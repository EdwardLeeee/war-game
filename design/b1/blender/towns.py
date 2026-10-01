"""B1-03: the pieces a town is built from (each piece is its own sprite, sorted on its own).

Pieces (kind, footprint in cells):
  th22, th21, th12, th11   town houses; th21 is 2 cells along x and 1 along y, th12 the other way
  ttower                   the big city's tower (2 x 2, sim TownTower), always neutral
  tflag                    the flagpole on the square: neutral banner / player colour / half-raised / broken
  tpost                    a boundary post on the town's circle: lantern / player pennant / knocked down
  tcart                    plunder clutter: an overturned cart, broken crates, spilt sacks
  ttax                     the governed town paying: stacked sacks, baskets, a crate of ore
  tlumber                  repairs: a pile of timber and tiles
  tground                  the paving of the square and the streets (flat), from a plan

House states ("state"): intact, ruin (burnt shell: the walls stand, so the cells still look blocked,
ceo 2026-10-01), burning (plunder), scaffold (repair). Every house has an empty "smoke_at" where
the governed town's cooking smoke rises (a shared overlay, not part of the house image).
"""
import math
import random

from mathutils import Vector

import lib
from lib import box, cyl, rod, slab, sphere
import kit
import states

FOOTPRINT = {"th22": (2, 2), "th21": (2, 1), "th12": (1, 2), "th11": (1, 1), "ttower": (2, 2), "tflag": (1, 1),
             "tpost": (1, 1), "tcart": (1, 1), "ttax": (1, 1), "tlumber": (1, 1), "tground": (1, 1),
             }


def _neutral(P):
    return lib.mat("neutral_cloth", (0.86, 0.84, 0.78), 0.85, sheen=0.2)


def _smoke_at(root, loc):
    e = lib.empty("smoke_at", parent=root, loc=loc)
    return e


# ---------------------------------------------------------------- houses

def _house(root, c, fx, fy, variant=0):
    """A town house filling fx x fy cells (with a little yard round it)."""
    P = kit.palette(c)
    W, D = fx * kit.CELL, fy * kit.CELL
    rnd = random.Random(fx * 10 + fy + variant * 7 + (0 if c == "E" else 3))
    kit.pad("th_pad", P, root, W, D, 0.1, material="earth")
    bw, bd = W - 0.7, D - 0.7
    ridge = "x" if bw >= bd else "y"
    if c == "E":
        box("th_plinth", (bw + 0.25, bd + 0.25, 0.25), P["stone"], root, loc=(0, 0, 0.22), bevel=0.03)
        door_side = "y" if ridge == "x" else "x"
        kit.block_e("th_body", P, root, 0, 0, bw, bd, 0.34, 1.9, door=(door_side, -0.3 if door_side == "y" else 0.3, 0.9),
                    windows=bw > 1.4 or bd > 1.4)
        kit.roof_e("th_roof", P, root, 0, 0, 2.24, bw, bd, 0.85 + 0.1 * min(bw, bd), over=0.45, curl=0.28, ridge=ridge)
        _smoke_at(root, (0.25 * bw / 2, 0.2, 2.24 + 0.85 + 0.1 * min(bw, bd)))
        if variant % 2 == 0 and bw >= 2.5:
            kit.awning("th_aw", P, root, "y", bw * 0.2, 1.75, 1.4, 0.7, y0=-bd / 2, team=False)
            for k in range(2):
                kit.sack(f"th_sk{k}", P, root, (bw * 0.2 - 0.3 + k * 0.5, -bd / 2 - 0.45, 0.1), 0.2)
        kit.lantern("th_lan", P, root, (-bw / 2 - 0.05, -bd / 2 - 0.05, 1.95))
    else:
        timber = 0.9 if variant % 2 == 0 else None
        door_side = "y" if ridge == "x" else "x"
        kit.block_w("th_body", P, root, 0, 0, bw, bd, 0.1, 2.0, timber_from=timber,
                    door=(door_side, 0.35 if door_side == "y" else -0.3, 0.9), windows=bw > 1.4 or bd > 1.4,
                    quoins=timber is None)
        thatch = variant % 2 == 1 or (fx == 1 and fy == 1)
        Pr = dict(P, tile=P["thatch"]) if thatch else P
        rh = 0.95 + 0.18 * min(bw, bd)
        kit.roof_w("th_roof", Pr, root, 0, 0, 2.1, bw, bd, rh, ridge=ridge, over=0.3)
        cx = -bw / 2 + 0.35 if ridge == "x" else 0.0
        cy = 0.0 if ridge == "x" else -bd / 2 + 0.35
        if not thatch:
            kit.chimney("th_chim", P, root, (cx, cy, 2.1), rh + 0.35, 0.4)
            _smoke_at(root, (cx, cy, 2.1 + rh + 0.5))
        else:
            _smoke_at(root, (0, 0, 2.1 + rh))
        if variant % 2 == 0 and bw >= 2.5:
            kit.awning("th_aw", P, root, "y", -bw * 0.15, 1.6, 1.3, 0.65, y0=-bd / 2, team=False)
            kit.barrel("th_br", P, root, (-bw * 0.15 + 0.5, -bd / 2 - 0.4, 0.1), r=0.2, h=0.5)


