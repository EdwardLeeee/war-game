"""World effects drawn by the game itself (client/docs/sprite-atlas.md, section 11).

python3 common/effects.py [--scale 3]
-> build/effects_x<scale>/effects.json, effects_0.png      format "war-game effects 1"

dust   the puff of dust under a unit when its body hits the ground (a fall's `impact` frame):
       6 frames at 12 a second, drawn at the size of an ordinary foot soldier; the game scales it
       by the animation's `impact_scale` for cavalry and siege engines. Anchor: its centre on the
       ground. No facings, no player colour, no shadow. Provisional until the user has seen P2.

The frames are generated here (no Blender): soft round puffs that start in a tight ring at the
ground point, roll outward along the ground (the ring is twice as wide as it is deep, like every
ground circle in this camera), rise a little, grow and fade. Fixed seed: the same pixels every run.

warn_sigil, warn_sigil_gold, warn_sigil_glow, warn_fill, warn_rim, warn_core   the 晶砲 warning circle B 符文漸強
       (D-041), as six still images the game puts together, turns and fades (design/b1/README.md, 「給 client：晶砲預警圈 B」;
       ceo and client 2026-10-18): drawn top-down and round by design/b1/common/warn.py, one frame each; the
       game squashes them to the ground (scale.y 0.5) and scales them by the sim's radius / `radius_m`.
       Anchor: the centre.

tower_shot   D-096: a gate tower looses an arrow (the sim's `shot` event from a gate): a short warm glint where the
       arrow leaves, so the eye finds the tower that shot; the game draws the arrow itself, as for the main city and the
       arrow tower. 5 frames at 20 a second, about 1.5 m across at its widest; drawn at the gate piece's
       `shoot_at_<k>` point (castle_<c>.json, the one nearest the target). Anchor: the centre. No facings, no shadow.

siege_stone, siege_stone_shadow, siege_hit_ground, siege_hit_building, siege_crater   D-099 (art-v6): the stone of the
       霹靂車 and the 投石機 (the sim's `siege_shot` event: u, x, y, lands, and `from` when the engine is out of sight).
       The game draws the flight itself: the stone leaves on the engine's attack `hit` frame from `from_m` (this entry,
       per unit: the unit's own space, x right, y forward, z up, metres, as the sling's stone_from_m; mirrored facings
       flip x), or, with `from`, from 14 m away in that direction (the middle of the 3-10 cell range) out of sight;
       it lands on (x, y) at tick `lands` (1 s); its path an arc whose top is `arc_m` + `arc_k` x the distance above
       the straight line. siege_stone: 4 frames looping (it tumbles), 0.6 m across, anchor its centre; drawn with
       siege_stone_shadow on the ground under it (anchor its centre; fainter and smaller the higher the stone). At
       the landing: siege_hit_ground on open ground, siege_hit_building where a building, a wall or a gate stands
       (anchor the landing point on the ground; drawn at its size: the burst reaches the impact radius, 1 cell), and
       siege_crater under it (top_down, radius_m), faded out over `crater_s` seconds.
"""
import argparse
import json
import math
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(1, str(HERE.parents[1] / "b1" / "common"))
import config  # noqa: E402
import spec    # noqa: E402
import warn    # noqa: E402  (design/b1/common: the warning circle's drawing)
from postprocess import Packer  # noqa: E402

DUST_FRAMES = 6
DUST_FPS = 12
DUST_COLOUR = (226, 212, 180)        # dry earth, lighter than the ground it rises from
DUST_SHADE = (168, 150, 118)         # the underside of a puff


