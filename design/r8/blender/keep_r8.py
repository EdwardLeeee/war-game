"""D-100 (the user 2026-10-23): the keep (主堡) at every town's centre, 3 x 3 cells (6 x 6 m), that shoots arrows; the big
city's tower becomes its keep. After research/keep-reference (notes.md, 給美術的要點), in the R8 look.

East: the gate tower of a prefecture's inner citadel (子城門樓, 譙樓/鼓角樓; 五臺山圖's gate, east ref 03; 袁州譙樓's
  proportions): a broad rammed-earth platform filling the 6 x 6 m, 3.2 m high, battered 1:4, its tamping layers showing; a
  flat-topped timber gate passage in the front (1.8 x 2.0 m, never a brick arch); on top, set back, a three-bay hall of
  two storeys under double eaves, a 歇山 roof with 鴟尾, about 8 m in all; along the front edge a walk and a parapet hung
  with 皮竹笆 shields, each with a square arrow window (武經總要); the war drum (arch_r8.war_drum) on the walk.
West: a square keep of the 12th century still in use about 1250 (Rochester, Goodrich, Viollet-le-Duc's Chambois): a 4.6 x
  4.6 m block of rubble with pale ashlar quoins, a battered plinth, two flat buttresses a face, corner turrets 1.2 m above
  the crenels at about 7.2 m; slits below, round-headed windows above; a low forebuilding with a stair to the first
  floor's door; all round the top a timber hoarding standing out 0.9 m under a lean-to roof, two small windows a face.
The player's colour only on flags and cloth (neutral: grey-white, the same layer tinted). Arrow points: shoot_at_<k>
empties at the windows the archers shoot from (the client plays effects.json tower_shot there, as at the gates).
state: done, damaged (fire in the roofs or the hoarding), rubble (the timber burnt away, a corner fallen), repair
(scaffolding, new timber and stone, the fallen corner being rebuilt).
"""
import math
import random

import lib
from lib import box, cyl, rod, slab, sphere
import kit
from arch_r8 import palette, hall_e, tang_roof, war_drum, lancet_w

CELL = 2.0


def _mark(root, name, loc):
    """An arrow point (render_b1 writes every shoot_at_* empty into the piece's json)."""
    lib.empty(name, parent=root, loc=loc)


# ---------------------------------------------------------------- East

def _rammed_platform(P, root, W, H, batter, seed, corner_cut=None):
    """The platform in tamping layers about 15 cm thick, each a little in or out and two earth tones; corner_cut:
    (sx, sy, depth) to leave a fallen corner."""
    rnd = random.Random(seed)
    earth1 = lib.mat("earth", (0.3, 0.21, 0.12), 0.95)          # yellow-brown loess, a darker and a paler course
    earth2 = lib.mat("earth_b1", (0.22, 0.155, 0.09), 0.95)
    n = int(H / 0.15)
    for k in range(n):
        z0 = k * H / n
        w0 = W - 2 * z0 / batter
        w1 = W - 2 * (z0 + H / n) / batter
        jit = rnd.uniform(-0.015, 0.015)
        box(f"kp_layer{k}", (w0 + jit, w0 + jit, H / n * 0.92), earth1 if k % 2 else earth2, root,
            loc=(0, 0, z0 + H / n / 2), taper=(w1 / w0, w1 / w0))
        box(f"kp_seam{k}", (w0 - 0.02, w0 - 0.02, H / n * 0.1), earth2, root, loc=(0, 0, z0 + H / n * 0.96))   # the seam
    if corner_cut:
        pass


