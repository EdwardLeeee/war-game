"""R13's battlefields behind the mock, 3 px a pt (2442 x 1140 = 814 x 380 pt), from art-v7 pictures on this machine (not in git;
read only, never changed):

  r13-river.png   the real-scale river scene (R11 s4), as it is: the battlefield of the command-area states
  r13-bases.png   grass, and our buildings set close together (the camera pulled back, about 0.42 of the normal zoom) so that one
                  screen shows each kind 進駐 can go into: a town's gate (大城), the main city, an arrow tower, an outpost (3 x 3, art-v6.4),
                  a barracks (it cannot be entered) and a squad of ours
  r13-bases-held.png  the same, the outpost manned (its spearmen drawn on the wall walk, D-121)
  r13-fall.png    the west edge with the waterfall, darkened: behind the result screen

The building pictures are cells of the art-v7 boards (V7B, 2 px a pt) and the art-v6.4 outpost board; each comes with its own grass,
so it is laid on with a feathered edge. The outpost is the 方形斜看 art-v6.4 one (the 3 x 3 outpost has no 菱形 picture yet).

python3 design/r13/common/field.py        -> design/r13/build/
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

SRC = Path(__file__).resolve().parents[2] / "r11" / "build"       # design/r11/build (not in git)
OUT = Path(__file__).resolve().parents[1] / "build"
B1 = SRC / "v7bout/V7B-01-東陸建築-phone.png"
B3 = SRC / "v7bout/V7B-03-東陸城牆-phone.png"
V64 = SRC / "v64out/V64-01-哨所-A敵臺門洞-3x3-phone.png"
# cells of the boards (px of the board; found by their grass rectangles), the outpost's without its caption line
CELLS = {
    "tower": (B1, (1123, 186, 1461, 583)),
    "main": (B1, (1304, 3227, 1926, 3771)),
    "barracks": (B1, (544, 727, 1046, 1099)),
    "post": (V64, (884, 246, 1164, 526)),
    "post_held": (V64, (1736, 246, 2016, 526)),
    "gate": (B3, (2044, 1656, 2620, 2254)),
}
K = 3          # px a pt in the output
BOARD = 2      # px a pt in the boards
# where each goes (pt, top left) and its zoom; the soldier from the river scene (3 px a pt, zoom 1)
PLACE = {"gate": (118, 94, 0.36), "main": (238, 92, 0.42), "tower": (392, 118, 0.42), "barracks": (478, 124, 0.42), "post": (604, 196, 0.42)}
SOLDIER = (835, 660, 905, 852)            # one of ours standing on grass in river_d (px)
SQUAD = [(536, 206), (556, 214), (548, 228), (572, 222), (566, 238), (590, 232), (530, 236), (582, 248), (548, 250), (600, 246), (566, 256), (520, 222)]


def feather(im, edge=0.2):
    """An alpha that is 1 inside and fades out over the outer `edge` of the picture (an ellipse, so the corners go)."""
    w, h = im.size
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    ex, ey = int(w * edge / 2), int(h * edge / 2)
    d.ellipse((ex - w * 0.12, ey - h * 0.12, w - ex + w * 0.12, h - ey + h * 0.12), fill=255)
    return m.filter(ImageFilter.GaussianBlur(min(w, h) * edge / 3))


def cell(name):
    path, box = CELLS[name]
    return Image.open(path).convert("RGB").crop(box)


def match(im, base, at):
    """The board's grass is lighter and greyer than grass_d: move the crop's grass-coloured pixels to the grass under it."""
    a = np.asarray(im).astype(float)
    edge = np.concatenate([a[:6].reshape(-1, 3), a[-6:].reshape(-1, 3), a[:, :6].reshape(-1, 3), a[:, -6:].reshape(-1, 3)])
    own = edge.mean(0)
    x, y = round(at[0] * K), round(at[1] * K)
    under = np.asarray(base.crop((x, y, x + im.width, y + im.height))).astype(float).reshape(-1, 3).mean(0)
    near = np.exp(-(((a - own) ** 2).sum(2)) / (2 * 38.0 ** 2))[..., None]
    return Image.fromarray(np.clip(a + (under - own) * near, 0, 255).astype(np.uint8))


def lay(base, name, at, zoom, src=None):
    im = src or cell(name)
    f = K / BOARD * zoom
    im = im.resize((round(im.width * f), round(im.height * f)), Image.LANCZOS)
    im = match(im, base, at)
    base.paste(im, (round(at[0] * K), round(at[1] * K)), feather(im))
    return {"x": at[0], "y": at[1], "w": im.width / K, "h": im.height / K}


def bases(held=False):
    base = Image.open(SRC / "work/s4/grass_d.png").convert("RGB")
    boxes = {}
    for name, (x, y, z) in PLACE.items():
        src = cell("post_held") if (name == "post" and held) else None
        boxes[name] = lay(base, name, (x, y), z, src)
    river = Image.open(SRC / "work/s4/river_d.png").convert("RGB")
    man = river.crop(SOLDIER)
    z = 0.42
    man = man.resize((round(man.width * z), round(man.height * z)), Image.LANCZOS)
    mask = feather(man, 0.35)
    for (x, y) in SQUAD:
        at = (x - man.width / K / 2, y - man.height / K)
        base.paste(match(man, base, at), (round(at[0] * K), round(at[1] * K)), mask)
    return base, boxes


def main():
    OUT.mkdir(exist_ok=True)
    Image.open(SRC / "work/s4/river_d.png").convert("RGB").save(OUT / "r13-river.png")
    b, boxes = bases()
    b.save(OUT / "r13-bases.png")
    bases(held=True)[0].save(OUT / "r13-bases-held.png")
    fall = Image.open(SRC / "v7board/west_fall.png").convert("RGB")
    ImageEnhance.Brightness(fall).enhance(0.55).save(OUT / "r13-fall.png")
    for k, v in boxes.items():
        print(k, {a: round(b, 1) for a, b in v.items()})


if __name__ == "__main__":
    main()
