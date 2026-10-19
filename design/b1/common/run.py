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
# B1-01: the other twelve buildings, the wall pieces and the gates, per culture
B101 = ("lumber_camp", "mine", "granary", "farm", "range", "mage_hall", "tower", "branch_city", "smithy", "stable",
        "workshop")
for _c in CULTURES:
    TARGETS[f"b101_{_c}"] = ([dict(kind=k, culture=_c, probe=True) for k in B101]
                             + [dict(kind="wall", culture=_c, opts=dict(piece=p), tag=p) for p in ("x", "y", "corner")]
                             + [dict(kind="gate", culture=_c, opts=dict(piece="x"), tag="x", footprint=[4, 1]),
                                dict(kind="gate", culture=_c, opts=dict(piece="y"), tag="y", footprint=[1, 4])])

# B1-04: resource points (trees per culture; gold, berries and crystal are the same in both) and the farm's crops
TARGETS["b104"] = (
    [dict(kind="tree", culture=c, opts=dict(variant=v), tag=f"v{v}") for c in CULTURES for v in (0, 1, 2)]
    + [dict(kind="tree", culture=c, opts=dict(state="stump"), tag="stump") for c in CULTURES]
    + [dict(kind="forest", culture=c, probe=True) for c in CULTURES]
    + [dict(kind="farm", culture=c, opts=dict(stage=st), tag=st) for c in CULTURES for st in ("sown", "growing", "ripe")]
    + [dict(kind=k, culture="E", opts=dict(variant=v, state=st), tag=f"v{v}_{st}") for k, sts in
       (("gold", ("full", "mined", "depleted")), ("berry", ("full", "depleted")), ("crystal", ("full", "depleted")))
       for v in (0, 1) for st in sts])

# second pass after the self-check: the damage and destruction states, the burning and ruined town houses and the
# torn-down tower (fire colour, holes, hollow stubs, rubble)
for _k in ("main_city", "house", "barracks"):
    TARGETS[f"states2_{_k}"] = [dict(kind=_k, culture=c, state=s) for c in CULTURES
                                for s in ("damaged_a", "damaged_b", "destroyed_a", "destroyed_b")]
for _c in CULTURES:
    TARGETS[f"towns2_{_c}"] = ([dict(kind=k, culture=_c, state=s, opts=dict(variant=v), tag=f"v{v}")
                                for k in ("th22", "th21", "th12") for v in (0, 1) for s in ("ruin", "burning")]
                               + [dict(kind="ttower", culture=_c, state="rubble")])

# player colour raised to 5 % or more (ceo 2026-10-02): the buildings that changed, and what is built from them
TARGETS["teamfix_b101"] = ([dict(kind=k, culture="E", probe=True) for k in
                            ("lumber_camp", "mine", "granary", "farm", "mage_hall", "smithy")]
                           + [dict(kind=k, culture="W", probe=True) for k in ("lumber_camp", "mine", "farm", "smithy")])
TARGETS["teamfix_core3"] = [dict(kind="house", culture="E", probe=True)]
TARGETS["teamfix_b104"] = [dict(kind="farm", culture=c, opts=dict(stage=st), tag=st) for c in CULTURES
                           for st in ("sown", "growing", "ripe")]
TARGETS["teamfix_states"] = [dict(kind="house", culture="E", state=s) for s in
                             ("build_a1", "build_a2", "build_a3", "build_b1", "build_b2", "build_b3",
                              "damaged_a", "damaged_b", "destroyed_a", "destroyed_b")]
# B1b (the user, 2026-10-02): the refined East tower and the rice and wheat fields
TARGETS["b1b"] = ([dict(kind="tower_fine", culture="E", probe=True)]
                  + [dict(kind="farm_fine", culture=c, opts=dict(stage=st), tag=st) for c in CULTURES
                     for st in ("sown", "growing", "ripe")])
TARGETS["states3"] = [dict(kind=k, culture=c, state="destroyed_b") for k in ("main_city", "barracks") for c in CULTURES]


