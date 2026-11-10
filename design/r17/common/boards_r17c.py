"""R17-03 boards (the user 2026-11-10, after R17-02: 「感覺可以有進攻 防守 跟團戰」; D-138): three kinds of marks on each
chart's time axis (進攻 ▲, 防守 a shield, 團戰 ●), a mark an event at its start, none joined, nothing about its result;
a tap on the axis opens the nearest event's card (two lines, 上一件／下一件). One option and an overview beside the
page as it is. Screens: the client's own 局後統計 (r17c.mjs); nothing boxed, the axis enlarged instead; labels above
the screens, none over them.

python3 design/r17/common/boards_r17c.py SHOTS EVENTS3.json OUT
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
BG = (24, 26, 30)
PW, PH = 1398, 504
AXIS = (640, 745, 2300, 840)          # the time axis on a 3x screenshot: the foot of the lines, the marks, the times
KEY = (2090, 322, 2566, 398)          # the small legend at the right end of the legend row
NOTE = "時間軸上三種記號，標在開始的時間：進攻 ▲（我方去打不是我方的城）、防守 盾形（電腦來打我方的城）、團戰 ●。各算各的、不合併，擠在一起就疊著；記號不表示結果。"
TAP = "點時間軸上任何地方，跳出最近那件事的說明卡：一行標題（哪一種、時間、地點、幾名），一行結果和死傷；「上一件／下一件」、第幾件／共幾件。圖上其他地方不加東西；①–④ 和圖下那行照舊；小圖例在圖例那一列的右端。資源、城鎮的圖也是同一排記號。"
RULES = [
    "怎麼算（war-game-client 用使用者的對局重播算的）：",
    "・防守：電腦士兵 5 名以上，到我方主城或我方治理、修繕中的城附近。",
    "・進攻：我方士兵 5 名以上，到電腦的主城、電腦的城、中立城鎮附近；中立城鎮要有人死或攻下才算（路過不算），廢墟不算。",
    "・團戰：60 秒內雙方士兵合計死 10 名以上（哪裡都算，野外也算）。",
    "・離開不到 30 秒又來算同一次；只出現 10 秒、又沒人死的不算。",
    "・幾名：那段時間附近同時最多的人數。死傷是整件事的合計，所以可能比名數多。",
    "・我方的城剛被打下（1 分鐘內），我方還在旁邊打：算在那次防守裡，不另外標進攻；死傷加進那次防守（城鎮的民兵不算）；搶回來了，防守的結果寫「失守後搶回」。這三局共 3 次（敗的那一局 2 次、短局 1 次）。",
]
SRC = "client 的局後統計頁（main，?ui=r6 A 銅木，Chromium 932×336＋iPhone 安全區），餵 client 重播的使用者對局時間軸。標頭的「對手」照對局寫成電腦・困難。"


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
    return Image.open(shots / f"{name}.png").convert("RGB").resize((PW, PH), Image.LANCZOS)


def axis(shots, name):
    """The time axis at twice the size of the screens on the board (the 3x screenshot's own pixels)."""
    return Image.open(shots / f"{name}.png").convert("RGB").crop(AXIS)


def rules(d, x, y, width, draw=True):
    for k, t in enumerate(RULES):
        f = font(30) if k == 0 else font(26, False)
        for i, ln in enumerate(wrap(d, t, f, width - (0 if k == 0 or i == 0 else 26))):
            if draw:
                d.text((x + (26 if k and i else 0), y), ln, font=f, fill=(255, 255, 255) if k == 0 else (220, 220, 220))
            y += f.size + 12
        y += 8
    return y


def head(d, W, title, lines, draw=True):
    y = 16
    if draw:
        d.text((24, y), title, font=font(52), fill=(240, 240, 240))
    y += 72
    for text, f, col in lines:
        for ln in wrap(d, text, f, W - 48):
            if draw:
                d.text((24, y), ln, font=f, fill=col)
            y += f.size + 14
    return y + 8


def game_names(ev):
    def n(g, what):
        c = ev[g]["count"]
        return f"{what}（進攻 {c['attack']}、防守 {c['defend']}、團戰 {c['battle']}）"
    return {"lose": n("33cdaaa5", "敗 92:39"), "win": n("2fd2e236", "勝 102:04"), "short": n("62ae4218", "短局敗 23:53")}


def board(shots, ev, out):
    G = game_names(ev)
    gap, lab = 24, 50
    W = 2 * PW + 3 * gap
    lines = [(NOTE, font(30), (250, 220, 140)), (TAP, font(25, False), (200, 200, 200)), (SRC, font(25, False), (170, 170, 170))]
    tmp = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    top = head(tmp, W, "", lines, draw=False)
    rows = [("lose", "lose", "兵力"), ("lose", "lose-tap", "點下去：防守（城丟了又搶回來的那一次）"),
            ("win", "win", "兵力"), ("win", "win-tap", "點下去：進攻"),
            ("short", "short", "兵力"), ("short", "short-tap", "點下去：團戰")]
    a = axis(shots, "lose")
    foot = lab + 3 * (34 + a.height + 18) + 10
    rx = 2 * gap + a.width
    rules_h = rules(tmp, rx, 6, W - rx - gap, draw=False)
    H = top + 3 * (lab + PH + gap) + max(foot, rules_h) + gap
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    head(d, W, "R17-03-戰事標記-三種記號-phone", lines)
    for i, (game, sname, what) in enumerate(rows):
        x = gap + (i % 2) * (PW + gap)
        y = top + (i // 2) * (lab + PH + gap)
        d.text((x, y + 6), f"{G[game]}　{what}", font=font(30), fill=(255, 255, 255))
        img.paste(shot(shots, sname), (x, y + lab))
    y0 = top + 3 * (lab + PH + gap)
    d.text((gap, y0 + 6), "時間軸那一排放大 2 倍（記號在 0 那條線下面）", font=font(30), fill=(255, 255, 255))
    yy = y0 + lab
    for game in ("lose", "win", "short"):
        d.text((gap, yy), G[game], font=font(24, False), fill=(210, 210, 210))
        img.paste(axis(shots, game), (gap, yy + 34))
        yy += 34 + a.height + 18
    rules(d, rx, y0 + 6, W - rx - gap)
    p = out / "R17-03-戰事標記-三種記號-phone.png"
    img.save(p, optimize=True)
    return p


def overview(shots, ev, out):
    G = game_names(ev)
    gap, lab = 24, 50
    W = 2 * PW + 3 * gap
    lines = [("左：現況（只有 ①–④）；右：三種記號。上：敗的那一局；中：左是勝的那一局的現況、右是點下去；下：時間軸那一排和小圖例放大 2 倍。", font(30), (250, 220, 140)),
             (NOTE, font(25, False), (200, 200, 200))]
    tmp = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    top = head(tmp, W, "", lines, draw=False)
    a = axis(shots, "lose")
    H = top + 2 * (lab + PH + gap) + 2 * (lab + a.height + 12) + gap
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    head(d, W, "R17-03-戰事標記-總覽-phone", lines)
    cells = [("現況　" + G["lose"].split("（")[0], "now-lose"), ("三種記號　" + G["lose"], "lose"),
             ("現況　" + G["win"].split("（")[0] + "（現況沒有可以點的）", "now-win"), ("三種記號　點下去", "lose-tap")]
    for i, (title, sname) in enumerate(cells):
        x = gap + (i % 2) * (PW + gap)
        y = top + (i // 2) * (lab + PH + gap)
        d.text((x, y + 6), title, font=font(30), fill=(255, 255, 255))
        img.paste(shot(shots, sname), (x, y + lab))
    y = top + 2 * (lab + PH + gap)
    for title, sname in (("現況　時間軸放大 2 倍（敗的那一局）", "now-lose"), ("三種記號　時間軸放大 2 倍", "lose")):
        d.text((gap, y + 6), title, font=font(30), fill=(255, 255, 255))
        img.paste(a if sname == "lose" else axis(shots, sname), (gap, y + lab))
        y += lab + a.height + 12
    key = Image.open(shots / "lose.png").convert("RGB").crop(KEY)
    x = 2 * gap + a.width
    y = top + 2 * (lab + PH + gap)
    d.text((x, y + 6), "小圖例放大 2 倍（在圖例那一列的右端，不另外佔一列）", font=font(30), fill=(255, 255, 255))
    img.paste(key, (x, y + lab))
    p = out / "R17-03-戰事標記-總覽-phone.png"
    img.save(p, optimize=True)
    return p


def main():
    shots, ev, out = Path(sys.argv[1]), json.loads(Path(sys.argv[2]).read_text()), Path(sys.argv[3])
    out.mkdir(parents=True, exist_ok=True)
    print(board(shots, ev, out).name)
    print(overview(shots, ev, out).name)


if __name__ == "__main__":
    main()
