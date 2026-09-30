"""A 彩繪桌遊: 2D vector painter shared by every A asset.

Every shape is painted twice: on the colour layer and on the team mask layer
(white where the player colour goes, black elsewhere, so later parts occlude
the mask correctly). Units are points (pt); the surface scale k is px per pt
(3 for the phone scene, 4 for the GIF). Origin = ground point under the feet.

Look: warm dark-brown outline, flat base colour, one cel shadow toward the
lower right, a thin highlight toward the upper left (light from the upper left).
"""
import math
from pathlib import Path

import cairo
import numpy as np
from PIL import Image

OUTLINE = (0.17, 0.11, 0.07)
TEAM_GRAY = (0.75, 0.75, 0.75)
EMBLEM_DIR = Path(__file__).resolve().parents[1] / "build" / "emblems"
_EMB = {}


def rgb(hexstr):
    h = hexstr.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def shade(c, f=0.72):
    return tuple(max(0, v * f) for v in c)


def tint(c, f=0.35):
    return tuple(v + (1 - v) * f for v in c)


def emblem(name):
    if name not in _EMB:
        _EMB[name] = cairo.ImageSurface.create_from_png(str(EMBLEM_DIR / f"{name}.png"))
    return _EMB[name]


class Painter:
    def __init__(self, w_pt, h_pt, anchor_pt, k=3.0, lw=1.1):
        self.k = k
        self.w, self.h = int(round(w_pt * k)), int(round(h_pt * k))
        self.anchor = (anchor_pt[0] * k, anchor_pt[1] * k)
        self.base = cairo.ImageSurface(cairo.FORMAT_ARGB32, self.w, self.h)
        self.mask = cairo.ImageSurface(cairo.FORMAT_ARGB32, self.w, self.h)
        self.cb = cairo.Context(self.base)
        self.cm = cairo.Context(self.mask)
        for c in (self.cb, self.cm):
            c.translate(*self.anchor)
            c.scale(k, k)
            c.set_line_join(cairo.LINE_JOIN_ROUND)
            c.set_line_cap(cairo.LINE_CAP_ROUND)
        self.lw = lw
        self.light = (-1.0, -1.0)

    # ---------------------------------------------------------- transforms
    def save(self):
        self.cb.save()
        self.cm.save()

    def restore(self):
        self.cb.restore()
        self.cm.restore()

    def translate(self, x, y):
        self.cb.translate(x, y)
        self.cm.translate(x, y)

    def rotate(self, deg):
        self.cb.rotate(math.radians(deg))
        self.cm.rotate(math.radians(deg))

    def scale(self, sx, sy):
        self.cb.scale(sx, sy)
        self.cm.scale(sx, sy)

    # ---------------------------------------------------------- painting
    def part(self, path, color, team=False, sh=1.4, hl=0.6, outline=True, lw=None, shf=0.7, alpha=1.0,
             mask_team=None):
        """path(ctx) appends a closed path. sh/hl = shadow/highlight crescent width (pt)."""
        lw = self.lw if lw is None else lw
        c = TEAM_GRAY if team else color
        cb = self.cb
        # base fill
        cb.new_path()
        path(cb)
        cb.set_source_rgba(*c, alpha)
        cb.fill_preserve()
        if sh:
            cb.save()
            cb.clip()
            cb.new_path()
            cb.set_fill_rule(cairo.FILL_RULE_EVEN_ODD)
            cb.rectangle(-1000, -1000, 2000, 2000)
            cb.save()
            cb.translate(self.light[0] * sh, self.light[1] * sh)
            path(cb)
            cb.restore()
            cb.set_source_rgba(*shade(c, shf), alpha)
            cb.fill()
            cb.restore()
            cb.new_path()
            path(cb)
        if hl:
            cb.save()
            cb.clip()
            cb.new_path()
            cb.set_fill_rule(cairo.FILL_RULE_EVEN_ODD)
            cb.rectangle(-1000, -1000, 2000, 2000)
            cb.save()
            cb.translate(-self.light[0] * hl, -self.light[1] * hl)
            path(cb)
            cb.restore()
            cb.set_source_rgba(*tint(c, 0.38), alpha)
            cb.fill()
            cb.restore()
            cb.new_path()
            path(cb)
        if outline:
            cb.set_source_rgba(*OUTLINE, alpha)
            cb.set_line_width(lw)
            cb.stroke()
        cb.new_path()
        # mask
        cm = self.cm
        cm.new_path()
        path(cm)
        on = team if mask_team is None else mask_team
        cm.set_source_rgba(1, 1, 1, alpha) if on else cm.set_source_rgba(0, 0, 0, alpha)
        cm.fill_preserve()
        if outline:
            cm.set_source_rgba(0, 0, 0, alpha)
            cm.set_line_width(lw)
            cm.stroke()
        cm.new_path()

    def line(self, pts, color, width, outline=True, lw=None, cap=cairo.LINE_CAP_ROUND):
        """A stick (spear shaft, bow string): dark outline stroke under a colour stroke."""
        lw = self.lw if lw is None else lw
        for c, is_mask in ((self.cb, False), (self.cm, True)):
            c.new_path()
            c.move_to(*pts[0])
            for p in pts[1:]:
                c.line_to(*p)
            c.set_line_cap(cap)
            if outline:
                c.set_source_rgb(*(OUTLINE if not is_mask else (0, 0, 0)))
                c.set_line_width(width + 2 * lw * 0.8)
                c.stroke_preserve()
            c.set_source_rgb(*(color if not is_mask else (0, 0, 0)))
            c.set_line_width(width)
            c.stroke()

    def curve(self, pts, color, width, outline=True):
        """Smooth stroke through control points (bezier triplets after the first point)."""
        for c, is_mask in ((self.cb, False), (self.cm, True)):
            c.new_path()
            c.move_to(*pts[0])
            for i in range(1, len(pts) - 2, 3):
                c.curve_to(*pts[i], *pts[i + 1], *pts[i + 2])
            if outline:
                c.set_source_rgb(*(OUTLINE if not is_mask else (0, 0, 0)))
                c.set_line_width(width + 2 * self.lw * 0.8)
                c.stroke_preserve()
            c.set_source_rgb(*(color if not is_mask else (0, 0, 0)))
            c.set_line_width(width)
            c.stroke()

    def detail(self, path, color, width=0.6, alpha=1.0, fill=False):
        """Ink detail line (no mask effect)."""
        cb = self.cb
        cb.new_path()
        path(cb)
        cb.set_source_rgba(*color, alpha)
        if fill:
            cb.fill()
        else:
            cb.set_line_width(width)
            cb.stroke()

    def emblem(self, name, x, y, size, rot=0, color=(1, 1, 1)):
        """Paint a white emblem (not team-coloured) at (x, y) centre."""
        surf = emblem(name)
        s = size / surf.get_width()
        for c, col in ((self.cb, color), (self.cm, (0, 0, 0))):
            c.save()
            c.translate(x, y)
            c.rotate(math.radians(rot))
            c.scale(s, s)
            c.translate(-surf.get_width() / 2, -surf.get_height() / 2)
            c.set_source_rgb(*col)
            c.mask_surface(surf, 0, 0)
            c.restore()

    def raw(self, fn):
        """Paint straight onto the colour layer only (effects, glows)."""
        fn(self.cb)

    # ---------------------------------------------------------- output
    def images(self):
        return surf_to_pil(self.base), surf_to_pil(self.mask)


