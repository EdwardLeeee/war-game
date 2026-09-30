"""C 水墨戰卷: 量產說明 card + md."""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "common"))

import config          # noqa: E402
import names           # noqa: E402
import prod_common as pc   # noqa: E402
import prodnotes as pn     # noqa: E402

OPT = "C"

TOOLS = [
    "和 B 共用同一套 Blender 模型、動作、8 方向（B 的建模工時不必再付一次）。",
    "每格算 4 層：顏色、光影（白模）、玩家色遮罩、影子。",
    "Python 把顏色換成濃淡墨（紙白到墨黑），光影壓成 3 階，內側加暈染聚墨，外輪廓是粗細不一、帶飛白的毛筆線；只有玩家色與魔晶保留顏色。",
    "地面：程式產生宣紙、淡墨暈染、毛筆描邊與草葉筆觸；畫面上方留白成霧，四角淡墨。",
]

HOURS = [
    ("兵種模型＋4 個動作（8 方向自動）", "與 B 共用（見 B）", "與 B 共用；C 只多一次著色參數調整，估計每兵種 5–10 分"),
    ("C 專用：水墨著色、毛筆輪廓、宣紙地面程式", "實測：約 30 分（初版 15 分＋依 ceo 回饋改成紙白墨黑 15 分）",
     "量產時一次做好、所有素材共用；要做出真正的筆意與濃淡，估計再 4–8 小時"),
    ("建築、城鎮、環境", "與 B 共用", "同 B：26 棟約 7–13 小時（共用）"),
    ("算圖（機器時間）", "每格比 B 多 1 層（顏色層很快，約 0.1–0.2 秒）", "估計比 B 多約 20–30%"),
]


def sections():
    o = names.OPTIONS[OPT]
    return dict(
        sub=f"{o['name']}｜{o['pipeline']}｜{o['tone']}｜工時是 AI session 的作業時間，不含使用者審稿",
        boxes=[
            ("工具鏈", pn.ul(TOOLS), False),
            ("引擎需求", pn.ul([
                ("執行時只畫 2D 圖，不需要即時 3D；墨線與色階都已烤進圖裡。", "g"),
                "畫面多一層全螢幕的宣紙紋理與黃昏暗角（一張疊加圖，負擔很小）。",
                "玩家色：遮罩＋換色，同 B。",
            ]), False),
            ("總素材量（完整量產）", pc.asset_box(), True),
            ("每件工時", pn.table(["項目", "本輪實測", "量產估計"], HOURS), True),
            ("手機貼圖記憶體（完整量產，估計）", pc.memory_box(), True),
            ("可以商用的確認", pn.ul(pc.LICENCES), True),
        ])


VERDICT = [
    ("和 B 明顯不同：宣紙留白、濃淡墨、毛筆輪廓，只有玩家色與魔法上色。", "g"),
    ("墨線把兩邊的材質統一成同一種筆觸；西陸石塔、騎士畫成墨線不怪，和東陸城樓放在一起一致。", "g"),
    ("玩家色與魔晶青光在黑白畫面上最跳：敵我與魔法是三個選項裡最清楚的。", "g"),
    ("水墨效果還不到位：單位的濃淡變化偏平，比較像「墨線插畫」；真正的筆意與暈染層次要第 2 輪再加強。", "r"),
    ("水墨本身帶東方印象，西陸的「西方感」被沖淡，石塔與騎士像「東方畫師筆下的西洋兵」。", "r"),
    ("原本偏暗，依 ceo 回饋改成紙白墨黑；三個選項目前沒有真正偏暗的版本。", "n"),
]


def build():
    lab = names.label(OPT, "量產說明")
    s = sections()
    pn.render_card(lab, s, VERDICT, config.OUT / f"{lab}.png")
    pn.write_md(HERE / "量產說明.md", lab, s, VERDICT)
    print("wrote", lab)


if __name__ == "__main__":
    build()
