"""R8 batch 2 style samples (ceo 2026-10-22: before everything is produced, the user sees the direction): per culture
the main city, a house and the barracks in the realistic look (blender/arch_r8.py, render_b1.py LOOK "r8") at the phone's
3x pixels and at actual size, with the period references beside them (public domain and CC0 only); the ground's five
layers blended as the client blends them (ground_r8.py); the cliff beside the walls (terrain_r8.py); an overview; and a
memory table per category (uncompressed RGBA8 and ASTC 4x4, at 2x).

python3 design/r8/common/samples_r8.py SUFFIX GROUND_DIR RESEARCH_DIR [UNITS_DIR]
  SUFFIX        x3 (run.py r8b_samples, r8b_compare) or prev (--preview --ppm 60)
  GROUND_DIR    ground_run.py's output (ground/, sample_top.png)
  RESEARCH_DIR  the research worktree (east-arch-reference, west-arch-reference, nature-reference, wall-reference)
writes design/r8/out/R8-21 ... R8-25 and memory_samples.json
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "b1" / "common"))
import config   # noqa: E402
import proj     # noqa: E402
import scene    # noqa: E402
import b1art    # noqa: E402
sys.path.insert(0, str(HERE.parents[1] / "r6" / "common"))
import boards   # noqa: E402

boards.OUT = HERE.parent / "out"
proj.use_camera(proj.OBLIQUE)
DIR = config.BUILD / "b1" / "r8b"
UNITS_DIR = None   # the R8 unit atlases (CI artifacts r7-v8-<unit>), for units on the ground sample
NAMES = {"main_city": "主城", "house": "民居", "barracks": "兵營"}
FOOT = {"main_city": (4, 4), "house": (2, 2), "barracks": (3, 3)}
SIDE = {"E": "東陸", "W": "西陸"}
REFS = {}          # culture -> [(file in research, caption)]
POINTS = {}        # culture -> the design points (text)
REFS["E"] = [
    ("03-南禪寺大殿模型-三開間歇山頂與台基踏道.jpg", "03 南禪寺大殿（782）模型（Gary Todd，CC0）：三開間歇山頂、台基和踏道 → 主城［一手實物的模型］"),
    ("01-佛光寺東大殿模型-七開間廡殿頂與大斗栱.jpg", "01 佛光寺東大殿（857）模型（CC0）：斗栱約柱高的一半、緩坡屋頂［一手實物的模型］"),
    ("08-懿德太子墓壁畫-闕樓-紅柱與七朱八白.jpg", "08 懿德太子墓壁畫闕樓（706，公有領域）：紅柱、白牆、橫樑的七朱八白［一手］"),
    ("09-隋唐陶屋-鴟尾筒瓦與直櫺窗.jpg", "09 隋唐陶屋（Gary Todd，CC0）：鴟尾、筒瓦一壟一壟、直櫺窗［一手］"),
    ("10-唐三彩院落模型-門屋正堂廂房圍牆.jpg", "10 唐三彩院落模型（CC0）：門屋、正堂、廂房、圍牆 → 民居、兵營的配置［一手］"),
    ("12-營造法式-殿堂六鋪作側樣-柱斗栱屋架剖面.jpg", "12《營造法式》殿堂側樣（1103，公有領域）：柱、斗栱、屋架的比例［一手］"),
]
POINTS["E"] = (
    "東陸建築樣本（R8 第二批，寫實畫風：CC0 材質、和寫實兵同一套打光、不畫輪廓）。年代唐末五代，考據筆記 research/east-arch-reference。\n"
    "・不是日式、也不是明清：屋頂坡度緩（殿 22–28 度、民居 25–30 度，不超過 34 度），屋簷只微微彎、屋角幾乎不翹（三開間殿約 6 公分）。\n"
    "・殿的等級看斗栱：主城的斗栱約柱高的一半（佛光寺），兵營小一號，民居只用柱子撐屋頂。屋脊兩端的鴟尾只有主城這種殿才有，約正面寬的五分之一。\n"
    "・顏色：柱、樑、門窗是土朱紅，牆刷白，瓦是灰的；主城的橫樑畫「七朱八白」（紅底上一格格白塊，懿德太子墓壁畫）。門是板門加門釘，窗是直櫺窗。\n"
    "・瓦是一壟一壟的筒瓦（中國屋頂最好認的紋理），8 公尺寬的主城約 25 壟。\n"
    "・主城：州府的正堂，三開間歇山頂，坐在 1.1 公尺高的台基上，前有踏道、兩盞石燈。\n"
    "・民居：一棟主屋，懸山頂、土牆加白灰、一小段夯土院牆、水缸。兵營：五開間的營房，前有走廊，操練場上有槍架和戰鼓。\n"
    "・玩家色在旗子和掛布上。")
REFS["nature"] = [
    ("11-懸崖-太行山紅砂岩-層理與崖間綠帶.jpg", "11 太行山紅砂岩（CC0）：一層一層的岩層，層間長草［一手］"),
    ("12-懸崖-猊鼻溪石灰岩-岩縫植物與不規則崖頂.jpg", "12 猊鼻溪石灰岩崖（CC0）：岩縫長植物、崖頂高低不平［一手］"),
    ("13-懸崖-石灰岩崖腳-岩屑錐.jpg", "13 石灰岩崖腳的岩屑錐（CC0）：崩落的碎石往外散成一片坡［一手］"),
]
REFS["W"] = [
    ("07-伊珀爾布料大廳與鐘樓-1855至1862年照片.jpg", "07 伊珀爾布料大廳和鐘樓（1855–62 年照片，公有領域）：市政廳加鐘樓 → 主城［一手實物］"),
    ("10-奧克姆城堡大廳與環牆-18世紀版畫.jpg", "10 奧克姆城堡大廳（版畫，公有領域）：守軍住的石造長屋 → 兵營［實物一手、圖二手］"),
    ("09-維奧萊勒杜克-維托13世紀後半民居-附5公尺比例尺.jpg", "09 維托的 13 世紀民居（維奧萊勒杜克，公有領域）：山牆朝街、出簷［二手］"),
    ("11-大科克斯韋爾穀倉-石板瓦陡屋頂與扶壁-約1292年.jpg", "11 大科克斯韋爾穀倉（約 1292，公有領域）：石板瓦陡屋頂、扶壁［一手實物］"),
    ("03-維拉爾手稿-屋架與單坡屋頂-約1230年.jpg", "03 維拉爾手稿的屋架（約 1230，公有領域）：陡屋頂的木構［一手］"),
    ("13-勒特雷爾詩篇163v-編籬羊圈-14世紀.jpg", "13 勒特雷爾詩篇的編籬羊圈（公有領域）：編籬圍欄［一手］"),
]
POINTS["W"] = (
    "西陸建築樣本（R8 第二批，寫實畫風：CC0 材質、和寫實兵同一套打光、不畫輪廓）。年代約 1250 年西歐，考據筆記 research/west-arch-reference。\n"
    "・屋頂陡，50–60 度（維拉爾的屋架、維托民居、大科克斯韋爾穀倉量出來的）。鄉下用茅草，城裡用石板瓦、木瓦。農舍沒有煙囪，屋脊開煙孔。\n"
    "・一般房子：木架，中間編籬抹泥、刷石灰；有身分的用石頭。窗是早期哥德式的尖拱窗。\n"
    "・主城：城市的市政廳加鐘樓（伊珀爾布料大廳）。樓下是開放的市場拱廊，樓上是議事大廳，前角一座方鐘樓。鐘樓頂上一圈垛口、不做尖頂，免得看起來像教堂。\n"
    "・民居：農舍。木架山牆朝鏡頭，茅草頂，前面編籬圍欄。\n"
    "・兵營：城堡裡守軍住的長屋（奧克姆城堡大廳）。石造底層、木架上層，石板瓦陡屋頂，屋脊有煙孔；前面操練場有練劍的木樁和長矛架。\n"
    "・真實的建築比遊戲占地大 2–5 倍：量體壓縮到格子裡，比例和材料照真的。玩家色在旗子和掛布上。")


def piece(name, suffix, pp, team="blue"):
    return scene.piece(DIR, name, suffix, team=team, ppm=20 * pp)


def tile(name, suffix, pp, foot, team="blue"):
    sp = piece(name, suffix, pp, team)
    return b1art.tile(scene.with_fx(sp), pp, footprint=foot, min_size=(140 * pp, 140 * pp))


def run_tile(name, suffix, pp, n=3, team="blue"):
    """n cells of one wall piece side by side (a run of wall, as long as the cliff beside it)."""
    items = [scene.piece(DIR, name, suffix, team=team, ppm=20 * pp, x=(i - (n - 1) / 2) * 2.0) for i in range(n)]
    return b1art.tile(items, pp, footprint=(n, 1), min_size=(140 * pp, 140 * pp))


def refs_row(W, folder, refs, h=300):
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    tiles = []
    for name, cap in refs:
        im = Image.open(Path(folder) / name).convert("RGB")
        im = im.resize((max(1, round(im.width * h / im.height)), h), Image.LANCZOS)
        w = max(im.width, 280)
        th = boards.wrap(probe, 0, 0, cap, w, size=20) + 8
        t = Image.new("RGB", (w, h + th + 8), boards.BG)
        t.paste(im, (0, 0))
        boards.wrap(ImageDraw.Draw(t), 0, h + 8, cap, w, size=20, fill=boards.INK)
        tiles.append(t)
    # as many rows as it takes
    rows, cur, x = [], [], 0
    for t in tiles:
        if cur and x + t.width > W - 4 * boards.M:
            rows.append(cur)
            cur, x = [], 0
        cur.append(t)
        x += t.width + 18
    if cur:
        rows.append(cur)
    return [boards.row(r, W, gap=18) for r in rows]


def text_block(W, text, size=24):
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    th = boards.wrap(probe, 0, 0, text, W - 2 * boards.M, size=size) + 16
    im = Image.new("RGB", (W, th), boards.BG)
    boards.wrap(ImageDraw.Draw(im), boards.M, 4, text, W - 2 * boards.M, size=size, fill=boards.INK)
    return im


def frame_bytes(name, suffix):
    """A frame's pixels at 2x as the packer would keep them (trimmed colour; the team layer's own box; the shadow at
    half size): (RGBA8 bytes, ASTC 4x4 bytes)."""
    px = 0
    for layer in ("beauty", "mask", "shadow"):
        p = DIR / f"{name}_{suffix}_{layer}.png"
        if not p.exists():
            continue
        im = Image.open(p)
        a = np.asarray(im.convert("RGBA"))[..., 3] if layer != "mask" else np.asarray(im.convert("L"))
        ys, xs = np.nonzero(a > 8)
        if len(xs) == 0:
            continue
        w, h = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
        meta = json.loads((DIR / f"{name}_{suffix}.json").read_text())
        f = 40.0 / meta["px_per_m"]                  # to 2x (40 px a metre)
        if layer == "shadow":
            f *= 0.5
        px += int(w * f) * int(h * f)
    return px * 4, px


def board_buildings(c, suffix, research, W=2800):
    label = f"R8-2{1 if c == 'E' else 2}-建築樣本-{SIDE[c]}-mobile"
    folder = research / ("east-arch-reference" if c == "E" else "west-arch-reference")
    parts = [boards.header(W, label, POINTS[c])]
    parts += refs_row(W, folder, REFS[c])
    big = [boards.captioned(tile(f"r8b_{k}_{c}_new", suffix, 3, FOOT[k]), f"{NAMES[k]}（3 倍，{FOOT[k][0]}×{FOOT[k][1]} 格）", 24)
           for k in NAMES]
    parts.append(boards.row(big, W, gap=24))
    teams = [boards.captioned(tile(f"r8b_main_city_{c}_new", suffix, 1, FOOT["main_city"], team=t), n, 20)
             for t, n in (("neutral", "沒有玩家色"), ("blue", "藍"), ("red", "紅"))]
    small = [boards.captioned(tile(f"r8b_{k}_{c}_new", suffix, 1, FOOT[k]), NAMES[k], 20) for k in NAMES]
    parts.append(boards.row([boards.captioned(boards.row(small + teams, W - 2 * boards.M, gap=20), "實際大小（1 倍，手機的點）", 24)], W))
    return boards.save(boards.stack(parts, W), label)


def board_ground(gdir, research, W=2800):
    label = "R8-23-地面樣本-mobile"
    g = json.loads((gdir / "ground" / "ground.json").read_text())
    sw = []
    for L in g["layers"]:
        im = Image.open(gdir / "ground" / L["file"]).convert("RGB")
        two = Image.new("RGB", (im.width * 2, im.height * 2))
        for i in range(2):
            for j in range(2):
                two.paste(im, (i * im.width, j * im.height))
        two = two.resize((300, 300), Image.LANCZOS)
        sw.append(boards.captioned(two, f"{L['id']}：一塊 {L['tile_m']} 公尺（接起來 2×2）", 20))
    top = Image.open(gdir / "sample_top.png")
    cam = Image.open(gdir / "sample_cam.png")
    cam = cam.resize((cam.width * 3 // 2, cam.height * 3 // 2), Image.LANCZOS).convert("RGBA")
    if UNITS_DIR:                                         # R8 units standing on it, at the same scale (36 px a metre)
        import boards_r8 as B
        f = 36 / 60
        for i, (u, anim, k, team, x, y) in enumerate((("spear_e", "idle", 0, "blue", 9.0, 15.0), ("spear_e", "walk", 3, "blue", 10.4, 15.6),
                                                       ("bow_e", "attack", 4, "blue", 11.6, 14.8), ("pike_w", "walk", 2, "red", 21.0, 16.5),
                                                       ("bow_w", "idle", 0, "red", 22.4, 17.2), ("farmer_e", "idle", 0, "blue", 20.5, 22.4))):
            a = B.field.Atlas(Path(UNITS_DIR) / u / "r7v8" / "prod" / u / "atlas_x3" / f"{u}.json")
            body, (ax, ay), _ = B.frame(a, u, anim, 6 if team == "blue" else 2, k, team)
            body = body.resize((max(1, int(body.width * f)), max(1, int(body.height * f))), Image.LANCZOS)
            cam.alpha_composite(body, (int(x * 36 - ax * f), int(y * 18 - ay * f)))
    cam = cam.convert("RGB")
    text = ("地面（R8 第二批）：五層可以無縫接的材質，已經打好光（和兵、建築同一個太陽），高度放在透明度裡；"
            "格式照 client 2026-10-21 談好的 war-game ground 1（ground.json）。混合照 client 的著色器："
            "草地到處都是，大片的乾草地用一個慢的雜訊混進去；資源點旁和零星的地方露土；岩石、懸崖腳下是碎石；水邊是河岸泥。"
            "交界用雜訊和高度打散，不是直線。\n"
            "左：五層各自（接起來 2×2 看接縫）；下：一段 40×40 公尺的樣本，上面是從正上方看，右邊是遊戲的鏡頭（方形斜看，前後壓成一半）。"
            "水面是暫時的平塗，寫實的水在第二批的地形裡。地面比兵暗、飽和度比兵低，讓兵一眼找得到（右圖站了幾名寫實兵）。\n"
            "這張用的就是要出貨的設定：ground.json 的 grade 亮度 1.0、飽和度 0.9；零星露土的門檻 0.8（越高露土越少）。"
            "五層的材質都是 Poly Haven 的 CC0 照片，重新上色、打光。")
    parts = [boards.header(W, label, text), boards.row(sw, W, gap=20)]
    parts.append(boards.row([boards.captioned(top.resize((top.width // 2 * 2 // 2, top.height // 2)), "從正上方看（每公尺 12 點）", 22),
                             boards.captioned(cam, "遊戲的鏡頭，上面站著寫實兵（實際大小約 1.8 倍）", 22)], W, gap=30))
    return boards.save(boards.stack(parts, W), label)


def board_cliff(suffix, research, W=2800):
    label = "R8-24-懸崖和城牆-mobile"
    text = ("懸崖和城牆擺在一起比（ceo 轉達：之前的懸崖遠看像城牆）。懸崖照天然岩壁做，凡是城牆有的它都沒有：\n"
            "・平面彎來彎去、頂端高低不平（城牆筆直、一樣高）；\n"
            "・岩面分層：一層一層的岩架、凹凸、懸出的岩塊、直的裂縫（城牆是一整片平面加垛口）；\n"
            "・上亮下暗兩種岩色，岩架上有苔和草，頂上一層草皮和灌木（城牆一種石色、光禿禿）；\n"
            "・腳下一片崩落的碎石往外散（城牆乾乾淨淨站在地上）。\n"
            "城牆是 D-096 的樣子換上寫實材質（第二批會照同樣的格局重做寫實版：射擊台、前片、城門四種樣子、牆上投石）。")
    cl = tile("r8b_cliff", suffix, 3, (3, 1))
    walls = [run_tile(f"r8b_{k}_{c}", suffix, 3) for c in ("E", "W") for k in ("sw_s", "pal_s")]
    names = ["石牆（東陸）", "木柵（東陸）", "石牆（西陸）", "木柵（西陸）"]
    W = max(W, sum(t.width + 24 for t in [cl] + walls) + 2 * boards.M + 20)     # the row fits
    parts = [boards.header(W, label, text)]
    parts.append(boards.row([boards.captioned(cl, "懸崖（3 格長，3 倍）", 24)] +
                            [boards.captioned(w_, n + "（3 格長，3 倍）", 22) for w_, n in zip(walls, names)], W, gap=24))
    small = [boards.captioned(tile("r8b_cliff", suffix, 1, (3, 1)), "懸崖", 20)] + \
            [boards.captioned(run_tile(f"r8b_{k}_{c}", suffix, 1), n, 20) for (c, k), n in
             zip([(c, k) for c in ("E", "W") for k in ("sw_s", "pal_s")], names)]
    parts.append(boards.row([boards.captioned(boards.row(small, W - 2 * boards.M, gap=20), "實際大小（1 倍）", 24)], W))
    nature = research / "nature-reference"
    if REFS.get("nature"):
        parts += refs_row(W, nature, REFS["nature"])
    else:
        parts.append(text_block(W, "懸崖的參考圖（天然岩壁的照片，公有領域和 CC0）還在整理，隨第二批正式稿補上。", 22))
    return boards.save(boards.stack(parts, W), label)


def board_overview(suffix, gdir, mem, W=3000):
    label = "R8-25-第二批樣本-總覽"
    text = ("R8 第二批的樣本（寫實畫風），給使用者先看方向：東陸、西陸的主城、民居、兵營，地面五層的混合，懸崖和城牆。"
            "都是 2 倍。細節和參考圖在 R8-21 到 R8-24。看過方向對了，再量產第二批全部：建築（含哨所、砲坊）的所有狀態、"
            "照 D-096 格局的寫實城牆、資源點、地形、地面。\n"
            "記憶體（2 倍，每張圖、一個狀態；一棟建築有六個狀態；未壓縮 RGBA8／ASTC 4×4）：" +
            "、".join(f"{NAMES.get(k.rsplit('_', 1)[0], k)}{'' if k == 'ground' else SIDE[k[-1]]} {v['rgba8_mb']}／{v['astc_mb']} MB"
                     for k, v in mem.items() if k != "ground") +
            f"；地面五層合計 {mem['ground']['rgba8_mb']}／{mem['ground']['astc_mb']} MB。")
    parts = [boards.header(W, label, text)]
    for c in ("E", "W"):
        row = [boards.captioned(tile(f"r8b_{k}_{c}_new", suffix, 2, FOOT[k]), f"{SIDE[c]}{NAMES[k]}", 22) for k in NAMES]
        parts.append(boards.row(row, W, gap=24))
    cam = Image.open(gdir / "sample_cam.png")
    cl = tile("r8b_cliff", suffix, 2, (3, 1))
    sw = run_tile("r8b_sw_s_E", suffix, 2)
    parts.append(boards.row([boards.captioned(cam, "地面（遊戲的鏡頭）", 22), boards.captioned(cl, "懸崖", 22),
                             boards.captioned(sw, "石牆", 22)], W, gap=24))
    return boards.save(boards.stack(parts, W), label)


def memory(suffix, gdir):
    out = {}
    for c in ("E", "W"):
        for k in NAMES:
            r, a = frame_bytes(f"r8b_{k}_{c}_new", suffix)
            out[f"{k}_{c}"] = dict(rgba8_mb=round(r / 2 ** 20, 2), astc_mb=round(a / 2 ** 20, 2))
    g = json.loads((gdir / "ground" / "ground.json").read_text())
    tot = 0
    for L in g["layers"]:
        im = Image.open(gdir / "ground" / L["file"])
        tot += im.width * im.height * 4 / 9 * 4 / 3          # at 2x (2/3 the 3x side), mipmaps a third more
    out["ground"] = dict(rgba8_mb=round(tot / 2 ** 20, 2), astc_mb=round(tot / 4 / 2 ** 20, 2))
    (boards.OUT / "memory_samples.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    return out


# ---------------------------------------------------------------- the redone cliff and the drum (2026-10-22)

CLIFF_DIR = config.BUILD / "b1" / "r8c"
CLIFF = 7


def _variant(x, y, n):
    """client/src/art/terrain.ts variant()"""
    return (x * 31 + y * 17 + ((x ^ y) & 7)) % n


def cliff_pieces(g):
    """client/src/art/terrain.ts terrainPieces(), the cliffs only: [(frame, x, y (cells), front)]."""
    h, w = g.shape

    def at(x, y):
        return g[min(h - 1, max(0, y)), min(w - 1, max(0, x))]
    out = []
    for y in range(h):
        for x in range(w):
            if g[y, x] != CLIFF:
                continue
            links = []
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    if (dx == 0 and dy == 0) or at(x + dx, y + dy) != CLIFF:
                        continue
                    if dx != 0 and dy != 0 and (at(x + dx, y) == CLIFF or at(x, y + dy) == CLIFF):
                        continue
                    links.append((dx, dy))
            straight = len(links) == 2 and links[0][0] == -links[1][0] and links[0][1] == -links[1][1]
            cx, cy = x + 0.5, y + 0.5
            if not straight:
                out.append((f"terrain_cliff_post_v{_variant(x, y, 2)}", cx, cy, y + 1))
            arm = _variant(x, y, 3)
            if at(x + 1, y) == CLIFF and x + 1 < w:
                out.append((f"terrain_cliff_arm_E_v{arm}", x + 1, cy, y + 0.99))
            if at(x, y + 1) == CLIFF and y + 1 < h:
                out.append((f"terrain_cliff_arm_S_v{arm}", cx, y + 1, y + 1.99))
            if at(x + 1, y + 1) == CLIFF and at(x + 1, y) != CLIFF and at(x, y + 1) != CLIFF and x + 1 < w and y + 1 < h:
                out.append((f"terrain_cliff_arm_SE_v{arm}", x + 1, y + 1, y + 1.99))
            if at(x - 1, y + 1) == CLIFF and at(x - 1, y) != CLIFF and at(x, y + 1) != CLIFF and x > 0 and y + 1 < h:
                out.append((f"terrain_cliff_arm_SW_v{arm}", x, y + 1, y + 1.99))
    return out


def _sprite(d, name, suffix, f):
    """A rendered piece scaled by f: (colour with AO, anchor), (shadow, its anchor) or None."""
    meta = json.loads((d / f"{name}_{suffix}.json").read_text())
    b = np.asarray(Image.open(d / f"{name}_{suffix}_beauty.png").convert("RGBA"), np.float32)
    ao_p = d / f"{name}_{suffix}_ao.png"
    if ao_p.exists():
        b[..., :3] *= (0.7 + 0.3 * np.asarray(Image.open(ao_p).convert("L"), np.float32) / 255.0)[..., None]
    im = Image.fromarray(np.clip(b, 0, 255).astype(np.uint8), "RGBA")
    im = im.resize((max(1, round(im.width * f)), max(1, round(im.height * f))), Image.LANCZOS)
    ax, ay = meta["anchor"][0] * f, meta["anchor"][1] * f
    sh = None
    s_p = d / f"{name}_{suffix}_shadow.png"
    if s_p.exists():
        s_ = np.asarray(Image.open(s_p).convert("RGBA"), np.float32)[..., 3] / 255.0 * 0.6
        sim = Image.fromarray(np.dstack([np.zeros(s_.shape + (3,)), s_[..., None] * 255]).astype(np.uint8), "RGBA")
        sim = sim.resize((max(1, round(sim.width * 2 * f)), max(1, round(sim.height * 2 * f))), Image.BILINEAR)
        sh = (sim, meta["shadow_anchor"][0] * 2 * f, meta["shadow_anchor"][1] * 2 * f)
    return im, (ax, ay), sh


def _ground_layers(gdir):
    gj = json.loads((gdir / "ground" / "ground.json").read_text())
    return {L["id"]: dict(img=np.asarray(Image.open(gdir / "ground" / L["file"]).convert("RGBA"), np.float32) / 255.0,
                          tile_m=L["tile_m"]) for L in gj["layers"]}


def cliff_scene(gdir, ppm=40, n=16):
    """A stretch of ground as the game draws it (方形斜看): a cliff line (four cells east-west, two south, a diagonal),
    a run of East stone wall, East spearmen at their feet (1.7 m): everything at one scale, ppm pixels a metre."""
    import ground_r8
    g = np.zeros((n, n), dtype=int)
    for x in range(2, 8):
        g[4, x] = CLIFF
    g[5, 7] = g[6, 7] = CLIFF
    g[7, 8] = g[8, 9] = CLIFF
    rules = dict(ground_r8.RULES, dirt=dict(ground_r8.RULES["dirt"], noise_threshold=0.99))   # no stray dirt here
    top = ground_r8.compose(g, [], _ground_layers(gdir), ppm=ppm, rules=rules)
    cam = Image.fromarray((top * 255).round().astype(np.uint8), "RGB").resize((top.shape[1], top.shape[0] // 2), Image.LANCZOS)
    cam = cam.convert("RGBA")
    items = []                                   # (front, image, (x px, y px)), shadows apart
    shadows = []
    f = ppm / 60.0

    def place(im, anc, sh, wx, wy, front):
        X, Y = wx * ppm, wy * ppm * 0.5
        items.append((front, im, (int(round(X - anc[0])), int(round(Y - anc[1])))))
        if sh:
            shadows.append((sh[0], (int(round(X - sh[1])), int(round(Y - sh[2])))))
    for frame, x, y, front in cliff_pieces(g):
        im, anc, sh = _sprite(CLIFF_DIR, frame, "x3", f)
        place(im, anc, sh, x * 2.0, y * 2.0, front)
    for k in range(3):                                   # the wall: three cells of East stone wall, south side
        im, anc, sh = _sprite(DIR, "r8b_sw_s_E", "x3", f)
        place(im, anc, sh, (11.5 + k) * 2.0, 10.5 * 2.0, 11)
    if UNITS_DIR:
        import boards_r8 as B
        a = B.field.Atlas(Path(UNITS_DIR) / "spear_e" / "r7v8" / "prod" / "spear_e" / "atlas_x3" / "spear_e.json")
        for (wx, wy, facing, anim, k) in ((7.0, 11.2, 6, "idle", 0), (9.4, 12.6, 7, "idle", 0), (5.2, 13.4, 5, "walk", 3),
                                          (17.8, 14.4, 6, "idle", 0), (23.5, 22.9, 6, "idle", 0), (26.0, 23.6, 7, "walk", 2)):
            body, (ax, ay), _ = B.frame(a, "spear_e", anim, facing, k, "blue")
            body = body.resize((max(1, int(body.width * f)), max(1, int(body.height * f))), Image.LANCZOS)
            place(body, (ax * f, ay * f), None, wx, wy, wy / 2.0)
    for _, im, xy in [(None, im, xy) for im, xy in shadows] + sorted(items, key=lambda t: t[0]):
        layer = Image.new("RGBA", cam.size, (0, 0, 0, 0))
        layer.paste(im, xy, im)
        cam = Image.alpha_composite(cam, layer)
    return cam.convert("RGB")


def terrain_pieces(g):
    """client/src/art/terrain.ts terrainPieces(): every terrain picture, [(frame, x, y (cells), front, ground)]."""
    h, w = g.shape

    def at(x, y):
        return g[min(h - 1, max(0, y)), min(w - 1, max(0, x))]

    def wet(v):
        return 3 <= v <= 6
    out = []
    for Y in range(h + 1):
        for X in range(w + 1):
            m = (wet(at(X - 1, Y - 1)) << 0) | (wet(at(X, Y - 1)) << 1) | (wet(at(X - 1, Y)) << 2) | (wet(at(X, Y)) << 3)
            if m:
                out.append((f"terrain_water_m{m}", X, Y, Y, "water"))
    for y in range(h):
        for x in range(w):
            v, cx, cy = g[y, x], x + 0.5, y + 0.5
            if v == 1:
                out.append((f"terrain_rock_v{_variant(x, y, 6)}", cx, cy, y + 1, None))
            elif v == 4:
                out.append((f"terrain_ford_v{_variant(x, y, 2)}", cx, cy, y + 1, "ford"))
            elif v in (5, 6):
                ns = v == 5
                out.append((f"terrain_bridge_deck_{'ns' if ns else 'ew'}", cx, cy, y + 1, "deck"))
                if ns:
                    if at(x - 1, y) != 5:
                        out.append(("terrain_bridge_rail_y", x, cy, y + 1, None))
                    if at(x + 1, y) != 5:
                        out.append(("terrain_bridge_rail_y", x + 1, cy, y + 1, None))
                else:
                    if at(x, y - 1) != 6:
                        out.append(("terrain_bridge_rail_x", cx, y, y + 0.01, None))
                    if at(x, y + 1) != 6:
                        out.append(("terrain_bridge_rail_x", cx, y + 1, y + 1, None))
    out += [(f, x, y, fr, None) for f, x, y, fr in cliff_pieces(g)]
    return out


def terrain_scene(gdir, g, ppm=40, units=(), extra=()):
    """The ground and its terrain pictures as the game draws them: the ground (ground_r8), the water, fords and bridge
    decks on the ground layer (water tiles cut to their square, as atlas_b1.terrain_prep), then everything that stands
    by its front edge. units: (unit, anim, facing, frame, team, x m, y m); extra: (dir, name, x m, y m, front)."""
    import ground_r8
    rules = dict(ground_r8.RULES, dirt=dict(ground_r8.RULES["dirt"], noise_threshold=0.99))
    top = ground_r8.compose(g, [], _ground_layers(gdir), ppm=ppm, rules=rules)
    cam = Image.fromarray((top * 255).round().astype(np.uint8), "RGB").resize((top.shape[1], top.shape[0] // 2), Image.LANCZOS)
    cam = cam.convert("RGBA")
    f = ppm / 60.0
    flat = {"water": [], "ford": [], "deck": []}
    items, shadows = [], []
    for frame, x, y, front, ground in terrain_pieces(g):
        im, anc, sh = _sprite(CLIFF_DIR, frame, "x3", 1.0)
        if ground == "water":                              # cut to the tile's square round the corner (3x: 120 x 60)
            ax, ay = int(anc[0]), int(anc[1])
            im = im.crop((ax - 60, ay - 30, ax + 60, ay + 30))
            anc = (60, 30)
        im = im.resize((max(1, round(im.width * f)), max(1, round(im.height * f))), Image.LANCZOS)
        anc = (anc[0] * f, anc[1] * f)
        X, Y = x * 2.0 * ppm, y * 2.0 * ppm * 0.5
        xy = (int(round(X - anc[0])), int(round(Y - anc[1])))
        if ground:
            flat[ground].append((im, xy))
            if ground == "deck" and sh:
                shs = sh[0].resize((max(1, round(sh[0].width * f)), max(1, round(sh[0].height * f))))
                flat["deck"].insert(0, (shs, (int(round(X - sh[1] * f)), int(round(Y - sh[2] * f)))))
        else:
            items.append((front, im, xy))
            if sh:
                shs = sh[0].resize((max(1, round(sh[0].width * f)), max(1, round(sh[0].height * f))))
                shadows.append((shs, (int(round(X - sh[1] * f)), int(round(Y - sh[2] * f)))))
    for d, name, x, y, front in extra:
        im, anc, sh = _sprite(d, name, "x3", f)
        items.append((front, im, (int(round(x * ppm - anc[0])), int(round(y * ppm * 0.5 - anc[1])))))
        if sh:
            shadows.append((sh[0], (int(round(x * ppm - sh[1])), int(round(y * ppm * 0.5 - sh[2])))))
    if UNITS_DIR:
        import boards_r8 as B
        atl = {}
        for (u, anim, facing, k, team, x, y) in units:
            if u not in atl:
                atl[u] = B.field.Atlas(Path(UNITS_DIR) / u / "r7v8" / "prod" / u / "atlas_x3" / f"{u}.json")
            body, (ax, ay), _ = B.frame(atl[u], u, anim, facing, k, team)
            body = body.resize((max(1, int(body.width * f)), max(1, int(body.height * f))), Image.LANCZOS)
            items.append((y / 2.0, body, (int(round(x * ppm - ax * f)), int(round(y * ppm * 0.5 - ay * f)))))
    seq = flat["water"] + flat["ford"] + flat["deck"] + shadows + [(im, xy) for _, im, xy in sorted(items, key=lambda t: t[0])]
    for im, xy in seq:
        layer = Image.new("RGBA", cam.size, (0, 0, 0, 0))
        layer.paste(im, xy, im)
        cam = Image.alpha_composite(cam, layer)
    return cam.convert("RGB")


def river_map(n=18):
    """A river west to east with a bend, a ford and a bridge across it, rocks, a short cliff."""
    g = np.zeros((n, n), dtype=int)
    for x in range(n):
        y0 = 7 + (1 if 6 <= x <= 11 else 0) + (1 if 8 <= x <= 9 else 0)
        g[y0:y0 + 2, x] = 3
    for x in range(2, 5):                                  # the ford, three cells wide
        for y in range(n):
            if g[y, x] == 3:
                g[y, x] = 4
    for x in range(13, 16):                                # the bridge, north-south
        for y in range(n):
            if g[y, x] == 3:
                g[y, x] = 5
    g[3, 8:12] = 7
    g[13, 4] = g[13, 5] = g[14, 5] = g[3, 14] = g[12, 12] = 1
    return g


def board_cliff_redo(gdir, research, W=2800):
    label = "R8-26-懸崖重做-mobile"
    text = ("懸崖重做（使用者 2026-10-22：「懸崖看起來不太真實」）。這次岩壁不是自己捏的，是真的岩壁：Poly Haven 的兩片實地掃描岩壁"
            "（CC0），從正面量出每一公分的凹凸和顏色，貼在懸崖的兩面。所以岩層、裂縫、層間凹進去的岩架都是真的，大小也照實物，"
            "和 1.7 公尺的兵擺在一起比例是對的。\n"
            "・岩面：一整片連續的岩層，有斷層和裂縫；顏色往太行山紅砂岩的灰褐色拉；往下有水流過的深色直紋，崖腳潮濕較暗。\n"
            "・崖頂：接著掃描岩壁上方的那一段（苔和土），高低不平，幾叢草長在岩縫和岩架上，不放圓灌木。\n"
            "・崖腳：碎石坡（岩屑錐），和地面的碎石同一種材質，邊緣淡進地面，沒有一條線；上面散著崩落的碎石。\n"
            "・高約 4 公尺，比城牆（東陸 4.2）略矮，看得出是天然的岩石，不是一道牆。\n"
            "・格式照 client 現在的懸崖（柱和臂，terrain.ts）：每格的臂在格子中央都接回同一段岩壁，一長條懸崖接起來沒有縫；"
            "轉角和兩端由岩柱蓋住。三種臂、兩種柱輪流用，長條不會一格一格重複。")
    scene_im = cliff_scene(gdir, ppm=40)
    zoom = scene_im.crop((40, 60, 760, 460)).resize((1440, 800), Image.LANCZOS)
    parts = [boards.header(W, label, text)]
    parts.append(boards.row([boards.captioned(scene_im, "遊戲的鏡頭（2 倍）：懸崖一條（東西四格、轉南兩格、再斜一段）、東陸石牆三格、東陸槍兵（1.7 公尺）", 22)], W))
    parts.append(boards.row([boards.captioned(zoom, "放大：懸崖和兵（4 倍）", 22)], W))
    tiles = []
    for name, cap in (("terrain_cliff_post_v0", "岩柱 1"), ("terrain_cliff_post_v1", "岩柱 2"), ("terrain_cliff_arm_E_v0", "東西臂 1"),
                      ("terrain_cliff_arm_E_v1", "東西臂 2"), ("terrain_cliff_arm_E_v2", "東西臂 3"), ("terrain_cliff_arm_S_v0", "南北臂"),
                      ("terrain_cliff_arm_SE_v0", "斜臂（東南）"), ("terrain_cliff_arm_SW_v0", "斜臂（西南）")):
        im, _, _ = _sprite(CLIFF_DIR, name, "x3", 1.0)
        bg = Image.new("RGBA", im.size, (92, 96, 74, 255))
        bg.alpha_composite(im)
        tiles.append(boards.captioned(bg.convert("RGB"), cap, 20))
    parts.append(boards.row(tiles[:5], W, gap=24))
    parts.append(boards.row(tiles[5:], W, gap=24))
    parts += refs_row(W, research / "nature-reference", REFS["nature"])
    return boards.save(boards.stack(parts, W), label)


def board_drum(W=2000):
    label = "R8-27-兵營戰鼓-東陸-mobile"
    text = ("東陸兵營的戰鼓重做（使用者 2026-10-22：「東陸兵營怎麼有一紅色的球？」）。之前的鼓太短、鼓面朝旁邊，遠看是一顆紅球。"
            "現在照唐代的軍鼓：朱漆鼓身、鼓面是淺色的皮，朝著鏡頭；鼓皮邊上一圈銅釘，鼓身兩道銅箍；架在四條腳的木鼓架上，"
            "兩支鼓槌交叉擱在鼓上。哨所的鼓量產時用同一個做法。")
    full = tile("r8b_barracks_E_new", "x3", 6, (3, 3)).convert("RGB")
    w, h = full.size
    zoom = full.crop((int(w * 0.38), int(h * 0.55), int(w * 0.64), int(h * 0.85))).resize((720, 830), Image.LANCZOS)
    parts = [boards.header(W, label, text),
             boards.row([boards.captioned(full, "東陸兵營（6 倍）", 22), boards.captioned(zoom, "戰鼓放大", 22)], W, gap=30)]
    return boards.save(boards.stack(parts, W), label)


def board_ground_fix(gdir, W=2600):
    """The ground before and after the fix proposed to war-game-client (ground_r8.RULES weights, dirt.noise_soft): a
    diagonal river with its bank, rocks with their gravel, dirt patches; the water drawn with rounded corners as the
    game's water tiles cut them."""
    import ground_r8 as G
    label = "R8-28-地面修正-mobile"
    text = ("地面的兩個修正（ceo 2026-10-22 看 R8-23 時發現：河岸沿著格子一格一格的方塊、露土的邊太硬）。原因查到了，"
            "和 client 談好改法：\n"
            "・河岸的方塊：河岸、碎石、資源點旁的露土是照「哪幾格靠近水、岩石、資源點」畫的，"
            "原本一格只有一個點、不是有就是沒有，所以邊界跟著格子走。改成每格 4 個點，照離水的實際距離慢慢變淡，"
            "再糊開一點：斜著流的河，河岸是一條順的帶子，不是樓梯。\n"
            "・露土的硬邊：零星的露土原本從草地變成土只有約 30 公分，邊像剪下來的。改成約 1–2 公尺慢慢過渡，"
            "邊緣被細的雜訊打散，像草慢慢變稀。\n"
            "左邊是現在，右邊是修正後；同一塊地、同樣的材質，只改這兩處。水面是暫時的平塗。")
    n = 20
    g = np.zeros((n, n), dtype=int)
    for i in range(n):
        y = int(3 + i * 0.7)
        g[y:y + 2, i] = 3
        if 8 <= i <= 12:
            g[y + 2, i] = 3
    g[2:4, 14:16] = 1
    nodes = [(4, 16), (16, 4)]
    ppm = 30
    layers = _ground_layers(gdir)
    wm = np.kron((g == 3).astype(float), np.ones((2 * ppm, 2 * ppm)))
    wm = (G.blur(wm, 0.6 * ppm) > 0.5).astype(float)
    water = G.blur(wm, 0.08 * ppm)[..., None]
    old = dict(G.RULES, weights=None, dirt=dict(G.RULES["dirt"], noise_soft=None))
    ims = []
    for rules in (old, G.RULES):
        top = G.compose(g, nodes, layers, ppm=ppm, rules=rules)
        top = top * (1 - water * 0.85) + np.array([0.16, 0.27, 0.33]) * water * 0.85
        ims.append(G.camera_view(top, ppm))
    parts = [boards.header(W, label, text)]
    for box, what in (((0, 0, 600, 300), "河岸"), ((600, 0, 1200, 300), "碎石和露土")):
        pair = [boards.captioned(im.crop(box).resize((1200, 600), Image.LANCZOS), f"{what}：{k}", 24)
                for im, k in zip(ims, ("現在", "修正後"))]
        parts.append(boards.row(pair, W, gap=30))
    return boards.save(boards.stack(parts, W), label)


