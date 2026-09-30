"""R2 option B/C buildings: the R1 城樓 and West stone tower with more built detail.

B: eave rafters and brackets, real lattice windows, pillar bases, a name plaque,
   bevelled stones, corbels under the tower parapet, iron-banded door.
C: B + door studs, lanterns, ridge beasts, corner quoins, banner fringe.
"""
import math
import os
import random

import buildings as B1          # R1 builders (roof, banner, crenels, P)
import lib
from lib import box, cyl, lathe, mat, rod, sphere


def P2():
    P = B1.P()
    P.update(
        tile=mat("tile2", (0.19, 0.21, 0.25), 0.5, pattern="tiles", pattern_scale=3.2),
        brick=mat("brick2", (0.42, 0.39, 0.36), 0.88, pattern="brick", pattern_scale=3.0),
        stone=mat("stone_blk2", (0.52, 0.49, 0.45), 0.85, pattern="block", pattern_scale=1.2),
        red_post=mat("red_post2", (0.5, 0.1, 0.07), 0.4, noise=0.15, noise_scale=12),
        timber=mat("timber2", (0.24, 0.15, 0.08), 0.6, noise=0.3, noise_scale=10),
        gold=mat("gold_trim2", (0.85, 0.62, 0.22), 0.3, 1.0),
        iron=mat("iron2", (0.2, 0.2, 0.22), 0.45, 1.0, pattern="worn_metal"),
        plaque=mat("plaque2", (0.08, 0.1, 0.14), 0.4),
    )
    return P


def brackets(name, P, parent, x0, x1, y, z, n):
    """斗拱-like bracket sets under an eave: stacked blocks and arms."""
    for k in range(n):
        x = x0 + (x1 - x0) * k / max(1, n - 1)
        box(f"{name}{k}a", (0.16, 0.16, 0.1), P["timber"], parent, loc=(x, y, z))
        box(f"{name}{k}b", (0.42, 0.1, 0.07), P["red_post"], parent, loc=(x, y, z + 0.09))
        box(f"{name}{k}c", (0.12, 0.3, 0.07), P["timber"], parent, loc=(x, y - 0.08, z + 0.16))


def rafters(name, P, parent, x0, x1, y, z, n, length=0.7):
    for k in range(n):
        x = x0 + (x1 - x0) * k / max(1, n - 1)
        box(f"{name}{k}", (0.06, length, 0.06), P["timber"], parent, loc=(x, y - length / 2, z), rot=(-18, 0, 0))


def lattice(name, P, parent, cx, y, cz, w, h, nx=4, nz=5):
    box(name + "_frame", (w, 0.06, h), P["red_post"], parent, loc=(cx, y, cz))
    box(name + "_paper", (w - 0.08, 0.02, h - 0.08), mat("paper2", (0.85, 0.8, 0.66), 0.9), parent,
        loc=(cx, y - 0.03, cz))
    for i in range(1, nx):
        box(f"{name}_v{i}", (0.025, 0.03, h - 0.08), P["timber"], parent,
            loc=(cx - w / 2 + w * i / nx, y - 0.045, cz), outline=False)
    for i in range(1, nz):
        box(f"{name}_h{i}", (w - 0.08, 0.03, 0.025), P["timber"], parent,
            loc=(cx, y - 0.045, cz - h / 2 + h * i / nz), outline=False)