def surf_to_pil(surf):
    surf.flush()
    w, h = surf.get_width(), surf.get_height()
    buf = np.ndarray((h, surf.get_stride() // 4, 4), np.uint8, surf.get_data())[:, :w, :].astype(np.float32)
    a = buf[..., 3:4] / 255.0
    rgb = np.where(a > 0, buf[..., 2::-1] / np.maximum(a, 1e-6), 0)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), buf[..., 3]]).astype(np.uint8), "RGBA")


def flat_recolor(base, mask, team_rgb):
    """Player colour from the grey team parts: grey 0.75 -> team, darker greys -> darker team."""
    b = np.asarray(base, np.float32)
    m = np.asarray(mask, np.float32)
    k = (m[..., 0] / 255.0) * (m[..., 3] / 255.0)
    g = b[..., :3].mean(axis=2) / 255.0
    f = g / TEAM_GRAY[0]
    team = np.asarray(team_rgb, np.float32)
    lo = team[None, None, :] * np.minimum(f, 1.0)[..., None]
    hi = (255 - team)[None, None, :] * np.clip((f - 1.0) / (1 / TEAM_GRAY[0] - 1), 0, 1)[..., None] * 0.7
    col = lo + hi
    out = b.copy()
    out[..., :3] = b[..., :3] * (1 - k[..., None]) + col * k[..., None]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")


# ---------------------------------------------------------------- path helpers

def ellipse(cx, cy, rx, ry, rot=0):
    def p(c):
        c.save()
        c.translate(cx, cy)
        c.rotate(math.radians(rot))
        c.scale(rx, ry)
        c.arc(0, 0, 1, 0, 2 * math.pi)
        c.restore()
    return p


def poly(pts):
    def p(c):
        c.move_to(*pts[0])
        for q in pts[1:]:
            c.line_to(*q)
        c.close_path()
    return p


def rrect(x, y, w, h, r):
    def p(c):
        c.new_sub_path()
        c.arc(x + w - r, y + r, r, -math.pi / 2, 0)
        c.arc(x + w - r, y + h - r, r, 0, math.pi / 2)
        c.arc(x + r, y + h - r, r, math.pi / 2, math.pi)
        c.arc(x + r, y + r, r, math.pi, 3 * math.pi / 2)
        c.close_path()
    return p


def capsule(p0, p1, r0, r1=None):
    """Tapered limb from p0 (radius r0) to p1 (radius r1)."""
    r1 = r0 if r1 is None else r1
    (x0, y0), (x1, y1) = p0, p1
    a = math.atan2(y1 - y0, x1 - x0)

    def p(c):
        c.new_sub_path()
        c.arc(x1, y1, r1, a - math.pi / 2, a + math.pi / 2)
        c.arc(x0, y0, r0, a + math.pi / 2, a + 3 * math.pi / 2)
        c.close_path()
    return p


def blob(pts):
    """Closed smooth shape through points (Catmull-Rom converted to beziers)."""
    n = len(pts)

    def p(c):
        c.move_to(*pts[0])
        for i in range(n):
            p0, p1, p2, p3 = pts[(i - 1) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
            c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
            c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
            c.curve_to(*c1, *c2, *p2)
        c.close_path()
    return p


def path_cmds(cmds):
    """cmds: [('M',x,y), ('L',x,y), ('C',x1,y1,x2,y2,x,y), ('Z',)]"""
    def p(c):
        for cmd in cmds:
            if cmd[0] == "M":
                c.move_to(*cmd[1:])
            elif cmd[0] == "L":
                c.line_to(*cmd[1:])
            elif cmd[0] == "C":
                c.curve_to(*cmd[1:])
            elif cmd[0] == "Z":
                c.close_path()
    return p


# ---------------------------------------------------------------- iso helpers (buildings)

def iso(x, y, z=0.0):
    """World metres -> screen pt offset (same camera as the 3D options)."""
    return (14.142 * (x - y), -7.071 * (x + y) - 17.32 * z)


def iso_poly(pts3):
    return poly([iso(*q) for q in pts3])
