# CoModel Studio CC5 Acquisition Scripts

The inventory scripts are read-only. Export scripts temporarily change only the requested shaping slider, restore its prior value, and write outputs under the user's Documents folder.

## Run in CC5

Run each script with CC5's Python/script runner, which provides the `RLPy` module. The scene inventory requires an avatar to be loaded; without one it reports an empty avatar list.

Outputs are written to `Documents/CoModelStudio/CC5Exports`:

- `cc5_scene_inventory.json` records loaded avatar names, mesh names, skeleton bone names, face expression names, per-mesh mesh morphs, and CC5 shaping slider IDs, display names, ranges, current weights, category paths, and available method signatures.
- `cc5_library_inventory.json` records files under the public Reallusion template/custom library roots, preserving paths relative to each root and summarizing extensions, categories, and file sizes.
- `cc5_export_library.py` offers an explicit-confirmation copy of all four library roots to a timestamped folder under `Documents/CoModelStudio/CC5Exports`. The current library is about 11.7 GB; check available space before approving the copy.
- `cc5_export_morph_pilot.py` offers a confirmation-gated export of the neutral avatar and the `Ear Scale Height` slider at its verified maximum. It requires the current character's shaping sliders to be neutral and restores the pilot slider after export.
- `cc5_export_morph_batch.py` exports each unique shaping slider endpoint in resumable chunks of 16. Keep `cc5_pack_morph_batch.py` beside it; Blender validates matching topology, packs compressed vertex deltas, and then the script deletes temporary FBXs.
- `cc5_pack_morph_batch.py` is the Blender-side chunk packer. It rejects mismatched mesh names, topology, or object transforms.
- `cc5_build_morph_asset.py` consumes the completed manifest/delta archives, creates shape keys on affected meshes, checks free space, saves a `.blend`, and exports a Meshopt-compressed GLB when supported.

The library inventory uses Python's standard library and can also be run with normal Python. The scene inventory and CC5 exporters require the embedded `RLPy` runtime. The batch exporter also requires Blender 5.2 or a compatible version; set `COMODEL_BLENDER_EXECUTABLE` if Blender is installed elsewhere.

## Full Morph Build

1. Load the neutral `CC3_Base_Plus` character in CC5 and ensure every shaping slider is at zero.
2. Load `cc5_export_morph_batch.py` from CC5's Python script menu and approve the batch. It writes a resumable manifest, one neutral FBX, and compressed delta archives under `Documents/CoModelStudio/CC5Exports/cc5_base_plus_morphs_v1`.
3. After the manifest reports `run_status: complete`, run the Blender consolidator:

```powershell
& "$env:ProgramFiles\Blender Foundation\Blender 5.2\blender.exe" --background --python "$env:USERPROFILE\Downloads\cc5_build_morph_asset.py" -- `
	--manifest "$env:USERPROFILE\Documents\CoModelStudio\CC5Exports\cc5_base_plus_morphs_v1\manifest.json" `
	--blend-output "$env:USERPROFILE\Documents\CoModelStudio\CC5Exports\cc5_base_plus_morphs_v1\build\CC5_Base_Plus_Morphs.blend" `
	--glb-output "$env:USERPROFILE\Documents\CoModelStudio\CC5Exports\cc5_base_plus_morphs_v1\build\CC5_Base_Plus_Morphs.glb" `
	--report-output "$env:USERPROFILE\Documents\CoModelStudio\CC5Exports\cc5_base_plus_morphs_v1\build\CC5_Base_Plus_Morphs_report.json"
```

The observed catalog contains 2,071 unique sliders and 2,167 non-neutral endpoints. Full export/consolidation can take hours and use substantial memory. The one-slider FBX/GLB path and an interrupted/resumed batch were tested; the full CC5 batch has not yet been run. Blender warns that influences beyond four are normalized/truncated during glTF export, so rig fidelity is not certified.

## Current Pipeline Boundary

The current CoModel Studio API/worker still accepts only CC3 asset IDs. This creates a separate CC5 asset family; browser/API integration and tests are still required before the new GLB can be selected in the app. The library report indexes installed files, and the optional exporter copies original files without converting proprietary formats or asserting redistribution rights. Keep exported content local unless its license permits sharing.
