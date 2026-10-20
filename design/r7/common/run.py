"""R7 (D-092): render one version of the realism comparison (design/r7/blender/render_r7.py) into design/r7/build/v<k>/:
the battlefield and the unit frames the boards and GIFs need. Local runs go through the memory-capped runner.

python3 design/r7/common/run.py <version> [--samples 64] [--only scene|units]
"""
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
R7 = HERE.parent
DESIGN = R7.parent
sys.path.insert(0, str(DESIGN / "production" / "common"))
import config  # noqa: E402

BUILD = R7 / "build"
EMBLEMS = DESIGN / "three" / "build" / "emblems"
# (kind, team, animation, frames, facing): the GIF's walk and attack, and the red pair for the side-by-side
UNITS = [("spear_e", "blue", "walk", 8, 1), ("spear_e", "blue", "attack", 10, 1),
         ("xbow_e", "blue", "walk", 8, 1), ("xbow_e", "blue", "attack", 10, 1),
         ("spear_e", "blue", "idle", 1, 1), ("xbow_e", "blue", "idle", 1, 1),
         ("spear_e", "red", "idle", 1, 5), ("xbow_e", "red", "idle", 1, 5)]


def emblems():
    import subprocess
    if not EMBLEMS.is_dir() or not any(EMBLEMS.iterdir()):
        subprocess.run([sys.executable, str(DESIGN / "round1" / "common" / "emblems.py"), str(EMBLEMS)], check=True,
                       cwd=DESIGN / "round1")


def main(version, samples, only=None):
    import textures
    textures.fetch()
    emblems()
    items = []
    if only in (None, "scene"):
        items.append(dict(what="scene"))
    if only in (None, "units"):
        items += [dict(what="unit", kind=k, team=t, anim=a, frames=n, facing=f) for k, t, a, n, f in UNITS]
    out = BUILD / f"v{version}"
    job = dict(version=version, tex_dir=str(textures.DIR), emblem_dir=str(EMBLEMS), out=str(out), samples=samples,
               items=items)
    jp = BUILD / "jobs" / f"v{version}.json"
    jp.parent.mkdir(parents=True, exist_ok=True)
    jp.write_text(json.dumps(job, indent=1))
    log = jp.with_suffix(".log")
    config.MEM_MAX = "3500M"
    config.THREADS = "6"
    wall = config.blender(R7 / "blender" / "render_r7.py", jp, log=log)
    txt = log.read_text()
    if "Traceback" in txt:
        print(txt[-3000:])
        raise SystemExit(f"blender job failed: {log}")
    print(f"v{version}: {len(items)} items in {wall:.0f} s -> {out}")


if __name__ == "__main__":
    sys.path.insert(0, str(HERE))
    ap = argparse.ArgumentParser()
    ap.add_argument("version", type=int)
    ap.add_argument("--samples", type=int, default=64)
    ap.add_argument("--only", choices=("scene", "units"))
    a = ap.parse_args()
    main(a.version, a.samples, a.only)
