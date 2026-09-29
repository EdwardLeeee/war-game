"""A 彩繪桌遊: the 術士 (East mage) — full action set in one direction, drawn in 2D.

Frames follow gif.MAGE_FRAMES: idle 12, walk 12, cast 30 (raise 0-5, calibrate 6-23 = 1.5 s,
fire 24-29), hit 6, shatter 8, fall 12, dead 4. Effects (shield, sigils, bolt, shards,
dropped crystals) are painted on the colour layer only, never on the team mask.
"""
import json
import math
import random
from pathlib import Path

import cairo

import figures as F
import paint as pt
from figures import Skel, arm, head
from paint import Painter, capsule, ellipse, poly
from units_a import C, cycle, ease, lerp

CRY = (0.35, 0.95, 1.0)
WARM = (1.0, 0.98, 0.9)
MAGE_FRAMES = [("idle", 12), ("walk", 12), ("cast", 30), ("hit", 6), ("shatter", 8), ("fall", 12), ("dead", 4)]


def cast_pose(e):
    rest = {"torso": 1, "aN": (8, 20), "aF": (-4, 22), "lN": (4, -2), "lF": (-4, -2), "nod": 0}
    up = {"torso": -4, "nod": -4, "aN": (86, 4), "aF": (46, 104), "lN": (16, -8), "lF": (-12, -4)}
    return lerp(rest, up, e)


def pose_for(anim, f):
    if anim == "idle":
        s = math.sin(2 * math.pi * f / 12)
        return {"torso": 1 + s, "aN": (8 + 2 * s, 22), "aF": (-4, 24), "lN": (4, -2), "lF": (-4, -2), "bob": 0.3 * s}
    if anim == "walk":
        t = f / 12
        a = math.sin(2 * math.pi * t)
        b = math.cos(2 * math.pi * t)
        return {"torso": 4, "aN": (-16 * a, 26), "aF": (16 * a, 26), "lN": (22 * a, -max(0, 34 * -b) - 4),
                "lF": (-22 * a, -max(0, 34 * b) - 4), "bob": 0.6 * abs(b)}
    if anim == "cast":
        if f < 6:
            return cast_pose(ease(f / 6))
        p = cast_pose(1.0)
        if f >= 24:
            e = (f - 24) / 6
            recoil = math.sin(min(1, e * 2) * math.pi) * (1 - e)
            p = lerp(p, {"torso": -12, "nod": -8, "aN": (92, 0), "aF": (46, 104), "lN": (16, -8), "lF": (-12, -4)},
                     recoil)
            if e > 0.5:
                p = lerp(p, cast_pose(0.3), (e - 0.5) * 1.2)
        return p
    if anim == "hit":
        k = [1.0, 0.4, 0.1, 1.0, 0.45, 0.15][f]
        p = pose_for("idle", 2)
        p["torso"] = -6 * k
        p["nod"] = -8 * k
        p["dx"] = -0.6 * k
        return p
    if anim == "shatter":
        e = f / 7
        return {"torso": -10 + 6 * e, "nod": -10, "aN": (60, 90), "aF": (70, 80), "lN": (8, -6), "lF": (-10, -4),
                "dx": -1.0}
    # fall / dead
    tt = 1.0 if anim == "dead" else f / 11
    k = ease(min(1, tt * 1.6))
    return {"torso": -6 * k, "nod": -14 * k, "aN": (30 - 40 * tt, 20), "aF": (20 + 60 * tt, 30),
            "lN": (40 * k * (1 - tt) + 10 * tt, -60 * k * (1 - tt)), "lF": (30 * k * (1 - tt), -70 * k * (1 - tt)),
            "bob": 3.5 * k * (1 - tt)}


