"""A 彩繪桌遊: buildings and props, drawn on the same isometric grid as the 3D options
(an isometric drawing grid, like a hand illustrator's; faces use fixed painted tones,
no lighting is computed). Buildings face world -Y (screen lower right).

draw(kind, variant, k) -> (colour RGBA, team mask RGBA, anchor px)
"""
import math
import random

import paint as pt
from paint import Painter, ellipse, iso, poly

C = dict(
    tile=pt.rgb("4f6a86"), tile_hl=pt.rgb("7f9bb8"), ridge=pt.rgb("2f3b4a"), plaster=pt.rgb("f6ecd6"),
    red=pt.rgb("c9402f"), timber=pt.rgb("7a4a28"), brick=pt.rgb("b9a58d"), brick_dk=pt.rgb("8f7c66"),
    stone=pt.rgb("c7c2b6"), stone_dk=pt.rgb("9d978a"), dark=pt.rgb("3a2c24"), gold=pt.rgb("f2c640"),
    rock=pt.rgb("9a8e80"), leaf=pt.rgb("5fae3e"), leaf2=pt.rgb("7cc24a"), pine=pt.rgb("2f8a52"),
    bark=pt.rgb("8a5a34"), grass=pt.rgb("6fbf3e"), wood=pt.rgb("a86a34"), straw=pt.rgb("f0c860"),
    lantern=pt.rgb("e0442e"), slate=pt.rgb("6d7686"), bronze=pt.rgb("c9923c"),
)


def box3(P, x0, x1, y0, y1, z0, z1, col, top=None, sh=0.78, lw=None, detail=None):
    """Iso box: left face (x=x0) lit, right face (y=y0) shaded, top lightest."""
    lw = P.lw if lw is None else lw
    left = pt.iso_poly([(x0, y0, z0), (x0, y1, z0), (x0, y1, z1), (x0, y0, z1)])
    right = pt.iso_poly([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)])
    topf = pt.iso_poly([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)])
    P.part(left, col, sh=0, hl=0, lw=lw)
    P.part(right, pt.shade(col, sh), sh=0, hl=0, lw=lw)
    if detail:
        detail(x0, x1, y0, y1, z0, z1)
    P.part(topf, top or pt.tint(col, 0.18), sh=0, hl=0, lw=lw)


def courses(P, x0, x1, y0, y1, z0, z1, step=0.45, col=None, alpha=0.45, vertical=0.9):
    """Masonry courses painted on the two visible faces."""
    col = col or (0.35, 0.28, 0.22)
    rnd = random.Random(int(x0 * 13 + y0 * 7 + z0 * 3))
    z = z0 + step
    row = 0
    while z < z1 - 0.05:
        for face in ("L", "R"):
            if face == "L":
                a, b = iso(x0, y0, z), iso(x0, y1, z)
            else:
                a, b = iso(x0, y0, z), iso(x1, y0, z)
            P.detail(lambda c, a=a, b=b: (c.move_to(*a), c.line_to(*b)), col, width=0.35, alpha=alpha)
        # vertical joints, staggered
        for face, (u0, u1) in (("L", (y0, y1)), ("R", (x0, x1))):
            u = u0 + (vertical * (0.5 if row % 2 else 1.0))
            while u < u1 - 0.1:
                if face == "L":
                    a, b = iso(x0, u, z - step), iso(x0, u, z)
                else:
                    a, b = iso(u, y0, z - step), iso(u, y0, z)
                P.detail(lambda c, a=a, b=b: (c.move_to(*a), c.line_to(*b)), col, width=0.3, alpha=alpha * 0.8)
                u += vertical * rnd.uniform(0.9, 1.3)
        z += step
        row += 1


