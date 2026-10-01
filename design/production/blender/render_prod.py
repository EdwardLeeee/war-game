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


FIT_MARGIN_M = 0.12      # room left around the furthest reach, metres


def fit_frame(target, extra, preview=False, review=False):
    """Pose every frame in all eight facings without rendering and size the frame to the furthest
    reach, so no weapon, flag or falling body is cut (the atlas trims each frame, so a large
    frame costs render time but no memory)."""
    u = spec.UNITS[target]
    if review:
        items = [dict(facing=f, anim=a, frame=i, n=n) for f in spec.REVIEW_FACINGS
                 for a, n in spec.REVIEW_ANIMS[target] for i in range(n)]
    else:
        items = [dict(facing=f, anim=src, frame=i, n=n) for f in spec.ALL_FACINGS
                 for _, n, src, _ in u["anims"] for i in ([0] if preview else range(n))]
    jobdir = config.BUILD / "jobs"
    jobdir.mkdir(parents=True, exist_ok=True)
    fit_out = config.BUILD / "prod" / (f"review-{target}" if review else target) / "fit.json"
    fit_out.parent.mkdir(parents=True, exist_ok=True)
    job = dict(kind=u["kind"], px_per_m=spec.PX_PER_M, emblem_dir=str(config.BUILD / "emblems"), items=items,
               level="C", quality="hq", frame_m=u["frame"], fit=True, fit_out=str(fit_out), **extra)
    path = jobdir / f"fit_{'review_' if review else ''}{target}.json"
    path.write_text(json.dumps(job))
    log = jobdir / f"fit_{'review_' if review else ''}{target}.log"
    config.blender(HERE / "render_units.py", path, log=log)
    txt = log.read_text()
    if "Traceback" in txt or not fit_out.exists():
        print(txt[-3000:])
        raise SystemExit(f"fit failed: {log}")
    e = json.loads(fit_out.read_text())
    m = FIT_MARGIN_M
    w, h = e["left"] + e["right"] + 2 * m, e["up"] + e["down"] + 2 * m
    frame = [round(w, 3), round(h, 3), round((e["left"] + m) / w, 4), round((e["up"] + m) / h, 4)]
    print(f"[{target}] fitted frame {frame} (spec had {u['frame']})", flush=True)
    return frame, e


def run(target, facings=None, anims=None, preview=False, review=False):
    u = spec.UNITS[target]
    outdir = config.BUILD / "prod" / (f"review-{target}" if review else target)
    raw = outdir / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    mage = u["kind"].startswith("mage")
    # the approved new animations (anims.py) are part of every production render; the mages' shield
    # is a layer of its own (client/docs/sprite-atlas.md version 2)
    extra = dict(variant=u.get("variant", 0), shadow_extra=list(spec.SHADOW_EXTRA), new_anims=True,
                 split_shield=mage)
    if u.get("style"):
        extra["mage_style"] = u["style"]
    if review:
        u = dict(u, anims=[(a, n, a, False) for a, n in spec.REVIEW_ANIMS[target]])
        facings = facings or spec.REVIEW_FACINGS
    t_fit = time.time()
    frame_m, reach = fit_frame(target, extra, preview, review)
    fit_seconds = round(time.time() - t_fit, 1)
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
            batch.run(u["kind"], items, spec.PX_PER_M, level="C", frame_m=frame_m, tag=f"prodp{'r' if review else ''}{f}",
                      outputs={"x3": spec.PX_PER_M}, samples={"beauty": 12, "shadow": 8, "ao": 6, "fx": 8, "mask": 4},
                      variant=extra["variant"], extra={k: v for k, v in extra.items() if k != "variant"})
        else:
            batch.run(u["kind"], items, spec.PX_PER_M, level="C", frame_m=frame_m, tag=f"prod{'r' if review else ''}{f}",
                      ss=spec.SUPERSAMPLE, outputs={"x3": spec.PX_PER_M}, variant=extra["variant"],
                      extra={k: v for k, v in extra.items() if k != "variant"})
        timing[f] = dict(seconds=round(time.time() - t0, 1), frames=len(items), passes=len(passes))
        print(f"[{target}] facing {f}: {len(items)} frames x {len(passes)} passes in {time.time() - t0:.0f}s", flush=True)
    if mage and not review and (anims is None or "shield" in anims):
        # the shield layer: one facing, no mirroring; named <unit>_shield_<anim>_<ii>
        items = [dict(facing=spec.SHIELD_FACING, anim=f"shield_{a}", frame=i, n=n, passes=["shield"],
                      out=str(raw / f"{target}_shield_{a}_{i:02d}"))
                 for a, n in spec.SHIELD_ANIMS for i in ([0] if preview else range(n))]
        t0 = time.time()
        if preview:
            batch.run(u["kind"], items, spec.PX_PER_M, level="C", frame_m=frame_m, tag="prodpshield",
                      outputs={"x3": spec.PX_PER_M}, samples={"fx": 8}, variant=extra["variant"],
                      extra={k: v for k, v in extra.items() if k != "variant"})
        else:
            batch.run(u["kind"], items, spec.PX_PER_M, level="C", frame_m=frame_m, tag="prodshield",
                      ss=spec.SUPERSAMPLE, outputs={"x3": spec.PX_PER_M}, variant=extra["variant"],
                      extra={k: v for k, v in extra.items() if k != "variant"})
        timing["shield"] = dict(seconds=round(time.time() - t0, 1), frames=len(items), passes=1)
        print(f"[{target}] shield: {len(items)} frames in {time.time() - t0:.0f}s", flush=True)
    stats = dict(target=target, seconds=round(time.time() - t_all, 1), fit_seconds=fit_seconds, frame_m=frame_m,
                 reach_m=reach, facings=timing, preview=preview)
    (outdir / "render_stats.json").write_text(json.dumps(stats, indent=1))
    print(f"[{target}] all done in {time.time() - t_all:.0f}s")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", required=True, choices=list(spec.UNITS))
    ap.add_argument("--facings", help="comma list, e.g. 0,7 (default: all eight)")
    ap.add_argument("--anims", help="comma list of animation names (default: all)")
    ap.add_argument("--preview", action="store_true", help="first frame of each animation, low samples, no supersampling")
    ap.add_argument("--review", action="store_true",
                    help="only the new animations waiting for approval (spec.REVIEW_ANIMS), into build/prod/review-<unit>")
    a = ap.parse_args()
    run(a.target, [int(x) for x in a.facings.split(",")] if a.facings else None,
        a.anims.split(",") if a.anims else None, a.preview, a.review)
