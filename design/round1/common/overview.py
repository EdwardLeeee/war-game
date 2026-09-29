"""R1-99-總覽對照.png: every option side by side, file names and key numbers under each."""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

import artboard
import config
import gif
import names

COL = {"g": artboard.GREEN, "r": artboard.RED, "n": artboard.GREY}
KEYS = [("idle", 3), ("cast", 20), ("cast", 25), ("shatter", 2), ("dead", 0)]


def cell(opt, width):
    d = config.BUILD / opt.lower()
    info = json.loads((d / "summary.json").read_text())
    o = names.OPTIONS[opt]
    screen = Image.open(d / "screen.png").convert("RGB")
    sh = int(screen.height * width / screen.width)
    shot = screen.resize((width, sh), Image.LANCZOS)
    frames = {(a, f): (img, anc) for a, f, img, anc in gif.load_frames(info["frames"])}
    bg = Image.open(info["frame_bg"]).convert("RGBA")
    kw = width // len(KEYS)
    kh = int(kw * 1.0)
    strip = Image.new("RGB", (width, kh), (230, 226, 216))
    for i, k in enumerate(KEYS):
        img, anc = frames[k]
        c = Image.new("RGBA", (kw - 6, kh))
        c.alpha_composite(gif.cover(bg, kw - 6, kh))
        s = 0.62
        im = img.resize((int(img.width * s), int(img.height * s)), Image.LANCZOS)
        c.alpha_composite(im, (int((kw - 6) * 0.42 - anc[0] * s), int(kh * 0.8 - anc[1] * s)))
        strip.paste(c.convert("RGB"), (i * kw, 0))
    lines = info["metrics"]
    H = 120 + sh + 20 + kh + 30 + 40 * len(lines) + 70
    out = Image.new("RGB", (width, H), (244, 241, 234))
    dr = ImageDraw.Draw(out)
    dr.text((0, 0), f"{opt}  {o['name']}", font=artboard.font(52), fill=artboard.INK)
    dr.text((0, 70), f"{o['tone']}｜{o['pipeline']}", font=artboard.font(24, weight="regular"), fill=artboard.GREY)
    out.paste(shot, (0, 120))
    y = 120 + sh + 20
    out.paste(strip, (0, y))
    dr.text((6, y + 6), "法師關鍵影格：待機／校準／發射／罩碎／陣亡", font=artboard.font(20), fill=(250, 250, 250))
    y += kh + 30
    for text, c in lines:
        dr.text((0, y), text, font=artboard.font(26, weight="regular"), fill=COL[c])
        y += 40
    dr.text((0, y + 14), names.label(opt, "mobile") + ".png", font=artboard.font(24), fill=artboard.INK)
    return out


def build(opts, out_path, footer):
    width = 1180
    cells = [cell(o, width) for o in opts]
    M = 70
    H = 200 + max(c.height for c in cells) + 110
    W = M * 2 + len(cells) * width + (len(cells) - 1) * 60
    art = Image.new("RGB", (W, H), (244, 241, 234))
    dr = ImageDraw.Draw(art)
    dr.text((M, 40), "R1-99-總覽對照", font=artboard.font(64), fill=artboard.INK)
    dr.text((M, 126), "第 1 輪 畫面風格：同一個戰場、同一套 UI 版面，只換畫風。綠字＝通過，紅字＝問題，灰字＝備註。",
            font=artboard.font(30, weight="regular"), fill=artboard.GREY)
    for i, c in enumerate(cells):
        art.paste(c, (M + i * (width + 60), 200))
    dr.text((M, H - 80), footer, font=artboard.font(28, weight="regular"), fill=artboard.GREY)
    art.save(out_path)
    return out_path


if __name__ == "__main__":
    opts = sys.argv[1:] or ["A", "B", "C"]
    build(opts, config.OUT / "R1-99-總覽對照.png",
          "想看像素風，下一輪可以用 B 的模型快速做一版。　玩家色 4 色待第 2 輪定。　三個選項執行時都只畫 2D 圖，都不需要即時 3D。")
