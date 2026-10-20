"""R6-51 (the user 2026-10-20: 「地形感覺可以多元一點，石頭好少 我覺得這種天然障礙物可以多些來擋路可能會更好玩」): a stretch
of road with one kind of natural obstacle across it, for the option boards (design/r6/common/r651.py). The sim's rules
(war-game-core 2026-10-20): none of them stops shots or sight; rock, ridge, cliff and the forest that cannot be cut block
like rock; water blocks; fords and bridges are 3 cells wide and walkable (fords do not slow, the first version).

  tpatch(root, c, w, d, plan)   w x d metres round the origin; plan (design/r6/common/r651.py), metres, render axes:
      ground  the gpatch plan under it (ground.py, look A)
      rocks   [(x, y), ...]           a heap of boulders on each cell
      cliff_line [(x, y), ...]        the escarpment's line (rock face, taller and darker than a heap)
      bank    [[(x, y), ...], ...]    the earth bank round the water, a little bigger than it
      water   [[(x, y), ...], ...]    river or lake polygons
      ford    [[(x, y), ...], ...]    shallow water with stepping stones
      bridge  [(x0, y0, x1, y1)]      a timber bridge over that rectangle, its length along the longer side
      trees   [(x, y, variant)]       trees that can be cut (the forest 甲)
      thick   [(x, y)]                the forest that cannot be cut (乙): trees with undergrowth and brambles
"""
import math
import random

import lib
from lib import box, cyl, ico, rod, slab, sphere
import kit
import ground
import nature

FOOTPRINT = {"tpatch": (1, 1), "trock": (1, 1), "tcliff_post": (1, 1), "tcliff_arm": (1, 1), "twater": (1, 1),
             "tford": (1, 1), "tbridge_deck": (1, 1), "tbridge_rail": (1, 1)}


def _water(name, pts, m, parent, z=0.03):
    return ground._poly(name, pts, m, parent, z)


def _boulders(name, x, y, P, parent, rnd, n=3, size=1.0, mat=None):
    for k in range(n):
        r = rnd.uniform(0.38, 0.62) * size
        ico(f"{name}_{k}", r, mat or P["rock"], parent, loc=(x + rnd.uniform(-0.45, 0.45), y + rnd.uniform(-0.45, 0.45), r * 0.55),
            subdiv=1, scale=(1, rnd.uniform(0.8, 1.1), rnd.uniform(0.8, 1.25)))


