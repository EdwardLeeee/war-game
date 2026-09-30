"""A 彩繪桌遊: 2D side-view rig (facing right, seen 3/4 from the front).

A pose is a dict of angles in degrees:
  torso   lean (+ = forward)          nod    head tilt
  aN/aF   (shoulder, elbow) near/far arm, measured from straight down, + = forward
  lN/lF   (hip, knee) near/far leg, knee negative bends backward
  bob     vertical offset of the hips (pt, + = down)
Proportions (pt): hip 13, torso 10.5, head r 4.4 -> body top ~34 pt (head ~1/4 of height).
"""
import math

import paint as pt
from paint import capsule, ellipse, poly, rrect

HIP_H = 13.0
TORSO = 10.5
HEAD_R = 4.5
UARM, FARM = 5.4, 5.0
THIGH, SHIN = 6.8, 6.4


def vec(deg, length):
    r = math.radians(deg)
    return (math.sin(r) * length, math.cos(r) * length)


def add(p, q):
    return (p[0] + q[0], p[1] + q[1])


class Skel:
    def __init__(self, pose, hip_h=HIP_H):
        g = pose.get
        self.pose = pose
        hip = (g("dx", 0.0), -hip_h + g("bob", 0.0))
        t = g("torso", 0.0)
        self.hip = hip
        self.t = t
        self.shoulder = add(hip, (math.sin(math.radians(t)) * TORSO, -math.cos(math.radians(t)) * TORSO))
        self.neck = add(self.shoulder, (math.sin(math.radians(t)) * 1.2, -math.cos(math.radians(t)) * 1.2))
        n = t + g("nod", 0.0)
        self.head = add(self.neck, (math.sin(math.radians(n)) * 3.6 + 0.4, -math.cos(math.radians(n)) * 3.8))
        self.nod = n
        self.sN = add(self.shoulder, (0.6, 1.2))
        self.sF = add(self.shoulder, (-1.4, 0.8))
        for side, s in (("N", self.sN), ("F", self.sF)):
            a1, a2 = g("a" + side, (10, 20))
            e = add(s, vec(a1, UARM))
            h = add(e, vec(a1 + a2, FARM))
            setattr(self, "e" + side, e)
            setattr(self, "h" + side, h)
            setattr(self, "ah" + side, a1 + a2)   # forearm direction (deg from down)
        for side, dx in (("N", 0.9), ("F", -0.9)):
            l1, l2 = g("l" + side, (0, 0))
            hp = add(hip, (dx, 0.5))
            k = add(hp, vec(l1, THIGH))
            a = add(k, vec(l1 + l2, SHIN))
            setattr(self, "hp" + side, hp)
            setattr(self, "k" + side, k)
            setattr(self, "an" + side, a)


