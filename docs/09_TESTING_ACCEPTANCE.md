# Test Strategy and Acceptance Suite

## Required CC3 workflow

1. Without Blender, API health reports `blender_available: false`, and project creation, plan creation/approval, and draft morph persistence still work; no mock mode or geometry is created.
2. A fresh project starts without selecting a saved project or displaying a fallback model; Female remains the default, and the selected installed model persists through planning and reopen.
3. A deterministic plan remains awaiting approval. Approval alone neither invokes Blender nor creates a scene component.
4. Draft morph writes require a complete selected-manifest map, validate signed/one-sided ranges, advance `draft_revision`, preserve `scene_version`, reject stale revisions, and survive project reopen.
5. Draft eye, preset, and compatible skin selections persist without changing `scene_version` or invoking Blender; skin selection rejects models outside its manifest allowlist; standalone eye modeling operations return `DRAFT_PREVIEW_ONLY`.
6. Final compile is rejected before approval, rejects an asset that differs from the project selection, and accepts only an installed pinned asset. It receives the persisted draft morph map, preset, eye, selected skin, semantic skin definition, and paint strokes together in the initial worker import.
7. Female import verifies four meshes, 14,647 runtime body vertices, 313 body shape keys, a 101-bone rig, and all 137 manifest controls. When installed, also verify Male (four meshes, 14,647 runtime body vertices, 323 body shape keys, 101-bone rig, 143 controls) and CC5/CC3+ (six meshes and 2,042 controls).
8. Compiled morph edits accept complete maps with signed/one-sided ranges from the selected manifest; malformed, incomplete, out-of-range, wrong-asset, or out-of-scope requests are rejected.
9. CC3 browser slider previews remain local. When the integrity-checked local CC5/CC3+ proxy is installed, draft and compiled slider previews combine cached signed deltas without Blender requests; without the proxy, draft CC5/CC3+ sliders are clearly disabled rather than causing a Blender preview operation. Explicit post-compile saves update the Blender scene, component manifest, preview, and scene version.
10. The CC3+ Elven Ears preset is available only when all of its native morph controls are present, applies only its supported ear values while preserving unrelated draft morphs, previews through the local proxy, and does not start Blender.
11. All 27 extracted CC5/CC3+ body/head preset FBXs are covered by the pinned allowlist. Only presets with an available pinned source and generated proxy delta appear in the catalog. Selecting one previews and persists it in the draft without Blender; final compile applies it to `CC_Base_Body` and transfers the deformation to separate eye, occlusion, tearline, teeth, and tongue meshes. It records the preset ID. Other character assets reject preset selection.
12. With an active non-neutral CC5/CC3+ preset or eye morph, switching among replacement eye assets (including `eye_game_multiUV` and `eye_game_oneUV`) transfers proxy deltas through matching eye-surface vertices, converts proxy meters to eye-local units, and keeps the incoming overlay hidden until deformation is applied. It then crossfades at the character's eye position without a base-pose flash or displacement-scale jump.
13. Repeating an operation ID with identical request data returns the recorded operation without rerunning Blender, even after the scene advances; reusing the ID with different request data returns `409 OPERATION_ID_REUSED`.
14. A checkpoint restore recovers the prior morph map and advances scene version monotonically.
15. Reference images are content-validated and stored locally; tests and UI do not claim that reference pixels were analyzed.
16. Chat includes a bounded request-relevant subset of selected-manifest controls/ranges and compatible installed appearance assets without reference pixels; the complete catalog is not truncated into malformed JSON. A valid structured response returns a draft proposal and registered guidance without mutating draft values or scene version and without invoking Blender.
17. Chat rejects unknown morph IDs, out-of-range/non-finite values, incompatible or unavailable appearance assets, appearance changes after compilation, morph changes when editing is disabled, and unregistered guidance targets. Rejected turns are not persisted.
18. Text-only assistant replies remain visible with a warning that no action was created. Malformed structured output fails explicitly. The UI requires explicit **Apply to draft**, shows action status, and never auto-approves or compiles.
19. Guidance opens the correct editor category, places a dismissible tooltip at the registered target, repositions it on scroll/resize, and can be reopened from chat. Missing targets do not produce a misplaced tooltip; tooltip text is rendered as text, not HTML.
20. Requests for unavailable capabilities (including an actual age morph or aging skin) are described honestly and do not invent controls or assets.
21. A slider-location question receives registered `morph-library` guidance even when Copilot replies with plain text; the browser opens Body Morphs and selects a real control without changing draft values or scene version.

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
- With the compatible skin selected, Paint and Erase pointer gestures update the four material-region previews without camera orbit or Blender; each gesture persists as validated project draft strokes, survives reopen, and is included only in explicit final compile. Undo and Clear paint update the saved draft; invalid tools, regions, UVs, or brush values are rejected.
- Semantic tone, undertone, and roughness controls update the browser preview without invoking Blender, require an explicit save, persist across reopen with revision checks, and are included only in final compile. AI interpretation returns a validated explanation and preview without changing saved draft state; explicit Apply saves it. Unsupported values and malformed AI output fail without modifying the draft.
- Assistant proposals apply only to the selected draft through the established API; changes do not bypass autosave, compiled-state restrictions, plan approval, or explicit compile.
- The CC5/CC3+ Ears library groups all 224 ear controls exactly once; selecting a group retains individual morph identity, ranges, sliders, favorites, and related controls. Search spans all ear groups, labels ear results by group, and opens the selected result's group. Basic and Advanced modes and All/Favorites/Recent filters remain available inside groups.
- The Body library groups all 180 CC5/CC3+ Body-category controls exactly once, with manifest-backed compatibility coverage for CC3 Female and Male. Group navigation preserves individual control identifiers and behavior; search spans groups, labels Body results by group, and opens the matching group when a result is selected. Basic and Advanced modes and All/Favorites/Recent filters remain available inside groups.
- The Head library groups all 103 CC5/CC3+ Head-category controls exactly once, with manifest-backed compatibility coverage for CC3 Female and Male. Group navigation preserves individual control identifiers and behavior; search spans groups, labels Head results by group, and opens the matching group when a result is selected. Basic and Advanced modes and All/Favorites/Recent filters remain available inside groups.
- The Face library groups all 93 CC5/CC3+ Face-category controls exactly once, with manifest-backed compatibility coverage for CC3 Female and Male. Group navigation preserves individual control identifiers and behavior; search spans groups, labels Face results by group, and opens the matching group when a result is selected. Basic and Advanced modes and All/Favorites/Recent filters remain available inside groups.
- The Eyes library groups all 322 CC5/CC3+ Eyes-category controls exactly once, with manifest-backed compatibility coverage for CC3 Female and Male. Group navigation preserves individual control identifiers and behavior; search spans groups, labels Eyes results by group, and opens the matching group when a result is selected. Basic and Advanced modes and All/Favorites/Recent filters remain available inside groups.
- The Nose, Mouth, Arms, Hands, Legs, Feet, and Misc libraries group all 1,120 controls in those CC5/CC3+ categories exactly once, with manifest-count coverage for CC3 Female and Male. No empty group cards are shown. Numbered Misc controls are retained together when their names and shape-key metadata do not establish a reliable anatomical location; clearly named dental, eyeball, eye-orbit, tearline, body/pose, face/head, and base-shape controls receive matching groups. Search spans every group and category, labels results by their group, and opens the matching group when selected. Existing morph IDs, ranges, sliders, previews, favorites, related controls, and Basic/Advanced and All/Favorites/Recent behaviors remain unchanged. Tail has no manifest controls and displays no empty group.

## Test commands

```bash
cd starter/api && . .venv/bin/activate && pytest -q
cd starter/api && . .venv/bin/activate && pytest -q ../worker/blender/test_worker.py
cd starter/web && npm run build
cd starter/web && npm test
```

Use synthetic references in tests. Do not commit private user images or generated project output.
