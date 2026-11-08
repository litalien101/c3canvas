import importlib.util
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import uuid
import zipfile

import pytest


WORKER_ENTRY = Path(__file__).with_name("worker_entry.py")
BLENDER_EXECUTABLE = os.getenv("BLENDER_EXECUTABLE", shutil.which("blender") or "")
WORKER_SPEC = importlib.util.spec_from_file_location("comodel_blender_worker", WORKER_ENTRY)
WORKER_MODULE = importlib.util.module_from_spec(WORKER_SPEC)
WORKER_SPEC.loader.exec_module(WORKER_MODULE)


def create_job(
    workspace: Path,
    *,
    operation: str,
    expected_scene_version: int,
    arguments: dict,
    scope_component_ids: list[str] | None = None,
    dependency_component_ids: list[str] | None = None,
) -> Path:
    job = {
        "job_id": str(uuid.uuid4()),
        "project_id": "1952985a-1503-4427-8861-9cedc54c3f5b",
        "operation_id": str(uuid.uuid4()),
        "expected_scene_version": expected_scene_version,
        "operation": operation,
        "scope_component_ids": scope_component_ids or [],
        "dependency_component_ids": dependency_component_ids or [],
        "arguments": arguments,
    }
    job_path = workspace / f"{job['operation_id']}.json"
    job_path.write_text(json.dumps(job), encoding="utf-8")
    return job_path


def run_worker(job_path: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            BLENDER_EXECUTABLE,
            "--background",
            "--factory-startup",
            "--disable-autoexec",
            "--python",
            str(WORKER_ENTRY),
            "--",
            "--job",
            str(job_path),
        ],
        capture_output=True,
        text=True,
        timeout=600,
        check=False,
    )


