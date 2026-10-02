"""B1b-03: the 晶砲 warning circle, a world effect the game draws (like the shared landing dust).

The sim warns 30 ticks (1.5 s) before a 晶砲 lands, radius 1.5 cells (3 m); both sides see it
(client world.ts drawWarnings; the prototype draws a pulsing disc and a disc growing from the centre).

frames(style, ppm) -> [(RGBA image, anchor)] for ticks 0..29 (ticksLeft 30 -> 1): drawn top-down at 4x,
turned 45 degrees to the map grid and squashed to the ground ellipse (camera 30 degrees: height = width / 2).

A 「收束圈」: a crisp outer rim with tick marks (the edge of the blast) that stays; a bright ring starts
  at the rim and closes in on the centre; behind it the ground glows hotter; the last 5 ticks flash.
B 「符文漸強」: an original crystal-lattice sigil (double ring, six crystal marks, a hexagon of lines,
  like the 魔晶's six faces) that turns slowly; it brightens and its fill thickens, pulsing faster
  and faster (3 -> 9 pulses a second); the last 5 ticks it burns white at the core.

Colours: orange-red (client WARNING_TINT 0xff8a2a, a little redder for the rim), a pale gold for the hottest
light, a dark ember line under the rim so it reads on pale paving; nothing cyan (the 魔晶, the shield).
"""
import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import proj

RADIUS_M = 3.0
TICKS = 30
ORANGE = (255, 112, 38)
TINT = (255, 138, 42)
GOLD = (255, 214, 130)
EMBER = (110, 26, 8)


def _iso(top, ppm):
    """Top-down square image (radius RADIUS_M + margin) -> the ground ellipse at ppm, anchor at its centre."""
    t = top.rotate(45, resample=Image.BICUBIC, expand=False)
    W = t.width
    scale = ppm / _TOP_PPM
    out_w = max(1, int(round(W * scale)))
    out_h = max(1, int(round(W * scale * 0.5)))
    img = t.resize((out_w, out_h), Image.LANCZOS)
    return img, (out_w / 2, out_h / 2)


_TOP_PPM = 120          # the top-down drawing: 120 px per metre (supersampled; scaled down to the board)


def _canvas():
    R = int((RADIUS_M + 0.5) * _TOP_PPM)
    return Image.new("RGBA", (2 * R, 2 * R), (0, 0, 0, 0)), R


def _ring(dr, c, r, w, col):
    dr.ellipse([c - r, c - r, c + r, c + r], outline=col, width=max(1, int(w)))


def frame_a(tick):
    """Style A at tick 0..29."""
    img, c = _canvas()
    R = RADIUS_M * _TOP_PPM
    k = tick / (TICKS - 1)                        # 0 .. 1
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    # the zone behind the closing ring glows hotter as it closes
    r_close = R * (1 - k) ** 0.85
    fill_a = int(40 + 70 * k)
    g.ellipse([c - R, c - R, c + R, c + R], fill=(*ORANGE, fill_a))
    if r_close > 4:
        g.ellipse([c - r_close, c - r_close, c + r_close, c + r_close], fill=(0, 0, 0, 0))
        g.ellipse([c - r_close, c - r_close, c + r_close, c + r_close], fill=(*ORANGE, 26))
    glow = glow.filter(ImageFilter.GaussianBlur(6))
    img.alpha_composite(glow)
    dr = ImageDraw.Draw(img)
    # the rim: an ember line under a crisp orange-red line, tick marks every 15 degrees pointing inward
    _ring(dr, c, R + 4, 14, (*EMBER, 170))
    _ring(dr, c, R, 10, (*ORANGE, 245))
    for i in range(24):
        a = 2 * math.pi * i / 24
        L = 34 if i % 2 == 0 else 18
        x0, y0 = c + math.cos(a) * (R - 6), c + math.sin(a) * (R - 6)
        x1, y1 = c + math.cos(a) * (R - 6 - L), c + math.sin(a) * (R - 6 - L)
        dr.line([x0, y0, x1, y1], fill=(*ORANGE, 230), width=7)
    # the closing ring: bright, gets hotter (orange -> gold) as it closes
    if r_close > 6:
        col = tuple(int(o + (gd - o) * k) for o, gd in zip(ORANGE, GOLD))
        cl = Image.new("RGBA", img.size, (0, 0, 0, 0))
        cd = ImageDraw.Draw(cl)
        _ring(cd, c, r_close, 30, (*col, 120))
        cl = cl.filter(ImageFilter.GaussianBlur(8))
        img.alpha_composite(cl)
        dr = ImageDraw.Draw(img)
        _ring(dr, c, r_close, 12, (*col, 255))
    # the centre mark
    s = 26
    dr.line([c - s, c, c + s, c], fill=(*ORANGE, 220), width=7)
    dr.line([c, c - s, c, c + s], fill=(*ORANGE, 220), width=7)
    # last five ticks: the whole zone flashes
    if tick >= TICKS - 5:
        f = 0.5 + 0.5 * math.sin(math.pi * (tick - (TICKS - 5)) * 1.0)
        fl = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(fl).ellipse([c - R, c - R, c + R, c + R], fill=(*GOLD, int(70 + 70 * f)))
        img.alpha_composite(fl.filter(ImageFilter.GaussianBlur(10)))
    return img


