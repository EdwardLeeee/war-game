"""R17 boards (the user 2026-11-10: 「我覺得結算畫面 也可以把電腦來進攻我們打團戰的飆進去」; brief
docs/briefs/2026-11-r17-stats-battles.md): each option one board, its screens the client's own 局後統計 (main, ?ui=r6,
A 銅木, 932 x 336 with the iPhone's safe area) of three of the user's games replayed by war-game-client
(war-game-worktrees/review/r17/), the option drawn in by r17-page.js; what was added boxed in yellow; every label above
its screen, none over it.

python3 design/r17/common/boards_r17.py SHOTS OUT     (SHOTS: r17.mjs's screenshots and marks.json)
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
BG = (24, 26, 30)
YELLOW = (255, 214, 40)
K = 0.5                                     # the 3x screenshots at half size: 1398 x 504
GAMES = {"lose": "敗：92:39，進攻 20、團戰 13（最多的一局，33cdaaa5）", "win": "勝：102:04，進攻 3、團戰 14，12 場在野外（2fd2e236）",
         "short": "短局敗：23:53，進攻 3、團戰 3（62ae4218）"}
COMMON = ("記號不用玩家色：進攻用形狀分（▽ 擋下、▼ 城鎮失守、× 主城被毀），團戰用填法分（淡色實心＝我方贏、斜線＝敵方贏、虛線框＝平手）；"
          "說明卡寫字。差不到 14 pt 的記號合成一個、寫數字。")
SRC = ("client 的局後統計頁（main bb88168，?ui=r6 A 銅木，Chromium 932×336＋iPhone 安全區），餵 client 重播的使用者對局時間軸；"
       "黃框＝這個選項加的。標頭的「對手」照對局寫成電腦・困難（重播的時間軸沒有記）。")
OPTIONS = [
    ("A", "圖上全標", "資源、兵力、城鎮的圖上都標：團戰是一段直條，進攻是頂端的記號和一條虛線。點記號跳出說明卡，上一件、下一件一件看。",
     [("lose", "A-lose", "兵力"), ("lose", "A-lose-tap", "兵力：點下去（第 10 件，進攻打成團戰合成一個）"), ("lose", "A-res", "資源（同一組記號）"),
      ("win", "A-win", "兵力"), ("short", "A-short", "兵力")]),
    ("B", "戰事清單", "「戰鬥」頁加切換「兵種｜戰事」：每次進攻、每場團戰一列（時間、地點、兵數、死傷、結果），清單在標題下捲。點一列跳到兵力圖、標出那段時間；"
     "圖上照舊只有 ①–④。",
     [("lose", "B-lose", "戰鬥 → 戰事"), ("lose", "B-lose-tap", "點第 10 件那列"), ("lose", "B-lose-jump", "點了以後：跳到兵力，標出那段時間"),
      ("win", "B-win", "戰鬥 → 戰事（野外只寫死傷）"), ("short", "B-short", "戰鬥 → 戰事")]),
    ("C", "圖下戰事帶", "曲線不動，圖下面加一條「戰事」帶（上排進攻、下排團戰），資源、兵力、城鎮共用；圖讓出這一列的高度。點帶上任何地方，"
     "跳出最近那件的說明卡，圖上標出那段時間。",
     [("lose", "C-lose", "兵力"), ("lose", "C-lose-tap", "兵力：點下去（第 10 件）"), ("lose", "C-res", "資源（同一條帶）"),
      ("win", "C-win", "兵力"), ("short", "C-short", "兵力")]),
]


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


def shot(shots, marks, name):
    im = Image.open(shots / f"{name}.png").convert("RGB")
    im = im.resize((round(im.width * K), round(im.height * K)), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    s = 3 * K
    for x, y, w, h in marks.get(name, []):
        d.rectangle((x * s - 3, y * s - 3, (x + w) * s + 3, (y + h) * s + 3), outline=YELLOW, width=4)
    return im


def board(shots, marks, out, key, name, note, rows):
    pw, ph = 1398, 504
    gap, lab = 24, 50
    cols = 2
    d0 = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    W = cols * pw + (cols + 1) * gap
    head = [(f"R17-01-戰事標記-{key}-{name}-phone", font(52), (240, 240, 240))]
    head += [(ln, font(30), (250, 220, 140)) for ln in wrap(d0, note, font(30), W - 2 * gap)]
    head += [(ln, font(25, False), (200, 200, 200)) for ln in wrap(d0, COMMON, font(25, False), W - 2 * gap)]
    head += [(ln, font(25, False), (170, 170, 170)) for ln in wrap(d0, SRC, font(25, False), W - 2 * gap)]
    top = 20 + sum(f.size + 18 for _, f, _ in head) + 10
    nrow = (len(rows) + cols - 1) // cols
    H = top + nrow * (lab + ph + gap)
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    y = 16
    for text, f, col in head:
        d.text((gap, y), text, font=f, fill=col)
        y += f.size + 18
    for i, (game, sname, what) in enumerate(rows):
        x = gap + (i % cols) * (pw + gap)
        yy = top + (i // cols) * (lab + ph + gap)
        d.text((x, yy + 6), f"{GAMES[game].split('，')[0]}　{what}", font=font(30), fill=(255, 255, 255))
        img.paste(shot(shots, marks, sname), (x, yy + lab))
    # what the three games are, under the last row's free cell
    if len(rows) % cols:
        x = gap + (len(rows) % cols) * (pw + gap)
        yy = top + (nrow - 1) * (lab + ph + gap) + lab
        for k, t in enumerate(GAMES.values()):
            d.text((x + 10, yy + 20 + 46 * k), t, font=font(28, False), fill=(220, 220, 220))
    p = out / f"R17-01-戰事標記-{key}-{name}-phone.png"
    img.save(p, optimize=True)
    return p


def overview(shots, marks, out):
    pw, ph = 1398, 504
    gap, lab = 24, 50
    W = 3 * pw + 4 * gap
    top = 190
    H = top + 2 * (lab + ph + gap)
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.text((gap, 16), "R17-01-戰事標記-總覽-phone", font=font(52), fill=(240, 240, 240))
    d.text((gap, 90), "上：敗的那一局（92 分鐘，24 件）；下：點下去。左到右：A 圖上全標、B 戰事清單、C 圖下戰事帶。總覽頁的「關鍵時刻」三個選項都照舊最多 4 個。",
           font=font(30), fill=(250, 220, 140))
    d.text((gap, 138), COMMON, font=font(25, False), fill=(200, 200, 200))
    for c, (key, name, _, rows) in enumerate(OPTIONS):
        x = gap + c * (pw + gap)
        for r, sname in enumerate((rows[0][1], rows[1][1])):
            yy = top + r * (lab + ph + gap)
            d.text((x, yy + 6), f"{key} {name}　{'敗' if r == 0 else '點下去'}", font=font(30), fill=(255, 255, 255))
            img.paste(shot(shots, marks, sname), (x, yy + lab))
    p = out / "R17-01-戰事標記-總覽-phone.png"
    img.save(p, optimize=True)
    return p


def main():
    shots, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    marks = json.loads((shots / "marks.json").read_text())
    for key, name, note, rows in OPTIONS:
        print(board(shots, marks, out, key, name, note, rows).name)
    print(overview(shots, marks, out).name)


if __name__ == "__main__":
    main()
