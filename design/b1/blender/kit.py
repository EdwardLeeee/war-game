"""B1 building kit: the East (東陸) and West (西陸) palettes and the parts every building is made of.

Conventions (the same camera as the units, lib.Camera):
- metres; the footprint is centred on the origin, x and y along the map grid, z up;
- the camera looks north-east, so the two faces it sees are -X (screen lower left) and -Y (screen
  lower right); the corner nearest the camera is (-x, -y) and the far corner (+x, +y);
- every size comes from cells x CELL, so a change of the cell size (client M_PER_CELL, provisional)
  is a re-render, not a remodel;
- player colour only on cloth that faces the camera (lib material kind "team"; R5 lesson: large,
  in front, on the -X / -Y faces).

East: white plaster, red posts, dark grey curved tile roofs (hip, upturned corners), stone plinths.
West: grey stone, dark timber framing on cream plaster, blue-grey slate gable roofs, thatch on the
humblest sheds. Both sit in one painted-miniature style (the R5 units).
"""
import math
import os
import random

import bmesh
import bpy

import lib
from lib import box, cyl, ico, lathe, mat, rod, slab, sphere
import buildings as B1          # R1: the East hip roof, banners, lumpy rocks

CELL = 2.0          # metres per cell (client tuning M_PER_CELL, provisional)
INSET = 0.1         # the visible base stops this far inside the footprint edge


def cells(n):
    return n * CELL


# ---------------------------------------------------------------- palettes

def palette(culture):
    common = dict(
        team=mat("team", kind="team", rough=0.75, sheen=0.3),
        dark=mat("dark", (0.07, 0.065, 0.06), 0.7),
        rope=mat("rope", (0.55, 0.46, 0.3), 0.9),
        straw=mat("straw", (0.8, 0.66, 0.36), 0.9, noise=0.25, noise_scale=30),
        wood=mat("wood", (0.42, 0.27, 0.14), 0.7, noise=0.3, noise_scale=6),
        logend=mat("logend", (0.7, 0.52, 0.32), 0.8, noise=0.2, noise_scale=10),
        bark=mat("bark", (0.28, 0.2, 0.13), 0.9, noise=0.3, noise_scale=20),
        iron=mat("iron_b1", (0.2, 0.2, 0.22), 0.45, 1.0, pattern="worn_metal"),
        gold=mat("gold_b1", (0.85, 0.62, 0.22), 0.3, 1.0),
        ore=mat("ore_b1", (1.0, 0.72, 0.2), 0.25, 1.0, emission=0.25),
        crystal=mat("crystal_b1", (0.0, 0.5, 0.56), 0.15, emission=0.45),
        earth=mat("earth_b1", (0.5, 0.41, 0.3), 0.95, noise=0.3, noise_scale=6),
        rock=mat("rock_b1", (0.34, 0.31, 0.28), 0.85, noise=0.45, noise_scale=5),
        hay=mat("hay_b1", (0.78, 0.66, 0.34), 0.9, noise=0.3, noise_scale=25),
        sack=mat("sack_b1", (0.74, 0.65, 0.48), 0.95, noise=0.2, noise_scale=14),
        canvas=mat("canvas_b1", (0.82, 0.78, 0.68), 0.9, noise=0.1, noise_scale=10),
        target=mat("target_b1", (0.86, 0.82, 0.7), 0.9),
        target_red=mat("target_red_b1", (0.62, 0.16, 0.12), 0.8),
        fire=mat("fire_b1", (1.0, 0.42, 0.08), 0.5, emission=2.2),
        char=mat("char_b1", (0.09, 0.075, 0.065), 0.9, noise=0.3, noise_scale=12),
    )
    if culture == "E":
        common.update(
            tile=mat("tile_e", (0.2, 0.22, 0.26), 0.55, pattern="tiles", pattern_scale=3.0),
            ridge=mat("ridge_e", (0.15, 0.15, 0.17), 0.6),
            wall=mat("plaster_e", (0.86, 0.83, 0.76), 0.9, noise=0.08, noise_scale=8),
            post=mat("red_post_e", (0.52, 0.1, 0.07), 0.4, noise=0.15, noise_scale=12),
            beam=mat("timber_e", (0.24, 0.15, 0.08), 0.6, noise=0.3, noise_scale=10),
            stone=mat("stone_e", (0.52, 0.49, 0.45), 0.85, pattern="block", pattern_scale=1.2),
            brick=mat("brick_e", (0.42, 0.39, 0.36), 0.88, pattern="brick", pattern_scale=3.0),
            pave=mat("pave_e", (0.56, 0.53, 0.48), 0.9, pattern="block", pattern_scale=0.8),
            lattice=mat("lattice_e", (0.3, 0.2, 0.12), 0.7),
            paper=mat("paper_e", (0.88, 0.82, 0.66), 0.9),
            lantern=mat("lantern_e", (0.78, 0.14, 0.06), 0.5, emission=0.6),
            thatch=mat("thatch_e", (0.62, 0.5, 0.3), 0.95, noise=0.3, noise_scale=30),
            plaque=mat("plaque_e", (0.08, 0.1, 0.14), 0.4),
        )
    else:
        common.update(
            tile=mat("slate_w", (0.27, 0.3, 0.36), 0.6, pattern="tiles", pattern_scale=5.0),
            ridge=mat("ridge_w", (0.2, 0.22, 0.26), 0.6),
            wall=mat("plaster_w", (0.84, 0.79, 0.66), 0.9, noise=0.1, noise_scale=8),
            post=mat("frame_w", (0.22, 0.15, 0.1), 0.65, noise=0.25, noise_scale=10),
            beam=mat("frame_w", (0.22, 0.15, 0.1), 0.65, noise=0.25, noise_scale=10),
            stone=mat("stone_w", (0.58, 0.56, 0.52), 0.85, pattern="block", pattern_scale=1.0),
            brick=mat("ashlar_w", (0.6, 0.58, 0.53), 0.85, pattern="block", pattern_scale=1.6),
            pave=mat("pave_w", (0.55, 0.54, 0.51), 0.9, pattern="block", pattern_scale=0.8),
            lattice=mat("lead_w", (0.16, 0.16, 0.18), 0.5, 0.6),
            paper=mat("glass_w", (0.55, 0.62, 0.62), 0.3),
            lantern=mat("lantern_w", (1.0, 0.75, 0.35), 0.5, emission=0.8),
            thatch=mat("thatch_w", (0.66, 0.55, 0.34), 0.95, noise=0.3, noise_scale=30),
            plaque=mat("sign_w", (0.3, 0.2, 0.12), 0.6),
        )
    for k in ("stone", "brick", "pave"):
        _boxmap(common[k])
    return common


