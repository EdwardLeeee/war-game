"""R12 (D-119, the user 2026-11-04: 「我是把它當作城牆來設計的」, chose 「先 A」 3 x 3): the outpost (哨所) as a 3 x 3
(6 x 6 m) piece of wall: lower and wider than the arrow tower, a passage through for one's own men (D-115), up to 9
spearmen hidden in it poking at what comes within a cell (D-119). In art-v7's realistic look, for the diamond camera.

Options (each East and West):
- A 敵臺門洞: a block of wall 6 m along x, 4.4 m deep, a flat-topped passage through it along y; a walk and a parapet on
  top. East rammed earth in tamped courses, a timber-framed passage (never a brick arch), 皮竹笆 shields; West rubble
  with quoins, an arched passage, merlons, a timber hoarding over the front.
- B 塢堡小院: four low walls round a small yard, a gate south and north, the corners raised; a shed inside.
- C 關城閘樓: a thick stretch of wall across the middle with the passage, a low one-storey gate house on it.
state: build (half its height, scaffolding, no top), done, damaged (merlons gone, a breach, scorch, a small fire),
garrison (done with nine men behind the parapet: helmets, shoulders in the player's colour, spears out over it).
"""
import math
import random

import lib
from lib import box, cyl, rod, sphere
import kit
import states
from arch_r8 import palette, hall_e, tang_roof
from main_city_r9 import rammed_earth

W, D = 6.0, 4.4                  # A's block


def _courses(name, P, root, x0, x1, y0, y1, h, batter, seed, earth=True):
    """A battered block, its foot x0..x1, y0..y1: East rammed earth (R9's tamped courses in the material: stacked boxes
    read as gravel slabs, R12 r0), West rubble (the R8 look's rubble texture)."""
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    w0, d0 = x1 - x0, y1 - y0
    w1, d1 = w0 - 2 * h / batter, d0 - 2 * h / batter
    box(f"{name}_blk", (w0, d0, h), rammed_earth() if earth else P["stone"], root, loc=(cx, cy, h / 2),
        bevel=0.03, taper=(w1 / w0, d1 / d0))
    return w1, d1


def _shield(P, root, name, x, y, z, rot_z, w=0.8, h=0.9):
    hide = lib.mat("hide_r8", (0.28, 0.2, 0.12), 0.9)
    g = lib.empty(name, parent=root, loc=(x, y, z), rot=(0, 0, rot_z))
    box(name + "_b", (w, 0.05, h), hide, g)
    for k in range(5):
        xx = -w / 2 + 0.05 + k * (w - 0.1) / 4
        rod(f"{name}_cane{k}", (xx, -0.03, -h / 2), (xx, -0.03, h / 2), 0.012, P["wood"], parent=g, segs=4)
    box(name + "_win", (0.18, 0.07, 0.18), P["dark"], g, loc=(0, -0.01, 0.12))


def _parapet(P, root, c, name, x0, x1, y0, y1, z, seed, sides="all", broken=()):
    """A parapet round x0..x1, y0..y1 at height z: East a 女牆 with crenels and hide shields on the two faces the camera
    sees (south, west), West merlons. broken: indices of merlons/crenels left out (damaged)."""
    pts = []
    t = 0.24
    faces = {"s": ((x0, y0), (x1, y0)), "n": ((x0, y1), (x1, y1)), "w": ((x0, y0), (x0, y1)), "e": ((x1, y0), (x1, y1))}
    use = "snwe" if sides == "all" else sides
    k = 0
    for f in use:
        (ax, ay), (bx, by) = faces[f]
        L = math.hypot(bx - ax, by - ay)
        horiz = ay == by
        if c == "E":
            ph = 0.9
            n = max(2, int(L / 1.2))
            for i in range(n):                   # a wall with low crenels: solid parts between gaps
                if k in broken:
                    k += 1
                    continue
                s0, s1 = i / n * L + 0.15, (i + 1) / n * L - 0.15
                mid = (s0 + s1) / 2
                px, py = (ax + mid, ay) if horiz else (ax, ay + mid)
                size = (s1 - s0, t, ph) if horiz else (t, s1 - s0, ph)
                box(f"{name}_{f}{i}", size, rammed_earth(), root, loc=(px, py, z + ph / 2))
                if f in "sw" and i % 2 == 0:
                    off = -0.16
                    _shield(P, root, f"{name}_sh{f}{i}", px + (0 if horiz else off), py + (off if horiz else 0), z + 0.5,
                            0.0 if horiz else 90.0)
                pts.append((px, py))
                k += 1
            box(f"{name}_{f}low", (L, t, 0.45) if horiz else (t, L, 0.45), rammed_earth(), root,
                loc=((ax + bx) / 2, (ay + by) / 2, z + 0.22))
        else:
            box(f"{name}_{f}wall", (L, t, 0.55) if horiz else (t, L, 0.55), P["stone"], root,
                loc=((ax + bx) / 2, (ay + by) / 2, z + 0.27))
            n = max(2, int(L / 0.75))
            for i in range(n):
                if i % 2:
                    continue
                if k in broken:
                    k += 1
                    continue
                s = (i + 0.5) / n * L
                px, py = (ax + s, ay) if horiz else (ax, ay + s)
                box(f"{name}_{f}m{i}", (0.42, t, 0.5) if horiz else (t, 0.42, 0.5), P["stone"], root, loc=(px, py, z + 0.8))
                pts.append((px, py))
                k += 1
    return pts


