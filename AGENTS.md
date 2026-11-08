# Instructions for AI Coding Agents

You are implementing **C3Canvas** (Code, Create, Collaborate), a browser-first, staged AI 3D modeling environment. Read this file and `docs/README.md` before making changes, then follow the product brief, PRD, architecture, modeling workflow, API contract, security requirements, and roadmap.

## Product intent

The user describes what they want in natural language and/or uploads reference images. A model-building agent creates the asset in stages. The user watches the 3D viewport, inspects the result, requests scoped changes, and approves a stage before the next gated stage begins. The project remains organized into meaningful editable components.

## Draft/compile invariant

Draft editing is browser preview plus persisted project data. Model, eye, preset, and morph choices must preview live; selecting or adjusting them must not import geometry or start Blender. The initial scene is compiled only after an explicit final **Save / Compile** or supported export action, with saved choices compiled together. Approval is a separate gate and never starts Blender. After compilation, only explicit scene actions (such as saving morph/preset changes, baking, or restoring a checkpoint) may invoke the worker. Never restore an assemble-first eye flow or a per-selection import.

## Operating rules

1. **Build in slices.** Follow the roadmap in `docs/10_BUILD_ROADMAP.md`. Each slice must run, have tests, and be documented before the next slice starts.
2. **Reuse local services; do not duplicate or silently change ports.** Before starting API, Vite, or other local development services, inspect the configured/default port and probe the expected endpoint. If the correct service is already running, reuse it. If it needs a restart, identify and stop/restart only the process known to belong to this workspace. Never accept automatic fallback ports or launch a duplicate on 8001/5174/etc. just because 8000/5173 is occupied. If the listener is not the expected service or its ownership is unclear, leave it running and ask before proceeding. Follow `docs/11_DEPLOYMENT_AND_DEV_SETUP.md`.
3. **Do not overbuild.** Implement the smallest coherent solution that satisfies the current acceptance criteria. Don't add unrelated product features.
4. **Preserve structure.** Every scene component receives a stable UUID, semantic type, clear name, material references, parent/attachment information, creation phase, and validation status.
5. **No black-box whole-scene regeneration for local edits.** A scoped user request should modify only the selected component and known dependencies. Show a change summary when more components must change.
6. **Human approvals are real gates.** If a phase requires approval, don't auto-approve. The UI/API/state machine must enforce the gate rather than relying on the prompt alone.
7. **Use typed commands.** The LLM emits validated arguments to allowlisted modeling tools. Never execute arbitrary LLM-generated Python in Blender. The Blender worker validates tool name, arguments, project ID, component scope, and expected scene version.
8. **Make edits reversible.** Save a checkpoint before destructive operations, record operation metadata, and keep rollback available for the MVP.
9. **Test behavior, not just code shape.** Test the draft-first happy path: create project → upload reference → plan → preview/persist body, eye, preset, and morph choices without Blender → review → approve → explicitly save/compile all choices together. Test export only when an export action is implemented.
10. **Secure by default.** No public unauthenticated worker socket. Do not place provider keys in browser code. Restrict file paths, file sizes, image types, network egress, and Blender worker permissions.
11. **Never fake capabilities.** Do not simulate modeling or show success-shaped placeholder geometry. If Blender is unavailable, explain the limitation and leave draft previews and planning usable.
12. **Keep docs aligned.** Update README/API schemas/roadmap when behavior or contracts change. Document architecture changes in an ADR.
13. **Run checks.** Use formatting, type checks, unit tests, API tests, and integration tests defined by the repo. Report exact commands/results, not just “looks good.”

## Architecture guardrails

- Web frontend: React + TypeScript + Vite + React Three Fiber/Three.js.
- API: FastAPI/Python.
- Modeling runtime: isolated Blender worker. API owns jobs and access control; worker owns Blender scene execution.
- Local MVP persistence: SQLite is acceptable; keep repository/service boundaries so PostgreSQL can be adopted without rewriting business logic.
- Asset delivery: local development filesystem behind an `AssetStore` abstraction; production object storage later.
- Progress: structured events over WebSocket or SSE.
- AI provider: provider-neutral adapter; all provider calls run server-side.
- Component manifest: the durable semantic source of truth for identity, hierarchy, status, and relationships; Blender object names alone are not sufficient.
- Draft state: the durable source of truth for uncompiled browser edits. Draft selection is Blender-free; initial import and post-compile scene changes require separate explicit user actions.

## Scope priorities

### Current implementation
- Follow the active supported slice and next work in `docs/10_BUILD_ROADMAP.md`.
- The shipped character workflow uses browser previews and persisted drafts, enforced plan approval, and explicit Blender compilation; do not reintroduce retired mock geometry or attach-first eye flows.

### Do later
- Production-grade anatomical modeling, realistic clothing simulation, automated retopology, robust UV creation, texturing, rigging, animation, payments, collaboration, plugin marketplace, and universal object categories.

## Definition of done for each task

- Acceptance criteria are implemented.
- Tests are added or updated and passing.
- Errors and loading states are handled.
- Permission and validation behavior is explicit.
- Types and API schemas are updated.
- No secrets, generated binaries, user content, or local environment files are committed.
- Documentation has been updated.

## If something is ambiguous

Use the requirements in `docs/01_PRD.md` and `docs/03_SYSTEM_ARCHITECTURE.md`. Prefer a minimal, safe, reversible default. Make assumptions explicit in code comments or a short ADR. Do not stop the project for non-blocking decisions; continue with the best documented interpretation.
