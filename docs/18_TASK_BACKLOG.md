# Build Backlog and Issue Breakdown

Use this backlog with `docs/10_BUILD_ROADMAP.md`. Implement in order unless a dependency requires otherwise. Each item should become a small PR/commit with tests.

The roadmap and acceptance suite describe the current supported product. This issue-style inventory includes deferred and historical work; an unchecked item is not by itself evidence that a shipped capability is missing.

## Epic A — Repository and developer experience
- [ ] **A-001** Pin supported Node/Python/Blender versions after smoke testing; commit lockfiles.
- [ ] **A-002** Add root-level setup scripts/Makefile or cross-platform task runner.
- [ ] **A-003** Add formatter/linter/type-check configuration for TypeScript and Python.
- [ ] **A-004** Add CI for frontend build, API tests, schema validation, and Blender-worker syntax checks.
- [ ] **A-005** Add `.env.example`, validate environment variables at startup, never log secrets.
- [ ] **A-006** Add a repository-level architecture map and developer troubleshooting guide.

## Epic B — Browser workspace
- [ ] **B-001** Keep viewport as the largest element in the layout.
- [ ] **B-002** Implement camera orbit, pan, zoom, fit-to-model, and named standard views.
- [ ] **B-003** Implement selection outline and selected-component scope indicator.
- [ ] **B-004** Implement component tree with nesting, type labels, select, rename, hide/show, isolate, and focus.
- [x] **B-005** Implement chat input, persisted text history, and explicit error states.
- [ ] **B-011** Add streamed assistant progress messages for long-running requests.
- [x] **B-012** Add validated draft-only assistant proposals and registered target-anchored UI guidance.
- [ ] **B-006** Implement phase rail and phase status badges.
- [ ] **B-007** Implement phase-review card with Approve / Request changes / Rollback.
- [ ] **B-008** Show `Mock mode` and `Preview stale` states clearly.
- [ ] **B-009** Preserve camera orientation across preview refresh where possible.
- [ ] **B-010** Add keyboard accessibility, focus treatment, labels, and reduced-motion handling.

## Epic C — API and persistence
- [ ] **C-001** Replace in-memory project store with SQLModel/SQLAlchemy or equivalent repository layer.
- [ ] **C-002** Add schema migrations.
- [x] **C-003** Implement owner-scoped permanent project deletion and immediate local artifact cleanup.
- [ ] **C-004** Implement reference upload, metadata storage, size/type/pixel limits, and deletion.
- [ ] **C-005** Implement phase records and dependency graph validation.
- [ ] **C-006** Implement component manifest persistence.
- [ ] **C-007** Implement jobs, operations, checkpoints, and event log.
- [ ] **C-008** Implement stable API error codes and response envelopes.
- [ ] **C-009** Add idempotency keys for mutating/job endpoints.
- [ ] **C-010** Add authentication/ownership authorization before any hosted/public deployment.

## Epic D — Phase and version state machine
- [ ] **D-001** Implement legal phase transitions as pure domain logic.
- [ ] **D-002** Enforce dependency approvals server-side.
- [ ] **D-003** Enforce approval only from `awaiting_review` at the reviewed scene version.
- [ ] **D-004** Revisions create a new revision record without erasing prior history.
- [ ] **D-005** Implement scene version compare-and-swap behavior.
- [ ] **D-006** Implement checkpoint creation and restore with a monotonically increasing version.
- [ ] **D-007** Mark downstream components `needs_revalidation` when dependencies change.
- [ ] **D-008** Make cancellations and failures explicit states, not silent no-ops.

## Epic E — Progress/events and jobs
- [ ] **E-001** Define event envelope and monotonic project-level sequence number.
- [ ] **E-002** Stream job/phase/operation events by WebSocket or SSE.
- [ ] **E-003** Implement replay/poll endpoint using `after` sequence number.
- [ ] **E-004** Provide cancellation, timeouts, retry policy, and max retries.
- [ ] **E-005** Add structured logs with correlation IDs and content redaction.
- [ ] **E-006** Test worker crash and partial artifact failure recovery.

## Epic F — Retired mock modeling adapter

The planned mock body/garment path was removed. Draft creation, planning, approval, and manifest-backed morph autosave do not require Blender; pinned character assembly and later scene operations do. Do not implement placeholder geometry or success-shaped mock operations. The CC3/CC5 import, morph persistence, component manifest, and checkpoint behavior are covered by the current API and worker tests.