def read_glb_json(glb_path: Path) -> dict:
    data = glb_path.read_bytes()
    magic, version, total_length = struct.unpack_from("<4sII", data, 0)
    chunk_length, chunk_type = struct.unpack_from("<II", data, 12)
    assert magic == b"glTF"
    assert version == 2
    assert total_length == len(data)
    assert chunk_type == 0x4E4F534A
    return json.loads(data[20:20 + chunk_length].decode("utf-8").rstrip("\x00 "))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def test_worker_job_schema_accepts_only_cc3_operations(tmp_path):
    valid_import = create_job(
        tmp_path,
        operation="import_base_model",
        expected_scene_version=0,
        arguments={"component_id": str(uuid.uuid4()), "asset_id": "character_cc3_morphs_v1"},
    )
    assert WORKER_MODULE.load_job(valid_import)["arguments"]["asset_id"] == "character_cc3_morphs_v1"
    skin_asset_id = next(iter(WORKER_MODULE.SKIN_ASSETS), None)
    if skin_asset_id:
        valid_skin_import = create_job(
            tmp_path,
            operation="import_base_model",
            expected_scene_version=0,
            arguments={
                "component_id": str(uuid.uuid4()),
                "asset_id": "character_cc5_rlcc3plus_all_morphs_v1",
                "skin_asset_id": skin_asset_id,
            },
        )
        assert WORKER_MODULE.load_job(valid_skin_import)["arguments"]["skin_asset_id"] == skin_asset_id
        incompatible_skin_import = create_job(
            tmp_path,
            operation="import_base_model",
            expected_scene_version=0,
            arguments={
                "component_id": str(uuid.uuid4()),
                "asset_id": "character_cc3_morphs_v1",
                "skin_asset_id": skin_asset_id,
            },
        )
        with pytest.raises(ValueError, match="installed compatible skin"):
            WORKER_MODULE.load_job(incompatible_skin_import)
    initial_morphs = {control_id: 0.0 for control_id in WORKER_MODULE.CC3_MORPH_CONTROLS}
    initial_morphs["ear_length"] = 0.25
    valid_import_with_morphs = create_job(
        tmp_path,
        operation="import_base_model",
        expected_scene_version=0,
        arguments={
            "component_id": str(uuid.uuid4()),
            "asset_id": "character_cc3_morphs_v1",
            "morphs": initial_morphs,
        },
    )
    assert WORKER_MODULE.load_job(valid_import_with_morphs)["arguments"]["morphs"] == initial_morphs
    if "character_cc5_rlcc3plus_all_morphs_v1" in WORKER_MODULE.CC3_ASSET:
        cc5_asset_id = "character_cc5_rlcc3plus_all_morphs_v1"
        cc5_morphs = {
            control_id: 0.0
            for control_id in WORKER_MODULE.CC3_MORPH_CONTROLS_BY_ASSET[cc5_asset_id]
        }
        preset_component_id = str(uuid.uuid4())
        valid_preset = create_job(
            tmp_path,
            operation="apply_cc3_body_preset",
            expected_scene_version=1,
            arguments={
                "component_id": preset_component_id,
                "asset_id": cc5_asset_id,
                "morphs": cc5_morphs,
                "preset_id": "female_neutral_head_preset_9",
            },
            scope_component_ids=[preset_component_id],
        )
        assert WORKER_MODULE.load_job(valid_preset)["operation"] == "apply_cc3_body_preset"
        for preset_id in WORKER_MODULE.CC5_BODY_PRESETS:
            allowlisted_preset = create_job(
                tmp_path,
                operation="apply_cc3_body_preset",
                expected_scene_version=1,
                arguments={
                    "component_id": preset_component_id,
                    "asset_id": cc5_asset_id,
                    "morphs": cc5_morphs,
                    "preset_id": preset_id,
                },
                scope_component_ids=[preset_component_id],
            )
            assert WORKER_MODULE.load_job(allowlisted_preset)["arguments"]["preset_id"] == preset_id
    invalid_import_morphs = create_job(
        tmp_path,
        operation="import_base_model",
        expected_scene_version=0,
        arguments={
            "component_id": str(uuid.uuid4()),
            "asset_id": "character_cc3_morphs_v1",
            "morphs": {"ear_length": 0.25},
        },
    )
    with pytest.raises(ValueError, match="every supported CC3 control"):
        WORKER_MODULE.load_job(invalid_import_morphs)
    valid_bake = create_job(
        tmp_path,
        operation="bake_cc3_morph_controls",
        expected_scene_version=1,
        arguments={
            "component_id": str(uuid.uuid4()),
            "asset_id": "character_cc3_morphs_v1",
            "morphs": {control_id: 0.0 for control_id in WORKER_MODULE.CC3_MORPH_CONTROLS},
        },
        scope_component_ids=[str(uuid.uuid4())],
    )
    with pytest.raises(ValueError, match="scope only their body component"):
        WORKER_MODULE.load_job(valid_bake)
    bake_component_id = str(uuid.uuid4())
    valid_bake = create_job(
        tmp_path,
        operation="bake_cc3_morph_controls",
        expected_scene_version=1,
        arguments={
            "component_id": bake_component_id,
            "asset_id": "character_cc3_morphs_v1",
            "morphs": {
                **{control_id: 0.0 for control_id in WORKER_MODULE.CC3_MORPH_CONTROLS},
                "ear_length": 0.25,
            },
        },
        scope_component_ids=[bake_component_id],
    )
    assert WORKER_MODULE.load_job(valid_bake)["operation"] == "bake_cc3_morph_controls"


    preview_component_id = str(uuid.uuid4())
    valid_preview = create_job(
        tmp_path,
        operation="preview_cc3_morph_controls",
        expected_scene_version=1,
        arguments={
            "component_id": preview_component_id,
            "asset_id": "character_cc3_morphs_v1",
            "morphs": {control_id: 0.0 for control_id in WORKER_MODULE.CC3_MORPH_CONTROLS},
        },
        scope_component_ids=[preview_component_id],
    )
    assert WORKER_MODULE.load_job(valid_preview)["operation"] == "preview_cc3_morph_controls"
    neutral_bake = create_job(
        tmp_path,
        operation="bake_cc3_morph_controls",
        expected_scene_version=1,
        arguments={
            "component_id": bake_component_id,
            "asset_id": "character_cc3_morphs_v1",
            "morphs": {control_id: 0.0 for control_id in WORKER_MODULE.CC3_MORPH_CONTROLS},
        },
        scope_component_ids=[bake_component_id],
    )
    with pytest.raises(ValueError, match="non-neutral morph value"):
        WORKER_MODULE.load_job(neutral_bake)
    if "character_cc3_male_morphs_v1" in WORKER_MODULE.CC3_ASSET:
        valid_male_import = create_job(
            tmp_path,
            operation="import_base_model",
            expected_scene_version=0,
            arguments={
                "component_id": str(uuid.uuid4()),
                "asset_id": "character_cc3_male_morphs_v1",
            },
        )
        assert WORKER_MODULE.load_job(valid_male_import)["arguments"]["asset_id"] == "character_cc3_male_morphs_v1"

    for operation, arguments in (
        ("attach_eye_asset", {"component_id": str(uuid.uuid4()), "asset_id": "eye-normal-1"}),
        ("create_body_blockout", {"component_id": str(uuid.uuid4())}),
        ("create_garment", {"component_id": str(uuid.uuid4()), "fit_target_component_id": str(uuid.uuid4())}),
        ("apply_eyelid_pose", {"component_id": str(uuid.uuid4()), "poses": {}}),
        ("sculpt_character_ears", {"component_id": str(uuid.uuid4()), "strokes": []}),
        ("execute_python", {"code": "import os"}),
    ):
        legacy_job = create_job(
            tmp_path,
            operation=operation,
            expected_scene_version=0,
            arguments=arguments,
        )
        with pytest.raises(ValueError, match="not allowlisted"):
            WORKER_MODULE.load_job(legacy_job)

    for asset_id in ("base_model_v1", "character_cc5_v1", "../../outside.glb"):
        retired_asset = create_job(
            tmp_path,
            operation="import_base_model",
            expected_scene_version=0,
            arguments={"component_id": str(uuid.uuid4()), "asset_id": asset_id},
        )
        with pytest.raises(ValueError, match="allowlisted source asset"):
            WORKER_MODULE.load_job(retired_asset)

    linked_job = tmp_path / "linked-job.json"
    linked_job.symlink_to(valid_import)
    with pytest.raises(ValueError, match="symbolic link"):
        WORKER_MODULE.load_job(linked_job)


