# C3Canvas — AI 3D Co-Modeler Build Pack

**Package version:** 1.0  
**Prepared:** 2026-10-29  
**Status:** Product specification + implementation blueprint + coding-agent instructions + starter scaffold  
**Product name:** C3Canvas (Code, Create, Collaborate)

## What this is

A build-ready planning package for an AI-assisted 3D modeling web application. The intended experience is a quiet, browser-based 3D viewport with a chat panel. The AI creates and edits a model in visible, reviewable stages while a human directs the creative decisions. The system must preserve the structure of the scene: body, garments, footwear, armor, hair, accessories, materials, and other meaningful components remain identifiable and independently editable instead of being flattened into one opaque mesh.

The initial product should focus on **humanoid character creation from reference images**. Support for props, creatures, vehicles, environments, animation, and other modeling domains can follow after the core workflow proves reliable.

## Contents

- `AGENTS.md` — standing instructions for a coding agent working in this repository.
- `docs/` — product requirements, UX, architecture, data model, workflow, security, tests, roadmap, deployment, reuse evaluation, and geometry strategy; start at the [documentation index](docs/README.md).
- `prompts/MASTER_BUILD_PROMPT.md` — copy/paste prompt for an AI coding agent to implement the product.
- `prompts/PHASED_IMPLEMENTATION_PROMPT.md` — prompts for staged delivery without skipping tests.
- `prompts/MODELING_AGENT_SYSTEM_PROMPT.md` — rules for the runtime AI that builds user models.
- `prompts/CODE_REVIEW_PROMPT.md` — review checklist for an AI reviewer.
- `schemas/` — initial JSON Schemas for components, phases, and modeling tools.
- `openapi.yaml` — initial API contract outline.
- `docs/18_TASK_BACKLOG.md` — issue-style implementation checklist across frontend, API, worker, geometry, AI, and hardening.
- `AI_HANDOFF_CHECKLIST.md` — final acceptance checklist for the coding agent.
- `starter/` — minimal web/API/Blender-worker scaffold to begin a vertical slice. It is a starter, **not a finished 3D modeling product**.
- `examples/` — example project manifest and example model plan.

## The core product principle

> The AI is the modeler and technical operator; the user is the art director. Work is visible, staged, reversible, and organized into editable components.

**Draft/compile invariant:** supported draft eye, skin, preset, and morph choices preview in the browser and never import geometry into Blender. Hair is not a browser draft or preview feature; the local worker/API support only the explicit staged scalp and native-guide operations described in the API contract. An explicit final **Save / Compile** or export action compiles all saved supported choices together; afterward, scene changes require explicit, supported worker operations. Approval remains a separate gate and never starts Blender.

The product is not successful merely because a generated model looks convincing in a render. It must also preserve meaningful scene structure, support localized revisions, keep approved work stable, and export usable project files.

The current chat assistant can explain the workspace, propose allowlisted draft morph/appearance changes for the user to apply, and display contextual tooltips beside registered controls. It cannot execute arbitrary UI or Blender operations, approve phases, or compile projects; unsupported effects are disclosed rather than simulated.

## Recommended starting architecture

1. **Browser UI:** React + TypeScript + Vite; use React Three Fiber/Three.js for the viewport. Keep the UI custom and intentionally minimal.
2. **Application API:** FastAPI in Python for projects, uploads, phases, jobs, event streaming, and AI orchestration.
3. **Modeling runtime:** Blender in a separate worker process/container for explicit final save/export compilation and supported post-compile scene operations. Project drafts, browser previews, and planning work without Blender. The API submits typed, allowlisted operations; the worker does not accept arbitrary model-generated Python snippets.
4. **Project state:** SQLite for local-first MVP; use PostgreSQL for a multi-user deployed service. Files stored locally in development and behind an object-storage adapter in production.
5. **Progress:** WebSocket or Server-Sent Events for job and phase events; refresh preview assets after meaningful modeling operations.
6. **AI integration:** provider-neutral adapter around a language model. Keep provider credentials server-side. Add image understanding and optional image-to-3D providers through adapters.

See `docs/03_SYSTEM_ARCHITECTURE.md` for details and trade-offs.

## How to hand this to an AI coding agent

1. Extract the ZIP into a new repository.
2. Open the entire folder in your coding agent (Codex, Claude Code, Cursor, or equivalent).
3. Ask the agent to read `AGENTS.md`, then `docs/00_PRODUCT_BRIEF.md`, `docs/01_PRD.md`, `docs/03_SYSTEM_ARCHITECTURE.md`, and `docs/10_BUILD_ROADMAP.md` before touching code.
4. Paste `prompts/MASTER_BUILD_PROMPT.md` as the implementation brief.
5. Require implementation in roadmap order, with one vertical slice at a time. The agent must update `docs/10_BUILD_ROADMAP.md` and the test results after each completed milestone.
6. Start with the persisted browser-draft and approval-gated final-compile slice. Do not invoke Blender during editing, fake modeling, or begin by trying to generate a production-quality human body.

## What the starter does and does not do

The starter contains a browser UI, FastAPI project API, and an isolated Blender worker. Local username/password accounts protect owner-scoped projects; this is not production identity management and does not include email verification, password recovery, or login throttling. Projects persist as lightweight drafts with autosaved manifest-backed morphs and appearance selections; eye geometry is previewed from only the selected browser asset. The API/worker expose `create_hair_scalp` and `generate_hair_guides` for explicit staged operations; the editor has no Hair category, draft hair settings, or hair preview controls. These operations produce editable native guides, not renderable/exportable hair. The pinned Copilot Hair Tutor 0.1.8 artifact is owner-reviewed with independent origin unverified. The compatible CC3+ skin supports direct 3D-surface paint/erase, pressure-aware UV strokes, semantic tone/undertone/roughness, and deterministic freckles on the head UV map. The paint ring follows raycast hits; source maps remain unchanged in the draft and strokes are replayed onto copied maps only during explicit compile. Semantic paint layers, alpha/scatter brushes, and a synchronized 2D UV view are not available yet. Cheek/nose masks and other advanced skin features are not available yet; AI interpretation is a reviewable proposal, not texture generation. The user explicitly saves/compiles the selected pinned CC3 Female/Male or, when installed locally, CC5/CC3+ asset plus all saved supported draft choices in one Blender operation. No draft edit or preview starts Blender. The Male and CC5/CC3+ source licenses have not been supplied; keep those runtime assets local until redistribution rights are confirmed. The application does **not** implement production-quality anatomy, garment generation, production-grade identity management, or a complete Blender security sandbox.

## Non-negotiable requirements

- Preserve each meaningful asset component as a named, stable-ID object or group.
- Make phase state explicit and persistent.
- Ask for approval at configured checkpoints; never silently move past a required approval gate.
- Support scoped edits to a selected component.
- Snapshot before destructive or high-risk operations and support rollback.
- Use typed, allowlisted modeling operations. Do not expose arbitrary Python execution to a public browser client or an untrusted model.
- Validate geometry and scene structure after every meaningful operation.
- Distinguish verified facts from assumptions inferred from a reference image.
- Never claim “game-ready”, “production-ready topology”, or similar without passing an explicit target-specific validation suite.

## External project research

The reuse review in `docs/12_REPO_REUSE_REVIEW.md` includes live project links and licensing caveats. Research is a starting point, not legal advice. Re-check current licenses, bundled assets, API terms, backend availability, and repository activity before adopting code or distributing a derivative.
