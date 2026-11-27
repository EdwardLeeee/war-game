"""R27 哨所轉向: the art-v7 outpost turned (design/b1/common/run.py r27y*, the camera turned so its lights stay put) put
on the real battlefield (scenes.mjs: the twin-rivers map, an iPhone 14 Pro Max in the app, 932 x 430 at 3x), as the
client draws a building (render/structure-art.ts): its picture's anchor on the footprint's middle, ptPerM / px_per_m
the scale, the team layer tinted with its owner's colour, its spearmen on the walk at the picture's stand marks
(outpost-crew.ts: facing out from the middle), the front layer over them. A faint 3 x 3 on the ground, its outline
dashed over everything.

Used by boards_r27.py: shot(scene, culture, yaw, ...) -> the phone screen (2796 x 1290) with the outpost on it.
"""
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
UI = HERE.parents[2]
R27 = UI / "design" / "b1" / "build" / "b1" / "r27"
BG = UI / "design" / "r27" / "build" / "bg"
UNITS = UI / "client" / "public" / "art" / "art-v7.11" / "x3" / "units"
BLUE = (52, 118, 224)          # ours (the client's own colour: the flags in its screenshots)
RED = (205, 52, 46)            # the enemy's
GOLD = (242, 200, 98)
PT_PER_M = 20.0                # client tuning: 20 pt a metre at zoom 1
SCENES = json.loads((BG / "scenes.json").read_text()) if (BG / "scenes.json").exists() else {}


def cam(yaw):
    """The render's camera for a facing: the diamond's az -45 turned by -yaw, elevation 30 (render_b1.py's RM)."""
    az = math.radians(-45 - yaw)
    e = math.radians(60)
    right = (math.cos(az), math.sin(az), 0.0)
    up = (-math.sin(az) * math.cos(e), math.cos(az) * math.cos(e), math.sin(e))
    return right, up


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def tinted(color, team, owner, gain=1.6):
    """The team layer (a greyscale picture, its alpha how much) tinted by the owner's colour, over the colour."""
    r, g, b, a = team.split()
    lum = Image.merge("RGB", (r, g, b)).convert("L")
    out = Image.merge("RGB", [lum.point(lambda v, c=c: min(255, int(v * c / 255 * gain))) for c in owner])
    layer = out.convert("RGBA")
    layer.putalpha(a)
    base = color.copy()
    base.alpha_composite(layer)
    return base


def building_layers(culture, yaw, owner=BLUE, fit=False, front=False):
    """(picture with its team colour, meta) of a render."""
    name = f"r27_{culture}_y{yaw:03d}{'fit' if fit else ''}{'_front' if front else ''}_x3"
    beauty = Image.open(R27 / f"{name}_beauty.png").convert("RGBA")
    mask = Image.open(R27 / f"{name}_mask.png").convert("RGBA")
    meta = json.loads((R27 / f"{name}.json").read_text())
    # the mask pass: white where the owner's colour goes (render_b1); as the atlas' team layer: the colour's grey, there
    mr, _, _, ma = mask.split()
    a = Image.composite(mr, Image.new("L", mask.size, 0), ma)
    team = beauty.copy()
    team.putalpha(a)
    return tinted(beauty, team, owner), meta


def shadow_layer(culture, yaw, fit=False):
    name = f"r27_{culture}_y{yaw:03d}{'fit' if fit else ''}_x3"
    return Image.open(R27 / f"{name}_shadow.png").convert("RGBA"), json.loads((R27 / f"{name}.json").read_text())


_ATLAS = {}


