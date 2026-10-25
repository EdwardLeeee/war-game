"""D-101 市場 (Market, 3x3 = 6 m x 6 m): R8-38's drafts, in the R8 look (arch_r8.py, arch2_r8.py), after
research/market-reference (notes.md 先講結論, 五). The player trades left-over food or wood for gold, so every option
carries the three: grain (sacks, tubs), wood (bundles, logs) and money (strings of cash and silver ingots in the East;
a money-changer's table, coin heaps and purses in the West). The front faces the camera (-y); the owner's colour on
cloth (banners, hangings, awnings).

  option A  East 市的一角   a stretch of low rammed-earth wall with a 烏頭門 (two posts, black caps, a lintel), two stall
                            sheds inside, the drum that opens the market, a steelyard tripod and goods outside
            West 市場棚     a small timber market hall on stone pads under a steep roof, trestle stalls inside, grain tubs,
                            sacks, barrels and a beam scale at its front corner
  option B  East 邸店院     a storehouse (邸) at the back, an open shop (店) with a counter of cash and silver in front, a
                            steelyard weighing a sack in the yard, firewood, logs, a ledger table
            West 市場十字   a stepped market cross in the middle, trestle stalls under cloth awnings round it, a
                            money-changer's table (a chequered cloth, coin heaps, a balance)
"""
import math
import random

import lib
from lib import box, cyl, rod, sphere
import kit
from arch_r8 import CELL, tang_roof, war_drum, rammed_wall_e, gable_roof_w
from arch2_r8 import palette as _palette, _log_pile, _posts, _shed_roof_w


def palette(c):
    P = _palette(c)
    m = lib.mat
    P.update(
        silver=m("silver_ingot", (0.6, 0.6, 0.58), 0.3, 1.0),
        cash=m("cash_bronze", (0.22, 0.16, 0.08), 0.45, 1.0),
        coin_w=m("coin_silver", (0.66, 0.64, 0.6), 0.28, 1.0),
        purse=m("purse", (0.3, 0.2, 0.12), 0.8),
        grain=m("grain", (0.55, 0.45, 0.24), 0.95, noise=0.3, noise_scale=40),
        check_a=m("check_dark", (0.08, 0.16, 0.1), 0.85),
        check_b=m("check_pale", (0.55, 0.52, 0.44), 0.85),
        black=m("wutou_black", (0.03, 0.03, 0.03), 0.5),
    )
    return P


# ---------------------------------------------------------------- the goods (both cultures)