def _boxmap(m):
    """lib's brick and block patterns map the object's (x, z) onto the texture, so a face that looks
    along x (the -X face the camera sees) gets one smeared column. Map (x + y, z) instead: both
    camera faces get courses of stones."""
    if m is None or m.get("boxmap"):
        return m
    nt = m.node_tree
    mp = next((n for n in nt.nodes if n.bl_idname == "ShaderNodeMapping"), None)
    br = next((n for n in nt.nodes if n.bl_idname == "ShaderNodeTexBrick"), None)
    if mp is None or br is None:
        return m
    co = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(co.outputs["Object"], sep.inputs[0])
    add = nt.nodes.new("ShaderNodeMath")
    add.operation = "ADD"
    nt.links.new(sep.outputs["X"], add.inputs[0])
    nt.links.new(sep.outputs["Y"], add.inputs[1])
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(add.outputs[0], comb.inputs["X"])
    nt.links.new(sep.outputs["Z"], comb.inputs["Y"])
    for link in list(mp.outputs["Vector"].links):
        nt.links.new(comb.outputs[0], link.to_socket)
    m["boxmap"] = True
    return m


EMBLEM = {"E": "crane", "W": "twintowers"}       # 南溟, 布倫莫爾: decoration only (ceo 2026-10-01)


# ---------------------------------------------------------------- ground and walls

def pad(name, P, parent, w, d, h=0.18, material="pave", inset=INSET):
    """The base the building stands on: exactly its footprint (minus a hair), so the cells read."""
    return box(name, (w - 2 * inset, d - 2 * inset, h), P[material], parent, loc=(0, 0, h / 2), bevel=0.03)


def plinth(name, P, parent, cx, cy, w, d, h, material="stone"):
    return box(name, (w, d, h), P[material], parent, loc=(cx, cy, h / 2), bevel=0.04)


