"""R11's boards (ceo 2026-11-02: the user chose 乙 菱形斜看; R9's realism carried on; the floating continent's edge):
the label top left, before (art-v6.3 as released, square camera) and after (R11, diamond camera), the latest scores.

python3 design/r11/common/boards_r11.py WORK OUT UNITS_BEFORE UNITS_AFTER ART_X3
  WORK: scene_r11.py's and edge_scene_r11.py's output folder (river_d, city_d, grass_d, edge_<A|B|C>.png/.gif, cost.json)
        plus R9's square-camera stills of the same places (r9_scene_before.png, r9_city_before.png, r9_grass_before.png)
"""
import json
import shutil
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "r9" / "common"))
import boards_r9 as B9    # noqa: E402
import scene_r11 as SR    # noqa: E402

board, pair, one_x = B9.board, B9.pair, B9.one_x


def scores_line():
    rows = [[c.strip() for c in ln.strip().strip("|").split("|")]
            for ln in (HERE.parent / "scores.md").read_text().splitlines() if ln.startswith("| ") and ln[2].isdigit()]
    names = ((1, "地面"), (2, "水邊"), (3, "槍兵"), (4, "主城"), (5, "樹和石頭"), (6, "邊緣 A"), (7, "邊緣 B"), (8, "邊緣 C"))
    out = []
    for k, name in names:
        got = [r for r in rows if len(r) > k and r[k] not in ("—", "")]
        if got:
            out.append(f"{name} {got[-1][k]}（第 {got[-1][0]} 輪）")
    return "、".join(out)


def pieces_sheet(art, grass):
    """05: the trees, rocks and the bridge: art-v6.3's (square camera) above, R11's (diamond) below, on grass."""
    ta = SR.S9.Atlas(art / "terrain" / "terrain.json")
    na = SR.S9.Atlas(art / "nodes" / "nodes.json")
    names = [f"tree_E_v{k}" for k in range(3)] + [f"terrain_rock_v{k}" for k in range(6)] + ["terrain_bridge_deck_ns"]
    rows = []
    for diamond in (False, True):
        canvas = grass.copy().convert("RGBA")
        x = 120
        for nm in names:
            if diamond:
                (im, ax, ay), sh = SR.piece(nm + "_d", "neutral")
            else:
                (im, ax, ay), sh = (na if nm.startswith("tree") else ta).sprite(nm, "neutral")
            y = canvas.height - 120
            if sh:
                si, sx, sy = sh
                SR.S9._paste(canvas, si, (int(x - sx), int(y - sy)))
            SR.S9._paste(canvas, im, (int(x - ax), int(y - ay)))
            x += max(im.width * 0.62, 150)
        rows.append(canvas.convert("RGB"))
    return rows