def th22(root, c, variant=0):
    _house(root, c, 2, 2, variant)


def th21(root, c, variant=0):
    _house(root, c, 2, 1, variant)


def th12(root, c, variant=0):
    _house(root, c, 1, 2, variant)


def th11(root, c, variant=0):
    _house(root, c, 1, 1, variant)


def house_state(root, kind, c, state):
    """The state of a town house (applied after the house is built)."""
    if state == "intact":
        return
    P = kit.palette(c)
    fx, fy = FOOTPRINT[kind]
    W, D = fx * kit.CELL, fy * kit.CELL
    seed = fx * 10 + fy + (0 if c == "E" else 5)
    roofs = states._tagged(root, "roof")
    blocks = states._tagged(root, "block")
    if state == "ruin":
        # roof gone, walls burnt down to a jagged height that still reads as a wall (the cells stay
        # blocked), hollow inside, charred beams fallen in
        rnd = random.Random(seed)
        for g, (cx, cy, bw, bd, z0, wh) in blocks:
            M = g.matrix_world
            o = M.translation
            inner = box("ru_hollow", (bw - 0.36, bd - 0.36, 6.0), lib.mat("cutter", (1, 0, 1)), None,
                        loc=(o.x, o.y, z0 + 0.35 + 3.0), outline=False)
            states._forget(inner)
            inner.hide_render = True
            notches = [inner]
            for i in range(6):      # broken gaps along the wall tops
                side = i % 4
                t = rnd.uniform(-0.4, 0.4)
                nx = o.x + (t * bw if side in (0, 2) else (-bw / 2 if side == 1 else bw / 2))
                ny = o.y + (t * bd if side in (1, 3) else (-bd / 2 if side == 0 else bd / 2))
                nb = box(f"ru_notch{i}", (rnd.uniform(0.5, 1.0), rnd.uniform(0.5, 1.0), 1.5), lib.mat("cutter", (1, 0, 1)),
                         None, loc=(nx, ny, z0 + rnd.uniform(1.15, 1.45) + 0.75), rot=(rnd.uniform(-20, 20), 0, 0),
                         outline=False)
                states._forget(nb)
                nb.hide_render = True
                notches.append(nb)
            for ob in kit.parts_under(root):
                b = states._bbox(ob)
                if b[5] < z0 + 0.3:
                    continue
                for k, cut in enumerate(notches):
                    m = ob.modifiers.new(f"ru{k}", "BOOLEAN")
                    m.operation = "DIFFERENCE"
                    m.object = cut
                    m.solver = "EXACT"
        states.cut_above(root, 1.9)
        states._char_all(root)
        for g, (cx, cy, bw, bd, z0, wh) in blocks:
            M = g.matrix_world
            for i in range(3):
                x = rnd.uniform(-bw / 2, bw / 2) * 0.6
                rod(f"ru_beam{i}", tuple(M @ Vector((x, -bd / 2 + 0.2, 1.7))),
                    tuple(M @ Vector((x + 0.4, bd / 2 - 0.3, 0.2))), 0.08, P["char"],
                    parent=root, segs=6)
            for i in range(4):     # a few broken courses on the wall tops
                x = rnd.uniform(-bw / 2, bw / 2) * 0.8
                box(f"ru_top{i}", (0.5, 0.25, 0.35), P["char"], root,
                    loc=tuple(M @ Vector((x, -bd / 2 + 0.12, 1.75 + 0.15))), bevel=0.03)
        states.ash(root, "ru_ash", W, D, seed)
    elif state == "burning":
        centres = []
        for g, (cx, cy, z, rw, rd, rh, over, ridge) in roofs[:1]:
            ww, dd = (rw, rd) if ridge == "x" else (rd, rw)
            centres.append(states.front_slope(g.matrix_world, ww, dd, 0.2, 0.45, rh * 0.5))
        parts = []
        for g, v in roofs:
            parts += kit.parts_under(g)
        states.cut_holes(parts, centres, 0.55)
        for k, cc in enumerate(centres):
            states.flames(root, P, f"bu_fire{k}", (cc.x, cc.y, cc.z - 0.1), size=1.3, n=7, seed=seed + k)
            states.smoke(root, f"bu_smoke{k}", (cc.x, cc.y, cc.z + 0.6), height=2.8, r0=0.32, r1=0.85, n=10, dark=0.15,
                         alpha=0.9)
    elif state == "scaffold":
        for g, (cx, cy, bw, bd, z0, wh) in blocks[:1]:
            M = g.matrix_world
            o = M.translation
            states.scaffold(root, P, c, o.x - bw / 2 - 0.25, o.x + bw / 2 + 0.25, o.y - bd / 2 - 0.25, o.y + bd / 2 + 0.25,
                            z0 + wh + 0.6, canvas=False, name="th_sc")
        kit.planks("th_pl", P, root, (-W / 2 + 0.6, -D / 2 + 0.35, 0.1), n=4, length=1.0)
    else:
        raise ValueError(state)


