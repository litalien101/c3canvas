# Product Requirements Document (PRD)

## 1. Goals
1. Let a user initiate a 3D project from a text brief and/or reference image.
2. Show construction progress in a usable 3D viewport.
3. Build one meaningful component at a time, following a saved plan.
4. Require user approval at configured milestones.
5. Keep components independently editable with persistent identity and relationships.
6. Support localized edits, undo/rollback, and project export.
7. Require real Blender operations for modeling; never replace the model with simulated geometry.

**Draft/compile invariant:** all editing is browser preview plus persisted project draft data. No geometry is imported into Blender during editing. Only an explicit final save/export compiles the selected assets and tracked edits together in Blender; approval is a separate gate.

## 2. MVP user journeys

### Journey 0: Open C3Canvas
- On launch, the browser shows a welcome screen with actions to start a character project or explicitly reopen a saved project.
- The welcome screen does not load a character preview, create a project, open a saved project, or import geometry into Blender.
- Starting or opening a project is the explicit transition into the character workspace and its model preview.
- Only supported, installed character models and manifest-backed controls are presented. Unsupported fantasy armor, presets, skin editing, and markings are not implied.

### Journey A: New project
- User chooses “New character” and selects a workflow: **Basic** (CC3 Female, default) for a lighter starting point, or **Advanced** (CC3+ Female) for more shaping controls and compatible presets. The CC3 Male base is also available as an additional model where installed.
- Basic and Advanced use the same project and approval steps; Advanced offers more controls and may use more system resources.
- User may upload reference images. The current planner stores but does not analyze their pixels.
- The selected model ID is persisted in a lightweight project draft; Blender is not required to create it.
- The plan identifies the selected model. The user can adjust manifest-backed sliders in the browser, and the complete parameter map is autosaved to SQLite.
- User reviews and approves the plan. Approval does not import geometry or start Blender.
- Eye, preset, and morph choices preview in the browser and persist as draft data without invoking Blender.

### Journey B: Save/compile the draft
- After approval, the user explicitly chooses **Save / Compile** or export.
- The API sends the pinned source asset and all persisted draft choices (morphs, preset, and selected eye) in one Blender operation; no intermediate or per-asset Blender import occurs.
- Blender writes the first authoritative scene and preview only after this explicit action.
- The user reviews the compiled scene. Supported morph and body-preset changes remain preview-only until the user explicitly saves them to Blender; those scene edits are checkpointed and versioned. Draft eye selection is locked after compilation. Do not describe the whole compiled project as immutable or imply unsupported post-compile eye replacement.

### Journey C: Additional geometry (future)
Garments, accessories, anatomical edits, and reference-image-driven geometry are not supported by the current product. Add them only after a licensed implementation, scoped API/worker contract, measurable checks, and end-to-end tests exist.

### Journey D: Recover from bad result
- Every destructive or high-risk operation produces a checkpoint.
- User can revert to the prior checkpoint or previous accepted state.
- Job failure is visible and does not silently mark the phase complete.

### Journey E: Save/export
Projects persist their plan, draft morph map and revision, eye/preset selections, and references without a Blender scene. The explicit final Save / Compile creates the first Blender scene and component manifest from the selected assets and tracked edits together. User-facing file export is not yet available.

### Journey F: Ask the assistant for an edit or walkthrough
- The user asks a question or requests a change in the workspace chat.
- The assistant may return a concise answer, a draft-only proposal using currently available morph/appearance controls, and/or a guide targeting a registered UI control.
- The user sees the proposed values and explicitly chooses **Apply to draft**. Existing draft validation and persistence rules apply; applying a proposal never compiles or starts Blender.
- Guidance opens the relevant editor area and displays a dismissible tooltip beside its registered control. The user can reopen it from the chat.
- If an effect or asset is unavailable (for example, no installed aging morph/skin effect), the assistant states the limitation rather than inventing a control or claiming the effect was applied.

## 3. Functional requirements

### Project and references
- FR-001: Create, rename, archive, and reopen projects.
- FR-002: Upload image references with file-type, size, and dimension validation.
- FR-003: Store reference metadata and optional user notes; never assume the hidden side of a model is known.
- FR-004: A project has one active scene version and a version history.

### Plan and phases
- FR-010: Generate a component plan before extensive modeling.
- FR-011: Allow edits to the component plan and per-component granularity.
- FR-012: Maintain phase states: `not_started`, `queued`, `running`, `awaiting_review`, `approved`, `blocked`, `failed`, `skipped`.
- FR-013: Enforce dependencies and human approval gates server-side.
- FR-014: Each phase records plan, operations, outputs, validations, decisions, and approval metadata.
- FR-015: Users can request revisions before approval; revisions create new operation records rather than erasing history.

