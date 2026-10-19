"""R6-06 城堡 (the user 2026-10-19: 「希望像一個城堡」): the walls of a town, piece by piece, each piece its own sprite
on its cells (design/b1/common/castle.py says which cell takes which piece; the client puts them together).

The small town's palisade (木柵):
  pal_x, pal_y        one cell of stakes, running along x (the north and south walls) or y (east and west)
  pal_corner          the corner cell: a watch post on four legs
  pal_gate_x/_y       the 3-cell gate: two big posts, a walkway over it, the hangings; the leaves stand open
The big city's stone wall (石牆):
  sw_x, sw_y          one cell of wall with its battlements
  sw_ctower           the corner tower, 2 x 2 (east: a 角樓 pavilion on a brick base; west: a round tower)
  sw_gate_x           the north and south gates, 4 cells: the piers and the 2-cell passage under the gate tower (城樓)
  sw_gate_y           the east and west gates, 1 x 4: the two piers and the open gap (seen from the side, a passage under
                      a tower would look shut, so nothing spans it)
Owner colour (the holder's, the neutral town's beige, the same layer tinted): the hangings and banners on the gates and
the corner pieces. state "ruin": everything sooty, the hangings burnt to rags, some fallen stones; the walls still stand
(they still block) and the gates stay open. The walls block walking only (shots go over), and never break.
"""
import math

import lib
from lib import box, cyl, rod, slab, sphere
import kit

CELL = kit.CELL


def _rag(name, P, parent, x, y, z, w=0.6, h=0.8, rot=0):
    m = lib.mat("rag", (0.32, 0.3, 0.28), 0.95)
    pts = [(-w / 2, 0), (w / 2, 0), (w * 0.3, -h * 0.8), (0, -h * 0.55), (-w / 2, -h)]
    return slab(name, pts, 0.02, m, parent=parent, loc=(x, y, z), rot=(0, 0, rot), plane="XZ")


def _hang(name, P, parent, face, t, z_top, w, h, ruin, x0=None, y0=None):
    """A hanging in the owner's colour, or its rag when burnt."""
    if ruin:
        if face == "y":
            return _rag(name, P, parent, t, y0 - 0.1, z_top - 0.05, w * 0.7, h * 0.45)
        return _rag(name, P, parent, x0 - 0.1, t, z_top - 0.05, w * 0.7, h * 0.45, rot=90)
    return kit.drape(name, P, parent, face, t, z_top, w, h, x0=x0, y0=y0)


def _soot(root):
    import states
    states._char_all(root, above=0.2)


def _stones(name, P, parent, pts, seed=1):
    import random
    rnd = random.Random(seed)
    for k, (x, y) in enumerate(pts):
        box(f"{name}{k}", (rnd.uniform(0.3, 0.55), rnd.uniform(0.25, 0.45), rnd.uniform(0.2, 0.32)), P["stone"], parent,
            loc=(x, y, 0.13), rot=(rnd.uniform(-12, 12), rnd.uniform(-12, 12), rnd.uniform(0, 90)), bevel=0.03)


# ---------------------------------------------------------------- the palisade (the small town)

def _stakes(name, P, parent, axis, c, length=CELL, h=None):
    """A row of pointed stakes along x or y through the origin, on a low earth bank, two rails binding them."""
    h = h or (2.6 if c == "E" else 2.9)
    wood = P["bark"] if c == "W" else P["wood"]
    box(name + "_bank", (length, 0.9, 0.22) if axis == "x" else (0.9, length, 0.22), P["earth"] if "earth" in P else P["stone"],
        parent, loc=(0, 0, 0.11))
    n = 7
    for i in range(n):
        t = -length / 2 + length * (i + 0.5) / n
        hh = h * (0.94 + 0.06 * ((i * 37) % 5) / 4)
        x, y = (t, 0.0) if axis == "x" else (0.0, t)
        cyl(f"{name}_s{i}", 0.13, hh - 0.3, wood, parent, loc=(x, y, 0.15), segs=8)
        cyl(f"{name}_t{i}", 0.13, 0.32, wood, parent, loc=(x, y, 0.15 + hh - 0.3), r2=0.02, segs=8)
    rail = P["post"] if c == "E" else P["beam"]
    for z in (0.8, h - 0.75):
        if axis == "x":
            box(f"{name}_r{z:.1f}", (length, 0.1, 0.12), rail, parent, loc=(0, 0.16, z))
            box(f"{name}_rf{z:.1f}", (length, 0.1, 0.12), rail, parent, loc=(0, -0.16, z))
        else:
            box(f"{name}_r{z:.1f}", (0.1, length, 0.12), rail, parent, loc=(0.16, 0, z))
            box(f"{name}_rf{z:.1f}", (0.1, length, 0.12), rail, parent, loc=(-0.16, 0, z))