def citygate2(root, detail):
    P = P2()
    B1.citygate_e(root)            # R1 massing (walls, platform, hall, roofs, banners)
    top = next(o for o in root.children if o.name.startswith("cg_top"))
    # eaves: rafters and brackets under both roofs, front side
    rafters("cg_raf1", P, top, -3.1, 3.1, -1.8, 2.45, 16)
    brackets("cg_brk1", P, top, -2.6, 2.6, -1.62, 2.28, 6)
    rafters("cg_raf2", P, top, -2.1, 2.1, -1.2, 4.25, 12, 0.6)
    brackets("cg_brk2", P, top, -1.6, 1.6, -1.15, 4.12, 4)
    # real lattice windows on the hall and the upper hall
    for k in range(5):
        x = -2.32 + k * 1.16
        lattice(f"cg_lat2_{k}", P, top, x, -1.56, 1.35, 0.85, 1.4)
    for k in range(3):
        lattice(f"cg_ulat{k}", P, top, -1.3 + k * 1.3, -1.12, 3.55, 0.9, 1.0, nx=3, nz=3)
    # stone bases under the pillars
    for k in range(6):
        cyl(f"cg_base{k}", 0.19, 0.12, P["stone"], top, loc=(-2.9 + k * 1.16, -1.6, 0.25), segs=8)
    # the name plaque above the gate
    box("cg_plaque", (1.6, 0.08, 0.6), P["plaque"], root, loc=(0, -2.66, 3.25), bevel=0.02)
    box("cg_plaque_rim", (1.7, 0.06, 0.7), P["gold"], root, loc=(0, -2.63, 3.25))
    if detail == "C":
        for i in range(4):          # door studs
            for jz in range(5):
                for s in (-1, 1):
                    sphere(f"cg_stud{i}{jz}{s}", 0.035, P["gold"], root,
                           loc=(s * (0.2 + i * 0.18), -2.77, 0.4 + jz * 0.42), outline=False)
        for s in (-1, 1):           # hanging lanterns
            rod(f"cg_lanternrope{s}", (s * 2.0, -1.78, 2.45), (s * 2.0, -1.78, 2.05), 0.01, P["timber"], parent=top)
            sphere(f"cg_lantern{s}", 0.16, mat("lantern2", (0.75, 0.14, 0.06), 0.5, emission=0.6), top,
                   loc=(s * 2.0, -1.78, 1.88), scale=(1, 1, 1.25))
            box(f"cg_beast{s}", (0.14, 0.3, 0.22), P["tile"], top, loc=(s * 2.2, 0, 5.85), rot=(0, 0, 0))


def tower2(root, detail):
    P = P2()
    B1.tower_w(root)
    # corbels (machicolation) under the parapet on the two visible faces
    for k in range(6):
        x = -1.25 + k * 0.5
        box(f"tw2_corb{k}", (0.22, 0.3, 0.3), P["stone"], root, loc=(x, -1.55, 5.62), bevel=0.03)
        box(f"tw2_corbx{k}", (0.3, 0.22, 0.3), P["stone"], root, loc=(1.55, x, 5.62), bevel=0.03)
    # iron bands on the door, a stone frame round it
    for z in (0.9, 1.5, 2.0):
        box(f"tw2_band{z}", (0.95, 0.03, 0.07), P["iron"], root, loc=(-0.5, -1.56, z))
    for s in (-1, 1):
        box(f"tw2_jamb{s}", (0.16, 0.14, 1.8), P["stone"], root, loc=(-0.5 + s * 0.55, -1.52, 1.3), bevel=0.02)
    # arrow-slit frames
    for z in (2.2, 4.2):
        box(f"tw2_slitf{z}", (0.34, 0.08, 0.95), P["stone"], root, loc=(0, -1.47, z), bevel=0.02)
    if detail == "C":
        rnd = random.Random(5)
        for z in range(9):           # corner quoins, alternating
            for sx, sy in ((1.5, -1.5),):
                w = 0.5 if z % 2 else 0.34
                box(f"tw2_quoin{z}", (w, 0.34 if z % 2 else 0.5, 0.52), P["stone"], root,
                    loc=(sx - 0.1, sy + 0.1, 0.9 + z * 0.55), bevel=0.04, rot=(0, 0, rnd.uniform(-2, 2)))
        for k in range(6):
            rod(f"tw2_fringe{k}", (0.95 + k * 0.15, -0.95, 6.1 + 2.2 - 1.6), (0.95 + k * 0.15, -0.95, 6.1 + 2.2 - 1.7),
                0.01, P["gold"], parent=root, outline=False)


def build(kind, variant=0, detail="B"):
    import units2
    u = units2.Unit(kind)
    if kind == "citygate_e":
        citygate2(u.root, detail)
    elif kind == "tower_w":
        tower2(u.root, detail)
    else:
        B1.BUILDERS[kind](u.root, variant) if kind in ("tree", "rock", "tuft") else B1.BUILDERS[kind](u.root)
    u.pose = lambda anim, frame: None
    u.face = lambda facing: None
    return u


FRAME_M = B1.FRAME_M
