# Blender Worker

`worker_entry.py` is the legacy-compatible allowlisted Blender entry point for the CC3/CC5 character morph workflow. Transaction-aware API calls use `worker_entry_staged.py`, which forces staged-only execution and requires transaction and attempt UUIDs plus supported API/worker contract versions in the validated job. The staged worker reads a scene copied into its unique attempt workspace and writes `scene_candidate.blend`, `preview_candidate.glb`, and a result report there; it does not replace project `scene.blend` or `preview.glb`. Its result report includes both contract versions. Only the API validates and promotes those candidates after backup and hash checks. The legacy entry remains for older API processes and isolated temporary preview workspaces; deploy the staged API and worker together.

The API validates and authorizes requests, creates bounded job files, and owns project access; the worker imports pinned assets, applies complete validated morph-control maps (including the saved draft map during final compile), restores checkpoints, and validates scene structure. It never executes model-generated code or accepts client-provided filesystem paths.

Configure `COMODEL_BLENDER_EXECUTABLE` for the API process. In staged mode all worker outputs remain under the attempt workspace; on failure the worker writes `output/worker-error.json`. The API validates report identity, candidate paths, file types, sizes, and hashes before project promotion.

**Draft/compile invariant:** Blender is not used for browser editing or previews. Project creation, plan approval, and saving draft morph/appearance choices are handled by the API and SQLite without starting the worker. Only explicit final save/export starts the worker; its single import job receives the pinned base, complete validated morph map, selected preset, optional eye asset, and compatible skin asset before the first scene and preview are written.

## Supported character assets

The worker loads only fixed asset paths whose SHA-256 digest and scene structure are defined by the matching shared manifest:

- `character_cc3_morphs_v1`: `assets/CC3_Base_Female_Morphs.glb`, 4 meshes, 14,647 body vertices, 313 body shape keys, a 101-bone rig, and 137 controls backed by 244 directional exports. Its manifest is `starter/shared/cc3_morph_manifest.json`.
- `character_cc3_male_morphs_v1`: `assets/CC3_Base_Male_Morphs.glb`, 4 meshes, 14,647 runtime body vertices (13,286 in the source FBX), 323 body shape keys, a 101-bone rig, and 143 controls backed by 254 exports. Its manifest is `starter/shared/cc3_male_morph_manifest.json`.
- `character_cc5_rlcc3plus_all_morphs_v1`: `assets/RL_CC3_Plus_Base_all_morphs.blend`, 6 meshes, 56,412 body vertices, 6,214 shape keys including Basis, a 101-bone rig, and 2,042 signed controls. Its manifest is `starter/shared/cc5_rlcc3plus_manifest.json`; `assets/CC5_RL_CC3_Plus_Base_preview.glb` is the integrity-pinned static browser preview.

Viewport previews omit shape-key targets when the installed Blender exporter supports it and use `EXT_meshopt_compression` when available. This keeps the browser preview fast while the authoritative `.blend` retains every editable shape key. CC3 controls preview locally. For CC5/CC3+, the optional local proxy build keeps the 2,042 controls responsive in the browser with a native-topology GLB and per-control sparse signed deltas. Its geometry uses lossless `EXT_meshopt_compression` (run `node optimize_cc5_morph_proxy.mjs` for an already-installed uncompressed proxy); the local proxy is about 5.2 MB after compression and preview-texture reduction, down from 7.7 MB. Neither optimization changes vertex indices or morph deltas. The proxy builder caps the nail and eyelash normal maps at 512 px to reduce startup transfer size; the full-resolution source character is unchanged. The browser loads changed controls on demand and applies only their value changes to the current proxy geometry; normals are refreshed only around affected vertices. Deltas use the same object normalization and Blender-to-glTF coordinate conversion as the exported proxy positions. No full geometry snapshot is stored for each control. The proxy is not subdivided so its vertices map exactly to the editable source topology; source textures and rig remain in the GLB. The proxy is enabled only when its generated manifest and both artifacts pass integrity checks. Without it, pre-compile draft sliders are disabled; after compile, `preview_cc3_morph_controls` applies the complete map across six tagged meshes in an isolated temporary workspace and returns the debounced server preview. Explicit post-compile saves apply values to the authoritative Blender scene. The owner confirms rights to provide the CC3+ character with this application; review any third-party attribution or redistribution terms before release.

The shared `cc5_body_presets.json` allowlist contains 27 body and head presets sourced from `source_archive/presets/`; they are available only for the CC5/CC3+ asset. Each pinned FBX must match its manifest hash and the topology of `CC_Base_Body`. The proxy builder packages a sparse delta for every preset alongside the control deltas, and the API exposes only presets whose source and generated delta are available and integrity-checked. The browser previews and persists the selected delta locally. Final compile creates a reversible shape key on `CC_Base_Body` and transfers its surface displacement onto separate `CC_Base_Eye`, `CC_Base_EyeOcclusion`, `CC_Base_TearLine`, `CC_Base_Teeth`, and `CC_Base_Tongue` meshes by nearest-surface interpolation. `CC_Base_Body` includes the head/face surface as well as the torso and limbs, so each source preset deforms the head/face too.

