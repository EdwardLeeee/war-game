"""R6-50 (the user 2026-10-20: 「地面也可以美化一下現在感覺太陽春」): a patch of battlefield ground in one of three looks,
rendered with the oblique camera and the art-v3 light, for the option boards (design/r6/common/r650.py). Only the
picture: the sim does not change.

  gpatch(root, c, style, w, d, plan)   w x d metres, centred on the origin; plan (design/b1/common/ground_plan.py):
      dirt  [[(x, y), ...], ...]    trampled earth (round the main city, a field's edge)
      gravel[[(x, y), ...], ...]    gravel ground
      dark  [[(x, y), ...], ...]    darker grass
      road  [[(x, y), ...], ...]    the road's centre line(s), metres
      decals[(kind, x, y, s), ...]  flower / tuft / pebble / bush, s its size

Styles: A 自然草地 (grass in two shades, flowers and tufts, a soft earth road), B 田野與碎石 (A with earth and gravel
ground, pebbles, a road with wheel ruts), C 手繪地圖風 (saturated, brush-stroke grass, a road with a drawn edge).
"""
import math
import random

import lib
from lib import cyl, ico, slab, sphere

FOOTPRINT = {"gpatch": (1, 1)}

LOOK = {
    # albedo picked so the lit ground lands near the R6 boards' (sRGB 111, 125, 91): the first renders were 1.5 x too bright
    "A": dict(grass=(0.11, 0.17, 0.06), grass2=(0.085, 0.14, 0.045), gn=0.22, gs=2.2, road=(0.19, 0.14, 0.085), rw=2.6,
              dirt=(0.16, 0.12, 0.075), gravel=None, ruts=False, edge=None, flowers=1.0, tufts=1.0, pebbles=0.0),
    "B": dict(grass=(0.115, 0.165, 0.06), grass2=(0.09, 0.135, 0.05), gn=0.26, gs=2.6, road=(0.18, 0.13, 0.08), rw=3.0,
              dirt=(0.155, 0.11, 0.07), gravel=(0.25, 0.24, 0.21), ruts=True, edge=None, flowers=0.6, tufts=1.2, pebbles=1.0),
    "C": dict(grass=(0.075, 0.2, 0.035), grass2=(0.05, 0.16, 0.025), gn=0.38, gs=9.0, road=(0.32, 0.22, 0.1), rw=2.6,
              dirt=(0.27, 0.19, 0.09), gravel=None, ruts=False, edge=(0.11, 0.07, 0.035), flowers=0.5, tufts=0.4, pebbles=0.0),
}


def _poly(name, pts, m, parent, z, thick=0.02):
    """A flat polygon facing up at height z (one face: a thin slab's sides flipped some normals, which rendered black)."""
    import bmesh
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, 0.0)) for x, y in pts]
    area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    bm.faces.new(vs if area > 0 else list(reversed(vs)))          # counter-clockwise: the normal points up
    return lib._mesh_obj(name, bm, m, parent, (0, 0, z), smooth=False, outline=False)


def _ribbon(name, line, width, m, parent, z):
    """A flat band of `width` along a polyline: one quad per segment, overlapping at the joints."""
    for k in range(len(line) - 1):
        (x0, y0), (x1, y1) = line[k], line[k + 1]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / L * width / 2, dx / L * width / 2
        ex, ey = dx / L * width * 0.35, dy / L * width * 0.35        # a little past the ends: round-ish joints
        pts = [(x0 - nx - ex, y0 - ny - ey), (x1 - nx + ex, y1 - ny + ey), (x1 + nx + ex, y1 + ny + ey), (x0 + nx - ex, y0 + ny - ey)]
        _poly(f"{name}{k}", pts, m, parent, z)


