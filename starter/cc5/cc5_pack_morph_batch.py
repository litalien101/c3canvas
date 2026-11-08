import argparse
import array
import hashlib
import json
import math
import re
import sys
import zlib
import zipfile
from pathlib import Path

import bpy
from mathutils import Vector

TOPOLOGY_TOLERANCE = 1e-5
DELTA_TOLERANCE = 1e-7


def parse_arguments():
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--neutral", required=True, type=Path)
    parser.add_argument("--jobs", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args(arguments)


def require_file(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError("Input must be a regular, non-symlink file: {0}".format(path))
    return path.resolve()


def normalized_name(name):
    return re.sub(r"\.\d{3}$", "", name)


def import_fbx(path):
    existing = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(path), use_anim=False)
    return [obj for obj in bpy.data.objects if obj not in existing]


def mesh_map(objects, label):
    meshes = {}
    for obj in objects:
        if obj.type != "MESH":
            continue
        name = normalized_name(obj.name)
        if name in meshes:
            raise ValueError("Duplicate mesh {0!r} in {1}".format(name, label))
        meshes[name] = obj
    if not meshes:
        raise ValueError("No meshes imported from {0}".format(label))
    return meshes


def topology(mesh):
    faces = tuple(tuple(int(index) for index in polygon.vertices) for polygon in mesh.data.polygons)
    digest = hashlib.sha256(repr(faces).encode("utf-8")).hexdigest()
    matrix = tuple(tuple(float(value) for value in row) for row in mesh.matrix_world)
    return {
        "vertex_count": len(mesh.data.vertices),
        "edge_count": len(mesh.data.edges),
        "face_count": len(mesh.data.polygons),
        "faces_sha256": digest,
        "matrix_world": matrix,
    }


def validate_compatible(base, target, base_topology, label):
    target_topology = topology(target)
    for key in ("vertex_count", "edge_count", "face_count", "faces_sha256"):
        if base_topology[key] != target_topology[key]:
            raise ValueError("Mesh {0} has mismatched {1} in {2}".format(base.name, key, label))
    for base_row, target_row in zip(base_topology["matrix_world"], target_topology["matrix_world"]):
        for base_value, target_value in zip(base_row, target_row):
            if abs(base_value - target_value) > TOPOLOGY_TOLERANCE:
                raise ValueError("Mesh {0} has a different object transform in {1}".format(base.name, label))


def encode_delta(base, target):
    values = array.array("f")
    maximum = 0.0
    changed = 0
    for base_vertex, target_vertex in zip(base.data.vertices, target.data.vertices):
        delta = target_vertex.co - base_vertex.co
        distance = delta.length
        maximum = max(maximum, distance)
        if distance > DELTA_TOLERANCE:
            changed += 1
        values.extend((delta.x, delta.y, delta.z))
    return zlib.compress(values.tobytes(), level=6), maximum, changed


def write_batch(neutral_path, jobs_path, output_path):
    neutral_path = require_file(neutral_path)
    jobs_path = require_file(jobs_path)
    jobs = json.loads(jobs_path.read_text(encoding="utf-8"))
    if not isinstance(jobs, list) or not jobs:
        raise ValueError("Jobs file must contain at least one export task")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    neutral_objects = import_fbx(neutral_path)
    neutral_meshes = mesh_map(neutral_objects, "neutral FBX")
    neutral_topology = {name: topology(mesh) for name, mesh in neutral_meshes.items()}

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = output_path.with_suffix(output_path.suffix + ".tmp")
    batch_report = {
        "format_version": 1,
        "neutral_filename": neutral_path.name,
        "neutral_meshes": neutral_topology,
        "targets": [],
    }
    with zipfile.ZipFile(temporary_path, "w", compression=zipfile.ZIP_STORED) as archive:
        for task_index, task in enumerate(jobs):
            task_id = task.get("task_id")
            modified_path = require_file(Path(task["fbx_path"]))
            imported_objects = import_fbx(modified_path)
            modified_meshes = mesh_map(imported_objects, str(task_id))
            if set(modified_meshes) != set(neutral_meshes):
                raise ValueError("Mesh name set differs from neutral for task {0}".format(task_id))

            target_report = {
                "task_id": task_id,
                "slider_id": task.get("slider_id"),
                "display_name": task.get("display_name"),
                "endpoint": task.get("endpoint"),
                "weight": task.get("weight"),
                "mesh_deltas": [],
            }
            for mesh_index, name in enumerate(sorted(neutral_meshes)):
                base = neutral_meshes[name]
                modified = modified_meshes[name]
                validate_compatible(base, modified, neutral_topology[name], str(task_id))
                compressed, maximum, changed = encode_delta(base, modified)
                if maximum > DELTA_TOLERANCE:
                    member = "deltas/{0:05d}_{1:02d}.f32z".format(task_index, mesh_index)
                    archive.writestr(member, compressed)
                    target_report["mesh_deltas"].append({
                        "mesh_name": name,
                        "vertex_count": neutral_topology[name]["vertex_count"],
                        "member": member,
                        "encoding": "zlib-f32x3-local-delta",
                        "max_displacement": maximum,
                        "changed_vertex_count": changed,
                    })
            batch_report["targets"].append(target_report)
            remove = [obj for obj in imported_objects if obj.name in bpy.data.objects]
            for obj in remove:
                bpy.data.objects.remove(obj, do_unlink=True)
            print("Packed {0} ({1}/{2}); affected meshes: {3}".format(
                task_id, task_index + 1, len(jobs), len(target_report["mesh_deltas"])
            ))

        archive.writestr("batch.json", json.dumps(batch_report, ensure_ascii=False, separators=(",", ":")))

    with zipfile.ZipFile(temporary_path, "r") as archive:
        if archive.testzip() is not None:
            temporary_path.unlink(missing_ok=True)
            raise ValueError("Packed delta archive failed CRC validation")
    temporary_path.replace(output_path)
    return batch_report


def main():
    args = parse_arguments()
    result = write_batch(args.neutral, args.jobs, args.output)
    print(json.dumps({
        "output": str(args.output),
        "target_count": len(result["targets"]),
        "mesh_delta_count": sum(len(target["mesh_deltas"]) for target in result["targets"]),
    }, indent=2))


if __name__ == "__main__":
    main()
