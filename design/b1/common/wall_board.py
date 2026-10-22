"""D-096 牆上的兵 drafts (the user 2026-10-22: 「上城牆不是這樣畫圖參考一下現實」): archers on the walls drawn the way the
client will draw them (agreed with war-game-client 2026-10-22): the wall piece, the units standing on it, then the
piece's front layer (`intact_front`, castle.front_only); everything else in depth order. Per culture: the small town's
palisade and the big city's stone wall, each seen from inside the town (a north wall: the camera is on the town side)
and from outside (a south wall: the attackers' side), at the phone's 3x pixels and at actual size.

python3 design/b1/common/wall_board.py SUFFIX UNITS_DIR [REFS_DIR]
  SUFFIX     prev (run.py d096_<c> --preview --ppm 60) or x3 (the full render)
  UNITS_DIR  folder with <unit>/r7v8/prod/<unit>/atlas_x3/<unit>.json (R8, the CI artifacts r7-v8-<unit>)
writes design/r8/out/R8-15-牆上的兵-東陸-mobile.png and R8-16-牆上的兵-西陸-mobile.png
"""
import json
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(1, str(HERE.parents[1] / "r8" / "common"))
import config           # noqa: E402
import proj             # noqa: E402
import scene            # noqa: E402  (b1's, before boards_r8 puts r6/common, which has its own, in front)
import boards_r8 as B   # noqa: E402  (the R8 unit atlases, boards)

boards = B.boards
proj.use_camera(proj.OBLIQUE)
DIR = config.BUILD / "b1" / "d096"
PPM = 60
LABEL = {"E": ("R8-15-牆上的兵-東陸-mobile", "東陸"), "W": ("R8-16-牆上的兵-西陸-mobile", "西陸")}
ARCHER = {"E": "bow_e", "W": "bow_w"}
FOOT = {"E": "spear_e", "W": "pike_w"}
INSIDE_BG, OUTSIDE_BG = (150, 146, 132), (104, 120, 84)     # paving inside the walls, grass outside


def piece(c, kind, suffix, team="blue", state="intact"):
    return scene.piece(DIR, f"castle_{kind}_{c}_{state}", suffix, team=team, ppm=PPM)


def stand(sp):
    return sp.meta.get("marks", {}).get("stand_at")


def unit(atlases, unit_, anim, facing, k, team):
    a = atlases[unit_]
    got = B.frame(a, unit_, anim, facing, k, team)
    if got is None:
        raise SystemExit(f"no frame {unit_} {anim} {facing} {k}")
    body, (ax, ay), sh = got
    return body, ax, ay, sh


def compose(layers, bg):
    """layers: [(image, ax, ay, (x, y, z) world point)] in drawing order -> the picture, cropped round everything."""
    boxes = []
    for img, ax, ay, p in layers:
        gx, gy = proj.to_px(p, (0, 0), PPM)
        boxes.append((gx - ax, gy - ay, gx - ax + img.width, gy - ay + img.height))
    pad = 24
    x0, y0 = min(b[0] for b in boxes) - pad, min(b[1] for b in boxes) - pad
    x1, y1 = max(b[2] for b in boxes) + pad, max(b[3] for b in boxes) + pad
    can = Image.new("RGBA", (int(x1 - x0), int(y1 - y0)), (*bg, 255))
    for img, ax, ay, p in layers:
        gx, gy = proj.to_px(p, (-x0, -y0), PPM)
        can.alpha_composite(img, (int(round(gx - ax)), int(round(gy - ay))))
    return can.convert("RGB")


