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

FOOTPRINT = {"tpatch": (1, 1)}


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
        # one escarpment along the line: broken blocks of rock face, strata, scree at its foot
        segs = list(zip(line, line[1:]))
        for k, ((x0, y0), (x1, y1)) in enumerate(segs):
            L = math.hypot(x1 - x0, y1 - y0)
            ang = math.degrees(math.atan2(y1 - y0, x1 - x0))
            n = max(2, int(L / 0.9))
            for i in range(n):
                t = (i + 0.5) / n
                x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
                h = rnd.uniform(2.6, 3.4)
                # tall weathered rock, not blocks: stretched, overlapping boulders
                ico(f"tp_cl{k}_{i}", 0.8, P["cliff"], root, loc=(x, y, h * 0.42), subdiv=2,
                    scale=(rnd.uniform(0.9, 1.15), rnd.uniform(0.85, 1.05), h / 1.55), rot=(0, 0, ang + rnd.uniform(-20, 20)))
            for i in range(n):
                t = rnd.random()
                _boulders(f"tp_scree{k}_{i}", x0 + (x1 - x0) * t + rnd.uniform(-0.3, 0.3), y0 + (y1 - y0) * t - 1.1, P, root, rnd,
                          n=2, size=0.55, mat=P["cliffdark"])
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


BUILDERS = {"tpatch": tpatch}
