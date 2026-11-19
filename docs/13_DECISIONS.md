# Architecture Decision Records (ADRs)

## ADR-001 — Browser UI + Blender worker rather than Blender desktop embedded in web
**Status:** Accepted for MVP

**Decision:** Build a web-first React viewport and run Blender in a controlled backend worker. Keep native `.blend` projects as the authoritative modeling artifact and use GLB snapshots for browser display.

**Why:** It matches the simplified UI vision and avoids requiring users to navigate the full Blender interface. It also separates UI iteration from Blender runtime and allows background jobs.

**Trade-offs:** Requires scene/preview synchronization and worker infrastructure; not every Blender feature maps perfectly to GLB.

## ADR-002 — Structure and phase state are backend-enforced
**Status:** Accepted

**Decision:** Component hierarchy, phase status, approval, scene version, and checkpoints are persisted in the API/database, not inferred from chat history alone.

**Why:** Chat transcripts are not reliable project state. Approval gates and object identity must survive refreshes and failures.

## ADR-003 — Typed allowlisted modeling tools
**Status:** Accepted

**Decision:** Runtime AI can call only schema-validated tools. No arbitrary AI-generated Python or shell execution in the product's exposed interface.

**Why:** Prevents scope violations and reduces the impact of prompt injection or malformed outputs.

## ADR-004 — No simulated modeling in the active product
**Status:** Accepted; replaces the retired mock-first approach

**Decision:** The active product requires Blender for model operations and labels deterministic planning as a template. It must not create placeholder geometry or return success-shaped mock modeling results.

**Why:** The viewport must show the supported CC3 character rather than an unrelated or simulated model. Explicit failure is preferable to presenting a capability the product does not provide.

## ADR-005 — Character-first MVP
**Status:** Accepted

**Decision:** Start with humanoid character workflow and modular outfit components.

**Why:** It maps directly to the stated user problem and provides a focused test for component relationships. Broader assets come later.

## ADR-006 — Native Blender file plus GLB preview
**Status:** Accepted

**Decision:** Use `.blend` as editable source of truth when real Blender is connected, and GLB for browser preview and portable export with explicit feature limits.

**Why:** The browser needs a fast common representation, while users need a native editable scene.

## ADR-007 — SQLite locally; database adapter for hosted deployment
**Status:** Accepted for MVP

**Decision:** Start with SQLite migrations and a repository abstraction; move to PostgreSQL for concurrent hosted use.

**Why:** Reduces local setup while protecting the service layer from database coupling.

## ADR-008 — CC3 morph character is the sole supported base model
**Status:** Superseded by ADR-009

**Decision:** The pinned consolidated CC3 morph GLB and shared 137-control manifest define the active character workflow. Retire the OBJ and CC5 import paths, mock body/garment tools, and legacy ear/eyelid sculpt operations.

**Why:** A single verified source asset keeps the browser preview, Blender scene, control panel, and API contract aligned. New operations must be added only with complete tests and documentation.

## ADR-009 — Asset-specific CC3 model selection
**Status:** Accepted

**Decision:** Support the pinned CC3 Female asset and a second pinned CC3 Male asset behind one typed asset registry. Persist the selected asset ID on each project, retain Female as the default for existing clients/projects, and load morph controls from the selected asset's shared manifest. Only expose Male when its manifest and local GLB are installed and the GLB hash matches.

**Why:** The user supplied a separate Male base and morph pack and requested it as a selectable alternative without replacing Female. Keeping each control contract asset-specific prevents morph maps from being applied to the wrong topology.

**Consequences:** Male's owner-supplied GLB is local-use-only until redistribution rights are confirmed. If its local binary is absent, only Female is offered. Both assets require the same approval gate and Blender worker allowlist. The Male glTF export's material and vertex-influence fidelity limitations remain disclosed.

## ADR-010 — Fixed reference-inspired workspace
**Status:** Accepted

**Decision:** Replace the dockable workspace with a fixed desktop composition: labeled left navigation, central viewport, and a fixed right inspector. Show installed character models in the inspector's Models view, followed by the existing Scene Hierarchy, Properties, and Workflow views. Keep chat floating rather than dockable.

**Why:** The user chose a fixed character-editor reference and explicitly asked to remove movable/dockable panels. Placing the real installed-model picker in the inspector preserves model selection without adding a persistent shelf that is absent from the requested composition.

**Consequences:** Existing browser-saved dock layouts are no longer read. Model creation, plan approval, final Blender compilation, and manifest-defined morph editing remain approval-gated. Unsupported presets, skin controls, markings, pose/camera tools, and export behavior remain unavailable rather than being represented by fake controls.