def _offset(line, d):
    out = []
    for k, (x, y) in enumerate(line):
        a = line[max(0, k - 1)]
        b = line[min(len(line) - 1, k + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy) or 1.0
        out.append((x - dy / L * d, y + dx / L * d))
    return out


def gpatch(root, c, variant=0, style="A", w=52.0, d=40.0, plan=None):
    S = LOOK[style]
    plan = plan or {}
    rnd = random.Random(7 + variant)
    grass = lib.mat(f"gp_grass_{style}", S["grass"], 0.92, noise=S["gn"], noise_scale=S["gs"])
    grass2 = lib.mat(f"gp_grass2_{style}", S["grass2"], 0.92, noise=S["gn"], noise_scale=S["gs"] * 1.7)
    road = lib.mat(f"gp_road_{style}", S["road"], 0.95, noise=0.18, noise_scale=6)
    dirt = lib.mat(f"gp_dirt_{style}", S["dirt"], 0.95, noise=0.25, noise_scale=5)
    # the ground itself, a little above the shadow catcher
    _poly("gp_base", [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)], grass, root, 0.004, 0.008)
    for k, pts in enumerate(plan.get("dark", [])):
        _poly(f"gp_dark{k}", pts, grass2, root, 0.012, 0.004)
    for k, pts in enumerate(plan.get("dirt", [])):
        _poly(f"gp_dirt{k}", pts, dirt, root, 0.016, 0.004)
    if S["gravel"]:
        gravel = lib.mat(f"gp_gravel_{style}", S["gravel"], 0.95, noise=0.5, noise_scale=40)
        for k, pts in enumerate(plan.get("gravel", [])):
            _poly(f"gp_grv{k}", pts, gravel, root, 0.018, 0.004)
    for k, line in enumerate(plan.get("road", [])):
        if S["edge"]:
            edge = lib.mat(f"gp_edge_{style}", S["edge"], 0.9)
            _ribbon(f"gp_redge{k}_", line, S["rw"] + 0.35, edge, root, 0.02)
        _ribbon(f"gp_road{k}_", line, S["rw"], road, root, 0.024)
        if S["ruts"]:
            rut = lib.mat(f"gp_rut_{style}", tuple(v * 0.72 for v in S["road"]), 0.95, noise=0.2, noise_scale=8)
            for side in (-0.55, 0.55):
                _ribbon(f"gp_rut{k}{side}_", _offset(line, side), 0.28, rut, root, 0.028)
    # the small things on the grass
    flower = [lib.mat(f"gp_fl{i}", col, 0.6, sheen=0.3) for i, col in
              enumerate(((0.8, 0.78, 0.7), (0.85, 0.62, 0.08), (0.7, 0.26, 0.38), (0.36, 0.36, 0.75)))]
    tuftm = lib.mat(f"gp_tuft_{style}", tuple(v * 1.12 for v in S["grass"]), 0.85, noise=0.2, noise_scale=20)
    bushm = lib.mat("gp_bush", (0.06, 0.13, 0.045), 0.85, noise=0.35, noise_scale=12, sheen=0.3)
    stone = lib.mat("gp_pebble", (0.26, 0.25, 0.23), 0.9, noise=0.4, noise_scale=20)
    for k, (kind, x, y, s) in enumerate(plan.get("decals", [])):
        if kind == "flower" and rnd.random() < S["flowers"]:
            m = flower[k % len(flower)]
            for i in range(5):
                a = rnd.uniform(0, 2 * math.pi)
                r = rnd.uniform(0, 0.35 * s)
                cyl(f"gp_stem{k}_{i}", 0.012, 0.18 * s, tuftm, root, loc=(x + r * math.cos(a), y + r * math.sin(a), 0.01),
                    segs=4, outline=False)
                sphere(f"gp_fl{k}_{i}", 0.05 * s, m, root, loc=(x + r * math.cos(a), y + r * math.sin(a), 0.2 * s),
                       outline=False)
        elif kind == "tuft" and rnd.random() < min(1.0, S["tufts"]):
            for i in range(7):
                a = rnd.uniform(0, 2 * math.pi)
                r = rnd.uniform(0, 0.18 * s)
                cyl(f"gp_tf{k}_{i}", 0.035 * s, 0.32 * s * rnd.uniform(0.7, 1.2), tuftm, root,
                    loc=(x + r * math.cos(a), y + r * math.sin(a), 0.0), r2=0.002, segs=5,
                    rot=(rnd.uniform(-18, 18), rnd.uniform(-18, 18), 0), outline=False)
        elif kind == "bush":
            for i in range(3):
                sphere(f"gp_bu{k}_{i}", 0.32 * s * rnd.uniform(0.8, 1.1), bushm, root,
                       loc=(x + rnd.uniform(-0.25, 0.25) * s, y + rnd.uniform(-0.25, 0.25) * s, 0.22 * s), scale=(1, 1, 0.75))
        elif kind == "pebble" and rnd.random() < S["pebbles"]:
            for i in range(3):
                ico(f"gp_pb{k}_{i}", 0.07 * s * rnd.uniform(0.7, 1.3), stone, root,
                    loc=(x + rnd.uniform(-0.3, 0.3) * s, y + rnd.uniform(-0.3, 0.3) * s, 0.03), subdiv=1,
                    scale=(1, 1, 0.6), outline=False)


BUILDERS = {"gpatch": gpatch}
