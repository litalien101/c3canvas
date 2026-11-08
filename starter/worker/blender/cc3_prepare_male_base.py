import argparse
import hashlib
import json
import sys
from pathlib import Path

import bpy


EXPECTED_MESHES = {"CC_Base_Body", "CC_Base_Eye", "CC_Base_Teeth", "CC_Base_Tongue"}
EXPECTED_BODY_VERTICES = 13286
EXPECTED_BODY_SHAPE_KEYS = 69
EXPECTED_BONES = 101


def parse_arguments():
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--neutral", required=True, type=Path)
    parser.add_argument("--glb-output", required=True, type=Path)
    parser.add_argument("--report-output", required=True, type=Path)
    return parser.parse_args(arguments)


def require_regular_file(path: Path) -> Path:
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Input must be a regular, non-symlink file: {path}")
    return path.resolve()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_report(path: Path, report: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    temporary_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    temporary_path.replace(path)


def main():
    args = parse_arguments()
    neutral_path = require_regular_file(args.neutral)
    if args.glb_output.exists() or args.glb_output.is_symlink():
        raise ValueError("The base GLB output path already exists")
    if args.report_output.exists() or args.report_output.is_symlink():
        raise ValueError("The base report output path already exists")

    args.glb_output.parent.mkdir(parents=True, exist_ok=True)
    args.report_output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(neutral_path), use_anim=False)

    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    mesh_by_name = {obj.name: obj for obj in meshes}
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if set(mesh_by_name) != EXPECTED_MESHES or len(meshes) != len(EXPECTED_MESHES):
        raise ValueError(f"Male base FBX meshes do not match the CC3 contract: {sorted(mesh_by_name)}")
    if len(armatures) != 1 or len(armatures[0].data.bones) != EXPECTED_BONES:
        raise ValueError("Male base FBX must contain exactly one 101-bone armature")

    body = mesh_by_name["CC_Base_Body"]
    if (
        len(body.data.vertices) != EXPECTED_BODY_VERTICES
        or body.data.shape_keys is None
        or len(body.data.shape_keys.key_blocks) != EXPECTED_BODY_SHAPE_KEYS
    ):
        raise ValueError("Male base body topology or original shape-key count does not match the verified source")

    armature = armatures[0]
    armature.name = "CC_Base"
    armature.data.name = "CC_Base"
    for obj in meshes:
        for modifier in obj.modifiers:
            if modifier.type == "ARMATURE" and modifier.object is not None:
                modifier.object = armature
        if obj.data.shape_keys:
            for key in obj.data.shape_keys.key_blocks:
                key.value = 0.0
    for image in bpy.data.images:
        if image.users > 0 and image.size[0] > 0 and not image.packed_file:
            image.pack()

    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    for obj in [*meshes, armature]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.export_scene.gltf(
        filepath=str(args.glb_output.resolve()),
        export_format="GLB",
        export_animations=False,
        export_skins=True,
        export_morph=True,
        export_image_format="AUTO",
    )

    report = {
        "source_fbx_sha256": sha256_file(neutral_path),
        "base_glb_sha256": sha256_file(args.glb_output),
        "base_glb_bytes": args.glb_output.stat().st_size,
        "mesh_count": len(meshes),
        "mesh_names": sorted(mesh_by_name),
        "body_vertex_count": len(body.data.vertices),
        "body_shape_key_count": len(body.data.shape_keys.key_blocks),
        "armature_name": armature.name,
        "bone_count": len(armature.data.bones),
        "source_material_names": sorted({
            material.name
            for obj in meshes
            for material in obj.data.materials
            if material is not None
        }),
    }
    write_report(args.report_output, report)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
