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
# D-096: the pieces of common/castle.py now (the plain walls one per side), the gates' closed, damaged and broken looks,
# and the front layer of the pieces with something in front of a unit on them (beauty and mask only)
_V4 = ([dict(kind=k, culture=c, opts=dict(state=s), name=f"castle_{k}_{c}_{s}", footprint=list(_castle.PIECE_FOOT[k]))
        for c in CULTURES for k in _castle.PIECE_FOOT
        for s in ("intact", "ruin") + (_castle.GATE_STATES if k in _castle.GATE_PIECES else ())]
       + [dict(kind=k, culture=c, opts=dict(state=s, front=True), name=f"castle_{k}_{c}_{s}_front",
               footprint=list(_castle.PIECE_FOOT[k]), passes=["beauty", "mask"])
          for c in CULTURES for k in _castle.FRONTS for s in ("intact", "ruin")]
       + [dict(kind="tground", culture=c, opts=dict(plan=[(0.0, 0.0, t)]), name=f"castle_tile_{t}_{c}")
          for c in CULTURES for t in ("square", "street", "garden")]
       + [dict(kind="ttower3", culture=c, state=st, name=f"town_tower3_{c}_{s}")
          for c in CULTURES for s, st in (("done", "intact"), ("damaged", "damaged"), ("rubble", "rubble"))])
TARGETS["prod_castle_t3"] = [pc for pc in _V4 if pc["kind"] == "ttower3"]     # again: the fire sat above the roof
CAMERA["prod_castle_t3"] = proj.OBLIQUE
for _i in range(0, len(_V4), 8):
    TARGETS[f"prod_castle_{_i // 8}"] = _V4[_i:_i + 8]
    CAMERA[f"prod_castle_{_i // 8}"] = proj.OBLIQUE

# D-096 (the user 2026-10-21: the gates shut, ranged units and mages go up on the walls): drafts first, for the user.
# Every gate in its open look (intact, art-v4's frame), closed, damaged and broken (blender/gates.py); the walls one
# piece per side (the walk is on the town side; the user 2026-10-22: 「上城牆不是這樣畫圖參考一下現實」): the palisade
# with its fighting platform, the stone wall with its crenellated parapet; and the front layer (castle.front_only) of
# the pieces that have something in front of a unit standing on them: the south palisade's stakes, the south stone
# wall's crenellated parapet, the north stone wall's low inner parapet
D096_GATES = _castle.GATE_PIECES
D096_STATES = _castle.GATE_STATES
D096_WALLS = tuple(f"{w}_{d}" for w in ("pal", "sw") for d in ("n", "s", "w", "e"))
D096_FRONTS = _castle.FRONTS
for _c in CULTURES:
    TARGETS[f"d096_{_c}"] = (
        [dict(kind=k, culture=_c, opts=dict(state=s), name=f"castle_{k}_{_c}_{s}", footprint=list(_castle.PIECE_FOOT[k]))
         for k in D096_GATES[:4] for s in ("intact",) + D096_STATES]
        + [dict(kind=k, culture=_c, opts=dict(state="intact"), name=f"castle_{k}_{_c}_intact", footprint=[1, 1])
           for k in D096_WALLS]
        + [dict(kind=k, culture=_c, opts=dict(state="intact", front=True), name=f"castle_{k}_{_c}_intact_front",
                footprint=list(_castle.PIECE_FOOT[k]), passes=["beauty", "mask"]) for k in D096_FRONTS]
        + [dict(kind=k, culture=_c, opts=dict(state="intact"), name=f"castle_{k}_{_c}_intact", footprint=list(_castle.PIECE_FOOT[k]))
           for k in ("pal_corner", "sw_ctower")])                     # unchanged: the corners on the boards
    TARGETS[f"d096w_{_c}"] = [pc for pc in TARGETS[f"d096_{_c}"] if pc["kind"] not in D096_GATES]
    CAMERA[f"d096_{_c}"] = CAMERA[f"d096w_{_c}"] = proj.OBLIQUE