def _garrison(P, root, c, spots, z, face="s"):
    """Nine men behind the parapet: an iron helmet, shoulders in the player's colour, a spear leaning out over it."""
    rnd = random.Random(9)
    iron = P["iron"]
    for k, (x, y) in enumerate(spots[:9]):
        g = lib.empty(f"gar{k}", parent=root, loc=(x, y, z))
        box(f"gar{k}_sh", (0.42, 0.22, 0.3), P["team"], g, loc=(0, 0, 0.78))
        sphere(f"gar{k}_head", 0.12, lib.mat("skin_gar", (0.45, 0.3, 0.22), 0.7), g, loc=(0, 0, 1.08), segs=10, rings=6)
        sphere(f"gar{k}_helm", 0.14, iron, g, loc=(0, 0.01, 1.14), segs=10, rings=6)
        lean = rnd.uniform(0.6, 1.0)
        out = (0, -1) if face == "s" else (-1, 0)
        rod(f"gar{k}_spear", (-out[0] * 0.3, -out[1] * 0.3, 0.7), (out[0] * 1.6 * lean, out[1] * 1.6 * lean, 1.9),
            0.02, P["wood"], parent=g, segs=5)
        rod(f"gar{k}_tip", (out[0] * 1.6 * lean, out[1] * 1.6 * lean, 1.9),
            (out[0] * 1.78 * lean, out[1] * 1.78 * lean, 2.02), 0.025, iron, parent=g, segs=5, r2=0.002)


def _fire(root, P, x, y, z, k=0):
    f = lib.mat("fire_b1", (1.0, 0.45, 0.1), 0.5, kind="emit", emission=6.0) if "fire_b1" not in lib.MATS else lib.MATS["fire_b1"]["mat"]
    for i in range(3):
        cyl(f"fire{k}_{i}", 0.18 - i * 0.04, 0.5 + i * 0.25, f, root, loc=(x + (i - 1) * 0.15, y, z), r2=0.01, segs=8)
    soot = lib.mat("soot", (0.03, 0.028, 0.026), 0.95)
    box(f"soot{k}", (1.2, 0.03, 0.9), soot, root, loc=(x, y - 0.02, z + 0.2))


def _debris(root, P, rnd, cx, cy, n, spread, mat):
    for i in range(n):
        s = rnd.uniform(0.15, 0.4)
        box(f"deb{i}", (s, s * rnd.uniform(0.6, 1.2), s * 0.6), mat, root,
            loc=(cx + rnd.uniform(-spread, spread), cy + rnd.uniform(-spread * 0.5, spread * 0.5), s * 0.3),
            rot=(rnd.uniform(-20, 20), rnd.uniform(-20, 20), rnd.uniform(0, 90)))


