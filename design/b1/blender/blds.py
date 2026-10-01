"""B1 buildings: one builder per building, each for both cultures ("E" 東陸, "W" 西陸).

builder(root, culture) builds under `root` with the footprint centred on the origin (kit.py
conventions). FOOTPRINT gives the cells (sim/src/core/rules.ts; the six new ones are the B1
proposal ceo accepted as working values on 2026-10-01).

Height rule (ceo 2026-10-01): the small buildings that stand close together (house, lumber camp,
mine, granary, smithy, farm, walls) are kept low so the units behind them still show; the
landmarks (main city, branch city, mage hall, tower, gate) put recognisability first. Tall parts go
on the camera side (-x, -y) where they hide the least ("前高後低").
"""
import math
import random

import lib
from lib import box, cyl, lathe, rod, slab, sphere
import kit
from kit import cells

FOOTPRINT = {
    "main_city": (4, 4), "house": (2, 2), "lumber_camp": (2, 2), "mine": (2, 2), "granary": (2, 2),
    "farm": (3, 3), "barracks": (3, 3), "range": (3, 3), "mage_hall": (3, 3),
    "tower": (2, 2), "wall": (1, 1), "gate": (4, 1), "branch_city": (3, 3), "smithy": (2, 2),
    "stable": (3, 3), "workshop": (3, 3),
}
NAMES = {
    "main_city": "主城", "house": "民居", "lumber_camp": "伐木場", "mine": "礦場", "granary": "糧倉",
    "farm": "農田", "barracks": "兵營", "range": "射場", "mage_hall": ("術院", "晶塔"),
    "tower": "箭樓", "wall": "城牆", "gate": "城門", "branch_city": "分城", "smithy": "鐵匠鋪",
    "stable": "馬廄", "workshop": "砲坊",
}


def name_of(kind, culture):
    n = NAMES[kind]
    return n if isinstance(n, str) else n[0 if culture == "E" else 1]


# ---------------------------------------------------------------- 主城

