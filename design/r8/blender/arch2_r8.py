"""R8 batch 2 (D-093): the rest of the buildings in the approved realistic style (R8-21, R8-22; arch_r8.py's helpers),
East late Tang, West c.1250, after research/east-arch-reference and west-arch-reference (notes.md, 八、每棟遊戲建築的建議
and 十四、每棟遊戲建築). Every building's front faces the camera (-y); the footprints are the sim's; the owner's colour
on flags, pennants and hangings (at least 5 % of the picture, ceo 2026-10-02).

  r8_lumber_camp  伐木場 2x2   E: an open shed and a log yard           W: a lean-to shed, sawhorses, a log pile
  r8_mine         礦場   2x2   E: a pit under a windlass frame (梯盤)   W: a shaft house over a windlass, an adit
  r8_granary      糧倉   2x2   E: a storehouse raised on piers          W: a small tithe barn, its porch to the camera
  r8_range        射場   3x3   E: an open archery hall, an earth butt    W: an open shed, two butts
  r8_mage_hall    術院／晶塔 3x3  E: a Daoist hall, an incense burner   W: an octagonal chapter house, a crystal lantern
  r8_arrow_tower  箭樓   2x2   E: a battered earth base, a timber room  W: a round stone tower, a timber hoarding
  r8_stable       馬廄   3x3   E: a long low shed, troughs, hay          W: a long low shed, a wattle paddock
  r8_outpost      哨所   2x2   E: a low earth platform, a shelter, a drum W: a mound, a watchtower, a palisade
  r8_siege_works  砲坊   3x3   E: an open shed, a half-built 單梢砲     W: an open shed, a trebuchet's base frame
  r8_farm         農田   3x3   E: rice paddies (stage: sown, growing, ripe)  W: wheat strips
"""
import math
import random

import lib
from lib import box, cyl, rod, slab, sphere
import kit
from arch_r8 import (CELL, palette as _palette, platform_e, hall_e, tang_roof, war_drum, rammed_wall_e, gable_roof_w,
                     gable_fill_w, timber_wall_w, lancet_w, stone_block_w, prism, surface)


def palette(c):
    """arch_r8's, with the props' colours toned down for the realistic light (the cartoon set's straw and canvas were
    near white) and rock that is rock (kit's mapped to a brick texture)."""
    P = _palette(c)
    m = lib.mat
    P.update(
        hay=m("hay", (0.36, 0.3, 0.15), 0.9),
        straw=m("straw", (0.42, 0.35, 0.18), 0.9),
        sack=m("sack", (0.38, 0.32, 0.22), 0.95),
        canvas=m("canvas", (0.45, 0.42, 0.35), 0.9),
        logend=m("logend", (0.42, 0.31, 0.19), 0.85),
        bark=m("bark", (0.12, 0.09, 0.06), 0.9),
        target=m("target", (0.5, 0.45, 0.33), 0.9),
        rock=m("cliffrockdark", (0.2, 0.17, 0.14), 0.92),
        rope=m("rope", (0.32, 0.26, 0.16), 0.9),
        water=m("water_still", (0.02, 0.04, 0.045), 0.08),
    )
    return P


def _log(name, P, parent, a, b, r):
    """A log from a to b: bark round it, cut ends."""
    rod(name, a, b, r, P["bark"], parent=parent, segs=10)
    for k, p in enumerate((a, b)):
        sphere(f"{name}_e{k}", r * 0.98, P["logend"], parent, loc=p, scale=(1, 1, 1), segs=10, rings=6)


def _log_pile(name, P, parent, x, y, n_rows=3, length=2.0, r=0.14, axis="x", seed=1):
    rnd = random.Random(seed)
    for row in range(n_rows):
        k = n_rows - row + 1
        for i in range(k):
            off = (i - (k - 1) / 2) * r * 2.05
            z = r + row * r * 1.75
            jitter = rnd.uniform(-0.12, 0.12)
            if axis == "x":
                a, b = (x - length / 2 + jitter, y + off, z), (x + length / 2 + jitter, y + off, z)
            else:
                a, b = (x + off, y - length / 2 + jitter, z), (x + off, y + length / 2 + jitter, z)
            _log(f"{name}{row}_{i}", P, parent, a, b, r * rnd.uniform(0.85, 1.1))


def _posts(name, P, parent, pts, h, r=0.09, mat="wood"):
    for k, (x, y) in enumerate(pts):
        cyl(f"{name}{k}", r, h, P[mat], parent, loc=(x, y, 0.0), r2=r * 0.9, segs=10)


def _shed_roof_w(name, P, parent, x0, x1, y_front, y_back, z_front, z_back, mat="tile", thick=0.1):
    """A single slope (lean-to) from the front eave down to the back (West sheds): `mat` slates, thatch or shingles."""
    def fn(u, v):
        return (x0 + (x1 - x0) * u, y_front + (y_back - y_front) * v, z_front + (z_back - z_front) * v)
    ob = surface(name, P[mat], parent, max(8, int((x1 - x0) / 0.3)), 8, fn, thick)
    g = lib.empty(name + "_tag", parent=parent, loc=((x0 + x1) / 2, (y_front + y_back) / 2, min(z_front, z_back)))
    g["roof"] = [(x0 + x1) / 2, (y_front + y_back) / 2, min(z_front, z_back), x1 - x0, abs(y_back - y_front),
                 abs(z_front - z_back), 0.2, 0]
    return ob


def _shed_e(name, P, parent, cx, cy, w, d, h, rise, mat_post="wood", tile=True):
    """An open shed (清明上河圖's roadside sheds, east ref 15): posts, a lintel, a small 懸山 roof."""
    xs = [cx - w / 2, cx + w / 2]
    ys = [cy - d / 2, cy + d / 2]
    pts = [(x, y) for x in xs for y in ys]
    if w > 3.5:
        pts += [(cx, y) for y in ys]
    _posts(name + "_p", P, parent, pts, h, r=0.1, mat=mat_post)
    for y in ys:
        box(f"{name}_lin{y:.1f}", (w + 0.2, 0.16, 0.2), P["timber"], parent, loc=(cx, y, h - 0.1))
    g = lib.empty(name + "_blk", parent=parent, loc=(cx, cy, 0.0))
    g["block"] = [cx, cy, w, d, 0.0, h]
    if tile:
        tang_roof(name + "_roof", P, parent, cx, cy, h, w + 0.1, d + 0.1, rise, 0.45, kind="xuanshan", lift=0.0,
                  chiwei=False, tile_amp=0.025, tile_pitch=0.24)
    else:
        g2, _ = gable_roof_w(name + "_roof", P, parent, cx, cy, h, w, d, 30, 0.4, "thatch", thick=0.25, round_eave=True)


# ---------------------------------------------------------------- 伐木場 lumber camp (2x2)

