"""R6 B.3: one overview per style of the whole set (pref: every batch comes with an overview), thumbnails of every
board in order with its label. python3 common/overview.py -> out/R6-99-整套總覽-<A-銅木|B-墨漆金線>.png"""
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "round1" / "common"))
import artboard  # noqa: E402

OUT = HERE.parent / "out"


def key(p):
    m = re.match(r"R6-(\d+)(b?)-?(\d*)", p.stem)
    return (int(m.group(1)), m.group(2), int(m.group(3) or 0), p.stem)


def overview(tag, title, sub):
    files = sorted([p for p in OUT.glob(f"R6-*-{tag}-mobile.png") if not p.stem.startswith(("R6-0", "R6-99"))]
                   + [p for p in OUT.glob("R6-4[1-3]-*-AB-*-mobile.png")], key=key)
    cols, tw = 5, 460
    thumbs = []
    for p in files:
        im = Image.open(p).convert("RGB")
        th = int(im.height * tw / im.width)
        thumbs.append((p.stem.replace("-mobile", ""), im.resize((tw, min(th, 900)), Image.LANCZOS) if th <= 900 else
                       im.resize((tw, th), Image.LANCZOS).crop((0, 0, tw, 900))))
    rows = [thumbs[i:i + cols] for i in range(0, len(thumbs), cols)]
    M, gap = 40, 26
    H = 170 + sum(max(t.height for _, t in r) + 60 for r in rows) + 30
    W = M * 2 + cols * tw + (cols - 1) * gap
    art = Image.new("RGB", (W, H), (244, 241, 234))
    d = ImageDraw.Draw(art)
    d.text((M, 30), title, font=artboard.font(50), fill=(40, 40, 40))
    d.text((M, 104), sub, font=artboard.font(22, weight="regular"), fill=(90, 90, 90))
    y = 170
    for r in rows:
        x = M
        for name, t in r:
            d.text((x, y), name, font=artboard.font(17), fill=(40, 40, 40))
            art.paste(t, (x, y + 28))
            x += tw + gap
        y += max(t.height for _, t in r) + 60
    p = OUT / f"{title}.png"
    art.save(p, optimize=True)
    print("wrote", p.name, art.size, len(files), "boards")


if __name__ == "__main__":
    overview("A-銅木", "R6-99-整套總覽-A-銅木", "風格 A 銅木（預設）的整套設計稿：盤點的 146 項（拿掉的 INV-16、INV-128 除外）加 D-087 新加的項目；"
             "R6-41–43 是 A、B 並排的代表畫面。長的設計稿只顯示上面一段。")
    overview("B-墨漆金線", "R6-99-整套總覽-B-墨漆金線", "風格 B 墨漆金線：元件表（每種按鈕的四種狀態和每種面板）、第一批三張、A、B 並排的代表畫面（R6-41–43）。排版和 A 完全一樣。")
