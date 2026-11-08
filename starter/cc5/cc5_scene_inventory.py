"""Read-only CC5 scene and character API inventory for CoModel Studio."""

import json
import inspect
import os
import re
import sys
from datetime import datetime
from pathlib import Path

import RLPy

OUTPUT_DIR = Path(os.environ.get("USERPROFILE", str(Path.home()))) / "Documents" / "CoModelStudio" / "CC5Exports"
FEATURE_METHODS = re.compile(r"morph|slider|shape|expression|blend|weight|key", re.IGNORECASE)
API_SYMBOLS = re.compile(r"morph|slider|shape|expression|blend|export|file|content|save|load", re.IGNORECASE)
API_METHODS = re.compile(r"morph|slider|shape|expression|blend|weight|key|export|fbx|save|load", re.IGNORECASE)


def _call(target, method_name, *args, errors=None, context=""):
    method = getattr(target, method_name, None)
    if not callable(method):
        return None
    try:
        return method(*args)
    except Exception as exc:
        if errors is not None:
            errors.append({"context": context, "method": method_name, "error": str(exc)})
        return None


def _public_feature_methods(target):
    if target is None:
        return []
    try:
        return sorted(
            name for name in dir(target)
            if not name.startswith("_") and FEATURE_METHODS.search(name)
        )
    except Exception:
        return []


def _api_symbols():
    try:
        return sorted(
            name for name in dir(RLPy)
            if not name.startswith("_") and API_SYMBOLS.search(name)
        )
    except Exception:
        return []


def _describe_api_object(name):
    target = getattr(RLPy, name, None)
    if target is None:
        return None
    description = {
        "type": type(target).__name__,
        "doc": inspect.getdoc(target),
        "members": [],
    }
    try:
        member_names = dir(target)
    except Exception:
        member_names = []
    for member_name in member_names:
        if member_name.startswith("_") or not API_METHODS.search(member_name):
            continue
        member = getattr(target, member_name, None)
        item = {"name": member_name, "type": type(member).__name__}
        try:
            item["signature"] = str(inspect.signature(member))
        except (TypeError, ValueError):
            item["signature"] = None
        item["doc"] = inspect.getdoc(member)
        description["members"].append(item)
    return description


def _describe_instance_methods(target, pattern):
    members = []
    for member_name in dir(target):
        if member_name.startswith("_") or not pattern.search(member_name):
            continue
        member = getattr(target, member_name, None)
        item = {"name": member_name, "type": type(member).__name__}
        try:
            item["signature"] = str(inspect.signature(member))
        except (TypeError, ValueError):
            item["signature"] = None
        members.append(item)
    return members


def _names(items):
    if items is None:
        return []
    try:
        return [str(item) for item in items]
    except Exception:
        return []


