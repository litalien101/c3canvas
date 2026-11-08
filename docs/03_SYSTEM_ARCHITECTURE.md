# System Architecture

## High-level diagram

```text
Browser (React + R3F)
  ├─ Chat / project UI / phase rail / component tree
  ├─ Three.js viewport (GLB or streamed scene snapshots)
  └─ REST + WebSocket/SSE
          │
          ▼
FastAPI application layer
  ├─ Authentication + project access
  ├─ Project/phase/component services
  ├─ State machine + approval gate enforcement
  ├─ AI orchestration + provider adapter
  ├─ Typed modeling-tool registry + argument validation
  ├─ Job queue / cancellation / event log
  └─ AssetStore abstraction
          │
          ├── SQLite (local MVP) / PostgreSQL (multi-user)
          ├── File asset store (local MVP) / object storage (production)
          └── Isolated Blender worker process/container
                 ├─ Opens project scene
                 ├─ Executes allowlisted operations
                 ├─ Runs validators
                 ├─ Creates checkpoints and exports
                 └─ Emits scene metadata + preview GLB
```

## Why separate the browser from Blender
Do not embed the entire Blender desktop application in the web page for the MVP. Run Blender as a controlled backend runtime and render a lightweight preview in the browser. The backend keeps the native `.blend` project; the browser consumes GLB snapshots and semantic metadata. This avoids having to recreate Blender's UI and makes the custom viewport simple.

A later remote-desktop or full native Blender mode may be added, but it should not define the first architecture.

## Deployment modes

### Mode A: local development
- Vite dev server.
- FastAPI local server.
- Blender executable installed locally; worker launches it in background mode.
- SQLite database and project files under a configurable data directory.
- Draft and planning APIs work without Blender; real modeling operations require the configured Blender worker. Do not select mock modeling as a fallback.

### Mode B: single-user self-hosted
- Docker Compose for web/API/database and worker orchestration.
- Blender installed in a dedicated worker image or mounted runtime.
- Explicit resource limits and project volume.
- Users supply their own provider keys through server-side environment configuration.

### Mode C: hosted multi-user service (later)
- Separate web/API, job queue, worker pool, PostgreSQL, and object store.
- Per-user/project authorization and quotas.
- Worker jobs isolated per project or container to avoid cross-project leakage.
- GPU use optional; most procedural Blender operations do not require a GPU, while some generation/render/AI services may.

## Frontend choice
Use React + TypeScript + Vite for quick iteration. Use `@react-three/fiber` and `three` for the viewport. Use `@react-three/drei` if it reduces implementation work without obscuring control. GLB is the default preview interchange format.

Keep a clean boundary between scene presentation and authoritative scene state. The browser is a viewer/editor UI, not the authority on the saved model.

The workspace uses a unified dark-slate and blue-accent visual system: a 65px application header, a 109px labeled navigation rail, a central viewport, and a responsive right character editor (about 650px wide at 1365px, capped at 760px). The Body editor is organized into anatomy navigation, a morph-card library, and selected-control details; its width is coordinated with the viewport and expands on wider screens. Models, Scene Hierarchy, Properties, and Workflow remain fixed sections within the inspector; no panel docking or saved panel-layout state is used.

## API choice
FastAPI because the modeling runtime and Blender scripting are Python-based. Use Pydantic models for request/response contracts. Keep long operations asynchronous, and keep the AI provider behind an interface.

## Modeling worker
The worker should run Blender in a separate process. A safe operation lifecycle:
1. API stores a job containing project ID, operation ID, allowed tool name, validated args, target component IDs, expected scene version, and user/agent context.
2. Worker receives the job through a queue or authenticated local control channel.
3. Worker verifies the version and component scope.
4. Worker creates a checkpoint when needed.
5. Worker runs the allowlisted operation implementation.
6. Worker runs validators and produces a structured diff.
7. Worker exports a GLB preview and saves `.blend` state when a commit is accepted.
8. API commits manifest/version changes and emits events.
9. If failure occurs, do not commit partial state; restore checkpoint or mark the job failed and preserve diagnostics.