# R6-50 (the user 2026-10-20: 「地面也可以美化一下現在感覺太陽春」): the R6 battlefield's ground in three looks
sys.path.insert(1, str(HERE.parents[1] / "r6" / "common"))
import ground_plan as _gp  # noqa: E402
_GPLAN = _gp.plan()
for _s in ("A", "B", "C"):
    TARGETS[f"r650_{_s}"] = [dict(kind="gpatch", culture="E", opts=dict(style=_s, w=_gp.W, d=_gp.D, plan=_GPLAN),
                                  name=f"ground_{_s}", footprint=[int(_gp.W / 2), int(_gp.D / 2)])]
    CAMERA[f"r650_{_s}"] = proj.OBLIQUE

# R6-51 (the user 2026-10-20: 「石頭好少 我覺得這種天然障礙物可以多些來擋路」): a stretch of road with each kind of
# obstacle across it
import r651 as _r651  # noqa: E402
for _k, *_ in _r651.KINDS:
    TARGETS[f"r651_{_k}"] = [dict(kind="tpatch", culture="E", opts=dict(w=_r651.W_CELLS * 2.0, d=_r651.D_CELLS * 2.0, plan=_r651.plan(_k)),
                                  name=f"tpatch_{_k}", footprint=[_r651.W_CELLS, _r651.D_CELLS])]
    CAMERA[f"r651_{_k}"] = proj.OBLIQUE

# art-v5 (R6-51, the user 2026-10-20: 「全部照整張地圖加」, the forests ordinary trees): the terrain tiles, each frame
# named terrain_<kind>... (atlas_b1 terrain/terrain.json; the Terrain values are core's, core/d089-obstacles)
import terrain_tiles as _tt  # noqa: E402
_V5 = ([dict(kind="trock", culture="E", opts=dict(variant=v), name=f"terrain_rock_v{v}") for v in range(6)]
       + [dict(kind="tcliff_post", culture="E", opts=dict(variant=v), name=f"terrain_cliff_post_v{v}") for v in range(2)]
       + [dict(kind="tcliff_arm", culture="E", opts=dict(direction=d, variant=v), name=f"terrain_cliff_arm_{d}_v{v}")
          for d in ("E", "S", "SE", "SW") for v in range(3)]
       + [dict(kind="twater", culture="E", opts=dict(mask=m, plan=_tt.water_polygons(m)), name=f"terrain_water_m{m}") for m in range(1, 16)]
       + [dict(kind="tford", culture="E", opts=dict(variant=v), name=f"terrain_ford_v{v}") for v in range(2)]
       + [dict(kind="tbridge_deck", culture="E", opts=dict(axis=a), name=f"terrain_bridge_deck_{a}") for a in ("ns", "ew")]
       + [dict(kind="tbridge_rail", culture="E", opts=dict(axis=a), name=f"terrain_bridge_rail_{a}") for a in ("x", "y")])
for _i in range(0, len(_V5), 9):
    TARGETS[f"prod_terrain_{_i // 9}"] = _V5[_i:_i + 9]
    CAMERA[f"prod_terrain_{_i // 9}"] = proj.OBLIQUE

# the output folder of a target: the parts of one item share a folder (states_* -> states, towns_* -> towns)
# 哨所 (D-080; ceo 2026-10-21): the outpost in the art-v3/v5 style, every state, the pieces named as production's
# (prod_<culture>_*: <kind>_<culture>_<state>), for the drafts and then art-v5.1
OUTPOST = [dict(kind="outpost", culture=c, state=st, name=f"outpost_{c}_{s}") for c in CULTURES
           for s, st in (("build1", "build_a1"), ("build2", "build_a2"), ("build3", "build_a3"), ("done", "done"),
                         ("damaged", "damaged_a"), ("rubble", "destroyed_a"))]
TARGETS["prod_outpost"] = OUTPOST
CAMERA["prod_outpost"] = proj.OBLIQUE      # registered after the prod_* camera line above: set here

# R8 batch 2 (D-093): the realistic look (render_b1.py LOOK "r8"; the CC0 textures of design/r7/common/textures.py)
R7_TEX = HERE.parents[1] / "r7" / "build" / "tex"
LOOK = {}
TARGETS["r8b_look"] = [dict(kind=k, culture=c, state="done", name=f"r8b_{k}_{c}") for c in CULTURES
                       for k in ("main_city", "house", "barracks")]
