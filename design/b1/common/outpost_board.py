"""哨所 (D-080) drafts in the current building style (art-v3/v5): one board per culture, every state, the player colour
neutral / blue / red, at the phone's 3x pixels and at actual size, each on the ground with its 2x2 cells.

python3 design/b1/common/outpost_board.py [SUFFIX]     (SUFFIX: x3 after `run.py prod_outpost`, prev after --preview)
writes design/r8/out/R8-13-哨所-東陸-mobile.png and R8-14-哨所-西陸-mobile.png
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "r6" / "common"))
import b1art    # noqa: E402
import boards   # noqa: E402
import config   # noqa: E402
import proj     # noqa: E402
import scene    # noqa: E402

boards.OUT = HERE.parents[1] / "r8" / "out"
proj.use_camera(proj.OBLIQUE)            # the grid and the placing: the buildings' square camera (art-v3 on)
STATES = [("build1", "施工 1（地基）"), ("build2", "施工 2"), ("build3", "施工 3"), ("done", "完成"), ("damaged", "受損"),
          ("rubble", "被摧毀（瓦礫）")]
LABEL = {"E": ("R8-13-哨所-東陸-mobile", "東陸"), "W": ("R8-14-哨所-西陸-mobile", "西陸")}
DIR = config.BUILD / "b1" / "prod"


def piece(c, state, suffix, pp, team):
    sp = scene.piece(DIR, f"outpost_{c}_{state}", suffix, team=team, ppm=20 * pp)
    return scene.with_fx(sp)          # the piece and its smoke (a list)


def team_share(c, suffix):
    base = DIR / f"outpost_{c}_done_{suffix}"
    a = np.asarray(Image.open(f"{base}_beauty.png").getchannel("A")) > 128
    m = np.asarray(Image.open(f"{base}_mask.png").convert("L")) > 128
    return float((a & m).sum()) / max(1, a.sum())


def top_m(c, suffix):
    import json
    return json.loads((DIR / f"outpost_{c}_done_{suffix}.json").read_text()).get("top_m")


def board(c, suffix):
    label, side = LABEL[c]
    W = 2500
    share = team_share(c, suffix)
    what = ("東陸：夯土矮牆（上面一道木壓頂）、鏡頭那一面留口；鏡頭那個角落一座紅柱木望樓，上面一間歇山頂小屋；旗、鼓、槍架。"
            if c == "E" else
            "西陸：削尖木樁圍成的柵欄、鏡頭那一面留口；鏡頭那個角落一座木架瞭望台，上面一間人字頂木屋，旁邊一把梯子；旗、帆布小帳篷。")
    text = (f"哨所（D-080）的暫用版，用現在建築的畫風（方形斜看，和 art-v5 的建築同一套相機、燈光、材質），{side}。占地 2×2 格（模擬 rules.ts size 2）。\n"
            f"{what}牆和柵欄壓低（約 1.3 公尺），站在後面的兵看得到；高的望樓放在鏡頭那個角落（前高後低，和其他建築同一條規則），"
            f"最高 {top_m(c, suffix)} 公尺。和箭樓分得開：箭樓是一座單獨的高樓，哨所是一圈矮牆加角落的小望樓。\n"
            f"狀態和其他建築一樣：施工三個階段、完成、受損（著火）、被摧毀（瓦礫）。玩家色：旗、望樓前的布幔、牆上的布幔，"
            f"佔完成圖的 {share:.1%}（其他建築的下限是 5%）。\n"
            "上兩列：每個狀態（藍，3 倍）；中：沒有玩家色、藍、紅（完成，3 倍）；下：實際大小。寫實版的哨所列在 R8 第二批。")
    parts = [boards.header(W, label, text)]
    tiles = [boards.captioned(b1art.tile(piece(c, s, suffix, 3, "blue"), 3, footprint=(2, 2), min_size=(380, 420)), name, 22)
             for s, name in STATES]
    parts.append(boards.row(tiles[:3], W, gap=20))
    parts.append(boards.row(tiles[3:], W, gap=20))
    tiles = [boards.captioned(b1art.tile(piece(c, "done", suffix, 3, t), 3, footprint=(2, 2), min_size=(380, 420)), n, 22)
             for t, n in (("neutral", "沒有玩家色"), ("blue", "藍"), ("red", "紅"))]
    parts.append(boards.row(tiles, W, gap=20))
    tiles = [boards.captioned(b1art.tile(piece(c, s, suffix, 1, t), 1, footprint=(2, 2), min_size=(130, 140)), n, 20)
             for s, t, n in (("done", "neutral", "沒有玩家色"), ("done", "blue", "藍"), ("done", "red", "紅"),
                             ("build2", "blue", "施工"), ("damaged", "blue", "受損"), ("rubble", "blue", "瓦礫"))]
    parts.append(boards.row([boards.captioned(boards.row(tiles, W - 2 * boards.M, gap=16), "實際大小（1 倍，手機的點）", 24)], W))
    return boards.save(boards.stack(parts, W), label)


if __name__ == "__main__":
    sfx = sys.argv[1] if len(sys.argv) > 1 else "x3"
    for c in ("E", "W"):
        board(c, sfx)
        print(c, f"player colour {team_share(c, sfx):.1%}")
