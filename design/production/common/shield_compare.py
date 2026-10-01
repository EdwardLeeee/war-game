"""Check the separate shield layer against the approved look (client/docs/sprite-atlas.md version 2,
section 4: "請 ui 驗證").

python3 common/shield_compare.py          (renders: build/val_shield/<unit>/, made by a validation job)
-> build/val_shield/shield_compare_3x.png, shield_compare_1x.png, and the numbers printed

For each mage and three frames (idle, the brightest frame of hit, the first frame of shatter):
  A  the approved composition: the effect layer still contains the shield, cut out where the body
     is in front of it (the R5 / P1-02 renders)
  B  the version-2 layers drawn in the game's order: colour, player colour, shield, effects; the
     shield layer is rendered without the body, so its back half also lies over the body
  C  as B, but the shield layer has only the half of the shell that faces the camera
Both drawn the way the game draws them (normal alpha blending, no added glow), East blue, West red.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(1, str(HERE.parents[1] / "round1" / "common"))
import artboard      # noqa: E402
import compose       # noqa: E402
import config        # noqa: E402
import postprocess   # noqa: E402

VAL = config.BUILD / "val_shield"
FRAMES = [("idle_00", "on_00", "待機"), ("hit_01", "hit_01", "受擊最亮"), ("shatter_01", "break_01", "破盾第 1 格")]
TEAM = {"mage_e": config.TEAM["blue"], "mage_w": config.TEAM["red"]}
GROUND = (118, 128, 104)


def body(d, key, team):
    c = postprocess._colour(d, f"{key}")
    return compose.recolor(c, Image.open(d / f"{key}_x3_mask.png"), team)


def layer(path):
    return Image.open(path).convert("RGBA")


# B: the whole shell; C: only the half facing the camera; D: the far half hidden behind a body-sized
# stand-in (render_units.py BODY_PROXY), as the body hid it in the approved look
VARIANTS = {"B": "shield", "C": "front", "D": "proxy"}


def compose_pair(unit, fkey, skey):
    """A (approved), then each variant; stats per variant: inside the body, and in the shield outside it."""
    d = VAL / unit
    team = TEAM[unit]
    a = Image.new("RGBA", layer(d / f"old_{fkey}_x3_beauty.png").size, (*GROUND, 255))
    a.alpha_composite(body(d, f"old_{fkey}", team))
    a.alpha_composite(layer(d / f"old_{fkey}_x3_fx.png"))
    inside = np.asarray(layer(d / f"new_{fkey}_x3_beauty.png"))[..., 3] > 128
    shell = np.asarray(layer(d / f"shield_{skey}_x3_shield.png"))[..., 3] > 8
    outside = shell & ~inside
    lum = lambda x: np.asarray(x, np.float32)[..., :3] @ np.array([0.299, 0.587, 0.114], np.float32)  # noqa: E731
    out, stats = [a], {}
    for name, prefix in VARIANTS.items():
        b = Image.new("RGBA", a.size, (*GROUND, 255))
        b.alpha_composite(body(d, f"new_{fkey}", team))
        b.alpha_composite(layer(d / f"{prefix}_{skey}_x3_shield.png"))
        b.alpha_composite(layer(d / f"new_{fkey}_x3_fx.png"))
        dl = lum(b) - lum(a)
        stats[name] = dict(inside=float(dl[inside].mean()), outside=float(dl[outside].mean()),
                           inside_abs=float(np.abs(dl[inside]).mean()), outside_abs=float(np.abs(dl[outside]).mean()))
        out.append(b)
    return out, stats


def board(scale, path):
    tiles, rows = [], []
    for unit in ("mage_e", "mage_w"):
        row = []
        for fkey, skey, name in FRAMES:
            ims0, st = compose_pair(unit, fkey, skey)
            a = ims0[0]
            pad = 6
            al = np.asarray(layer(VAL / unit / f"old_{fkey}_x3_fx.png"))[..., 3] > 8
            al |= np.asarray(layer(VAL / unit / f"old_{fkey}_x3_beauty.png"))[..., 3] > 8
            ys, xs = np.nonzero(al)
            box = (max(0, xs.min() - pad), max(0, ys.min() - pad), min(a.width, xs.max() + pad), min(a.height, ys.max() + pad))
            ims = [i.crop(box) for i in ims0]
            if scale != 3:
                f = scale / 3
                ims = [i.resize((max(1, round(i.width * f)), max(1, round(i.height * f))), Image.LANCZOS) for i in ims]
            row.append((f"{'劍修' if unit == 'mage_e' else '學院大師'} {name}", ims, st))
        rows.append(row)
    cw = max(sum(i.width for i in ims) + 6 for row in rows for _, ims, _ in row)
    ch = max(max(i.height for i in ims) for row in rows for _, ims, _ in row) + 24
    W, H = 10 + len(rows[0]) * (cw + 14), 10 + len(rows) * (ch + 14)
    sheet = Image.new("RGB", (W, H), (244, 241, 234))
    dr = ImageDraw.Draw(sheet)
    for r, row in enumerate(rows):
        for c, (title, ims, st) in enumerate(row):
            x, y = 10 + c * (cw + 14), 10 + r * (ch + 14)
            dr.text((x, y), f"{title}：A 核准｜B 整顆｜C 前半｜D 替身遮後半", font=artboard.font(14), fill=(40, 40, 40))
            xx = x
            for im in ims:
                sheet.paste(im.convert("RGB"), (xx, y + 18))
                xx += im.width + 6
    sheet.save(path)
    return rows


if __name__ == "__main__":
    rows = board(3, VAL / "shield_compare_3x.png")
    board(1, VAL / "shield_compare_1x.png")
    print("mean luminance change against A (0-255): inside the body / in the shield around it")
    for row in rows:
        for title, _, st in row:
            print(f"{title:14s} " + "  ".join(f"{k}: {v['inside']:+6.2f} / {v['outside']:+6.2f}" for k, v in st.items()))
