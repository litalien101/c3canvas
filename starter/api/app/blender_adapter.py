"""Bounded local subprocess adapter for the allowlisted Blender worker."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from typing import Any
from uuid import UUID, uuid4


WORKER_ENTRY = Path(__file__).resolve().parents[2] / "worker" / "blender" / "worker_entry.py"
MAX_JOB_BYTES = 1024 * 1024
MAX_RESULT_BYTES = 1024 * 1024
MAX_SCENE_BYTES = 3 * 1024 * 1024 * 1024
MAX_PREVIEW_BYTES = 256 * 1024 * 1024
WORKER_TIMEOUT_SECONDS = 600


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
    ):
        raise BlenderAdapterError("Blender worker result did not match the requested project operation.")

    if operation == "preview_cc3_morph_controls":
        if result.get("scene_file") is not None:
            raise BlenderAdapterError("Blender preview operation unexpectedly returned a scene file.")
    else:
        scene_path = output_dir / "scene.blend"
        if scene_path.is_symlink() or not scene_path.is_file() or scene_path.stat().st_size > MAX_SCENE_BYTES:
            raise BlenderAdapterError("Blender worker scene output is missing or exceeds the size limit.")
        if result.get("scene_file") != "output/scene.blend":
            raise BlenderAdapterError("Blender worker returned an unexpected scene path.")

    preview_path = output_dir / "preview.glb"
    preview_status = result.get("preview_export_status")
    if preview_status == "pass":
        if (
            preview_path.is_symlink()
            or not preview_path.is_file()
            or preview_path.stat().st_size > MAX_PREVIEW_BYTES
            or result.get("preview_file") != "output/preview.glb"
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
) -> dict[str, Any]:
    executable = configured_blender_executable()
    if executable is None:
        raise BlenderAdapterError("Blender mode is selected, but COMODEL_BLENDER_EXECUTABLE is not configured.")
    if not WORKER_ENTRY.is_file():
        raise BlenderAdapterError("The allowlisted Blender worker entry point is missing.")

    data_root = data_directory.resolve()
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
    if (output_dir / "scene.blend").is_symlink() or (output_dir / "preview.glb").is_symlink():
        raise BlenderAdapterError("Blender output files cannot be symbolic links.")

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
            process = subprocess.run(
                [
                    str(executable),
                    "--background",
                    "--factory-startup",
                    "--disable-autoexec",
                    "--python-exit-code",
                    "1",
                    "--python",
                    str(WORKER_ENTRY),
                    "--",
                    "--job",
                    str(job_path),
                ],
                cwd=workspace,
                env=child_environment,
                capture_output=True,
                text=True,
                timeout=WORKER_TIMEOUT_SECONDS,
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise BlenderAdapterError("Blender worker exceeded its 600-second time limit.") from error
        except OSError as error:
            raise BlenderAdapterError("Blender worker could not be started.") from error
        if process.returncode != 0 and not (output_dir / "worker-error.json").is_file():
            raise BlenderAdapterError("Blender worker exited unexpectedly without a failure report.")
        return _read_worker_result(
            workspace=workspace,
            job_id=job_id,
            project_id=str(project_id),
            operation_id=str(operation_id),
            operation=operation,
            expected_scene_version=expected_scene_version,
        )
    finally:
        job_path.unlink(missing_ok=True)
