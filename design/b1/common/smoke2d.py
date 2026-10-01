"""Smoke columns drawn in 2D (like the shared landing dust, common effects.py in design/production).

In the game, smoke over a burning or damaged building and the cooking smoke of a governed town are
overlays the client draws on top of the building (and can animate later); they are not part of the
building images. The renders only mark where a column rises (states.smoke / towns smoke_at).

column(ppm, **params) -> (RGBA image, anchor): the anchor is the column's base point.
"""
import math
import random

import numpy as np
from PIL import Image, ImageFilter

import proj


def _puff(size, seed, shade_top, shade_bottom, alpha):
    n = max(4, size * 2)
    rnd = random.Random(seed)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    a = np.zeros((n, n), np.float32)
    for _ in range(4):
        cx = n / 2 + rnd.uniform(-0.15, 0.15) * n
        cy = n / 2 + rnd.uniform(-0.12, 0.12) * n
        r = rnd.uniform(0.25, 0.36) * n
        d = np.hypot(xx - cx, (yy - cy) * 1.1) / r
        a = np.maximum(a, np.clip(1 - d, 0, 1) ** 0.9)
    t = np.clip((yy / n - 0.25) * 1.3, 0, 1)[..., None]
    rgb = np.array(shade_top, np.float32) * (1 - t) + np.array(shade_bottom, np.float32) * t
    img = np.dstack([rgb, (a * 255 * alpha)[..., None]]).astype(np.uint8)
    return Image.fromarray(img, "RGBA").resize((size, size), Image.LANCZOS)


def column(ppm, h=3.0, r0=0.3, r1=0.8, dark=0.2, alpha=0.8, drift=(0.35, 0.25), n=None, seed=1):
    """A column rising h metres from the base, puffs growing from r0 to r1 (metres), drifting by
    drift x h in x and y; dark: grey value 0..1; alpha: opacity of the thickest part."""
    n = n or max(6, int(h * 3.2))
    rnd = random.Random(seed)
    base = np.array(proj.to_px((0, 0, 0), (0, 0), ppm))
    pts = []
    for i in range(n):
        t = i / max(1, n - 1)
        r = (r0 + (r1 - r0) * t) * rnd.uniform(0.85, 1.15)
        side = rnd.uniform(-1, 1) * r * 0.35
        w = (drift[0] * h * t + side, drift[1] * h * t - side * 0.5, h * t)
        p = np.array(proj.to_px(w, (0, 0), ppm)) - base
        pts.append((p, r * ppm, t))
    pad = int(max(r1 * ppm * 1.5, 8))
    xs = [p[0] for p, _, _ in pts]
    ys = [p[1] for p, _, _ in pts]
    x0, y0 = int(min(xs)) - pad, int(min(ys)) - pad
    W, H = int(max(xs)) + pad - x0, int(max(ys)) + pad - y0
    can = Image.new("RGBA", (max(1, W), max(1, H)), (0, 0, 0, 0))
    g = int(255 * dark)
    top = tuple(min(255, int(g * 1.35 + 18)) for _ in range(3))
    bottom = tuple(int(g * 0.8) for _ in range(3))
    for k, (p, rp, t) in enumerate(pts):
        size = max(4, int(rp * 2))
        pf = _puff(size, seed * 100 + k, top, bottom, alpha * (1 - 0.35 * t))
        can.alpha_composite(pf, (int(p[0] - x0 - size / 2), int(p[1] - y0 - size / 2)))
    can = can.filter(ImageFilter.GaussianBlur(max(0.6, ppm / 60)))
    return can, (-x0, -y0)


if __name__ == "__main__":
    im, a = column(60, h=3.0, dark=0.2)
    im.save("/tmp/smoke_test.png")
    print(im.size, a)
