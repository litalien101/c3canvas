import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

import bpy
from mathutils.kdtree import KDTree


MAX_BASE_MAPPING_DISTANCE = 1e-4
SUPPORTED_ASSET_IDS = {"character_cc3_morphs_v1", "character_cc3_male_morphs_v1"}


def parse_arguments():
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--neutral", required=True, type=Path)
    parser.add_argument("--base-glb", required=True, type=Path)
    parser.add_argument("--exports-root", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--blend-output", required=True, type=Path)
    parser.add_argument("--glb-output", required=True, type=Path)
    parser.add_argument("--report-output", required=True, type=Path)
    parser.add_argument("--mesh-name", default="CC_Base_Body")
    parser.add_argument("--checkpoint-every", type=int, default=10)
    parser.add_argument("--resume", action="store_true")
    return parser.parse_args(arguments)


def require_file(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Input must be a regular, non-symlink file: {path}")
    return path.resolve()


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_manifest(path):
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if (
        not isinstance(manifest, dict)
        or manifest.get("format_version") != 1
        or manifest.get("asset_id") not in SUPPORTED_ASSET_IDS
        or not isinstance(manifest.get("controls"), list)
    ):
        raise ValueError("The CC3 morph manifest has an unsupported format")

    controls = manifest["controls"]
    control_ids = set()
    shape_keys = set()
    export_names = set()
    export_count = 0
    for control in controls:
        if not isinstance(control, dict):
            raise ValueError("Every CC3 morph control must be an object")
        control_id = control.get("id")
        if (
            not isinstance(control_id, str)
            or not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", control_id)
            or control_id in control_ids
        ):
            raise ValueError(f"Invalid or duplicate CC3 morph control ID: {control_id!r}")
        control_ids.add(control_id)
        minimum = control.get("minimum")
        maximum = control.get("maximum")
        if (
            isinstance(minimum, bool)
            or isinstance(maximum, bool)
            or not isinstance(minimum, (int, float))
            or not isinstance(maximum, (int, float))
            or not -1 <= minimum <= 0 <= maximum <= 1
            or minimum == maximum
        ):
            raise ValueError(f"Invalid value range for CC3 morph control {control_id}")
        for side, field, key_field in (
            ("positive", "positive_filename", "positive_shape_key"),
            ("negative", "negative_filename", "negative_shape_key"),
        ):
            filename = control.get(field)
            shape_key = control.get(key_field)
            if filename is None:
                if shape_key is not None:
                    raise ValueError(f"{control_id} has a shape key without a {side} export")
                continue
            if (
                not isinstance(filename, str)
                or Path(filename).name != filename
                or filename in export_names
                or not isinstance(shape_key, str)
                or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", shape_key)
                or shape_key in shape_keys
            ):
                raise ValueError(f"Invalid or duplicate {side} export for {control_id}")
            export_names.add(filename)
            shape_keys.add(shape_key)
            export_count += 1
        if (minimum < 0) != (control.get("negative_filename") is not None):
            raise ValueError(f"Negative range does not match the negative export for {control_id}")
        if (maximum > 0) != (control.get("positive_filename") is not None):
            raise ValueError(f"Positive range does not match the positive export for {control_id}")

    if (
        len(controls) != manifest.get("control_count")
        or export_count != manifest.get("export_count")
        or len(export_names) != export_count
    ):
        raise ValueError("CC3 morph manifest counts do not match its controls")
    return manifest


def import_fbx(path):
    existing = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(path), use_anim=False)
    return [obj for obj in bpy.data.objects if obj not in existing]


def import_glb(path):
    existing = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    return [obj for obj in bpy.data.objects if obj not in existing]


def normalized_name(name):
    return re.sub(r"\.\d{3}$", "", name)


def find_body(objects, requested_name, label):
    meshes = [
        obj for obj in objects
        if obj.type == "MESH" and normalized_name(obj.name) == requested_name
    ]
    if len(meshes) != 1:
        available = ", ".join(sorted(obj.name for obj in objects if obj.type == "MESH")) or "none"
        raise ValueError(
            f"Expected one {requested_name!r} mesh in {label}; found {len(meshes)}. "
            f"Imported meshes: {available}"
        )
    return meshes[0]


def topology_signature(mesh):
    return (
        len(mesh.data.vertices),
        tuple(tuple(poly.vertices) for poly in mesh.data.polygons),
        tuple(tuple(row) for row in mesh.matrix_world),
    )


def compatible_with_neutral(neutral_signature, modified):
    modified_signature = topology_signature(modified)
    if modified_signature[:2] != neutral_signature[:2]:
        raise ValueError("A modified FBX does not match the neutral topology or vertex order")
    if any(
        abs(left - right) > 1e-5
        for left_row, right_row in zip(neutral_signature[2], modified_signature[2])
        for left, right in zip(left_row, right_row)
    ):
        raise ValueError("A modified FBX has a different object transform from the neutral FBX")


def remove_objects(objects):
    for obj in objects:
        if obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)