CAMERA["r8b_look"] = proj.OBLIQUE
LOOK["r8b_look"] = "r8"
# the style samples (ceo 2026-10-22: main city, house, barracks of both cultures first, for the user)
TARGETS["r8b_samples"] = [dict(kind=f"r8_{k}", culture=c, state="done", name=f"r8b_{k}_{c}_new") for c in CULTURES
                          for k in ("main_city", "house", "barracks")]
CAMERA["r8b_samples"] = proj.OBLIQUE
LOOK["r8b_samples"] = "r8"
# the cliff beside the stone wall (ceo 2026-10-22: the user's complaint, the cliff looked like a wall)
TARGETS["r8b_compare"] = [dict(kind=k, culture=c, opts=dict(state="intact"), name=f"r8b_{k}_{c}", footprint=[1, 1])
                          for c in CULTURES for k in ("sw_s", "pal_s")]
CAMERA["r8b_compare"] = proj.OBLIQUE
LOOK["r8b_compare"] = "r8"
# the cliff redone from scanned rock (the user 2026-10-22: 「懸崖看起來不太真實」), as the client's tiles: posts and
# arms (client/src/art/terrain.ts), named as art-v5's terrain_cliff_* frames
TARGETS["r8c_cliff"] = ([dict(kind="r8_cliff_post", culture="E", opts=dict(variant=v), name=f"terrain_cliff_post_v{v}")
                         for v in range(2)]
                        + [dict(kind="r8_cliff_arm", culture="E", opts=dict(direction=d, variant=v),
                                name=f"terrain_cliff_arm_{d}_v{v}") for d in ("E", "S", "SE", "SW") for v in range(3)])
CAMERA["r8c_cliff"] = proj.OBLIQUE
LOOK["r8c_cliff"] = "r8"
# the rest of the terrain in the same rock (ceo 2026-10-22: terrain production in the approved approach)
TARGETS["r8c_rock"] = [dict(kind="r8_rock", culture="E", opts=dict(variant=v), name=f"terrain_rock_v{v}") for v in range(6)]
CAMERA["r8c_rock"] = proj.OBLIQUE
LOOK["r8c_rock"] = "r8"
TARGETS["r8c_water"] = ([dict(kind="r8_water", culture="E", opts=dict(mask=m), name=f"terrain_water_m{m}") for m in range(1, 16)]
                        + [dict(kind="r8_ford", culture="E", opts=dict(variant=v), name=f"terrain_ford_v{v}") for v in range(2)]
                        + [dict(kind="r8_bridge_deck", culture="E", opts=dict(axis=a), name=f"terrain_bridge_deck_{a}")
                           for a in ("ns", "ew")]
                        + [dict(kind="r8_bridge_rail", culture="E", opts=dict(axis=a), name=f"terrain_bridge_rail_{a}")
                           for a in ("x", "y")])
CAMERA["r8c_water"] = proj.OBLIQUE
LOOK["r8c_water"] = "r8"
# the rest of the buildings in the approved style (ceo 2026-10-22: full production), finished, for the first look
R8_KINDS = ("lumber_camp", "mine", "granary", "range", "mage_hall", "arrow_tower", "stable", "outpost", "siege_works", "farm")
TARGETS["r8d_done"] = [dict(kind=f"r8_{k}", culture=c, state="done", name=f"r8d_{k}_{c}") for c in CULTURES for k in R8_KINDS]
CAMERA["r8d_done"] = proj.OBLIQUE
LOOK["r8d_done"] = "r8"


