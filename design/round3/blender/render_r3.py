"""R3 renders: the four 術士 designs (0 current, A, B, C) and the riders' fixed legs.

python3 blender/render_r3.py --target mageA [--preview]
targets: mage0 mageA mageB mageC legs
Output: build/r3/<target>/<name>_<scale>_<pass>.png (scale x3 = actual size on the phone, x6 = 2x zoom)
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

FRAME = {"mage_e": [3.4, 3.6, 0.5, 0.74], "hcav_e": [5.6, 4.2, 0.5, 0.75], "knight_w": [6.0, 4.2, 0.5, 0.75]}
MAGE_STILLS = [(7, "idle", 3), (0, "idle", 3), (7, "cast", 20), (5, "idle", 3)]
RIDERS = {"hcav_e": [(7, "walk", 2), (0, "walk", 2)], "knight_w": [(5, "walk", 1), (4, "walk", 1), (4, "walk", 5)]}


def nm(kind, f, a, fr, prefix=""):
    return f"{prefix}{kind}_f{f}_{a}{fr:02d}"


def run(target, preview=False):
    out = config.BUILD / "r3" / target
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    samples = {"beauty": 12, "shadow": 8, "ao": 6, "fx": 8} if preview else None
    if target.startswith("mage"):
        style = target[-1]
        extra = dict(r3=True, mage_style=style)
        ps = ["beauty", "mask", "shadow", "ao", "fx"]
        items = [dict(facing=f, anim=a, frame=fr, passes=ps, out=str(out / nm("mage_e", f, a, fr)))
                 for f, a, fr in MAGE_STILLS]
        if preview:
            batch.run("mage_e", items[:1], 60, level="C", frame_m=FRAME["mage_e"], samples=samples, tag="r3p",
                      outputs={"x3": 60}, extra=extra)
            return
        batch.run("mage_e", items, 120, level="C", frame_m=FRAME["mage_e"], tag="r3", ss=2,
                  outputs={"x6": 120, "x3": 60}, extra=extra)
        motion = [dict(facing=7, anim="walk", frame=f, passes=ps, out=str(out / nm("mage_e", 7, "walk", f, "motion_")))
                  for f in range(12)]
        motion += [dict(facing=7, anim="cast", frame=f, passes=ps, out=str(out / nm("mage_e", 7, "cast", f, "motion_")))
                   for f in range(30)]
        batch.run("mage_e", motion, 120, level="C", frame_m=[4.6, 3.6, 0.36, 0.74], tag="r3m", outputs={"x6": 120},
                  samples={"beauty": 32, "shadow": 16, "ao": 8, "fx": 16}, extra=extra)
    elif target == "legs":
        extra = dict(r3=True, legs_fixed=True)
        ps = ["beauty", "mask", "shadow", "ao"]
        for kind, poses in RIDERS.items():
            items = [dict(facing=f, anim=a, frame=fr, passes=ps, out=str(out / nm(kind, f, a, fr)))
                     for f, a, fr in poses]
            if preview:
                batch.run(kind, items[:1], 60, level="C", frame_m=FRAME[kind], samples=samples, tag="r3p",
                          outputs={"x3": 60}, extra=extra)
                continue
            batch.run(kind, items, 120, level="C", frame_m=FRAME[kind], tag="r3", ss=2,
                      outputs={"x6": 120, "x3": 60}, extra=extra)
        if not preview:
            items = [dict(facing=5, anim="walk", frame=f, passes=ps, out=str(out / nm("knight_w", 5, "walk", f, "motion_")))
                     for f in range(8)]
            batch.run("knight_w", items, 120, level="C", frame_m=FRAME["knight_w"], tag="r3m", outputs={"x6": 120},
                      samples={"beauty": 32, "shadow": 16, "ao": 8}, extra=extra)
    print(f"R3 {target} renders done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", required=True, choices=["mage0", "mageA", "mageB", "mageC", "legs"])
    ap.add_argument("--preview", action="store_true")
    a = ap.parse_args()
    run(a.target, a.preview)