def draw_body(P, sk, anim, f):
    # ribbons trailing from the crown (behind everything)
    x, y = sk.head
    r = F.HEAD_R
    sway = math.sin(f * 0.8) * 1.2
    for dy, ln in ((0, 11), (1.6, 9)):
        P.part(pt.blob([(x - r * 0.6, y - r * 1.0 + dy), (x - r * 0.9 - ln * 0.5, y - r * 0.3 + dy + sway * 0.5),
                        (x - r * 0.9 - ln, y + r * 1.2 + dy + sway), (x - r * 0.9 - ln + 1.4, y + r * 1.5 + dy + sway),
                        (x - r * 0.9 - ln * 0.4, y + dy), (x - r * 0.4, y - r * 0.5 + dy)]), (0, 0, 0), team=True,
               sh=0.5, hl=0.3, lw=P.lw * 0.8)
    arm(P, sk, "F", C["robe"], C["skin"])
    # wide far sleeve
    ex, ey = sk.eF
    hx, hy = sk.hF
    P.part(pt.blob([(ex, ey - 1.0), (hx + 0.8, hy - 1.2), (hx + 2.4, hy + 2.6), (hx - 1.4, hy + 3.6),
                    (ex - 1.8, ey + 1.6)]), pt.shade(C["robe"], 0.85), sh=0.8, hl=0.3)
    # feet peeking under the hem
    for side in ("F", "N"):
        a = getattr(sk, "an" + side)
        col = C["dark"] if side == "N" else pt.shade(C["dark"], 0.8)
        P.part(pt.blob([(a[0] - 1.4, a[1] - 1.0), (a[0] + 1.4, a[1] - 1.2), (a[0] + 3.2, a[1] - 0.1),
                        (a[0] + 3.0, a[1] + 0.8), (a[0] - 1.4, a[1] + 0.8)]), col, sh=0.4, hl=0.2)
    # long robe: from the shoulders, flaring to the ground, following the legs a little
    hx0, hy0 = sk.hip
    sx, sy = sk.shoulder
    kN, kF = sk.kN, sk.kF
    lean = (sk.anN[0] + sk.anF[0]) / 2
    ground = max(sk.anN[1], sk.anF[1]) - 1.2
    front = max(kN[0], kF[0]) + 3.8
    back = min(kN[0], kF[0]) - 4.2
    robe = pt.blob([(sx - 3.6, sy - 0.4), (sx + 3.2, sy - 0.2), (hx0 + 3.6, hy0 - 0.5), (front, (hy0 + ground) / 2),
                    (lean + 6.6, ground), (lean, ground + 0.8), (lean - 6.8, ground),
                    (back, (hy0 + ground) / 2), (hx0 - 3.9, hy0 - 0.5)])
    P.part(robe, C["robe"], sh=2.4, hl=0.8)
    # team hem band and sash
    P.part(pt.blob([(lean + 6.8, ground - 2.0), (lean + 6.6, ground), (lean, ground + 0.8), (lean - 6.8, ground),
                    (lean - 6.9, ground - 2.0), (lean, ground - 1.2)]), (0, 0, 0), team=True, sh=0.6, hl=0.3,
           lw=P.lw * 0.8)
    P.part(pt.rrect(hx0 - 4.0, hy0 - 2.6, 8.0, 2.2, 0.8), (0, 0, 0), team=True, sh=0.5, hl=0.3)
    P.part(pt.poly([(hx0 + 1.8, hy0 - 1.0), (hx0 + 3.6, hy0 - 1.0), (hx0 + 3.2 + sway * 0.3, hy0 + 6.5),
                    (hx0 + 1.4 + sway * 0.3, hy0 + 6.0)]), (0, 0, 0), team=True, sh=0.4, hl=0.2, lw=P.lw * 0.8)
    # white inner collar (V)
    P.part(pt.poly([(sx - 0.2, sy - 0.6), (sx + 2.4, sy - 0.4), (sx + 0.9, sy + 4.4)]), C["inner"], sh=0.3, hl=0,
           lw=P.lw * 0.7)
    # crystal pouch
    P.part(pt.rrect(hx0 - 4.6, hy0 - 1.6, 2.4, 2.8, 0.7), C["leather"], sh=0.4, hl=0.2, lw=P.lw * 0.8)
    P.part(poly([(hx0 - 3.4, hy0 - 3.4), (hx0 - 2.6, hy0 - 1.8), (hx0 - 3.4, hy0 - 0.8), (hx0 - 4.2, hy0 - 1.8)]),
           C["crystal"], sh=0.2, hl=0.3, lw=0.5)
    # head, hair knot, lotus crown with a crystal
    head(P, sk, C["skin"], hair=C["dark"])
    P.part(ellipse(x - r * 0.25, y - r * 1.05, r * 0.5, r * 0.42), C["dark"], sh=0.4, hl=0.3)
    P.part(pt.poly([(x - r * 0.8, y - r * 1.15), (x + r * 0.35, y - r * 1.15), (x + r * 0.2, y - r * 1.75),
                    (x - r * 0.25, y - r * 1.4), (x - r * 0.65, y - r * 1.75)]), C["gold"], sh=0.4, hl=0.2,
           lw=P.lw * 0.8)
    P.part(poly([(x - r * 0.22, y - r * 2.15), (x + r * 0.08, y - r * 1.62), (x - r * 0.22, y - r * 1.3),
                 (x - r * 0.52, y - r * 1.62)]), C["crystal"], sh=0.2, hl=0.3, lw=0.5)
    # near arm with a wide sleeve, holding the 法印 (bronze seal with a glowing face)
    arm(P, sk, "N", C["robe"], C["skin"])
    ex, ey = sk.eN
    hx, hy = sk.hN
    P.part(pt.blob([(ex, ey - 1.2), (hx - 0.6, hy - 1.4), (hx + 0.4, hy + 2.2), (hx - 3.2, hy + 3.8),
                    (ex - 1.6, ey + 1.8)]), C["robe"], sh=0.8, hl=0.3)
    a = math.radians(sk.ahN - 90)
    dx, dy = math.cos(a), math.sin(a)
    cx, cy = hx + dx * 2.0, hy + dy * 2.0
    P.save()
    P.translate(cx, cy)
    P.rotate(math.degrees(a))
    P.part(pt.rrect(-1.6, -1.8, 3.4, 3.6, 0.5), C["bronze"], sh=0.6, hl=0.3, lw=P.lw * 0.8)
    P.part(pt.rrect(1.5, -1.5, 0.8, 3.0, 0.2), C["crystal"], sh=0, hl=0.2, lw=P.lw * 0.6)
    P.restore()
    return (cx + dx * 1.8, cy + dy * 1.8)


