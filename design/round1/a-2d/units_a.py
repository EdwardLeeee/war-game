"""A 彩繪桌遊: the ten unit types drawn as 2D cut-out figures (facing right).

draw(kind, anim, frame, variant, k) -> (colour RGBA, team mask RGBA, anchor px, body_top_pt)
West units and anything facing left are mirrored by the compositor.
"""
import math

import figures as F
import paint as pt
from figures import Skel, arm, head, leg
from paint import Painter, capsule, ellipse, poly

C = dict(
    skin=pt.rgb("f0c098"), lacquer=pt.rgb("3e2c2c"), gold=pt.rgb("e8b440"), tassel=pt.rgb("f4ecd8"),
    cloth=pt.rgb("3b3542"), ochre=pt.rgb("bfa06a"), hemp=pt.rgb("ead7a8"), straw=pt.rgb("dfc27e"),
    wood=pt.rgb("a86a34"), wood_dk=pt.rgb("6e4424"), dark=pt.rgb("2e2621"), steel=pt.rgb("c9d0d8"),
    steel_dk=pt.rgb("8f98a3"), leather=pt.rgb("94602f"), cream=pt.rgb("f3e2b6"), moss=pt.rgb("9c8566"), hood=pt.rgb("8a7a66"),
    rope=pt.rgb("d8c08a"), horse_bay=pt.rgb("9a5a2c"), horse_grey=pt.rgb("e2ded6"), mane=pt.rgb("3a2a20"),
    lacq_red=pt.rgb("b8322a"), robe=pt.rgb("2c2a3e"), inner=pt.rgb("f1e7cf"), crystal=pt.rgb("5af2ff"),
    stone=pt.rgb("a8a39a"), bronze=pt.rgb("c9923c"),
)


def lerp(a, b, t):
    return {k: tuple(x + (y - x) * t for x, y in zip(a.get(k, (0, 0)), b.get(k, (0, 0))))
            if isinstance(a.get(k, b.get(k)), tuple) else a.get(k, 0) + (b.get(k, 0) - a.get(k, 0)) * t
            for k in set(a) | set(b)}


def ease(t):
    return t * t * (3 - 2 * t)


def cycle(keys, t):
    """keys: list of (time, pose); piecewise eased interpolation, t in [0,1)."""
    for i in range(len(keys)):
        t0, p0 = keys[i]
        t1, p1 = keys[(i + 1) % len(keys)]
        if t1 <= t0:
            t1 += 1.0
        tt = t if t >= t0 else t + 1.0
        if t0 <= tt < t1:
            return lerp(p0, p1, ease((tt - t0) / (t1 - t0)))
    return keys[0][1]


def walk_pose(t, arms=True, stride=26):
    a = math.sin(2 * math.pi * t)
    b = math.cos(2 * math.pi * t)
    p = {"torso": 4, "lN": (stride * a, -max(0, 40 * -b) - 4), "lF": (-stride * a, -max(0, 40 * b) - 4),
         "bob": 0.6 * abs(b)}
    if arms:
        p.update({"aN": (-20 * a, 20), "aF": (20 * a, 20)})
    return p


# ------------------------------------------------------------------ helpers

def spear_line(P, sk, length, back, shaft, tip, tassel=None, tip_len=3.6, width=1.1):
    """Shaft through the near hand toward the far hand; returns (butt, point)."""
    hx, hy = sk.hN
    fx, fy = sk.hF
    ang = math.degrees(math.atan2(fy - hy, fx - hx)) if math.hypot(fx - hx, fy - hy) > 2 else 8.0
    ang = max(-6.0, min(16.0, ang))          # keep the spear lowered, near level
    dx, dy = math.cos(math.radians(ang)), math.sin(math.radians(ang))
    butt = (hx - dx * back, hy - dy * back)
    point = (hx + dx * (length - back), hy + dy * (length - back))
    P.line([butt, point], shaft, width)
    px, py = -dy, dx
    P.part(poly([point, (point[0] + dx * tip_len + px * 0.0, point[1] + dy * tip_len),
                 (point[0] + dx * 0.6 + px * 1.3, point[1] + dy * 0.6 + py * 1.3),
                 (point[0] - px * 0.2, point[1] - py * 0.2),
                 (point[0] + dx * 0.6 - px * 1.3, point[1] + dy * 0.6 - py * 1.3)]), tip, sh=0.4, hl=0.3,
           lw=P.lw * 0.8)
    if tassel:
        P.part(ellipse(point[0] - dx * 0.6, point[1] - dy * 0.6 + 1.2, 1.3, 1.7), tassel, sh=0.5, hl=0.3,
               lw=P.lw * 0.8)
    return butt, point


