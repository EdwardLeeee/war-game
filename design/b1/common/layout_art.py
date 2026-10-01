"""B1-03 layout plans: the cells of the small town and the big city seen from above (for ceo and
war-game-core), next to the town as the game draws it with the blocked cells tinted.

python3 common/layout_art.py [prev|x3]
-> out/B1-03-城鎮配置-小鎮.png, out/B1-03-城鎮配置-大城.png
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(1, str(HERE.parents[1] / "round1" / "common"))
import artboard   # noqa: E402
import config     # noqa: E402
import layouts    # noqa: E402
import proj       # noqa: E402
import town_art   # noqa: E402

BG = (244, 241, 234)
INK = (40, 40, 40)
GREY = (100, 100, 100)
COL = {"square": (226, 220, 204), "street": (205, 190, 160), "garden": (170, 196, 130), "house": (150, 92, 70),
       "tower": (70, 66, 80)}
LEGEND = [("house", "房子（擋路）"), ("tower", "箭樓（擋路，拆掉後可走）"), ("square", "廣場（可走）"),
          ("street", "街道（可走）"), ("garden", "菜園空地（可走）")]


def plan_image(L, px=None):
    """Top view: x to the right, y down (the sim's grid), the town centre in the middle."""
    R = L["radius"]
    px = px or (60 if R <= 5 else 48)
    n = 2 * R + 2
    W = H = n * px + 40
    im = Image.new("RGB", (W, H), (255, 255, 255))
    dr = ImageDraw.Draw(im)
    big = L["tower"] is not None
    cx = cy = W / 2
    # cell (i, j) -> top-left pixel; small: cell centre at (i, j) cells, big: at (i + 0.5, j + 0.5)
    for (i, j), k in L["cells"].items():
        a, b = L["cell_centre"](i, j)
        x0, y0 = cx + (a - 0.5) * px, cy + (b - 0.5) * px
        dr.rectangle([x0, y0, x0 + px - 1, y0 + px - 1], fill=COL[k], outline=(255, 255, 255))
    # house pieces outlined, with their size
    for kind, ca, cb, _ in L["pieces"]:
        fx, fy = layouts.piece_fp(kind)
        x0, y0 = cx + (ca - fx / 2) * px, cy + (cb - fy / 2) * px
        dr.rectangle([x0 + 1, y0 + 1, x0 + fx * px - 2, y0 + fy * px - 2], outline=(60, 30, 20), width=2)
        dr.text((x0 + 5, y0 + 3), f"{fx}×{fy}", font=artboard.font(15), fill=(255, 240, 220))
    # the sim's circle (the town's radius): small town from the centre cell's middle; big city as proposed
    r = R * px
    dr.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(200, 60, 40), width=2)
    if big:
        # where the sim measures from today: the middle of the centre cell, half a cell off the tower's middle
        ox, oy = cx + 0.5 * px, cy + 0.5 * px
        dr.ellipse([ox - r, oy - r, ox + r, oy + r], outline=(200, 60, 40), width=1)
        dr.ellipse([ox - 4, oy - 4, ox + 4, oy + 4], fill=(200, 60, 40))
    dr.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=(30, 30, 30))

    def mark(pt, label, col):
        x, y = cx + pt[0] * px, cy + pt[1] * px
        dr.ellipse([x - 12, y - 12, x + 12, y + 12], fill=col, outline=(255, 255, 255))
        dr.text((x - 8, y - 10), label, font=artboard.font(16), fill=(255, 255, 255))

    for p in L["militia"]:
        mark(p, "民", (90, 90, 90))
    for p in L["garrison"]:
        mark(p, "駐", (46, 110, 214))
    mark(L["flag"], "旗", (150, 40, 120))
    for p in L["posts"]:
        mark(p, "樁", (200, 120, 30))
    return im