def roof(P, x0, x1, y0, y1, ze, zr, over=0.8, curl=0.55, col=None):
    """East hip roof: concave slopes, ridge along X, upturned corners; only the two front faces show."""
    col = col or C["tile"]
    A = (x0 - over, y0 - over)
    B = (x1 + over, y0 - over)
    D = (x0 - over, y1 + over)
    yc = (y0 + y1) / 2
    half_d = (y1 - y0) / 2 + over
    xa, xb = x0 + half_d * 0.5, x1 - half_d * 0.5
    if xb < xa:
        xa = xb = (x0 + x1) / 2
    R0, R1 = (xa, yc, zr), (xb, yc, zr)

    def eave(p, q, n=10):
        pts = []
        for i in range(n + 1):
            u = i / n
            x = p[0] + (q[0] - p[0]) * u
            y = p[1] + (q[1] - p[1]) * u
            lift = curl * (abs(2 * u - 1) ** 4)
            pts.append((x, y, ze + lift - 0.12 * math.sin(math.pi * u)))
        return pts

    def hip(corner, ridge, n=6):
        pts = []
        for i in range(n + 1):
            s = i / n
            x = corner[0] + (ridge[0] - corner[0]) * s
            y = corner[1] + (ridge[1] - corner[1]) * s
            z = ze + curl * (1 - s) ** 2 + (zr - ze) * s ** 1.5
            pts.append((x, y, z))
        return pts

    front = eave(A, B) + hip(B, R1)[1:] + [R0] + list(reversed(hip(A, R0)[1:-1]))
    left = eave(D, A) + hip(A, R0)[1:] + list(reversed(hip(D, R0)[1:-1]))
    P.part(pt.iso_poly(left), col, sh=0, hl=0)
    P.part(pt.iso_poly(front), pt.shade(col, 0.8), sh=0, hl=0)
    # tile channels running down the front slope
    for i in range(1, 14):
        u = i / 14
        e = eave(A, B)[int(u * 10)]
        r = (xa + (xb - xa) * u, yc, zr)
        a, b = iso(*e), iso(*r)
        P.detail(lambda c, a=a, b=b: (c.move_to(*a), c.line_to(*b)), pt.shade(col, 0.6), width=0.4, alpha=0.7)
    for i in range(1, 6):
        u = i / 6
        e = eave(D, A)[int(u * 10)]
        a, b = iso(*e), iso(*R0)
        P.detail(lambda c, a=a, b=b: (c.move_to(*a), c.line_to(*b)), pt.shade(col, 0.72), width=0.4, alpha=0.6)
    # light eave edge (tile ends)
    for seg in (eave(A, B), eave(D, A)):
        pts = [iso(*q) for q in seg]
        P.detail(lambda c, pts=pts: (c.move_to(*pts[0]), [c.line_to(*q) for q in pts[1:]]), C["tile_hl"],
                 width=0.9)
    # ridge beam with curled ends
    ra, rb = iso(*R0), iso(*R1)
    P.line([ra, rb], C["ridge"], 1.6)
    for end, s in ((ra, -1), (rb, 1)):
        P.curve([end, (end[0] + s * 1.0, end[1] - 1.6), (end[0] + s * 2.4, end[1] - 2.8),
                 (end[0] + s * 1.4, end[1] - 4.0)], C["ridge"], 1.1)


def hall_front(P, x0, x1, y0, z0, z1, posts=6, lattice=True):
    """Red pillars and lattice screens on the front (y = y0) face."""
    for i in range(posts):
        x = x0 + (x1 - x0) * i / (posts - 1)
        if lattice and i < posts - 1:
            xm0 = x + 0.15
            xm1 = x + (x1 - x0) / (posts - 1) - 0.15
            P.part(pt.iso_poly([(xm0, y0, z0 + 0.5), (xm1, y0, z0 + 0.5), (xm1, y0, z1 - 0.3), (xm0, y0, z1 - 0.3)]),
                   C["timber"], sh=0, hl=0, lw=P.lw * 0.6)
            for k in range(1, 4):
                zz = z0 + 0.5 + (z1 - z0 - 0.8) * k / 4
                a, b = iso(xm0, y0, zz), iso(xm1, y0, zz)
                P.detail(lambda c, a=a, b=b: (c.move_to(*a), c.line_to(*b)), pt.tint(C["timber"], 0.45), width=0.4)
        a, b = iso(x, y0 - 0.05, z0), iso(x, y0 - 0.05, z1)
        P.line([a, b], C["red"], 1.5)


