"""R8 batch 2 (D-093): the buildings in the realistic look the user chose for R8 (R7 version 2: CC0 textures, the R7
light rig, no outlines; render_b1.py LOOK "r8"). New models, real proportions, after the research notes:
  East  late Tang / Five Dynasties (research/east-arch-reference): halls on stone platforms, red-ochre columns and
        beams, big bracket sets (斗栱, about 0.4 of a column), white plaster walls, 直櫺窗 windows, 板門 doors with
        studs; grey tile roofs, a shallow pitch with a gentle concave curve (舉折) and a little lift at the corners
        (起翹; not the steep Ming/Qing upsweep), 鴟尾 at the ridge ends of the high-ranking halls; rammed earth (夯土)
        for walls and the poorer houses. Numbers from the notes: average roof pitch 22–28° for halls, 25–30° for houses
        (never over 34°); brackets about half a column on the main hall, smaller by rank, none on houses; the corner lift
        a few centimetres; 鴟尾 about a fifth of the front's width; 七朱八白 on a ranking hall's lintels.
  West  c.1250 (research/west-arch-reference): timber frames with limewashed wattle and daub, stone footings and
        stone halls for rank, steep roofs (thatch, slate), lancet windows, smoke louvres rather than chimneys.

Each builder takes (root, culture) like design/b1/blender/blds.py and stands on its footprint (2 m cells) centred on
the root, the camera on the -y side. Team colour: banners and hangings (kit.flag, kit.drape: the `team` material).
The materials are named after design/r7/blender/look.py's MATCH keys, so look.realistic textures them.
"""
import math
import random

import bmesh

import kit
import lib
from lib import box, cyl, rod, slab, sphere

CELL = kit.CELL


# ---------------------------------------------------------------- materials (linear albedo; look.MATCH names)

def palette(c):
    P = dict(kit.palette(c))             # team, dark, rope, canvas, iron, gold, ...: the shared ones
    m = lib.mat
    if c == "E":
        P.update(
            # grey fired tiles: the rows are modelled (tang_roof), so no photo texture on top (it made a moiré)
            tile=m("tile_tang", (0.12, 0.125, 0.13), 0.6, noise=0.12, noise_scale=6),
            ridge=m("ridge", (0.085, 0.085, 0.09), 0.6),
            red=m("red_post", (0.36, 0.075, 0.045), 0.55),        # 土朱: red ochre on columns, beams, brackets
            timber=m("timber", (0.24, 0.1, 0.06), 0.6),           # the brackets' faces, darker than the columns
            plaster=m("plaster", (0.6, 0.56, 0.48), 0.9),
            stone=m("stone", (0.38, 0.36, 0.33), 0.85),
            brick=m("brick", (0.2, 0.2, 0.2), 0.85),
            earth=m("earth", (0.4, 0.3, 0.19), 0.95),             # rammed earth
            wood=m("wood", (0.2, 0.11, 0.06), 0.65),
            lattice=m("lattice", (0.16, 0.08, 0.05), 0.6),
            pave=m("pave", (0.3, 0.29, 0.27), 0.9),
            thatch=m("thatch", (0.33, 0.27, 0.16), 0.95),
        )
    else:
        P.update(
            tile=m("tile", (0.075, 0.08, 0.09), 0.65),            # slates
            ridge=m("ridge", (0.06, 0.06, 0.065), 0.6),
            timber=m("timber", (0.1, 0.065, 0.04), 0.65),         # oak, darkened
            plaster=m("plaster", (0.66, 0.62, 0.52), 0.9),        # limewash
            stone=m("rubble", (0.42, 0.39, 0.33), 0.85),          # rubble stone (rustic_stone_wall_02), not bricks
            brick=m("brick", (0.3, 0.28, 0.24), 0.85),
            earth=m("earth", (0.36, 0.28, 0.18), 0.95),
            wood=m("wood", (0.16, 0.1, 0.06), 0.65),
            lattice=m("lattice", (0.1, 0.07, 0.05), 0.6),
            pave=m("pave", (0.34, 0.32, 0.28), 0.9),
            thatch=m("thatch", (0.13, 0.1, 0.06), 0.95),          # weathered straw: grey-brown, not new gold
            red=m("red_post", (0.3, 0.09, 0.05), 0.6),
        )
    return P


# ---------------------------------------------------------------- mesh helpers

