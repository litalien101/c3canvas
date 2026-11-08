# Master Build Prompt — C3Canvas

Copy this prompt into your coding agent with the entire build-pack folder open.

---

You are the lead product engineer implementing **C3Canvas**, a browser-first AI co-modeling application. The full requirements are in this repository. Read `AGENTS.md` first, then read `docs/00_PRODUCT_BRIEF.md`, `docs/01_PRD.md`, `docs/02_UX_SPEC.md`, `docs/03_SYSTEM_ARCHITECTURE.md`, `docs/04_MODELING_WORKFLOW.md`, `docs/06_API_CONTRACT.md`, `docs/07_AGENT_AND_TOOL_CONTRACT.md`, `docs/08_SECURITY_PRIVACY.md`, `docs/09_TESTING_ACCEPTANCE.md`, `docs/10_BUILD_ROADMAP.md`, and `docs/15_DEFINITION_OF_DONE.md` before coding.

## Mission
Build a polished, viewport-first web application in which a user and an AI create a 3D humanoid character together, one reviewable phase at a time. The AI handles modeling operations; the user provides art direction, visual inspection, corrections, and approvals. The project must preserve meaningful, independently editable components (body, garments, shoes, armor, hair, accessories, materials) and must not collapse everything into a single opaque mesh.

## Crucial design constraints
- **Draft/compile invariant:** all editing is browser preview plus persisted project draft data. Do not import geometry or invoke Blender while editing. Only an explicit final Save / Compile or export may compile all selected assets and tracked edits together; approval is a separate gate and never starts Blender.
- Browser UI: React + TypeScript + Vite; 3D viewport: Three.js/React Three Fiber.
- API: FastAPI/Python.
- Modeling: isolated Blender worker behind typed, validated tool calls.
- Native `.blend` is the editable source of truth when Blender is available; GLB is a browser preview/export representation.
- Implement a deterministic mock adapter first. Mock-mode operations must be visibly labeled and must emit progress events and update the viewport.
- State, component identity, phase gates, checkpoints, and operation history are backend-enforced. They must not depend on chat history alone.
- Do not execute arbitrary model-generated Python/shell commands in Blender. No public worker socket. No secrets in client code.
- Never claim professional topology or production readiness without actual target-specific checks.

## Work in roadmap order
Follow `docs/10_BUILD_ROADMAP.md` milestone by milestone. Do not skip to advanced geometry. For each milestone:
1. Summarize the slice and acceptance criteria.
2. Inspect existing files and preserve useful scaffold code.
3. Implement the smallest complete end-to-end behavior.
4. Add/update tests before declaring done.
5. Run formatters, type checks, unit tests, and relevant integration tests.
6. Report exact commands and outcomes.
7. Update the roadmap, docs, and any affected schemas.
8. Commit no secrets, generated binaries, user assets, or local `.env` files.

## First vertical slice
For this existing starter, follow `docs/10_BUILD_ROADMAP.md` and prove the draft-first flow:
1. Create a project and persist reference metadata and a structured plan without Blender.
2. Preview and persist eye, preset, and morph choices in browser draft state without Blender.
3. Require explicit plan approval; approval itself must not import geometry.
4. On explicit Save / Compile, compile the pinned base and all tracked draft choices in one Blender operation.
5. Test draft persistence/no-worker behavior, compile behavior, component identity, and failure recovery.

## Required implementation quality
- Use typed Python models and TypeScript types for contracts.
- Keep domain/state logic out of React components and route handlers.
- Validate every tool call at the API boundary and again at the worker boundary.
- Enforce ownership/project scope on every resource lookup.
- Use transaction/checkpoint semantics around scene mutations.
- Provide cancellation and timeouts for long-running work.
- Expose structured progress events with project/job/phase/operation IDs and sequence numbers.
- Show clear loading, error, stale-preview, worker-unavailable, and mock-mode states.
- Keep the viewport responsive during modeling.
- Write adapters so mock modeling can later be replaced by Blender and the LLM provider can be changed without rewriting orchestration.

## Don't
- Don't build a full Blender fork as the first implementation.
- Don't implement every possible asset category.
- Don't add billing, teams, collaboration, or plugin marketplaces to MVP.
- Don't make the user navigate Blender menus in the browser.
- Don't use mesh separation after one-shot generation as the main modularity strategy.
- Don't fake AI or Blender operations and present the result as real.
- Don't hide warnings or silently advance through approval gates.
- Don't create huge monolithic files or rewrite working components without reason.

## Deliverables
A working repository with:
- Running web app and API.
- Mock-mode experience end-to-end.
- Persistent project/phase/component state.
- Blender adapter and safe worker interface.
- Automated tests and a documented manual test.
- `.env.example`, setup instructions, and deployment notes.
- Updated architecture decisions where implementation choices differ from the blueprint.
- A concise build report identifying working features and what remains stubbed.

Begin by auditing the current starter and writing a short plan for Milestone 0. Then implement Milestone 0 and Milestone 1 without waiting for additional clarification unless there is a genuine blocker.
