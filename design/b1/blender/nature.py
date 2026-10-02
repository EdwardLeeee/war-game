"""B1-04: resource points. One piece per cell, as in the sim (protocol.ts NodeKind: a tree per cell;
a gold mine is 2 x 2 node cells, berries 3 x 2, a crystal vein 2 x 2; each cell runs out on its own
and is walkable once it has: economy.ts deplete). So what is left of a cell is low.

  tree      variant 0-2, East (松, 曲松, 樟) or West (橡, 冷杉, 樺); state full / stump
  gold      variant 0-1; state full / mined (half) / depleted
  berry     variant 0-1; state full / depleted
  crystal   variant 0-1; state full / depleted
  forest    a 3 x 3 patch of trees, only for the occlusion test of a forest's edge
"""
import math
import random

import lib
from lib import box, cyl, ico, rod, sphere
import kit
import buildings as B1

FOOTPRINT = {"tree": (1, 1), "gold": (1, 1), "berry": (1, 1), "crystal": (1, 1), "forest": (3, 3)}


def _mats(c):
    P = kit.palette(c)
    P.update(
        leaf_e=lib.mat("leaf_e", (0.16, 0.32, 0.12), 0.75, noise=0.35, noise_scale=10, sheen=0.3),
        pine_e=lib.mat("pine_e", (0.1, 0.24, 0.14), 0.75, noise=0.35, noise_scale=14),
        leaf_w=lib.mat("leaf_w", (0.24, 0.36, 0.12), 0.75, noise=0.35, noise_scale=10, sheen=0.3),
        fir_w=lib.mat("fir_w", (0.08, 0.22, 0.15), 0.75, noise=0.3, noise_scale=14),
        birch=lib.mat("birch", (0.85, 0.83, 0.78), 0.8, noise=0.4, noise_scale=25),
        birchleaf=lib.mat("birchleaf", (0.42, 0.52, 0.18), 0.75, noise=0.35, noise_scale=10, sheen=0.3),
        berry=lib.mat("berry", (0.72, 0.08, 0.12), 0.35, sheen=0.4),
        bush=lib.mat("bush", (0.14, 0.3, 0.12), 0.8, noise=0.35, noise_scale=12, sheen=0.3),
        twig=lib.mat("twig", (0.3, 0.22, 0.15), 0.9),
        darkrock=lib.mat("darkrock", (0.2, 0.21, 0.24), 0.75, noise=0.4, noise_scale=6),
        vein=lib.mat("vein_crystal", (0.0, 0.5, 0.56), 0.15, emission=0.45),
        dullvein=lib.mat("vein_dull", (0.22, 0.42, 0.42), 0.4),
        gravel=lib.mat("gravel", (0.45, 0.42, 0.38), 0.95, noise=0.5, noise_scale=30),
    )
    return P


def _trunk(name, P, root, h, r=0.16, mat="bark", lean=(0, 0)):
    return rod(name, (0, 0, 0), (lean[0], lean[1], h), r, P[mat], parent=root, segs=10, r2=r * 0.6)


def _stump(root, P, seed):
    rnd = random.Random(seed)
    cyl("st_stump", 0.22, 0.38, P["bark"], root, segs=12, r2=0.2)
    cyl("st_top", 0.2, 0.02, P["logend"], root, loc=(0, 0, 0.38), segs=12, outline=False)
    for k in range(4):
        a = rnd.uniform(0, 2 * math.pi)
        box(f"st_chip{k}", (0.14, 0.06, 0.03), P["logend"], root, loc=(0.45 * math.cos(a), 0.45 * math.sin(a), 0.02),
            rot=(0, 0, rnd.uniform(0, 180)), outline=False)
    rod("st_root1", (0, 0, 0.05), (0.38, 0.1, 0.0), 0.06, P["bark"], parent=root, segs=6)
    rod("st_root2", (0, 0, 0.05), (-0.2, 0.32, 0.0), 0.06, P["bark"], parent=root, segs=6)