def sacks(name, P, parent, x, y, n=5, seed=1, s=0.3):
    """Grain sacks in a heap: a row on the ground and a few on top."""
    rnd = random.Random(seed)
    for k in range(n):
        row, i = (0, k) if k < (n + 1) // 2 else (1, k - (n + 1) // 2)
        kit.sack(f"{name}{k}", P, parent, (x + (i - 0.5 * (n // 2)) * s * 1.6 + row * s * 0.8, y + rnd.uniform(-0.08, 0.08),
                                           row * s * 1.05), s=s, rot=rnd.uniform(0, 90))


def firewood(name, P, parent, x, y, n=3):
    """Bundles of firewood (柴), tied in the middle, stacked."""
    for k in range(n):
        bx, bz = x + (k % 2) * 0.45 - 0.2, (k // 2) * 0.32
        for j in range(7):
            a = 2 * math.pi * j / 7
            rod(f"{name}{k}_{j}", (bx + 0.12 * math.cos(a), y - 0.5, 0.17 + bz + 0.12 * math.sin(a)),
                (bx + 0.12 * math.cos(a), y + 0.5, 0.17 + bz + 0.12 * math.sin(a)), 0.035, P["wood"], parent=parent, segs=5)
        cyl(f"{name}{k}_tie", 0.17, 0.05, P["rope"], parent, loc=(bx, y, 0.17 + bz), rot=(90, 0, 0), at=(0, 0, -0.025), segs=10)


def steelyard(name, P, parent, x, y, h=2.5, load=True):
    """A big steelyard (大桿秤) on a tripod of poles: the beam on a rope from the apex, a hook and a sack at the short
    end, the counterpoise on the long end."""
    apex = (x, y, h)
    for k in range(3):
        a = math.radians(90 + 120 * k)
        rod(f"{name}_leg{k}", (x + 0.9 * math.cos(a), y + 0.9 * math.sin(a), 0.0), apex, 0.045, P["wood"], parent=parent, segs=6)
    zb = h - 0.75
    rod(f"{name}_rope", apex, (x, y, zb), 0.012, P["rope"], parent=parent, segs=4)
    rod(f"{name}_beam", (x - 0.45, y - 0.15, zb), (x + 1.25, y - 0.15, zb + 0.06), 0.035, P["wood"], parent=parent, segs=6)
    rod(f"{name}_hook", (x - 0.42, y - 0.15, zb), (x - 0.42, y - 0.15, zb - 0.55), 0.012, P["rope"], parent=parent, segs=4)
    if load:
        kit.sack(f"{name}_load", P, parent, (x - 0.42, y - 0.15, zb - 1.05), s=0.3, rot=20)
    rod(f"{name}_wcord", (x + 1.0, y - 0.15, zb + 0.05), (x + 1.0, y - 0.15, zb - 0.3), 0.01, P["rope"], parent=parent, segs=4)
    sphere(f"{name}_weight", 0.11, P["iron"], parent, loc=(x + 1.0, y - 0.15, zb - 0.38), scale=(1, 1, 1.2), segs=10, rings=7)


def table(name, P, parent, x, y, w=1.8, d=0.7, h=0.8, top=None):
    box(f"{name}_top", (w, d, 0.06), P[top or "wood"], parent, loc=(x, y, h - 0.03))
    for sx in (-1, 1):                              # trestles
        for sy in (-1, 1):
            rod(f"{name}_l{sx}{sy}", (x + sx * (w / 2 - 0.15), y + sy * (d / 2 - 0.02), 0.0),
                (x + sx * (w / 2 - 0.15), y + sy * 0.05, h - 0.06), 0.03, P["wood"], parent=parent, segs=5)
    return h


def cash_and_silver(name, P, parent, x, y, z):
    """Strings of bronze cash (貫, a long roll each) and silver ingots (銀鋌, flat bars) on a counter."""
    for k in range(3):
        cyl(f"{name}_cash{k}", 0.035, 0.42, P["cash"], parent, loc=(x - 0.45 + k * 0.1, y, z + 0.035), rot=(0, 90, 0),
            at=(0, 0, -0.21), segs=10)
    for k in range(3):
        box(f"{name}_ingot{k}", (0.3, 0.08, 0.03), P["silver"], parent, loc=(x + 0.25, y - 0.12 + k * 0.1, z + 0.015 + (k == 1) * 0.03),
            bevel=0.01, taper=(0.9, 0.85))
    box(f"{name}_chest", (0.45, 0.32, 0.3), P["timber"], parent, loc=(x + 0.25, y + 0.2, z + 0.15), bevel=0.02)


def grain_tub(name, P, parent, x, y, r=0.55, h=0.85):
    """An open grain tub (糧桶), staved and hooped, heaped with grain."""
    cyl(name, r, h, P["wood"], parent, loc=(x, y, 0.0), r2=r * 1.05, segs=18)
    for z in (0.15, h - 0.15):
        cyl(f"{name}_hoop{z}", r * 1.04, 0.05, P["iron"], parent, loc=(x, y, z), segs=18)
    sphere(f"{name}_grain", r * 0.95, P["grain"], parent, loc=(x, y, h - 0.05), scale=(1, 1, 0.25), segs=16, rings=8)


# ---------------------------------------------------------------- East

def wutou_gate(name, P, parent, x, y, w=2.4, h=2.5):
    """烏頭門 (營造法式 卷三十二; market-reference 04): two posts with black caps standing above a lintel, two leaves with a
    vertical lattice above and boards below, standing open."""
    for sx in (-1, 1):
        px = x + sx * w / 2
        box(f"{name}_post{sx}", (0.26, 0.26, h + 0.55), P["red"], parent, loc=(px, y, (h + 0.55) / 2), bevel=0.02)
        cyl(f"{name}_cap{sx}", 0.17, 0.32, P["black"], parent, loc=(px, y, h + 0.55), segs=12)
        cyl(f"{name}_tip{sx}", 0.1, 0.18, P["black"], parent, loc=(px, y, h + 0.87), r2=0.0, segs=8)
        box(f"{name}_base{sx}", (0.5, 0.5, 0.25), P["stone"], parent, loc=(px, y, 0.12), bevel=0.03)
    box(f"{name}_lintel", (w + 0.7, 0.22, 0.24), P["red"], parent, loc=(x, y, h), bevel=0.02)
    for k, sx in enumerate((-1, 1)):                # the leaves, swung half open into the market
        g = lib.empty(f"{name}_leaf{k}", parent=parent, loc=(x + sx * (w / 2 - 0.1), y, 0.0), rot=(0, 0, sx * 70))
        lw = w / 2 - 0.12
        box(f"{name}_lf{k}", (lw, 0.06, h * 0.42), P["wood"], g, loc=(-sx * lw / 2, 0, h * 0.21 + 0.05))
        box(f"{name}_lr{k}", (lw, 0.07, 0.08), P["wood"], g, loc=(-sx * lw / 2, 0, h - 0.18))
        for j in range(7):
            box(f"{name}_lb{k}{j}", (0.035, 0.05, h * 0.5), P["wood"], g,
                loc=(-sx * (0.08 + j * (lw - 0.16) / 6), 0, h * 0.42 + h * 0.25))


def stall_shed_e(name, P, parent, cx, cy, w, d, h_front, h_back, team_hang=True):
    """An open stall shed (偏廂, 涼棚): posts, a single slope of reed mats falling to the back, a counter under it, the
    owner's cloth sign (幌子) hanging from the front eave."""
    xs = (cx - w / 2 + 0.1, cx + w / 2 - 0.1)
    for x in xs:
        rod(f"{name}_pf{x:.1f}", (x, cy - d / 2, 0.0), (x, cy - d / 2, h_front), 0.07, P["red"], parent=parent, segs=8)
        rod(f"{name}_pb{x:.1f}", (x, cy + d / 2, 0.0), (x, cy + d / 2, h_back), 0.07, P["red"], parent=parent, segs=8)
    box(f"{name}_lin", (w, 0.12, 0.14), P["timber"], parent, loc=(cx, cy - d / 2, h_front - 0.07))
    _shed_roof_w(f"{name}_roof", P, parent, cx - w / 2 - 0.3, cx + w / 2 + 0.3, cy - d / 2 - 0.45, cy + d / 2 + 0.2,
                 h_front + 0.05, h_back + 0.05, mat="thatch", thick=0.14)     # a reed-mat slope (蓆頂)
    g = lib.empty(name + "_blk", parent=parent, loc=(cx, cy, 0.0))
    g["block"] = [cx, cy, w, d, 0.0, h_front]
    if team_hang:
        kit.drape(f"{name}_sign", P, parent, "y", cx + w / 2 - 0.45, h_front - 0.12, 0.42, 1.05, y0=cy - d / 2 - 0.02)


def east_a(root, P):
    """市的一角: the corner of a walled market (唐六典: the market walled, its gates, the drum at noon), 6 m of it."""
    kit.pad("mk_pad", P, root, 3 * CELL, 3 * CELL, h=0.06, material="earth")
    rammed_wall_e("mk_wall_b1", P, root, -2.9, 2.6, -1.6, 2.6, 1.9, t=0.45)
    rammed_wall_e("mk_wall_b2", P, root, 1.0, 2.6, 2.9, 2.6, 1.9, t=0.45)
    rammed_wall_e("mk_wall_r", P, root, 2.7, 2.6, 2.7, 0.2, 1.9, t=0.45)
    wutou_gate("mk_gate", P, root, -0.3, 2.6, w=2.4, h=2.5)
    stall_shed_e("mk_shed1", P, root, 1.35, 1.55, 2.4, 1.6, 2.15, 1.75)
    stall_shed_e("mk_shed2", P, root, -1.75, -0.2, 2.2, 1.5, 2.05, 1.7)
    table("mk_t1", P, root, 1.35, 1.25, w=1.9, d=0.6)
    cash_and_silver("mk_cash", P, root, 1.35, 1.25, 0.8)
    table("mk_t2", P, root, -1.75, -0.45, w=1.7, d=0.6)
    for k in range(3):                                  # 斗 measures of grain on the second counter
        box(f"mk_dou{k}", (0.28, 0.28, 0.2), P["wood"], root, loc=(-2.3 + k * 0.45, -0.45, 0.9), taper=(1.2, 1.2))
        sphere(f"mk_dg{k}", 0.15, P["grain"], root, loc=(-2.3 + k * 0.45, -0.45, 1.0), scale=(1, 1, 0.45), segs=10, rings=6)
    war_drum("mk_drum", P, root, -2.25, 1.75, r=0.4, h=0.95)
    steelyard("mk_yard", P, root, 0.75, -1.35)
    sacks("mk_sacks", P, root, 1.7, -2.15, n=5, seed=3)
    firewood("mk_wood", P, root, 2.45, -0.6, n=3)
    _log_pile("mk_logs", P, root, -0.9, -2.3, n_rows=2, length=2.3, r=0.13, seed=5)
    kit.pennant("mk_pen", P, root, (-1.6, 2.35, 0.0), 4.2, w=0.9, fh=0.55)


def east_b(root, P):
    """邸店院: a merchant's yard (唐律疏議 邸店; the 926 edict: grain and firewood through brokers) — the storehouse at the
    back, the shop with its counter in front, the weighing in the yard."""
    kit.pad("mk_pad", P, root, 3 * CELL, 3 * CELL, h=0.06, material="earth")
    # the storehouse (邸): rammed-earth walls, a plank door, a 懸山 tile roof
    box("mk_di", (4.4, 1.7, 2.2), P["earth"], root, loc=(-0.5, 1.95, 1.1), bevel=0.04, taper=(0.99, 0.97))
    box("mk_di_door", (1.0, 0.06, 1.7), P["wood"], root, loc=(-0.9, 1.08, 0.88))
    for k, x in enumerate((-2.1, 0.6)):
        box(f"mk_di_vent{k}", (0.3, 0.06, 0.25), P["dark"], root, loc=(x, 1.08, 1.75))
    tang_roof("mk_di_roof", P, root, -0.5, 1.95, 2.2, 4.4, 1.7, 0.85, 0.45, kind="xuanshan", lift=0.0, chiwei=False,
              tile_amp=0.028)
    g = lib.empty("mk_di_blk", parent=root, loc=(-0.5, 1.95, 0.0))
    g["block"] = [-0.5, 1.95, 4.4, 1.7, 0.0, 2.2]
    # the shop (店): an open shed with a counter facing the street
    stall_shed_e("mk_shop", P, root, -1.4, -0.75, 2.8, 1.6, 2.2, 1.85)
    box("mk_counter", (2.4, 0.5, 0.9), P["timber"], root, loc=(-1.4, -1.35, 0.45), bevel=0.02)
    cash_and_silver("mk_cash", P, root, -1.4, -1.35, 0.9)
    # the yard: the steelyard, sacks waiting to be weighed, firewood, logs, the clerk's ledger table
    steelyard("mk_yard", P, root, 1.35, -0.35)
    sacks("mk_sacks", P, root, 1.5, -2.1, n=6, seed=7)
    firewood("mk_wood", P, root, 2.45, 1.2, n=4)
    _log_pile("mk_logs", P, root, 1.8, 0.55, n_rows=2, length=1.6, r=0.12, axis="x", seed=9)
    table("mk_ledger", P, root, 0.15, -2.2, w=0.9, d=0.5, h=0.6)
    box("mk_book", (0.3, 0.22, 0.05), P["check_b"], root, loc=(0.15, -2.2, 0.63))
    kit.pennant("mk_pen", P, root, (2.6, -1.9, 0.0), 3.6, w=0.85, fh=0.5)


# ---------------------------------------------------------------- West

def beam_scale(name, P, parent, x, y, h=2.2):
    """A public beam scale: a post, a beam across its top, a pan on chains at each end, a sack on one."""
    box(f"{name}_post", (0.18, 0.18, h), P["timber"], parent, loc=(x, y, h / 2))
    box(f"{name}_foot", (0.6, 0.6, 0.12), P["stone"], parent, loc=(x, y, 0.06))
    rod(f"{name}_beam", (x - 0.85, y - 0.12, h - 0.1), (x + 0.85, y - 0.12, h - 0.05), 0.035, P["iron"], parent=parent, segs=6)
    for k, sx in enumerate((-1, 1)):
        for j in range(3):
            a = 2 * math.pi * j / 3
            rod(f"{name}_ch{k}{j}", (x + sx * 0.82, y - 0.12, h - 0.1), (x + sx * 0.82 + 0.2 * math.cos(a), y - 0.12 + 0.2 * math.sin(a), 0.75),
                0.008, P["iron"], parent=parent, segs=3)
        cyl(f"{name}_pan{k}", 0.24, 0.05, P["iron"], parent, loc=(x + sx * 0.82, y - 0.12, 0.72), segs=14)
    kit.sack(f"{name}_load", P, parent, (x - 0.82, y - 0.12, 0.76), s=0.24, rot=30)


def money_table(name, P, parent, x, y):
    """The money-changer's table (Chartres windows 105, 106): a chequered cloth, heaps of coin, purses, a balance."""
    h = table(name, P, parent, x, y, w=1.6, d=0.75, h=0.82)
    n_x, n_y = 6, 3
    for i in range(n_x):
        for j in range(n_y):
            box(f"{name}_ch{i}{j}", (1.5 / n_x, 0.7 / n_y, 0.012), P["check_a" if (i + j) % 2 else "check_b"], parent,
                loc=(x - 0.75 + (i + 0.5) * 1.5 / n_x, y - 0.35 + (j + 0.5) * 0.7 / n_y, h + 0.006))
    for k, (dx, dy) in enumerate(((-0.5, -0.1), (-0.15, 0.12), (0.2, -0.12))):
        cyl(f"{name}_heap{k}", 0.1, 0.06, P["coin_w"], parent, loc=(x + dx, y + dy, h + 0.012), r2=0.05, segs=12)
    for k in range(2):
        sphere(f"{name}_purse{k}", 0.1, P["purse"], parent, loc=(x + 0.5 + k * 0.18, y + 0.15, h + 0.09), scale=(1, 1, 1.2),
               segs=10, rings=7)
    box(f"{name}_bpost", (0.04, 0.04, 0.35), P["timber"], parent, loc=(x + 0.45, y - 0.15, h + 0.18))
    rod(f"{name}_bbeam", (x + 0.3, y - 0.15, h + 0.34), (x + 0.6, y - 0.15, h + 0.34), 0.01, P["iron"], parent=parent, segs=4)
    for k, dx in enumerate((0.3, 0.6)):
        cyl(f"{name}_bpan{k}", 0.06, 0.012, P["iron"], parent, loc=(x + dx, y - 0.15, h + 0.17), segs=10)
    box(f"{name}_chest", (0.5, 0.35, 0.35), P["timber"], parent, loc=(x + 0.95, y + 0.4, 0.175), bevel=0.02)


def west_a(root, P):
    """市場棚: a small timber market hall (Plouescat, Dives: later, the structure only), its posts on stone pads, a steep
    roof; stalls under it, the grain, wine and wood round it, the beam scale at its corner."""
    kit.pad("mk_pad", P, root, 3 * CELL, 3 * CELL, h=0.06, material="earth")
    cx, cy, w, d, hp = 0.0, 0.55, 5.0, 3.4, 2.1
    xs = (-w / 2, 0.0, w / 2)
    ys = (cy - d / 2, cy + d / 2)
    for x in xs:
        for y in ys:
            box(f"mk_pad{x:.1f}{y:.1f}", (0.45, 0.45, 0.35), P["stone"], root, loc=(x, y, 0.175), bevel=0.04)
            box(f"mk_post{x:.1f}{y:.1f}", (0.24, 0.24, hp - 0.35), P["timber"], root, loc=(x, y, 0.35 + (hp - 0.35) / 2))
            for sx in (-1, 1):                       # knee braces along the length
                if abs(x + sx * 0.7) <= w / 2 + 0.01:
                    rod(f"mk_br{x:.1f}{y:.1f}{sx}", (x, y, hp - 0.7), (x + sx * 0.7, y, hp - 0.05), 0.06, P["timber"], parent=root,
                        segs=5)
    for y in ys:
        box(f"mk_plate{y:.1f}", (w + 0.3, 0.26, 0.24), P["timber"], root, loc=(cx, y, hp + 0.12))
    for x in xs:
        box(f"mk_tie{x:.1f}", (0.22, d + 0.3, 0.22), P["timber"], root, loc=(x, cy, hp + 0.12))
    g = lib.empty("mk_hall_blk", parent=root, loc=(cx, cy, 0.0))
    g["block"] = [cx, cy, w, d, 0.0, hp]
    gable_roof_w("mk_roof", P, root, cx, cy, hp + 0.24, w, d, 52, 0.45, "tile", thick=0.1)
    table("mk_t1", P, root, -1.3, cy + 0.6, w=1.8)
    table("mk_t2", P, root, 1.3, cy + 0.6, w=1.8)
    for k in range(4):                                # cloth bolts and baskets on the stalls
        box(f"mk_bolt{k}", (0.35, 0.5, 0.18), P["canvas"], root, loc=(-1.9 + k * 0.4, cy + 0.6, 0.89))
    sacks("mk_s_in", P, root, 1.0, cy + 0.65, n=3, seed=2, s=0.26)
    grain_tub("mk_tub1", P, root, -1.6, -1.55)
    grain_tub("mk_tub2", P, root, -0.4, -1.85, r=0.45, h=0.7)
    sacks("mk_sacks", P, root, 0.85, -2.2, n=5, seed=4)
    for k in range(2):
        kit.barrel(f"mk_barrel{k}", P, root, (2.55, 1.0 + k * 0.62, 0.0), r=0.3, h=0.88)
    _log_pile("mk_logs", P, root, 1.95, 2.55, n_rows=2, length=2.0, r=0.12, seed=6)
    beam_scale("mk_scale", P, root, 2.05, -1.3)
    kit.drape("mk_hang1", P, root, "y", -1.25, hp - 0.05, 0.9, 0.75, y0=cy - d / 2 - 0.15, tails=False)
    kit.drape("mk_hang2", P, root, "y", 1.25, hp - 0.05, 0.9, 0.75, y0=cy - d / 2 - 0.15, tails=False)
    kit.pennant("mk_pen", P, root, (-2.7, -2.3, 0.0), 3.8, w=0.85, fh=0.5)


def awning_stall(name, P, parent, cx, cy, w=2.0, d=1.2, h=2.0):
    """A trestle stall under a sloping cloth awning in the owner's colour, on two front poles."""
    table(name + "_t", P, parent, cx, cy, w=w - 0.2, d=0.7)
    for sx in (-1, 1):
        rod(f"{name}_pf{sx}", (cx + sx * w / 2, cy - d / 2, 0.0), (cx + sx * w / 2, cy - d / 2, h), 0.045, P["wood"], parent=parent,
            segs=6)
        rod(f"{name}_pb{sx}", (cx + sx * w / 2, cy + d / 2, 0.0), (cx + sx * w / 2, cy + d / 2, h + 0.45), 0.045, P["wood"],
            parent=parent, segs=6)
    a = math.degrees(math.atan2(0.45, d))
    box(f"{name}_cloth", (w + 0.2, math.hypot(d, 0.45) + 0.2, 0.04), P["team"], parent, loc=(cx, cy, h + 0.24), rot=(a, 0, 0))
    box(f"{name}_valance", (w + 0.2, 0.03, 0.25), P["team"], parent, loc=(cx, cy - d / 2 - 0.1, h - 0.05))
    g = lib.empty(name + "_tag", parent=parent, loc=(cx, cy, h))  # a roof for the states: build3 frames it, damaged burns it
    g["roof"] = [cx, cy, h, w, d, 0.45, 0.1, 0]


def market_cross(name, P, parent, x, y):
    """A market cross (Lydney, market-reference 17): three square steps, a socket, a tapering shaft, a small cross head."""
    for k, s in enumerate((2.3, 1.7, 1.1)):
        box(f"{name}_step{k}", (s, s, 0.3), P["stone"], parent, loc=(x, y, 0.15 + 0.3 * k), bevel=0.03)
    box(f"{name}_socket", (0.6, 0.6, 0.5), P["stone"], parent, loc=(x, y, 0.9 + 0.25), bevel=0.04, taper=(0.75, 0.75))
    cyl(f"{name}_shaft", 0.13, 2.6, P["stone"], parent, loc=(x, y, 1.4), r2=0.09, segs=8)
    box(f"{name}_arm", (0.6, 0.12, 0.12), P["stone"], parent, loc=(x, y, 3.85), bevel=0.02)
    box(f"{name}_head", (0.12, 0.12, 0.6), P["stone"], parent, loc=(x, y, 3.95), bevel=0.02)


def west_b(root, P):
    """市場十字: the stepped cross in the middle of the market place, stalls under awnings round it, the money-changer."""
    kit.pad("mk_pad", P, root, 3 * CELL, 3 * CELL, h=0.06, material="pave")
    market_cross("mk_cross", P, root, 0.0, 0.35)
    awning_stall("mk_st1", P, root, -1.75, 1.9)
    awning_stall("mk_st2", P, root, 1.75, 1.9)
    awning_stall("mk_st3", P, root, -1.95, -0.85, w=1.8)
    sacks("mk_s1", P, root, -1.75, 1.95, n=3, seed=5, s=0.24)
    for k in range(3):
        kit.barrel(f"mk_keg{k}", P, root, (1.25 + k * 0.42, 1.95, 0.8), r=0.18, h=0.45)
    money_table("mk_money", P, root, 1.55, -1.0)
    grain_tub("mk_tub", P, root, -2.2, -2.3, r=0.45, h=0.75)
    sacks("mk_sacks", P, root, -0.75, -2.35, n=4, seed=8, s=0.27)
    firewood("mk_wood", P, root, 2.55, 0.45, n=3)
    kit.barrel("mk_barrel", P, root, (0.55, -2.4, 0.0), r=0.3, h=0.85)


def r8_market(root, c, option="A"):
    P = palette(c)
    {("E", "A"): east_a, ("E", "B"): east_b, ("W", "A"): west_a, ("W", "B"): west_b}[(c, option)](root, P)


FOOTPRINT = {"r8_market": (3, 3)}
BUILDERS = {"r8_market": r8_market}