## Epic G — Typed modeling tools and safety
- [ ] **G-001** Build tool registry with strict Pydantic/JSON Schema args.
- [ ] **G-002** Reject unknown tool names, extra arguments, arbitrary code, paths, and stale scene versions.
- [ ] **G-003** Validate all component IDs belong to the authorized project.
- [ ] **G-004** Require scope IDs and expected scene version on mutations.
- [ ] **G-005** Save a checkpoint before destructive operations.
- [ ] **G-006** Compare before/after component scope; reject unexpected modifications.
- [ ] **G-007** Maintain operation time/resource budget and cancellation hooks.
- [ ] **G-008** Audit the code path for prompt injection and untrusted imported metadata.

## Epic H — Blender worker
- [ ] **H-001** Detect Blender executable/version and fail clearly if unavailable.
- [ ] **H-002** Run Blender through a dedicated worker process, never inside API request thread.
- [ ] **H-003** Create/reopen `.blend` scenes using project-derived workspace paths.
- [ ] **H-004** Persist semantic component UUIDs to object custom properties.
- [ ] **H-005** Implement scene inspection and structure validation.
- [x] **H-006** Placeholder body and garment operations were retired; integration tests exercise the pinned CC3 asset instead.
- [ ] **H-007** Export GLB preview and native `.blend` checkpoint.
- [ ] **H-008** Implement temporary workspace + atomic promote/rollback.
- [ ] **H-009** Add Blender version-specific integration test and artifact reopen test.
- [ ] **H-010** Containerize/harden worker for public use with no default network egress.

## Epic I — Geometry and component adapters
- [ ] **I-001** Run time-boxed evaluation of MPFB/MakeHuman, CharacterCreator, and a procedural alternative.
- [ ] **I-002** Create geometry-adapter interface and one documented implementation.
- [ ] **I-003** Build body parameters/targets and reference-analysis mapping; record unknowns.
- [ ] **I-004** Establish body quality goals and test views before clothing.
- [ ] **I-005** Build a garment-adapter interface with fit targets and layer order.
- [ ] **I-006** Validate garment remains a separate object/component.
- [ ] **I-007** Implement garment-only revisions and body-unchanged regression test.
- [ ] **I-008** Add material-only editing route that does not change geometry.
- [ ] **I-009** Add accessory/footwear operations.
- [ ] **I-010** Only after the core workflow passes, evaluate retopology, UVs, and rigging.
- [x] **I-011** Add a typed, approval-gated source-model import operation that reads the pinned base-model asset, preserves source groups/material slots/asset hashes, and validates expected geometry counts without accepting arbitrary model code.

## Epic J — AI orchestration
- [ ] **J-001** Implement provider-neutral adapter and server-side key configuration.
- [ ] **J-002** Add typed reference-analysis output with observed/inferred/unknown labels.
- [x] **J-003** Add deterministic/mock planner and real AI planner behind the same interface.
- [ ] **J-004** Route user intents to question, plan change, scoped component edit, global edit, or review action.
- [ ] **J-005** Give the runtime agent only registered tools and validated tool results.
- [ ] **J-006** Add budget/cycle limits and failure handling.
- [ ] **J-007** Add concise change summaries with changed and preserved component lists.
- [ ] **J-008** Evaluate prompt-injection and invalid-tool-call scenarios.

The shared plan contract also supports an explicit pre-approval edit/save step through the project plan endpoint. Edits preserve retained component IDs, server-assign IDs for new entries, and use scene-version and plan-revision compare-and-swap guards.

## Epic K — Export and quality reporting
- [ ] **K-001** Save manifest next to every authoritative Blender file.
- [ ] **K-002** Export GLB preview and test it in browser.
- [ ] **K-003** Add validation report schema with `pass`, `warn`, `fail`, and `not_run`.
- [ ] **K-004** Implement naming/hierarchy/duplicate-ID checks.
- [ ] **K-005** Implement normals/degenerate geometry checks where reliable.
- [ ] **K-006** Add target profile checks and avoid unsupported readiness claims.
- [ ] **K-007** Provide export report and show warnings before export.

## Epic L — Release hardening
- [ ] **L-001** Add security review and dependency/SBOM/license notices.
- [ ] **L-002** Add upload limits, signed asset URLs/authorization, retention/deletion.
- [ ] **L-003** Add observability and job-cost limits.
- [ ] **L-004** Add production database/object storage deployment.
- [ ] **L-005** Test backups and restore procedure using real `.blend` + manifest.
- [ ] **L-006** Perform end-to-end acceptance suite on supported OS/Blender versions.
- [ ] **L-007** Publish known limitations and a transparent quality matrix.
