# Build Roadmap

The product currently supports one deliberate vertical slice: a welcome screen with explicit project create/open actions, followed by a persisted browser draft, live browser previews for supported edits, plan approval, and an explicit final save/compile of the complete draft in Blender. The character viewport and preview load only after the user creates or opens a project. Draft editing does not import geometry or start Blender; after compilation, only explicit supported scene operations may invoke the worker. Do not reintroduce assemble-first eyes, simulated geometry, or unpinned base-model imports.

## Current supported slice

- React + TypeScript welcome screen with new-character setup and saved-project reopening; no project is created or automatically selected at startup.
- The editor and integrity-pinned character preview mount only after an explicit project create/open action.
- Dark-slate fixed editor workspace with blue active states, New/Open Project header actions, and a viewport AI Assistant launcher. The startup right editor shows manifest-backed body morph controls, not base-model cards.
- SQLite projects, saved plans, reference-image records, component manifests, operations, and checkpoints.
- Lightweight draft creation, deterministic model-specific plans, complete manifest-backed morph autosave with optimistic draft revisions, and plan approval do not require Blender.
- Approval is a real gate but does not start Blender. The user explicitly saves/compiles the persisted draft only when ready.
- Asset-specific pinned character import in the local Blender worker. Female remains the backward-compatible default; Male and CC5/CC3+ appear only when their matching manifests and integrity-checked local assets are installed.
- New character setup offers **Basic** (CC3 Female, preselected) and **Advanced** (CC3+ Female) as plain-language workflows. Both share the same project flow; Advanced exposes more shaping controls and can require more system resources. The CC3 Male remains an additional installed model option.
- Final compile passes the saved draft morph map, preset, and selected eye to the worker in one operation before the first scene and preview are committed.
- Browser-local preview for CC3 manifest-defined morph sliders and, when its verified local proxy is installed, CC5/CC3+ sliders using lazily cached sparse deltas. CC5/CC3+ uses the same proxy topology for its base and edited previews to avoid a visible topology swap when a slider changes. Without the proxy, CC5/CC3+ draft sliders remain disabled and assembled projects use the debounced server-preview fallback. Explicit save applies values to Blender after project assembly. Reset restores the last saved values. Baking freezes the combined slider shape into the body mesh, removes editable morph keys, and keeps a pre-bake checkpoint available for restoration.
- CC5/CC3+ only: the Presets category offers up to 27 integrity-pinned body/head presets from `source_archive/presets/` when each source and generated browser delta is available. Cards preview and persist the selected draft preset in the browser/API; final compile applies it as a dedicated `CC_Base_Body` shape key plus transferred keys on the five separate character meshes.
- CC5/CC3+ only: the Ears category offers an **Elven Ears** starter preset composed of verified native pointed-ear, height, and angle morphs. It changes only the draft morph map, previews through the existing verified proxy, and compiles with the saved morphs; it is a native morph blend, not a custom ear sculpt.
- The Eyes category offers 14 integrity-pinned eye-only GLBs. Selecting an eye loads only that eye's browser preview, preserving the eye surface, occlusion, tearline, and materials; it hides only default eye meshes in the base preview. The choice persists in the draft and is imported only during final compile. With the CC5/CC3+ proxy, a replacement overlay is brought to the active preset/morph pose before its crossfade. Proxy-meter deltas are converted to the eye asset's centimeter-like local units before the overlay's 0.01 scale is applied.
- The Skin category offers only locally installed, integrity-pinned skin packages compatible with the selected character. The CC3+ Female card uses reduced WebP diffuse and lossless PNG normal previews (1024px maximum, 256px card image) for the head, body, arms, and legs in the browser draft; the normal-map strength is limited to 0.35 in both preview and compiled Blender materials. In the draft viewport, users can paint or erase on those four UV-mapped regions with adjustable color, brush size, and opacity. Each pointer gesture is previewed locally and saved as a bounded UV stroke list; undo removes the last stroke and Clear paint resets the list. Paint and erase edits persist with the selected skin and are applied to the full-resolution, hash-verified materials only during explicit final compile. Skin selection, painting, and approval never start Blender. Browser preview maps use the same vertical orientation and UV transforms as the GLTF material maps. The source FBX and generated local maps/material library remain outside the browser bundle and are not committed.
- The selected skin also exposes versioned draft controls for base tone, undertone, and surface roughness with live browser material preview. Users explicitly save manual edits; Copilot interpretation returns an explainable proposal that must be explicitly applied. Saved values are applied to the pinned Blender materials only during final compile. Regional effects, freckles, wrinkles, subsurface controls, and generated textures remain unsupported.
- The lightweight model catalog includes pinned hashes and morph-control counts. Fetch model preview geometry and manifest controls only for an explicitly selected project model. Load the larger browser-morph asset only when a slider is adjusted. Project GLB previews omit morph targets and use Meshopt compression where supported by Blender.
- Human approval in the Scene workflow inspector is required before final compile of the selected model in Blender; approval itself does not import or mutate geometry.
- Unified dark-slate and blue-accent character-editor layout with a 65px header, 109px labeled navigation, central viewport, fixed responsive right inspector, and direct orbit/pan/zoom gestures; Models, Scene Hierarchy, Properties, and Workflow are not dockable.
- Scoped typed API and worker operations; no arbitrary model-generated code.
- Reversible changes, GLB preview refresh, and component visibility controls.
- Context-aware chat responses can propose allowlisted draft morph/appearance changes for explicit user application and show dismissible guidance beside registered controls. Chat remains text/proposal-only and never starts Blender or bypasses approval/compile gates.

## Next slices

### 1. Harden the CC3 modeling workflow

- API and worker tests cover Female and installed Male manifests, signed and one-sided morph values, scoped saves, scene-version checks, exact-request retries, and checkpoint restoration.
- Verify loading and error states in the browser against the local API.
- Keep reference images stored and clearly mark them unanalyzed until a real image-understanding provider exists.

### 2. Improve product reliability

- Add authenticated project ownership and project-scoped authorization.
- Add explicit project deletion and retention for scenes, reference uploads, and checkpoints.
- Add worker resource limits, deployment isolation, monitoring, and recovery procedures.

### 3. Expand modeling only behind measurable gates

- Evaluate the quality and licensing of a next geometry operation before adding it.
- Keep each editable component identity stable and preserve unrelated components during scoped edits.
- Require tests, documentation, a visible status, and explicit human approval for each new phase.
- Do not claim production anatomical quality, UVs, retopology, garment simulation, or animation until verified.

## Retired workflows

The static OBJ preview, CC5 FBX import, mock body/garment placeholders, garment revisions, legacy eyelid/ear sculpt tools, and automatic project restoration are removed. Their source assets and public operations are not part of the active product.

## Definition of done for a slice

- Acceptance behavior is implemented with explicit errors and loading states.
- API schemas and worker allowlists agree.
- Focused tests cover behavior, scope, approvals, and failure paths.
- User-facing documentation matches what the product actually does.
- The browser build, API tests, and Blender worker tests pass.