def board(L, suffix="prev"):
    title = f"B1-03-城鎮配置-{'小鎮' if L['name'] == 'small' else '大城'}"
    plan = plan_image(L)
    iso, origin = town_art.town("E", L, "neutral", "AB", suffix)
    # tint the blocked cells on the drawing: outline every blocked cell's diamond in red
    ppm = 30 if suffix == "prev" else 60
    d = ImageDraw.Draw(iso, "RGBA")
    for (i, j), k in L["cells"].items():
        if k not in ("house", "tower"):
            continue
        a, b = L["cell_centre"](i, j)
        x, y = a * layouts.CELL, b * layouts.CELL
        h = layouts.CELL / 2
        poly = [proj.to_px((x + dx, y + dy), origin, ppm) for dx, dy in ((-h, -h), (h, -h), (h, h), (-h, h))]
        d.polygon(poly, outline=(220, 40, 30, 255))
    M = 50
    sub = ("俯視格子圖：x 往右、y 往下（模擬的格子），每格 2 公尺。房子和箭樓擋路，其餘都可以走。"
           "配置轉 90° 和左右翻都一樣，從哪個方向進城都公平。紅圈是城鎮範圍（攻下和駐軍看這個圈）。"
           "民＝民兵站的位置，駐＝駐軍，旗＝方向 A 的旗桿，樁＝方向 B 的界樁。")
    if L["tower"] is not None:
        sub += ("　大城：箭樓 2×2 照模擬放在中心格的左上，所以箭樓中心在格線交點，比模擬量範圍的中心（紅點）偏半格。"
                "配置以箭樓中心對稱，粗紅圈是建議的範圍；細紅圈是現在模擬量的範圍。建議 core 把大城的範圍中心改到箭樓中心。")
    else:
        sub += "　小鎮：中心在格子正中（和模擬一樣），廣場 3×3，街道 3 格寬。"
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    W = M * 3 + plan.width + iso.width
    top = artboard_wrap(probe, M, 110, sub, W - 2 * M) + 20
    counts = layouts.counts(L)
    stats = "　".join(f"{n}：{counts.get(k, 0)} 格" for k, n in (("house", "房子"), ("tower", "箭樓"), ("square", "廣場"),
                                                             ("street", "街道"), ("garden", "空地")))
    H = top + max(plan.height, iso.height) + 120
    art = Image.new("RGB", (W, H), BG)
    dr = ImageDraw.Draw(art)
    dr.text((M, 34), title, font=artboard.font(48), fill=INK)
    artboard_wrap(dr, M, 110, sub, W - 2 * M)
    art.paste(plan, (M, top))
    art.paste(iso.convert("RGB"), (2 * M + plan.width, top))
    y = top + max(plan.height, iso.height) + 16
    x = M
    for k, n in LEGEND:
        dr.rectangle([x, y, x + 22, y + 22], fill=COL[k])
        dr.text((x + 30, y), n, font=artboard.font(18), fill=INK)
        x += 60 + int(dr.textlength(n, font=artboard.font(18)))
    dr.text((M, y + 40), stats + "　（右圖：東陸、中立，紅框是擋路的格子；民兵是替代，用東陸槍兵套中立灰白）",
            font=artboard.font(18), fill=GREY)
    p = config.OUT / f"{title}.png"
    art.save(p)
    print("wrote", p.name, art.size)


def artboard_wrap(dr, x, y, text, width, size=22):
    """Wrap Chinese text by characters; returns the y below the last line."""
    f = artboard.font(size)
    line = ""
    for ch in text:
        if dr.textlength(line + ch, font=f) > width:
            dr.text((x, y), line, font=f, fill=GREY)
            y += size + 10
            line = ch
        else:
            line += ch
    if line:
        dr.text((x, y), line, font=f, fill=GREY)
        y += size + 10
    return y


if __name__ == "__main__":
    suffix = sys.argv[1] if len(sys.argv) > 1 else "prev"
    config.OUT.mkdir(parents=True, exist_ok=True)
    for L in (layouts.small(), layouts.large()):
        board(L, suffix)
