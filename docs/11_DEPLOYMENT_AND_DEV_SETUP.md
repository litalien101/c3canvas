# Development and Deployment Guide

## Prerequisites
- Git.
- Node.js LTS compatible with the selected Vite toolchain.
- Python 3.11+ (choose a version compatible with the chosen FastAPI and Blender Python runtime).
- Blender installed locally for explicit final Save / Compile and Blender operations; draft creation, preview selection, and planning do not require it.
- Optional container runtime for isolated worker testing.

Because releases move, confirm supported versions before locking dependencies. Commit lockfiles after selecting versions. Never build production from floating package ranges alone.

## Local development sequence
1. Copy `.env.example` to `.env` (create it if not present) and keep secrets out of version control.
2. Before starting either server, inspect the default ports (API `127.0.0.1:8000`, Vite `127.0.0.1:5173`) and probe the expected health/page endpoints. Reuse an already-running service from this workspace instead of starting another copy.
3. If a service needs a restart, identify its listener and verify that it belongs to this workspace before stopping it. Restart it on its configured port. Do not rely on Vite/Uvicorn automatic port fallback or switch to another port just because the default is occupied. If the listener is not the expected service or its ownership is unclear, leave it alone and ask before proceeding.
4. Start API from `starter/api` in a virtual environment only if the expected API is not already running.
5. Start frontend from `starter/web` using npm/pnpm according to the committed package manager only if the expected Vite app is not already running.
6. Optionally configure `COMODEL_BLENDER_EXECUTABLE` before starting/restarting the API to enable final scene compilation.
7. When Blender is unavailable or misconfigured, health reports that status while project drafts, plans, approval, and draft morph saves remain available. Modeling operations fail explicitly; there is no mock modeling adapter.
8. Run API unit tests and frontend checks after changes.

### Existing-service check and restart policy

For this workspace, the normal development ports are API `8000` and Vite `5173`; Vite proxies `/api/v1` to API `8000`. Check `curl -fsS http://127.0.0.1:8000/api/v1/health` and `curl -fsSI http://127.0.0.1:5173/` before launching services. If either expected app is already responding, use it and do not start a duplicate. If a port is occupied but the expected endpoint does not respond, inspect the listening process (for example with `ss -ltnp` and process command/cwd) before taking action. Stop or restart only a process positively identified as belonging to this workspace; never kill an unknown or other user's process. Do not accept an automatically selected alternate port. If the default cannot safely be freed or the existing service cannot be reused, report the conflict and ask the user what to do.

## Environment variables (design target)
- `APP_ENV=development|test|production`
- `APP_HOST=127.0.0.1` (production requires explicit secure configuration)
- `APP_PORT=8000`
- `DATABASE_URL=sqlite:///./data/comodel.db` for local MVP
- `DATA_DIR=./data`
- `COMODEL_BLENDER_EXECUTABLE=/path/to/blender`
- `AI_PROVIDER=none|openai|anthropic|...` (implemented adapters only)
- `AI_API_KEY` — server-side only; never commit
- `MAX_UPLOAD_BYTES`, `MAX_IMAGE_PIXELS`, `JOB_TIMEOUT_SECONDS`
- `ALLOWED_ORIGINS=http://localhost:5173`

## Blender runtime notes
- Verify exact Blender version through `blender --version` and the official Python API docs for that release.
- Use background execution for worker operations and test that all needed operators run headlessly.
- Avoid assuming UI context is available in background mode; prefer data API/BMesh operations where suitable.
- Use version-specific adapters for changed APIs.
- Include Blender version in project/export metadata.

## Production worker hardening
- Separate API and Blender workers.
- Run non-root and restrict mounts to a per-job workspace.
- Apply CPU/memory/time limits.
- Default deny network egress.
- No public socket listener for direct code execution.
- Per-job workspace cleanup.
- Durable queue and retry policy.
- Quarantine malformed or unexpected artifacts.

## Deployment sequence
1. Build and test frontend artifact.
2. Build API image.
3. Build/obtain Blender worker image and run smoke test.
4. Apply database migrations.
5. Configure object storage and signed/authorized asset delivery.
6. Configure secrets manager and CORS/auth.
7. Run the health check and create/save a draft. If Blender is configured, explicitly assemble a test project and verify its saved scene and preview; user-facing export is not yet available.
8. Verify backups and rollback procedure.

## Backup and recovery
- Back up project database and project files/objects together.
- Store checkpoints as immutable objects where possible.
- Verify restore by reopening a `.blend` plus matching manifest, not by checking that files merely exist.
- Do not delete a prior good export until the new one passes validation.

## Cost controls
- Track LLM/image API calls per job.
- Limit retries and tool cycles.
- Use cheap models for classification/planning where appropriate and reserve more capable models for difficult reasoning.
- Prefer procedural operations for deterministic tasks.
- Separate preview renders from high-quality final renders.
- Set user-visible quotas only after real workload measurements.