def lumber_camp(root, c):
    P = palette(c)
    kit.pad("lc_ground", P, root, 2 * CELL, 2 * CELL, h=0.06, material="earth")
    if c == "E":
        # an open shed at the back (east ref 15), a yard of stacked logs, a sawhorse with a log on it, a chopping block
        _shed_e("lc_shed", P, root, 0.0, 0.85, 3.0, 1.5, 2.2, 0.6)
        _log_pile("lc_logs", P, root, -0.55, -0.9, n_rows=3, length=2.2, r=0.13, seed=3)
        for sx in (-1, 1):                            # the sawhorse (two crossed trestles), a log across it
            for e in (-1, 1):
                rod(f"lc_tr{sx}{e}", (1.25 + sx * 0.35, -0.95 + e * 0.25, 0.0), (1.25 + sx * 0.35, -0.95 - e * 0.25, 0.8),
                    0.035, P["wood"], parent=root, segs=6)
        _log("lc_saw_log", P, root, (0.7, -0.95, 0.72), (1.8, -0.95, 0.72), 0.12)
        cyl("lc_block", 0.25, 0.45, P["logend"], root, loc=(1.35, 0.05, 0.0), segs=12)
        rod("lc_axe", (1.35, 0.05, 0.45), (1.55, -0.1, 0.95), 0.025, P["wood"], parent=root, segs=6)
        box("lc_axehead", (0.16, 0.04, 0.1), P["iron"], root, loc=(1.36, 0.04, 0.48))
        kit.logs("lc_inshed", P, root, (0.0, 0.95, 0.0), n=5, length=2.4, r=0.12)
        kit.drape("lc_hang", P, root, "y", 0.0, 2.05, 0.9, 0.85, y0=0.85 - 0.76)
        kit.pennant("lc_pen", P, root, (-1.75, -1.6, 0.0), 3.4, w=0.8, fh=0.5)
    else:
        # a lean-to against a back wall, open at the front (west ref 15, 14): planks stood against the wall, a bench of
        # two sawhorses and a thick plank, an axe in a stump, a log pile
        box("lc_back", (3.4, 0.25, 2.3), P["stone"], root, loc=(0, 1.65, 1.15), bevel=0.02)
        _posts("lc_p", P, root, [(-1.6, 0.25), (0.0, 0.25), (1.6, 0.25)], 2.3, r=0.1, mat="timber")
        box("lc_plate", (3.4, 0.18, 0.18), P["timber"], root, loc=(0, 0.25, 2.25))
        _shed_roof_w("lc_roof", P, root, -1.85, 1.85, -0.05, 1.95, 2.5, 1.9, mat="tile")
        for k in range(6):
            box(f"lc_plank{k}", (0.24, 0.05, 2.0), P["wood"], root, loc=(-1.3 + k * 0.28, 1.45, 1.0), rot=(-12, 0, 0))
        for sx in (-1, 1):
            for e in (-1, 1):
                rod(f"lc_tr{sx}{e}", (0.9 + sx * 0.5, -0.8 + e * 0.22, 0.0), (0.9 + sx * 0.5, -0.8 - e * 0.22, 0.75),
                    0.035, P["wood"], parent=root, segs=6)
        box("lc_bench", (1.4, 0.32, 0.08), P["wood"], root, loc=(0.9, -0.8, 0.78))
        cyl("lc_stump", 0.26, 0.5, P["logend"], root, loc=(-0.2, -0.6, 0.0), segs=12)
        rod("lc_axe", (-0.2, -0.6, 0.5), (0.0, -0.75, 1.0), 0.025, P["wood"], parent=root, segs=6)
        _log_pile("lc_logs", P, root, -1.15, -1.05, n_rows=2, length=1.6, r=0.14, axis="x", seed=5)
        kit.drape("lc_hang", P, root, "y", 0.8, 2.2, 0.9, 0.9, y0=0.15)
        kit.pennant("lc_pen", P, root, (1.75, -1.6, 0.0), 3.4, w=0.8, fh=0.5)


# ---------------------------------------------------------------- 礦場 mine (2x2)

def _pit(name, P, parent, x, y, w, d, depth=0.6):
    """A pit's mouth: a timber kerb round a dark hole going down."""
    box(name + "_hole", (w, d, 0.05), P["dark"], parent, loc=(x, y, 0.02))
    for k, (sx, sy, L, ax) in enumerate(((0, -1, w + 0.3, "x"), (0, 1, w + 0.3, "x"), (-1, 0, d, "y"), (1, 0, d, "y"))):
        size = (L, 0.2, 0.2) if ax == "x" else (0.2, L, 0.2)
        box(f"{name}_kerb{k}", size, P["timber"], parent, loc=(x + sx * (w / 2 + 0.1), y + sy * (d / 2 + 0.1), 0.1))


def mine(root, c):
    P = palette(c)
    kit.pad("mn_ground", P, root, 2 * CELL, 2 * CELL, h=0.06, material="earth")
    if c == "E":
        # a pit under a 梯盤 windlass frame (east ref 18): four posts, the top frame, a roller with two cranks, a rope
        # down to a bamboo basket; baskets, an ore heap; a small work shed behind
        _shed_e("mn_shed", P, root, -0.6, 1.25, 2.4, 1.0, 1.9, 0.45)
        _pit("mn_pit", P, root, 0.35, -0.2, 1.1, 1.0)
        for sx in (-1, 1):
            for sy in (-1, 1):
                rod(f"mn_post{sx}{sy}", (0.35 + sx * 0.7, -0.2 + sy * 0.65, 0.0), (0.35 + sx * 0.62, -0.2 + sy * 0.58, 2.3),
                    0.07, P["timber"], parent=root, segs=8)
        for sy in (-1, 1):
            box(f"mn_top{sy}", (1.45, 0.14, 0.14), P["timber"], root, loc=(0.35, -0.2 + sy * 0.58, 2.3))
        cyl("mn_roller", 0.12, 1.5, P["wood"], root, loc=(-0.4, -0.2, 2.42), rot=(0, 90, 0), segs=12)
        for sx in (-1, 1):
            rod(f"mn_crank{sx}", (0.35 + sx * 0.78, -0.2, 2.42), (0.35 + sx * 0.78, -0.55, 2.15), 0.03, P["wood"], parent=root,
                segs=6)
        rod("mn_rope", (0.35, -0.2, 2.3), (0.35, -0.2, 1.0), 0.015, P["rope"], parent=root, segs=5)
        cyl("mn_basket", 0.22, 0.32, P["straw"], root, loc=(0.35, -0.2, 0.68), r2=0.26, segs=12)
        for k, (x, y) in enumerate(((-1.25, -0.55), (-1.0, -1.15))):
            cyl(f"mn_bk{k}", 0.2, 0.3, P["straw"], root, loc=(x, y, 0.0), r2=0.24, segs=12)
        kit.ore_pile("mn_ore", P, root, (1.25, -1.15, 0.0), r=0.55, gold=5)
        kit.flag("mn_flag", P, root, (-1.6, 0.35, 0.0), 3.6, c, w=0.8, fh=1.0)
        kit.drape("mn_hang", P, root, "y", -0.6, 1.75, 0.8, 0.8, y0=1.25 - 0.56)
    else:
        # a shaft house: a small gable shed on posts over the windlass (west ref 17), an adit framed in timber into a
        # mound at the back, a grey waste heap, a cart of ore
        import terrain_r8                             # the hillock in the approved rock (R8-26)
        terrain_r8._mass("mn_hill", root, terrain_r8.mats(), random.Random(31), cx=0.0, cy=1.35, radius=(1.2, 1.55), H=1.6,
                         nk=7, round_top=0.35, taper=0.3, cap=0.25, tilt=0.15)
        for ob in kit.parts_under(root):              # ground, there before the building: never cut while it is built
            if ob.name.startswith("mn_hill"):
                ob["no_cut"] = True
        box("mn_adit", (0.9, 0.3, 1.3), P["dark"], root, loc=(-0.9, 0.5, 0.65))
        for sx in (-1, 1):
            box(f"mn_adp{sx}", (0.16, 0.2, 1.45), P["timber"], root, loc=(-0.9 + sx * 0.5, 0.42, 0.72))
        box("mn_adl", (1.25, 0.22, 0.18), P["timber"], root, loc=(-0.9, 0.42, 1.48))
        _pit("mn_pit", P, root, 0.6, -0.35, 0.9, 0.9)
        _posts("mn_sp", P, root, [(0.6 + sx * 0.65, -0.35 + sy * 0.6) for sx in (-1, 1) for sy in (-1, 1)], 1.9, r=0.08,
               mat="timber")
        cyl("mn_roller", 0.12, 1.3, P["wood"], root, loc=(-0.05, -0.35, 1.25), rot=(0, 90, 0), segs=12)
        rod("mn_crank", (1.3, -0.35, 1.25), (1.3, -0.7, 1.0), 0.03, P["wood"], parent=root, segs=6)
        rod("mn_rope", (0.6, -0.35, 1.25), (0.6, -0.35, 0.5), 0.015, P["rope"], parent=root, segs=5)
        g, rise = gable_roof_w("mn_roof", P, root, 0.6, -0.35, 1.9, 1.4, 1.3, 50, 0.25, "tile", thick=0.08)
        kit.cart("mn_cart", P, root, (-1.0, -1.05, 0.0), rot=10, load="ore")
        kit.ore_pile("mn_waste", P, root, (1.35, 0.75, 0.0), r=0.5, gold=0)
        kit.flag("mn_flag", P, root, (1.65, -1.5, 0.0), 3.4, c, w=0.8, fh=1.0)
        kit.drape("mn_hang", P, root, "y", 0.6, 1.85, 0.7, 0.75, y0=-0.35 - 0.68)