def banner(P, x, y, z, h, emblem, w=1.0, fh=1.9, team=True):
    base = iso(x, y, z)
    top = iso(x, y, z + h)
    P.line([base, top], C["timber"], 0.9)
    P.part(ellipse(top[0], top[1] - 0.6, 0.9, 0.9), C["gold"], sh=0.2, hl=0.2, lw=0.6)
    fx, fy = top[0] + 0.4, top[1] + 0.8
    Wp, Hp = w * 15.0, fh * 17.3
    P.part(pt.path_cmds([("M", fx, fy), ("L", fx + Wp, fy + Wp * 0.18),
                         ("C", fx + Wp * 1.04, fy + Hp * 0.5, fx + Wp * 0.94, fy + Hp * 0.8, fx + Wp, fy + Hp + 2),
                         ("L", fx + Wp * 0.5, fy + Hp * 0.86 + 2), ("L", fx, fy + Hp), ("Z",)]),
           (0, 0, 0), team=team, sh=1.4, hl=0.5)
    P.emblem(emblem, fx + Wp * 0.5, fy + Hp * 0.46, min(Wp, Hp) * 0.9)
    P.line([(fx, fy), (fx + Wp, fy + Wp * 0.18)], C["timber"], 0.8)


# ------------------------------------------------------------------ buildings

def citygate_e(P):
    # wall wings (behind the platform)
    for s in (-1, 1):
        xa, xb = (3.7, 10.7) if s > 0 else (-10.7, -3.7)
        box3(P, xa, xb, -1.9, 2.5, 0.0, 0.5, C["stone"])
        box3(P, xa, xb, -1.8, 2.4, 0.5, 3.4, C["brick"], top=pt.rgb("d9c9ae"),
             detail=lambda *a: courses(P, *a, step=0.42, vertical=0.9))
        # crenellations along the front edge (雉堞)
        n = 8
        for k in range(n):
            x = xa + (xb - xa) * (k + 0.5) / n
            box3(P, x - 0.28, x + 0.28, -1.8, -1.35, 3.4, 3.95, C["brick"], lw=P.lw * 0.8)
    box3(P, -4.15, 4.15, -2.75, 2.75, 0.0, 0.6, C["stone"])
    box3(P, -4.0, 4.0, -2.6, 2.6, 0.6, 3.8, C["brick"], top=pt.rgb("d9c9ae"),
         detail=lambda *a: courses(P, *a, step=0.42, vertical=0.9))
    # gate arch with red doors
    pts = [(-1.15, -2.62, 0.05), (1.15, -2.62, 0.05)]
    for i in range(9):
        a = math.pi * i / 8
        pts.append((1.15 * math.cos(a), -2.62, 2.2 + 1.0 * math.sin(a)))
    P.part(pt.iso_poly(pts), C["dark"], sh=0, hl=0)
    P.part(pt.iso_poly([(-1.0, -2.64, 0.05), (-0.05, -2.64, 0.05), (-0.05, -2.64, 2.4), (-1.0, -2.64, 2.3)]),
           C["red"], sh=0, hl=0, lw=P.lw * 0.7)
    for k in range(3):
        for j in range(3):
            q = iso(-0.8 + j * 0.3, -2.66, 0.6 + k * 0.6)
            P.detail(ellipse(q[0], q[1], 0.45, 0.45), C["gold"], fill=True)
    for k in range(10):
        x = -3.7 + k * 0.82
        box3(P, x - 0.24, x + 0.24, -2.6, -2.2, 3.8, 4.3, C["brick"], lw=P.lw * 0.8)
    # tower hall
    box3(P, -3.3, 3.3, -1.7, 2.1, 3.8, 4.05, C["stone"])
    box3(P, -2.8, 2.8, -1.3, 1.7, 4.05, 6.3, C["plaster"])
    hall_front(P, -2.8, 2.8, -1.32, 4.05, 6.3, posts=6)
    for k in range(4):   # pillars on the left face
        y = -1.3 + k * 1.0
        P.line([iso(-2.82, y, 4.05), iso(-2.82, y, 6.3)], C["red"], 1.4)
    box3(P, -3.1, 3.1, -1.6, 2.0, 4.8, 4.95, C["red"], lw=P.lw * 0.7)
    roof(P, -2.8, 2.8, -1.3, 1.7, 6.3, 7.5, over=0.95, curl=0.6)
    box3(P, -2.1, 2.1, -0.9, 1.3, 7.2, 8.6, C["plaster"])
    hall_front(P, -2.1, 2.1, -0.92, 7.2, 8.6, posts=4)
    roof(P, -2.1, 2.1, -0.9, 1.3, 8.6, 10.0, over=0.85, curl=0.55)
    banner(P, -3.5, -2.6, 3.8, 3.6, "crane", w=1.0, fh=1.9)
    banner(P, 3.2, -2.6, 3.8, 3.6, "crane", w=1.0, fh=1.9)


