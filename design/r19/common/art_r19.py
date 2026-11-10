"""R19 (the user 2026-11-10, after the hoe he had to find himself): every unit's every action, checked. The frames of
a released art pack's unit atlases (x3: what the phone shows), the player colour tinted in as the client does, their
shadows under them; a stage to stand them on (the pack's grass, or its average colour for enlarged pictures); the
iPhone's display path (design/r16/common/scene_r16.py: the 3x art drawn at pixel ratio 2, scaled up to 3).

A frame's place is its anchor (the foot on the ground). Facings: 0 right, 1 up-right, 2 up, 6 down, 7 down-right on
the screen are rendered; 3, 4, 5 are 1, 0, 7 mirrored.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
for d in ("r14", "r9"):
    sys.path.insert(0, str(REPO / "design" / d / "common"))
import scene_r14 as S14   # noqa: E402
import scene_r9 as S9     # noqa: E402

FACES = [7, 0, 1, 2, 6]                       # the rendered facings, the one seen most from the front first
FACE_NAME = {0: "朝右", 1: "朝右上", 2: "朝上", 6: "朝下", 7: "朝右下"}
ANIM_NAME = {"idle": "待機", "walk": "走路", "attack": "攻擊", "death": "倒下", "work_chop": "砍樹", "work_mine": "挖礦",
             "work_farm": "種田", "work_build": "蓋房", "sling": "投石", "cast": "施法", "hit": "被打", "shatter": "護盾碎",
             "fall": "倒下", "dead": "躺著"}
SHADE = np.array([0.45, 0.46, 0.50], np.float32)      # scene_r14.Canvas: what a shadow leaves of the ground


class Unit:
    def __init__(self, art, u):
        self.u = u
        self.a = S9.Atlas(Path(art) / "units" / u / f"{u}.json")
        self.anims = self.a.j["anims"]

    def sprite(self, anim, face, k, team="blue"):
        """((colour, ax, ay), (shadow, ax, ay) or None) of a frame, mirrored for facings 3-5."""
        name, flip = S9.unit_frame(self.a, self.u, anim, face % 8, k)
        spr = self.a.sprite(name, team)
        return S14.mirror(spr) if flip else spr

    def box(self, anim, faces=FACES, frames=None):
        """(left, top, right, bottom) px around the anchor that hold every frame of the facings."""
        l = t = r = b = 0
        for f in faces:
            for k in (range(self.anims[anim]["frames"]) if frames is None else frames):
                (im, ax, ay), _ = self.sprite(anim, f, k)
                l, t, r, b = max(l, ax), max(t, ay), max(r, im.width - ax), max(b, im.height - ay)
        return tuple(int(np.ceil(v)) for v in (l, t, r, b))


class Stage:
    """Sprites by their anchors (px) on a ground picture: shadows darken the ground, sprites over them in order."""

    def __init__(self, base):
        self.base = base.convert("RGBA")
        self.shadow = np.zeros((base.height, base.width), np.float32)
        self.items = []

    def put(self, spr, x, y, shadow=True):
        (im, ax, ay), sh = spr
        if sh and shadow:
            si, sx, sy = sh
            a = np.asarray(si.getchannel("A"), np.float32) / 255.0
            x0, y0 = round(x - sx), round(y - sy)
            xa, ya, xb, yb = max(0, x0), max(0, y0), min(self.base.width, x0 + si.width), min(self.base.height, y0 + si.height)
            if xa < xb and ya < yb:
                self.shadow[ya:yb, xa:xb] = np.maximum(self.shadow[ya:yb, xa:xb], a[ya - y0:yb - y0, xa - x0:xb - x0])
        self.items.append((im, round(x - ax), round(y - ay)))

    def render(self):
        g = np.asarray(self.base, np.float32).copy()
        g[..., :3] *= 1 - self.shadow[..., None] * (1 - SHADE)
        out = Image.fromarray(np.clip(g, 0, 255).astype(np.uint8), "RGBA")
        for im, x, y in self.items:
            cx, cy = max(0, -x), max(0, -y)
            if cx < im.width and cy < im.height:
                out.alpha_composite(im.crop((cx, cy, im.width, im.height)), (max(0, x), max(0, y)))
        return out.convert("RGB")


_GRASS = {}


def grass(art, w, h):
    """The pack's grass through the camera at its default scale, w x h px (3 px a pt)."""
    key = (str(art), w, h)
    if key not in _GRASS:
        S14.W, S14.H = -(-w // S14.K), -(-h // S14.K)
        _GRASS[key] = S14.ground(Path(art), S14.Cam(1.0, look=(40.0, 40.0)), {}).crop((0, 0, w, h))
    return _GRASS[key].copy()


def grass_colour(art):
    return tuple(int(v) for v in np.asarray(grass(art, 600, 300), np.float32).reshape(-1, 3).mean(0))


def phone(img):
    """The 3x picture as the iPhone shows it: drawn at pixel ratio 2, scaled up to 3 by the browser."""
    small = img.resize((round(img.width * 2 / 3), round(img.height * 2 / 3)), Image.LANCZOS)
    return small.resize(img.size, Image.BILINEAR)


def enlarge(img, n):
    return img.resize((round(img.width * n), round(img.height * n)), Image.LANCZOS)