def east_helmet(P, sk, plume=True):
    x, y = sk.head
    r = F.HEAD_R
    P.part(pt.blob([(x - r * 1.18, y + r * 0.2), (x - r * 1.1, y - r * 0.6), (x - r * 0.3, y - r * 1.25),
                    (x + r * 0.6, y - r * 1.12), (x + r * 1.12, y - r * 0.45), (x + r * 1.0, y - r * 0.1),
                    (x - r * 0.2, y - r * 0.25), (x - r * 0.9, y + r * 0.55)]), C["lacquer"], sh=1.2, hl=0.6)
    P.part(pt.rrect(x - r * 1.15, y - r * 0.32, r * 2.25, r * 0.34, 0.4), C["gold"], sh=0.3, hl=0.2,
           lw=P.lw * 0.7)
    P.line([(x, y - r * 1.2), (x + 0.1, y - r * 1.75)], C["gold"], 0.8)
    if plume:
        P.part(pt.blob([(x - 0.3, y - r * 1.7), (x + 1.5, y - r * 2.1), (x + 0.4, y - r * 2.9),
                        (x - 1.8, y - r * 2.6), (x - 2.6, y - r * 1.9)]), C["tassel"], sh=0.8, hl=0.4)


def west_kettle(P, sk):
    x, y = sk.head
    r = F.HEAD_R
    P.part(pt.blob([(x - r * 1.75, y - r * 0.35), (x - r * 0.9, y - r * 0.62), (x - r * 0.75, y - r * 1.2),
                    (x, y - r * 1.45), (x + r * 0.8, y - r * 1.2), (x + r * 0.95, y - r * 0.62),
                    (x + r * 1.85, y - r * 0.3), (x + r * 1.7, y - r * 0.05), (x, y - r * 0.45),
                    (x - r * 1.6, y - r * 0.08)]), C["steel"], sh=1.1, hl=0.7)


def lamellar(P, sk, skirt=True, color=None):
    col = color or C["lacquer"]
    P.part(F.torso_path(sk, 6.0, 8.0), col, sh=1.8, hl=0.7)
    # lamellar rows (gold stitching)
    t = math.radians(sk.t)
    for k in range(3):
        f = 0.3 + k * 0.22
        cx = sk.hip[0] + (sk.shoulder[0] - sk.hip[0]) * f
        cy = sk.hip[1] + (sk.shoulder[1] - sk.hip[1]) * f
        P.detail(lambda c, cx=cx, cy=cy: (c.move_to(cx - 3.2 * math.cos(t), cy - 3.2 * math.sin(t)),
                                          c.line_to(cx + 3.4 * math.cos(t), cy + 3.4 * math.sin(t))),
                 C["gold"], width=0.45, alpha=0.8)
    hx, hy = sk.hip
    P.part(pt.rrect(hx - 3.4, hy - 1.9, 6.8, 1.6, 0.5), C["gold"], sh=0.3, hl=0.2, lw=P.lw * 0.7)
    if skirt:
        P.part(F.skirt_path(sk, 5.6, 1.4, 6.0), col, sh=1.4, hl=0.5)


def surcoat(P, sk, length=6.4):
    P.part(F.torso_path(sk, 6.0, 7.8), (0, 0, 0), team=True, sh=1.8, hl=0.7)
    P.part(F.skirt_path(sk, length, 1.2, 6.0), (0, 0, 0), team=True, sh=1.4, hl=0.5)
    hx, hy = sk.hip
    P.part(pt.rrect(hx - 3.3, hy - 1.8, 6.6, 1.4, 0.5), C["leather"], sh=0.3, hl=0.2, lw=P.lw * 0.7)


# ------------------------------------------------------------------ poses

SPEAR_KEYS = [
    (0.0, {"torso": 8, "aN": (38, 62), "aF": (72, 18), "lN": (22, -16), "lF": (-16, -8), "bob": 0.6}),
    (0.3, {"torso": 0, "aN": (8, 84), "aF": (56, 30), "lN": (18, -12), "lF": (-14, -6), "bob": 0.3}),
    (0.5, {"torso": 22, "aN": (72, 14), "aF": (88, 4), "lN": (32, -28), "lF": (-24, -4), "bob": 1.2, "dx": 1.2}),
]
XBOW_KEYS = [
    (0.0, {"torso": 4, "nod": 6, "aN": (78, 14), "aF": (88, 8), "lN": (16, -10), "lF": (-12, -6)}),
    (0.35, {"torso": -2, "nod": 4, "aN": (84, 14), "aF": (92, 8), "lN": (16, -10), "lF": (-12, -6)}),
    (0.5, {"torso": 26, "nod": -6, "aN": (40, 50), "aF": (30, 70), "lN": (20, -20), "lF": (-10, -10),
           "bob": 1.0}),
]
BOW_KEYS = [
    (0.0, {"torso": 2, "aN": (40, 60), "aF": (70, 20), "lN": (14, -6), "lF": (-14, -4)}),
    (0.4, {"torso": 0, "nod": 4, "aN": (94, 142), "aF": (92, 0), "lN": (14, -6), "lF": (-14, -4)}),
    (0.6, {"torso": -2, "nod": 4, "aN": (100, 110), "aF": (92, 0), "lN": (14, -6), "lF": (-14, -4)}),
]
CHOP_KEYS = [
    (0.0, {"torso": 26, "aN": (40, 6), "aF": (36, 8), "lN": (24, -20), "lF": (-12, -6), "bob": 1.2}),
    (0.5, {"torso": -8, "aN": (168, 18), "aF": (160, 22), "lN": (14, -8), "lF": (-12, -6)}),
    (0.72, {"torso": 26, "aN": (40, 6), "aF": (36, 8), "lN": (24, -20), "lF": (-12, -6), "bob": 1.2}),
]


