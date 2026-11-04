"""art-v7 PR4's review boards (D-118, the edge as the client will draw it from edge/): the label top left, R11's C
(round 3, the user's choice) beside the production edge, the pieces on one sheet.

python3 design/r11/common/boards_v7edge.py BOARD_DIR EDGE_X3 R11_OUT OUT [scores-line]
  BOARD_DIR: edge_board_v7.py's output (west_fall.png/.gif, corner_sw.png); R11_OUT: design/r11/build/out
"""
import json
import shutil
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "r9" / "common"))
import boards_r9 as B9    # noqa: E402

board, one_x = B9.board, B9.one_x
NOTE = ("art-v7 量產 PR 4（D-118：使用者 2026-11-04 選「C 遠方浮島」、照這個方向量產）：浮空大陸的邊緣，照和 client 談定的格式"
        "（design/r11/edge-format.md）畫成 edge/ 的素材，這張圖是照 client 會怎麼畫把素材疊起來：雲海遠近兩層在螢幕上拼貼（視差 0.2、0.35，"
        "各自錯開半個週期淡入淡出）、遠方浮島、崖面每 16 公尺一段、轉角、瀑布（往下捲、越往下越寬）、水霧、河口、地面在地圖邊切直、最後 0.75 公尺"
        "淡出到崖頂的草、最上面飄過的雲。")


def sheet(edge_dir):
    """Every picture of edge/ at 1/3 on a dark sky, with its name."""
    from PIL import ImageDraw
    E = json.loads((edge_dir / "edge.json").read_text())
    names = [p["file"] for p in E["cliff"]["sw"] + E["cliff"]["se"]] + [E["cliff"]["corner"][k]["file"] for k in
                                                                       ("left", "bottom", "right")]
    names += [i["file"] for i in E["islands"]] + [E["fall"]["loop"]["file"], E["fall"]["spray"]["file"],
                                                  E["fall"]["mouth"]["file"], E["fall"]["mouth"]["se"]["file"]]
    names += [p["file"] for p in E["puffs"]]
    ims = []
    for n in names:
        im = Image.open(edge_dir / n).convert("RGBA")
        f = 1 / 3 if im.width > 300 else 1.0
        ims.append((n, im.resize((max(1, int(im.width * f)), max(1, int(im.height * f))), Image.LANCZOS)))
    W = 1900
    x = y = 20
    rowh = 0
    pos = []
    for n, im in ims:
        if x + im.width > W - 20:
            x, y = 20, y + rowh + 40
            rowh = 0
        pos.append((n, im, x, y))
        x += im.width + 24
        rowh = max(rowh, im.height)
    H = y + rowh + 50
    o = Image.new("RGBA", (W, H), (58, 74, 98, 255))
    d = ImageDraw.Draw(o)
    for n, im, x, y in pos:
        o.alpha_composite(im, (x, y))
        d.text((x, y + im.height + 4), n, fill=(230, 232, 236), font=B9.font(18, False))
    return o.convert("RGB")


def main(bd, edge_dir, r11, out, scores=""):
    out.mkdir(parents=True, exist_ok=True)
    note = NOTE + ("\n" + scores if scores else "")
    w = Image.open(bd / "west_fall.png").convert("RGB")
    c = Image.open(bd / "corner_sw.png").convert("RGB")
    shutil.copy(bd / "west_fall.gif", out / "V7E-01-地圖邊緣-西邊瀑布-動畫.gif")
    board("V7E-01-地圖邊緣-西邊瀑布-phone", note + "\n雙河關西邊北河流出去的地方（R11-06 同一處）。動畫見同名 GIF（3 秒循環，鏡頭左右慢慢移）。",
          [("實際大小（1 倍）", one_x(w)), ("手機像素（3 倍的 2/3）", w.resize((w.width * 2 // 3, w.height * 2 // 3), Image.LANCZOS))], out)
    board("V7E-02-地圖邊緣-西南轉角-phone", note + "\n地圖的西南角（菱形的下角）：左下、右下兩條邊的崖面在這裡相接。",
          [("實際大小（1 倍）", one_x(c)), ("手機像素（3 倍的 2/3）", c.resize((c.width * 2 // 3, c.height * 2 // 3), Image.LANCZOS))], out)
    r = Image.open(r11 / "R11-06-地圖邊緣-C-遠方浮島-phone.png").convert("RGB")
    board("V7E-03-地圖邊緣-R11對照-phone", note + "\n上：R11 試驗的 C（使用者選的方向，評審第 3 輪 5.5）；下：量產（同一處）。",
          [("R11 C（試驗圖，原圖縮小）", r.resize((r.width * 2 // 3, r.height * 2 // 3), Image.LANCZOS)),
           ("量產（3 倍的 2/3）", w.resize((w.width * 2 // 3, w.height * 2 // 3), Image.LANCZOS))], out)
    board("V7E-04-地圖邊緣-素材一覽-phone", note + "\nedge/ 的每一張圖（3 倍的 1/3），名字照 edge.json。",
          [("素材", sheet(edge_dir))], out)
    print("boards in", out)


if __name__ == "__main__":
    a = sys.argv
    main(Path(a[1]), Path(a[2]), Path(a[3]), Path(a[4]), a[5] if len(a) > 5 else "")