def block_e(name, P, parent, cx, cy, w, d, z0, wall_h, posts=True, windows=True, door=None):
    """East hall body: plaster walls, red posts at the corners and along the two camera faces,
    a timber band at the top, lattice windows and a door on the camera faces."""
    g = lib.empty(name, parent=parent, loc=(cx, cy, z0))
    g["block"] = [cx, cy, w, d, z0, wall_h]
    box(name + "_wall", (w, d, wall_h), P["wall"], g, loc=(0, 0, wall_h / 2))
    box(name + "_band", (w + 0.12, d + 0.12, 0.18), P["beam"], g, loc=(0, 0, wall_h - 0.05))
    if posts:
        nx, ny = max(2, int(w / 1.3) + 1), max(2, int(d / 1.3) + 1)
        for i in range(nx):
            x = -w / 2 + w * i / (nx - 1)
            cyl(f"{name}_px{i}", 0.12, wall_h, P["post"], g, loc=(x, -d / 2 - 0.02, 0), segs=10)
        for j in range(ny):
            y = -d / 2 + d * j / (ny - 1)
            cyl(f"{name}_py{j}", 0.12, wall_h, P["post"], g, loc=(-w / 2 - 0.02, y, 0), segs=10)
        cyl(f"{name}_pb", 0.12, wall_h, P["post"], g, loc=(w / 2, d / 2, 0), segs=10)
    if windows:
        for side, length in (("y", w), ("x", d)):
            n = max(1, int(length / 1.6))
            for k in range(n):
                t = -length / 2 + length * (k + 0.5) / n
                if door and door[0] == side and abs(t - door[1]) < 0.9:
                    continue
                if side == "y":
                    lattice(f"{name}_wy{k}", P, g, (t, -d / 2 - 0.04, wall_h * 0.58), 0.8, wall_h * 0.4, "y")
                else:
                    lattice(f"{name}_wx{k}", P, g, (-w / 2 - 0.04, t, wall_h * 0.58), 0.8, wall_h * 0.4, "x")
    if door:
        side, t, dw = door[0], door[1], door[2] if len(door) > 2 else 1.1
        dh = min(2.0, wall_h - 0.3)
        if side == "y":
            box(name + "_door", (dw, 0.1, dh), P["post"], g, loc=(t, -d / 2 - 0.05, dh / 2))
            box(name + "_doorg", (0.04, 0.12, dh), P["dark"], g, loc=(t, -d / 2 - 0.07, dh / 2), outline=False)
        else:
            box(name + "_door", (0.1, dw, dh), P["post"], g, loc=(-w / 2 - 0.05, t, dh / 2))
            box(name + "_doorg", (0.12, 0.04, dh), P["dark"], g, loc=(-w / 2 - 0.07, t, dh / 2), outline=False)
    return g


def block_w(name, P, parent, cx, cy, w, d, z0, wall_h, timber_from=None, windows=True, door=None, quoins=True):
    """West body: stone walls; from `timber_from` metres up, cream plaster with dark timber framing
    (posts, a rail and braces) on the camera faces; small dark windows; an arched door."""
    g = lib.empty(name, parent=parent, loc=(cx, cy, z0))
    g["block"] = [cx, cy, w, d, z0, wall_h]
    stone_h = wall_h if timber_from is None else timber_from
    box(name + "_stone", (w, d, stone_h), P["stone"], g, loc=(0, 0, stone_h / 2), bevel=0.03)
    if timber_from is not None:
        th = wall_h - timber_from
        box(name + "_upper", (w + 0.16, d + 0.16, th), P["wall"], g, loc=(0, 0, timber_from + th / 2))
        # framing on the -Y face (along x) and the -X face (along y)
        for side, length in (("y", w + 0.16), ("x", d + 0.16)):
            n = max(2, int(length / 0.9) + 1)
            for k in range(n):
                t = -length / 2 + length * k / (n - 1)
                if side == "y":
                    box(f"{name}_fy{k}", (0.12, 0.06, th), P["beam"], g, loc=(t, -d / 2 - 0.1, timber_from + th / 2))
                else:
                    box(f"{name}_fx{k}", (0.06, 0.12, th), P["beam"], g, loc=(-w / 2 - 0.1, t, timber_from + th / 2))
            for k in range(n - 1):
                t0 = -length / 2 + length * k / (n - 1)
                t1 = -length / 2 + length * (k + 1) / (n - 1)
                a, b = (t0, timber_from), (t1, wall_h) if k % 2 == 0 else (t1, timber_from)
                if k % 2:
                    a, b = (t0, wall_h), (t1, timber_from)
                if side == "y":
                    rod(f"{name}_by{k}", (a[0], -d / 2 - 0.1, a[1]), (b[0], -d / 2 - 0.1, b[1]), 0.04, P["beam"], parent=g)
                else:
                    rod(f"{name}_bx{k}", (-w / 2 - 0.1, a[0], a[1]), (-w / 2 - 0.1, b[0], b[1]), 0.04, P["beam"], parent=g)
        box(name + "_sill", (w + 0.26, d + 0.26, 0.14), P["beam"], g, loc=(0, 0, timber_from))
    if quoins:
        rnd = random.Random(len(name))
        for k in range(int(stone_h / 0.45)):
            ww = 0.42 if k % 2 else 0.3
            for sx, sy in ((-1, -1), (1, -1), (-1, 1)):
                box(f"{name}_q{k}{sx}{sy}", (ww if k % 2 else 0.3, 0.3 if k % 2 else ww, 0.4), P["brick"], g,
                    loc=(sx * (w / 2 - 0.08), sy * (d / 2 - 0.08), 0.22 + k * 0.45), bevel=0.03,
                    rot=(0, 0, rnd.uniform(-2, 2)))
    if windows:
        z = (stone_h if timber_from is None else timber_from + (wall_h - timber_from) / 2) * (0.6 if timber_from is None else 1)
        for side, length in (("y", w), ("x", d)):
            n = max(1, int(length / 1.8))
            for k in range(n):
                t = -length / 2 + length * (k + 0.5) / n
                if door and door[0] == side and abs(t - door[1]) < 0.9:
                    continue
                if side == "y":
                    box(f"{name}_wy{k}", (0.5, 0.12, 0.7), P["dark"], g, loc=(t, -d / 2 - 0.12, z), outline=False)
                    box(f"{name}_wsy{k}", (0.66, 0.16, 0.08), P["stone"], g, loc=(t, -d / 2 - 0.14, z - 0.4))
                else:
                    box(f"{name}_wx{k}", (0.12, 0.5, 0.7), P["dark"], g, loc=(-w / 2 - 0.12, t, z), outline=False)
                    box(f"{name}_wsx{k}", (0.16, 0.66, 0.08), P["stone"], g, loc=(-w / 2 - 0.14, t, z - 0.4))
    if door:
        side, t, dw = door[0], door[1], door[2] if len(door) > 2 else 1.1
        dh = min(2.0, wall_h - 0.3)
        if side == "y":
            box(name + "_door", (dw, 0.1, dh - dw / 2), P["wood"], g, loc=(t, -d / 2 - 0.05, (dh - dw / 2) / 2))
            cyl(name + "_arch", dw / 2, 0.1, P["wood"], g, loc=(t, -d / 2 - 0.05, dh - dw / 2), rot=(90, 0, 0),
                at=(0, 0, -0.05))
            for z in (0.5, 1.2):
                box(f"{name}_dband{z}", (dw + 0.02, 0.03, 0.06), P["iron"], g, loc=(t, -d / 2 - 0.11, z))
        else:
            box(name + "_door", (0.1, dw, dh - dw / 2), P["wood"], g, loc=(-w / 2 - 0.05, t, (dh - dw / 2) / 2))
            cyl(name + "_arch", dw / 2, 0.1, P["wood"], g, loc=(-w / 2 - 0.05, t, dh - dw / 2), rot=(0, 90, 0),
                at=(0, 0, -0.05))
    return g


