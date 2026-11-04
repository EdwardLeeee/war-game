"""art-v7 PR2's review boards (D-118): every frame of the building, castle, node and terrain atlases (atlas_b1, the
pieces re-rendered on the diamond camera, targets r8d7_*), each on a patch of the ground with its shadow, blue.

python3 design/r11/common/boards_v7buildings.py ATLAS_X3 GRASS OUT
  ATLAS_X3: the buildings-atlas run's atlas_x3/ (buildings/, castle/, nodes/, terrain/); GRASS: a ground tile
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "r9" / "common"))
import boards_r9 as B9    # noqa: E402
import scene_r9 as S9     # noqa: E402

SHEETS = [("V7B-01-東陸建築", "buildings/buildings_E.json"), ("V7B-02-西陸建築", "buildings/buildings_W.json"),
          ("V7B-03-東陸城牆", "castle/castle_E.json"), ("V7B-04-西陸城牆", "castle/castle_W.json"),
          ("V7B-05-資源點", "nodes/nodes.json"), ("V7B-06-地形", "terrain/terrain.json")]


def tile(a, name, grass, pad=24):
    (im, ax, ay), sh = a.sprite(name, "blue")
    x0, y0, x1, y1 = -ax, -ay, im.width - ax, im.height - ay
    if sh:
        si, sx, sy = sh
        x0, y0, x1, y1 = min(x0, -sx), min(y0, -sy), max(x1, si.width - sx), max(y1, si.height - sy)
    w, h = int(x1 - x0) + 2 * pad, int(y1 - y0) + 2 * pad
    bg = Image.new("RGBA", (w, h))
    for x in range(0, w, grass.width):
        for y in range(0, h, grass.height):
            bg.paste(grass, (x, y))
    X, Y = pad - x0, pad - y0
    if sh:
        # the shadow darkens the ground it falls on, keeping its colour (lit x (0.45, 0.46, 0.50), as R11's composer and
        # the client): a navy overlay read as blue dots (PR2 review 2)
        import numpy as np
        si, sx, sy = sh
        a = np.zeros((h, w), np.float32)
        sa = np.asarray(si.getchannel("A"), np.float32) / 255.0
        x0, y0 = int(X - sx), int(Y - sy)
        xa, ya, xb, yb = max(0, x0), max(0, y0), min(w, x0 + si.width), min(h, y0 + si.height)
        if xa < xb and ya < yb:
            a[ya:yb, xa:xb] = sa[ya - y0:yb - y0, xa - x0:xb - x0]
        g = np.asarray(bg, np.float32)
        k = 1 - a[..., None] * (1 - np.array([0.45, 0.46, 0.50]))
        g[..., :3] *= k
        bg = Image.fromarray(np.clip(g, 0, 255).astype(np.uint8), "RGBA")
    bg.alpha_composite(im, (int(round(X - ax)), int(round(Y - ay))))
    return bg.convert("RGB")


def sheet(a, grass, width=2600, scale=2 / 3):
    names = sorted(a.j["frames"])
    tiles = []
    for n in names:
        t = tile(a, n, grass)
        tiles.append((n, t.resize((max(1, int(t.width * scale)), max(1, int(t.height * scale))), Image.LANCZOS)))
    x = y = 0
    rowh = 0
    pos = []
    for n, t in tiles:
        if x + t.width > width:
            x, y, rowh = 0, y + rowh + 34, 0
        pos.append((n, t, x, y))
        x += t.width + 10
        rowh = max(rowh, t.height)
    o = Image.new("RGB", (width, y + rowh + 34), B9.BG)
    d = ImageDraw.Draw(o)
    for n, t, x, y in pos:
        o.paste(t, (x, y))
        d.text((x, y + t.height + 4), n, font=B9.font(18, False), fill=B9.INK)
    return o


def main(atlas_x3, grass_p, out):
    out.mkdir(parents=True, exist_ok=True)
    grass = Image.open(grass_p).convert("RGBA")
    note = ("art-v7 量產 PR 2（D-118）：圖集要的每一件（建築、城牆、資源點、地形）用菱形鏡頭（仰角 30 度、方位角 −45 度）重算，"
            "每件照它最後的定義（371 件，CI 的 r8d7_0–46）；描述檔都寫 \"view\": \"diamond\"。每張是圖集裡的一格，藍隊，3 倍畫質的 2/3。")
    for label, rel in SHEETS:
        a = S9.Atlas(Path(atlas_x3) / rel)
        B9.board(f"{label}-phone", note, [(rel, sheet(a, grass))], out)
    print("boards in", out)


if __name__ == "__main__":
    a = sys.argv
    main(Path(a[1]), a[2], Path(a[3]))
