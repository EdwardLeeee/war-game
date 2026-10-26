"""A check sheet of the castles as the client lays them: one culture's layouts from a packed atlas (art-vN-x2's
castle/, buildings/, ground/), each town on its own ground (grass, its lanes and trampled earth in yard), the pieces'
shadows, then the pieces and the big city's tower by their front edge (atlas-buildings.md 0, 6, 11, 13), the player
colour neutral (#d8d2c0). Not the client's renderer: a picture to check the layouts and the pieces against.

python3 common/castle_sheet.py ATLAS_DIR E small,large,large3 OUT.png
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config  # noqa: E402

NEUTRAL = (0xd8, 0xd2, 0xc0)
CELL_X, CELL_Y, PAD = 80, 40, 3          # 2x: a 2 m cell is 80 x 40 px on screen; cells of ground round the walls


def _crop(pages, f, scale=1):
    im = pages[f["page"]].crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"]))
    if scale != 1:
        im = im.resize((f["w"] * scale, f["h"] * scale), Image.BILINEAR)
    return im


def _tint(im, colour, gain):
    r, g, b, a = im.split()
    ch = [c.point(lambda v, k=k: min(255, int(v * k / 255 * gain))) for c, k in zip((r, g, b), colour)]
    return Image.merge("RGBA", (*ch, a))


def _ground(gdir, w, h, marks):
    """Grass tiled (squashed to the camera: 2 m across, 1 m down a tile), yard over it by the lanes' weights, blurred."""
    def tiled(name):
        t = Image.open(gdir / name).convert("RGB")
        t = t.resize((t.width, t.height // 2))
        out = Image.new("RGB", (w, h))
        for y in range(0, h, t.height):
            for x in range(0, w, t.width):
                out.paste(t, (x, y))
        return out
    grass, yard = tiled("grass.png"), tiled("yard.png")
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    for (x0, y0), wgt in marks:
        d.rectangle([x0, y0, x0 + CELL_X - 1, y0 + CELL_Y - 1], fill=int(255 * wgt))
    mask = mask.filter(ImageFilter.GaussianBlur(10))
    return Image.composite(yard, grass, mask).convert("RGBA")


def town(adir, c, name):
    cj = json.loads((adir / "castle" / f"castle_{c}.json").read_text())
    bj = json.loads((adir / "buildings" / f"buildings_{c}.json").read_text())
    L = cj["layouts"][name]
    load = lambda d, files: {i: Image.open(adir / d / f).convert("RGBA") for i, f in enumerate(files)}
    cp = {k: load("castle", v) for k, v in cj["pages"].items()}
    bp = {k: load("buildings", v) for k, v in bj["pages"].items()}
    cells = [cc for p in L["walls"] for cc in p["cells"]]
    x0, x1 = min(x for x, _ in cells) - PAD, max(x for x, _ in cells) + PAD + 1
    y0, y1 = min(y for _, y in cells) - PAD - 8, max(y for _, y in cells) + PAD + 1     # headroom for the north wall
    W, H = (x1 - x0) * CELL_X, (y1 - y0) * CELL_Y
    sx = lambda x: (x - x0) * CELL_X
    sy = lambda y: (y - y0) * CELL_Y
    img = _ground(adir / "ground", W, H, [((sx(g["cell"][0]), sy(g["cell"][1])), g["w"]) for g in L.get("ground", [])])
    # what stands: the wall pieces, the decor, the big city's tower (art-v5.2's TownTower: 2 x 2 on large, 3 x 3 on large3)
    items = [(p["front"], p["anchor"][0], cj, cp, cj["pieces"][p["piece"]]["frames"]["intact"], p["anchor"]) for p in L["walls"]]
    items += [(d["front"], d["at"][0], cj, cp, cj["decor"][d["piece"]], d["at"]) for d in L.get("decor", [])]
    tt = next((v for v in bj["buildings"].values() if v["type"] == 9), None)        # the client's buildingEntry
    if name.endswith("_d100"):                                                     # D-100: the keep, 3 x 3 in the middle
        items.append((2.0, 0.5, bj, bp, bj["buildings"]["Keep"]["states"]["done"], [0.5, 0.5]))
    elif name == "large" and tt:
        items.append((1.0, 0.0, bj, bp, tt["states"]["done"], [0.0, 0.0]))
    elif name == "large3" and tt:
        st = tt.get("sizes", {}).get("3", tt)["states"]
        items.append((2.0, 0.5, bj, bp, st["done"], [0.5, 0.5]))
    for _, _, j, pages, fr, (ax, ay) in items:                                # shadows first, on the ground
        f = j["shadows"].get(fr)
        if f:
            sh = _crop(pages["shadow"], f, 2 if f.get("half_res") else 1)
            k = 2 if f.get("half_res") else 1
            img.alpha_composite(sh, (int(sx(ax) - f["ax"] * k), int(sy(ay) - f["ay"] * k)))
    for _, _, j, pages, fr, (ax, ay) in sorted(items, key=lambda t: (t[0], t[1])):
        f = j["frames"][fr]
        img.alpha_composite(_crop(pages["color"], f), (int(sx(ax) - f["ax"]), int(sy(ay) - f["ay"])))
        t = j["team"].get(fr)
        if t:
            img.alpha_composite(_tint(_crop(pages["team"], t), NEUTRAL, j.get("team_gain", 1.0)),
                                (int(sx(ax) - t["ax"]), int(sy(ay) - t["ay"])))
    return img


def sheet(adir, c, names, title, out):
    from PIL import ImageFont
    ims = [town(adir, c, n) for n in names]
    font = ImageFont.truetype(config.fonts()["sans"], 34)
    small = ImageFont.truetype(config.fonts()["sans_regular"], 24)
    W = sum(i.width for i in ims) + 40 * (len(ims) + 1)
    H = max(i.height for i in ims) + 150
    o = Image.new("RGBA", (W, H), (244, 241, 234, 255))
    d = ImageDraw.Draw(o)
    d.text((40, 24), title, font=font, fill=(40, 40, 40))
    x = 40
    for n, im in zip(names, ims):
        d.text((x, 90), n, font=small, fill=(80, 80, 80))
        o.alpha_composite(im, (x, 130))
        x += im.width + 40
    o.convert("RGB").save(out)


if __name__ == "__main__":
    a = sys.argv[1:]
    sheet(Path(a[0]), a[1], a[2].split(","), a[4] if len(a) > 4 else f"castle_{a[1]} {a[2]}", a[3])