def _sigil(dr, c, R, rot, col, width):
    """The crystal-lattice sigil (original): a double ring, six crystal marks on the ring, a hexagon of
    straight lines joining them, and a small hexagon at the centre."""
    _ring(dr, c, R, width, col)
    _ring(dr, c, R * 0.84, max(2, width * 0.6), col)
    pts = []
    for i in range(6):
        a = rot + 2 * math.pi * i / 6
        pts.append((c + math.cos(a) * R * 0.84, c + math.sin(a) * R * 0.84))
        # a crystal mark (a long diamond) across the band between the two rings
        m = R * 0.92
        ax, ay = c + math.cos(a) * m, c + math.sin(a) * m
        ux, uy = math.cos(a), math.sin(a)
        vx, vy = -uy, ux
        L, Wd = R * 0.11, R * 0.035
        dr.polygon([(ax + ux * L, ay + uy * L), (ax + vx * Wd, ay + vy * Wd), (ax - ux * L, ay - uy * L),
                    (ax - vx * Wd, ay - vy * Wd)], fill=col)
    for i in range(6):
        dr.line([pts[i], pts[(i + 2) % 6]], fill=col, width=max(2, int(width * 0.5)))
    h = [(c + math.cos(rot + math.pi / 6 + 2 * math.pi * i / 6) * R * 0.18,
          c + math.sin(rot + math.pi / 6 + 2 * math.pi * i / 6) * R * 0.18) for i in range(6)]
    dr.polygon(h, outline=col, width=max(2, int(width * 0.6)))


def frame_b(tick):
    """Style B at tick 0..29."""
    img, c = _canvas()
    R = RADIUS_M * _TOP_PPM
    k = tick / (TICKS - 1)
    t = tick / 20.0                                    # seconds
    # pulses: 3 a second at the start, 9 at the end (phase = integral of the frequency)
    phase = 2 * math.pi * (3 * t + 3 * t * t / 1.5)
    pulse = 0.5 + 0.5 * math.cos(phase)
    bright = 0.45 + 0.55 * k
    fill = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(fill).ellipse([c - R, c - R, c + R, c + R],
                                 fill=(*ORANGE, int((30 + 90 * k) * (0.75 + 0.25 * pulse))))
    img.alpha_composite(fill.filter(ImageFilter.GaussianBlur(10)))
    rot = math.radians(20 * t)                          # turns slowly: 20 degrees a second
    col = tuple(int(o + (gd - o) * k * 0.7) for o, gd in zip(ORANGE, GOLD))
    a = int(255 * min(1.0, bright * (0.8 + 0.2 * pulse)))
    halo = Image.new("RGBA", img.size, (0, 0, 0, 0))
    _sigil(ImageDraw.Draw(halo), c, R, rot, (*col, int(a * 0.6)), 22)
    img.alpha_composite(halo.filter(ImageFilter.GaussianBlur(9)))
    dr = ImageDraw.Draw(img)
    _ring(dr, c, R + 4, 14, (*EMBER, 160))
    _sigil(dr, c, R, rot, (*col, a), 9)
    if tick >= TICKS - 5:
        f = (tick - (TICKS - 5) + 1) / 5
        core = Image.new("RGBA", img.size, (0, 0, 0, 0))
        rr = R * (0.25 + 0.5 * f)
        ImageDraw.Draw(core).ellipse([c - rr, c - rr, c + rr, c + rr], fill=(*GOLD, int(120 + 100 * f)))
        img.alpha_composite(core.filter(ImageFilter.GaussianBlur(18)))
    return img


def frames(style, ppm):
    fn = frame_a if style == "A" else frame_b
    return [_iso(fn(t), ppm) for t in range(TICKS)]


def ground_ellipse_check(ppm):
    """The size the ellipse must have: a ground circle of RADIUS_M seen by the game camera."""
    xs = [proj.to_px((RADIUS_M * math.cos(a), RADIUS_M * math.sin(a)), (0, 0), ppm) for a in
          [2 * math.pi * i / 64 for i in range(64)]]
    w = max(p[0] for p in xs) - min(p[0] for p in xs)
    h = max(p[1] for p in xs) - min(p[1] for p in xs)
    return w, h


if __name__ == "__main__":
    import sys
    for st in ("A", "B"):
        fr = frames(st, 30)
        print(st, fr[0][0].size, ground_ellipse_check(30))
