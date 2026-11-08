"""Consolidate packed CC5 morph deltas into a rigged Blender scene and GLB."""

import argparse
import array
import hashlib
import json
import math
import shutil
import sys
import zipfile
import zlib
from pathlib import Path

import bpy
from mathutils import Vector


def parse_arguments():
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--blend-output", required=True, type=Path)
    parser.add_argument("--glb-output", required=True, type=Path)
    parser.add_argument("--report-output", required=True, type=Path)
    return parser.parse_args(arguments)


def require_file(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError("Input must be a regular, non-symlink file: {0}".format(path))
    return path.resolve()


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def normalized_name(name):
    return name[:-4] if len(name) > 4 and name[-4] == "." and name[-3:].isdigit() else name


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
    face_hash = hashlib.sha256(repr(faces).encode("utf-8")).hexdigest()
    matrix = tuple(tuple(float(value) for value in row) for row in mesh.matrix_world)
    return {
        "vertex_count": len(mesh.data.vertices),
        "edge_count": len(mesh.data.edges),
        "face_count": len(mesh.data.polygons),
        "faces_sha256": face_hash,
        "matrix_world": matrix,
    }


def load_manifest(path):
    manifest_path = require_file(path)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("format_version") != 1 or manifest.get("asset_id") != "character_cc5_base_plus_morphs_v1":
        raise ValueError("Unsupported CC5 morph manifest")
    if manifest.get("run_status") != "complete":
        raise ValueError("CC5 batch manifest is not complete")
    tasks = manifest.get("tasks", [])
    if len(tasks) != manifest.get("endpoint_count"):
        raise ValueError("Manifest endpoint count does not match task list")
    completed = set(manifest.get("completed_task_ids", []))
    if completed != {task.get("task_id") for task in tasks}:
        raise ValueError("Not all endpoint tasks are marked complete")
    neutral_path = require_file(Path(manifest["neutral_fbx"]))
    if manifest.get("neutral_sha256") != sha256_file(neutral_path):
        raise ValueError("Neutral FBX checksum does not match the batch manifest")
    return manifest_path, manifest, neutral_path


def decode_delta(archive, member, vertex_count):
    if not isinstance(member, str) or not member.startswith("deltas/") or ".." in Path(member).parts:
        raise ValueError("Invalid delta archive member path")
    values = array.array("f")
    values.frombytes(zlib.decompress(archive.read(member)))
    if sys.byteorder != "little":
        values.byteswap()
    if len(values) != vertex_count * 3:
        raise ValueError("Delta coordinate count does not match mesh vertex count")
    return values


def add_delta_shape(mesh_obj, shape_name, values):
    if mesh_obj.data.shape_keys is None:
        mesh_obj.shape_key_add(name="Basis", from_mix=False)
    key_blocks = mesh_obj.data.shape_keys.key_blocks
    if key_blocks.get(shape_name) is not None:
        raise ValueError("Duplicate shape key name: {0}".format(shape_name))
    basis = key_blocks[0]
    target = mesh_obj.shape_key_add(name=shape_name, from_mix=False)
    for index, point in enumerate(target.data):
        offset = index * 3
        point.co = basis.data[index].co + Vector((values[offset], values[offset + 1], values[offset + 2]))
    return target


def build_asset(manifest_path, blend_output, glb_output, report_output):
    manifest_path, manifest, neutral_path = load_manifest(manifest_path)
    batch_directory = manifest_path.parent / "deltas"
    batches = sorted(manifest.get("batches", []), key=lambda item: item["batch_index"])
    if not batches:
        raise ValueError("Manifest contains no packed delta batches")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    neutral_objects = import_fbx(neutral_path)
    meshes = mesh_map(neutral_objects, "neutral FBX")
    neutral_topology = {name: topology(mesh) for name, mesh in meshes.items()}
    expected_meshes = manifest.get("neutral_meshes")
    if expected_meshes and set(expected_meshes) != set(meshes):
        raise ValueError("Neutral mesh set differs from the original batch export")
    for name, description in (expected_meshes or {}).items():
        current = neutral_topology[name]
        for field in ("vertex_count", "edge_count", "face_count", "faces_sha256"):
            if current[field] != description[field]:
                raise ValueError("Neutral mesh {0} no longer matches recorded {1}".format(name, field))

    estimated_morph_bytes = (
        sum(item["vertex_count"] for item in neutral_topology.values())
        * 3 * 4 * len(manifest["tasks"])
    )
    required_free_bytes = estimated_morph_bytes * 2 + 1024 ** 3
    blend_output.parent.mkdir(parents=True, exist_ok=True)
    glb_output.parent.mkdir(parents=True, exist_ok=True)
    report_output.parent.mkdir(parents=True, exist_ok=True)
    available_bytes = shutil.disk_usage(blend_output.parent).free
    if available_bytes < required_free_bytes:
        raise ValueError(
            "Insufficient disk space for the consolidated asset. Estimated safe requirement: "
            "{0:.2f} GiB; available: {1:.2f} GiB.".format(
                required_free_bytes / (1024 ** 3), available_bytes / (1024 ** 3)
            )
        )

    tasks = {task["task_id"]: task for task in manifest["tasks"]}
    built_shapes = {name: [] for name in meshes}
    unchanged_tasks = []
    seen_tasks = set()
    for batch in batches:
        archive_path = require_file(Path(batch["archive"]))
        with zipfile.ZipFile(archive_path, "r") as archive:
            if archive.testzip() is not None:
                raise ValueError("Delta archive failed CRC validation: {0}".format(archive_path))
            packed = json.loads(archive.read("batch.json").decode("utf-8"))
            for target_report in packed.get("targets", []):
                task_id = target_report.get("task_id")
                task = tasks.get(task_id)
                if task is None or task_id in seen_tasks:
                    raise ValueError("Unknown or duplicate packed task: {0}".format(task_id))
                seen_tasks.add(task_id)
                if (
                    task.get("slider_id") != target_report.get("slider_id")
                    or task.get("endpoint") != target_report.get("endpoint")
                    or not math.isclose(float(task.get("weight")), float(target_report.get("weight")), abs_tol=1e-8)
                ):
                    raise ValueError("Packed task metadata differs from manifest: {0}".format(task_id))
                if not target_report.get("mesh_deltas"):
                    unchanged_tasks.append(task_id)
                    continue
                for delta in target_report["mesh_deltas"]:
                    mesh_name = delta.get("mesh_name")
                    mesh_obj = meshes.get(mesh_name)
                    if mesh_obj is None:
                        raise ValueError("Delta references unknown mesh {0}".format(mesh_name))
                    mesh_topology = neutral_topology[mesh_name]
                    if delta.get("vertex_count") != mesh_topology["vertex_count"]:
                        raise ValueError("Delta vertex count differs for mesh {0}".format(mesh_name))
                    values = decode_delta(archive, delta.get("member"), mesh_topology["vertex_count"])
                    add_delta_shape(mesh_obj, task["shape_key_name"], values)
                    built_shapes[mesh_name].append(task["shape_key_name"])

    if seen_tasks != set(tasks):
        raise ValueError("Packed archives do not cover the complete endpoint task list")

    bpy.ops.wm.save_as_mainfile(filepath=str(blend_output))

    operator_properties = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    export_options = {"filepath": str(glb_output), "export_format": "GLB"}
    if "export_morph" in operator_properties:
        export_options["export_morph"] = True
    meshopt_enabled = "export_meshopt_compression_enable" in operator_properties
    if meshopt_enabled:
        export_options["export_meshopt_compression_enable"] = True
    if "export_animations" in operator_properties:
        export_options["export_animations"] = False
    bpy.ops.export_scene.gltf(**export_options)
    if not glb_output.is_file() or glb_output.stat().st_size == 0:
        raise RuntimeError("Blender did not create the CC5 GLB")

    report = {
        "asset_id": manifest["asset_id"],
        "avatar_name": manifest["avatar_name"],
        "source_neutral_sha256": manifest["neutral_sha256"],
        "neutral_meshes": {
            name: {
                "vertex_count": item["vertex_count"],
                "edge_count": item["edge_count"],
                "face_count": item["face_count"],
            }
            for name, item in neutral_topology.items()
        },
        "endpoint_task_count": len(tasks),
        "built_shape_key_count": sum(len(names) for names in built_shapes.values()),
        "unchanged_endpoint_count": len(unchanged_tasks),
        "shape_keys_by_mesh": {name: len(names) for name, names in built_shapes.items()},
        "estimated_uncompressed_morph_bytes": estimated_morph_bytes,
        "required_free_bytes_at_build_start": required_free_bytes,
        "blend_output": str(blend_output),
        "blend_bytes": blend_output.stat().st_size,
        "glb_output": str(glb_output),
        "glb_bytes": glb_output.stat().st_size,
        "glb_compression": "meshopt" if meshopt_enabled else "none",
    }
    atomic_json(report_output, report)
    print(json.dumps(report, indent=2))
    return report


def main():
    arguments = parse_arguments()
    build_asset(arguments.manifest, arguments.blend_output, arguments.glb_output, arguments.report_output)


if __name__ == "__main__":
    main()