def pal_x(root, c, variant=0, state="intact"):
    P = kit.palette(c)
    _stakes("px", P, root, "x", c)
    if state == "ruin":
        _soot(root)


def pal_y(root, c, variant=0, state="intact"):
    P = kit.palette(c)
    _stakes("py", P, root, "y", c)
    if state == "ruin":
        _soot(root)


def pal_corner(root, c, variant=0, state="intact"):
    """A watch post on the corner: four legs, a deck at 3 m, a rail, a small roof; the owner's hanging in front."""
    P = kit.palette(c)
    ruin = state == "ruin"
    wood = P["bark"] if c == "W" else P["wood"]
    s = 0.75
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(f"pc_leg{sx}{sy}", 0.12, 3.9, wood, root, loc=(sx * s, sy * s, 0.0), segs=8)
    box("pc_deck", (1.9, 1.9, 0.14), P["beam"], root, loc=(0, 0, 3.0))
    for k, (a, b, axis) in enumerate(((0, -0.92, "x"), (0, 0.92, "x"), (-0.92, 0, "y"), (0.92, 0, "y"))):
        box(f"pc_rail{k}", (1.9, 0.08, 0.5) if axis == "x" else (0.08, 1.9, 0.5), P["beam"], root, loc=(a, b, 3.3))
    for sx in (-1, 1):                       # braces under the deck
        rod(f"pc_br{sx}", (sx * s, -s, 0.4), (-sx * s, -s, 2.9), 0.05, P["beam"], parent=root)
    if c == "E":
        kit.roof_e("pc_roof", P, root, 0, 0, 3.9, 1.8, 1.8, 0.8, over=0.3, curl=0.35)
    else:
        kit.roof_w("pc_roof", dict(P, tile=P["thatch"]), root, 0, 0, 3.9, 1.8, 1.8, 0.9, over=0.2, ridge="x")
    _hang("pc_hang", P, root, "y", 0, 2.95, 1.2, 1.4, ruin, y0=-0.92)
    if ruin:
        _soot(root)


def _pal_gate(root, c, axis, state):
    """The 3-cell gate of the palisade, along `axis`: the posts on the edges of the opening, a walkway over it."""
    P = kit.palette(c)
    ruin = state == "ruin"
    L = 3 * CELL
    wood = P["bark"] if c == "W" else P["wood"]
    H = 4.1
    along = (lambda t, o=0.0, z=0.0: (t, o, z)) if axis == "x" else (lambda t, o=0.0, z=0.0: (o, t, z))
    for sx in (-1, 1):
        x, y, _ = along(sx * L / 2)
        cyl(f"pg_post{sx}", 0.24, H, wood, root, loc=(x, y, 0.0), segs=10)
        cyl(f"pg_cap{sx}", 0.26, 0.3, P["beam"], root, loc=(x, y, H), r2=0.05, segs=10)
    # the walkway on top: a deck, its rails, a roof (east) or a pointed hood (west)
    size = (L + 0.6, 1.3, 0.16) if axis == "x" else (1.3, L + 0.6, 0.16)
    box("pg_deck", size, P["beam"], root, loc=(0, 0, 3.55))
    for o in (-0.62, 0.62):
        x, y, _ = along(0, o)
        box(f"pg_rail{o}", (L + 0.6, 0.08, 0.55) if axis == "x" else (0.08, L + 0.6, 0.55), P["beam"], root, loc=(x, y, 3.9))
    if c == "E":
        kit.roof_e("pg_roof", P, root, 0, 0, 4.25, L * 0.55 if axis == "x" else 1.4, 1.4 if axis == "x" else L * 0.55, 0.8,
                   over=0.35, curl=0.4, ridge="x" if axis == "x" else "y")
    else:
        kit.roof_w("pg_roof", dict(P, tile=P["thatch"]), root, 0, 0, 4.25, L * 0.5 if axis == "x" else 1.4,
                   1.4 if axis == "x" else L * 0.5, 0.95, over=0.2, ridge="x" if axis == "x" else "y")
    # the leaves stand open, flat against the stakes on either side (outside the opening)
    for sx in (-1, 1):
        x, y, _ = along(sx * (L / 2 + 0.75), -0.3)
        leaf = (1.4, 0.12, 2.6) if axis == "x" else (0.12, 1.4, 2.6)
        if ruin and sx > 0:
            box("pg_leaf_fallen", (1.4, 2.6, 0.12) if axis == "x" else (2.6, 1.4, 0.12), P["char"], root, loc=(x, y - 1.2, 0.08),
                rot=(0, 0, 8))
        else:
            box(f"pg_leaf{sx}", leaf, wood, root, loc=(x, y, 1.35))
    # the owner's colour: two hangings under the walkway (seen from the front gates) and a banner on each post
    if axis == "x":
        for sx in (-1, 1):
            _hang(f"pg_hang{sx}", P, root, "y", sx * 1.7, 3.45, 1.1, 1.5, ruin, y0=-0.62)
    for sx in (-1, 1):
        x, y, _ = along(sx * L / 2)
        if ruin:
            _rag(f"pg_brag{sx}", P, root, x + 0.15, y - 0.3, 4.2)
        else:
            kit.flag(f"pg_flag{sx}", P, root, (x, y - 0.3, H + 0.2), 1.9, c, w=0.9, fh=1.3)
    if ruin:
        _soot(root)