def pose_for(kind, anim, frame):
    t = (frame % 8) / 8
    if anim == "walk":
        return walk_pose(t)
    if anim == "idle":
        base = {"torso": 1, "aN": (6, 14), "aF": (-6, 14), "lN": (4, -2), "lF": (-4, -2)}
        base["bob"] = 0.3 * math.sin(2 * math.pi * t)
        return base
    keys = {"spear_e": SPEAR_KEYS, "pike_w": SPEAR_KEYS, "xbow_e": XBOW_KEYS, "bow_w": BOW_KEYS,
            "farmer_e": CHOP_KEYS}[kind]
    return cycle(keys, t)


# ------------------------------------------------------------------ infantry

def draw_infantry(P, kind, anim, frame, variant):
    pose = pose_for(kind, anim, frame)
    sk = Skel(pose)
    F.ground_shadow(P, 7.5, 2.2)
    east = kind.endswith("_e")
    if kind == "spear_e":
        sleeve, pants, boots = C["cloth"], C["dark"], C["dark"]
    elif kind == "pike_w":
        sleeve, pants, boots = C["cream"], C["leather"], C["leather"]
    elif kind == "xbow_e":
        sleeve, pants, boots = C["ochre"], C["cloth"], C["dark"]
    elif kind == "bow_w":
        sleeve, pants, boots = C["moss"], C["leather"], C["leather"]
    else:  # farmer
        sleeve, pants, boots = C["hemp"], C["hemp"], C["straw"]
    # far side
    if kind == "bow_w":
        # quiver on the back
        sx, sy = sk.shoulder
        P.part(pt.rrect(sx - 4.2, sy - 2.2, 2.4, 8.5, 0.8), C["leather"], sh=0.6, hl=0.3)
        for k in range(3):
            P.line([(sx - 3.6 + k * 0.7, sy - 2.0), (sx - 3.4 + k * 0.7, sy - 4.2)], C["cream"], 0.6)
    if east and kind != "farmer_e":
        F.back_banner(P, sk, h=13.5 if kind == "spear_e" else 11.5, sway=0.6 * math.sin(frame))
    arm(P, sk, "F", sleeve, C["skin"])
    leg(P, sk, "F", pants, boots)
    leg(P, sk, "N", pants, boots)
    # body
    if kind == "spear_e":
        lamellar(P, sk)
    elif kind == "pike_w":
        surcoat(P, sk)
        for sd in (sk.sN,):
            P.part(ellipse(sd[0] + 0.4, sd[1] - 0.2, 2.6, 2.1), C["steel"], sh=0.8, hl=0.5)
    elif kind == "xbow_e":
        P.part(F.skirt_path(sk, 5.0, 1.2, 5.6), C["ochre"], sh=1.2, hl=0.5)
        P.part(F.torso_path(sk, 5.8, 7.6), C["lacquer"], sh=1.6, hl=0.6)
        hx, hy = sk.hip
        P.part(pt.rrect(hx - 3.2, hy - 1.8, 6.4, 1.4, 0.5), C["gold"], sh=0.3, hl=0.2, lw=P.lw * 0.7)
    elif kind == "bow_w":
        surcoat(P, sk, length=5.2)
    else:
        P.part(F.skirt_path(sk, 4.2, 1.0, 5.6), C["hemp"], sh=1.1, hl=0.5)
        P.part(F.torso_path(sk, 5.6, 7.2), C["hemp"], sh=1.6, hl=0.6)
        hx, hy = sk.hip
        P.part(pt.rrect(hx - 3.2, hy - 1.9, 6.4, 1.5, 0.5), (0, 0, 0), team=True, sh=0.3, hl=0.2)
        if variant == 1:  # ore basket on the back
            sx, sy = sk.shoulder
            P.part(pt.poly([(sx - 5.4, sy - 1), (sx - 1.6, sy - 1), (sx - 2.0, sy + 6), (sx - 5.0, sy + 6)]),
                   C["straw"], sh=0.8, hl=0.4)
            for k in range(3):
                P.part(ellipse(sx - 4.4 + k * 1.1, sy - 1.3, 0.9, 0.7), C["gold"], sh=0.2, hl=0.2, lw=0.5)
    # head and headgear
    if kind == "bow_w":
        head(P, sk, C["skin"])
        x, y = sk.head
        r = F.HEAD_R
        P.part(pt.poly([(x - r * 1.2, y - r * 0.4), (x - r * 2.7, y + r * 0.5), (x - r * 1.0, y + r * 0.4)]),
               C["hood"], sh=0.4, hl=0.2)
        P.part(pt.blob([(x - r * 1.25, y + r * 0.95), (x - r * 1.35, y - r * 0.4), (x - r * 0.6, y - r * 1.25),
                        (x + r * 0.55, y - r * 1.18), (x + r * 0.95, y - r * 0.62), (x + r * 0.2, y - r * 0.62),
                        (x - r * 0.35, y - r * 0.15), (x - r * 0.5, y + r * 0.95)]), C["hood"], sh=1.1, hl=0.5)
        # the face stays skin-coloured and visible under the hood
        P.part(ellipse(x + r * 0.32, y + r * 0.12, r * 0.62, r * 0.66), C["skin"], sh=0.5, hl=0.3, lw=P.lw * 0.7)
        P.detail(ellipse(x + r * 0.5, y + r * 0.02, r * 0.13, r * 0.19), (0.12, 0.08, 0.06), fill=True)
    elif kind == "pike_w":
        head(P, sk, C["skin"])
        west_kettle(P, sk)
    elif kind == "spear_e":
        head(P, sk, C["skin"])
        east_helmet(P, sk)
    elif kind == "xbow_e":
        head(P, sk, C["skin"])
        x, y = sk.head
        r = F.HEAD_R
        # 幞頭: soft black cap with two stiff tails
        P.part(pt.blob([(x - r * 1.05, y + r * 0.1), (x - r * 1.0, y - r * 0.7), (x - r * 0.2, y - r * 1.25),
                        (x + r * 0.7, y - r * 1.05), (x + r * 1.05, y - r * 0.35), (x - r * 0.1, y - r * 0.35)]),
               C["dark"], sh=0.9, hl=0.5)
        P.line([(x - r * 0.8, y - r * 0.6), (x - r * 2.4, y - r * 0.3)], C["dark"], 1.0)
    else:
        head(P, sk, C["skin"], hair=C["dark"])
        x, y = sk.head
        r = F.HEAD_R
        # 斗笠: the wide conical straw hat that marks the farmer
        P.part(pt.poly([(x - r * 2.2, y - r * 0.2), (x + r * 2.3, y - r * 0.35), (x + 0.2, y - r * 1.9)]),
               C["straw"], sh=1.0, hl=0.5)
        P.detail(lambda c: (c.move_to(x - r * 1.2, y - r * 0.5), c.line_to(x + 0.1, y - r * 1.7),
                            c.move_to(x + r * 1.2, y - r * 0.6), c.line_to(x + 0.1, y - r * 1.7)),
                 pt.shade(C["straw"], 0.7), width=0.5)
    # near arm and weapons
    if kind in ("spear_e", "pike_w"):
        long = kind == "pike_w"
        spear_line(P, sk, 40 if long else 33, 9 if long else 8, C["wood"] if long else C["wood_dk"], C["steel"],
                   tassel=None if long else C["tassel"], tip_len=4.2)
        arm(P, sk, "N", sleeve, C["skin"])
    elif kind == "xbow_e":
        arm(P, sk, "N", sleeve, C["skin"])
        hx, hy = sk.hN
        a = math.radians(sk.ahN - 90)
        dx, dy = math.cos(a), math.sin(a)
        if anim != "attack" or (frame % 8) < 3:
            dx, dy = 1.0, 0.05
        n = math.hypot(dx, dy)
        dx, dy = dx / n, dy / n
        s0 = (hx - dx * 4.0, hy - dy * 4.0)
        s1 = (hx + dx * 5.5, hy + dy * 5.5)
        P.line([s0, s1], C["wood"], 1.5)
        px, py = -dy, dx
        P.curve([(s1[0] - dx * 1.8 + px * 4.6, s1[1] - dy * 1.8 + py * 4.6),
                 (s1[0] + dx * 0.8 + px * 2.2, s1[1] + dy * 0.8 + py * 2.2),
                 (s1[0] + dx * 0.8 - px * 2.2, s1[1] + dy * 0.8 - py * 2.2),
                 (s1[0] - dx * 1.8 - px * 4.6, s1[1] - dy * 1.8 - py * 4.6)], C["wood_dk"], 1.1)
        P.line([(s1[0] - dx * 1.8 + px * 4.6, s1[1] - dy * 1.8 + py * 4.6), (hx + dx * 0.6, hy + dy * 0.6),
                (s1[0] - dx * 1.8 - px * 4.6, s1[1] - dy * 1.8 - py * 4.6)], C["rope"], 0.35, outline=False)
    elif kind == "bow_w":
        fx, fy = sk.hF
        P.curve([(fx - 1.6, fy - 10.5), (fx + 3.4, fy - 6.0), (fx + 3.4, fy + 6.0), (fx - 1.6, fy + 10.5)],
                C["wood"], 1.0)
        hx, hy = sk.hN
        P.line([(fx - 1.6, fy - 10.5), (hx, hy), (fx - 1.6, fy + 10.5)], C["cream"], 0.3, outline=False)
        arm(P, sk, "N", sleeve, C["skin"])
        if (frame % 8) < 5:
            P.line([(hx - 0.5, hy), (fx + 3.5, fy)], C["wood_dk"], 0.5)
    else:
        arm(P, sk, "N", sleeve, C["skin"])
        # tool continues the forearms: axe (variant 0) or pickaxe (1)
        hx, hy = sk.hN
        a = math.radians(sk.ahN)
        dx, dy = math.sin(a), math.cos(a)
        end = (hx + dx * 8.5, hy + dy * 8.5)
        P.line([(hx - dx * 1.5, hy - dy * 1.5), end], C["wood"], 1.0)
        px, py = -dy, dx
        if variant == 0:
            P.part(poly([(end[0] - dx * 2.2 + px * 0.4, end[1] - dy * 2.2 + py * 0.4),
                         (end[0] + px * 3.2 - dx * 3.2, end[1] + py * 3.2 - dy * 3.2),
                         (end[0] + px * 3.4 + dx * 0.8, end[1] + py * 3.4 + dy * 0.8),
                         (end[0] + dx * 0.4, end[1] + dy * 0.4)]), C["steel"], sh=0.5, hl=0.3)
        else:
            P.curve([(end[0] + px * 4.2 - dx * 1.6, end[1] + py * 4.2 - dy * 1.6),
                     (end[0] + px * 1.5, end[1] + py * 1.5), (end[0] - px * 1.5, end[1] - py * 1.5),
                     (end[0] - px * 4.2 - dx * 1.6, end[1] - py * 4.2 - dy * 1.6)], C["steel"], 1.1)
    return sk


