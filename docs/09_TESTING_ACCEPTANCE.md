# Test Strategy and Acceptance Suite

## Required CC3 workflow

1. Without Blender, API health reports `blender_available: false`, and project creation, plan creation/approval, and draft morph persistence still work; no mock mode or geometry is created.
2. A fresh project starts without selecting a saved project or displaying a fallback model; Female remains the default, and the selected installed model persists through planning and reopen.
3. A deterministic plan remains awaiting approval. Approval alone neither invokes Blender nor creates a scene component.
4. Draft morph writes require a complete selected-manifest map, validate signed/one-sided ranges, advance `draft_revision`, preserve `scene_version`, reject stale revisions, and survive project reopen.
5. Draft eye, preset, and compatible skin selections persist without changing `scene_version` or invoking Blender; skin selection rejects models outside its manifest allowlist; standalone eye modeling operations return `DRAFT_PREVIEW_ONLY`. Verify retired hair asset/draft routes are absent and hair worker operations are rejected.
6. Final compile is rejected before approval, rejects an asset that differs from the project selection, and accepts only installed pinned assets. It receives the persisted draft morph map, presets, eye, skin, semantic skin definition, and paint strokes together in the initial worker import.
7. Female import verifies four meshes, 14,647 runtime body vertices, 313 body shape keys, a 101-bone rig, and all 137 manifest controls. When installed, also verify Male (four meshes, 14,647 runtime body vertices, 323 body shape keys, 101-bone rig, 143 controls) and CC5/CC3+ (six meshes and 2,042 controls).
8. Compiled morph edits accept complete maps with signed/one-sided ranges from the selected manifest; malformed, incomplete, out-of-range, wrong-asset, or out-of-scope requests are rejected.
9. CC3 browser slider previews remain local. When the integrity-checked local CC5/CC3+ proxy is installed, draft and compiled slider previews combine cached signed deltas without Blender requests; without the proxy, draft CC5/CC3+ sliders are clearly disabled rather than causing a Blender preview operation. Explicit post-compile saves update the Blender scene, component manifest, preview, and scene version.
9a. The CC5/CC3+ proxy build limits the nail and eyelash normal maps to 512 px in the browser-only proxy, records those generated dimensions in its integrity manifest, and leaves source-character textures, mesh topology, and morph-delta data unchanged.
10. The CC3+ Elven Ears preset is available only when all of its native morph controls are present, applies only its supported ear values while preserving unrelated draft morphs, previews through the local proxy, and does not start Blender.
11. All 27 extracted CC5/CC3+ body/head preset FBXs are covered by the pinned allowlist. Only presets with an available pinned source and generated proxy delta appear in the catalog. Selecting body and/or head presets previews and persists them in the draft without Blender; final compile applies both selections to `CC_Base_Body` and transfers each deformation to separate eye, occlusion, tearline, teeth, and tongue meshes. It records both preset IDs. Other character assets reject preset selection.
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
22. Morph undo/redo stores at most 50 value snapshots, groups each slider gesture into one step, clears redo history after a new edit, resets when switching projects, and updates only local morph values; uncompiled drafts autosave them, while compiled-scene changes remain behind the explicit morph-save action. Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, and Ctrl+Y perform available history actions outside editable controls without intercepting text or slider input.
23. The project Workflow section lists stored reference filenames and dimensions, states that images are not visually analyzed, and supports adding/removing references with visible progress and inline error feedback without implying reference-driven modeling.
24. With API available and Blender unavailable, the draft workflow remains available, compilation is clearly disabled with an explanation, and the message does not imply saved draft data is lost. API connection failures identify the API as the unavailable service; compile guidance identifies approval and save-state blockers.
25. Initial API health, saved-project, and character-catalog failures each offer an in-place retry; controls show retry progress, disable duplicate requests while loading, and do not mutate project state.
26. Eye and skin catalog failures provide category-specific retry actions and preserve existing draft selections while reloading asset metadata.
27. Morph-control catalog failures and empty responses for supported models show a clear error with a retry action; retries leave draft morph values and project selection unchanged.
28. Failed character, morph, and eye GLTF previews show a retry action; retry clears their cached failed loader entries and reloads the currently selected URLs without changing project data.

