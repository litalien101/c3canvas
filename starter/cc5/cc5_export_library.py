"""Copy CC5/Reallusion library files to a local, portable export folder."""

import json
import os
import shutil
from datetime import datetime
from pathlib import Path

from PySide2 import QtWidgets

DOCUMENTS_ROOT = Path(os.environ.get("USERPROFILE", str(Path.home()))) / "Documents"
OUTPUT_ROOT = DOCUMENTS_ROOT / "CoModelStudio" / "CC5Exports"
PUBLIC_DOCUMENTS = Path(os.environ.get("PUBLIC", r"C:\Users\Public")) / "Documents" / "Reallusion"
LIBRARY_NAMES = (
    "Reallusion Templates",
    "Shared Templates",
    "Reallusion Custom",
    "Shared Custom",
)
GIB = 1024 ** 3


def _collect_files():
    files = []
    errors = []
    roots = []
    for name in LIBRARY_NAMES:
        root = PUBLIC_DOCUMENTS / name
        if not root.is_dir():
            continue
        roots.append(root)

        def on_walk_error(error):
            errors.append({"path": str(error.filename or root), "error": str(error)})

        for current_root, directories, filenames in os.walk(str(root), onerror=on_walk_error):
            directories.sort(key=str.casefold)
            filenames.sort(key=str.casefold)
            for filename in filenames:
                source = Path(current_root) / filename
                try:
                    relative = source.relative_to(root)
                    size_bytes = source.stat().st_size
                except OSError as exc:
                    errors.append({"path": str(source), "error": str(exc)})
                    continue
                files.append({
                    "source": source,
                    "root": root,
                    "relative": relative,
                    "size_bytes": size_bytes,
                })
    return roots, files, errors


def _new_destination():
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    base = OUTPUT_ROOT / ("library_assets_" + stamp)
    candidate = base
    suffix = 1
    while candidate.exists():
        candidate = Path(str(base) + "_" + str(suffix))
        suffix += 1
    return candidate


def _confirm(file_count, total_bytes, available_bytes, destination, scan_errors):
    estimated_gib = total_bytes / GIB
    available_gib = available_bytes / GIB
    message = (
        "Copy {0:,} library files ({1:.2f} GiB) to:\n{2}\n\n"
        "Available space: {3:.2f} GiB. This makes a local copy and does not alter CC5."
    ).format(file_count, estimated_gib, destination, available_gib)
    if scan_errors:
        message += "\n\nSome source files could not be read; the export may be incomplete."
    message += "\n\nOnly copy or share these assets as their licenses permit."
    answer = QtWidgets.QMessageBox.question(
        None,
        "CoModel Studio: Export CC5 Libraries",
        message,
        QtWidgets.QMessageBox.Yes | QtWidgets.QMessageBox.No,
        QtWidgets.QMessageBox.No,
    )
    return answer == QtWidgets.QMessageBox.Yes


def run_script():
    roots, files, errors = _collect_files()
    if not files:
        QtWidgets.QMessageBox.warning(
            None,
            "CoModel Studio: Export CC5 Libraries",
            "No library files were found in the configured Reallusion folders.",
        )
        return None

    total_bytes = sum(item["size_bytes"] for item in files)
    destination = _new_destination()
    available_bytes = shutil.disk_usage(DOCUMENTS_ROOT).free
    safety_margin = max(256 * 1024 ** 2, int(total_bytes * 0.05))
    if available_bytes < total_bytes + safety_margin:
        QtWidgets.QMessageBox.warning(
            None,
            "CoModel Studio: Export CC5 Libraries",
            "Not enough free space for the library copy plus a safety margin.\n"
            "Required: {0:.2f} GiB; available: {1:.2f} GiB.".format(
                (total_bytes + safety_margin) / GIB,
                available_bytes / GIB,
            ),
        )
        return None

    if not _confirm(len(files), total_bytes, available_bytes, destination, errors):
        print("CC5 library export cancelled; no files were copied.")
        return None

    destination.mkdir(parents=True, exist_ok=False)
    copied = []
    for index, item in enumerate(files, start=1):
        target = destination / item["root"].name / item["relative"]
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(item["source"]), str(target))
            copied.append({
                "library": item["root"].name,
                "relative_path": item["relative"].as_posix(),
                "size_bytes": item["size_bytes"],
            })
        except OSError as exc:
            errors.append({"path": str(item["source"]), "error": str(exc)})
        if index % 100 == 0:
            print("Processed {0:,} of {1:,} files".format(index, len(files)))

    report = {
        "format_version": 1,
        "generated_local": datetime.now().replace(microsecond=0).isoformat(),
        "source_roots": [str(root) for root in roots],
        "destination": str(destination),
        "expected_file_count": len(files),
        "copied_file_count": len(copied),
        "expected_bytes": total_bytes,
        "copied_bytes": sum(item["size_bytes"] for item in copied),
        "files": copied,
        "errors": errors,
        "license_note": "Local copy only; sharing and redistribution remain subject to each asset's license.",
    }
    report_path = destination / "library_export_manifest.json"
    with report_path.open("w", encoding="utf-8") as report_file:
        json.dump(report, report_file, ensure_ascii=False, indent=2)

    print("Copied {0:,} of {1:,} files to: {2}".format(len(copied), len(files), destination))
    print("Export manifest: {0}".format(report_path))
    return str(destination)


if __name__ == "__main__":
    run_script()
