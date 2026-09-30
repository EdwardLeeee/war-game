"""B 立體微縮: 量產說明 card + md."""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "common"))

import config          # noqa: E402
import names           # noqa: E402
import prod_common as pc   # noqa: E402
import prodnotes as pn     # noqa: E402

OPT = "B"

TOOLS = [
    "Blender 5.2.2：Python 腳本建模（基本形組合）、關節轉軸擺姿勢、Cycles CPU 算圖；8 方向由腳本轉鏡頭自動產生。",
    "每格算 3 層：本體、玩家色遮罩、地面影子（影子半解析度）；法師特效另算 1 層。",
    "Python（Pillow、numpy、pycairo）：換玩家色、地面、特效、合成；ffmpeg 做 GIF。",
    "這台筆電（Intel 內顯、記憶體上限 1.5 GB）就能跑；也能放 GitHub Actions 平行算。",
]

HOURS = [
    ("兵種模型＋4 個動作（8 方向自動）", "實測：10 個兵種初版共約 9 分，依 ceo 回饋再修 8 分（約 1.7 分／兵種）",
     "估計 20–40 分／兵種（加細節、材質、每個動作檢查、2–3 輪修正）→ 12 兵種約 4–8 小時"),
    ("法師完整動作＋特效", "實測：約 25 分（寫程式 10 分＋2 輪修正 15 分）", "另一文化的法師估計 20–30 分"),
    ("建築、城鎮、環境", "實測：7 件初版約 4 分", "估計 15–30 分／棟（含 3 種狀態）→ 26 棟約 7–13 小時；廢墟版另計"),
    ("地面（2 種地貌）", "實測：程式產生約 10 分", "估計 2–4 小時（邊界過渡、裝飾物）"),
    ("算圖（機器時間）", "實測：3 倍每層 0.4–1.5 秒；主城 20–30 秒",
     "估計：全部兵種約 1–1.5 小時、建築約 1 小時（這台筆電）"),
]


def sections():
    o = names.OPTIONS[OPT]
    return dict(
        sub=f"{o['name']}｜{o['pipeline']}｜{o['tone']}｜工時是 AI session 的作業時間，不含使用者審稿",
        boxes=[
            ("工具鏈", pn.ul(TOOLS), False),
            ("引擎需求", pn.ul([
                ("執行時只畫 2D 圖（精靈圖集），不需要即時 3D；Godot 與 PixiJS 兩個候選都適用。", "g"),
                "玩家色：遮罩＋換色 shader（或載入時預先換好 4 色）。",
                "魔法光暈用加亮混合的 2D 特效圖；影子是另一張半透明圖。",
            ]), False),
            ("總素材量（完整量產）", pc.asset_box(), True),
            ("每件工時", pn.table(["項目", "本輪實測", "量產估計"], HOURS), True),
            ("手機貼圖記憶體（完整量產，估計）", pc.memory_box(), True),
            ("可以商用的確認", pn.ul(pc.LICENCES), True),
        ])


VERDICT = [
    ("同一套打光（午後斜陽、同方向影子、冷色背光）與材質語言（漆、布、鋼、木），東陸城樓和西陸石塔、槍陣和長矛陣放在一起不突兀。", "g"),
    ("玩家色只出現在換色區（背旗、罩袍、馬衣、馬鎧下擺）；衣甲一律避開玩家色，紅纓改白、紅槍桿改深木。", "g"),
    ("兩邊重騎兵的玩家色面積相近：具裝騎兵加了玩家色馬鎧下擺與頸披，和騎士的紅馬衣一樣顯眼。", "g"),
    ("東陸甲改成帶高光的青銅褐、加一盞冷色背光，實際大小在泥地上分得出。", "g"),
    ("術士：白袍＋青色發光鑲邊＋頭頂三顆浮空魔晶，不靠防護罩也認得出。", "g"),
    ("兩邊的長槍都是褐色的線，戰線交錯處看不出是誰的槍（持槍的人本身敵我分明）。", "n"),
    ("建築的朱紅柱子暫時保留（東方建築特色），第 2 輪定 4 種玩家色時一起檢查。", "n"),
    ("模型是基本形組合，放大（頭像）時看得出很簡化；遊戲尺寸（約 35 pt）看不出來。", "n"),
]


def build():
    lab = names.label(OPT, "量產說明")
    s = sections()
    pn.render_card(lab, s, VERDICT, config.OUT / f"{lab}.png")
    pn.write_md(HERE / "量產說明.md", lab, s, VERDICT)
    print("wrote", lab)


if __name__ == "__main__":
    build()