def main_city(root, c):
    P = kit.palette(c)
    W = cells(4)
    kit.pad("mc_pad", P, root, W, W, 0.2)
    if c == "E":
        # low back courtyard wall with a tile coping (the back stays low)
        for k, (p0, p1) in enumerate((((3.6, -3.6), (3.6, 3.6)), ((-3.6, 3.6), (3.6, 3.6)))):
            L = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
            cx, cy = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2
            along_x = abs(p1[0] - p0[0]) > 0.1
            box(f"mc_cw{k}", (L, 0.4, 1.5) if along_x else (0.4, L, 1.5), P["wall"], root, loc=(cx, cy, 0.95))
            box(f"mc_cwc{k}", (L + 0.3, 0.7, 0.18) if along_x else (0.7, L + 0.3, 0.18), P["tile"], root,
                loc=(cx, cy, 1.78))
        # two low side halls along the back edges
        kit.block_e("mc_side1", P, root, 2.1, 2.2, 2.4, 2.0, 0.2, 2.0, windows=True)
        kit.roof_e("mc_side1r", P, root, 2.1, 2.2, 2.2, 2.4, 2.0, 0.8, over=0.45, curl=0.3)
        # the main hall on a high stone platform, two roofs (重簷), toward the front
        hx, hy = -0.4, -0.9
        box("mc_plat", (6.2, 4.6, 1.0), P["stone"], root, loc=(hx, hy, 0.7), bevel=0.05)
        box("mc_platcap", (6.4, 4.8, 0.14), P["pave"], root, loc=(hx, hy, 1.24))
        for i in range(5):          # front steps (-y)
            box(f"mc_step{i}", (1.8, 0.36, 0.2), P["stone"], root, loc=(hx, hy - 2.48 - 0.32 * (4 - i), 0.3 + 0.2 * i))
        for s in (-1, 1):           # carved balustrade along the platform front
            box(f"mc_bal{s}", (2.0, 0.12, 0.45), P["stone"], root, loc=(hx + s * 2.0, hy - 2.3, 1.55))
        kit.block_e("mc_hall", P, root, hx, hy, 4.8, 3.0, 1.3, 2.6, door=("y", 0.0, 1.3))
        kit.roof_e("mc_roof1", P, root, hx, hy, 3.9, 4.8, 3.0, 0.75, over=0.9, curl=0.45)
        kit.block_e("mc_hall2", P, root, hx, hy, 3.4, 1.8, 4.3, 1.2, windows=True)
        kit.roof_e("mc_roof2", P, root, hx, hy, 5.5, 3.4, 1.8, 1.35, over=0.85, curl=0.55)
        box("mc_plaque", (1.2, 0.08, 0.5), P["plaque"], root, loc=(hx, hy - 1.6, 3.55), bevel=0.02)
        box("mc_plaque_rim", (1.3, 0.06, 0.6), P["gold"], root, loc=(hx, hy - 1.58, 3.55))
        for s in (-1, 1):
            kit.lantern(f"mc_lan{s}", P, root, (hx + s * 1.7, hy - 1.95, 3.5))
        # player colour: two tall hanging banners either side of the steps and drapes on the platform
        kit.flag("mc_flagL", P, root, (hx - 2.9, hy - 2.6, 0.2), 6.6, c, w=1.2, fh=2.4)
        kit.flag("mc_flagR", P, root, (hx + 2.2, hy - 2.6, 0.2), 6.6, c, w=1.2, fh=2.4)
        kit.drape("mc_drY", P, root, "y", hx + 1.9, 1.15, 1.3, 0.85, y0=hy - 2.35, tails=False)
        kit.drape("mc_drY2", P, root, "y", hx - 1.9, 1.15, 1.3, 0.85, y0=hy - 2.35, tails=False)
        kit.drape("mc_drX", P, root, "x", hy, 1.15, 2.6, 0.85, x0=hx - 3.15, tails=False)
        # bronze cauldron and a stone lion pair in front
        for s in (-1, 1):
            box(f"mc_lionb{s}", (0.5, 0.5, 0.35), P["stone"], root, loc=(hx + s * 1.4, hy - 3.55, 0.37))
            sphere(f"mc_lion{s}", 0.28, P["stone"], root, loc=(hx + s * 1.4, hy - 3.55, 0.8), scale=(0.8, 1, 1.1))
    else:
        # curtain wall along the back edges (low, crenellated)
        for k, (cx, cy, sx, sy) in enumerate(((3.55, 0.6, 0.6, 6.6), (0.6, 3.55, 6.6, 0.6))):
            box(f"mc_cw{k}", (sx, sy, 2.0), P["stone"], root, loc=(cx, cy, 1.2), bevel=0.04)
            n = 6
            for i in range(n):
                t = -3.0 + 6.6 * (i + 0.5) / n + 0.3
                loc = (cx, t, 2.45) if k == 0 else (t, cy, 2.45)
                box(f"mc_cwm{k}{i}", (0.5, 0.5, 0.5), P["brick"], root, loc=loc, bevel=0.03)
        # the great hall behind the keep (lower), slate gable roof, ridge along y
        kit.block_w("mc_hallw", P, root, 1.7, 1.2, 3.0, 4.6, 0.2, 2.6, timber_from=1.4, door=None)
        kit.roof_w("mc_hallwr", P, root, 1.7, 1.2, 2.8, 3.0, 4.6, 1.5, ridge="y", gable="wall")
        # the keep toward the front, crenellated
        kx, ky = -1.1, -1.1
        kit.block_w("mc_keep", P, root, kx, ky, 4.4, 4.4, 0.2, 6.2, door=("y", -0.6, 1.4), windows=True)
        box("mc_keepband", (4.7, 4.7, 0.3), P["brick"], root, loc=(kx, ky, 6.55), bevel=0.04)
        kit.roof_flat_parapet("mc_keeptop", P, root, kx, ky, 6.7, 4.7, 4.7)
        # round corner turret at the front corner, conical slate roof
        tx, ty = kx - 2.1, ky - 2.1
        cyl("mc_tur", 0.95, 8.2, P["stone"], root, loc=(tx, ty, 0.2), segs=20)
        cyl("mc_turband", 1.08, 0.3, P["brick"], root, loc=(tx, ty, 8.3), segs=20)
        cyl("mc_turroof", 1.25, 2.4, P["tile"], root, loc=(tx, ty, 8.6), r2=0.02, segs=20)
        for z in (2.6, 5.0):
            box(f"mc_tslit{z}", (0.12, 0.12, 0.7), P["dark"], root, loc=(tx - 0.62, ty - 0.68, z), rot=(0, 0, 45),
                outline=False)
        # player colour: two great banners down the keep's camera faces, a flag on the turret
        kit.drape("mc_banY", P, root, "y", kx + 1.1, 6.1, 1.5, 3.2, y0=ky - 2.32)
        kit.drape("mc_banX", P, root, "x", ky + 1.0, 6.1, 1.5, 3.2, x0=kx - 2.32)
        kit.flag("mc_flag", P, root, (tx, ty, 10.9), 1.9, c, w=1.1, fh=1.5)
        # forecourt: a well and crates
        kit.crate("mc_cr1", P, root, (2.6, -3.0, 0.2))
        kit.barrel("mc_br1", P, root, (3.2, -2.9, 0.2))