def unit_frame(unit, anim, facing, frame=0, owner=BLUE):
    """A unit's picture (colour with its team layer) and its anchor, from art-v7.11's atlas (x3, 60 px a metre)."""
    if unit not in _ATLAS:
        j = json.loads((UNITS / unit / f"{unit}.json").read_text())
        pages = {k: [Image.open(UNITS / unit / p).convert("RGBA") for p in v] for k, v in j["pages"].items() if v}
        _ATLAS[unit] = (j, pages)
    j, pages = _ATLAS[unit]
    mirrored = {int(k): v for k, v in j["facings"]["mirrored"].items()}
    src = mirrored.get(facing, facing)
    flip = facing in mirrored
    key = f"{unit}_{anim}_f{src}_{frame:02d}"
    fr = j["frames"][key]
    color = pages["color"][fr["page"]].crop((fr["x"], fr["y"], fr["x"] + fr["w"], fr["y"] + fr["h"]))
    ax, ay = fr["ax"], fr["ay"]
    tr = j["team"].get(key)
    if tr is not None:
        team = pages["team"][tr["page"]].crop((tr["x"], tr["y"], tr["x"] + tr["w"], tr["y"] + tr["h"]))
        full = Image.new("RGBA", color.size, (0, 0, 0, 0))
        full.alpha_composite(team, (round(ax - tr["ax"]), round(ay - tr["ay"])))
        color = tinted(color, full, owner, j.get("team_gain", 1.6))
    if flip:
        color = color.transpose(Image.FLIP_LEFT_RIGHT)
        ax = color.width - ax
    return color, (ax, ay), j["px_per_m"]


def facing_of(dx, dy):
    """The atlas facing for a screen direction (y down): f0 right, counterclockwise by 45 degrees (f2 up, f6 down)."""
    ang = math.degrees(math.atan2(-dy, dx)) % 360
    return int(round(ang / 45.0)) % 8


def paste_scaled(dst, im, at, anchor, k):
    """Paste `im` scaled by k with its anchor at `at` (dst px)."""
    w, h = max(1, round(im.width * k)), max(1, round(im.height * k))
    s = im.resize((w, h), Image.LANCZOS)
    dst.alpha_composite(s, (round(at[0] - anchor[0] * k), round(at[1] - anchor[1] * k)))


def dashed(d, a, b, fill, width, dash=14, gap=9):
    L = math.dist(a, b)
    if L == 0:
        return
    ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
    t = 0.0
    while t < L:
        e = min(L, t + dash)
        d.line([(a[0] + ux * t, a[1] + uy * t), (a[0] + ux * e, a[1] + uy * e)], fill=fill, width=width)
        t = e + gap


def arrow(d, tail, head, fill, width=12, outline=(40, 26, 10, 230)):
    """A ground arrow from tail to head (screen px)."""
    L = math.dist(tail, head)
    ux, uy = (head[0] - tail[0]) / L, (head[1] - tail[1]) / L
    nx, ny = -uy, ux
    hl, hw = width * 2.4, width * 1.9
    base = (head[0] - ux * hl, head[1] - uy * hl)
    tri = [head, (base[0] + nx * hw, base[1] + ny * hw), (base[0] - nx * hw, base[1] - ny * hw)]
    d.line([tail, base], fill=outline, width=width + 8)
    d.polygon(tri, fill=outline)
    d.line([tail, base], fill=fill, width=width)
    tri2 = [(head[0] - ux * 5, head[1] - uy * 5), (base[0] + nx * (hw - 5), base[1] + ny * (hw - 5)), (base[0] - nx * (hw - 5), base[1] - ny * (hw - 5))]
    d.polygon(tri2, fill=fill)


FACING = {0: (1, 0), 45: (1, -1), 90: (0, -1), 135: (-1, -1), 180: (-1, 0), 225: (-1, 1), 270: (0, 1), 315: (1, 1)}   # grid x east, y south


def ground_vec(scene, gx, gy):
    """Screen px (at 3x) of a ground step of (gx, gy) cells from the footprint's middle."""
    s = SCENES[scene]
    c = (s["centre"]["x"], s["centre"]["y"])
    ex = (s["east"]["x"] - c[0], s["east"]["y"] - c[1])
    sy = (s["south"]["x"] - c[0], s["south"]["y"] - c[1])
    k = s["dpr"]
    return ((gx * ex[0] + gy * sy[0]) * k, (gx * ex[1] + gy * sy[1]) * k)


