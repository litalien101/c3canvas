# Test Strategy and Acceptance Suite

## Required CC3 workflow

1. Without Blender, API health reports `blender_available: false`, and project creation, plan creation/approval, and draft morph persistence still work; no mock mode or geometry is created.
2. A fresh project starts without selecting a saved project or displaying a fallback model; Female remains the default, and the selected installed model persists through planning and reopen.
3. A deterministic plan remains awaiting approval. Approval alone neither invokes Blender nor creates a scene component.
4. Draft morph writes require a complete selected-manifest map, validate signed/one-sided ranges, advance `draft_revision`, preserve `scene_version`, reject stale revisions, and survive project reopen.
5. Draft eye, preset, and compatible skin selections persist without changing `scene_version` or invoking Blender; skin selection rejects models outside its manifest allowlist; standalone eye modeling operations return `DRAFT_PREVIEW_ONLY`.
6. Final compile is rejected before approval, rejects an asset that differs from the project selection, and accepts only an installed pinned asset. It receives the persisted draft morph map, preset, eye, and selected skin together in the initial worker import.
7. Female import verifies four meshes, 14,647 runtime body vertices, 313 body shape keys, a 101-bone rig, and all 137 manifest controls. When installed, also verify Male (four meshes, 14,647 runtime body vertices, 323 body shape keys, 101-bone rig, 143 controls) and CC5/CC3+ (six meshes and 2,042 controls).
8. Compiled morph edits accept complete maps with signed/one-sided ranges from the selected manifest; malformed, incomplete, out-of-range, wrong-asset, or out-of-scope requests are rejected.
9. CC3 browser slider previews remain local. When the integrity-checked local CC5/CC3+ proxy is installed, draft and compiled slider previews combine cached signed deltas without Blender requests; without the proxy, draft CC5/CC3+ sliders are clearly disabled rather than causing a Blender preview operation. Explicit post-compile saves update the Blender scene, component manifest, preview, and scene version.
10. All 27 extracted CC5/CC3+ body/head preset FBXs are covered by the pinned allowlist. Only presets with an available pinned source and generated proxy delta appear in the catalog. Selecting one previews and persists it in the draft without Blender; final compile applies it to `CC_Base_Body` and transfers the deformation to separate eye, occlusion, tearline, teeth, and tongue meshes. It records the preset ID. Other character assets reject preset selection.
11. With an active non-neutral CC5/CC3+ preset or eye morph, switching among replacement eye assets (including `eye_game_multiUV` and `eye_game_oneUV`) transfers proxy deltas through matching eye-surface vertices, converts proxy meters to eye-local units, and keeps the incoming overlay hidden until deformation is applied. It then crossfades at the character's eye position without a base-pose flash or displacement-scale jump.
12. Repeating an operation ID with identical request data returns the recorded operation without rerunning Blender, even after the scene advances; reusing the ID with different request data returns `409 OPERATION_ID_REUSED`.
13. A checkpoint restore recovers the prior morph map and advances scene version monotonically.
14. Reference images are content-validated and stored locally; tests and UI do not claim that reference pixels were analyzed.
15. Chat includes a bounded request-relevant subset of selected-manifest controls/ranges and compatible installed appearance assets without reference pixels; the complete catalog is not truncated into malformed JSON. A valid structured response returns a draft proposal and registered guidance without mutating draft values or scene version and without invoking Blender.
16. Chat rejects unknown morph IDs, out-of-range/non-finite values, incompatible or unavailable appearance assets, appearance changes after compilation, morph changes when editing is disabled, and unregistered guidance targets. Rejected turns are not persisted.
17. Text-only assistant replies remain visible with a warning that no action was created. Malformed structured output fails explicitly. The UI requires explicit **Apply to draft**, shows action status, and never auto-approves or compiles.
18. Guidance opens the correct editor category, places a dismissible tooltip at the registered target, repositions it on scroll/resize, and can be reopened from chat. Missing targets do not produce a misplaced tooltip; tooltip text is rendered as text, not HTML.
19. Requests for unavailable capabilities (including an actual age morph or aging skin) are described honestly and do not invent controls or assets.
20. A slider-location question receives registered `morph-library` guidance even when Copilot replies with plain text; the browser opens Body Morphs and selects a real control without changing draft values or scene version.

## Worker security and correctness

- Unknown and retired tools, extra arguments, arbitrary code, client paths, invalid assets, and stale scene versions are rejected.
- Component scope is checked before mutation and compared against scene changes afterward.
- Scope checks skip full vertex fingerprints only for the explicitly scoped component; changes to unrelated components remain rejected.
- Scene writes remain inside the project workspace and use atomic output promotion.
- Worker failures do not replace the last committed Blender scene.
- A CC5/CC3+ preview export uses an isolated temporary workspace and preserves the saved scene bytes, project morph map, and scene version.

## Browser checks

- The application displays an empty workspace until an explicit project is created/opened. A draft can show the selected browser preview without an imported Blender component.
- Saved projects are never automatically selected on page load.
- All controls are rendered from the selected project's manifest metadata after import (137 Female; 143 Male).
- Loading, Blender/API errors, draft autosave errors, unsaved slider values, live-preview progress, and saved Blender preview state are distinguishable.
- CC5/CC3+ proxy mode validates the proxy and delta hashes, loads allowlisted controls on demand, replaces the previous signed delta correctly when sliders change or cross zero, applies slider changes without replacing the base geometry, and reports a clear error if proxy data is invalid.
- Component visibility controls affect preview only, not saved geometry.
- The Skin tab lists only locally installed hash-verified assets; the CC3+ Female card is disabled for incompatible models, previews its four diffuse/normal material regions without Blender, and is applied only during final compile.
- Assistant proposals apply only to the selected draft through the established API; changes do not bypass autosave, compiled-state restrictions, plan approval, or explicit compile.

## Test commands

```bash
cd starter/api && . .venv/bin/activate && pytest -q
cd starter/api && . .venv/bin/activate && pytest -q ../worker/blender/test_worker.py
cd starter/web && npm run build
cd starter/web && npm test
```

Use synthetic references in tests. Do not commit private user images or generated project output.