def tpatch(root, c, variant=0, w=48.0, d=28.0, plan=None):
    plan = plan or {}
    rnd = random.Random(11 + variant)
    ground.gpatch(root, c, style="A", w=w, d=d, plan=plan.get("ground"))
    P = dict(kit.palette(c))
    P["rock"] = lib.mat("tp_rock", (0.48, 0.47, 0.44), 0.85, noise=0.4, noise_scale=6)
    P["cliff"] = lib.mat("tp_cliff", (0.36, 0.31, 0.26), 0.9, noise=0.5, noise_scale=3)
    P["cliffdark"] = lib.mat("tp_cliffdark", (0.3, 0.25, 0.2), 0.9, noise=0.4, noise_scale=5)
    # flat colours as dark as ground.LOOK's (the lit ground comes out about 1.5 x brighter than its albedo)
    # rough enough that the white world light does not wash the water out (0.22 rendered it white)
    water = lib.mat("tp_water", (0.02, 0.075, 0.13), 0.6, noise=0.15, noise_scale=3)
    shallow = lib.mat("tp_shallow", (0.07, 0.15, 0.16), 0.65, noise=0.2, noise_scale=4)
    bank = lib.mat("tp_bank", (0.17, 0.13, 0.08), 0.95, noise=0.3, noise_scale=8)
    for k, pts in enumerate(plan.get("bank", [])):
        _water(f"tp_bank{k}", pts, bank, root, 0.03)
    for k, pts in enumerate(plan.get("water", [])):
        _water(f"tp_water{k}", pts, water, root, 0.034)
    for k, pts in enumerate(plan.get("ford", [])):
        _water(f"tp_ford{k}", pts, shallow, root, 0.04)
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        for i in range(16):                      # stepping stones and gravel across it
            ico(f"tp_step{k}_{i}", rnd.uniform(0.18, 0.3), P["rock"], root,
                loc=(rnd.uniform(min(xs) + 0.3, max(xs) - 0.3), rnd.uniform(min(ys) + 0.3, max(ys) - 0.3), 0.06),
                subdiv=1, scale=(1, 1, 0.45), outline=False)
    for k, (x0, y0, x1, y1) in enumerate(plan.get("bridge", [])):
        along_x = (x1 - x0) >= (y1 - y0)
        L = (x1 - x0) if along_x else (y1 - y0)
        Wd = (y1 - y0) if along_x else (x1 - x0)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        deck = lib.mat("tp_deck", (0.46, 0.33, 0.2), 0.8, noise=0.3, noise_scale=10, pattern="tiles", pattern_scale=4.0)
        box(f"tp_deck{k}", (L, Wd - 0.3, 0.22) if along_x else (Wd - 0.3, L, 0.22), deck, root, loc=(cx, cy, 0.42))
        n = max(3, int(L / 1.6))
        for s in (-1, 1):
            for i in range(n + 1):
                t = -L / 2 + L * i / n
                px, py = (cx + t, cy + s * (Wd / 2 - 0.2)) if along_x else (cx + s * (Wd / 2 - 0.2), cy + t)
                cyl(f"tp_post{k}{s}{i}", 0.09, 1.25, P["beam"], root, loc=(px, py, 0.0), segs=8)
            if along_x:
                box(f"tp_rail{k}{s}", (L, 0.1, 0.12), P["beam"], root, loc=(cx, cy + s * (Wd / 2 - 0.2), 1.1))
            else:
                box(f"tp_rail{k}{s}", (0.1, L, 0.12), P["beam"], root, loc=(cx + s * (Wd / 2 - 0.2), cy, 1.1))
    for k, (x, y) in enumerate(plan.get("rocks", [])):
        _boulders(f"tp_rk{k}", x, y, P, root, rnd, n=4, size=rnd.uniform(1.15, 1.45))
    line = plan.get("cliff_line", [])
    if line:
        _cliff(root, line, P, rnd)
    for k, (x, y, v) in enumerate(plan.get("trees", [])):
        g = lib.empty(f"tp_tree{k}", parent=root, loc=(x + rnd.uniform(-0.2, 0.2), y + rnd.uniform(-0.2, 0.2), 0))
        nature.tree(g, c, variant=v, seed=200 + k)
    if plan.get("thick"):
        bush = lib.mat("tp_bush", (0.12, 0.26, 0.1), 0.85, noise=0.35, noise_scale=12, sheen=0.3)
        bramble = lib.mat("tp_bramble", (0.2, 0.17, 0.1), 0.9, noise=0.3, noise_scale=20)
        for k, (x, y) in enumerate(plan["thick"]):
            g = lib.empty(f"tp_thick{k}", parent=root, loc=(x + rnd.uniform(-0.15, 0.15), y + rnd.uniform(-0.15, 0.15), 0))
            nature.tree(g, c, variant=(k * 2) % 3, seed=400 + k)
            for i in range(5):                    # undergrowth filling the gaps between the trunks, up to the crowns
                sphere(f"tp_ug{k}_{i}", rnd.uniform(0.6, 0.85), bush, root,
                       loc=(x + rnd.uniform(-0.9, 0.9), y + rnd.uniform(-0.9, 0.9), 0.5), scale=(1, 1, 0.85))
            for i in range(4):                    # brambles: dark thorny sticks
                a = rnd.uniform(0, math.pi)
                rod(f"tp_br{k}_{i}", (x + math.cos(a) * 0.8, y + math.sin(a) * 0.8, 0.05),
                    (x - math.cos(a) * 0.8, y - math.sin(a) * 0.8, rnd.uniform(0.4, 0.8)), 0.035, bramble, parent=root, segs=5)


