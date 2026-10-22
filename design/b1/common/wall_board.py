"""D-096 牆上的兵 drafts (the user 2026-10-22: 「上城牆不是這樣畫圖參考一下現實」): archers on the walls drawn the way the
client will draw them (agreed with war-game-client 2026-10-22): the wall piece, the units standing on it, then the
piece's front layer (`intact_front`, castle.front_only); everything else in depth order. Per culture: the small town's
palisade and the big city's stone wall, each seen from inside the town (a north wall: the camera is on the town side)
and from outside (a south wall: the attackers' side), at the phone's 3x pixels and at actual size.

python3 design/b1/common/wall_board.py SUFFIX UNITS_DIR [REFS_DIR]
  SUFFIX     prev (run.py d096_<c> --preview --ppm 60) or x3 (the full render)
  UNITS_DIR  folder with <unit>/r7v8/prod/<unit>/atlas_x3/<unit>.json (R8, the CI artifacts r7-v8-<unit>)
  REFS_DIR   research/wall-reference (the reference pictures, REFS)
writes design/r8/out/R8-15-牆上的兵-東陸-mobile.png and R8-16-牆上的兵-西陸-mobile.png
"""
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


FACE_OUT = {"n": 2, "s": 6, "w": 4, "e": 0}       # an archer on a wall looks out of the town


def town_scene(c, suffix, atlases, stone):
    """The whole town's walls as the client lays them out (common/castle.py placements: closed gates, the corners),
    archers on every other cell of plain wall looking out; each piece, then the archers on it, then its front."""
    import castle as CASTLE
    L = CASTLE.large() if stone else CASTLE.small()
    pieces = sorted(CASTLE.placements(L), key=lambda q: (q["front"], q["anchor"][0]))
    layers = []
    k = 0
    for q in pieces:
        kind = q["piece"]
        state = "closed" if kind in CASTLE.GATE_PIECES else "intact"
        sp = piece(c, kind, suffix, state=state)
        at = (q["anchor"][0] * 2.0, -q["anchor"][1] * 2.0, 0.0)          # the sim's cells (+y south) to metres
        layers.append((sp.img, sp.ax, sp.ay, at))
        side = kind.split("_")[1] if kind.count("_") == 1 and kind.split("_")[1] in FACE_OUT else None
        if side is None:
            continue
        k += 1
        if k % 2:
            st = stand(sp)
            body, ax, ay, _ = unit(atlases, ARCHER[c], "attack", FACE_OUT[side], (k * 3) % 8, "blue")
            layers.append((body, ax, ay, (at[0] + st[0], at[1] + st[1], st[2])))
        fp = DIR / f"castle_{kind}_{c}_intact_front_{suffix}.json"
        if fp.exists():
            fr = scene.piece(DIR, f"castle_{kind}_{c}_intact_front", suffix, team="blue", ppm=PPM, shadow=False)
            layers.append((fr.img, fr.ax, fr.ay, at))
    return compose(layers, INSIDE_BG)


# research/wall-reference (not in this repo; public domain and CC0 only, THIRD_PARTY_NOTICES.md): what is on the boards
REFS = [
    ("02-史坦威克斯堡重建-圓木胸牆內側站台與人的比例.jpg", "02 史坦威克斯堡重建（美國國家公園管理局，公有領域）：圓木胸牆內側的站台［二手］"),
    ("03-史坦威克斯堡重建-外圍尖木樁在下-守軍胸牆在上.jpg", "03 同一座堡從外面看：尖樁在下、守軍在胸牆後［二手］"),
    ("05-迪利希1641築城書-胸牆踏台剖面與木樁位置.jpg", "05 迪利希 1641 築城書剖面：胸牆、踏台、木樁［一手］"),
    ("06-武經總要-城制-女頭垛口與馬面敵棚.jpg", "06《武經總要》城制：女頭、垛口［一手，清代重繪］"),
    ("09-西安明城牆-城頂走道-外側垛牆與內側宇牆.jpg", "09 西安明城牆頂：外側垛牆、內側宇牆（Gary Todd，CC0）［一手］"),
    ("14-維奧萊勒杜克-卡卡松城堡垛口-附4公尺比例尺.jpg", "14 維奧萊勒杜克：卡卡松的垛口，附 4 公尺比例尺［二手］"),
]
POINTS = ("依據（考據筆記 research/wall-reference/notes.md）：\n"
          "・木柵：守軍站在胸牆後的踏台上，胸牆頂比踏台高約 1.3 公尺，矮個子也能從牆頂射擊（Mahan 1862 野戰築城教本）。"
          "我們：尖樁高出射擊台 1.3 公尺。\n"
          "・中國城牆：外側垛牆的「女頭」約 1.55 公尺，每 1.86 公尺一個（《守城錄》）；城裡那一側的宇牆 0.8–1 公尺（明代北京城）。"
          "我們（東陸）：垛 1.55 公尺、垛口寬 0.45 公尺、垛口下緣 1 公尺、女牆 0.9 公尺。\n"
          "・歐洲城牆：垛約 2 公尺高，可以把人整個藏住；垛口寬 0.7–1 公尺，下緣離走道約 1 公尺；一個垛口站一個人（維奧萊勒杜克）。"
          "我們（西陸）：垛 2 公尺、垛口 0.7 公尺、下緣 1 公尺。\n"
          "・世紀帝國 4 只看了文字說明，沒有放它的圖（版權）。")