def _puff(size, seed, colour=DUST_COLOUR, shade_colour=DUST_SHADE):
    """One soft, slightly lumpy puff (RGBA), size px across, lit from above (colour) and darker underneath."""
    rnd = random.Random(seed)
    n = size * 2                      # supersampled
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    a = np.zeros((n, n), np.float32)
    for _ in range(5):                # a few overlapping lobes
        cx = n / 2 + rnd.uniform(-0.16, 0.16) * n
        cy = n / 2 + rnd.uniform(-0.12, 0.12) * n
        r = rnd.uniform(0.22, 0.34) * n
        d = np.hypot(xx - cx, (yy - cy) * 1.15) / r
        a = np.maximum(a, np.clip(1 - d, 0, 1) ** 0.8)
    shade = np.clip((yy / n - 0.35) * 1.4, 0, 1)[..., None]          # darker toward the bottom
    rgb = np.array(colour, np.float32) * (1 - shade) + np.array(shade_colour, np.float32) * shade
    img = np.dstack([rgb, (a * 255)[..., None]]).astype(np.uint8)
    return Image.fromarray(img, "RGBA").resize((size, size), Image.LANCZOS)


def dust_frames(scale=3.0, seed=7):
    """[(image, (anchor x, anchor y))]: the six dust frames at `scale` pixels per point."""
    ppm = spec.PX_PER_M * scale / 3.0            # pixels per metre on the ground
    rnd = random.Random(seed)
    n = 18             # every third puff stays near the middle, so the cloud has no hole
    puffs = [dict(angle=2 * math.pi * (k + rnd.uniform(-0.3, 0.3)) / n,
                  speed=rnd.uniform(0.15, 0.5) if k % 3 == 0 else rnd.uniform(0.65, 1.15),
                  size=rnd.uniform(0.55, 0.85), rise=rnd.uniform(0.1, 0.34), seed=seed * 100 + k)
             for k in range(n)]
    W, H = int(3.4 * ppm), int(2.0 * ppm)
    ax, ay = W / 2, H * 0.68
    out = []
    for f in range(DUST_FRAMES):
        t = f / (DUST_FRAMES - 1)
        can = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        spread = 0.10 + 0.80 * (1 - (1 - t) ** 2)            # metres from the ground point, slowing down
        fade = (1 - f / DUST_FRAMES) ** 1.15 * 0.95           # the last frame is faint, not empty
        # far puffs first, near ones over them
        for p in sorted(puffs, key=lambda q: math.sin(q["angle"])):
            r = spread * p["speed"]
            x = ax + math.cos(p["angle"]) * r * ppm
            y = ay + math.sin(p["angle"]) * r * ppm * 0.5 - p["rise"] * t * ppm
            size = max(4, int(p["size"] * (0.7 + 0.9 * t) * ppm))
            puff = _puff(size, p["seed"])
            al = puff.getchannel("A").point(lambda v, k=fade: int(v * k))
            puff.putalpha(al)
            can.alpha_composite(puff, (int(x - size / 2), int(y - size * 0.62)))
        can = can.filter(ImageFilter.GaussianBlur(0.6 * scale / 3.0))
        out.append((can, (ax, ay)))
    return out


SHOT_FRAMES = 5
SHOT_FPS = 20
SHOT_CORE = (255, 251, 232)
SHOT_RAY = (255, 230, 160)
SHOT_GLOW = (255, 168, 60)           # behind it all: keeps the glint visible on the pale paving inside the walls
SHOT_RING = (244, 226, 176)          # the client's arrow colour (render/world.ts drawShots)