# art-v6 (D-093, R8 batch 2): every building piece again in the realistic style, named as art-v5's frames (so the
# client's tables stay), plus the siege works (D-099, 砲坊: siege_works_<culture>_<state>); 2x supersampled on CI
def _prod_r8(c):
    kinds = ("main_city", "house", "lumber_camp", "mine", "granary", "barracks", "range", "mage_hall", "arrow_tower",
             "stable", "siege_works")
    out = [dict(kind=f"r8_{k}", culture=c, state=st, name=f"{k}_{c}_{s}") for k in kinds
           for s, st in (("done", "done"), ("build2", "build_a2"), ("build3", "build_a3"), ("damaged", "damaged_a"))]
    for size, k in ((2, "house"), (3, "barracks"), (4, "main_city")):
        out += [dict(kind=f"r8_{k}", culture=c, state="build_a1", name=f"found_{size}x{size}_{c}"),
                dict(kind=f"r8_{k}", culture=c, state="destroyed_a", name=f"rubble_{size}x{size}_{c}")]
    out.append(dict(kind="r8_farm", culture=c, state="build_a1", opts=dict(stage="sown"), name=f"farm_{c}_build1"))
    out += [dict(kind="r8_farm", culture=c, opts=dict(stage=s), name=f"farm_{c}_{s}") for s in ("sown", "growing", "ripe")]
    out += [dict(kind="r8_outpost", culture=c, state=st, name=f"outpost_{c}_{s}")
            for s, st in (("build1", "build_a1"), ("build2", "build_a2"), ("build3", "build_a3"), ("done", "done"),
                          ("damaged", "damaged_a"), ("rubble", "destroyed_a"))]
    return out


# the castles (D-096 pieces, approved; D-100's bigger layouts use the same pieces) in the R8 look, named as art-v5's;
# not the 4-cell stone gate (D-100 has 3-cell gates with piers only) nor the 3 x 3 town tower (the keep replaces it)
R8_CASTLE = [dict(pc, opts=dict(pc["opts"], r8=True)) if pc["kind"] == "tground" else pc
             for pc in _V4 if pc["kind"] not in ("sw_gate_x", "sw_gate_y", "ttower3")]
for _i in range(0, len(R8_CASTLE), 10):
    TARGETS[f"r8w_{_i // 10}"] = R8_CASTLE[_i:_i + 10]
    CAMERA[f"r8w_{_i // 10}"] = proj.OBLIQUE
    LOOK[f"r8w_{_i // 10}"] = "r8"
# art-v6.1 (ceo 2026-10-25: the realistic art live while KEEP is off): what D-089's castles need that art-v6 left out, in
# the R8 look and named as art-v5.2's: the 4-cell stone gates (every look, their front layer) and the big city's 2 x 2 and
# 3 x 3 town towers
R8_V61 = ([pc for pc in _V4 if pc["kind"] in ("sw_gate_x", "sw_gate_y", "ttower3")]
          + [dict(kind="ttower", culture=c, state=st, name=f"town_tower_{c}_{s}")
             for c in CULTURES for s, st in (("done", "intact"), ("damaged", "damaged"), ("rubble", "rubble"))])
for _i in range(0, len(R8_V61), 8):
    TARGETS[f"r8v61_{_i // 8}"] = R8_V61[_i:_i + 8]
    CAMERA[f"r8v61_{_i // 8}"] = proj.OBLIQUE
    LOOK[f"r8v61_{_i // 8}"] = "r8"
# R8-38 (D-101 市場, ceo 2026-10-25): the drafts, two options a culture (design/r8/blender/market_r8.py)
TARGETS["r8m_draft"] = [dict(kind="r8_market", culture=c, opts=dict(option=o), name=f"market_{c}_{o}") for c in CULTURES
                        for o in ("A", "B")]
CAMERA["r8m_draft"] = proj.OBLIQUE
LOOK["r8m_draft"] = "r8"
# R8-38's states (the user 2026-10-25 chose East A 市的一角, West B 市場十字): the market's own build2, build3, damaged;
# the foundation (build1) and the rubble are every 3 x 3 building's (found_3x3_<c>, rubble_3x3_<c>)
MARKET = {"E": "A", "W": "B"}
TARGETS["r8m_states"] = [dict(kind="r8_market", culture=c, state=st, opts=dict(option=MARKET[c]), name=f"market_{c}_{s}")
                         for c in CULTURES for s, st in (("done", "done"), ("build2", "build_a2"), ("build3", "build_a3"),
                                                          ("damaged", "damaged_a"))]
CAMERA["r8m_states"] = proj.OBLIQUE
LOOK["r8m_states"] = "r8"
# art-v6: the finished looks that carry shoot points (shoot_at_<k>, added 2026-10-23 after the r8p run): a later run
# replaces these pieces of the r8p run in the atlas
TARGETS["r8p_marks"] = [pc for _c in CULTURES for pc in _prod_r8(_c) if pc["name"] in
                        (f"main_city_{_c}_done", f"arrow_tower_{_c}_done")]