# R6 production (art-v2, design/b1/atlas-buildings.md, agreed with client 2026-10-18): every piece is named by its
# atlas frame. Each building: finished, construction 2 and 3, damaged (B1-02 A); per footprint size and culture the
# shared foundation (construction 1) and rubble, from the three buildings B1-02 was drawn on; the farm's own
# foundation and its three crop stages; the big city's tower finished, damaged and torn down; the resource points.
def _prod_buildings(c):
    kinds = {"main_city": "main_city", "house": "house", "lumber_camp": "lumber_camp", "mine": "mine",
             "granary": "granary", "barracks": "barracks", "range": "range", "mage_hall": "mage_hall",
             "arrow_tower": "tower_fine" if c == "E" else "tower", "stable": "stable"}
    out = [dict(kind=k, culture=c, state=st, name=f"{n}_{c}_{s}") for n, k in kinds.items()
           for s, st in (("done", "done"), ("build2", "build_a2"), ("build3", "build_a3"), ("damaged", "damaged_a"))]
    for size, k in ((2, "house"), (3, "barracks"), (4, "main_city")):
        out += [dict(kind=k, culture=c, state="build_a1", name=f"found_{size}x{size}_{c}"),
                dict(kind=k, culture=c, state="destroyed_a", name=f"rubble_{size}x{size}_{c}")]
    out.append(dict(kind="farm_fine", culture=c, state="build_a1", opts=dict(stage="sown"), name=f"farm_{c}_build1"))
    out += [dict(kind="farm_fine", culture=c, opts=dict(stage=s), name=f"farm_{c}_{s}") for s in ("sown", "growing", "ripe")]
    out += [dict(kind="ttower", culture=c, state=st, name=f"town_tower_{c}_{s}")
            for s, st in (("done", "intact"), ("damaged", "damaged"), ("rubble", "rubble"))]
    return out


PROD_NODES = ([dict(kind="tree", culture=c, opts=dict(variant=v), name=f"tree_{c}_v{v}") for c in CULTURES for v in (0, 1, 2)]
              + [dict(kind="tree", culture=c, opts=dict(state="stump"), name=f"tree_{c}_stump") for c in CULTURES]
              + [dict(kind=k, culture="E", opts=dict(variant=v, state=st), name=f"{k}_v{v}_{st}") for k, sts in
                 (("gold", ("full", "mined", "depleted")), ("berry", ("full", "depleted")),
                  ("crystal", ("full", "depleted"))) for v in (0, 1) for st in sts])
PROD_CHUNK = 8                        # pieces per CI job
for _c in CULTURES:
    _all = _prod_buildings(_c)
    for _i in range(0, len(_all), PROD_CHUNK):
        TARGETS[f"prod_{_c}_{_i // PROD_CHUNK}"] = _all[_i:_i + PROD_CHUNK]
for _i in range(0, len(PROD_NODES), PROD_CHUNK):
    TARGETS[f"prod_nodes_{_i // PROD_CHUNK}"] = PROD_NODES[_i:_i + PROD_CHUNK]
# art-v3 again (2026-10-19): every damaged look, with the soot behind the hangings (blender/states.py damaged_a)
for _c in CULTURES:
    _dm = [pc for pc in _prod_buildings(_c) if pc["name"].endswith("_damaged")]
    for _i in range(0, len(_dm), 6):
        TARGETS[f"prod_dmg_{_c}_{_i // 6}"] = _dm[_i:_i + 6]
# again after the first run (2026-10-18): the pieces states.fire_at_top burns, without the soot that floated
TARGETS["prod_fire"] = [pc for _c in CULTURES for pc in _prod_buildings(_c)
                        if pc["name"] in ("arrow_tower_W_damaged", "town_tower_E_damaged", "town_tower_W_damaged")]

# R6-04 (the user, 2026-10-18: 「改正方形地圖吧」): the representative scene's buildings and resources with two other
# cameras. 甲 方形斜看: 30 degrees up, square to the grid. 乙 正上方俯視: 60 degrees up, square to the grid.
CAMERA = {}
for _t, _cam in (("dir_sq", dict(elev=30, az=0)), ("dir_top", dict(elev=60, az=0))):
    TARGETS[_t] = ([dict(kind=k, culture="E", name=f"{k}_E_{_t}") for k in ("main_city", "house", "barracks")]
                   + [dict(kind="tree", culture="E", opts=dict(variant=v), name=f"tree_E_v{v}_{_t}") for v in (0, 1, 2)]
                   + [dict(kind="gold", culture="E", opts=dict(variant=0, state="full"), name=f"gold_v0_full_{_t}")])
    CAMERA[_t] = _cam