# ---------------------------------------------------------------- the big city's tower (neutral)

def ttower(root, c, variant=0):
    P = kit.palette(c)
    N = _neutral(P)
    W = 2 * kit.CELL
    kit.pad("tt_pad", P, root, W, W, 0.15)
    if c == "E":
        box("tt_base", (3.4, 3.4, 3.2), P["brick"], root, loc=(0, 0, 1.75), bevel=0.06, taper=(0.9, 0.9))
        box("tt_deck", (3.3, 3.3, 0.2), P["stone"], root, loc=(0, 0, 3.45))
        kit.block_e("tt_hall", P, root, 0, 0, 2.3, 2.3, 3.55, 1.7, windows=True)
        kit.roof_e("tt_roof", P, root, 0, 0, 5.25, 2.3, 2.3, 1.4, over=0.7, curl=0.5)
        box("tt_rail", (3.2, 0.1, 0.5), P["post"], root, loc=(0, -1.6, 3.8))
        box("tt_railx", (0.1, 3.2, 0.5), P["post"], root, loc=(-1.6, 0, 3.8))
        box("tt_gate", (1.0, 0.1, 1.6), P["dark"], root, loc=(-0.4, -1.72, 1.0), outline=False)
        drum = cyl("tt_drum", 0.35, 0.4, P["post"], root, loc=(0.6, -0.8, 4.3), rot=(90, 0, 45), segs=14)
        pts = [(-0.45, 0), (0.45, 0), (0.45, -1.7), (0, -1.5), (-0.45, -1.7)]
        slab("tt_ban", pts, 0.03, N, parent=root, loc=(-1.0, -1.78, 3.3), plane="XZ")
    else:
        box("tt_body", (3.2, 3.2, 5.8), P["stone"], root, loc=(0, 0, 3.05), bevel=0.06, taper=(0.92, 0.92))
        kit.roof_flat_parapet("tt_top", P, root, 0, 0, 5.95, 3.3, 3.3, merlon=0.45, gap=0.4)
        for z in (2.0, 4.0):
            box(f"tt_slit{z}", (0.14, 0.1, 0.7), P["dark"], root, loc=(0.3, -1.52, z), outline=False)
            box(f"tt_slitx{z}", (0.1, 0.14, 0.7), P["dark"], root, loc=(-1.52, -0.3, z), outline=False)
        box("tt_door", (0.9, 0.1, 1.5), P["wood"], root, loc=(-0.5, -1.62, 0.9))
        pts = [(-0.45, 0), (0.45, 0), (0.45, -1.8), (0, -1.55), (-0.45, -1.8)]
        slab("tt_ban", pts, 0.03, N, parent=root, loc=(-1.63, 0.5, 5.6), rot=(0, 0, 90), plane="XZ")