def surface(name, mat, parent, nu, nv, fn, thick=0.0, loc=(0, 0, 0)):
    """A grid surface fn(u, v) -> (x, y, z) for u, v in [0, 1]; `thick` metres of solidify (downward/inward)."""
    bm = bmesh.new()
    vs = [[bm.verts.new(fn(i / nu, j / nv)) for j in range(nv + 1)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((vs[i][j], vs[i + 1][j], vs[i + 1][j + 1], vs[i][j + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = lib._mesh_obj(name, bm, mat, parent, loc, (0, 0, 0), smooth=True, outline=False)
    if thick:
        mod = ob.modifiers.new("thick", "SOLIDIFY")
        mod.thickness = thick
        mod.offset = -1.0
    return ob


def prism(name, mat, parent, pts, y0, y1, loc=(0, 0, 0)):
    """A polygon in the XZ plane (pts: (x, z)) extruded along y from y0 to y1: gables and gable walls."""
    bm = bmesh.new()
    a = [bm.verts.new((x, y0, z)) for x, z in pts]
    b = [bm.verts.new((x, y1, z)) for x, z in pts]
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    n = len(pts)
    for i in range(n):
        bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return lib._mesh_obj(name, bm, mat, parent, loc, (0, 0, 0), smooth=False, outline=False)


# ---------------------------------------------------------------- East: late Tang

def platform_e(name, P, parent, w, d, h, cy=0.0, steps=1.8):
    """台基: a stone-edged brick platform, a step flight in the middle of the front."""
    box(name, (w, d, h), P["brick"], parent, loc=(0, cy, h / 2), bevel=0.02)
    box(name + "_cap", (w + 0.08, d + 0.08, 0.12), P["stone"], parent, loc=(0, cy, h - 0.06), bevel=0.02)
    if steps:
        n = max(2, int(round(h / 0.17)))
        for k in range(n):
            t = (k + 1) / n
            box(f"{name}_step{k}", (steps, 0.3 * (n - k), h * t), P["stone"], parent,
                loc=(0, cy - d / 2 - 0.15 * (n - k) + 0.02, h * t / 2), bevel=0.01)


def dougong(name, P, parent, x, y, z, s, normal):
    """One bracket set (斗栱) at (x, y) on the column line, from z up, `s` its height; stepping out toward `normal`
    ((±1, 0) or (0, ±1)): a big bearing block, two tiers of crossing arms, the blocks between."""
    nx, ny = normal
    along = (abs(ny), abs(nx))                     # the wall's direction
    blk = s * 0.32
    box(name + "_lu", (blk * 1.3, blk * 1.3, blk), P["timber"], parent, loc=(x, y, z + blk / 2), bevel=0.01)
    zz = z + blk
    for tier in range(2):
        out = 0.35 * s * (tier + 1)
        h = s * 0.2
        ln = s * (1.3 + 0.35 * tier)               # the arm along the wall
        box(f"{name}_g{tier}", (ln * along[0] + h * (1 - along[0]), ln * along[1] + h * (1 - along[1]), h), P["red"], parent,
            loc=(x + nx * out * 0.5, y + ny * out * 0.5, zz + h / 2), bevel=0.01)
        box(f"{name}_h{tier}", (out * 2 * abs(nx) + h * (1 - abs(nx)), out * 2 * abs(ny) + h * (1 - abs(ny)), h), P["red"],
            parent, loc=(x + nx * out * 0.5, y + ny * out * 0.5, zz + h / 2), bevel=0.01)
        for e in (-1, 1):                          # the small blocks on the arm's ends
            bx = x + along[0] * e * ln / 2 + nx * out * 0.5
            by = y + along[1] * e * ln / 2 + ny * out * 0.5
            box(f"{name}_d{tier}{e}", (h * 0.9, h * 0.9, h * 0.7), P["timber"], parent, loc=(bx, by, zz + h + h * 0.35))
        zz += h * 1.7
    return zz - z


def hall_e(name, P, parent, cx, cy, z0, bays_x, bays_y, col_h, col_r, dg, front_door=True, walls=True, qizhu=False):
    """A timber hall on a platform top at z0: columns on the bay lines (bays_*: widths), red lintels, bracket sets on the
    column heads and one between, plaster walls with 直櫺窗 windows on the sides of the front, a 板門 in the middle bay.
    Returns (w, d, z_top) of the column frame and the bracket top."""
    w, d = sum(bays_x), sum(bays_y)
    xs = [-w / 2]
    for b in bays_x:
        xs.append(xs[-1] + b)
    ys = [-d / 2]
    for b in bays_y:
        ys.append(ys[-1] + b)
    g = lib.empty(name, parent=parent, loc=(cx, cy, z0))
    g["block"] = [cx, cy, w, d, z0, col_h + dg]
    cols = [(x, y) for x in xs for y in ys if x in (xs[0], xs[-1]) or y in (ys[0], ys[-1])]
    for k, (x, y) in enumerate(cols):
        cyl(f"{name}_col{k}", col_r, col_h, P["red"], g, loc=(x, y, 0.0), r2=col_r * 0.88, segs=14)
        cyl(f"{name}_base{k}", col_r * 1.5, 0.12, P["stone"], g, loc=(x, y, 0.0), r2=col_r * 1.25, segs=14)
    # 闌額 lintels and 普拍枋 on the column tops
    for nm, size, loc in (("lf", (w, 0.2, 0.32), (0, ys[0], col_h - 0.2)), ("lb", (w, 0.2, 0.32), (0, ys[-1], col_h - 0.2)),
                          ("ll", (0.2, d, 0.32), (xs[0], 0, col_h - 0.2)), ("lr", (0.2, d, 0.32), (xs[-1], 0, col_h - 0.2))):
        box(f"{name}_{nm}", size, P["red"], g, loc=loc, bevel=0.01)
    box(name + "_pu", (w + 0.3, d + 0.3, 0.12), P["timber"], g, loc=(0, 0, col_h + 0.06))
    if qizhu:                                      # 七朱八白: white blocks along the red lintel of a ranking hall
        nq = int(w / 0.62)
        for q in range(nq):
            box(f"{name}_qz{q}", (0.34, 0.03, 0.17), P["plaster"], g,
                loc=(-w / 2 + (q + 0.5) * w / nq, ys[0] - 0.11, col_h - 0.2), outline=False)
    # bracket sets: on every perimeter column, one between columns on the front and back
    top = 0
    for k, (x, y) in enumerate(cols):
        if y == ys[0]:
            nrm = (0, -1)
        elif y == ys[-1]:
            nrm = (0, 1)
        else:
            nrm = (-1, 0) if x == xs[0] else (1, 0)
        top = dougong(f"{name}_dg{k}", P, g, x, y, col_h + 0.12, dg, nrm)
    for i in range(len(xs) - 1):
        xm = (xs[i] + xs[i + 1]) / 2
        dougong(f"{name}_dgf{i}", P, g, xm, ys[0], col_h + 0.12, dg * 0.8, (0, -1))
    if walls:
        # the walls between the columns, inset; the front: windows either side, the door in the middle bay
        wh = col_h - 0.36
        for side, yy in (("b", ys[-1]), ):
            box(f"{name}_wb", (w, 0.24, wh), P["plaster"], g, loc=(0, yy, wh / 2))
        for side, xx in (("l", xs[0]), ("r", xs[-1])):
            box(f"{name}_w{side}", (0.24, d, wh), P["plaster"], g, loc=(xx, 0, wh / 2))
        mid = len(bays_x) // 2
        for i in range(len(bays_x)):
            x0, x1 = xs[i], xs[i + 1]
            bw = x1 - x0 - col_r * 2
            xm = (x0 + x1) / 2
            yf = ys[0] + 0.05
            if i == mid and front_door:
                # 板門: two leaves with rows of studs, a lintel and a transom of vertical bars over them
                dh = min(wh - 0.5, 2.6)
                for e in (-1, 1):
                    box(f"{name}_door{i}{e}", (bw / 2 - 0.03, 0.08, dh), P["red"], g, loc=(xm + e * bw / 4, yf, dh / 2))
                    for r_ in range(4):
                        for q in range(2):
                            sphere(f"{name}_stud{i}{e}{r_}{q}", 0.03, P["gold"], g,
                                   loc=(xm + e * (bw / 4 + (q - 0.5) * bw * 0.18), yf - 0.05, dh * (0.25 + 0.17 * r_)), segs=8,
                                   rings=5)
                box(f"{name}_trans{i}", (bw, 0.1, wh - dh), P["plaster"], g, loc=(xm, yf + 0.04, dh + (wh - dh) / 2))
            else:
                # a low wall (檻牆), the 直櫺窗 over it, plaster above
                sill = 0.9
                box(f"{name}_dado{i}", (bw, 0.2, sill), P["brick"], g, loc=(xm, yf + 0.04, sill / 2))
                win_h = min(1.2, wh - sill - 0.3)
                box(f"{name}_wfr{i}", (bw, 0.14, win_h), P["lattice"], g, loc=(xm, yf, sill + win_h / 2))
                nb = max(5, int(bw / 0.12))
                for b in range(nb):
                    box(f"{name}_bar{i}_{b}", (0.035, 0.05, win_h - 0.1), P["red"], g,
                        loc=(xm - bw / 2 + (b + 0.5) * bw / nb, yf - 0.06, sill + win_h / 2))
                top_h = wh - sill - win_h
                box(f"{name}_wup{i}", (bw, 0.2, top_h), P["plaster"], g, loc=(xm, yf + 0.04, sill + win_h + top_h / 2))
    return w, d, col_h + 0.12 + top


def _prof(v, kind="tang"):
    """The roof's height along its slope, 0 at the eave, 1 at the ridge: Tang's gentle concave curve (舉折)."""
    return v ** 1.45


def tang_roof(name, P, parent, cx, cy, z, w, d, rise, over, kind="xieshan", lift=0.18, chiwei=True, gable_v=0.55,
              tile_pitch=0.26, tile_amp=0.035, thick=0.16, chiwei_s=None):
    """A tiled roof over the rectangle w x d (the eave purlins) at height z, `over` metres of eave beyond it, `rise` to
    the ridge. kind: wudian (hip), xieshan (hip below, gable above from gable_v), xuanshan (two slopes, the gables
    open and overhanging). The tile rows are the surface's ridges (筒瓦), the corners lift a little at the eave."""
    g = lib.empty(name, parent=parent, loc=(cx, cy, z))
    g["roof"] = [cx, cy, z, w, d, rise, over, 0]
    W, D = w + 2 * over, d + 2 * over                 # the eave's outline
    hd = D / 2
    ridge_half = max(0.0, (W - D) / 2) if kind != "xuanshan" else W / 2
    gx = ridge_half + hd * (1 - gable_v)              # xieshan: the gables' x

    def zat(v, corner):
        return rise * _prof(v) + lift * corner * (1 - v) ** 2

    def front(sign):
        def fn(u, v):
            if kind == "xuanshan":
                half = W / 2
            elif kind == "xieshan" and v >= gable_v:
                half = gx
            else:
                half = ridge_half + hd * (1 - v)
            x = (u - 0.5) * 2 * half
            y = sign * hd * (1 - v)
            corner = (abs(x) / (W / 2)) ** 6 if kind != "xuanshan" else 0.0
            zz = zat(v, corner) + tile_amp * math.sin(2 * math.pi * x / tile_pitch) * min(1.0, 4 * v + 0.3)
            return (x, y, zz)
        return fn

    nu = max(24, int(W / tile_pitch * 4))
    surface(name + "_f", P["tile"], g, nu, 16, front(-1), thick)
    surface(name + "_b", P["tile"], g, nu, 16, front(1), thick)
    if kind in ("wudian", "xieshan"):
        vmax = gable_v if kind == "xieshan" else 1.0

        def side(sign):
            def fn(u, v):
                vv = v * vmax
                half = hd * (1 - vv)
                y = (u - 0.5) * 2 * half
                x = sign * (ridge_half + hd * (1 - vv))
                corner = (abs(y) / hd) ** 6
                zz = zat(vv, corner) + tile_amp * math.sin(2 * math.pi * y / tile_pitch) * min(1.0, 4 * vv + 0.3)
                return (x, y, zz)
            return fn
        surface(name + "_l", P["tile"], g, max(16, int(D / tile_pitch * 4)), 10, side(-1), thick)
        surface(name + "_r", P["tile"], g, max(16, int(D / tile_pitch * 4)), 10, side(1), thick)
        # the hip ridges (垂脊／戧脊), from each corner up the slopes' meeting line
        for sx in (-1, 1):
            for sy in (-1, 1):
                pts = []
                for k in range(9):
                    v = vmax * k / 8
                    x = sx * (ridge_half + hd * (1 - v))
                    y = sy * hd * (1 - v)
                    pts.append((x, y, zat(v, 1.0) + 0.05))
                for k in range(8):
                    rod(f"{name}_hip{sx}{sy}{k}", pts[k], pts[k + 1], 0.09, P["ridge"], parent=g, segs=8)
    if kind == "xieshan":
        # the gable triangles (山花) and their bargeboards at x = ±gx, from the slope at gable_v up to the ridge
        vs = [gable_v + (1 - gable_v) * k / 8 for k in range(9)]
        up = [(-hd * (1 - v), zat(v, 0.0)) for v in vs]                  # up the front slope to the ridge
        down = [(hd * (1 - v), zat(v, 0.0)) for v in reversed(vs[:-1])]  # and down the back one
        for sx in (-1, 1):
            slab(f"{name}_gable{sx}", up + down, 0.12, P["plaster"], parent=g, loc=(sx * gx, 0, 0), rot=(0, 0, 90),
                 plane="XZ", outline=False)
    if kind == "xuanshan":
        # the gable walls' tops under the overhang are filled by the building's own walls; the bargeboards here
        for sx in (-1, 1):
            for k in range(8):
                v0, v1 = k / 8, (k + 1) / 8
                for sy in (-1, 1):
                    rod(f"{name}_barge{sx}{sy}{k}", (sx * W / 2, sy * hd * (1 - v0), zat(v0, 0) - 0.05),
                        (sx * W / 2, sy * hd * (1 - v1), zat(v1, 0) - 0.05), 0.05, P["timber"], parent=g, segs=6)
    # the main ridge (正脊) and the 鴟尾 at its ends
    rl = (gx if kind == "xieshan" else (ridge_half if kind == "wudian" else W / 2)) * 2
    box(name + "_ridge", (rl, 0.3, 0.32), P["ridge"], g, loc=(0, 0, rise + 0.12), bevel=0.03)
    if chiwei:
        for sx in (-1, 1):
            chiwei_e(f"{name}_cw{sx}", P, g, (sx * rl / 2, 0, rise + 0.2), sx, s=chiwei_s or min(1.0, 0.25 + rise * 0.28))
    # the eave's front: a dark board under the tiles (連檐), round tile ends implied by the rows
    for sy in (-1, 1):
        box(f"{name}_eave{sy}", (W * (0.97 if kind != 'xuanshan' else 1.0), 0.08, 0.14), P["timber"], g,
            loc=(0, sy * (hd - 0.04), -0.1))
    return g


def chiwei_e(name, P, parent, loc, sx, s=1.0):
    """鴟尾: the ridge end's fin, rising and curling inward (Tang: a tall tail, ridged on its outer edge)."""
    pts = [(0.0, 0.0), (0.42, 0.0), (0.4, 0.3), (0.28, 0.62), (0.08, 0.95), (-0.08, 1.05), (-0.05, 0.85), (0.08, 0.62),
           (0.04, 0.35), (-0.06, 0.2)]
    pts = [(-x * sx * s, z * s) for x, z in pts]
    slab(name, pts, 0.16 * s, P["ridge"], parent=parent, loc=loc, plane="XZ", outline=False)      # faces the camera


def war_drum(name, P, parent, x, y, r=0.42, h=0.8):
    """A war drum (戰鼓) on its stand, its head toward the camera (the user 2026-10-22: the first one read as a red ball):
    a red-lacquered barrel with brass bands, pale hide heads nailed round the rims, a wooden frame of four splayed legs
    and two cross rails holding it, two beaters resting on the frame."""
    g = lib.empty(name, parent=parent, loc=(x, y, 0.0))
    hide = lib.mat("drumhide", (0.55, 0.44, 0.3), 0.7)
    zc = h + r                                         # the drum's axis height
    L = r * 1.3                                        # its length, along y
    cyl(name + "_body", r, L, P["red"], g, loc=(0, L / 2, zc), rot=(90, 0, 0), r2=r, segs=28)
    cyl(name + "_belly", r * 1.08, L * 0.5, P["red"], g, loc=(0, L * 0.25, zc), rot=(90, 0, 0), segs=28)
    for e in (-1, 1):                                  # the heads, the nail rings, the brass bands
        y0 = e * L / 2
        cyl(f"{name}_head{e}", r * 1.01, 0.03, hide, g, loc=(0, y0 + 0.015, zc), rot=(90, 0, 0), segs=28)
        cyl(f"{name}_band{e}", r * 1.03, 0.04, P["gold"], g, loc=(0, y0 - 0.075 * e + 0.02, zc), rot=(90, 0, 0), segs=28)
        for k in range(18):                            # the nails holding the hide, round the shell just behind the rim
            a = 2 * math.pi * k / 18
            sphere(f"{name}_nail{e}{k}", 0.026, P["gold"], g, loc=(r * 1.0 * math.cos(a), y0 - 0.03 * e, zc + r * 1.0 * math.sin(a)),
                   segs=8, rings=5)
    for sx in (-1, 1):                                 # the stand: splayed legs, rails under the drum, a cradle
        for sy in (-1, 1):
            rod(f"{name}_leg{sx}{sy}", (sx * (r + 0.18), sy * L * 0.55, 0.0), (sx * r * 0.75, sy * L * 0.3, zc - r * 0.55), 0.045,
                P["wood"], parent=g, segs=6)
        rod(f"{name}_rail{sx}", (sx * r * 0.85, -L * 0.45, zc - r * 0.62), (sx * r * 0.85, L * 0.45, zc - r * 0.62), 0.045,
            P["wood"], parent=g, segs=6)
    for sy in (-1, 1):
        rod(f"{name}_cross{sy}", (-(r + 0.12), sy * L * 0.45, 0.35), ((r + 0.12), sy * L * 0.45, 0.35), 0.035, P["wood"], parent=g,
            segs=6)
    zt = zc + r * 1.08 + 0.03                          # the beaters, crossed on top of the barrel, knobs to the front
    for k, sx in enumerate((-1, 1)):
        rod(f"{name}_stick{k}", (sx * 0.24, -L * 0.3, zt), (-sx * 0.2, L * 0.3, zt), 0.022, P["wood"], parent=g, segs=6)
        sphere(f"{name}_knob{k}", 0.045, P["wood"], g, loc=(sx * 0.24, -L * 0.3, zt), segs=8, rings=6)
    return g


def rammed_wall_e(name, P, parent, x0, y0, x1, y1, h, t=0.5):
    """夯土 wall with a tile coping, from (x0, y0) to (x1, y1)."""
    L = math.hypot(x1 - x0, y1 - y0)
    a = math.degrees(math.atan2(y1 - y0, x1 - x0))
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    box(name, (L, t, h), P["earth"], parent, loc=(cx, cy, h / 2), rot=(0, 0, a), bevel=0.04, taper=(1.0, 0.85))
    box(name + "_cap", (L + 0.1, t + 0.25, 0.12), P["tile"], parent, loc=(cx, cy, h + 0.06), rot=(0, 0, a), bevel=0.03)
    box(name + "_cap2", (L + 0.1, 0.12, 0.12), P["ridge"], parent, loc=(cx, cy, h + 0.17), rot=(0, 0, a))


# ---------------------------------------------------------------- West: c.1250

def gable_roof_w(name, P, parent, cx, cy, z, w, d, pitch_deg, over, mat, thick=0.12, ridge="x", louvre=False,
                 round_eave=False):
    """A steep two-slope roof over w x d at height z (the wall plate), `over` beyond the walls; mat: P key (thatch:
    thick, rounded eaves and ridge; tile: slates). ridge along x or y. Returns the ridge height above z."""
    g = lib.empty(name, parent=parent, loc=(cx, cy, z), rot=(0, 0, 90 if ridge == "y" else 0))
    ww, dd = (w, d) if ridge == "x" else (d, w)
    rise = (dd / 2) * math.tan(math.radians(pitch_deg))
    g["roof"] = [cx, cy, z, w, d, rise, over, 0 if ridge == "x" else 1]
    hd = dd / 2 + over * math.cos(math.radians(pitch_deg))
    drop = over * math.sin(math.radians(pitch_deg))
    W = ww + 2 * over * (0.6 if mat == "thatch" else 0.4)
    m = P[mat]
    for sy in (-1, 1):
        def fn(u, v, sy=sy):
            x = (u - 0.5) * W
            y = sy * hd * (1 - v)
            zz = -drop + (rise + drop) * v
            if round_eave:              # thatch: the eave and the verges roll over, laid in courses, a little uneven
                zz -= 0.12 * (1 - v) ** 4 + 0.1 * (abs(u - 0.5) * 2) ** 8
                course = (v * (rise + drop) / 0.32) % 1.0
                zz += 0.05 * course + 0.025 * math.sin(x * 2.3 + v * 7.0) + 0.02 * math.sin(x * 5.1 - v * 3.0)
            return (x, y, zz)
        surface(f"{name}_s{sy}", m, g, max(12, int(W / 0.3)), 40 if round_eave else 10, fn, thick)
    g["rise"] = rise
    if mat == "thatch":
        box(name + "_ridge", (W * 0.98, 0.5, 0.28), m, g, loc=(0, 0, rise - 0.02), bevel=0.12)
    else:
        box(name + "_ridge", (W * 0.99, 0.16, 0.16), P["ridge"], g, loc=(0, 0, rise + 0.03), bevel=0.03, rot=(45, 0, 0))
    if louvre:                           # a smoke louvre on the ridge (no chimneys yet in 1250)
        box(name + "_lv", (0.6, 0.6, 0.45), P["timber"], g, loc=(0, 0, rise + 0.2))
        prism(name + "_lvr", P["tile"], g, [(-0.42, 0.0), (0.42, 0.0), (0.0, 0.35)], -0.42, 0.42, loc=(0, 0, rise + 0.42))
    return g, rise


def gable_fill_w(name, P, parent, cx, cy, z, w, d, rise, ridge="x", mat="plaster", timber=True, under=1.0):
    """The gable triangles at the ridge's ends, flush with the walls (timbered: a king post and two struts); `under`
    shrinks them to stay under a thick roof's rolled verge (thatch)."""
    hd = (d if ridge == "x" else w) / 2 * under
    rise = rise * under
    for s in (-1, 1):
        if ridge == "x":
            pts = [(-hd, 0.0), (hd, 0.0), (0.0, rise)]
            ob = prism(f"{name}_g{s}", P[mat], parent, pts, -0.1, 0.1, loc=(cx + s * w / 2, cy, z))
            ob.rotation_euler = (0, 0, math.radians(90))
        else:
            pts = [(-hd, 0.0), (hd, 0.0), (0.0, rise)]
            ob = prism(f"{name}_g{s}", P[mat], parent, pts, -0.1, 0.1, loc=(cx, cy + s * d / 2, z))
        if timber and ridge == "y" and s < 0:
            rod(f"{name}_kp{s}", (cx, cy - d / 2 - 0.11, z), (cx, cy - d / 2 - 0.11, z + rise * 0.95), 0.07, P["timber"],
                parent=parent, segs=6)
            for e in (-1, 1):
                rod(f"{name}_st{s}{e}", (cx + e * hd * 0.85, cy - d / 2 - 0.11, z + 0.05), (cx, cy - d / 2 - 0.11, z + rise * 0.6),
                    0.06, P["timber"], parent=parent, segs=6)


def timber_wall_w(name, P, parent, x0, x1, y, z0, h, posts=4, braces=True, rail=True, face=-1):
    """A timber-framed wall in the XZ plane at y: sill, posts, a mid rail, curved braces at the ends, limewashed
    wattle and daub between (the infill a little behind the timbers)."""
    L = x1 - x0
    xc = (x0 + x1) / 2
    box(name + "_fill", (L, 0.16, h), P["plaster"], parent, loc=(xc, y, z0 + h / 2))
    f = face * 0.1
    box(name + "_sill", (L + 0.1, 0.2, 0.18), P["timber"], parent, loc=(xc, y + f * 0.2, z0 + 0.09))
    box(name + "_plate", (L + 0.1, 0.2, 0.18), P["timber"], parent, loc=(xc, y + f * 0.2, z0 + h - 0.09))
    for k in range(posts):
        x = x0 + L * k / (posts - 1)
        box(f"{name}_p{k}", (0.18, 0.2, h), P["timber"], parent, loc=(x, y + f * 0.2, z0 + h / 2))
    if rail:
        box(name + "_rail", (L, 0.16, 0.14), P["timber"], parent, loc=(xc, y + f * 0.25, z0 + h * 0.5))
    if braces:
        for e, xa in ((1, x0), (-1, x1)):
            rod(f"{name}_br{e}", (xa, y + f * 0.25, z0 + h * 0.5), (xa + e * min(1.0, L / 3), y + f * 0.25, z0 + h - 0.15),
                0.07, P["timber"], parent=parent, segs=6)


def lancet_w(name, P, parent, x, y, z, w, h, depth=0.12):
    """A lancet window (early Gothic, 1250): a tall pointed opening, dark glass-less, with a stone surround."""
    pts = [(-w / 2, 0.0), (w / 2, 0.0), (w / 2, h - w * 0.8)]
    for k in range(1, 8):
        a = math.pi / 2 * k / 8
        pts.append((w / 2 - w * (1 - math.cos(a)) * 0.5, h - w * 0.8 + w * 0.8 * math.sin(a)))
    pts += [(0.0, h)]
    pts += [(-px, pz) for px, pz in reversed(pts[3:-1])] + [(-w / 2, h - w * 0.8)]
    sur = [(px * 1.35, (pz - h / 2) * 1.12 + h / 2) for px, pz in pts]
    slab(name + "_sur", sur, 0.06, P["stone"], parent=parent, loc=(x, y - 0.02, z), plane="XZ", outline=False)
    slab(name, pts, depth, P["dark"], parent=parent, loc=(x, y - 0.05, z), plane="XZ", outline=False)


def stone_block_w(name, P, parent, cx, cy, w, d, z0, h, buttress=0):
    """A stone body (ashlar-faced rubble), a chamfered plinth, `buttress` buttresses on the front face."""
    g = lib.empty(name, parent=parent, loc=(cx, cy, z0))
    g["block"] = [cx, cy, w, d, z0, h]
    box(name + "_body", (w, d, h), P["stone"], g, loc=(0, 0, h / 2), bevel=0.02)
    box(name + "_plinth", (w + 0.16, d + 0.16, 0.45), P["stone"], g, loc=(0, 0, 0.22), bevel=0.06)
    for k in range(buttress):
        x = -w / 2 + w * (k + 0.5) / buttress
        box(f"{name}_bt{k}", (0.4, 0.5, h * 0.8), P["stone"], g, loc=(x, -d / 2 - 0.2, h * 0.4), bevel=0.03, taper=(1.0, 0.5))
    return g


# ---------------------------------------------------------------- the samples: main city, house, barracks

def _team_hangings_e(P, root, xs, y, z_top, w=0.7, h=1.6):
    for k, x in enumerate(xs):
        kit.drape(f"tm_hang{k}", P, root, "y", x, z_top, w, h, y0=y)


def main_city(root, c):
    P = palette(c)
    if c == "E":
        # 州府正堂: a three-bay hall on a high platform, 歇山 roof with 鴟尾; a paved forecourt with lanterns, the owner's
        # banners at the front corners, hangings between the front columns
        kit.pad("mc_pave", P, root, 4 * CELL, 4 * CELL, h=0.12, material="pave")
        platform_e("mc_plat", P, root, 7.2, 5.0, 1.1, cy=0.9, steps=2.2)
        w, d, top = hall_e("mc_hall", P, root, 0, 1.0, 1.1, (1.9, 2.4, 1.9), (1.8, 1.8), 3.0, 0.25, 1.45, qizhu=True)
        tang_roof("mc_roof", P, root, 0, 1.0, 1.1 + top, w + 0.6, d + 0.6, 1.65, 1.25, kind="xieshan", lift=0.07, chiwei=True,
                  chiwei_s=1.15, tile_pitch=0.3)
        _team_hangings_e(P, root, (-2.15, 2.15), 1.0 - d / 2 - 0.2, 1.1 + 2.9, w=0.7, h=1.7)
        for sx in (-1, 1):
            kit.flag(f"mc_flag{sx}", P, root, (sx * 3.5, -3.4, 0.12), 5.2, c, w=1.2, fh=1.8)
            cyl(f"mc_lamp{sx}", 0.22, 1.1, P["stone"], root, loc=(sx * 1.6, -3.0, 0.12), r2=0.16, segs=8)
            box(f"mc_lampbox{sx}", (0.42, 0.42, 0.42), P["stone"], root, loc=(sx * 1.6, -3.0, 1.43), bevel=0.04)
    else:
        # a town hall c.1250 (a market hall below, the council hall above; a belfry): an open arcade of pointed arches
        # on the ground floor, the hall's lancet windows over it, a steep slate roof; a square crenellated belfry at
        # the front corner (not a spire: it must not read as a church); the owner's banners
        kit.pad("mc_pave", P, root, 4 * CELL, 4 * CELL, h=0.12, material="pave")
        hx, hy, hw, hd = 0.6, 0.8, 6.2, 4.6
        stone_block_w("mc_hall", P, root, hx, hy, hw, hd, 0.12, 5.4, buttress=0)
        yf = hy - hd / 2
        for k, x in enumerate((-1.25, 0.6, 2.45)):            # the arcade: three pointed arches, dark inside
            lancet_w(f"mc_arc{k}", P, root, x, yf, 0.12, 1.25, 2.3, depth=0.5)
        box("mc_string", (hw + 0.1, 0.18, 0.2), P["stone"], root, loc=(hx, yf - 0.06, 2.75), bevel=0.02)
        for k, x in enumerate((-1.25, 0.6, 2.45)):
            lancet_w(f"mc_l{k}", P, root, x, yf, 3.15, 0.5, 1.6)
        g, rise = gable_roof_w("mc_roof", P, root, hx, hy, 5.52, hw, hd, 55, 0.3, "tile", thick=0.1)
        gable_fill_w("mc_gf", P, root, hx, hy, 5.52, hw, hd, rise, ridge="x", mat="stone", timber=False)
        # the belfry: a square stone tower, an open bell stage, crenellations on top, a low lead roof inside them
        tx, ty, tw = -2.75, -2.55, 2.3
        stone_block_w("mc_tower", P, root, tx, ty, tw, tw, 0.12, 8.6)
        lancet_w("mc_tl2", P, root, tx, ty - tw / 2, 3.9, 0.28, 0.9)
        for e in (-0.45, 0.45):                               # the bell stage: two openings on the front
            lancet_w(f"mc_bell{e}", P, root, tx + e, ty - tw / 2, 6.6, 0.42, 1.4, depth=0.5)
        box("mc_tcorb", (tw + 0.3, tw + 0.3, 0.25), P["stone"], root, loc=(tx, ty, 8.85), bevel=0.03)
        for i in range(4):
            for side in range(4):
                t = -tw / 2 - 0.05 + (i + 0.5) * (tw + 0.1) / 4
                if i % 2:
                    continue
                pos = {0: (tx + t, ty - tw / 2 - 0.05), 1: (tx + t, ty + tw / 2 + 0.05), 2: (tx - tw / 2 - 0.05, ty + t),
                       3: (tx + tw / 2 + 0.05, ty + t)}[side]
                box(f"mc_tm{i}{side}", (0.5, 0.5, 0.65), P["stone"], root, loc=(pos[0], pos[1], 9.3), bevel=0.02)
        cyl("mc_troof", tw * 0.62, 1.1, P["tile"], root, loc=(tx, ty, 8.97), r2=0.02, segs=4, rot=(0, 0, 45))
        for sx in (-1, 1):
            kit.flag(f"mc_flag{sx}", P, root, (3.4 if sx > 0 else -1.2, -3.5, 0.12), 4.8, c, w=1.2, fh=1.8)
        kit.flag("mc_tflag", P, root, (tx, ty, 10.0), 2.4, c, w=1.0, fh=1.3)
        kit.drape("mc_hang", P, root, "y", 1.55, 4.9, 0.9, 1.9, y0=yf - 0.02)


def house(root, c):
    P = palette(c)
    if c == "E":
        # a commoner's house: rammed-earth and plaster walls on a low platform, red posts, a 懸山 tile roof; a low
        # rammed-earth yard wall, a water jar, a small owner's pennant
        platform_e("hs_plat", P, root, 3.6, 2.8, 0.35, cy=0.45, steps=1.0)
        w, d, top = hall_e("hs_hall", P, root, 0, 0.45, 0.35, (1.0, 1.4, 1.0), (2.3,), 2.4, 0.13, 0.0)
        tang_roof("hs_roof", P, root, 0, 0.45, 0.35 + 2.45, w + 0.2, d + 0.2, 0.96, 0.55, kind="xuanshan", lift=0.0,
                  chiwei=False, tile_amp=0.03)
        rammed_wall_e("hs_yw", P, root, -1.9, -1.85, -0.7, -1.85, 1.0, t=0.32)
        rammed_wall_e("hs_yw2", P, root, 0.7, -1.85, 1.9, -1.85, 1.0, t=0.32)
        cyl("hs_jar", 0.28, 0.6, P["brick"], root, loc=(1.45, -1.2, 0.0), r2=0.22, segs=12)
        kit.pennant("hs_pen", P, root, (1.75, 1.7, 0.0), 3.6, w=0.7, fh=0.45)
    else:
        # a peasant's cottage: a timber frame on a stone footing, limewashed wattle and daub, a steep thatch with a
        # smoke hole, a wattle fence; the owner's pennant
        kit.pad("hs_ground", P, root, 2 * CELL, 2 * CELL, h=0.06, material="earth")
        box("hs_foot", (2.8, 3.3, 0.35), P["stone"], root, loc=(0, 0.3, 0.17), bevel=0.04)
        # the gable end faces the camera: a timber frame (sill, posts, rail, braces) with limewashed panels
        timber_wall_w("hs_wf", P, root, -1.35, 1.35, 0.3 - 1.6, 0.35, 1.9, posts=4, face=-1)
        box("hs_back", (2.7, 0.16, 1.9), P["plaster"], root, loc=(0, 0.3 + 1.6, 1.3))
        for sx in (-1, 1):                       # the side walls (edge-on to the camera): plain boxes do
            box(f"hs_side{sx}", (0.16, 3.2, 1.9), P["plaster"], root, loc=(sx * 1.35, 0.3, 1.3))
        box("hs_door", (0.75, 0.08, 1.55), P["wood"], root, loc=(-0.35, 0.3 - 1.68, 0.35 + 0.78))
        box("hs_win", (0.45, 0.08, 0.4), P["dark"], root, loc=(0.75, 0.3 - 1.68, 0.35 + 1.25))
        g, rise = gable_roof_w("hs_roof", P, root, 0, 0.3, 2.25, 2.7, 3.2, 52, 0.4, "thatch", thick=0.38, louvre=False,
                               round_eave=True, ridge="y")
        gable_fill_w("hs_gf", P, root, 0, 0.3, 2.25, 2.7, 3.2, rise, ridge="y", timber=True, under=0.86)
        for k in range(7):                   # the wattle fence round the front
            rod(f"hs_fence{k}", (-1.9 + k * 0.6, -1.7, 0.0), (-1.9 + k * 0.6, -1.7, 0.9), 0.04, P["wood"], parent=root, segs=5)
        for z in (0.3, 0.6, 0.85):
            box(f"hs_wattle{z}", (3.7, 0.05, 0.12), P["thatch"], root, loc=(-0.1, -1.7, z))
        kit.pennant("hs_pen", P, root, (1.8, 1.75, 0.0), 3.4, w=0.7, fh=0.45)


def barracks(root, c):
    P = palette(c)
    if c == "E":
        # 軍營: a long five-bay barrack hall with a front gallery (廊) of columns, a 懸山 tile roof; a beaten-earth drill
        # yard in front: a weapon rack of spears, a war drum, the owner's big banner
        kit.pad("bk_yard", P, root, 3 * CELL, 3 * CELL, h=0.08, material="earth")
        platform_e("bk_plat", P, root, 5.8, 2.8, 0.4, cy=1.35, steps=1.4)
        w, d, top = hall_e("bk_hall", P, root, 0, 1.35, 0.4, (1.1, 1.1, 1.2, 1.1, 1.1), (2.4,), 2.6, 0.14, 0.55)
        tang_roof("bk_roof", P, root, 0, 1.35, 0.4 + top, w + 0.3, d + 0.3, 1.04, 0.7, kind="xuanshan", lift=0.0,
                  chiwei=False)
        rack = lib.empty("bk_rack", parent=root, loc=(-1.8, -1.6, 0.08))
        for k in range(2):
            box(f"bk_rack_b{k}", (1.6, 0.08, 0.08), P["wood"], rack, loc=(0, 0, 0.5 + k * 0.9))
        for sx in (-1, 1):
            box(f"bk_rack_p{sx}", (0.1, 0.1, 1.6), P["wood"], rack, loc=(sx * 0.8, 0, 0.8))
        for k in range(6):
            rod(f"bk_spear{k}", (-0.65 + k * 0.26, 0.05, 0.05), (-0.65 + k * 0.26, -0.05, 2.6), 0.02, P["wood"], parent=rack,
                segs=5)
            cyl(f"bk_tip{k}", 0.03, 0.22, P["iron"], rack, loc=(-0.65 + k * 0.26, -0.05, 2.6), r2=0.0, segs=5)
        war_drum("bk_drum", P, root, 1.15, -1.55, r=0.4, h=0.55)
        kit.flag("bk_flag", P, root, (2.4, -2.3, 0.08), 5.0, c, w=1.3, fh=1.9)
        _team_hangings_e(P, root, (-1.65, 1.65), 1.35 - d / 2 - 0.2, 0.4 + 2.45, w=0.6, h=1.3)
    else:
        # garrison lodging c.1250: a long stone ground floor with a timber-framed upper storey, a steep slate roof with a
        # louvre; a yard with a pell (the practice post), a weapon rack, the owner's banner
        kit.pad("bk_yard", P, root, 3 * CELL, 3 * CELL, h=0.08, material="earth")
        stone_block_w("bk_low", P, root, 0, 1.3, 5.6, 3.0, 0.08, 2.4, buttress=0)
        for k, x in enumerate((-1.9, 0.0, 1.9)):
            lancet_w(f"bk_l{k}", P, root, x, 1.3 - 1.5, 1.1, 0.3, 0.8)
        box("bk_door", (0.9, 0.1, 1.8), P["wood"], root, loc=(-0.95, 1.3 - 1.52, 0.08 + 0.9))
        timber_wall_w("bk_up", P, root, -2.8, 2.8, 1.3 - 1.5, 2.48, 1.9, posts=6, face=-1)
        box("bk_upback", (5.6, 0.16, 1.9), P["plaster"], root, loc=(0, 1.3 + 1.5, 2.48 + 0.95))
        for sx in (-1, 1):
            box(f"bk_upside{sx}", (0.16, 3.0, 1.9), P["plaster"], root, loc=(sx * 2.8, 1.3, 2.48 + 0.95))
        g, rise = gable_roof_w("bk_roof", P, root, 0, 1.3, 4.38, 5.6, 3.0, 52, 0.35, "tile", thick=0.1, louvre=True)
        gable_fill_w("bk_gf", P, root, 0, 1.3, 4.38, 5.6, 3.0, rise, ridge="x", mat="plaster", timber=False)
        cyl("bk_pell", 0.14, 1.8, P["wood"], root, loc=(1.4, -1.9, 0.08), segs=10)
        rack = lib.empty("bk_rack", parent=root, loc=(-1.5, -1.8, 0.08))
        for k in range(2):
            box(f"bk_rack_b{k}", (1.5, 0.08, 0.08), P["wood"], rack, loc=(0, 0, 0.5 + k * 0.9))
        for k in range(5):
            rod(f"bk_pike{k}", (-0.6 + k * 0.3, 0.05, 0.05), (-0.6 + k * 0.3, -0.05, 2.7), 0.022, P["wood"], parent=rack, segs=5)
        kit.flag("bk_flag", P, root, (2.5, -2.3, 0.08), 5.0, c, w=1.3, fh=1.9)
        kit.drape("bk_hang", P, root, "y", 0.9, 4.2, 0.9, 1.4, y0=1.3 - 1.62)


FOOTPRINT = {"r8_main_city": (4, 4), "r8_house": (2, 2), "r8_barracks": (3, 3)}
BUILDERS = {"r8_main_city": main_city, "r8_house": house, "r8_barracks": barracks}