## Worker security and correctness

- Unknown and retired tools, extra arguments, arbitrary code, client paths, invalid assets, and stale scene versions are rejected.
- Component scope is checked before mutation and compared against scene changes afterward.
- Scope checks skip full vertex fingerprints only for the explicitly scoped component; changes to unrelated components remain rejected.
- Scene writes remain inside the project workspace and use atomic output promotion.
- Worker failures do not replace the last committed Blender scene.
- A CC5/CC3+ preview export uses an isolated temporary workspace and preserves the saved scene bytes, project morph map, and scene version.

## Browser checks

- Account registration validates usernames and password length; passwords are not stored in plaintext. Login issues an HttpOnly, SameSite session cookie, logout revokes it, and expired/invalid sessions do not expose project routes.
- Project lists and every project-scoped API route are private to the authenticated owner; another account gets no project summaries and receives the same 404 for an unknown or foreign project. Mutating project requests without the session CSRF token are rejected.
- Owner-initiated project deletion permanently removes project/checkpoint state, uploaded references, and the per-project Blender workspace. Deleted projects disappear from summaries; symlinked/out-of-root cleanup targets are rejected without following them, and cleanup errors leave the project record available for retry.
- Legacy projects are assigned to the first account after migration and are not visible to subsequently registered accounts.
- The application displays an empty workspace until an explicit project is created/opened. A draft can show the selected browser preview without an imported Blender component.
- Saved projects are never automatically selected on page load.
- All controls are rendered from the selected project's manifest metadata after import (137 Female; 143 Male).
- Loading, Blender/API errors, draft autosave errors, unsaved slider values, live-preview progress, and saved Blender preview state are distinguishable.
- CC5/CC3+ proxy mode validates the proxy and delta hashes, loads allowlisted controls on demand, replaces the previous signed delta correctly when sliders change or cross zero, applies slider changes without replacing the base geometry, and reports a clear error if proxy data is invalid.
- Component visibility controls affect preview only, not saved geometry.
- The Skin tab lists only locally installed hash-verified assets; the CC3+ Female card is disabled for incompatible models, previews its four diffuse/normal material regions without Blender, and is applied only during final compile.
- With the compatible skin selected, Paint and Erase pointer gestures update the four material-region previews without camera orbit or Blender; the brush indicator follows the 3D raycast surface hit and pen pressure affects stroke size and opacity. UV discontinuities start a new stroke rather than bridging unrelated texture regions. Each gesture persists as validated project draft strokes, survives reopen, and is included only in explicit final compile. Undo and Clear paint update the saved draft; missing point pressure defaults to full pressure, while invalid tools, regions, UVs, pressure, or brush values are rejected.
- Semantic tone, undertone, roughness, and seeded head-map freckle controls update the browser preview without invoking Blender, require an explicit save, persist across reopen with revision checks, and are included only in final compile. Freckle generation is deterministic across browser and worker for the same settings/seed and affects only the head diffuse map; cheek/nose localization is not claimed without verified masks. AI interpretation returns a validated explanation and preview without changing saved draft state; explicit Apply saves it. Unsupported values and malformed AI output fail without modifying the draft.

## Object Workshop masonry

- Selecting the Masonry preset and generating a wall or road creates independently named, selectable brick/paver components over a mortar or sand bed, with running/stack bond offsets, clipped perimeter units, bounded deterministic color/size variation, and persisted layout settings.
- Changing dimensions, unit dimensions, joint width/fill, or bond and regenerating updates the geometry; the generated assembly stays within the 350-piece cap and scene import validation rejects unsupported config, component dimensions, and oversized scenes.
- Moving an unlocked masonry component snaps in unit-grid increments; locking the assembly disables per-piece edits and lets Move drag the complete object; unlocking restores per-piece edits.
- Generated geometry survives browser autosave and editable JSON reload and appears in GLB exports. Masonry editing remains browser-only and does not start Blender.
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