# ------------------------------------------------------------------ cavalry

def horse(P, t, coat, barding=None, caparison=False, gallop=True):
    """Horse in side view facing right; returns the saddle point (pt)."""
    a = math.sin(2 * math.pi * t)
    b = math.sin(2 * math.pi * t + 1.3)
    bob = 1.0 * abs(a) if gallop else 0
    by = -19.0 + bob
    far = pt.shade(coat, 0.8)

    def leg4(x, sgn, ph, back, colr):
        up = 30 * ph if not back else -26 * ph
        k = (x + math.sin(math.radians(up)) * 6.4, by + 4.2 + math.cos(math.radians(up)) * 6.4)
        low = up + (-50 * max(0, -ph) if not back else 40 * max(0, ph))
        f = (k[0] + math.sin(math.radians(low)) * 6.8, k[1] + math.cos(math.radians(low)) * 6.8)
        P.part(capsule((x, by + 3.0), k, 2.3, 1.5), colr, sh=0.8, hl=0.3)
        P.part(capsule(k, f, 1.4, 1.1), colr, sh=0.5, hl=0.2)
        P.part(pt.rrect(f[0] - 1.4, f[1] - 0.4, 2.8, 1.6, 0.5), C["mane"], sh=0.2, hl=0.1, lw=P.lw * 0.8)

    # far legs
    leg4(7.5, 1, b if gallop else 0.1, False, far)
    leg4(-8.0, 1, a if gallop else -0.1, True, far)
    # tail
    P.part(pt.blob([(-11.5, by - 2.0), (-16.5, by + 1.0), (-17.5, by + 8.5), (-15.0, by + 6.0),
                    (-12.5, by + 1.5)]), C["mane"], sh=0.8, hl=0.4)
    # body
    P.part(pt.blob([(-12.5, by - 2.0), (-6.0, by - 5.2), (6.0, by - 5.4), (12.5, by - 3.0), (13.2, by + 2.6),
                    (6.0, by + 5.6), (-6.0, by + 5.4), (-12.8, by + 2.8)]), coat, sh=2.2, hl=1.0)
    # neck and head
    P.part(pt.blob([(8.5, by - 3.5), (13.5, by - 12.0), (17.0, by - 15.0), (19.0, by - 12.6), (15.0, by - 3.0),
                    (12.5, by + 1.0)]), coat, sh=1.6, hl=0.8)
    P.part(pt.blob([(14.8, by - 17.6), (19.6, by - 17.4), (26.2, by - 11.6), (25.6, by - 8.6), (22.4, by - 8.2),
                    (18.6, by - 10.4), (15.2, by - 12.2)]), coat, sh=1.2, hl=0.6)
    P.detail(ellipse(24.4, by - 9.6, 0.5, 0.4), (0.1, 0.07, 0.05), fill=True)
    P.part(pt.poly([(16.2, by - 16.0), (16.8, by - 19.2), (18.2, by - 16.2)]), coat, sh=0.4, hl=0.2)
    P.detail(ellipse(19.2, by - 14.2, 0.55, 0.7), (0.1, 0.07, 0.05), fill=True)
    P.part(pt.blob([(9.0, by - 6.0), (13.2, by - 13.0), (16.2, by - 16.6), (14.6, by - 12.0), (10.8, by - 4.0)]),
           C["mane"], sh=0.5, hl=0.3)
    if barding:
        barding(P, by)
    if caparison:
        P.part(pt.blob([(-13.2, by - 2.6), (-6.0, by - 6.0), (6.0, by - 6.2), (13.6, by - 3.2), (14.2, by + 3.4),
                        (13.8, by + 9.2), (5.0, by + 10.4), (-5.0, by + 10.2), (-13.8, by + 9.0),
                        (-13.9, by + 3.0)]), (0, 0, 0), team=True, sh=2.2, hl=0.9)
        P.part(pt.blob([(9.0, by - 4.0), (13.4, by - 12.6), (17.0, by - 15.6), (19.6, by - 12.8),
                        (15.6, by - 2.0)]), (0, 0, 0), team=True, sh=1.2, hl=0.6)
        P.emblem("twintowers", -1.0, by + 3.0, 9.0)
        # dagged hem
        for k in range(7):
            x0 = -13.0 + k * 3.9
            P.part(pt.poly([(x0, by + 9.0), (x0 + 3.9, by + 9.0), (x0 + 1.95, by + 11.4)]), (0, 0, 0), team=True,
                   sh=0.4, hl=0.2, lw=P.lw * 0.7)
    # near legs
    leg4(9.5, 1, a if gallop else -0.1, False, coat)
    leg4(-6.5, 1, b if gallop else 0.1, True, coat)
    return (0.5, by - 5.2)


