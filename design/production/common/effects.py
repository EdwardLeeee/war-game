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
"""
import argparse
import json
import math
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import config  # noqa: E402
import spec    # noqa: E402

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


def write_atlas(scale=3.0, page=2048):
    """effects.json + effects_0.png: trimmed frames, one page, the colour layer's rules."""
    out = config.BUILD / f"effects_x{scale:g}"
    out.mkdir(parents=True, exist_ok=True)
    frames, x, shelf = {}, 0, 0
    items = []
    for i, (im, (ax, ay)) in enumerate(dust_frames(scale)):
        bb = im.getchannel("A").point(lambda v: 255 if v > 4 else 0).getbbox()
        c = im.crop(bb)
        items.append((f"dust_{i:02d}", c, ax - bb[0], ay - bb[1]))
    h = (max(c.height for _, c, _, _ in items) + 2 + 3) // 4 * 4
    pg = Image.new("RGBA", (page, h), (0, 0, 0, 0))
    for name, c, ax, ay in items:
        pg.paste(c, (x, 0))
        frames[name] = dict(page=0, x=x, y=0, w=c.width, h=c.height, ax=round(ax, 2), ay=round(ay, 2))
        x += c.width + 2
    pg.save(out / "effects_0.png", optimize=True)
    manifest = {"format": "war-game effects 1", "scale": scale, "px_per_m": spec.PX_PER_M * scale / 3.0,
                "pages": ["effects_0.png"],
                "effects": {"dust": dict(frames=DUST_FRAMES, fps=DUST_FPS, loop=False)}, "frames": frames}
    (out / "effects.json").write_text(json.dumps(manifest, separators=(",", ":")))
    used = x * h
    print(f"effects x{scale:g}: {len(frames)} frames, page {page}x{h} ({page * h * 4 / 2 ** 20:.2f} MB RGBA8, "
          f"frames cover {used * 4 / 2 ** 20:.2f} MB)")
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--scale", type=float, default=3.0)
    a = ap.parse_args()
    write_atlas(a.scale)