def test_base_compile_imports_selected_quality_eye_geometry(tmp_path):
    if not BLENDER_EXECUTABLE:
        pytest.skip("Blender is unavailable")

    body_component_id = str(uuid.uuid4())
    eye_component_id = str(uuid.uuid4())
    job = create_job(
        tmp_path,
        operation="import_base_model",
        expected_scene_version=0,
        arguments={
            "component_id": body_component_id,
            "asset_id": "character_cc3_morphs_v1",
            "eye_attachment": {
                "asset_id": "eye-normal-1",
                "component_id": eye_component_id,
            },
        },
    )
    completed = run_worker(job)
    assert completed.returncode == 0, completed.stderr

    output_dir = tmp_path / "output"
    result = json.loads((output_dir / "result.json").read_text(encoding="utf-8"))
    eye_result = result["result"]["eye_attachment"]
    assert len(eye_result["object_ids"]) == 3
    assert eye_result["generated_sha256"] == WORKER_MODULE.EYE_ASSETS["eye-normal-1"]["generated_sha256"]

    preview = read_glb_json(output_dir / "preview.glb")
    node_names = {node.get("name") for node in preview["nodes"]}
    assert any("Eye" in name for name in node_names)
    assert any("Occlusion" in name for name in node_names)
    assert any("TearLine" in name for name in node_names)
    assert not node_names.intersection({"Cube", "Camera", "Light"})


def test_component_fingerprints_skip_geometry_for_the_scoped_component():
    component_id = str(uuid.uuid4())
    object_id = str(uuid.uuid4())

    class ScopedObject:
        def get(self, key):
            return {
                "comodel_component_id": component_id,
                "comodel_object_id": object_id,
            }.get(key)

        @property
        def matrix_world(self):
            raise AssertionError("Scoped component geometry should not be fingerprinted")

    class FakeBpy:
        class context:
            class scene:
                objects = [ScopedObject()]

    assert WORKER_MODULE.component_object_fingerprints(FakeBpy, {component_id}) == {
        object_id: (component_id,),
    }

    with pytest.raises(ValueError, match="SCOPE_VIOLATION"):
        WORKER_MODULE.verify_operation_scope(
            {"unrelated-object": ("unrelated-component", "before")},
            {"unrelated-object": ("unrelated-component", "after")},
            {component_id},
        )


def test_cc5_manifest_covers_all_directional_controls_and_meshes():
    asset_id = "character_cc5_rlcc3plus_all_morphs_v1"
    assert asset_id in WORKER_MODULE.CC3_ASSET
    manifest = WORKER_MODULE.CC3_MORPH_MANIFESTS[asset_id]

    assert WORKER_MODULE.CC3_ASSET[asset_id]["format"] == "blend"
    assert len(manifest["controls"]) == 2042
    assert len(WORKER_MODULE.CC3_MORPH_CONTROLS_BY_ASSET[asset_id]) == 2042
    assert manifest["component_shape_key_count"] == 6214
    assert manifest["mesh_count"] == 6
    assert manifest["object_count"] == 7
    assert all(
        control["positive_shape_key"] and control["negative_shape_key"]
        for control in manifest["controls"]
    )