def _passage_frame(P, root, c, y_face, h, w=1.8):
    """The passage's mouth on the face y = y_face: East a flat timber frame (posts, lintel), West a round arch."""
    if c == "E":
        for sx in (-1, 1):
            box(f"pf_post{sx}{y_face:.0f}", (0.22, 0.3, h), P["timber"], root, loc=(sx * (w / 2 + 0.05), y_face, h / 2))
        box(f"pf_lintel{y_face:.0f}", (w + 0.5, 0.32, 0.26), P["timber"], root, loc=(0, y_face, h + 0.1))
    else:
        ashlar = lib.mat("ashlar", (0.46, 0.43, 0.37), 0.85)
        for i in range(9):                       # voussoirs round the arch
            a = math.pi * i / 8
            box(f"pf_v{i}{y_face:.0f}", (0.22, 0.34, 0.3), ashlar, root,
                loc=(math.cos(a) * (w / 2 + 0.1), y_face, h - w / 2 + math.sin(a) * (w / 2 + 0.1)), rot=(0, -math.degrees(a) + 90, 0))


def _build(root, P, c, x0, x1, y0, y1, h):
    """The site: the walls half up, poles round, planks on the camera faces, a pile of timber and earth/stone."""
    states.scaffold(root, P, c, x0 - 0.3, x1 + 0.3, y0 - 0.3, y1 + 0.3, h + 0.4, name="sc")
    rnd = random.Random(4)
    for i in range(6):
        rod(f"logs{i}", (x1 - 0.4, y0 - 1.0 + i * 0.12, 0.08 + (i % 2) * 0.1), (x1 + 0.9, y0 - 1.0 + i * 0.12, 0.08 + (i % 2) * 0.1),
            0.07, P["wood"], parent=root, segs=6)
    _debris(root, P, rnd, x0 + 0.2, y0 - 0.9, 7, 0.6, P["earth"] if c == "E" else P["stone"])


# ---------------------------------------------------------------- A 敵臺門洞

def opt_a(root, c, state):
    P = palette(c)
    build = state == "build"
    H = 2.6 if c == "E" else 2.8
    h = H * 0.55 if build else H
    pw = 1.8                                       # the passage
    x0, x1, y0, y1 = -W / 2, W / 2, -D / 2, D / 2
    batter = 5.0 if c == "E" else 12.0
    for sx in (-1, 1):                             # two halves either side of the passage
        xa, xb = (x0, -pw / 2) if sx < 0 else (pw / 2, x1)
        _courses(f"a_half{sx}", P, root, xa, xb, y0, y1, h, batter, 3 + sx, earth=c == "E")
    if c == "W":                                   # pale quoins at the outer corners
        ashlar = lib.mat("ashlar", (0.46, 0.43, 0.37), 0.85)
        for k in range(int(h / 0.42)):
            for sx in (-1, 1):
                for sy in (-1, 1):
                    a_, b_ = (0.5, 0.28) if k % 2 else (0.28, 0.5)
                    box(f"a_q{k}{sx}{sy}", (a_, b_, 0.38), ashlar, root,
                        loc=(sx * (W / 2 - a_ / 2 + 0.02), sy * (D / 2 - b_ / 2 + 0.02), 0.2 + k * 0.42))
    box("a_dark", (pw, D, h * 0.92), P["dark"], root, loc=(0, 0, h * 0.46))          # the passage's shade
    if build:
        _build(root, P, c, x0, x1, y0, y1, h)
        return
    tw, td = W - 2 * H / batter, D - 2 * H / batter
    box("a_deck", (tw, td, 0.12), P["pave"], root, loc=(0, 0, H - 0.05))          # the walk, paved over the passage
    for yf in (y0, y1):
        _passage_frame(P, root, c, yf + (0.05 if yf < 0 else -0.05), 2.1)
    broken = (1, 2, 7) if state == "damaged" else ()
    spots = _parapet(P, root, c, "a_par", -tw / 2, tw / 2, -td / 2, td / 2, H, 5, broken=broken)
    if c == "E":
        hut = lib.empty("a_hut", parent=root, loc=(tw / 2 - 0.9, td / 2 - 0.8, H))   # a small 戰棚 at the back corner
        for sx in (-1, 1):
            for sy in (-1, 1):
                cyl(f"a_hutp{sx}{sy}", 0.06, 1.5, P["timber"], hut, loc=(sx * 0.6, sy * 0.45, 0), segs=6)
        tang_roof("a_hutroof", P, hut, 0, 0, 1.5, 1.5, 1.2, 0.35, 0.4, kind="xuanshan", lift=0.0, chiwei=False,
                  tile_pitch=0.2, tile_amp=0.02)
    else:
        wood = lib.mat("timber", (0.16, 0.12, 0.08), 0.8)                            # a hoarding over the front
        box("a_hoard", (tw - 0.6, 0.7, 0.9), wood, root, loc=(0, -td / 2 - 0.3, H + 0.45))
        box("a_hoardroof", (tw - 0.4, 1.0, 0.08), P["tile"], root, loc=(0, -td / 2 - 0.25, H + 1.02), rot=(14, 0, 0))
    kit.flag("a_flag", P, root, (-tw / 2 + 0.4, td / 2 - 0.4, H), 3.0, c, w=1.0, fh=1.3)
    _finish(root, P, c, state, spots, H, x0, x1, y0, y1)