## Real-time strategy
For MVP, use **operation-level progressive previews** rather than trying to stream every vertex mutation. Each meaningful operation can emit progress and refresh a GLB snapshot. The UI swaps the preview when the new asset has loaded. This produces a live, piece-by-piece feeling without building a custom geometry delta protocol.

### Draft-first browser workspace and explicit Blender compile
**Invariant:** draft editing is browser preview plus persisted project data. The browser does not import editable geometry into Blender while the user is choosing eyes, presets, or morphs. An explicit final **Save / Compile** or export starts the initial compilation of the pinned base asset and all saved draft choices together. Afterward, only explicit, supported scene operations may start Blender. Approval is an independent gate and never starts Blender. Standalone eye attachment is forbidden.

Project creation, deterministic plan generation, plan approval, morph persistence, and appearance persistence are API/SQLite operations and do not require Blender. The browser edits a full manifest-validated morph map and saves it with an optimistic `draft_revision`; eye and preset choices are stored in `draft_appearance`. These values are project data, not Blender scene geometry. The compile operation validates and passes the selected pinned asset, complete saved morph map, preset, and eye attachment together so the worker writes the first committed scene and preview only after the explicit user action.

The initial browser screen is a welcome page with explicit create/open project actions; no character preview is mounted and no saved project is automatically opened. The model catalog may be fetched for availability and labels, but character preview geometry and manifest morph controls load only after a project is explicitly created or opened. The model catalog returns source hashes without transferring the full morph library. CC3 morph edits use browser-local morph targets. Eye selection loads only its integrity-pinned eye-only GLB as a browser overlay and hides only the base preview's default eye meshes. For CC5/CC3+, an optional local build provides a native-topology, high-detail GLB proxy plus lazily fetched sparse signed control deltas; the browser combines active deltas from an immutable base geometry. Proxy hashes and source identity are verified. If the proxy is unavailable, CC5/CC3+ draft sliders remain disabled rather than invoking Blender for a preview. Project viewport previews omit morph targets when supported. Previously saved morph-heavy previews are refreshed from the Blender scene when first requested. If the installed Blender exporter cannot omit morph targets, the API records that capability fallback to avoid repeated exports.

Later optimization options: websocket metadata, binary geometry deltas, partial component GLBs, and lower-resolution preview exports while a high-resolution operation continues.

## AI orchestration
Separate three jobs:
- **Planner:** converts user intent/reference observations into a component plan and dependency graph.
- **Modeling agent:** chooses validated tools and calls them within an assigned scope.
- **Reviewer/validator:** examines tool outputs and reports criteria results. It may be deterministic code, an LLM, or both; deterministic checks take precedence for measurable properties.

Use a bounded loop: inspect → propose operation → validate args → execute → validate scene → update state → continue or request review. Set maximum tool calls, wall-clock budget, and failure count per phase.

The current conversational assistant has a separate, non-modeling interaction contract. The API supplies up to 64 request-relevant manifest control IDs/ranges, compatible installed appearance IDs, and registered guidance targets, then validates the assistant's structured answer against the full selected-model manifest before returning it. The bounded context is never sliced into invalid JSON; if other project context exceeds the configured budget, the API reports an explicit error. Morph and appearance changes are proposals only; the browser renders them and the user explicitly applies them through the existing draft APIs. Guidance uses only registered target IDs and is rendered as escaped text in a tooltip anchored to the corresponding editor element. Chat never calls the modeling-tool registry, Blender, approval endpoints, or compile endpoints. Plain text remains a text-only answer; invalid structured output is an explicit error.

## Data consistency
The component manifest and project version log form the semantic record. Blender scene objects persist the UUIDs as custom properties, but the backend also stores a manifest to recover from renamed or missing objects. Every commit increments `scene_version`. A command with stale `expected_scene_version` must be rejected or re-planned.

## Queue and jobs
For local MVP, an asyncio task/subprocess manager may be sufficient. Before multi-user deployment, replace it with a durable queue (e.g. Redis-backed worker queue) and persistent job records. Avoid creating a heavy distributed architecture before the first vertical slice works.

## Observability
Log structured events with correlation IDs: request ID, project ID, job ID, operation ID, phase ID, component IDs. Redact prompts/reference content by default. Include worker version, Blender version, duration, status, validator outcomes, and a safe error summary.