def _shield(P, root, name, x, y, z, rot_z, w=0.85, h=0.95):
    """皮竹笆: a hide-and-bamboo screen hung outside the parapet, a square arrow window in it."""
    hide = lib.mat("hide_r8", (0.28, 0.2, 0.12), 0.9)
    g = lib.empty(name, parent=root, loc=(x, y, z), rot=(0, 0, rot_z))
    box(name + "_b", (w, 0.05, h), hide, g, loc=(0, 0, 0))
    for k in range(5):
        rod(f"{name}_cane{k}", (-w / 2 + 0.05 + k * (w - 0.1) / 4, -0.03, -h / 2), (-w / 2 + 0.05 + k * (w - 0.1) / 4, -0.03, h / 2),
            0.012, P["wood"], parent=g, segs=4)
    box(name + "_win", (0.2, 0.07, 0.2), P["dark"], g, loc=(0, -0.01, 0.12))


def keep_east(root, c, state="done"):
    P = palette(c)
    W, H, batter = 6.0, 3.2, 4.0
    top = W - 2 * H / batter                       # 4.4 m
    _rammed_platform(P, root, W, H, batter, 3)
    # the gate passage: a flat timber frame, closed red doors, a dark recess
    yf = -W / 2 + 0.12
    box("kg_recess", (1.8, 0.4, 2.0), P["dark"], root, loc=(0, yf + 0.45, 1.0))
    for sx in (-1, 1):
        box(f"kg_post{sx}", (0.22, 0.3, 2.15), P["timber"], root, loc=(sx * 1.0, yf - 0.06, 1.07))
    box("kg_lintel", (2.3, 0.32, 0.26), P["timber"], root, loc=(0, yf - 0.06, 2.2))
    for e in (-1, 1):
        box(f"kg_door{e}", (0.88, 0.08, 1.95), P["red"], root, loc=(e * 0.45, yf + 0.0, 0.98))
        for r_ in range(5):
            for q in range(2):
                sphere(f"kg_stud{e}{r_}{q}", 0.03, P["gold"], root, loc=(e * (0.25 + q * 0.4) * 0.9, yf - 0.05, 0.35 + r_ * 0.35), segs=6, rings=4)
    # the walk and the parapet along the front and the sides
    zt = H
    box("kp_deck", (top, top, 0.1), P["pave"], root, loc=(0, 0, zt + 0.05))
    par_h = 1.0
    for k, (L, loc, axis) in enumerate(((top, (0, -top / 2 + 0.12, zt + 0.1 + par_h / 2), "x"),
                                        (top, (-top / 2 + 0.12, 0, zt + 0.1 + par_h / 2), "y"),
                                        (top, (top / 2 - 0.12, 0, zt + 0.1 + par_h / 2), "y"))):
        size = (L, 0.24, par_h) if axis == "x" else (0.24, L, par_h)
        box(f"kp_par{k}", size, P["brick"], root, loc=loc)
    for k in range(3):                             # the front's three crenels: gaps in the parapet's top
        x = -top / 2 + top * (k + 1) / 4
        box(f"kp_cren{k}", (0.5, 0.3, 0.45), P["dark"], root, loc=(x, -top / 2 + 0.12, zt + 0.1 + par_h - 0.2))
    rnd = random.Random(5)
    marks = 0
    for k in range(4):                             # the screens: hung outside the front parapet, one on each side
        x = -top / 2 + 0.6 + k * (top - 1.2) / 3
        _shield(P, root, f"kp_sh{k}", x, -top / 2 - 0.02, zt + 0.55, 0.0)
        _mark(root, f"shoot_at_{marks}", (x, -top / 2 - 0.2, zt + 0.7))
        marks += 1
    for sx in (-1, 1):
        _shield(P, root, f"kp_shs{sx}", sx * (top / 2 + 0.02), -0.6, zt + 0.55, 90.0)
        _mark(root, f"shoot_at_{marks}", (sx * (top / 2 + 0.2), -0.6, zt + 0.7))
        marks += 1
    # the tower: set back, three bays, two storeys, double eaves
    ty = top / 2 - 1.5
    w1, d1, t1 = hall_e("kt_low", P, root, 0, ty, zt + 0.1, (0.9, 1.2, 0.9), (2.4,), 1.6, 0.13, 0.28, qizhu=True)
    tang_roof("kt_eave", P, root, 0, ty, zt + 0.1 + t1, w1 + 0.3, d1 + 0.3, 0.45, 0.65, kind="wudian", lift=0.04, chiwei=False,
              tile_pitch=0.24, tile_amp=0.025)
    z2 = zt + 0.1 + t1 + 0.34
    box("kt_balc", (w1 + 0.2, d1 + 0.2, 0.12), P["timber"], root, loc=(0, ty, z2))
    for k in range(10):                            # the 平坐 railing round the upper floor
        x = -(w1 + 0.1) / 2 + k * (w1 + 0.1) / 9
        cyl(f"kt_rail{k}", 0.025, 0.5, P["red"], root, loc=(x, ty - (d1 + 0.1) / 2, z2), segs=6)
    box("kt_railbar", (w1 + 0.15, 0.05, 0.06), P["red"], root, loc=(0, ty - (d1 + 0.1) / 2, z2 + 0.5))
    w2, d2, t2 = hall_e("kt_up", P, root, 0, ty, z2 + 0.06, (0.8, 1.1, 0.8), (2.0,), 1.25, 0.11, 0.24, front_door=True)
    tang_roof("kt_roof", P, root, 0, ty, z2 + 0.06 + t2, w2 + 0.3, d2 + 0.3, 0.85, 0.7, kind="xieshan", lift=0.05,
              chiwei=True, chiwei_s=0.7, tile_pitch=0.24, tile_amp=0.025)
    for k in range(2):                             # the upper windows the archers shoot from
        _mark(root, f"shoot_at_{marks}", ((k - 0.5) * 1.6, ty - d2 / 2 - 0.25, z2 + 0.75))
        marks += 1
    war_drum("kp_drum", P, root, 1.35, -top / 2 + 0.75, r=0.34, h=zt + 0.1 + 0.25)
    for sx in (-1, 1):
        kit.flag(f"kp_flag{sx}", P, root, (sx * (top / 2 - 0.25), -top / 2 + 0.3, zt + 0.1), 3.4, c, w=1.0, fh=1.4)
    kit.drape("kp_hang", P, root, "y", 0.0, z2 + 1.15, 0.8, 0.9, y0=ty - d2 / 2 - 0.12)
    for sx in (-1, 1):
        kit.drape(f"kp_ghang{sx}", P, root, "y", sx * 1.65, H - 0.2, 0.7, 1.4, y0=-W / 2 + 0.25 * 0.8 - 0.02)
    return dict(top=top, zt=zt, ty=ty, z2=z2)