def pal_gate_x(root, c, variant=0, state="intact"):
    _pal_gate(root, c, "x", state)


def pal_gate_y(root, c, variant=0, state="intact"):
    _pal_gate(root, c, "y", state)


# ---------------------------------------------------------------- the stone wall (the big city)

WALL_H = {"E": 4.2, "W": 4.6}


def _wall(name, P, parent, axis, c, length=CELL):
    """One run of wall along x or y through the origin, 1.6 m thick, with battlements on both faces."""
    H = WALL_H[c]
    T = 1.6
    size = (length, T, H) if axis == "x" else (T, length, H)
    box(name + "_body", size, P["brick"] if c == "E" else P["stone"], parent, loc=(0, 0, H / 2), bevel=0.03,
        taper=(1.0, 0.94) if axis == "x" else (0.94, 1.0))
    box(name + "_walk", (length, T - 0.1, 0.12) if axis == "x" else (T - 0.1, length, 0.12), P["pave"], parent,
        loc=(0, 0, H + 0.06))
    n = 3
    for side in (-1, 1):
        for i in range(n):
            t = -length / 2 + length * (i + 0.5) / n
            loc = (t, side * (T / 2 - 0.15), H + 0.4) if axis == "x" else (side * (T / 2 - 0.15), t, H + 0.4)
            msize = (0.42, 0.3, 0.62) if axis == "x" else (0.3, 0.42, 0.62)
            box(f"{name}_m{side}{i}", msize, P["brick"] if c == "E" else P["stone"], parent, loc=loc, bevel=0.02)
            if c == "E":                     # a tile coping on each merlon
                box(f"{name}_mc{side}{i}", (msize[0] + 0.08, msize[1] + 0.08, 0.08), P["tile"], parent,
                    loc=(loc[0], loc[1], H + 0.75))


def sw_x(root, c, variant=0, state="intact"):
    P = kit.palette(c)
    _wall("wx", P, root, "x", c)
    if state == "ruin":
        _stones("wx_st", P, root, ((-0.6, -1.0), (0.5, -0.95), (0.1, 1.0)), seed=3)
        _soot(root)


def sw_y(root, c, variant=0, state="intact"):
    P = kit.palette(c)
    _wall("wy", P, root, "y", c)
    if state == "ruin":
        _stones("wy_st", P, root, ((-1.0, -0.4), (0.95, 0.5)), seed=5)
        _soot(root)