def wall_scene(c, suffix, atlases, stone, side, attackers):
    """A stretch of wall on `side` ("n": seen from the town, "s": from outside), a corner at its west end, four archers
    on it; attackers on the ground outside when asked."""
    w = "sw" if stone else "pal"
    cells = [-2.0, 0.0, 2.0, 4.0]                 # the wall cells' middles along x (metres), on the line y = 0
    layers, shadows = [], []
    corner = piece(c, "sw_ctower" if stone else "pal_corner", suffix) if (DIR / f"castle_{'sw_ctower' if stone else 'pal_corner'}_{c}_intact_{suffix}.json").exists() else None
    if corner is not None:
        # the corner tower's 2 x 2 cells: its outer row on the wall's line; the corner post: one cell
        cx, cy = (-5.0, (-1.0 if side == "n" else 1.0)) if stone else (-4.0, 0.0)
        layers.append((corner.img, corner.ax, corner.ay, (cx, cy, 0.0)))
        if corner.shadow:
            shadows.append((*corner.shadow, (cx, cy, 0.0)))
    walls = [piece(c, f"{w}_{side}", suffix) for _ in cells]
    for sp, x in zip(walls, cells):
        layers.append((sp.img, sp.ax, sp.ay, (x, 0.0, 0.0)))
        if sp.shadow:
            shadows.append((*sp.shadow, (x, 0.0, 0.0)))
    st = stand(walls[0])
    facing = 2 if side == "n" else 6
    poses = [("attack", 3), ("idle", 0), ("attack", 6), ("attack", 1)]
    for x, (anim, k) in zip(cells, poses):
        body, ax, ay, _ = unit(atlases, ARCHER[c], anim, facing, k, "blue")
        layers.append((body, ax, ay, (x + st[0], st[1], st[2])))
    fp = DIR / f"castle_{w}_{side}_{c}_intact_front_{suffix}.json"
    if fp.exists():
        front = scene.piece(DIR, f"castle_{w}_{side}_{c}_intact_front", suffix, team="blue", ppm=PPM, shadow=False)
        for x in cells:
            layers.append((front.img, front.ax, front.ay, (x, 0.0, 0.0)))
    if attackers:
        foot = FOOT[c]
        for i, (x, y) in enumerate(((-1.2, -4.2), (1.0, -4.6), (3.1, -4.0), (0.0, -6.0), (2.2, -6.4), (4.3, -5.8))):
            body, ax, ay, sh = unit(atlases, foot, "walk" if i % 2 else "idle", 2, (i * 3) % 8, "red")
            layers.append((body, ax, ay, (x, y, 0.0)))
            if sh:
                shadows.append((*sh, (x, y, 0.0)))
        layers[-6:] = sorted(layers[-6:], key=lambda L: -L[3][1])
    bg = INSIDE_BG if side == "n" else OUTSIDE_BG
    return compose([(s[0], s[1], s[2], s[3]) for s in shadows] + layers, bg)


def board(c, suffix, atlases):
    label, side_name = LABEL[c]
    W = 2500
    text = (f"牆上的兵（D-096），{side_name}，暫用版（現在建築的畫風）。使用者 2026-10-22 看了 #266 的截圖說"
            "「上城牆不是這樣畫圖參考一下現實」：弓手站在尖樁上面、畫在牆前面不對。\n"
            "改成照真實的樣子：\n"
            "・木柵（小鎮）：尖樁照舊，城裡那一側加一道射擊台（木板走道架在柱子上），弓手站在台上，尖樁到胸口，只露出頭、肩和弓。\n"
            "・石牆（大城）：牆頂是走道；外側一道有垛口的胸牆（垛口下緣在腰的高度，垛子比人頭還高，"
            + ("垛子上有射眼、蓋瓦" if c == "E" else "垛子上有箭縫") + "）；城裡那一側一道矮的"
            + ("女牆" if c == "E" else "護牆") + "。\n"
            "・從城裡看（北牆）：看到弓手的背；從城外看（南牆，進攻方的角度）：胸牆或尖樁擋住下半身。\n"
            "client 的畫法（和 war-game-client 談好）：先畫牆，再畫牆上的兵，最後把牆的前片蓋上去。"
            "四面牆分開成不同的圖，因為走道在城裡那一側。上：手機 3 倍；下：實際大小。")
    parts = [boards.header(W, label, text)]
    big, small = [], []
    for stone, name in ((False, "木柵（小鎮）"), (True, "石牆（大城）")):
        for side, view, att in (("n", "從城裡看（北牆）", False), ("s", "從城外看（南牆，進攻方）", True)):
            img = wall_scene(c, suffix, atlases, stone, side, att)
            big.append(boards.captioned(img, f"{name}　{view}", 24))
            small.append(boards.captioned(img.resize((img.width // 3, img.height // 3), Image.LANCZOS), f"{name}　{view}", 20))
    parts.append(boards.row(big[:2], W, gap=24))
    parts.append(boards.row(big[2:], W, gap=24))
    parts.append(boards.row([boards.captioned(boards.row(small, W - 2 * boards.M, gap=24), "實際大小（1 倍，手機的點）", 24)], W))
    return boards.save(boards.stack(parts, W), label)


def atlases_from(d):
    d = Path(d)
    out = {}
    for u in ("bow_e", "bow_w", "spear_e", "pike_w"):
        p = d / u / "r7v8" / "prod" / u / "atlas_x3" / f"{u}.json"
        out[u] = B.field.Atlas(p)
    return out


if __name__ == "__main__":
    sfx, udir = sys.argv[1], sys.argv[2]
    at = atlases_from(udir)
    for c in ("E", "W"):
        print(board(c, sfx, at))