# ---------------------------------------------------------------- West

def keep_west(root, c, state="done"):
    P = palette(c)
    ashlar = lib.mat("ashlar", (0.46, 0.43, 0.37), 0.85)
    S, Hw = 4.6, 7.2
    cx0, cy = -0.4, 0.3                            # the block left of the middle: the forebuilding fits on its right
    g = lib.empty("kw_body", parent=root, loc=(cx0, cy, 0))
    g["block"] = [cx0, cy, S, S, 0.0, Hw]
    box("kw_plinth", (S + 0.5, S + 0.5, 0.9), P["stone"], root, loc=(cx0, cy, 0.45), taper=(S / (S + 0.5), S / (S + 0.5)))
    box("kw_block", (S, S, Hw), P["stone"], g, loc=(0, 0, Hw / 2))
    for k in range(int((Hw - 0.9) / 0.42)):        # the quoins: pale dressed stones at the corners, long and short in turn
        z = 0.9 + k * 0.42 + 0.2
        for sx in (-1, 1):
            for sy in (-1, 1):
                a, b = (0.55, 0.3) if k % 2 else (0.3, 0.55)
                box(f"kw_q{k}{sx}{sy}", (a, b, 0.38), ashlar, g, loc=(sx * (S / 2 - a / 2 + 0.025), sy * (S / 2 - b / 2 + 0.025), z))
    for k, x in enumerate((-S / 6, S / 6)):        # two flat buttresses a face (the front and the left side seen)
        box(f"kw_bf{k}", (0.4, 0.16, Hw - 0.6), P["stone"], g, loc=(x, -S / 2 - 0.08, (Hw - 0.6) / 2 + 0.3))
        box(f"kw_bl{k}", (0.16, 0.4, Hw - 0.6), P["stone"], g, loc=(-S / 2 - 0.08, x, (Hw - 0.6) / 2 + 0.3))
    for k, (x, z, w, h) in enumerate(((-0.55, 1.6, 0.09, 0.7), (0.55, 1.6, 0.09, 0.7))):     # slits below
        box(f"kw_slit{k}", (w, 0.1, h), P["dark"], root, loc=(cx0 + x, cy - S / 2 - 0.03, z))
    for k, x in enumerate((-0.7, 0.7)):            # round-headed windows above (lancet_w with a round head)
        box(f"kw_win{k}", (0.38, 0.1, 0.62), P["dark"], root, loc=(cx0 + x, cy - S / 2 - 0.03, 4.6))
        cyl(f"kw_winhead{k}", 0.19, 0.1, P["dark"], root, loc=(cx0 + x, cy - S / 2 + 0.02, 4.91), rot=(90, 0, 0), segs=16)
        box(f"kw_winsill{k}", (0.5, 0.16, 0.08), ashlar, root, loc=(cx0 + x, cy - S / 2 - 0.06, 4.27))
    # the crenellated parapet, the corner turrets standing above it
    zc = Hw
    for side in range(4):
        for i in range(5):
            t = -S / 2 + 0.45 + i * (S - 0.9) / 4
            pos = {0: (t, -S / 2 + 0.12), 1: (t, S / 2 - 0.12), 2: (-S / 2 + 0.12, t), 3: (S / 2 - 0.12, t)}[side]
            if i % 2 == 0:
                box(f"kw_merl{side}{i}", (0.5 if side < 2 else 0.24, 0.24 if side < 2 else 0.5, 0.55), P["stone"], g,
                    loc=(pos[0], pos[1], zc + 0.27))
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(f"kw_tur{sx}{sy}", (0.95, 0.95, 1.2 + 0.5), P["stone"], g, loc=(sx * (S / 2 - 0.47), sy * (S / 2 - 0.47), zc + 0.85))
            for i in range(2):
                box(f"kw_turm{sx}{sy}{i}", (0.3, 0.3, 0.35), P["stone"], g,
                    loc=(sx * (S / 2 - 0.47) + (i - 0.5) * 0.5 * (1 if sy < 0 else -1), sy * (S / 2 - 0.47) - sy * 0.32, zc + 1.88))
    # the hoarding: a timber gallery all round, standing out on beams, a lean-to roof sloping out, two windows a face
    hz = zc - 0.25
    over = 0.9
    wood = lib.mat("timber", (0.16, 0.12, 0.08), 0.8)
    for side in range(4):
        horiz = side < 2
        sgn = -1 if side in (0, 2) else 1
        L = S - 1.9
        cx = 0 if horiz else sgn * (S / 2 + over / 2)
        cy2 = (sgn * (S / 2 + over / 2)) if horiz else 0
        size = (L, over, 1.25) if horiz else (over, L, 1.25)
        box(f"kw_hoard{side}", size, wood, g, loc=(cx, cy2, hz + 0.62))
        box(f"kw_hoardroof{side}", (L + 0.1, over + 0.25, 0.08) if horiz else (over + 0.25, L + 0.1, 0.08), P["tile"], g,
            loc=(cx + (0 if horiz else sgn * 0.1), cy2 + (sgn * 0.1 if horiz else 0), hz + 1.3),
            rot=((sgn * -14) if horiz else 0, 0 if horiz else (sgn * 14), 0))
        for k in range(4):                         # the beams it stands on
            t = -L / 2 + 0.2 + k * (L - 0.4) / 3
            box(f"kw_hbeam{side}{k}", (0.14, over + 0.3, 0.16) if horiz else (over + 0.3, 0.14, 0.16), wood, g,
                loc=(t if horiz else cx - sgn * 0.15, (cy2 - sgn * 0.15) if horiz else t, hz - 0.05))
        for k in range(2):
            t = (k - 0.5) * L * 0.45
            loc = (t, cy2 + sgn * (over / 2 + 0.01), hz + 0.75) if horiz else (cx + sgn * (over / 2 + 0.01), t, hz + 0.75)
            box(f"kw_hwin{side}{k}", (0.3, 0.04, 0.3) if horiz else (0.04, 0.3, 0.3), P["dark"], g, loc=loc)
            if True:                               # every face shoots (the client uses the point nearest the target)
                _mark(root, f"shoot_at_{side * 2 + k}", (loc[0] + cx0 + (0 if horiz else sgn * 0.2),
                                                       loc[1] + cy + (sgn * 0.2 if horiz else 0), loc[2]))
    cyl("kw_roof", (S - 1.9) * 0.72, 1.1, P["tile"], g, loc=(0, 0, zc), r2=0.05, segs=4, rot=(0, 0, 45))
    # the forebuilding on the right, its stair up from the front to the first floor's door
    fx = cx0 + S / 2 + 0.5                         # the forebuilding against the right face, 1.0 m wide, flush in front
    fy0, fy1 = cy - S / 2, cy + 0.4
    box("kw_fore", (1.0, fy1 - fy0, 3.3), P["stone"], root, loc=(fx, (fy0 + fy1) / 2, 1.65))
    for i in range(2):
        box(f"kw_forem{i}", (0.3, 0.3, 0.35), P["stone"], root, loc=(fx, fy0 + 0.25 + i * 0.6, 3.47))
    box("kw_door", (0.7, 0.1, 1.45), P["wood"], root, loc=(fx, fy0 - 0.06, 2.5 + 0.72))       # the door at 2.5 m
    box("kw_doorhead", (0.86, 0.14, 0.16), ashlar, root, loc=(fx, fy0 - 0.08, 2.5 + 1.52))
    # the stair: along the keep's front from the left up to a landing before the forebuilding's door (its sawtooth seen
    # from the camera), a low wall on its open side
    n = 11
    x0, x1 = cx0 - 0.6, fx - 0.55
    sy = fy0 - 0.5
    for i in range(n):
        h = 2.5 * (i + 1) / (n + 1)
        x = x0 + (x1 - x0) * (i + 0.5) / n
        box(f"kw_step{i}", ((x1 - x0) / n + 0.01, 0.9, h), P["stone"], root, loc=(x, sy, h / 2))
    box("kw_landing", (1.1, 0.95, 2.5), P["stone"], root, loc=(fx, sy, 1.25))

    for sx in (-1, 1):
        kit.flag(f"kw_flag{sx}", P, root, (cx0 + sx * (S / 2 - 0.47), cy - (S / 2 - 0.47), zc + 1.7), 2.4, c, w=0.9, fh=1.0)
    kit.drape("kw_hang", P, root, "y", cx0, hz + 1.2, 1.0, 1.0, y0=cy - S / 2 - over - 0.02)
    kit.drape("kw_hangl", P, root, "x", cy, hz + 1.2, 0.9, 1.0, x0=cx0 - S / 2 - over - 0.02)
    return dict(S=S, Hw=Hw, cx0=cx0, cy=cy, hz=hz, fx=fx, fy0=fy0, fy1=fy1)


