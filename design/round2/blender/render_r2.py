"""Every render R2 needs, per detail level (0, A, B, C).

python3 blender/render_r2.py --level B [--only spear_e,mage_e] [--preview] [--parts detail,vignette,motion,buildings]

Output: build/r2/<level>/<name>_<scale>_<pass>.png + <name>_<scale>.json
  scale x3 = 1 pt per 3 px (the phone at 1x zoom), x6 = the phone zoomed in 2x.
Final renders run on GitHub Actions (.github/workflows/design-render.yml);
--preview is the small local check (3x only, low samples) under the memory cap.
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

# detail samples face the viewer (3/4 front): East 7, West 5
DETAIL = [("spear_e", 7, "attack", 0), ("hcav_e", 7, "walk", 2), ("mage_e", 7, "idle", 3), ("knight_w", 5, "walk", 1)]
# a small battle line for the 1x view
VIGNETTE = [("spear_e", 0, "attack", 1), ("spear_e", 0, "attack", 3), ("spear_e", 0, "attack", 5),
            ("hcav_e", 0, "walk", 2), ("mage_e", 0, "idle", 3), ("knight_w", 4, "walk", 1), ("knight_w", 4, "walk", 5)]
MOTION = [("spear_e", 7, "walk", 8), ("knight_w", 5, "walk", 8), ("mage_e", 7, "walk", 12)]
FRAME_M = {"spear_e": [4.6, 3.4, 0.5, 0.72], "hcav_e": [5.6, 4.2, 0.5, 0.75], "knight_w": [6.0, 4.2, 0.5, 0.75],
           "mage_e": [3.2, 3.4, 0.5, 0.74]}


def name(kind, facing, anim, frame):
    return f"{kind}_f{facing}_{anim}{frame:02d}"


def passes(kind, level):
    p = ["beauty", "mask", "shadow"]
    if level != "0":
        p.append("ao")
    if kind == "mage_e":
        p.append("fx")
    return p


def run(level, only=None, preview=False, parts=("detail", "vignette", "motion", "buildings")):
    out = config.BUILD / "r2" / level
    out.mkdir(parents=True, exist_ok=True)
    quality = "r1" if level == "0" else "hq"
    samples = {"beauty": 12, "shadow": 8, "ao": 6, "fx": 8} if preview else None
    t0 = time.time()
    groups = {}
    if "detail" in parts or "vignette" in parts:
        for kind, facing, anim, frame in (DETAIL if "detail" in parts else []) + (VIGNETTE if "vignette" in parts else []):
            groups.setdefault(kind, []).append((facing, anim, frame))
    for kind, poses in groups.items():
        if only and kind not in only:
            continue
        items = [dict(facing=f, anim=a, frame=fr, passes=passes(kind, level), out=str(out / name(kind, f, a, fr)))
                 for f, a, fr in sorted(set(poses))]
        if level == "0":
            # R1 as it was: rendered straight at the target size, no supersampling
            batch.run(kind, items, 60, level="0", frame_m=FRAME_M[kind], tag="r2", outputs={"x3": 60})
            if not preview:
                batch.run(kind, items, 120, level="0", frame_m=FRAME_M[kind], tag="r2", outputs={"x6": 120})
        elif preview:
            batch.run(kind, items, 60, level=level, quality=quality, frame_m=FRAME_M[kind], samples=samples,
                      tag="r2p", outputs={"x3": 60})
        else:
            batch.run(kind, items, 120, level=level, quality=quality, frame_m=FRAME_M[kind], tag="r2", ss=2,
                      outputs={"x6": 120, "x3": 60})
    if "motion" in parts and not preview:
        for kind, facing, anim, n in MOTION:
            if only and kind not in only:
                continue
            items = [dict(facing=facing, anim=anim, frame=f, passes=passes(kind, level),
                          out=str(out / ("motion_" + name(kind, facing, anim, f)))) for f in range(n)]
            batch.run(kind, items, 120, level=level, quality=quality, frame_m=FRAME_M[kind], tag="r2m",
                      samples={"beauty": 24 if level == "0" else 32, "shadow": 16, "ao": 8, "fx": 16},
                      outputs={"x6": 120})
    if "buildings" in parts and not preview:
        for kind in ("citygate_e", "tower_w"):
            if only and kind not in only:
                continue
            ps = ["beauty", "mask", "shadow"] + ([] if level == "0" else ["ao"])
            it = [dict(facing=0, anim="idle", frame=0, passes=ps, out=str(out / f"{kind}_full"))]
            if level == "0":
                batch.run(kind, it, 60, level="0", tag="r2b", outputs={"x3": 60})
            else:
                batch.run(kind, it, 60, level=level, quality=quality, tag="r2b", ss=2, outputs={"x3": 60})
            # zoom crop (2x): the upper hall of the gate / the top of the tower, at 6x
            crop = {"citygate_e": [0.3, 0.05, 0.7, 0.45], "tower_w": [0.15, 0.05, 0.85, 0.55]}[kind]
            it = [dict(facing=0, anim="idle", frame=0, passes=["beauty"] + ([] if level == "0" else ["ao"]),
                       out=str(out / f"{kind}_zoom"))]
            if level == "0":
                batch.run(kind, it, 120, level="0", tag="r2z", border=crop, outputs={"x6": 120})
            else:
                batch.run(kind, it, 120, level=level, quality=quality, tag="r2z", ss=2, border=crop,
                          outputs={"x6": 120})
    print(f"R2 level {level} renders done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--level", required=True, choices=["0", "A", "B", "C"])
    ap.add_argument("--only", default="")
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--parts", default="detail,vignette,motion,buildings")
    a = ap.parse_args()
    run(a.level, set(filter(None, a.only.split(","))) or None, a.preview, tuple(a.parts.split(",")))