def house(P, cx, cy, w, d):
    x0, x1, y0, y1 = cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2
    box3(P, x0 - 0.15, x1 + 0.15, y0 - 0.15, y1 + 0.15, 0, 0.4, C["stone"])
    box3(P, x0, x1, y0, y1, 0.4, 2.6, C["plaster"])
    for x in (x0, x1):
        P.line([iso(x, y0 - 0.02, 0.4), iso(x, y0 - 0.02, 2.6)], C["timber"], 1.1)
    P.line([iso(x0 - 0.02, y1, 0.4), iso(x0 - 0.02, y1, 2.6)], C["timber"], 1.1)
    P.line([iso(x0, y0 - 0.02, 2.5), iso(x1, y0 - 0.02, 2.5)], C["timber"], 1.0)
    P.part(pt.iso_poly([(x0 + w * 0.2, y0 - 0.03, 0.4), (x0 + w * 0.42, y0 - 0.03, 0.4),
                        (x0 + w * 0.42, y0 - 0.03, 2.0), (x0 + w * 0.2, y0 - 0.03, 2.0)]), C["timber"], sh=0, hl=0,
           lw=P.lw * 0.7)
    P.part(pt.iso_poly([(x0 + w * 0.6, y0 - 0.03, 1.4), (x0 + w * 0.85, y0 - 0.03, 1.4),
                        (x0 + w * 0.85, y0 - 0.03, 2.05), (x0 + w * 0.6, y0 - 0.03, 2.05)]),
           pt.rgb("5a3a22"), sh=0, hl=0, lw=P.lw * 0.7)
    roof(P, x0, x1, y0, y1, 2.6, 3.9, over=0.7, curl=0.38)


def town_e(P):
    # low stone wall arc (back part first)
    segs = []
    for k in range(7):
        a = math.radians(-160 + k * 22)
        segs.append((5.4 * math.cos(a), 5.0 * math.sin(a) + 0.6))
    house(P, 2.6, 2.6, 2.4, 3.2)
    house(P, -2.8, 1.8, 3.6, 2.6)
    # drum tower
    box3(P, 2.0, 4.4, -2.8, -0.4, 0, 2.4, C["stone"], detail=lambda *a: courses(P, *a, step=0.5, vertical=0.8))
    box3(P, 2.25, 4.15, -2.55, -0.65, 2.4, 3.9, C["plaster"])
    hall_front(P, 2.25, 4.15, -2.57, 2.4, 3.9, posts=3)
    roof(P, 2.25, 4.15, -2.55, -0.65, 3.9, 5.2, over=0.7, curl=0.45)
    house(P, -0.4, -1.8, 3.0, 2.2)
    # sacks, crate, lanterns
    for x, y in [(-1.9, -3.4), (-1.5, -3.7), (-2.3, -3.8)]:
        q = iso(x, y, 0)
        P.part(ellipse(q[0], q[1] - 3.4, 3.0, 3.4), C["straw"], sh=0.9, hl=0.4)
    for x in (-1.2, 0.4):
        q = iso(x, -2.95, 2.1)
        P.line([(q[0], q[1] - 3), (q[0], q[1] - 1)], C["dark"], 0.4, outline=False)
        P.part(ellipse(q[0], q[1] + 0.8, 1.6, 2.1), C["lantern"], sh=0.6, hl=0.4)
    # low fieldstone wall along the front, one continuous run
    box3(P, -4.6, -2.2, -4.5, -4.1, 0, 0.6, C["stone"], lw=P.lw * 0.9)
    box3(P, -0.9, 4.8, -4.5, -4.1, 0, 0.6, C["stone"], lw=P.lw * 0.9)
    banner(P, 1.2, -3.6, 0, 6.2, "crane", w=1.3, fh=2.3)