## ADR-011 — CC5 browser proxy with sparse morph deltas
**Status:** Accepted for local CC5/CC3+ installations

**Context:** The CC5/CC3+ asset has 2,042 controls across six source meshes. Regenerating and loading a full Blender preview for every slider update is too slow, while storing a complete geometry snapshot per slider multiplies storage and does not compose naturally.

**Decision:** Optionally generate a source-hash-bound browser GLB with the source topology and a ZIP of sparse positive/negative per-control vertex deltas. The browser lazily loads allowlisted controls and applies only changed values to the current proxy geometry, refreshing normals around affected vertices. Blender remains authoritative; only explicit save mutates the project. If the local proxy is unavailable or invalid, retain the existing debounced server preview for assembled projects; keep pre-assembly CC5/CC3+ sliders disabled instead of implicitly starting Blender.

**Alternatives considered:** Full geometry snapshots for each control (large and combinatorially unfit for mixed controls), and full-scene Blender regeneration on every slider change (too slow).

**Consequences:** The proxy avoids subdivision to keep a direct source-vertex mapping; its geometry therefore follows source topology rather than the higher-subdivision server preview. Sparse deltas must use the same normalized object transform and Blender-to-glTF coordinate conversion as proxy positions. The owner confirms rights to provide the CC3+ character with this application (2026-11-07); underlying third-party attribution or redistribution terms still require review before release. Integrity checks and manifest allowlisting gate proxy and delta delivery.

## ADR-013 — Basic and Advanced character workflows
**Status:** Accepted

**Decision:** Offer CC3 Female as the default **Basic** workflow and CC3+ Female as **Advanced** in new-character setup. Keep the CC3 Male available as an additional model option when installed. Both workflows use the same project, approval, and explicit compile gates; the Advanced option explains that it provides more shaping controls and may use more system resources.

**Why:** Users can choose the lighter, simpler starting model or the higher-detail model without needing to understand internal asset names.

**Consequences:** The selected pinned asset ID remains the persisted project contract. CC3+ is exposed only when its local source and preview artifacts pass existing integrity checks. The owner confirmed rights to provide it with the application on 2026-11-07; third-party attribution and redistribution terms still need release review.

## ADR-014 — Validated assistant proposals and registered UI guidance
**Status:** Accepted

**Context:** Users want to ask the assistant to adjust character controls and to explain how to use specific parts of the editor. Direct UI scripting or model-driven tool execution would bypass draft validation and existing approval/compile boundaries.

**Decision:** Non-plan chat responses use a typed interaction contract: user-facing text, optional manifest-validated morph/appearance proposals, and optional guidance to an API-supplied registered target. The API validates the model output; the browser renders a proposal and waits for explicit user application through existing draft APIs. Guidance opens the matching editor area and uses escaped text in a dismissible target-anchored tooltip. Chat cannot call Blender or approval/compile routes.

**Alternatives considered:** Let the model directly manipulate arbitrary browser controls or run modeling operations from chat (unbounded and unsafe); keep chat text-only (does not provide requested contextual assistance).

**Consequences:** Plain-text replies remain available but have no actions. Invalid structured output is reported explicitly and not persisted as a successful turn. The action/guidance payloads are currently response-only; persisted chat history stores text. The assistant must disclose missing capabilities such as the absence of an installed age morph or aging-skin effect.

## ADR-012 — Persist browser drafts before final Blender compile
**Status:** Accepted

**Context:** Importing large source assets while users are still choosing eyes, presets, or proportions makes editing slow and can freeze the worker. Whole-geometry snapshots per slider are also wasteful and cannot be composed efficiently.

**Decision:** All editing is browser preview plus persisted project draft data. Create and persist a lightweight project and plan without Blender. Autosave a complete, manifest-validated morph map and eye/preset/skin selections; do not store geometry snapshots or advance `scene_version` for draft edits. Eye previews use only their integrity-pinned GLBs. Plan approval changes phase state only. The user must explicitly choose **Save / Compile** or export after approval. The API sends the pinned source, saved morph map, preset, eye, and skin together so the worker creates the first Blender scene only at this final compile boundary. Standalone eye attachment is forbidden.

**Alternatives considered:** Import on project creation or eye selection (slow and caused worker resource spikes); per-slider geometry snapshots (large and non-composable); implicitly compile when approving (confuses review with a costly runtime operation).

**Consequences:** Drafts, planning, approval, and draft persistence work when Blender is unavailable. CC3, eye, and preset previews run in the browser; CC5/CC3+ uses the verified local proxy when installed. Hair generation and hairstyle preview/attachment are currently unsupported. If the optional CC5/CC3+ proxy is unavailable, the UI discloses that draft deformation cannot be previewed and keeps those sliders disabled rather than starting Blender. Blender is required only for explicit compile/export and explicit post-compile scene operations.