BOLD = {"on": False}


def fx_shield(P, sk, alpha=1.0, flash=0.0):
    cx, cy = sk.hip[0] + 0.5, -16.0
    if BOLD["on"]:
        flash = max(flash, 0.35)

    def f(c):
        c.save()
        c.translate(cx, cy)
        c.scale(12.0, 17.5)
        c.arc(0, 0, 1, 0, 2 * math.pi)
        c.restore()
        g = cairo.RadialGradient(cx - 3, cy - 5, 2, cx, cy, 17.5)
        g.add_color_stop_rgba(0, *CRY, (0.06 + 0.35 * flash) * alpha)
        g.add_color_stop_rgba(0.75, *CRY, (0.12 + 0.35 * flash) * alpha)
        g.add_color_stop_rgba(1, *CRY, (0.45 + 0.4 * flash) * alpha)
        c.set_source(g)
        c.fill_preserve()
        c.set_source_rgba(*pt.OUTLINE, 0.55 * alpha)
        c.set_line_width(1.9 if BOLD["on"] else 1.4)
        c.stroke_preserve()
        c.set_source_rgba(*pt.tint(CRY, 0.4 + 0.4 * flash), (0.95) * alpha)
        c.set_line_width(1.1 if BOLD["on"] else 0.9)
        c.stroke()
        # hexagon lattice clipped to the bubble
        c.save()
        c.translate(cx, cy)
        c.scale(12.0, 17.5)
        c.arc(0, 0, 0.98, 0, 2 * math.pi)
        c.restore()
        c.clip()
        s = 3.2
        c.set_source_rgba(*CRY, (0.35 + 0.5 * flash) * alpha)
        c.set_line_width(0.35)
        for j in range(-7, 8):
            for i in range(-5, 6):
                hx = cx + i * s * 1.5
                hy = cy + j * s * 0.866 * 2 + (s * 0.866 if i % 2 else 0)
                for k in range(6):
                    a0, a1 = math.pi / 3 * k, math.pi / 3 * (k + 1)
                    c.move_to(hx + s * math.cos(a0), hy + s * math.sin(a0))
                    c.line_to(hx + s * math.cos(a1), hy + s * math.sin(a1))
        c.stroke()
        c.reset_clip()
        # specular glint
        c.set_source_rgba(1, 1, 1, 0.55 * alpha)
        c.set_line_width(1.0)
        c.arc(cx - 3.5, cy - 7.0, 6.0, math.radians(200), math.radians(250))
        c.stroke()
    P.raw(f)