@pytest.mark.skipif(not BLENDER_EXECUTABLE, reason="Blender executable is not installed")
def test_blender_worker_imports_cc3_morphs_and_persists_signed_values(tmp_path):
    component_id = str(uuid.uuid4())
    initial_morphs = {control_id: 0.0 for control_id in WORKER_MODULE.CC3_MORPH_CONTROLS}
    initial_morphs["ear_length"] = 0.25
    initial_morphs["ear_angle_top"] = -0.2
    import_job = create_job(
        tmp_path,
        operation="import_base_model",
        expected_scene_version=0,
        arguments={
            "component_id": component_id,
            "asset_id": "character_cc3_morphs_v1",
            "morphs": initial_morphs,
        },
    )
    imported = run_worker(import_job)
    assert imported.returncode == 0, imported.stderr
    import_report = json.loads((tmp_path / "output" / "result.json").read_text(encoding="utf-8"))
    source = import_report["result"]
    assert source["asset_id"] == "character_cc3_morphs_v1"
    assert source["initial_morphs"] == initial_morphs
    assert source["mesh_count"] == 4
    assert source["body_vertex_count"] == 14647
    assert source["body_shape_key_count"] == WORKER_MODULE.CC3_ASSET[
        "character_cc3_morphs_v1"
    ]["body_shape_keys"]
    assert source["bone_count"] == 101
    assert set(source["morph_control_names"]) == set(WORKER_MODULE.CC3_MORPH_CONTROLS)
    assert len(source["morph_control_specs"]) == 137
    assert sum(spec["positive_shape_key"] is not None for spec in source["morph_control_specs"]) == 136
    assert sum(spec["negative_shape_key"] is not None for spec in source["morph_control_specs"]) == 108
    assert len(source["object_ids"]) == 5

    preview_path = tmp_path / "output" / "preview.glb"
    preview = read_glb_json(preview_path)
    if source["preview_compression"].startswith("meshopt-"):
        assert "EXT_meshopt_compression" in preview["extensionsUsed"]
        source_asset = Path(WORKER_MODULE.__file__).parent / WORKER_MODULE.CC3_ASSET[
            "character_cc3_morphs_v1"
        ]["filename"]
        assert preview_path.stat().st_size < source_asset.stat().st_size * 0.25
        assert source["preview_compression"] == "meshopt-static"
    else:
        assert source["preview_compression"] == "none-static"
    body_mesh = next(mesh for mesh in preview["meshes"] if mesh.get("name") == "CC_Base_Body")
    assert not body_mesh.get("extras", {}).get("targetNames")

    positive_values = {name: 0.0 for name in WORKER_MODULE.CC3_MORPH_CONTROLS}
    positive_values["ear_length"] = 0.75
    positive_job = create_job(
        tmp_path,
        operation="apply_cc3_morph_controls",
        expected_scene_version=1,
        arguments={
            "component_id": component_id,
            "asset_id": "character_cc3_morphs_v1",
            "morphs": positive_values,
        },
        scope_component_ids=[component_id],
    )
    positive_result = run_worker(positive_job)
    assert positive_result.returncode == 0, positive_result.stderr

    negative_values = dict(positive_values)
    negative_values["ear_length"] = -0.5
    negative_values["ear_angle_top"] = 0.4
    negative_job = create_job(
        tmp_path,
        operation="apply_cc3_morph_controls",
        expected_scene_version=2,
        arguments={
            "component_id": component_id,
            "asset_id": "character_cc3_morphs_v1",
            "morphs": negative_values,
        },
        scope_component_ids=[component_id],
    )
    negative_result = run_worker(negative_job)
    assert negative_result.returncode == 0, negative_result.stderr
    report = json.loads((tmp_path / "output" / "result.json").read_text(encoding="utf-8"))
    assert report["result"]["morphs"] == negative_values
    assert report["result"]["preview_compression"] == source["preview_compression"]
    assert report["result"]["shape_key_count"] == source["body_shape_key_count"] - 1

    preview = read_glb_json(preview_path)
    if source["preview_compression"].startswith("meshopt-"):
        assert "EXT_meshopt_compression" in preview["extensionsUsed"]
    body_mesh = next(mesh for mesh in preview["meshes"] if mesh.get("name") == "CC_Base_Body")
    targets = body_mesh.get("extras", {}).get("targetNames", [])
    assert not targets
    bake_job = create_job(
        tmp_path,
        operation="bake_cc3_morph_controls",
        expected_scene_version=3,
        arguments={
            "component_id": component_id,
            "asset_id": "character_cc3_morphs_v1",
            "morphs": negative_values,
        },
        scope_component_ids=[component_id],
    )
    baked_result = run_worker(bake_job)
    assert baked_result.returncode == 0, baked_result.stderr
    baked_report = json.loads((tmp_path / "output" / "result.json").read_text(encoding="utf-8"))
    assert baked_report["result"]["component_id"] == component_id
    assert baked_report["result"]["baked_morphs"] == negative_values
    assert baked_report["result"]["shape_key_count"] == 0
    assert baked_report["result"]["baked_vertex_count"] == source["body_vertex_count"]
    assert baked_report["result"]["baked_geometry_hash"] != source["geometry_hash"]
    baked_preview = read_glb_json(preview_path)
    baked_body_mesh = next(mesh for mesh in baked_preview["meshes"] if mesh.get("name") == "CC_Base_Body")
    assert not baked_body_mesh.get("extras", {}).get("targetNames")


