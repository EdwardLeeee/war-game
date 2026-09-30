"""Per-option summary.json for the overview: screen, mage frames, ground tile, key lines.

Heights come from the ruler data each option already measured; the judgement lines
match the 東西協調 verdicts in each 量產說明.
"""
import json
import sys
from pathlib import Path

from PIL import Image

import config

ROOT = Path(__file__).resolve().parents[1]

LINES = {
    "A": [
        ("實際大小最好認：粗描邊＋平塗，兵種剪影各不相同", "g"),
        ("身體高度：步兵 33–37 pt、騎兵 46–47 pt、術士 38 pt", "n"),
        ("8 方向：純 2D 要手畫 5 個方向（本輪只畫 1 個）", "r"),
        ("東西協調：同一套描邊與平塗，不突兀", "g"),
        ("明亮卡通；亂世的緊張感較弱", "n"),
        ("引擎：執行時只畫 2D 圖，不需要即時 3D", "g"),
    ],
    "B": [
        ("藍紅分明；術士白袍＋浮空魔晶，一眼找得到", "g"),
        ("身體高度：步兵 34–36 pt、騎兵 45–47 pt、術士 41 pt（含浮空魔晶）", "n"),
        ("8 方向：同一個 3D 模型由腳本自動產生", "g"),
        ("東西協調：同一套打光與材質，不突兀", "g"),
        ("模型較簡化，放大（頭像）才看得出", "n"),
        ("引擎：執行時只畫 2D 圖，不需要即時 3D", "g"),
    ],
    "C": [
        ("紙白墨黑，只有玩家色與魔法上色：敵我最清楚", "g"),
        ("身體高度同 B（和 B 共用模型）", "n"),
        ("8 方向：和 B 共用模型，自動產生", "g"),
        ("水墨效果還不到位：濃淡偏平，像墨線插畫", "r"),
        ("西陸的西方感被水墨沖淡", "r"),
        ("引擎：2D 圖＋一層全螢幕宣紙疊圖", "g"),
    ],
}


def tile(opt):
    d = config.BUILD / opt.lower()
    g = Image.open(d / "ground.png").convert("RGBA")
    t = g.crop((1500, 900, 2200, 1290))
    if opt == "C":
        sys.path.insert(0, str(ROOT / "c-ink"))
        import make_c
        t = make_c.dusk(g).crop((1500, 900, 2200, 1290))
    p = d / "tile.png"
    t.save(p)
    return p


def write(opt):
    d = config.BUILD / opt.lower()
    info = dict(frames=str(d / "mage_frames"), frame_bg=str(tile(opt)), metrics=LINES[opt])
    (d / "summary.json").write_text(json.dumps(info, ensure_ascii=False, indent=1))
    return info


if __name__ == "__main__":
    for o in sys.argv[1:] or ["A", "B", "C"]:
        write(o)
        print("summary", o)
