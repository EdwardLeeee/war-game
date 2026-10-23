"""D-100 drafts R8-36 (the user 2026-10-23 rejected the paved floor: 「我覺得看起還是不太對 而且那個陸是幹嘛的？」): the
small decorative pieces of two of the three directions for the inside of the walls, East (late Tang), in the R8 look.
Purely decorative (the sim does not see them), kept low (under 3 m) so the units among them stay visible.

B a lived-in town: hut_a (a rammed-earth hut, its long side to the camera, a thatch roof), hut_b (the same turned, its
  gable to the camera), shed (an open lean-to with firewood), well (a stone curb, a windlass frame), cart (a two-wheeled
  hand cart with sacks), stack (hay, jars and baskets).
C a garrison: tent_a, tent_b (ridge tents of hemp cloth, guy ropes and pegs), rack (spears and round shields in a rack),
  supplies (crates, sacks and jars stacked under a cloth), posts (straw training posts), flag (a tall banner pole in
  the owner's colour, for the parade ground).
"""
import math
import random

import lib
from lib import box, cyl, rod, sphere
import kit
from arch_r8 import prism, war_drum
from arch2_r8 import palette as _palette


def palette(c):
    P = _palette(c)
    P["canvas"] = lib.mat("tentcloth", (0.2, 0.18, 0.14), 0.9)      # hemp cloth, weathered: not white
    return P


def _thatch_roof(name, P, parent, cx, cy, z, w, d, rise, over=0.35, ridge="x"):
    """A two-slope thatch roof, thick and rounded at the eaves (arch_r8.gable_roof_w's thatch), low pitch for the East."""
    from arch_r8 import gable_roof_w
    pitch = math.degrees(math.atan2(rise, (d if ridge == "x" else w) / 2))
    return gable_roof_w(name, P, parent, cx, cy, z, w, d, pitch, over, "thatch", thick=0.28, round_eave=True, ridge=ridge)


def hut(root, c, turned=False):
    """A one-room hut of rammed earth on a low stone footing, a plank door and a small barred window, a thatch roof."""
    P = palette(c)
    w, d, h = (2.6, 1.9, 1.75) if not turned else (1.9, 2.6, 1.75)
    box("hu_foot", (w + 0.15, d + 0.15, 0.25), P["stone"], root, loc=(0, 0, 0.12))
    box("hu_walls", (w, d, h), P["earth"], root, loc=(0, 0, 0.25 + h / 2), taper=(0.97, 0.97))
    fy = -d / 2 - 0.02
    box("hu_door", (0.7, 0.06, 1.4), P["wood"], root, loc=(-0.3 if not turned else 0.0, fy, 0.25 + 0.7))
    if not turned:
        box("hu_win", (0.45, 0.06, 0.35), P["dark"], root, loc=(0.7, fy, 0.25 + 1.15))
        for k in range(4):
            box(f"hu_bar{k}", (0.03, 0.08, 0.35), P["wood"], root, loc=(0.56 + k * 0.09, fy - 0.01, 0.25 + 1.15))
    g, rise = _thatch_roof("hu_roof", P, root, 0, 0, 0.25 + h, w, d, 0.85, over=0.3, ridge="x" if not turned else "y")
    if turned:
        from arch_r8 import gable_fill_w
        gable_fill_w("hu_gf", P, root, 0, 0, 0.25 + h, w, d, rise, ridge="y", mat="earth", timber=False, under=0.85)
    else:
        from arch_r8 import gable_fill_w
        gable_fill_w("hu_gf", P, root, 0, 0, 0.25 + h, w, d, rise, ridge="x", mat="earth", timber=False, under=0.85)
    kit.pennant("hu_pen", P, root, (w / 2 - 0.1, -d / 2 + 0.1, 0.0), 2.6, w=0.45, fh=0.3)


