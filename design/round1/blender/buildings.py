"""Buildings and props (Blender side): 城樓 corner, East town, West stone tower,
gold mine, trees, rocks, grass tufts. Buildings face world -Y (screen lower right)."""
import math
import os
import random

import bmesh
import bpy

import lib
from lib import box, cyl, ico, lathe, mat, rod, slab, sphere


def roof(name, w, d, h, over, curl, material, parent=None, loc=(0, 0, 0), thick=0.14):
    """East hip roof: concave slopes, ridge along X, upturned corners."""
    A, B = w / 2 + over, d / 2 + over
    R = max(0.05, w / 2 - d / 2)
    per = 10
    bm = bmesh.new()
    rings = []
    ts = [0, 0.12, 0.28, 0.46, 0.66, 0.84, 1.0]
    for t in ts:
        ax = A + (R - A) * t
        ay = max(0.0005, B * (1 - t))
        z = h * t ** 1.7
        pts = []
        corners = [(ax, ay), (-ax, ay), (-ax, -ay), (ax, -ay)]
        for c in range(4):
            x0, y0 = corners[c]
            x1, y1 = corners[(c + 1) % 4]
            for k in range(per):
                f = k / per
                x, y = x0 + (x1 - x0) * f, y0 + (y1 - y0) * f
                prox = (abs(x) / ax) ** 4 * (abs(y) / ay) ** 4 if ay > 0.001 else 0
                lift = curl * prox * (1 - t) ** 2
                pts.append(bm.verts.new((x, y, z + lift)))
        rings.append(pts)
    n = len(rings[0])
    for j in range(len(rings) - 1):
        for i in range(n):
            bm.faces.new((rings[j][i], rings[j][(i + 1) % n], rings[j + 1][(i + 1) % n], rings[j + 1][i]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.002)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = lib._mesh_obj(name, bm, material, parent, loc, smooth=True)
    mod = ob.modifiers.new("thick", "SOLIDIFY")
    mod.thickness = thick
    mod.offset = -1
    ob.modifiers.move(len(ob.modifiers) - 1, 0)
    # ridge beam with curled ends
    ridge_mat = mat("roof_ridge", (0.16, 0.16, 0.18), 0.6)
    box(name + "_ridge", (2 * R + 0.3, 0.22, 0.22), ridge_mat, parent, loc=(loc[0], loc[1], loc[2] + h + 0.05))
    for s in (-1, 1):
        box(name + f"_orn{s}", (0.22, 0.2, 0.5), ridge_mat, parent,
            loc=(loc[0] + s * (R + 0.15), loc[1], loc[2] + h + 0.3), rot=(0, 20 * s, 0))
    return ob


def P():
    return dict(
        tile=mat("tile", (0.2, 0.22, 0.26), 0.55, pattern="tiles", pattern_scale=2.2),
        plaster=mat("plaster", (0.86, 0.83, 0.76), 0.9, noise=0.08, noise_scale=8),
        red_post=mat("red_post", (0.55, 0.1, 0.07), 0.45),
        timber=mat("timber", (0.25, 0.15, 0.08), 0.7, noise=0.25, noise_scale=6),
        stone=mat("stone_blk", (0.5, 0.47, 0.43), 0.85, pattern="block", pattern_scale=0.9),
        brick=mat("brick", (0.4, 0.37, 0.34), 0.88, pattern="brick", pattern_scale=2.4),
        earth=mat("earth", (0.55, 0.45, 0.32), 0.9, noise=0.3, noise_scale=6),
        lattice=mat("lattice", (0.3, 0.2, 0.12), 0.7),
        gold=mat("gold", (1.0, 0.7, 0.18), 0.25, 1.0, emission=0.35),
        rock=mat("rock", (0.3, 0.27, 0.24), 0.85, noise=0.45, noise_scale=5),
        leaf=mat("leaf", (0.17, 0.33, 0.1), 0.7, noise=0.35, noise_scale=12, sheen=0.3),
        leaf2=mat("leaf2", (0.24, 0.38, 0.12), 0.7, noise=0.35, noise_scale=12, sheen=0.3),
        pine=mat("pine", (0.08, 0.22, 0.12), 0.75, noise=0.3, noise_scale=14),
        bark=mat("bark", (0.28, 0.2, 0.13), 0.9, noise=0.3, noise_scale=20),
        grass=mat("grass_tuft", (0.3, 0.45, 0.14), 0.8, sheen=0.3),
        slate=mat("slate", (0.24, 0.26, 0.3), 0.6, noise=0.25, noise_scale=20),
        wood=mat("wood", (0.42, 0.27, 0.14), 0.7, noise=0.3, noise_scale=6),
        dark=mat("dark", (0.07, 0.065, 0.06), 0.7),
        red_lantern=mat("red_lantern", (0.75, 0.12, 0.06), 0.5),
        team=mat("team", kind="team", rough=0.75, sheen=0.3),
        rope=mat("rope", (0.55, 0.46, 0.3), 0.9),
        straw=mat("straw", (0.8, 0.66, 0.36), 0.9, noise=0.25, noise_scale=30),
    )


def banner(name, Pm, parent, loc, h, emblem, w=0.9, fh=1.6):
    rod(name + "_pole", loc, (loc[0], loc[1], loc[2] + h), 0.05, Pm["timber"], parent=parent)
    sphere(name + "_finial", 0.09, mat("bronze", (0.78, 0.55, 0.25), 0.35, 1.0), parent,
           loc=(loc[0], loc[1], loc[2] + h + 0.05))
    fm = lib.flag_mat("flag_" + emblem, os.path.join(os.environ["EMBLEM_DIR"], emblem + ".png"))
    # a hanging banner (vertical) facing the viewer side (-Y), slightly waved
    pts = [(0, 0), (w, -0.04), (w * 0.98, -fh), (w * 0.5, -fh * 0.9), (0, -fh)]
    ob = slab(name + "_flag", pts, 0.03, fm, parent=parent,
              loc=(loc[0] + 0.05, loc[1] - 0.02, loc[2] + h - 0.1), rot=(0, 0, -20))
    rod(name + "_bar", (loc[0], loc[1], loc[2] + h - 0.08), (loc[0] + w * 0.94, loc[1] - w * 0.34, loc[2] + h - 0.12),
        0.025, Pm["timber"], parent=parent)
    return ob


def crenels(name, Pm, material, parent, x0, x1, y, z, n, size=(0.5, 0.5, 0.5), east=True):
    for k in range(n):
        x = x0 + (x1 - x0) * (k + 0.5) / n
        box(f"{name}{k}", size, material, parent, loc=(x, y, z + size[2] / 2), bevel=0.03)


def citygate_e(root):
    Pm = P()
    # platform (墩台) with a gate arch, and wall wings along X
    box("cg_base", (8.0, 5.2, 3.8), Pm["brick"], root, loc=(0, 0, 1.9), bevel=0.08, taper=(0.96, 0.94))
    box("cg_plinth", (8.3, 5.5, 0.6), Pm["stone"], root, loc=(0, 0, 0.3), bevel=0.05)
    for s in (-1, 1):
        box(f"cg_wall{s}", (7.0, 4.4, 3.4), Pm["brick"], root, loc=(s * 7.2, 0.3, 1.7), bevel=0.06,
            taper=(1, 0.94))
        box(f"cg_wallpl{s}", (7.1, 4.7, 0.5), Pm["stone"], root, loc=(s * 7.2, 0.3, 0.25), bevel=0.04)
        crenels(f"cg_cren{s}_", Pm, Pm["brick"], root, s * 3.9, s * 10.6, -1.75, 3.4, 8, (0.55, 0.35, 0.55))
    # gate arch (dark opening) with red doors
    box("cg_gate", (2.2, 0.3, 2.6), Pm["dark"], root, loc=(0, -2.62, 1.3), outline=False)
    cyl("cg_arch", 1.1, 0.3, Pm["dark"], root, loc=(0, -2.62, 2.6), rot=(90, 0, 0), at=(0, 0, -0.15),
        outline=False)
    for s in (-1, 1):
        box(f"cg_door{s}", (0.9, 0.12, 2.5), Pm["red_post"], root, loc=(s * 0.5, -2.7, 1.25))
    crenels("cg_parapet", Pm, Pm["brick"], root, -3.9, 3.9, -2.45, 3.8, 9, (0.5, 0.3, 0.45))
    # tower hall (城樓) on top: red pillars, lattice walls, two roofs
    top = lib.empty("cg_top", parent=root, loc=(0, 0.2, 3.8))
    box("cg_floor", (6.6, 3.8, 0.25), Pm["stone"], top, loc=(0, 0, 0.12))
    box("cg_hall", (5.6, 3.0, 2.2), Pm["plaster"], top, loc=(0, 0, 1.35))
    for k in range(6):
        x = -2.9 + k * 1.16
        for y in (-1.6, 1.6):
            cyl(f"cg_post{k}{y}", 0.13, 2.3, Pm["red_post"], top, loc=(x, y, 0.25), segs=10)
        if 0 < k < 6:
            box(f"cg_lat{k}", (0.9, 0.08, 1.4), Pm["lattice"], top, loc=(x - 0.58, -1.52, 1.35))
    box("cg_rail", (6.4, 0.12, 0.12), Pm["red_post"], top, loc=(0, -1.75, 0.9))
    roof("cg_roof1", 6.6, 3.8, 1.2, 0.9, 0.55, Pm["tile"], top, loc=(0, 0, 2.5))
    box("cg_hall2", (4.2, 2.2, 1.4), Pm["plaster"], top, loc=(0, 0, 3.55))
    for k in range(4):
        x = -1.95 + k * 1.3
        cyl(f"cg_post2{k}", 0.11, 1.5, Pm["red_post"], top, loc=(x, -1.15, 2.85), segs=10)
    roof("cg_roof2", 4.6, 2.6, 1.4, 0.8, 0.5, Pm["tile"], top, loc=(0, 0, 4.3))
    # banners of 南溟 (white crane on the player colour)
    banner("cg_ban1", Pm, root, (-3.5, -2.6, 3.8), 3.6, "crane", w=1.0, fh=1.9)
    banner("cg_ban2", Pm, root, (3.2, -2.6, 3.8), 3.6, "crane", w=1.0, fh=1.9)


def house(name, Pm, parent, loc, w, d, rot=0):
    g = lib.empty(name, parent=parent, loc=loc, rot=(0, 0, rot))
    box(name + "_base", (w + 0.3, d + 0.3, 0.4), Pm["stone"], g, loc=(0, 0, 0.2), bevel=0.04)
    box(name + "_walls", (w, d, 2.2), Pm["plaster"], g, loc=(0, 0, 1.5))
    for x in (-w / 2, w / 2):
        for y in (-d / 2, d / 2):
            box(f"{name}_c{x}{y}", (0.18, 0.18, 2.3), Pm["timber"], g, loc=(x, y, 1.5))
    box(name + "_beam", (w + 0.1, d + 0.1, 0.16), Pm["timber"], g, loc=(0, 0, 2.55))
    box(name + "_door", (0.9, 0.08, 1.6), Pm["timber"], g, loc=(-w * 0.2, -d / 2 - 0.03, 1.2))
    box(name + "_win", (0.8, 0.08, 0.6), Pm["lattice"], g, loc=(w * 0.25, -d / 2 - 0.03, 1.7))
    roof(name + "_roof", w, d, 1.3, 0.7, 0.35, Pm["tile"], g, loc=(0, 0, 2.6))
    return g


def town_e(root):
    """東陸小鎮，我方治理：修好的屋瓦、糧袋、紅燈籠、插著我方白鶴旗。"""
    Pm = P()
    house("tw_h1", Pm, root, (-2.8, 1.8, 0), 3.6, 2.6)
    house("tw_h2", Pm, root, (2.6, 2.6, 0), 3.2, 2.4, rot=90)
    house("tw_h3", Pm, root, (-0.4, -1.8, 0), 3.0, 2.2)
    # drum tower (鼓樓): stone base + small hall
    tw = lib.empty("tw_tower", parent=root, loc=(3.2, -1.6, 0))
    box("tw_tbase", (2.4, 2.4, 2.4), Pm["stone"], tw, loc=(0, 0, 1.2), bevel=0.06, taper=(0.92, 0.92))
    box("tw_thall", (1.9, 1.9, 1.5), Pm["plaster"], tw, loc=(0, 0, 3.15))
    for x in (-0.9, 0.9):
        for y in (-0.9, 0.9):
            cyl(f"tw_tp{x}{y}", 0.09, 1.6, Pm["red_post"], tw, loc=(x, y, 2.4), segs=8)
    roof("tw_troof", 2.2, 2.2, 1.3, 0.7, 0.45, Pm["tile"], tw, loc=(0, 0, 3.9))
    # low stone wall arc in front
    for k in range(7):
        a = math.radians(-160 + k * 22)
        box(f"tw_wall{k}", (1.9, 0.5, 0.9), Pm["stone"], root, loc=(5.4 * math.cos(a), 5.0 * math.sin(a) + 0.6, 0.45),
            rot=(0, 0, math.degrees(a) + 90), bevel=0.05)
    # produce: sacks and crates (the town is paying taxes)
    for k, (x, y) in enumerate([(-1.9, -0.2), (-1.5, -0.5), (-2.2, -0.6)]):
        sphere(f"tw_sack{k}", 0.35, Pm["straw"], root, loc=(x, y, 0.3), scale=(1, 1, 0.8))
    box("tw_crate", (0.7, 0.7, 0.6), Pm["wood"], root, loc=(0.9, 0.1, 0.3), bevel=0.03)
    for k, (x, y) in enumerate([(-1.2, -2.95), (0.4, -2.95)]):
        sphere(f"tw_lantern{k}", 0.16, Pm["red_lantern"], root, loc=(x, y, 2.1), scale=(1, 1, 1.25))
    # the governing flag: 南溟 white crane on the player colour
    banner("tw_flag", Pm, root, (1.2, -3.6, 0), 6.2, "crane", w=1.3, fh=2.3)


def tower_w(root):
    """布倫莫爾的石造箭樓（西陸）：方塔、雉堞、箭孔、紅底雙塔旗。"""
    Pm = P()
    box("tw_w_base", (3.4, 3.4, 0.6), Pm["stone"], root, loc=(0, 0, 0.3), bevel=0.05)
    box("tw_w_body", (3.0, 3.0, 5.6), Pm["stone"], root, loc=(0, 0, 3.1), bevel=0.06, taper=(0.9, 0.9))
    box("tw_w_band", (3.2, 3.2, 0.35), Pm["stone"], root, loc=(0, 0, 5.9), bevel=0.04)
    for k in range(4):
        for s in (-1, 1):
            x = -1.2 + k * 0.8
            box(f"tw_w_mx{k}{s}", (0.45, 0.4, 0.55), Pm["stone"], root, loc=(x, s * 1.4, 6.35), bevel=0.03)
            box(f"tw_w_my{k}{s}", (0.4, 0.45, 0.55), Pm["stone"], root, loc=(s * 1.4, x, 6.35), bevel=0.03)
    for z in (2.2, 4.2):
        box(f"tw_w_slit{z}", (0.14, 0.1, 0.7), Pm["dark"], root, loc=(0, -1.43, z), outline=False)
        box(f"tw_w_slitb{z}", (0.1, 0.14, 0.7), Pm["dark"], root, loc=(1.43, 0.3, z), outline=False)
    box("tw_w_door", (0.9, 0.1, 1.6), Pm["wood"], root, loc=(-0.5, -1.5, 1.4))
    cyl("tw_w_arch", 0.45, 0.1, Pm["wood"], root, loc=(-0.5, -1.5, 2.2), rot=(90, 0, 0), at=(0, 0, -0.05))
    banner("tw_w_flag", Pm, root, (0.9, -0.9, 6.1), 2.2, "twintowers", w=0.9, fh=1.5)


def goldmine(root):
    Pm = P()
    rnd = random.Random(7)
    for k in range(7):
        x, y = rnd.uniform(-1.6, 1.6), rnd.uniform(-0.6, 1.2)
        r = rnd.uniform(0.65, 1.05)
        lumpy(f"gm_rock{k}", r, Pm["rock"], root, (x, y, r * 0.45), seed=k, squash=0.8)
    for k in range(16):
        x, y = rnd.uniform(-1.7, 1.7), rnd.uniform(-1.4, 0.2)
        ico(f"gm_gold{k}", rnd.uniform(0.2, 0.34), Pm["gold"], root, loc=(x, y - 0.3, rnd.uniform(0.3, 1.1)),
            subdiv=1, smooth=False)
    for k in range(6):   # a spill of ore on the ground
        ico(f"gm_ore{k}", 0.16, Pm["gold"], root, loc=(-0.6 + k * 0.25, -1.55 - 0.1 * (k % 2), 0.08),
            subdiv=1, smooth=False)
    # timber prop frame of the mine entrance
    for s in (-1, 1):
        rod(f"gm_post{s}", (s * 0.5, -0.9, 0), (s * 0.45, -0.9, 1.4), 0.07, Pm["wood"], parent=root)
    rod("gm_lintel", (-0.6, -0.9, 1.4), (0.6, -0.9, 1.4), 0.08, Pm["wood"], parent=root)
    box("gm_hole", (0.8, 0.1, 1.3), Pm["dark"], root, loc=(0, -0.8, 0.65), outline=False)


def lumpy(name, r, material, parent, loc, seed=0, squash=1.0, subdiv=3, amp=0.2):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    rnd = random.Random(seed)
    for v in bm.verts:
        k = 1 + rnd.uniform(-amp, amp)
        v.co.x *= k
        v.co.y *= k
        v.co.z *= k * squash
    return lib._mesh_obj(name, bm, material, parent, loc, smooth=True)


def tree(root, variant):
    Pm = P()
    rnd = random.Random(100 + variant)
    if variant == 2:   # pine
        cyl("tr_trunk", 0.18, 1.4, Pm["bark"], root, r2=0.12)
        for k, (r, z) in enumerate([(1.4, 1.0), (1.1, 2.1), (0.8, 3.1), (0.45, 4.0)]):
            cyl(f"tr_cone{k}", r, 1.5, Pm["pine"], root, loc=(0, 0, z), r2=0.02, segs=10)
        return
    h = 2.2 if variant == 0 else 1.8
    cyl("tr_trunk", 0.2, h + 0.6, Pm["bark"], root, r2=0.12, segs=10)
    rod("tr_branch", (0, 0, h * 0.7), (0.6, -0.2, h + 0.5), 0.08, Pm["bark"], parent=root)
    blobs = [(0, 0, h + 1.2, 1.35), (0.8, -0.3, h + 0.7, 0.95), (-0.7, 0.2, h + 0.8, 1.0), (0.1, 0.5, h + 1.9, 0.9),
             (-0.3, -0.6, h + 0.4, 0.8)]
    for k, (x, y, z, r) in enumerate(blobs):
        lumpy(f"tr_leaf{k}", r, Pm["leaf" if (k + variant) % 2 else "leaf2"], root, (x, y, z), seed=variant * 10 + k,
              amp=0.25)


def rock(root, variant=0):
    Pm = P()
    lumpy("rk_a", 0.5, Pm["rock"], root, (0, 0, 0.18), seed=3, squash=0.6)
    lumpy("rk_b", 0.3, Pm["rock"], root, (0.45, -0.25, 0.1), seed=5, squash=0.6)


def tuft(root, variant=0):
    Pm = P()
    rnd = random.Random(11)
    for k in range(14):
        a = rnd.uniform(0, 2 * math.pi)
        rr = rnd.uniform(0, 0.25)
        x, y = rr * math.cos(a), rr * math.sin(a)
        rod(f"tf_{k}", (x, y, 0), (x * 2.2 + rnd.uniform(-0.1, 0.1), y * 2.2, rnd.uniform(0.3, 0.55)), 0.035,
            Pm["grass"], parent=root, r2=0.003, segs=4, outline=False)


BUILDERS = {"citygate_e": citygate_e, "town_e": town_e, "tower_w": tower_w, "goldmine": goldmine,
            "tree": tree, "rock": rock, "tuft": tuft}
FRAME_M = {
    "citygate_e": (23.0, 14.5, 0.5, 0.64), "town_e": (15.0, 11.0, 0.5, 0.6), "tower_w": (6.0, 9.0, 0.5, 0.82),
    "goldmine": (6.0, 5.0, 0.5, 0.66), "tree": (5.0, 7.0, 0.5, 0.86), "rock": (2.0, 1.4, 0.5, 0.6),
    "tuft": (1.4, 1.0, 0.5, 0.7),
}


def build(kind, variant):
    import units
    u = units.Unit(kind)
    fn = BUILDERS[kind]
    if kind in ("tree", "rock", "tuft"):
        fn(u.root, variant)
    else:
        fn(u.root)
    u.face = lambda facing: None
    u.pose = lambda anim, frame: None
    return u