The local skin-card allowlist is `starter/shared/skin_assets.json`. To prepare the supplied CC3+ FBX, run `blender --background --factory-startup --python prepare_skin_asset.py -- --source /absolute/path/to/female_skin_full_body_1.Fbx` from `starter/worker/blender`. The preparation script keeps the full-resolution diffuse and normal PNGs packed into an allowlisted `.blend` library and creates separate 1024px-or-smaller WebP diffuse previews, lossless PNG normal previews, and a 256px card image. It sets normal-map strength to 0.35 to soften exaggerated creases in both browser preview and final compile. The API serves only integrity-pinned previews; the worker independently verifies the full-resolution maps and library, applies them to the matching `Std_Skin_{Head,Body,Arm,Leg}` body slots, and rejects skins on incompatible models. Keep the FBX and generated outputs local unless redistribution rights are confirmed.

Hair support is limited to the separately allowlisted `create_hair_scalp` and `generate_hair_guides` operations. The worker imports the owner-reviewed Copilot Hair Tutor 0.1.8 package only after verifying its deployment-controlled file inventory and tree hash; its independent source provenance remains explicitly unverified. It never calls the package's `register()` or `unregister()` functions. Scalp and Curves objects are resolved and recorded by stable CoModel component/object IDs, not Blender names. A scalp and a guide component can each be created only once per parent component; matching operation-ID retries are handled by the API transaction layer. Guide generation creates editable, native Hair Curves hidden from rendering. It does not create visible/exportable strands, apply the package's scalp mask, or refit hair after morph edits.

Scoped operations avoid serializing the edited component's full vertex data for before/after scope checks. Unrelated components still receive complete fingerprints and any out-of-scope change fails validation.

CC5/CC3+ preview export applies level-1 Catmull-Clark subdivision to temporary `CC_Base_Body` meshes and level-2 subdivision to `CC_Base_EyeOcclusion` and `CC_Base_TearLine`. The editable source geometry and its morphs remain unchanged.

The supplied CC5/CC3+ project has every manifest-controlled directional shape key active at value `1`. Import verifies those active keys match the manifest, resets them to `0`, and records a neutral 2,042-control state before producing the browser preview. Unmapped active shape keys fail import rather than being silently preserved.

Build the optional local proxy after installing the pinned CC5/CC3+ source asset:

```bash
cd starter/worker/blender
blender --background --factory-startup --disable-autoexec \
  --python build_cc5_morph_proxy.py
```

The script writes the GLB, compressed delta archive, and a source-hash-bound build manifest under `assets/`. It refuses symbolic-link outputs and promotes generated files only after successful creation. Do not commit the generated owner-supplied assets.

Projects with older morph-heavy previews are migrated on their next preview request by exporting a lightweight preview from the saved `.blend`; this does not change the scene version or shape keys. If the installed Blender exporter cannot omit morph targets, the API records that capability fallback and avoids repeating the export on subsequent requests.

The Male GLB is built from owner-supplied FBXs and is intended for local use only until redistribution rights are confirmed. Blender's glTF export also normalizes vertex influences beyond four and uses the first shader image node per texture; material and rig fidelity are not certified.

`apply_cc3_morph_controls` requires the matching asset ID and a complete map of that asset's supported control IDs, validates each value against the manifest range, scopes changes to the body component, and records the values on the scene. For CC5/CC3+, baking removes shape keys from all six component meshes. Checkpoints are created before destructive edits and can be restored.

## Job safety

Only `import_base_model`, `create_hair_scalp`, `generate_hair_guides`, `apply_cc3_morph_controls`, `apply_cc3_body_preset`, `preview_cc3_morph_controls`, `bake_cc3_morph_controls`, `restore_checkpoint`, and `validate_scene_structure` are accepted by worker contract `worker-staged-v2`. Jobs require UUID job/project/operation IDs, a nonnegative expected scene version, and declared component scope/dependencies. Extra fields, removed legacy operations, arbitrary code, unknown assets, stale versions, cross-project scene reuse, and out-of-scope object changes are rejected.

The local subprocess is bounded but is not a production security sandbox. Do not expose a worker socket publicly or provide it with untrusted job files.

## Tests

```bash
cd starter/api
. .venv/bin/activate
pytest -q ../worker/blender/test_worker.py
```

The Blender integration tests verify the Female asset and all 137 controls; when optional assets are installed, they also verify the Male model and the CC5/CC3+ complete manifest, multi-mesh morph application, preview refresh, body-preset application/removal, and bake behavior.