## ADR-015 — Persist skin painting as surface UV strokes
**Status:** Accepted for the local MVP

**Context:** Users need to paint on the visible character while keeping draft edits reversible and Blender-free. Editing source diffuse images directly would make drafts destructive and couple browser editing to high-resolution asset storage.

**Decision:** Convert each raycast surface hit into an allowlisted skin material and normalized UV point. Persist strokes (including optional per-point stylus pressure) as bounded project draft data. The browser composes a derived preview texture; at explicit compile, the worker replays the saved strokes onto copies of the pinned diffuse maps. A large UV jump starts a new stroke rather than bridging unrelated texture regions.

**Alternatives considered:** Persist browser-mutated bitmaps (destructive and opaque); store 3D decal geometry (does not update the skin texture); invoke Blender during each edit (violates the draft/compile boundary).

**Consequences:** Base maps remain unchanged while editing, and stroke data remains inspectable and replayable. The current slice provides a surface brush indicator, Paint/Erase, pressure-aware size/opacity, and stroke-level undo/clear. Semantic layer controls, redo, alpha/scatter brushes, and a synchronized UV canvas are deferred.

## ADR-016 — Local accounts and project ownership
**Status:** Accepted for the self-hosted MVP

**Context:** The local API previously relied on loopback access or one server-wide bearer token, which did not provide a distinct principal for project-level authorization.

**Decision:** Add local username/password accounts, scrypt password hashes, opaque server-side sessions in HttpOnly/SameSite=Strict cookies, CSRF-token checks for mutations, and an owner ID for every project. Keep account and project routes loopback-only unless `APP_ENV=production` is explicitly selected. Disable registration by default in production. Assign pre-existing ownerless projects to the first account created after migration.

**Alternatives considered:** Treat every local or bearer-token request as one shared owner (does not isolate accounts); add an external identity provider (adds deployment dependencies not available in the local MVP).

**Consequences:** The browser now requires sign-in and each account sees only its own project data. Password recovery, email verification, login throttling, hosted identity integration, and production readiness remain out of scope; production deployments still need HTTPS, explicit origins, rate limits, controlled provisioning, and a security review.

## ADR-017 — Immediate project deletion in the local MVP
**Status:** Accepted for local MVP

**Decision:** Keep project data until the owner explicitly deletes it, then immediately remove the database project state and checkpoints, reference uploads, and per-project Blender workspace. Do not retain a trash copy or automatically expire active projects.

**Why:** The existing project picker describes deletion as irreversible. Immediate cleanup honors that promise, minimizes retained user content, and avoids adding an undeclared recovery period.

**Consequences:** Owners must download or otherwise preserve anything they want to keep before deletion. Hosted deployments must separately define backup retention and deletion guarantees.

## ADR-018 — Hair workflow retired
**Status:** Superseded

**Context:** The initial pinned and procedural hair features were unreliable and did not meet the product's quality bar.

**Decision:** Remove the Hair editor, browser previews, draft settings, API routes, and Blender worker operations. Retain the former implementation notes below only as historical context; they do not describe supported behavior.

**Consequences:** Hair generation and hairstyle preview/attachment are unsupported. Any future hair implementation is a new product slice and must define its own preview, persistence, compile, validation, and rollback contracts before release.

## ADR-019 — Scoped native hair worker operations
**Status:** Accepted

**Context:** The transaction foundation is live-validated. The local Copilot Hair Tutor 0.1.8 archive passed headless API checks in Blender 5.2.2, but no independently trusted source repository or revision was established.

**Decision:** The project owner approved the exact archive for a narrowly allowlisted, staged worker integration while explicitly accepting that its origin remains unverified. Record its archive and canonical package-tree hashes, exact file inventory, and approval status in `starter/shared/hair_tutor_package.json`. Support only `create_hair_scalp` and `generate_hair_guides`, resolve objects using stable CoModel component/object IDs, and rely on transaction operation IDs plus persisted allocated component IDs for retries. Import the package without calling `register()` or `unregister()`.

**Consequences:** Native editable Hair Curves guides are created but remain hidden from renders. Visible/exportable hair, scalp-mask-guided distribution, morph refitting, browser draft controls, and hairstyle preview are excluded. This decision authorizes source changes only; it does not authorize production deployment or mutation of any live project.

## ADR template
- Title / status / date
- Context
- Decision
- Alternatives considered
- Consequences
