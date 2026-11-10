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
# sim/src/core/rules.ts UNITS: cells a second, seconds between attacks (the militia's sling as the spearman's)
SPEED = {"farmer": 1.0, "spear": 1.0, "pike": 1.0, "bow": 1.0, "mage": 0.9, "hcav": 1.6, "knight": 1.6, "siege": 0.6}
COOLDOWN_S = {"farmer": 1.5, "spear": 1.5, "pike": 1.5, "bow": 2.0, "mage": 1.0, "hcav": 1.5, "knight": 1.5, "siege": 5.0}


def kind(unit):
    return unit.split("_")[0]


def walk_fps(info, unit):
    """client/src/art/spec.ts walkFps: the walk's frames a second at the unit's own speed."""
    cells = SPEED[kind(unit)]
    if info.get("stride_m"):
        return info["frames"] * cells * 2 / info["stride_m"]
    return info["fps"] * cells


class Unit:
    def __init__(self, art, u):
        self.u = u
        self.a = S9.Atlas(Path(art) / "units" / u / f"{u}.json")
        self.anims = self.a.j["anims"]

    def _layer(self, kind, name):
        """A frame of the effects or the shield page (the mages'), or None."""
        table = self.a.j.get("fx", {}) if kind == "fx" else self.a.j.get("shield", {}).get("frames", {})
        f = table.get(name)
        if f is None or not self.a.pages.get(kind):
            return None
        im = self.a.pages[kind][f["page"]].crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"]))
        k = 2 if f.get("half_res") else 1
        if k > 1:
            im = im.resize((im.width * k, im.height * k), Image.BILINEAR)
        return im, f["ax"] * k, f["ay"] * k

    def sprite(self, anim, face, k, team="blue", shield=None):
        """((colour, ax, ay), (shadow, ax, ay) or None) of a frame, mirrored for facings 3-5. As the client stacks
        them (client/src/render/unit-art-draw.ts): colour, player colour, the shield (`shield`: on_00, hit_03,
        break_01...; its one picture, never mirrored), the effects of that frame."""
        name, flip = S9.unit_frame(self.a, self.u, anim, face % 8, k)
        (im, ax, ay), sh = self.a.sprite(name, team)
        over = [self._layer("shield", f"{self.u}_shield_{shield}") if shield else None, self._layer("fx", name)]
        over = [o for o in over if o]
        if over:
            l, t = max([ax] + [o[1] for o in over]), max([ay] + [o[2] for o in over])
            r = max([im.width - ax] + [o[0].width - o[1] for o in over])
            b = max([im.height - ay] + [o[0].height - o[2] for o in over])
            big = Image.new("RGBA", (int(np.ceil(l + r)), int(np.ceil(t + b))), (0, 0, 0, 0))
            big.alpha_composite(im, (round(l - ax), round(t - ay)))
            for oi, ox, oy in over:
                big.alpha_composite(oi, (round(l - ox), round(t - oy)))
            im, ax, ay = big, l, t
        spr = (im, ax, ay), sh
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


def grass(art, w, h, yard=False):
    """The pack's grass through the camera at its default scale, w x h px (3 px a pt); yard: its packed earth."""
    key = (str(art), w, h, yard)
    if key not in _GRASS:
        S14.W, S14.H = -(-w // S14.K), -(-h // S14.K)
        cells = {(x, y): 1.0 for x in range(0, 81) for y in range(0, 81)} if yard else {}
        _GRASS[key] = S14.ground(Path(art), S14.Cam(1.0, look=(40.0, 40.0)), cells).crop((0, 0, w, h))
    return _GRASS[key].copy()


def grass_colour(art):
    return tuple(int(v) for v in np.asarray(grass(art, 600, 300), np.float32).reshape(-1, 3).mean(0))


def phone(img):
    """The 3x picture as the iPhone shows it: drawn at pixel ratio 2, scaled up to 3 by the browser."""
    small = img.resize((round(img.width * 2 / 3), round(img.height * 2 / 3)), Image.LANCZOS)
    return small.resize(img.size, Image.BILINEAR)


def enlarge(img, n):
    return img.resize((round(img.width * n), round(img.height * n)), Image.LANCZOS)
