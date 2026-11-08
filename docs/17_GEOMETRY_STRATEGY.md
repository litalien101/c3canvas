# Geometry Strategy

## Current supported asset

The active modeling path supports the pinned CC3 Female/Male GLBs and an owner-supplied CC5/CC3+ Blender asset documented in [the character blueprint](./19_BASE_MODEL_BLUEPRINT.md). Blender remains authoritative; the browser renders a GLB preview. The API and worker validate each source hash, mesh/rig structure, manifest, operation scope, and scene version. CC3 controls preview locally. For CC5/CC3+, an optional local proxy uses source-topology geometry and sparse control deltas, avoiding the transfer of thousands of morph targets; explicit save still applies values to Blender. Without verified proxy artifacts, the existing Blender preview path remains available.

The product does not currently generate anatomy, garments, accessories, or geometry from reference images. References are stored but not analyzed. The UI and API must communicate these limits rather than substituting placeholders or implying completed modeling.

## Extension criteria

Before adding another geometry operation:

1. Identify a properly licensed, reproducible source asset or algorithm.
2. Define stable component IDs, relationships, and the exact operation scope.
3. Define measurable structural checks and clearly identify visual checks that remain `not_run`.
4. Require a pre-operation checkpoint and preserve unrelated components.
5. Add API, worker, and browser behavior together, with tests for approval, failure, rollback, and scene-version consistency.
6. Document limitations and source provenance before exposing the operation.

Do not add whole-scene regeneration for a scoped edit. A user-requested change must affect only its selected component and explicitly declared dependencies.
