"""Production renders: one approved unit, every animation and facing, 3x source art.

python3 blender/render_prod.py --target farmer_e [--facings 0,7] [--anims idle,walk] [--preview]
-> build/prod/<unit>/raw/<unit>_<anim>_f<facing>_<ii>_x3_<pass>.png and .json (anchor, size)

One Blender process per facing. Rendered facings get colour, player-colour mask, shadow and AO
(mages also the effect layer); mirrored facings (spec.MIRRORED) get only their own shadow.
Scaling and compression are not done here: see common/postprocess.py.
"""
import argparse
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "common"))
sys.path.insert(0, str(HERE))
import batch   # noqa: E402
import config  # noqa: E402
import spec    # noqa: E402


def run(target, facings=None, anims=None, preview=False):
    u = spec.UNITS[target]
    raw = config.BUILD / "prod" / target / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    mage = u["kind"].startswith("mage")
    extra = dict(variant=u.get("variant", 0), shadow_extra=list(spec.SHADOW_EXTRA))
    if u.get("style"):
        extra["mage_style"] = u["style"]
    todo = [f for f in spec.ALL_FACINGS if facings is None or f in facings]
    timing = {}
    t_all = time.time()
    for f in todo:
        mirrored = f in spec.MIRRORED
        passes = spec.MIRROR_PASSES if mirrored else (spec.MAGE_PASSES if mage else spec.PASSES)
        items = []
        for name, n, src, _ in u["anims"]:
            if anims and name not in anims:
                continue
            frames = [0] if preview else range(n)
            for i in frames:
                items.append(dict(facing=f, anim=src, frame=i, n=n, passes=passes,
                                  out=str(raw / spec.frame_name(target, name, f, i))))
        if not items:
            continue
        t0 = time.time()
        if preview:
            batch.run(u["kind"], items, spec.PX_PER_M, level="C", frame_m=u["frame"], tag=f"prodp{f}",
                      outputs={"x3": spec.PX_PER_M}, samples={"beauty": 12, "shadow": 8, "ao": 6, "fx": 8, "mask": 4},
                      variant=extra["variant"], extra={k: v for k, v in extra.items() if k != "variant"})
        else:
            batch.run(u["kind"], items, spec.PX_PER_M, level="C", frame_m=u["frame"], tag=f"prod{f}",
                      ss=spec.SUPERSAMPLE, outputs={"x3": spec.PX_PER_M}, variant=extra["variant"],
                      extra={k: v for k, v in extra.items() if k != "variant"})
        timing[f] = dict(seconds=round(time.time() - t0, 1), frames=len(items), passes=len(passes))
        print(f"[{target}] facing {f}: {len(items)} frames x {len(passes)} passes in {time.time() - t0:.0f}s", flush=True)
    stats = dict(target=target, seconds=round(time.time() - t_all, 1), facings=timing, preview=preview)
    (config.BUILD / "prod" / target / "render_stats.json").write_text(json.dumps(stats, indent=1))
    print(f"[{target}] all done in {time.time() - t_all:.0f}s")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", required=True, choices=list(spec.UNITS))
    ap.add_argument("--facings", help="comma list, e.g. 0,7 (default: all eight)")
    ap.add_argument("--anims", help="comma list of animation names (default: all)")
    ap.add_argument("--preview", action="store_true", help="first frame of each animation, low samples, no supersampling")
    a = ap.parse_args()
    run(a.target, [int(x) for x in a.facings.split(",")] if a.facings else None,
        a.anims.split(",") if a.anims else None, a.preview)