# ---------------------------------------------------------------- 糧倉 granary (2x2)

def granary(root, c):
    P = palette(c)
    if c == "E":
        # a storehouse raised on stone piers (east ref 19's shape, Tang roof and colours): a plank floor, plaster
        # walls with small square vents, a 懸山 tile roof; sacks, a 斗 measure, a ladder up to the door
        kit.pad("gr_pave", P, root, 2 * CELL, 2 * CELL, h=0.08, material="earth")
        for sx in (-1, 0, 1):
            for sy in (-1, 1):
                box(f"gr_pier{sx}{sy}", (0.3, 0.3, 0.7), P["stone"], root, loc=(sx * 1.1, 0.5 + sy * 0.75, 0.35), bevel=0.03)
        box("gr_floor", (2.8, 2.0, 0.16), P["wood"], root, loc=(0, 0.5, 0.78))
        w, d, top = hall_e("gr_hall", P, root, 0, 0.5, 0.86, (0.9, 0.9, 0.9), (1.7,), 1.9, 0.1, 0.0, front_door=True)
        for k, x in enumerate((-0.9, 0.9)):           # the vents: small square holes high on the front
            box(f"gr_vent{k}", (0.22, 0.06, 0.22), P["dark"], root, loc=(x, 0.5 - 0.88, 2.25))
        tang_roof("gr_roof", P, root, 0, 0.5, 0.86 + top, w + 0.2, d + 0.2, 0.82, 0.5, kind="xuanshan", lift=0.0, chiwei=False,
                  tile_amp=0.028)
        for k in range(2):                            # the ladder up to the door
            rod(f"gr_ladder{k}", (-0.25 + k * 0.5, -0.75, 0.0), (-0.25 + k * 0.5, -0.4, 0.86), 0.025, P["wood"], parent=root,
                segs=5)
        for k in range(4):
            box(f"gr_rung{k}", (0.5, 0.04, 0.04), P["wood"], root, loc=(0.0, -0.72 + k * 0.09, 0.15 + k * 0.2))
        for k, (x, y) in enumerate(((1.25, -1.15), (1.55, -0.95), (1.4, -0.7), (-1.4, -1.2))):
            kit.sack(f"gr_sack{k}", P, root, (x, y, 0.08), s=0.32, rot=k * 35)
        box("gr_dou", (0.36, 0.36, 0.28), P["wood"], root, loc=(-1.0, -1.25, 0.22), taper=(1.0, 1.25))
        kit.pennant("gr_pen", P, root, (1.7, 1.6, 0.0), 3.6, w=0.8, fh=0.5)
        kit.drape("gr_hang", P, root, "y", 0.9, 2.55, 0.5, 0.9, y0=0.5 - 0.95)
    else:
        # a small tithe barn (west ref 11, 12): low stone walls, a huge steep roof, a porch facing the camera with big
        # doors, buttresses, slit vents
        kit.pad("gr_pave", P, root, 2 * CELL, 2 * CELL, h=0.08, material="earth")
        stone_block_w("gr_body", P, root, 0, 0.45, 3.2, 2.6, 0.08, 1.7, buttress=0)
        for sx in (-1, 1):
            box(f"gr_bt{sx}", (0.35, 0.45, 1.4), P["stone"], root, loc=(sx * 1.6, 0.45 - 1.3 - 0.15, 0.78), bevel=0.03,
                taper=(1.0, 0.5))
        for k, x in enumerate((-0.95, 0.95)):
            box(f"gr_slit{k}", (0.1, 0.06, 0.6), P["dark"], root, loc=(x, 0.45 - 1.32, 1.1))
        g, rise = gable_roof_w("gr_roof", P, root, 0, 0.45, 1.78, 3.2, 2.6, 55, 0.35, "tile", thick=0.1)
        gable_fill_w("gr_gf", P, root, 0, 0.45, 1.78, 3.2, 2.6, rise, ridge="x", mat="stone", timber=False)
        # the porch: a gabled bay sticking out of the front, its own small roof, the big doors in it
        stone_block_w("gr_porch", P, root, 0.0, -1.15, 1.3, 0.8, 0.08, 1.7)
        box("gr_doors", (0.9, 0.08, 1.45), P["wood"], root, loc=(0.0, -1.57, 0.08 + 0.72))
        g2, r2 = gable_roof_w("gr_proof", P, root, 0.0, -1.15, 1.78, 1.3, 0.8, 55, 0.2, "tile", thick=0.08, ridge="y")
        gable_fill_w("gr_pgf", P, root, 0.0, -1.15, 1.78, 1.3, 0.8, r2, ridge="y", mat="stone", timber=False)
        for k, (x, y) in enumerate(((1.4, -1.5), (1.65, -1.3), (-1.45, -1.55))):
            kit.sack(f"gr_sack{k}", P, root, (x, y, 0.08), s=0.32, rot=k * 40)
        kit.pennant("gr_pen", P, root, (-1.75, 1.65, 0.0), 3.8, w=0.8, fh=0.5)
        kit.drape("gr_hang", P, root, "y", -0.9, 1.6, 0.55, 0.95, y0=0.45 - 1.34)


# ---------------------------------------------------------------- 射場 range (3x3)

def _target(name, P, parent, x, y, z, r=0.42):
    """A straw target face toward the camera: rings painted on it."""
    cyl(name, r, 0.16, P["straw"], parent, loc=(x, y + 0.08, z), rot=(90, 0, 0), segs=24)
    for k, (rr, m) in enumerate(((0.75, "target"), (0.5, "red"), (0.25, "target"))):
        cyl(f"{name}_r{k}", r * rr, 0.01, P[m], parent, loc=(x, y - 0.005 - 0.002 * k, z), rot=(90, 0, 0), segs=24)