def east_barding(P, by):
    lac = C["lacquer"]
    P.part(pt.blob([(-13.4, by - 2.6), (-6.0, by - 6.2), (6.0, by - 6.4), (13.2, by - 3.6), (14.0, by + 2.8),
                    (13.2, by + 7.6), (5.0, by + 8.6), (-5.0, by + 8.4), (-13.6, by + 7.4)]), lac, sh=2.2, hl=0.8)
    for k in range(3):
        y = by - 1.5 + k * 3.2
        P.detail(lambda c, y=y: (c.move_to(-12.5, y), c.line_to(13.0, y - 0.6)), C["gold"], width=0.45, alpha=0.8)
    # player colour: rear drape, saddle cloth and a fringed skirt below the lacquer
    P.part(pt.blob([(-13.6, by - 2.2), (-8.0, by - 5.8), (-4.2, by - 5.6), (-4.6, by + 3.0), (-9.0, by + 7.2),
                    (-13.8, by + 6.6)]), (0, 0, 0), team=True, sh=1.4, hl=0.6)
    P.part(pt.rrect(-4.0, by - 6.6, 8.6, 6.0, 1.2), (0, 0, 0), team=True, sh=1.0, hl=0.5)
    P.part(pt.blob([(-13.8, by + 5.6), (0.0, by + 6.4), (14.0, by + 5.4), (14.2, by + 10.4), (0.0, by + 11.2),
                    (-14.0, by + 10.4)]), (0, 0, 0), team=True, sh=1.2, hl=0.5)
    for k in range(9):
        x0 = -13.6 + k * 3.1
        P.part(pt.poly([(x0, by + 10.0), (x0 + 3.1, by + 10.2), (x0 + 1.55, by + 13.4)]), (0, 0, 0), team=True,
               sh=0.4, hl=0.2, lw=P.lw * 0.7)
    P.part(pt.rrect(-13.6, by + 5.0, 27.8, 1.3, 0.5), C["gold"], sh=0.2, hl=0.2, lw=P.lw * 0.7)
    P.part(pt.blob([(8.5, by - 4.2), (13.4, by - 12.4), (16.8, by - 15.4), (19.2, by - 12.8), (15.2, by - 2.6),
                    (11.8, by + 1.0)]), lac, sh=1.4, hl=0.6)
    P.part(pt.blob([(15.4, by - 17.8), (20.0, by - 17.6), (25.4, by - 12.0), (21.0, by - 10.6), (15.8, by - 12.6)]),
           C["gold"], sh=0.7, hl=0.4)
    P.part(ellipse(16.4, by - 18.4, 1.6, 2.2, -20), (0, 0, 0), team=True, sh=0.5, hl=0.3)


