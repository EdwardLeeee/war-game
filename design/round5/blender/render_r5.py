"""R5 renders.

python3 blender/render_r5.py --target mageWA [--preview]
targets:
  mageWA mageWB mageWC   R5-01 西陸晶術師 designs (stills and the motion strip)
  compare                R1 longbowman and pikeman with the R2 render settings, only for the
                         actual-size "can you tell them apart" row (their level-C models are R5-02)
  rosterE1 rosterE2 rosterW1 rosterW2 rosterW3
                         R5-02 level-C roster (W3 is the chosen West mage, B 學院大師): every unit at facing 7 (idle + action, x3 and x6)
                         and the formation frames (East facing 0, West facing 4; x3)
Option 0 (the current mage, shared by both sides) reuses design/round3/build/r3/mage0.
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
MAGE_FRAME = [3.4, 3.6, 0.5, 0.74]
# R5-02 roster: (kind, frame metres, action (anim, frame), extra job keys); East faces 0, West faces 4.
# Frames are wide enough for spears, lances, the hoe and the raised axe in the side views.
ROSTER = {
    "rosterE1": [("farmer_e", [3.0, 3.2, 0.5, 0.8], ("attack", 4), {}),
                 ("spear_e", [6.4, 3.6, 0.5, 0.72], ("attack", 4), {}),
                 ("xbow_e", [2.6, 3.2, 0.5, 0.72], ("attack", 1), {})],
    "rosterE2": [("hcav_e", [7.2, 4.4, 0.5, 0.75], ("walk", 2), {}),
                 ("siege_e", [5.6, 6.4, 0.5, 0.8], ("attack", 3), {}),
                 ("mage_e", MAGE_FRAME, ("cast", 20), {"mage_style": "TB"})],
    "rosterW1": [("farmer_w", [3.8, 3.4, 0.5, 0.8], ("attack", 4), {}),
                 ("pike_w", [8.0, 4.4, 0.5, 0.62], ("attack", 4), {}),
                 ("bow_w", [2.8, 3.2, 0.5, 0.74], ("attack", 4), {})],
    "rosterW2": [("knight_w", [7.6, 4.4, 0.5, 0.75], ("walk", 2), {}),
                 ("siege_w", [5.6, 4.4, 0.5, 0.72], ("attack", 2), {})],
    # R5-03 槍兵 option A: player-colour cloth drape over the tassets (variant 1)
    "spearA": [("spear_e", [6.4, 3.6, 0.5, 0.72], ("attack", 4), {"variant": 1})],
    # the West peasant again, after its headscarf became player colour
    "rosterW1farmer": [("farmer_w", [3.8, 3.4, 0.5, 0.8], ("attack", 4), {})],
    # the West mage chosen in R5-01 (使用者 2026-09-30：「b 學院大師」)
    "rosterW3": [("mage_w", MAGE_FRAME, ("cast", 20), {"mage_style": "WB"})],
}
COMPARE = {"bow_w": [2.6, 3.0, 0.5, 0.74], "pike_w": [5.2, 3.4, 0.5, 0.72]}


def nm(kind, f, a, fr, prefix=""):
    return f"{prefix}{kind}_f{f}_{a}{fr:02d}"


def run(target, preview=False):
    out = config.BUILD / "r5" / target
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    if target == "compare":
        ps = ["beauty", "mask", "shadow", "ao"]
        for kind, fm in COMPARE.items():
            items = [dict(facing=f, anim=a, frame=fr, passes=ps, out=str(out / nm(kind, f, a, fr)))
                     for f, a, fr in [(7, "idle", 3), (0, "idle", 3)]]
            batch.run(kind, items, 60 if preview else 120, level="A", quality="hq", frame_m=fm, tag="r5",
                      ss=1 if preview else 2, outputs={"x3": 60} if preview else {"x6": 120, "x3": 60})
        print(f"R5 compare done in {time.time() - t0:.0f}s")
        return
    if target in ROSTER:
        for kind, fm, (act, af), ex in ROSTER[target]:
            side = 0 if kind.endswith("_e") else 4
            ps = ["beauty", "mask", "shadow", "ao"] + (["fx"] if kind.startswith("mage") else [])
            big = [(7, "idle", 3), (7, act, af)]
            small = [(side, "idle", 3), (side, "walk", 2), (side, "walk", 6)]
            items = [dict(facing=f, anim=a, frame=fr, passes=ps, out=str(out / nm(kind, f, a, fr))) for f, a, fr in big]
            ex = dict(ex)
            variant = ex.pop("variant", 0)
            extra = dict(r5=True, **ex)
            if preview:
                batch.run(kind, items[:1], 60, level="C", frame_m=fm, tag="r5p", outputs={"x3": 60}, variant=variant,
                          samples={"beauty": 12, "shadow": 8, "ao": 6, "fx": 8}, extra=extra)
                continue
            batch.run(kind, items, 120, level="C", frame_m=fm, tag="r5", ss=2, outputs={"x6": 120, "x3": 60},
                      extra=extra, variant=variant)
            items = [dict(facing=f, anim=a, frame=fr, passes=ps, out=str(out / nm(kind, f, a, fr))) for f, a, fr in small]
            batch.run(kind, items, 60, level="C", frame_m=fm, tag="r5f", ss=2, outputs={"x3": 60}, extra=extra,
                      variant=variant)
        print(f"R5 {target} renders done in {time.time() - t0:.0f}s")
        return
    style = target.replace("mage", "")
    extra = dict(r5=True, mage_style=style)
    ps = ["beauty", "mask", "shadow", "ao", "fx"]
    items = [dict(facing=f, anim=a, frame=fr, passes=ps, out=str(out / nm("mage_w", f, a, fr))) for f, a, fr in MAGE_STILLS]
    if preview:
        batch.run("mage_w", items[:1] + items[2:3], 60, level="C", frame_m=MAGE_FRAME, tag="r5p", outputs={"x3": 60},
                  samples={"beauty": 12, "shadow": 8, "ao": 6, "fx": 8}, extra=extra)
        return
    batch.run("mage_w", items, 120, level="C", frame_m=MAGE_FRAME, tag="r5", ss=2,
              outputs={"x6": 120, "x3": 60}, extra=extra)
    motion = [dict(facing=7, anim="walk", frame=f, passes=ps, out=str(out / nm("mage_w", 7, "walk", f, "motion_")))
              for f in range(12)]
    motion += [dict(facing=7, anim="cast", frame=f, passes=ps, out=str(out / nm("mage_w", 7, "cast", f, "motion_")))
               for f in range(30)]
    batch.run("mage_w", motion, 120, level="C", frame_m=[4.6, 3.6, 0.36, 0.74], tag="r5m", outputs={"x6": 120},
              samples={"beauty": 32, "shadow": 16, "ao": 8, "fx": 16}, extra=extra)
    print(f"R5 {target} renders done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", required=True, choices=["mageWA", "mageWB", "mageWC", "compare"] + list(ROSTER))
    ap.add_argument("--preview", action="store_true")
    a = ap.parse_args()
    run(a.target, a.preview)
