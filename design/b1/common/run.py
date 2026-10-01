"""Host side of the B1 renders: write a job, run Blender (capped on the laptop, direct on CI), then
downscale every pass from the supersampled render to the output scale.

python3 common/run.py <target> [--preview]          targets: see TARGETS
-> build/b1/<target>/<piece>_x3_<pass>.png, <piece>_x3.json     (3x: 60 px per metre)

--preview: 1x-ish (24 px per metre), few samples, colour only; for checking shapes on the laptop.
"""
import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import config  # noqa: E402
import layouts  # noqa: E402

PPM = 60                 # 3x art scale (20 pt per metre x 3), the same as the units
SS = 2                   # supersampling
PASSES = ["beauty", "mask", "shadow", "ao"]
SAMPLES = {"beauty": 64, "mask": 8, "shadow": 32, "ao": 16}
CULTURES = ("E", "W")

# target -> list of piece dicts (kind, culture, state, opts, probe)
TARGETS = {
    "core3": [dict(kind=k, culture=c, probe=True) for k in ("main_city", "house", "barracks") for c in CULTURES],
    # B1-02: the states of three buildings, both cultures (one CI job per building)
    **{f"states_{k}": [dict(kind=k, culture=c, state=s) for c in CULTURES
                       for s in ("build_a1", "build_a2", "build_a3", "build_b1", "build_b2", "build_b3",
                                 "damaged_a", "damaged_b", "destroyed_a", "destroyed_b")]
       for k in ("main_city", "house", "barracks")},
    # B1-03: the town pieces (houses in four states, two looks each; the big city's tower; the square's
    # flag; the boundary posts; clutter; the paving of both layouts)
    **{f"towns_{c}": (
        [dict(kind=k, culture=c, state=s, opts=dict(variant=v), tag=f"v{v}")
         for k in ("th22", "th21", "th12") for v in (0, 1)
         for s in ("intact", "ruin", "burning", "scaffold")]
        + [dict(kind="ttower", culture=c, state=s) for s in ("intact", "rubble")]
        + [dict(kind="tflag", culture=c, opts=dict(state=s), tag=s) for s in ("neutral", "team", "half", "broken")]
        + [dict(kind="tpost", culture=c, opts=dict(state=s), tag=s) for s in ("lantern", "pennant", "bare", "fallen")]
        + [dict(kind=k, culture=c) for k in ("tcart", "ttax", "tlumber")]
        + [dict(kind="tground", culture=c, opts=dict(plan=layouts.ground_plan(L)), tag=L["name"])
           for L in (layouts.small(), layouts.large())]) for c in CULTURES},
}
# the output folder of a target: the parts of one item share a folder (states_* -> states, towns_* -> towns)
FOLDER = {t: t.split("_")[0] for t in TARGETS}


def pieces(target):
    return TARGETS[target]


def piece_name(pc):
    s = pc.get("state", "done")
    tag = pc.get("tag", "")
    return f"{pc['kind']}_{pc['culture']}" + ("" if s == "done" else f"_{s}") + (f"_{tag}" if tag else "")


def run(target, preview=False, only=None, prev_ppm=24):
    out = config.BUILD / "b1" / FOLDER[target]
    out.mkdir(parents=True, exist_ok=True)
    jobdir = config.BUILD / "jobs"
    jobdir.mkdir(parents=True, exist_ok=True)
    ppm = prev_ppm if preview else PPM
    ss = 1 if preview else SS
    pcs = []
    for pc in pieces(target):
        if only and pc["kind"] not in only:
            continue
        d = dict(pc)
        d["out"] = str(out / f"{piece_name(pc)}_raw")
        d["passes"] = ["beauty", "mask"] if preview else PASSES
        if preview:
            d["probe"] = pc.get("probe", False)
        pcs.append(d)
    job = dict(px_per_m=ppm * ss, emblem_dir=str(config.BUILD / "emblems"), quality="hq",
               samples={"beauty": 12, "mask": 4, "shadow": 8, "ao": 4} if preview else SAMPLES, pieces=pcs)
    jp = jobdir / f"b1_{target}{'_prev' if preview else ''}.json"
    jp.write_text(json.dumps(job))
    log = jobdir / f"b1_{target}{'_prev' if preview else ''}.log"
    wall = config.blender(Path(HERE.parent / "blender" / "render_b1.py"), jp, log=log)
    txt = log.read_text()
    if "Traceback" in txt or "Error:" in txt:
        print(txt[-4000:])
        raise SystemExit(f"blender job failed: {log}")
    print("\n".join(ln for ln in txt.splitlines() if ln.startswith(("PIECE", "RENDERED", "MAXRSS"))))
    print(f"[{target}] wall {wall:.0f}s")
    suffix = "prev" if preview else "x3"
    for pc in pcs:
        base = Path(pc["out"])
        meta = json.loads(Path(str(base) + ".json").read_text())
        f = 1.0 / ss
        for p in pc["passes"]:
            im = Image.open(f"{base}_{p}.png")
            if f != 1:
                im = im.resize((max(1, round(im.width * f)), max(1, round(im.height * f))), Image.LANCZOS)
                if p == "beauty":
                    im = im.filter(ImageFilter.UnsharpMask(radius=1.0, percent=40, threshold=2))
            dst = Path(str(base).replace("_raw", f"_{suffix}") + f"_{p}.png")
            im.save(dst)
            Path(f"{base}_{p}.png").unlink()
        meta = dict(meta, anchor=[a * f for a in meta["anchor"]], size=[round(s * f) for s in meta["size"]],
                    shadow_anchor=[a * f for a in meta["shadow_anchor"]],
                    shadow_size=[round(s * f) for s in meta["shadow_size"]], px_per_m=ppm)
        Path(str(base).replace("_raw", f"_{suffix}") + ".json").write_text(json.dumps(meta))
        Path(str(base) + ".json").unlink()
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("target", choices=list(TARGETS))
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--only", help="comma list of kinds")
    ap.add_argument("--ppm", type=int, default=24, help="preview pixels per metre (60 = the 3x art scale)")
    a = ap.parse_args()
    run(a.target, a.preview, a.only.split(",") if a.only else None, a.ppm)
