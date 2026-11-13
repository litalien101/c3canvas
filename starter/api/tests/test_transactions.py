from __future__ import annotations

import multiprocessing
import os
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from app import main
from app.repository import SQLiteProjectRepository
from app.transactions import (
    ProjectLockError,
    ProjectLockTimeout,
    acquire_project_lock,
    hold_project_lock,
    require_project_lock,
)


def _hold_lock(data_directory: str, project_id: str, ready, release) -> None:
    with hold_project_lock(Path(data_directory), UUID(project_id)):
        ready.set()
        release.wait(5)


def _exit_with_lock(data_directory: str, project_id: str, ready) -> None:
    lock = acquire_project_lock(Path(data_directory), UUID(project_id))
    ready.set()
    os._exit(0)


def test_project_lock_verifies_ownership_and_releases(tmp_path: Path) -> None:
    project_id = uuid4()
    with hold_project_lock(tmp_path, project_id) as lock:
        lock.assert_owned(project_id)
        assert require_project_lock(project_id) is lock

    with pytest.raises(ProjectLockError):
        require_project_lock(project_id)


def test_project_lock_coordinates_processes_and_times_out(tmp_path: Path) -> None:
    context = multiprocessing.get_context("fork")
    project_id = uuid4()
    ready = context.Event()
    release = context.Event()
    process = context.Process(
        target=_hold_lock,
        args=(str(tmp_path), str(project_id), ready, release),
    )
    process.start()
    try:
        assert ready.wait(5)
        with pytest.raises(ProjectLockTimeout):
            acquire_project_lock(tmp_path, project_id, timeout=0.1)
    finally:
        release.set()
        process.join(5)
        if process.is_alive():
            process.terminate()
            process.join(5)
    assert process.exitcode == 0


def test_project_lock_is_released_when_owner_process_dies(tmp_path: Path) -> None:
    context = multiprocessing.get_context("fork")
    project_id = uuid4()
    ready = context.Event()
    process = context.Process(
        target=_exit_with_lock,
        args=(str(tmp_path), str(project_id), ready),
    )
    process.start()
    assert ready.wait(5)
    process.join(5)
    assert process.exitcode == 0

    with hold_project_lock(tmp_path, project_id) as lock:
        lock.assert_owned(project_id)


def _create_transaction_repo(tmp_path: Path, monkeypatch) -> tuple[SQLiteProjectRepository, main.Project]:
    repository = SQLiteProjectRepository(tmp_path / "transactions.sqlite")
    project = main.Project(name="Transaction test", target_profile="test", mode="blender")
    repository.create_account("test-owner", "test-owner", "unused-hash", "2024-01-01T00:00:00+00:00")
    repository.create(project, "test-owner")
    monkeypatch.setattr(main, "REPOSITORY", repository)
    return repository, project


def test_operation_identity_survives_rollback_and_rejects_reuse(tmp_path: Path, monkeypatch) -> None:
    repository, project = _create_transaction_repo(tmp_path, monkeypatch)
    operation_id = str(uuid4())
    component_id = str(uuid4())

    with hold_project_lock(tmp_path, project.id):
        first = repository.prepare_modeling_transaction(
            project=project,
            operation_id=operation_id,
            request_hash="request-hash",
            transaction_id=str(uuid4()),
            attempt_id=str(uuid4()),
            api_contract_version=main.API_TRANSACTION_CONTRACT_VERSION,
            worker_contract_version=main.STAGED_WORKER_CONTRACT_VERSION,
            allocated_component_id=component_id,
            staging_path=str(tmp_path / "transactions" / "first" / "attempt"),
            backup_path=str(tmp_path / "transactions" / "first" / "backup"),
            target_scene_version=1,
        )
        with pytest.raises(ValueError, match="Invalid transaction state transition"):
            repository.update_modeling_transaction(first["transaction_id"], "COMMITTED")
        repository.update_modeling_transaction(first["transaction_id"], "ROLLING_BACK")
        repository.restore_modeling_transaction_metadata(first["transaction_id"])

        with pytest.raises(ValueError, match="OPERATION_ID_REUSED"):
            repository.prepare_modeling_transaction(
                project=project,
                operation_id=operation_id,
                request_hash="different-request",
                transaction_id=str(uuid4()),
                attempt_id=str(uuid4()),
                api_contract_version=main.API_TRANSACTION_CONTRACT_VERSION,
                worker_contract_version=main.STAGED_WORKER_CONTRACT_VERSION,
                allocated_component_id=component_id,
                staging_path=str(tmp_path / "transactions" / "wrong" / "attempt"),
                backup_path=str(tmp_path / "transactions" / "wrong" / "backup"),
                target_scene_version=1,
            )

        retry = repository.prepare_modeling_transaction(
            project=project,
            operation_id=operation_id,
            request_hash="request-hash",
            transaction_id=str(uuid4()),
            attempt_id=str(uuid4()),
            api_contract_version=main.API_TRANSACTION_CONTRACT_VERSION,
            worker_contract_version=main.STAGED_WORKER_CONTRACT_VERSION,
            allocated_component_id=None,
            staging_path=str(tmp_path / "transactions" / "retry" / "attempt"),
            backup_path=str(tmp_path / "transactions" / "retry" / "backup"),
            target_scene_version=1,
        )
        assert retry["attempt_id"] != first["attempt_id"]
        assert retry["api_contract_version"] == main.API_TRANSACTION_CONTRACT_VERSION
        assert retry["worker_contract_version"] == main.STAGED_WORKER_CONTRACT_VERSION
        operation = repository.get_modeling_operation(project.id, operation_id)
        assert operation is not None
        assert operation["allocated_component_id"] == component_id