def shed(root, c):
    """An open lean-to: four posts, a thatch slope falling to the back, firewood stacked under it, a chopping block."""
    P = palette(c)
    for x in (-1.1, 1.1):
        rod(f"sh_pf{x}", (x, -0.6, 0.0), (x, -0.6, 2.0), 0.07, P["wood"], parent=root, segs=7)
        rod(f"sh_pb{x}", (x, 0.6, 0.0), (x, 0.6, 1.5), 0.07, P["wood"], parent=root, segs=7)
    from arch2_r8 import _shed_roof_w, _log_pile
    _shed_roof_w("sh_roof", P, root, -1.35, 1.35, -0.85, 0.85, 2.05, 1.5, mat="thatch", thick=0.2)
    _log_pile("sh_wood", P, root, 0.0, 0.25, n_rows=3, length=1.9, r=0.09, seed=4)
    cyl("sh_block", 0.2, 0.4, P["logend"] if "logend" in P else P["wood"], root, loc=(0.9, -1.0, 0.0), segs=10)


def well(root, c):
    """A well: a round stone curb, a timber frame over it with a windlass and its rope, a wooden bucket on the curb."""
    P = palette(c)
    cyl("we_curb", 0.62, 0.65, P["stone"], root, segs=18)
    cyl("we_water", 0.48, 0.02, P["dark"], root, loc=(0, 0, 0.63), segs=18)
    for sx in (-1, 1):
        rod(f"we_post{sx}", (sx * 0.7, 0, 0.0), (sx * 0.62, 0, 1.75), 0.07, P["wood"], parent=root, segs=7)
    cyl("we_drum", 0.1, 1.2, P["wood"], root, loc=(-0.6, 0, 1.6), rot=(0, 90, 0), segs=10)
    rod("we_crank", (0.72, 0, 1.6), (0.72, -0.25, 1.4), 0.025, P["wood"], parent=root, segs=5)
    rod("we_rope", (0.0, 0, 1.6), (0.0, 0, 0.9), 0.012, P["rope"], parent=root, segs=4)
    cyl("we_bucket", 0.15, 0.25, P["wood"], root, loc=(0.4, -0.45, 0.65), r2=0.17, segs=10)
    box("we_roof", (1.6, 0.9, 0.06), P["thatch"], root, loc=(0, 0, 1.85), rot=(0, 0, 0))


