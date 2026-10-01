"""B1-01: the other twelve buildings (blds.py has the main city, house and barracks).

Small buildings that stand close together (lumber camp, mine, granary, smithy, farm, walls) stay low;
the landmarks (branch city, mage hall, tower, gate) put recognisability first (ceo 2026-10-01).
"""
import math
import random

import lib
from lib import box, cyl, lathe, rod, slab, sphere
import kit
from kit import cells


# ---------------------------------------------------------------- 伐木場

def lumber_camp(root, c):
    P = kit.palette(c)
    W = cells(2)
    kit.pad("lc_pad", P, root, W, W, 0.1, material="earth")
    # an open shed on posts along the back edges (low: eaves 2 m), logs under it
    sx, sy, sw, sd = 0.55, 0.55, 2.7, 2.6
    for x in (sx - sw / 2 + 0.1, sx + sw / 2 - 0.1):
        for y in (sy - sd / 2 + 0.1, sy + sd / 2 - 0.1):
            rod(f"lc_post{x:.1f}{y:.1f}", (x, y, 0.1), (x, y, 2.0), 0.09, P["beam"], parent=root, segs=8)
    if c == "E":
        kit.roof_e("lc_roof", dict(P, tile=P["thatch"]), root, sx, sy, 2.0, sw, sd, 0.85, over=0.35, curl=0.15)
    else:
        kit.roof_w("lc_roof", dict(P, tile=P["thatch"]), root, sx, sy, 2.0, sw, sd, 1.0, over=0.25, ridge="x")
    kit.logs("lc_stack", P, root, (sx + 0.15, sy + 0.2, 0.1), n=10, length=2.3, r=0.16)
    # in front: a log on a sawhorse, a chopping block with an axe, split wood
    for s in (-1, 1):
        rod(f"lc_hl{s}", (-1.2 + s * 0.35, -1.3, 0.1), (-1.2, -1.3, 0.75), 0.04, P["wood"], parent=root, segs=6)
        rod(f"lc_hr{s}", (-0.2 + s * 0.35, -1.3, 0.1), (-0.2, -1.3, 0.75), 0.04, P["wood"], parent=root, segs=6)
    rod("lc_sawlog", (-1.55, -1.3, 0.8), (0.15, -1.3, 0.8), 0.17, P["bark"], parent=root, segs=10)
    cyl("lc_block", 0.3, 0.45, P["logend"], root, loc=(1.0, -1.25, 0.1), segs=12)
    rod("lc_axe", (1.0, -1.25, 0.55), (0.75, -1.4, 1.1), 0.03, P["wood"], parent=root, segs=6)
    box("lc_axehead", (0.06, 0.25, 0.18), P["iron"], root, loc=(1.02, -1.24, 0.6), rot=(0, 30, 0))
    for k in range(5):
        box(f"lc_split{k}", (0.12, 0.45, 0.12), P["logend"], root, loc=(1.35 + (k % 3) * 0.14, -0.7 - (k // 3) * 0.2, 0.16),
            rot=(0, 0, 10 * k))
    kit.awning("lc_aw", P, root, "y", sx - 0.6, 1.75, 1.2, 0.7, y0=sy - sd / 2)
    kit.drape("lc_val", P, root, "x", sy, 1.98, sd - 0.3, 0.75, x0=sx - sw / 2 - 0.02)
    kit.pennant("lc_pen", P, root, (-1.7, -0.4, 0.1), 2.8, w=1.2, fh=0.75)


# ---------------------------------------------------------------- 礦場

def mine(root, c):
    P = kit.palette(c)
    W = cells(2)
    kit.pad("mi_pad", P, root, W, W, 0.1, material="earth")
    # a low stone store at the back right (gold and crystal are kept here)
    bx, by, bw, bd = 0.6, 0.55, 2.4, 2.5
    if c == "E":
        box("mi_plinth", (bw + 0.2, bd + 0.2, 0.25), P["stone"], root, loc=(bx, by, 0.22))
        kit.block_e("mi_store", P, root, bx, by, bw, bd, 0.34, 1.7, door=("y", -0.2, 1.0), windows=False)
        kit.roof_e("mi_roof", P, root, bx, by, 2.04, bw, bd, 0.8, over=0.4, curl=0.25)
    else:
        kit.block_w("mi_store", P, root, bx, by, bw, bd, 0.1, 1.9, door=("y", -0.2, 1.0), windows=False)
        kit.roof_w("mi_roof", P, root, bx, by, 2.0, bw, bd, 0.95, ridge="x")
    kit.drape("mi_dr", P, root, "y", bx - 0.2, 1.7 if c == "E" else 1.75, 1.0, 1.0, y0=by - bd / 2 - 0.05, tails=False)
    kit.drape("mi_drx", P, root, "x", by + 0.3, 1.75, 1.2, 1.05, x0=bx - bw / 2 - 0.08)
    # ore heaps with gold and 魔晶 in front, an ore cart on two rails
    kit.ore_pile("mi_ore", P, root, (-1.15, 0.6, 0.1), r=0.75, gold=8, crystal=4, seed=4)
    kit.ore_pile("mi_ore2", P, root, (-0.9, -0.45, 0.1), r=0.55, gold=6, crystal=0, seed=8)
    for s in (-1, 1):
        rod(f"mi_rail{s}", (-0.2, -1.75, 0.13), (1.6, -1.75 + s * 0.0, 0.13), 0.03, P["iron"], parent=root, segs=6)
    kit.cart("mi_cart", P, root, (0.7, -1.4, 0.1), rot=0, load="ore")
    # a small winch frame (thin) at the front-left corner
    for s in (-1, 1):
        rod(f"mi_frame{s}", (-1.55 + s * 0.35, -1.5, 0.1), (-1.55, -1.5, 2.6), 0.06, P["wood"], parent=root, segs=6)
    cyl("mi_wheel", 0.35, 0.08, P["wood"], root, loc=(-1.55, -1.5, 2.45), rot=(90, 0, 0), at=(0, 0, -0.04), segs=14)
    rod("mi_rope", (-1.55, -1.5, 2.1), (-1.15, 0.2, 0.6), 0.015, P["rope"], parent=root, segs=4, outline=False)
    kit.pennant("mi_pen", P, root, (-1.55, -1.5, 2.6), 0.9, w=1.0, fh=0.6)


# ---------------------------------------------------------------- 糧倉

def granary(root, c):
    P = kit.palette(c)
    W = cells(2)
    kit.pad("gr_pad", P, root, W, W, 0.1, material="earth")
    if c == "E":
        # a granary raised on stilts against the damp, plank walls, a thatch roof
        gx, gy, gw, gd = 0.45, 0.45, 2.6, 2.5
        for x in (gx - gw / 2 + 0.15, gx, gx + gw / 2 - 0.15):
            for y in (gy - gd / 2 + 0.15, gy + gd / 2 - 0.15):
                cyl(f"gr_stilt{x:.1f}{y:.1f}", 0.1, 0.7, P["stone"], root, loc=(x, y, 0.1), segs=8)
        box("gr_floor", (gw + 0.1, gd + 0.1, 0.15), P["wood"], root, loc=(gx, gy, 0.85))
        kit.block_e("gr_body", P, root, gx, gy, gw, gd, 0.9, 1.35, door=("y", 0.4, 0.8), windows=False)
        kit.roof_e("gr_roof", dict(P, tile=P["thatch"]), root, gx, gy, 2.25, gw, gd, 0.95, over=0.45, curl=0.2)
        rod("gr_ladder1", (gx + 0.15, gy - gd / 2 - 0.55, 0.1), (gx + 0.15, gy - gd / 2 - 0.05, 0.95), 0.03, P["wood"],
            parent=root, segs=6)
        rod("gr_ladder2", (gx + 0.65, gy - gd / 2 - 0.55, 0.1), (gx + 0.65, gy - gd / 2 - 0.05, 0.95), 0.03, P["wood"],
            parent=root, segs=6)
        kit.drape("gr_dr", P, root, "x", gy, 2.1, 1.3, 1.0, x0=gx - gw / 2 - 0.06)
        kit.drape("gr_dry", P, root, "y", gx - 0.55, 2.1, 0.95, 0.95, y0=gy - gd / 2 - 0.06)
    else:
        # a timber barn with big doors; a squat round silo at the front-left
        gx, gy, gw, gd = 0.55, 0.5, 2.5, 2.6
        kit.block_w("gr_body", P, root, gx, gy, gw, gd, 0.1, 1.9, timber_from=0.6, door=("y", 0.0, 1.3), windows=False)
        kit.roof_w("gr_roof", P, root, gx, gy, 2.0, gw, gd, 1.1, ridge="y")
        cyl("gr_silo", 0.62, 2.0, P["stone"], root, loc=(-1.15, -1.1, 0.1), segs=18)
        cyl("gr_siloroof", 0.75, 0.8, P["thatch"], root, loc=(-1.15, -1.1, 2.1), r2=0.03, segs=18)
        kit.drape("gr_dr", P, root, "y", gx, 1.85, 1.2, 1.1, y0=gy - gd / 2 - 0.12, tails=False)
    # sacks and baskets of grain in front
    for k, (x, y) in enumerate(((1.0, -1.45), (1.35, -1.3), (1.2, -1.0), (0.65, -1.5))):
        kit.sack(f"gr_sack{k}", P, root, (x, y, 0.1), 0.24)
    for k, (x, y) in enumerate(((-1.5, 0.6), (-1.5, 1.1))):
        cyl(f"gr_basket{k}", 0.25, 0.35, P["straw"], root, loc=(x, y, 0.1), r2=0.3, segs=12)
        sphere(f"gr_grain{k}", 0.22, P["hay"], root, loc=(x, y, 0.42), scale=(1, 1, 0.45))


# ---------------------------------------------------------------- 農田

CROP = {"E": ((0.42, 0.55, 0.2), (0.78, 0.7, 0.3)), "W": ((0.45, 0.58, 0.2), (0.86, 0.72, 0.32))}


def farm(root, c, stage="growing"):
    """A field you can walk over: furrows and crops no higher than 0.6 m, a scarecrow with a
    player-colour scarf (1.6 m, thin). stage: sown, growing, ripe."""
    P = kit.palette(c)
    W = cells(3)
    soil = lib.mat("soil_" + c, (0.42, 0.32, 0.22), 0.95, noise=0.35, noise_scale=8)
    box("fa_soil", (W - 0.3, W - 0.3, 0.06), soil, root, loc=(0, 0, 0.03), outline=False)
    # a low earth bund round the edge (East: paddy-like dykes; West: a turf edge)
    for s in (-1, 1):
        box(f"fa_bx{s}", (W - 0.2, 0.22, 0.14), P["earth"], root, loc=(0, s * (W / 2 - 0.2), 0.07), outline=False)
        box(f"fa_by{s}", (0.22, W - 0.2, 0.14), P["earth"], root, loc=(s * (W / 2 - 0.2), 0, 0.07), outline=False)
    green, gold = CROP[c]
    g = (green[0] + (gold[0] - green[0]) * (stage == "ripe"), green[1] + (gold[1] - green[1]) * (stage == "ripe"),
         green[2] + (gold[2] - green[2]) * (stage == "ripe"))
    cm = lib.mat(f"crop_{c}_{stage}", g, 0.8, noise=0.3, noise_scale=20, sheen=0.3)
    h = {"sown": 0.1, "growing": 0.35, "ripe": 0.55}[stage]
    rnd = random.Random(3)
    rows = 9
    for i in range(rows):
        y = -W / 2 + 0.55 + i * (W - 1.1) / (rows - 1)
        box(f"fa_furrow{i}", (W - 0.7, 0.18, 0.08), soil, root, loc=(0, y, 0.08), outline=False)
        if stage == "sown":
            for k in range(14):
                sphere(f"fa_sprout{i}_{k}", 0.05, cm, root, loc=(-W / 2 + 0.45 + k * (W - 0.9) / 13, y, 0.14),
                       outline=False)
            continue
        for k in range(10):
            x = -W / 2 + 0.5 + k * (W - 1.0) / 9 + rnd.uniform(-0.05, 0.05)
            if c == "E":           # tufts (millet)
                cyl(f"fa_c{i}_{k}", 0.14, h, cm, root, loc=(x, y, 0.1), r2=0.2, segs=7, outline=False)
                if stage == "ripe":
                    sphere(f"fa_h{i}_{k}", 0.08, P["hay"], root, loc=(x + 0.08, y - 0.05, 0.1 + h), outline=False)
            else:                  # wheat: a thicker strip of stalks
                box(f"fa_c{i}_{k}", (0.24, 0.16, h), cm, root, loc=(x, y, 0.1 + h / 2), outline=False)
    # the scarecrow (thin) with the player colour
    sx, sy = -W / 2 + 0.6, -W / 2 + 0.6
    rod("fa_scpost", (sx, sy, 0), (sx, sy, 1.6), 0.04, P["wood"], parent=root, segs=6)
    rod("fa_scarm", (sx - 0.4, sy, 1.25), (sx + 0.4, sy, 1.25), 0.03, P["wood"], parent=root, segs=6)
    sphere("fa_schead", 0.13, P["sack"], root, loc=(sx, sy, 1.62))
    if c == "E":
        cyl("fa_schat", 0.26, 0.12, P["straw"], root, loc=(sx, sy, 1.68), r2=0.02, segs=12)
    slab("fa_scarf", [(-0.4, 0), (0.4, 0), (0.3, -0.55), (-0.3, -0.55)], 0.03, P["team"], parent=root,
         loc=(sx, sy - 0.05, 1.32), plane="XZ")
    for k in range(4):                 # field markers: short stakes with player-colour flags on the front edges
        t = -W / 2 + 1.3 + k * (W - 2.2) / 3
        for side, (x, y) in (("y", (t, -W / 2 + 0.15)), ("x", (-W / 2 + 0.15, t))):
            if abs(x - sx) < 0.6 and abs(y - sy) < 0.6:
                continue
            rod(f"fa_mk{side}{k}", (x, y, 0.0), (x, y, 1.0), 0.03, P["wood"], parent=root, segs=6)
            slab(f"fa_mf{side}{k}", [(0, 0), (0.55, -0.1), (0.5, -0.38), (0, -0.42)], 0.02, P["team"], parent=root,
                 loc=(x + 0.03, y - 0.02, 0.98), rot=(0, 0, -25 if side == "y" else 65), plane="XZ")


# ---------------------------------------------------------------- 射場

def range_(root, c):
    P = kit.palette(c)
    W = cells(3)
    kit.pad("rg_pad", P, root, W, W, 0.12, material="earth")
    # the shooting gallery along the camera-left edge (low), the butts along the far-right edge
    hx, hy, hw, hd = -1.95, 0.0, 1.7, 5.2
    if c == "E":
        for y in (-2.3, -0.8, 0.8, 2.3):
            for x in (hx - 0.65, hx + 0.65):
                cyl(f"rg_post{x:.1f}{y:.1f}", 0.1, 2.1, P["post"], root, loc=(x, y, 0.12), segs=10)
        box("rg_floor", (hw + 0.2, hd + 0.2, 0.22), P["stone"], root, loc=(hx, hy, 0.18))
        box("rg_back", (0.12, hd, 1.6), P["wall"], root, loc=(hx + 0.75, hy, 1.0))
        kit.roof_e("rg_roof", P, root, hx, hy, 2.2, hw, hd, 0.75, over=0.45, curl=0.3, ridge="y")
        kit.drape("rg_dr1", P, root, "x", -1.55, 2.05, 0.9, 1.2, x0=hx - 0.75 - 0.06)
        kit.drape("rg_dr2", P, root, "x", 1.55, 2.05, 0.9, 1.2, x0=hx - 0.75 - 0.06)
    else:
        for y in (-2.3, -0.8, 0.8, 2.3):
            for x in (hx - 0.65, hx + 0.65):
                rod(f"rg_post{x:.1f}{y:.1f}", (x, y, 0.12), (x, y, 2.1), 0.1, P["beam"], parent=root, segs=8)
        box("rg_floor", (hw + 0.2, hd + 0.2, 0.18), P["wood"], root, loc=(hx, hy, 0.16))
        kit.roof_w("rg_roof", dict(P, tile=P["thatch"]), root, hx, hy, 2.1, hw, hd, 0.8, ridge="y", over=0.25)
        kit.drape("rg_dr1", P, root, "x", -1.55, 1.95, 0.9, 1.2, x0=hx - 0.75 - 0.06)
        kit.drape("rg_dr2", P, root, "x", 1.55, 1.95, 0.9, 1.2, x0=hx - 0.75 - 0.06)
    # three butts with painted rings, facing the gallery (and the camera)
    for k, y in enumerate((-1.9, 0.0, 1.9)):
        kit.butt(f"rg_butt{k}", P, root, (2.35, y, 0.12), face="x")
    # straw backstop behind the butts (low), arrows in a rack, a quiver stand
    for k in range(3):
        kit.hay(f"rg_bale{k}", P, root, (2.75, -1.9 + k * 1.9, 0.12), r=0.45)
    for k in range(4):
        rod(f"rg_arrow{k}", (-0.6 + k * 0.08, -2.5, 0.12), (-0.55 + k * 0.08, -2.5, 1.05), 0.012, P["wood"], parent=root,
            segs=4, outline=False)
    cyl("rg_quiver", 0.16, 0.7, P["post"], root, loc=(-0.45, -2.45, 0.12), segs=10)
    kit.flag("rg_flag", P, root, (0.4, -2.6, 0.12), 4.6, c, w=1.0, fh=1.6)


# ---------------------------------------------------------------- 法術營（術院／晶塔）

def mage_hall(root, c):
    P = kit.palette(c)
    W = cells(3)
    kit.pad("mh_pad", P, root, W, W, 0.2)
    glow = lib.mat("crystal_glow", (0.0, 0.5, 0.56), 0.15, emission=0.5)
    if c == "E":
        # 術院: a hall at the back-right (low), and at the front a three-tier pagoda with a 魔晶 finial
        kit.block_e("mh_hall", P, root, 1.0, 1.0, 3.6, 3.0, 0.2, 2.1, door=("y", 0.0, 1.1))
        kit.roof_e("mh_hallr", P, root, 1.0, 1.0, 2.3, 3.6, 3.0, 0.95, over=0.55, curl=0.4)
        px, py = -1.3, -1.3
        box("mh_pbase", (2.6, 2.6, 0.6), P["stone"], root, loc=(px, py, 0.5), bevel=0.04)
        z = 0.8
        for k, (w, h) in enumerate(((2.0, 1.6), (1.6, 1.2), (1.2, 1.0))):
            kit.block_e(f"mh_t{k}", P, root, px, py, w, w, z, h, windows=k == 0, door=("y", 0.0, 0.8) if k == 0 else None)
            kit.roof_e(f"mh_tr{k}", P, root, px, py, z + h, w, w, 0.55 + 0.1 * k, over=0.55, curl=0.45)
            z += h + 0.5
        kit.drape("mh_tdy", P, root, "y", px, 2.2, 1.3, 1.25, y0=py - 1.0 - 0.06)
        kit.drape("mh_tdx", P, root, "x", py, 2.2, 1.3, 1.25, x0=px - 1.0 - 0.06)
        for s_ in (-1, 1):
            kit.drape(f"mh_ban{s_}", P, root, "y", px + s_ * 1.15, 2.35, 0.45, 1.5, y0=py - 1.2)
        rod("mh_spire", (px, py, z), (px, py, z + 0.9), 0.05, P["gold"], parent=root)
        kit.crystals("mh_cr", dict(P, crystal=glow), root, (px, py, z + 0.8), size=0.9, n=6, seed=2)
        # a bronze incense tripod and crystal lanterns in the court
        lathe("mh_tripod", [(0.0, 0.5), (0.35, 0.55), (0.45, 0.9), (0.4, 1.15), (0.3, 1.2)], P["gold"], root,
              loc=(1.3, -1.6, 0.0), segs=16)
        for s in (-1, 1):
            rod(f"mh_tleg{s}", (1.3 + s * 0.3, -1.6, 0.2), (1.3 + s * 0.2, -1.6, 0.6), 0.04, P["gold"], parent=root)
        for k, (x, y) in enumerate(((-0.1, -2.6), (2.6, 0.2))):
            rod(f"mh_lpost{k}", (x, y, 0.2), (x, y, 1.6), 0.05, P["post"], parent=root)
            sphere(f"mh_lamp{k}", 0.17, glow, root, loc=(x, y, 1.7), scale=(1, 1, 1.2))
        kit.drape("mh_dr", P, root, "y", 1.0, 2.0, 1.2, 1.4, y0=1.0 - 1.5 - 0.06)
        kit.drape("mh_drx", P, root, "x", 1.4, 2.0, 1.0, 1.3, x0=1.0 - 1.8 - 0.06)
    else:
        # 晶塔: a slim round tower at the front with a great 魔晶 held in stone arms; a chapter house behind
        kit.block_w("mh_hall", P, root, 1.1, 1.1, 3.4, 3.2, 0.2, 2.2, timber_from=1.1, door=("x", 0.4, 1.0))
        kit.roof_w("mh_hallr", P, root, 1.1, 1.1, 2.4, 3.4, 3.2, 1.25, ridge="x")
        tx, ty = -1.2, -1.2
        cyl("mh_tbase", 1.25, 0.8, P["stone"], root, loc=(tx, ty, 0.2), segs=20)
        lathe("mh_tower", [(1.0, 0.0), (0.92, 2.5), (0.85, 5.0), (0.95, 5.3), (0.95, 5.6)], P["stone"], root,
              loc=(tx, ty, 1.0), segs=20)
        for z in (2.0, 4.0):
            box(f"mh_win{z}", (0.12, 0.12, 0.8), P["dark"], root, loc=(tx - 0.62, ty - 0.66, 1.0 + z), rot=(0, 0, 45),
                outline=False)
        for k in range(4):
            a = math.radians(45 + 90 * k)
            rod(f"mh_arm{k}", (tx + 0.8 * math.cos(a), ty + 0.8 * math.sin(a), 6.5),
                (tx + 0.45 * math.cos(a), ty + 0.45 * math.sin(a), 7.6), 0.12, P["stone"], parent=root)
        kit.crystals("mh_cr", dict(P, crystal=glow), root, (tx, ty, 6.7), size=1.5, n=7, seed=5)
        kit.drape("mh_dr", P, root, "y", tx + 0.0, 5.6, 0.9, 2.4, y0=ty - 0.98)
        kit.drape("mh_drx", P, root, "x", ty + 0.0, 5.6, 0.9, 2.4, x0=tx - 0.98)
        for k, (x, y) in enumerate(((1.4, -1.9), (2.4, -1.0))):
            kit.crystals(f"mh_sm{k}", dict(P, crystal=glow), root, (x, y, 0.2), size=0.5, n=4, seed=10 + k)


# ---------------------------------------------------------------- 箭樓

def tower(root, c):
    P = kit.palette(c)
    W = cells(2)
    kit.pad("to_pad", P, root, W, W, 0.15)
    if c == "E":
        # a timber watchtower on a stone base: an enclosed lookout under a hip roof
        box("to_base", (2.8, 2.8, 1.2), P["stone"], root, loc=(0, 0, 0.75), bevel=0.05, taper=(0.92, 0.92))
        for x in (-1.05, 1.05):
            for y in (-1.05, 1.05):
                rod(f"to_leg{x}{y}", (x, y, 1.35), (x * 0.85, y * 0.85, 5.0), 0.12, P["post"], parent=root, segs=10)
        for z in (2.6, 3.9):
            for k, (p0, p1) in enumerate((((-1.0, -1.0), (1.0, -1.0)), ((-1.0, -1.0), (-1.0, 1.0)))):
                rod(f"to_br{z}{k}", (p0[0], p0[1], z - 1.2), (p1[0], p1[1], z), 0.05, P["beam"], parent=root, segs=6)
        box("to_deck", (2.6, 2.6, 0.2), P["wood"], root, loc=(0, 0, 5.0))
        kit.block_e("to_room", P, root, 0, 0, 2.1, 2.1, 5.1, 1.4, windows=True)
        kit.roof_e("to_roof", P, root, 0, 0, 6.5, 2.1, 2.1, 1.1, over=0.6, curl=0.45)
        box("to_rail", (2.6, 0.08, 0.45), P["post"], root, loc=(0, -1.3, 5.35))
        box("to_railx", (0.08, 2.6, 0.45), P["post"], root, loc=(-1.3, 0, 5.35))
        kit.drape("to_dr", P, root, "y", 0.0, 4.95, 1.4, 1.4, y0=-1.32)
        kit.flag("to_flag", P, root, (0.9, 0.9, 7.4), 1.4, c, w=0.9, fh=1.1)
    else:
        # a round stone tower, crenellated, a conical slate roof over half the top
        cyl("to_body", 1.45, 6.2, P["stone"], root, loc=(0, 0, 0.15), segs=22)
        cyl("to_band", 1.6, 0.3, P["brick"], root, loc=(0, 0, 6.3), segs=22)
        for k in range(10):
            a = 2 * math.pi * k / 10
            box(f"to_mer{k}", (0.45, 0.4, 0.55), P["brick"], root, loc=(1.38 * math.cos(a), 1.38 * math.sin(a), 6.85),
                rot=(0, 0, math.degrees(a)), bevel=0.03)
        cyl("to_cone", 1.0, 1.8, P["tile"], root, loc=(0.2, 0.2, 6.6), r2=0.02, segs=18)
        for z in (2.0, 4.2):
            box(f"to_slit{z}", (0.12, 0.12, 0.75), P["dark"], root, loc=(-1.0, -1.04, z), rot=(0, 0, 45), outline=False)
        box("to_door", (0.85, 0.12, 1.5), P["wood"], root, loc=(0.6, -1.36, 0.9), rot=(0, 0, 25))
        kit.drape("to_dr", P, root, "y", -0.35, 6.2, 1.0, 2.4, y0=-1.5)
        kit.flag("to_flag", P, root, (0.2, 0.2, 8.4), 1.3, c, w=0.9, fh=1.1)


# ---------------------------------------------------------------- 城牆與城門

WALL_H = {"E": 3.0, "W": 3.2}


def wall(root, c, piece="x"):
    """One cell of wall. piece: x (runs along x), y (along y), corner (a square turret that joins
    walls in any two directions, so one picture fits all four corners and the ends)."""
    P = kit.palette(c)
    H = WALL_H[c]
    t = 1.5                                     # wall thickness inside the 2 m cell
    if piece == "corner":
        box("wa_turret", (1.95, 1.95, H + 0.6), P["brick"] if c == "E" else P["stone"], root,
            loc=(0, 0, (H + 0.6) / 2), bevel=0.04, taper=(0.95, 0.95))
        kit.roof_flat_parapet("wa_top", P, root, 0, 0, H + 0.6, 2.05, 2.05, merlon=0.42, gap=0.25, h=0.45, culture=c)
        if c == "E":
            kit.roof_e("wa_troof", P, root, 0, 0, H + 1.1, 1.3, 1.3, 0.7, over=0.35, curl=0.4)
        return
    L = 2.0
    size = (L, t, H) if piece == "x" else (t, L, H)
    box("wa_body", size, P["brick"] if c == "E" else P["stone"], root, loc=(0, 0, H / 2), taper=None)
    box("wa_foot", (size[0] - 0.04, size[1] + 0.2, 0.4) if piece == "x" else (size[0] + 0.2, size[1] - 0.04, 0.4),
        P["stone"], root, loc=(0, 0, 0.2))
    if c == "E":
        box("wa_coping", (L, t + 0.3, 0.14) if piece == "x" else (t + 0.3, L, 0.14), P["tile"], root, loc=(0, 0, H + 0.07))
    n = 2
    for k in range(n):
        o = -L / 2 + L * (k + 0.5) / n
        for s in (-1, 1):
            loc = (o, s * (t / 2 - 0.15), H + 0.3) if piece == "x" else (s * (t / 2 - 0.15), o, H + 0.3)
            box(f"wa_mer{k}{s}", (0.6, 0.3, 0.5) if piece == "x" else (0.3, 0.6, 0.5), P["brick"], root, loc=loc,
                bevel=0.03)


def gate(root, c, piece="x"):
    """A gate four cells long: a gate tower cell at each end and a two-cell passage between them
    (own units pass, sim D-024). The doors stand open, so the passage reads as a way through."""
    P = kit.palette(c)
    H = WALL_H[c]
    along = piece == "x"

    def at(u, v, z=0.0):
        return (u, v, z) if along else (v, u, z)

    def sz(a, b, h):
        return (a, b, h) if along else (b, a, h)

    t = 1.6
    for s in (-1, 1):                                 # the two gate towers
        u = s * 3.0
        box(f"ga_tow{s}", sz(1.95, t + 0.3, H + 1.2), P["brick"] if c == "E" else P["stone"], root,
            loc=at(u, 0, (H + 1.2) / 2), bevel=0.04)
    # the passage: a lintel and a gatehouse over the two middle cells
    box("ga_lintel", sz(4.1, t, 1.0), P["brick"] if c == "E" else P["stone"], root, loc=at(0, 0, H + 0.7))
    if c == "E":
        kit.block_e("ga_house", P, root, *at(0, 0)[:2], *sz(5.6, t + 0.2, 0)[:2], H + 1.2, 1.5, windows=True)
        kit.roof_e("ga_roof", P, root, *at(0, 0)[:2], H + 2.7, *sz(5.6, t + 0.2, 0)[:2], 1.25, over=0.6, curl=0.5,
                   ridge="x" if along else "y")
        box("ga_plaque", sz(1.0, 0.08, 0.45), P["plaque"], root, loc=at(0, -t / 2 - 0.12, H + 0.75))
    else:
        kit.roof_flat_parapet("ga_top", P, root, *at(0, 0)[:2], H + 1.2, *sz(7.9, t + 0.3, 0)[:2], merlon=0.5, gap=0.4)
        for s in (-1, 1):
            cyl(f"ga_cone{s}", 1.05, 1.6, P["tile"], root, loc=at(s * 3.0, 0, H + 1.4), r2=0.02, segs=16)
        rod("ga_portc", at(-1.9, -t / 2 - 0.05, H + 0.15), at(1.9, -t / 2 - 0.05, H + 0.15), 0.08, P["iron"], parent=root)
    # the open doors, swung back against the passage sides
    for s in (-1, 1):
        box(f"ga_door{s}", sz(0.12, 1.4, H - 0.3), P["post"] if c == "E" else P["wood"], root,
            loc=at(s * 1.85, -t / 2 + 0.75, (H - 0.3) / 2))
    # player colour: long banners on the outer faces of both towers
    for s in (-1, 1):
        if along:
            kit.drape(f"ga_ban{s}", P, root, "y", s * 3.0, H + 0.9, 1.1, 2.6, y0=-(t + 0.3) / 2 - 0.03)
        else:
            kit.drape(f"ga_ban{s}", P, root, "x", s * 3.0, H + 0.9, 1.1, 2.6, x0=-(t + 0.3) / 2 - 0.03)


# ---------------------------------------------------------------- 分城

def branch_city(root, c):
    P = kit.palette(c)
    W = cells(3)
    kit.pad("bc_pad", P, root, W, W, 0.2)
    if c == "E":
        box("bc_plat", (4.4, 3.8, 0.7), P["stone"], root, loc=(-0.4, -0.5, 0.55), bevel=0.05)
        for i in range(4):
            box(f"bc_step{i}", (1.4, 0.32, 0.18), P["stone"], root, loc=(-0.4, -2.55 - 0.3 * (3 - i), 0.29 + 0.17 * i))
        kit.block_e("bc_hall", P, root, -0.4, -0.5, 3.6, 2.6, 0.9, 2.4, door=("y", 0.0, 1.2))
        kit.roof_e("bc_roof", P, root, -0.4, -0.5, 3.3, 3.6, 2.6, 1.5, over=0.8, curl=0.5)
        box("bc_plaque", (0.9, 0.08, 0.4), P["plaque"], root, loc=(-0.4, -1.86, 2.95))
        # a low store along the back edge, sacks and crates (it keeps every resource)
        kit.block_e("bc_store", P, root, 1.9, 1.6, 1.8, 2.4, 0.2, 1.8, windows=False)
        kit.roof_e("bc_storer", P, root, 1.9, 1.6, 2.0, 1.8, 2.4, 0.7, over=0.35, curl=0.25)
        kit.flag("bc_flag", P, root, (-2.6, -2.6, 0.2), 5.6, c, w=1.1, fh=2.0)
        kit.drape("bc_dr", P, root, "y", 0.9, 0.85, 1.1, 0.6, y0=-0.5 - 1.9 - 0.06, tails=False)
        kit.drape("bc_drx", P, root, "x", -0.5, 0.85, 1.8, 0.6, x0=-0.4 - 2.2 - 0.06, tails=False)
        for s in (-1, 1):
            kit.lantern(f"bc_lan{s}", P, root, (-0.4 + s * 1.3, -1.9, 3.15))
    else:
        # a fortified manor: a square stone tower at the front-left, a hall, a low wall
        kit.block_w("bc_hall", P, root, 0.7, 0.6, 3.6, 3.0, 0.2, 2.4, timber_from=1.2, door=("y", 0.6, 1.1))
        kit.roof_w("bc_roof", P, root, 0.7, 0.6, 2.6, 3.6, 3.0, 1.45, ridge="x")
        kit.block_w("bc_tow", P, root, -1.6, -1.6, 2.2, 2.2, 0.2, 5.0, door=None, windows=True)
        kit.roof_flat_parapet("bc_towtop", P, root, -1.6, -1.6, 5.2, 2.4, 2.4, merlon=0.45, gap=0.35)
        kit.drape("bc_ban", P, root, "y", -1.6, 4.8, 1.2, 2.4, y0=-1.6 - 1.12 - 0.04)
        kit.drape("bc_banx", P, root, "x", -1.6, 4.8, 1.2, 2.4, x0=-1.6 - 1.12 - 0.04)
        kit.flag("bc_flag", P, root, (-1.6, -1.6, 5.6), 1.8, c, w=1.0, fh=1.4)
    for k, (x, y) in enumerate(((1.8, -1.9), (2.3, -1.4), (2.3, -2.2))):
        kit.crate(f"bc_cr{k}", P, root, (x, y, 0.2), 0.55, rot=10 * k)
    kit.sack("bc_sk", P, root, (1.3, -2.3, 0.2), 0.25)
    kit.barrel("bc_br", P, root, (2.6, -0.6, 0.2), r=0.25, h=0.65)


# ---------------------------------------------------------------- 鐵匠鋪

def smithy(root, c):
    P = kit.palette(c)
    W = cells(2)
    kit.pad("sm_pad", P, root, W, W, 0.12, material="earth")
    coals = lib.mat("coals", (1.0, 0.38, 0.1), 0.5, emission=5.0)
    # an open-fronted forge shed (low), the forge and its chimney on the camera-left side
    sx, sy, sw, sd = 0.45, 0.55, 2.8, 2.5
    if c == "E":
        kit.block_e("sm_shed", P, root, sx, sy + 0.5, sw, 1.4, 0.12, 2.0, windows=False)
        kit.roof_e("sm_roof", P, root, sx, sy, 2.12, sw, sd, 0.85, over=0.45, curl=0.3)
        for x in (sx - sw / 2 + 0.1, sx + sw / 2 - 0.1):
            cyl(f"sm_post{x:.1f}", 0.11, 2.0, P["post"], root, loc=(x, sy - sd / 2 + 0.1, 0.12), segs=10)
    else:
        kit.block_w("sm_shed", P, root, sx, sy + 0.5, sw, 1.4, 0.12, 2.0, windows=False, quoins=False)
        kit.roof_w("sm_roof", P, root, sx, sy, 2.12, sw, sd, 0.95, ridge="x")
        for x in (sx - sw / 2 + 0.1, sx + sw / 2 - 0.1):
            rod(f"sm_post{x:.1f}", (x, sy - sd / 2 + 0.1, 0.12), (x, sy - sd / 2 + 0.1, 2.1), 0.1, P["beam"], parent=root)
    box("sm_forge", (1.0, 0.9, 0.85), P["brick"] if c == "E" else P["stone"], root, loc=(-0.65, 0.35, 0.55), bevel=0.04)
    box("sm_coals", (0.7, 0.6, 0.06), coals, root, loc=(-0.65, 0.35, 1.0), outline=False)
    kit.chimney("sm_chim", dict(P, stone=P["brick"]) if c == "E" else P, root, (-1.15, 0.85, 0.12), 3.6, 0.55)
    kit.anvil("sm_anvil", P, root, (0.35, -0.75))
    kit.barrel("sm_quench", P, root, (1.25, -0.95, 0.12), r=0.28, h=0.6)
    # a rack of finished blades and a hanging sign
    box("sm_rack", (0.9, 0.12, 0.08), P["wood"], root, loc=(1.6, -1.5, 1.1))
    for k in range(4):
        rod(f"sm_blade{k}", (1.25 + k * 0.22, -1.52, 0.2), (1.25 + k * 0.22, -1.52, 1.25), 0.025, P["iron"], parent=root,
            segs=4)
    kit.awning("sm_aw", P, root, "y", 0.75, 1.85, 2.3, 0.85, y0=sy - sd / 2)
    kit.drape("sm_ban", P, root, "y", sx + sw / 2 - 0.35, 1.75, 0.55, 1.3, y0=sy - sd / 2 - 0.02)
    kit.pennant("sm_pen", P, root, (-1.65, -1.65, 0.12), 2.8, w=1.2, fh=0.75)


# ---------------------------------------------------------------- 馬廄

def stable(root, c):
    P = kit.palette(c)
    W = cells(3)
    kit.pad("st_pad", P, root, W, W, 0.12, material="earth")
    # a long low stable along the back edge with a row of stall doors facing the camera, a paddock in front
    bx, by, bw, bd = 0.3, 1.7, 5.2, 2.2
    if c == "E":
        kit.block_e("st_body", P, root, bx, by, bw, bd, 0.12, 2.0, windows=False)
        kit.roof_e("st_roof", P, root, bx, by, 2.12, bw, bd, 0.95, over=0.55, curl=0.3)
    else:
        kit.block_w("st_body", P, root, bx, by, bw, bd, 0.12, 2.0, timber_from=0.9, windows=False, quoins=False)
        kit.roof_w("st_roof", dict(P, tile=P["thatch"]), root, bx, by, 2.12, bw, bd, 1.05, ridge="x")
    for k in range(4):                                # half doors (stalls)
        x = bx - bw / 2 + 0.65 + k * 1.3
        box(f"st_stall{k}", (0.9, 0.08, 1.0), P["wood"], root, loc=(x, by - bd / 2 - 0.06, 0.62))
        box(f"st_dark{k}", (0.85, 0.06, 0.8), P["dark"], root, loc=(x, by - bd / 2 - 0.02, 1.5), outline=False)
        rod(f"st_xbr{k}", (x - 0.4, by - bd / 2 - 0.11, 0.2), (x + 0.4, by - bd / 2 - 0.11, 1.05), 0.03, P["beam"],
            parent=root, segs=4)
    kit.drape("st_dr1", P, root, "y", bx - 1.95, 2.05, 0.9, 0.9, y0=by - bd / 2 - 0.08, tails=False)
    kit.drape("st_dr2", P, root, "y", bx + 1.95, 2.05, 0.9, 0.9, y0=by - bd / 2 - 0.08, tails=False)
    # the paddock: a low rail fence, a trough, hay, a saddle on the rail
    kit.fence("st_f1", P, root, (-2.8, -2.8), (2.8, -2.8), h=0.9)
    kit.fence("st_f2", P, root, (-2.8, -2.8), (-2.8, 0.4), h=0.9)
    box("st_trough", (1.4, 0.45, 0.45), P["wood"], root, loc=(-1.4, -1.3, 0.35))
    box("st_water", (1.3, 0.35, 0.03), lib.mat("water", (0.18, 0.3, 0.36), 0.15), root, loc=(-1.4, -1.3, 0.56),
        outline=False)
    for k, (x, y) in enumerate(((1.6, -0.6), (2.2, -0.2), (1.9, -1.2))):
        kit.hay(f"st_hay{k}", P, root, (x, y, 0.12), r=0.45)
    box("st_saddle", (0.5, 0.35, 0.2), P["post"], root, loc=(0.4, -2.8, 1.0), bevel=0.05)
    slab("st_saddlecl", [(-0.3, 0), (0.3, 0), (0.25, -0.45), (-0.25, -0.45)], 0.03, P["team"], parent=root,
         loc=(0.4, -2.86, 0.95), plane="XZ")
    kit.flag("st_flag", P, root, (-2.6, 0.9, 0.12), 4.4, c, w=1.0, fh=1.5)


# ---------------------------------------------------------------- 砲坊

def workshop(root, c):
    P = kit.palette(c)
    W = cells(3)
    kit.pad("ws_pad", P, root, W, W, 0.12, material="earth")
    # a big shed along the back-right with wide doors, a half-built engine in the yard, a crane
    bx, by, bw, bd = 1.3, 1.1, 3.0, 3.4
    if c == "E":
        kit.block_e("ws_shed", P, root, bx, by, bw, bd, 0.12, 2.6, door=("x", 0.0, 2.2), windows=False)
        kit.roof_e("ws_roof", P, root, bx, by, 2.72, bw, bd, 1.0, over=0.55, curl=0.3, ridge="y")
    else:
        kit.block_w("ws_shed", P, root, bx, by, bw, bd, 0.12, 2.6, timber_from=1.2, door=("x", 0.0, 2.2), windows=False)
        kit.roof_w("ws_roof", P, root, bx, by, 2.72, bw, bd, 1.2, ridge="y")
    kit.drape("ws_dr", P, root, "y", bx, 2.55, 1.6, 1.3, y0=by - bd / 2 - 0.08)
    # the half-built engine: a frame on four wheels and a throwing arm not yet fitted
    ex, ey = -1.3, -0.9
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(f"ws_wheel{sx}{sy}", 0.42, 0.14, P["wood"], root, loc=(ex + sx * 0.8, ey + sy * 0.7, 0.42), rot=(90, 0, 0),
                at=(0, 0, -0.07), segs=16)
    box("ws_frame", (2.0, 1.3, 0.2), P["wood"], root, loc=(ex, ey, 0.75))
    for s in (-1, 1):
        rod(f"ws_up{s}", (ex, ey + s * 0.55, 0.85), (ex + 0.2, ey + s * 0.35, 2.0), 0.08, P["wood"], parent=root)
    rod("ws_arm", (ex - 1.2, ey + 1.2, 0.15), (ex + 0.9, ey + 1.0, 0.6), 0.09, P["wood"], parent=root)
    # the crane: an A-frame with a hoisted beam (thin)
    for s in (-1, 1):
        rod(f"ws_crane{s}", (-2.6 + s * 0.4, -2.6, 0.12), (-2.4, -2.2, 4.2), 0.07, P["beam"], parent=root)
    rod("ws_jib", (-2.4, -2.2, 4.1), (-1.4, -1.0, 3.7), 0.06, P["beam"], parent=root)
    rod("ws_line", (-1.4, -1.0, 3.7), (-1.4, -1.0, 2.2), 0.015, P["rope"], parent=root, segs=4, outline=False)
    rod("ws_load", (-1.9, -1.0, 2.15), (-0.9, -1.0, 2.15), 0.1, P["wood"], parent=root)
    kit.logs("ws_timber", P, root, (1.2, -2.3, 0.12), n=6, length=2.2, r=0.13)
    kit.flag("ws_flag", P, root, (-0.1, -2.7, 0.12), 4.2, c, w=1.0, fh=1.5)


BUILDERS = {"lumber_camp": lumber_camp, "mine": mine, "granary": granary, "farm": farm, "range": range_,
            "mage_hall": mage_hall, "tower": tower, "wall": wall, "gate": gate, "branch_city": branch_city,
            "smithy": smithy, "stable": stable, "workshop": workshop}
