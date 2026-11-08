"""Read-only inventory of CC5/Reallusion template and custom libraries."""

import json
import os
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

OUTPUT_DIR = Path(os.environ.get("USERPROFILE", str(Path.home()))) / "Documents" / "CoModelStudio" / "CC5Exports"
PUBLIC_DOCUMENTS = Path(os.environ.get("PUBLIC", r"C:\Users\Public")) / "Documents" / "Reallusion"
LIBRARY_NAMES = (
    "Reallusion Templates",
    "Shared Templates",
    "Reallusion Custom",
    "Shared Custom",
)


def _scan_library(root):
    files = []
    errors = []
    extensions = Counter()
    categories = Counter()
    total_bytes = 0

    def on_walk_error(error):
        errors.append({"path": str(error.filename or root), "error": str(error)})

    for current_root, directories, filenames in os.walk(str(root), onerror=on_walk_error):
        directories.sort(key=str.casefold)
        filenames.sort(key=str.casefold)
        for filename in filenames:
            full_path = Path(current_root) / filename
            try:
                relative_path = full_path.relative_to(root)
                size_bytes = full_path.stat().st_size
            except OSError as exc:
                errors.append({"path": str(full_path), "error": str(exc)})
                continue

            parts = relative_path.parts
            category = parts[0] if len(parts) > 1 else "(root)"
            extension = full_path.suffix.lower() or "(no extension)"
            files.append({
                "relative_path": relative_path.as_posix(),
                "category": category,
                "extension": extension,
                "size_bytes": size_bytes,
            })
            extensions[extension] += 1
            categories[category] += 1
            total_bytes += size_bytes

    return {
        "name": root.name,
        "path": str(root),
        "file_count": len(files),
        "total_bytes": total_bytes,
        "category_counts": dict(sorted(categories.items(), key=lambda item: item[0].casefold())),
        "extension_counts": dict(sorted(extensions.items())),
        "files": files,
        "errors": errors,
    }


def build_report():
    libraries = []
    missing = []
    for name in LIBRARY_NAMES:
        root = PUBLIC_DOCUMENTS / name
        if root.is_dir():
            libraries.append(_scan_library(root))
        else:
            missing.append(str(root))

    return {
        "format_version": 1,
        "generated_utc": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "runtime": {
            "python_version": sys.version,
            "executable": sys.executable,
            "public_documents_root": str(PUBLIC_DOCUMENTS),
        },
        "libraries": libraries,
        "missing_library_roots": missing,
        "notes": [
            "Read-only file inventory; does not open, convert, move, or modify content files.",
            "File metadata is not proof of a license to redistribute the listed assets.",
        ],
    }


def run_script():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / "cc5_library_inventory.json"
    with output_path.open("w", encoding="utf-8") as output_file:
        json.dump(build_report(), output_file, ensure_ascii=False, indent=2)
    print("CC5 library inventory written to: {0}".format(output_path))
    return str(output_path)


if __name__ == "__main__":
    run_script()
