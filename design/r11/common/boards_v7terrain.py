"""art-v7.3's terrain check (ceo 2026-11-06): the client's own drawing of the fixed map's bridges, banks and cliffs on the
diamond camera (shoot_terrain.mjs), art-v7.2's terrain beside the turned one.

python3 design/r11/common/boards_v7terrain.py BEFORE_PREFIX AFTER_PREFIX OUT
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "r9" / "common"))
import boards_r9 as B9    # noqa: E402

SPOTS = [("bridge_ns", "南北向的橋（17–19, 58–60），跨東西向的河"), ("bridge_ew", "東西向的橋（58–60, 17–19），跨南北向的河"),
         ("cliff", "階梯狀的懸崖（52–56, 70–81），縮放 0.8"), ("cliff_far", "同一段懸崖，縮放 0.5")]


def main(before, after, out):
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for name, cap in SPOTS:
        a = Image.open(f"{before}_{name}.png").convert("RGB").resize((1221, 570), Image.LANCZOS)
        b = Image.open(f"{after}_{name}.png").convert("RGB").resize((1221, 570), Image.LANCZOS)
        pair = Image.new("RGB", (2 * 1221 + 20, 606), B9.BG)
        d = ImageDraw.Draw(pair)
        d.text((0, 2), "art-v7.2（現在）", font=B9.font(26), fill=B9.INK)
        d.text((1241, 2), "art-v7.3（地形轉 90 度）", font=B9.font(26), fill=B9.INK)
        pair.paste(a, (0, 36))
        pair.paste(b, (1241, 36))
        rows.append((cap, pair))
    note = ("art-v7.3（ceo 2026-11-06：擋 art-v7 的切換，先單獨發）：client 自己畫的固定地圖（?test=1&map=fixed，菱形鏡頭，art=x3），"
            "左邊是 art-v7.2 的地形圖，右邊是轉 90 度後的。art-v7 的菱形地形照 edge-format 的鏡頭算、和 client 的投影差 90 度："
            "河岸碎成齒、橋順著河、懸崖成了空心的拱；轉過以後河岸連成一條、兩座橋都跨過河、懸崖是一道岩壁。每格是手機像素的一半。")
    B9.board("V7T-01-地形轉向-client實拍-前後對照-phone", note, rows, out)
    print("board in", out)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], Path(sys.argv[3]))