# ---------------------------------------------------------------- B 塢堡小院

def opt_b(root, c, state):
    P = palette(c)
    build = state == "build"
    H = 2.5 if c == "E" else 2.7
    h = H * 0.55 if build else H
    t = 0.9 if c == "E" else 0.8
    x0, x1, y0, y1 = -3.0, 3.0, -3.0, 3.0
    gw = 1.8
    earth = c == "E"
    batter = 6.0 if earth else 14.0
    # the four walls; the south and north ones in two pieces round the gates
    for sx in (-1, 1):
        _courses(f"b_w{sx}", P, root, (x0 if sx < 0 else x1 - t), (x0 + t if sx < 0 else x1), y0 + t, y1 - t, h, batter, 6 + sx, earth)
        for yy, nm in ((y0, "s"), (y1 - t, "n")):
            xa, xb = (x0, -gw / 2) if sx < 0 else (gw / 2, x1)
            _courses(f"b_{nm}{sx}", P, root, xa, xb, yy, yy + t, h, batter, 8 + sx, earth)
    for sx in (-1, 1):                             # the raised corners
        for sy in (-1, 1):
            cx, cy = sx * (3.0 - 0.7), sy * (3.0 - 0.7)
            _courses(f"b_c{sx}{sy}", P, root, cx - 0.7, cx + 0.7, cy - 0.7, cy + 0.7, h + (0 if build else 0.7), batter * 1.5, 11, earth)
    box("b_yard", (6.0 - 2 * t, 6.0 - 2 * t, 0.04), P["pave"], root, loc=(0, 0, 0.02))
    if build:
        _build(root, P, c, x0, x1, y0, y1, h)
        return
    for yf in (y0, y1):
        _passage_frame(P, root, c, yf + (t / 2 if yf < 0 else -t / 2), 2.0)
        yc = yf + (t / 2 if yf < 0 else -t / 2)               # the wall carried over the gate (the arch held up)
        box(f"b_over{yf:.0f}", (gw + 0.3, t, H - 2.2), rammed_earth() if earth else P["stone"], root, loc=(0, yc, 2.2 + (H - 2.2) / 2))
    broken = (0, 3, 4) if state == "damaged" else ()
    spots = _parapet(P, root, c, "b_par", x0 + 0.12, x1 - 0.12, y0 + 0.12, y1 - 0.12, H, 7, sides="sw", broken=broken)
    shed = lib.empty("b_shed", parent=root, loc=(0.9, 0.6, 0))                       # the shed in the yard
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(f"b_shp{sx}{sy}", 0.07, 1.9, P["timber"], shed, loc=(sx * 0.9, sy * 0.7, 0), segs=6)
    if c == "E":
        tang_roof("b_shroof", P, shed, 0, 0, 1.9, 2.1, 1.7, 0.45, 0.45, kind="xuanshan", lift=0.0, chiwei=False,
                  tile_pitch=0.2, tile_amp=0.02)
    else:
        for sy in (-1, 1):
            box(f"b_shroof{sy}", (2.3, 1.1, 0.08), P["tile"], shed, loc=(0, sy * 0.48, 2.2), rot=(sy * -28, 0, 0))
    kit.flag("b_flag", P, root, (x0 + 0.7, y0 + 0.7, H + 0.7), 2.8, c, w=1.0, fh=1.3)
    _finish(root, P, c, state, spots, H, x0, x1, y0, y1)


# ---------------------------------------------------------------- C 關城閘樓