# ---------------------------------------------------------------- 民居

def house(root, c):
    P = kit.palette(c)
    W = cells(2)
    kit.pad("ho_pad", P, root, W, W, 0.12, material="earth")
    if c == "E":
        box("ho_plinth", (3.2, 2.7, 0.3), P["stone"], root, loc=(0.1, 0.25, 0.27), bevel=0.04)
        kit.block_e("ho_body", P, root, 0.1, 0.25, 2.9, 2.4, 0.42, 1.95, door=("y", -0.5, 1.0))
        kit.roof_e("ho_roof", P, root, 0.1, 0.25, 2.37, 2.9, 2.4, 1.0, over=0.5, curl=0.3)
        kit.drape("ho_cur", P, root, "y", -0.5, 2.15, 1.05, 1.15, y0=0.25 - 1.2, tails=False)
        kit.drape("ho_curx", P, root, "x", 0.6, 2.15, 0.9, 0.9, x0=0.1 - 1.45 - 0.06)
        for k, (x, y) in enumerate(((-1.55, -1.45), (-1.25, -1.6))):     # water jars
            lathe(f"ho_jar{k}", [(0.18, 0), (0.26, 0.2), (0.22, 0.45), (0.14, 0.5)], P["brick"], root, loc=(x, y, 0.12),
                  segs=12)
        kit.logs("ho_fw", P, root, (1.2, -1.45, 0.12), n=3, length=0.9, r=0.1)
    else:
        kit.block_w("ho_body", P, root, 0.15, 0.2, 2.8, 2.6, 0.12, 2.1, timber_from=0.9, door=("y", 0.4, 0.9))
        kit.roof_w("ho_roof", P, root, 0.15, 0.2, 2.22, 2.8, 2.6, 1.15, ridge="x")
        kit.chimney("ho_chim", P, root, (-1.0, -0.2, 2.6), 1.35, 0.45)
        kit.drape("ho_cur", P, root, "y", 0.4, 1.95, 0.95, 1.25, y0=0.2 - 1.3 - 0.08, tails=False)
        kit.drape("ho_curx", P, root, "x", 0.3, 1.95, 1.0, 0.75, x0=0.15 - 1.4 - 0.1)
        for k in range(3):          # a flower box under the window
            sphere(f"ho_fl{k}", 0.12, lib.mat("flower_w", (0.75, 0.35, 0.5), 0.8), root,
                   loc=(-0.7 + k * 0.22, 0.2 - 1.42, 1.25))
        kit.barrel("ho_br", P, root, (-1.55, -1.5, 0.12), r=0.24, h=0.6)
        kit.logs("ho_fw", P, root, (1.25, -1.45, 0.12), n=3, length=0.9, r=0.1)


# ---------------------------------------------------------------- 兵營