def range_(root, c):
    P = palette(c)
    kit.pad("rg_ground", P, root, 3 * CELL, 3 * CELL, h=0.06, material="earth")
    if c == "E":
        # 射堂: a three-bay hall open on three sides on a low platform at the back-left, its 歇山 roof; the shooting lane
        # across the front to an earth butt (土垛) with a target at the right; a bow rack, arrows in a pot
        platform_e("rg_plat", P, root, 3.8, 2.4, 0.35, cy=1.55, steps=1.0)
        w, d, top = hall_e("rg_hall", P, root, -0.6, 1.55, 0.35, (1.0, 1.2, 1.0), (1.8,), 2.4, 0.12, 0.35, walls=False)
        box("rg_backwall", (w, 0.2, 2.0), P["plaster"], root, loc=(-0.6, 1.55 + 0.9, 0.35 + 1.0))
        tang_roof("rg_roof", P, root, -0.6, 1.55, 0.35 + top, w + 0.3, d + 0.3, 0.95, 0.65, kind="xieshan", lift=0.05,
                  chiwei=False, gable_v=0.55)
        box("rg_butt", (1.6, 1.0, 1.3), P["earth"], root, loc=(1.9, -1.0, 0.65), taper=(0.85, 0.7), bevel=0.15)
        _target("rg_tgt", P, root, 1.9, -1.55, 0.85)
        rack = lib.empty("rg_rack", parent=root, loc=(-2.0, -1.4, 0.06))
        for sx in (-1, 1):
            box(f"rg_rk{sx}", (0.08, 0.08, 1.4), P["wood"], rack, loc=(sx * 0.55, 0, 0.7))
        box("rg_rkbar", (1.2, 0.08, 0.08), P["wood"], rack, loc=(0, 0, 1.3))
        for k in range(4):
            rod(f"rg_bow{k}", (-0.4 + k * 0.27, -0.05, 0.25), (-0.4 + k * 0.27 + 0.05, -0.05, 1.3), 0.02, P["timber"], parent=rack,
                segs=5)
        cyl("rg_pot", 0.17, 0.5, P["brick"], root, loc=(-0.9, -1.45, 0.06), r2=0.13, segs=12)
        for k in range(6):
            rod(f"rg_arrow{k}", (-0.9, -1.45, 0.3), (-0.9 + 0.08 * math.cos(k), -1.45 + 0.08 * math.sin(k), 1.05), 0.008,
                P["wood"], parent=root, segs=4)
        kit.flag("rg_flag", P, root, (0.65, -2.4, 0.06), 4.6, c, w=1.2, fh=1.7)
        kit.drape("rg_hang", P, root, "y", -0.6, 0.35 + 2.3, 0.7, 1.0, y0=1.55 - 0.95)
    else:
        # an open timber shed (bows, arrows, targets in store) at the back, two earth butts with targets in front
        # (west ref: the Luttrell Psalter's butts, units research 10)
        box("rg_back", (4.4, 0.25, 2.3), P["plaster"], root, loc=(-0.4, 2.2, 1.15))
        timber_wall_w("rg_bw", P, root, -2.6, 1.8, 2.05, 0.0, 2.3, posts=5, face=-1)
        _posts("rg_p", P, root, [(-2.6, 0.8), (-0.4, 0.8), (1.8, 0.8)], 2.3, r=0.11, mat="timber")
        box("rg_plate", (4.5, 0.18, 0.18), P["timber"], root, loc=(-0.4, 0.8, 2.25))
        _shed_roof_w("rg_roof", P, root, -2.85, 2.05, 0.45, 2.55, 2.7, 2.1, mat="thatch", thick=0.25)
        for k, x in enumerate((-1.6, 1.4)):
            box(f"rg_butt{k}", (1.1, 0.8, 1.1), P["earth"], root, loc=(x, -1.6, 0.55), taper=(0.8, 0.7), bevel=0.15)
            _target(f"rg_tgt{k}", P, root, x, -2.02, 0.65, r=0.35)
        kit.weapon_rack("rg_rack", P, root, (-1.4, 1.5, 0.0), axis="x", n=4, east=False)
        kit.barrel("rg_barrel", P, root, (1.0, 1.4, 0.0))
        kit.flag("rg_flag", P, root, (2.5, -0.4, 0.06), 4.6, c, w=1.2, fh=1.7)
        kit.drape("rg_hang", P, root, "y", -0.4, 2.15, 1.0, 1.1, y0=0.75)


# ---------------------------------------------------------------- 術院 / 晶塔 mage hall (3x3)

def _incense_burner(name, P, parent, x, y):
    """香爐: a bronze cauldron (鼎) on three legs, a lid, a thin smoke."""
    for k in range(3):
        a = 2 * math.pi * k / 3 + 0.3
        rod(f"{name}_leg{k}", (x + 0.3 * math.cos(a), y + 0.3 * math.sin(a), 0.0), (x + 0.22 * math.cos(a), y + 0.22 * math.sin(a), 0.4),
            0.04, P["bronze"], parent=parent, segs=6)
    cyl(name + "_body", 0.36, 0.5, P["bronze"], parent, loc=(x, y, 0.35), r2=0.42, segs=18)
    cyl(name + "_lid", 0.4, 0.16, P["bronze"], parent, loc=(x, y, 0.85), r2=0.12, segs=18)
    for e in (-1, 1):
        box(f"{name}_ear{e}", (0.06, 0.18, 0.2), P["bronze"], parent, loc=(x + e * 0.4, y, 0.92))


def mage_hall(root, c):
    P = palette(c)
    P["bronze"] = lib.mat("bronze", (0.32, 0.22, 0.12), 0.45, 1.0)
    if c == "E":
        # 術院 as a Daoist temple (道觀; east refs 03, 04, 06): a three-bay 歇山 hall with 鴟尾 on a high platform, an
        # incense burner in the court, two 幡竿 poles with long banners in the owner's colour
        kit.pad("mh_pave", P, root, 3 * CELL, 3 * CELL, h=0.1, material="pave")
        platform_e("mh_plat", P, root, 4.8, 3.2, 0.9, cy=1.0, steps=1.6)
        w, d, top = hall_e("mh_hall", P, root, 0, 1.0, 0.9, (1.15, 1.5, 1.15), (2.2,), 2.5, 0.16, 0.85, qizhu=True)
        tang_roof("mh_roof", P, root, 0, 1.0, 0.9 + top, w + 0.4, d + 0.4, 1.25, 0.95, kind="xieshan", lift=0.06, chiwei=True,
                  chiwei_s=0.85, tile_pitch=0.27)
        _incense_burner("mh_ding", P, root, 0.0, -1.85)
        for sx in (-1, 1):                            # 幡竿: tall poles, a long narrow banner hanging from a cross-arm
            cyl(f"mh_pole{sx}", 0.06, 6.2, P["red"], root, loc=(sx * 2.25, -2.0, 0.1), segs=10)
            box(f"mh_arm{sx}", (0.9, 0.06, 0.06), P["red"], root, loc=(sx * 2.25 - sx * 0.35, -2.0, 6.0))
            kit.drape(f"mh_ban{sx}", P, root, "y", sx * 2.25 - sx * 0.55, 5.95, 0.45, 2.6, y0=-2.05, tails=True)
        kit.drape("mh_hang", P, root, "y", 0.0, 0.9 + 2.35, 1.1, 1.0, y0=1.0 - 1.25)
    else:
        # 晶塔: an octagonal chapter house in pale ashlar (west refs 18, 19), a tall lancet in each face, a high conical
        # roof, an open lantern on top holding the crystal; the owner's banners at the door
        kit.pad("mh_pave", P, root, 3 * CELL, 3 * CELL, h=0.1, material="pave")
        R, H = 2.0, 4.2
        g = lib.empty("mh_body", parent=root, loc=(0, 0.45, 0.1))
        g["block"] = [0, 0.45, 2 * R, 2 * R, 0.1, H]
        ashlar = lib.mat("ashlar", (0.55, 0.52, 0.45), 0.85)
        cyl("mh_oct", R, H, ashlar, g, loc=(0, 0, 0), segs=8, rot=(0, 0, 22.5), smooth=False)
        cyl("mh_plinth", R * 1.08, 0.45, ashlar, g, loc=(0, 0, 0), segs=8, rot=(0, 0, 22.5), smooth=False)
        for k in range(8):                            # a buttress at each corner, a lancet in each face
            a = math.radians(22.5 + 45 * k)
            box(f"mh_bt{k}", (0.35, 0.5, H * 0.85), ashlar, g, loc=(R * 1.02 * math.cos(a), R * 1.02 * math.sin(a), H * 0.42),
                rot=(0, 0, math.degrees(a) + 90), taper=(1.0, 0.6))
        for k, x in enumerate((-1.05, 0.0, 1.05)):     # the three faces toward the camera: tall lancets
            lancet_w(f"mh_l{k}", P, root, x * 0.95, 0.45 - R * 0.93 + abs(x) * 0.42, 1.2, 0.42, 2.2)
        box("mh_door", (0.9, 0.12, 1.7), P["wood"], root, loc=(0.0, 0.45 - R * 0.93 - 0.05, 0.1 + 0.85))
        cyl("mh_cone", R * 1.18, 3.4, P["tile"], root, loc=(0, 0.45, 0.1 + H), r2=0.35, segs=8, rot=(0, 0, 22.5))
        # the lantern: four slender posts, a little pointed cap, the crystal inside glowing
        zl = 0.1 + H + 3.2
        for k in range(4):
            a = math.radians(45 + 90 * k)
            cyl(f"mh_lp{k}", 0.05, 1.0, ashlar, root, loc=(0.33 * math.cos(a), 0.45 + 0.33 * math.sin(a), zl), segs=6)
        cyl("mh_lcap", 0.48, 0.9, P["tile"], root, loc=(0, 0.45, zl + 1.0), r2=0.0, segs=8, rot=(0, 0, 22.5))
        kit.crystals("mh_crystal", P, root, (0, 0.45, zl + 0.05), size=0.55, n=5, seed=4)
        for sx in (-1, 1):
            kit.flag(f"mh_flag{sx}", P, root, (sx * 1.6, -2.3, 0.1), 4.4, c, w=1.0, fh=1.5)
        kit.drape("mh_hang", P, root, "y", 0.0, 3.4, 1.0, 1.2, y0=0.45 - R * 0.93 - 0.12)