def opt_c(root, c, state):
    P = palette(c)
    build = state == "build"
    H = 2.6 if c == "E" else 2.8
    h = H * 0.55 if build else H
    pw = 1.8
    Dc = 3.4
    x0, x1, y0, y1 = -3.0, 3.0, -Dc / 2, Dc / 2
    earth = c == "E"
    batter = 5.0 if earth else 12.0
    for sx in (-1, 1):
        xa, xb = (x0, -pw / 2) if sx < 0 else (pw / 2, x1)
        _courses(f"c_half{sx}", P, root, xa, xb, y0, y1, h, batter, 13 + sx, earth)
    box("c_dark", (pw, Dc, h * 0.92), P["dark"], root, loc=(0, 0, h * 0.46))
    if build:
        _build(root, P, c, x0, x1, y0, y1, h)
        return
    tw, td = 6.0 - 2 * H / batter, Dc - 2 * H / batter
    box("c_deck", (tw, td, 0.14), P["pave"], root, loc=(0, 0, H - 0.07))
    for yf in (y0, y1):
        _passage_frame(P, root, c, yf + (0.05 if yf < 0 else -0.05), 2.1)
    broken = (2, 5) if state == "damaged" else ()
    spots = _parapet(P, root, c, "c_par", -tw / 2, tw / 2, -td / 2, td / 2, H, 9, sides="sw", broken=broken)
    if c == "E":                                   # a low one-storey gate house, three bays, a hip roof
        w_, d_, t_ = hall_e("c_house", P, root, 0, 0.15, H, (0.9, 1.1, 0.9), (1.4,), 1.45, 0.11, 0.22, front_door=False)
        if state != "damaged":
            tang_roof("c_roof", P, root, 0, 0.15, H + t_, w_ + 0.5, d_ + 0.5, 0.75, 0.55, kind="wudian", lift=0.05,
                      chiwei=False, tile_pitch=0.2, tile_amp=0.025)
        else:                                      # the roof burnt half away
            tang_roof("c_roof", P, root, -0.7, 0.15, H + t_, (w_ + 0.5) * 0.55, d_ + 0.5, 0.75, 0.55, kind="wudian",
                      lift=0.05, chiwei=False, tile_pitch=0.2, tile_amp=0.025)
    else:                                          # a timber gallery under a pitched roof
        wood = lib.mat("timber", (0.16, 0.12, 0.08), 0.8)
        box("c_gal", (3.0, 1.6, 1.3), wood, root, loc=(0, 0.1, H + 0.65))
        for k in range(3):
            box(f"c_galw{k}", (0.3, 0.04, 0.3), P["dark"], root, loc=(-1.0 + k, 0.1 - 0.81, H + 0.8))
        if state != "damaged":
            for sy in (-1, 1):
                box(f"c_galroof{sy}", (3.3, 1.15, 0.09), P["tile"], root, loc=(0, 0.1 + sy * 0.45, H + 1.6), rot=(sy * -30, 0, 0))
    kit.flag("c_flag", P, root, (tw / 2 - 0.35, -td / 2 + 0.35, H), 3.0, c, w=1.0, fh=1.3)
    _finish(root, P, c, state, spots, H, x0, x1, y0, y1)


def _finish(root, P, c, state, spots, H, x0, x1, y0, y1):
    rnd = random.Random(21)
    if state == "damaged":
        _debris(root, P, rnd, x0 + 1.2, y0 - 0.5, 14, 1.2, P["earth"] if c == "E" else P["stone"])
        _fire(root, P, x1 - 1.5, y0 - 0.02, H * 0.55)
        _fire(root, P, x0 + 0.02, (y0 + y1) / 2 + 0.6, H * 0.6, k=1)
    if state == "garrison":
        front = [(x, y) for x, y in spots if abs(y - min(s[1] for s in spots)) < 0.3][:6]
        side = [(x, y) for x, y in spots if abs(x - min(s[0] for s in spots)) < 0.3][:3]
        _garrison(P, root, c, [(x, y + 0.45) for x, y in front], H - 0.35, "s")
        _garrison(P, root, c, [(x + 0.45, y) for x, y in side], H - 0.35, "w")
    for k, (x, y) in enumerate(spots[:4]):          # where the men poke from (the client: hidden spearmen's thrusts)
        lib.empty(f"shoot_at_{k}", parent=root, loc=(x, y, H + 0.6))


def r12_outpost(root, c="E", opt="A", state="done"):
    {"A": opt_a, "B": opt_b, "C": opt_c}[opt](root, c, state)


FOOTPRINT = {"r12_outpost": (3, 3)}
BUILDERS = {"r12_outpost": r12_outpost}