def write_report(path, report):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    temporary_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    temporary_path.replace(path)


def save_checkpoint(blend_path, report_path, report):
    blend_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path.resolve()))
    report["completed_exports"] = len(report["exports"])
    write_report(report_path, report)


def main():
    args = parse_arguments()
    if args.checkpoint_every < 1:
        raise ValueError("--checkpoint-every must be at least one")

    neutral_path = require_file(args.neutral)
    base_glb_path = require_file(args.base_glb)
    manifest_path = require_file(args.manifest)
    if args.exports_root.is_symlink():
        raise ValueError("--exports-root must be a regular directory")
    exports_root = args.exports_root.resolve(strict=True)
    if not exports_root.is_dir():
        raise ValueError("--exports-root must be a regular directory")
    manifest = validate_manifest(manifest_path)
    base_glb_sha256 = sha256_file(base_glb_path)
    if base_glb_sha256 != manifest.get("base_glb_sha256"):
        raise ValueError("The pinned base GLB SHA-256 does not match the verified source asset")

    exports = []
    for control in manifest["controls"]:
        for side, field in (
            ("positive", "positive_filename"),
            ("negative", "negative_filename"),
        ):
            filename = control[field]
            if filename is None:
                continue
            path = exports_root / side / filename
            exports.append((control, side, require_file(path)))
    if len(exports) != manifest["export_count"]:
        raise ValueError("The number of supplied FBX exports does not match the manifest")
    supplied_files = {
        path.name
        for side in ("positive", "negative")
        for path in (exports_root / side).glob("*.Fbx")
    }
    if supplied_files != {path.name for _, _, path in exports}:
        raise ValueError("The supplied FBX export directories contain missing or extra files")

    manifest_sha256 = sha256_file(manifest_path)
    if args.resume and args.blend_output.is_file():
        bpy.ops.wm.open_mainfile(filepath=str(args.blend_output.resolve()))
        body = bpy.data.objects.get(args.mesh_name)
        if (
            body is None
            or body.get("comodel_cc3_build_manifest_sha256") != manifest_sha256
            or body.get("comodel_cc3_build_base_sha256") != base_glb_sha256
        ):
            raise ValueError("The checkpoint does not match this manifest and pinned base asset")
        completed_names = set(json.loads(body.get("comodel_cc3_completed_export_names_json", "[]")))
    else:
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.object.delete(use_global=False)
        base_objects = import_glb(base_glb_path)
        body = find_body(base_objects, args.mesh_name, "base GLB")
        body_shape_keys = body.data.shape_keys
        if body_shape_keys is None:
            raise ValueError("The pinned CC3 base GLB has no body shape keys")
        for key in body_shape_keys.key_blocks:
            key.value = 0.0
        body["comodel_cc3_build_manifest_sha256"] = manifest_sha256
        body["comodel_cc3_build_base_sha256"] = base_glb_sha256
        body["comodel_cc3_completed_export_names_json"] = "[]"
        completed_names = set()

    body = bpy.data.objects.get(args.mesh_name)
    if body is None or body.type != "MESH" or body.data.shape_keys is None:
        raise ValueError("The build scene is missing the CC3 body shape keys")
    basis = body.data.shape_keys.key_blocks[0]
    original_key_names = {key.name for key in body.data.shape_keys.key_blocks}
    expected_shape_key_names = {
        control[field]
        for control in manifest["controls"]
        for field in ("positive_shape_key", "negative_shape_key")
        if control[field] is not None
    }
    if len(expected_shape_key_names) != manifest["export_count"]:
        raise ValueError("CC3 morph shape-key names must be unique")
    if manifest.get("body_shape_key_count") != len(original_key_names | expected_shape_key_names):
        raise ValueError("Manifest body shape-key count does not match the pinned base asset")

    neutral_objects = import_fbx(neutral_path)
    neutral_body = find_body(neutral_objects, args.mesh_name, "neutral FBX")
    neutral_signature = topology_signature(neutral_body)
    neutral_matrix = neutral_body.matrix_world.copy()
    neutral_positions = [
        neutral_matrix @ vertex.co
        for vertex in neutral_body.data.vertices
    ]
    source_tree = KDTree(len(neutral_positions))
    for index, position in enumerate(neutral_positions):
        source_tree.insert(position, index)
    source_tree.balance()
    base_to_neutral = []
    maximum_mapping_distance = 0.0
    base_matrix = body.matrix_world.copy()
    base_matrix_inverse = base_matrix.inverted()
    for vertex in body.data.vertices:
        _, index, distance = source_tree.find(base_matrix @ basis.data[vertex.index].co)
        if distance > MAX_BASE_MAPPING_DISTANCE:
            raise ValueError(
                f"Base GLB vertex {vertex.index} has no safe neutral correspondence "
                f"(distance {distance:.8f})"
            )
        maximum_mapping_distance = max(maximum_mapping_distance, distance)
        base_to_neutral.append(index)
    remove_objects(neutral_objects)

    report = {
        "asset_id": manifest["asset_id"],
        "manifest_sha256": manifest_sha256,
        "base_glb_sha256": base_glb_sha256,
        "neutral_fbx_sha256": sha256_file(neutral_path),
        "neutral_vertex_count": len(neutral_positions),
        "base_vertex_count": len(body.data.vertices),
        "base_mapping_maximum_distance": maximum_mapping_distance,
        "expected_export_count": manifest["export_count"],
        "expected_shape_key_count": len(original_key_names | expected_shape_key_names),
        "exports": [],
    }
    if args.report_output.is_file():
        previous_report = json.loads(args.report_output.read_text(encoding="utf-8"))
        if previous_report.get("manifest_sha256") == manifest_sha256:
            report["exports"] = [
                item for item in previous_report.get("exports", [])
                if item.get("filename") in completed_names
            ]

    for control, side, modified_path in exports:
        shape_key_name = control[f"{side}_shape_key"]
        if shape_key_name in completed_names:
            continue
        imported = import_fbx(modified_path)
        modified_body = find_body(imported, args.mesh_name, str(modified_path))
        compatible_with_neutral(neutral_signature, modified_body)
        modified_positions = [
            modified_body.matrix_world @ vertex.co
            for vertex in modified_body.data.vertices
        ]
        changed_vertex_count = 0
        maximum_vertex_delta = 0.0
        for neutral_position, modified_position in zip(neutral_positions, modified_positions):
            delta_length = (modified_position - neutral_position).length
            maximum_vertex_delta = max(maximum_vertex_delta, delta_length)
            changed_vertex_count += delta_length > 1e-7
        if changed_vertex_count == 0:
            remove_objects(imported)
            raise ValueError(f"{modified_path.name} contains no measurable body deformation")

        key_blocks = body.data.shape_keys.key_blocks
        target = key_blocks.get(shape_key_name)
        if target is None:
            target = body.shape_key_add(name=shape_key_name, from_mix=False)
        target.relative_key = basis
        base_delta_matrix = base_matrix_inverse.to_3x3()
        for base_index, neutral_index in enumerate(base_to_neutral):
            world_delta = modified_positions[neutral_index] - neutral_positions[neutral_index]
            target.data[base_index].co = (
                basis.data[base_index].co + base_delta_matrix @ world_delta
            )
        remove_objects(imported)
        completed_names.add(shape_key_name)
        body["comodel_cc3_completed_export_names_json"] = json.dumps(
            sorted(completed_names),
            separators=(",", ":"),
        )
        report["exports"] = [
            item for item in report["exports"]
            if item.get("shape_key") != shape_key_name
        ]
        report["exports"].append({
            "control_id": control["id"],
            "side": side,
            "filename": modified_path.name,
            "shape_key": shape_key_name,
            "changed_vertex_count": changed_vertex_count,
            "maximum_vertex_delta": maximum_vertex_delta,
        })
        if len(completed_names) % args.checkpoint_every == 0:
            save_checkpoint(args.blend_output, args.report_output, report)
        if len(completed_names) % 25 == 0:
            bpy.data.orphans_purge(do_recursive=True)
            print(f"Processed {len(completed_names)} of {manifest['export_count']} morph exports")

    if completed_names != expected_shape_key_names:
        raise ValueError("The completed export set does not match the morph manifest")
    if len(body.data.shape_keys.key_blocks) != report["expected_shape_key_count"]:
        raise ValueError(
            "The consolidated body shape-key count does not match the manifest "
            f"({len(body.data.shape_keys.key_blocks)} found, "
            f"{report['expected_shape_key_count']} expected)"
        )
    for control in manifest["controls"]:
        for side in ("positive", "negative"):
            key_name = control[f"{side}_shape_key"]
            if key_name is not None:
                body.data.shape_keys.key_blocks[key_name].value = 0.0

    body["comodel_cc3_morph_control_count"] = manifest["control_count"]
    body["comodel_cc3_morph_export_count"] = manifest["export_count"]
    body["comodel_cc3_completed_export_names_json"] = json.dumps(
        sorted(completed_names),
        separators=(",", ":"),
    )
    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.context.scene.objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = body
    args.blend_output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output.resolve()))
    args.glb_output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(args.glb_output.resolve()),
        export_format="GLB",
        export_animations=False,
    )
    report.update({
        "completed_exports": len(report["exports"]),
        "final_shape_key_count": len(body.data.shape_keys.key_blocks),
        "morph_control_count": manifest["control_count"],
        "positive_export_count": sum(
            control["positive_filename"] is not None
            for control in manifest["controls"]
        ),
        "negative_export_count": sum(
            control["negative_filename"] is not None
            for control in manifest["controls"]
        ),
        "blend_output": str(args.blend_output.resolve()),
        "glb_output": str(args.glb_output.resolve()),
        "glb_sha256": sha256_file(args.glb_output),
        "glb_bytes": args.glb_output.stat().st_size,
    })
    write_report(args.report_output, report)
    print(json.dumps({key: value for key, value in report.items() if key != "exports"}, indent=2))


if __name__ == "__main__":
    main()
