"""SQLite-backed project repository for the local MVP."""
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from typing import TYPE_CHECKING, Iterator
from contextlib import contextmanager
from uuid import UUID

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

    def create(self, project: Project) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO projects (
                    id, name, target_profile, scene_version, created_at, updated_at, mode, base_model_asset_id
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
                ),
            )
            self._write_state(connection, project)

    def get(self, project_id: UUID) -> Project | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT p.*, s.phases_json, s.components_json, s.checkpoints_json,
                       s.plan_json, s.planning_metadata_json, s.references_json, s.messages_json, s.operations_json,
                       s.draft_morphs_json, s.draft_revision, s.draft_appearance_json
                FROM projects AS p
                JOIN project_state AS s ON s.project_id = p.id
                WHERE p.id = ?
                """,
                (str(project_id),),
            ).fetchone()
        return self._project_from_row(row) if row else None

    def list(self) -> list[Project]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT p.*, s.phases_json, s.components_json, s.checkpoints_json,
                       s.plan_json, s.planning_metadata_json, s.references_json, s.messages_json, s.operations_json,
                       s.draft_morphs_json, s.draft_revision, s.draft_appearance_json
                FROM projects AS p
                JOIN project_state AS s ON s.project_id = p.id
                ORDER BY p.created_at, p.id
                """
            ).fetchall()
        return [self._project_from_row(row) for row in rows]

    def list_summaries(self) -> list[dict[str, object]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT p.id, p.name, p.base_model_asset_id, s.components_json
                FROM projects AS p
                JOIN project_state AS s ON s.project_id = p.id
                ORDER BY p.created_at, p.id
                """
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

    def delete(self, project_id: UUID) -> bool:
        with self._connect() as connection:
            cursor = connection.execute("DELETE FROM projects WHERE id = ?", (str(project_id),))
            return cursor.rowcount > 0

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
                draft_morphs_json, draft_revision, draft_appearance_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                draft_appearance_json = excluded.draft_appearance_json
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
            ),
        )

    @staticmethod
    def _project_from_row(row: sqlite3.Row) -> Project:
        from .main import Project

        draft_appearance = json.loads(row["draft_appearance_json"])
        draft_appearance.setdefault("skin_asset_id", None)
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
            mode=row["mode"],
        )


def create_default_repository() -> SQLiteProjectRepository:
    return SQLiteProjectRepository(database_path_from_env())
