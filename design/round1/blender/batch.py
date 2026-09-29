"""Host-side helper: run Blender unit jobs one at a time under the memory cap."""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "common"))
import config  # noqa: E402

EMBLEMS = config.BUILD / "emblems"


def run(kind, items, px_per_m, variant=0, frame_m=None, samples=None, tag="job"):
    jobdir = config.BUILD / "jobs"
    jobdir.mkdir(parents=True, exist_ok=True)
    job = dict(kind=kind, variant=variant, px_per_m=px_per_m, emblem_dir=str(EMBLEMS), items=items)
    if frame_m:
        job["frame_m"] = frame_m
    if samples:
        job["samples"] = samples
    path = jobdir / f"{tag}_{kind}_{variant}.json"
    path.write_text(json.dumps(job))
    log = jobdir / f"{tag}_{kind}_{variant}.log"
    wall = config.blender(HERE / "render_units.py", path, log=log)
    txt = log.read_text()
    if "Traceback" in txt or "Error:" in txt:
        print(txt[-3000:])
        raise SystemExit(f"blender job failed: {log}")
    line = [l for l in txt.splitlines() if l.startswith(("RENDERED", "MAXRSS"))]
    print(f"[{tag}] {kind} v{variant}: {' | '.join(line)} (wall {wall:.1f}s)", flush=True)
    return wall