def _cliff(root, line, P, rnd, taper_ends=True, name="tp_cliff", ends=None):
    """One continuous rock face along the line (the user 2026-10-20 picked the cliff; the first draft looked like a row
    of standing stones): a swept cross-section whose height and width wander, a ledge half-way up for the strata, broken
    rock jutting from the face, scree at both feet. ends=(h, w): the height and half-width held at both ends (the
    tiles' arms, so every arm meets the post the same way)."""
    import bmesh
    pts = []
    for (x0, y0), (x1, y1) in zip(line, line[1:]):
        L = math.hypot(x1 - x0, y1 - y0)
        n = max(1, int(L / 0.35))
        for i in range(n):
            t = i / n
            pts.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))
    pts.append(line[-1])
    total = sum(math.hypot(x1 - x0, y1 - y0) for (x0, y0), (x1, y1) in zip(line, line[1:]))
    bm = bmesh.new()
    rings = []
    for k, (x, y) in enumerate(pts):
        a, b = pts[max(0, k - 1)], pts[min(len(pts) - 1, k + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / L, dx / L
        s = k * 0.35
        end = min(k, len(pts) - 1 - k)
        taper = min(1.0, 0.35 + end * 0.12) if taper_ends else 1.0     # the ends come down to the ground
        h = (2.7 + 0.35 * math.sin(s * 1.3) + 0.25 * math.sin(s * 3.1 + 1.0) + rnd.uniform(-0.12, 0.12)) * taper
        w = 0.95 + 0.15 * math.sin(s * 0.9)
        if ends:                                  # held at the ends, free in the middle
            f = min(1.0, min(k, len(pts) - 1 - k) / max(1, len(pts) - 1) * total / 0.8)
            f = f * f * (3 - 2 * f)
            h = ends[0] + (h - ends[0]) * f
            w = ends[1] + (w - ends[1]) * f
        prof = [(-w, 0.0), (-w * 0.78, h * 0.5), (-w * 0.62, h * 0.55), (-w * 0.42, h * 0.97), (0.0, h),
                (w * 0.4, h * 0.94), (w * 0.6, h * 0.5), (w * 0.8, h * 0.46), (w, 0.0)]
        rings.append([bm.verts.new((x + nx * o, y + ny * o, z)) for o, z in prof])
    for r0, r1 in zip(rings, rings[1:]):
        for i in range(len(r0) - 1):
            bm.faces.new((r0[i], r0[i + 1], r1[i + 1], r1[i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    rock = lib.mat("tp_cliffface", (0.34, 0.3, 0.26), 0.92, noise=0.55, noise_scale=2.2)
    lib._mesh_obj(name, bm, rock, root, (0, 0, 0), smooth=False, outline=True)
    for k in range(0, len(pts), 3):                       # broken rock on the face, on both sides
        x, y = pts[k]
        side = 1 if k % 2 else -1
        a, b = pts[max(0, k - 1)], pts[min(len(pts) - 1, k + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / L, dx / L
        z = rnd.uniform(0.6, 2.0)
        ico(f"{name}_jut{k}", rnd.uniform(0.3, 0.5), P["cliffdark"], root, loc=(x + nx * side * 0.75, y + ny * side * 0.75, z),
            subdiv=1, scale=(1.2, 0.8, 0.7))
    for k in range(0, len(pts), 2):                       # scree at the feet
        x, y = pts[k]
        a, b = pts[max(0, k - 1)], pts[min(len(pts) - 1, k + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / L, dx / L
        for side in (-1, 1):
            if rnd.random() < 0.6:
                ico(f"{name}_scr{k}{side}", rnd.uniform(0.14, 0.3), P["cliffdark"], root,
                    loc=(x + nx * side * rnd.uniform(1.0, 1.5), y + ny * side * rnd.uniform(1.0, 1.5), 0.08), subdiv=1, scale=(1, 1, 0.6))


# ---------------------------------------------------------------- the terrain tiles (art-v5): one cell each

def _mats():
    P = dict(rock=lib.mat("tp_rock", (0.48, 0.47, 0.44), 0.85, noise=0.4, noise_scale=6),
             cliffdark=lib.mat("tp_cliffdark", (0.3, 0.25, 0.2), 0.9, noise=0.4, noise_scale=5))
    return P


def trock(root, c, variant=0):
    """Blocked (1): a heap of boulders on one cell; variants 0-2 big, 3-5 smaller. Neighbouring cells make heaps and
    ridges."""
    P = _mats()
    rnd = random.Random(500 + variant)
    big = variant < 3
    _boulders("tr", 0.0, 0.0, P, root, rnd, n=4 if big else 3, size=1.4 if big else 1.1)


ARM_END = (2.8, 0.95)          # every arm's height and half-width at its two ends (metres)


def tcliff_post(root, c, variant=0):
    """Cliff (7): the rock mass on the cell's middle, where the arms to the neighbours meet: the arms' cross-section
    turned round the middle, a little taller and wider than an arm's end so it covers the join (and rounds off the
    line's two ends)."""
    import bmesh
    P = _mats()
    rnd = random.Random(600 + variant)
    rock = lib.mat("tp_cliffface", (0.34, 0.3, 0.26), 0.92, noise=0.55, noise_scale=2.2)
    h, w = ARM_END[0] + 0.15, ARM_END[1] + 0.05
    prof = [(w, 0.0), (w * 0.78, h * 0.5), (w * 0.62, h * 0.55), (w * 0.42, h * 0.97)]
    segs = 14
    bm = bmesh.new()
    rings = []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        j = rnd.uniform(1.0, 1.12)                # only outward: the post never falls inside an arm
        rings.append([bm.verts.new((r * j * math.cos(a), r * j * math.sin(a), z)) for r, z in prof])
    top = bm.verts.new((0.0, 0.0, h))
    for i in range(segs):
        r0, r1 = rings[i], rings[(i + 1) % segs]
        for k in range(len(prof) - 1):
            bm.faces.new((r0[k], r1[k], r1[k + 1], r0[k + 1]))
        bm.faces.new((r0[-1], r1[-1], top))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    lib._mesh_obj("tc_post", bm, rock, root, (0, 0, 0), smooth=False, outline=True)
    for k in range(3):
        a = rnd.uniform(0, 2 * math.pi)
        ico(f"tc_post_j{k}", rnd.uniform(0.3, 0.45), P["cliffdark"], root, loc=(0.85 * math.cos(a), 0.85 * math.sin(a), rnd.uniform(0.5, 1.8)),
            subdiv=1, scale=(1.2, 0.8, 0.7))


ARMS = {"E": ((-1.0, 0.0), (1.0, 0.0)), "S": ((0.0, 1.0), (0.0, -1.0)), "SE": ((-1.0, 1.0), (1.0, -1.0)),
        "SW": ((1.0, 1.0), (-1.0, -1.0))}       # render axes (+y north): from this cell's middle to the neighbour's


def tcliff_arm(root, c, variant=0, direction="E"):
    """Cliff (7): the rock face between a cliff cell and its neighbour to the E, S, SE or SW, its middle on the anchor
    (half-way between the two cells' middles); no taper at its ends, the posts cover the joins."""
    P = _mats()
    rnd = random.Random(700 + variant + 13 * list(ARMS).index(direction))
    a, b = ARMS[direction]
    _cliff(root, [a, b], P, rnd, taper_ends=False, name=f"tc_arm_{direction}", ends=ARM_END)


def _faces(name, polys, m, root, z):
    """Many small polygons as one mesh, all facing up."""
    import bmesh
    bm = bmesh.new()
    for pts in polys:
        area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
        if abs(area) < 1e-9:
            continue
        vs = [bm.verts.new((x, y, 0.0)) for x, y in pts]
        bm.faces.new(vs if area > 0 else list(reversed(vs)))
    return lib._mesh_obj(name, bm, m, root, (0, 0, z), smooth=False, outline=False)


def twater(root, c, variant=0, mask=15, plan=None):
    """Water (3, and 4, 5, 6 under the ford and the bridges): the tile on a cell corner for one mask of its four
    cells (common/terrain_tiles.py): the earth bank, the water, its lighter shallow rim and the darker deep."""
    plan = plan or {}
    bank = lib.mat("tw_bank", (0.17, 0.13, 0.08), 0.95, noise=0.3, noise_scale=8)
    rim = lib.mat("tw_rim", (0.05, 0.12, 0.16), 0.6, noise=0.1, noise_scale=3)
    deep = lib.mat("tw_deep", (0.015, 0.055, 0.1), 0.6, noise=0.08, noise_scale=3)
    _faces("tw_bank", plan.get("bank", []), bank, root, 0.006)
    _faces("tw_rim", plan.get("water", []), rim, root, 0.012)
    _faces("tw_deep", plan.get("deep", []), deep, root, 0.018)


def tford(root, c, variant=0):
    """Ford (4): over the water tiles, a cell of shallow water with stones and gravel showing."""
    rnd = random.Random(800 + variant)
    P = _mats()
    shallow = lib.mat("tp_shallow", (0.07, 0.15, 0.16), 0.65, noise=0.2, noise_scale=4)
    ground._poly("tf_water", [(-1.05, -1.05), (1.05, -1.05), (1.05, 1.05), (-1.05, 1.05)], shallow, root, 0.03)   # overlaps its neighbours
    for i in range(7):
        ico(f"tf_step{i}", rnd.uniform(0.15, 0.28), P["rock"], root, loc=(rnd.uniform(-0.8, 0.8), rnd.uniform(-0.8, 0.8), 0.05),
            subdiv=1, scale=(1, 1, 0.45), outline=False)


def tbridge_deck(root, c, variant=0, axis="ns"):
    """Bridge (5 north-south, 6 east-west): one cell of deck, the planks across the way, on posts in the water; on the
    ground layer (the rails are tbridge_rail)."""
    P = kit.palette("E")
    deck = lib.mat("tb_deck", (0.46, 0.33, 0.2), 0.8, noise=0.3, noise_scale=10)
    for i in range(5):                         # planks across the way, a hair apart
        t = -0.8 + i * 0.4
        if axis == "ns":
            box(f"tb_plank{i}", (2.0, 0.36, 0.08), deck, root, loc=(0, t, 0.4))
        else:
            box(f"tb_plank{i}", (0.36, 2.0, 0.08), deck, root, loc=(t, 0, 0.4))
    for sx in (-1, 1):                         # stringers under the planks, a pile under each
        if axis == "ns":
            box(f"tb_str{sx}", (0.16, 2.0, 0.18), P["beam"], root, loc=(sx * 0.7, 0, 0.27))
            cyl(f"tb_pile{sx}", 0.09, 0.2, P["beam"], root, loc=(sx * 0.7, 0, 0.0), segs=8)
        else:
            box(f"tb_str{sx}", (2.0, 0.16, 0.18), P["beam"], root, loc=(0, sx * 0.7, 0.27))
            cyl(f"tb_pile{sx}", 0.09, 0.2, P["beam"], root, loc=(0, sx * 0.7, 0.0), segs=8)


def tbridge_rail(root, c, variant=0, axis="x"):
    """A bridge's rail along one edge of a cell (its anchor the edge's middle): along x for an east-west bridge's
    north and south sides, along y for a north-south bridge's west and east sides."""
    P = kit.palette("E")
    for i in (-0.5, 0.5):                      # a post every metre along the whole bridge
        x, y = (i, 0.0) if axis == "x" else (0.0, i)
        cyl(f"tb_post{i}", 0.08, 1.2, P["beam"], root, loc=(x, y, 0.0), segs=8)
    box("tb_rail", (2.0, 0.1, 0.12) if axis == "x" else (0.1, 2.0, 0.12), P["beam"], root, loc=(0, 0, 1.05))
    box("tb_mid", (2.0, 0.08, 0.08) if axis == "x" else (0.08, 2.0, 0.08), P["beam"], root, loc=(0, 0, 0.65))


BUILDERS = {"tpatch": tpatch, "trock": trock, "tcliff_post": tcliff_post, "tcliff_arm": tcliff_arm,
            "twater": twater, "tford": tford, "tbridge_deck": tbridge_deck, "tbridge_rail": tbridge_rail}