def tower_state(root, c, state):
    if state == "intact":
        return
    P = kit.palette(c)
    if state == "rubble":           # torn down: the sim frees the cells, so the rubble is low
        for ob in list(kit.parts_under(root)):
            if states._bbox(ob)[5] > 0.3:
                states._drop(ob)
        states.rubble(root, P, c, 2 * kit.CELL, 2 * kit.CELL, seed=21 + (0 if c == "E" else 3))
    else:
        raise ValueError(state)


# ---------------------------------------------------------------- the square: flag, posts, clutter

def tflag(root, c, variant=0, state="neutral"):
    """The town flag on the square. neutral: a pale 鄉勇 banner; team: the holder's colour with the
    nation's emblem (decoration); half: the new holder's flag half-way up (repairs); broken."""
    P = kit.palette(c)
    N = _neutral(P)
    box("tf_base", (0.7, 0.7, 0.3), P["stone"], root, loc=(0, 0, 0.15), bevel=0.04)
    if state == "broken":
        rod("tf_stump", (0, 0, 0.3), (0.02, 0, 1.4), 0.08, P["char"], parent=root)
        rod("tf_fallen", (0.2, 0.2, 0.1), (2.6, 1.6, 0.12), 0.07, P["char"], parent=root)
        pts = [(0, 0), (0.9, 0), (0.9, -0.6), (0, -0.6)]
        slab("tf_rag", pts, 0.02, lib.mat("rag", (0.32, 0.3, 0.28), 0.95), parent=root, loc=(1.7, 1.0, 0.12),
             rot=(90, 0, 30), plane="XZ")
        return
    h = 7.0
    rod("tf_pole", (0, 0, 0.3), (0, 0, h), 0.08, P["beam"], parent=root)
    sphere("tf_finial", 0.13, P["gold"], root, loc=(0, 0, h + 0.05))
    top = h - 0.1 if state != "half" else h * 0.55
    rod("tf_bar", (0, 0, top), (1.6, -0.6, top - 0.05), 0.03, P["beam"], parent=root)
    if state == "neutral":
        pts = [(0, 0), (1.6, 0), (1.5, -2.6), (0.8, -2.3), (0, -2.6)]
        slab("tf_cloth", pts, 0.03, N, parent=root, loc=(0.05, -0.02, top - 0.05), rot=(0, 0, -20), plane="XZ")
        # the militia's mark in dark paint: a spear over a round shield
        cyl("tf_mark", 0.32, 0.02, lib.mat("ink", (0.12, 0.11, 0.1), 0.8), root, loc=(0.75, -0.33, top - 1.0),
            rot=(90, 0, -20), segs=20, outline=False)
    else:
        kit.flag("tf_team", P, root, (0, 0, top - 2.65), 2.65, c, w=1.6, fh=2.6)


def tpost(root, c, variant=0, state="lantern"):
    """A boundary post on the town's circle (direction B)."""
    P = kit.palette(c)
    if state == "fallen":
        box("tp_base", (0.6, 0.6, 0.3), P["stone"], root, loc=(-0.9, 0.3, 0.15))
        rod("tp_post", (-0.7, 0.25, 0.25), (2.6, -0.6, 0.12), 0.1, P["char"], parent=root)
        return
    H = 4.2
    box("tp_base", (0.6, 0.6, 0.4), P["stone"], root, loc=(0, 0, 0.2), bevel=0.04)
    rod("tp_post", (0, 0, 0.4), (0, 0, H), 0.1, P["beam"], parent=root)
    if c == "E":
        box("tp_cap", (0.5, 0.5, 0.14), P["tile"], root, loc=(0, 0, H + 0.05))
    else:
        cyl("tp_cap", 0.18, 0.4, P["stone"], root, loc=(0, 0, H), r2=0.02, segs=8)
    rod("tp_arm", (0, 0, H - 0.25), (0.75, -0.25, H - 0.25), 0.045, P["beam"], parent=root)
    if state == "lantern":
        # neutral: a pair of big pale lanterns, round (a different shape from the holder's streamer)
        lam = lib.mat("paper_lantern", (0.94, 0.9, 0.78), 0.8, emission=0.5)
        for k, (x, z) in enumerate(((0.62, H - 0.75), (0.0, H - 1.55))):
            rod(f"tp_lr{k}", (x, -0.2 * (x > 0), z + 0.5), (x, -0.2 * (x > 0), z + 0.32), 0.012, P["rope"], parent=root,
                outline=False)
            sphere(f"tp_lantern{k}", 0.3, lam, root, loc=(x + (0.0 if x else 0.25), -0.2 * (x > 0) - (0.0 if x else 0.1), z),
                   scale=(1, 1, 1.25))
    elif state == "pennant":
        # held: a long streamer (幡) in the holder's colour
        pts = [(-0.32, 0), (0.32, 0), (0.32, -2.3), (0, -2.05), (-0.32, -2.3)]
        slab("tp_pen", pts, 0.03, P["team"], parent=root, loc=(0.45, -0.16, H - 0.3), rot=(0, 0, -20), plane="XZ")
    elif state == "bare":
        pass
    else:
        raise ValueError(state)