# ---------------------------------------------------------------- the states

def _cut(obs, cutter):
    """Boolean difference of `cutter` (a mesh, hidden) from every object in obs."""
    import bpy
    for ob in obs:
        if ob.type != "MESH" or ob is cutter:
            continue
        m = ob.modifiers.new("keep_cut", "BOOLEAN")
        m.operation = "DIFFERENCE"
        m.solver = "EXACT"
        m.object = cutter
    cutter.hide_render = True
    cutter.display_type = "WIRE"


def _cutter(name, size, loc, rot):
    import states
    ob = box(name, size, lib.mat("cutter", (1, 0, 1)), None, loc=loc, rot=rot, outline=False)
    states._forget(ob)
    return ob


def _debris(root, P, rnd, cx, cy, n, spread, zmax, mats):
    import terrain_r8
    for k in range(n):
        x, y = cx + rnd.gauss(0, spread), cy + rnd.gauss(0, spread * 0.7)
        r = rnd.uniform(0.07, 0.24)
        terrain_r8._rock(f"kd_{k}", r, mats[k % len(mats)], root, (x, y, r * 0.25 + rnd.uniform(0, zmax)), rnd)


def _low_ruin(root, c, info):
    """The keep thrown down (war-game-core 2026-10-23: its 3 x 3 cells walk again, it is rebuilt where it stood): R8's
    ruin (states.r8_ruin: everything cut at knee height, under 0.6 m), its own extras: the east's platform a low stub of
    rammed earth in layers with clods of it about; the west's wall footings with the keep's dressed stone in the heap."""
    import states
    root["no_bases"] = True                     # no column bases: the tower stood 3 m up on the platform
    states.apply(root, "r8_keep", c, "destroyed_a")
    rnd = random.Random(29)
    if c == "E":                                # a low heap of the platform's earth over the stub, timber and tiles in it
        import terrain_r8
        earth = lib.mat("earth", (0.3, 0.21, 0.12), 0.95)
        earth2 = lib.mat("earth_b1", (0.22, 0.155, 0.09), 0.95)
        for ob in [o for o in kit.parts_under(root) if o.name.startswith("rb_soot")][3:]:
            states._drop(ob)
        for k in range(46):
            x, y = rnd.gauss(0, 1.1), rnd.gauss(0, 1.0)
            if abs(x) > 2.6 or abs(y) > 2.6:
                continue
            r = rnd.uniform(0.08, 0.18) * (1.0 - 0.4 * min(1.0, math.hypot(x, y) / 2.5))
            terrain_r8._rock(f"kd_clod{k}", r, earth if k % 3 else earth2, root, (x, y, 0.44 + r * 0.1), rnd)
        char = lib.mat("wooddark", (0.03, 0.026, 0.022), 0.95)
        for k in range(7):
            a_ = rnd.uniform(0, math.pi)
            x, y, L = rnd.uniform(-1.8, 1.8), rnd.uniform(-1.6, 1.6), rnd.uniform(1.2, 2.2)
            rod(f"kd_beam{k}", (x - math.cos(a_) * L / 2, y - math.sin(a_) * L / 2, 0.48),
                (x + math.cos(a_) * L / 2, y + math.sin(a_) * L / 2, 0.52), 0.07, char, parent=root, segs=6)
    else:
        ashlar = lib.mat("ashlar", (0.46, 0.43, 0.37), 0.85)
        _debris(root, palette(c), rnd, info["cx0"], info["cy"], 26, 1.4, 0.3, [ashlar, lib.mat("rubble", (0.3, 0.28, 0.25), 0.9)])


