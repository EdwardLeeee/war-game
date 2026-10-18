"""R6 B.2 boards (the images ceo shows the user): file name = the label in the image,
輪次-項目編號-項目名-選項字母-選項名-裝置 (ceo 2026-10-18: style and the left-hand items are separate questions).

python3 common/boards.py     reads build/shot-*.png (shoot.mjs) -> out/R6-0x-*.png
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "round1" / "common"))
import artboard  # noqa: E402

BUILD = HERE.parent / "build"
OUT = HERE.parent / "out"
BG = (244, 241, 234)
INK = (40, 40, 40)
GREY = (96, 96, 96)
M = 50
FONT_NOTE = ("字是 iPhone 內建的字（PingFang TC；這台電腦用 Noto Sans CJK TC 代替），只用兩種粗細：一般（400）、粗（700）。"
             "玩家色先用藍、紅，整套設計稿時和中立色一起定案。")

STYLES = [
    ("A", "銅木", "a", "深色胡桃木的面板鑲一圈銅邊，按鈕像一塊塊木牌，按下去會往下沉。和立體微縮的模型最像，像擺在桌上的軍棋；字是米白色。"),
    ("B", "墨漆金線", "b", "深墨色、半透明的漆面板，切角加金色細線和四角的小金釘；按鈕平、輕，按下去會亮起來。最不搶戰場，小字最清楚。"),
    ("C", "沙盤軍帖", "c", "米黃紙卡像攤在沙盤上的軍帖，墨色的線；進攻、撤退、堅守像紅、藍、黃三色的印。最亮、最醒目，也最搶戰場的顏色。"),
]
LEFT = [
    ("A", "照現在", "keep", None, "四樣（重設、全體回城、閒置、小地圖）都留在左邊，位置不變，只換風格。"),
    ("B", "收成一顆", "fan", "fanopen",
     "左邊只剩一顆「工具」，紅點的數字是閒置的村民；點了往上展開重設、全體回城、閒置（右下：打開時）。小地圖縮小到 84 pt。"
     "戰場左邊多露出約 70 pt 寬。"),
    ("C", "需要時才出現", "ond", "ondopen",
     "閒置只在有閒置的村民時出現；全體回城收進選單，家被打的時候才跳出來（要新增這個提示）；"
     "重設併進選取資訊的 × 和提示列的「取消」（按了就回到什麼都沒選）；小地圖收成「地圖」鈕，點了才打開（右下：打開時）。戰場露出最多。"),
    ("D", "搬到別處", "moved", None,
     "閒置併進資源列（點數字跳到閒置的村民）；全體回城搬到右上，和速度、暫停、選單同一排；重設併進 × 和「取消」；"
     "小地圖改小，放到左上、資源列下面。左下整塊空出來。"),
]
MINIMAP = [
    ("A", "方形", "sq", "地圖照格子畫成正方形（現在的做法）。戰場畫成斜 45 度以後，鏡頭框在小地圖上變成斜的；"
     "小地圖的上下左右和畫面差 45 度。112×112 pt。"),
    ("B", "菱形", "di", "小地圖和戰場一樣轉 45 度、壓成 2:1 的菱形：上下左右和畫面一致，鏡頭框是正的長方形；"
     "地圖的四個角就是戰場的四個角。比方形扁，152×76 pt。"),
]


def font(size, bold=True):
    return artboard.font(size, weight="bold" if bold else "regular")


def wrap(dr, x, y, text, width, size=24, fill=GREY, bold=False):
    f = font(size, bold)
    line = ""
    for ch in text:
        if ch == "\n" or (dr.textlength(line + ch, font=f) > width and ch not in "，。、」』）：；！？"):
            dr.text((x, y), line, font=f, fill=fill)
            y += int(size * 1.45)
            line = "" if ch == "\n" else ch
        else:
            line += ch
    if line:
        dr.text((x, y), line, font=f, fill=fill)
        y += int(size * 1.45)
    return y


def header(W, label, sub):
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    h = wrap(probe, 0, 120, sub, W - 2 * M) + 20
    art = Image.new("RGB", (W, h), BG)
    dr = ImageDraw.Draw(art)
    dr.text((M, 34), label, font=font(54), fill=INK)
    wrap(dr, M, 120, sub, W - 2 * M)
    return art


def stack(parts, W):
    H = sum(p.height for p in parts)
    art = Image.new("RGB", (W, H), BG)
    y = 0
    for p in parts:
        art.paste(p, (0, y))
        y += p.height
    return art


def captioned(img, text, size=24):
    out = Image.new("RGB", (img.width, img.height + int(size * 1.7)), BG)
    ImageDraw.Draw(out).text((0, 0), text, font=font(size), fill=INK)
    out.paste(img.convert("RGB"), (0, int(size * 1.7)))
    return out


def row(images, W, gap=40):
    H = max(i.height for i in images)
    out = Image.new("RGB", (W, H + 30), BG)
    x = M
    for im in images:
        out.paste(im, (x, 0))
        x += im.width + gap
    return out


def shot(name):
    return Image.open(BUILD / f"shot-{name}.png").convert("RGB")


def save(art, label):
    OUT.mkdir(exist_ok=True)
    p = OUT / f"{label}.png"
    art.save(p, optimize=True)
    print("wrote", p.name, art.size)
    return p


def style_boards():
    out = []
    for opt, name, t, sub in STYLES:
        scr = shot(t)
        W = scr.width + 2 * M
        label = f"R6-01-介面風格-{opt}-{name}-mobile"
        head = header(W, label, f"選項 {opt}「{name}」：{sub}\n"
                      "三張排版一樣，只換風格；位置照現在的原型（左邊四樣怎麼收是另一題 R6-02）。上：手機像素（3 倍）。"
                      "下：實際大小（1 pt = 1 px），以及按鈕的四種狀態——一般、按下、亮著、不能按（現在的介面沒有「按下」和「不能按」的樣子）。"
                      + FONT_NOTE)
        main = Image.new("RGB", (W, scr.height + 30), BG)
        main.paste(scr, (M, 0))
        actual = captioned(scr.resize((814, 380), Image.LANCZOS), "實際大小（1 pt = 1 px）")
        st = shot(f"s{t}")
        sw = W - 2 * M - actual.width - 40
        st = st.resize((sw, round(st.height * sw / st.width)), Image.LANCZOS)
        states = captioned(st, "按鈕的四種狀態（放大）")
        out.append(save(stack([head, main, row([actual, states], W)], W), label))
    # overview: the three at actual size, with their state sheets under them
    W = M * 2 + 3 * 814 + 2 * 40
    head = header(W, "R6-01-介面風格-總覽", "三種風格並排（實際大小，1 pt = 1 px），下面是各自的按鈕狀態。排版都一樣，只換風格。")
    cols = []
    for opt, name, t, _ in STYLES:
        a = captioned(shot(t).resize((814, 380), Image.LANCZOS), f"{opt}「{name}」", 28)
        st = shot(f"s{t}")
        st = st.resize((814, round(st.height * 814 / st.width)), Image.LANCZOS)
        col = Image.new("RGB", (814, a.height + 16 + st.height), BG)
        col.paste(a, (0, 0))
        col.paste(st, (0, a.height + 16))
        cols.append(col)
    out.append(save(stack([head, row(cols, W)], W), "R6-01-介面風格-總覽"))
    return out


def left_boards():
    out = []
    for opt, name, key, open_key, sub in LEFT:
        scr = shot(f"L-{key}") if key != "keep" else shot("b")
        W = scr.width + 2 * M
        label = f"R6-02-左邊收法-{opt}-{name}-mobile"
        head = header(W, label, f"選項 {opt}「{name}」：{sub}\n"
                      "四樣的功能都留著（GDD 的設計），只換位置或出現的時機。這一題用 B「墨漆金線」畫，只為了比較位置；"
                      "選哪一種風格是另一題（R6-01）。上：手機像素（3 倍）；下：實際大小。")
        main = Image.new("RGB", (W, scr.height + 30), BG)
        main.paste(scr, (M, 0))
        parts = [captioned(scr.resize((814, 380), Image.LANCZOS), "實際大小（1 pt = 1 px）")]
        if open_key:
            parts.append(captioned(shot(f"L-{open_key}").resize((814, 380), Image.LANCZOS), "打開時（實際大小）"))
        out.append(save(stack([head, main, row(parts, W)], W), label))
    W = M * 2 + 2 * 814 + 40
    head = header(W, "R6-02-左邊收法-總覽", "左邊四樣（重設、全體回城、閒置、小地圖）的四種收法，實際大小。都用 B「墨漆金線」畫，只比較位置。")
    rows_ = []
    items = [(opt, name, key) for opt, name, key, _, _ in LEFT]
    for i in range(0, len(items), 2):
        cells = []
        for opt, name, key in items[i:i + 2]:
            im = shot(f"L-{key}") if key != "keep" else shot("b")
            cells.append(captioned(im.resize((814, 380), Image.LANCZOS), f"{opt}「{name}」", 28))
        rows_.append(row(cells, W))
    out.append(save(stack([head] + rows_, W), "R6-02-左邊收法-總覽"))
    return out


def minimap_boards():
    out = []
    crops = []
    for opt, name, key, sub in MINIMAP:
        scr = shot(f"M-{key}")
        W = scr.width + 2 * M
        label = f"R6-03-小地圖形狀-{opt}-{name}-mobile"
        head = header(W, label, f"選項 {opt}「{name}」：{sub}\n"
                      "白框是鏡頭現在看到的範圍；藍是我方、紅是敵方，黑色是還沒探過的地方。用 B「墨漆金線」畫；"
                      "小地圖放哪裡、要不要收起來是 R6-02。上：手機像素（3 倍）；下：小地圖放大 2 倍，和實際大小。")
        main = Image.new("RGB", (W, scr.height + 30), BG)
        main.paste(scr, (M, 0))
        box = (0, scr.height - 130 * 3, 180 * 3, scr.height)
        crop = scr.crop(box)
        zoom = crop.resize((crop.width * 2 // 3, crop.height * 2 // 3), Image.LANCZOS)      # 2 px a pt
        crops.append((opt, name, crop))
        out.append(save(stack([head, main, row([captioned(zoom, "小地圖（放大 2 倍）"),
                                                captioned(scr.resize((814, 380), Image.LANCZOS), "實際大小（1 pt = 1 px）")], W)], W), label))
    W = M * 2 + 2 * 540 + 40
    head = header(W, "R6-03-小地圖形狀-總覽", "方形和菱形的小地圖（手機像素）。白框是鏡頭看到的範圍。")
    out.append(save(stack([head, row([captioned(c, f"{o}「{n}」", 28) for o, n, c in crops], W)], W), "R6-03-小地圖形狀-總覽"))
    return out


if __name__ == "__main__":
    style_boards()
    left_boards()
    minimap_boards()
