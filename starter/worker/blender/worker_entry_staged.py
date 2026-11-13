from __future__ import annotations

import importlib.util
from pathlib import Path


WORKER_PATH = Path(__file__).with_name("worker_entry.py")
SPEC = importlib.util.spec_from_file_location("c3canvas_staged_worker", WORKER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("The Blender worker implementation could not be loaded.")
WORKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WORKER)
raise SystemExit(WORKER.main(force_staged_only=True))