def draw_cav(P, kind, anim, frame):
    east = kind == "hcav_e"
    t = (frame % 8) / 8
    F.ground_shadow(P, 17, 3.2, dx=2.0)
    saddle = horse(P, t, C["horse_bay"] if east else C["horse_grey"], barding=east_barding if east else None,
                   caparison=not east, gallop=anim in ("walk", "attack"))
    sx, sy = saddle
    pose = {"torso": 8 + 3 * math.sin(2 * math.pi * t), "nod": 4, "aN": (46, 58), "aF": (40, 60),
            "lN": (72, -86), "lF": (70, -80), "dx": sx}
    sk = Skel(pose, hip_h=-sy)
    sleeve = C["cloth"] if east else C["steel_dk"]
    if east:
        F.back_banner(P, sk, h=14.5, sway=0.6 * math.sin(frame))
    arm(P, sk, "F", sleeve, C["skin"])
    leg(P, sk, "N", C["dark"] if east else C["steel_dk"], C["dark"] if east else C["steel"])
    if east:
        lamellar(P, sk, skirt=False)
    else:
        surcoat(P, sk, length=3.6)
    head(P, sk, C["skin"])
    x, y = sk.head
    r = F.HEAD_R
    if east:
        east_helmet(P, sk)
    else:
        # great helm with an eye slit and a player-coloured crest
        P.part(pt.rrect(x - r * 1.0, y - r * 1.12, r * 2.05, r * 1.95, 1.3), C["steel"], sh=1.1, hl=0.6)
        P.detail(lambda c: (c.move_to(x - r * 0.1, y - r * 0.15), c.line_to(x + r * 1.1, y - r * 0.15)),
                 pt.OUTLINE, width=0.8)
        P.part(ellipse(x - r * 0.1, y - r * 1.3, r * 0.8, r * 0.4), (0, 0, 0), team=True, sh=0.4, hl=0.2)
    # lance, lowered forward
    hx, hy = sk.hN
    length = 36
    tip = (hx + length * 0.8, hy + 3.0)
    butt = (hx - length * 0.2, hy - 1.6)
    P.line([butt, tip], C["wood_dk"] if east else C["cream"], 1.2)
    if not east:
        # player-coloured spiral band shown as two stripes near the grip
        for k in range(3):
            u = 0.28 + k * 0.1
            p0 = (butt[0] + (tip[0] - butt[0]) * u, butt[1] + (tip[1] - butt[1]) * u)
            P.part(ellipse(p0[0], p0[1], 1.0, 0.9), (0, 0, 0), team=True, sh=0.2, hl=0.1, lw=0.4)
    P.part(poly([tip, (tip[0] + 4.0, tip[1] + 0.35), (tip[0] + 0.5, tip[1] + 1.2)]), C["steel"], sh=0.3, hl=0.2,
           lw=P.lw * 0.8)
    if east:
        P.part(ellipse(tip[0] - 1.2, tip[1] + 1.2, 1.2, 1.6), C["tassel"], sh=0.4, hl=0.3, lw=0.6)
    arm(P, sk, "N", sleeve, C["skin"])
    if not east:
        # heater shield on the near side with the twin towers
        ex, ey = sk.sN
        P.part(pt.path_cmds([("M", ex - 3.6, ey + 0.4), ("L", ex + 3.6, ey + 0.4), ("L", ex + 3.6, ey + 4.2),
                             ("C", ex + 3.4, ey + 7.4, ex + 1.0, ey + 8.8, ex, ey + 9.6),
                             ("C", ex - 1.0, ey + 8.8, ex - 3.4, ey + 7.4, ex - 3.6, ey + 4.2), ("Z",)]),
               (0, 0, 0), team=True, sh=1.2, hl=0.5)
        P.emblem("twintowers", ex, ey + 4.2, 5.8)
    return sk