def tower_w(P):
    box3(P, -1.7, 1.7, -1.7, 1.7, 0, 0.6, C["stone_dk"])
    box3(P, -1.5, 1.5, -1.5, 1.5, 0.6, 5.9, C["stone"], detail=lambda *a: courses(P, *a, step=0.5, vertical=0.75))
    box3(P, -1.65, 1.65, -1.65, 1.65, 5.9, 6.25, C["stone_dk"])
    # merlons: back and left edges first, then the front ones
    for k in range(4):
        x = -1.2 + k * 0.8
        box3(P, x - 0.22, x + 0.22, 1.2, 1.62, 6.25, 6.85, C["stone"], lw=P.lw * 0.8)
        box3(P, -1.62, -1.2, x - 0.22, x + 0.22, 6.25, 6.85, C["stone"], lw=P.lw * 0.8)
    for k in range(4):
        x = -1.2 + k * 0.8
        box3(P, x - 0.22, x + 0.22, -1.62, -1.2, 6.25, 6.85, C["stone"], lw=P.lw * 0.8)
        box3(P, 1.2, 1.62, x - 0.22, x + 0.22, 6.25, 6.85, C["stone"], lw=P.lw * 0.8)
    for z in (2.2, 4.2):
        P.part(pt.iso_poly([(-0.07, -1.52, z), (0.07, -1.52, z), (0.07, -1.52, z + 0.8), (-0.07, -1.52, z + 0.8)]),
               C["dark"], sh=0, hl=0, lw=P.lw * 0.5)
        P.part(pt.iso_poly([(-1.52, 0.23, z), (-1.52, 0.37, z), (-1.52, 0.37, z + 0.8), (-1.52, 0.23, z + 0.8)]),
               C["dark"], sh=0, hl=0, lw=P.lw * 0.5)
    pts = [(-1.0, -1.53, 0.6), (-0.1, -1.53, 0.6)]
    for i in range(7):
        a = math.pi * i / 6
        pts.append((-0.55 + 0.45 * math.cos(a), -1.53, 1.9 + 0.45 * math.sin(a)))
    P.part(pt.iso_poly(pts), C["wood"], sh=0, hl=0)
    banner(P, 0.9, -0.9, 6.25, 2.2, "twintowers", w=0.9, fh=1.5)


def goldmine(P):
    rnd = random.Random(7)
    rocks = []
    for k in range(7):
        x, y = rnd.uniform(-1.6, 1.6), rnd.uniform(-0.6, 1.2)
        r = rnd.uniform(0.65, 1.05)
        rocks.append((x, y, r))
    rocks.sort(key=lambda q: -(q[0] + q[1]))
    for x, y, r in rocks:
        cx, cy = iso(x, y, r * 0.45)
        pts = []
        for i in range(9):
            a = 2 * math.pi * i / 9
            rr = r * 17.0 * rnd.uniform(0.85, 1.1)
            pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr * 0.72))
        P.part(pt.blob(pts), C["rock"], sh=3.0, hl=1.2)
    # timber mine frame
    for s in (-0.5, 0.45):
        P.line([iso(s, -0.9, 0), iso(s, -0.9, 1.4)], C["wood"], 1.2)
    P.line([iso(-0.6, -0.9, 1.4), iso(0.6, -0.9, 1.4)], C["wood"], 1.3)
    P.part(pt.iso_poly([(-0.4, -0.85, 0), (0.35, -0.85, 0), (0.35, -0.85, 1.3), (-0.4, -0.85, 1.3)]), C["dark"],
           sh=0, hl=0, lw=P.lw * 0.6)
    for k in range(16):
        x, y = rnd.uniform(-1.7, 1.7), rnd.uniform(-1.4, 0.2)
        q = iso(x, y - 0.3, rnd.uniform(0.3, 1.1))
        s = rnd.uniform(2.2, 3.4)
        P.part(poly([(q[0], q[1] - s), (q[0] + s, q[1]), (q[0] + s * 0.3, q[1] + s * 0.8), (q[0] - s, q[1] + s * 0.2)]),
               C["gold"], sh=0.7, hl=0.5, lw=P.lw * 0.8)
    for k in range(6):
        q = iso(-0.6 + k * 0.25, -1.55 - 0.1 * (k % 2), 0.08)
        P.part(ellipse(q[0], q[1], 2.0, 1.4), C["gold"], sh=0.5, hl=0.4, lw=P.lw * 0.8)