def refs_part(W, folder):
    from PIL import ImageDraw
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    h = 250
    tiles = []
    for name, cap in REFS:
        im = Image.open(Path(folder) / name).convert("RGB")
        im = im.resize((round(im.width * h / im.height), h), Image.LANCZOS)
        w = max(im.width, 280)
        th = boards.wrap(probe, 0, 0, cap, w, size=20) + 8
        t = Image.new("RGB", (w, h + th + 8), boards.BG)
        t.paste(im, (0, 0))
        boards.wrap(ImageDraw.Draw(t), 0, h + 8, cap, w, size=20, fill=boards.INK)
        tiles.append(t)
    row = boards.row(tiles, W, gap=18)
    th = boards.wrap(probe, 0, 0, POINTS, W - 2 * boards.M, size=24) + 16
    txt = Image.new("RGB", (W, th), boards.BG)
    boards.wrap(ImageDraw.Draw(txt), boards.M, 4, POINTS, W - 2 * boards.M, size=24, fill=boards.INK)
    return boards.stack([boards.row([boards.captioned(Image.new("RGB", (W - 2 * boards.M, 2), boards.BG),
                                                      "真實的樣子（只放公有領域和 CC0 的圖）", 26)], W), row, txt], W)


def board(c, suffix, atlases, refs=None):
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
            "四面牆分開成不同的圖，因為走道在城裡那一側。\n"
            "東西兩面牆從這個鏡頭看是側面：弓手站在尖樁或胸牆旁邊，看得到全身。\n"
            "最下面是整座城的實際大小：城門關著，弓手站在每隔一格的牆上、面向城外。上：手機 3 倍；中、下：實際大小。")
    parts = [boards.header(W, label, text)]
    if refs:
        parts.append(refs_part(W, refs))
    big, small = [], []
    for stone, name in ((False, "木柵（小鎮）"), (True, "石牆（大城）")):
        for side, view, att in (("n", "從城裡看（北牆）", False), ("s", "從城外看（南牆，進攻方）", True)):
            img = wall_scene(c, suffix, atlases, stone, side, att)
            big.append(boards.captioned(img, f"{name}　{view}", 24))
            small.append(boards.captioned(img.resize((img.width // 3, img.height // 3), Image.LANCZOS), f"{name}　{view}", 20))
    parts.append(boards.row(big[:2], W, gap=24))
    parts.append(boards.row(big[2:], W, gap=24))
    parts.append(boards.row([boards.captioned(boards.row(small, W - 2 * boards.M, gap=24), "實際大小（1 倍，手機的點）", 24)], W))
    towns = []
    for stone, name in ((False, "整座小鎮（木柵）"), (True, "整座大城（石牆）")):
        img = town_scene(c, suffix, atlases, stone)
        towns.append(boards.captioned(img.resize((img.width // 3, img.height // 3), Image.LANCZOS),
                                      f"{name}　實際大小", 22))
    parts.append(boards.row(towns, W, gap=40))
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
    rdir = sys.argv[3] if len(sys.argv) > 3 else None
    at = atlases_from(udir)
    for c in ("E", "W"):
        print(board(c, sfx, at, rdir))