def _repair(root, c, info):
    """The ruin being rebuilt (the town governed, its repair counting down): scaffolding over the whole footprint,
    stakes and lines, the materials: the east's rammed-earth formwork (posts, boards tied with straw rope) and baskets
    of earth, new raw timber; the west's new pale stone, a small jib crane."""
    import states
    P = palette(c)
    W = 6.0
    states.scaffold(root, kit.palette(c), c, -W / 2 + 0.3, W / 2 - 0.3, -W / 2 + 0.3, W / 2 - 0.3, 3.6, z0=0.0, canvas=False,
                    name="kf_sc")
    rope = lib.mat("rope", (0.32, 0.26, 0.16), 0.9)
    wood = lib.mat("timber_raw", (0.32, 0.22, 0.13), 0.8)
    rnd = random.Random(31)
    if c == "E":                                # the first course of new rammed earth in its formwork, front left
        earth = lib.mat("earth", (0.3, 0.21, 0.12), 0.95)
        box("kf_newearth", (2.4, 2.4, 0.9), earth, root, loc=(-1.6, -1.6, 0.45))
        for k in range(2):
            z = 0.45 + k * 0.5
            box(f"kf_board{k}", (2.6, 0.05, 0.42), wood, root, loc=(-1.6, -2.85, z))
            box(f"kf_boards{k}", (0.05, 2.6, 0.42), wood, root, loc=(-2.85, -1.6, z))
        for x, y in ((-2.9, -2.9), (-0.3, -2.9), (-2.9, -0.3)):
            rod(f"kf_post{x}{y}", (x, y, 0.0), (x, y, 1.5), 0.06, wood, parent=root, segs=6)
        for k in range(2):
            rod(f"kf_rope{k}", (-2.9, -2.9, 0.6 + k * 0.5), (-0.3, -2.9, 0.6 + k * 0.5), 0.015, rope, parent=root, segs=4)
        for k in range(3):
            cyl(f"kf_basket{k}", 0.2, 0.3, P["straw"] if "straw" in P else rope, root, loc=(1.0 + k * 0.45, -2.5, 0.0), r2=0.24, segs=12)
        for k in range(4):
            rod(f"kf_log{k}", (0.6, -1.0 + k * 0.25, 0.1 + 0.08 * (k % 2)), (2.6, -1.0 + k * 0.25, 0.1 + 0.08 * (k % 2)), 0.08, wood,
                parent=root, segs=8)
    else:
        S, cx0, cy = info["S"], info["cx0"], info["cy"]
        new = lib.mat("ashlar", (0.58, 0.55, 0.48), 0.85)
        for k in range(12):                     # new pale stone laid on the footings, a stack waiting
            box(f"kf_new{k}", (0.5, 0.3, 0.3), new, root, loc=(cx0 - S / 2 + 0.4 + (k % 6) * 0.55, cy - S / 2 + 0.15, 0.6 + (k // 6) * 0.32))
        for k in range(8):
            box(f"kf_stack{k}", (0.5, 0.32, 0.28), new, root, loc=(1.8 + (k % 2) * 0.55, -2.4 + (k // 4) * 0.36, 0.14 + ((k // 2) % 2) * 0.3))
        rod("kf_jib", (-2.4, -2.3, 0.0), (-2.4, -2.3, 4.2), 0.08, wood, parent=root, segs=6)
        rod("kf_jibarm", (-2.4, -2.3, 4.0), (-1.0, -1.4, 4.3), 0.06, wood, parent=root, segs=6)
        rod("kf_jibrope", (-1.0, -1.4, 4.3), (-1.0, -1.4, 1.0), 0.012, rope, parent=root, segs=4)
        box("kf_load", (0.45, 0.32, 0.3), new, root, loc=(-1.0, -1.4, 0.85))


def r8_keep(root, c, state="done"):
    import states
    info = (keep_east if c == "E" else keep_west)(root, c, state)
    if state == "damaged":
        states.apply(root, "r8_keep", c, "damaged_a")
    elif state == "rubble":
        _low_ruin(root, c, info)
    elif state == "repair":                     # the ruin with scaffolding (the keep is rebuilt at once when done)
        _low_ruin(root, c, info)
        _repair(root, c, info)


FOOTPRINT = {"r8_keep": (3, 3)}
BUILDERS = {"r8_keep": r8_keep}