def glow_disc(c, x, y, r, col, a):
    g = cairo.RadialGradient(x, y, 0, x, y, r)
    g.add_color_stop_rgba(0, 1, 1, 1, a)
    g.add_color_stop_rgba(0.35, *col, a * 0.8)
    g.add_color_stop_rgba(1, *col, 0)
    c.set_source(g)
    c.arc(x, y, r, 0, 2 * math.pi)
    c.fill()


def fx_sigil(P, at, scale, spin, strength=1.0):
    """Front sigil, facing the camera (a circle), rings + runes + hexagram."""
    x, y = at[0] + 4.0 * scale, at[1]
    R = 7.5 * scale

    def f(c):
        glow_disc(c, x, y, R * 1.6, CRY, 0.35 * strength)
        c.set_line_width(0.9)
        for rr, a in ((R, 0.95), (R * 0.78, 0.8), (R * 0.45, 0.8)):
            c.set_source_rgba(*pt.tint(CRY, 0.3), a * strength)
            c.arc(x, y, rr, 0, 2 * math.pi)
            c.stroke()
        c.set_line_width(0.6)
        for k in range(12):
            a = spin + 2 * math.pi * k / 12
            c.move_to(x + R * 0.8 * math.cos(a), y + R * 0.8 * math.sin(a))
            c.line_to(x + R * 0.97 * math.cos(a), y + R * 0.97 * math.sin(a))
        c.stroke()
        for k in range(2):
            c.move_to(x + R * 0.74 * math.cos(-spin + k * math.pi / 3 + math.pi / 2),
                      y + R * 0.74 * math.sin(-spin + k * math.pi / 3 + math.pi / 2))
            for j in range(1, 4):
                a = -spin + k * math.pi / 3 + math.pi / 2 + j * 2 * math.pi / 3
                c.line_to(x + R * 0.74 * math.cos(a), y + R * 0.74 * math.sin(a))
            c.close_path()
        c.stroke()
    P.raw(f)


def fx_ground_sigil(P, cx, scale, spin, strength=1.0):
    def f(c):
        c.save()
        c.translate(cx, 0.2)
        c.scale(1, 0.5)
        R = 15.0 * scale
        c.set_source_rgba(*CRY, 0.9 * strength)
        c.set_line_width(1.4)
        c.arc(0, 0, R, 0, 2 * math.pi)
        c.stroke()
        c.set_line_width(0.7)
        c.arc(0, 0, R * 0.82, 0, 2 * math.pi)
        c.stroke()
        for k in range(8):
            a = spin + 2 * math.pi * k / 8
            c.move_to(R * 0.82 * math.cos(a), R * 0.82 * math.sin(a))
            c.line_to(R * math.cos(a + 0.12), R * math.sin(a + 0.12))
        c.stroke()
        c.restore()
    P.raw(f)


