# Starter API

The local FastAPI service persists projects, plans, draft morph maps, component manifests, operations, references, and checkpoints in SQLite. Project creation, planning, approval, and draft saves work without Blender. Health reports Blender availability separately; explicit character assembly and later Blender operations fail clearly when Blender is missing or misconfigured. No simulated modeling fallback is used.

The supported character workflow is approval-gated, explicitly user-started assembly of the selected pinned character. The API passes the saved complete draft morph map to the worker in the same import job, which applies it before writing the initial scene and preview. Subsequent morph edits use scoped Blender operations. Reference images are validated and stored locally. Planning uses a deterministic character template when a configured Copilot bridge is unavailable; chat does not fabricate a response when the bridge is unavailable.

Non-plan chat responses may return a validated draft-only morph/appearance proposal and a UI guidance target. The API filters model-specific controls to a bounded relevant subset, validates proposed IDs/ranges/assets/targets, and never invokes Blender from chat. Invalid structured output fails explicitly; plain-text replies remain available without actions. See the [API contract](../../docs/06_API_CONTRACT.md#chat-and-planning-provider).

For imported CC5/CC3+ projects, `POST /api/v1/projects/{project_id}/morph-preview` accepts the complete manifest morph map and returns a GLB preview. The API validates the project, component, control IDs, and value ranges, then runs the preview in a temporary workspace seeded from the saved scene. It does not update the saved scene, project record, or scene version. The browser debounces slider changes; preview generation still requires a Blender export and can take time.

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

Upload limits default to `MAX_UPLOAD_BYTES=15728640` and `MAX_IMAGE_PIXELS=40000000`. The API validates image content, dimensions, and size before storing references. The service is intended for loopback development only; hosted deployments need authentication, authorization, malware scanning, retention controls, and a security review.