# ---------------------------------------------------------------- 箭樓 arrow tower (2x2)

def arrow_tower(root, c):
    P = palette(c)
    if c == "E":
        # 闕樓-like (east refs 08, 14, 20): a battered rammed-earth base with a brick skin at its foot, a timber room on
        # it with a balcony (平坐) and railings, board walls with arrow slits, a 歇山 roof
        kit.pad("at_ground", P, root, 2 * CELL, 2 * CELL, h=0.06, material="earth")
        bh = 3.0
        box("at_base", (3.2, 3.2, bh), P["earth"], root, loc=(0, 0.1, bh / 2), taper=(0.78, 0.78), bevel=0.05)
        box("at_foot", (3.3, 3.3, 0.5), P["brick"], root, loc=(0, 0.1, 0.25), bevel=0.02)
        box("at_deck", (2.9, 2.9, 0.18), P["wood"], root, loc=(0, 0.1, bh + 0.09))
        for k in range(12):                            # the balcony railing round the deck
            t = -1.35 + k * 2.7 / 11
            for sx, sy in ((t, -1.4), (t, 1.6), (-1.35, t + 0.1), (1.35, t + 0.1)):
                cyl(f"at_bal{k}{sx:.1f}{sy:.1f}", 0.035, 0.75, P["red"], root, loc=(sx, sy, bh + 0.18), segs=6)
        for nm, size, loc in (("f", (2.8, 0.08, 0.08), (0, -1.4, bh + 0.9)), ("b", (2.8, 0.08, 0.08), (0, 1.6, bh + 0.9)),
                              ("l", (0.08, 3.0, 0.08), (-1.35, 0.1, bh + 0.9)), ("r", (0.08, 3.0, 0.08), (1.35, 0.1, bh + 0.9))):
            box(f"at_rail{nm}", size, P["red"], root, loc=loc)
        w, d, top = hall_e("at_room", P, root, 0, 0.1, bh + 0.18, (1.9,), (1.9,), 1.9, 0.1, 0.3, walls=False)
        for k, (size, loc) in enumerate((((1.9, 0.1, 1.7), (0, 0.1 - 0.95, bh + 0.18 + 0.85)), ((1.9, 0.1, 1.7), (0, 1.05, bh + 1.03)),
                                         ((0.1, 1.9, 1.7), (-0.95, 0.1, bh + 1.03)), ((0.1, 1.9, 1.7), (0.95, 0.1, bh + 1.03)))):
            box(f"at_board{k}", size, P["wood"], root, loc=loc)
        for k, x in enumerate((-0.5, 0.0, 0.5)):
            box(f"at_slit{k}", (0.08, 0.06, 0.6), P["dark"], root, loc=(x, 0.1 - 1.0, bh + 1.15))
        for k, (x, y) in enumerate(((0.0, 0.1 - 1.3), (-1.2, 0.1), (1.2, 0.1), (0.0, 1.4))):   # the room's slits all round
            lib.empty(f"shoot_at_{k}", parent=root, loc=(x, y, bh + 1.2))
        tang_roof("at_roof", P, root, 0, 0.1, bh + 0.18 + top, w + 0.3, d + 0.3, 0.95, 0.6, kind="xieshan", lift=0.06,
                  chiwei=False)
        kit.drape("at_hang", P, root, "y", 0.0, bh + 0.95, 1.6, 1.1, y0=-1.45)
        kit.flag("at_flag", P, root, (1.25, 1.45, bh + 0.18), 3.2, c, w=0.9, fh=1.1)
    else:
        # a round stone tower of three storeys (west refs 20, 06): arrow slits, a timber hoarding (a covered gallery)
        # round the top for the archers, a conical slate roof
        kit.pad("at_ground", P, root, 2 * CELL, 2 * CELL, h=0.06, material="earth")
        R, H = 1.45, 4.8
        g = lib.empty("at_body", parent=root, loc=(0, 0.1, 0.06))
        g["block"] = [0, 0.1, 2 * R, 2 * R, 0.06, H]
        cyl("at_round", R, H, P["stone"], g, loc=(0, 0, 0), r2=R * 0.92, segs=28)
        cyl("at_batter", R * 1.15, 1.0, P["stone"], g, loc=(0, 0, 0), r2=R * 0.98, segs=28)
        for k, z in enumerate((1.6, 3.2)):           # string courses between the storeys
            cyl(f"at_course{k}", R * (1.0 - 0.08 * z / H) + 0.06, 0.14, P["stone"], root, loc=(0, 0.1, z - 0.5), segs=28)
        box("at_door", (0.8, 0.2, 1.5), P["wood"], root, loc=(-0.45, 0.1 - R * 1.02, 0.06 + 0.75))
        for k, z in enumerate((2.2, 3.8)):
            for e in (-0.6, 0.6):
                box(f"at_slit{k}{e}", (0.08, 0.1, 0.7), P["dark"], root, loc=(e, 0.1 - R * 0.96 * math.cos(e * 0.75), z))
        # the hoarding: a timber gallery standing out on beams, board walls, slits, the roof over it
        zh = 0.06 + H
        cyl("at_hfloor", R + 0.4, 0.12, P["wood"], root, loc=(0, 0.1, zh - 0.06), segs=28)
        for k in range(10):
            a = 2 * math.pi * k / 10
            box(f"at_hbeam{k}", (0.12, 0.6, 0.14), P["timber"], root, loc=((R + 0.15) * math.sin(a), 0.1 - (R + 0.15) * math.cos(a), zh - 0.15),
                rot=(0, 0, math.degrees(a)))
        cyl("at_hwall", R + 0.38, 1.3, P["wood"], root, loc=(0, 0.1, zh + 0.06), segs=28)
        for k in range(5):
            a = (k - 2) * 0.42
            box(f"at_hslit{k}", (0.07, 0.08, 0.55), P["dark"], root, loc=((R + 0.38) * math.sin(a), 0.1 - (R + 0.42) * math.cos(a), zh + 0.75),
                rot=(0, 0, math.degrees(a)))
        cyl("at_cone", R + 0.6, 2.6, P["tile"], root, loc=(0, 0.1, zh + 1.3), r2=0.03, segs=28)
        for k in range(4):                         # the hoarding's slits, a quarter round apart
            a = math.pi / 2 * k
            lib.empty(f"shoot_at_{k}", parent=root, loc=((R + 0.6) * math.sin(a), 0.1 - (R + 0.6) * math.cos(a), zh + 0.75))
        kit.drape("at_hang", P, root, "y", 0.0, zh + 1.25, 1.2, 1.0, y0=0.1 - R - 0.44)
        kit.flag("at_flag", P, root, (0.0, 0.1, zh + 3.75), 1.8, c, w=0.9, fh=1.0)