def fx_bolt(P, at, dist, size=1.0):
    x, y = at[0] + dist, at[1] - dist * 0.05

    def f(c):
        for k in range(10):
            u = k / 10
            glow_disc(c, x - dist * (1 - u) * 0.6, y + dist * 0.03 * (1 - u), 3.0 * size * (0.4 + 0.6 * u), CRY,
                      0.25 * u)
        glow_disc(c, x, y, 9 * size, CRY, 0.9)
        c.move_to(x + 7 * size, y)
        c.line_to(x, y - 2.2 * size)
        c.line_to(x - 5 * size, y)
        c.line_to(x, y + 2.2 * size)
        c.close_path()
        c.set_source_rgba(*pt.tint(CRY, 0.5), 1)
        c.fill_preserve()
        c.set_source_rgba(*pt.OUTLINE, 0.9)
        c.set_line_width(0.6)
        c.stroke()
    P.raw(f)


def fx_sparks(P, at, e):
    rnd = random.Random(3)

    def f(c):
        for k in range(10):
            ph = (e * 3 + k / 10) % 1.0
            rad = 14 * (1 - ph)
            ang = k * 2.4 + ph * 5
            x = at[0] + 4 + rad * math.cos(ang)
            y = at[1] + rad * math.sin(ang) * 0.8
            glow_disc(c, x, y, 1.6 * (1 - 0.5 * ph), CRY, 0.9)
    P.raw(f)


def fx_shards(P, sk, e):
    rnd = random.Random(8)
    cx, cy = sk.hip[0] + 0.5, -16.0

    def f(c):
        for k in range(22):
            a = rnd.uniform(0, 2 * math.pi)
            r0 = 12.0 + rnd.uniform(-1, 1)
            px = cx + math.cos(a) * r0 * (1 + 0.9 * e)
            py = cy + math.sin(a) * r0 * 1.4 * (1 + 0.9 * e) + 26 * e * e
            if py > -0.5:
                py = -0.5
            s = 2.4 * (1 - 0.7 * e)
            rot = a + e * 5 + k
            c.save()
            c.translate(px, py)
            c.rotate(rot)
            c.move_to(0, -s)
            c.line_to(s * 0.9, s * 0.7)
            c.line_to(-s * 0.9, s * 0.6)
            c.close_path()
            c.restore()
            c.set_source_rgba(*pt.tint(CRY, 0.3), 0.8 * (1 - e * 0.8))
            c.fill_preserve()
            c.set_source_rgba(*CRY, 1 - e * 0.8)
            c.set_line_width(0.5)
            c.stroke()
        if e < 0.3:
            glow_disc(c, cx, cy, 20 * (1 - e), CRY, 0.6 * (1 - e / 0.3))
    P.raw(f)


def fx_drops(P, tt):
    def f(c):
        for k in range(5):
            e = min(1, tt * 1.3)
            ang = k * 1.26 + 0.5
            x = 4 + 14 * e * math.cos(ang)
            y = -min(20, 20 * (1 - e) + 6 * math.sin(e * math.pi)) + 3 * e * math.sin(ang) - 0.8
            glow_disc(c, x, y, 3.2, CRY, 0.7)
            c.move_to(x, y - 2.0)
            c.line_to(x + 1.1, y)
            c.line_to(x, y + 1.6)
            c.line_to(x - 1.1, y)
            c.close_path()
            c.set_source_rgba(*pt.tint(CRY, 0.3), 1)
            c.fill_preserve()
            c.set_source_rgba(*pt.OUTLINE, 1)
            c.set_line_width(0.45)
            c.stroke()
    P.raw(f)


