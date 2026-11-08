# Character Morph Asset Blueprint

The supported character assets are the pinned CC3 Female and Male GLBs and the owner-supplied CC5/CC3+ full-morph Blender project. The CC3 Female remains the backward-compatible default. Each installed model appears only when its shared manifest and pinned preview asset pass integrity checks.

## CC3 Female asset

- Asset ID: `character_cc3_morphs_v1`
- Runtime file: `starter/worker/blender/assets/CC3_Base_Female_Morphs.glb`
- Manifest: `starter/shared/cc3_morph_manifest.json`
- Morph controls: 137 controls backed by 244 directional shape-key exports

## CC3 Male asset

- Asset ID: `character_cc3_male_morphs_v1`
- Runtime file: `starter/worker/blender/assets/CC3_Base_Male_Morphs.glb`
- Manifest: `starter/shared/cc3_male_morph_manifest.json`
- Morph controls: 143 controls backed by 254 directional exports
- Body: 14,647 runtime GLB vertices (13,286 in the source FBX), 323 shape keys, and a 101-bone rig

The Male asset was consolidated from the user's local FBX collection. Its source license was not provided, so it remains local-use-only until redistribution rights are confirmed. Blender's glTF export reports that vertex influences beyond four are truncated/normalized and that only the first shader image node per texture is used; fidelity is not certified.

## CC5/CC3+ full-morph asset

- Asset ID: `character_cc5_rlcc3plus_all_morphs_v1`
- Name in the model picker: **RL CC3+ Full Morphs**
- Authoritative runtime file: `starter/worker/blender/assets/RL_CC3_Plus_Base_all_morphs.blend`
- Lightweight static browser preview: `starter/worker/blender/assets/CC5_RL_CC3_Plus_Base_preview.glb`
- Shared manifest: `starter/shared/cc5_rlcc3plus_manifest.json`
- Morph controls: **2,042**, each with positive and negative shape-key endpoints in the range -1 to 1
- Source build: 5,574 shape-key operations across six meshes
- Meshes: `CC_Base_Body`, `CC_Base_Eye`, `CC_Base_EyeOcclusion`, `CC_Base_TearLine`, `CC_Base_Teeth`, and `CC_Base_Tongue`
- Body: 56,412 vertices and 4,434 shape keys, including Basis
- All six meshes: 71,583 vertices and 6,214 shape keys, including each mesh's Basis key
- Rig: `CC3_Base_Plus`, 101 bones
- Materials: 17 named materials; the source Blender project is authoritative for the complete editable material setup

The supplied `.blend` has all 5,574 manifest-controlled directional shape-key instances active at value `1`. On import, the worker verifies those are exactly the mapped controls, resets them to `0`, and saves a neutral starting character; any active unmapped key blocks import. The static browser preview is generated from that neutral state.

The verified merged source is approximately 976 MiB; the static preview is approximately 6.7 MiB and contains no morph targets. The API and Blender worker validate the source `.blend` hash, preview hash, mesh names/counts, shape-key counts, rig, materials, and complete morph manifest. An optional local build adds a browser proxy and lazy sparse signed deltas for responsive slider previews. The proxy uses source topology (no subdivision) so cached deltas map directly to source vertices; Blender remains authoritative, and slider changes are applied to all affected meshes when the user selects **Save changes to Blender**. Baking applies the selected shape to all six meshes and removes their shape keys; the pre-bake checkpoint can restore them.

The full source is owner-supplied. The owner confirms rights to provide the CC3+ character with this application (2026-11-07); underlying third-party attribution or redistribution terms have not been independently documented and must be checked before release. The static GLB is for viewport performance, not a replacement for the editable source. Blender's glTF exporter reports that influences beyond four are normalized to the highest four; material, texture, and rig visual fidelity still require manual review.

## Browser and persistence behavior

The selected asset ID is stored in SQLite. Import still requires explicit approval of the project plan, and morph edits are scoped to that model's body component. The component manifest records source hashes, morph specifications, values, object IDs, and scene version.

CC3 Female/Male controls continue to preview locally in the browser. When the verified CC5/CC3+ proxy is installed, the browser loads sparse deltas only for active controls and combines them on the high-detail proxy; otherwise, it uses the debounced server preview. It never loads thousands of morph targets. The **All categories** filter and search expose both `Actor` and `Actor Parts` controls.

A fresh workspace shows the welcome screen and does not load a character preview or automatically open a saved project. After an explicit create/open action, the GLB is only the browser preview; the Blender scene remains authoritative.

## Validation and limitations

Automated checks verify pinned asset hashes, asset-specific mesh names/counts, body and component shape-key counts, armature and bone count, material names, manifest agreement, complete control sets, valid ranges, scene versioning, and checkpoint restoration. The CC5/CC3+ worker test checks a shared Body/Tongue morph key, static preview refresh, and baking across all six meshes; API tests verify proxy integrity and allowlisted delta access. These checks do not certify anatomical quality, combined-slider interactions, full material fidelity, UV quality, or suitability for production.

The model is not a general-purpose character-generation system: it does not generate new anatomy, garments, hair, or accessories from reference images. Existing CC3 workflows and the Female default remain unchanged.
