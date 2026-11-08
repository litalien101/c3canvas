"""Prepare the owner-supplied CC3 male source as a consolidated, pinned GLB."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


FILENAME_CORRECTIONS = {
    "brow_depth_mx.Fbx": "brow_depth_max.Fbx",
    "eyelid_bottom_in_height_max.Fbx": "eyeball_bottom_in_height_max.Fbx",
    "lower_eyelid_up_,max.Fbx": "lower_eyelid_up_max.Fbx",
    "nostril_bridge_depth_negative.Fbx": "nose_bridge_depth_negative.Fbx",
}

MALE_ONLY_CONTROLS = [
    ("bust_proximity", "Bust Proximity", "Torso & Hips", None, "bust_proximity_max.Fbx"),
    ("bust_size", "Bust Size", "Torso & Hips", None, "bust_size_max.Fbx"),
    ("lower_nipple_position", "Lower Nipple Position", "Torso & Hips", "lower_nipple_position_negative.Fbx", "lower_nipple_position_max.Fbx"),
    ("shoulder_depth", "Shoulder Depth", "Arms & Hands", "shoulder_depth_negative.Fbx", "shoulder_depth_max.Fbx"),
    ("shoulder_outer", "Shoulder Outer", "Arms & Hands", "shoulder_outer_negative.Fbx", "shoulder_outer_max.Fbx"),
    ("shoulder_top_round", "Shoulder Top Round", "Arms & Hands", "shoulder_top_round_negative.Fbx", "shoulder_top_round_max.Fbx"),
]

ASSET_ID = "character_cc3_male_morphs_v1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", required=True, type=Path)
    parser.add_argument("--worker-root", required=True, type=Path)
    parser.add_argument("--blender", required=True, type=Path)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--final-asset-directory", required=True, type=Path)
    parser.add_argument("--checkpoint-every", type=int, default=10)
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def regular_file(path: Path, label: str) -> Path:
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"{label} must be a regular, non-symlink file: {path}")
    return path.resolve()


def expected_exports(manifest: dict) -> list[tuple[str, str, dict]]:
    result = []
    for control in manifest["controls"]:
        for side in ("positive", "negative"):
            filename = control.get(f"{side}_filename")
            if filename:
                result.append((side, FILENAME_CORRECTIONS.get(filename, filename), control))
    for control_id, label, category, negative_filename, positive_filename in MALE_ONLY_CONTROLS:
        for side, filename in (("positive", positive_filename), ("negative", negative_filename)):
            if filename:
                result.append((side, filename, {
                    "id": control_id,
                    "label": label,
                    "category": category,
                    f"{side}_filename": filename,
                }))
    return result


def create_male_manifest(
    female_manifest: dict,
    *,
    source_fbx: Path,
    base_glb: Path,
    base_report: dict,
    exports: list[tuple[str, str, dict]],
) -> dict:
    controls = json.loads(json.dumps(female_manifest["controls"]))
    for control in controls:
        for side in ("positive", "negative"):
            field = f"{side}_filename"
            if control.get(field) in FILENAME_CORRECTIONS:
                control[field] = FILENAME_CORRECTIONS[control[field]]
        control["positive_shape_key"] = (
            f"CC3_{control['id'].title()}_Positive"
            if control.get("positive_filename") else None
        )
        control["negative_shape_key"] = (
            f"CC3_{control['id'].title()}_Negative"
            if control.get("negative_filename") else None
        )

    for control_id, label, category, negative_filename, positive_filename in MALE_ONLY_CONTROLS:
        controls.append({
            "id": control_id,
            "label": label,
            "category": category,
            "minimum": -1 if negative_filename else 0,
            "maximum": 1,
            "positive_shape_key": f"CC3_{control_id.title()}_Positive",
            "negative_shape_key": (
                f"CC3_{control_id.title()}_Negative"
                if negative_filename else None
            ),
            "positive_filename": positive_filename,
            "negative_filename": negative_filename,
            "source_control_names": [control_id],
        })

    manifest = {
        "format_version": 1,
        "asset_id": ASSET_ID,
        "source_neutral_filename": source_fbx.name,
        "source_neutral_sha256": sha256_file(source_fbx),
        "base_glb_sha256": sha256_file(base_glb),
        "mesh_count": base_report["mesh_count"],
        "mesh_names": base_report["mesh_names"],
        "body_vertex_count": base_report["body_vertex_count"],
        "body_shape_key_count": base_report["body_shape_key_count"] + len(exports),
        "armature_name": base_report["armature_name"],
        "bone_count": base_report["bone_count"],
        "export_count": len(exports),
        "control_count": len(controls),
        "controls": controls,
    }
    if manifest["mesh_count"] != 4 or manifest["bone_count"] != 101:
        raise ValueError("Prepared base GLB failed the CC3 male mesh or rig contract")
    if manifest["control_count"] != 143 or manifest["export_count"] != 254:
        raise ValueError("Male morph manifest counts do not match the inspected export set")
    return manifest


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def run_blender(blender: Path, script: Path, arguments: list[str], log_path: Path) -> None:
    with log_path.open("w", encoding="utf-8") as log:
        result = subprocess.run(
            [str(blender), "--background", "--python", str(script), "--", *arguments],
            stdout=log,
            stderr=subprocess.STDOUT,
            check=False,
        )
    if result.returncode:
        tail = log_path.read_text(encoding="utf-8", errors="replace")[-8000:]
        raise RuntimeError(f"Blender failed ({result.returncode}); see {log_path}\n{tail}")


def main() -> int:
    args = parse_args()
    source_root = args.source_root.resolve(strict=True)
    worker_root = args.worker_root.resolve(strict=True)
    blender = regular_file(args.blender, "Blender executable")
    if not source_root.is_dir() or source_root.is_symlink():
        raise ValueError("Source root must be a regular directory")
    base_fbx = regular_file(source_root / "original" / "CC3_Base Male.Fbx", "Neutral FBX")
    female_manifest_path = regular_file(
        worker_root.parent.parent / "shared" / "cc3_morph_manifest.json",
        "Female CC3 manifest",
    )
    base_script = regular_file(worker_root / "cc3_prepare_male_base.py", "Base preparation script")
    builder_script = regular_file(worker_root / "cc3_build_morph_asset.py", "Morph builder")

    output_root = args.output_root
    if output_root.exists() or output_root.is_symlink():
        raise ValueError(f"Build output directory already exists: {output_root}")
    output_root.mkdir(parents=True)
    exports_root = output_root / "exports"
    (exports_root / "positive").mkdir(parents=True)
    (exports_root / "negative").mkdir(parents=True)

    female_manifest = json.loads(female_manifest_path.read_text(encoding="utf-8"))
    planned_exports = expected_exports(female_manifest)
    source_fbx_by_name = {}
    for source in source_root.rglob("*.Fbx"):
        if source.parent.name.lower() == "original":
            continue
        if source.name in source_fbx_by_name:
            raise ValueError(f"Duplicate male morph export filename: {source.name}")
        source_fbx_by_name[source.name] = source

    mapped_exports = []
    for side, expected_name, control in planned_exports:
        source = source_fbx_by_name.get(expected_name)
        if source is None:
            raise ValueError(f"Male morph export is missing: {expected_name}")
        destination = exports_root / side / expected_name
        os.link(source, destination)
        mapped_exports.append((side, expected_name, control))
    if len(source_fbx_by_name) != len(planned_exports):
        unexpected = sorted(set(source_fbx_by_name) - {
            name for _, name, _ in planned_exports
        })
        raise ValueError(f"Male source export count differs from the allowlisted manifest: {unexpected}")

    base_glb = output_root / "CC3_Base_Male_Neutral.glb"
    base_report_path = output_root / "male_base_report.json"
    run_blender(
        blender,
        base_script,
        ["--neutral", str(base_fbx), "--glb-output", str(base_glb), "--report-output", str(base_report_path)],
        output_root / "base-preparation.log",
    )
    base_report = json.loads(base_report_path.read_text(encoding="utf-8"))
    build_manifest = create_male_manifest(
        female_manifest,
        source_fbx=base_fbx,
        base_glb=base_glb,
        base_report=base_report,
        exports=mapped_exports,
    )
    build_manifest_path = output_root / "male-build-manifest.json"
    write_json(build_manifest_path, build_manifest)

    final_glb = output_root / "CC3_Base_Male_Morphs.glb"
    blend_output = output_root / "male-morph-checkpoint.blend"
    report_output = output_root / "male-morph-report.json"
    run_blender(
        blender,
        builder_script,
        [
            "--neutral", str(base_fbx),
            "--base-glb", str(base_glb),
            "--exports-root", str(exports_root),
            "--manifest", str(build_manifest_path),
            "--blend-output", str(blend_output),
            "--glb-output", str(final_glb),
            "--report-output", str(report_output),
            "--checkpoint-every", str(args.checkpoint_every),
        ],
        output_root / "morph-build.log",
    )
    report = json.loads(report_output.read_text(encoding="utf-8"))
    if (
        report.get("glb_sha256") != sha256_file(final_glb)
        or report.get("final_shape_key_count") != build_manifest["body_shape_key_count"]
        or report.get("completed_exports") != build_manifest["export_count"]
    ):
        raise ValueError("The completed male GLB does not match its morph manifest")

    final_manifest = dict(build_manifest)
    final_manifest["source_body_vertex_count"] = build_manifest["body_vertex_count"]
    final_manifest["body_vertex_count"] = report["base_vertex_count"]
    final_manifest["glb_sha256"] = report["glb_sha256"]
    final_manifest["source"] = {
        "provider": "owner_supplied_local_asset",
        "original_filename": base_fbx.name,
        "license": "Not provided; local use only until the owner confirms redistribution rights.",
    }
    args.final_asset_directory.mkdir(parents=True, exist_ok=True)
    if args.final_asset_directory.is_symlink():
        raise ValueError("Final asset directory cannot be a symbolic link")
    shutil.copy2(final_glb, args.final_asset_directory / final_glb.name)
    write_json(args.final_asset_directory / "cc3_male_morph_manifest.json", final_manifest)
    summary = {
        "asset_id": ASSET_ID,
        "glb_sha256": report["glb_sha256"],
        "glb_bytes": report["glb_bytes"],
        "mesh_count": report["mesh_count"] if "mesh_count" in report else build_manifest["mesh_count"],
        "body_vertex_count": report["base_vertex_count"],
        "source_body_vertex_count": build_manifest["body_vertex_count"],
        "body_shape_key_count": report["final_shape_key_count"],
        "armature_name": build_manifest["armature_name"],
        "bone_count": build_manifest["bone_count"],
        "morph_control_count": build_manifest["control_count"],
        "morph_export_count": report["completed_exports"],
        "final_glb": str(args.final_asset_directory / final_glb.name),
        "final_manifest": str(args.final_asset_directory / "cc3_male_morph_manifest.json"),
        "build_report": str(report_output),
        "build_log": str(output_root / "morph-build.log"),
    }
    write_json(output_root / "male-build-summary.json", summary)
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
