"""2D compositing shared by every option: noise, sprite placement, recolour,
cairo<->PIL conversion, glow. Screen units are points; images are at SCALE."""
import json
import math
from pathlib import Path

import cairo
import numpy as np
from PIL import Image, ImageFilter

import config

S = config.SCALE
W, H = config.SCREEN_W * S, config.SCREEN_H * S


# ------------------------------------------------------------------ noise

def value_noise(w, h, cell, seed=0, octaves=4, persistence=0.5, stretch_y=0.5):
    """Smooth fractal value noise in [0,1]; stretch_y<1 flattens features onto the ground plane."""
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    amp, total = 1.0, 0.0
    for o in range(octaves):
        c = max(2, cell / (2 ** o))
        gw = int(w / c) + 3
        gh = int(h / (c * stretch_y)) + 3
        grid = rng.random((gh, gw)).astype(np.float32)
        img = Image.fromarray((grid * 255).astype(np.uint8)).resize(
            (int(gw * c), int(gh * c * stretch_y)), Image.BICUBIC)
        a = np.asarray(img, np.float32)[:h, :w] / 255.0
        out += a * amp
        total += amp
        amp *= persistence
    return out / total


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def lerp_rgb(a, b, t):
    t = t[..., None]
    return np.asarray(a, np.float32) * (1 - t) + np.asarray(b, np.float32) * t


def to_img(rgb, alpha=None):
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    if alpha is None:
        return Image.fromarray(rgb, "RGB").convert("RGBA")
    a = np.clip(alpha * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack([rgb, a]), "RGBA")


def ellipse_mask(cx, cy, rx, ry, noise=None, soft=0.15, amount=0.35):
    """Mask of a ground ellipse (pt units) with a ragged edge from `noise`."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    d = np.sqrt(((xx / S - cx) / rx) ** 2 + ((yy / S - cy) / ry) ** 2)
    if noise is not None:
        d = d + (noise - 0.5) * amount
    return 1 - smoothstep(1 - soft, 1 + soft, d)


def polyline_mask(points, width_pt, noise=None, amount=0.5):
    img = Image.new("L", (W, H), 0)
    from PIL import ImageDraw
    dr = ImageDraw.Draw(img)
    pts = [(x * S, y * S) for x, y in points]
    dr.line(pts, fill=255, width=int(width_pt * S), joint="curve")
    for x, y in pts:
        r = width_pt * S / 2
        dr.ellipse((x - r, y - r, x + r, y + r), fill=255)
    img = img.filter(ImageFilter.GaussianBlur(width_pt * S * 0.25))
    m = np.asarray(img, np.float32) / 255
    if noise is not None:
        m = smoothstep(0.35, 0.65, m + (noise - 0.5) * amount)
    return m


# ------------------------------------------------------------------ sprites

class Sprite:
    def __init__(self, img, anchor):
        self.img = img
        self.anchor = anchor


def load(dirpath, key, pas):
    d = Path(dirpath)
    meta = json.loads((d / f"{key}.json").read_text())
    img = Image.open(d / f"{key}_{pas}.png").convert("RGBA")
    return Sprite(img, tuple(meta["anchor"]))


def place(canvas, sprite, x_pt, y_pt, flip=False, scale=1.0, opacity=1.0):
    img = sprite.img
    ax, ay = sprite.anchor
    if flip:
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
        ax = img.width - ax
    if scale != 1.0:
        img = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.LANCZOS)
        ax, ay = ax * scale, ay * scale
    if opacity < 1:
        a = np.asarray(img, np.float32)
        a[..., 3] *= opacity
        img = Image.fromarray(a.astype(np.uint8), "RGBA")
    canvas.alpha_composite(img, (int(round(x_pt * S - ax)), int(round(y_pt * S - ay))))


def recolor(beauty, mask, team_rgb, ref=0.62, keep=0.0):
    """Replace grey team parts with the player colour, keeping their shading."""
    b = np.asarray(beauty, np.float32)
    m = np.asarray(mask.convert("RGBA"), np.float32)
    k = (m[..., 0] / 255.0) * (m[..., 3] / 255.0)
    lum = (0.299 * b[..., 0] + 0.587 * b[..., 1] + 0.114 * b[..., 2]) / 255.0
    shade = np.clip(lum / ref, 0, 1.6)[..., None]
    team = np.asarray(team_rgb, np.float32)[None, None, :]
    # bright highlights drift toward white, shadows stay saturated
    col = team * np.minimum(shade, 1.0) + (255 - team) * np.clip(shade - 1.0, 0, 1) * 0.6
    out = b.copy()
    out[..., :3] = b[..., :3] * (1 - k[..., None]) + col * k[..., None]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")


def load_shadow(dirpath, key, color=(28, 34, 52), strength=0.8, blur_px=2.0):
    """Shadow pass is rendered at half size without denoising: scale up, soften."""
    sp = load(dirpath, key, "shadow")
    img = sp.img.resize((sp.img.width * 2, sp.img.height * 2), Image.BILINEAR)
    img = img.filter(ImageFilter.GaussianBlur(blur_px))
    return Sprite(shadow_from(img, color, strength), sp.anchor)


def shadow_from(sprite_img, color=(28, 34, 52), strength=0.55):
    a = np.asarray(sprite_img, np.float32)[..., 3] / 255.0 * strength
    h, w = a.shape
    rgb = np.empty((h, w, 3), np.float32)
    rgb[:] = color
    return to_img(rgb, a)


# ------------------------------------------------------------------ cairo

def cairo_layer(w=W, h=H):
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, w, h)
    ctx = cairo.Context(surf)
    ctx.scale(S, S)
    return surf, ctx


def cairo_to_pil(surf):
    surf.flush()
    w, h = surf.get_width(), surf.get_height()
    buf = np.ndarray((h, surf.get_stride() // 4, 4), np.uint8, surf.get_data())[:, :w, :]
    bgra = buf.astype(np.float32)
    a = bgra[..., 3:4] / 255.0
    rgb = np.where(a > 0, bgra[..., 2::-1] / np.maximum(a, 1e-6), 0)
    out = np.dstack([np.clip(rgb, 0, 255), bgra[..., 3]]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def add_glow(canvas, layer, radius_pt=6, strength=1.0):
    """Additive bloom of `layer` (RGBA) onto canvas (RGBA, opaque)."""
    blur = layer.filter(ImageFilter.GaussianBlur(radius_pt * S))
    c = np.asarray(canvas, np.float32)
    g = np.asarray(blur, np.float32)
    add = g[..., :3] * (g[..., 3:4] / 255.0) * strength
    c[..., :3] = 255 - (255 - c[..., :3]) * (1 - np.clip(add / 255.0, 0, 1))   # screen blend
    return Image.fromarray(np.clip(c, 0, 255).astype(np.uint8), "RGBA")


def screen_blend(canvas, layer, strength=1.0):
    c = np.asarray(canvas, np.float32)
    g = np.asarray(layer, np.float32)
    add = g[..., :3] * (g[..., 3:4] / 255.0) * strength
    c[..., :3] = 255 - (255 - c[..., :3]) * (1 - np.clip(add / 255.0, 0, 1))
    return Image.fromarray(np.clip(c, 0, 255).astype(np.uint8), "RGBA")


def bezier_point(p0, p1, p2, t):
    return ((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
            (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1])


def arc_ctrl(x0, y0, x1, y1, lift):
    return ((x0 + x1) / 2, min(y0, y1) - lift)
