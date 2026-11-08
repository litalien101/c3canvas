"""Export a neutral CC5 avatar and one verified shaping-slider pilot."""

import json
import math
import os
import re
from datetime import datetime
from pathlib import Path

import RLPy
from PySide2 import QtWidgets

OUTPUT_ROOT = Path(os.environ.get("USERPROFILE", str(Path.home()))) / "Documents" / "CoModelStudio" / "CC5Exports"
TARGET_SLIDER_ID = "2018-09-10-17-03-40_ear length"
TARGET_DISPLAY_NAME = "Ear Scale Height"


def _status_text(value):
    return str(value)


def _parse_min_max(value):
    numbers = re.findall(r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?", str(value))
    if len(numbers) != 2:
        raise ValueError("Could not read the slider's two-value min/max range: {0}".format(value))
    minimum, maximum = (float(number) for number in numbers)
    if not math.isfinite(minimum) or not math.isfinite(maximum) or minimum >= maximum:
        raise ValueError("Invalid slider min/max range: {0}".format(value))
    return minimum, maximum


def _new_output_dir():
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    base = OUTPUT_ROOT / ("morph_pilot_" + stamp)
    candidate = base
    suffix = 1
    while candidate.exists():
        candidate = Path(str(base) + "_" + str(suffix))
        suffix += 1
    candidate.mkdir(parents=True, exist_ok=False)
    return candidate


def _export_fbx(avatar, file_path):
    return RLPy.RFileIO.ExportFbxFile(
        avatar,
        str(file_path),
        RLPy.EExportFbxOptions__None,
        RLPy.EExportFbxOptions2__None,
        RLPy.EExportFbxOptions3__None,
        RLPy.EExportTextureSize_Original,
        RLPy.EExportTextureFormat_Default,
        "",
    )


def _confirm(avatar_name, neutral_path, morph_path, weight):
    message = (
        "Export a neutral FBX and one morph FBX for {0}?\n\n"
        "Neutral: {1}\nMorph: {2}\nSlider: {3} at {4}\n\n"
        "The script will temporarily set this one slider, export, then restore its current value."
    ).format(avatar_name, neutral_path, morph_path, TARGET_DISPLAY_NAME, weight)
    answer = QtWidgets.QMessageBox.question(
        None,
        "CoModel Studio: CC5 Morph Export Pilot",
        message,
        QtWidgets.QMessageBox.Yes | QtWidgets.QMessageBox.No,
        QtWidgets.QMessageBox.No,
    )
    return answer == QtWidgets.QMessageBox.Yes


def run_script():
    avatars = RLPy.RScene.GetAvatars()
    if not avatars:
        QtWidgets.QMessageBox.warning(None, "CC5 Morph Export Pilot", "Load a character first.")
        return None

    avatar = avatars[0]
    shaping = avatar.GetAvatarShapingComponent()
    slider_ids = set()
    for category in shaping.GetShapingMorphCatergoryNames():
        slider_ids.update(str(slider_id) for slider_id in shaping.GetShapingMorphIDs(category))

    weights = {}
    for slider_id in slider_ids:
        weight = shaping.GetShapingMorphWeight(slider_id)
        if weight is None:
            raise RuntimeError("CC5 returned no current weight for slider {0}".format(slider_id))
        weights[slider_id] = float(weight)
    nonzero = {slider_id: weight for slider_id, weight in weights.items() if abs(weight) > 1e-6}
    if nonzero:
        QtWidgets.QMessageBox.warning(
            None,
            "CC5 Morph Export Pilot",
            "The character is not neutral ({0} nonzero shaping sliders). Reset its sliders to zero before exporting.".format(len(nonzero)),
        )
        return None

    slider_names = []
    for category in shaping.GetShapingMorphCatergoryNames():
        ids = shaping.GetShapingMorphIDs(category)
        names = shaping.GetShapingMorphDisplayNames(category)
        slider_names.extend(
            (str(slider_id), str(display_name))
            for slider_id, display_name in zip(ids, names)
        )
    if (TARGET_SLIDER_ID, TARGET_DISPLAY_NAME) not in slider_names:
        QtWidgets.QMessageBox.warning(
            None,
            "CC5 Morph Export Pilot",
            "The expected Ear Scale Height slider was not found on this character.",
        )
        return None

    range_value = shaping.GetShapingMorphMinMax(TARGET_SLIDER_ID)
    minimum, maximum = _parse_min_max(range_value)
    original_weight = shaping.GetShapingMorphWeight(TARGET_SLIDER_ID)
    if not minimum <= maximum <= 1.0 or not math.isclose(maximum, 1.0):
        raise RuntimeError("Pilot slider range changed; expected max 1.0, received {0}".format(range_value))

    output_dir = _new_output_dir()
    neutral_path = output_dir / "CC3_Base_Plus_neutral.fbx"
    morph_path = output_dir / "CC3_Base_Plus_ear_scale_height_max.fbx"
    if not _confirm(avatar.GetName(), neutral_path, morph_path, maximum):
        print("CC5 morph export pilot cancelled; no FBX files exported.")
        return None

    report = {
        "avatar": avatar.GetName(),
        "slider_id": TARGET_SLIDER_ID,
        "slider_display_name": TARGET_DISPLAY_NAME,
        "slider_min_max": [minimum, maximum],
        "original_weight": float(original_weight),
        "neutral_export": None,
        "morph_export": None,
        "restore_status": None,
    }
    try:
        neutral_result = _export_fbx(avatar, neutral_path)
        report["neutral_export"] = {
            "path": str(neutral_path),
            "status": _status_text(neutral_result),
            "success": neutral_result == RLPy.RStatus.Success,
        }
        if not report["neutral_export"]["success"]:
            raise RuntimeError("Neutral FBX export failed: {0}".format(neutral_result))

        set_result = shaping.SetShapingMorphWeight(TARGET_SLIDER_ID, maximum)
        RLPy.RGlobal.ObjectModified(
            avatar,
            RLPy.EObjectModifiedType_Attribute | RLPy.EObjectModifiedType_Transform,
        )
        report["set_weight_status"] = _status_text(set_result)
        actual_weight = float(shaping.GetShapingMorphWeight(TARGET_SLIDER_ID))
        if not math.isclose(actual_weight, maximum, abs_tol=1e-6):
            raise RuntimeError("Slider did not reach requested weight: {0}".format(actual_weight))

        morph_result = _export_fbx(avatar, morph_path)
        report["morph_export"] = {
            "path": str(morph_path),
            "status": _status_text(morph_result),
            "success": morph_result == RLPy.RStatus.Success,
        }
        if not report["morph_export"]["success"]:
            raise RuntimeError("Morph FBX export failed: {0}".format(morph_result))
    finally:
        report["restore_status"] = _status_text(
            shaping.SetShapingMorphWeight(TARGET_SLIDER_ID, float(original_weight))
        )
        RLPy.RGlobal.ObjectModified(
            avatar,
            RLPy.EObjectModifiedType_Attribute | RLPy.EObjectModifiedType_Transform,
        )

    report_path = output_dir / "morph_pilot_report.json"
    with report_path.open("w", encoding="utf-8") as report_file:
        json.dump(report, report_file, ensure_ascii=False, indent=2)
    print("CC5 morph pilot outputs written to: {0}".format(output_dir))
    return str(output_dir)


if __name__ == "__main__":
    run_script()
