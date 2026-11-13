"""Allowlisted Blender worker scaffold for CoModel Studio.

It reads typed JSON arguments from an API-created job file; it does not execute
code from the model.
Run using: blender --background --python worker_entry.py -- --job /path/to/job.json
"""
from __future__ import annotations

import argparse
from array import array
import hashlib
import json
import math
import os
import random
import re
import shutil
import struct
import sys
import tempfile
from pathlib import Path
from uuid import UUID

API_TRANSACTION_CONTRACT_VERSION = "transaction-v1"
WORKER_CONTRACT_VERSION = "worker-staged-v1"
SUPPORTED_API_CONTRACT_VERSIONS = {API_TRANSACTION_CONTRACT_VERSION}

ALLOWED_OPERATIONS = {
    "import_base_model",
    "apply_cc3_morph_controls",
    "apply_cc3_body_preset",
    "preview_cc3_morph_controls",
    "bake_cc3_morph_controls",
    "restore_checkpoint",
    "validate_scene_structure",
}
MAX_JOB_BYTES = 1024 * 1024
COMPONENT_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
CC3_ASSET_CONFIG = {
    "character_cc3_morphs_v1": {
        "format": "glb",
        "filename": "assets/CC3_Base_Female_Morphs.glb",
        "manifest_filename": "cc3_morph_manifest.json",
    },
    "character_cc3_male_morphs_v1": {
        "format": "glb",
        "filename": "assets/CC3_Base_Male_Morphs.glb",
        "manifest_filename": "cc3_male_morph_manifest.json",
    },
    "character_cc5_rlcc3plus_all_morphs_v1": {
        "format": "blend",
        "filename": "assets/RL_CC3_Plus_Base_all_morphs.blend",
        "manifest_filename": "cc5_rlcc3plus_manifest.json",
    },
}
CC3_MODEL_HEIGHT = 2.7
CC3_SHARED_ROOT = Path(__file__).resolve().parents[2] / "shared"
PROJECT_ROOT = Path(__file__).resolve().parents[3]
CC5_BODY_PRESETS_MANIFEST = json.loads(
    (CC3_SHARED_ROOT / "cc5_body_presets.json").read_text(encoding="utf-8")
)
CC5_BODY_PRESETS = {
    preset["id"]: preset
    for preset in CC5_BODY_PRESETS_MANIFEST["presets"]
}
EYE_ASSETS_MANIFEST = json.loads(
    (CC3_SHARED_ROOT / "eye_assets.json").read_text(encoding="utf-8")
)
EYE_ASSETS = {asset["id"]: asset for asset in EYE_ASSETS_MANIFEST["assets"]}
SKIN_ASSETS_PATH = CC3_SHARED_ROOT / "skin_assets.json"
SKIN_ASSETS_MANIFEST = (
    json.loads(SKIN_ASSETS_PATH.read_text(encoding="utf-8"))
    if SKIN_ASSETS_PATH.is_file() and not SKIN_ASSETS_PATH.is_symlink()
    else {"assets": []}
)
SKIN_ASSETS = {asset["id"]: asset for asset in SKIN_ASSETS_MANIFEST.get("assets", [])}
CC5_PREVIEW_SUBDIVISION_LEVELS = {
    "CC_Base_Body": 1,
    "CC_Base_EyeOcclusion": 2,
    "CC_Base_TearLine": 2,
}


def load_cc3_manifests() -> dict[str, dict]:
    manifests = {}
    for asset_id, config in CC3_ASSET_CONFIG.items():
        path = CC3_SHARED_ROOT / config["manifest_filename"]
        if path.is_file() and not path.is_symlink():
            manifest = json.loads(path.read_text(encoding="utf-8"))
            if manifest.get("asset_id") != asset_id:
                raise RuntimeError(f"CC3 manifest asset ID does not match {asset_id}.")
            manifests[asset_id] = manifest
    return manifests