# art-v3 (D-088, the user 2026-10-19: 「我覺得地圖還是正方形好」, 甲 方形斜看): every production piece with the
# camera 30 degrees up and square to the grid (proj.OBLIQUE); art-v2 was the diamond camera.
import proj  # noqa: E402
CAMERA.update({t: proj.OBLIQUE for t in TARGETS if t.startswith("prod_")})
# before the run for the atlas: the finished look of every building at that camera, to measure the player colour
# of all of them at once; R6-05 (the side-by-side the user approves first) takes three of these
_done = {c: [pc for pc in _prod_buildings(c) if pc["name"].endswith("_done") or pc["name"] == f"farm_{c}_ripe"]
         for c in CULTURES}
for _c in CULTURES:
    for _i in range(0, len(_done[_c]), 6):
        TARGETS[f"sqdone_{_c}_{_i // 6}"] = _done[_c][_i:_i + 6]
        CAMERA[f"sqdone_{_c}_{_i // 6}"] = proj.OBLIQUE

# the R6 battlefield boards before art-v3 is packed (D-088): the other frames their scenes draw (design/r6/common)
_SQF = ("found_2x2_E", "house_E_build2", "farm_E_growing", "tree_E_v0", "tree_E_v1", "tree_E_v2", "tree_W_v0", "tree_W_v1",
        "tree_W_v2", "gold_v0_full", "gold_v1_full")
TARGETS["sqfield"] = [pc for pc in _prod_buildings("E") + PROD_NODES if pc["name"] in _SQF]
CAMERA["sqfield"] = proj.OBLIQUE

# R6-06 (the user 2026-10-19: 「阿中立城市沒有圖耶」): the neutral towns, oblique, east (the prototype's towns). 甲: the
# landmark (towns.tgate) and the low B1-03 pieces round it; 乙: B1-03 as approved (the houses block); the west's
# landmark once, neutral, as a preview
_R606 = ([dict(kind="tgate", culture="E", opts=dict(variant=v, state=s), name=f"tgate_E_{n}_{s}")
          for v, n in ((0, "small"), (1, "large")) for s in ("intact", "ruin")]
         + [dict(kind="tgate", culture="W", opts=dict(variant=0), name="tgate_W_small_intact")]
         + [dict(kind="tground", culture="E", opts=dict(plan=layouts.ground_plan(L, h)), name=f"tground_E_{L['name']}_{t}")
            for L in (layouts.small(), layouts.large()) for t, h in (("A", "garden"), ("B", None))]
         + [dict(kind=k, culture="E", state=s, opts=dict(variant=v), name=f"{k}_E_{s}_v{v}")
            for k in ("th22", "th21", "th12") for v in (0, 1) for s in ("intact", "ruin")]
         + [dict(kind="ttower", culture="E", state="intact", name="ttower_E_intact")]
         + [dict(kind="tpost", culture="E", opts=dict(state=s), name=f"tpost_E_{s}") for s in ("lantern", "pennant", "fallen")])
TARGETS["r606_w"] = [pc for pc in _R606 if pc["name"] == "tgate_W_small_intact"]       # again: the arch's stones
CAMERA["r606_w"] = proj.OBLIQUE
for _i in range(0, len(_R606), 7):
    TARGETS[f"r606_{_i // 7}"] = _R606[_i:_i + 7]
    CAMERA[f"r606_{_i // 7}"] = proj.OBLIQUE

# R6-06 城堡 (the user 2026-10-19: 「希望像一個城堡」, D-089): the wall pieces (blender/castle.py), both cultures, whole
# and burnt, the paving inside the walls (common/castle.py), and the west's town tower
import castle as _castle  # noqa: E402
_R606C = ([dict(kind=k, culture=c, opts=dict(state=s), name=f"{k}_{c}_{s}")
           for c in CULTURES for k in ("pal_x", "pal_y", "pal_corner", "pal_gate_x", "pal_gate_y", "sw_x", "sw_y", "sw_ctower",
                                       "sw_gate_x", "sw_gate_y") for s in ("intact", "ruin")]
          + [dict(kind="tground", culture=c, opts=dict(plan=_castle.ground_plan(L)), name=f"tground_{c}_castle_{L['name']}")
             for c in CULTURES for L in (_castle.small(), _castle.large())]
          + [dict(kind="ttower", culture=c, state="intact", name=f"ttower_{c}_intact") for c in CULTURES])
TARGETS["castle_g"] = [pc for pc in _R606C if pc["kind"] == "tground"]      # again: the roads out of the gates
CAMERA["castle_g"] = proj.OBLIQUE
for _i in range(0, len(_R606C), 7):
    TARGETS[f"castle_{_i // 7}"] = _R606C[_i:_i + 7]
    CAMERA[f"castle_{_i // 7}"] = proj.OBLIQUE