def tree(P, variant):
    rnd = random.Random(100 + variant)
    ts = 1.0 + 0.1 * variant
    if variant == 2:   # pine: stacked triangles
        P.part(pt.rrect(-1.6, -14, 3.2, 14, 1.0), C["bark"], sh=0.8, hl=0.3)
        for k, (w, y) in enumerate([(22, -12), (18, -30), (14, -46), (9, -60)]):
            P.part(pt.path_cmds([("M", -w, y + 6), ("C", -w * 0.5, y + 8, w * 0.5, y + 8, w, y + 6),
                                 ("L", 0, y - 22), ("Z",)]), C["pine"], sh=3.0, hl=1.2)
        return
    P.part(pt.path_cmds([("M", -2.4, 0), ("L", -1.4, -24), ("L", 1.4, -24), ("L", 2.4, 0), ("Z",)]), C["bark"],
           sh=1.0, hl=0.4)
    P.line([(0.5, -20), (7.0, -30)], C["bark"], 1.6)
    blobs = [(0, -44, 20), (13, -34, 14), (-12, -36, 14), (3, -58, 13), (-6, -28, 11)]
    for k, (x, y, r) in enumerate(sorted(blobs, key=lambda b: b[1])):
        pts = []
        for i in range(10):
            a = 2 * math.pi * i / 10
            rr = r * ts * rnd.uniform(0.86, 1.08)
            pts.append((x + math.cos(a) * rr, y + math.sin(a) * rr * 0.92))
        P.part(pt.blob(pts), C["leaf" if (k + variant) % 2 else "leaf2"], sh=4.5, hl=1.8)
    # a few leaf-stroke accents
    for k in range(8):
        x, y = rnd.uniform(-14, 14), rnd.uniform(-60, -30)
        P.detail(lambda c, x=x, y=y: (c.move_to(x, y), c.curve_to(x + 1, y - 1.5, x + 2.5, y - 1.5, x + 3.5, y)),
                 pt.shade(C["leaf"], 0.7), width=0.8)


def rock(P, variant=0):
    rnd = random.Random(3)
    for cx, cy, r in ((0, -3.5, 7.0), (7.5, -1.5, 4.4)):
        pts = []
        for i in range(8):
            a = 2 * math.pi * i / 8
            rr = r * rnd.uniform(0.85, 1.1)
            pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr * 0.7))
        P.part(pt.blob(pts), C["rock"], sh=1.8, hl=0.8)


def tuft(P, variant=0):
    rnd = random.Random(11)
    for k in range(8):
        x = rnd.uniform(-6, 6)
        h = rnd.uniform(6.5, 11)
        lean = rnd.uniform(-2.5, 2.5)
        P.part(pt.path_cmds([("M", x - 1.0, 0), ("C", x - 0.6, -h * 0.5, x + lean * 0.6, -h * 0.8, x + lean, -h),
                             ("C", x + lean * 0.3 + 0.4, -h * 0.6, x + 0.6, -h * 0.4, x + 1.0, 0), ("Z",)]),
               C["grass"], sh=0.8, hl=0.3, lw=P.lw * 0.6)


FRAMES = {  # w, h, anchor x, anchor y (pt)
    "citygate_e": (420, 300, 210, 200), "town_e": (260, 200, 130, 130), "tower_w": (110, 170, 55, 145),
    "goldmine": (130, 90, 65, 58), "tree": (80, 110, 40, 100), "rock": (40, 24, 18, 16), "tuft": (30, 20, 15, 16),
}


def draw(kind, variant=0, k=3.0):
    w, h, ax, ay = FRAMES[kind]
    P = Painter(w, h, (ax, ay), k=k, lw=1.3 if kind in ("citygate_e", "town_e", "tower_w") else 1.2)
    fn = {"citygate_e": citygate_e, "town_e": town_e, "tower_w": tower_w, "goldmine": goldmine}.get(kind)
    if fn:
        fn(P)
    elif kind == "tree":
        tree(P, variant)
    elif kind == "rock":
        rock(P, variant)
    else:
        tuft(P, variant)
    base, mask = P.images()
    bb = base.getbbox()
    return base.crop(bb), mask.crop(bb), (P.anchor[0] - bb[0], P.anchor[1] - bb[1])