def sw_ctower(root, c, variant=0, state="intact"):
    """The corner tower, 2 x 2 cells. East: a 角樓, a brick base with a two-roofed pavilion; west: a round tower."""
    P = kit.palette(c)
    ruin = state == "ruin"
    if c == "E":
        Hb = 5.0
        box("ct_base", (3.8, 3.8, Hb), P["brick"], root, loc=(0, 0, Hb / 2), bevel=0.05, taper=(0.92, 0.92))
        kit.roof_flat_parapet("ct_par", P, root, 0, 0, Hb, 3.7, 3.7, merlon=0.45, gap=0.4, h=0.5, culture="E")
        kit.block_e("ct_hall", P, root, 0, 0, 2.6, 2.6, Hb + 0.2, 1.7, windows=True)
        kit.roof_e("ct_roof1", P, root, 0, 0, Hb + 1.9, 3.4, 3.4, 0.7, over=0.55, curl=0.45)
        kit.block_e("ct_hall2", P, root, 0, 0, 1.8, 1.8, Hb + 2.5, 1.1, windows=True)
        kit.roof_e("ct_roof2", P, root, 0, 0, Hb + 3.6, 2.4, 2.4, 1.0, over=0.5, curl=0.5)
        _hang("ct_hang", P, root, "y", 0, Hb - 0.4, 1.5, 2.2, ruin, y0=-1.75)
        top = Hb + 4.6
    else:
        R, Hb = 1.75, 6.4
        cyl("ct_body", R, Hb, P["stone"], root, loc=(0, 0, 0.0), r2=R * 0.93, segs=24)
        cyl("ct_band", R * 1.04, 0.3, P["brick"], root, loc=(0, 0, Hb - 0.3), segs=24)
        for k in range(10):                  # merlons round the top
            a = 2 * math.pi * k / 10
            box(f"ct_m{k}", (0.45, 0.35, 0.6), P["stone"], root, loc=(R * 0.9 * math.cos(a), R * 0.9 * math.sin(a), Hb + 0.3),
                rot=(0, 0, math.degrees(a) + 90), bevel=0.02)
        cyl("ct_roof", R * 0.85, 2.4, P["tile"], root, loc=(0, 0, Hb + 0.1), r2=0.03, segs=24)
        for z in (2.0, 4.0):
            box(f"ct_slit{z}", (0.12, 0.1, 0.7), P["dark"], root, loc=(0, -R + 0.02, z), outline=False)
        _hang("ct_hang", P, root, "y", 0, Hb - 0.7, 1.2, 2.4, ruin, y0=-R + 0.05)
        top = Hb + 2.5
    if ruin:
        _rag("ct_frag", P, root, 0.1, -0.3, top + 0.6)
        _stones("ct_st", P, root, ((-1.9, -1.8), (1.4, -2.0), (2.0, -1.2)), seed=7)
        _soot(root)
    else:
        kit.flag("ct_flag", P, root, (0, 0, top - 0.1), 2.2, c, w=1.2, fh=1.5)


def sw_gate_x(root, c, variant=0, state="intact"):
    """The north and south gates, 4 cells along x: a pier on each side cell, the 2-cell passage under the gate tower."""
    P = kit.palette(c)
    ruin = state == "ruin"
    H = WALL_H[c] + 0.4
    L = 4 * CELL
    op = 2 * CELL                            # the passage, 4 m
    pier = (L - op) / 2
    mat = P["brick"] if c == "E" else P["stone"]
    for sx in (-1, 1):
        box(f"gx_pier{sx}", (pier, 2.0, H), mat, root, loc=(sx * (op / 2 + pier / 2), 0, H / 2), bevel=0.04)
    # over the passage: the lintel with a stepped arch under it
    box("gx_lintel", (op + 0.2, 2.0, 1.1), mat, root, loc=(0, 0, H - 0.55), bevel=0.03)
    for k, (w, z) in enumerate(((op - 0.2, H - 1.25), (op - 0.9, H - 1.55))):
        box(f"gx_arch{k}", (0.35, 2.0, 0.3), mat, root, loc=(-w / 2, 0, z))
        box(f"gx_archr{k}", (0.35, 2.0, 0.3), mat, root, loc=(w / 2, 0, z))
    if c == "E":
        # the 城樓: a timber hall on the gate with two roofs, the name board in the owner's colour
        box("gx_deck", (L, 2.2, 0.2), P["pave"], root, loc=(0, 0, H + 0.1))
        kit.block_e("gx_hall", P, root, 0, 0, L - 1.6, 1.8, H + 0.2, 1.8, windows=True)
        kit.roof_e("gx_roof1", P, root, 0, 0, H + 2.0, L - 0.8, 2.6, 0.7, over=0.55, curl=0.45)
        kit.block_e("gx_hall2", P, root, 0, 0, L - 3.4, 1.4, H + 2.6, 1.0, windows=True)
        kit.roof_e("gx_roof2", P, root, 0, 0, H + 3.6, L - 2.4, 2.0, 1.0, over=0.5, curl=0.5)
        if not ruin:
            box("gx_rim", (1.7, 0.08, 0.66), P["gold"], root, loc=(0, -1.06, H - 0.55))
            box("gx_board", (1.5, 0.1, 0.52), P["team"], root, loc=(0, -1.1, H - 0.55))
        top = H + 4.6
    else:
        # two round towers on the piers, a crenellated walk between, the portcullis up
        for sx in (-1, 1):
            x = sx * (op / 2 + pier / 2)
            cyl(f"gx_tw{sx}", 1.05, H + 2.0, P["stone"], root, loc=(x, -0.2, 0.0), segs=20)
            for k in range(8):
                a = 2 * math.pi * k / 8
                box(f"gx_tm{sx}{k}", (0.35, 0.3, 0.5), P["stone"], root, loc=(x + 0.9 * math.cos(a), -0.2 + 0.9 * math.sin(a),
                                                                                  H + 2.25), rot=(0, 0, math.degrees(a)))
            cyl(f"gx_tr{sx}", 0.95, 1.8, P["tile"], root, loc=(x, -0.2, H + 2.05), r2=0.03, segs=20)
        kit.roof_flat_parapet("gx_par", P, root, 0, 0, H, op + 0.4, 2.0, merlon=0.45, gap=0.4, h=0.55, culture="W")
        for i in range(5):                   # the raised portcullis in the passage's top
            box(f"gx_pc{i}", (0.06, 0.08, 0.8), P["iron"], root, loc=(-op / 2 + 0.4 + i * (op - 0.8) / 4, -0.6, H - 1.55),
                outline=False)
        top = H + 3.9
    for sx in (-1, 1):                       # hangings on the piers' faces, a banner on each side
        _hang(f"gx_hang{sx}", P, root, "y", sx * (op / 2 + pier / 2), H - 0.9, 1.1, 2.0, ruin, y0=-1.0 if c == "E" else -1.25)
    if ruin:
        _stones("gx_st", P, root, ((-3.2, -1.6), (2.9, -1.4), (-1.6, 1.5)), seed=9)
        _soot(root)
    else:
        for sx in (-1, 1):
            kit.flag(f"gx_flag{sx}", P, root, (sx * (L / 2 - 0.5), -0.2, top - (1.5 if c == "E" else 0.3)), 2.0, c, w=1.0, fh=1.4)