if __name__ == "__main__" and sys.argv[1] == "terrain":
    UNITS_DIR = sys.argv[3] if len(sys.argv) > 3 else None
    terrain_scene(Path(sys.argv[2]), river_map(), units=[("spear_e", "walk", 6, 2, "blue", 7.0, 14.0),
                                                         ("spear_e", "idle", 6, 0, "blue", 28.5, 17.8),
                                                         ("bow_w", "idle", 2, 0, "red", 8.2, 25.0)]).save(sys.argv[4])
elif __name__ == "__main__" and sys.argv[1] == "groundfix":
    print(board_ground_fix(Path(sys.argv[2])))
elif __name__ == "__main__" and sys.argv[1] == "redo":
    gd, rs = Path(sys.argv[2]), Path(sys.argv[3])
    UNITS_DIR = sys.argv[4] if len(sys.argv) > 4 else None
    print(board_cliff_redo(gd, rs))
    print(board_drum())
elif __name__ == "__main__":
    sfx, gd, rs = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
    UNITS_DIR = sys.argv[4] if len(sys.argv) > 4 else None
    for c in ("E", "W"):
        print(board_buildings(c, sfx, rs))
    print(board_ground(gd, rs))
    print(board_cliff(sfx, rs))
    mem = memory(sfx, gd)
    print(json.dumps(mem, ensure_ascii=False))
    print(board_overview(sfx, gd, mem))
