# CC3 Slider Conversion

`cc3_slider_to_shape_key.py` converts one CC3 slider deformation into a Blender shape key and GLB morph target. `cc3_build_morph_asset.py` consolidates the exported slider FBXs into the rigged CC3 base asset using `starter/shared/cc3_morph_manifest.json`.

## Prepare the exports

In Character Creator 3, export the same CC3 character twice with identical FBX settings:

1. Export the neutral character.
2. Apply one slider at its full value and export the modified character.

The target mesh must have the same object name, vertex count, polygon order, vertex order, and object transform in both exports. The script refuses mismatches instead of guessing correspondence. The default mesh name is `CC_Base_Body`.

The `.ccSlider` binary itself is not parsed. Character Creator must apply the slider and create the modified FBX export.

## Convert

Run with Blender 5.2 or compatible:

```powershell
blender --background --python cc3_slider_to_shape_key.py -- `
  --neutral neutral.fbx `
  --modified ear-length.fbx `
  --shape-key CC3_Ear_Length `
  --blend-output character.blend `
  --glb-output character.glb `
  --report-output conversion-report.json
```

The neutral FBX supplies the preserved scene, rig, and existing shape keys. The modified FBX supplies only the target vertex positions; its imported objects are removed after the shape key is created. The report records vertex and polygon counts, changed vertex count, and maximum displacement.

## Build all exported controls

The batch builder expects the FBXs arranged by direction in `exports/positive` and `exports/negative`, using the filenames recorded in the manifest. Each modified FBX must be exported from the same neutral character. The builder validates the pinned base GLB, manifest counts, export set, body topology and transform, and neutral-to-base vertex correspondence before writing any shape key.

```powershell
blender --background --python cc3_build_morph_asset.py -- `
  --neutral "CC3_Base Female.Fbx" `
  --base-glb "CC3_Base_Female_Morphs.glb" `
  --exports-root "exports" `
  --manifest "starter/shared/cc3_morph_manifest.json" `
  --blend-output "build/cc3_morph_checkpoint.blend" `
  --glb-output "build/CC3_Base_Female_Morphs.glb" `
  --report-output "build/cc3_morph_report.json"
```

The manifest describes 244 exported directions across 137 controls. The completed body is expected to contain 313 shape keys, including the 85 original keys. Checkpoints are saved every ten exports by default; `--resume` continues only when the checkpoint's base-asset and manifest hashes match. Keep the source FBXs and neutral export until the report and final asset have been validated; they are not needed by the running application after the consolidated GLB is installed.

## Validation

The single-slider converter has been smoke-tested with Blender 5.2.2 using a synthetic pair of topology-matched FBX meshes. A real `ear_length` positive/negative pilot was also mapped onto the rigged base GLB, preserving its 101-bone rig and 85-key count. The full export set still requires a complete batch build and final asset validation.