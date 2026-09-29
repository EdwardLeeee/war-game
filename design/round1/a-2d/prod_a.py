"""A 彩繪桌遊: 量產說明 card + md (timings from a-2d/worklog-a.md)."""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "common"))

import config          # noqa: E402
import names           # noqa: E402
import prod_common as pc   # noqa: E402
import prodnotes as pn     # noqa: E402

OPT = "A"

TOOLS = [
    "Python＋pycairo：每個零件是向量形狀（貝茲曲線），粗描邊＋兩階平塗陰影＋高光；零件掛在 2D 骨架上旋轉位移做動作。",
    "每個形狀同時畫在顏色層與玩家色遮罩層，執行時用程式換色。",
    "地面、建築、特效同一套繪圖函式；輸出 3 倍 PNG 序列，ffmpeg 做 GIF。",
    "不需要 Blender，不需要顯示卡；這台筆電一張戰鬥畫面約 8 秒。",
]

HOURS = [
    ("兵種（1 個方向，待機／走路／攻擊）", "實測：10 種共 3.5 分＋依 ceo 回饋修 2.2 分（約 0.6 分／種）",
     "估計：加上倒下、細修到量產品質約 5–10 分／種／方向"),
    ("8 方向", "本輪只畫 1 個方向（向右），向左用鏡像",
     "估計：要手畫 5 個方向（右、右前、前、右後、後），正面與背面輪廓全部重畫 → 每兵種約 5 倍，12 兵種約 5–10 小時"),
    ("法師完整動作＋特效（1 個方向）", "實測：約 3 分（寫 1.5 分＋修正 1.5 分）", "估計：5 個方向約 15–30 分"),
    ("建築、城鎮、環境", "實測：大型建築約 0.5 分／棟、小物件約 0.1 分／件",
     "估計：量產品質 10–20 分／棟（3 種狀態）→ 26 棟約 4–9 小時"),
    ("地面（2 種地貌）", "實測：1 種約 1 分", "估計：2–3 小時（邊界過渡、裝飾物）"),
    ("輸出（機器時間）", "實測：戰鬥畫面約 8 秒、84 格動畫約 15 秒", "全部素材估計 30 分鐘內；不需要算圖農場"),
]


def sections():
    o = names.OPTIONS[OPT]
    return dict(
        sub=f"{o['name']}｜{o['pipeline']}｜{o['tone']}｜工時是 AI session 的作業時間，不含使用者審稿",
        boxes=[
            ("工具鏈", pn.ul(TOOLS), False),
            ("引擎需求", pn.ul([
                ("執行時只畫 2D 圖，不需要即時 3D；兩個引擎候選都適用。", "g"),
                "玩家色：遮罩＋換色，同 B、C。",
                ("另一條路：零件直接在引擎裡做骨架（切片）動畫，貼圖只要零件圖集，記憶體可降到約十分之一；但 8 方向仍要 5 套零件。", "n"),
            ]), False),
            ("總素材量（完整量產）", pc.asset_box(), True),
            ("每件工時", pn.table(["項目", "本輪實測", "量產估計"], HOURS), True),
            ("手機貼圖記憶體（完整量產，估計；做成序列圖時）", pc.memory_box(), True),
            ("可以商用的確認", pn.ul([t for t in pc.LICENCES if not t[0].startswith("Blender")] +
                                    [("A 不使用 Blender。", "n")]), True),
        ])


VERDICT = [
    ("同一套粗暖褐描邊與兩階平塗，東陸城樓、小鎮和西陸石塔、兩邊的兵放在一起不突兀。", "g"),
    ("實際大小（1 pt = 1 px）最好認：白纓盔長槍、卡其裙弩手、灰褐兜帽長弓、寬邊鐵盔長矛，剪影各不相同；藍紅分明。", "g"),
    ("玩家色只在換色區；具裝騎兵加了玩家色後披、鞍布與流蘇裙，和騎士一樣顯眼。", "g"),
    ("純 2D 每個方向都要手畫；本輪只證明了 1 個方向，正面、背面的造型還沒畫過，是量產最大的風險。", "r"),
    ("除了術士，其他兵種這輪沒有倒下動作；西陸建築只畫了石塔 1 棟。", "r"),
    ("新雙塔徽章在實際大小的馬衣上只剩一小塊白，放大 3 倍以上才看得出是兩座塔（至少不再像 H）。", "n"),
    ("明亮卡通的調子最親切，但「亂世戰爭的緊張」較弱。", "n"),
]


def build():
    lab = names.label(OPT, "量產說明")
    s = sections()
    pn.render_card(lab, s, VERDICT, config.OUT / f"{lab}.png")
    pn.write_md(HERE / "量產說明.md", lab, s, VERDICT)
    print("wrote", lab)


if __name__ == "__main__":
    build()