# ------------------------------------------------------------------ siege

def wheel(P, x, y, r, col):
    P.part(ellipse(x, y, r, r), col, sh=0.9, hl=0.4)
    P.part(ellipse(x, y, r * 0.3, r * 0.3), C["bronze"], sh=0.3, hl=0.2, lw=P.lw * 0.7)
    for k in range(4):
        a = k * math.pi / 4
        P.detail(lambda c, a=a: (c.move_to(x + math.cos(a) * r * 0.3, y + math.sin(a) * r * 0.3),
                                 c.line_to(x + math.cos(a) * r * 0.9, y + math.sin(a) * r * 0.9),
                                 c.move_to(x - math.cos(a) * r * 0.3, y - math.sin(a) * r * 0.3),
                                 c.line_to(x - math.cos(a) * r * 0.9, y - math.sin(a) * r * 0.9)),
                 pt.shade(col, 0.6), width=0.6)


def draw_siege_e(P, anim, frame):
    """霹靂車: tall red trestle, long throwing arm, hauling ropes, banner."""
    t = (frame % 8) / 8
    if anim == "attack":
        ang = 55 - 150 * ease(min(1, t / 0.5)) if t < 0.5 else -95 + 150 * ease((t - 0.5) / 0.5)
    else:
        ang = 55
    F.ground_shadow(P, 20, 4.0, dx=3.0)
    wheel(P, -9.0, -4.6, 4.6, pt.shade(C["wood_dk"], 0.85))
    wheel(P, 9.0, -4.6, 4.6, pt.shade(C["wood_dk"], 0.85))
    P.part(pt.rrect(-14.0, -8.6, 28.0, 2.6, 0.8), C["wood"], sh=0.8, hl=0.4)
    pv = (0.0, -44.0)
    for x0, x1 in ((-11.0, -1.2), (11.0, 1.2)):
        P.part(capsule((x0, -8.0), (x1, pv[1] + 1.0), 1.4, 1.1), C["wood_dk"], sh=0.8, hl=0.4)
        for u in (0.25, 0.55, 0.85):     # bronze hoops
            bx, by_ = x0 + (x1 - x0) * u, -8.0 + (pv[1] + 9.0) * u
            P.part(pt.rrect(bx - 1.7, by_ - 0.6, 3.4, 1.2, 0.4), C["bronze"], sh=0.3, hl=0.2, lw=P.lw * 0.7)
    P.part(capsule((-6.5, -24.0), (6.5, -24.0), 0.9), C["wood"], sh=0.4, hl=0.2)
    # arm: long end (sling) and short end (ropes)
    a = math.radians(ang)
    long_end = (pv[0] - math.cos(a) * 30.0, pv[1] + math.sin(a) * 30.0)
    short_end = (pv[0] + math.cos(a) * 12.0, pv[1] - math.sin(a) * 12.0)
    P.part(capsule(short_end, long_end, 1.5, 0.9), C["wood_dk"], sh=0.7, hl=0.3)
    for k in range(4):
        P.line([short_end, (short_end[0] + 4 + k * 2.2, -1.0)], C["rope"], 0.55)
    sl = (long_end[0] - 1.0, long_end[1] + 7.0)
    P.line([long_end, sl], C["rope"], 0.5)
    P.part(ellipse(sl[0], sl[1] + 1.2, 1.8, 1.8), C["stone"], sh=0.6, hl=0.3)
    P.part(ellipse(*pv, 1.6, 1.6), C["bronze"], sh=0.4, hl=0.3)
    # banner on a pole at the rear
    P.line([(-13.0, -8.0), (-13.0, -46.0)], C["wood_dk"], 0.8)
    P.part(pt.poly([(-13.0, -45.5), (-20.0, -44.6), (-19.6, -35.6), (-13.0, -36.4)]), (0, 0, 0), team=True,
           sh=1.0, hl=0.4)
    P.emblem("crane", -16.4, -40.6, 6.4)


