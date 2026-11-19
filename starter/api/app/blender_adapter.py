"""Bounded local subprocess adapter for the allowlisted Blender worker."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
from typing import Any, Callable
from uuid import UUID, uuid4


WORKER_ENTRY = Path(__file__).resolve().parents[2] / "worker" / "blender" / "worker_entry.py"
STAGED_WORKER_ENTRY = Path(__file__).resolve().parents[2] / "worker" / "blender" / "worker_entry_staged.py"
MAX_JOB_BYTES = 1024 * 1024
MAX_RESULT_BYTES = 1024 * 1024
MAX_SCENE_BYTES = 3 * 1024 * 1024 * 1024
MAX_PREVIEW_BYTES = 256 * 1024 * 1024
WORKER_TIMEOUT_SECONDS = 600
API_TRANSACTION_CONTRACT_VERSION = "transaction-v1"
STAGED_WORKER_CONTRACT_VERSION = "worker-staged-v2"


class BlenderAdapterError(RuntimeError):
    pass


def configured_blender_executable() -> Path | None:
    configured = os.getenv("COMODEL_BLENDER_EXECUTABLE")
    if not configured:
        return None

    resolved = shutil.which(configured)
    if resolved is None:
        candidate = Path(configured).expanduser()
        if candidate.is_file() and os.access(candidate, os.X_OK):
            resolved = str(candidate.resolve())
    if resolved is None:
        raise BlenderAdapterError("Configured Blender executable is unavailable or not executable.")
    return Path(resolved).resolve()


def _read_worker_result(
    *,
    workspace: Path,
    job_id: str,
    project_id: str,
    operation_id: str,
    operation: str,
    expected_scene_version: int,
    transaction_id: str | None = None,
    attempt_id: str | None = None,
) -> dict[str, Any]:
    output_dir = workspace / "output"
    error_path = output_dir / "worker-error.json"
    if error_path.is_symlink():
        raise BlenderAdapterError("Blender worker wrote an unsafe failure path.")
    if error_path.is_file():
        try:
            error_payload = json.loads(error_path.read_text(encoding="utf-8"))
            error = error_payload.get("error", "Blender worker rejected the operation.")
        except (OSError, json.JSONDecodeError):
            error = "Blender worker failed and wrote an invalid failure report."
        raise BlenderAdapterError(str(error)[:1000])

    result_path = output_dir / "result.json"
    if result_path.is_symlink() or not result_path.is_file() or result_path.stat().st_size > MAX_RESULT_BYTES:
        raise BlenderAdapterError("Blender worker did not produce a valid result report.")
    try:
        result = json.loads(result_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise BlenderAdapterError("Blender worker result report could not be read.") from error

    if (
        not isinstance(result, dict)
        or result.get("status") not in {"completed", "completed_with_warning"}
        or result.get("mode") != "blender"
        or result.get("job_id") != job_id
        or result.get("project_id") != project_id
        or result.get("operation_id") != operation_id
        or result.get("operation") != operation
        or result.get("expected_scene_version") != expected_scene_version
        or result.get("scene_version") != expected_scene_version + (
            operation not in {"validate_scene_structure", "preview_cc3_morph_controls"}
        )
        or (
            transaction_id is not None
            and (
                result.get("transaction_id") != transaction_id
                or result.get("attempt_id") != attempt_id
                or result.get("api_contract_version") != API_TRANSACTION_CONTRACT_VERSION
                or result.get("worker_contract_version") != STAGED_WORKER_CONTRACT_VERSION
            )
        )
    ):
        raise BlenderAdapterError("Blender worker result did not match the requested project operation.")

    if operation == "preview_cc3_morph_controls":
        if result.get("scene_file") is not None:
            raise BlenderAdapterError("Blender preview operation unexpectedly returned a scene file.")
    else:
        scene_filename = "scene_candidate.blend" if transaction_id is not None else "scene.blend"
        scene_path = output_dir / scene_filename
        if scene_path.is_symlink() or not scene_path.is_file() or scene_path.stat().st_size > MAX_SCENE_BYTES:
            raise BlenderAdapterError("Blender worker scene output is missing or exceeds the size limit.")
        if result.get("scene_file") != f"output/{scene_filename}":
            raise BlenderAdapterError("Blender worker returned an unexpected scene path.")

    preview_filename = "preview_candidate.glb" if transaction_id is not None else "preview.glb"
    preview_path = output_dir / preview_filename
    preview_status = result.get("preview_export_status")
    if preview_status == "pass":
        if (
            preview_path.is_symlink()
            or not preview_path.is_file()
            or preview_path.stat().st_size > MAX_PREVIEW_BYTES
            or result.get("preview_file") != f"output/{preview_filename}"
        ):
            raise BlenderAdapterError("Blender worker preview output is missing or exceeds the size limit.")
    elif preview_status != "fail" or result.get("preview_file") is not None:
        raise BlenderAdapterError("Blender worker returned an invalid preview status.")

    return result


def run_blender_operation(
    *,
    data_directory: Path,
    project_id: UUID,
    operation_id: UUID,
    expected_scene_version: int,
    operation: str,
    arguments: dict[str, Any],
    scope_component_ids: list[str],
    dependency_component_ids: list[str],
    transaction_id: UUID | None = None,
    attempt_id: UUID | None = None,
    staging_directory: Path | None = None,
    worker_started_callback: Callable[[subprocess.Popen[str]], None] | None = None,
) -> dict[str, Any]:
    staged_only = transaction_id is not None or attempt_id is not None or staging_directory is not None
    if staged_only and (
        transaction_id is None or attempt_id is None or staging_directory is None
    ):
        raise BlenderAdapterError("Transaction-aware worker calls require transaction, attempt, and staging identities.")
    executable = configured_blender_executable()
    if executable is None:
        raise BlenderAdapterError("Blender mode is selected, but COMODEL_BLENDER_EXECUTABLE is not configured.")
    worker_entry = STAGED_WORKER_ENTRY if staged_only else WORKER_ENTRY
    if not worker_entry.is_file():
        raise BlenderAdapterError("The allowlisted Blender worker entry point is missing.")

    data_root = data_directory.resolve()
    if staged_only:
        transactions_directory = data_root / "transactions"
        if transactions_directory.is_symlink():
            raise BlenderAdapterError("Transaction staging paths cannot be symbolic links.")
        transactions_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(transactions_directory, 0o700)
        transaction_root = transactions_directory / str(transaction_id)
        if transaction_root.is_symlink():
            raise BlenderAdapterError("Transaction paths cannot be symbolic links.")
        transaction_root.mkdir(mode=0o700, exist_ok=True)
        os.chmod(transaction_root, 0o700)
        workspace = staging_directory.resolve()
        expected_workspace = (transaction_root / str(attempt_id)).resolve()
        if workspace != expected_workspace:
            raise BlenderAdapterError("Transaction staging path does not match its transaction and attempt IDs.")
        if workspace.exists():
            raise BlenderAdapterError("Transaction attempt staging directory already exists.")
        workspace.mkdir(parents=True, mode=0o700)
    else:
        projects_directory = data_root / "blender-projects"
        if projects_directory.is_symlink():
            raise BlenderAdapterError("Blender workspace paths cannot be symbolic links.")
        projects_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        workspace = projects_directory / str(project_id)
    if workspace.is_symlink():
        raise BlenderAdapterError("Blender workspace paths cannot be symbolic links.")
    workspace.mkdir(parents=True, exist_ok=True, mode=0o700)
    directories = (workspace / "output", workspace / "home", workspace / "tmp", workspace / "config")
    if any(directory.is_symlink() for directory in directories):
        raise BlenderAdapterError("Blender workspace paths cannot be symbolic links.")
    for directory in directories:
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if any(directory.is_symlink() for directory in (workspace, *directories)):
        raise BlenderAdapterError("Blender workspace paths cannot be symbolic links.")
    output_dir = workspace / "output"
    if any((output_dir / name).is_symlink() for name in (
        "scene.blend", "preview.glb", "scene_candidate.blend", "preview_candidate.glb",
    )):
        raise BlenderAdapterError("Blender output files cannot be symbolic links.")
    if staged_only:
        committed_output = data_root / "blender-projects" / str(project_id) / "output"
        if any(path.is_symlink() for path in (data_root / "blender-projects", committed_output.parent, committed_output)):
            raise BlenderAdapterError("Committed Blender project paths cannot be symbolic links.")
        if committed_output.exists():
            for source in committed_output.iterdir():
                if source.name == "scene.blend" or re.fullmatch(r"scene-v[0-9]+\.blend", source.name):
                    if source.is_symlink() or not source.is_file():
                        raise BlenderAdapterError("Committed scene inputs cannot be symbolic links.")
                    destination = output_dir / source.name
                    try:
                        os.link(source, destination)
                    except OSError:
                        shutil.copy2(source, destination)

    job_id = str(uuid4())
    job_payload = {
        "job_id": job_id,
        "project_id": str(project_id),
        "operation_id": str(operation_id),
        "expected_scene_version": expected_scene_version,
        "operation": operation,
        "scope_component_ids": scope_component_ids,
        "dependency_component_ids": dependency_component_ids,
        "arguments": arguments,
    }
    if staged_only:
        job_payload["transaction_id"] = str(transaction_id)
        job_payload["attempt_id"] = str(attempt_id)
        job_payload["api_contract_version"] = API_TRANSACTION_CONTRACT_VERSION
        job_payload["worker_contract_version"] = STAGED_WORKER_CONTRACT_VERSION
    job_descriptor, job_name = tempfile.mkstemp(prefix=f".job-{operation_id}-", suffix=".json", dir=workspace)
    job_path = Path(job_name)
    try:
        with os.fdopen(job_descriptor, "w", encoding="utf-8") as job_file:
            json.dump(job_payload, job_file, separators=(",", ":"))
        if job_path.stat().st_size > MAX_JOB_BYTES:
            raise BlenderAdapterError("Generated Blender job exceeds the configured size limit.")

        child_environment = {
            "PATH": os.getenv("PATH", ""),
            "HOME": str(workspace / "home"),
            "TMPDIR": str(workspace / "tmp"),
            "TEMP": str(workspace / "tmp"),
            "TMP": str(workspace / "tmp"),
            "BLENDER_USER_CONFIG": str(workspace / "config"),
            "LANG": os.getenv("LANG", "C.UTF-8"),
        }
        try:
            command = [
                    str(executable),
                    "--background",
                    "--factory-startup",
                    "--disable-autoexec",
                    "--python-exit-code",
                    "1",
                    "--python",
                    str(worker_entry),
                    "--",
                    "--job",
                    str(job_path),
                ]
            if staged_only:
                command.append("--staged-only")
                process = subprocess.Popen(
                    command,
                    cwd=workspace,
                    env=child_environment,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    start_new_session=True,
                )
                try:
                    if worker_started_callback is not None:
                        worker_started_callback(process)
                    stdout, stderr = process.communicate(timeout=WORKER_TIMEOUT_SECONDS)
                except subprocess.TimeoutExpired as error:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.communicate()
                    raise BlenderAdapterError("Blender worker exceeded its 600-second time limit.") from error
                except Exception:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.communicate()
                    raise
                returncode = process.returncode
            else:
                process = subprocess.run(
                    command,
                    cwd=workspace,
                    env=child_environment,
                    capture_output=True,
                    text=True,
                    timeout=WORKER_TIMEOUT_SECONDS,
                    check=False,
                )
                stdout, stderr, returncode = process.stdout, process.stderr, process.returncode
        except subprocess.TimeoutExpired as error:
            raise BlenderAdapterError("Blender worker exceeded its 600-second time limit.") from error
        except OSError as error:
            raise BlenderAdapterError("Blender worker could not be started.") from error
        if returncode != 0 and not (output_dir / "worker-error.json").is_file():
            raise BlenderAdapterError("Blender worker exited unexpectedly without a failure report.")
        return _read_worker_result(
            workspace=workspace,
            job_id=job_id,
            project_id=str(project_id),
            operation_id=str(operation_id),
            operation=operation,
            expected_scene_version=expected_scene_version,
            transaction_id=str(transaction_id) if staged_only else None,
            attempt_id=str(attempt_id) if staged_only else None,
        )
    finally:
        job_path.unlink(missing_ok=True)