def lattice(name, P, parent, loc, w, h, side):
    """East lattice window (frame, paper, bars) on a -Y ('y') or -X ('x') face."""
    if side == "y":
        box(name, (w, 0.06, h), P["post"], parent, loc=loc)
        box(name + "_p", (w - 0.1, 0.03, h - 0.1), P["paper"], parent, loc=(loc[0], loc[1] - 0.03, loc[2]))
        for i in range(1, 4):
            box(f"{name}_v{i}", (0.025, 0.03, h - 0.1), P["lattice"], parent,
                loc=(loc[0] - w / 2 + w * i / 4, loc[1] - 0.05, loc[2]), outline=False)
        box(name + "_h", (w - 0.1, 0.03, 0.025), P["lattice"], parent, loc=(loc[0], loc[1] - 0.05, loc[2]), outline=False)
    else:
        box(name, (0.06, w, h), P["post"], parent, loc=loc)
        box(name + "_p", (0.03, w - 0.1, h - 0.1), P["paper"], parent, loc=(loc[0] - 0.03, loc[1], loc[2]))
        for i in range(1, 4):
            box(f"{name}_v{i}", (0.03, 0.025, h - 0.1), P["lattice"], parent,
                loc=(loc[0] - 0.05, loc[1] - w / 2 + w * i / 4, loc[2]), outline=False)
        box(name + "_h", (0.03, w - 0.1, 0.025), P["lattice"], parent, loc=(loc[0] - 0.05, loc[1], loc[2]), outline=False)


# ---------------------------------------------------------------- roofs