CAMERA["r8p_marks"] = proj.OBLIQUE
LOOK["r8p_marks"] = "r8"
# R8-36 the inside of the walls, directions B and C (decor_r8.py): the decorative pieces, East
TARGETS["r8x_decor"] = [dict(kind="r8_decor", culture="E", opts=dict(piece=k), name=f"decor_{k}_E")
                        for k in ("hut_a", "hut_b", "shed", "well", "cart", "stack", "tent_a", "tent_b", "rack", "supplies",
                                  "posts", "flag")]
CAMERA["r8x_decor"] = proj.OBLIQUE
LOOK["r8x_decor"] = "r8"
# art-v6 (R8-36 B, the user 2026-10-23): the decorative pieces of a lived-in town, both cultures (castle.DECOR_SIZE)
TARGETS["r8x_prod"] = [dict(kind="r8_decor", culture=c, opts=dict(piece=k), name=f"decor_{k}_{c}") for c in CULTURES
                       for k in ("hut_a", "hut_b", "shed", "stack", "well", "cart")]
CAMERA["r8x_prod"] = proj.OBLIQUE
LOOK["r8x_prod"] = "r8"
# D-100 the keep (keep_r8.py): the drafts for the user first, every state of both cultures
TARGETS["r8k_draft"] = [dict(kind="r8_keep", culture=c, opts=dict(state=st), name=f"keep_{c}_{st}") for c in CULTURES
                        for st in ("done", "damaged", "rubble", "repair")]
CAMERA["r8k_draft"] = proj.OBLIQUE
LOOK["r8k_draft"] = "r8"
# the resource points (nature_r8.py), named as art-v5's PROD_NODES
R8_NODES = ([dict(kind="r8_tree", culture=c, opts=dict(variant=v), name=f"tree_{c}_v{v}") for c in CULTURES for v in (0, 1, 2)]
            + [dict(kind="r8_tree", culture=c, opts=dict(state="stump"), name=f"tree_{c}_stump") for c in CULTURES]
            + [dict(kind=f"r8_{k}", culture="E", opts=dict(variant=v, state=st), name=f"{k}_v{v}_{st}") for k, sts in
               (("gold", ("full", "mined", "depleted")), ("berry", ("full", "depleted")), ("crystal", ("full", "depleted")))
               for v in (0, 1) for st in sts])
for _i in range(0, len(R8_NODES), PROD_CHUNK):
    TARGETS[f"r8n_{_i // PROD_CHUNK}"] = R8_NODES[_i:_i + PROD_CHUNK]
    CAMERA[f"r8n_{_i // PROD_CHUNK}"] = proj.OBLIQUE
    LOOK[f"r8n_{_i // PROD_CHUNK}"] = "r8"
for _c in CULTURES:
    _all = _prod_r8(_c)
    for _i in range(0, len(_all), PROD_CHUNK):
        TARGETS[f"r8p_{_c}_{_i // PROD_CHUNK}"] = _all[_i:_i + PROD_CHUNK]
        CAMERA[f"r8p_{_c}_{_i // PROD_CHUNK}"] = proj.OBLIQUE
        LOOK[f"r8p_{_c}_{_i // PROD_CHUNK}"] = "r8"

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
FOLDER.update({t: "d096" for t in TARGETS if t.startswith("d096")})
FOLDER.update({t: "r650" for t in TARGETS if t.startswith("r650_")})
FOLDER.update({t: "r651" for t in TARGETS if t.startswith("r651_")})


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
        d["passes"] = ["beauty", "mask"] if preview else pc.get("passes", PASSES)
        if preview:
            d["probe"] = pc.get("probe", False)
        pcs.append(d)
    job = dict(px_per_m=ppm * ss, emblem_dir=str(config.BUILD / "emblems"), quality="hq",
               samples={"beauty": 12, "mask": 4, "shadow": 8, "ao": 4} if preview else SAMPLES, pieces=pcs,
               camera=CAMERA.get(target), look=LOOK.get(target), tex_dir=str(R7_TEX))
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