def draw_siege_w(P, anim, frame):
    """投石機: low wheeled frame, spoon arm, winch, banner."""
    t = (frame % 8) / 8
    if anim == "attack":
        ang = 70 - 80 * ease(min(1, t / 0.35)) if t < 0.35 else -10 + 80 * ease((t - 0.35) / 0.65)
    else:
        ang = 70
    F.ground_shadow(P, 16, 3.4, dx=2.4)
    wheel(P, -8.0, -4.0, 4.0, pt.shade(C["wood_dk"], 0.85))
    wheel(P, 8.0, -4.0, 4.0, pt.shade(C["wood_dk"], 0.85))
    P.part(pt.rrect(-13.0, -9.0, 26.0, 3.6, 0.8), C["wood"], sh=0.9, hl=0.4)
    P.part(pt.rrect(-13.0, -8.4, 26.0, 1.0, 0.3), C["steel_dk"], sh=0.2, hl=0.1, lw=P.lw * 0.7)
    P.part(capsule((5.0, -8.0), (5.0, -25.0), 1.3), C["wood"], sh=0.6, hl=0.3)
    P.part(capsule((-4.0, -8.0), (4.6, -23.0), 1.0), C["wood"], sh=0.5, hl=0.3)
    P.part(pt.rrect(2.5, -27.0, 6.0, 3.2, 1.0), C["leather"], sh=0.6, hl=0.3)
    P.part(ellipse(-9.0, -11.5, 2.4, 2.4), C["wood_dk"], sh=0.6, hl=0.3)
    pv = (-8.0, -11.0)
    a = math.radians(ang)
    end = (pv[0] - math.sin(a) * 22.0, pv[1] - math.cos(a) * 22.0)
    P.part(capsule(pv, end, 1.4, 1.1), C["wood_dk"], sh=0.6, hl=0.3)
    P.part(ellipse(end[0], end[1] - 1.2, 3.0, 2.0), C["wood_dk"], sh=0.6, hl=0.3)
    P.part(ellipse(end[0], end[1] - 2.2, 1.8, 1.6), C["stone"], sh=0.5, hl=0.3)
    P.line([(-12.0, -9.0), (-12.0, -36.0)], C["wood_dk"], 0.8)
    P.part(pt.poly([(-12.0, -35.5), (-19.0, -35.5), (-19.0, -27.0), (-15.5, -29.0), (-12.0, -27.0)]), (0, 0, 0),
           team=True, sh=1.0, hl=0.4)
    P.emblem("twintowers", -15.5, -31.5, 5.6)


# ------------------------------------------------------------------ entry

FRAMES = {  # (w, h, anchor x, anchor y) in pt, generous; sprites are cropped afterwards
    "infantry": (80, 70, 36, 58), "cav": (90, 80, 40, 66), "siege": (80, 80, 40, 70),
}
BODY_TOP = {}


def draw(kind, anim, frame, variant=0, k=3.0):
    import mage_a
    if kind == "mage_e":
        return mage_a.draw_scene_frame(anim, frame, k)
    group = "cav" if kind in ("hcav_e", "knight_w") else "siege" if kind.startswith("siege") else "infantry"
    w, h, ax, ay = FRAMES[group]
    P = Painter(w, h, (ax, ay), k=k)
    top = None
    if group == "infantry":
        sk = draw_infantry(P, kind, anim, frame, variant)
        top = -(sk.head[1] - F.HEAD_R * (1.9 if kind in ("spear_e",) else 1.45 if kind == "pike_w" else 1.2))
    elif group == "cav":
        sk = draw_cav(P, kind, anim, frame)
        top = -(sk.head[1] - F.HEAD_R * (1.9 if kind == "hcav_e" else 1.6))
    elif kind == "siege_e":
        draw_siege_e(P, anim, frame)
        top = 45.0
    else:
        draw_siege_w(P, anim, frame)
        top = 27.0
    base, mask = P.images()
    return crop(base, mask, P.anchor, top)


def crop(base, mask, anchor, top):
    bb = base.getbbox()
    base = base.crop(bb)
    mask = mask.crop(bb)
    return base, mask, (anchor[0] - bb[0], anchor[1] - bb[1]), top
