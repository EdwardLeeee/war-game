"""R13-01-B2's battlefields, 3 px a pt, drawn from the art-v7 atlases (not in git; read only): grass, the buildings of r13-b2-scene.js at
their zoom with their shadows (lit x (0.45, 0.46, 0.50), as the game), the selected squad from the unit atlases.

python3 design/r13/common/field_b2.py      -> design/r13/build/r13-b2-<scene>.png
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
D = HERE.parents[1]
sys.path.insert(0, str(D / "r9" / "common"))
import scene_r9 as S9    # noqa: E402

GRASS = D / "r11/build/work/s4/grass_d.png"
ATLAS = D / "b1/build/v7atlas_dl/atlas_x3"
UNITS = D / "production/build/v8u_dl"
OUT = HERE.parent / "build"
K = 3
# the squad, as r13-b2.js's rings
RINGS = [[0, 0], [24, 10], [-22, 8], [10, 26], [-30, 28], [38, 30], [-8, -18], [30, -14], [-40, -8], [52, 6], [-54, 16], [58, 28]]
KINDS = ["spear_e"] * 6 + ["bow_e"] * 4 + ["mage_e"] * 2


def scaled(im, z):
    return im if z == 1 else im.resize((max(1, round(im.width * z)), max(1, round(im.height * z))), Image.LANCZOS)


def put(base, spr, x, y, z):
    (im, ax, ay), sh = spr
    px, py = x * K, y * K
    if sh:
        si, sx, sy = sh
        si = scaled(si, z)
        a = np.zeros((base.height, base.width), np.float32)
        s = np.asarray(si.getchannel("A"), np.float32) / 255.0
        x0, y0 = round(px - sx * z), round(py - sy * z)
        xa, ya, xb, yb = max(0, x0), max(0, y0), min(base.width, x0 + si.width), min(base.height, y0 + si.height)
        if xa < xb and ya < yb:
            a[ya:yb, xa:xb] = s[ya - y0:yb - y0, xa - x0:xb - x0]
            g = np.asarray(base, np.float32)
            g = g * (1 - a[..., None] * (1 - np.array([0.45, 0.46, 0.50])))
            base.paste(Image.fromarray(g.astype(np.uint8), "RGB"))
    im = scaled(im, z)
    rgba = base.convert("RGBA")
    rgba.alpha_composite(im, (max(0, round(px - ax * z)), max(0, round(py - ay * z)))) if round(px - ax * z) >= 0 and round(py - ay * z) >= 0 else paste_clipped(rgba, im, round(px - ax * z), round(py - ay * z))
    base.paste(rgba.convert("RGB"))


def paste_clipped(rgba, im, x, y):
    cx, cy = max(0, -x), max(0, -y)
    rgba.alpha_composite(im.crop((cx, cy, im.width, im.height)), (max(0, x), max(0, y)))


def main():
    text = (HERE / "r13-b2-scene.js").read_text()
    scenes = json.loads(text.split("window.R13_B2 =", 1)[1].rstrip().rstrip(";"))
    b = S9.Atlas(ATLAS / "buildings/buildings_E.json")
    c = S9.Atlas(ATLAS / "castle/castle_E.json")
    units = {u: S9.Atlas(next(UNITS.rglob(f"atlas_x3/{u}.json"))) for u in set(KINDS)}
    for name, sc in scenes.items():
        base = Image.open(GRASS).convert("RGB")
        z = sc["zoom"]
        draws = []
        for bd in sc["buildings"]:
            x, y = bd["at"]
            if not (-120 < x < 934 and -60 < y < 480):
                continue
            a = c if bd["frame"].startswith("castle") else b
            draws.append((y, a.sprite(bd["frame"], "blue"), x, y))
        sx, sy = sc["squad"]["at"]
        k = z * 1.25
        for i, (dx, dy) in enumerate(RINGS[:sc["squad"]["n"]]):
            u = KINDS[i] if sc["squad"]["n"] > 6 else "spear_e"
            nm, flip = S9.unit_frame(units[u], u, "idle", 7, 0)
            spr, sh = units[u].sprite(nm, "blue")
            if flip:
                continue
            x, y = sx + dx * k, sy + dy * k
            if -40 < x < 854 and -40 < y < 420:
                draws.append((y, (spr, sh), x, y))
        for _, spr, x, y in sorted(draws, key=lambda d: d[0]):
            put(base, spr, x, y, z)
        base.save(OUT / f"r13-b2-{name}.png")
        print(name, "ok")


if __name__ == "__main__":
    main()
