import argparse
import json
import re
import sys
from pathlib import Path

import bpy


def parse_arguments():
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--neutral", required=True, type=Path)
    parser.add_argument("--modified", required=True, type=Path)
    parser.add_argument("--mesh-name", default="CC_Base_Body")
    parser.add_argument("--shape-key", required=True)
    parser.add_argument("--blend-output", required=True, type=Path)
    parser.add_argument("--glb-output", required=True, type=Path)
    parser.add_argument("--report-output", required=True, type=Path)
    return parser.parse_args(arguments)


def require_file(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Input must be a regular, non-symlink file: {path}")
    return path.resolve()


def imported_objects(path):
    existing = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(path), use_anim=False)
    return [obj for obj in bpy.data.objects if obj not in existing]


def normalized_name(name):
    return re.sub(r"\.\d{3}$", "", name)


def find_mesh(meshes, requested_name, label):
    matches = [obj for obj in meshes if normalized_name(obj.name) == requested_name]
    if len(matches) != 1:
        available = ", ".join(sorted(obj.name for obj in meshes)) or "none"
        raise ValueError(
            f"Expected one {requested_name!r} mesh in {label}; found {len(matches)}. "
            f"Imported meshes: {available}"
        )
    return matches[0]


def compatible_topology(neutral, modified):
    if len(neutral.data.vertices) != len(modified.data.vertices):
        raise ValueError("The neutral and modified meshes have different vertex counts")
    if len(neutral.data.polygons) != len(modified.data.polygons):
        raise ValueError("The neutral and modified meshes have different polygon counts")
    neutral_faces = [tuple(poly.vertices) for poly in neutral.data.polygons]
    modified_faces = [tuple(poly.vertices) for poly in modified.data.polygons]
    if neutral_faces != modified_faces:
        raise ValueError("The neutral and modified meshes have different topology or vertex order")
    for neutral_value, modified_value in zip(neutral.matrix_world, modified.matrix_world):
        if any(abs(a - b) > 1e-5 for a, b in zip(neutral_value, modified_value)):
            raise ValueError("The neutral and modified mesh transforms do not match")


def main():
    args = parse_arguments()
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", args.shape_key):
        raise ValueError("Shape-key names must be 1-64 ASCII letters, digits, or underscores")

    neutral_path = require_file(args.neutral)
    modified_path = require_file(args.modified)
    for output_path in (args.blend_output, args.glb_output, args.report_output):
        output_path.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    neutral_objects = imported_objects(neutral_path)
    neutral_meshes = [obj for obj in neutral_objects if obj.type == "MESH"]
    neutral_body = find_mesh(neutral_meshes, args.mesh_name, "neutral FBX")
    modified_objects = imported_objects(modified_path)
    modified_meshes = [obj for obj in modified_objects if obj.type == "MESH"]
    modified_body = find_mesh(modified_meshes, args.mesh_name, "modified FBX")
    compatible_topology(neutral_body, modified_body)

    if neutral_body.data.shape_keys is None:
        neutral_body.shape_key_add(name="Basis", from_mix=False)
    shape_keys = neutral_body.data.shape_keys.key_blocks
    if args.shape_key in shape_keys:
        raise ValueError(f"Shape key {args.shape_key!r} already exists on the neutral mesh")

    basis = shape_keys[0]
    target = neutral_body.shape_key_add(name=args.shape_key, from_mix=False)
    target.relative_key = basis
    changed_vertices = 0
    maximum_delta = 0.0
    for neutral_vertex, modified_vertex, target_vertex in zip(
        neutral_body.data.vertices, modified_body.data.vertices, target.data
    ):
        delta = (modified_vertex.co - neutral_vertex.co).length
        maximum_delta = max(maximum_delta, delta)
        if delta > 1e-7:
            changed_vertices += 1
        target_vertex.co = modified_vertex.co

    if changed_vertices == 0:
        raise ValueError("The modified mesh contains no measurable deformation")

    for existing_key in list(neutral_body.data.shape_keys.key_blocks):
        if existing_key != basis and existing_key != target:
            neutral_body.shape_key_remove(existing_key)

    for vertex, target_vertex in zip(neutral_body.data.vertices, target.data):
        vertex.co = target_vertex.co
    neutral_body.shape_key_clear()

    for obj in modified_objects:
        bpy.data.objects.remove(obj, do_unlink=True)

    for obj in list(bpy.context.scene.objects):
        if obj != neutral_body:
            bpy.data.objects.remove(obj, do_unlink=True)

    bpy.ops.object.select_all(action="DESELECT")
    neutral_body.select_set(True)
    bpy.context.view_layer.objects.active = neutral_body

    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))
    bpy.ops.export_scene.gltf(
        filepath=str(args.glb_output.resolve()),
        export_format="GLB",
        export_animations=False,
        use_selection=True,
        export_materials="NONE",
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
    )

    report = {
        "mesh_name": neutral_body.name,
        "shape_key": args.shape_key,
        "vertex_count": len(neutral_body.data.vertices),
        "polygon_count": len(neutral_body.data.polygons),
        "changed_vertex_count": changed_vertices,
        "maximum_vertex_delta": maximum_delta,
        "blend_output": str(args.blend_output.resolve()),
        "glb_output": str(args.glb_output.resolve()),
    }
    args.report_output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()