def shot(scene, culture, yaw, owner=BLUE, crew=5, fit=False, grid=True, show_arrow=True, ghost=None, extra=None, outline=True):
    """The phone screen of `scene` with the outpost of `culture` facing `yaw` on it; ghost: a placement preview's alpha.
    extra(img, centre, ppx): more drawn after the outpost (a soldier beside it)."""
    s = SCENES[scene]
    k = s["dpr"]
    img = Image.open(BG / f"bg-{scene}.png").convert("RGBA")
    centre = (s["centre"]["x"] * k, s["centre"]["y"] * k)
    ppx = PT_PER_M * s["zoom"] * k                          # screen px a metre
    corners = [(p["x"] * k, p["y"] * k) for p in s["corners"]]
    over = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    if ghost is not None:                                   # the client's placement look: the cells lit green
        d.polygon(corners, fill=(90, 220, 110, 70), outline=(120, 255, 140, 200))
        img.alpha_composite(over)
        over = Image.new("RGBA", img.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(over)
    elif grid:                                              # a faint 3 x 3 on the ground
        for a, b, c2, e in s["grid"]:
            for p, q in ((a, b), (c2, e)):
                d.line([(p["x"] * k, p["y"] * k), (q["x"] * k, q["y"] * k)], fill=(255, 240, 170, 70), width=3)
        img.alpha_composite(over)
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sh, sm = shadow_layer(culture, yaw, fit)
    paste_scaled(layer, sh, centre, sm["shadow_anchor"], ppx / 30.0)     # the shadow pass at half the size: 30 px a metre
    pic, meta = building_layers(culture, yaw, owner, fit)
    paste_scaled(layer, pic, centre, meta["anchor"], ppx / meta["px_per_m"])
    if crew:
        right, up = cam(yaw)
        marks = sorted((v for n, v in meta.get("marks", {}).items() if n.startswith("stand_at_")), key=lambda v: 0)
        spots = [meta["marks"][f"stand_at_{i}"] for i in range(min(crew, 9)) if f"stand_at_{i}" in meta["marks"]]
        del marks
        men = []
        for p in spots:
            x = centre[0] + dot(p, right) * ppx
            y = centre[1] - dot(p, up) * ppx
            gx = centre[0] + dot((p[0], p[1], 0.0), right) * ppx      # its foot's direction from the middle, on the ground
            gy = centre[1] - dot((p[0], p[1], 0.0), up) * ppx
            men.append((y, x, facing_of(gx - centre[0], gy - centre[1])))
        unit = "spear_e" if culture == "E" else "pike_w"
        for y, x, f in sorted(men):
            im, anc, upm = unit_frame(unit, "idle", f, 0, owner)
            paste_scaled(layer, im, (x, y), anc, ppx / upm)
        fr, fm = building_layers(culture, yaw, owner, fit, front=True)
        paste_scaled(layer, fr, centre, fm["anchor"], ppx / fm["px_per_m"])
    if ghost is not None:
        r, g, b, a = layer.split()
        layer.putalpha(a.point(lambda v: int(v * ghost)))
    img.alpha_composite(layer)
    if extra is not None:
        extra(img, centre, ppx)
    top = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(top)
    if outline:
        for i in range(4):
            dashed(d, corners[i], corners[(i + 1) % 4], (255, 236, 150, 170), 4)
    if show_arrow:
        # the passage: the way through it, both ways (its two faces are alike: which way it "faces" shows only in its flag)
        fx, fy = FACING[yaw]
        n = math.hypot(fx, fy)
        for sgn in (1, -1):
            t = ground_vec(scene, sgn * fx / n * 2.1, sgn * fy / n * 2.1)
            h = ground_vec(scene, sgn * fx / n * 3.4, sgn * fy / n * 3.4)
            arrow(d, (centre[0] + t[0], centre[1] + t[1]), (centre[0] + h[0], centre[1] + h[1]), GOLD + (255,), width=10)
    img.alpha_composite(top)
    return img, centre


def crop_round(img, centre, w=1560, h=930, up=0.58):
    """A crop round the outpost (more above it than below: its picture stands up)."""
    x0 = int(min(max(0, centre[0] - w / 2), img.width - w))
    y0 = int(min(max(0, centre[1] - h * up), img.height - h))
    return img.crop((x0, y0, x0 + w, y0 + h)), (x0, y0)
