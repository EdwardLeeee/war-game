"""R4 renders: the three 道士／修仙 術士 designs, plus a farmer for the hat-silhouette check.

python3 blender/render_r4.py --target mageTA [--preview]
targets: mageTA mageTB mageTC farmer
Option 0 (the current mage) reuses design/round3/build/r3/mage0 (same settings).
"""
import argparse
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "common"))
sys.path.insert(0, str(HERE))
import batch   # noqa: E402
import config  # noqa: E402

MAGE_STILLS = [(7, "idle", 3), (0, "idle", 3), (7, "cast", 20), (5, "idle", 3)]


def nm(kind, f, a, fr, prefix=""):
    return f"{prefix}{kind}_f{f}_{a}{fr:02d}"


def run(target, preview=False):
    out = config.BUILD / "r4" / target
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    if target == "farmer":
        # R1 farmer model with the R2 render settings: only for comparing hats at actual size
        ps = ["beauty", "mask", "shadow", "ao"]
        items = [dict(facing=f, anim=a, frame=fr, passes=ps, out=str(out / nm("farmer_e", f, a, fr)))
                 for f, a, fr in [(7, "idle", 3), (0, "walk", 2)]]
        batch.run("farmer_e", items, 60 if preview else 120, level="A", quality="hq", frame_m=[2.6, 2.6, 0.5, 0.78],
                  tag="r4", ss=1 if preview else 2, outputs={"x3": 60} if preview else {"x6": 120, "x3": 60})
        print(f"R4 farmer done in {time.time() - t0:.0f}s")
        return
    style = target.replace("mage", "")
    extra = dict(r4=True, mage_style=style)
    ps = ["beauty", "mask", "shadow", "ao", "fx"]
    items = [dict(facing=f, anim=a, frame=fr, passes=ps, out=str(out / nm("mage_e", f, a, fr))) for f, a, fr in MAGE_STILLS]
    if preview:
        batch.run("mage_e", items[:1], 60, level="C", frame_m=[3.4, 3.6, 0.5, 0.74], tag="r4p", outputs={"x3": 60},
                  samples={"beauty": 12, "shadow": 8, "ao": 6, "fx": 8}, extra=extra)
        return
    batch.run("mage_e", items, 120, level="C", frame_m=[3.4, 3.6, 0.5, 0.74], tag="r4", ss=2,
              outputs={"x6": 120, "x3": 60}, extra=extra)
    motion = [dict(facing=7, anim="walk", frame=f, passes=ps, out=str(out / nm("mage_e", 7, "walk", f, "motion_")))
              for f in range(12)]
    motion += [dict(facing=7, anim="cast", frame=f, passes=ps, out=str(out / nm("mage_e", 7, "cast", f, "motion_")))
               for f in range(30)]
    batch.run("mage_e", motion, 120, level="C", frame_m=[4.6, 3.6, 0.36, 0.74], tag="r4m", outputs={"x6": 120},
              samples={"beauty": 32, "shadow": 16, "ao": 8, "fx": 16}, extra=extra)
    print(f"R4 {target} renders done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", required=True, choices=["mageTA", "mageTB", "mageTC", "farmer"])
    ap.add_argument("--preview", action="store_true")
    a = ap.parse_args()
    run(a.target, a.preview)
