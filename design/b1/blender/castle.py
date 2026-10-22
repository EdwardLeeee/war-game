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

D-096 (the gates shut, ranged units and mages go up on the walls, the gate towers shoot): the gates' states closed,
damaged and broken (gates.py; "intact" is the open gate); the palisade is two rows of stakes with a walk between them, so
that a unit has something to stand on; `front=True` renders only the wall in front of a unit standing on it (the client
draws it over that unit); empties `stand_at` (where a unit on the wall stands) and `shoot_at_<k>` (where a gate tower's
arrows leave) go into the piece's json.
"""
import math

import lib
from lib import box, cyl, rod, slab, sphere
import gates
import kit

CELL = kit.CELL
GATE_STATES = ("closed", "damaged", "broken")
# D-096: the way to the town from a wall piece on each side (Blender -y is toward the camera, the sim's +y, south)
INWARD = {"n": (0.0, -1.0), "s": (0.0, 1.0), "w": (1.0, 0.0), "e": (-1.0, 0.0)}
SIDES = ("n", "s", "w", "e")


def _at(side, t, o, z=0.0):
    """A point of a wall piece on `side`: t along the wall, o toward the town (both from the cell's middle), z up."""
    ix, iy = INWARD[side]
    ax, ay = (1.0, 0.0) if side in ("n", "s") else (0.0, 1.0)
    return (ax * t + ix * o, ay * t + iy * o, z)


def _size(side, along, across, h):
    return (along, across, h) if side in ("n", "s") else (across, along, h)


def front_only(root, stand, walk, reach=0.4, gap=0.15):
    """Keep, for the camera, only what stands in front of a unit on the wall (D-096): the parts nearer the camera than
    the spot `stand` (by `gap`), across his width (`reach` either side of him; on a north or south wall the whole cell,
    where his bow and arms reach) and rising above the walk he stands on. `stand` may be a list of spots (a corner tower,
    a gate's piers): a part in front of any of them is kept.
    The rest stays in the scene as a holdout (transparent, still casting its shadows), so the kept parts look exactly as
    in the whole piece, which the client draws under the unit."""
    import bpy
    import states
    bpy.context.view_layer.update()
    spots = stand if isinstance(stand[0], (list, tuple)) else [stand]
    ce, se = math.cos(math.radians(lib.CAM_ELEV)), math.sin(math.radians(lib.CAM_ELEV))

    def v(y, z):                             # how high a point shows in the picture (the camera looks along +y)
        return y * se + z * ce

    def hides(box, spot):
        """In front of the unit at `spot` and over him in the picture (a part in front of one unit on a piece with
        several, but not over him, must not be drawn over the others)."""
        x0, y0, z0, x1, y1, z1 = box
        sx, sy, sz = spot
        if not ((y0 + y1) / 2 < sy - gap and x0 < sx + reach and x1 > sx - reach and z1 > walk + 0.05):
            return False
        lo = min(v(y, z) for y in (y0, y1) for z in (z0, z1))
        hi = max(v(y, z) for y in (y0, y1) for z in (z0, z1))
        return lo < v(sy, sz) + 1.9 * ce and hi > v(sy, sz)
    for ob in kit.parts_under(root):
        box = states._bbox(ob)
        if not any(hides(box, sp) for sp in spots):
            ob["back_holdout"] = True


def _stand_cells(root, foot, spots):
    """Where a unit stands on each cell of a piece that sims lets units onto (D-096: the corners and the gates' piers
    are wall cells too): {(dx, dy): (x, y, z)}, dx, dy the cell from the footprint's north-west one (the sim's axes),
    x, y, z the spot in the piece's metres. Marked as empties stand_at_<dx>_<dy>."""
    for (dx, dy), at in sorted(spots.items()):
        _mark(f"stand_at_{dx}_{dy}", root, at)
    return list(spots.values())


def _mark(name, parent, at):
    """A point the client needs (stand_at, shoot_at_<k>), in the piece's metres from its anchor."""
    lib.empty(name, parent=parent, loc=at)


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


PAL_WALK = {"E": 1.3, "W": 1.6}      # the fighting platform: the stakes (2.6, 2.9 m) stand 1.3 m over it, a man's chest
                                     # (Mahan 1862: the banquette 4 ft 3 in under the parapet's top; research wall-reference)
PAL_IN = 0.42                        # where he stands: on the platform, close behind the stakes


def _banquette(name, P, parent, side, c):
    """The fighting platform behind the stakes (D-096; the reconstructed palisade forts: a plank walk on posts along the
    inside, the stakes up to a standing man's chest): from the stakes' inner face to the cell's inner edge, planks laid
    across, a ledger on the stakes and a joist on two posts with knee braces."""
    walk = PAL_WALK[c]
    wood = P["bark"] if c == "W" else P["wood"]
    o0, o1 = 0.17, 0.99
    for k in range(5):
        t = -CELL / 2 + CELL * (k + 0.5) / 5
        box(f"{name}_plank{k}", _size(side, CELL / 5 - 0.03, o1 - o0, 0.07), P["beam"], parent,
            loc=_at(side, t, (o0 + o1) / 2, walk - 0.035))
    box(f"{name}_ledger", _size(side, CELL, 0.1, 0.16), P["beam"], parent, loc=_at(side, 0, o0 + 0.05, walk - 0.15))
    box(f"{name}_joist", _size(side, CELL, 0.1, 0.16), P["beam"], parent, loc=_at(side, 0, o1 - 0.1, walk - 0.15))
    for k, t in enumerate((-0.55, 0.55)):
        cyl(f"{name}_post{k}", 0.07, walk - 0.07, wood, parent, loc=_at(side, t, o1 - 0.1), segs=8)
        rod(f"{name}_brace{k}", _at(side, t, o1 - 0.1, 0.45), _at(side, t, o0 + 0.1, walk - 0.22), 0.04, P["beam"],
            parent=parent, segs=6)


def _pal_side(root, c, side, state, front):
    """One cell of palisade on `side` (D-096): the art-v4 stakes and, on the town side, the fighting platform."""
    P = kit.palette(c)
    _stakes("ps", P, root, "x" if side in ("n", "s") else "y", c)
    _banquette("pb", P, root, side, c)
    stand = _at(side, 0, PAL_IN, PAL_WALK[c])
    _mark("stand_at", root, stand)
    if state == "ruin":
        _soot(root)
    if front:
        front_only(root, stand, PAL_WALK[c], reach=1.0 if side in ("n", "s") else 0.4)


def pal_n(root, c, variant=0, state="intact", front=False):
    _pal_side(root, c, "n", state, front)


def pal_s(root, c, variant=0, state="intact", front=False):
    _pal_side(root, c, "s", state, front)


def pal_w(root, c, variant=0, state="intact", front=False):
    _pal_side(root, c, "w", state, front)


def pal_e(root, c, variant=0, state="intact", front=False):
    _pal_side(root, c, "e", state, front)


PC_DECK = 3.07                       # the watch post's deck: a unit on the corner stands there (D-096)
PC_ROOF = 5.2                        # its roof, high enough over the deck for a man (art-v4: 3.9, nobody stood there)


def pal_corner(root, c, variant=0, state="intact", front=False):
    """A watch post on the corner: four legs, a deck at 3 m, a rail, a small roof; the owner's hanging in front."""
    P = kit.palette(c)
    ruin = state == "ruin"
    wood = P["bark"] if c == "W" else P["wood"]
    s = 0.75
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(f"pc_leg{sx}{sy}", 0.12, PC_ROOF, wood, root, loc=(sx * s, sy * s, 0.0), segs=8)
    box("pc_deck", (1.9, 1.9, 0.14), P["beam"], root, loc=(0, 0, 3.0))
    for k, (a, b, axis) in enumerate(((0, -0.92, "x"), (0, 0.92, "x"), (-0.92, 0, "y"), (0.92, 0, "y"))):
        box(f"pc_rail{k}", (1.9, 0.08, 0.5) if axis == "x" else (0.08, 1.9, 0.5), P["beam"], root, loc=(a, b, 3.3))
    for sx in (-1, 1):                       # braces under the deck
        rod(f"pc_br{sx}", (sx * s, -s, 0.4), (-sx * s, -s, 2.9), 0.05, P["beam"], parent=root)
    if c == "E":
        kit.roof_e("pc_roof", P, root, 0, 0, PC_ROOF, 1.8, 1.8, 0.8, over=0.3, curl=0.35)
    else:
        kit.roof_w("pc_roof", dict(P, tile=P["thatch"]), root, 0, 0, PC_ROOF, 1.8, 1.8, 0.9, over=0.2, ridge="x")
    _hang("pc_hang", P, root, "y", 0, 2.95, 1.2, 1.4, ruin, y0=-0.92)
    spots = _stand_cells(root, (1, 1), {(0, 0): (0.0, 0.0, PC_DECK)})
    if ruin:
        _soot(root)
    if front:
        front_only(root, spots, PC_DECK, reach=0.45)


def _pal_gate(root, c, axis, state):
    """The 3-cell gate of the palisade, along `axis`: the posts on the edges of the opening, a walkway over it; the
    leaves open (intact, ruin) or in a D-096 state (gates.py)."""
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
    if state in GATE_STATES:
        gates.shut(root, P, c, axis, L - 0.5, 2.95 if c == "E" else 3.1, "plank_e" if c == "E" else "log_w", state,
                   mouth=-0.8, seed=21 if c == "E" else 23)
    else:
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
    # where the gate's arrows leave (D-096: it shoots while the town is governed): over the walkway's front rail
    for k, sx in enumerate((-1, 1)):
        _mark(f"shoot_at_{k}", root, along(sx * 1.4, -0.62 if axis == "x" else 0.0, 4.2))
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


SW_OUT = {"E": 1.55, "W": 2.0}       # the merlons above the walk: 女頭 about 1.55 m (《守城錄》), European about 2 m (Viollet-le-Duc)
SW_SILL = 1.0                         # the crenel's sill above the walk, at a man's waist (Viollet-le-Duc)
SW_CRENEL = {"E": 0.45, "W": 0.7}     # the crenel's width: one in the middle of each cell, where the unit stands; the merlon
                                      # spans the cell's edge with the next (1.55 m east, 1.3 m west)
SW_IN = {"E": 0.9, "W": 0.6}          # the low parapet on the town side (女牆; a curb on the European walk)
SW_STAND = -0.25                      # where a unit stands: close behind the crenels


def _wall_side(name, P, parent, side, c):
    """One cell of stone wall on `side` (D-096): the art-v4 body and walk; on the outer edge a crenellated parapet (the
    crenel in the middle of the cell, where the unit stands; a half merlon to each edge, whole with the next cell's), a
    loophole (east) or an arrow slit (west) in each half; on the town side a low parapet."""
    H = WALL_H[c]
    T = 1.6
    mat = P["brick"] if c == "E" else P["stone"]
    top = H + 0.12
    box(name + "_body", _size(side, CELL, T, H), mat, parent, loc=(0, 0, H / 2), bevel=0.03,
        taper=(1.0, 0.94) if side in ("n", "s") else (0.94, 1.0))
    box(name + "_walk", _size(side, CELL, T - 0.1, 0.12), P["pave"], parent, loc=(0, 0, H + 0.06))
    po = -(T / 2 - 0.175)
    box(name + "_sill", _size(side, CELL, 0.35, SW_SILL), mat, parent, loc=_at(side, 0, po, top + SW_SILL / 2), bevel=0.02)
    hm = SW_OUT[c] - SW_SILL
    half = (CELL - SW_CRENEL[c]) / 2
    for k, sgn in enumerate((-1, 1)):
        t = sgn * (SW_CRENEL[c] / 2 + half / 2)
        box(f"{name}_m{k}", _size(side, half, 0.35, hm), mat, parent, loc=_at(side, t, po, top + SW_SILL + hm / 2), bevel=0.02)
        if c == "E":
            box(f"{name}_mc{k}", _size(side, half + 0.04, 0.43, 0.08), P["tile"], parent, loc=_at(side, t, po, top + SW_OUT[c] + 0.04))
            box(f"{name}_eye{k}", _size(side, 0.14, 0.37, 0.16), P["dark"], parent, loc=_at(side, t, po, top + SW_SILL + hm * 0.45),
                outline=False)
        else:
            box(f"{name}_slit{k}", _size(side, 0.07, 0.37, 0.55), P["dark"], parent, loc=_at(side, t, po, top + SW_SILL + hm * 0.5),
                outline=False)
    if c == "E":                              # the crenels' sill under a tile coping too
        box(name + "_sc", _size(side, CELL, 0.41, 0.06), P["tile"], parent, loc=_at(side, 0, po, top + SW_SILL + 0.03))
    pi = T / 2 - 0.15
    box(name + "_inner", _size(side, CELL, 0.3, SW_IN[c]), mat, parent, loc=_at(side, 0, pi, top + SW_IN[c] / 2), bevel=0.02)
    if c == "E":
        box(name + "_ic", _size(side, CELL, 0.38, 0.07), P["tile"], parent, loc=_at(side, 0, pi, top + SW_IN[c] + 0.035))


def _sw_side(root, c, side, state, front):
    P = kit.palette(c)
    _wall_side("ws", P, root, side, c)
    stand = _at(side, 0, SW_STAND, WALL_H[c] + 0.12)
    _mark("stand_at", root, stand)
    if state == "ruin":
        _stones("ws_st", P, root, (_at(side, -0.6, -1.0)[:2], _at(side, 0.5, -0.95)[:2], _at(side, 0.1, 1.0)[:2]), seed=3)
        _soot(root)
    if front:
        front_only(root, stand, WALL_H[c] + 0.12, reach=1.0 if side in ("n", "s") else 0.4)


def sw_n(root, c, variant=0, state="intact", front=False):
    _sw_side(root, c, "n", state, front)


def sw_s(root, c, variant=0, state="intact", front=False):
    _sw_side(root, c, "s", state, front)


def sw_w(root, c, variant=0, state="intact", front=False):
    _sw_side(root, c, "w", state, front)


def sw_e(root, c, variant=0, state="intact", front=False):
    _sw_side(root, c, "e", state, front)


def sw_ctower(root, c, variant=0, state="intact", front=False):
    """The corner tower, 2 x 2 cells. East: a 角樓, a brick base with a two-roofed pavilion; west: a round tower.
    D-096: units stand on its top round the pavilion (east) or the roof cone (west, narrowed to leave a walk); its
    front cells on the front of the top, the back ones at its sides, so that none stands behind the pavilion."""
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
        cyl("ct_roof", R * 0.5, 2.4, P["tile"], root, loc=(0, 0, Hb + 0.1), r2=0.03, segs=24)     # art-v4: R * 0.85
        for z in (2.0, 4.0):
            box(f"ct_slit{z}", (0.12, 0.1, 0.7), P["dark"], root, loc=(0, -R + 0.02, z), outline=False)
        _hang("ct_hang", P, root, "y", 0, Hb - 0.7, 1.2, 2.4, ruin, y0=-R + 0.05)
        top = Hb + 2.5
    # the cells (from the north-west one): (0, 0) NW, (1, 0) NE, (0, 1) SW, (1, 1) SE; SW and SE are the front ones
    if c == "E":
        z, f, sd = Hb + 0.2, 1.55, 1.55
        spots = {(0, 1): (-0.9, -f, z), (1, 1): (0.9, -f, z), (0, 0): (-sd, -0.35, z), (1, 0): (sd, -0.35, z)}
    else:
        z = Hb + 0.02
        spots = {(0, 1): (-0.8, -0.8, z), (1, 1): (0.8, -0.8, z), (0, 0): (-1.1, -0.3, z), (1, 0): (1.1, -0.3, z)}
    spots = _stand_cells(root, (2, 2), spots)
    if ruin:
        _rag("ct_frag", P, root, 0.1, -0.3, top + 0.6)
        _stones("ct_st", P, root, ((-1.9, -1.8), (1.4, -2.0), (2.0, -1.2)), seed=7)
        _soot(root)
    else:
        kit.flag("ct_flag", P, root, (0, 0, top - 0.1), 2.2, c, w=1.2, fh=1.5)
    if front:
        front_only(root, spots, spots[0][2], reach=0.4)


def sw_gate_x(root, c, variant=0, state="intact", front=False):
    """The north and south gates along x: a pier on each side cell, the passage under the gate tower. variant 0: the
    2-cell passage (4 cells in all); 1: the 3-cell passage of the random maps' centred big city (5 cells, core.large3).
    D-096: the piers are wall cells; a unit on one stands on the gate tower's deck in front of the hall (east), on the
    round tower's top round its cone (west, narrowed to leave a walk)."""
    P = kit.palette(c)
    ruin = state == "ruin"
    H = WALL_H[c] + 0.4
    L = (4 + variant) * CELL
    op = (2 + variant) * CELL                # the passage
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
            cyl(f"gx_tr{sx}", 0.4, 1.8, P["tile"], root, loc=(x, -0.2, H + 2.05), r2=0.03, segs=20)     # art-v4: 0.95
        kit.roof_flat_parapet("gx_par", P, root, 0, 0, H, op + 0.4, 2.0, merlon=0.45, gap=0.4, h=0.55, culture="W")
        if state in GATE_STATES:             # D-096: the portcullis let down in front of the leaves (torn out: broken)
            gates.portcullis("gx_port", P, root, "x", op, H - 1.15, -0.75, state)
        else:
            for i in range(5):               # the raised portcullis in the passage's top
                box(f"gx_pc{i}", (0.06, 0.08, 0.8), P["iron"], root, loc=(-op / 2 + 0.4 + i * (op - 0.8) / 4, -0.6, H - 1.55),
                    outline=False)
        top = H + 3.9
    if state in GATE_STATES:
        gates.shut(root, P, c, "x", op, H - 1.2, "lacquer_e" if c == "E" else "oak_w", state, mouth=-1.25,
                   seed=31 + variant + (0 if c == "E" else 4))
    for k, sx in enumerate((-1, 1)):         # where the gate tower's arrows leave: the hall's windows, the towers' tops
        _mark(f"shoot_at_{k}", root, (sx * (L / 2 - 2.0), -1.0, H + 1.2) if c == "E"
              else (sx * (op / 2 + pier / 2), -1.1, H + 2.3))
    for sx in (-1, 1):                       # hangings on the piers' faces, a banner on each side
        _hang(f"gx_hang{sx}", P, root, "y", sx * (op / 2 + pier / 2), H - 0.9, 1.1, 2.0, ruin, y0=-1.0 if c == "E" else -1.25)
    if ruin:
        _stones("gx_st", P, root, ((-3.2, -1.6), (2.9, -1.4), (-1.6, 1.5)), seed=9)
        _soot(root)
    else:
        for sx in (-1, 1):
            kit.flag(f"gx_flag{sx}", P, root, (sx * (L / 2 - 0.5), -0.2, top - (1.5 if c == "E" else 0.3)), 2.0, c, w=1.0, fh=1.4)
    n = 4 + variant
    xp = op / 2 + pier / 2
    spots = _stand_cells(root, (n, 1), {(0, 0): (-xp, -1.0, H + 0.2), (n - 1, 0): (xp, -1.0, H + 0.2)} if c == "E" else
                         {(0, 0): (-xp, -0.77, H + 2.0), (n - 1, 0): (xp, -0.77, H + 2.0)})
    if front:
        front_only(root, spots, spots[0][2], reach=0.4)


def sw_gate_y(root, c, variant=0, state="intact", front=False):
    """The east and west gates along y: a pier tower on each side cell and the open gap between (seen from the camera
    the side walls are edge-on, so a span over the passage would look like a wall). variant as sw_gate_x."""
    P = kit.palette(c)
    ruin = state == "ruin"
    H = WALL_H[c] + 0.4
    L = (4 + variant) * CELL
    op = (2 + variant) * CELL
    pier = (L - op) / 2
    for sy in (-1, 1):
        y = sy * (op / 2 + pier / 2)
        if c == "E":
            box(f"gy_pier{sy}", (2.0, pier, H), P["brick"], root, loc=(0, y, H / 2), bevel=0.04)
            kit.roof_flat_parapet(f"gy_par{sy}", P, root, 0, y, H, 2.0, pier, merlon=0.4, gap=0.35, h=0.45, culture="E")
            # the kiosk set back from the camera side, leaving a walk in front of it for a unit on the pier (D-096;
            # art-v4: 1.4 m square in the middle)
            kit.block_e(f"gy_kiosk{sy}", P, root, 0, y + 0.3, 1.1, 1.1, H + 0.2, 1.2, windows=False)
            kit.roof_e(f"gy_roof{sy}", P, root, 0, y + 0.3, H + 1.4, 1.6, 1.6, 0.8, over=0.35, curl=0.45)
            top = H + 2.3
        else:
            cyl(f"gy_tw{sy}", 1.0, H + 1.8, P["stone"], root, loc=(0, y, 0.0), segs=20)
            for k in range(8):
                a = 2 * math.pi * k / 8
                box(f"gy_tm{sy}{k}", (0.33, 0.3, 0.5), P["stone"], root, loc=(0.85 * math.cos(a), y + 0.85 * math.sin(a), H + 2.05),
                    rot=(0, 0, math.degrees(a)))
            cyl(f"gy_tr{sy}", 0.4, 1.7, P["tile"], root, loc=(0, y, H + 1.85), r2=0.03, segs=20)     # art-v4: 0.9
            top = H + 3.6
        _hang(f"gy_hang{sy}", P, root, "y", 0, H - 0.8, 1.2, 1.9, ruin, y0=y - pier / 2 - (0.05 if c == "E" else 0.0))
        if ruin:
            _rag(f"gy_rag{sy}", P, root, 0.1, y - 0.2, top + 0.4)
        else:
            kit.flag(f"gy_flag{sy}", P, root, (0, y, top - 0.1), 2.0, c, w=1.0, fh=1.4)
        _mark(f"shoot_at_{(sy + 1) // 2}", root, (0, y + 0.3, H + 0.8) if c == "E" else (0, y, H + 2.2))
    if state in GATE_STATES:
        # D-096: the leaves across the passage. Edge-on to the camera and behind the near pier, so what shows is what
        # spills out of the passage's mouths: the fire and the splinters (damaged), the fallen leaf (broken)
        if c == "W":
            gates.portcullis("gy_port", P, root, "y", op, H - 1.15, -0.75, state)
        gates.shut(root, P, c, "y", op, H - 1.2, "lacquer_e" if c == "E" else "oak_w", state, mouth=-1.4,
                   seed=41 + variant + (0 if c == "E" else 4))
        if state != "closed":
            # and on the near pier, which the camera does see: cracks (east; a soot patch there reads as a doorway),
            # stones down at its foot (both)
            y0 = -(op / 2 + pier)
            if c == "E":
                import states
                states.cracks(root, "gy_crack", (-0.75, y0 - 0.04, H - 0.4), "y", length=2.2, seed=6)
                states.cracks(root, "gy_crackb", (0.8, y0 - 0.04, H - 1.6), "y", length=1.4, seed=8)
            _stones("gy_hurt", P, root, ((-1.3, y0 + 0.4), (1.25, y0 + 0.9)) if state == "damaged"
                    else ((-1.4, y0 + 0.3), (1.3, y0 + 0.8), (-1.6, y0 + 1.6), (1.5, y0 + 1.9)), seed=13)
    if ruin:
        _stones("gy_st", P, root, ((-1.5, -0.4), (1.4, 0.6)), seed=11)
        _soot(root)
    # D-096: a unit on a pier stands in front of its kiosk (east), on its round tower round the cone (west); the
    # north pier is the footprint's first cell
    n = 4 + variant
    yp = op / 2 + pier / 2
    spots = _stand_cells(root, (1, n), {(0, 0): (0.0, yp - 0.47, H + 0.2), (0, n - 1): (0.0, -yp - 0.47, H + 0.2)} if c == "E"
                         else {(0, 0): (0.0, yp - 0.57, H + 1.8), (0, n - 1): (0.0, -yp - 0.57, H + 1.8)})
    if front:
        front_only(root, spots, spots[0][2], reach=0.4)


def ttower3(root, c, variant=0):
    """The big city's tower of the random maps' neighbouring spawns, 3 x 3 cells (sim GameMap.towerSize 3, D-074):
    the 2 x 2 tower (towns.ttower) widened to 3 cells and a little taller, under its own scaled empty so the states
    (tower3_state) put the fire and the rubble where the scaled tower is."""
    import towns
    g = lib.empty("tt3_scaled", parent=root)
    towns.ttower(g, c)
    g.scale = (1.5, 1.5, 1.3)


def tower3_state(root, c, state):
    """towns.tower_state for the 3 x 3 tower: the fire at its top, or the rubble over its 3 x 3 cells."""
    if state in ("done", "intact"):
        return
    import bpy
    import states
    P = kit.palette(c)
    bpy.context.view_layer.update()
    if state == "rubble":
        for ob in list(kit.parts_under(root)):
            if states._bbox(ob)[5] > 0.3:
                states._drop(ob)
        states.rubble(root, P, c, 3 * CELL, 3 * CELL, seed=27 + (0 if c == "E" else 3))
    elif state == "damaged":
        states.fire_at_top(root, P, seed=37 + (0 if c == "E" else 3))
    else:
        raise ValueError(state)


def gate_x3(root, c, variant=0, state="intact", front=False):
    sw_gate_x(root, c, variant=1, state=state, front=front)


def gate_y3(root, c, variant=0, state="intact", front=False):
    sw_gate_y(root, c, variant=1, state=state, front=front)


FOOTPRINT = {"pal_x": (1, 1), "pal_y": (1, 1), "pal_corner": (1, 1), "pal_gate_x": (3, 1), "pal_gate_y": (1, 3),
             "sw_x": (1, 1), "sw_y": (1, 1), "sw_ctower": (2, 2), "sw_gate_x": (4, 1), "sw_gate_y": (1, 4), "sw_gate_x3": (5, 1), "sw_gate_y3": (1, 5),
             "ttower3": (3, 3)}
FOOTPRINT.update({f"{w}_{d}": (1, 1) for w in ("pal", "sw") for d in SIDES})

BUILDERS = {"pal_x": pal_x, "pal_y": pal_y, "pal_corner": pal_corner, "pal_gate_x": pal_gate_x, "pal_gate_y": pal_gate_y,
            "sw_x": sw_x, "sw_y": sw_y, "sw_ctower": sw_ctower, "sw_gate_x": sw_gate_x, "sw_gate_y": sw_gate_y,
            "sw_gate_x3": gate_x3, "sw_gate_y3": gate_y3, "ttower3": ttower3}
BUILDERS.update({"pal_n": pal_n, "pal_s": pal_s, "pal_w": pal_w, "pal_e": pal_e, "sw_n": sw_n, "sw_s": sw_s, "sw_w": sw_w,
                 "sw_e": sw_e})