def _json_value(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    return str(value)


def _shaping_component_report(avatar, context, errors):
    component = _call(
        avatar,
        "GetAvatarShapingComponent",
        errors=errors,
        context="{0}.shaping_component".format(context),
    )
    report = {
        "available": component is not None,
        "python_type": type(component).__name__ if component is not None else None,
        "feature_methods": _public_feature_methods(component),
        "method_signatures": [],
        "categories": {},
        "slider_count": 0,
        "unique_slider_count": 0,
        "sliders": [],
    }
    if component is None:
        return report

    report["method_signatures"] = _describe_instance_methods(component, API_METHODS)
    categories = _call(
        component,
        "GetShapingMorphCatergoryNames",
        errors=errors,
        context="{0}.shaping_component".format(context),
    ) or []
    slider_index = {}
    for category in categories:
        category_name = str(category)
        slider_ids = _call(
            component,
            "GetShapingMorphIDs",
            category,
            errors=errors,
            context="{0}.shaping_component[{1}]".format(context, category_name),
        ) or []
        display_names = _call(
            component,
            "GetShapingMorphDisplayNames",
            category,
            errors=errors,
            context="{0}.shaping_component[{1}]".format(context, category_name),
        ) or []
        if len(slider_ids) != len(display_names):
            errors.append({
                "context": "{0}.shaping_component[{1}]".format(context, category_name),
                "method": "GetShapingMorphIDs/GetShapingMorphDisplayNames",
                "error": "slider ID and display-name counts differ",
            })
        entries = []
        for index in range(max(len(slider_ids), len(display_names))):
            slider_id = slider_ids[index] if index < len(slider_ids) else None
            display_name = display_names[index] if index < len(display_names) else None
            slider_key = str(slider_id) if slider_id is not None else None
            entries.append({
                "id": _json_value(slider_id),
                "id_type": type(slider_id).__name__ if slider_id is not None else None,
                "display_name": str(display_name) if display_name is not None else None,
            })
            if slider_key is None:
                continue
            if slider_key not in slider_index:
                minimum_maximum = _call(
                    component,
                    "GetShapingMorphMinMax",
                    slider_id,
                    errors=errors,
                    context="{0}.shaping_component[{1}]".format(context, slider_key),
                )
                current_weight = _call(
                    component,
                    "GetShapingMorphWeight",
                    slider_id,
                    errors=errors,
                    context="{0}.shaping_component[{1}]".format(context, slider_key),
                )
                slider_index[slider_key] = {
                    "id": _json_value(slider_id),
                    "id_type": type(slider_id).__name__,
                    "display_name": str(display_name) if display_name is not None else None,
                    "min_max": _json_value(minimum_maximum),
                    "current_weight": _json_value(current_weight),
                    "categories": [],
                }
            if category_name not in slider_index[slider_key]["categories"]:
                slider_index[slider_key]["categories"].append(category_name)
        report["categories"][category_name] = entries
        report["slider_count"] += len(entries)
    report["unique_slider_count"] = len(slider_index)
    report["sliders"] = list(slider_index.values())
    return report


def _component_report(avatar, accessor, label, errors):
    component = _call(avatar, accessor, errors=errors, context=label)
    report = {
        "available": component is not None,
        "python_type": type(component).__name__ if component is not None else None,
        "feature_methods": _public_feature_methods(component),
    }
    return component, report


def _avatar_report(avatar, index, errors):
    context = "avatar[{0}]".format(index)
    name = _call(avatar, "GetName", errors=errors, context=context)
    mesh_names = _call(avatar, "GetMeshNames", errors=errors, context=context)
    mesh_name_list = _names(mesh_names)
    report = {
        "name": str(name) if name is not None else None,
        "python_type": type(avatar).__name__,
        "mesh_names": mesh_name_list,
        "feature_methods": _public_feature_methods(avatar),
    }

    morph_component, report["morph_component"] = _component_report(
        avatar, "GetMorphComponent", "{0}.morph_component".format(context), errors
    )
    if morph_component is not None:
        morph_names_by_mesh = {}
        all_morph_names = []
        for mesh_name in dict.fromkeys(mesh_name_list):
            morph_names = _call(
                morph_component, "GetMorphNames", mesh_name,
                errors=errors,
                context="{0}.morph_component[{1}]".format(context, mesh_name)
            )
            names = _names(morph_names)
            morph_names_by_mesh[mesh_name] = names
            for morph_name in names:
                if morph_name not in all_morph_names:
                    all_morph_names.append(morph_name)
        report["morph_component"]["morph_names_by_mesh"] = morph_names_by_mesh
        report["morph_component"]["morph_names"] = all_morph_names
    report["shaping_component"] = _shaping_component_report(avatar, context, errors)
    face_component, report["face_component"] = _component_report(
        avatar, "GetFaceComponent", "{0}.face_component".format(context), errors
    )

    if face_component is not None:
        uid = _call(face_component, "GetExpressionSetUid", errors=errors, context=context)
        expressions = _call(
            face_component, "GetExpressionNames", "", True,
            errors=errors, context=context
        )
        report["face_component"]["expression_set_uid"] = str(uid) if uid is not None else None
        report["face_component"]["expression_names"] = _names(expressions)

    skeleton = _call(avatar, "GetSkeletonComponent", errors=errors, context=context)
    report["skeleton"] = {
        "available": skeleton is not None,
        "python_type": type(skeleton).__name__ if skeleton is not None else None,
        "skin_bones": [],
        "motion_bones": [],
    }
    if skeleton is not None:
        for method_name, key in (("GetSkinBones", "skin_bones"), ("GetMotionBones", "motion_bones")):
            bones = _call(skeleton, method_name, errors=errors, context=context)
            if bones is not None:
                report["skeleton"][key] = _names(
                    _call(bone, "GetName", errors=errors, context=context)
                    for bone in bones
                )

    return report


def build_report():
    errors = []
    avatars = _call(RLPy.RScene, "GetAvatars", errors=errors, context="scene") or []
    report = {
        "format_version": 1,
        "generated_utc": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "runtime": {
            "python_version": sys.version,
            "executable": sys.executable,
            "cc5_install_hint": os.environ.get("ProgramFiles", ""),
        },
        "avatar_count": len(avatars),
        "avatars": [
            _avatar_report(avatar, index, errors)
            for index, avatar in enumerate(avatars)
        ],
        "reallusion_api_symbols": _api_symbols(),
        "api_descriptions": {
            name: _describe_api_object(name)
            for name in (
                "RIMorphComponent",
                "RIAvatarShapingComponent",
                "RFileIO",
                "RFileIO_ExportFbxFile",
                "RExportFbxSetting",
            )
        },
        "errors": errors,
        "notes": [
            "Read-only API inventory; no scene or avatar data is modified.",
            "The shaping component records slider IDs and display names; no slider values are changed or FBX files exported.",
        ],
    }
    return report


def run_script():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / "cc5_scene_inventory.json"
    with output_path.open("w", encoding="utf-8") as output_file:
        json.dump(build_report(), output_file, ensure_ascii=False, indent=2)
    print("CC5 scene inventory written to: {0}".format(output_path))
    return str(output_path)


if __name__ == "__main__":
    run_script()
