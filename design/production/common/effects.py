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


def _puff(size, seed):
    """One soft, slightly lumpy puff (RGBA, alpha only shaped here), size px across."""
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
    rgb = np.array(DUST_COLOUR, np.float32) * (1 - shade) + np.array(DUST_SHADE, np.float32) * shade
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