def tree(root, c, variant=0, state="full", seed=None):
    P = _mats(c)
    rnd = random.Random(100 + variant * 7 + (0 if c == "E" else 3) if seed is None else seed)
    if state == "stump":
        _stump(root, P, variant)
        return
    if c == "E":
        if variant == 0:          # 松: a straight pine, tiers of needles
            _trunk("tr_trunk", P, root, 2.4, 0.15)
            for k, (r, z) in enumerate(((1.05, 1.5), (0.85, 2.3), (0.62, 3.0), (0.38, 3.6))):
                cyl(f"tr_cone{k}", r, 1.1, P["pine_e"], root, loc=(0, 0, z), r2=0.05, segs=10)
        elif variant == 1:        # 曲松: a leaning pine with flat pads of needles
            _trunk("tr_trunk", P, root, 2.9, 0.16, lean=(0.45, 0.2))
            rod("tr_branch", (0.2, 0.1, 1.6), (-0.7, 0.2, 2.2), 0.08, P["bark"], parent=root, segs=6)
            for k, (x, y, z, r) in enumerate(((0.5, 0.2, 3.1, 0.85), (-0.75, 0.25, 2.35, 0.7), (0.9, -0.2, 2.2, 0.6),
                                              (0.2, 0.3, 3.65, 0.55))):
                B1.lumpy(f"tr_pad{k}", r, P["pine_e"], root, (x, y, z), seed=k + variant * 10, squash=0.38, amp=0.18)
        else:                     # 樟: a broad round crown
            _trunk("tr_trunk", P, root, 2.0, 0.18)
            for k, (x, y, z, r) in enumerate(((0, 0, 2.8, 1.1), (0.6, -0.3, 2.4, 0.8), (-0.6, 0.25, 2.5, 0.8),
                                              (0.1, 0.4, 3.3, 0.7))):
                B1.lumpy(f"tr_leaf{k}", r, P["leaf_e"], root, (x, y, z), seed=k + 30, amp=0.22)
    else:
        if variant == 0:          # 橡: a wide lumpy oak
            _trunk("tr_trunk", P, root, 1.9, 0.2)
            rod("tr_b1", (0, 0, 1.4), (0.6, -0.3, 2.2), 0.09, P["bark"], parent=root, segs=6)
            for k, (x, y, z, r) in enumerate(((0, 0, 2.9, 1.15), (0.75, -0.35, 2.45, 0.8), (-0.65, 0.3, 2.55, 0.85),
                                              (0.15, 0.45, 3.35, 0.7), (-0.25, -0.5, 2.3, 0.6))):
                B1.lumpy(f"tr_leaf{k}", r, P["leaf_w"], root, (x, y, z), seed=k + 50, amp=0.24)
        elif variant == 1:        # 冷杉: a narrow fir
            _trunk("tr_trunk", P, root, 1.2, 0.14)
            for k, (r, z) in enumerate(((0.95, 0.8), (0.8, 1.6), (0.62, 2.4), (0.42, 3.15), (0.22, 3.8))):
                cyl(f"tr_cone{k}", r, 1.0, P["fir_w"], root, loc=(0, 0, z), r2=0.03, segs=10)
        else:                     # 樺: white trunks, light crown
            for k, (dx, dy) in enumerate(((0.0, 0.0), (0.35, 0.25))):
                rod(f"tr_trunk{k}", (dx, dy, 0), (dx + 0.15, dy + 0.1, 3.2 - k * 0.5), 0.11, P["birch"], parent=root,
                    segs=8, r2=0.07)
            for k, (x, y, z, r) in enumerate(((0.1, 0.05, 3.2, 0.75), (0.5, 0.35, 2.7, 0.6), (-0.3, 0.1, 2.7, 0.55))):
                B1.lumpy(f"tr_leaf{k}", r, P["birchleaf"], root, (x, y, z), seed=k + 70, amp=0.24, squash=1.2)