def torso_path(sk, w_hip=5.4, w_sh=7.2, extra_top=1.0):
    """Trapezoid torso along the spine, rounded."""
    t = math.radians(sk.t)
    ux, uy = math.sin(t), -math.cos(t)          # up along the spine
    px, py = math.cos(t), math.sin(t)           # across (to the front)
    hx, hy = sk.hip
    sx, sy = sk.shoulder
    pts = [
        (hx - px * w_hip / 2, hy - py * w_hip / 2),
        (hx + px * w_hip / 2, hy + py * w_hip / 2),
        (sx + px * w_sh / 2 + ux * extra_top, sy + py * w_sh / 2 + uy * extra_top),
        (sx - px * w_sh / 2 + ux * extra_top, sy - py * w_sh / 2 + uy * extra_top),
    ]
    return pt.blob([pts[0], ((pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2 + 0.6), pts[1],
                    ((pts[1][0] + pts[2][0]) / 2 + px * 0.5, (pts[1][1] + pts[2][1]) / 2 + py * 0.5), pts[2],
                    ((pts[2][0] + pts[3][0]) / 2 + ux * 0.8, (pts[2][1] + pts[3][1]) / 2 + uy * 0.8), pts[3],
                    ((pts[3][0] + pts[0][0]) / 2 - px * 0.5, (pts[3][0] * 0 + (pts[3][1] + pts[0][1]) / 2 - py * 0.5))])


def skirt_path(sk, length=6.0, flare=2.2, w=5.6):
    """Armour skirt / robe hem hanging from the hips (vertical, flared)."""
    hx, hy = sk.hip
    return pt.blob([(hx - w / 2, hy - 1.0), (hx + w / 2, hy - 1.0), (hx + w / 2 + flare * 0.6, hy + length * 0.6),
                    (hx + w / 2 + flare, hy + length), (hx, hy + length + 0.6), (hx - w / 2 - flare, hy + length),
                    (hx - w / 2 - flare * 0.6, hy + length * 0.6)])


def leg(P, sk, side, pants, boots, thick=1.0):
    hp, k, a = getattr(sk, "hp" + side), getattr(sk, "k" + side), getattr(sk, "an" + side)
    far = side == "F"
    c1 = pt.shade(pants, 0.85) if far else pants
    c2 = pt.shade(boots, 0.85) if far else boots
    P.part(capsule(hp, k, 2.0 * thick, 1.7 * thick), c1, sh=0.9)
    P.part(capsule(k, a, 1.7 * thick, 1.5 * thick), c2, sh=0.8)
    P.part(pt.blob([(a[0] - 1.6, a[1] - 1.2), (a[0] + 1.2, a[1] - 1.4), (a[0] + 3.4, a[1] - 0.2),
                    (a[0] + 3.2, a[1] + 0.8), (a[0] - 1.6, a[1] + 0.8)]), c2, sh=0.6, hl=0.3)


def arm(P, sk, side, sleeve, skin, thick=1.0, hand=True, glove=None):
    s, e, h = getattr(sk, "s" + side), getattr(sk, "e" + side), getattr(sk, "h" + side)
    far = side == "F"
    c = pt.shade(sleeve, 0.85) if far else sleeve
    P.part(capsule(s, e, 1.8 * thick, 1.5 * thick), c, sh=0.8)
    P.part(capsule(e, h, 1.5 * thick, 1.3 * thick), c, sh=0.7)
    if hand:
        hc = glove or skin
        P.part(ellipse(h[0], h[1], 1.45, 1.45), pt.shade(hc, 0.9) if far else hc, sh=0.5, hl=0.3)


def head(P, sk, skin, hair=None, eye=True, r=HEAD_R):
    x, y = sk.head
    P.part(ellipse(x, y, r, r * 1.02), skin, sh=1.4, hl=0.7)
    # ear and a hint of the face turned to the right
    P.part(ellipse(x - r * 0.28, y + r * 0.08, r * 0.24, r * 0.3), pt.shade(skin, 0.9), sh=0, hl=0, lw=P.lw * 0.7)
    if eye:
        P.detail(ellipse(x + r * 0.42, y - r * 0.02, r * 0.13, r * 0.19), (0.12, 0.08, 0.06), fill=True)
        P.detail(lambda c: (c.move_to(x + r * 0.95, y + r * 0.1), c.line_to(x + r * 1.08, y + r * 0.3),
                            c.line_to(x + r * 0.9, y + r * 0.34)), pt.OUTLINE, width=0.5)
    if hair:
        P.part(pt.blob([(x - r * 1.02, y + r * 0.1), (x - r * 0.9, y - r * 0.6), (x - r * 0.2, y - r * 1.05),
                        (x + r * 0.6, y - r * 0.9), (x + r * 0.95, y - r * 0.45), (x + r * 0.2, y - r * 0.6),
                        (x - r * 0.4, y - r * 0.2), (x - r * 0.55, y + r * 0.35)]), hair, sh=0.7, hl=0.4)


def ground_shadow(P, w=7.0, h=2.2, dx=1.2):
    """Soft cast shadow toward the lower right (drawn on the colour layer only)."""
    def f(c):
        c.save()
        c.translate(dx, 0.3)
        c.scale(w, h)
        c.arc(0, 0, 1, 0, 2 * math.pi)
        c.restore()
        c.set_source_rgba(0.18, 0.22, 0.12, 0.35)
        c.fill()
    P.raw(f)


def back_banner(P, sk, pole=(0.35, 0.28, 0.2), h=14.0, w=5.2, fh=7.0, sway=0.0):
    """East identity: small player-coloured banner on a pole rising from the back."""
    t = math.radians(sk.t)
    ux, uy = math.sin(t), -math.cos(t)
    bx, by = sk.shoulder[0] - 2.4 - ux * 3, sk.shoulder[1] - uy * -3
    top = (bx + ux * h * 0.4 - 0.6, by - h)
    P.line([(bx, by + 5), top], pole, 0.7)
    x, y = top
    P.part(pt.poly([(x - 0.2, y + 0.6), (x - w, y + 1.2 + sway), (x - w + 0.4, y + fh + sway),
                    (x - 0.2, y + fh)]), (0, 0, 0), team=True, sh=1.0, hl=0.4)
    P.part(ellipse(x, y, 0.7, 0.7), (0.9, 0.72, 0.3), sh=0, hl=0, lw=0.5)
