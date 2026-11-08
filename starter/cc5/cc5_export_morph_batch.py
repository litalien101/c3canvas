"""Resumable CC5 shaping-slider exporter for CoModel Studio."""

import json
import hashlib
import math
import os
import re
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime
from pathlib import Path

import RLPy
from PySide2 import QtWidgets

DOCUMENTS_ROOT = Path(os.environ.get("USERPROFILE", str(Path.home()))) / "Documents"
OUTPUT_ROOT = DOCUMENTS_ROOT / "CoModelStudio" / "CC5Exports" / "cc5_base_plus_morphs_v1"
CHUNK_SIZE = 16
NEUTRAL_TOLERANCE = 1e-6
MIN_FREE_BYTES = 2 * 1024 ** 3
EXPORT_OPTIONS = (
    RLPy.EExportFbxOptions__None,
    RLPy.EExportFbxOptions2__None,
    RLPy.EExportFbxOptions3__None,
    RLPy.EExportTextureSize_Original,
    RLPy.EExportTextureFormat_Default,
)


def _atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _parse_min_max(value):
    if isinstance(value, (tuple, list)) and len(value) == 2:
        minimum, maximum = (float(item) for item in value)
    else:
        numbers = re.findall(r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?", str(value))
        if len(numbers) != 2:
            raise ValueError("Invalid slider min/max result: {0}".format(value))
        minimum, maximum = (float(number) for number in numbers)
    if not math.isfinite(minimum) or not math.isfinite(maximum) or minimum >= maximum:
        raise ValueError("Invalid slider range: {0}".format(value))
    if minimum > 0 or maximum < 0:
        raise ValueError("Slider range does not include neutral weight zero: {0}".format(value))
    return minimum, maximum


def _collect_catalog(shaping):
    catalog = {}
    categories = shaping.GetShapingMorphCatergoryNames()
    for category_index, category in enumerate(categories, start=1):
        category_name = str(category)
        slider_ids = shaping.GetShapingMorphIDs(category)
        display_names = shaping.GetShapingMorphDisplayNames(category)
        if len(slider_ids) != len(display_names):
            raise ValueError("Slider ID/name count differs in category {0}".format(category_name))
        for slider_id, display_name in zip(slider_ids, display_names):
            slider_id = str(slider_id)
            if slider_id not in catalog:
                current_weight = float(shaping.GetShapingMorphWeight(slider_id))
                minimum, maximum = _parse_min_max(shaping.GetShapingMorphMinMax(slider_id))
                if not minimum - NEUTRAL_TOLERANCE <= current_weight <= maximum + NEUTRAL_TOLERANCE:
                    raise ValueError("Current weight is outside range for {0}".format(slider_id))
                catalog[slider_id] = {
                    "id": slider_id,
                    "display_name": str(display_name),
                    "minimum": minimum,
                    "maximum": maximum,
                    "original_weight": current_weight,
                    "categories": [],
                }
            elif catalog[slider_id]["display_name"] != str(display_name):
                raise ValueError("One slider ID has inconsistent display names: {0}".format(slider_id))
            if category_name not in catalog[slider_id]["categories"]:
                catalog[slider_id]["categories"].append(category_name)
        if category_index % 5 == 0 or category_index == len(categories):
            print("CC5 morph preflight: {0}/{1} categories, {2:,} unique sliders".format(
                category_index, len(categories), len(catalog)
            ))
            QtWidgets.QApplication.processEvents()
    return [catalog[key] for key in sorted(catalog)]


def _build_tasks(sliders):
    tasks = []
    controls = []
    for slider_index, slider in enumerate(sliders, start=1):
        endpoints = []
        if slider["minimum"] < 0:
            endpoints.append(("min", slider["minimum"]))
        if slider["maximum"] > 0:
            endpoints.append(("max", slider["maximum"]))
        control = dict(slider)
        control["task_ids"] = []
        for endpoint, weight in endpoints:
            task_id = "slider_{0:05d}_{1}".format(slider_index, endpoint)
            control["task_ids"].append(task_id)
            tasks.append({
                "task_id": task_id,
                "slider_id": slider["id"],
                "display_name": slider["display_name"],
                "categories": slider["categories"],
                "endpoint": endpoint,
                "weight": weight,
                "shape_key_name": "CC5_{0:05d}_{1}".format(slider_index, endpoint.upper()),
                "status": "pending",
            })
        controls.append(control)
    return controls, tasks


def _find_blender():
    configured = os.environ.get("COMODEL_BLENDER_EXECUTABLE")
    candidates = [configured] if configured else []
    program_files = Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
    candidates.append(str(program_files / "Blender Foundation" / "Blender 5.2" / "blender.exe"))
    candidates.append(str(program_files / "Blender Foundation" / "Blender" / "blender.exe"))
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return str(Path(candidate).resolve())
    raise FileNotFoundError("Blender executable not found; set COMODEL_BLENDER_EXECUTABLE")


def _export_fbx(avatar, path):
    return RLPy.RFileIO.ExportFbxFile(avatar, str(path), *EXPORT_OPTIONS, "")


def _set_weight(shaping, avatar, slider_id, weight):
    result = shaping.SetShapingMorphWeight(slider_id, float(weight))
    RLPy.RGlobal.ObjectModified(
        avatar,
        RLPy.EObjectModifiedType_Attribute | RLPy.EObjectModifiedType_Transform,
    )
    actual = float(shaping.GetShapingMorphWeight(slider_id))
    if not math.isclose(actual, float(weight), abs_tol=NEUTRAL_TOLERANCE):
        raise RuntimeError("Slider {0} did not reach weight {1}; got {2}".format(slider_id, weight, actual))
    return result


def _remove_path(path):
    if path.is_dir():
        shutil.rmtree(str(path))
    elif path.exists():
        path.unlink()


def _confirm(avatar_name, slider_count, endpoint_count, batch_count, output_dir, completed_count=0):
    action = "Resume" if completed_count else "Start"
    remaining = endpoint_count - completed_count
    message = (
        "{0} the CC5-native morph dataset for {1}?\n\n"
        "Unique sliders: {2:,}\nEndpoint exports: {3:,}\nRemaining exports: {4:,}\n"
        "Blender packing batches: {5:,} (up to {6} exports each)\n\n"
        "Temporary FBXs are removed after each verified delta archive.\n"
        "Output: {7}\n\nThis may take several hours and is resumable."
    ).format(action, avatar_name, slider_count, endpoint_count, remaining, batch_count, CHUNK_SIZE, output_dir)
    answer = QtWidgets.QMessageBox.question(
        None,
        "CoModel Studio: CC5 Morph Batch",
        message,
        QtWidgets.QMessageBox.Yes | QtWidgets.QMessageBox.No,
        QtWidgets.QMessageBox.No,
    )
    return answer == QtWidgets.QMessageBox.Yes


def _initial_manifest(avatar, sliders, controls, tasks, neutral_path):
    return {
        "format_version": 1,
        "asset_id": "character_cc5_base_plus_morphs_v1",
        "source_application": "Character Creator 5",
        "avatar_name": str(avatar.GetName()),
        "generated_local": datetime.now().replace(microsecond=0).isoformat(),
        "neutral_fbx": str(neutral_path),
        "neutral_sha256": None,
        "chunk_size": CHUNK_SIZE,
        "slider_count": len(sliders),
        "endpoint_count": len(tasks),
        "neutral_meshes": None,
        "controls": controls,
        "tasks": tasks,
        "completed_task_ids": [],
        "batches": [],
        "run_status": "initialized",
        "last_error": None,
    }


def _validate_resume(manifest, avatar, sliders, controls, tasks, neutral_path):
    if manifest.get("format_version") != 1 or manifest.get("asset_id") != "character_cc5_base_plus_morphs_v1":
        raise ValueError("Existing manifest has an unsupported format or asset ID")
    if manifest.get("avatar_name") != str(avatar.GetName()):
        raise ValueError("Loaded avatar does not match the existing batch manifest")
    if manifest.get("neutral_fbx") != str(neutral_path):
        raise ValueError("Neutral FBX path differs from the existing batch manifest")
    old_controls = manifest.get("controls", [])
    old_control_by_id = {item["id"]: item for item in old_controls}
    current_control_by_id = {item["id"]: item for item in sliders}
    if set(old_control_by_id) != set(current_control_by_id):
        raise ValueError("CC5 slider catalog changed since this batch was started")
    old_tasks = manifest.get("tasks", [])
    old_task_by_id = {item["task_id"]: item for item in old_tasks}
    current_task_by_id = {item["task_id"]: item for item in tasks}
    removed_task_ids = set(old_task_by_id) - set(current_task_by_id)
    if removed_task_ids:
        raise ValueError("CC5 removed existing slider endpoints; refusing to invalidate packed deltas")

    for slider_id, old in old_control_by_id.items():
        current = current_control_by_id[slider_id]
        if old.get("display_name") != current.get("display_name"):
            raise ValueError("CC5 display name changed for slider {0}".format(slider_id))
        if not math.isclose(float(old.get("original_weight", 0.0)), float(current.get("original_weight", 0.0)), abs_tol=NEUTRAL_TOLERANCE):
            raise ValueError("CC5 original weight changed for slider {0}".format(slider_id))
        for side, bound in (("min", "minimum"), ("max", "maximum")):
            old_value = float(old[bound])
            current_value = float(current[bound])
            if math.isclose(old_value, current_value, abs_tol=1e-8):
                continue
            expanded = (side == "min" and math.isclose(old_value, 0.0, abs_tol=1e-8) and current_value < 0)
            expanded = expanded or (side == "max" and math.isclose(old_value, 0.0, abs_tol=1e-8) and current_value > 0)
            if not expanded:
                raise ValueError(
                    "CC5 {0} bound changed for {1} ({2} -> {3}); an existing endpoint may no longer match. "
                    "Keep the saved data and use a separate output version."
                    .format(bound, slider_id, old_value, current_value)
                )

    for task_id, old_task in old_task_by_id.items():
        current_task = current_task_by_id[task_id]
        if (
            old_task.get("slider_id") != current_task.get("slider_id")
            or old_task.get("endpoint") != current_task.get("endpoint")
            or old_task.get("shape_key_name") != current_task.get("shape_key_name")
            or not math.isclose(float(old_task.get("weight")), float(current_task.get("weight")), abs_tol=1e-8)
        ):
            raise ValueError("CC5 changed an existing endpoint task {0}; refusing to reuse its packed delta".format(task_id))

    new_tasks = [task for task in tasks if task["task_id"] not in old_task_by_id]
    for task in new_tasks:
        old = old_control_by_id[task["slider_id"]]
        current = current_control_by_id[task["slider_id"]]
        valid_expansion = (
            task["endpoint"] == "min"
            and math.isclose(float(old["minimum"]), 0.0, abs_tol=1e-8)
            and float(current["minimum"]) < 0
            and math.isclose(float(task["weight"]), float(current["minimum"]), abs_tol=1e-8)
        ) or (
            task["endpoint"] == "max"
            and math.isclose(float(old["maximum"]), 0.0, abs_tol=1e-8)
            and float(current["maximum"]) > 0
            and math.isclose(float(task["weight"]), float(current["maximum"]), abs_tol=1e-8)
        )
        if not valid_expansion:
            raise ValueError("CC5 introduced an unexpected endpoint task {0}".format(task["task_id"]))

    manifest["controls"] = controls
    manifest["tasks"] = old_tasks + new_tasks
    manifest["slider_count"] = len(sliders)
    manifest["endpoint_count"] = len(manifest["tasks"])


def _export_chunk(avatar, shaping, chunk, chunk_index, output_dir, neutral_path, blender_path, packer_path, manifest):
    staging_dir = output_dir / "staging"
    batch_dir = output_dir / "deltas"
    staging_dir.mkdir(parents=True, exist_ok=True)
    batch_dir.mkdir(parents=True, exist_ok=True)
    jobs = []

    for task in chunk:
        fbx_path = staging_dir / (task["task_id"] + ".fbx")
        _remove_path(fbx_path)
        _remove_path(fbx_path.with_suffix(".fbm"))
        restore_weight = 0.0
        try:
            _set_weight(shaping, avatar, task["slider_id"], task["weight"])
            result = _export_fbx(avatar, fbx_path)
            if result != RLPy.RStatus.Success or not fbx_path.is_file() or fbx_path.stat().st_size < 1024 * 1024:
                raise RuntimeError("FBX export failed for {0}: {1}".format(task["task_id"], result))
        finally:
            _set_weight(shaping, avatar, task["slider_id"], restore_weight)
        jobs.append({
            "task_id": task["task_id"],
            "slider_id": task["slider_id"],
            "display_name": task["display_name"],
            "endpoint": task["endpoint"],
            "weight": task["weight"],
            "shape_key_name": task["shape_key_name"],
            "fbx_path": str(fbx_path),
        })

    jobs_path = staging_dir / ("jobs_{0:05d}.json".format(chunk_index))
    _atomic_json(jobs_path, jobs)
    archive_path = batch_dir / ("batch_{0:05d}.zip".format(chunk_index))
    process = subprocess.run(
        [
            blender_path,
            "--background",
            "--factory-startup",
            "--python",
            str(packer_path),
            "--",
            "--neutral",
            str(neutral_path),
            "--jobs",
            str(jobs_path),
            "--output",
            str(archive_path),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        universal_newlines=True,
    )
    if process.returncode != 0:
        raise RuntimeError("Blender delta pack failed for batch {0}:\n{1}".format(chunk_index, process.stdout[-6000:]))
    if not archive_path.is_file():
        raise RuntimeError("Blender did not create delta archive {0}".format(archive_path))
    with zipfile.ZipFile(str(archive_path), "r") as archive:
        if archive.testzip() is not None:
            raise RuntimeError("Delta archive failed CRC validation: {0}".format(archive_path))
        batch_report = json.loads(archive.read("batch.json").decode("utf-8"))
    if len(batch_report.get("targets", [])) != len(chunk):
        raise RuntimeError("Delta archive target count does not match batch size")

    manifest["completed_task_ids"].extend(task["task_id"] for task in chunk)
    if manifest.get("neutral_meshes") is None:
        manifest["neutral_meshes"] = batch_report.get("neutral_meshes")
    elif set(manifest["neutral_meshes"]) != set(batch_report.get("neutral_meshes", {})):
        raise RuntimeError("Neutral mesh set changed between packed batches")
    for task in chunk:
        task["status"] = "packed"
    manifest["batches"].append({
        "batch_index": chunk_index,
        "archive": str(archive_path),
        "target_count": len(chunk),
        "mesh_delta_count": sum(len(target["mesh_deltas"]) for target in batch_report["targets"]),
        "archive_bytes": archive_path.stat().st_size,
        "completed_local": datetime.now().replace(microsecond=0).isoformat(),
    })
    manifest["run_status"] = "running"
    manifest["last_error"] = None
    _atomic_json(output_dir / "manifest.json", manifest)

    for job in jobs:
        fbx_path = Path(job["fbx_path"])
        _remove_path(fbx_path)
        _remove_path(fbx_path.with_suffix(".fbm"))
    _remove_path(jobs_path)
    print("Completed packed batch {0}; {1}/{2} endpoint tasks".format(
        chunk_index,
        len(manifest["completed_task_ids"]),
        manifest["endpoint_count"],
    ))


def run_script():
    avatars = RLPy.RScene.GetAvatars()
    if not avatars:
        QtWidgets.QMessageBox.warning(None, "CC5 Morph Batch", "Load the target character first.")
        return None
    avatar = avatars[0]
    shaping = avatar.GetAvatarShapingComponent()
    sliders = _collect_catalog(shaping)
    nonzero = [slider for slider in sliders if abs(slider["original_weight"]) > NEUTRAL_TOLERANCE]
    if nonzero:
        sample = ", ".join(item["display_name"] for item in nonzero[:8])
        QtWidgets.QMessageBox.warning(
            None,
            "CC5 Morph Batch",
            "The character is not neutral ({0} nonzero sliders). Reset all shaping sliders before starting.\n{1}".format(len(nonzero), sample),
        )
        return None

    controls, tasks = _build_tasks(sliders)
    if not tasks:
        raise RuntimeError("No non-neutral slider endpoints were found")
    if len(avatars) != 1:
        QtWidgets.QMessageBox.warning(
            None,
            "CC5 Morph Batch",
            "This batch requires exactly one avatar in the scene; found {0}.".format(len(avatars)),
        )
        return None

    packer_path = Path(__file__).with_name("cc5_pack_morph_batch.py")
    if not packer_path.is_file():
        raise FileNotFoundError("Place cc5_pack_morph_batch.py next to this script")
    blender_path = _find_blender()
    output_dir = OUTPUT_ROOT
    manifest_path = output_dir / "manifest.json"
    neutral_path = output_dir / "neutral" / "CC3_Base_Plus_neutral.fbx"
    batch_count = int(math.ceil(len(tasks) / float(CHUNK_SIZE)))

    output_dir.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(DOCUMENTS_ROOT).free < MIN_FREE_BYTES:
        QtWidgets.QMessageBox.warning(
            None,
            "CC5 Morph Batch",
            "At least 2 GiB free space is required for neutral and temporary chunk exports.",
        )
        return None

    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        _validate_resume(manifest, avatar, sliders, controls, tasks, neutral_path)
        tasks = manifest["tasks"]
        completed_count = len(set(manifest.get("completed_task_ids", [])))
        if completed_count < len(tasks) and not _confirm(
            avatar.GetName(), len(sliders), len(tasks), batch_count, output_dir, completed_count
        ):
            print("CC5 morph batch resume cancelled; no exports were created.")
            return None
    else:
        existing = list(output_dir.iterdir())
        if existing:
            raise RuntimeError("Output folder already contains data but no manifest; move it aside before starting")
        if not _confirm(avatar.GetName(), len(sliders), len(tasks), batch_count, output_dir):
            print("CC5 morph batch cancelled; no exports were created.")
            return None
        manifest = _initial_manifest(avatar, sliders, controls, tasks, neutral_path)
        _atomic_json(manifest_path, manifest)

    if not neutral_path.is_file():
        if manifest.get("completed_task_ids"):
            raise RuntimeError("Resume manifest has completed tasks but its neutral FBX is missing")
        neutral_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            neutral_result = _export_fbx(avatar, neutral_path)
            if neutral_result != RLPy.RStatus.Success or not neutral_path.is_file():
                raise RuntimeError("Neutral FBX export failed: {0}".format(neutral_result))
            manifest["neutral_sha256"] = _sha256_file(neutral_path)
            manifest["run_status"] = "initialized"
            manifest["last_error"] = None
            _atomic_json(manifest_path, manifest)
        except Exception as exc:
            _remove_path(neutral_path)
            _remove_path(neutral_path.with_suffix(".fbm"))
            manifest["run_status"] = "failed"
            manifest["last_error"] = str(exc)
            _atomic_json(manifest_path, manifest)
            raise
    elif manifest.get("neutral_sha256"):
        if _sha256_file(neutral_path) != manifest["neutral_sha256"]:
            raise RuntimeError("Neutral FBX hash differs from the original batch; refusing to resume")
    else:
        manifest["neutral_sha256"] = _sha256_file(neutral_path)
        _atomic_json(manifest_path, manifest)

    completed = set(manifest.get("completed_task_ids", []))
    chunks = [tasks[index:index + CHUNK_SIZE] for index in range(0, len(tasks), CHUNK_SIZE)]
    try:
        manifest["run_status"] = "running"
        manifest["last_error"] = None
        _atomic_json(manifest_path, manifest)
        for chunk_index, chunk in enumerate(chunks, start=1):
            if all(task["task_id"] in completed for task in chunk):
                continue
            if any(task["task_id"] in completed for task in chunk):
                raise RuntimeError("Manifest contains a partially completed chunk; refusing unsafe resume")
            _export_chunk(
                avatar,
                shaping,
                chunk,
                chunk_index,
                output_dir,
                neutral_path,
                blender_path,
                packer_path,
                manifest,
            )
            completed.update(task["task_id"] for task in chunk)
        manifest["run_status"] = "complete"
        manifest["completed_local"] = datetime.now().replace(microsecond=0).isoformat()
        _atomic_json(manifest_path, manifest)
        QtWidgets.QMessageBox.information(
            None,
            "CC5 Morph Batch",
            "All {0:,} slider endpoint deltas are packed.\nManifest: {1}".format(len(tasks), manifest_path),
        )
        return str(output_dir)
    except Exception as exc:
        manifest["run_status"] = "failed"
        manifest["last_error"] = str(exc)
        _atomic_json(manifest_path, manifest)
        QtWidgets.QMessageBox.critical(None, "CC5 Morph Batch Failed", str(exc))
        raise


if __name__ == "__main__":
    run_script()