def sw_gate_y(root, c, variant=0, state="intact"):
    """The east and west gates, 4 cells along y: a pier tower on each side cell and the open gap between (seen from the
    camera the side walls are edge-on, so a span over the passage would look like a wall)."""
    P = kit.palette(c)
    ruin = state == "ruin"
    H = WALL_H[c] + 0.4
    L = 4 * CELL
    op = 2 * CELL
    pier = (L - op) / 2
    for sy in (-1, 1):
        y = sy * (op / 2 + pier / 2)
        if c == "E":
            box(f"gy_pier{sy}", (2.0, pier, H), P["brick"], root, loc=(0, y, H / 2), bevel=0.04)
            kit.roof_flat_parapet(f"gy_par{sy}", P, root, 0, y, H, 2.0, pier, merlon=0.4, gap=0.35, h=0.45, culture="E")
            kit.block_e(f"gy_kiosk{sy}", P, root, 0, y, 1.4, 1.4, H + 0.2, 1.2, windows=False)
            kit.roof_e(f"gy_roof{sy}", P, root, 0, y, H + 1.4, 1.9, 1.9, 0.8, over=0.35, curl=0.45)
            top = H + 2.3
        else:
            cyl(f"gy_tw{sy}", 1.0, H + 1.8, P["stone"], root, loc=(0, y, 0.0), segs=20)
            for k in range(8):
                a = 2 * math.pi * k / 8
                box(f"gy_tm{sy}{k}", (0.33, 0.3, 0.5), P["stone"], root, loc=(0.85 * math.cos(a), y + 0.85 * math.sin(a), H + 2.05),
                    rot=(0, 0, math.degrees(a)))
            cyl(f"gy_tr{sy}", 0.9, 1.7, P["tile"], root, loc=(0, y, H + 1.85), r2=0.03, segs=20)
            top = H + 3.6
        _hang(f"gy_hang{sy}", P, root, "y", 0, H - 0.8, 1.2, 1.9, ruin, y0=y - pier / 2 - (0.05 if c == "E" else 0.0))
        if ruin:
            _rag(f"gy_rag{sy}", P, root, 0.1, y - 0.2, top + 0.4)
        else:
            kit.flag(f"gy_flag{sy}", P, root, (0, y, top - 0.1), 2.0, c, w=1.0, fh=1.4)
    if ruin:
        _stones("gy_st", P, root, ((-1.5, -0.4), (1.4, 0.6)), seed=11)
        _soot(root)


FOOTPRINT = {"pal_x": (1, 1), "pal_y": (1, 1), "pal_corner": (1, 1), "pal_gate_x": (3, 1), "pal_gate_y": (1, 3),
             "sw_x": (1, 1), "sw_y": (1, 1), "sw_ctower": (2, 2), "sw_gate_x": (4, 1), "sw_gate_y": (1, 4)}
BUILDERS = {"pal_x": pal_x, "pal_y": pal_y, "pal_corner": pal_corner, "pal_gate_x": pal_gate_x, "pal_gate_y": pal_gate_y,
            "sw_x": sw_x, "sw_y": sw_y, "sw_ctower": sw_ctower, "sw_gate_x": sw_gate_x, "sw_gate_y": sw_gate_y}