def main(work, out, ub, ua, art):
    out.mkdir(parents=True, exist_ok=True)
    last = scores_line()
    note = ("R11（使用者 2026-11-02 選「乙 菱形斜看」、「照 R9 方向繼續改」，並說：「邊邊可以加個瀑布動畫，感覺像是再一個浮空大陸上的感覺」）。"
            "只是試驗圖，沒有發版。左邊／上面是現在（art-v6.3，方形斜看），右邊／下面是 R11（菱形斜看）。"
            f"\n評審最後一輪分數（0–10，現在 → R11）：{last}")
    b = Image.open(work / "r9_scene_before.png").convert("RGB")
    a = Image.open(work / "river_d.png").convert("RGB")
    board("R11-01-地面-A-菱形斜看-phone",
          note + "\n地面：R9 的起伏圖、草叢、風吹的草色，在地圖座標上算，再整張轉 45 度（等於 client 的 shader 在世界座標上畫）。"
          "太陽固定在畫面左上，所以起伏圖照菱形鏡頭的太陽另算一張（同樣大小）。雙河關同一座橋。",
          [("實際大小（1 倍）：現在 → R11", pair(one_x(b), one_x(a))),
           ("手機像素（3 倍）一角：現在", b.crop((1300, 700, 2442, 1140))),
           ("手機像素（3 倍）一角：R11", a.crop((1300, 700, 2442, 1140)))], out)
    board("R11-02-水邊-A-菱形斜看-phone",
          note + "\n水邊（照 R9 最後評審的六點改）：對岸水線改成暖褐色、不再是黑線；近岸只剩一道細的濕線，淺處的暖色在水底、一塊一塊；"
          "河中央暗一點、偏綠；漣漪強弱分成一條條水流帶，跟著河岸彎；平靜的地方映更多天空；橋板在水上的影子加回來。",
          [("實際大小（1 倍）：現在 → R11", pair(one_x(b), one_x(a))),
           ("手機像素（3 倍）河段：現在", b.crop((0, 380, 1300, 840))),
           ("手機像素（3 倍）河段：R11", a.crop((300, 160, 1600, 620)))], out)
    gb = Image.open(work / "r9_grass_before.png").convert("RGB").crop((600, 720, 1600, 1000))
    ga = Image.open(work / "grass_d.png").convert("RGB").crop((600, 720, 1600, 1000))
    sb, sa = B9.spear_strip(ub, gb), B9.spear_strip(ua, ga)
    board("R11-03-槍兵-A-布料皺褶-phone",
          note + "\n槍兵：兵不用為了 45 度重算——太陽固定在畫面左上，相機轉 45 度看兵，和兵轉一格方向是同一張圖，client 把方向編號平移一格就好。"
          "這輪只改材質：袍子加上往下垂的皺褶（R9 的皺褶畫在網格自己的座標上，單位不是公尺，所以沒出現），頭盔改暗改粗糙。",
          [("實際大小（1 倍）：現在 → R11", pair(one_x(sb), one_x(sa), gap=10)),
           ("手機像素（3 倍）：現在", sb), ("手機像素（3 倍）：R11", sa),
           ("放大 2 倍看細節（前三個動作）：現在 → R11", pair(B9.zoom2(sb), B9.zoom2(sa), gap=10))], out)
    B9.spear_gif(ub, gb, out / "R11-03-槍兵-0-現況-動作.gif")
    B9.spear_gif(ua, ga, out / "R11-03-槍兵-A-布料皺褶-動作.gif")
    cb = Image.open(work / "r9_city_before.png").convert("RGB")
    ca = Image.open(work / "city_d.png").convert("RGB")
    board("R11-04-主城-A-菱形斜看-phone",
          note + "\n主城：用菱形鏡頭重算，角朝向玩家。夯土台改成尖角、夯層更淡，加兩排「腳手架孔」（夯土時插橫木留下的洞）；"
          "影子更深、偏藍（陰影裡是天空的藍光）。門前踩實的土和小路照 R9。",
          [("實際大小（1 倍）：現在 → R11", pair(one_x(cb), one_x(ca))),
           ("手機像素（3 倍）：現在", cb), ("手機像素（3 倍）：R11", ca)], out)
    r0, r1 = pieces_sheet(art, Image.open(work / "grass_d.png").convert("RGB").crop((0, 600, 2200, 1000)))
    board("R11-05-樹和石頭-A-菱形斜看-phone",
          note + "\n樹（3 種）、石頭（6 種）、橋：用菱形鏡頭重算（和地圖格子對齊的東西轉 45 度一定要重算；樹和石頭看起來差不多，但影子和光的方向要對）。",
          [("手機像素（3 倍）：現在（方形斜看）", r0), ("手機像素（3 倍）：R11（菱形斜看）", r1)], out)
    cost = json.loads((work / "cost.json").read_text())
    ctext = ("動畫成本（量的是這張試驗圖的素材，3 倍畫質）：\n"
             f"(a) shader 捲動（推薦）：雲海一張 {cost['cloud_tile']}、瀑布一張 {cost['fall_tile']}（單色 A8），"
             f"飄過的雲 {cost['puffs_n']} 朵共 {cost['puffs_rgba']} RGBA8／{cost['puffs_astc']} ASTC；合計約 {cost['a_total']}。"
             f"每格畫面多畫雲海一層（約 {cost['void_share']} 的畫面、每點取 4 次貼圖）、瀑布一小塊、幾朵雲，手機上估計每格不到 1 毫秒（一格的預算是 16.7 毫秒）。\n"
             f"(b) 逐格圖：每秒 {cost['fps']} 張、循環 {cost['frames']} 張；瀑布 {cost['fall_flip_rgba']} RGBA8／{cost['fall_flip_astc']} ASTC，"
             f"雲海兩層 {cost['sea_flip_rgba']}／{cost['sea_flip_astc']}；合計約 {cost['b_total']}。")
    for st, name, text in (("A", "岩壁瀑布雲海", "崖壁是 R8 懸崖用的同一種掃描岩石（Poly Haven CC0），有層理，硬的岩層凸出成一道道岩棚；崖頂一層薄土和草叢；"
                                               "往下 13 公尺淡進雲海。河從淺灘流出邊緣，變成瀑布，底下是水霧。"),
                           ("B", "捲邊懸根", "崖頂是一層厚土往外捲，草垂下來蓋住邊緣，下面垂著樹根、掉落的土塊；再往下是往內收的岩石底部（浮島的底）。瀑布、雲海同 A。"),
                           ("C", "遠方浮島", "A 的岩壁，雲海裡再加三座遠處的小浮島（有草、有樹、岩石底部），在霧裡，慢慢上下浮動。")):
        e = Image.open(work / f"edge_{st}.png").convert("RGB")
        shutil.copy(work / f"edge_{st}.gif", out / f"R11-06-地圖邊緣-{st}-{name}-動畫.gif")
        board(f"R11-06-地圖邊緣-{st}-{name}-phone",
              note + "\n地圖邊緣（浮空大陸）：照 client 的四層排，由下往上：雲海（遠、近兩層，鏡頭移動時只跟著動 0.2–0.35 倍）、崖面、瀑布和水霧、飄過的雲。"
              "動畫見同名 GIF（3 秒循環，鏡頭左右慢慢移，看得出雲海的視差）。\n" + text + "\n" + ctext,
              [("實際大小（1 倍）", one_x(e)), ("手機像素（3 倍的 2/3）", e.resize((e.width * 2 // 3, e.height * 2 // 3), Image.LANCZOS))], out)
    now = one_x(b)
    rows = [("現在（art-v6.3，方形斜看）", now), ("R11 菱形斜看", one_x(a))]
    for st in ("A", "B", "C"):
        rows.append((f"R11 地圖邊緣 {st}", one_x(Image.open(work / f"edge_{st}.png").convert("RGB"))))
    board("R11-99-總覽-phone", note + "\n手機實際大小（1 倍）：現在、R11 的菱形斜看（雙河關的橋），和地圖邊緣三個選項。", rows, out)
    print("boards in", out)


if __name__ == "__main__":
    a = sys.argv
    main(Path(a[1]), Path(a[2]), Path(a[3]), Path(a[4]), Path(a[5]))
