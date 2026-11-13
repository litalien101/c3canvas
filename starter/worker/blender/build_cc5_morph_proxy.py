"""Build a local CC5 browser proxy and lazy morph-delta archive."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
import zipfile

import bpy
from bpy_extras.io_utils import axis_conversion

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cc5_proxy_textures import downscale_detail_textures
import worker_entry as worker


ASSET_ID = "character_cc5_rlcc3plus_all_morphs_v1"
ASSET_DIRECTORY = Path(__file__).resolve().parent / "assets"
PROXY_FILENAME = "CC5_RL_CC3_Plus_Morph_Proxy.glb"
DELTAS_FILENAME = "CC5_RL_CC3_Plus_Morph_Deltas.zip"
BUILD_MANIFEST_FILENAME = "CC5_RL_CC3_Plus_Morph_Proxy.json"
VERTEX_ATTRIBUTE = "_COMODEL_SOURCE_VERTEX"
GLB_JSON_CHUNK = 0x4E4F534A
GLB_BINARY_CHUNK = 0x004E4942
BODY_PRESETS_MANIFEST = worker.CC3_SHARED_ROOT / "cc5_body_presets.json"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_glb(path: Path) -> tuple[dict, bytes, list[tuple[int, bytes]]]:
    data = path.read_bytes()
    magic, version, total_length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or version != 2 or total_length != len(data):
        raise ValueError("Blender produced an invalid morph proxy GLB")
    chunks = []
    offset = 12
    gltf = None
    while offset < len(data):
        length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        chunk = data[offset:offset + length]
        if len(chunk) != length:
            raise ValueError("Morph proxy GLB has a truncated chunk")
        offset += length
        chunks.append((chunk_type, chunk))
        if chunk_type == GLB_JSON_CHUNK:
            gltf = json.loads(chunk.rstrip(b"\x00 ").decode("utf-8"))
    if gltf is None or sum(kind == GLB_BINARY_CHUNK for kind, _ in chunks) != 1:
        raise ValueError("Morph proxy GLB must contain one JSON and one binary chunk")
    binary = next(chunk for kind, chunk in chunks if kind == GLB_BINARY_CHUNK)
    return gltf, binary, chunks


def accessor_values(gltf: dict, binary: bytes, accessor_index: int) -> list[int]:
    accessor = gltf["accessors"][accessor_index]
    if accessor.get("type") != "SCALAR" or accessor.get("normalized"):
        raise ValueError("Morph proxy source-vertex attribute has an unsupported format")
    component_types = {
        5121: ("<B", 1),
        5123: ("<H", 2),
        5124: ("<i", 4),
        5125: ("<I", 4),
        5126: ("<f", 4),
    }
    component = component_types.get(accessor.get("componentType"))
    if component is None:
        raise ValueError("Morph proxy source-vertex attribute must use an unsigned integer")
    format_string, element_size = component
    view = gltf["bufferViews"][accessor["bufferView"]]
    stride = view.get("byteStride", element_size)
    if stride < element_size:
        raise ValueError("Morph proxy source-vertex attribute has an invalid stride")
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    count = accessor["count"]
    values = [
        struct.unpack_from(format_string, binary, start + index * stride)[0]
        for index in range(count)
    ]
    if accessor["componentType"] == 5126:
        rounded = [round(value) for value in values]
        if any(abs(value - index) > 1e-4 for value, index in zip(values, rounded, strict=True)):
            raise ValueError("Morph proxy source-vertex mapping contains non-integer values")
        return [int(value) for value in rounded]
    return [int(value) for value in values]


def pack_target(records: list[tuple[int, int, list[tuple[int, float, float, float]]]]) -> bytes:
    packed = bytearray()
    for mesh_index, primitive_index, deltas in records:
        packed.extend(struct.pack("<BHI", mesh_index, primitive_index, len(deltas)))
        for vertex_index, x, y, z in deltas:
            packed.extend(struct.pack("<Ifff", vertex_index, x, y, z))
    return bytes(packed)


def build_body_preset_delta(
    preset: dict,
    meshes: dict[str, bpy.types.Object],
    source_to_proxy: dict[str, list[list[tuple[int, int]]]],
    mesh_index_by_name: dict[str, int],
    blender_to_gltf,
) -> bytes:
    project_root = worker.CC3_SHARED_ROOT.parent.parent
    source_path = project_root / preset["source_path"]
    if source_path.is_symlink() or not source_path.is_file():
        raise ValueError(f"Body preset source is unavailable: {preset['id']}")
    if sha256_file(source_path) != preset["source_sha256"]:
        raise ValueError(f"Body preset source hash does not match: {preset['id']}")

    objects_before_import = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(source_path), use_anim=False)
    imported_objects = set(bpy.data.objects) - objects_before_import
    imported_meshes = {
        obj.name.rsplit(".", 1)[0]: obj
        for obj in imported_objects
        if obj.type == "MESH"
    }
    mesh_name = preset["mesh_name"]
    source_mesh = meshes.get(mesh_name)
    target_mesh = imported_meshes.get(mesh_name)
    if source_mesh is None or target_mesh is None:
        raise ValueError(f"Body preset is missing its expected {mesh_name} mesh")
    source_keys = source_mesh.data.shape_keys
    target_keys = target_mesh.data.shape_keys
    if source_keys is None or target_keys is None:
        raise ValueError(f"Body preset is missing its {mesh_name} Basis shape")
    source_basis = source_keys.key_blocks[0]
    target_basis = target_keys.key_blocks[0]
    if (
        len(source_basis.data) != len(target_basis.data)
        or len(source_mesh.data.polygons) != len(target_mesh.data.polygons)
        or any(
            tuple(source_polygon.vertices) != tuple(target_polygon.vertices)
            for source_polygon, target_polygon in zip(
                source_mesh.data.polygons,
                target_mesh.data.polygons,
                strict=True,
            )
        )
    ):
        raise ValueError(f"Body preset topology does not match {mesh_name}")

    try:
        body_inverse = source_mesh.matrix_world.inverted()
        body_delta_by_vertex = [
            body_inverse @ (target_mesh.matrix_world @ target_vertex.co) - source_vertex.co
            for target_vertex, source_vertex in zip(
                target_basis.data,
                source_basis.data,
                strict=True,
            )
        ]
        source_mesh.data.calc_loop_triangles()
        triangles = [
            tuple(triangle.vertices)
            for triangle in source_mesh.data.loop_triangles
        ]
        from mathutils.bvhtree import BVHTree

        body_bvh = BVHTree.FromPolygons(
            [vertex.co.copy() for vertex in source_mesh.data.vertices],
            triangles,
            all_triangles=True,
        )
        deltas_by_primitive: dict[
            tuple[int, int], list[tuple[int, float, float, float]]
        ] = {}
        for current_mesh_name, current_mesh in meshes.items():
            if current_mesh_name == mesh_name:
                body_deltas = body_delta_by_vertex
            else:
                body_deltas = []
                for vertex in current_mesh.data.vertices:
                    body_local_point = body_inverse @ (
                        current_mesh.matrix_world @ vertex.co
                    )
                    nearest = body_bvh.find_nearest(body_local_point)
                    if nearest is None or nearest[2] is None:
                        raise ValueError(
                            f"Could not map {current_mesh_name} to the preset body surface"
                        )
                    closest_point, _, triangle_index, _ = nearest
                    first, second, third = triangles[triangle_index]
                    a = source_mesh.data.vertices[first].co
                    edge_a = source_mesh.data.vertices[second].co - a
                    edge_b = source_mesh.data.vertices[third].co - a
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
                    body_deltas.append(
                        body_delta_by_vertex[first] * weight_a
                        + body_delta_by_vertex[second] * weight_b
                        + body_delta_by_vertex[third] * weight_c
                    )

            body_to_current_mesh = (
                current_mesh.matrix_world.inverted().to_3x3()
                @ source_mesh.matrix_world.to_3x3()
            )
            for source_index, body_delta in enumerate(body_deltas):
                current_mesh_delta = (
                    body_delta
                    if current_mesh_name == mesh_name
                    else body_to_current_mesh @ body_delta
                )
                world_delta = (
                    source_mesh.matrix_world.to_3x3() @ body_delta
                    if current_mesh_name == mesh_name
                    else current_mesh.matrix_world.to_3x3() @ current_mesh_delta
                )
                delta = blender_to_gltf @ world_delta
                if delta.length_squared <= 1e-14:
                    continue
                for primitive_index, proxy_index in source_to_proxy[current_mesh_name][source_index]:
                    deltas_by_primitive.setdefault(
                        (mesh_index_by_name[current_mesh_name], primitive_index),
                        [],
                    ).append((
                        proxy_index,
                        float(delta.x),
                        float(delta.y),
                        float(delta.z),
                    ))
        records = [
            (mesh_index, primitive_index, deltas)
            for (mesh_index, primitive_index), deltas in sorted(deltas_by_primitive.items())
        ]
        target = pack_target(records)
        return struct.pack("<4sBHH", b"CMMD", 1, len(records), 0) + target
    finally:
        for obj in imported_objects:
            bpy.data.objects.remove(obj, do_unlink=True)
        for datablocks in (
            bpy.data.armatures,
            bpy.data.curves,
            bpy.data.meshes,
            bpy.data.materials,
            bpy.data.images,
        ):
            orphaned = [datablock for datablock in datablocks if datablock.users == 0]
            bpy.data.batch_remove(orphaned)


def main() -> None:
    manifest = worker.CC3_MORPH_MANIFESTS.get(ASSET_ID)
    if manifest is None:
        raise ValueError("The pinned CC5 source manifest is unavailable")

    component_id = "cc5-morph-proxy"
    worker._import_character_cc5_blend(
        bpy,
        component_id,
        ASSET_ID,
        clear_default_cube=True,
    )
    meshes = {
        str(obj.get("comodel_source_group")): obj
        for obj in bpy.context.scene.objects
        if obj.type == "MESH" and obj.get("comodel_source_asset_id") == ASSET_ID
    }
    expected_names = list(manifest["mesh_names"])
    preset_manifest = json.loads(BODY_PRESETS_MANIFEST.read_text(encoding="utf-8"))
    if (
        preset_manifest.get("format_version") != 1
        or preset_manifest.get("asset_id") != ASSET_ID
        or not isinstance(preset_manifest.get("presets"), list)
    ):
        raise ValueError("The CC5 body preset manifest is invalid")
    if set(meshes) != set(expected_names):
        raise ValueError("Imported CC5 proxy meshes do not match the pinned manifest")
    preview_texture_dimensions = downscale_detail_textures(bpy.data.images)
    blender_to_gltf = axis_conversion(
        from_forward="Y",
        from_up="Z",
        to_forward="-Z",
        to_up="Y",
    ).to_3x3()

    for mesh in meshes.values():
        attribute = mesh.data.attributes.get(VERTEX_ATTRIBUTE)
        if attribute is None:
            attribute = mesh.data.attributes.new(
                name=VERTEX_ATTRIBUTE,
                type="INT",
                domain="POINT",
            )
        for index, item in enumerate(attribute.data):
            item.value = index

    with tempfile.TemporaryDirectory(prefix="comodel-cc5-proxy-") as temporary_directory:
        temporary_glb = Path(temporary_directory) / "proxy.glb"
        worker.export_gltf_preview(
            bpy,
            temporary_glb,
            cc5_subdivision=False,
            meshopt_compression=True,
            export_attributes=True,
        )
        gltf, binary, chunks = read_glb(temporary_glb)
        mesh_index_by_name = {name: index for index, name in enumerate(expected_names)}
        source_to_proxy = {
            name: [[] for _ in range(len(meshes[name].data.vertices))]
            for name in expected_names
        }
        source_vertex_counts = {
            name: len(meshes[name].data.vertices)
            for name in expected_names
        }

        for node in gltf.get("nodes", []):
            if "mesh" not in node:
                continue
            mesh_name = node.get("name", "")
            if mesh_name not in meshes:
                raise ValueError(f"Unexpected mesh in CC5 proxy GLB: {mesh_name!r}")
            mesh_def = gltf["meshes"][node["mesh"]]
            for primitive_index, primitive in enumerate(mesh_def["primitives"]):
                attributes = primitive.get("attributes", {})
                source_attribute_name = next(
                    (
                        name
                        for name in attributes
                        if name.upper() == VERTEX_ATTRIBUTE
                    ),
                    None,
                )
                if source_attribute_name is None:
                    raise ValueError("Blender glTF export omitted proxy source-vertex mapping")
                source_indices = accessor_values(
                    gltf,
                    binary,
                    attributes[source_attribute_name],
                )
                del attributes[source_attribute_name]
                positions = gltf["accessors"][attributes["POSITION"]]
                if positions["count"] != len(source_indices):
                    raise ValueError("Proxy vertex mapping does not match exported positions")
                if any(index >= source_vertex_counts[mesh_name] for index in source_indices):
                    raise ValueError("Proxy source-vertex mapping exceeds the CC5 mesh")
                for proxy_index, source_index in enumerate(source_indices):
                    source_to_proxy[mesh_name][source_index].append(
                        (primitive_index, proxy_index)
                    )
                primitive["extras"] = {
                    **primitive.get("extras", {}),
                    "comodel_proxy_mesh": mesh_name,
                    "comodel_proxy_primitive": primitive_index,
                    "comodel_proxy_mesh_index": mesh_index_by_name[mesh_name],
                    "comodel_proxy_primitive_index": primitive_index,
                }

        archive_temp = ASSET_DIRECTORY / f".{DELTAS_FILENAME}.tmp"
        proxy_temp = ASSET_DIRECTORY / f".{PROXY_FILENAME}.tmp"
        build_manifest_temp = ASSET_DIRECTORY / f".{BUILD_MANIFEST_FILENAME}.tmp"
        final_paths = (
            ASSET_DIRECTORY / PROXY_FILENAME,
            ASSET_DIRECTORY / DELTAS_FILENAME,
            ASSET_DIRECTORY / BUILD_MANIFEST_FILENAME,
        )
        if any(path.is_symlink() for path in (*final_paths, archive_temp, proxy_temp, build_manifest_temp)):
            raise ValueError("CC5 morph proxy outputs cannot be symbolic links")

        with zipfile.ZipFile(
            archive_temp,
            mode="w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=3,
            allowZip64=True,
        ) as archive:
            for control_number, control in enumerate(manifest["controls"], start=1):
                target_records: dict[str, list[tuple[int, int, list[tuple[int, float, float, float]]]]] = {
                    "positive_shape_key": [],
                    "negative_shape_key": [],
                }
                for side in target_records:
                    key_name = control.get(side)
                    if not key_name:
                        continue
                    for mesh_name in expected_names:
                        mesh = meshes[mesh_name]
                        shape_keys = mesh.data.shape_keys
                        key = shape_keys.key_blocks.get(key_name) if shape_keys else None
                        if key is None:
                            continue
                        basis = shape_keys.key_blocks[0]
                        delta_transform = blender_to_gltf @ mesh.matrix_world.to_3x3()
                        deltas_by_primitive: dict[int, list[tuple[int, float, float, float]]] = {}
                        for source_index, (target_vertex, base_vertex) in enumerate(
                            zip(key.data, basis.data, strict=True)
                        ):
                            delta = delta_transform @ (target_vertex.co - base_vertex.co)
                            if delta.length_squared <= 1e-14:
                                continue
                            for primitive_index, proxy_index in source_to_proxy[mesh_name][source_index]:
                                deltas_by_primitive.setdefault(primitive_index, []).append((
                                    proxy_index,
                                    float(delta.x),
                                    float(delta.y),
                                    float(delta.z),
                                ))
                        target_records[side].extend(
                            (
                                mesh_index_by_name[mesh_name],
                                primitive_index,
                                deltas,
                            )
                            for primitive_index, deltas in sorted(deltas_by_primitive.items())
                        )

                positive = pack_target(target_records["positive_shape_key"])
                negative = pack_target(target_records["negative_shape_key"])
                control_data = (
                    struct.pack(
                        "<4sBHH",
                        b"CMMD",
                        1,
                        len(target_records["positive_shape_key"]),
                        len(target_records["negative_shape_key"]),
                    )
                    + positive
                    + negative
                )
                archive.writestr(
                    f"controls/{control['id']}.bin",
                    control_data,
                )
                if control_number % 100 == 0:
                    print(f"CC5 morph proxy: packed {control_number}/{len(manifest['controls'])} controls")

            body_presets = []
            for preset in preset_manifest["presets"]:
                delta = build_body_preset_delta(
                    preset,
                    meshes,
                    source_to_proxy,
                    mesh_index_by_name,
                    blender_to_gltf,
                )
                entry = f"presets/{preset['id']}.bin"
                archive.writestr(entry, delta)
                body_presets.append({
                    "id": preset["id"],
                    "label": preset["label"],
                    "source_fbx_sha256": preset["source_sha256"],
                    "delta_entry": entry,
                })

        json_chunk = json.dumps(gltf, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
        json_chunk += b" " * ((-len(json_chunk)) % 4)
        binary_chunks = [(kind, chunk) for kind, chunk in chunks if kind != GLB_JSON_CHUNK]
        total_length = 12 + 8 + len(json_chunk) + sum(8 + len(chunk) for _, chunk in binary_chunks)
        with proxy_temp.open("wb") as output:
            output.write(struct.pack("<4sII", b"glTF", 2, total_length))
            output.write(struct.pack("<II", len(json_chunk), GLB_JSON_CHUNK))
            output.write(json_chunk)
            for kind, chunk in binary_chunks:
                output.write(struct.pack("<II", len(chunk), kind))
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())

        proxy_hash = sha256_file(proxy_temp)
        deltas_hash = sha256_file(archive_temp)
        build_manifest = {
            "format_version": 1,
            "asset_id": ASSET_ID,
            "source_blend_sha256": manifest["blend_sha256"],
            "proxy_glb_filename": PROXY_FILENAME,
            "proxy_glb_sha256": proxy_hash,
            "proxy_glb_bytes": proxy_temp.stat().st_size,
            "morph_deltas_filename": DELTAS_FILENAME,
            "morph_deltas_sha256": deltas_hash,
            "morph_deltas_bytes": archive_temp.stat().st_size,
            "mesh_names": expected_names,
            "control_count": len(manifest["controls"]),
            "body_presets": body_presets,
            "preview_texture_dimensions": preview_texture_dimensions,
            "meshopt_compression": "EXT_meshopt_compression" in gltf.get("extensionsUsed", []),
        }
        build_manifest_temp.write_text(json.dumps(build_manifest, indent=2) + "\n", encoding="utf-8")
        for source, target in zip(
            (proxy_temp, archive_temp, build_manifest_temp),
            final_paths,
            strict=True,
        ):
            os.replace(source, target)
        print(json.dumps(build_manifest, indent=2))


if __name__ == "__main__":
    main()
