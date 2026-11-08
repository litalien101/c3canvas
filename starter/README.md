# C3Canvas Starter

This starter implements a focused CC3/CC5 character morph workflow:

- React/Three.js viewport with no static model fallback and no automatic project selection.
- New character setup offers CC3 Female as the default Basic workflow and CC3+ Female as Advanced; both share the same approval and compile steps. CC3 Male remains an additional option when installed.
- FastAPI and SQLite project state, references, plans, component manifests, operations, and checkpoints.
- Blender-independent project drafts with optimistic, persisted morph-map autosave; plan approval is separate from build.
- Explicit plan approval and a separate user action before assembling a pinned CC3 or CC5/CC3+ morph character in Blender. The saved draft map is applied during initial import.
- Blender-backed import and scoped morph persistence for CC3's 137 controls or the CC5/CC3+ model's 2,042 controls.
- GLB preview loading and separate API/Blender availability reporting. Projects, plans, approval, and drafts work without Blender; editable scene assembly and later Blender saves require it.
- A smaller pinned static Female preview loads at startup; its full morph asset is fetched only when a slider is adjusted.
- The saved-project menu fetches compact summaries rather than full scene and operation histories.
- For CC5/CC3+ browser previews, replacement eye geometry is initialized to the active preset/morph pose before it is crossfaded into the viewport. Proxy-meter deltas are converted to eye-asset local units, and preset deltas are transferred through matching proxy eye surfaces.
- The Skin tab supports an integrity-checked CC3+ Female package with compact 1024px WebP diffuse and lossless PNG normal previews plus a 256px card image for the head, body, arms, and legs. Normal-map strength is reduced consistently for browser preview and final compile. Full-resolution maps remain packed in the pinned Blender material library and are applied only during final compile.

The backward-compatible default is `worker/blender/assets/CC3_Base_Female_Morphs.glb`. The owner-supplied full-morph model uses `worker/blender/assets/RL_CC3_Plus_Base_all_morphs.blend` and the manifest at `shared/cc5_rlcc3plus_manifest.json`. An optional local build provides a native-topology browser proxy with sparse per-control deltas; the existing Blender-generated slider preview remains the fallback. Blender applies saved values to the editable source. See [the API contract](../docs/06_API_CONTRACT.md), [the worker guide](worker/blender/README.md), and [the character blueprint](../docs/19_BASE_MODEL_BLUEPRINT.md).

To install the local CC3+ skin package, extract the user-supplied archive, then run `blender --background --factory-startup --python worker/blender/prepare_skin_asset.py -- --source /absolute/path/to/female_skin_full_body_1.Fbx` from this directory. The script writes the pinned full-resolution maps, reduced WebP browser previews, Blender material library, and `shared/skin_assets.json`; these user-supplied/generated assets are excluded from source control. The original source FBX remains local.

## Run the web UI

Before starting services, check whether this workspace's API (`127.0.0.1:8000`) and Vite (`127.0.0.1:5173`) are already running and reuse them. Do not start duplicates or accept automatic alternate ports. If a restart is needed, identify and stop only this workspace's process; leave unknown listeners alone and ask if their ownership is unclear. See [the local service policy](../docs/11_DEPLOYMENT_AND_DEV_SETUP.md#existing-service-check-and-restart-policy).

```bash
cd starter/web
npm install
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Vite proxies `/api/v1` to `http://127.0.0.1:8000` by default. Set `VITE_API_PROXY_TARGET` to change the development proxy. For a separately hosted API, set `VITE_API_BASE` at build time.

## Run the API

```bash
cd starter/api
python3 -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -e '.[test]'
# Blender is optional for draft creation/planning; configure it for editable scene assembly.
COMODEL_BLENDER_EXECUTABLE=/path/to/blender uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The default database is `sqlite:///./data/comodel.db`, resolved from the API working directory. Projects and uploaded reference images are local runtime data. Project APIs require a loopback request by default; set `COMODEL_API_TOKEN` to require a bearer token for remote access, or keep the app bound to `127.0.0.1` only.

## Verify

```bash
cd starter/api && . .venv/bin/activate && pytest -q
cd starter/api && . .venv/bin/activate && pytest -q ../worker/blender/test_worker.py
cd starter/web && npm run build
```

The planner uses a deterministic CC3 template when no Copilot text model is connected. Reference image bytes are stored locally but are not analyzed or sent to Copilot. Chat fails explicitly when the local Copilot bridge is unavailable. No modeling operation silently substitutes mock geometry.
