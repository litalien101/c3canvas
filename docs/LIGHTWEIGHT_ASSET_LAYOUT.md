# Lightweight Asset Layout

## Active directories

- `generated_assets/base_character/` contains optimized neutral browser GLBs.
- `generated_assets/presets/` is reserved for browser-ready preset GLBs.
- `generated_assets/eyes/` contains compact eye-only GLBs with eye surface, occlusion, tearline, and their materials; unrelated character meshes and default scene objects are excluded.
- `catalogs/` contains small startup catalogs. The browser should load one catalog entry at a time.

## Source archive

- `source_archive/presets/` contains original Character Creator preset FBXs.
- `source_archive/eyes/` contains original eye FBXs and texture packages.
- `source_archive/py_extract/` contains extraction captures, batch work, manifests, and ZIP archives.

Source archives are local provenance/conversion inputs, not browser assets; do not serve or reference them from the web player. The repository ignore rules exclude the root source archive and local backup directories to avoid accidentally including owner-supplied assets or historical copies.

## Loading contract

1. Load only the neutral/base character browser preview when editing starts; do not import it into Blender.
2. Load a small catalog to present choices.
3. Load only the selected preset or eye preview in the browser and persist the selection in draft data.
4. Use generated GLBs for browser previews; the final compile loads the selected assets into Blender together with the base.
5. Use source FBXs only for provenance, conversion, and regeneration.

**Draft/compile invariant:** no model geometry is imported into Blender while editing. The only Blender import is the explicit final save/export compile of the saved project choices.

## Drift prevention

Every asset listed in `starter/shared/cc5_body_presets.json` and `starter/shared/eye_assets.json` must have an existing source file. Catalog entries under `catalogs/` mirror those manifests. Run the asset integrity checks before deployment or after moving files.