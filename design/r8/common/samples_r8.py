"""R8 batch 2 style samples (ceo 2026-10-22: before everything is produced, the user sees the direction): per culture
the main city, a house and the barracks in the realistic look (blender/arch_r8.py, render_b1.py LOOK "r8") at the phone's
3x pixels and at actual size, with the period references beside them (public domain and CC0 only); the ground's five
layers blended as the client blends them (ground_r8.py); the cliff beside the walls (terrain_r8.py); an overview; and a
memory table per category (uncompressed RGBA8 and ASTC 4x4, at 2x).

python3 design/r8/common/samples_r8.py SUFFIX GROUND_DIR RESEARCH_DIR
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
    text = ("地面（R8 第二批）：五層可以無縫接的材質，已經打好光（和兵、建築同一個太陽），高度放在透明度裡；"
            "格式照 client 2026-10-21 談好的 war-game ground 1（ground.json）。混合照 client 的著色器："
            "草地到處都是，大片的乾草地用一個慢的雜訊混進去；資源點旁和零星的地方露土；岩石、懸崖腳下是碎石；水邊是河岸泥。"
            "交界用雜訊和高度打散，不是直線。\n"
            "左：五層各自（接起來 2×2 看接縫）；下：一段 40×40 公尺的樣本，上面是從正上方看，右邊是遊戲的鏡頭（方形斜看，前後壓成一半）。"
            "水面是暫時的平塗，寫實的水在第二批的地形裡。地面比兵暗、飽和度比兵低，讓兵一眼找得到。")
    parts = [boards.header(W, label, text), boards.row(sw, W, gap=20)]
    parts.append(boards.row([boards.captioned(top.resize((top.width // 2 * 2 // 2, top.height // 2)), "從正上方看（每公尺 12 點）", 22),
                             boards.captioned(cam.resize((cam.width * 3 // 2, cam.height * 3 // 2)), "遊戲的鏡頭（實際大小約 1.5 倍）", 22)], W, gap=30))
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
    return boards.save(boards.stack(parts, W), label)


def board_overview(suffix, gdir, mem, W=3000):
    label = "R8-25-第二批樣本-總覽"
    text = ("R8 第二批的樣本（寫實畫風），給使用者先看方向：東陸、西陸的主城、民居、兵營，地面五層的混合，懸崖和城牆。"
            "都是 2 倍。細節和參考圖在 R8-21 到 R8-24。看過方向對了，再量產第二批全部：建築（含哨所、砲坊）的所有狀態、"
            "照 D-096 格局的寫實城牆、資源點、地形、地面。\n"
            "記憶體（2 倍，這幾樣各自；未壓縮 RGBA8／ASTC 4×4）：" +
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


if __name__ == "__main__":
    sfx, gd, rs = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
    for c in ("E", "W"):
        print(board_buildings(c, sfx, rs))
    print(board_ground(gd, rs))
    print(board_cliff(sfx, rs))
    mem = memory(sfx, gd)
    print(json.dumps(mem, ensure_ascii=False))
    print(board_overview(sfx, gd, mem))
