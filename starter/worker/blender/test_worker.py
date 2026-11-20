from array import array
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
from types import SimpleNamespace
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


def run_worker(
    job_path: Path,
    *,
    staged_only: bool = False,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    arguments = [
        "--job",
        str(job_path),
    ]
    worker_entry = WORKER_ENTRY
    if staged_only:
        worker_entry = WORKER_ENTRY.with_name("worker_entry_staged.py")
        arguments.append("--staged-only")
    return subprocess.run(
        [
            BLENDER_EXECUTABLE,
            "--background",
            "--factory-startup",
            "--disable-autoexec",
            "--python",
            str(worker_entry),
            "--",
            *arguments,
        ],
        capture_output=True,
        text=True,
        timeout=600,
        check=False,
        env=env,
    )


def test_staged_worker_job_requires_transaction_and_attempt_identity(tmp_path: Path):
    job_path = create_job(
        tmp_path,
        operation="validate_scene_structure",
        expected_scene_version=0,
        arguments={},
    )
    job = json.loads(job_path.read_text(encoding="utf-8"))
    job["transaction_id"] = str(uuid.uuid4())
    job["attempt_id"] = str(uuid.uuid4())
    job["api_contract_version"] = WORKER_MODULE.API_TRANSACTION_CONTRACT_VERSION
    job["worker_contract_version"] = WORKER_MODULE.WORKER_CONTRACT_VERSION
    job_path.write_text(json.dumps(job), encoding="utf-8")

    staged_job = WORKER_MODULE.load_job(job_path, staged_only=True)
    assert staged_job["transaction_id"] == job["transaction_id"]
    assert staged_job["attempt_id"] == job["attempt_id"]
    with pytest.raises(ValueError, match="missing or unsupported"):
        WORKER_MODULE.load_job(job_path)

    for key in ("api_contract_version", "worker_contract_version"):
        incompatible_job = dict(job)
        incompatible_job[key] = "unsupported"
        job_path.write_text(json.dumps(incompatible_job), encoding="utf-8")
        with pytest.raises(ValueError, match="unsupported transaction worker contract version"):
            WORKER_MODULE.load_job(job_path, staged_only=True)


@pytest.mark.skipif(not BLENDER_EXECUTABLE, reason="Blender executable is not installed")
def test_staged_worker_writes_failure_report(tmp_path: Path):
    transaction_id = str(uuid.uuid4())
    attempt_id = str(uuid.uuid4())
    workspace = tmp_path / "transactions" / transaction_id / attempt_id
    workspace.mkdir(parents=True)
    job_path = create_job(
        workspace,
        operation="unsupported_operation",
        expected_scene_version=0,
        arguments={},
    )
    job = json.loads(job_path.read_text(encoding="utf-8"))
    job.update({
        "transaction_id": transaction_id,
        "attempt_id": attempt_id,
        "api_contract_version": WORKER_MODULE.API_TRANSACTION_CONTRACT_VERSION,
        "worker_contract_version": WORKER_MODULE.WORKER_CONTRACT_VERSION,
    })
    job_path.write_text(json.dumps(job), encoding="utf-8")

    process = run_worker(job_path, staged_only=True)

    failure_path = workspace / "output" / "worker-error.json"
    assert process.returncode != 0
    failure = json.loads(failure_path.read_text(encoding="utf-8"))
    assert failure["status"] == "failed"
    assert failure["error_type"] == "ValueError"
    assert failure["error"]


@pytest.mark.skipif(not BLENDER_EXECUTABLE, reason="Blender executable is not installed")
def test_staged_worker_does_not_promote_scene_or_preview(tmp_path: Path):
    committed_root = tmp_path / "committed"
    committed_output = committed_root / "output"
    committed_output.mkdir(parents=True)
    initial_job = create_job(
        committed_root,
        operation="validate_scene_structure",
        expected_scene_version=0,
        arguments={},
    )
    initial = run_worker(initial_job)
    assert initial.returncode == 0, initial.stderr
    committed_scene = committed_output / "scene.blend"
    committed_preview = committed_output / "preview.glb"
    assert committed_scene.is_file()
    assert committed_preview.is_file()
    committed_scene_hash = sha256_file(committed_scene)
    committed_preview_hash = sha256_file(committed_preview)

    staging_root = tmp_path / "transactions" / str(uuid.uuid4()) / str(uuid.uuid4())
    staging_output = staging_root / "output"
    staging_output.mkdir(parents=True)
    shutil.copy2(committed_scene, staging_output / "scene.blend")
    shutil.copy2(committed_preview, staging_output / "preview.glb")
    staged_job = create_job(
        staging_root,
        operation="validate_scene_structure",
        expected_scene_version=0,
        arguments={},
    )
    job = json.loads(staged_job.read_text(encoding="utf-8"))
    job["transaction_id"] = str(uuid.uuid4())
    job["attempt_id"] = str(uuid.uuid4())
    job["api_contract_version"] = WORKER_MODULE.API_TRANSACTION_CONTRACT_VERSION
    job["worker_contract_version"] = WORKER_MODULE.WORKER_CONTRACT_VERSION
    staged_job.write_text(json.dumps(job), encoding="utf-8")

    staged = run_worker(staged_job, staged_only=True)
    assert staged.returncode == 0, staged.stderr
    report = json.loads((staging_output / "result.json").read_text(encoding="utf-8"))
    assert report["transaction_id"] == job["transaction_id"]
    assert report["attempt_id"] == job["attempt_id"]
    assert report["api_contract_version"] == WORKER_MODULE.API_TRANSACTION_CONTRACT_VERSION
    assert report["worker_contract_version"] == WORKER_MODULE.WORKER_CONTRACT_VERSION
    assert report["scene_file"] == "output/scene_candidate.blend"
    assert report["preview_file"] == "output/preview_candidate.glb"
    assert (staging_output / "scene_candidate.blend").is_file()
    assert (staging_output / "preview_candidate.glb").is_file()
    assert sha256_file(committed_scene) == committed_scene_hash
    assert sha256_file(committed_preview) == committed_preview_hash


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
        valid_import_with_presets = create_job(
            tmp_path,
            operation="import_base_model",
            expected_scene_version=0,
            arguments={
                "component_id": str(uuid.uuid4()),
                "asset_id": cc5_asset_id,
                "preset_ids": {
                    "body": "female_neutral_body_preset_4",
                    "head": "female_neutral_head_preset_9",
                },
            },
        )
        assert WORKER_MODULE.load_job(valid_import_with_presets)["arguments"]["preset_ids"] == {
            "body": "female_neutral_body_preset_4",
            "head": "female_neutral_head_preset_9",
        }
        invalid_import_preset_kinds = create_job(
            tmp_path,
            operation="import_base_model",
            expected_scene_version=0,
            arguments={
                "component_id": str(uuid.uuid4()),
                "asset_id": cc5_asset_id,
                "preset_ids": {
                    "body": "female_neutral_head_preset_9",
                    "head": None,
                },
            },
        )
        with pytest.raises(ValueError, match="body preset"):
            WORKER_MODULE.load_job(invalid_import_preset_kinds)
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
    with pytest.raises(ValueError, match="scope only their character component"):
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


def test_retired_hair_worker_operations_and_import_fields_are_rejected(tmp_path):
    for operation in ("generate_cc5_hair", "attach_pinned_hair_asset"):
        job_path = create_job(
            tmp_path,
            operation=operation,
            expected_scene_version=1,
            arguments={},
        )
        with pytest.raises(ValueError, match="Operation is not allowlisted"):
            WORKER_MODULE.load_job(job_path)

    job_path = create_job(
        tmp_path,
        operation="import_base_model",
        expected_scene_version=0,
        arguments={
            "component_id": str(uuid.uuid4()),
            "asset_id": "character_cc5_rlcc3plus_all_morphs_v1",
            "hair_attachment": {"asset_id": "legacy", "component_id": "legacy-hair"},
        },
    )
    with pytest.raises(ValueError, match="unsupported fields"):
        WORKER_MODULE.load_job(job_path)


def test_hair_worker_operations_require_stable_component_scope_and_bounded_arguments(tmp_path):
    scalp_component_id = str(uuid.uuid4())
    body_component_id = str(uuid.uuid4())
    scalp_job = create_job(
        tmp_path,
        operation="create_hair_scalp",
        expected_scene_version=1,
        arguments={
            "component_id": scalp_component_id,
            "body_component_id": body_component_id,
            "body_object_id": f"{body_component_id}-cc_base_body",
        },
        scope_component_ids=[scalp_component_id],
        dependency_component_ids=[body_component_id],
    )
    assert WORKER_MODULE.load_job(scalp_job)["operation"] == "create_hair_scalp"

    guide_component_id = str(uuid.uuid4())
    guide_job = create_job(
        tmp_path,
        operation="generate_hair_guides",
        expected_scene_version=2,
        arguments={
            "component_id": guide_component_id,
            "scalp_component_id": scalp_component_id,
            "scalp_object_id": f"{scalp_component_id}-scalp",
            "guide_count": 16,
            "guide_length": 0.15,
            "seed": 23,
        },
        scope_component_ids=[guide_component_id],
        dependency_component_ids=[scalp_component_id],
    )
    assert WORKER_MODULE.load_job(guide_job)["arguments"]["guide_count"] == 16

    invalid_cases = (
        (
            "create_hair_scalp",
            {
                "component_id": scalp_component_id,
                "body_component_id": body_component_id,
                "body_object_id": f"{body_component_id}-cc_base_body",
                "source_object_name": "CC_Base_Body",
            },
            [scalp_component_id],
            [body_component_id],
            "missing or unsupported",
        ),
        (
            "create_hair_scalp",
            {
                "component_id": scalp_component_id,
                "body_component_id": body_component_id,
                "body_object_id": f"{body_component_id}-cc_base_body",
            },
            [],
            [body_component_id],
            "stable CC_Base_Body object",
        ),
        (
            "generate_hair_guides",
            {
                "component_id": guide_component_id,
                "scalp_component_id": scalp_component_id,
                "scalp_object_id": f"{scalp_component_id}-scalp",
                "guide_count": 129,
                "guide_length": 0.15,
                "seed": 23,
            },
            [guide_component_id],
            [scalp_component_id],
            "bounded guide settings",
        ),
        (
            "generate_hair_guides",
            {
                "component_id": guide_component_id,
                "scalp_component_id": scalp_component_id,
                "scalp_object_id": f"{scalp_component_id}-scalp",
                "guide_count": True,
                "guide_length": 0.15,
                "seed": 23,
            },
            [guide_component_id],
            [scalp_component_id],
            "bounded guide settings",
        ),
    )
    for operation, arguments, scope, dependencies, message in invalid_cases:
        job_path = create_job(
            tmp_path,
            operation=operation,
            expected_scene_version=1,
            arguments=arguments,
            scope_component_ids=scope,
            dependency_component_ids=dependencies,
        )
        with pytest.raises(ValueError, match=message):
            WORKER_MODULE.load_job(job_path)


def test_hair_tutor_package_verification_enforces_the_deployment_pin(tmp_path, monkeypatch):
    pin = WORKER_MODULE.verify_pinned_hair_tutor_package()
    assert pin["package_id"] == "blender_copilot_chat"
    assert pin["version"] == "0.1.8"
    assert pin["approval_status"] == "owner_reviewed_origin_unverified"
    assert pin["provenance"]["status"] == "unverified"
    assert len(pin["files"]) == 3

    package_root = tmp_path / "blender_copilot_chat"
    shutil.copytree(WORKER_MODULE.HAIR_TUTOR_PACKAGE_ROOT, package_root)
    pin_path = tmp_path / "hair_tutor_package.json"
    shutil.copy2(WORKER_MODULE.HAIR_TUTOR_PACKAGE_PIN_PATH, pin_path)
    monkeypatch.setattr(WORKER_MODULE, "HAIR_TUTOR_PACKAGE_ROOT", package_root)
    monkeypatch.setattr(WORKER_MODULE, "HAIR_TUTOR_PACKAGE_PIN_PATH", pin_path)
    assert WORKER_MODULE.verify_pinned_hair_tutor_package()["package_tree_sha256"] == pin["package_tree_sha256"]

    (package_root / "__init__.py").write_bytes(b"tampered")
    with pytest.raises(ValueError, match="failed integrity validation"):
        WORKER_MODULE.verify_pinned_hair_tutor_package()


@pytest.mark.skipif(not BLENDER_EXECUTABLE, reason="Blender executable is not installed")
def test_staged_hair_operations_preserve_character_and_persist_native_guides(tmp_path):
    project_id = "1952985a-1503-4427-8861-9cedc54c3f5b"
    body_component_id = str(uuid.uuid4())
    scalp_component_id = str(uuid.uuid4())
    guide_component_id = str(uuid.uuid4())
    committed_output = tmp_path / "committed" / "output"
    committed_output.mkdir(parents=True)
    home = tmp_path / "home"
    temp = tmp_path / "tmp"
    config = tmp_path / "config"
    for path in (home, temp, config):
        path.mkdir()
    child_env = dict(os.environ)
    child_env.update({
        "HOME": str(home),
        "TMPDIR": str(temp),
        "TEMP": str(temp),
        "TMP": str(temp),
        "BLENDER_USER_CONFIG": str(config),
        "LANG": "C.UTF-8",
    })

    fixture_script = tmp_path / "create_hair_fixture.py"
    fixture_script.write_text(
        """
import json
import sys
from pathlib import Path
import bpy

scene_path, body_component_id, project_id, worker_directory, snapshot_path = (
    sys.argv[sys.argv.index("--") + 1:]
)
sys.path.insert(0, worker_directory)
import worker_entry as worker

hair_tutor, _pin = worker.load_pinned_hair_tutor()
bpy.ops.wm.read_factory_settings(use_empty=True)
with bpy.data.libraries.load(str(hair_tutor._BASE_SCALP_ASSET), link=False) as (source, target):
    target.objects = ["Copilot_Base_Scalp"]
asset_scalp = target.objects[0]
required_bones = {
    group.name
    for group in asset_scalp.vertex_groups
    if any(
        assignment.group == group.index and assignment.weight > 0.0
        for vertex in asset_scalp.data.vertices
        for assignment in vertex.groups
    )
}
asset_mesh = asset_scalp.data
bpy.data.objects.remove(asset_scalp, do_unlink=True)
if asset_mesh.users == 0:
    bpy.data.meshes.remove(asset_mesh)

mesh = bpy.data.meshes.new("Fixture_Character_Mesh")
mesh.from_pydata(
    [(-1,-1,-1), (1,-1,-1), (1,1,-1), (-1,1,-1),
     (-1,-1,1), (1,-1,1), (1,1,1), (-1,1,1)],
    [],
    [(0,1,2,3), (4,7,6,5), (0,4,5,1), (1,5,6,2), (2,6,7,3), (4,0,3,7)],
)
uv_layer = mesh.uv_layers.new(name="CharacterUV")
for index, loop in enumerate(uv_layer.data):
    loop.uv = ((index % 4) / 3.0, (index // 4) / 3.0)
body = bpy.data.objects.new("Fixture_Character", mesh)
bpy.context.scene.collection.objects.link(body)
body.shape_key_add(name="Basis")
smile = body.shape_key_add(name="Fixture_Smile")
smile.data[0].co.z += 0.1
smile.value = 0.0
head_group = body.vertex_groups.new(name="Head")
head_group.add(list(range(len(mesh.vertices))), 1.0, "REPLACE")
armature_data = bpy.data.armatures.new("Fixture_Rig")
armature = bpy.data.objects.new("Fixture_Rig", armature_data)
bpy.context.scene.collection.objects.link(armature)
bpy.ops.object.select_all(action="DESELECT")
armature.select_set(True)
bpy.context.view_layer.objects.active = armature
bpy.ops.object.mode_set(mode="EDIT")
for index, name in enumerate(sorted(required_bones)):
    bone = armature_data.edit_bones.new(name)
    bone.head = (0.0, 0.0, float(index))
    bone.tail = (0.0, 0.0, float(index) + 0.5)
drift_bone = armature_data.edit_bones.new("Fixture_Rounding_Drift")
drift_bone.head = (0.0, 0.0, float(len(required_bones) + 1))
drift_bone.tail = (0.0, 0.0, float(len(required_bones) + 1) + 0.5)
bpy.ops.object.mode_set(mode="OBJECT")
armature.pose.bones["Fixture_Rounding_Drift"].location.x = 0.0001220703125
bpy.context.view_layer.update()
body.parent = armature
modifier = body.modifiers.new("Fixture_Armature", "ARMATURE")
modifier.object = armature
body["comodel_component_id"] = body_component_id
body["comodel_object_id"] = body_component_id + "-cc_base_body"
body["comodel_semantic_type"] = "body"
armature["comodel_component_id"] = body_component_id
armature["comodel_object_id"] = body_component_id + "-body_rig"
armature["comodel_semantic_type"] = "body_rig"
bpy.context.scene["comodel_project_id"] = project_id
bpy.context.scene["comodel_scene_version"] = 0

def snapshot():
    return {
        "vertices": [[round(float(value), 7) for value in vertex.co] for vertex in body.data.vertices],
        "faces": [list(polygon.vertices) for polygon in body.data.polygons],
        "uvs": [[round(float(value), 7) for value in loop.uv] for loop in body.data.uv_layers["CharacterUV"].data],
        "groups": [
            [group.name, [
                next((round(float(assignment.weight), 7) for assignment in vertex.groups if assignment.group == group.index), 0.0)
                for vertex in body.data.vertices
            ]]
            for group in body.vertex_groups
        ],
        "shape_keys": [
            [key.name, round(float(key.value), 7), [[round(float(value), 7) for value in point.co] for point in key.data]]
            for key in body.data.shape_keys.key_blocks
        ],
        "rig_pose": [
            [bone.name, [[round(float(value), 7) for value in row] for row in bone.matrix]]
            for bone in armature.pose.bones
        ],
        "parent": body.parent.name,
        "modifiers": [[item.name, item.type, item.object.name if item.object else None] for item in body.modifiers],
    }

Path(snapshot_path).write_text(json.dumps(snapshot(), sort_keys=True), encoding="utf-8")
bpy.ops.wm.save_as_mainfile(filepath=scene_path, check_existing=False)
""",
        encoding="utf-8",
    )
    initial_scene = committed_output / "scene.blend"
    snapshot_path = tmp_path / "body_snapshot.json"
    fixture = subprocess.run(
        [
            BLENDER_EXECUTABLE,
            "--background",
            "--factory-startup",
            "--disable-autoexec",
            "--python-exit-code",
            "1",
            "--python",
            str(fixture_script),
            "--",
            str(initial_scene),
            body_component_id,
            project_id,
            str(WORKER_ENTRY.parent),
            str(snapshot_path),
        ],
        capture_output=True,
        text=True,
        timeout=600,
        check=False,
        env=child_env,
    )
    assert fixture.returncode == 0, fixture.stderr

    def run_staged(
        operation: str,
        expected_scene_version: int,
        arguments: dict,
        scope_component_ids: list[str],
        dependency_component_ids: list[str],
        scene_source: Path | None = None,
    ):
        transaction_id = str(uuid.uuid4())
        attempt_id = str(uuid.uuid4())
        workspace = tmp_path / "transactions" / transaction_id / attempt_id
        output = workspace / "output"
        output.mkdir(parents=True)
        shutil.copy2(scene_source or committed_output / "scene.blend", output / "scene.blend")
        previous_preview = committed_output / "preview.glb"
        if previous_preview.is_file():
            shutil.copy2(previous_preview, output / "preview.glb")
        job_path = create_job(
            workspace,
            operation=operation,
            expected_scene_version=expected_scene_version,
            arguments=arguments,
            scope_component_ids=scope_component_ids,
            dependency_component_ids=dependency_component_ids,
        )
        job = json.loads(job_path.read_text(encoding="utf-8"))
        job.update({
            "transaction_id": transaction_id,
            "attempt_id": attempt_id,
            "api_contract_version": WORKER_MODULE.API_TRANSACTION_CONTRACT_VERSION,
            "worker_contract_version": WORKER_MODULE.WORKER_CONTRACT_VERSION,
        })
        job_path.write_text(json.dumps(job), encoding="utf-8")
        process = run_worker(job_path, staged_only=True, env=child_env)
        report_path = output / "result.json"
        report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.is_file() else None
        return process, output, report

    scalp_process, scalp_output, scalp_report = run_staged(
        "create_hair_scalp",
        0,
        {
            "component_id": scalp_component_id,
            "body_component_id": body_component_id,
            "body_object_id": f"{body_component_id}-cc_base_body",
        },
        [scalp_component_id],
        [body_component_id],
    )
    assert scalp_process.returncode == 0, scalp_process.stderr
    assert scalp_report["worker_contract_version"] == "worker-staged-v2"
    assert scalp_report["result"]["component_id"] == scalp_component_id
    assert scalp_report["result"]["object_ids"] == [f"{scalp_component_id}-scalp"]
    assert scalp_report["preview_export_status"] == "pass"
    shutil.copy2(scalp_output / "scene_candidate.blend", committed_output / "scene.blend")
    shutil.copy2(scalp_output / "preview_candidate.glb", committed_output / "preview.glb")

    guide_process, guide_output, guide_report = run_staged(
        "generate_hair_guides",
        1,
        {
            "component_id": guide_component_id,
            "scalp_component_id": scalp_component_id,
            "scalp_object_id": f"{scalp_component_id}-scalp",
            "guide_count": 8,
            "guide_length": 0.1,
            "seed": 23,
        },
        [guide_component_id],
        [scalp_component_id],
    )
    assert guide_process.returncode == 0, guide_process.stderr
    assert guide_report["result"]["object_ids"] == [f"{guide_component_id}-curves"]
    assert guide_report["result"]["guide_count"] == 8
    assert guide_report["preview_export_status"] == "pass"
    shutil.copy2(guide_output / "scene_candidate.blend", committed_output / "scene.blend")

    verify_script = tmp_path / "verify_hair_scene.py"
    verify_script.write_text(
        """
import json
import sys
import bpy

scene_path, snapshot_path, body_id, scalp_id, guides_id = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.open_mainfile(filepath=scene_path)
body = next(obj for obj in bpy.context.scene.objects if obj.get("comodel_component_id") == body_id and obj.get("comodel_semantic_type") == "body")
scalp = next(obj for obj in bpy.context.scene.objects if obj.get("comodel_component_id") == scalp_id and obj.get("comodel_object_id") == scalp_id + "-scalp")
guides = next(obj for obj in bpy.context.scene.objects if obj.get("comodel_component_id") == guides_id and obj.get("comodel_object_id") == guides_id + "-curves")
assert guides.type == "CURVES"
assert len(guides.data.curves) == 8
assert guides.data.surface == scalp
assert guides.data.surface_uv_map == scalp.data.uv_layers.active.name
assert guides.hide_render
assert scalp.parent is not None

def snapshot():
    return {
        "vertices": [[round(float(value), 7) for value in vertex.co] for vertex in body.data.vertices],
        "faces": [list(polygon.vertices) for polygon in body.data.polygons],
        "uvs": [[round(float(value), 7) for value in loop.uv] for loop in body.data.uv_layers["CharacterUV"].data],
        "groups": [
            [group.name, [
                next((round(float(assignment.weight), 7) for assignment in vertex.groups if assignment.group == group.index), 0.0)
                for vertex in body.data.vertices
            ]]
            for group in body.vertex_groups
        ],
        "shape_keys": [
            [key.name, round(float(key.value), 7), [[round(float(value), 7) for value in point.co] for point in key.data]]
            for key in body.data.shape_keys.key_blocks
        ],
        "rig_pose": [
            [bone.name, [[round(float(value), 7) for value in row] for row in bone.matrix]]
            for bone in body.parent.pose.bones
        ],
        "parent": body.parent.name,
        "modifiers": [[item.name, item.type, item.object.name if item.object else None] for item in body.modifiers],
    }

assert snapshot() == json.load(open(snapshot_path, encoding="utf-8"))
assert bpy.context.scene.get("comodel_scene_version") == 2
print("Hair worker scene reopened with stable IDs, attached native guides, and unchanged body data.")
""",
        encoding="utf-8",
    )
    verify = subprocess.run(
        [
            BLENDER_EXECUTABLE,
            "--background",
            "--factory-startup",
            "--disable-autoexec",
            "--python-exit-code",
            "1",
            "--python",
            str(verify_script),
            "--",
            str(committed_output / "scene.blend"),
            str(snapshot_path),
            body_component_id,
            scalp_component_id,
            guide_component_id,
        ],
        capture_output=True,
        text=True,
        timeout=600,
        check=False,
        env=child_env,
    )
    assert verify.returncode == 0, verify.stderr

    large_pose_scene = tmp_path / "large_pose_scene.blend"
    large_pose_script = tmp_path / "set_large_pose_drift.py"
    large_pose_script.write_text(
        """
import sys
import bpy

scene_path, output_path = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.open_mainfile(filepath=scene_path)
armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
armature.pose.bones["Fixture_Rounding_Drift"].location.x = 0.01
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=output_path, check_existing=False)
""",
        encoding="utf-8",
    )
    drift_fixture = subprocess.run(
        [
            BLENDER_EXECUTABLE,
            "--background",
            "--factory-startup",
            "--disable-autoexec",
            "--python-exit-code",
            "1",
            "--python",
            str(large_pose_script),
            "--",
            str(scalp_output / "scene_candidate.blend"),
            str(large_pose_scene),
        ],
        capture_output=True,
        text=True,
        timeout=600,
        check=False,
        env=child_env,
    )
    assert drift_fixture.returncode == 0, drift_fixture.stderr
    large_guide_component_id = str(uuid.uuid4())
    large_drift_process, large_drift_output, _ = run_staged(
        "generate_hair_guides",
        1,
        {
            "component_id": large_guide_component_id,
            "scalp_component_id": scalp_component_id,
            "scalp_object_id": f"{scalp_component_id}-scalp",
            "guide_count": 8,
            "guide_length": 0.1,
            "seed": 23,
        },
        [large_guide_component_id],
        [scalp_component_id],
        scene_source=large_pose_scene,
    )
    failure_path = large_drift_output / "worker-error.json"
    assert large_drift_process.returncode != 0
    failure = json.loads(failure_path.read_text(encoding="utf-8"))
    assert "exceeds the temporary normalization limit" in failure["error"]
    assert not (large_drift_output / "scene_candidate.blend").exists()


def test_worker_validates_semantic_skin_definition(tmp_path):
    skin_asset_id = next(iter(WORKER_MODULE.SKIN_ASSETS))
    arguments = {
        "component_id": str(uuid.uuid4()),
        "asset_id": "character_cc5_rlcc3plus_all_morphs_v1",
        "skin_asset_id": skin_asset_id,
        "skin_definition": {
            "version": 2,
            "base": {"tone": 0.62, "undertone": "neutral"},
            "surface": {"roughness": 0.42},
            "features": {"freckles": {
                "enabled": False,
                "density": 0.18,
                "size": 0.45,
                "strength": 0.35,
                "color": "#80513F",
                "seed": 24301,
            }},
        },
    }
    valid = create_job(
        tmp_path,
        operation="import_base_model",
        expected_scene_version=0,
        arguments=arguments,
    )
    assert WORKER_MODULE.load_job(valid)["arguments"]["skin_definition"] == arguments["skin_definition"]

    invalid = create_job(
        tmp_path,
        operation="import_base_model",
        expected_scene_version=0,
        arguments={
            **arguments,
            "skin_definition": {
                **arguments["skin_definition"],
                "base": {"tone": 0.62, "undertone": "red"},
            },
        },
    )
    with pytest.raises(ValueError, match="unsupported skin properties"):
        WORKER_MODULE.load_job(invalid)


def test_worker_applies_skin_semantics_without_losing_source_roughness():
    base_color = SimpleNamespace(links=[], default_value=(0.5, 0.4, 0.3, 1.0))
    roughness = SimpleNamespace(links=[], default_value=0.8)
    shader = SimpleNamespace(
        type="BSDF_PRINCIPLED",
        inputs={"Base Color": base_color, "Roughness": roughness},
    )
    material = SimpleNamespace(
        name="Body_CC3PlusFemaleSkin",
        use_nodes=True,
        node_tree=SimpleNamespace(nodes=[shader]),
        diffuse_color=(1.0, 1.0, 1.0, 1.0),
    )
    definition = {
        "version": 2,
        "base": {"tone": 1.0, "undertone": "warm"},
        "surface": {"roughness": 0.21},
        "features": {"freckles": {
            "enabled": False,
            "density": 0.18,
            "size": 0.45,
            "strength": 0.35,
            "color": "#80513F",
            "seed": 24301,
        }},
    }

    result = WORKER_MODULE.apply_skin_definition(
        SimpleNamespace(data=SimpleNamespace(materials=[material])),
        definition,
    )

    assert result["material_parameters"]["roughness_scale"] == 0.5
    assert roughness.default_value == pytest.approx(0.4)
    assert base_color.default_value[:3] == pytest.approx((0.624, 0.48, 0.3456))


def test_worker_generates_seeded_freckle_layout():
    settings = {
        "enabled": True,
        "density": 0.1,
        "size": 0.45,
        "strength": 0.35,
        "color": "#80513F",
        "seed": 24301,
    }

    spots = WORKER_MODULE.generate_skin_freckle_spots(settings, 128, 64)

    assert len(spots) == 80
    assert spots == WORKER_MODULE.generate_skin_freckle_spots(settings, 128, 64)
    assert spots[0] == pytest.approx((56.19259175658226, 16.706750452518463, 0.08027152073171737, 0.13194720307271926))
    assert all(0 <= x < 128 and 0 <= y < 64 and radius > 0 and opacity > 0
               for x, y, radius, opacity in spots)
    assert WORKER_MODULE.generate_skin_freckle_spots(
        {**settings, "enabled": False},
        128,
        64,
    ) == []


def test_worker_bakes_freckles_into_a_copy_of_the_head_diffuse_map():
    class FakePixels:
        def __init__(self, values):
            self.values = values

        def foreach_get(self, target):
            target[:] = array("f", self.values)

        def foreach_set(self, values):
            self.values = list(values)

    class FakeImage:
        def __init__(self, values):
            self.size = (256, 256)
            self.pixels = FakePixels(values)
            self.name = "HeadDiffuse"

        def copy(self):
            return FakeImage(self.pixels.values.copy())

        def update(self):
            pass

        def pack(self):
            pass

    original_image = FakeImage([0.5, 0.4, 0.3, 1.0] * (256 * 256))
    image_node = SimpleNamespace(type="TEX_IMAGE", image=original_image)
    color_input = SimpleNamespace(links=[SimpleNamespace(from_node=image_node)])
    shader = SimpleNamespace(type="BSDF_PRINCIPLED", inputs={"Base Color": color_input})
    material = SimpleNamespace(
        name="Std_Skin_Head_CC3PlusFemaleSkin",
        use_nodes=True,
        node_tree=SimpleNamespace(nodes=[shader, image_node]),
    )
    bpy = SimpleNamespace(data=SimpleNamespace(
        materials=SimpleNamespace(get=lambda name: material if name == material.name else None),
    ))
    settings = {
        "enabled": True,
        "density": 0.1,
        "size": 0.45,
        "strength": 0.35,
        "color": "#80513F",
        "seed": 24301,
    }

    count = WORKER_MODULE.apply_skin_freckles(bpy, settings)

    assert count == 80
    assert image_node.image is not original_image
    assert original_image.pixels.values[0:3] == [0.5, 0.4, 0.3]
    assert image_node.image.pixels.values != original_image.pixels.values


def test_skin_paint_worker_validation_is_bounded_and_region_scoped():
    stroke = {
        "material": "Std_Skin_Head",
        "tool": "paint",
        "color": "#c84051",
        "radius": 0.01,
        "opacity": 0.75,
        "points": [{"u": 0.25, "v": 0.4}, {"u": 0.3, "v": 0.45}],
    }
    assert WORKER_MODULE.validate_skin_paint_strokes([stroke], "skin_cc3plus_female_1") == [stroke]
    freckles_stroke = {**stroke, "material": "Std_Skin_Body", "tool": "freckles"}
    assert WORKER_MODULE.validate_skin_paint_strokes(
        [freckles_stroke],
        "skin_cc3plus_female_1",
    ) == [freckles_stroke]
    pressure_stroke = {
        **stroke,
        "points": [{"u": 0.25, "v": 0.4, "pressure": 0.2}],
    }
    assert WORKER_MODULE.validate_skin_paint_strokes(
        [pressure_stroke],
        "skin_cc3plus_female_1",
    ) == [pressure_stroke]
    erase_stroke = {**stroke, "tool": "erase"}
    assert WORKER_MODULE.validate_skin_paint_strokes(
        [erase_stroke],
        "skin_cc3plus_female_1",
    ) == [erase_stroke]
    with pytest.raises(ValueError, match="require an installed skin asset"):
        WORKER_MODULE.validate_skin_paint_strokes([stroke], None)
    with pytest.raises(ValueError, match="invalid brush settings"):
        WORKER_MODULE.validate_skin_paint_strokes(
            [{**stroke, "material": "Std_Skin_Eye"}],
            "skin_cc3plus_female_1",
        )
    with pytest.raises(ValueError, match="UV coordinates"):
        WORKER_MODULE.validate_skin_paint_strokes(
            [{**stroke, "points": [{"u": 1.1, "v": 0.5}]}],
            "skin_cc3plus_female_1",
        )
    with pytest.raises(ValueError, match="pressure must be a finite value"):
        WORKER_MODULE.validate_skin_paint_strokes(
            [{**stroke, "points": [{"u": 0.25, "v": 0.4, "pressure": 2}]}],
            "skin_cc3plus_female_1",
        )


def test_worker_applies_stylus_pressure_to_paint_size_and_opacity():
    legacy_samples = WORKER_MODULE.skin_paint_samples(
        [{"u": 0.5, "v": 0.5}],
        32,
        32,
        1.0,
    )
    assert legacy_samples == [(15.5, 15.5, 1.0, 1)]

    points = [
        {"u": 1 / 31, "v": 0.5, "pressure": 0.05},
        {"u": 30 / 31, "v": 0.5, "pressure": 1.0},
    ]

    samples = WORKER_MODULE.skin_paint_samples(points, 32, 32, 1.0)

    assert samples[0] == pytest.approx((1, 15.5, 0.5, 0.05))
    assert samples[-1] == pytest.approx((30, 15.5, 1.0, 1.0))
    assert len(samples) > 2
    assert 0.05 < samples[len(samples) // 2][3] < 1
    assert 1.0 * samples[0][3] < 1.0 * samples[-1][3]


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


@pytest.mark.skipif(
    "character_cc5_rlcc3plus_all_morphs_v1" not in WORKER_MODULE.CC3_ASSET,
    reason="The owner-supplied CC5/CC3+ blend and preview are not installed",
)
@pytest.mark.skipif(not BLENDER_EXECUTABLE, reason="Blender executable is not installed")
def test_blender_worker_imports_cc5_with_body_and_head_presets(tmp_path):
    asset_id = "character_cc5_rlcc3plus_all_morphs_v1"
    manifest = WORKER_MODULE.CC3_MORPH_MANIFESTS[asset_id]
    component_id = str(uuid.uuid4())
    preset_ids = {
        "body": "female_neutral_body_preset_4",
        "head": "female_neutral_head_preset_9",
    }
    job = create_job(
        tmp_path,
        operation="import_base_model",
        expected_scene_version=0,
        arguments={
            "component_id": component_id,
            "asset_id": asset_id,
            "preset_ids": preset_ids,
        },
    )

    completed = run_worker(job)

    assert completed.returncode == 0, completed.stderr
    result = json.loads((tmp_path / "output" / "result.json").read_text(encoding="utf-8"))["result"]
    assert result["body_preset"]["preset_ids"] == preset_ids
    assert result["body_preset"]["preset_mesh_name"] == "CC_Base_Body"
    assert set(result["body_preset"]["preset_following_mesh_names"]) == (
        set(manifest["mesh_names"]) - {"CC_Base_Body"}
    )
    assert result["body_preset"]["shape_key_count"] == manifest["body_shape_key_count"] + 1
    assert result["component_shape_key_count"] == (
        manifest["component_shape_key_count"]
        + manifest["mesh_count"] * len(preset_ids)
    )
    preset_inspection = (
        "import bpy,json;"
        f"component_id={json.dumps(component_id)};"
        "body=next(obj for obj in bpy.context.scene.objects "
        "if obj.type=='MESH' and obj.get('comodel_component_id')==component_id "
        "and obj.get('comodel_source_group')=='CC_Base_Body');"
        "result={'preset_ids':json.loads(body['comodel_cc5_preset_ids']),"
        "'shape_keys':sorted(key.name for key in body.data.shape_keys.key_blocks "
        "if key.name.startswith('CoModel_Preset_'))};"
        "print('CC5_COMPILED_PRESETS='+json.dumps(result,sort_keys=True))"
    )
    inspected = subprocess.run(
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
    assert inspected.returncode == 0, inspected.stderr
    compiled_presets = next(
        json.loads(line.split("=", 1)[1])
        for line in inspected.stdout.splitlines()
        if line.startswith("CC5_COMPILED_PRESETS=")
    )
    assert compiled_presets["preset_ids"] == preset_ids
    assert set(compiled_presets["shape_keys"]) == {
        f"CoModel_Preset_{preset_id}" for preset_id in preset_ids.values()
    }


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
    expected_preview_mesh_count = manifest["mesh_count"]
    expected_preview_skin_count = 1
    assert len(neutral_gltf["meshes"]) == expected_preview_mesh_count
    assert len(neutral_gltf["skins"]) == expected_preview_skin_count
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
        dependency_component_ids=[],
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
        dependency_component_ids=[],
    )
    saved = run_worker(save_job)
    assert saved.returncode == 0, saved.stderr
    save_report = json.loads((tmp_path / "output" / "result.json").read_text(encoding="utf-8"))
    assert save_report["result"]["morphs"] == values
    assert save_report["result"]["shape_key_count"] == manifest["body_shape_key_count"] - 1
    assert save_report["result"]["component_shape_key_count"] == manifest["component_shape_key_count"] - manifest["mesh_count"]
    assert preview_path.read_bytes() != neutral_preview
    saved_gltf = read_glb_json(preview_path)
    assert len(saved_gltf["meshes"]) == expected_preview_mesh_count
    assert len(saved_gltf["skins"]) == expected_preview_skin_count
    assert all(
        not mesh.get("extras", {}).get("targetNames")
        for mesh in saved_gltf["meshes"]
    )

    preset_job = create_job(
        tmp_path,
        operation="apply_cc3_body_preset",
        expected_scene_version=2,
        arguments={
            "component_id": component_id,
            "asset_id": asset_id,
            "morphs": values,
            "preset_ids": {
                "body": "female_neutral_body_preset_4",
                "head": "female_neutral_head_preset_9",
            },
        },
        scope_component_ids=[component_id],
        dependency_component_ids=[],
    )
    preset_applied = run_worker(preset_job)
    assert preset_applied.returncode == 0, preset_applied.stderr
    preset_report = json.loads((tmp_path / "output" / "result.json").read_text(encoding="utf-8"))
    assert preset_report["scene_version"] == 3
    assert preset_report["result"]["preset_ids"] == {
        "body": "female_neutral_body_preset_4",
        "head": "female_neutral_head_preset_9",
    }
    assert preset_report["result"]["preset_mesh_name"] == "CC_Base_Body"
    assert set(preset_report["result"]["preset_following_mesh_names"]) == (
        set(manifest["mesh_names"]) - {"CC_Base_Body"}
    )
    assert preset_report["result"]["shape_key_count"] == manifest["body_shape_key_count"] + 1
    assert preset_report["result"]["component_shape_key_count"] == (
        manifest["component_shape_key_count"] - manifest["mesh_count"] + 2 * manifest["mesh_count"]
    )
    preset_inspection = (
        "import bpy,json;"
        f"component_id={json.dumps(component_id)};"
        "key_names=['CoModel_Preset_female_neutral_body_preset_4',"
        "'CoModel_Preset_female_neutral_head_preset_9'];"
        "result={key_name:{obj.get('comodel_source_group'):{"
        "'value':obj.data.shape_keys.key_blocks[key_name].value,"
        "'moved_vertices':sum((obj.data.shape_keys.key_blocks[key_name].data[i].co-"
        "obj.data.shape_keys.key_blocks[0].data[i].co).length>1e-6 "
        "for i in range(len(obj.data.vertices)))} "
        "for obj in bpy.context.scene.objects "
        "if obj.type=='MESH' and obj.get('comodel_component_id')==component_id "
        "and obj.get('comodel_source_group')!='CC_Base_Body' "
        "and obj.data.shape_keys is not None "
        "and key_name in obj.data.shape_keys.key_blocks} for key_name in key_names};"
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
    expected_followers = set(manifest["mesh_names"]) - {"CC_Base_Body"}
    assert set(preset_followers) == {
        "CoModel_Preset_female_neutral_body_preset_4",
        "CoModel_Preset_female_neutral_head_preset_9",
    }
    assert all(set(followers) == expected_followers for followers in preset_followers.values())
    assert all(
        follower["value"] == 1.0 and follower["moved_vertices"] > 0
        for followers in preset_followers.values()
        for follower in followers.values()
    )

    undo_preset_job = create_job(
        tmp_path,
        operation="apply_cc3_body_preset",
        expected_scene_version=3,
        arguments={
            "component_id": component_id,
            "asset_id": asset_id,
            "morphs": values,
            "preset_ids": {"body": None, "head": None},
        },
        scope_component_ids=[component_id],
        dependency_component_ids=[],
    )
    preset_undone = run_worker(undo_preset_job)
    assert preset_undone.returncode == 0, preset_undone.stderr
    undo_report = json.loads((tmp_path / "output" / "result.json").read_text(encoding="utf-8"))
    assert undo_report["scene_version"] == 4
    assert undo_report["result"]["preset_ids"] == {"body": None, "head": None}
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
        dependency_component_ids=[],
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
