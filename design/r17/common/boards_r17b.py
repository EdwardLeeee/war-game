"""R17-02 boards (the user 2026-11-10, after R17-01's A, B, C: 「感覺圖片有點複雜，感覺只需要放在在時間軸上標事件 想知道自己點進去
就好」): one row of small marks on each chart's time axis, an event a mark at its start, nothing about its result; a tap
on the axis opens the nearest event's card (two lines, 上一件／下一件). 甲 one kind of mark, 乙 an attack's ▲ and a
battle's ●. Screens: the client's own 局後統計 (r17b.mjs), nothing boxed (the marks are meant to be quiet): each
board shows the axis enlarged beside the screens instead. Labels above the screens, none over them.

python3 design/r17/common/boards_r17b.py SHOTS OUT
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
BG = (24, 26, 30)
K = 0.5
PW, PH = 1398, 504
AXIS = (640, 745, 2300, 840)          # the time axis on a 3x screenshot: the foot of the lines, the marks under the 0 line, the times
GAMES = {"lose": "敗 92:39（進攻 20、團戰 13）", "win": "勝 102:04（進攻 3、團戰 14）", "short": "短局敗 23:53（進攻 3、團戰 3）"}
SRC = "client 的局後統計頁（main bb88168，?ui=r6 A 銅木，Chromium 932×336＋iPhone 安全區），餵 client 重播的使用者對局時間軸。標頭的「對手」照對局寫成電腦・困難。"
OPTIONS = [
    ("甲", "一種記號", "時間軸上每件事一個 ◆（進攻、團戰同一種），標在開始的時間；擠在一起就疊著。結果、兵數、死傷只在點下去的說明卡裡。"),
    ("乙", "兩種記號", "時間軸上進攻是 ▲、團戰是 ●，標在開始的時間；擠在一起就疊著。結果、兵數、死傷只在點下去的說明卡裡。"),
]
COMMON = "點時間軸上任何地方，跳出最近那件事的說明卡：一行標題（進攻或團戰、時間、地點），一行結果和死傷；「上一件／下一件」、第幾件／共幾件。圖上其他地方不加東西；①–④ 和圖下那行照舊。"


def font(size, bold=True):
    return ImageFont.truetype(BOLD if bold else REG, size, index=3)


def wrap(d, text, f, width):
    lines, cur = [], ""
    for ch in text:
        if d.textlength(cur + ch, font=f) > width:
            lines.append(cur)
            cur = ch
        else:
            cur += ch
    return lines + [cur] if cur else lines


def shot(shots, name):
    im = Image.open(shots / f"{name}.png").convert("RGB")
    return im.resize((PW, PH), Image.LANCZOS)


def axis(shots, name, zoom=2):
    """The time axis' row of a screenshot, enlarged (3x pixels times `zoom`)."""
    im = Image.open(shots / f"{name}.png").convert("RGB").crop(AXIS)
    return im.resize((im.width * zoom // 2, im.height * zoom // 2), Image.LANCZOS)


def head(d, W, title, lines):
    y = 16
    d.text((24, y), title, font=font(52), fill=(240, 240, 240))
    y += 72
    for text, f, col in lines:
        for ln in wrap(d, text, f, W - 48):
            d.text((24, y), ln, font=f, fill=col)
            y += f.size + 14
    return y + 8


def board(shots, out, key, name, note):
    gap, lab = 24, 50
    W = 2 * PW + 3 * gap
    rows = [("lose", f"{key}-lose", "兵力"), ("lose", f"{key}-lose-tap", "點下去（最近的是 43:08 那場團戰）"),
            ("win", f"{key}-win", "兵力"), ("win", f"{key}-win-tap", "點下去（73:00 那次進攻）"), ("short", f"{key}-short", "兵力")]
    lines = [(note, font(30), (250, 220, 140)), (COMMON, font(25, False), (200, 200, 200)), (SRC, font(25, False), (170, 170, 170))]
    tmp = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    top = head(tmp, W, "", lines)
    H = top + 3 * (lab + PH + gap)
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    head(d, W, f"R17-02-戰事標記-{key}-{name}-phone", lines)
    for i, (game, sname, what) in enumerate(rows):
        x = gap + (i % 2) * (PW + gap)
        y = top + (i // 2) * (lab + PH + gap)
        d.text((x, y + 6), f"{GAMES[game]}　{what}", font=font(30), fill=(255, 255, 255))
        img.paste(shot(shots, sname), (x, y + lab))
    # the sixth cell: the axis rows enlarged
    x = gap + PW + gap
    y = top + 2 * (lab + PH + gap)
    d.text((x, y + 6), "時間軸那一排放大 2 倍（記號在 0 那條線下面）", font=font(30), fill=(255, 255, 255))
    yy = y + lab + 10
    for game in ("lose", "win", "short"):
        d.text((x, yy), GAMES[game], font=font(24, False), fill=(210, 210, 210))
        a = axis(shots, f"{key}-{game}", 2)
        a = a.resize((PW, round(a.height * PW / a.width)), Image.LANCZOS)
        img.paste(a, (x, yy + 34))
        yy += 34 + a.height + 22
    p = out / f"R17-02-戰事標記-{key}-{name}-phone.png"
    img.save(p, optimize=True)
    return p


def overview(shots, out):
    gap, lab = 24, 50
    W = 3 * PW + 4 * gap
    lines = [("左到右：現況、甲 一種記號、乙 兩種記號。上：敗的那一局（92 分鐘，33 件）；中：點下去；下：時間軸那一排放大 2 倍。", font(30), (250, 220, 140)),
             (COMMON, font(25, False), (200, 200, 200))]
    tmp = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    top = head(tmp, W, "", lines)
    a0 = axis(shots, "甲-lose", 2)
    ah = round(a0.height * PW / a0.width)
    H = top + 2 * (lab + PH + gap) + lab + ah + gap
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    head(d, W, "R17-02-戰事標記-總覽-phone", lines)
    cols = [("現況", "現況（只有 ①–④）"), ("甲", "甲 一種記號 ◆"), ("乙", "乙 兩種記號：進攻 ▲、團戰 ●")]
    for c, (key, title) in enumerate(cols):
        x = gap + c * (PW + gap)
        y = top
        d.text((x, y + 6), title, font=font(30), fill=(255, 255, 255))
        img.paste(shot(shots, f"{key}-lose"), (x, y + lab))
        y += lab + PH + gap
        if key == "現況":
            d.text((x, y + 6), "現況沒有可以點的；另一局：勝（102 分鐘）", font=font(30), fill=(255, 255, 255))
            img.paste(shot(shots, "現況-win"), (x, y + lab))
        else:
            d.text((x, y + 6), f"{key}　點下去", font=font(30), fill=(255, 255, 255))
            img.paste(shot(shots, f"{key}-lose-tap"), (x, y + lab))
        y += lab + PH + gap
        d.text((x, y + 6), f"{key}　時間軸放大 2 倍", font=font(30), fill=(255, 255, 255))
        a = axis(shots, f"{key}-lose", 2).resize((PW, ah), Image.LANCZOS)
        img.paste(a, (x, y + lab))
    p = out / "R17-02-戰事標記-總覽-phone.png"
    img.save(p, optimize=True)
    return p


def main():
    shots, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    for key, name, note in OPTIONS:
        print(board(shots, out, key, name, note).name)
    print(overview(shots, out).name)


if __name__ == "__main__":
    main()