def shot_frames(scale=3.0):
    """[(image, (anchor x, anchor y))]: the gate tower's glint, frame by frame at `scale` pixels per point: a star of
    eight rays (long and short) round a bright core with a warm glow behind, a ring spreading out; the last frame faint,
    not empty."""
    ppm = spec.PX_PER_M * scale / 3.0
    k = 4                                            # supersampled, then reduced
    S = int(1.8 * ppm) * k
    c = S / 2
    m = ppm * k
    out = []
    for f in range(SHOT_FRAMES):
        t = f / (SHOT_FRAMES - 1)
        fade = max(0.22, (1 - t) ** 1.1)
        glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        rg = (0.28 + 0.12 * t) * m
        ImageDraw.Draw(glow).ellipse([c - rg, c - rg, c + rg, c + rg], fill=(*SHOT_GLOW, int(150 * fade)))
        can = glow.filter(ImageFilter.GaussianBlur(0.12 * m))
        d = ImageDraw.Draw(can)
        if f > 0:                                    # the ring of the twang, spreading and thinning
            r = (0.18 + 0.55 * t) * m
            w = max(1, int((0.06 - 0.03 * t) * m))
            d.ellipse([c - r, c - r * 0.8, c + r, c + r * 0.8], outline=(*SHOT_RING, int(210 * fade)), width=w)
        for i in range(8):
            a = math.radians(22.5 + 45 * i)
            long_ = i % 2 == 0
            r0 = (0.04 + 0.22 * t) * m
            r1 = (0.42 + 0.4 * t) * m * (1.0 if long_ else 0.6)
            hw = 0.055 * (1 - 0.5 * t) * m
            ca, sa = math.cos(a), math.sin(a) * 0.8
            px, py = -math.sin(a), math.cos(a)
            pts = [(c + ca * r0 + px * hw, c + sa * r0 + py * hw), (c + ca * r1, c + sa * r1),
                   (c + ca * r0 - px * hw, c + sa * r0 - py * hw)]
            d.polygon(pts, fill=(*SHOT_RAY, int(255 * fade)))
        rc = 0.13 * (1 - 0.6 * t) * m
        d.ellipse([c - rc, c - rc, c + rc, c + rc], fill=(*SHOT_CORE, int(255 * fade)))
        can = can.filter(ImageFilter.GaussianBlur(0.4 * k * scale / 3.0)).resize((S // k, S // k), Image.LANCZOS)
        out.append((can, (S / k / 2, S / k / 2)))
    return out


# ---------------------------------------------------------------- D-099 the siege stone and its impacts

SIEGE_FROM_M = {"siege_e": [0.0, -0.5, 5.4], "siege_w": [0.0, 0.8, 5.2]}   # the arm's tip at release (measured on the
# R8 renders, 2026-10-23: the topmost moving pixels of the attack frames, side and front views agreeing)
STONE_FRAMES, STONE_FPS = 4, 12
HIT_FRAMES, HIT_FPS = 10, 15
ROCK = (112, 104, 92)                # the stone: the cliffs' weathered sandstone, as the sun leaves it
EARTH_DUST = (184, 170, 144)         # dry earth thrown up as dust: paler than the R8 ground it rises from
EARTH_SHADE = (128, 114, 92)
STONE_DUST = (170, 165, 155)         # plaster and stone dust off a building
STONE_SHADE = (122, 116, 108)
CLOD = (70, 60, 46)
SPLINTER = (96, 70, 44)


def _rock_image(size, seed, angle):
    """A broken stone, lit from the upper left like the sprites (R7 rig): a lumpy outline, a shaded body, a few
    darker pits; rotated by `angle` (degrees) for the tumble."""
    rnd = random.Random(seed)
    k = 4
    n = size * k
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    c = n / 2
    a = np.arctan2(yy - c, xx - c)
    r = np.hypot(xx - c, yy - c) / (n * 0.42)
    m = rnd.randint(9, 12)                      # an angular outline: a polygon of broken faces
    angs = sorted(rnd.uniform(0, 2 * math.pi) for _ in range(m))
    rads = [rnd.uniform(0.84, 1.0) for _ in range(m)]
    pts = [(c + n * 0.42 * rr * math.cos(t), c + n * 0.42 * rr * math.sin(t) * 0.88) for t, rr in zip(angs, rads)]
    mask = Image.new("L", (n, n), 0)
    ImageDraw.Draw(mask).polygon(pts, fill=255)
    inside = np.asarray(mask) > 127
    nx, ny = (xx - c) / (n * 0.42), (yy - c) / (n * 0.42)
    nz = np.sqrt(np.clip(1 - nx ** 2 - ny ** 2, 0, 1))
    light = np.clip(-0.55 * nx - 0.6 * ny + 0.6 * nz, 0, 1)
    facet = 0.1 * np.sign(np.sin(a * m * 0.5 + seed)) * (r > 0.45)
    shade = np.clip(0.35 + 0.75 * light + facet, 0.2, 1.15)
    rng = np.random.default_rng(seed)
    grain = rng.normal(1.0, 0.06, (n, n))
    rgb = np.array(ROCK, np.float32)[None, None, :] * (shade * grain)[..., None]
    img = Image.fromarray(np.dstack([np.clip(rgb, 0, 255), inside * 255.0]).astype(np.uint8), "RGBA")
    img = img.rotate(angle, resample=Image.BICUBIC)
    return img.resize((size, size), Image.LANCZOS)


def stone_frames(scale=3.0):
    ppm = spec.PX_PER_M * scale / 3.0
    size = max(8, int(0.6 * ppm))
    return [(_rock_image(size, 11, 90 * f), (size / 2, size / 2)) for f in range(STONE_FRAMES)]


def stone_shadow(scale=3.0):
    ppm = spec.PX_PER_M * scale / 3.0
    W, H = int(0.5 * ppm), int(0.25 * ppm)
    pad = int(0.25 * ppm)
    im = Image.new("RGBA", (W + 2 * pad, H + 2 * pad), (0, 0, 0, 0))
    ImageDraw.Draw(im).ellipse([pad, pad, pad + W, pad + H], fill=(0, 0, 0, 130))
    im = im.filter(ImageFilter.GaussianBlur(0.06 * ppm))
    return im, (im.width / 2, im.height / 2)


def _shard(rnd, size, colour, long_=False):
    """A clod of earth or a splinter: a small irregular polygon."""
    k = 4
    n = max(4, int(size * k))
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    m = rnd.randint(5, 7)
    pts = []
    for i in range(m):
        a = 2 * math.pi * i / m + rnd.uniform(-0.3, 0.3)
        rr = n / 2 * rnd.uniform(0.6, 1.0) * ((1.0 if i % 2 else 0.35) if long_ else 1.0)
        pts.append((n / 2 + rr * math.cos(a), n / 2 + rr * math.sin(a) * (0.45 if long_ else 0.85)))
    shade = rnd.uniform(0.8, 1.15)
    ImageDraw.Draw(im).polygon(pts, fill=(*[int(v * shade) for v in colour], 255))
    return im.rotate(rnd.uniform(0, 360), resample=Image.BICUBIC, expand=True).resize((max(2, int(n / k * 1.3)),) * 2, Image.LANCZOS)


def hit_frames(kind="ground", scale=3.0, seed=21):
    """[(image, anchor)]: the stone landing, about the impact radius (1 cell, 2 m) across on the ground: first a dark
    spray of earth (or chips and splinters off a building) thrown up in a crown, clods flying out under gravity; then a
    dust cloud billowing out and up about 2 m, lit from above, thinning away. Earthy dust on open ground, paler stone
    dust with a darker plume off a building. Anchor: the landing point on the ground."""
    ppm = spec.PX_PER_M * scale / 3.0
    rnd = random.Random(seed + (0 if kind == "ground" else 50))
    dust_c, dust_s = (EARTH_DUST, EARTH_SHADE) if kind == "ground" else (STONE_DUST, STONE_SHADE)
    n = 22
    puffs = []
    for k in range(n):
        ang = 2 * math.pi * (k + rnd.uniform(-0.35, 0.35)) / n
        puffs.append(dict(angle=ang, out=rnd.uniform(0.25, 1.0), size=rnd.uniform(0.7, 1.15), rise=rnd.uniform(0.3, 1.9),
                          seed=seed * 100 + k))
    shards = [dict(angle=rnd.uniform(0, 2 * math.pi), v=rnd.uniform(1.5, 4.5), up=rnd.uniform(3.0, 6.5),
                   size=rnd.uniform(0.07, 0.17), colour=CLOD if kind == "ground" else (SPLINTER if k % 2 else ROCK),
                   long_=kind != "ground" and k % 2 == 0) for k in range(24)]
    for sh in shards:
        sh["img"] = _shard(rnd, sh["size"] * ppm, sh["colour"], sh["long_"])
    spray = [dict(dx=rnd.gauss(0, 0.22), up=rnd.uniform(0.5, 2.0), size=rnd.uniform(0.012, 0.035)) for _ in range(160)]
    W, H = int(5.6 * ppm), int(4.6 * ppm)
    ax, ay = W / 2, H * 0.8
    out = []
    for f in range(HIT_FRAMES):
        t = f / (HIT_FRAMES - 1)
        sec = f / HIT_FPS
        can = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(can)
        if f <= 3:                                           # the crown of thrown earth: a dark fan of grains going up
            k = 1 - f / 4
            for g in spray:
                h = g["up"] * min(1.0, (f + 1) / 2.5)
                x = ax + g["dx"] * ppm * (0.5 + 0.6 * f / 3)
                y = ay - h * ppm * 0.866 * (0.6 + 0.4 * rnd.random())
                r = max(1.0, g["size"] * ppm)
                d.ellipse([x - r, y - r, x + r, y + r], fill=(*(CLOD if kind == "ground" else STONE_SHADE), int(230 * k)))
        fade = (1 - t) ** 1.2 * 0.92 + 0.08 * (1 - t)
        grow = 1 - (1 - t) ** 2.4                            # fast at first, then slowing
        # the cloud: far puffs first, near ones over them; the higher a puff, the paler and thinner
        for p in sorted(puffs, key=lambda q: math.sin(q["angle"])):
            r = (0.2 + 1.5 * grow * p["out"])
            x = ax + math.cos(p["angle"]) * r * ppm
            hgt = p["rise"] * grow
            y = ay + math.sin(p["angle"]) * r * ppm * 0.5 - hgt * ppm * 0.866
            size = max(4, int(p["size"] * (0.45 + 1.1 * grow) * ppm))
            hi = min(1.0, hgt / 1.9)
            col = tuple(int(a * (1 - 0.25 * hi) + b * 0.25 * hi) for a, b in zip(dust_c, (200, 196, 186)))
            pf = _puff(size, p["seed"], col, dust_s)
            pf.putalpha(pf.getchannel("A").point(lambda v, k=min(1.0, fade * 1.15) * (1 - 0.3 * hi): int(v * k)))
            can.alpha_composite(pf, (int(x - size / 2), int(y - size * 0.6)))
        if kind == "building" and f >= 2:                    # a darker plume rising out of the middle
            for q in range(4):
                size = int((0.9 + 0.4 * q) * (0.5 + t) * ppm)
                y = ay - (0.8 + 0.7 * q) * (0.4 + t) * ppm
                pf = _puff(size, seed * 7 + q, (118, 112, 104), (80, 76, 70))
                pf.putalpha(pf.getchannel("A").point(lambda v, k=fade * 0.7: int(v * k)))
                can.alpha_composite(pf, (int(ax - size / 2 + (q - 1.5) * 0.15 * ppm), int(y - size / 2)))
        for sh in shards:                                    # ballistic, under gravity, gone when they land
            tt = sec + 0.03
            h = sh["up"] * tt - 4.9 * tt * tt
            if h < -0.05 or f == 0:
                continue
            dd = sh["v"] * tt * 0.55
            x = ax + math.cos(sh["angle"]) * dd * ppm
            y = ay + math.sin(sh["angle"]) * dd * ppm * 0.5 - h * ppm * 0.866
            im = sh["img"]
            can.alpha_composite(im, (int(x - im.width / 2), int(y - im.height / 2)))
        can = can.filter(ImageFilter.GaussianBlur(0.4 * scale / 3.0))
        out.append((can, (ax, ay)))
    return out


CRATER_R = 1.0


def crater_image(scale=3.0):
    """Top-down (the game squashes it like the warning circle): a dark dented ring of thrown earth, soft edged."""
    S = 256
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    r = np.hypot(xx - S / 2, yy - S / 2) / (S / 2)
    rng = np.random.default_rng(5)
    a = np.arctan2(yy - S / 2, xx - S / 2)
    wob = 0.06 * np.sin(a * 5 + 1.0) + 0.04 * np.sin(a * 9 + 2.0)
    pit = np.clip(1 - (r / (0.55 + wob)) ** 2, 0, 1)
    rim = np.exp(-((r - 0.68 - wob) / 0.14) ** 2)
    spatter = (rng.random((S, S)) < 0.04) * np.clip(1 - r, 0, 1) * 0.7
    alpha = np.clip(pit * 0.75 + rim * 0.55 + spatter, 0, 0.85) * (r < 1)
    col = np.array((86, 74, 58), np.float32) * (1 - 0.4 * pit)[..., None]      # freshly turned earth: dark, darker in the pit
    img = Image.fromarray(np.dstack([np.clip(col, 0, 255), alpha * 255]).astype(np.uint8), "RGBA").filter(ImageFilter.GaussianBlur(2))
    ppm = spec.PX_PER_M * scale / 3.0
    px = int(2 * CRATER_R * ppm)
    return img.resize((px, px), Image.LANCZOS), CRATER_R


CORE_RADIUS = 0.75                   # the core image is drawn at 75 % of the circle; the game grows it from 25 %


def warn_images(scale=3.0):
    """{name: (image, radius_m)}: the six still images of the warning circle B, top-down, at `scale`."""
    R = warn.RADIUS_M * warn._TOP_PPM
    out = {}
    img, c = warn._canvas()
    warn._sigil(ImageDraw.Draw(img), c, R, 0.0, (*warn.ORANGE, 255), 9)
    out["warn_sigil"] = (img, warn.RADIUS_M)
    img, c = warn._canvas()                # the same lines in gold: faded in over the orange, the lines turn gold
    warn._sigil(ImageDraw.Draw(img), c, R, 0.0, (*warn.GOLD, 255), 9)
    out["warn_sigil_gold"] = (img, warn.RADIUS_M)
    img, c = warn._canvas()
    warn._sigil(ImageDraw.Draw(img), c, R, 0.0, (*warn.ORANGE, 255), 22)
    out["warn_sigil_glow"] = (img.filter(ImageFilter.GaussianBlur(9)), warn.RADIUS_M)
    img, c = warn._canvas()
    ImageDraw.Draw(img).ellipse([c - R, c - R, c + R, c + R], fill=(*warn.ORANGE, 255))
    out["warn_fill"] = (img.filter(ImageFilter.GaussianBlur(10)), warn.RADIUS_M)
    img, c = warn._canvas()
    warn._ring(ImageDraw.Draw(img), c, R + 4, 14, (*warn.EMBER, 160))
    out["warn_rim"] = (img, warn.RADIUS_M)
    img, c = warn._canvas()
    r = R * CORE_RADIUS
    ImageDraw.Draw(img).ellipse([c - r, c - r, c + r, c + r], fill=(*warn.GOLD, 255))
    out["warn_core"] = (img.filter(ImageFilter.GaussianBlur(18)), warn.RADIUS_M * CORE_RADIUS)
    ppm = spec.PX_PER_M * scale / 3.0
    f = ppm / warn._TOP_PPM
    return {k: (im.resize((round(im.width * f), round(im.height * f)), Image.LANCZOS), rad) for k, (im, rad) in out.items()}


def write_atlas(scale=3.0, page=2048):
    """effects.json + effects_<k>.png: trimmed frames, the colour layer's rules (packed like the unit pages)."""
    out = config.BUILD / f"effects_x{scale:g}"
    out.mkdir(parents=True, exist_ok=True)
    for p in out.glob("effects_*.png"):
        p.unlink()
    items = []
    for i, (im, (ax, ay)) in enumerate(dust_frames(scale)):
        bb = im.getchannel("A").point(lambda v: 255 if v > 4 else 0).getbbox()
        items.append((f"dust_{i:02d}", im.crop(bb), ax - bb[0], ay - bb[1]))
    effects = {"dust": dict(frames=DUST_FRAMES, fps=DUST_FPS, loop=False)}
    for i, (im, (ax, ay)) in enumerate(shot_frames(scale)):
        bb = im.getchannel("A").point(lambda v: 255 if v > 4 else 0).getbbox()
        items.append((f"tower_shot_{i:02d}", im.crop(bb), ax - bb[0], ay - bb[1]))
    effects["tower_shot"] = dict(frames=SHOT_FRAMES, fps=SHOT_FPS, loop=False)
    for i, (im, (ax, ay)) in enumerate(stone_frames(scale)):
        items.append((f"siege_stone_{i:02d}", im, ax, ay))
    effects["siege_stone"] = dict(frames=STONE_FRAMES, fps=STONE_FPS, loop=True, from_m=SIEGE_FROM_M, arc_m=2.0, arc_k=0.25,
                                  from_far_m=14.0)
    im, (ax, ay) = stone_shadow(scale)
    items.append(("siege_stone_shadow_00", im, ax, ay))
    effects["siege_stone_shadow"] = dict(frames=1, fps=1, loop=True)
    for kind in ("ground", "building"):
        for i, (im, (ax, ay)) in enumerate(hit_frames(kind, scale)):
            bb = im.getchannel("A").point(lambda v: 255 if v > 4 else 0).getbbox()
            items.append((f"siege_hit_{kind}_{i:02d}", im.crop(bb), ax - bb[0], ay - bb[1]))
        effects[f"siege_hit_{kind}"] = dict(frames=HIT_FRAMES, fps=HIT_FPS, loop=False, radius_m=2.0)
    im, rad = crater_image(scale)
    items.append(("siege_crater_00", im, im.width / 2, im.height / 2))
    effects["siege_crater"] = dict(frames=1, fps=1, loop=True, top_down=True, radius_m=rad, crater_s=8.0)
    for name, (im, rad) in warn_images(scale).items():
        bb = im.getchannel("A").point(lambda v: 255 if v > 4 else 0).getbbox()
        items.append((f"{name}_00", im.crop(bb), im.width / 2 - bb[0], im.height / 2 - bb[1]))
        effects[name] = dict(frames=1, fps=1, loop=True, top_down=True, radius_m=rad)
    packer, frames = Packer(page), {}
    for name, c, ax, ay in sorted(items, key=lambda t: (-t[1].height, -t[1].width, t[0])):
        k, x, y = packer.add(c)
        frames[name] = dict(page=k, x=x, y=y, w=c.width, h=c.height, ax=round(ax, 2), ay=round(ay, 2))
    pages, area = [], 0
    for k, content in enumerate(packer.pages):
        h = min(page, (packer.used_height(k) + 3) // 4 * 4)
        pg = Image.new("RGBA", (page, h), (0, 0, 0, 0))
        for x, y, im in content:
            pg.paste(im, (x, y))
        pg.save(out / f"effects_{k}.png", optimize=True)
        pages.append(f"effects_{k}.png")
        area += page * h
    manifest = {"format": "war-game effects 1", "scale": scale, "px_per_m": spec.PX_PER_M * scale / 3.0,
                "pages": pages, "effects": effects, "frames": dict(sorted(frames.items()))}
    (out / "effects.json").write_text(json.dumps(manifest, separators=(",", ":")))
    print(f"effects x{scale:g}: {len(frames)} frames, {len(pages)} page(s), {area * 4 / 2 ** 20:.2f} MB RGBA8")
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--scale", type=float, default=3.0)
    a = ap.parse_args()
    write_atlas(a.scale)
