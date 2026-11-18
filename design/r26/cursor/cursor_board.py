"""R26-05 游標 對照 (ceo 2026-11-18: 畫好先給我看一張排在一起的對照，放在草地和建築上各一次，看得清楚才算): each cursor large,
then at its real size on grass and on a building, at 1x (32 px, a usual screen) and 2x (64 px, a high-resolution one).
The screens' pixels are not scaled: what is seen is what the player sees.

python3 -I design/r26/cursor/cursor_board.py CURSORS OUT     (CURSORS: cursors.mjs's PNGs and backdrop.mjs's shots)
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
BG = (24, 26, 30)
INK = (240, 240, 240)
GOLD = (250, 220, 140)
GREY = (190, 190, 190)
DIM = (150, 150, 150)
GAP = 28
TEXTS = []


def font(size, bold=True):
    return ImageFont.truetype(BOLD if bold else REG, size, index=3)


def check_glyphs():
    f = font(40)

    def ink(ch):
        im = Image.new("L", (80, 80), 0)
        ImageDraw.Draw(im).text((10, 5), ch, font=f, fill=255)
        return im

    tofu = ink("")
    bad = sorted({ch for t in TEXTS for ch in t if not ch.isspace() and ImageChops.difference(ink(ch), tofu).getbbox() is None})
    if bad:
        raise SystemExit(f"no glyph in the font for: {' '.join(bad)}")


def text(d, xy, s, size, colour, bold=True):
    TEXTS.append(s)
    d.text(xy, s, font=font(size, bold), fill=colour)


def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    at = json.loads((src / "backdrop.json").read_text())
    hot = json.loads((src / "hotspots.json").read_text())
    bg1 = Image.open(src / "bg-1x.png").convert("RGBA")
    bg2 = Image.open(src / "bg-2x.png").convert("RGBA")
    rows = [("sword", "劍：選了兵，滑鼠在敵人上（攻擊）", "橫刀：直刃、單面開刃、環首，跟東陸兵腰上的刀一樣"),
            ("gate", "城門：選了兵，滑鼠在自己可以進駐的城或建築上", "唐代城門：平的木過梁、門洞兩邊往內斜，上面一座城樓"),
            ("axe", "斧頭：只選了村民，滑鼠在樹、金礦、漿果、晶礦上（採集）", "舊鐵斧頭、木柄，跟村民手上那把一樣（R20）"),
            ("hammer", "鎚子：只選了村民，滑鼠在自己蓋到一半或受損的建築上（蓋、修）", "整支木頭的木槌，跟村民蓋房用的一樣（R20）")]
    W1, H1 = 280, 170

    def panel(bg, k, point, name):
        cx, cy = point[0] * k, point[1] * k
        w, h = W1 * k, H1 * k
        crop = bg.crop((int(cx - w / 2), int(cy - h / 2), int(cx - w / 2) + w, int(cy - h / 2) + h)).copy()
        px = 32 * k
        cur = Image.open(src / f"{name}-{px}.png").convert("RGBA")
        hx, hy = hot[name][str(px)]
        crop.alpha_composite(cur, (w // 2 - hx, h // 2 - hy))
        return crop

    cols = [("放大看（8 倍）", None), ("草地 1 倍（一般螢幕，32 px）", ("grass", 1)), ("建築 1 倍", ("city", 1)),
            ("草地 2 倍（高解析度螢幕，64 px）", ("grass", 2)), ("建築 2 倍", ("city", 2))]
    widths = [256, W1, W1, 2 * W1, 2 * W1]
    rh = 2 * H1
    W = sum(widths) + (len(widths) + 1) * GAP
    head = 210
    H = head + len(rows) * (rh + 110 + 26) + 120
    img = Image.new("RGBA", (W, H), BG + (255,))
    d = ImageDraw.Draw(img)
    text(d, (GAP, 20), "R26-05-滑鼠游標-正式圖對照-desktop", 50, INK)
    text(d, (GAP, 86), "劍、城門、斧頭、鎚子，照東陸唐末五代的器物畫。每張都是原尺寸：游標 32 px（一般螢幕）和 64 px（高解析度螢幕），背景沒有縮放。", 28, GOLD)
    text(d, (GAP, 128), "游標的尖端（點下去算的那一點）在每張背景的正中間；城門的那一點在圖的正中間。只在有滑鼠的裝置出現。", 26, GREY, False)
    text(d, (GAP, 164), "草地、建築用 1920×950 的真畫面（預設拉近 1.3 倍後）；介面藏起來，只看游標和戰場。", 24, DIM, False)
    y = head
    for name, title, why in rows:
        text(d, (GAP, y), title, 32, GOLD)
        text(d, (GAP, y + 44), why, 24, GREY, False)
        x = GAP
        yy = y + 90
        for (lab, spec), w in zip(cols, widths):
            text(d, (x, yy - 2), lab, 20, DIM, False) if y == head else None
            if spec is None:
                big = Image.new("RGBA", (256, 256), (60, 66, 58, 255))
                big.alpha_composite(Image.open(src / f"{name}-256.png").convert("RGBA"))
                img.alpha_composite(big, (x, yy + 26))
            else:
                where, k = spec
                p = panel(bg1 if k == 1 else bg2, k, (at[where]["x"], at[where]["y"]), name)
                img.alpha_composite(p, (x, yy + 26))
            x += w + GAP
        y += rh + 110 + 26
    text(d, (GAP, y), "要改哪一個（顏色、大小、樣子），指出來就改。之後交給 client 的是這四張的 32 px、64 px PNG 和每張的尖端座標（hotspots.json）。", 26, INK, False)
    check_glyphs()
    img.convert("RGB").crop((0, 0, W, y + 60)).save(out / "R26-05-滑鼠游標-正式圖對照-desktop.png")
    print(out / "R26-05-滑鼠游標-正式圖對照-desktop.png")


if __name__ == "__main__":
    main()
