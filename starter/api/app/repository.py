"""SQLite-backed project repository for the local MVP."""
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from typing import TYPE_CHECKING, Iterator
from contextlib import contextmanager
from uuid import UUID

from .transactions import require_project_lock

if TYPE_CHECKING:
    from .main import Project


def database_path_from_env() -> Path:
    database_url = os.getenv("DATABASE_URL", "sqlite:///./data/comodel.db")
    prefix = "sqlite:///"
    if not database_url.startswith(prefix):
        raise ValueError("Only SQLite DATABASE_URL values are supported by the local MVP.")

    database_path = Path(database_url.removeprefix(prefix))
    if not database_path.is_absolute():
        database_path = Path.cwd() / database_path
    return database_path.resolve()


class SQLiteProjectRepository:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._migrate()

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _migrate(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            applied = connection.execute(
                "SELECT 1 FROM schema_migrations WHERE version = 1"
            ).fetchone()
            if not applied:
                connection.execute(
                    """
                    CREATE TABLE projects (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        target_profile TEXT NOT NULL,
                        scene_version INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        mode TEXT NOT NULL DEFAULT 'mock'
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE project_state (
                        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
                        phases_json TEXT NOT NULL DEFAULT '[]',
                        components_json TEXT NOT NULL DEFAULT '[]',
                        checkpoints_json TEXT NOT NULL DEFAULT '[]'
                    )
                    """
                )
                connection.execute("INSERT INTO schema_migrations (version) VALUES (1)")

            applied_v2 = connection.execute(
                "SELECT 1 FROM schema_migrations WHERE version = 2"
            ).fetchone()
            if not applied_v2:
                connection.execute(
                    "ALTER TABLE project_state ADD COLUMN plan_json TEXT NOT NULL DEFAULT '[]'"
                )
                connection.execute(
                    "ALTER TABLE project_state ADD COLUMN references_json TEXT NOT NULL DEFAULT '[]'"
                )
                connection.execute(
                    "ALTER TABLE project_state ADD COLUMN messages_json TEXT NOT NULL DEFAULT '[]'"
                )
                connection.execute("INSERT INTO schema_migrations (version) VALUES (2)")

            applied_v3 = connection.execute(
                "SELECT 1 FROM schema_migrations WHERE version = 3"
            ).fetchone()
            if not applied_v3:
                connection.execute(
                    "ALTER TABLE project_state ADD COLUMN operations_json TEXT NOT NULL DEFAULT '[]'"
                )
                connection.execute("INSERT INTO schema_migrations (version) VALUES (3)")

            applied_v4 = connection.execute(
                "SELECT 1 FROM schema_migrations WHERE version = 4"
            ).fetchone()
            if not applied_v4:
                connection.execute(
                    "ALTER TABLE project_state ADD COLUMN planning_metadata_json TEXT NOT NULL DEFAULT '{}'"
                )
                connection.execute("INSERT INTO schema_migrations (version) VALUES (4)")

            applied_v5 = connection.execute(
                "SELECT 1 FROM schema_migrations WHERE version = 5"
            ).fetchone()
            if not applied_v5:
                connection.execute(
                    "ALTER TABLE projects ADD COLUMN base_model_asset_id TEXT NOT NULL "
                    "DEFAULT 'character_cc3_morphs_v1'"
                )
                connection.execute("INSERT INTO schema_migrations (version) VALUES (5)")

            applied_v6 = connection.execute(
                "SELECT 1 FROM schema_migrations WHERE version = 6"
            ).fetchone()
            if not applied_v6:
                connection.execute(
                    "ALTER TABLE project_state ADD COLUMN draft_morphs_json TEXT NOT NULL DEFAULT '{}'"
                )
                connection.execute(
                    "ALTER TABLE project_state ADD COLUMN draft_revision INTEGER NOT NULL DEFAULT 0"
                )
                connection.execute("INSERT INTO schema_migrations (version) VALUES (6)")

            applied_v7 = connection.execute(
                "SELECT 1 FROM schema_migrations WHERE version = 7"
            ).fetchone()
            if not applied_v7:
                connection.execute(
                    "ALTER TABLE project_state ADD COLUMN draft_appearance_json "
                    "TEXT NOT NULL DEFAULT '{\"eye_asset_id\":null,\"body_preset_id\":null}'"
                )
                connection.execute("INSERT INTO schema_migrations (version) VALUES (7)")

            applied_v8 = connection.execute(
                "SELECT 1 FROM schema_migrations WHERE version = 8"
            ).fetchone()
            if not applied_v8:
                for row in connection.execute(
                    "SELECT project_id, draft_appearance_json FROM project_state"
                ):
                    appearance = json.loads(row["draft_appearance_json"])
                    appearance.setdefault("skin_asset_id", None)
                    connection.execute(
                        "UPDATE project_state SET draft_appearance_json = ? WHERE project_id = ?",
                        (json.dumps(appearance), row["project_id"]),
                    )
                connection.execute("INSERT INTO schema_migrations (version) VALUES (8)")

            applied_v9 = connection.execute(
                "SELECT 1 FROM schema_migrations WHERE version = 9"
            ).fetchone()
            if not applied_v9:
                connection.execute(
                    "ALTER TABLE project_state ADD COLUMN draft_skin_paint_strokes_json "
                    "TEXT NOT NULL DEFAULT '[]'"
                )
                connection.execute("INSERT INTO schema_migrations (version) VALUES (9)")

            applied_v10 = connection.execute(
                "SELECT 1 FROM schema_migrations WHERE version = 10"
            ).fetchone()
            if not applied_v10:
                connection.execute(
                    "ALTER TABLE project_state ADD COLUMN draft_skin_definition_json "
                    "TEXT NOT NULL DEFAULT '{\"version\":1,\"base\":{\"tone\":0.62,\"undertone\":\"neutral\"},"
                    "\"surface\":{\"roughness\":0.42}}'"
                )
                connection.execute(
                    "ALTER TABLE project_state ADD COLUMN draft_skin_revision "
                    "INTEGER NOT NULL DEFAULT 0"
                )
                connection.execute("INSERT INTO schema_migrations (version) VALUES (10)")

            applied_v11 = connection.execute(
                "SELECT 1 FROM schema_migrations WHERE version = 11"
            ).fetchone()
            if not applied_v11:
                connection.execute(
                    """
                    CREATE TABLE accounts (
                        id TEXT PRIMARY KEY,
                        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
                        password_hash TEXT NOT NULL,
                        created_at TEXT NOT NULL
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE account_sessions (
                        token_hash TEXT PRIMARY KEY,
                        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                        csrf_token TEXT NOT NULL,
                        expires_at TEXT NOT NULL
                    )
                    """
                )
                connection.execute(
                    "CREATE INDEX account_sessions_account_id ON account_sessions(account_id)"
                )
                connection.execute(
                    "ALTER TABLE projects ADD COLUMN owner_id TEXT REFERENCES accounts(id)"
                )
                connection.execute("INSERT INTO schema_migrations (version) VALUES (11)")

            applied_v12 = connection.execute(
                "SELECT 1 FROM schema_migrations WHERE version = 12"
            ).fetchone()
            if not applied_v12:
                connection.execute(
                    "ALTER TABLE project_state ADD COLUMN draft_hair_settings_json "
                    "TEXT NOT NULL DEFAULT '{}'"
                )
                connection.execute(
                    "ALTER TABLE project_state ADD COLUMN draft_hair_revision "
                    "INTEGER NOT NULL DEFAULT 0"
                )
                connection.execute("INSERT INTO schema_migrations (version) VALUES (12)")

            applied_v13 = connection.execute(
                "SELECT 1 FROM schema_migrations WHERE version = 13"
            ).fetchone()
            if not applied_v13:
                connection.execute(
                    """
                    CREATE TABLE modeling_operations (
                        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                        operation_id TEXT NOT NULL,
                        request_hash TEXT NOT NULL,
                        allocated_component_id TEXT,
                        status TEXT NOT NULL,
                        active_attempt_id TEXT,
                        result_json TEXT,
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        PRIMARY KEY (project_id, operation_id)
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE TABLE modeling_transactions (
                        transaction_id TEXT PRIMARY KEY,
                        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                        operation_id TEXT NOT NULL,
                        attempt_id TEXT NOT NULL UNIQUE,
                        state TEXT NOT NULL,
                        previous_scene_version INTEGER NOT NULL,
                        target_scene_version INTEGER NOT NULL,
                        staging_path TEXT NOT NULL,
                        backup_path TEXT NOT NULL,
                        prior_project_json TEXT NOT NULL,
                        worker_pid INTEGER,
                        worker_start_ticks TEXT,
                        worker_boot_id TEXT,
                        worker_process_group INTEGER,
                        candidate_scene_sha256 TEXT,
                        candidate_preview_sha256 TEXT,
                        backup_scene_sha256 TEXT,
                        backup_preview_sha256 TEXT,
                        error TEXT,
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (project_id, operation_id)
                            REFERENCES modeling_operations(project_id, operation_id)
                            ON DELETE CASCADE
                    )
                    """
                )
                connection.execute(
                    "CREATE INDEX modeling_transactions_project_state "
                    "ON modeling_transactions(project_id, state)"
                )
                connection.execute("INSERT INTO schema_migrations (version) VALUES (13)")

            applied_v14 = connection.execute(
                "SELECT 1 FROM schema_migrations WHERE version = 14"
            ).fetchone()
            if not applied_v14:
                connection.execute(
                    "ALTER TABLE modeling_transactions ADD COLUMN api_contract_version "
                    "TEXT NOT NULL DEFAULT 'unrecorded'"
                )
                connection.execute(
                    "ALTER TABLE modeling_transactions ADD COLUMN worker_contract_version "
                    "TEXT NOT NULL DEFAULT 'unrecorded'"
                )
                connection.execute("INSERT INTO schema_migrations (version) VALUES (14)")

    def create(self, project: Project, owner_id: str) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO projects (
                    id, name, target_profile, scene_version, created_at, updated_at, mode, base_model_asset_id,
                    owner_id
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(project.id),
                    project.name,
                    project.target_profile,
                    project.scene_version,
                    project.created_at.isoformat(),
                    project.updated_at.isoformat(),
                    project.mode,
                    project.base_model_asset_id,
                    owner_id,
                ),
            )
            self._write_state(connection, project)

    def get(self, project_id: UUID, owner_id: str | None = None) -> Project | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT p.*, s.phases_json, s.components_json, s.checkpoints_json,
                       s.plan_json, s.planning_metadata_json, s.references_json, s.messages_json, s.operations_json,
                       s.draft_morphs_json, s.draft_revision, s.draft_appearance_json,
                       s.draft_skin_paint_strokes_json, s.draft_skin_definition_json,
                       s.draft_skin_revision
                FROM projects AS p
                JOIN project_state AS s ON s.project_id = p.id
                WHERE p.id = ? AND (? IS NULL OR p.owner_id = ?)
                """,
                (str(project_id), owner_id, owner_id),
            ).fetchone()
        return self._project_from_row(row) if row else None

    def get_project_owner(self, project_id: UUID) -> str | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT owner_id FROM projects WHERE id = ?",
                (str(project_id),),
            ).fetchone()
        return row["owner_id"] if row else None

    def list(self, owner_id: str) -> list[Project]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT p.*, s.phases_json, s.components_json, s.checkpoints_json,
                       s.plan_json, s.planning_metadata_json, s.references_json, s.messages_json, s.operations_json,
                       s.draft_morphs_json, s.draft_revision, s.draft_appearance_json,
                       s.draft_skin_paint_strokes_json, s.draft_skin_definition_json,
                       s.draft_skin_revision
                FROM projects AS p
                JOIN project_state AS s ON s.project_id = p.id
                WHERE p.owner_id = ?
                ORDER BY p.created_at, p.id
                """,
                (owner_id,),
            ).fetchall()
        return [self._project_from_row(row) for row in rows]

    def list_summaries(self, owner_id: str) -> list[dict[str, object]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT p.id, p.name, p.base_model_asset_id, s.components_json
                FROM projects AS p
                JOIN project_state AS s ON s.project_id = p.id
                WHERE p.owner_id = ?
                ORDER BY p.created_at, p.id
                """,
                (owner_id,),
            ).fetchall()
        summaries = []
        for row in rows:
            components = json.loads(row["components_json"])
            summaries.append({
                "id": row["id"],
                "name": row["name"],
                "base_model_asset_id": row["base_model_asset_id"],
                "has_character": any(
                    isinstance(component.get("source_asset"), dict)
                    for component in components
                    if isinstance(component, dict)
                ),
            })
        return summaries

    def delete(self, project_id: UUID, owner_id: str) -> bool:
        with self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM projects WHERE id = ? AND owner_id = ?",
                (str(project_id), owner_id),
            )
            return cursor.rowcount > 0

    def create_account(
        self,
        account_id: str,
        username: str,
        password_hash: str,
        created_at: str,
    ) -> None:
        with self._connect() as connection:
            is_first_account = connection.execute(
                "SELECT 1 FROM accounts LIMIT 1"
            ).fetchone() is None
            connection.execute(
                "INSERT INTO accounts (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
                (account_id, username, password_hash, created_at),
            )
            if is_first_account:
                connection.execute(
                    "UPDATE projects SET owner_id = ? WHERE owner_id IS NULL",
                    (account_id,),
                )

    def get_account_by_username(self, username: str) -> dict[str, str] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT id, username, password_hash, created_at FROM accounts WHERE username = ?",
                (username,),
            ).fetchone()
        return dict(row) if row else None

    def get_account(self, account_id: str) -> dict[str, str] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT id, username, created_at FROM accounts WHERE id = ?",
                (account_id,),
            ).fetchone()
        return dict(row) if row else None

    def create_session(
        self,
        token_hash: str,
        account_id: str,
        csrf_token: str,
        expires_at: str,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO account_sessions (token_hash, account_id, csrf_token, expires_at)
                VALUES (?, ?, ?, ?)
                """,
                (token_hash, account_id, csrf_token, expires_at),
            )

    def get_session(self, token_hash: str, now: str) -> dict[str, str] | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT a.id, a.username, a.created_at, s.token_hash, s.csrf_token, s.expires_at
                FROM account_sessions AS s
                JOIN accounts AS a ON a.id = s.account_id
                WHERE s.token_hash = ? AND s.expires_at > ?
                """,
                (token_hash, now),
            ).fetchone()
        return dict(row) if row else None

    def delete_session(self, token_hash: str) -> None:
        with self._connect() as connection:
            connection.execute(
                "DELETE FROM account_sessions WHERE token_hash = ?",
                (token_hash,),
            )

    def save(self, project: Project) -> None:
        with self._connect() as connection:
            updated = connection.execute(
                """
                UPDATE projects
                SET name = ?, target_profile = ?, scene_version = ?, updated_at = ?, mode = ?,
                    base_model_asset_id = ?
                WHERE id = ?
                """,
                (
                    project.name,
                    project.target_profile,
                    project.scene_version,
                    project.updated_at.isoformat(),
                    project.mode,
                    project.base_model_asset_id,
                    str(project.id),
                ),
            )
            if updated.rowcount == 0:
                raise KeyError(f"Cannot save unknown project {project.id}")
            self._write_state(connection, project)

    def prepare_modeling_transaction(
        self,
        *,
        project: Project,
        operation_id: str,
        request_hash: str,
        transaction_id: str,
        attempt_id: str,
        api_contract_version: str,
        worker_contract_version: str,
        allocated_component_id: str | None,
        staging_path: str,
        backup_path: str,
        target_scene_version: int,
    ) -> dict:
        project_id = str(project.id)
        require_project_lock(project.id)
        prior_project_json = project.model_dump_json()
        with self._connect() as connection:
            operation = connection.execute(
                "SELECT * FROM modeling_operations WHERE project_id = ? AND operation_id = ?",
                (project_id, operation_id),
            ).fetchone()
            if operation is not None:
                if operation["request_hash"] != request_hash:
                    raise ValueError("OPERATION_ID_REUSED")
                stored_component_id = operation["allocated_component_id"]
                if (
                    stored_component_id is not None
                    and allocated_component_id is not None
                    and stored_component_id != allocated_component_id
                ):
                    raise ValueError("OPERATION_COMPONENT_ID_MISMATCH")
                if operation["status"] == "committed":
                    raise ValueError("OPERATION_ALREADY_COMMITTED")
                if stored_component_id is not None:
                    allocated_component_id = stored_component_id
            else:
                connection.execute(
                    """
                    INSERT INTO modeling_operations (
                        project_id, operation_id, request_hash, allocated_component_id, status
                    ) VALUES (?, ?, ?, ?, 'pending')
                    """,
                    (project_id, operation_id, request_hash, allocated_component_id),
                )

            unresolved = connection.execute(
                """
                SELECT transaction_id FROM modeling_transactions
                WHERE project_id = ? AND state IN
                    ('PREPARED', 'COMMITTING', 'ROLLING_BACK', 'BLOCKED')
                LIMIT 1
                """,
                (project_id,),
            ).fetchone()
            if unresolved is not None:
                raise ValueError("PROJECT_TRANSACTION_UNRESOLVED")
            connection.execute(
                """
                INSERT INTO modeling_transactions (
                    transaction_id, project_id, operation_id, attempt_id, state,
                    previous_scene_version, target_scene_version, staging_path,
                    backup_path, prior_project_json, api_contract_version,
                    worker_contract_version
                ) VALUES (?, ?, ?, ?, 'PREPARED', ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    transaction_id,
                    project_id,
                    operation_id,
                    attempt_id,
                    project.scene_version,
                    target_scene_version,
                    staging_path,
                    backup_path,
                    prior_project_json,
                    api_contract_version,
                    worker_contract_version,
                ),
            )
            connection.execute(
                """
                UPDATE modeling_operations
                SET allocated_component_id = COALESCE(allocated_component_id, ?),
                    status = 'pending', active_attempt_id = ?, updated_at = CURRENT_TIMESTAMP
                WHERE project_id = ? AND operation_id = ?
                """,
                (allocated_component_id, attempt_id, project_id, operation_id),
            )
            row = connection.execute(
                "SELECT * FROM modeling_transactions WHERE transaction_id = ?",
                (transaction_id,),
            ).fetchone()
            return dict(row)

    def get_modeling_transaction(self, transaction_id: str) -> dict | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM modeling_transactions WHERE transaction_id = ?",
                (transaction_id,),
            ).fetchone()
            if row is not None:
                require_project_lock(UUID(row["project_id"]))
        return dict(row) if row is not None else None

    def list_unresolved_modeling_transactions(self, project_id: str) -> list[dict]:
        require_project_lock(UUID(project_id))
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM modeling_transactions
                WHERE project_id = ? AND state NOT IN ('COMMITTED', 'ROLLED_BACK')
                ORDER BY created_at, transaction_id
                """,
                (project_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_latest_committed_modeling_transaction(self, project_id: UUID) -> dict | None:
        require_project_lock(project_id)
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT * FROM modeling_transactions
                WHERE project_id = ? AND state = 'COMMITTED'
                ORDER BY target_scene_version DESC, created_at DESC
                LIMIT 1
                """,
                (str(project_id),),
            ).fetchone()
        return dict(row) if row is not None else None

    def record_modeling_worker(
        self,
        transaction_id: str,
        *,
        worker_pid: int,
        worker_start_ticks: str,
        worker_boot_id: str,
        worker_process_group: int,
    ) -> None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT project_id, state FROM modeling_transactions WHERE transaction_id = ?",
                (transaction_id,),
            ).fetchone()
            if row is None:
                raise KeyError("Transaction journal entry was not found")
            require_project_lock(UUID(row["project_id"]))
            if row["state"] != "PREPARED":
                raise ValueError("Worker identity can only be recorded while PREPARED")
            updated = connection.execute(
                """
                UPDATE modeling_transactions
                SET worker_pid = ?, worker_start_ticks = ?, worker_boot_id = ?,
                    worker_process_group = ?, updated_at = CURRENT_TIMESTAMP
                WHERE transaction_id = ? AND state = 'PREPARED'
                """,
                (
                    worker_pid, worker_start_ticks, worker_boot_id,
                    worker_process_group, transaction_id,
                ),
            )
            if updated.rowcount != 1:
                raise ValueError("Worker identity was not attached to the active transaction")

    def update_modeling_transaction(
        self,
        transaction_id: str,
        target_state: str,
        *,
        updates: dict[str, object] | None = None,
    ) -> dict:
        transitions = {
            "PREPARED": {"COMMITTING", "ROLLING_BACK", "BLOCKED"},
            "COMMITTING": {"COMMITTED", "ROLLING_BACK", "BLOCKED"},
            "ROLLING_BACK": {"ROLLED_BACK", "BLOCKED"},
            "ROLLED_BACK": set(),
            "COMMITTED": {"BLOCKED"},
            "BLOCKED": {"ROLLING_BACK"},
        }
        allowed_fields = {
            "worker_pid", "worker_start_ticks", "worker_boot_id",
            "worker_process_group", "candidate_scene_sha256",
            "candidate_preview_sha256", "backup_scene_sha256",
            "backup_preview_sha256", "error",
        }
        changes = updates or {}
        if set(changes) - allowed_fields:
            raise ValueError("Unsupported transaction journal update field")
        with self._connect() as connection:
            row = connection.execute(
                "SELECT state FROM modeling_transactions WHERE transaction_id = ?",
                (transaction_id,),
            ).fetchone()
            if row is None:
                raise KeyError("Transaction journal entry was not found")
            project_id = connection.execute(
                "SELECT project_id FROM modeling_transactions WHERE transaction_id = ?",
                (transaction_id,),
            ).fetchone()["project_id"]
            require_project_lock(UUID(project_id))
            current_state = row["state"]
            if target_state not in transitions.get(current_state, set()):
                raise ValueError(
                    f"Invalid transaction state transition: {current_state} -> {target_state}"
                )
            assignments = ["state = ?", "updated_at = CURRENT_TIMESTAMP"]
            values: list[object] = [target_state]
            for field, value in changes.items():
                assignments.append(f"{field} = ?")
                values.append(value)
            values.append(transaction_id)
            connection.execute(
                f"UPDATE modeling_transactions SET {', '.join(assignments)} "
                "WHERE transaction_id = ?",
                values,
            )
            updated = connection.execute(
                "SELECT * FROM modeling_transactions WHERE transaction_id = ?",
                (transaction_id,),
            ).fetchone()
            return dict(updated)

    def commit_modeling_transaction(
        self,
        project: Project,
        transaction_id: str,
        operation_result: dict,
    ) -> None:
        require_project_lock(project.id)
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT project_id, operation_id, attempt_id, state
                FROM modeling_transactions WHERE transaction_id = ?
                """,
                (transaction_id,),
            ).fetchone()
            if row is None or row["project_id"] != str(project.id):
                raise ValueError("Transaction journal identity mismatch")
            if row["state"] != "COMMITTING":
                raise ValueError("Transaction must be COMMITTING before metadata commit")
            updated = connection.execute(
                """
                UPDATE projects
                SET name = ?, target_profile = ?, scene_version = ?, updated_at = ?, mode = ?,
                    base_model_asset_id = ?
                WHERE id = ?
                """,
                (
                    project.name, project.target_profile, project.scene_version,
                    project.updated_at.isoformat(), project.mode,
                    project.base_model_asset_id, str(project.id),
                ),
            )
            if updated.rowcount == 0:
                raise KeyError(f"Cannot save unknown project {project.id}")
            self._write_state(connection, project)
            connection.execute(
                "UPDATE modeling_transactions SET state = 'COMMITTED', "
                "updated_at = CURRENT_TIMESTAMP WHERE transaction_id = ? AND state = 'COMMITTING'",
                (transaction_id,),
            )
            operation_update = connection.execute(
                """
                UPDATE modeling_operations
                SET status = 'committed', result_json = ?, updated_at = CURRENT_TIMESTAMP
                WHERE project_id = ? AND operation_id = ? AND active_attempt_id = ?
                """,
                (
                    json.dumps(operation_result, separators=(",", ":")),
                    str(project.id), row["operation_id"], row["attempt_id"],
                ),
            )
            if operation_update.rowcount != 1:
                raise ValueError("Modeling operation identity no longer matches the active attempt")

    def restore_modeling_transaction_metadata(self, transaction_id: str) -> Project:
        from .main import Project

        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT project_id, operation_id, attempt_id, state, prior_project_json
                FROM modeling_transactions WHERE transaction_id = ?
                """,
                (transaction_id,),
            ).fetchone()
            if row is None or row["state"] not in {"ROLLING_BACK", "BLOCKED"}:
                raise ValueError("Transaction is not eligible for metadata restoration")
            require_project_lock(UUID(row["project_id"]))
            project = Project.model_validate(json.loads(row["prior_project_json"]))
            updated = connection.execute(
                """
                UPDATE projects
                SET name = ?, target_profile = ?, scene_version = ?, updated_at = ?, mode = ?,
                    base_model_asset_id = ?
                WHERE id = ?
                """,
                (
                    project.name, project.target_profile, project.scene_version,
                    project.updated_at.isoformat(), project.mode,
                    project.base_model_asset_id, str(project.id),
                ),
            )
            if updated.rowcount == 0:
                raise KeyError(f"Cannot restore unknown project {project.id}")
            self._write_state(connection, project)
            connection.execute(
                "UPDATE modeling_transactions SET state = 'ROLLED_BACK', "
                "updated_at = CURRENT_TIMESTAMP WHERE transaction_id = ?",
                (transaction_id,),
            )
            connection.execute(
                """
                UPDATE modeling_operations
                SET status = 'rolled_back', updated_at = CURRENT_TIMESTAMP
                WHERE project_id = ? AND operation_id = ? AND active_attempt_id = ?
                """,
                (row["project_id"], row["operation_id"], row["attempt_id"]),
            )
        return project

    def get_modeling_operation(self, project_id: UUID, operation_id: str) -> dict | None:
        require_project_lock(project_id)
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM modeling_operations WHERE project_id = ? AND operation_id = ?",
                (str(project_id), operation_id),
            ).fetchone()
        return dict(row) if row is not None else None

    def clear(self) -> None:
        with self._connect() as connection:
            connection.execute("DELETE FROM project_state")
            connection.execute("DELETE FROM projects")

    @staticmethod
    def _write_state(connection: sqlite3.Connection, project: Project) -> None:
        connection.execute(
            """
            INSERT INTO project_state (
                project_id, phases_json, components_json, checkpoints_json,
                plan_json, planning_metadata_json, references_json, messages_json, operations_json,
                draft_morphs_json, draft_revision, draft_appearance_json, draft_skin_paint_strokes_json,
                draft_skin_definition_json, draft_skin_revision
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id) DO UPDATE SET
                phases_json = excluded.phases_json,
                components_json = excluded.components_json,
                checkpoints_json = excluded.checkpoints_json,
                plan_json = excluded.plan_json,
                planning_metadata_json = excluded.planning_metadata_json,
                references_json = excluded.references_json,
                messages_json = excluded.messages_json,
                operations_json = excluded.operations_json,
                draft_morphs_json = excluded.draft_morphs_json,
                draft_revision = excluded.draft_revision,
                draft_appearance_json = excluded.draft_appearance_json,
                draft_skin_paint_strokes_json = excluded.draft_skin_paint_strokes_json,
                draft_skin_definition_json = excluded.draft_skin_definition_json,
                draft_skin_revision = excluded.draft_skin_revision
            """,
            (
                str(project.id),
                json.dumps([phase.model_dump(mode="json") for phase in project.phases]),
                json.dumps(project.components),
                json.dumps(project.checkpoints),
                json.dumps(project.component_plan),
                json.dumps(project.planning_metadata),
                json.dumps(project.references),
                json.dumps(project.messages),
                json.dumps(project.operations),
                json.dumps(project.draft_morphs),
                project.draft_revision,
                json.dumps(project.draft_appearance),
                json.dumps([stroke.model_dump(mode="json") for stroke in project.draft_skin_paint_strokes]),
                json.dumps(project.draft_skin_definition.model_dump(mode="json")),
                project.draft_skin_revision,
            ),
        )

    @staticmethod
    def _project_from_row(row: sqlite3.Row) -> Project:
        from .main import Project

        draft_appearance = json.loads(row["draft_appearance_json"])
        draft_appearance.setdefault("skin_asset_id", None)
        draft_appearance.pop("hair_asset_id", None)

        return Project(
            id=row["id"],
            name=row["name"],
            target_profile=row["target_profile"],
            base_model_asset_id=row["base_model_asset_id"],
            scene_version=row["scene_version"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            phases=json.loads(row["phases_json"]),
            components=json.loads(row["components_json"]),
            checkpoints=json.loads(row["checkpoints_json"]),
            component_plan=json.loads(row["plan_json"]),
            planning_metadata=json.loads(row["planning_metadata_json"]),
            references=json.loads(row["references_json"]),
            messages=json.loads(row["messages_json"]),
            operations=json.loads(row["operations_json"]),
            draft_morphs=json.loads(row["draft_morphs_json"]),
            draft_revision=row["draft_revision"],
            draft_appearance=draft_appearance,
            draft_skin_paint_strokes=json.loads(row["draft_skin_paint_strokes_json"]),
            draft_skin_definition=json.loads(row["draft_skin_definition_json"]),
            draft_skin_revision=row["draft_skin_revision"],
            mode=row["mode"],
        )


def create_default_repository() -> SQLiteProjectRepository:
    return SQLiteProjectRepository(database_path_from_env())