def roof_e(name, P, parent, cx, cy, z, w, d, h, over=0.6, curl=0.4, ridge="x"):
    """East hip roof with upturned corners (R1), ridge along x or y."""
    g = lib.empty(name + "_g", parent=parent, loc=(cx, cy, z), rot=(0, 0, 90 if ridge == "y" else 0))
    g["roof"] = [cx, cy, z, w, d, h, over, 0 if ridge == "x" else 1]
    ww, dd = (w, d) if ridge == "x" else (d, w)
    B1.roof(name, ww, dd, h, over, curl, P["tile"], g, loc=(0, 0, 0))
    # rafter ends under the eave on the two camera faces (level C detail)
    beam = P["beam"]
    for k in range(max(2, int(w / 0.38))):
        x = cx - w / 2 + (k + 0.5) * w / max(2, int(w / 0.38))
        box(f"{name}_rfy{k}", (0.07, over * 0.8, 0.07), beam, parent, loc=(x, cy - d / 2 - over * 0.4, z - 0.02),
            rot=(-14, 0, 0), outline=False)
    for k in range(max(2, int(d / 0.38))):
        y = cy - d / 2 + (k + 0.5) * d / max(2, int(d / 0.38))
        box(f"{name}_rfx{k}", (over * 0.8, 0.07, 0.07), beam, parent, loc=(cx - w / 2 - over * 0.4, y, z - 0.02),
            rot=(0, 14, 0), outline=False)
    return g


def roof_w(name, P, parent, cx, cy, z, w, d, h, over=0.35, ridge="x", gable=None):
    """West gable roof: two straight slopes, gable ends filled with `gable` (P key) or plaster."""
    g = lib.empty(name + "_g", parent=parent, loc=(cx, cy, z), rot=(0, 0, 90 if ridge == "y" else 0))
    g["roof"] = [cx, cy, z, w, d, h, over, 0 if ridge == "x" else 1]
    ww, dd = (w, d) if ridge == "x" else (d, w)
    half = dd / 2 + over
    slope = math.atan2(h, dd / 2)
    length = math.hypot(dd / 2 + over, (dd / 2 + over) * h / (dd / 2))
    for s in (-1, 1):
        box(f"{name}_s{s}", (ww + 2 * over, length, 0.14), P["tile"], g,
            loc=(0, s * (half - (dd / 2 + over) / 2), h / 2 - over * h / (dd / 2) / 2),
            rot=(s * -math.degrees(slope), 0, 0), bevel=0.02)
    box(name + "_ridge", (ww + 2 * over + 0.1, 0.2, 0.16), P["ridge"], g, loc=(0, 0, h + 0.04))
    gm = P[gable] if gable else P["wall"]
    for s in (-1, 1):
        pts = [(-dd / 2, 0), (dd / 2, 0), (0, h)]
        slab(f"{name}_gable{s}", pts, 0.12, gm, parent=g, loc=(s * ww / 2, 0, 0), rot=(0, 0, 90), plane="XZ")
    return g


def roof_flat_parapet(name, P, parent, cx, cy, z, w, d, merlon=0.5, gap=0.45, h=0.55, culture="W"):
    """Crenellated top for towers and keeps (West) or a low brick parapet (East)."""
    g = lib.empty(name, parent=parent, loc=(cx, cy, z))
    box(name + "_deck", (w, d, 0.2), P["stone"], g, loc=(0, 0, 0.1))
    step = merlon + gap
    for side in ("x0", "x1", "y0", "y1"):
        length = d if side[0] == "x" else w
        n = max(2, int(length / step))
        for k in range(n):
            t = -length / 2 + (k + 0.5) * length / n
            if side == "y0":
                loc = (t, -d / 2 + 0.15, 0.2 + h / 2)
            elif side == "y1":
                loc = (t, d / 2 - 0.15, 0.2 + h / 2)
            elif side == "x0":
                loc = (-w / 2 + 0.15, t, 0.2 + h / 2)
            else:
                loc = (w / 2 - 0.15, t, 0.2 + h / 2)
            box(f"{name}_{side}{k}", (merlon, merlon, h) if culture == "W" else (merlon, 0.3, h), P["brick"], g,
                loc=loc, bevel=0.03)
    return g


# ---------------------------------------------------------------- cloth (player colour), signs, lights

def drape(name, P, parent, face, t, z_top, w, h, x0=None, y0=None, tails=True):
    """A player-colour hanging on a camera face: face 'y' hangs on the -Y face at x = t (y = y0),
    face 'x' on the -X face at y = t (x = x0). A rod on top, a slightly waved cloth below."""
    if face == "y":
        rod(name + "_rod", (t - w / 2 - 0.08, y0 - 0.06, z_top), (t + w / 2 + 0.08, y0 - 0.06, z_top), 0.03, P["beam"],
            parent=parent)
        pts = [(-w / 2, 0), (w / 2, 0), (w / 2, -h), (0, -h * 0.9), (-w / 2, -h)] if tails else \
            [(-w / 2, 0), (w / 2, 0), (w / 2, -h), (-w / 2, -h)]
        return slab(name, pts, 0.03, P["team"], parent=parent, loc=(t, y0 - 0.08, z_top - 0.04), plane="XZ")
    rod(name + "_rod", (x0 - 0.06, t - w / 2 - 0.08, z_top), (x0 - 0.06, t + w / 2 + 0.08, z_top), 0.03, P["beam"],
        parent=parent)
    pts = [(-w / 2, 0), (w / 2, 0), (w / 2, -h), (0, -h * 0.9), (-w / 2, -h)] if tails else \
        [(-w / 2, 0), (w / 2, 0), (w / 2, -h), (-w / 2, -h)]
    return slab(name, pts, 0.03, P["team"], parent=parent, loc=(x0 - 0.08, t, z_top - 0.04), rot=(0, 0, 90),
                plane="XZ")