def gold(root, c, variant=0, state="full"):
    """One gold-mine cell: a rock with gold veins and nuggets; mined: smaller; depleted: gravel."""
    P = _mats(c)
    rnd = random.Random(10 + variant)
    if state == "depleted":
        for k in range(8):
            B1.lumpy(f"go_grav{k}", rnd.uniform(0.15, 0.28), P["gravel"], root,
                     (rnd.uniform(-0.6, 0.6), rnd.uniform(-0.6, 0.6), 0.05), seed=k, squash=0.4)
        for k in range(3):
            ico(f"go_fleck{k}", 0.05, P["ore"], root, loc=(rnd.uniform(-0.5, 0.5), rnd.uniform(-0.5, 0.5), 0.08), subdiv=1,
                smooth=False, outline=False)
        return
    s = 1.0 if state == "full" else 0.65
    for k, (x, y, r) in enumerate(((0.0, 0.1, 0.75), (0.45, -0.35, 0.5), (-0.45, -0.3, 0.45), (0.3, 0.5, 0.45))):
        B1.lumpy(f"go_rock{k}", r * s, P["rock"], root, (x * s, y * s, r * s * 0.5), seed=k + variant * 5, squash=0.8)
    for k in range(int(10 * s)):
        a = rnd.uniform(-1.2, 2.4)
        z = rnd.uniform(0.25, 1.0) * s
        rr = 0.62 * s
        ico(f"go_gold{k}", rnd.uniform(0.09, 0.15), P["ore"], root,
            loc=(rr * math.cos(a) * 0.9 - 0.05, -rr * abs(math.sin(a)) * 0.8 - 0.05, z), subdiv=1, smooth=False)
    for k in range(3):
        ico(f"go_nug{k}", 0.1, P["ore"], root, loc=(-0.5 + k * 0.35, -0.8, 0.07), subdiv=1, smooth=False)


def berry(root, c, variant=0, state="full"):
    P = _mats(c)
    rnd = random.Random(20 + variant)
    if state == "depleted":
        for k in range(7):
            a = 2 * math.pi * k / 7
            rod(f"be_twig{k}", (0, 0, 0.05), (0.35 * math.cos(a), 0.35 * math.sin(a), rnd.uniform(0.25, 0.4)), 0.025,
                P["twig"], parent=root, segs=4)
        return
    for k, (x, y, z, r) in enumerate(((0, 0, 0.5, 0.6), (0.4, -0.25, 0.4, 0.45), (-0.4, 0.2, 0.42, 0.45),
                                      (0.1, 0.35, 0.65, 0.4))):
        B1.lumpy(f"be_bush{k}", r, P["bush"], root, (x, y, z), seed=k + variant * 9, amp=0.2, squash=0.85)
    for k in range(16):
        a = rnd.uniform(-math.pi * 0.9, math.pi * 0.2)
        z = rnd.uniform(0.3, 0.95)
        sphere(f"be_b{k}", 0.075, P["berry"], root, loc=(0.6 * math.cos(a), 0.6 * math.sin(a) - 0.05, z), segs=8, rings=6)


def crystal(root, c, variant=0, state="full"):
    P = _mats(c)
    if state == "depleted":
        B1.lumpy("cr_base", 0.55, P["darkrock"], root, (0, 0, 0.12), seed=variant, squash=0.35)
        kit.crystals("cr_stub", dict(P, crystal=P["dullvein"]), root, (0, 0, 0.15), size=0.35, n=4, seed=variant + 3)
        return
    B1.lumpy("cr_base", 0.7, P["darkrock"], root, (0, 0, 0.25), seed=variant, squash=0.55)
    kit.crystals("cr_main", dict(P, crystal=P["vein"]), root, (0.0, -0.05, 0.35), size=1.6, n=7, seed=variant + 1)
    kit.crystals("cr_side", dict(P, crystal=P["vein"]), root, (0.5, 0.3, 0.2), size=0.8, n=4, seed=variant + 9)


def forest(root, c, variant=0):
    """A 3 x 3 patch of trees: only for measuring how much a forest's edge hides."""
    for i in range(3):
        for j in range(3):
            g = lib.empty(f"fo_{i}{j}", parent=root, loc=((i - 1) * kit.CELL, (j - 1) * kit.CELL, 0))
            tree(g, c, variant=(i + j) % 3)


BUILDERS = {"tree": tree, "gold": gold, "berry": berry, "crystal": crystal, "forest": forest}
