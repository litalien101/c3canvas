"""Extract allowlisted CC3+ skin materials and browser maps from a local FBX."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

import bpy

PROJECT_ROOT = Path(__file__).resolve().parents[3]
ASSET_ROOT = PROJECT_ROOT / "starter" / "worker" / "blender" / "assets"
SHARED_ROOT = PROJECT_ROOT / "starter" / "shared"
ASSET_ID = "skin_cc3plus_female_1"
ASSET_DIRECTORY = ASSET_ROOT / ASSET_ID
MATERIALS = (
    "Std_Skin_Head",
    "Std_Skin_Body",
    "Std_Skin_Arm",
    "Std_Skin_Leg",
)
NORMAL_MAP_STRENGTH = 0.35


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def save_preview(image, destination: Path, maximum_size: int, file_format: str) -> dict[str, str]:
    preview = image.copy()
    try:
        width, height = image.size
        scale = min(1.0, maximum_size / max(width, height))
        preview.scale(max(1, round(width * scale)), max(1, round(height * scale)))
        preview.file_format = file_format
        preview.filepath_raw = str(destination)
        preview.save()
    finally:
        bpy.data.images.remove(preview)
    return {
        "preview_path": f"starter/worker/blender/assets/{ASSET_ID}/{destination.name}",
        "preview_sha256": sha256(destination),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path, help="Local CC3+ skin FBX")
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = parser.parse_args(arguments)
    source_argument = args.source.expanduser()
    if source_argument.is_symlink():
        raise ValueError("Source must be a regular local FBX file.")
    source = source_argument.resolve(strict=True)
    if not source.is_file() or source.suffix.lower() != ".fbx":
        raise ValueError("Source must be a regular local FBX file.")

    ASSET_DIRECTORY.mkdir(parents=True, exist_ok=True)
    bpy.ops.import_scene.fbx(filepath=str(source))
    materials = {material.name: material for material in bpy.data.materials}
    if not set(MATERIALS).issubset(materials):
        raise RuntimeError("The FBX does not contain all four expected CC3+ skin materials.")

    asset = {
        "id": ASSET_ID,
        "name": "CC3+ Female Full Body Skin",
        "category": "skin",
        "compatible_asset_ids": ["character_cc5_rlcc3plus_all_morphs_v1"],
        "material_library_path": f"starter/worker/blender/assets/{ASSET_ID}/skin_materials.blend",
        "card_preview": {},
        "materials": {},
    }
    for material_name in MATERIALS:
        material = materials[material_name]
        if not material.use_nodes or material.node_tree is None:
            raise RuntimeError(f"{material_name} has no node-based material.")
        for node in material.node_tree.nodes:
            if node.type == "NORMAL_MAP":
                node.inputs["Strength"].default_value = NORMAL_MAP_STRENGTH
        node_images = {
            node.image.name: node.image
            for node in material.node_tree.nodes
            if node.type == "TEX_IMAGE" and node.image is not None
        }
        selected = {}
        for map_name in ("Diffuse", "Normal"):
            image = next(
                (image for name, image in node_images.items()
                 if name.lower().startswith(f"{material_name}_{map_name}".lower())),
                None,
            )
            if image is None or image.size[0] < 1 or image.size[1] < 1:
                raise RuntimeError(f"{material_name} is missing its packed {map_name.lower()} map.")
            image_name = f"{material_name}_{map_name}.png"
            image_path = ASSET_DIRECTORY / image_name
            image.file_format = "PNG"
            image.filepath_raw = str(image_path)
            image.save()
            image.pack()
            entry = {
                "path": f"starter/worker/blender/assets/{ASSET_ID}/{image_name}",
                "sha256": sha256(image_path),
            }
            preview_format = "PNG" if map_name == "Normal" else "WEBP"
            preview_extension = "png" if map_name == "Normal" else "webp"
            entry.update(save_preview(
                image,
                ASSET_DIRECTORY / f"{material_name}_{map_name}_Preview.{preview_extension}",
                1024,
                preview_format,
            ))
            selected[map_name.lower()] = entry
            if material_name == "Std_Skin_Head" and map_name == "Diffuse":
                asset["card_preview"] = save_preview(
                    image,
                    ASSET_DIRECTORY / "Skin_Card_Preview.webp",
                    256,
                    "WEBP",
                )
        asset["materials"][material_name] = selected

    library_path = ASSET_DIRECTORY / "skin_materials.blend"
    bpy.data.libraries.write(
        str(library_path),
        {materials[name] for name in MATERIALS},
        fake_user=True,
        compress=True,
    )
    asset["material_library_sha256"] = sha256(library_path)
    (SHARED_ROOT / "skin_assets.json").write_text(
        json.dumps({"assets": [asset]}, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(asset, indent=2))


if __name__ == "__main__":
    main()