def tcart(root, c, variant=0):
    P = kit.palette(c)
    g = kit.cart("tc_cart", P, root, (0.1, 0.0, 0.0), rot=25, load="none")
    g.rotation_euler[1] = math.radians(70)          # tipped on its side
    g.location.z = 0.45
    rnd = random.Random(4)
    for k in range(5):
        kit.sack(f"tc_sack{k}", P, root, (rnd.uniform(-0.8, 0.8), rnd.uniform(-0.8, 0.8), 0.0), 0.2, rot=rnd.uniform(0, 90))
    for k in range(3):
        box(f"tc_board{k}", (0.6, 0.12, 0.04), P["wood"], root, loc=(rnd.uniform(-0.7, 0.7), rnd.uniform(-0.7, 0.7), 0.04),
            rot=(0, 0, rnd.uniform(0, 180)))


def ttax(root, c, variant=0):
    P = kit.palette(c)
    for k, (x, y) in enumerate(((-0.4, -0.3), (0.1, -0.35), (-0.15, 0.15), (0.45, 0.1))):
        kit.sack(f"tx_sack{k}", P, root, (x, y, 0.0), 0.24)
    kit.sack("tx_top", P, root, (-0.1, -0.1, 0.3), 0.22)
    kit.crate("tx_crate", P, root, (0.5, -0.5, 0.0), 0.5)
    for i in range(4):
        lib.ico(f"tx_gold{i}", 0.08, P["ore"], root, loc=(0.4 + (i % 2) * 0.15, -0.55 + (i // 2) * 0.12, 0.55), subdiv=1,
                smooth=False)
    kit.crystals("tx_cr", P, root, (-0.5, 0.45, 0.0), size=0.45, n=4, seed=3)


def tlumber(root, c, variant=0):
    P = kit.palette(c)
    kit.logs("tl_logs", P, root, (0, 0.2, 0.0), n=6, length=1.6, r=0.12)
    for k in range(5):
        box(f"tl_tile{k}", (0.6, 0.4, 0.07), P["tile"], root, loc=(0.1, -0.55, 0.05 + k * 0.075))


def tground(root, c, variant=0, plan=()):
    """Flat paving: the square and the streets (stone or packed earth), garden plots; no height.
    plan: [(x, y, kind)] cell centres in metres from the layout centre (common/layouts.py)."""
    P = kit.palette(c)
    street = lib.mat("street_" + c, (0.55, 0.5, 0.42) if c == "E" else (0.5, 0.49, 0.46), 0.95, pattern="block",
                     pattern_scale=1.4)
    garden = lib.mat("garden", (0.33, 0.42, 0.18), 0.9, noise=0.4, noise_scale=12)
    for k, (x, y, kind) in enumerate(plan):
        i, j = k, 0
        if kind in ("square", "street"):
            box(f"tg_{i}_{j}", (kit.CELL - 0.02, kit.CELL - 0.02, 0.04), street if kind == "street" else P["pave"], root,
                loc=(x, y, 0.02), outline=False)
        elif kind == "garden":
            box(f"tg_{i}_{j}", (kit.CELL - 0.3, kit.CELL - 0.3, 0.05), garden, root, loc=(x, y, 0.025), outline=False)


BUILDERS = {"tground": tground, "th22": th22, "th21": th21, "th12": th12, "th11": th11, "ttower": ttower, "tflag": tflag, "tpost": tpost,
            "tcart": tcart, "ttax": ttax, "tlumber": tlumber}