def flag(name, P, parent, loc, h, culture, w=1.0, fh=1.6):
    """A banner on a pole with the nation's emblem on the player colour (R1 banner), turned to the camera."""
    return B1.banner(name, dict(timber=P["beam"]), parent, loc, h, EMBLEM[culture], w=w, fh=fh)


def pennant(name, P, parent, loc, h, w=0.9, fh=0.5):
    """A plain player-colour pennant on a pole (no emblem): small, for the humble buildings."""
    rod(name + "_pole", loc, (loc[0], loc[1], loc[2] + h), 0.04, P["beam"], parent=parent)
    pts = [(0, 0), (w, -fh * 0.35), (0, -fh)]
    return slab(name, pts, 0.03, P["team"], parent=parent, loc=(loc[0] + 0.04, loc[1] - 0.02, loc[2] + h - 0.05),
                rot=(0, 0, -25), plane="XZ")


def awning(name, P, parent, face, t, z, w, depth, x0=None, y0=None, team=True):
    """A sloping cloth canopy over a door or a stall on a camera face."""
    m = P["team"] if team else P["canvas"]
    if face == "y":
        ob = box(name, (w, depth, 0.05), m, parent, loc=(t, y0 - depth / 2, z), rot=(-18, 0, 0))
        for s in (-1, 1):
            rod(f"{name}_p{s}", (t + s * (w / 2 - 0.05), y0 - depth + 0.05, 0), (t + s * (w / 2 - 0.05), y0 - depth + 0.05,
                                                                              z - depth * 0.3), 0.04, P["beam"],
                parent=parent)
        return ob
    ob = box(name, (depth, w, 0.05), m, parent, loc=(x0 - depth / 2, t, z), rot=(0, 18, 0))
    for s in (-1, 1):
        rod(f"{name}_p{s}", (x0 - depth + 0.05, t + s * (w / 2 - 0.05), 0), (x0 - depth + 0.05, t + s * (w / 2 - 0.05),
                                                                          z - depth * 0.3), 0.04, P["beam"],
            parent=parent)
    return ob


def lantern(name, P, parent, loc):
    rod(name + "_rope", (loc[0], loc[1], loc[2] + 0.45), loc, 0.01, P["rope"], parent=parent, outline=False)
    return sphere(name, 0.16, P["lantern"], parent, loc=(loc[0], loc[1], loc[2] - 0.15), scale=(1, 1, 1.25))


def chimney(name, P, parent, loc, h, w=0.5):
    g = box(name, (w, w, h), P["stone"] if "stone" in P else P["brick"], parent, loc=(loc[0], loc[1], loc[2] + h / 2),
            bevel=0.03)
    box(name + "_cap", (w + 0.12, w + 0.12, 0.1), P["stone"], parent, loc=(loc[0], loc[1], loc[2] + h + 0.02))
    return g


# ---------------------------------------------------------------- props

def crate(name, P, parent, loc, s=0.6, rot=0):
    return box(name, (s, s, s), P["wood"], parent, loc=(loc[0], loc[1], loc[2] + s / 2), rot=(0, 0, rot), bevel=0.03)


def barrel(name, P, parent, loc, r=0.28, h=0.75):
    ob = lathe(name, [(r * 0.85, 0), (r, h * 0.3), (r, h * 0.7), (r * 0.85, h)], P["wood"], parent, loc=loc, segs=14)
    for z in (0.15, h - 0.15):
        cyl(f"{name}_hoop{z}", r * 0.95 + 0.02, 0.05, P["iron"], parent, loc=(loc[0], loc[1], loc[2] + z), segs=14,
            outline=False)
    return ob


def sack(name, P, parent, loc, s=0.35, rot=0):
    return sphere(name, s, P["sack"], parent, loc=(loc[0], loc[1], loc[2] + s * 0.7), rot=(0, 0, rot),
                  scale=(1, 0.8, 0.85))


