# Modeling Workflow and Phase State Machine

## Principles
- **Draft/compile boundary:** eye, preset, and morph draft edits are live browser previews plus persisted data. Do not invoke Blender or import geometry for those edits. Compile all saved choices together only after explicit user save/export; later scene changes also require explicit, supported worker operations.
- The system agrees on structure before expensive modeling.
- Each phase yields a reviewable artifact.
- Approval gates are enforced by backend state, not by prompt wording alone.
- Every operation declares scope, dependencies, and expected scene version.
- User edits are preserved as project history.

## Project phase template
Phases are configurable and some can repeat per component. Do not hard-code every asset into one fixed seven-step list; keep a standard character template plus a dependency graph.

### Phase 0 — Reference analysis and plan
Outputs: reference inventory; assumptions/uncertainties; target-use profile; component plan; hierarchy; dependency graph; quality targets; estimated operation sequence.
Before final compile, the selected model can be previewed in the browser and its complete morph-control map plus appearance selections autosaved to the project draft. Draft persistence does not create scene geometry or require Blender.
Gate: plan approval before meaningful geometry generation. Approval alone never starts Blender.

### Phase 1 — Draft review and final compile
Outputs before save: live browser previews and persisted selections/morphs; no Blender scene, component geometry, or worker operation.
Gate: plan approval is required before final compile, but approval itself never invokes Blender.

On explicit **Save / Compile** or export, the API sends the pinned base asset, chosen eye and preset, and complete saved morph map together in one worker import. The first Blender scene and preview are created only after this action. Do not reintroduce per-selection attachment or import flows.

### Phase 2 — Base body refinement
Outputs: improved anatomy and topology according to target profile; validation notes; stable mesh IDs.
Gate: user approves body before clothes and accessories are fitted.

### Phase 3 — Body materials and surface details
Outputs: skin/body materials, textures where supported, material assignments. Geometry must remain unchanged unless explicitly authorized.
Gate: review appearance and material quality.

### Phase 4 — Clothing, one garment task per component
Examples: undershirt, jacket, pants, dress, gloves. A garment can contain subcomponents if the plan says they need independent editing. Each task must declare fit target(s), layer order, body region, dependencies, and whether it may modify underlying geometry (default: no).
Gate: approve/revise each garment or a user-chosen bundle.

### Phase 5 — Footwear, armor, and accessories
Separate left/right items and fasteners only where practical. Maintain attachments and meaningful material boundaries. Use component tasks with explicit dependencies.
Gate: approve/revise by component or group.

### Phase 6 — Final validation and export preparation
Run scene/component checks, material/UV checks where applicable, naming/hierarchy checks, intersection heuristics where available, and target-specific checks. Produce a report; never claim a check was performed if the validator is not implemented.
Gate: user sees warnings before export.

### Optional Phase 7 — Rigging/animation/export profile
Build a rig and test poses only when requested and when the current geometry supports it. Clothing deformation, skin weights, and rig compatibility need dedicated validation. Keep optional; don't block static asset export unnecessarily.

## Phase state machine

```text
not_started → queued → running → awaiting_review → approved
                         │              │
                         ├─ failed      ├─ request_changes → queued/running
                         ├─ blocked     └─ rollback → previous consistent version
                         └─ cancelled
```

- `approved` is terminal for the current phase revision. A user can request reopening, which creates a new phase revision and leaves history intact.
- `blocked` means a dependency is unresolved or a required runtime/resource is missing.
- `failed` means an operation failed; it does not mean approved.
- `skipped` is allowed only when the plan and dependency graph permit it, and the skip is recorded.

## Component lifecycle
`planned → queued → creating → needs_review → approved → modified/archived`.
A component can have multiple revisions. Stable component ID persists when the semantic component is revised; a replacement that is genuinely a different component can receive a new ID and keep a `replaces_component_id` link.

## Scoped-edit policy
Every user message should be classified as one of:
1. Selected-component edit.
2. Named component edit.
3. Global change affecting multiple components.
4. Plan change affecting future work.
5. Ambiguous/underspecified instruction.

For 1 and 2, default to minimal scope. For 3, show the intended affected components and ask for confirmation if the change is destructive or affects approved components. For 4, update the plan and preserve completed work unless changes are required. For 5, ask one concise clarifying question only if reasonable alternatives would materially change the asset; otherwise make a reversible assumption and disclose it.

In the current browser draft, chat requests for supported morph or appearance changes produce an allowlisted proposal, not an operation. The user explicitly applies that proposal to the persisted draft. Chat cannot change a compiled appearance, approve a phase, or start Blender. How-to questions may return guidance attached to a registered UI target without changing project data.

## Dependency examples
- Garment fit depends on body geometry version.
- Armor fitting may depend on body and garment layers.
- Material edits depend on material slots but ordinarily not geometry.
- Rigging depends on body topology/pose and may depend on garment weighting.
- Export profile depends on target use and current validation warnings.

If a dependency changes, mark affected downstream components `needs_revalidation`; do not silently mutate them. Offer a repair/refit operation.

## Reference confidence
Single-view references hide the back, side, and occluded geometry. Store per-feature evidence: observed, inferred, or user-specified. Ask for extra reference views where the uncertainty is high and consequential. Do not invent a precise hidden detail while presenting it as source-grounded.