# ---------------------------------------------------------------- 馬廄 stable (3x3)

def stable(root, c):
    P = palette(c)
    kit.pad("st_ground", P, root, 3 * CELL, 3 * CELL, h=0.06, material="earth")
    if c == "E":
        # 廄 (east refs 15, 13): a long low 懸山 shed open to the front, stalls between the posts, a long trough in
        # front, hay stacks, a hitching rail
        _shed_e("st_shed", P, root, 0.0, 1.2, 5.4, 2.4, 2.3, 0.7)
        box("st_back", (5.4, 0.18, 2.0), P["plaster"], root, loc=(0, 1.2 + 1.15, 1.0))
        for k in range(5):
            x = -2.2 + k * 1.1
            box(f"st_stall{k}", (0.07, 1.8, 1.2), P["wood"], root, loc=(x, 1.3, 0.6))
        box("st_trough", (4.2, 0.4, 0.4), P["wood"], root, loc=(0, -0.2, 0.25))
        box("st_water", (4.05, 0.28, 0.02), P["water"], root, loc=(0, -0.2, 0.42))
        for k, x in enumerate((-2.3, -1.6)):
            kit.hay(f"st_hay{k}", P, root, (x, -1.7, 0.0), r=0.6)
        rod("st_hitch", (0.6, -1.5, 0.95), (2.6, -1.5, 0.95), 0.05, P["wood"], parent=root, segs=6)
        for x in (0.6, 2.6):
            cyl(f"st_hp{x}", 0.07, 1.0, P["wood"], root, loc=(x, -1.5, 0.0), segs=8)
        kit.flag("st_flag", P, root, (2.6, -2.5, 0.06), 4.6, c, w=1.2, fh=1.7)
        kit.drape("st_hang", P, root, "y", -0.6, 2.15, 1.0, 0.9, y0=1.2 - 1.3)
    else:
        # a long low timber stable with a thatch roof, open bays to the front, a hay rack; a wattle paddock in front
        # (west ref 13)
        box("st_back", (5.4, 0.2, 1.8), P["plaster"], root, loc=(0, 2.0, 0.9))
        timber_wall_w("st_bw", P, root, -2.7, 2.7, 1.88, 0.0, 1.8, posts=6, face=-1)
        _posts("st_p", P, root, [(-2.7 + k * 1.35, 0.6) for k in range(5)], 1.8, r=0.1, mat="timber")
        for sx in (-1, 1):
            box(f"st_side{sx}", (0.18, 1.5, 1.8), P["plaster"], root, loc=(sx * 2.7, 1.3, 0.9))
        g = lib.empty("st_blk", parent=root, loc=(0, 1.3, 0.0))
        g["block"] = [0, 1.3, 5.4, 1.6, 0.0, 1.8]
        g2, rise = gable_roof_w("st_roof", P, root, 0, 1.3, 1.8, 5.4, 1.6, 50, 0.4, "thatch", thick=0.3, round_eave=True)
        box("st_rack", (4.6, 0.1, 0.5), P["wood"], root, loc=(0, 1.75, 1.2))
        kit.hay("st_hay", P, root, (-2.2, -0.3, 0.0), r=0.55)
        kit.fence("st_pad", P, root, (-1.4, -2.6), (2.7, -2.6), h=0.95)
        kit.fence("st_pad2", P, root, (2.7, -2.6), (2.7, -0.3), h=0.95)
        box("st_trough", (1.6, 0.4, 0.35), P["wood"], root, loc=(1.0, -0.9, 0.2))
        kit.flag("st_flag", P, root, (-2.6, -2.5, 0.06), 4.6, c, w=1.2, fh=1.7)
        kit.drape("st_hang", P, root, "y", 0.0, 1.75, 1.0, 0.85, y0=0.5)


# ---------------------------------------------------------------- 哨所 outpost (2x2)

def outpost(root, c):
    P = palette(c)
    if c == "E":
        # 烽堠 / a roadside post (east refs 06, 20): a low rammed-earth platform, a one-bay shelter with a 懸山 roof, a
        # tall flag pole, the same war drum as the barracks (R8-27), a beacon basket on a pole
        kit.pad("op_ground", P, root, 2 * CELL, 2 * CELL, h=0.06, material="earth")
        box("op_plat", (3.2, 3.0, 0.9), P["earth"], root, loc=(0, 0.35, 0.45), taper=(0.92, 0.92), bevel=0.06)
        box("op_steps", (0.9, 0.6, 0.45), P["earth"], root, loc=(-0.9, -1.25, 0.22))
        w, d, top = hall_e("op_hut", P, root, 0.45, 0.75, 0.9, (1.5,), (1.3,), 1.9, 0.1, 0.0, front_door=False)
        tang_roof("op_roof", P, root, 0.45, 0.75, 0.9 + top, w + 0.2, d + 0.2, 0.62, 0.45, kind="xuanshan", lift=0.0,
                  chiwei=False, tile_amp=0.025)
        war_drum("op_drum", P, root, -0.75, -0.35, r=0.32, h=0.9 + 0.35)
        kit.flag("op_flag", P, root, (-1.3, 0.9, 0.9), 4.6, c, w=1.0, fh=1.4)
        cyl("op_bpole", 0.06, 2.6, P["wood"], root, loc=(1.35, -1.0, 0.9), segs=8)
        for k in range(8):                            # the beacon: an open basket of iron bars, charcoal in it
            a = 2 * math.pi * k / 8
            rod(f"op_bar{k}", (1.35 + 0.16 * math.cos(a), -1.0 + 0.16 * math.sin(a), 3.5),
                (1.35 + 0.32 * math.cos(a), -1.0 + 0.32 * math.sin(a), 3.9), 0.018, P["iron"], parent=root, segs=4)
        cyl("op_ring", 0.33, 0.03, P["iron"], root, loc=(1.35, -1.0, 3.88), segs=16)
        for k in range(5):
            sphere(f"op_coal{k}", 0.09, P["char"], root, loc=(1.35 + 0.1 * math.cos(k * 1.3), -1.0 + 0.1 * math.sin(k * 1.3), 3.62 + 0.04 * k),
                   segs=6, rings=4)
        kit.drape("op_hang", P, root, "y", 0.45, 0.9 + 1.8, 0.9, 0.75, y0=0.75 - 0.7)
    else:
        # a mound with a timber watchtower and a ring of sharpened stakes (west ref 21)
        kit.pad("op_ground", P, root, 2 * CELL, 2 * CELL, h=0.06, material="earth")
        cyl("op_mound", 1.75, 0.8, P["earth"], root, loc=(0, 0.2, 0.0), r2=1.25, segs=24)
        for k in range(26):
            a = 2 * math.pi * k / 26
            if -0.35 < a - 1.5 * math.pi < 0.35:          # the gap toward the camera
                continue
            x, y = 1.82 * math.cos(a), 0.2 + 1.82 * math.sin(a)
            hh = 1.2 + 0.12 * (k % 3)
            cyl(f"op_stake{k}", 0.09, hh, P["wood"], root, loc=(x, y, 0.0), segs=7)
            cyl(f"op_pt{k}", 0.09, 0.22, P["wood"], root, loc=(x, y, hh), r2=0.0, segs=7)
        for sx in (-1, 1):
            for sy in (-1, 1):
                rod(f"op_leg{sx}{sy}", (sx * 0.7, 0.2 + sy * 0.7, 0.8), (sx * 0.55, 0.2 + sy * 0.55, 4.0), 0.08, P["timber"],
                    parent=root, segs=8)
        rod("op_brace0", (-0.7, -0.5, 1.0), (0.55, -0.35, 3.0), 0.05, P["timber"], parent=root, segs=6)
        rod("op_brace1", (0.7, -0.5, 1.0), (-0.55, -0.35, 3.0), 0.05, P["timber"], parent=root, segs=6)
        box("op_deck", (1.6, 1.6, 0.14), P["wood"], root, loc=(0, 0.2, 4.0))
        for k, (size, loc) in enumerate((((1.6, 0.08, 0.9), (0, 0.2 - 0.78, 4.5)), ((1.6, 0.08, 0.9), (0, 0.98, 4.5)),
                                         ((0.08, 1.6, 0.9), (-0.78, 0.2, 4.5)), ((0.08, 1.6, 0.9), (0.78, 0.2, 4.5)))):
            box(f"op_wall{k}", size, P["wood"], root, loc=loc)
        g, rise = gable_roof_w("op_roof", P, root, 0, 0.2, 5.6, 1.6, 1.6, 45, 0.25, "tile", thick=0.07)
        for sx in (-1, 1):
            for sy in (-1, 1):
                cyl(f"op_rp{sx}{sy}", 0.05, 0.7, P["timber"], root, loc=(sx * 0.75, 0.2 + sy * 0.75, 4.9), segs=6)
        rod("op_ladder0", (-0.3, -1.4, 0.0), (-0.3, -0.6, 4.0), 0.03, P["wood"], parent=root, segs=5)
        rod("op_ladder1", (0.2, -1.4, 0.0), (0.2, -0.6, 4.0), 0.03, P["wood"], parent=root, segs=5)
        kit.drape("op_hang", P, root, "y", 0.0, 4.95, 1.2, 0.85, y0=0.2 - 0.84)
        kit.flag("op_flag", P, root, (0.65, 0.85, 5.0), 2.4, c, w=0.9, fh=1.0)