# art-v4 (D-089, the user 2026-10-20 approved the castle boards: 「可以，照這樣做」): the wall pieces in both states
# (the four owner looks are one image tinted), the floor tiles inside the walls, and the 3 x 3 big city tower
_V4 = ([dict(kind=k, culture=c, opts=dict(state=s), name=f"castle_{k}_{c}_{s}", footprint=list(_castle.PIECE_FOOT[k]))
        for c in CULTURES for k in _castle.PIECE_FOOT for s in ("intact", "ruin")]
       + [dict(kind="tground", culture=c, opts=dict(plan=[(0.0, 0.0, t)]), name=f"castle_tile_{t}_{c}")
          for c in CULTURES for t in ("square", "street", "garden")]
       + [dict(kind="ttower3", culture=c, state=st, name=f"town_tower3_{c}_{s}")
          for c in CULTURES for s, st in (("done", "intact"), ("damaged", "damaged"), ("rubble", "rubble"))])
for _i in range(0, len(_V4), 8):
    TARGETS[f"prod_castle_{_i // 8}"] = _V4[_i:_i + 8]
    CAMERA[f"prod_castle_{_i // 8}"] = proj.OBLIQUE

# the output folder of a target: the parts of one item share a folder (states_* -> states, towns_* -> towns)
FOLDER = {t: t.split("_")[0] for t in TARGETS}
FOLDER.update({t: "b101" for t in TARGETS if t.startswith("b101")})
FOLDER.update({t: "states" for t in TARGETS if t.startswith(("states2", "states3"))})
FOLDER.update({"b1b": "b1b", "teamfix_b101": "b101", "teamfix_core3": "core3", "teamfix_b104": "b104", "teamfix_states": "states"})
FOLDER.update({t: "towns" for t in TARGETS if t.startswith("towns2")})
FOLDER.update({t: "prod" for t in TARGETS if t.startswith("prod_")})
FOLDER.update({t: "dir" for t in CAMERA if t.startswith("dir_")})
FOLDER.update({t: "sqdone" for t in TARGETS if t.startswith(("sqdone_", "sqfield"))})
FOLDER.update({t: "r606" for t in TARGETS if t.startswith("r606_")})
FOLDER.update({t: "castle" for t in TARGETS if t.startswith("castle_")})


def pieces(target):
    return TARGETS[target]


def piece_name(pc):
    if "name" in pc:
        return pc["name"]
    s = pc.get("state", "done")
    tag = pc.get("tag", "")
    return f"{pc['kind']}_{pc['culture']}" + ("" if s == "done" else f"_{s}") + (f"_{tag}" if tag else "")


def probes(target, only=None):
    """Only the occlusion measurement (no rendering): build/b1/<folder>/<piece>_probe.json."""
    out = config.BUILD / "b1" / FOLDER[target]
    out.mkdir(parents=True, exist_ok=True)
    pcs = []
    for pc in pieces(target):
        if not pc.get("probe") or (only and pc["kind"] not in only):
            continue
        d = dict(pc, out=str(out / f"{piece_name(pc)}_probe"), passes=[])
        pcs.append(d)
    job = dict(px_per_m=20, emblem_dir=str(config.BUILD / "emblems"), quality="hq", probe_only=True, pieces=pcs)
    jp = config.BUILD / "jobs" / f"b1_{target}_probe.json"
    jp.write_text(json.dumps(job))
    log = config.BUILD / "jobs" / f"b1_{target}_probe.log"
    config.blender(Path(HERE.parent / "blender" / "render_b1.py"), jp, log=log)
    txt = log.read_text()
    if "Traceback" in txt:
        print(txt[-3000:])
        raise SystemExit("probe failed")
    print("\n".join(ln for ln in txt.splitlines() if ln.startswith("PROBE")))


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
               samples={"beauty": 12, "mask": 4, "shadow": 8, "ao": 4} if preview else SAMPLES, pieces=pcs,
               camera=CAMERA.get(target))
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
    ap.add_argument("--probe", action="store_true", help="only the occlusion measurement, no rendering")
    a = ap.parse_args()
    if a.probe:
        probes(a.target, a.only.split(",") if a.only else None)
    else:
        run(a.target, a.preview, a.only.split(",") if a.only else None, a.ppm)