def cart(root, c):
    """A two-wheeled hand cart, its shafts on the ground, a load of sacks."""
    P = palette(c)
    box("ca_bed", (1.5, 0.95, 0.12), P["wood"], root, loc=(0, 0, 0.62), rot=(0, -6, 0))
    for sy in (-1, 1):
        box(f"ca_side{sy}", (1.5, 0.05, 0.25), P["wood"], root, loc=(0, sy * 0.47, 0.78), rot=(0, -6, 0))
        cyl(f"ca_wheel{sy}", 0.5, 0.07, P["wood"], root, loc=(0.1, sy * 0.56, 0.5), rot=(90, 0, 0), at=(0, 0, -0.035), segs=16)
        rod(f"ca_shaft{sy}", (0.7, sy * 0.4, 0.62), (1.9, sy * 0.4, 0.05), 0.04, P["wood"], parent=root, segs=6)
    for k in range(4):
        kit.sack(f"ca_sack{k}", P, root, (-0.45 + (k % 2) * 0.5, -0.2 + (k // 2) * 0.4, 0.72), s=0.3, rot=k * 30)


def stack(root, c):
    """Hay, a row of tall storage jars, baskets."""
    P = palette(c)
    hay = lib.mat("hay", (0.36, 0.3, 0.15), 0.9)
    sphere("st_hay", 0.65, hay, root, loc=(-0.5, 0.15, 0.4), scale=(1, 0.9, 0.75))
    for k in range(3):
        cyl(f"st_jar{k}", 0.2, 0.62, P["brick"], root, loc=(0.45 + k * 0.32, -0.25, 0.0), r2=0.14, segs=12)
    for k in range(2):
        cyl(f"st_bk{k}", 0.2, 0.28, lib.mat("straw", (0.42, 0.35, 0.18), 0.9), root, loc=(0.3 + k * 0.45, 0.4, 0.0), r2=0.24, segs=12)


def tent(root, c, turned=False):
    """A ridge tent of hemp cloth on two poles and a ridge pole, its walls pegged out, the door flap tied back, guy ropes."""
    P = palette(c)
    cloth = P["canvas"]
    L, W, H = 2.8, 2.2, 2.1
    ax = "x" if not turned else "y"
    pts = [(-W / 2, 0.0), (W / 2, 0.0), (W / 2 - 0.1, 0.55), (0.0, H), (-W / 2 + 0.1, 0.55)]
    ob = prism("te_body", cloth, root, pts, -L / 2, L / 2)
    if not turned:
        ob.rotation_euler = (0, 0, math.radians(90))
    for e in (-1, 1):
        x, y = ((e * L / 2, 0) if not turned else (0, e * L / 2))
        rod(f"te_pole{e}", (x * 1.02, y * 1.02, 0.0), (x * 1.02, y * 1.02, H + 0.2), 0.035, P["wood"], parent=root, segs=6)
    fx, fy = (0, -W / 2 - 0.01) if not turned else (0, -L / 2 - 0.01)
    box("te_door", (0.6, 0.03, 1.2), P["dark"], root, loc=(fx, fy, 0.6))
    for k, (dx, dy) in enumerate(((-1, -1), (1, -1), (-1, 1), (1, 1))):
        a = (dx * (L / 2 if not turned else W / 2), dy * (W / 2 if not turned else L / 2))
        rod(f"te_guy{k}", (a[0] * 1.0, a[1] * 1.0, 0.55), (a[0] * 1.35, a[1] * 1.35, 0.0), 0.008, P["rope"], parent=root, segs=4)
    kit.pennant("te_pen", P, root, ((L / 2 + 0.05) if not turned else 0.0, 0.0 if not turned else (L / 2 + 0.05), 0.0), H + 0.6,
                w=0.5, fh=0.35)


def rack(root, c):
    """A weapon rack of spears with red tassels, round shields leaning against it."""
    P = palette(c)
    kit.weapon_rack("ra", P, root, (0, 0, 0), axis="x", n=6, east=True)
    for k in range(3):
        g = lib.empty(f"ra_sh{k}", parent=root, loc=(-0.5 + k * 0.5, -0.35, 0.42), rot=(70, 0, 0))
        cyl(f"ra_shield{k}", 0.38, 0.05, P["red"] if k % 2 else P["wood"], g, segs=18)
        cyl(f"ra_boss{k}", 0.08, 0.06, P["gold"], g, loc=(0, 0, 0.05), segs=10)


def supplies(root, c):
    """Supplies: crates, sacks and jars, half under a cloth tied down."""
    P = palette(c)
    for k, (x, y, z) in enumerate(((-0.45, 0.0, 0.0), (0.2, 0.05, 0.0), (-0.12, 0.05, 0.6))):
        kit.crate(f"su_cr{k}", P, root, (x, y, z), s=0.6, rot=k * 8)
    for k in range(4):
        kit.sack(f"su_sk{k}", P, root, (0.8 + (k % 2) * 0.35, -0.3 + (k // 2) * 0.35, 0.0), s=0.32, rot=k * 40)
    cloth = P["canvas"]
    box("su_cloth", (1.1, 0.75, 0.05), cloth, root, loc=(-0.12, 0.05, 1.22), rot=(0, 4, 2))


def posts(root, c):
    """Two straw training posts."""
    P = palette(c)
    P["straw"] = lib.mat("straw", (0.42, 0.35, 0.18), 0.9)
    P["sack"] = lib.mat("sack", (0.38, 0.32, 0.22), 0.95)
    kit.dummy("po_a", P, root, (-0.5, 0.0))
    kit.dummy("po_b", P, root, (0.6, 0.3))


def flag(root, c):
    """The parade ground's banner: a tall pole, a long banner in the owner's colour, the war drum beside it."""
    P = palette(c)
    kit.flag("fl", P, root, (0.0, 0.0, 0.0), 5.5, c, w=1.2, fh=1.8)
    war_drum("fl_drum", P, root, 0.9, -0.4, r=0.32, h=0.45)


BUILD = {"hut_a": lambda r, c: hut(r, c, False), "hut_b": lambda r, c: hut(r, c, True), "shed": shed, "well": well,
         "cart": cart, "stack": stack, "tent_a": lambda r, c: tent(r, c, False), "tent_b": lambda r, c: tent(r, c, True),
         "rack": rack, "supplies": supplies, "posts": posts, "flag": flag}


def r8_decor(root, c, piece="hut_a"):
    BUILD[piece](root, c)


FOOTPRINT = {"r8_decor": (1, 1)}
BUILDERS = {"r8_decor": r8_decor}
