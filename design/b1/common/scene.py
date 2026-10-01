"""Putting rendered pieces and units together the way the game draws them (client/docs/sprite-atlas.md
section 6, and the B1 notes for client): shadows on the ground first, then every piece and unit in
depth order, each sprite placed by its anchor on its ground point.

Depth order: a piece is behind another when its footprint lies wholly further from the camera in x
or in y (the camera looks toward +x, +y); the rest by the footprint centre. This is the order we
propose to client for buildings (a single anchor point puts a unit next to a big building in front
of it or behind it at random).
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(1, str(HERE.parents[1] / "round1" / "common"))
import compose  # noqa: E402  (recolor)
import config   # noqa: E402
import proj     # noqa: E402
import smoke2d  # noqa: E402

TEAM = {"blue": config.TEAM["blue"], "red": config.TEAM["red"], "neutral": (216, 210, 192)}
UNITS = HERE.parents[1] / "production" / "build" / "prod"      # the production unit renders (3x)
SHADOW = (26, 30, 48)


class Spr:
    def __init__(self, img, ax, ay, rect, shadow=None, z=0.0, ground=False, top=False):
        self.img, self.ax, self.ay, self.rect = img, ax, ay, rect
        self.shadow = shadow            # (img, ax, ay) at the same scale
        self.z = z                      # height of the anchor point above the ground (smoke on a chimney)
        self.ground = ground            # drawn before everything (paving)
        self.top = top                  # drawn after everything (smoke)


def _scaled(img, f):
    if abs(f - 1) < 1e-6:
        return img
    return img.resize((max(1, round(img.width * f)), max(1, round(img.height * f))), Image.LANCZOS)


def piece(dirpath, name, suffix, team="blue", scale=1.0, x=0.0, y=0.0, z=0.0, shadow=True, ground=False, top=False,
          ppm=None):
    """A rendered piece (render_b1.py) at world (x, y): colour with AO and player colour, plus shadow.
    ppm: the pixels per metre wanted (overrides scale, whatever the render's own resolution)."""
    d = Path(dirpath)
    meta = json.loads((d / f"{name}_{suffix}.json").read_text())
    if ppm:
        scale = ppm / meta["px_per_m"]
    b = Image.open(d / f"{name}_{suffix}_beauty.png").convert("RGBA")
    ao_p = d / f"{name}_{suffix}_ao.png"
    if ao_p.exists():
        ao = np.asarray(Image.open(ao_p).convert("L"), np.float32) / 255.0
        a = np.asarray(b, np.float32)
        a[..., :3] *= (0.7 + 0.3 * ao)[..., None]
        b = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")
    m_p = d / f"{name}_{suffix}_mask.png"
    if m_p.exists():
        b = compose.recolor(b, Image.open(m_p), TEAM[team])
    sh = None
    s_p = d / f"{name}_{suffix}_shadow.png"
    if shadow and s_p.exists():
        s = Image.open(s_p).convert("RGBA")
        s = s.resize((s.width * 2, s.height * 2), Image.BILINEAR).filter(ImageFilter.GaussianBlur(1.5))
        al = np.asarray(s, np.float32)[..., 3] / 255.0 * 0.78
        rgb = np.empty(al.shape + (3,), np.float32)
        rgb[:] = SHADOW
        s = Image.fromarray(np.dstack([rgb, al[..., None] * 255]).astype(np.uint8), "RGBA")
        sax, say = meta["shadow_anchor"][0] * 2, meta["shadow_anchor"][1] * 2
        sh = (_scaled(s, scale), sax * scale, say * scale)
    fx, fy = meta["footprint"]
    hx, hy = fx * meta["cell_m"] / 2, fy * meta["cell_m"] / 2
    sp = Spr(_scaled(b, scale), meta["anchor"][0] * scale, meta["anchor"][1] * scale, (x - hx, x + hx, y - hy, y + hy),
             sh, z=z, ground=ground, top=top)
    sp.meta = meta
    sp.extra = []
    ppm = meta["px_per_m"] * scale
    for k, sm in enumerate(meta.get("smoke", [])):
        px, py, pz = sm["pos"]
        sp.extra.append(smoke(ppm, x + px, y + py, pz, h=sm["h"], r0=sm["r0"], r1=sm["r1"], dark=sm["dark"],
                              alpha=sm["alpha"], drift=sm["drift"], seed=k + int(abs(x * 7 + y * 3))))
    return sp


def smoke(ppm, x, y, z, seed=1, **params):
    """A 2D smoke column (smoke2d.py) rising from world (x, y, z), drawn over everything."""
    img, (ax, ay) = smoke2d.column(ppm, seed=seed, **params)
    return Spr(img, ax, ay, (x - 0.1, x + 0.1, y - 0.1, y + 0.1), z=z, top=True)


def with_fx(sp):
    """The piece and its smoke columns."""
    return [sp] + getattr(sp, "extra", [])


def unit(name, team="blue", anim="idle", facing=7, frame=0, scale=1.0, x=0.0, y=0.0):
    """A production unit render (3x) at world (x, y)."""
    raw = UNITS / name / "raw"
    base = f"{name}_{anim}_f{facing}_{frame:02d}"
    meta = json.loads((raw / f"{base}_x3.json").read_text())
    b = Image.open(raw / f"{base}_x3_beauty.png").convert("RGBA")
    ao_p = raw / f"{base}_x3_ao.png"
    if ao_p.exists():
        ao = np.asarray(Image.open(ao_p).convert("L"), np.float32) / 255.0
        a = np.asarray(b, np.float32)
        a[..., :3] *= (0.7 + 0.3 * ao)[..., None]
        b = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")
    b = compose.recolor(b, Image.open(raw / f"{base}_x3_mask.png"), TEAM[team])
    sh = None
    s_p = raw / f"{base}_x3_shadow.png"
    if s_p.exists():
        s = Image.open(s_p).convert("RGBA")
        s = s.resize((s.width * 2, s.height * 2), Image.BILINEAR).filter(ImageFilter.GaussianBlur(1.5))
        al = np.asarray(s, np.float32)[..., 3] / 255.0 * 0.78
        rgb = np.empty(al.shape + (3,), np.float32)
        rgb[:] = SHADOW
        s = Image.fromarray(np.dstack([rgb, al[..., None] * 255]).astype(np.uint8), "RGBA")
        sh = (_scaled(s, scale), meta["anchor"][0] * scale, meta["anchor"][1] * scale)
    r = 0.3
    return Spr(_scaled(b, scale), meta["anchor"][0] * scale, meta["anchor"][1] * scale, (x - r, x + r, y - r, y + r), sh)


def _behind(a, b):
    """True when a must be drawn before b."""
    ax0, ax1, ay0, ay1 = a.rect
    bx0, bx1, by0, by1 = b.rect
    eps = 1e-3
    return ax0 >= bx1 - eps or ay0 >= by1 - eps


def order(items):
    """Topological depth order; ties by footprint centre (far first)."""
    items = sorted(items, key=lambda s: -((s.rect[0] + s.rect[1]) / 2 + (s.rect[2] + s.rect[3]) / 2))
    n = len(items)
    out, done = [], [False] * n

    def visit(i, stack):
        if done[i]:
            return
        stack.add(i)
        for j in range(n):
            if j != i and not done[j] and j not in stack and _behind(items[j], items[i]) and not _behind(items[i], items[j]):
                visit(j, stack)
        stack.discard(i)
        done[i] = True
        out.append(items[i])

    for i in range(n):
        visit(i, set())
    return out


def render(items, ppm, pad=20, bg=None, bounds=None):
    """Compose: returns (image, origin pixel of world (0, 0))."""
    # bounds from every sprite's box placed at its anchor
    boxes = []
    for s in items:
        cx = (s.rect[0] + s.rect[1]) / 2
        cy = (s.rect[2] + s.rect[3]) / 2
        gx, gy = proj.to_px((cx, cy, s.z), (0, 0), ppm)
        boxes.append((gx - s.ax, gy - s.ay, gx - s.ax + s.img.width, gy - s.ay + s.img.height))
        if s.shadow:
            si, sax, say = s.shadow
            boxes.append((gx - sax, gy - say, gx - sax + si.width, gy - say + si.height))
    if bounds is None:
        x0 = min(b[0] for b in boxes) - pad
        y0 = min(b[1] for b in boxes) - pad
        x1 = max(b[2] for b in boxes) + pad
        y1 = max(b[3] for b in boxes) + pad
    else:
        x0, y0, x1, y1 = bounds
    W, H = int(x1 - x0), int(y1 - y0)
    can = Image.new("RGBA", (W, H), (*(bg or (118, 128, 104)), 255))
    origin = (-x0, -y0)

    def at(s):
        cx = (s.rect[0] + s.rect[1]) / 2
        cy = (s.rect[2] + s.rect[3]) / 2
        return proj.to_px((cx, cy, s.z), origin, ppm)

    for s in [s for s in items if s.ground]:
        gx, gy = at(s)
        can.alpha_composite(s.img, (int(round(gx - s.ax)), int(round(gy - s.ay))))
    for s in items:
        if s.shadow:
            gx, gy = at(s)
            si, sax, say = s.shadow
            can.alpha_composite(si, (int(round(gx - sax)), int(round(gy - say))))
    for s in order([s for s in items if not s.ground and not s.top]):
        gx, gy = at(s)
        can.alpha_composite(s.img, (int(round(gx - s.ax)), int(round(gy - s.ay))))
    for s in [s for s in items if s.top]:
        gx, gy = at(s)
        can.alpha_composite(s.img, (int(round(gx - s.ax)), int(round(gy - s.ay))))
    return can, origin