@pytest.mark.skipif(
    "character_cc3_male_morphs_v1" not in WORKER_MODULE.CC3_ASSET,
    reason="The owner-supplied Male GLB is local-only and is not installed in every environment",
)
@pytest.mark.skipif(not BLENDER_EXECUTABLE, reason="Blender executable is not installed")
def test_blender_worker_imports_male_manifest_and_saves_male_controls(tmp_path):
    asset_id = "character_cc3_male_morphs_v1"
    component_id = str(uuid.uuid4())
    specs = WORKER_MODULE.CC3_MORPH_SPECS_BY_ASSET[asset_id]
    controls = WORKER_MODULE.CC3_MORPH_CONTROLS_BY_ASSET[asset_id]
    import_job = create_job(
        tmp_path,
        operation="import_base_model",
        expected_scene_version=0,
        arguments={"component_id": component_id, "asset_id": asset_id},
    )
    imported = run_worker(import_job)
    assert imported.returncode == 0, imported.stderr
    source = json.loads((tmp_path / "output" / "result.json").read_text(encoding="utf-8"))["result"]
    assert source["asset_id"] == asset_id
    assert source["mesh_count"] == 4
    assert source["body_vertex_count"] == 14647
    assert source["source_body_vertex_count"] == 13286
    assert source["body_shape_key_count"] == 323
    assert source["bone_count"] == 101
    assert len(source["morph_control_specs"]) == 143
    assert len(source["object_ids"]) == 5

    preview_path = tmp_path / "output" / "preview.glb"
    preview = read_glb_json(preview_path)
    if source["preview_compression"].startswith("meshopt-"):
        assert "EXT_meshopt_compression" in preview["extensionsUsed"]
        source_asset = Path(WORKER_MODULE.__file__).parent / WORKER_MODULE.CC3_ASSET[asset_id]["filename"]
        assert preview_path.stat().st_size < source_asset.stat().st_size * 0.25
        assert source["preview_compression"] == "meshopt-static"
    else:
        assert source["preview_compression"] == "none-static"
    body_mesh = next(mesh for mesh in preview["meshes"] if mesh.get("name") == "CC_Base_Body")
    assert not body_mesh.get("extras", {}).get("targetNames")

    values = {control_id: 0.0 for control_id in controls}
    values["shoulder_depth"] = -0.5
    values["bust_size"] = 0.75
    save_job = create_job(
        tmp_path,
        operation="apply_cc3_morph_controls",
        expected_scene_version=1,
        arguments={"component_id": component_id, "asset_id": asset_id, "morphs": values},
        scope_component_ids=[component_id],
    )
    saved = run_worker(save_job)
    assert saved.returncode == 0, saved.stderr
    report = json.loads((tmp_path / "output" / "result.json").read_text(encoding="utf-8"))
    assert report["result"]["morphs"] == values
    assert report["result"]["shape_key_count"] == source["body_shape_key_count"] - 1
    assert report["result"]["preview_compression"] == source["preview_compression"]
    preview = read_glb_json(preview_path)
    if source["preview_compression"].startswith("meshopt-"):
        assert "EXT_meshopt_compression" in preview["extensionsUsed"]
    body_mesh = next(mesh for mesh in preview["meshes"] if mesh.get("name") == "CC_Base_Body")
    targets = body_mesh.get("extras", {}).get("targetNames", [])
    assert not targets


