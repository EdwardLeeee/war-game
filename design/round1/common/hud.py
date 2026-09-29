"""HUD overlay (HTML -> headless Chrome, capped) and the minimap image."""
import math
import random
import shutil
from pathlib import Path
from string import Template

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import compose
import config
import scene

UI = Path(__file__).resolve().parent / "ui"


def minimap(path, pal, size=366, seed=4):
    """Stylised overview of the whole map (diamond), not a copy of the screen.

    pal: bg, grass, grass2, forest, road, water, blue, red, neutral, frame, view, ink (bool)
    """
    S = size
    img = Image.new("RGBA", (S, S), pal["bg"])
    n = compose.value_noise(S, S, 40, seed=seed, octaves=3, stretch_y=1.0)
    rgb = compose.lerp_rgb(pal["grass"], pal["grass2"], n)
    base = compose.to_img(rgb)
    # diamond mask (isometric map)
    mask = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(mask)
    m = 10
    d.polygon([(S / 2, m), (S - m, S / 2), (S / 2, S - m), (m, S / 2)], fill=255)
    img.paste(base, (0, 0), mask)
    dr = ImageDraw.Draw(img)
    rnd = random.Random(seed)

    def mp(u, v):   # map coords (0..1, 0..1) -> diamond pixels
        return (S / 2 + (u - v) * (S / 2 - m), m + (u + v) * (S / 2 - m))
    # river from north to south through the middle, with a bridge
    pts = [mp(0.5 + 0.08 * math.sin(k / 3), k / 20) for k in range(21)]
    dr.line(pts, fill=pal["water"], width=int(S * 0.025))
    # forests
    for _ in range(26):
        u, v = rnd.random(), rnd.random()
        x, y = mp(u, v)
        r = rnd.uniform(S * 0.02, S * 0.045)
        dr.ellipse((x - r, y - r * 0.6, x + r, y + r * 0.6), fill=pal["forest"])
    # roads between bases and towns
    for a, b in [((0.15, 0.2), (0.5, 0.5)), ((0.5, 0.5), (0.85, 0.8)), ((0.15, 0.2), (0.3, 0.62)),
                 ((0.85, 0.8), (0.72, 0.3))]:
        dr.line([mp(*a), mp(*b)], fill=pal["road"], width=int(S * 0.012))
    # bases (squares) and towns (circles)
    def base_icon(u, v, col):
        x, y = mp(u, v)
        r = S * 0.035
        dr.rectangle((x - r, y - r, x + r, y + r), fill=col, outline=pal["frame"], width=2)
    def town(u, v, col, ring=None):
        x, y = mp(u, v)
        r = S * 0.022
        dr.ellipse((x - r, y - r, x + r, y + r), fill=col, outline=ring or pal["frame"], width=2)
    base_icon(0.15, 0.2, pal["blue"])
    base_icon(0.85, 0.8, pal["red"])
    town(0.3, 0.3, pal["blue"])
    town(0.5, 0.5, pal["neutral"])
    town(0.72, 0.3, pal["red"])
    town(0.3, 0.62, pal["ruin"])
    town(0.62, 0.78, pal["neutral"])
    # armies as dots
    for cx, cy, col, k in [(0.36, 0.33, pal["blue"], 16), (0.42, 0.36, pal["red"], 14), (0.18, 0.24, pal["blue"], 5),
                           (0.8, 0.72, pal["red"], 6)]:
        for _ in range(k):
            x, y = mp(cx + rnd.uniform(-0.03, 0.03), cy + rnd.uniform(-0.03, 0.03))
            dr.rectangle((x - 2, y - 2, x + 2, y + 2), fill=col)
    # camera frame (the part of the map on screen)
    v = scene.MINIMAP_VIEW
    corners = [mp(v["x"], v["y"]), mp(v["x"] + v["w"], v["y"]), mp(v["x"] + v["w"], v["y"] + v["h"]),
               mp(v["x"], v["y"] + v["h"])]
    dr.polygon(corners, outline=pal["view"], width=3)
    # attack alert ping on the enemy-governed town
    x, y = mp(0.72, 0.3)
    for r in (14, 22):
        dr.ellipse((x - r, y - r, x + r, y + r), outline=pal["alert"], width=2)
    if pal.get("post"):
        img = pal["post"](img)
    img.save(path)
    return path


def render(opt_dir, skin, body_class, minimap_png, portrait_png, out_png):
    """Fill the HUD template, copy assets next to it, screenshot with Chrome."""
    opt_dir = Path(opt_dir)
    work = opt_dir / "hud"
    work.mkdir(parents=True, exist_ok=True)
    shutil.copy(UI / skin, work / skin)
    shutil.copy(minimap_png, work / "minimap.png")
    shutil.copy(portrait_png, work / "portrait.png")
    html = Template((UI / "hud.html").read_text()).substitute(
        skin=skin, body_class=body_class, minimap="minimap.png", portrait="portrait.png")
    page = work / "hud.html"
    page.write_text(html)
    t = config.chrome_screenshot(page, out_png)
    print(f"hud rendered in {t:.1f}s -> {out_png}")
    return out_png


def portrait(sprite_rgba, out, size=138, bg=(26, 36, 38), top_frac=0.62, zoom=1.0, focus_y=0.0):
    """Crop the upper body of a character sprite into a square portrait."""
    bb = sprite_rgba.getbbox()
    im = sprite_rgba.crop(bb)
    h = int(im.height * top_frac)
    crop = im.crop((0, int(focus_y * im.height), im.width, int(focus_y * im.height) + h))
    side = max(crop.width, crop.height)
    sq = Image.new("RGBA", (side, side), (*bg, 255))
    sq.alpha_composite(crop, ((side - crop.width) // 2, side - crop.height))
    sq = sq.resize((size, size), Image.LANCZOS)
    sq.save(out)
    return out
