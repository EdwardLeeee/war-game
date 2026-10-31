"""R10's boards from raw/ (shoot.mjs): one PNG an option and device, its label top left, what was measured under it
(green passes, grey notes), and the overview.

python3 design/r10/common/compose.py RAW_DIR      -> design/r10/out/
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[1] / "out"
BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
BG, INK, GREY, GREEN = (244, 241, 234), (40, 40, 40), (110, 110, 110), (38, 120, 62)
M = 28
LAND_NOTE = "和 R6-10 同一張卡片；地圖列三顆平分原本的寬度"
PORT_NOTE = "目前直向只有「請轉成橫向」：要看到這張，開局畫面得拿掉那個遮罩（對局中不變）"

# file name, job, what it shows
BOARDS = [
    ("R10-01-開局地圖-0-現況-橫向", "01-0-land", "現況：固定地圖、隨機地圖兩顆（R6-10）"),
    ("R10-01-開局地圖-0-現況-直向", "01-0-port", "現況：手機直拿，整個畫面是「請轉成橫向」，開局卡片看不到"),
    ("R10-01-開局地圖-A-關口-橫向", "01-A-land", "名字 A「關口」：最短，直接說這張圖的特色"),
    ("R10-01-開局地圖-A-關口-直向", "01-A-port", "名字 A「關口」"),
    ("R10-01-開局地圖-B-雙河關-橫向", "01-B-land", "名字 B「雙河關」：地圖上真的有兩條河，每條一座橋、一處淺灘"),
    ("R10-01-開局地圖-B-雙河關-直向", "01-B-port", "名字 B「雙河關」"),
    ("R10-01-開局地圖-C-雙橋-橫向", "01-C-land", "名字 C「雙橋」：兩條河各一座橋"),
    ("R10-01-開局地圖-C-雙橋-直向", "01-C-port", "名字 C「雙橋」"),
    ("R10-02-地圖縮圖-A-不放-橫向", "01-B-land", "縮圖 A 不放（名字用「雙河關」示意）：卡片大小和現在一樣"),
    ("R10-02-地圖縮圖-A-不放-直向", "01-B-port", "縮圖 A 不放"),
    ("R10-02-地圖縮圖-B-放縮圖-橫向", "02-B-land", "縮圖 B：選到這張圖時，「開始」下面多一張小地圖，只有河、橋、樹林、岩石，沒有城鎮和礦（照樣要探）"),
    ("R10-02-地圖縮圖-B-放縮圖-直向", "02-B-port", "縮圖 B"),
]


def font(size, bold=True):
    return ImageFont.truetype(BOLD if bold else REG, size)


def checks(m, port):
    """[(text, colour)] under a frame."""
    if not m.get("card"):
        return [("沒有開局卡片", GREY)]
    b = m["buttons"]
    out = [(f"地圖列 {len(b)} 顆，每顆 {b[0]['w']}×{b[0]['h']} pt，沒有截字", GREEN if all(x["h"] >= 44 and x["w"] >= 44 and not x["clipped"] for x in b) else (200, 40, 40)),
           (f"說明 {m['descLines']} 行", GREEN if m["descLines"] == 1 else (200, 40, 40)),
           (f"卡片 {round(m['card']['w'])}×{round(m['card']['h'])} pt，在 {m['screen']['w']}×{m['screen']['h']} 的畫面內", GREEN if m["card"]["b"] <= m["screen"]["h"] and m["rowRight"] <= m["colRight"] + 0.5 else (200, 40, 40))]
    out.append((PORT_NOTE if port else LAND_NOTE, GREY))
    return out


def wrap(d, text, f, w):
    lines, cur = [], ""
    for ch in text:
        if d.textlength(cur + ch, font=f) > w:
            lines.append(cur)
            cur = ch
        else:
            cur += ch
    return lines + [cur]


def board(name, job, cap, raw, scale=2):
    im = Image.open(raw / f"{job}.png").convert("RGB")
    im = im.resize((im.width * scale // 3, im.height * scale // 3), Image.LANCZOS)
    m = json.loads((raw / f"{job}.json").read_text())
    port = im.height > im.width
    W = max(im.width + 2 * M, 900)
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    lines = [(ln, INK, font(24)) for ln in wrap(probe, cap, font(24), W - 2 * M)]
    for t, c in checks(m, port):
        lines += [(ln, c, font(20, False)) for ln in wrap(probe, t, font(20, False), W - 2 * M)]
    H = M + 50 + 12 + im.height + 14 + sum(int(f.size * 1.5) for _, _, f in lines) + M
    o = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(o)
    d.text((M, M), name, font=font(32), fill=INK)
    o.paste(im, (M, M + 62))
    y = M + 62 + im.height + 14
    for t, c, f in lines:
        d.text((M, y), t, font=f, fill=c)
        y += int(f.size * 1.5)
    o.save(OUT / f"{name}.png")
    return o


def overview(tiles):
    """Every option: landscape on the left, portrait beside it, its file name under it."""
    k = 0.5
    cols = []
    for name, im in tiles:
        cols.append((name, im.resize((int(im.width * k), int(im.height * k)), Image.LANCZOS)))
    pairs = [cols[i:i + 2] for i in range(0, len(cols), 2)]
    row_w = sum(t.width for _, t in pairs[0]) + 20
    per = 2
    rows = [pairs[i:i + per] for i in range(0, len(pairs), per)]
    H0 = 110
    W = max(sum(sum(t.width + 16 for _, t in p) + 30 for p in r) for r in rows) + 2 * M
    hs = [max(max(t.height for _, t in p) for p in r) for r in rows]
    o = Image.new("RGB", (W, H0 + sum(h + 30 for h in hs) + M), BG)
    d = ImageDraw.Draw(o)
    d.text((M, M), "R10-99-總覽對照", font=font(38), fill=INK)
    d.text((M, M + 54), "把上一局那張隨機地圖（種子 2106939660）存成開局可以選的地圖。01 名字；02 要不要放小地圖。", font=font(20, False), fill=GREY)
    y = H0
    for r, h in zip(rows, hs):
        x = M
        for p in r:
            for _, t in p:
                o.paste(t, (x, y))
                x += t.width + 16
            x += 30
        y += h + 30
    o.save(OUT / "R10-99-總覽對照.png")


def main(raw):
    OUT.mkdir(exist_ok=True)
    tiles = [(n, board(n, j, c, raw)) for n, j, c in BOARDS]
    overview(tiles)
    print(len(tiles) + 1, "boards in", OUT)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