def logs(name, P, parent, loc, n=6, length=2.2, r=0.18, axis="x"):
    """A stack of logs (pyramid), along x or y."""
    k = 0
    row, rows = n, []
    while row > 0:
        rows.append(row)
        row -= 1
        if sum(rows) >= n:
            break
    for j, cnt in enumerate(rows):
        for i in range(cnt):
            off = (i - (cnt - 1) / 2) * 2 * r
            z = r + j * r * 1.7
            if axis == "x":
                p0, p1 = (loc[0] - length / 2, loc[1] + off, loc[2] + z), (loc[0] + length / 2, loc[1] + off, loc[2] + z)
            else:
                p0, p1 = (loc[0] + off, loc[1] - length / 2, loc[2] + z), (loc[0] + off, loc[1] + length / 2, loc[2] + z)
            rod(f"{name}{k}", p0, p1, r, P["bark"], parent=parent, segs=10)
            k += 1


def planks(name, P, parent, loc, n=5, length=1.8, axis="x"):
    for i in range(n):
        w = (length, 0.28, 0.06) if axis == "x" else (0.28, length, 0.06)
        box(f"{name}{i}", w, P["wood"], parent, loc=(loc[0], loc[1], loc[2] + 0.04 + i * 0.065), rot=(0, 0, (i % 2) * 4 - 2))


def fence(name, P, parent, p0, p1, h=0.8, n=None):
    """A low timber fence from p0 to p1 (ground points)."""
    L = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    n = n or max(2, int(L / 1.0) + 1)
    for i in range(n):
        f = i / (n - 1)
        x, y = p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f
        rod(f"{name}_p{i}", (x, y, 0), (x, y, h), 0.05, P["wood"], parent=parent, segs=6)
    for z in (h * 0.45, h * 0.85):
        rod(f"{name}_r{z}", (p0[0], p0[1], z), (p1[0], p1[1], z), 0.035, P["wood"], parent=parent, segs=6)


def weapon_rack(name, P, parent, loc, axis="x", n=5, east=True):
    """Spears (East: red-tasselled) leaning in a rack."""
    g = lib.empty(name, parent=parent, loc=loc, rot=(0, 0, 0 if axis == "x" else 90))
    box(name + "_bar", (1.4, 0.12, 0.1), P["wood"], g, loc=(0, 0, 1.0))
    box(name + "_base", (1.4, 0.3, 0.12), P["wood"], g, loc=(0, 0.1, 0.06))
    for s in (-1, 1):
        rod(f"{name}_leg{s}", (s * 0.65, 0, 0), (s * 0.65, 0, 1.05), 0.05, P["wood"], parent=g)
    for i in range(n):
        x = -0.55 + 1.1 * i / (n - 1)
        rod(f"{name}_sp{i}", (x, 0.15, 0.05), (x + 0.05, -0.12, 2.3), 0.025, P["wood"], parent=g, segs=6)
        cyl(f"{name}_tip{i}", 0.05, 0.25, P["iron"], g, loc=(x + 0.055, -0.13, 2.3), r2=0.0, segs=6)
    return g


def dummy(name, P, parent, loc):
    """A straw training post with a cross arm."""
    rod(name + "_post", (loc[0], loc[1], 0), (loc[0], loc[1], 1.6), 0.06, P["wood"], parent=parent)
    rod(name + "_arm", (loc[0] - 0.45, loc[1], 1.25), (loc[0] + 0.45, loc[1], 1.25), 0.05, P["wood"], parent=parent)
    cyl(name + "_body", 0.22, 0.75, P["straw"], parent, loc=(loc[0], loc[1], 0.75), segs=10)
    sphere(name + "_head", 0.16, P["sack"], parent, loc=(loc[0], loc[1], 1.68))


def butt(name, P, parent, loc, face="y"):
    """An archery target: a straw butt with painted rings, facing the camera side."""
    g = lib.empty(name, parent=parent, loc=loc, rot=(0, 0, 0 if face == "y" else -90))
    rod(name + "_l1", (-0.45, 0.25, 0), (-0.35, 0.0, 1.5), 0.05, P["wood"], parent=g)
    rod(name + "_l2", (0.45, 0.25, 0), (0.35, 0.0, 1.5), 0.05, P["wood"], parent=g)
    cyl(name + "_straw", 0.62, 0.3, P["straw"], g, loc=(0, 0, 1.0), rot=(90, 0, 0), at=(0, 0, -0.15), segs=20)
    for k, (r, m) in enumerate(((0.52, "target"), (0.38, "target_red"), (0.25, "target"), (0.12, "target_red"))):
        cyl(f"{name}_ring{k}", r, 0.02, P[m], g, loc=(0, -0.16 - 0.01 * k, 1.0), rot=(90, 0, 0), segs=24, outline=False)
    return g


