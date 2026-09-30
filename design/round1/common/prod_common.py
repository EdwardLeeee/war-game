"""Shared 量產說明 boxes (asset counts, texture memory, licences) for every option."""
import prodnotes as pn

# measured this round (build/3d/sprites, trimmed alpha box at 3x); A reuses the same art scale
UNIT_PX = 20384          # mean 140 x 136 px, includes spears and banners
BUILDING_PX = 240000     # main city 1112x827, town 745x510, tower 288x511 -> typical ~240k


def asset_box():
    rows = [
        ("兵種動作", f"{pn.clips()} 組（2 文化 × 6 兵種 × 4 動作 × 8 方向）"),
        ("兵種影格", f"{pn.unit_frames(False):,} 張；3 個方向用鏡像時要做 {pn.unit_frames(True):,} 張"),
        ("每方向影格（估計）", "待機 8、走路 8、攻擊 10、倒下 10；法師 80（本輪實際）；農夫另加 4 種工作 × 8"),
        ("建築", f"13 棟 × 2 文化 × 3 狀態（建造中、完成、受損）＝ {pn.BUILDINGS} 張"),
        ("城鎮", f"2 文化 × 2 尺寸 × 3 種圖（中立、廢墟、治理）＝ {pn.TOWN_IMAGES} 張；我方／敵方治理只換旗色"),
        ("地貌", f"2 種 × 約 35 件（地面、裝飾、樹、資源）＝ {pn.TERRAIN} 件"),
        ("玩家色", "只畫一次：玩家色的部分另存遮罩，執行時用程式換色（本輪藍紅兩色就是這樣做的）"),
    ]
    return pn.table(["項目", "數量"], rows)


def memory_box():
    rows = []
    for name, u, m, b, t in pn.memory_table(UNIT_PX, BUILDING_PX):
        rows.append((name, f"{u:.0f}", f"{m:.0f}", f"{b:.0f}", f"{t:.0f}"))
    note = pn.ul([
        ("3 倍未壓縮放不進手機記憶體；建議 2 倍＋ASTC 壓縮（約 40 MB 級）。", "r"),
        ("算法：影格數 × 平均修邊面積（本輪實測兵種 140×136 px、建築約 24 萬 px，3 倍）× 每像素位元。", "n"),
        ("只載入這一局出現的文化；遮罩也可以塞進同一張圖的一個通道。", "n"),
    ])
    return pn.table(["規格", "兵種 MB", "玩家色遮罩 MB", "建築城鎮 MB", "合計 MB"], rows) + note


LICENCES = [
    ("Blender 5.2.2（GPL）：只當製作工具；GPL 不管算出來的圖，圖可以商用。", "g"),
    ("Python、Pillow、numpy、pycairo、ffmpeg、pyoxipng（MIT）：製作工具，不隨遊戲發佈。", "g"),
    ("Google Chrome：只用來把設計稿的 UI 截圖，不進遊戲。", "g"),
    ("Noto Sans／Serif CJK TC（SIL OFL 1.1）：設計稿文字；遊戲若內嵌字型，OFL 允許商用與內嵌。", "g"),
    ("模型、材質、徽章、地面全部由本 repo 的程式產生，沒有使用第三方素材。", "g"),
]
