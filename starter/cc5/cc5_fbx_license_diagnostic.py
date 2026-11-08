"""Read-only CC5 FBX entitlement diagnostic; does not export or alter the scene."""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

import RLPy

OUTPUT_DIR = Path(os.environ.get("USERPROFILE", str(Path.home()))) / "Documents" / "CoModelStudio" / "CC5Exports" / "cc5_base_plus_morphs_v1"


def _describe(value):
    return {
        "type": type(value).__name__,
        "repr": repr(value),
        "bool_value": bool(value) if value is not None else None,
    }


def run_script():
    avatars = RLPy.RScene.GetAvatars()
    result = {
        "generated_local": datetime.now().replace(microsecond=0).isoformat(),
        "python_version": sys.version,
        "avatar_count": len(avatars),
        "avatars": [],
        "trial_content_mode": None,
        "errors": [],
        "note": "Read-only licensing diagnostic. It does not suppress or bypass Reallusion license checks.",
    }
    is_trial = getattr(RLPy.RGlobal, "IsTrialContentMode", None)
    if callable(is_trial):
        try:
            result["trial_content_mode"] = _describe(is_trial())
        except Exception as exc:
            result["errors"].append({"method": "RGlobal.IsTrialContentMode", "error": str(exc)})

    license_check = getattr(RLPy.RFileIO, "CheckExportFbxHasLicense", None)
    for avatar in avatars:
        entry = {"name": str(avatar.GetName()), "type": type(avatar).__name__}
        if callable(license_check):
            try:
                entry["fbx_license_check"] = _describe(license_check(avatar))
            except Exception as exc:
                entry["fbx_license_check_error"] = str(exc)
        else:
            entry["fbx_license_check_error"] = "RFileIO.CheckExportFbxHasLicense is unavailable"
        result["avatars"].append(entry)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / "cc5_fbx_license_diagnostic.json"
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print("CC5 FBX license diagnostic written to: {0}".format(output_path))
    return result


if __name__ == "__main__":
    run_script()