def paint_frame(P, anim, f, with_shadow=True):
    pose = pose_for(anim, f)
    sk = Skel(pose)
    if with_shadow:
        F.ground_shadow(P, 8.5, 2.4)
    tip = None
    fall = anim in ("fall", "dead")
    if anim == "cast" and f >= 6:
        e = min(1.0, (f - 6) / 18) if f < 24 else 1.0
        g = 0.5 + 0.5 * ease(min(1, e * 1.6)) if f < 24 else max(0.001, 1 - (f - 24) / 6)
        fx_ground_sigil(P, 0.5, g, e * 1.5 if f < 24 else 1.5)
    if fall:
        tt = 1.0 if anim == "dead" else f / 11
        e = ease(max(0, (tt - 0.25) / 0.75))
        P.save()
        P.translate(13.0 * e, -2.4 * e)
        P.rotate(-84 * e)
        tip = draw_body(P, sk, anim, f)
        P.restore()
        fx_drops(P, tt)
        return sk, tip
    tip = draw_body(P, sk, anim, f)
    if anim == "idle" or anim == "walk":
        fx_shield(P, sk)
    elif anim == "hit":
        k = [1.0, 0.4, 0.1, 1.0, 0.45, 0.15][f]
        fx_shield(P, sk, flash=k)

        def impact(c, k=k, f=f):
            x, y = (8.0, -24.0) if f < 3 else (9.5, -12.0)
            glow_disc(c, x, y, 7 * k + 1, (1.0, 0.95, 0.8), 0.9 * k)
        P.raw(impact)
    elif anim == "shatter":
        if f == 0:
            fx_shield(P, sk, flash=1.0)
        fx_shards(P, sk, f / 7)
    elif anim == "cast":
        fx_shield(P, sk)
        if f < 6:
            fx_sigil(P, tip, 0.3 * ease(f / 6) + 0.05, f * 0.1, 0.8)
        elif f < 24:
            e = (f - 6) / 18
            fx_sigil(P, tip, 0.35 + 0.65 * ease(min(1, e * 1.4)), e * 2.6, 0.7 + 0.3 * e)
            fx_sparks(P, tip, e)
        else:
            e = (f - 24) / 6
            fx_sigil(P, tip, max(0.05, 1 - e), 2.6, 1 - e)
            fx_bolt(P, tip, 8 + 60 * e, 1.0 + 0.4 * (1 - e))
    return sk, tip


def draw_scene_frame(anim, frame, k=3.0):
    """Mage sprite for the battle scene (3x): colour, mask, anchor px, body top pt."""
    from units_a import crop
    P = Painter(90, 80, (30, 66), k=k)
    BOLD["on"] = True
    sk, tip = paint_frame(P, anim, frame)
    BOLD["on"] = False
    base, mask = P.images()
    top = -(sk.head[1] - F.HEAD_R * 2.1)
    out = crop(base, mask, P.anchor, top)
    return out


def sigil_pt(anim="cast", frame=22):
    """Screen offset (pt) from the feet to the sigil centre, for the 晶砲 trail in the scene."""
    P = Painter(4, 4, (2, 2), k=1)
    sk = Skel(pose_for(anim, frame))
    a = math.radians(sk.ahN - 90)
    hx, hy = sk.hN
    return (hx + math.cos(a) * 3.8 + 4.0, hy + math.sin(a) * 3.8)


def write_frames(out_dir, team_rgb, k=4.0):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    for anim, n in MAGE_FRAMES:
        for f in range(n):
            P = Painter(120, 70, (38, 58), k=k)
            paint_frame(P, anim, f)
            base, mask = P.images()
            img = pt.flat_recolor(base, mask, team_rgb)
            img.save(out_dir / f"{anim}_{f:02d}.png")
            (out_dir / f"{anim}_{f:02d}.json").write_text(json.dumps({"anchor": list(P.anchor)}))
    return out_dir