### Modeling and components
- FR-020: All scene components have stable UUIDs independent of their display names.
- FR-021: Components include semantic type, parent/group, dependencies, material references, source/target phase, scene version, and validation state.
- FR-022: Provide select, rename, hide/show, isolate, and focus actions in the component tree/viewport.
- FR-023: Support scoped editing to the selected component and declared dependent components.
- FR-024: Model agent operations must declare their intended scope and expected scene version.
- FR-025: Validate every operation's output before committing it.
- FR-026: Preserve the imported character meshes and rig as stable component/object identities; future component types require their own tested contracts.
- FR-027: Material updates must not change mesh geometry unless the operation explicitly declares geometry changes.
- FR-028: A scoped morph update must not affect objects outside its body component.

### Viewport and progress
- FR-030: Viewport supports orbit/rotate, zoom, pan, fit-to-view, selection, and a clean default camera.
- FR-031: The UI receives phase/job/operation events and updates progress in place.
- FR-032: A preview refreshes after each meaningful operation, not only after the whole project ends.
- FR-033: Show a clear indication when the Blender preview is stale, loading, or unavailable; never substitute a mock model.
- FR-034: Use loading/progress messages that describe the current action without falsely claiming exact polygon-level real-time generation.

### Review and history
- FR-040: Users can approve a phase, request changes, cancel an active job, and roll back to a prior checkpoint.
- FR-041: Approval is recorded with timestamp, phase ID, project version, and actor.
- FR-042: Rollback restores both scene data and component manifest to a consistent version.
- FR-043: The UI summarizes what changed and which component IDs were affected.

### AI and tools
- FR-050: AI provider is configured through server-side adapters.
- FR-051: Runtime model agent uses allowlisted tools with JSON-schema validation.
- FR-052: Do not run arbitrary model-generated code in Blender.
- FR-053: Model tool operations are idempotent where practical and include operation IDs.
- FR-054: Agent can request more reference information if uncertainty materially affects the geometry; otherwise it records assumptions and continues with reversible choices.
- FR-055: Chat may propose only manifest-backed morph values and installed, compatible appearance assets; the API validates IDs, ranges, and project state before returning an actionable proposal.
- FR-056: The user must explicitly apply a draft proposal. Chat cannot directly mutate Blender, approve a phase, compile a project, or bypass existing state gates.
- FR-057: Chat guidance may target only registered controls and assets. The UI opens the relevant category, anchors an accessible dismissible tooltip, and allows the user to reopen it from chat.
- FR-058: Plain-text assistant replies remain readable but produce no actions; malformed or invalid structured actions fail explicitly and are not persisted as successful chat turns.

### Export and quality
- FR-060: Export a Blender `.blend` project when the Blender runtime is available.
- FR-061: Provide GLB preview/export when supported by the current feature set.
- FR-062: Export report lists components, applied checks, warnings, and unsupported features.
- FR-063: Do not call an asset production-ready unless a target profile's checks pass.

## 4. Non-functional requirements
- NFR-001: No provider API key in frontend bundles or browser storage.
- NFR-002: Public worker endpoints require authentication and must not accept arbitrary code.
- NFR-003: Long jobs are asynchronous; user can continue inspecting the scene while they run.
- NFR-004: Every event has project/job/operation identifiers and a monotonic sequence number.
- NFR-005: Operations have timeouts, resource budgets, cancellation, and isolated filesystem access.
- NFR-006: Test the actual supported Blender workflow in a Blender-enabled integration environment; do not mask a missing worker with mock geometry.
- NFR-007: Usable at desktop 1280×800 or greater; mobile is not a primary MVP target.
- NFR-008: Accessibility: keyboard navigation for core actions, visible focus, adequate contrast, labeled controls, reduced-motion preference.
- NFR-009: Local project save/export survives application restart.
- NFR-010: File upload and asset retention policies are visible to the user.

## 5. Acceptance criteria for the active character slice
1. Select an installed character model, create a project and deterministic matching plan without Blender, and optionally upload a valid reference.
2. Save slider values to the project draft with optimistic draft revisions; reopen the project and verify values persist without a Blender scene or component.
3. Verify that plan approval does not start Blender or create geometry, and that final compile remains unavailable until approval.
4. Reject compile before approval, reject a different model than the project selection, and reject all uninstalled assets and tools.
5. Explicitly Save / Compile the selected pinned asset and saved draft morph, preset, and eye choices in one operation; verify asset hashes, meshes, rig, topology, shape keys, and every control in its manifest (Female: 137; Male: 143; CC5/CC3+: 2,042 when locally installed).
6. Preview signed and one-sided morph values locally; verify draft persistence without a Blender scene, then verify the explicit compile result and refreshed GLB.
7. Reject incomplete, out-of-range, stale-version, and out-of-scope morph requests without changing the saved scene.
8. Restore the pre-edit checkpoint and verify the previous morph values and monotonic scene version.
9. Reopen the project explicitly and verify the draft or assembled scene, component metadata, and morph controls remain consistent.

## 6. Product analytics (privacy-conscious)
Track event counts and timing only when configured and disclosed: project created, phase started/completed, approval, rollback, export outcome, operation failure. Do not send reference images, prompts, model geometry, or other content to analytics by default.