def anvil(name, P, parent, loc):
    box(name + "_block", (0.4, 0.4, 0.5), P["wood"], parent, loc=(loc[0], loc[1], 0.25))
    box(name, (0.6, 0.24, 0.22), P["iron"], parent, loc=(loc[0], loc[1], 0.6), bevel=0.02)
    cyl(name + "_horn", 0.1, 0.3, P["iron"], parent, loc=(loc[0] + 0.3, loc[1], 0.62), rot=(0, 90, 0), r2=0.02, segs=8)


def crystals(name, P, parent, loc, size=1.0, n=7, seed=1):
    """A cluster of 魔晶 (cyan, glowing): hexagonal prisms with pointed tips."""
    rnd = random.Random(seed)
    for i in range(n):
        h = size * rnd.uniform(0.5, 1.0)
        r = size * rnd.uniform(0.08, 0.14)
        a, b = rnd.uniform(-25, 25), rnd.uniform(-25, 25)
        x, y = loc[0] + rnd.uniform(-0.25, 0.25) * size, loc[1] + rnd.uniform(-0.25, 0.25) * size
        cyl(f"{name}{i}", r, h * 0.8, P["crystal"], parent, loc=(x, y, loc[2]), rot=(a, b, 0), segs=6, smooth=False)
        cyl(f"{name}{i}t", r, h * 0.25, P["crystal"], parent, loc=(x, y, loc[2]), rot=(a, b, 0), at=(0, 0, h * 0.8),
            r2=0.0, segs=6, smooth=False)


def ore_pile(name, P, parent, loc, r=0.8, gold=6, crystal=0, seed=2):
    B1.lumpy(name, r, P["rock"], parent, (loc[0], loc[1], loc[2] + r * 0.3), seed=seed, squash=0.55)
    rnd = random.Random(seed)
    for i in range(gold):
        ico(f"{name}_g{i}", rnd.uniform(0.1, 0.17), P["ore"], parent,
            loc=(loc[0] + rnd.uniform(-r, r) * 0.6, loc[1] + rnd.uniform(-r, r) * 0.6 - 0.1, loc[2] + rnd.uniform(0.25, 0.5)),
            subdiv=1, smooth=False)
    if crystal:
        crystals(name + "_c", P, parent, (loc[0] + 0.2, loc[1] - 0.2, loc[2] + 0.2), size=0.6, n=crystal, seed=seed)


def cart(name, P, parent, loc, rot=0, load="ore"):
    g = lib.empty(name, parent=parent, loc=loc, rot=(0, 0, rot))
    box(name + "_bed", (1.2, 0.8, 0.45), P["wood"], g, loc=(0, 0, 0.55), bevel=0.03)
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(f"{name}_wh{sx}{sy}", 0.22, 0.08, P["wood"], g, loc=(sx * 0.4, sy * 0.44, 0.22), rot=(90, 0, 0),
                at=(0, 0, -0.04), segs=12)
    if load == "ore":
        for i in range(5):
            ico(f"{name}_l{i}", 0.17, P["ore"], g, loc=(-0.35 + i * 0.18, (i % 2) * 0.15 - 0.07, 0.85), subdiv=1,
                smooth=False)
    elif load == "logs":
        for i in range(3):
            rod(f"{name}_l{i}", (-0.75, -0.25 + i * 0.25, 0.92), (0.75, -0.25 + i * 0.25, 0.92), 0.12, P["bark"],
                parent=g)
    return g


def hay(name, P, parent, loc, r=0.55):
    return sphere(name, r, P["hay"], parent, loc=(loc[0], loc[1], loc[2] + r * 0.6), scale=(1, 1, 0.75))


def well(name, P, parent, loc, culture):
    g = lib.empty(name, parent=parent, loc=loc)
    cyl(name + "_ring", 0.6, 0.7, P["stone"], g, segs=16)
    cyl(name + "_water", 0.48, 0.02, P["dark"], g, loc=(0, 0, 0.7), segs=16, outline=False)
    for s in (-1, 1):
        rod(f"{name}_post{s}", (s * 0.55, 0, 0.7), (s * 0.55, 0, 1.8), 0.06, P["wood"], parent=g)
    if culture == "E":
        B1.roof(name + "_roof", 1.3, 0.9, 0.5, 0.25, 0.25, P["tile"], g, loc=(0, 0, 1.8), thick=0.08)
    else:
        rod(name + "_beam", (-0.6, 0, 1.75), (0.6, 0, 1.75), 0.06, P["wood"], parent=g)
        roof_w(name + "_roof", P, g, 0, 0, 1.8, 1.2, 0.8, 0.45, over=0.15)
    return g


# ---------------------------------------------------------------- object bookkeeping for states

def parts_under(root):
    """Every mesh object under `root` (recursive)."""
    out, stack = [], [root]
    while stack:
        o = stack.pop()
        stack.extend(o.children)
        if o.type == "MESH":
            out.append(o)
    return out
