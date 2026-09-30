"""A 彩繪桌遊: bright painted ground (noon grass, trampled dirt, road, flowers)."""
import math
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "common"))

import cairo                       # noqa: E402
import numpy as np                 # noqa: E402
from PIL import Image, ImageFilter  # noqa: E402

import compose   # noqa: E402
import scene     # noqa: E402

S = compose.S
W, H = compose.W, compose.H
OUT_C = (0.17, 0.11, 0.07)


def ground(seed=1):
    n1 = compose.value_noise(W, H, 260, seed=seed, octaves=3)
    n2 = compose.value_noise(W, H, 70, seed=seed + 1, octaves=2)
    rgb = compose.lerp_rgb((122, 184, 72), (160, 208, 92), compose.smoothstep(0.3, 0.7, n1))
    # painted patches: lighter and darker blobs with soft but visible edges
    rgb = compose.lerp_rgb(rgb, (176, 216, 104), compose.smoothstep(0.62, 0.68, n2) * 0.55)
    rgb = compose.lerp_rgb(rgb, (104, 164, 62), compose.smoothstep(0.34, 0.28, n2) * 0.5)
    edge = compose.value_noise(W, H, 36, seed=seed + 3, octaves=2)
    bf = scene.BATTLEFIELD
    m_bf = compose.ellipse_mask(bf["x"], bf["y"], bf["rx"], bf["ry"], edge, soft=0.06, amount=0.45)
    m_road = compose.polyline_mask(scene.PATHS[0], 15, edge, amount=0.5)
    pads = [compose.ellipse_mask(cx, cy, rx, ry, edge, soft=0.08, amount=0.35) for cx, cy, rx, ry in
            [(258, 274, 58, 28), (706, 128, 112, 50), (110, 192, 150, 60), (792, 194, 40, 20)]]
    m_pad = np.clip(sum(pads), 0, 1)
    dirt_n = compose.value_noise(W, H, 24, seed=seed + 5, octaves=2)
    dirt = compose.lerp_rgb((206, 164, 104), (226, 190, 128), dirt_n)
    dirt = compose.lerp_rgb(dirt, (186, 142, 88), compose.smoothstep(0.6, 0.66, n2) * 0.6)
    rgb = compose.lerp_rgb(rgb, dirt, m_bf)
    rgb = compose.lerp_rgb(rgb, (232, 204, 146), np.clip(m_road + m_pad, 0, 1))
    img = compose.to_img(rgb)
    # darker rim where dirt meets grass (painted outline, broken)
    all_dirt = np.clip(m_bf + m_road + m_pad, 0, 1)
    rim = compose.smoothstep(0.3, 0.5, all_dirt) * (1 - compose.smoothstep(0.5, 0.75, all_dirt))
    brk = compose.smoothstep(0.35, 0.55, compose.value_noise(W, H, 14, seed=seed + 7, octaves=1))
    a = np.clip(rim * 1.6 * brk, 0, 1) * 0.55
    col = np.empty((H, W, 3), np.float32)
    col[:] = (126, 92, 48)
    img.alpha_composite(compose.to_img(col, a))
    # grass strokes, pebbles, flowers
    rnd = random.Random(seed + 11)
    surf, ctx = compose.cairo_layer()
    grassy = 1 - all_dirt
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    for _ in range(2600):
        x, y = rnd.uniform(0, W / S), rnd.uniform(0, H / S)
        if grassy[min(H - 1, int(y * S)), min(W - 1, int(x * S))] < 0.6:
            continue
        dark = rnd.random() < 0.65
        ctx.set_source_rgba(*((0.3, 0.52, 0.18) if dark else (0.78, 0.9, 0.48)), 0.8)
        ctx.set_line_width(0.55)
        h = rnd.uniform(1.6, 3.0)
        ctx.move_to(x - 0.9, y)
        ctx.curve_to(x - 0.9, y - h * 0.6, x - 0.4, y - h, x - 0.2, y - h)
        ctx.move_to(x + 0.3, y)
        ctx.curve_to(x + 0.4, y - h * 0.5, x + 0.9, y - h * 0.8, x + 1.3, y - h * 0.9)
        ctx.stroke()
    for _ in range(320):
        x, y = rnd.uniform(0, W / S), rnd.uniform(0, H / S)
        if grassy[min(H - 1, int(y * S)), min(W - 1, int(x * S))] < 0.9:
            continue
        col = rnd.choice([(1, 1, 0.96), (1, 0.85, 0.25), (1, 0.62, 0.72)])
        for k in range(3):
            px, py = x + rnd.uniform(-2, 2), y + rnd.uniform(-1, 1)
            ctx.arc(px, py, 0.75, 0, 2 * math.pi)
            ctx.set_source_rgba(*OUT_C, 0.8)
            ctx.fill_preserve()
            ctx.set_source_rgba(*col, 1)
            ctx.arc(px, py, 0.5, 0, 2 * math.pi)
            ctx.fill()
    for _ in range(700):
        x, y = rnd.uniform(0, W / S), rnd.uniform(0, H / S)
        if all_dirt[min(H - 1, int(y * S)), min(W - 1, int(x * S))] < 0.8:
            continue
        r = rnd.uniform(0.5, 1.1)
        ctx.save()
        ctx.translate(x, y)
        ctx.scale(1, 0.65)
        ctx.arc(0, 0, r, 0, 2 * math.pi)
        ctx.restore()
        g = rnd.uniform(0.7, 0.85)
        ctx.set_source_rgba(g, g * 0.9, g * 0.8, 1)
        ctx.fill_preserve()
        ctx.set_source_rgba(*OUT_C, 0.7)
        ctx.set_line_width(0.3)
        ctx.stroke()
    # footprints and hoof marks on the battlefield
    for _ in range(160):
        x, y = rnd.uniform(bf["x"] - 200, bf["x"] + 200), rnd.uniform(bf["y"] - 80, bf["y"] + 80)
        if m_bf[min(H - 1, int(y * S)), min(W - 1, int(x * S))] < 0.9:
            continue
        ctx.save()
        ctx.translate(x, y)
        ctx.scale(1.2, 0.6)
        ctx.arc(0, 0, 0.9, 0, 2 * math.pi)
        ctx.restore()
        ctx.set_source_rgba(0.62, 0.45, 0.27, 0.55)
        ctx.fill()
    img.alpha_composite(compose.cairo_to_pil(surf))
    return img
