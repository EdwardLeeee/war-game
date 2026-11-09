"""R16 (the user 2026-11-10: 「種田的農民圖看起來好像有點怪」): farmers hoeing a field as the iPhone shows them, for the boards.

The battlefield at the camera's default scale (1) on the diamond camera, composed as design/r14/common/scene_r14.py lays
it (the client's projection, depth by x + y, shadows under the sprites), on the art's ground, then put through the
client's display path on the user's iPhone (client/src/battlefield-res.ts, 2026-11-07 on): the 3x art drawn into a
canvas of pixel ratio 2 and scaled up by the browser to the 3x screen.

The farmers are this branch's draft renders (design/r16/common/render_r16.py: <tag>_<anim>_f<facing>_<ii>_x3_{beauty,
mask,shadow}.png and .json), their player colour tinted in from the mask; the field, the spearman beside them and the
ground are a release's x3 atlases.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(REPO / "design" / "r14" / "common"))
import scene_r14 as S     # noqa: E402

S.W, S.H = 932, 336                    # the iPhone 14 Pro Max on its side, Safari with its tab bar
K = S.K                                # 3 px a pt
TEAM = {"blue": (0x3f, 0x7f, 0xe0), "red": (0xd9, 0x43, 0x3a)}


def farmer(prefix, team="blue"):
    """((colour, ax, ay), (shadow, ax, ay)) of one draft frame at x3; the mask's player colour tinted in."""
    b = np.asarray(Image.open(f"{prefix}_x3_beauty.png").convert("RGBA"), np.float32)
    m = np.asarray(Image.open(f"{prefix}_x3_mask.png").convert("RGBA"), np.float32) / 255.0
    ax, ay = json.loads(Path(f"{prefix}_x3.json").read_text())["anchor"]
    w = (m[..., 0] * m[..., 3])[..., None]
    tint = np.array(TEAM[team], np.float32) / 255.0 * 1.7
    b[..., :3] = b[..., :3] * (1 - w) + np.clip(b[..., :3] * tint, 0, 255) * w
    sh = Image.open(f"{prefix}_x3_shadow.png").convert("RGBA")
    sh = sh.resize((sh.width * 2, sh.height * 2), Image.BILINEAR)     # rendered at half size, the same top-left
    return (Image.fromarray(b.astype(np.uint8), "RGBA"), ax, ay), (sh, ax, ay)


def phone(img):
    """The 3x picture as the iPhone shows it: drawn at pixel ratio 2, scaled up to 3 by the browser."""
    small = img.resize((round(img.width * 2 / 3), round(img.height * 2 / 3)), Image.LANCZOS)
    return small.resize(img.size, Image.BILINEAR)


def field(atlas, culture, farmers, focus, units=None, spear=None):
    """The screen (932 x 336 pt at 3x, the phone's path applied): the culture's field growing at cells 40-42, the
    farmers [(sprite, x, y)] on it, a spearman (spear: (unit, x, y, facing)) beside. Returns (image, cam)."""
    art = S.Art(Path(atlas), Path(units or Path(atlas).parent / "units"))
    cam = S.Cam(1.0, focus=focus)
    canvas = S.Canvas(S.ground(art.atlas, cam, {}), cam)
    ba = art.buildings(culture)
    canvas.add(ba.sprite(f"farm_{culture}_growing", "blue"), 41.5, 41.5, -1e6)
    for spr, x, y in farmers:
        canvas.add(spr, x, y, x + y)
    if spear is not None:
        u, x, y, f = spear
        canvas.add(art.unit_sprite(u, "idle", f, 0, "blue"), x, y, x + y)
    return phone(canvas.render()), cam