def barracks(root, c):
    P = kit.palette(c)
    W = cells(3)
    kit.pad("ba_pad", P, root, W, W, 0.14, material="earth")
    # the hall along the camera-left edge (-x); the training yard on the right, low, so the back stays open
    hx, hy, hw, hd = -1.65, 0.0, 2.5, 5.4
    if c == "E":
        box("ba_plinth", (hw + 0.3, hd + 0.3, 0.35), P["stone"], root, loc=(hx, hy, 0.3), bevel=0.04)
        kit.block_e("ba_hall", P, root, hx, hy, hw, hd, 0.47, 2.3, door=("x", -1.0, 1.2))
        kit.roof_e("ba_roof", P, root, hx, hy, 2.77, hw, hd, 1.15, over=0.6, curl=0.35, ridge="y")
        kit.drape("ba_drx1", P, root, "x", 1.0, 2.55, 1.1, 1.6, x0=hx - hw / 2 - 0.06)
        kit.drape("ba_drx2", P, root, "x", -2.3, 2.55, 0.9, 1.4, x0=hx - hw / 2 - 0.06)
        kit.drape("ba_dry", P, root, "y", hx, 2.55, 1.2, 1.5, y0=hy - hd / 2 - 0.06)
        kit.lantern("ba_lan", P, root, (hx - 1.5, -1.9, 2.6))
        # drum on a stand at the yard's front
        cyl("ba_drum", 0.45, 0.5, P["post"], root, loc=(0.4, -2.2, 1.0), rot=(90, 0, 45), at=(0, 0, -0.25), segs=16)
        for s in (-1, 1):
            rod(f"ba_drumleg{s}", (0.4 + s * 0.35, -2.2 - s * 0.35, 0.14), (0.4, -2.2, 1.0), 0.05, P["beam"], parent=root)
    else:
        kit.block_w("ba_hall", P, root, hx, hy, hw, hd, 0.14, 2.4, timber_from=1.2, door=("x", -1.0, 1.2))
        kit.roof_w("ba_roof", P, root, hx, hy, 2.54, hw, hd, 1.25, ridge="y")
        kit.drape("ba_drx1", P, root, "x", 1.0, 2.35, 1.1, 1.5, x0=hx - hw / 2 - 0.12)
        kit.drape("ba_drx2", P, root, "x", -2.3, 2.35, 0.9, 1.3, x0=hx - hw / 2 - 0.12)
        kit.drape("ba_dry", P, root, "y", hx, 3.6, 1.0, 1.6, y0=hy - hd / 2 - 0.12)
        # a rack of round shields on the yard side
        for k in range(3):
            cyl(f"ba_shield{k}", 0.38, 0.06, P["team"] if k == 1 else P["wood"], root,
                loc=(0.2 + k * 0.85, -2.45, 0.85), rot=(90, 0, 0), segs=18)
            sphere(f"ba_boss{k}", 0.08, P["iron"], root, loc=(0.2 + k * 0.85, -2.5, 0.85))
        rod("ba_srack", (-0.2, -2.4, 0.5), (2.3, -2.4, 0.5), 0.05, P["wood"], parent=root)
    # the yard: a low fence along the two back edges, weapon racks, straw dummies, the banner pole
    kit.fence("ba_fx", P, root, (2.85, -2.8), (2.85, 2.85), h=0.85)
    kit.fence("ba_fy", P, root, (-0.3, 2.85), (2.85, 2.85), h=0.85)
    kit.weapon_rack("ba_rack1", P, root, (1.6, 2.3, 0.14), axis="x")
    kit.weapon_rack("ba_rack2", P, root, (2.35, 0.6, 0.14), axis="y")
    kit.dummy("ba_dum1", P, root, (0.6, 0.6))
    kit.dummy("ba_dum2", P, root, (1.5, -0.6))
    kit.flag("ba_flag", P, root, (-0.1, -2.6, 0.14), 5.2, c, w=1.1, fh=1.9)


BUILDERS = {"main_city": main_city, "house": house, "barracks": barracks}

import blds2  # noqa: E402  (the other twelve)

BUILDERS.update(blds2.BUILDERS)