def test_recovery_restores_both_artifacts_if_metadata_commit_fails(tmp_path: Path, monkeypatch) -> None:
    repository, project = _create_transaction_repo(tmp_path, monkeypatch)
    operation_id = str(uuid4())
    transaction_id = str(uuid4())
    attempt_id = str(uuid4())
    project_output = tmp_path / "blender-projects" / str(project.id) / "output"
    project_output.mkdir(parents=True)
    (project_output / "scene.blend").write_bytes(b"old scene")
    (project_output / "preview.glb").write_bytes(b"old preview")
    staging_root = tmp_path / "transactions" / transaction_id / attempt_id
    staged_output = staging_root / "output"
    staged_output.mkdir(parents=True)
    (staged_output / "scene_candidate.blend").write_bytes(b"new scene")
    (staged_output / "preview_candidate.glb").write_bytes(b"new preview")

    project.scene_version = 1
    repository.save(project)
    operation = {"operation_id": operation_id, "tool_name": "test", "scene_version": 2}
    with hold_project_lock(tmp_path, project.id):
        transaction = repository.prepare_modeling_transaction(
            project=project,
            operation_id=operation_id,
            request_hash="request-hash",
            transaction_id=transaction_id,
            attempt_id=attempt_id,
            api_contract_version=main.API_TRANSACTION_CONTRACT_VERSION,
            worker_contract_version=main.STAGED_WORKER_CONTRACT_VERSION,
            allocated_component_id=None,
            staging_path=str(staging_root),
            backup_path=str(tmp_path / "transactions" / transaction_id / "backup"),
            target_scene_version=2,
        )
        project.scene_version = 2

        def fail_metadata_commit(*_args, **_kwargs):
            raise RuntimeError("simulated crash before SQLite commit")

        monkeypatch.setattr(repository, "commit_modeling_transaction", fail_metadata_commit)
        with pytest.raises(RuntimeError, match="simulated crash"):
            main._commit_modeling_operation(project, operation, transaction)

        assert (project_output / "scene.blend").read_bytes() == b"new scene"
        assert (project_output / "preview.glb").read_bytes() == b"new preview"
        main.recover_project_transactions(project.id)

    assert (project_output / "scene.blend").read_bytes() == b"old scene"
    assert (project_output / "preview.glb").read_bytes() == b"old preview"
    assert repository.get(project.id).scene_version == 1
    with hold_project_lock(tmp_path, project.id):
        assert repository.get_modeling_transaction(transaction_id)["state"] == "ROLLED_BACK"


def test_corrupt_committed_artifact_blocks_until_explicit_recovery(tmp_path: Path, monkeypatch) -> None:
    repository, project = _create_transaction_repo(tmp_path, monkeypatch)
    transaction_id = str(uuid4())
    attempt_id = str(uuid4())
    operation_id = str(uuid4())
    staging_root = tmp_path / "transactions" / transaction_id / attempt_id
    staged_output = staging_root / "output"
    staged_output.mkdir(parents=True)
    (staged_output / "scene_candidate.blend").write_bytes(b"scene")
    (staged_output / "preview_candidate.glb").write_bytes(b"preview")
    project.scene_version = 1
    transaction = None

    with hold_project_lock(tmp_path, project.id):
        transaction = repository.prepare_modeling_transaction(
            project=main.Project(
                id=project.id,
                name=project.name,
                target_profile=project.target_profile,
                scene_version=0,
                mode="blender",
            ),
            operation_id=operation_id,
            request_hash="request-hash",
            transaction_id=transaction_id,
            attempt_id=attempt_id,
            api_contract_version=main.API_TRANSACTION_CONTRACT_VERSION,
            worker_contract_version=main.STAGED_WORKER_CONTRACT_VERSION,
            allocated_component_id=None,
            staging_path=str(staging_root),
            backup_path=str(tmp_path / "transactions" / transaction_id / "backup"),
            target_scene_version=1,
        )
        main._commit_modeling_operation(
            project,
            {"operation_id": operation_id, "tool_name": "test", "scene_version": 1},
            transaction,
        )

        output = tmp_path / "blender-projects" / str(project.id) / "output"
        (output / "preview.glb").write_bytes(b"corrupt")
        with pytest.raises(ProjectLockError, match="integrity verification"):
            main.recover_project_transactions(project.id)
        assert repository.get_modeling_transaction(transaction_id)["state"] == "BLOCKED"

        main.recover_blocked_modeling_transaction(project.id, transaction_id)
        assert repository.get_modeling_transaction(transaction_id)["state"] == "ROLLED_BACK"

    assert repository.get(project.id).scene_version == 0
    assert not (output / "scene.blend").exists()
    assert not (output / "preview.glb").exists()