# ---------------------------------------------------------------- 砲坊 siege works (3x3, D-099)

def siege_works(root, c):
    P = palette(c)
    kit.pad("sw_ground", P, root, 3 * CELL, 3 * CELL, h=0.06, material="earth")
    if c == "E":
        # 作院 (east refs 17, 15, 18): a long open 懸山 shed at the back, a timber pile, rope coils, a heap of shot; in
        # the yard a half-built 單梢砲: the four-legged trapezoid frame, the axle, the throwing arm laid on it, raised
        # at a slant above the roofline (the one thing to see from afar)
        _shed_e("sw_shed", P, root, -0.6, 1.6, 4.6, 1.9, 2.3, 0.62)
        box("sw_back", (4.6, 0.18, 2.0), P["plaster"], root, loc=(-0.6, 1.6 + 0.95, 1.0))
        box("sw_bench", (2.0, 0.6, 0.12), P["wood"], root, loc=(-1.4, 1.4, 0.85))
        for sx in (-1, 1):
            box(f"sw_bl{sx}", (0.1, 0.5, 0.8), P["wood"], root, loc=(-1.4 + sx * 0.9, 1.4, 0.4))
        fx, fy = 1.1, -0.6
        for sx in (-1, 1):                            # the frame: two trapezoid sides, legs splayed
            for sy in (-1, 1):
                rod(f"sw_leg{sx}{sy}", (fx + sx * 0.9, fy + sy * 0.75, 0.0), (fx + sx * 0.35, fy + sy * 0.35, 2.4), 0.08, P["timber"],
                    parent=root, segs=8)
            rod(f"sw_sill{sx}", (fx + sx * 0.9, fy - 0.75, 0.15), (fx + sx * 0.9, fy + 0.75, 0.15), 0.08, P["timber"], parent=root,
                segs=8)
            rod(f"sw_mid{sx}", (fx + sx * 0.65, fy - 0.6, 1.2), (fx + sx * 0.65, fy + 0.6, 1.2), 0.06, P["timber"], parent=root,
                segs=8)
        rod("sw_axle", (fx - 0.45, fy, 2.45), (fx + 0.45, fy, 2.45), 0.1, P["iron"], parent=root, segs=10)
        rod("sw_arm", (fx - 0.2, fy + 2.0, 1.1), (fx + 0.15, fy - 2.6, 4.9), 0.09, P["wood"], parent=root, segs=10)
        for k in range(3):
            rod(f"sw_lash{k}", (fx - 0.2 + k * 0.03, fy + 0.4 - k * 0.5, 2.2 + k * 0.4), (fx + 0.1, fy + 0.4 - k * 0.5, 2.3 + k * 0.4),
                0.03, P["rope"], parent=root, segs=5)
        _log_pile("sw_timber", P, root, -1.7, -1.4, n_rows=2, length=2.0, r=0.13, seed=8)
        for k in range(5):
            sphere(f"sw_shot{k}", 0.2, P["rock"], root, loc=(2.3 - (k % 3) * 0.38, -2.2 + (k // 3) * 0.35, 0.2 + (k // 3) * 0.2),
                   segs=10, rings=7)
        cyl("sw_coil", 0.35, 0.18, P["rope"], root, loc=(0.0, -2.0, 0.06), r2=0.3, segs=16)
        kit.flag("sw_flag", P, root, (-2.6, -2.4, 0.06), 4.8, c, w=1.2, fh=1.7)
        kit.drape("sw_hang", P, root, "y", -1.8, 2.15, 0.9, 0.9, y0=1.6 - 1.05)
    else:
        # a big open timber shed with a lean-to roof (west refs 16, 15, 14, 01); in the yard a trebuchet's base: the
        # ground beams crossed in a diamond, the raking struts, two windlasses at the front; a timber pile, a bench
        # and a small jib crane
        box("sw_back", (5.0, 0.25, 2.6), P["stone"], root, loc=(-0.4, 2.4, 1.3))
        _posts("sw_p", P, root, [(-2.8, 1.0), (-0.4, 1.0), (2.0, 1.0)], 2.6, r=0.12, mat="timber")
        box("sw_plate", (5.0, 0.2, 0.2), P["timber"], root, loc=(-0.4, 1.0, 2.55))
        _shed_roof_w("sw_roof", P, root, -3.05, 2.25, 0.6, 2.75, 3.0, 2.4, mat="tile")
        g = lib.empty("sw_blk", parent=root, loc=(-0.4, 1.7, 0.0))
        g["block"] = [-0.4, 1.7, 5.0, 1.6, 0.0, 2.6]
        fx, fy = 0.9, -1.0
        for k, (a, b) in enumerate((((fx - 1.6, fy), (fx + 1.6, fy)), ((fx, fy - 1.4), (fx, fy + 1.4)))):
            rod(f"sw_gb{k}", (a[0], a[1], 0.15), (b[0], b[1], 0.15), 0.12, P["timber"], parent=root, segs=8)
        for k, (x, y) in enumerate(((fx - 1.5, fy), (fx + 1.5, fy), (fx, fy - 1.3), (fx, fy + 1.3))):
            rod(f"sw_strut{k}", (x, y, 0.2), (fx, fy, 2.3), 0.08, P["timber"], parent=root, segs=8)
        cyl("sw_post", 0.14, 2.6, P["timber"], root, loc=(fx, fy, 0.0), segs=10)
        for sx in (-1, 1):                            # the windlasses at the front
            rod(f"sw_wl{sx}", (fx + sx * 0.4, fy - 1.3, 0.4), (fx + sx * 0.4, fy - 0.8, 0.4), 0.09, P["wood"], parent=root, segs=8)
            for k in range(4):
                a = k * math.pi / 2
                rod(f"sw_sp{sx}{k}", (fx + sx * 0.4, fy - 1.05, 0.4), (fx + sx * 0.4, fy - 1.05 + 0.35 * math.cos(a), 0.4 + 0.35 * math.sin(a)),
                    0.025, P["wood"], parent=root, segs=5)
        _log_pile("sw_timber", P, root, -2.0, -1.6, n_rows=2, length=2.0, r=0.13, axis="x", seed=9)
        rod("sw_jib", (2.6, 1.5, 0.0), (2.6, 1.5, 3.4), 0.1, P["timber"], parent=root, segs=8)
        rod("sw_jibarm", (2.6, 1.5, 3.3), (1.4, 0.6, 3.6), 0.07, P["timber"], parent=root, segs=8)
        rod("sw_jibrope", (1.4, 0.6, 3.6), (1.4, 0.6, 1.4), 0.015, P["rope"], parent=root, segs=5)
        kit.flag("sw_flag", P, root, (-2.7, -2.5, 0.06), 4.8, c, w=1.2, fh=1.7)
        kit.drape("sw_hang", P, root, "y", -1.6, 2.5, 1.0, 1.0, y0=0.85)


# ---------------------------------------------------------------- 農田 farm (3x3)

def _crop(root, name, clumps, mat, tall, rnd, per=8, spread=0.06, ripe=False, heads="ff_heads", z0=0.06):
    """A field's crop as two meshes: the leaves (kit.blades, many thin curved blades a clump) and, ripe, the heads
    (rice panicles bowing over, wheat ears upright) in a golder colour."""
    specs, ends = [], []
    for x, y in clumps:
        for b in range(per):
            a = rnd.uniform(0, 2 * math.pi)
            lean = rnd.uniform(0.1, 0.45)
            L = tall * rnd.uniform(0.75, 1.1)
            d = (lean * math.cos(a), lean * math.sin(a), 1.0)
            specs.append(((x + rnd.uniform(-spread, spread) * 0.3, y + rnd.uniform(-spread, spread) * 0.3, z0), d, L,
                          rnd.uniform(0.012, 0.022), rnd.uniform(0.1, 0.35)))
            if ripe and b % 3 == 0:
                ends.append((x + lean * L * 0.55 * math.cos(a), y + lean * L * 0.55 * math.sin(a), z0 + L * 0.85, a))
    kit.blades(name, mat, root, specs, width_tip=0.002, segs=3)
    if ends:
        gold = lib.mat("crop_heads", (0.55, 0.42, 0.14), 0.8)
        hs = [((x, y, z), (0.6 * math.cos(a), 0.6 * math.sin(a), -0.5 if "panicle" in heads else 0.8), 0.14, 0.03, 0.4)
              for x, y, z, a in ends]
        kit.blades(heads, gold, root, hs, width_tip=0.012, segs=3)


def farm(root, c, stage="ripe"):
    """Rice paddies (East) or wheat strips (West) with a small thatched shelter at a corner; stage: sown, growing,
    ripe. Parts named ff_* are the crop, water and scarecrow (states.py drops them for build_a1)."""
    P = palette(c)
    rnd = random.Random(70 + (c == "W"))
    S = 3 * CELL
    kit.pad("ff_soil", P, root, S, S, h=0.05, material="earth")
    col = {"sown": (0.24, 0.3, 0.1), "growing": (0.12, 0.2, 0.05), "ripe": (0.45, 0.36, 0.12)}[stage]
    crop = lib.mat(f"crop_{stage}_{c}", col, 0.85)
    tall = {"sown": 0.12, "growing": 0.45, "ripe": 0.7}[stage]
    if c == "E":
        # paddies: bunds (田埂) round four plots, water in them, rice in rows
        for k in range(3):
            t = -S / 2 + 0.1 + k * (S - 0.2) / 2
            box(f"ff_bundx{k}", (S - 0.1, 0.22, 0.14), P["earth"], root, loc=(0, t, 0.1))
            box(f"ff_bundy{k}", (0.22, S - 0.1, 0.14), P["earth"], root, loc=(t, 0, 0.1))
        if stage != "ripe":
            box("ff_water", (S - 0.3, S - 0.3, 0.02), P["water"], root, loc=(0, 0, 0.07))
        clumps = []                                   # rice planted in rows of clumps, 25 cm apart
        n = int((S - 0.6) / 0.25)
        for ix in range(n):
            for iy in range(n):
                x = -S / 2 + 0.3 + ix * 0.25
                y = -S / 2 + 0.3 + iy * 0.25
                if abs(x) < 0.16 or abs(y) < 0.16:
                    continue
                clumps.append((x + rnd.uniform(-0.03, 0.03), y + rnd.uniform(-0.03, 0.03)))
        _crop(root, "ff_rice", clumps, crop, tall, rnd, per=9, spread=0.07, ripe=stage == "ripe", heads="ff_panicle")
        sx, sy = S / 2 - 0.7, S / 2 - 0.7          # the shelter: four posts, a thatch top
        _posts("ff_hutp", P, root, [(sx - 0.45, sy - 0.45), (sx + 0.45, sy - 0.45), (sx - 0.45, sy + 0.45), (sx + 0.45, sy + 0.45)],
               1.6, r=0.05)
        g, _ = gable_roof_w("ff_hutroof", P, root, sx, sy, 1.6, 1.1, 1.1, 35, 0.2, "thatch", thick=0.2, round_eave=True)
        kit.pennant("ff_pen", P, root, (-S / 2 + 0.3, S / 2 - 0.3, 0.0), 3.0, w=0.8, fh=0.5)
        kit.drape("ff_hang", P, root, "y", sx, 1.55, 0.7, 0.5, y0=sy - 0.6)
    else:
        # wheat in long strips (ridge and furrow), a wattle fence along the front, sheaves when ripe
        clumps = []
        for k in range(6):
            y = -S / 2 + 0.5 + k * (S - 1.0) / 5
            box(f"ff_ridge{k}", (S - 0.4, 0.55, 0.12), P["earth"], root, loc=(0, y, 0.09))
            for i in range(int((S - 0.6) / 0.12)):
                clumps.append((-S / 2 + 0.3 + i * 0.12 + rnd.uniform(-0.04, 0.04), y + rnd.uniform(-0.2, 0.2)))
        _crop(root, "ff_wheat", clumps, crop, tall, rnd, per=5, spread=0.04, ripe=stage == "ripe", heads="ff_ears", z0=0.14)
        kit.fence("ff_fence", P, root, (-S / 2 + 0.1, -S / 2 + 0.08), (S / 2 - 0.1, -S / 2 + 0.08), h=0.8)
        if stage == "ripe":
            for k in range(3):
                cyl(f"ff_sheaf{k}", 0.16, 0.7, crop, root, loc=(-1.8 + k * 0.6, -2.4, 0.0), r2=0.22, segs=10)
        kit.pennant("ff_pen", P, root, (S / 2 - 0.3, S / 2 - 0.3, 0.0), 3.0, w=0.8, fh=0.5)
        kit.drape("ff_hang", P, root, "y", 0.0, 0.75, 1.2, 0.45, y0=-S / 2)


FOOTPRINT = {"r8_lumber_camp": (2, 2), "r8_mine": (2, 2), "r8_granary": (2, 2), "r8_range": (3, 3), "r8_mage_hall": (3, 3),
             "r8_arrow_tower": (2, 2), "r8_stable": (3, 3), "r8_outpost": (2, 2), "r8_siege_works": (3, 3), "r8_farm": (3, 3)}
BUILDERS = {"r8_lumber_camp": lumber_camp, "r8_mine": mine, "r8_granary": granary, "r8_range": range_,
            "r8_mage_hall": mage_hall, "r8_arrow_tower": arrow_tower, "r8_stable": stable, "r8_outpost": outpost,
            "r8_siege_works": siege_works, "r8_farm": farm}
