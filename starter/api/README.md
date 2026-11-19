# Starter API

The local FastAPI service persists projects, plans, draft morph maps, component manifests, operations, references, and checkpoints in SQLite. Project creation, planning, approval, and draft saves work without Blender. Health reports Blender availability separately; explicit character assembly and later Blender operations fail clearly when Blender is missing or misconfigured. No simulated modeling fallback is used.

The supported character workflow is approval-gated, explicitly user-started assembly of the selected pinned character. The API passes the saved complete draft morph map to the worker in the same import job, which applies it before writing the initial scene and preview. Subsequent morph edits use scoped Blender operations. Reference images are validated and stored locally. Planning uses a deterministic character template when a configured Copilot bridge is unavailable; chat does not fabricate a response when the bridge is unavailable.

Project routes require a signed-in local account. Register or sign in through the browser; project records are private to their owner. Local development uses scrypt password hashes, HttpOnly/SameSite session cookies, CSRF checks, and loopback-only account/project access. Production registration is disabled by default; hosted use additionally requires HTTPS, explicit origins, rate limiting, recovery and retention policies, and a security review.

Non-plan chat responses may return a validated draft-only morph/appearance proposal and a UI guidance target. The API filters model-specific controls to a bounded relevant subset, validates proposed IDs/ranges/assets/targets, and never invokes Blender from chat. Invalid structured output fails explicitly; plain-text replies remain available without actions. See the [API contract](../../docs/06_API_CONTRACT.md#chat-and-planning-provider).

For imported CC5/CC3+ projects, `POST /api/v1/projects/{project_id}/morph-preview` accepts the complete manifest morph map and returns a GLB preview. The API validates the project, component, control IDs, and value ranges, then runs the preview in a temporary workspace seeded from the saved scene. It does not update the saved scene, project record, or scene version. The browser debounces slider changes; preview generation still requires a Blender export and can take time.

The modeling-tools API narrowly supports `create_hair_scalp` followed by `generate_hair_guides`. Both are staged Blender transactions that create separate components and resolve their inputs through component/object IDs. Same-operation retries retain their allocated component ID; separate operations are rejected if the body already has a scalp or the scalp already has guides. The worker verifies the owner-reviewed Copilot Hair Tutor 0.1.8 package pin in `starter/shared/hair_tutor_package.json` before importing it without registration. The artifact's origin is unverified and is recorded as such. Guides persist as editable native Hair Curves and are hidden from renders; visible/exportable hair, scalp-mask-driven distribution, and refitting after morph changes are not included.

## Blender transaction boundary

Blender modeling and checkpoint-restore requests acquire a per-project Linux `flock`, recover any incomplete journal entries, and stage each attempt under a unique `data/transactions/<transaction-id>/<attempt-id>` directory. The operation ID is bound to the canonical request hash; retries keep the operation's allocated component ID but always use a new attempt and staging directory. Every transaction attempt records `api_contract_version` and `worker_contract_version`; the worker job and result report echo both values, and the API rejects mismatches. Existing journal rows from before migration 14 are marked `unrecorded` because their versions cannot be recovered.

The staged worker never promotes project artifacts. The API verifies candidate files, creates and syncs backups, records `COMMITTING`, promotes the scene and preview on the same filesystem, verifies their hashes, then atomically writes project state and `COMMITTED` in SQLite. Recovery rolls back incomplete attempts; integrity failures block project operations and preview access until the explicit blocked-transaction recovery helper is invoked while holding the project lock. Project preview responses use a locked snapshot so streaming cannot race a later commit. Morph-preview generation holds the project lock while it snapshots and renders the committed scene.

This locking design is for cooperating API processes on one Linux host and a local filesystem that supports `flock` and same-filesystem atomic replacement. Before deployment, verify the API processes share the same data directory and filesystem, and inspect SQLite journal/synchronous settings. Do not mix the staged API with an older API process that still uses the legacy worker contract; restart or deploy the API processes as a coordinated cutover. The older `worker_entry.py` path remains for compatibility and isolated preview workspaces.

## Run

Before launching, check `http://127.0.0.1:8000/api/v1/health`. Reuse the expected workspace service if it is already running. Do not start a duplicate or silently switch ports when `8000` is occupied. If a restart is needed, verify the listener belongs to this workspace and stop/restart only that process; ask before touching an unknown listener. See [the local service policy](../../docs/11_DEPLOYMENT_AND_DEV_SETUP.md#existing-service-check-and-restart-policy).

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -e '.[test]'
COMODEL_BLENDER_EXECUTABLE=/path/to/blender uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Set `COMODEL_BLENDER_EXECUTABLE` when starting the API if editable scene assembly is needed. Visit `http://127.0.0.1:8000/docs` or `/api/v1/health`.

The default database URL is `sqlite:///./data/comodel.db`. Relative database paths are resolved from the API working directory; configure another SQLite path with `DATABASE_URL`. Schema migrations run automatically on startup. Database files and generated project scenes are local runtime data and should not be committed.

Upload limits default to `MAX_UPLOAD_BYTES=15728640` and `MAX_IMAGE_PIXELS=40000000`. The API validates image content, dimensions, and size before storing references. The service is intended for loopback development; hosted deployments need additional protections described in [the security requirements](../../docs/08_SECURITY_PRIVACY.md).