CC3_MORPH_MANIFESTS = load_cc3_manifests()
CC3_ASSET = {
    asset_id: {
        "format": config.get("format", "glb"),
        "filename": config["filename"],
        "sha256": CC3_MORPH_MANIFESTS[asset_id].get(
            "blend_sha256",
            CC3_MORPH_MANIFESTS[asset_id]["glb_sha256"],
        ),
        "preview_sha256": CC3_MORPH_MANIFESTS[asset_id]["glb_sha256"],
        "max_bytes": (
            2 * 1024 * 1024 * 1024
            if config.get("format") == "blend"
            else 512 * 1024 * 1024
        ),
        "object_names": set(CC3_MORPH_MANIFESTS[asset_id].get("object_names", [])),
        "mesh_names": set(CC3_MORPH_MANIFESTS[asset_id].get(
            "mesh_names",
            ["CC_Base_Body", "CC_Base_Eye", "CC_Base_Teeth", "CC_Base_Tongue"],
        )),
        "mesh_count": CC3_MORPH_MANIFESTS[asset_id].get("mesh_count", 4),
        "body_vertices": CC3_MORPH_MANIFESTS[asset_id].get("body_vertex_count", 14647),
        "source_body_vertices": CC3_MORPH_MANIFESTS[asset_id].get("source_body_vertex_count"),
        "body_shape_keys": CC3_MORPH_MANIFESTS[asset_id]["body_shape_key_count"],
        "armature_name": CC3_MORPH_MANIFESTS[asset_id].get("armature_name", "CC_Base"),
        "bone_count": CC3_MORPH_MANIFESTS[asset_id].get("bone_count", 101),
    }
    for asset_id, config in CC3_ASSET_CONFIG.items()
    if asset_id in CC3_MORPH_MANIFESTS
}
CC3_MORPH_SPECS_BY_ASSET = {
    asset_id: manifest["controls"]
    for asset_id, manifest in CC3_MORPH_MANIFESTS.items()
}
CC3_MORPH_CONTROLS_BY_ASSET = {
    asset_id: {
        control["id"]: (control["positive_shape_key"], control["negative_shape_key"])
        for control in specs
    }
    for asset_id, specs in CC3_MORPH_SPECS_BY_ASSET.items()
}
CC3_MORPH_MANIFEST = CC3_MORPH_MANIFESTS["character_cc3_morphs_v1"]
CC3_MORPH_SPECS = CC3_MORPH_MANIFEST["controls"]
CC3_MORPH_CONTROLS = {
    control["id"]: (control["positive_shape_key"], control["negative_shape_key"])
    for control in CC3_MORPH_SPECS
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", required=True, help="Path to API-created validated job JSON")
    parser.add_argument("--staged-only", action="store_true")
    return parser.parse_args(argv)


def validate_cc5_preset_ids(value: object) -> dict[str, str | None]:
    if not isinstance(value, dict) or set(value) != {"body", "head"}:
        raise ValueError("preset_ids must contain body and head selections")
    for kind, preset_id in value.items():
        if preset_id is not None and (
            not isinstance(preset_id, str)
            or preset_id not in CC5_BODY_PRESETS
            or CC5_BODY_PRESETS[preset_id].get("kind") != kind
        ):
            raise ValueError(f"{kind} preset is not an available CC5 character preset")
    return value


def load_job(job_path: Path, staged_only: bool = False) -> dict:
    if job_path.is_symlink():
        raise ValueError("Job file cannot be a symbolic link")
    job_path = job_path.resolve()
    if not job_path.is_file() or job_path.suffix.lower() != ".json":
        raise ValueError("Job file must be an existing JSON file")
    if job_path.stat().st_size > MAX_JOB_BYTES:
        raise ValueError("Job file exceeds the configured size limit")
    data = json.loads(job_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Job payload must be an object")

    required_keys = {
        "job_id",
        "project_id",
        "operation_id",
        "expected_scene_version",
        "operation",
        "scope_component_ids",
        "dependency_component_ids",
        "arguments",
    }
    if staged_only:
        required_keys.update({
            "transaction_id", "attempt_id", "api_contract_version", "worker_contract_version",
        })
    if set(data) != required_keys:
        raise ValueError("Job payload contains missing or unsupported fields")
    if staged_only and (
        not isinstance(data["api_contract_version"], str)
        or data["api_contract_version"] not in SUPPORTED_API_CONTRACT_VERSIONS
        or not isinstance(data["worker_contract_version"], str)
        or data["worker_contract_version"] != WORKER_CONTRACT_VERSION
    ):
        raise ValueError("Job payload uses an unsupported transaction worker contract version")
    id_keys = ["job_id", "project_id", "operation_id"]
    if staged_only:
        id_keys.extend(("transaction_id", "attempt_id"))
    for key in id_keys:
        try:
            UUID(data[key])
        except (ValueError, TypeError, AttributeError) as exc:
            raise ValueError(f"{key} must be a UUID") from exc
    expected_version = data["expected_scene_version"]
    if isinstance(expected_version, bool) or not isinstance(expected_version, int) or expected_version < 0:
        raise ValueError("expected_scene_version must be a non-negative integer")

    operation = data.get("operation")
    if operation not in ALLOWED_OPERATIONS:
        raise ValueError("Operation is not allowlisted")
    if not isinstance(data.get("arguments", {}), dict):
        raise ValueError("arguments must be an object")

    scope_ids = data["scope_component_ids"]
    dependency_ids = data["dependency_component_ids"]
    if not isinstance(scope_ids, list) or not isinstance(dependency_ids, list):
        raise ValueError("Component scope and dependencies must be arrays")
    for component_id in scope_ids + dependency_ids:
        safe_component_id(component_id)
    if len(set(scope_ids)) != len(scope_ids) or len(set(dependency_ids)) != len(dependency_ids):
        raise ValueError("Component scope and dependencies must not contain duplicates")

    arguments = data["arguments"]
    allowed_arguments = {
        "import_base_model": set(),
        "apply_cc3_morph_controls": {"component_id", "asset_id", "morphs"},
        "apply_cc3_body_preset": {
            "component_id", "asset_id", "morphs", "preset_id", "preset_ids",
        },
        "preview_cc3_morph_controls": {"component_id", "asset_id", "morphs"},
        "bake_cc3_morph_controls": {"component_id", "asset_id", "morphs"},
        "restore_checkpoint": {"checkpoint_scene_version"},
        "validate_scene_structure": set(),
    }[operation]
    if operation == "import_base_model":
        allowed_import_fields = {
            "component_id", "asset_id", "morphs", "preset_id", "preset_ids",
            "eye_attachment", "skin_asset_id", "skin_paint_strokes", "skin_definition",
        }
        if (
            not {"component_id", "asset_id"} <= set(arguments)
            or set(arguments) - allowed_import_fields
            or {"preset_id", "preset_ids"} <= set(arguments)
        ):
            raise ValueError("Operation arguments contain missing or unsupported fields")
        if "preset_ids" in arguments:
            if arguments["asset_id"] != "character_cc5_rlcc3plus_all_morphs_v1":
                raise ValueError("Character presets require the CC5/CC3+ source model")
            validate_cc5_preset_ids(arguments["preset_ids"])
    elif operation == "apply_cc3_body_preset":
        required_preset_fields = {"component_id", "asset_id", "morphs"}
        valid_preset_fields = (
            required_preset_fields | {"preset_id"},
            required_preset_fields | {"preset_ids"},
        )
        if set(arguments) not in valid_preset_fields:
            raise ValueError("Operation arguments contain missing or unsupported fields")
    elif set(arguments) != allowed_arguments:
        raise ValueError("Operation arguments contain missing or unsupported fields")
    if "component_id" in arguments:
        safe_component_id(arguments["component_id"])
    if operation == "import_base_model":
        if arguments["asset_id"] not in CC3_ASSET:
            raise ValueError("asset_id is not an allowlisted source asset")
        if scope_ids or dependency_ids:
            raise ValueError("CC3 import must have an empty input scope")
        if "morphs" in arguments:
            _validate_morph_map(arguments["asset_id"], arguments["morphs"])
        preset_id = arguments.get("preset_id")
        if preset_id is not None and (
            not isinstance(preset_id, str)
            or arguments["asset_id"] != "character_cc5_rlcc3plus_all_morphs_v1"
            or preset_id not in CC5_BODY_PRESETS
        ):
            raise ValueError("preset_id is not an available CC5 character preset")
        if preset_id is not None and CC5_BODY_PRESETS[preset_id].get("kind") not in {"body", "head"}:
            raise ValueError("preset_id is not an available CC5 character preset")
        eye_attachment = arguments.get("eye_attachment")
        if eye_attachment is not None and (
            not isinstance(eye_attachment, dict)
            or set(eye_attachment) != {"asset_id", "component_id"}
            or eye_attachment["asset_id"] not in EYE_ASSETS
        ):
            raise ValueError("eye_attachment must identify an allowlisted eye and component")
        if eye_attachment is not None:
            safe_component_id(eye_attachment["component_id"])
            if eye_attachment["component_id"] == arguments["component_id"]:
                raise ValueError("Body and eye components must have distinct IDs")
        skin_asset_id = arguments.get("skin_asset_id")
        if skin_asset_id is not None and (
            not isinstance(skin_asset_id, str)
            or skin_asset_id not in SKIN_ASSETS
            or arguments["asset_id"] not in SKIN_ASSETS[skin_asset_id].get("compatible_asset_ids", [])
            or not skin_asset_is_integrity_valid(SKIN_ASSETS[skin_asset_id])
        ):
            raise ValueError("skin_asset_id must identify an installed compatible skin asset")
        validate_skin_paint_strokes(
            arguments.get("skin_paint_strokes", []),
            skin_asset_id,
        )
        if "skin_definition" in arguments:
            validate_skin_definition(arguments["skin_definition"])
            if skin_asset_id is None:
                raise ValueError("skin_definition requires a selected skin asset")
    elif operation in {
        "apply_cc3_morph_controls",
        "apply_cc3_body_preset",
        "preview_cc3_morph_controls",
        "bake_cc3_morph_controls",
    }:
        component_id = arguments["component_id"]
        asset_id = arguments["asset_id"]
        if asset_id not in CC3_ASSET:
            raise ValueError("asset_id is not an allowlisted source asset")
        if (
            scope_ids != [component_id]
            or dependency_ids
        ):
            raise ValueError("CC3 morph controls must scope only their character component")
        morphs = _validate_morph_map(asset_id, arguments["morphs"])
        if operation == "bake_cc3_morph_controls" and not any(morphs.values()):
            raise ValueError("At least one non-neutral morph value is required to bake the character")
        if operation == "apply_cc3_body_preset":
            if asset_id != "character_cc5_rlcc3plus_all_morphs_v1":
                raise ValueError("Character presets require an allowlisted CC5/CC3+ preset")
            preset_fields = set(arguments) - {"component_id", "asset_id", "morphs"}
            if preset_fields == {"preset_ids"}:
                validate_cc5_preset_ids(arguments["preset_ids"])
            elif preset_fields == {"preset_id"}:
                preset_id = arguments["preset_id"]
                if preset_id is not None and (
                    not isinstance(preset_id, str)
                    or preset_id not in CC5_BODY_PRESETS
                ):
                    raise ValueError("preset_id is not an available CC5 character preset")
            else:
                raise ValueError("Operation arguments contain missing or unsupported fields")
    elif operation == "restore_checkpoint":
        checkpoint_version = arguments["checkpoint_scene_version"]
        if isinstance(checkpoint_version, bool) or not isinstance(checkpoint_version, int) or checkpoint_version < 0:
            raise ValueError("checkpoint_scene_version must be a non-negative integer")
        if scope_ids or dependency_ids:
            raise ValueError("Checkpoint restore cannot declare component scope")
    elif scope_ids or dependency_ids:
        raise ValueError("Scene validation cannot declare component scope")

    data["_job_root"] = str(job_path.parent)
    return data


def safe_component_id(value: object) -> str:
    if not isinstance(value, str) or not COMPONENT_ID_PATTERN.fullmatch(value):
        raise ValueError("component_id contains unsupported characters")
    return value


def _validate_morph_map(asset_id: str, morphs: object) -> dict:
    controls = CC3_MORPH_CONTROLS_BY_ASSET[asset_id]
    if not isinstance(morphs, dict) or set(morphs) != set(controls):
        raise ValueError("morphs must specify every supported CC3 control")
    controls_by_id = {
        control["id"]: control
        for control in CC3_MORPH_SPECS_BY_ASSET[asset_id]
    }
    for control_id, value in morphs.items():
        spec = controls_by_id[control_id]
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            or not spec["minimum"] <= value <= spec["maximum"]
        ):
            raise ValueError(
                f"morph {control_id} must be a finite number from "
                f"{spec['minimum']} to {spec['maximum']}"
            )
    return morphs


def get_or_create_collection(bpy, name: str):
    collection = bpy.data.collections.get(name)
    if collection is None:
        collection = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(collection)
    return collection


def move_to_collection(obj, collection):
    for old_collection in list(obj.users_collection):
        old_collection.objects.unlink(obj)
    collection.objects.link(obj)










def validate_scene_structure(bpy) -> dict:
    ids = []
    component_ids = set()
    duplicate_ids = []
    for obj in bpy.context.scene.objects:
        object_id = obj.get("comodel_object_id")
        component_id = obj.get("comodel_component_id")
        if component_id:
            component_ids.add(component_id)
        if object_id:
            if object_id in ids:
                duplicate_ids.append(object_id)
            ids.append(object_id)
    return {
        "object_count": len(bpy.context.scene.objects),
        "objects_with_comodel_ids": len(ids),
        "component_ids": sorted(component_ids),
        "duplicate_object_ids": duplicate_ids,
        "status": "fail" if duplicate_ids else "pass",
    }










































def apply_cc3_morph_controls(bpy, args: dict) -> dict:
    component_id = safe_component_id(args["component_id"])
    asset_id = args["asset_id"]
    controls = CC3_MORPH_CONTROLS_BY_ASSET.get(asset_id)
    if controls is None:
        raise ValueError("asset_id is not an allowlisted source asset")
    body = bpy.data.objects.get("CC_Base_Body")
    if CC3_ASSET[asset_id]["format"] == "blend":
        body = next(
            (
                obj
                for obj in bpy.context.scene.objects
                if obj.type == "MESH"
                and obj.get("comodel_component_id") == component_id
                and obj.get("comodel_source_asset_id") == asset_id
                and obj.get("comodel_source_group") == "CC_Base_Body"
            ),
            None,
        )
    if (
        body is None
        or body.get("comodel_component_id") != component_id
        or body.get("comodel_source_asset_id") != asset_id
        or body.data.shape_keys is None
    ):
        raise ValueError("SCOPE_VIOLATION: CC3 morph target is not the tagged CC3 body")

    values = args["morphs"]
    target_meshes = (
        [
            obj
            for obj in bpy.context.scene.objects
            if obj.type == "MESH"
            and obj.get("comodel_component_id") == component_id
            and obj.get("comodel_source_asset_id") == asset_id
        ]
        if CC3_ASSET[asset_id]["format"] == "blend"
        else [body]
    )
    if (
        CC3_ASSET[asset_id]["format"] == "blend"
        and len(target_meshes) != CC3_ASSET[asset_id]["mesh_count"]
    ):
        raise ValueError("VALIDATION_FAILED: imported CC3 morph component has an unexpected mesh count")
    for morph_name, (positive_key, negative_key) in controls.items():
        value = float(values[morph_name])
        for key_name, key_value in (
            (positive_key, max(value, 0.0)),
            (negative_key, max(-value, 0.0)),
        ):
            if key_name is None:
                continue
            affected_meshes = 0
            for target in target_meshes:
                shape_keys = target.data.shape_keys
                key_blocks = shape_keys.key_blocks if shape_keys is not None else None
                if key_blocks is not None and key_name in key_blocks:
                    key_blocks[key_name].value = key_value
                    affected_meshes += 1
            if affected_meshes == 0:
                raise ValueError(f"VALIDATION_FAILED: CC3 component is missing shape key {key_name}")

    body["comodel_cc3_morph_controls_json"] = json.dumps(
        {name: float(values[name]) for name in controls},
        sort_keys=True,
        separators=(",", ":"),
    )
    bpy.context.view_layer.update()
    result = {
        "component_id": component_id,
        "morphs": {name: float(values[name]) for name in controls},
        "shape_key_count": len(body.data.shape_keys.key_blocks) - 1,
        "component_shape_key_count": sum(
            len(mesh.data.shape_keys.key_blocks) - 1
            for mesh in target_meshes
            if mesh.data.shape_keys is not None
        ),
    }
    return result


def _apply_cc3_single_preset(
    bpy,
    args: dict,
    *,
    preset_kind: str,
) -> dict:
    component_id = safe_component_id(args["component_id"])
    asset_id = args["asset_id"]
    if asset_id != "character_cc5_rlcc3plus_all_morphs_v1":
        raise ValueError("Body presets require the CC5/CC3+ source model")
    body = next(
        (
            obj
            for obj in bpy.context.scene.objects
            if obj.type == "MESH"
            and obj.get("comodel_component_id") == component_id
            and obj.get("comodel_source_asset_id") == asset_id
            and obj.get("comodel_source_group") == "CC_Base_Body"
        ),
        None,
    )
    if body is None or body.data.shape_keys is None:
        raise ValueError("SCOPE_VIOLATION: the CC5 body mesh is unavailable")

    accessory_meshes = sorted(
        (
            obj
            for obj in bpy.context.scene.objects
            if obj.type == "MESH"
            and obj.get("comodel_component_id") == component_id
            and obj.get("comodel_source_asset_id") == asset_id
            and obj is not body
        ),
        key=lambda obj: obj.get("comodel_source_group", obj.name),
    )
    expected_accessory_names = CC3_ASSET[asset_id]["mesh_names"] - {"CC_Base_Body"}
    if {obj.get("comodel_source_group") for obj in accessory_meshes} != expected_accessory_names:
        raise ValueError("SCOPE_VIOLATION: CC5 accessory meshes do not match the pinned character")

    preset_id = args["preset_id"]
    preset_ids_json = body.get("comodel_cc5_preset_ids")
    if preset_ids_json is None:
        legacy_preset_id = body.get("comodel_cc5_body_preset")
        current_preset_ids = {}
        if legacy_preset_id in CC5_BODY_PRESETS:
            current_preset_ids[CC5_BODY_PRESETS[legacy_preset_id]["kind"]] = legacy_preset_id
    else:
        current_preset_ids = json.loads(preset_ids_json)
        if (
            not isinstance(current_preset_ids, dict)
            or any(kind not in {"body", "head"} for kind in current_preset_ids)
            or any(
                selected_id not in CC5_BODY_PRESETS
                or CC5_BODY_PRESETS[selected_id].get("kind") != kind
                for kind, selected_id in current_preset_ids.items()
            )
        ):
            raise ValueError("The scene contains invalid CC5 preset metadata")
    current_preset_id = current_preset_ids.get(preset_kind)
    current_key_name = (
        f"CoModel_Preset_{current_preset_id}"
        if current_preset_id
        else "CoModel_Female_Neutral_Body_Preset_1"
    )
    if preset_id is None:
        for mesh in [body, *accessory_meshes]:
            accessory_key = (
                mesh.data.shape_keys.key_blocks.get(current_key_name)
                if mesh.data.shape_keys is not None
                else None
            )
            if accessory_key is not None:
                mesh.shape_key_remove(accessory_key)
        current_preset_ids.pop(preset_kind, None)
    else:
        preset = CC5_BODY_PRESETS.get(preset_id)
        if preset is None:
            raise ValueError("preset_id is not an available CC5 character preset")
        if preset.get("kind") != preset_kind:
            raise ValueError("preset_id does not match the requested character preset kind")
        preset_key_name = f"CoModel_Preset_{preset_id}"
        for mesh in [body, *accessory_meshes]:
            old_key = (
                mesh.data.shape_keys.key_blocks.get(current_key_name)
                if mesh.data.shape_keys is not None
                else None
            )
            if old_key is not None:
                mesh.shape_key_remove(old_key)
        existing_key = None
        source_path = PROJECT_ROOT / preset["source_path"]
        try:
            source_path.resolve().relative_to(PROJECT_ROOT)
        except ValueError as error:
            raise ValueError("Body preset source path is outside the project") from error
        if source_path.is_symlink() or not source_path.is_file():
            raise ValueError("Body preset source file is unavailable")
        if _sha256_file(source_path) != preset["source_sha256"]:
            raise ValueError("Body preset source hash does not match the pinned asset")

        objects_before_import = set(bpy.data.objects)
        try:
            bpy.ops.import_scene.fbx(filepath=str(source_path), use_anim=False)
            imported_objects = set(bpy.data.objects) - objects_before_import
            preset_mesh = next(
                (
                    obj
                    for obj in imported_objects
                    if obj.type == "MESH"
                    and obj.name.rsplit(".", 1)[0] == preset["mesh_name"]
                ),
                None,
            )
            if preset_mesh is None or preset_mesh.data.shape_keys is None:
                raise ValueError("Body preset FBX is missing its expected Basis mesh")
            if (
                len(body.data.vertices) != len(preset_mesh.data.vertices)
                or len(body.data.polygons) != len(preset_mesh.data.polygons)
                or any(
                    tuple(source_polygon.vertices) != tuple(preset_polygon.vertices)
                    for source_polygon, preset_polygon in zip(
                        body.data.polygons,
                        preset_mesh.data.polygons,
                        strict=True,
                    )
                )
            ):
                raise ValueError("Body preset topology does not match the CC5 body mesh")

            if existing_key is None:
                existing_key = body.shape_key_add(name=preset_key_name, from_mix=False)
                preset_basis = preset_mesh.data.shape_keys.key_blocks[0]
                body_inverse = body.matrix_world.inverted()
                for destination, source in zip(
                    existing_key.data,
                    preset_basis.data,
                    strict=True,
                ):
                    destination.co = body_inverse @ (preset_mesh.matrix_world @ source.co)
            existing_key.value = 1.0
            body.data.calc_loop_triangles()
            triangles = [
                tuple(triangle.vertices)
                for triangle in body.data.loop_triangles
            ]
            from mathutils.bvhtree import BVHTree

            body_bvh = BVHTree.FromPolygons(
                [vertex.co.copy() for vertex in body.data.vertices],
                triangles,
                all_triangles=True,
            )
            body_basis = body.data.shape_keys.key_blocks[0]
            body_world_to_local = body.matrix_world.inverted()
            accessory_names = []
            for accessory in accessory_meshes:
                if accessory.data.shape_keys is None:
                    accessory.shape_key_add(name="Basis", from_mix=False)
                accessory_key = accessory.data.shape_keys.key_blocks.get(preset_key_name)
                if accessory_key is not None:
                    accessory.shape_key_remove(accessory_key)
                accessory_key = accessory.shape_key_add(name=preset_key_name, from_mix=False)
                accessory_key.value = 1.0
                accessory_world_to_local = accessory.matrix_world.inverted()
                body_to_accessory = (
                    accessory_world_to_local.to_3x3()
                    @ body.matrix_world.to_3x3()
                )
                for vertex_index, destination in enumerate(accessory_key.data):
                    body_local_point = body_world_to_local @ (
                        accessory.matrix_world @ destination.co
                    )
                    nearest = body_bvh.find_nearest(body_local_point)
                    if nearest is None or nearest[2] is None:
                        raise ValueError("Could not map a CC5 accessory vertex to the preset body")
                    closest_point, _, triangle_index, _ = nearest
                    first, second, third = triangles[triangle_index]
                    a = body.data.vertices[first].co
                    edge_a = body.data.vertices[second].co - a
                    edge_b = body.data.vertices[third].co - a
                    point_offset = closest_point - a
                    dot_aa = edge_a.dot(edge_a)
                    dot_ab = edge_a.dot(edge_b)
                    dot_bb = edge_b.dot(edge_b)
                    dot_pa = point_offset.dot(edge_a)
                    dot_pb = point_offset.dot(edge_b)
                    denominator = dot_aa * dot_bb - dot_ab * dot_ab
                    if abs(denominator) <= 1e-20:
                        raise ValueError("The CC5 body contains a degenerate triangle")
                    weight_b = (dot_bb * dot_pa - dot_ab * dot_pb) / denominator
                    weight_c = (dot_aa * dot_pb - dot_ab * dot_pa) / denominator
                    weight_a = 1.0 - weight_b - weight_c
                    body_delta = (
                        (existing_key.data[first].co - body_basis.data[first].co) * weight_a
                        + (existing_key.data[second].co - body_basis.data[second].co) * weight_b
                        + (existing_key.data[third].co - body_basis.data[third].co) * weight_c
                    )
                    destination.co += body_to_accessory @ body_delta
                accessory_names.append(accessory.get("comodel_source_group", accessory.name))
            current_preset_ids[preset_kind] = preset_id
        finally:
            for obj in set(bpy.data.objects) - objects_before_import:
                bpy.data.objects.remove(obj, do_unlink=True)

    if current_preset_ids:
        body["comodel_cc5_preset_ids"] = json.dumps(current_preset_ids, sort_keys=True)
    else:
        body.pop("comodel_cc5_preset_ids", None)
    for kind in ("body", "head"):
        property_name = f"comodel_cc5_{kind}_preset"
        selected_id = current_preset_ids.get(kind)
        if selected_id is None:
            body.pop(property_name, None)
        else:
            body[property_name] = selected_id
    bpy.context.view_layer.update()
    preset_following_mesh_names = (
        accessory_names if preset_id is not None else []
    )
    result = {
        "component_id": component_id,
        "preset_id": preset_id,
        "preset_mesh_name": preset["mesh_name"] if preset_id is not None else None,
        "preset_following_mesh_names": preset_following_mesh_names,
        "preset_vertex_count": len(body.data.vertices),
        "shape_key_count": len(body.data.shape_keys.key_blocks) - 1,
        "component_shape_key_count": sum(
            len(obj.data.shape_keys.key_blocks) - 1
            for obj in bpy.context.scene.objects
            if obj.type == "MESH"
            and obj.get("comodel_component_id") == component_id
            and obj.data.shape_keys is not None
        ),
    }
    return result


def apply_cc3_body_preset(bpy, args: dict) -> dict:
    if "preset_ids" in args:
        preset_ids = validate_cc5_preset_ids(args["preset_ids"])
    elif args.get("preset_id") is not None:
        preset_id = args["preset_id"]
        preset = CC5_BODY_PRESETS.get(preset_id)
        if preset is None:
            raise ValueError("preset_id is not an available CC5 character preset")
        preset_ids = {"body": None, "head": None}
        preset_ids[preset["kind"]] = preset_id
    else:
        preset_ids = {"body": None, "head": None}

    results = [
        _apply_cc3_single_preset(
            bpy,
            {
                **args,
                "preset_id": preset_ids[kind],
            },
            preset_kind=kind,
        )
        for kind in ("body", "head")
    ]
    result = results[-1]
    result["preset_ids"] = preset_ids
    result["preset_id"] = args.get("preset_id")
    result["preset_mesh_name"] = (
        "CC_Base_Body" if any(preset_ids.values()) else None
    )
    result["preset_following_mesh_names"] = (
        next(
            (
                item["preset_following_mesh_names"]
                for item in results
                if item["preset_id"] is not None
            ),
            [],
        )
    )
    return result


def bake_cc3_morph_controls(bpy, args: dict) -> dict:
    applied = apply_cc3_morph_controls(bpy, args)
    body = next(
        (
            obj
            for obj in bpy.context.scene.objects
            if obj.type == "MESH"
            and obj.get("comodel_component_id") == applied["component_id"]
            and obj.get("comodel_source_asset_id") == args["asset_id"]
            and (
                obj.get("comodel_source_group") == "CC_Base_Body"
                if CC3_ASSET[args["asset_id"]]["format"] == "blend"
                else obj.name == "CC_Base_Body"
            )
        ),
        None,
    )
    if body is None:
        raise ValueError("VALIDATION_FAILED: CC3 body mesh is unavailable for baking")
    target_meshes = (
        [
            obj
            for obj in bpy.context.scene.objects
            if obj.type == "MESH"
            and obj.get("comodel_component_id") == applied["component_id"]
            and obj.get("comodel_source_asset_id") == args["asset_id"]
        ]
        if CC3_ASSET[args["asset_id"]]["format"] == "blend"
        else [body]
    )
    shape_keys = body.data.shape_keys
    if shape_keys is None or len(shape_keys.key_blocks) < 2:
        raise ValueError("VALIDATION_FAILED: CC3 body has no editable morph shape keys to bake")

    active_object = bpy.context.view_layer.objects.active
    selected_objects = list(bpy.context.selected_objects)
    try:
        if active_object is not None and active_object.mode != "OBJECT":
            bpy.context.view_layer.objects.active = active_object
            bpy.ops.object.mode_set(mode="OBJECT")
        for obj in bpy.context.selected_objects:
            obj.select_set(False)
        for target in target_meshes:
            if target.data.shape_keys is None:
                continue
            if target.mode != "OBJECT":
                bpy.context.view_layer.objects.active = target
                bpy.ops.object.mode_set(mode="OBJECT")
            target.select_set(True)
            bpy.context.view_layer.objects.active = target
            target.active_shape_key_index = 1
            bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
            target.select_set(False)
        bpy.context.view_layer.update()
    finally:
        for target in target_meshes:
            target.select_set(False)
        for obj in selected_objects:
            if obj.name in bpy.context.view_layer.objects:
                obj.select_set(True)
        if active_object is not None and active_object.name in bpy.context.view_layer.objects:
            bpy.context.view_layer.objects.active = active_object

    if any(mesh.data.shape_keys is not None for mesh in target_meshes):
        raise ValueError("VALIDATION_FAILED: baked CC3 component shape keys were not removed")
    body["comodel_cc3_morph_controls_json"] = json.dumps(
        {name: 0.0 for name in CC3_MORPH_CONTROLS_BY_ASSET[args["asset_id"]]},
        sort_keys=True,
        separators=(",", ":"),
    )
    result = {
        "component_id": applied["component_id"],
        "baked_morphs": applied["morphs"],
        "shape_key_count": 0,
        "baked_vertex_count": len(body.data.vertices),
        "baked_component_vertex_count": sum(len(mesh.data.vertices) for mesh in target_meshes),
        "component_shape_key_count": 0,
    }
    return result




def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source_file:
        for chunk in iter(lambda: source_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def skin_asset_is_integrity_valid(asset: dict) -> bool:
    files = [
        (asset.get("material_library_path"), asset.get("material_library_sha256")),
    ]
    materials = asset.get("materials")
    if not isinstance(materials, dict) or set(materials) != {
        "Std_Skin_Head",
        "Std_Skin_Body",
        "Std_Skin_Arm",
        "Std_Skin_Leg",
    }:
        return False
    for maps in materials.values():
        if not isinstance(maps, dict):
            return False
        files.extend(
            (maps.get(map_name, {}).get("path"), maps.get(map_name, {}).get("sha256"))
            for map_name in ("diffuse", "normal")
        )
    for relative_path, expected_hash in files:
        if not isinstance(relative_path, str) or not isinstance(expected_hash, str):
            return False
        path = PROJECT_ROOT / relative_path
        try:
            path.resolve().relative_to(PROJECT_ROOT.resolve())
        except ValueError:
            return False
        if path.is_symlink() or not path.is_file() or _sha256_file(path) != expected_hash:
            return False
    return True


def validate_skin_paint_strokes(strokes: object, skin_asset_id: object) -> list[dict]:
    if not isinstance(strokes, list) or len(strokes) > 500:
        raise ValueError("skin_paint_strokes must be a list of at most 500 strokes")
    if strokes and skin_asset_id is None:
        raise ValueError("skin paint strokes require an installed skin asset")
    valid_materials = {"Std_Skin_Head", "Std_Skin_Body", "Std_Skin_Arm", "Std_Skin_Leg"}
    total_points = 0
    for stroke in strokes:
        if not isinstance(stroke, dict) or set(stroke) != {
            "material", "tool", "color", "radius", "opacity", "points",
        }:
            raise ValueError("skin paint stroke contains unsupported fields")
        if (
            stroke["material"] not in valid_materials
            or stroke["tool"] not in {"paint", "freckles", "erase"}
            or not isinstance(stroke["color"], str)
            or not re.fullmatch(r"#[0-9A-Fa-f]{6}", stroke["color"])
            or isinstance(stroke["radius"], bool)
            or not isinstance(stroke["radius"], (int, float))
            or not math.isfinite(stroke["radius"])
            or not 0 < stroke["radius"] <= 0.1
            or isinstance(stroke["opacity"], bool)
            or not isinstance(stroke["opacity"], (int, float))
            or not math.isfinite(stroke["opacity"])
            or not 0 < stroke["opacity"] <= 1
            or not isinstance(stroke["points"], list)
            or not 1 <= len(stroke["points"]) <= 256
        ):
            raise ValueError("skin paint stroke has invalid brush settings")
        total_points += len(stroke["points"])
        for point in stroke["points"]:
            if (
                not isinstance(point, dict)
                or set(point) not in ({"u", "v"}, {"u", "v", "pressure"})
                or any(
                    isinstance(point[axis], bool)
                    or not isinstance(point[axis], (int, float))
                    or not math.isfinite(point[axis])
                    or not 0 <= point[axis] <= 1
                    for axis in ("u", "v")
                )
            ):
                raise ValueError("skin paint UV coordinates must be finite values from 0 to 1")
            pressure = point.get("pressure", 1)
            if (
                isinstance(pressure, bool)
                or not isinstance(pressure, (int, float))
                or not math.isfinite(pressure)
                or not 0.05 <= pressure <= 1
            ):
                raise ValueError("skin paint pressure must be a finite value from 0.05 to 1")
    if total_points > 20_000:
        raise ValueError("skin paint strokes exceed the supported point limit")
    return strokes


def validate_skin_definition(definition: object) -> dict:
    if isinstance(definition, dict):
        features = definition.get("features")
        if isinstance(features, dict) and isinstance(features.get("freckles"), dict):
            freckles = dict(features["freckles"])
            freckles.setdefault("pattern", "natural")
            definition = {
                **definition,
                "features": {
                    **features,
                    "freckles": freckles,
                },
            }
    if not isinstance(definition, dict) or set(definition) != {"version", "base", "surface", "features"}:
        raise ValueError("skin_definition contains missing or unsupported fields")
    base = definition["base"]
    surface = definition["surface"]
    features = definition["features"]
    freckles = features.get("freckles") if isinstance(features, dict) else None
    if (
        definition["version"] != 2
        or isinstance(definition["version"], bool)
        or not isinstance(base, dict)
        or set(base) != {"tone", "undertone"}
        or not isinstance(surface, dict)
        or set(surface) != {"roughness"}
        or not isinstance(features, dict)
        or set(features) != {"freckles"}
        or not isinstance(freckles, dict)
        or set(freckles) != {"enabled", "density", "size", "strength", "color", "seed", "pattern"}
        or not isinstance(base.get("undertone"), str)
        or base["undertone"] not in {"cool", "neutral", "warm", "olive"}
        or not isinstance(freckles.get("enabled"), bool)
        or not isinstance(freckles.get("color"), str)
        or re.fullmatch(r"#[0-9A-Fa-f]{6}", freckles["color"]) is None
        or freckles.get("pattern") not in {
            "natural",
            "light_dusting",
            "dense_center",
            "cheek_clusters",
            "sun_kissed",
            "constellation",
            "mottled",
        }
        or isinstance(freckles.get("seed"), bool)
        or not isinstance(freckles.get("seed"), int)
        or not 0 <= freckles["seed"] <= 0xFFFFFFFF
    ):
        raise ValueError("skin_definition contains unsupported skin properties")
    for section, key in (
        (base, "tone"),
        (surface, "roughness"),
        (freckles, "density"),
        (freckles, "size"),
        (freckles, "strength"),
    ):
        value = section[key]
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            or not 0 <= value <= 1
        ):
            raise ValueError(f"skin_definition {key} must be a finite value from 0 to 1")
    return definition


def skin_material_parameters(definition: dict) -> dict:
    validate_skin_definition(definition)
    tone_factor = 0.7 + definition["base"]["tone"] * 0.5
    undertone = {
        "cool": (0.97, 0.99, 1.04),
        "neutral": (1.0, 1.0, 1.0),
        "warm": (1.04, 1.0, 0.96),
        "olive": (0.99, 1.02, 0.96),
    }[definition["base"]["undertone"]]
    return {
        "color_multiplier": [round(tone_factor * channel, 6) for channel in undertone],
        "roughness_scale": round(definition["surface"]["roughness"] / 0.42, 6),
    }


def generate_skin_freckle_spots(freckles: dict, width: int, height: int) -> list[tuple[float, float, float, float]]:
    freckles = {
        **freckles,
        "pattern": freckles.get("pattern", "natural"),
    }
    validate_skin_definition({
        "version": 2,
        "base": {"tone": 0.62, "undertone": "neutral"},
        "surface": {"roughness": 0.42},
        "features": {"freckles": freckles},
    })
    if not freckles["enabled"] or freckles["density"] <= 0 or width < 1 or height < 1:
        return []

    state = freckles["seed"]

    def random_value() -> float:
        nonlocal state
        state ^= (state << 13) & 0xFFFFFFFF
        state ^= state >> 17
        state ^= (state << 5) & 0xFFFFFFFF
        state &= 0xFFFFFFFF
        return state / 0x1_0000_0000

    minimum_dimension = min(width, height)
    count = math.floor(freckles["density"] * 800 + 0.5)
    spots = []
    pattern = freckles["pattern"]
    for _ in range(count):
        x = random_value()
        y = random_value()
        if pattern == "light_dusting":
            x = 0.16 + random_value() * 0.68
            y = 0.18 + random_value() * 0.64
        elif pattern == "dense_center":
            x = min(0.98, max(0.02, 0.5 + (random_value() - 0.5) * 0.38))
            y = min(0.98, max(0.02, 0.5 + (random_value() - 0.5) * 0.48))
        elif pattern == "cheek_clusters":
            cluster = -1 if random_value() < 0.5 else 1
            x = 0.5 + cluster * (0.18 + random_value() * 0.13) + (random_value() - 0.5) * 0.08
            y = 0.42 + random_value() * 0.34
        elif pattern == "sun_kissed":
            x = 0.5 + (random_value() - 0.5) * 0.78
            y = 0.72 - random_value() * 0.48
        elif pattern == "constellation":
            cluster_index = math.floor(random_value() * 6)
            angle = random_value() * math.pi * 2
            distance = random_value() * 0.12
            x = 0.22 + (cluster_index % 3) * 0.28 + math.cos(angle) * distance
            y = 0.32 + math.floor(cluster_index / 3) * 0.24 + math.sin(angle) * distance
        elif pattern == "mottled":
            x = random_value() * 0.55 if random_value() < 0.5 else 0.45 + random_value() * 0.55
            y = random_value() * 0.82 + 0.08
        spots.append((
            min(0.999, max(0, x)) * width,
            min(0.999, max(0, y)) * height,
            minimum_dimension
            * (0.00055 + freckles["size"] * 0.00115)
            * (0.6 + random_value() * 0.8),
            freckles["strength"] * 0.35 * (0.6 + random_value() * 0.8),
        ))
    return spots


def apply_skin_freckles(bpy, freckles: dict) -> int:
    if not freckles["enabled"]:
        return 0
    material = bpy.data.materials.get("Std_Skin_Head_CC3PlusFemaleSkin")
    if material is None or not material.use_nodes or material.node_tree is None:
        raise ValueError("SKIN_FRECKLE_MATERIAL_UNAVAILABLE: head skin material is missing")
    shader = next(
        (node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"),
        None,
    )
    color_input = shader.inputs.get("Base Color") if shader is not None else None
    image_node = next(
        (
            link.from_node
            for link in color_input.links
            if link.from_node.type == "TEX_IMAGE" and link.from_node.image is not None
        ),
        None,
    ) if color_input is not None else None
    if image_node is None:
        raise ValueError("SKIN_FRECKLE_TEXTURE_UNAVAILABLE: head diffuse image is missing")
    image = image_node.image.copy()
    image.name = "Std_Skin_Head_Freckles"
    image_node.image = image
    width, height = image.size
    spots = generate_skin_freckle_spots(freckles, width, height)
    pixels = array("f", [0.0]) * (width * height * 4)
    image.pixels.foreach_get(pixels)

    def linear_to_srgb(value: float) -> float:
        value = min(1.0, max(0.0, value))
        return value * 12.92 if value <= 0.0031308 else 1.055 * value ** (1 / 2.4) - 0.055

    def srgb_to_linear(value: float) -> float:
        return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4

    color = tuple(int(freckles["color"][index:index + 2], 16) / 255 for index in (1, 3, 5))
    for center_x, center_y, radius, opacity in spots:
        left = max(0, math.floor(center_x - radius))
        right = min(width - 1, math.ceil(center_x + radius))
        top = max(0, math.floor(center_y - radius))
        bottom = min(height - 1, math.ceil(center_y + radius))
        for y in range(top, bottom + 1):
            for x in range(left, right + 1):
                coverage = min(1.0, max(0.0, radius + 0.5 - math.hypot(x - center_x, y - center_y)))
                alpha = opacity * coverage
                if alpha <= 0:
                    continue
                offset = (y * width + x) * 4
                for channel in range(3):
                    source = linear_to_srgb(pixels[offset + channel])
                    blended = source * (1 - alpha) + color[channel] * alpha
                    quantized = math.floor(blended * 255 + 0.5) / 255
                    pixels[offset + channel] = srgb_to_linear(quantized)
    image.pixels.foreach_set(pixels)
    image.update()
    image.pack()
    return len(spots)


def skin_paint_samples(
    points: list[dict],
    width: int,
    height: int,
    brush_radius: float,
) -> list[tuple[float, float, float, float]]:
    if len(points) == 1:
        point = points[0]
        pressure = point.get("pressure", 1)
        return [(
            point["u"] * (width - 1),
            point["v"] * (height - 1),
            max(0.5, brush_radius * pressure),
            pressure,
        )]
    samples = []
    for start, end in zip(points, points[1:]):
        x0, y0 = start["u"] * (width - 1), start["v"] * (height - 1)
        x1, y1 = end["u"] * (width - 1), end["v"] * (height - 1)
        pressure0 = start.get("pressure", 1)
        pressure1 = end.get("pressure", 1)
        distance = math.hypot(x1 - x0, y1 - y0)
        count = max(
            1,
            math.ceil(distance / max(brush_radius * min(pressure0, pressure1) * 0.4, 1)),
        )
        samples.extend(
            (
                x0 + (x1 - x0) * step / count,
                y0 + (y1 - y0) * step / count,
                max(0.5, brush_radius * (pressure0 + (pressure1 - pressure0) * step / count)),
                pressure0 + (pressure1 - pressure0) * step / count,
            )
            for step in range(count)
        )
    last = points[-1]
    last_pressure = last.get("pressure", 1)
    samples.append((
        last["u"] * (width - 1),
        last["v"] * (height - 1),
        max(0.5, brush_radius * last_pressure),
        last_pressure,
    ))
    return samples


def apply_skin_paint(bpy, strokes: list[dict]) -> dict:
    if not strokes:
        return {"stroke_count": 0}
    import numpy as np

    strokes_by_material: dict[str, list[dict]] = {}
    for stroke in strokes:
        strokes_by_material.setdefault(stroke["material"], []).append(stroke)
    for material_name, material_strokes in strokes_by_material.items():
        material = bpy.data.materials.get(f"{material_name}_CC3PlusFemaleSkin")
        if material is None or not material.use_nodes or material.node_tree is None:
            raise ValueError(f"SKIN_PAINT_MATERIAL_UNAVAILABLE: {material_name}")
        base_color = next(
            (node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"),
            None,
        )
        if base_color is None:
            raise ValueError(f"SKIN_PAINT_MATERIAL_UNAVAILABLE: {material_name}")
        color_input = base_color.inputs.get("Base Color")
        image_node = next(
            (
                link.from_node
                for link in color_input.links
                if link.from_node.type == "TEX_IMAGE" and link.from_node.image is not None
            ),
            None,
        ) if color_input is not None else None
        if image_node is None:
            raise ValueError(f"SKIN_PAINT_TEXTURE_UNAVAILABLE: {material_name}")
        image = image_node.image.copy()
        image.name = f"{material_name}_Painted"
        image_node.image = image
        width, height = image.size
        if width < 1 or height < 1:
            raise ValueError(f"SKIN_PAINT_TEXTURE_INVALID: {material_name}")
        pixels = np.empty(width * height * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        pixels = pixels.reshape((height, width, 4))
        base_pixels = pixels.copy()

        def srgb_to_linear(channel: int) -> float:
            value = channel / 255
            return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4

        for stroke in material_strokes:
            color = np.array([
                srgb_to_linear(int(stroke["color"][index:index + 2], 16))
                for index in (1, 3, 5)
            ], dtype=np.float32)
            radius = max(1.0, stroke["radius"] * width)
            path = skin_paint_samples(stroke["points"], width, height, radius)
            for center_x, center_y, point_radius, pressure in path:
                if stroke["tool"] == "freckles":
                    seed = (
                        int((center_x / max(width, 1) * 10000 + center_y / max(height, 1) * 7777) * 1000)
                        & 0xFFFFFFFF
                    )
                    def random_value():
                        nonlocal seed
                        seed ^= (seed << 13) & 0xFFFFFFFF
                        seed ^= seed >> 17
                        seed ^= (seed << 5) & 0xFFFFFFFF
                        seed &= 0xFFFFFFFF
                        return seed / 0x1_0000_0000
                    for _ in range(4 + int(random_value() * 5)):
                        angle = random_value() * math.pi * 2
                        distance = math.sqrt(random_value()) * point_radius
                        mark_x = center_x + math.cos(angle) * distance
                        mark_y = center_y + math.sin(angle) * distance
                        mark_radius = max(0.7, point_radius * (0.08 + random_value() * 0.14))
                        left = max(0, math.floor(mark_x - mark_radius))
                        right = min(width, math.ceil(mark_x + mark_radius + 1))
                        bottom = max(0, math.floor(mark_y - mark_radius))
                        top = min(height, math.ceil(mark_y + mark_radius + 1))
                        y, x = np.ogrid[bottom:top, left:right]
                        coverage = np.clip(mark_radius + 0.5 - np.sqrt((x - mark_x) ** 2 + (y - mark_y) ** 2), 0, 1)
                        alpha = coverage[..., None] * stroke["opacity"] * pressure
                        region = pixels[bottom:top, left:right, :3]
                        region[:] = color * alpha + region * (1 - alpha)
                    continue
                left = max(0, math.floor(center_x - point_radius))
                right = min(width, math.ceil(center_x + point_radius + 1))
                bottom = max(0, math.floor(center_y - point_radius))
                top = min(height, math.ceil(center_y + point_radius + 1))
                y, x = np.ogrid[bottom:top, left:right]
                coverage = np.clip(point_radius + 0.5 - np.sqrt((x - center_x) ** 2 + (y - center_y) ** 2), 0, 1)
                alpha = coverage[..., None] * stroke["opacity"] * pressure
                region = pixels[bottom:top, left:right, :3]
                if stroke["tool"] == "erase":
                    base_region = base_pixels[bottom:top, left:right, :3]
                    region[:] = base_region * alpha + region * (1 - alpha)
                else:
                    region[:] = color * alpha + region * (1 - alpha)
        image.pixels.foreach_set(pixels.reshape(-1))
        image.update()
        image.pack()
    return {"stroke_count": len(strokes), "painted_materials": sorted(strokes_by_material)}


def apply_skin_asset(bpy, component_id: str, asset_id: str) -> dict:
    asset = SKIN_ASSETS.get(asset_id)
    if (
        asset is None
        or "character_cc5_rlcc3plus_all_morphs_v1" not in asset.get("compatible_asset_ids", [])
        or not skin_asset_is_integrity_valid(asset)
    ):
        raise ValueError("SKIN_ASSET_UNAVAILABLE: selected pinned skin materials are not installed")
    library_path = PROJECT_ROOT / asset["material_library_path"]
    material_names = list(asset["materials"])
    target_slots = []
    existing_material_names = {}
    for obj in bpy.context.scene.objects:
        if (
            obj.get("comodel_component_id") != component_id
            or obj.type != "MESH"
            or obj.get("comodel_source_group") != "CC_Base_Body"
        ):
            continue
        for index, slot in enumerate(obj.material_slots):
            material = slot.material
            if material is not None and material.name in asset["materials"]:
                target_slots.append((obj, index, material.name))
                existing_material_names.setdefault(material, material.name)
    if not target_slots or {name for _, _, name in target_slots} != set(material_names):
        raise ValueError("SKIN_ASSET_INVALID: the target body is missing expected skin material slots")
    for material, original_name in existing_material_names.items():
        material.name = f"{original_name}_CoModelSource_{component_id}"
    try:
        with bpy.data.libraries.load(str(library_path), link=False) as (source, target):
            if not set(material_names).issubset(source.materials):
                raise ValueError("SKIN_ASSET_INVALID: material library is missing expected skin materials")
            target.materials = material_names.copy()
    finally:
        for material, original_name in existing_material_names.items():
            material.name = original_name
    skin_materials = {}
    for source_name, material in zip(material_names, target.materials, strict=True):
        if material is None:
            raise ValueError(f"SKIN_ASSET_INVALID: failed to load {source_name}")
        material.name = f"{source_name}_CC3PlusFemaleSkin"
        skin_materials[source_name] = material
    for material, original_name in existing_material_names.items():
        material.name = original_name
    missing_materials = {name for _, _, name in target_slots} - set(skin_materials)
    if missing_materials:
        raise ValueError(
            "SKIN_ASSET_INVALID: material library names do not match the target slots "
            f"(missing {sorted(missing_materials)}, loaded {sorted(skin_materials)})"
        )
    for obj, index, original_name in target_slots:
        obj.data.materials[index] = skin_materials[original_name]
    return {
        "asset_id": asset_id,
        "material_library_sha256": asset["material_library_sha256"],
        "material_names": sorted(material.name for material in skin_materials.values()),
    }


def apply_skin_definition(bpy, definition: dict) -> dict:
    parameters = skin_material_parameters(definition)
    freckle_count = apply_skin_freckles(bpy, definition["features"]["freckles"])
    colors = parameters["color_multiplier"]
    roughness_scale = parameters["roughness_scale"]
    materials = [
        material
        for material in bpy.data.materials
        if material.name.endswith("_CC3PlusFemaleSkin")
    ]
    if not materials:
        raise ValueError("SKIN_MATERIAL_UNAVAILABLE: no selected skin materials were loaded")
    for material in materials:
        if not material.use_nodes or material.node_tree is None:
            raise ValueError(f"SKIN_MATERIAL_UNAVAILABLE: {material.name}")
        shader = next(
            (node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"),
            None,
        )
        if shader is None:
            raise ValueError(f"SKIN_SHADER_UNAVAILABLE: {material.name}")
        base_color = shader.inputs.get("Base Color")
        roughness_input = shader.inputs.get("Roughness")
        if base_color is None or roughness_input is None:
            raise ValueError(f"SKIN_SHADER_UNAVAILABLE: {material.name}")

        base_links = list(base_color.links)
        if len(base_links) > 1:
            raise ValueError(f"SKIN_SHADER_UNSUPPORTED: multiple Base Color links on {material.name}")
        if base_links:
            source_socket = base_links[0].from_socket
            multiply = material.node_tree.nodes.new("ShaderNodeMixRGB")
            multiply.blend_type = "MULTIPLY"
            multiply.inputs[0].default_value = 1.0
            multiply.inputs[2].default_value = (*colors, 1.0)
            multiply.label = "Semantic Skin Tone"
            for link in base_links:
                material.node_tree.links.remove(link)
            material.node_tree.links.new(source_socket, multiply.inputs[1])
            material.node_tree.links.new(multiply.outputs["Color"], base_color)
        else:
            original_color = base_color.default_value
            base_color.default_value = tuple(
                original_color[index] * colors[index]
                for index in range(3)
            ) + (original_color[3],)

        roughness_links = list(roughness_input.links)
        if len(roughness_links) > 1:
            raise ValueError(f"SKIN_SHADER_UNSUPPORTED: multiple Roughness links on {material.name}")
        if roughness_links:
            source_socket = roughness_links[0].from_socket
            multiply = material.node_tree.nodes.new("ShaderNodeMath")
            multiply.operation = "MULTIPLY"
            multiply.inputs[1].default_value = roughness_scale
            multiply.label = "Semantic Skin Roughness"
            for link in roughness_links:
                material.node_tree.links.remove(link)
            material.node_tree.links.new(source_socket, multiply.inputs[0])
            material.node_tree.links.new(multiply.outputs[0], roughness_input)
        else:
            roughness_input.default_value *= roughness_scale
        material.diffuse_color = (*colors, 1.0)
    return {
        "definition": definition,
        "material_parameters": parameters,
        "material_names": sorted(material.name for material in materials),
        "freckles": {"enabled": definition["features"]["freckles"]["enabled"], "spot_count": freckle_count},
    }




























def _fixed_cc3_asset_path(asset_id: str) -> tuple[dict, Path]:
    spec = CC3_ASSET[asset_id]
    project_root = Path(__file__).resolve().parents[3]
    asset_root = project_root / "starter" / "worker" / "blender" / "assets"
    asset_path = project_root / "starter" / "worker" / "blender" / spec["filename"]
    if asset_root.is_symlink() or asset_path.is_symlink():
        raise ValueError("CC3 source asset path cannot be a symbolic link")
    resolved_root = asset_root.resolve()
    resolved_path = asset_path.resolve()
    if resolved_root not in resolved_path.parents or not resolved_path.is_file():
        raise ValueError("Allowlisted CC3 source asset is unavailable")
    if resolved_path.stat().st_size > spec["max_bytes"]:
        raise ValueError("Allowlisted CC3 source asset exceeds its size limit")
    if _sha256_file(resolved_path) != spec["sha256"]:
        raise ValueError("Allowlisted CC3 source asset failed its SHA-256 integrity check")
    return spec, resolved_path










def _import_character_cc3_glb(
    bpy,
    component_id: str,
    asset_id: str,
    *,
    clear_default_cube: bool,
) -> dict:
    spec, glb_path = _fixed_cc3_asset_path(asset_id)
    morph_specs = CC3_MORPH_SPECS_BY_ASSET[asset_id]
    morph_controls = CC3_MORPH_CONTROLS_BY_ASSET[asset_id]
    previous_objects = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    imported_objects = [obj for obj in bpy.context.scene.objects if obj not in previous_objects]
    expected_mesh_names = spec["mesh_names"]
    meshes = [
        obj for obj in imported_objects
        if obj.type == "MESH" and obj.name in expected_mesh_names
    ]
    mesh_by_name = {obj.name: obj for obj in meshes}
    armatures = [
        obj for obj in imported_objects
        if obj.type == "ARMATURE" and obj.name == spec["armature_name"]
    ]
    if (
        set(mesh_by_name) != expected_mesh_names
        or len(meshes) != spec["mesh_count"]
        or len(armatures) != 1
    ):
        raise ValueError("VALIDATION_FAILED: CC3 GLB object structure does not match the pinned asset")
    armature = armatures[0]
    body = mesh_by_name["CC_Base_Body"]
    body_shape_key_count = len(body.data.shape_keys.key_blocks) if body.data.shape_keys else 0
    bone_count = len(armature.data.bones)
    if (
        len(body.data.vertices) != spec["body_vertices"]
        or body_shape_key_count != spec["body_shape_keys"]
        or bone_count != spec["bone_count"]
    ):
        raise ValueError(
            "VALIDATION_FAILED: CC3 asset counts do not match its manifest "
            f"(body vertices {len(body.data.vertices)}/{spec['body_vertices']}, "
            f"shape keys {body_shape_key_count}/{spec['body_shape_keys']}, "
            f"bones {bone_count}/{spec['bone_count']})"
        )
    required_keys = {
        key_name
        for pair in morph_controls.values()
        for key_name in pair
        if key_name is not None
    }
    if not required_keys.issubset(set(body.data.shape_keys.key_blocks.keys())):
        raise ValueError("VALIDATION_FAILED: CC3 body is missing one or more slider shape keys")

    kept_objects = set(meshes) | {armature}
    for obj in imported_objects:
        if obj not in kept_objects:
            bpy.data.objects.remove(obj, do_unlink=True)

    vertices = [
        obj.matrix_world @ vertex.co
        for obj in meshes
        for vertex in obj.data.vertices
    ]
    min_x = min(float(vertex.x) for vertex in vertices)
    max_x = max(float(vertex.x) for vertex in vertices)
    min_y = min(float(vertex.y) for vertex in vertices)
    max_y = max(float(vertex.y) for vertex in vertices)
    min_z = min(float(vertex.z) for vertex in vertices)
    max_z = max(float(vertex.z) for vertex in vertices)
    source_height = max_z - min_z
    if source_height <= 0:
        raise ValueError("VALIDATION_FAILED: CC3 GLB has invalid vertical bounds")
    scale = CC3_MODEL_HEIGHT / source_height
    from mathutils import Matrix

    normalization = Matrix.Translation((
        -((min_x + max_x) / 2.0) * scale,
        -((min_y + max_y) / 2.0) * scale,
        -min_z * scale,
    )) @ Matrix.Scale(scale, 4)
    collection = get_or_create_collection(bpy, f"CoModel/Components/{component_id}")
    mesh_results = []
    material_names = set()
    for obj in [*meshes, armature]:
        obj.matrix_world = normalization @ obj.matrix_world
        obj["comodel_component_id"] = component_id
        obj["comodel_object_id"] = f"{component_id}-{obj.name.lower()}"
        obj["comodel_semantic_type"] = (
            "body_rig" if obj.type == "ARMATURE"
            else "body" if obj == body
            else "body_detail"
        )
        obj["comodel_source_group"] = obj.name
        obj["comodel_source_asset_id"] = asset_id
        obj["comodel_creation_phase"] = "body_blockout"
        obj["comodel_validation_status"] = "pass"
        move_to_collection(obj, collection)
        if obj.type == "MESH":
            names = sorted(material.name for material in obj.data.materials if material is not None)
            material_names.update(names)
            mesh_results.append({
                "name": obj.name,
                "vertex_count": len(obj.data.vertices),
                "polygon_count": len(obj.data.polygons),
                "shape_key_count": (
                    len(obj.data.shape_keys.key_blocks)
                    if obj.data.shape_keys is not None
                    else 0
                ),
                "material_names": names,
            })

    for image in bpy.data.images:
        if image.users > 0 and image.size[0] > 0 and not image.packed_file:
            image.pack()
    bpy.context.view_layer.update()
    if clear_default_cube:
        for default_name in ("Cube", "Camera", "Light"):
            default_object = bpy.data.objects.get(default_name)
            if default_object is not None and not default_object.get("comodel_component_id"):
                bpy.data.objects.remove(default_object, do_unlink=True)

    return {
        "component_id": component_id,
        "asset_id": asset_id,
        "source_glb_sha256": spec["sha256"],
        "source_height": round(source_height, 6),
        "normalized_height": CC3_MODEL_HEIGHT,
        "mesh_count": len(meshes),
        "source_mesh_polygon_count": sum(len(obj.data.polygons) for obj in meshes),
        "mesh_polygon_count": sum(len(obj.data.polygons) for obj in meshes),
        "armature_name": armature.name,
        "bone_count": len(armature.data.bones),
        "body_vertex_count": len(body.data.vertices),
        "source_body_vertex_count": spec["source_body_vertices"],
        "body_shape_key_count": len(body.data.shape_keys.key_blocks),
        "morph_control_names": sorted(morph_controls),
        "morph_control_specs": morph_specs,
        "meshes": mesh_results,
        "groups": mesh_results,
        "material_names": sorted(material_names),
        "object_count": len(meshes) + 1,
        "warning": (
            f"The asset includes {len(morph_specs)} slider controls backed by the "
            "available positive and negative FBX exports. Morph combinations and "
            "anatomical quality have not been independently certified."
        ),
    }


def _import_character_cc5_blend(
    bpy,
    component_id: str,
    asset_id: str,
    *,
    clear_default_cube: bool,
) -> dict:
    spec, blend_path = _fixed_cc3_asset_path(asset_id)
    manifest = CC3_MORPH_MANIFESTS[asset_id]
    morph_specs = CC3_MORPH_SPECS_BY_ASSET[asset_id]
    morph_controls = CC3_MORPH_CONTROLS_BY_ASSET[asset_id]
    expected_names = spec["object_names"]
    previous_names = {obj.name for obj in bpy.context.scene.objects}

    with bpy.data.libraries.load(str(blend_path), link=False) as (data_from, data_to):
        missing_names = expected_names - set(data_from.objects)
        if missing_names:
            raise ValueError(
                "VALIDATION_FAILED: CC5 Blender source is missing objects "
                + ", ".join(sorted(missing_names))
            )
        source_names = sorted(expected_names)
        data_to.objects = list(source_names)

    imported_objects = list(data_to.objects)
    if len(imported_objects) != len(source_names) or any(obj is None for obj in imported_objects):
        raise ValueError("VALIDATION_FAILED: CC5 Blender source objects could not be appended")
    source_pairs = list(zip(source_names, imported_objects, strict=True))
    for source_name, obj in source_pairs:
        if obj.name in previous_names:
            obj.name = f"{source_name}_{component_id}"
        bpy.context.scene.collection.objects.link(obj)

    mesh_by_source = {
        source_name: obj
        for source_name, obj in source_pairs
        if obj.type == "MESH"
    }
    armatures = [
        obj
        for source_name, obj in source_pairs
        if obj.type == "ARMATURE" and source_name == spec["armature_name"]
    ]
    if set(mesh_by_source) != spec["mesh_names"] or len(armatures) != 1:
        raise ValueError("VALIDATION_FAILED: CC5 Blender object structure does not match its manifest")
    meshes = [mesh_by_source[name] for name in sorted(mesh_by_source)]
    armature = armatures[0]
    body = mesh_by_source.get("CC_Base_Body")
    body_shape_key_count = (
        len(body.data.shape_keys.key_blocks)
        if body is not None and body.data.shape_keys is not None
        else 0
    )
    if (
        body is None
        or len(body.data.vertices) != spec["body_vertices"]
        or body_shape_key_count != spec["body_shape_keys"]
        or len(armature.data.bones) != spec["bone_count"]
    ):
        raise ValueError("VALIDATION_FAILED: CC5 Blender source counts do not match its manifest")

    required_keys = {
        key_name
        for pair in morph_controls.values()
        for key_name in pair
        if key_name is not None
    }
    available_keys = {
        key.name
        for mesh in meshes
        if mesh.data.shape_keys is not None
        for key in mesh.data.shape_keys.key_blocks
    }
    if not required_keys.issubset(available_keys):
        raise ValueError("VALIDATION_FAILED: CC5 Blender source is missing morph shape keys")

    unexpected_active_keys = [
        (mesh.name, key.name)
        for mesh in meshes
        if mesh.data.shape_keys is not None
        for key in mesh.data.shape_keys.key_blocks[1:]
        if key.name not in required_keys and abs(key.value) > 1e-8
    ]
    if unexpected_active_keys:
        raise ValueError(
            "VALIDATION_FAILED: CC5 Blender source has active shape keys outside "
            "the morph manifest"
        )
    neutralized_morph_key_count = 0
    for mesh in meshes:
        if mesh.data.shape_keys is None:
            continue
        for key in mesh.data.shape_keys.key_blocks[1:]:
            if key.name in required_keys:
                key.value = 0.0
                neutralized_morph_key_count += 1
    if neutralized_morph_key_count != manifest["shape_key_operations"]:
        raise ValueError("VALIDATION_FAILED: CC5 morph shape-key count does not match its manifest")
    body["comodel_cc3_morph_controls_json"] = json.dumps(
        {name: 0.0 for name in sorted(morph_controls)},
        sort_keys=True,
        separators=(",", ":"),
    )

    bpy.context.view_layer.update()
    world_vertices = [
        obj.matrix_world @ vertex.co
        for obj in meshes
        for vertex in obj.data.vertices
    ]
    min_x = min(float(vertex.x) for vertex in world_vertices)
    max_x = max(float(vertex.x) for vertex in world_vertices)
    min_y = min(float(vertex.y) for vertex in world_vertices)
    max_y = max(float(vertex.y) for vertex in world_vertices)
    min_z = min(float(vertex.z) for vertex in world_vertices)
    max_z = max(float(vertex.z) for vertex in world_vertices)
    source_height = max_z - min_z
    if source_height <= 0:
        raise ValueError("VALIDATION_FAILED: CC5 Blender source has invalid vertical bounds")

    from mathutils import Matrix

    scale = CC3_MODEL_HEIGHT / source_height
    normalization = Matrix.Translation((
        -((min_x + max_x) / 2.0) * scale,
        -((min_y + max_y) / 2.0) * scale,
        -min_z * scale,
    )) @ Matrix.Scale(scale, 4)
    collection = get_or_create_collection(bpy, f"CoModel/Components/{component_id}")
    mesh_results = []
    material_names = set()
    for source_name, obj in source_pairs:
        obj.matrix_world = normalization @ obj.matrix_world
        obj["comodel_component_id"] = component_id
        obj["comodel_object_id"] = f"{component_id}-{source_name.lower()}"
        obj["comodel_semantic_type"] = (
            "body_rig" if obj.type == "ARMATURE"
            else "body" if source_name == "CC_Base_Body"
            else "body_detail"
        )
        obj["comodel_source_group"] = source_name
        obj["comodel_source_asset_id"] = asset_id
        obj["comodel_creation_phase"] = "body_blockout"
        obj["comodel_validation_status"] = "pass"
        move_to_collection(obj, collection)
        if obj.type == "MESH":
            names = sorted(material.name for material in obj.data.materials if material is not None)
            material_names.update(names)
            mesh_results.append({
                "name": source_name,
                "vertex_count": len(obj.data.vertices),
                "polygon_count": len(obj.data.polygons),
                "shape_key_count": (
                    len(obj.data.shape_keys.key_blocks)
                    if obj.data.shape_keys is not None
                    else 0
                ),
                "material_names": names,
            })

    for image in bpy.data.images:
        if image.users > 0 and image.size[0] > 0 and not image.packed_file:
            image.pack()
    bpy.context.view_layer.update()
    if clear_default_cube:
        for default_name in ("Cube", "Camera", "Light"):
            default_object = bpy.data.objects.get(default_name)
            if default_object is not None and not default_object.get("comodel_component_id"):
                bpy.data.objects.remove(default_object, do_unlink=True)

    return {
        "component_id": component_id,
        "asset_id": asset_id,
        "source_glb_sha256": spec["preview_sha256"],
        "source_blend_sha256": spec["sha256"],
        "source_height": round(source_height, 6),
        "normalized_height": CC3_MODEL_HEIGHT,
        "mesh_count": len(meshes),
        "source_mesh_polygon_count": sum(len(obj.data.polygons) for obj in meshes),
        "mesh_polygon_count": sum(len(obj.data.polygons) for obj in meshes),
        "armature_name": spec["armature_name"],
        "bone_count": len(armature.data.bones),
        "body_vertex_count": len(body.data.vertices),
        "source_body_vertex_count": spec["source_body_vertices"],
        "body_shape_key_count": len(body.data.shape_keys.key_blocks),
        "neutralized_morph_key_count": neutralized_morph_key_count,
        "component_vertex_count": sum(len(obj.data.vertices) for obj in meshes),
        "component_shape_key_count": sum(
            len(obj.data.shape_keys.key_blocks)
            for obj in meshes
            if obj.data.shape_keys is not None
        ),
        "morph_control_names": sorted(morph_controls),
        "meshes": mesh_results,
        "groups": mesh_results,
        "material_names": sorted(material_names),
        "object_count": len(meshes) + 1,
        "warning": (
            "Imported the owner-supplied CC5/CC3+ Blender source with all "
            f"{len(morph_specs)} server-applied morph controls. The browser preview "
            "updates after saving the controls to Blender."
        ),
    }


def _import_character_cc3_asset(
    bpy,
    component_id: str,
    asset_id: str,
    *,
    clear_default_cube: bool,
) -> dict:
    if CC3_ASSET[asset_id]["format"] == "blend":
        return _import_character_cc5_blend(
            bpy,
            component_id,
            asset_id,
            clear_default_cube=clear_default_cube,
        )
    return _import_character_cc3_glb(
        bpy,
        component_id,
        asset_id,
        clear_default_cube=clear_default_cube,
    )


def import_base_model(bpy, args: dict, *, clear_default_cube: bool) -> dict:
    component_id = safe_component_id(args.get("component_id"))
    asset_id = args.get("asset_id")
    if asset_id not in CC3_ASSET:
        raise ValueError("asset_id is not an allowlisted source asset")
    if any(obj.get("comodel_semantic_type") == "body" for obj in bpy.context.scene.objects):
        raise ValueError("BODY_ALREADY_EXISTS: source model import cannot replace an existing body")
    result = _import_character_cc3_asset(
        bpy,
        component_id,
        asset_id,
        clear_default_cube=clear_default_cube,
    )
    morphs = args.get("morphs")
    if morphs is not None:
        result["initial_morphs"] = apply_cc3_morph_controls(
            bpy,
            {"component_id": component_id, "asset_id": asset_id, "morphs": morphs},
        )["morphs"]
    if "preset_ids" in args:
        result["body_preset"] = apply_cc3_body_preset(
            bpy,
            {
                "component_id": component_id,
                "asset_id": asset_id,
                "preset_ids": args["preset_ids"],
            },
        )
    elif args.get("preset_id") is not None:
        result["body_preset"] = apply_cc3_body_preset(
            bpy,
            {
                "component_id": component_id,
                "asset_id": asset_id,
                "preset_id": args["preset_id"],
            },
        )
    skin_asset_id = args.get("skin_asset_id")
    if skin_asset_id is not None:
        result["skin_asset"] = apply_skin_asset(bpy, component_id, skin_asset_id)
        result["skin_paint"] = apply_skin_paint(
            bpy,
            args.get("skin_paint_strokes", []),
        )
        result["skin_definition"] = apply_skin_definition(
            bpy,
            args.get(
                "skin_definition",
                {
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
            ),
        )
    eye_attachment = args.get("eye_attachment")
    if eye_attachment is not None:
        body_meshes = [
            obj for obj in bpy.context.scene.objects
            if obj.get("comodel_component_id") == component_id
        ]
        for obj in body_meshes:
            obj["comodel_semantic_type"] = "body"
        result["eye_attachment"] = attach_eye_asset(
            bpy,
            {
                "component_id": eye_attachment["component_id"],
                "asset_id": eye_attachment["asset_id"],
            },
        )
    if "preset_ids" in args or args.get("preset_id") is not None:
        result["component_shape_key_count"] = sum(
            len(obj.data.shape_keys.key_blocks)
            for obj in bpy.context.scene.objects
            if obj.type == "MESH"
            and obj.get("comodel_component_id") == component_id
            and obj.data.shape_keys is not None
        )
    return result


def attach_eye_asset(bpy, args: dict) -> dict:
    component_id = safe_component_id(args.get("component_id"))
    asset_id = args.get("asset_id")
    asset = EYE_ASSETS.get(asset_id)
    if asset is None:
        raise ValueError("asset_id is not an installed eye asset")
    source_path = PROJECT_ROOT / asset["generated_path"]
    try:
        source_path.resolve().relative_to(PROJECT_ROOT.resolve())
    except ValueError as error:
        raise ValueError("Generated eye asset path is outside the project") from error
    if source_path.is_symlink() or not source_path.is_file():
        raise ValueError("Generated eye asset is unavailable")
    if _sha256_file(source_path) != asset["generated_sha256"]:
        raise ValueError("Generated eye asset hash does not match the pinned manifest")

    replacement_component_id = args.get("replace_component_id")
    if replacement_component_id is not None:
        safe_component_id(replacement_component_id)
        replaced_objects = [
            obj
            for obj in list(bpy.context.scene.objects)
            if obj.get("comodel_component_id") == replacement_component_id
        ]
        if not replaced_objects:
            raise ValueError("VALIDATION_FAILED: replacement eye component has no tagged Blender objects")
        for obj in replaced_objects:
            bpy.data.objects.remove(obj, do_unlink=True)

    objects_before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(source_path))
    imported_objects = list(set(bpy.context.scene.objects) - objects_before)
    if not imported_objects or not any(obj.type == "MESH" for obj in imported_objects):
        raise ValueError("Eye asset import produced no meshes")
    eye_geometry_names = (
        "eye",
        "cornea",
        "occlusion",
        "tearline",
        "tear_line",
        "iris",
        "sclera",
        "pupil",
    )
    eye_meshes = [
        obj
        for obj in imported_objects
        if obj.type == "MESH" and any(token in obj.name.lower() for token in eye_geometry_names)
    ]
    if not eye_meshes:
        raise ValueError("VALIDATION_FAILED: generated eye asset produced no eye geometry")
    kept_objects = set(eye_meshes)
    for obj in imported_objects:
        if obj not in kept_objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    object_ids = []
    material_names = set()
    geometry = hashlib.sha256()
    for index, obj in enumerate(eye_meshes):
        object_id = f"{component_id}-{index:04d}"
        obj["comodel_component_id"] = component_id
        obj["comodel_object_id"] = object_id
        obj["comodel_semantic_type"] = "eyes"
        object_ids.append(object_id)
        if obj.type == "MESH":
            geometry.update(obj.name.encode("utf-8"))
            geometry.update(str(len(obj.data.vertices)).encode("ascii"))
            for vertex in obj.data.vertices:
                geometry.update(struct.pack("<3f", *vertex.co))
            for polygon in obj.data.polygons:
                geometry.update(struct.pack("<3f", *polygon.center))
            for material in obj.data.materials:
                if material is not None:
                    material_names.add(material.name)
    return {
        "component_id": component_id,
        "asset_id": asset_id,
        "generated_sha256": asset["generated_sha256"],
        "geometry_hash": geometry.hexdigest(),
        "object_ids": object_ids,
        "material_names": sorted(material_names),
    }

def component_object_fingerprints(
    bpy,
    scoped_component_ids: set[str] | None = None,
) -> dict[str, tuple]:
    scoped_component_ids = scoped_component_ids or set()
    fingerprints = {}
    for obj in bpy.context.scene.objects:
        component_id = obj.get("comodel_component_id")
        object_id = obj.get("comodel_object_id")
        if not component_id or not object_id:
            continue
        if component_id in scoped_component_ids:
            fingerprints[object_id] = (component_id,)
            continue
        matrix = tuple(round(float(value), 6) for row in obj.matrix_world for value in row)
        mesh_data = obj.data if obj.type == "MESH" else None
        topology = (
            len(mesh_data.vertices),
            len(mesh_data.edges),
            len(mesh_data.polygons),
            tuple(
                round(float(coordinate), 6)
                for vertex in mesh_data.vertices
                for coordinate in vertex.co
            ),
        ) if mesh_data else None
        curve_geometry = (
            (
                tuple(curve.points_length for curve in obj.data.curves),
                tuple(
                    round(float(value), 6)
                    for point in obj.data.attributes["position"].data
                    for value in point.vector
                ),
            )
            if obj.type == "CURVES" and obj.data.attributes.get("position") is not None
            else None
        )
        pose = (
            tuple(
                (
                    bone.name,
                    tuple(round(float(value), 6) for value in bone.rotation_quaternion),
                    tuple(round(float(value), 6) for value in bone.rotation_euler),
                )
                for bone in obj.pose.bones
            )
            if obj.type == "ARMATURE" else None
        )
        materials = tuple(
            (
                material.name,
                material.surface_render_method,
                tuple(
                    (
                        round(float(node.inputs["Alpha"].default_value), 6),
                        any(
                            link.to_node == node and link.to_socket == node.inputs["Alpha"]
                            for link in material.node_tree.links
                        ),
                    )
                    for node in material.node_tree.nodes
                    if node.type == "BSDF_PRINCIPLED"
                ) if material.node_tree else (),
            )
            for material in obj.data.materials
            if material is not None
        ) if hasattr(obj.data, "materials") else ()
        fingerprints[object_id] = (
            component_id,
            matrix,
            topology,
            curve_geometry,
            pose,
            materials,
        )
    return fingerprints


def component_geometry_hash(bpy, component_id: str) -> str:
    geometry = []
    object_ids = []
    for obj in sorted(
        (item for item in bpy.context.scene.objects if item.get("comodel_component_id") == component_id),
        key=lambda item: str(item.get("comodel_object_id", "")),
    ):
        object_id = str(obj.get("comodel_object_id", ""))
        object_ids.append(object_id)
        vertices = (
            [[round(float(value), 6) for value in vertex.co] for vertex in obj.data.vertices]
            if obj.type == "MESH"
            else []
        )
        curve_points = (
            [
                [round(float(value), 6) for value in point.vector]
                for point in obj.data.attributes["position"].data
            ]
            if obj.type == "CURVES" and obj.data.attributes.get("position") is not None
            else []
        )
        curve_sizes = (
            [curve.points_length for curve in obj.data.curves]
            if obj.type == "CURVES"
            else []
        )
        ear_sculpt = (
            obj.data.shape_keys.key_blocks.get("CoModel_Ear_Sculpt")
            if obj.type == "MESH" and obj.data.shape_keys is not None
            else None
        )
        geometry.append({
            "object_id": object_id,
            "name": obj.name,
            "matrix": [[round(float(value), 6) for value in row] for row in obj.matrix_world],
            "vertices": vertices,
            "curve_points": curve_points,
            "curve_sizes": curve_sizes,
            "ear_sculpt": (
                [[round(float(value), 6) for value in vertex.co] for vertex in ear_sculpt.data]
                if ear_sculpt is not None
                else []
            ),
            "faces": [list(polygon.vertices) for polygon in obj.data.polygons] if obj.type == "MESH" else [],
        })
    if not geometry:
        raise ValueError("VALIDATION_FAILED: operation did not create component geometry")
    digest = hashlib.sha256(json.dumps(geometry, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    return digest, object_ids


def verify_operation_scope(before: dict[str, tuple], after: dict[str, tuple], allowed_component_ids: set[str]) -> None:
    for object_id, fingerprint in before.items():
        if fingerprint[0] not in allowed_component_ids and after.get(object_id) != fingerprint:
            raise ValueError(f"SCOPE_VIOLATION: unrelated object {object_id} changed")
    for object_id, fingerprint in after.items():
        if object_id not in before and fingerprint[0] not in allowed_component_ids:
            raise ValueError(f"SCOPE_VIOLATION: undeclared object {object_id} was created")


def ensure_regular_output_paths(output_dir: Path) -> None:
    for filename in (
        "scene.blend",
        "scene_candidate.blend",
        "preview.glb",
        "preview_candidate.glb",
        "result.json",
        "result.tmp",
        "worker-error.json",
        "worker-error.tmp",
    ):
        if (output_dir / filename).is_symlink():
            raise ValueError("Output files cannot be symbolic links")
    if any(path.is_symlink() for path in output_dir.glob("scene-v*.blend")):
        raise ValueError("Versioned scene files cannot be symbolic links")


def atomic_write_json(path: Path, payload: dict) -> None:
    file_descriptor, temporary_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(file_descriptor, "w", encoding="utf-8") as temporary_file:
            json.dump(payload, temporary_file, indent=2)
        os.replace(temporary_path, path)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise


def export_gltf_preview(
    bpy,
    path: Path,
    *,
    cc5_subdivision: bool = True,
    meshopt_compression: bool = True,
    export_attributes: bool = False,
) -> str:
    options = {"filepath": str(path), "export_format": "GLB"}
    meshopt_supported = (
        "export_meshopt_compression_enable"
        in bpy.ops.export_scene.gltf.get_rna_type().properties
    ) and meshopt_compression
    if meshopt_supported:
        options["export_meshopt_compression_enable"] = True
    if export_attributes:
        options["export_attributes"] = True
    morph_export_supported = "export_morph" in bpy.ops.export_scene.gltf.get_rna_type().properties
    if morph_export_supported:
        options["export_morph"] = False
    cc5_asset_ids = {
        asset_id
        for asset_id, spec in CC3_ASSET.items()
        if spec["format"] == "blend"
    }
    source_meshes = [
        obj
        for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        and obj.get("comodel_source_asset_id") in cc5_asset_ids
    ]
    if not source_meshes:
        bpy.ops.export_scene.gltf(**options)
    else:
        if "use_selection" not in bpy.ops.export_scene.gltf.get_rna_type().properties:
            raise RuntimeError("Blender glTF exporter cannot isolate baked CC5 preview meshes")
        original_names = [(obj, obj.name) for obj in source_meshes]
        selected_before = list(bpy.context.selected_objects)
        active_before = bpy.context.view_layer.objects.active
        preview_objects = []
        preview_meshes = []
        try:
            for source, source_name in original_names:
                subdivision_modifier = None
                subdivision_level = (
                    CC5_PREVIEW_SUBDIVISION_LEVELS.get(source_name)
                    if cc5_subdivision
                    else None
                )
                if subdivision_level is not None:
                    subdivision_modifier = source.modifiers.new(
                        name="CC3+ Preview Subdivision",
                        type="SUBSURF",
                    )
                    subdivision_modifier.subdivision_type = "CATMULL_CLARK"
                    subdivision_modifier.levels = subdivision_level
                    subdivision_modifier.render_levels = subdivision_level
                armature_modifiers = [
                    modifier
                    for modifier in source.modifiers
                    if modifier.type == "ARMATURE" and modifier.show_viewport
                ]
                for modifier in armature_modifiers:
                    modifier.show_viewport = False
                try:
                    bpy.context.view_layer.update()
                    depsgraph = bpy.context.evaluated_depsgraph_get()
                    evaluated = source.evaluated_get(depsgraph)
                    preview_mesh = bpy.data.meshes.new_from_object(
                        evaluated,
                        preserve_all_data_layers=True,
                        depsgraph=depsgraph,
                    )
                finally:
                    for modifier in armature_modifiers:
                        modifier.show_viewport = True
                    if subdivision_modifier is not None:
                        source.modifiers.remove(subdivision_modifier)
                    bpy.context.view_layer.update()

                if preview_mesh.shape_keys is not None:
                    bpy.data.meshes.remove(preview_mesh)
                    raise ValueError("VALIDATION_FAILED: static CC5 preview mesh retained shape keys")
                preview_meshes.append(preview_mesh)
                source.name = f"{source_name}__comodel_preview_source"
                preview_object = source.copy()
                preview_object.data = preview_mesh
                preview_object.name = source_name
                preview_object.matrix_world = source.matrix_world.copy()
                for modifier in list(preview_object.modifiers):
                    if modifier.type != "ARMATURE":
                        preview_object.modifiers.remove(modifier)
                preview_objects.append(preview_object)
                collections = list(source.users_collection)
                if collections:
                    for collection in collections:
                        collection.objects.link(preview_object)
                else:
                    bpy.context.scene.collection.objects.link(preview_object)

            preview_object_set = set(preview_objects)
            source_mesh_set = set(source_meshes)
            for obj in bpy.context.scene.objects:
                obj.select_set(False)
                if obj not in source_mesh_set and not obj.hide_get():
                    obj.select_set(True)
            for obj in preview_object_set:
                obj.select_set(True)
            bpy.context.view_layer.objects.active = (
                preview_objects[0] if preview_objects else active_before
            )
            options["use_selection"] = True
            bpy.ops.export_scene.gltf(**options)
        finally:
            for obj in preview_objects:
                bpy.data.objects.remove(obj, do_unlink=True)
            for mesh in preview_meshes:
                if mesh.users == 0:
                    bpy.data.meshes.remove(mesh)
            for obj, source_name in original_names:
                obj.name = source_name
            for obj in bpy.context.scene.objects:
                obj.select_set(False)
            for obj in selected_before:
                if obj.name in bpy.context.view_layer.objects:
                    obj.select_set(True)
            if active_before is not None and active_before.name in bpy.context.view_layer.objects:
                bpy.context.view_layer.objects.active = active_before
    compression = "meshopt" if meshopt_supported else "none"
    return f"{compression}-static" if morph_export_supported else f"{compression}-morphs"


def write_failure_report(job_path: Path, error: Exception) -> None:
    if job_path.is_symlink():
        return
    root = job_path.absolute().parent.resolve()
    output_dir = (root / "output").resolve()
    if root not in output_dir.parents:
        return
    output_dir.mkdir(parents=True, exist_ok=True)
    if (output_dir / "worker-error.json").is_symlink():
        return
    report = {
        "status": "failed",
        "error_type": type(error).__name__,
        "error": str(error)[:1000],
    }
    atomic_write_json(output_dir / "worker-error.json", report)


def main(*, force_staged_only: bool = False) -> int:
    import bpy  # Available only inside Blender's Python runtime.

    args = parse_args()
    staged_only = force_staged_only or args.staged_only
    job = load_job(Path(args.job), staged_only=staged_only)
    if staged_only != ("transaction_id" in job and "attempt_id" in job):
        raise ValueError("Worker staging mode does not match the transaction job identity")
    root = Path(job["_job_root"]).resolve()
    output_dir = (root / "output").resolve()
    # Ensure all outputs remain under the job workspace.
    if root not in output_dir.parents:
        raise ValueError("Invalid output path")
    output_dir.mkdir(parents=True, exist_ok=True)
    ensure_regular_output_paths(output_dir)
    previous_error = output_dir / "worker-error.json"
    if previous_error.exists():
        previous_error.unlink()

    committed_blend = output_dir / "scene.blend"
    if committed_blend.is_file():
        bpy.ops.wm.open_mainfile(filepath=str(committed_blend))
    project_id = job["project_id"]
    stored_project_id = bpy.context.scene.get("comodel_project_id")
    if stored_project_id not in (None, project_id):
        raise ValueError("PROJECT_SCOPE_VIOLATION: scene belongs to another project")
    current_version = int(bpy.context.scene.get("comodel_scene_version", 0))
    expected_version = job.get("expected_scene_version")
    if not isinstance(expected_version, int) or expected_version != current_version:
        raise ValueError(f"STALE_SCENE_VERSION: expected {expected_version!r}, current {current_version}")

    operation = job["operation"]
    op_args = job["arguments"]
    allowed_component_ids = (
        {op_args["component_id"]}
        if operation in {
            "import_base_model",
            "attach_eye_asset",
            "apply_cc3_morph_controls",
            "apply_cc3_body_preset",
            "preview_cc3_morph_controls",
            "bake_cc3_morph_controls",
        }
        else set()
    )
    if operation == "import_base_model" and op_args.get("eye_attachment"):
        allowed_component_ids.add(op_args["eye_attachment"]["component_id"])
    if operation == "attach_eye_asset" and op_args.get("replace_component_id"):
        allowed_component_ids.add(op_args["replace_component_id"])
    if operation == "attach_eye_asset" and current_version == 0:
        for obj in list(bpy.context.scene.objects):
            if obj.name in {"Cube", "Camera", "Light"} and not obj.get("comodel_component_id"):
                bpy.data.objects.remove(obj, do_unlink=True)
    before_fingerprints = component_object_fingerprints(bpy, allowed_component_ids)
    if operation == "restore_checkpoint":
        checkpoint_version = op_args["checkpoint_scene_version"]
        if checkpoint_version == 0:
            bpy.ops.wm.read_factory_settings(use_empty=False)
        else:
            checkpoint_path = output_dir / f"scene-v{checkpoint_version}.blend"
            if checkpoint_path.is_symlink() or not checkpoint_path.is_file():
                raise ValueError("CHECKPOINT_NOT_FOUND: Blender scene checkpoint is unavailable")
            bpy.ops.wm.open_mainfile(filepath=str(checkpoint_path))
        restored_project_id = bpy.context.scene.get("comodel_project_id")
        if checkpoint_version > 0 and restored_project_id != project_id:
            raise ValueError("PROJECT_SCOPE_VIOLATION: checkpoint belongs to another project")
        result = {"checkpoint_scene_version": checkpoint_version, "status": "restored"}
    elif operation == "import_base_model":
        allowed_component_ids.add(op_args["component_id"])
        result = import_base_model(
            bpy,
            op_args,
            clear_default_cube=current_version == 0 and not before_fingerprints,
        )
    elif operation == "attach_eye_asset":
        allowed_component_ids.add(op_args["component_id"])
        result = attach_eye_asset(bpy, op_args)
    elif operation == "apply_cc3_morph_controls":
        component_id = op_args["component_id"]
        allowed_component_ids.add(component_id)
        result = apply_cc3_morph_controls(bpy, op_args)
    elif operation == "apply_cc3_body_preset":
        component_id = op_args["component_id"]
        allowed_component_ids.add(component_id)
        result = apply_cc3_morph_controls(bpy, op_args)
        result.update(apply_cc3_body_preset(bpy, op_args))
    elif operation == "preview_cc3_morph_controls":
        component_id = op_args["component_id"]
        allowed_component_ids.add(component_id)
        result = apply_cc3_morph_controls(bpy, op_args)
    elif operation == "bake_cc3_morph_controls":
        component_id = op_args["component_id"]
        allowed_component_ids.add(component_id)
        result = bake_cc3_morph_controls(bpy, op_args)
    elif operation == "validate_scene_structure":
        result = validate_scene_structure(bpy)
    else:
        raise ValueError("Unsupported operation")
    if operation in {
        "import_base_model",
        "attach_eye_asset",
        "apply_cc3_morph_controls",
        "apply_cc3_body_preset",
        "preview_cc3_morph_controls",
        "bake_cc3_morph_controls",
    }:
        after_fingerprints = component_object_fingerprints(bpy, allowed_component_ids)
        verify_operation_scope(before_fingerprints, after_fingerprints, allowed_component_ids)
        if operation == "import_base_model":
            component_id = op_args["component_id"]
            geometry_hash, object_ids = component_geometry_hash(bpy, component_id)
            result["geometry_hash"] = geometry_hash
            result["object_ids"] = object_ids
        elif operation == "bake_cc3_morph_controls":
            result["baked_geometry_hash"], _ = component_geometry_hash(bpy, op_args["component_id"])
    structure_validation = validate_scene_structure(bpy)
    if structure_validation["status"] != "pass":
        raise ValueError("VALIDATION_FAILED: Blender scene contains duplicate CoModel object IDs")
    result["scene_structure_validation"] = structure_validation

    # Save to a candidate path first. Promote only after save succeeds; production should
    # also validate scope/manifest and perform this transaction in a disposable workspace.
    preview_only = operation == "preview_cc3_morph_controls"
    next_version = (
        current_version
        if operation in {"validate_scene_structure", "preview_cc3_morph_controls"}
        else current_version + 1
    )
    bpy.context.scene["comodel_project_id"] = project_id
    bpy.context.scene["comodel_scene_version"] = next_version
    candidate_blend = output_dir / "scene_candidate.blend"
    candidate_preview = output_dir / "preview_candidate.glb"
    if not preview_only:
        bpy.ops.wm.save_as_mainfile(filepath=str(candidate_blend))
    export_status = "not_run"
    try:
        result["preview_compression"] = export_gltf_preview(bpy, candidate_preview)
        export_status = "pass"
    except Exception as exc:
        result["preview_export_error"] = type(exc).__name__
        export_status = "fail"

    if not preview_only and current_version > 0 and committed_blend.is_file():
        versioned_scene = output_dir / f"scene-v{current_version}.blend"
        temporary_scene = output_dir / f".scene-v{current_version}.{os.getpid()}.tmp"
        if versioned_scene.is_symlink() or temporary_scene.is_symlink():
            raise ValueError("Versioned scene files cannot be symbolic links")
        try:
            os.link(committed_blend, temporary_scene)
        except OSError:
            shutil.copy2(committed_blend, temporary_scene)
        os.replace(temporary_scene, versioned_scene)
    if not staged_only:
        if not preview_only:
            os.replace(candidate_blend, committed_blend)
        if export_status == "pass" and candidate_preview.is_file():
            os.replace(candidate_preview, output_dir / "preview.glb")
        elif candidate_preview.exists():
            candidate_preview.unlink()

    result_doc = {
        "job_id": job.get("job_id"),
        "project_id": project_id,
        "operation_id": job["operation_id"],
        "operation": operation,
        **(
            {
                "transaction_id": job["transaction_id"],
                "attempt_id": job["attempt_id"],
                "api_contract_version": job["api_contract_version"],
                "worker_contract_version": WORKER_CONTRACT_VERSION,
            }
            if staged_only
            else {}
        ),
        "status": "completed" if export_status == "pass" else "completed_with_warning",
        "mode": "blender",
        "expected_scene_version": expected_version,
        "scene_version": next_version,
        "scope_component_ids": job["scope_component_ids"],
        "dependency_component_ids": job["dependency_component_ids"],
        "scene_file": (
            None if preview_only else
            "output/scene_candidate.blend" if staged_only else "output/scene.blend"
        ),
        "preview_file": (
            ("output/preview_candidate.glb" if staged_only else "output/preview.glb")
            if export_status == "pass" else None
        ),
        "preview_export_status": export_status,
        "result": result,
    }
    atomic_write_json(output_dir / "result.json", result_doc)
    print(json.dumps(result_doc))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        separator_index = sys.argv.index("--") if "--" in sys.argv else -1
        job_path = (
            Path(sys.argv[separator_index + 2])
            if separator_index >= 0 and len(sys.argv) > separator_index + 2
            else Path.cwd() / "job.json"
        )
        write_failure_report(job_path, exc)
        error = {"status": "failed", "error_type": type(exc).__name__, "error": str(exc)[:1000]}
        print(json.dumps(error), file=sys.stderr)
        sys.exit(1)
