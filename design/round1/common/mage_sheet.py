"""Shared helpers for the 3D options (B, C): turn the Blender mage passes into
final frames (GIF contract of gif.py) and the 8-direction sheet."""
import json
import math
from pathlib import Path

import cairo
from PIL import Image, ImageDraw

import artboard
import compose
import config
import gif

MAGE = config.BUILD / "3d" / "mage"
DIR_NAMES = ["→ 右", "↗ 右後", "↑ 後", "↖ 左後", "← 左", "↙ 左前", "↓ 前", "↘ 右前"]
KEY_POSES = [("idle", 3, "待機"), ("walk", 3, "走路"), ("cast", 20, "晶砲校準"), ("dead", 0, "陣亡")]


def write_frames(process, out_dir):
    """process(dirpath, key) -> RGBA frame (same size and anchor as the pass images)."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    for anim, n in gif.MAGE_FRAMES:
        for f in range(n):
            k = f"{anim}_{f:02d}"
            img = process(MAGE / "anim", k)
            img.save(out_dir / f"{k}.png")
            meta = json.loads((MAGE / "anim" / f"{k}.json").read_text())
            (out_dir / f"{k}.json").write_text(json.dumps({"anchor": meta["anchor"]}))
    return out_dir


def ring_drawer(color=(1.0, 0.42, 0.25), crystal=(0.35, 0.95, 1.0), ink=False):
    """Warning circle ahead of the mage in the 4x GIF panel during the cast."""
    def draw(panel, anim, f):
        if anim != "cast" or f < 6:
            return
        e = min(1.0, (f - 6) / 6)
        surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, panel.width, panel.height)
        ctx = cairo.Context(surf)
        cx, cy, rx = panel.width * 0.86, panel.height * 0.72, 62
        ctx.translate(cx, cy)
        ctx.scale(1, 0.5)
        ctx.set_source_rgba(*color, 0.18 * e)
        ctx.arc(0, 0, rx, 0, 2 * math.pi)
        ctx.fill()
        ctx.set_source_rgba(*color, 0.95 * e)
        ctx.set_line_width(4)
        if ink:
            ctx.set_dash([18, 5, 6, 5])
        ctx.arc(0, 0, rx, 0, 2 * math.pi)
        ctx.stroke()
        ctx.set_dash([])
        ctx.set_source_rgba(*crystal, 0.9 * e)
        ctx.set_line_width(2.5)
        ctx.arc(0, 0, rx * 0.7, 0, 2 * math.pi)
        ctx.stroke()
        if f >= 27:   # impact flash
            k = (f - 26) / 4
            g = cairo.RadialGradient(0, 0, 0, 0, 0, rx * 1.2)
            g.add_color_stop_rgba(0, 1, 1, 1, 0.9 * (1 - k * 0.5))
            g.add_color_stop_rgba(0.5, *crystal, 0.6 * (1 - k * 0.5))
            g.add_color_stop_rgba(1, *crystal, 0)
            ctx.set_source(g)
            ctx.arc(0, 0, rx * 1.2, 0, 2 * math.pi)
            ctx.fill()
        panel.alpha_composite(compose.cairo_to_pil(surf))
    return draw


def dirs_sheet(process, background, label, out_png, note):
    cw, ch = 272, 256
    W = 40 + 150 + 8 * (cw + 8)
    H = 170 + 4 * (ch + 8) + 60
    can = Image.new("RGB", (W, H), (244, 241, 234))
    d = ImageDraw.Draw(can)
    d.text((40, 30), label, font=artboard.font(40), fill=(30, 30, 34))
    d.text((40, 88), note, font=artboard.font(24, weight="regular"), fill=(110, 110, 110))
    for c, name in enumerate(DIR_NAMES):
        d.text((40 + 150 + c * (cw + 8) + 10, 132), name, font=artboard.font(26), fill=(30, 30, 34))
    for r, (anim, f, cap) in enumerate(KEY_POSES):
        y = 170 + r * (ch + 8)
        d.text((40, y + ch // 2 - 16), cap, font=artboard.font(28), fill=(30, 30, 34))
        for c in range(8):
            k = f"f{c}_{anim}{f:02d}"
            img = process(MAGE / "dirs", k)
            meta = json.loads((MAGE / "dirs" / f"{k}.json").read_text())
            ax, ay = meta["anchor"]
            cell = Image.new("RGBA", (cw, ch))
            cell.alpha_composite(gif.cover(background, cw, ch))
            if anim == "dead":        # lying body: centre its bounding box in the cell
                bb = img.getbbox()
                ax, ay = (bb[0] + bb[2]) / 2, bb[3] - (ch * 0.78 - ch * 0.62)
            cell.alpha_composite(img, (int(cw / 2 - ax), int(ch * 0.78 - ay)))
            can.paste(cell.convert("RGB"), (40 + 150 + c * (cw + 8), y))
    can.save(out_png)
    return out_png
