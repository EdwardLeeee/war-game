"""R6-04 地圖方向 (ceo 2026-10-18, the user: 「改正方形地圖吧 我想改方案」): the R6-01 scene on the two square maps and
the present diamond, with the A panels; one board each and an overview.

python3 common/r6_04.py ART DIRS     ART: art-v2-x3 extracted; DIRS: the b1 renders of run.py dir_sq, dir_top
-> build/field-a-mapsq.png, field-a-maptop.png, minimap-mapsq.png, minimap-maptop.png, then (after shoot) out/R6-04-*.png
"""
import subprocess
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import boards       # noqa: E402
import field_sq     # noqa: E402

R6 = HERE.parent
BUILD = R6 / "build"
OPTS = [
    ("甲", "方形斜看", "MAP-sq",
     "鏡頭仰角照舊 30 度，但不轉 45 度，正對格線：地圖的邊和螢幕平行，一格壓成 2:1 的長方形（寬 40 pt、深 20 pt）。",
     "代價：兵不用重算（8 個方向剛好轉一格，client 改方向的對應）。建築、資源點要用新鏡頭在 CI 重算（約 1 小時），"
     "但它們是照斜 45 度設計的，正對以後只看得到正面，側面的布幔、玩家色要補（約 1–2 天）。和現在的差別：一樣是立體微縮，只是地圖不斜。"),
    ("乙", "正上方俯視", "MAP-top",
     "地面照現在的原型，從正上方看，一格是正方形（40×40 pt）；3D 的兵直接站上去（client 的 art-v1-x2-battle 截圖就是這樣）。"
     "建築和資源點改用 60 度仰角重算，底座的深是寬的 0.87 倍，接近正方形。",
     "代價：兵不用重算。建築、資源點用 60 度在 CI 重算（約 1 小時，再看一輪）。地面是正上方、兵和建築是斜著看的，兩種角度混在一起，"
     "看起來比較像桌上的紙板兵；和核准的立體微縮差最多。好處是格子最好認、點選最準、遮擋最少。"),
]


def build(art, dirs):
    BUILD.mkdir(exist_ok=True)
    for mode, key in (("sq", "mapsq"), ("top", "maptop")):
        img, _ = field_sq.render(mode, art, dirs)
        img.convert("RGB").save(BUILD / f"field-a-{key}.png")
        field_sq.minimap_square(330, mode, field_sq.scene(mode)["units"]).save(BUILD / f"minimap-{key}.png")


def shoot():
    subprocess.run(["node", str(HERE / "shoot.mjs"), "MAP-dia", "theme=a&state=MAP-dia", "MAP-sq", "theme=a&state=MAP-sq",
                    "MAP-top", "theme=a&state=MAP-top"], check=True, env={**__import__("os").environ, "R6_PAGE": "ui.html"})


def compose():
    out = []
    for opt, name, key, sub, cost in OPTS:
        scr = boards.shot(key)
        W = scr.width + 2 * boards.M
        label = f"R6-04-地圖方向-{opt}-{name}-mobile"
        head = boards.header(W, label, f"選項 {opt}「{name}」：{sub}\n{cost}\n"
                             "同一個場景：選到一隊兵，主城、兵營、民居、樹、金礦，A 銅木面板；淡淡的格線是為了看出格子的形狀，遊戲裡沒有。"
                             "地圖是方形，小地圖也跟著改回方形（R6-03 選的菱形是配合斜 45 度的戰場）。上：手機像素（3 倍）；下：實際大小。")
        main = Image.new("RGB", (W, scr.height + 30), boards.BG)
        main.paste(scr, (boards.M, 0))
        act = boards.captioned(scr.resize((814, 380), Image.LANCZOS), "實際大小（1 pt = 1 px）")
        out.append(boards.save(boards.stack([head, main, boards.row([act], W)], W), label))
    W = boards.M * 2 + 3 * 814 + 2 * 40
    head = boards.header(W, "R6-04-地圖方向-總覽", "左：現在的菱形（斜 45 度，D-085）。中：甲「方形斜看」。右：乙「正上方俯視」。實際大小，同一個場景，A 銅木面板。")
    cells = [boards.captioned(boards.shot(k).resize((814, 380), Image.LANCZOS), t, 28)
             for k, t in (("MAP-dia", "現在：菱形（斜 45 度）"), ("MAP-sq", "甲「方形斜看」"), ("MAP-top", "乙「正上方俯視」"))]
    out.append(boards.save(boards.stack([head, boards.row(cells, W)], W), "R6-04-地圖方向-總覽"))
    return out


if __name__ == "__main__":
    build(Path(sys.argv[1]), Path(sys.argv[2]))
    shoot()
    compose()