@pytest.mark.skipif(
    "character_cc5_rlcc3plus_all_morphs_v1" not in WORKER_MODULE.CC3_ASSET,
    reason="The owner-supplied CC5/CC3+ blend and preview are not installed",
)
@pytest.mark.skipif(not BLENDER_EXECUTABLE, reason="Blender executable is not installed")
def test_blender_worker_applies_and_bakes_cc5_controls_across_all_meshes(tmp_path):
    asset_id = "character_cc5_rlcc3plus_all_morphs_v1"
    manifest = WORKER_MODULE.CC3_MORPH_MANIFESTS[asset_id]
    component_id = str(uuid.uuid4())
    head_scale = next(control for control in manifest["controls"] if control["label"] == "Head Scale")

    skin_asset = next(iter(WORKER_MODULE.SKIN_ASSETS.values()), None)
    skin_installed = skin_asset is not None and WORKER_MODULE.skin_asset_is_integrity_valid(skin_asset)
    import_arguments = {"component_id": component_id, "asset_id": asset_id}
    if skin_installed:
        import_arguments["skin_asset_id"] = skin_asset["id"]
    import_job = create_job(
        tmp_path,
        operation="import_base_model",
        expected_scene_version=0,
        arguments=import_arguments,
    )
    imported = run_worker(import_job)
    assert imported.returncode == 0, imported.stderr
    source = json.loads((tmp_path / "output" / "result.json").read_text(encoding="utf-8"))["result"]
    assert source["source_blend_sha256"] == manifest["blend_sha256"]
    assert source["mesh_count"] == manifest["mesh_count"]
    assert source["object_count"] == manifest["object_count"]
    assert source["component_vertex_count"] == manifest["component_vertex_count"]
    assert source["component_shape_key_count"] == manifest["component_shape_key_count"]
    assert source["neutralized_morph_key_count"] == manifest["shape_key_operations"]
    assert source["body_shape_key_count"] == manifest["body_shape_key_count"]
    assert len(source["morph_control_names"]) == 2042
    if skin_installed:
        assert source["skin_asset"] == {
            "asset_id": skin_asset["id"],
            "material_library_sha256": skin_asset["material_library_sha256"],
            "material_names": sorted(
                f"{material_name}_CC3PlusFemaleSkin"
                for material_name in skin_asset["materials"]
            ),
        }
        skin_inspection = (
            "import bpy,json;"
            f"component_id={json.dumps(component_id)};"
            "body=next(obj for obj in bpy.context.scene.objects "
            "if obj.type=='MESH' and obj.get('comodel_component_id')==component_id "
            "and obj.get('comodel_source_group')=='CC_Base_Body');"
            "materials=sorted(slot.material.name for slot in body.material_slots "
            "if slot.material and slot.material.name.endswith('_CC3PlusFemaleSkin'));"
            "print('CC5_SKIN_MATERIALS='+json.dumps(materials))"
        )
        inspected_skin = subprocess.run(
            [
                BLENDER_EXECUTABLE,
                "--background",
                "--factory-startup",
                "--disable-autoexec",
                str(tmp_path / "output" / "scene.blend"),
                "--python-expr",
                skin_inspection,
            ],
            capture_output=True,
            text=True,
            timeout=600,
            check=False,
        )
        assert inspected_skin.returncode == 0, inspected_skin.stderr
        material_line = next(line for line in inspected_skin.stdout.splitlines() if line.startswith("CC5_SKIN_MATERIALS="))
        assert json.loads(material_line.split("=", 1)[1]) == sorted(
            f"{material_name}_CC3PlusFemaleSkin" for material_name in skin_asset["materials"]
        )

    neutral_inspection = (
        "import bpy,json;"
        f"component_id={json.dumps(component_id)};"
        "active=[(obj.name,key.name) for obj in bpy.context.scene.objects "
        "if obj.type=='MESH' and obj.get('comodel_component_id')==component_id "
        "and obj.data.shape_keys is not None "
        "for key in obj.data.shape_keys.key_blocks[1:] if abs(key.value)>1e-8];"
        "body=next(obj for obj in bpy.context.scene.objects "
        "if obj.type=='MESH' and obj.get('comodel_component_id')==component_id "
        "and obj.get('comodel_source_group')=='CC_Base_Body');"
        "morphs=json.loads(body['comodel_cc3_morph_controls_json']);"
        "print('CC5_INITIAL_MORPH_VALUES='+json.dumps("
        "{'active_key_count':len(active),'nonzero_control_count':sum(value!=0 for value in morphs.values())},"
        "sort_keys=True))"
    )
    inspected = subprocess.run(
        [
            BLENDER_EXECUTABLE,
            "--background",
            "--factory-startup",
            "--disable-autoexec",
            str(tmp_path / "output" / "scene.blend"),
            "--python-expr",
            neutral_inspection,
        ],
        capture_output=True,
        text=True,
        timeout=600,
        check=False,
    )
    assert inspected.returncode == 0, inspected.stderr
    initial_line = next(line for line in inspected.stdout.splitlines() if line.startswith("CC5_INITIAL_MORPH_VALUES="))
    assert json.loads(initial_line.split("=", 1)[1]) == {
        "active_key_count": 0,
        "nonzero_control_count": 0,
    }

    preview_path = tmp_path / "output" / "preview.glb"
    neutral_preview = preview_path.read_bytes()
    neutral_gltf = read_glb_json(preview_path)
    assert len(neutral_gltf["meshes"]) == manifest["mesh_count"]
    assert len(neutral_gltf["skins"]) == 1
    assert all(not mesh.get("extras", {}).get("targetNames") for mesh in neutral_gltf["meshes"])
    body_node = next(
        node for node in neutral_gltf["nodes"]
        if node.get("name") == "CC_Base_Body" and "mesh" in node
    )
    body_mesh = neutral_gltf["meshes"][body_node["mesh"]]
    body_position_count = sum(
        neutral_gltf["accessors"][primitive["attributes"]["POSITION"]]["count"]
        for primitive in body_mesh["primitives"]
    )
    assert body_position_count > manifest["body_vertex_count"]
    for mesh_name, baseline_positions in (
        ("CC_Base_EyeOcclusion", 325),
        ("CC_Base_TearLine", 331),
    ):
        node = next(
            node for node in neutral_gltf["nodes"]
            if node.get("name") == mesh_name and "mesh" in node
        )
        mesh = neutral_gltf["meshes"][node["mesh"]]
        position_counts = [
            neutral_gltf["accessors"][primitive["attributes"]["POSITION"]]["count"]
            for primitive in mesh["primitives"]
        ]
        assert len(position_counts) == 2
        assert all(count > baseline_positions * 8 for count in position_counts), (
            f"{mesh_name} preview geometry was not subdivided: {position_counts}"
        )

    values = {control["id"]: 0.0 for control in manifest["controls"]}
    values[head_scale["id"]] = 0.5
    scene_path = tmp_path / "output" / "scene.blend"
    scene_hash = sha256_file(scene_path)
    preview_job = create_job(
        tmp_path,
        operation="preview_cc3_morph_controls",
        expected_scene_version=1,
        arguments={"component_id": component_id, "asset_id": asset_id, "morphs": values},
        scope_component_ids=[component_id],
    )
    previewed = run_worker(preview_job)
    assert previewed.returncode == 0, previewed.stderr
    preview_report = json.loads((tmp_path / "output" / "result.json").read_text(encoding="utf-8"))
    assert preview_report["scene_version"] == 1
    assert preview_report["scene_file"] is None
    assert preview_report["preview_export_status"] == "pass"
    assert sha256_file(scene_path) == scene_hash
    assert preview_path.read_bytes() != neutral_preview

    save_job = create_job(
        tmp_path,
        operation="apply_cc3_morph_controls",
        expected_scene_version=1,
        arguments={"component_id": component_id, "asset_id": asset_id, "morphs": values},
        scope_component_ids=[component_id],
    )
    saved = run_worker(save_job)
    assert saved.returncode == 0, saved.stderr
    save_report = json.loads((tmp_path / "output" / "result.json").read_text(encoding="utf-8"))
    assert save_report["result"]["morphs"] == values
    assert save_report["result"]["shape_key_count"] == manifest["body_shape_key_count"] - 1
    assert save_report["result"]["component_shape_key_count"] == manifest["component_shape_key_count"] - manifest["mesh_count"]
    assert preview_path.read_bytes() != neutral_preview
    saved_gltf = read_glb_json(preview_path)
    assert len(saved_gltf["meshes"]) == manifest["mesh_count"]
    assert len(saved_gltf["skins"]) == len(neutral_gltf["skins"])
    assert all(not mesh.get("extras", {}).get("targetNames") for mesh in saved_gltf["meshes"])

    preset_job = create_job(
        tmp_path,
        operation="apply_cc3_body_preset",
        expected_scene_version=2,
        arguments={
            "component_id": component_id,
            "asset_id": asset_id,
            "morphs": values,
            "preset_id": "female_neutral_head_preset_9",
        },
        scope_component_ids=[component_id],
    )
    preset_applied = run_worker(preset_job)
    assert preset_applied.returncode == 0, preset_applied.stderr
    preset_report = json.loads((tmp_path / "output" / "result.json").read_text(encoding="utf-8"))
    assert preset_report["scene_version"] == 3
    assert preset_report["result"]["preset_id"] == "female_neutral_head_preset_9"
    assert preset_report["result"]["preset_mesh_name"] == "CC_Base_Body"
    assert set(preset_report["result"]["preset_following_mesh_names"]) == (
        set(manifest["mesh_names"]) - {"CC_Base_Body"}
    )
    assert preset_report["result"]["shape_key_count"] == manifest["body_shape_key_count"]
    assert preset_report["result"]["component_shape_key_count"] == (
        manifest["component_shape_key_count"] - manifest["mesh_count"] + manifest["mesh_count"]
    )
    preset_inspection = (
        "import bpy,json;"
        f"component_id={json.dumps(component_id)};"
        "key_name='CoModel_Preset_female_neutral_head_preset_9';"
        "result={obj.get('comodel_source_group'):{"
        "'value':obj.data.shape_keys.key_blocks[key_name].value,"
        "'moved_vertices':sum((obj.data.shape_keys.key_blocks[key_name].data[i].co-"
        "obj.data.shape_keys.key_blocks[0].data[i].co).length>1e-6 "
        "for i in range(len(obj.data.vertices)))} "
        "for obj in bpy.context.scene.objects "
        "if obj.type=='MESH' and obj.get('comodel_component_id')==component_id "
        "and obj.get('comodel_source_group')!='CC_Base_Body' "
        "and obj.data.shape_keys is not None "
        "and key_name in obj.data.shape_keys.key_blocks};"
        "print('CC5_PRESET_FOLLOWERS='+json.dumps(result,sort_keys=True))"
    )
    inspected_preset = subprocess.run(
        [
            BLENDER_EXECUTABLE,
            "--background",
            "--factory-startup",
            "--disable-autoexec",
            str(tmp_path / "output" / "scene.blend"),
            "--python-expr",
            preset_inspection,
        ],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert inspected_preset.returncode == 0, inspected_preset.stderr
    preset_followers = next(
        json.loads(line.split("=", 1)[1])
        for line in inspected_preset.stdout.splitlines()
        if line.startswith("CC5_PRESET_FOLLOWERS=")
    )
    assert set(preset_followers) == set(manifest["mesh_names"]) - {"CC_Base_Body"}
    assert all(
        follower["value"] == 1.0 and follower["moved_vertices"] > 0
        for follower in preset_followers.values()
    )

    undo_preset_job = create_job(
        tmp_path,
        operation="apply_cc3_body_preset",
        expected_scene_version=3,
        arguments={
            "component_id": component_id,
            "asset_id": asset_id,
            "morphs": values,
            "preset_id": None,
        },
        scope_component_ids=[component_id],
    )
    preset_undone = run_worker(undo_preset_job)
    assert preset_undone.returncode == 0, preset_undone.stderr
    undo_report = json.loads((tmp_path / "output" / "result.json").read_text(encoding="utf-8"))
    assert undo_report["scene_version"] == 4
    assert undo_report["result"]["preset_id"] is None
    assert undo_report["result"]["shape_key_count"] == manifest["body_shape_key_count"] - 1
    assert undo_report["result"]["component_shape_key_count"] == (
        manifest["component_shape_key_count"] - manifest["mesh_count"]
    )
    inspection = (
        "import bpy,json;"
        f"component_id={json.dumps(component_id)};"
        f"key_name={json.dumps(head_scale['positive_shape_key'])};"
        "values={obj.get('comodel_source_group'):obj.data.shape_keys.key_blocks[key_name].value "
        "for obj in bpy.context.scene.objects "
        "if obj.type=='MESH' and obj.get('comodel_component_id')==component_id "
        "and obj.data.shape_keys is not None and key_name in obj.data.shape_keys.key_blocks};"
        "print('CC5_MORPH_VALUES='+json.dumps(values,sort_keys=True))"
    )
    inspected = subprocess.run(
        [
            BLENDER_EXECUTABLE,
            "--background",
            "--factory-startup",
            "--disable-autoexec",
            str(tmp_path / "output" / "scene.blend"),
            "--python-expr",
            inspection,
        ],
        capture_output=True,
        text=True,
        timeout=600,
        check=False,
    )
    assert inspected.returncode == 0, inspected.stderr
    values_line = next(line for line in inspected.stdout.splitlines() if line.startswith("CC5_MORPH_VALUES="))
    assert json.loads(values_line.split("=", 1)[1]) == {
        "CC_Base_Body": 0.5,
        "CC_Base_Tongue": 0.5,
    }

    bake_job = create_job(
        tmp_path,
        operation="bake_cc3_morph_controls",
        expected_scene_version=4,
        arguments={"component_id": component_id, "asset_id": asset_id, "morphs": values},
        scope_component_ids=[component_id],
    )
    baked = run_worker(bake_job)
    assert baked.returncode == 0, baked.stderr
    bake_report = json.loads((tmp_path / "output" / "result.json").read_text(encoding="utf-8"))
    assert bake_report["result"]["baked_morphs"] == values
    assert bake_report["result"]["shape_key_count"] == 0
    assert bake_report["result"]["component_shape_key_count"] == 0
    assert bake_report["result"]["baked_component_vertex_count"] == manifest["component_vertex_count"]


@pytest.mark.skipif(
    not (Path(__file__).with_name("assets") / "CC5_RL_CC3_Plus_Morph_Deltas.zip").is_file(),
    reason="The generated CC5/CC3+ morph proxy deltas are not installed",
)
def test_cc5_blink_proxy_deltas_use_normalized_gltf_space():
    asset_id = "character_cc5_rlcc3plus_all_morphs_v1"
    manifest = WORKER_MODULE.CC3_MORPH_MANIFESTS[asset_id]
    control = next(item for item in manifest["controls"] if item["label"] == "01_Blink_L")
    archive_path = Path(__file__).with_name("assets") / "CC5_RL_CC3_Plus_Morph_Deltas.zip"
    with zipfile.ZipFile(archive_path) as archive:
        data = archive.read(f"controls/{control['id']}.bin")

    magic, version, positive_count, negative_count = struct.unpack_from("<4sBHH", data)
    assert (magic, version) == (b"CMMD", 1)
    offset = struct.calcsize("<4sBHH")
    maximum_delta_length = 0.0
    for record_count in (positive_count, negative_count):
        for _ in range(record_count):
            _, _, delta_count = struct.unpack_from("<BHI", data, offset)
            offset += struct.calcsize("<BHI")
            for _ in range(delta_count):
                _, x, y, z = struct.unpack_from("<Ifff", data, offset)
                offset += struct.calcsize("<Ifff")
                maximum_delta_length = max(maximum_delta_length, (x * x + y * y + z * z) ** 0.5)

    assert offset == len(data)
    assert maximum_delta_length < 0.1
