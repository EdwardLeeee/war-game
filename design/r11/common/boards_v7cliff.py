"""art-v7.3 item 7 (the review 2026-11-04: 懸崖臂單格要附拼好的圖確認): the cliff pieces of terrain.json put together on the
diamond camera exactly as the client picks them (client/src/art/terrain.ts terrainPieces) and places them
(client/src/camera/projection.ts diamond: plane x = (x - y) A, y = (x + y) A / 2), in two draw orders:
- now: the client's terrain-draw.ts: by toPlane(0, front).y, i.e. the oblique camera's front edge, x only breaking ties;
- by depth: the diamond's own, x + y of the piece's anchor (posts + 0.6, so they cover the arms' ends).
A spearman stands behind the east-west face and one in front, drawn by their own x + y (the client's units).

python3 design/r11/common/boards_v7cliff.py ART OUT      ART: art-v7 (or later) x3 unpacked
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "r9" / "common"))
sys.path.insert(0, str(HERE))
import boards_r9 as B9          # noqa: E402
import boards_v7astc as V7A     # noqa: E402  (the ground, the shadow, put())
import scene_r9 as S9           # noqa: E402

CELL_PX = 120                   # x3: 2 m a cell, 60 px a metre
A = CELL_PX * math.sqrt(0.5)    # the plane per cell along each axis (a cell's diamond is 170 x 85)
CLIFF = 7
W, H = 16, 12
CELLS = {(6, 3), (5, 4),                          # one SW arm between two cells (the item)
         (12, 1), (11, 2), (10, 3),               # an SW line of three
         (2, 7), (3, 7), (4, 7), (5, 7), (6, 7),  # an east-west face
         (10, 7), (11, 8),                         # one SE arm
         (13, 4), (13, 5), (13, 6), (14, 6)}       # a north-south face turning east
MEN = [((4.5, 6.55), "behind"), ((5.6, 8.35), "in front")]
ORIGIN = (1000, 150)            # where the plane's (0, 0) lands in the 2442 x 1140 picture


def variant(x, y, n):
    return (x * 31 + y * 17 + ((x ^ y) & 7)) % n


def at(x, y):
    x, y = min(W - 1, max(0, x)), min(H - 1, max(0, y))
    return CLIFF if (x, y) in CELLS else 0


def pieces():
    """terrain.ts terrainPieces, the cliff part: (frame, x, y, front, kind)."""
    out = []
    for y in range(H):
        for x in range(W):
            if at(x, y) != CLIFF:
                continue
            links = [(dx, dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)
                     if (dx or dy) and at(x + dx, y + dy) == CLIFF and not (dx and dy and (at(x + dx, y) == CLIFF or at(x, y + dy) == CLIFF))]
            straight = len(links) == 2 and links[0][0] == -links[1][0] and links[0][1] == -links[1][1]
            if not straight:
                out.append((f"terrain_cliff_post_v{variant(x, y, 2)}", x + 0.5, y + 0.5, y + 1, "post"))
            arm = variant(x, y, 3)
            if at(x + 1, y) == CLIFF and x + 1 < W:
                out.append((f"terrain_cliff_arm_E_v{arm}", x + 1, y + 0.5, y + 0.99, "arm"))
            if at(x, y + 1) == CLIFF and y + 1 < H:
                out.append((f"terrain_cliff_arm_S_v{arm}", x + 0.5, y + 1, y + 1.99, "arm"))
            if at(x + 1, y + 1) == CLIFF and at(x + 1, y) != CLIFF and at(x, y + 1) != CLIFF:
                out.append((f"terrain_cliff_arm_SE_v{arm}", x + 1, y + 1, y + 1.99, "arm"))
            if at(x - 1, y + 1) == CLIFF and at(x - 1, y) != CLIFF and at(x, y + 1) != CLIFF and x > 0:
                out.append((f"terrain_cliff_arm_SW_v{arm}", x, y + 1, y + 1.99, "arm"))
    return out


def plane(x, y):
    return ORIGIN[0] + (x - y) * A, ORIGIN[1] + (x + y) * A / 2


def compose(art, order):
    base = V7A.ground(art, 3)
    ter = S9.Atlas(art / "terrain/terrain.json")
    spear = S9.Atlas(art / "units/spear_e/spear_e.json")
    items = []
    for frame, x, y, front, kind in pieces():
        if order == "now":       # terrain-draw.ts: depthOf(toPlane(0, front).y, floor(x), i), the units by their own y
            key = (front * A / 2, math.floor(x))
        else:                    # the diamond's depth: the anchor's x + y, a post a little later
            key = ((x + y + (0.6 if kind == "post" else 0.0)) * A / 2, x)
        spr = ter._crop("color", frame), ter._crop("shadow", frame)
        items.append((key, spr, x, y))
    for (x, y), _ in MEN:
        nm, _f = S9.unit_frame(spear, "spear_e", "idle", 6, 0)
        items.append((((x + y) * A / 2, x), spear.sprite(nm, "blue"), x, y))
    draws = []
    for key, spr, x, y in sorted(items, key=lambda t: t[0]):
        px, py = plane(x, y)
        draws.append((spr, px / 3, py / 3))
    for spr, sx, sy in draws:
        V7A.put(base, spr, sx, sy, 3)
    d = ImageDraw.Draw(base)
    for (x, y), label in MEN:
        px, py = plane(x, y)
        d.text((px + 40, py - 20), "牆後" if label == "behind" else "牆前", font=B9.font(40), fill=(255, 255, 255))
    return base


def main(art, out):
    out.mkdir(parents=True, exist_ok=True)
    now, fixed = compose(art, "now"), compose(art, "depth")
    crop = lambda im, b: im.crop(b)     # noqa: E731
    zoom = (420, 120, 1320, 720)        # the SW arms and the east-west face
    rows = [("整片（手機像素的一半）：左邊是 client 現在的排法，右邊照菱形的前後", None)]
    pair = Image.new("RGB", (2 * 1221 + 20, 570), B9.BG)
    pair.paste(now.resize((1221, 570), Image.LANCZOS), (0, 0))
    pair.paste(fixed.resize((1221, 570), Image.LANCZOS), (1241, 0))
    rows = [("整片（手機像素的一半）：左邊是 client 現在的排法（只看前緣的 y），右邊照菱形的前後（x + y）", pair)]
    z2 = Image.new("RGB", (2 * 900 + 20, 600), B9.BG)
    z2.paste(crop(now, zoom), (0, 0))
    z2.paste(crop(fixed, zoom), (920, 0))
    rows.append(("放大（手機像素）：單格的 SW 臂、三格的 SW 線、東西向的岩壁和兩名槍兵", z2))
    note = ("art-v7.3 第 7 件：懸崖的圖塊照 terrain.json 和 client 的挑法（terrain.ts）在菱形鏡頭拼起來確認。圖塊本身接得起來；"
            "問題在前後：client 的 terrain-draw.ts、castle-draw.ts 在菱形鏡頭還用斜看鏡頭的排法（toPlane(0, 前緣)，x 當 0），"
            "所以單格的 SW 臂蓋住它東邊那根岩柱，而地形和兵、建築（用自己的 x + y）混排時，地圖越東邊的岩壁越早畫，牆後的兵會畫在牆前面。"
            "右邊是照菱形前後排的樣子。")
    B9.board("V7C-01-懸崖臂單格-拼圖確認-phone", note, rows, out)
    print("board in", out)


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
