"""R6-24: the four player colours and the neutral (sprite-atlas.md section 4: settled in R6), as options for the user.

python3 common/colours.py ART_DIR   -> out/R6-24-玩家色-<甲|乙|丙>-<名>-mobile.png, out/R6-24-玩家色-總覽.png
                                       build/colours.json: every colour difference that was computed

Every pair of a palette's colours, and every colour against the reserved ones (晶 cyan of the crystal and the shield,
the 晶砲 warning orange, the neutral off-white, the green of the health bar, the meadow), is measured with CIEDE2000
(ΔE00; about 2 is just visible, over 10 is clearly another colour) and the board prints the smallest ones. The
colours are shown where the game uses them: the player-colour layer of the units and buildings (the layer is the
grey x 1.6, tinted: a multiply), the minimap dots, the health bars and a group button.
"""
import itertools
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(1, str(HERE.parents[1] / "round1" / "common"))
import artboard   # noqa: E402
import field      # noqa: E402

BUILD = HERE.parent / "build"
OUT = HERE.parent / "out"
NEUTRAL = ("中立", (0xd8, 0xd2, 0xc0))
RESERVED = [("魔晶青", (0x5f, 0xe3, 0xf0)), ("預警橘", (0xff, 0x8a, 0x2a)), ("中立灰白", NEUTRAL[1]),
            ("血條綠", (0x7f, 0xcf, 0x6a)), ("草地", field.GROUND)]
PALETTES = [
    ("甲", "藍紅黃紫", [("藍", (0x3f, 0x7f, 0xe0)), ("紅", (0xd9, 0x43, 0x3a)), ("黃", (0xe8, 0xc4, 0x2e)), ("紫", (0x9a, 0x5c, 0xe0))],
     "藍、紅照現在（我方藍、敵方紅），再加黃和紫。黃偏檸檬，不靠近預警的橘；紫偏亮，乘在士兵的灰上不會太暗。"),
    ("乙", "藍紅黃綠", [("藍", (0x3f, 0x7f, 0xe0)), ("紅", (0xd9, 0x43, 0x3a)), ("黃", (0xe8, 0xc4, 0x2e)), ("綠", (0x2f, 0x9e, 0x52))],
     "紫換成綠。綠最好叫名字，但和草地、血條的綠最近，數字比甲小。"),
    ("丙", "藍紅黃洋紅", [("藍", (0x3f, 0x7f, 0xe0)), ("紅", (0xd9, 0x43, 0x3a)), ("黃", (0xe8, 0xc4, 0x2e)), ("洋紅", (0xd8, 0x4f, 0xb0))],
     "紫換成洋紅（粉紫）。在草地上最跳，但和紅比較近。"),
]


# ---------------------------------------------------------------- CIEDE2000

def _lab(rgb):
    c = np.asarray(rgb, np.float64) / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = m @ c / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return 116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])


def de2000(a, b):
    L1, a1, b1 = _lab(a)
    L2, a2, b2 = _lab(b)
    C1, C2 = math.hypot(a1, b1), math.hypot(a2, b2)
    Cm = (C1 + C2) / 2
    G = 0.5 * (1 - math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360
    h2p = math.degrees(math.atan2(b2, a2p)) % 360
    dLp, dCp = L2 - L1, C2p - C1p
    dh = h2p - h1p
    if C1p * C2p == 0:
        dh = 0
    elif dh > 180:
        dh -= 360
    elif dh < -180:
        dh += 360
    dHp = 2 * math.sqrt(C1p * C2p) * math.sin(math.radians(dh / 2))
    Lpm, Cpm = (L1 + L2) / 2, (C1p + C2p) / 2
    hs = h1p + h2p
    if C1p * C2p == 0:
        hpm = hs
    elif abs(h1p - h2p) <= 180:
        hpm = hs / 2
    else:
        hpm = (hs + 360) / 2 if hs < 360 else (hs - 360) / 2
    T = (1 - 0.17 * math.cos(math.radians(hpm - 30)) + 0.24 * math.cos(math.radians(2 * hpm))
         + 0.32 * math.cos(math.radians(3 * hpm + 6)) - 0.20 * math.cos(math.radians(4 * hpm - 63)))
    dth = 30 * math.exp(-(((hpm - 275) / 25) ** 2))
    Rc = 2 * math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7))
    Sl = 1 + 0.015 * (Lpm - 50) ** 2 / math.sqrt(20 + (Lpm - 50) ** 2)
    Sc, Sh = 1 + 0.045 * Cpm, 1 + 0.015 * Cpm * T
    Rt = -math.sin(math.radians(2 * dth)) * Rc
    return math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh))


def measure(cols):
    """Every pair inside the palette (with the neutral) and every colour against the reserved ones."""
    named = cols + [NEUTRAL]
    pairs = sorted(((round(de2000(a, b), 1), f"{n1}–{n2}") for (n1, a), (n2, b) in itertools.combinations(named, 2)))
    vs = sorted(((round(de2000(c, r), 1), f"{n}–{rn}") for n, c in cols for rn, r in RESERVED if r != NEUTRAL[1]))
    return pairs, vs


# ---------------------------------------------------------------- the board

def font(size):
    return artboard.font(size)


def unit_tile(atl, cols, ppm_scale=1.5):
    """A row of the same units, one per colour, at 1 pt = 1.5 px, with a health bar in the player colour."""
    W, H = int(70 * ppm_scale), int(80 * ppm_scale)
    out = []
    for name, rgb in cols:
        can = Image.new("RGBA", (W * 4, H), (*field.GROUND, 255))
        key = f"c{rgb}"
        field.TEAM[key] = rgb
        for k, (u, fr) in enumerate((("spear_e", "spear_e_idle_f7_00"), ("xbow_e", "xbow_e_idle_f6_00"),
                                     ("pike_w", "pike_w_idle_f7_00"), ("mage_w", "mage_w_idle_f6_00"))):
            body, ax, ay = atl[u].body(fr, key)
            s = 0.5 * ppm_scale                       # the 3x atlas at 1.5 px a pt
            body = body.resize((round(body.width * s), round(body.height * s)), Image.LANCZOS)
            gx, gy = W * k + W / 2, H * 0.86
            sh = atl[u].shadow(fr)
            if sh:
                si = sh[0].resize((round(sh[0].width * s), round(sh[0].height * s)), Image.LANCZOS)
                can.alpha_composite(si, (int(gx - sh[1] * s), int(gy - sh[2] * s)))
            can.alpha_composite(body, (int(gx - ax * s), int(gy - ay * s)))
            dr = ImageDraw.Draw(can)
            bx, by = gx - 13 * ppm_scale / 1.5, gy - ay * s - 8
            dr.rounded_rectangle([bx, by, bx + 26 * ppm_scale / 1.5, by + 4 * ppm_scale / 1.5], 2, fill=(20, 16, 12, 200))
            dr.rounded_rectangle([bx, by, bx + 20 * ppm_scale / 1.5, by + 4 * ppm_scale / 1.5], 2, fill=rgb)
        out.append((name, rgb, can))
    return out


def building_tile(batl, rgb, height):
    """The East barracks in this colour, scaled to the row's height (smaller than 1 pt = 1.5 px)."""
    key = f"c{rgb}"
    field.TEAM[key] = rgb
    body, ax, ay = batl.body("barracks_E_done", key)
    s = (height - 12) / body.height
    body = body.resize((round(body.width * s), round(body.height * s)), Image.LANCZOS)
    can = Image.new("RGBA", (body.width + 20, height), (*field.GROUND, 255))
    can.alpha_composite(body, (10, 6))
    return can


def board(opt, name, cols, note, art):
    atl = {u: field.Atlas(art / "units" / u / f"{u}.json") for u in ("spear_e", "xbow_e", "pike_w", "mage_w")}
    batl = field.Atlas(art / "buildings" / "buildings_E.json")
    pairs, vs = measure(cols)
    label = f"R6-24-玩家色-{opt}-{name}-mobile"
    M, W = 50, 1760
    tiles = unit_tile(atl, cols + [NEUTRAL])
    rows_h = sum(t[2].height + 40 for t in tiles)
    H = 300 + rows_h + 360
    art_ = Image.new("RGB", (W, H), (244, 241, 234))
    dr = ImageDraw.Draw(art_)
    dr.text((M, 34), label, font=font(54), fill=(40, 40, 40))
    dr.text((M, 116), f"選項 {opt}「{name}」：{note}", font=font(24), fill=(96, 96, 96))
    dr.text((M, 156), "每一列同一種顏色：士兵（玩家色層乘上顏色，和遊戲一樣）、血條、兵營、小地圖的點、編隊鈕的色條。最下面一列是中立（城鎮的民兵）。1 pt = 1.5 px。",
            font=font(22), fill=(96, 96, 96))
    y = 210
    for nm, rgb, can in tiles:
        dr.text((M, y + can.height // 2 - 18), f"{nm}  #{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}", font=font(26), fill=(40, 40, 40))
        x = M + 300
        art_.paste(can.convert("RGB"), (x, y))
        x += can.width + 30
        if nm != NEUTRAL[0]:
            b = building_tile(batl, rgb, can.height)
            art_.paste(b.convert("RGB"), (x, y + can.height - b.height))
            x += b.width + 30
        else:
            x += 170
        mm = Image.new("RGB", (120, can.height), (0, 0, 0))
        md = ImageDraw.Draw(mm)
        for i in range(9):
            px, py = 20 + (i % 3) * 30 + (i // 3) * 6, 30 + (i // 3) * 30
            md.ellipse([px - 4, py - 4, px + 4, py + 4], fill=rgb)
        md.rectangle([10, 10, 50, 50], fill=tuple(int(v * 0.9) for v in rgb))
        art_.paste(mm, (x, y))
        x += 150
        g = Image.new("RGB", (90, 90), (60, 44, 30))
        gd = ImageDraw.Draw(g)
        gd.rounded_rectangle([4, 4, 86, 86], 10, fill=(78, 56, 36), outline=(185, 141, 76), width=3)
        gd.rectangle([14, 70, 76, 78], fill=rgb)
        gd.text((34, 18), "1", font=font(36), fill=(244, 231, 201))
        art_.paste(g, (x, y + (can.height - 90) // 2))
        y += can.height + 40
    dr.text((M, y + 10), "色差（CIEDE2000，ΔE00：約 2 剛看得出來，10 以上明顯是另一種顏色；全部用程式算）", font=font(26), fill=(40, 40, 40))
    dr.text((M, y + 56), "玩家色兩兩之間（含中立）最小的三個：" + "、".join(f"{p} {d}" for d, p in pairs[:3]), font=font(24), fill=(60, 60, 60))
    dr.text((M, y + 96), "和保留色（魔晶青、預警橘、血條綠、草地）最小的三個：" + "、".join(f"{p} {d}" for d, p in vs[:3]), font=font(24), fill=(60, 60, 60))
    dr.text((M, y + 136), f"兩兩最小 {pairs[0][0]}（{pairs[0][1]}）；和保留色最小 {vs[0][0]}（{vs[0][1]}）。", font=font(24), fill=(160, 40, 30))
    art_ = art_.crop((0, 0, W, y + 200))
    OUT.mkdir(exist_ok=True)
    p = OUT / f"{label}.png"
    art_.save(p, optimize=True)
    print("wrote", p.name, art_.size, "min pair", pairs[0], "min reserved", vs[0])
    return dict(option=opt, name=name, colours={n: "#%02x%02x%02x" % c for n, c in cols}, pairs=pairs, reserved=vs)


def overview(art, res):
    """The three palettes, one row each: the soldiers at actual size (1 pt = 1 px) and 2x, and the smallest ΔE00."""
    atl = {u: field.Atlas(art / "units" / u / f"{u}.json") for u in ("spear_e", "xbow_e", "pike_w", "mage_w")}
    M, W = 50, 1400
    rows = []
    for (opt, name, cols, _), r in zip(PALETTES, res):
        big = unit_tile(atl, cols + [NEUTRAL], 2.0)
        small = unit_tile(atl, cols + [NEUTRAL], 1.0)
        rows.append((opt, name, big, small, r))
    H = 170 + sum(max(b[2].height for b in big) + 100 for _, _, big, _, _ in rows) + 40
    img = Image.new("RGB", (W, H), (244, 241, 234))
    dr = ImageDraw.Draw(img)
    dr.text((M, 34), "R6-24-玩家色-總覽", font=font(54), fill=(40, 40, 40))
    dr.text((M, 112), "三組玩家色（四個玩家加中立），同一名槍兵：左邊放大 2 倍，右邊實際大小。紅字是用程式算的最小色差（ΔE00）。",
            font=font(22), fill=(96, 96, 96))
    y = 170
    for opt, name, big, small, r in rows:
        dr.text((M, y), f"{opt}「{name}」", font=font(30), fill=(40, 40, 40))
        x = M
        yy = y + 50
        for nm, rgb, can in big:
            cell = can.crop((0, 0, can.width // 4, can.height))       # the spearman only
            img.paste(cell.convert("RGB"), (x, yy))
            dr.text((x + 4, yy + 4), nm, font=font(18), fill=(250, 248, 240))
            x += cell.width + 6
        x += 30
        dr.text((x, yy + big[0][2].height + 4), "實際大小", font=font(18), fill=(96, 96, 96))
        for nm, rgb, can in small:
            cell = can.crop((0, 0, can.width // 4, can.height))
            img.paste(cell.convert("RGB"), (x, yy + big[0][2].height - cell.height))
            x += cell.width + 4
        dr.text((M + 360, y + 4), f"兩兩最小 {r['pairs'][0][0]}（{r['pairs'][0][1]}）；保留色最小 {r['reserved'][0][0]}（{r['reserved'][0][1]}）",
                font=font(22), fill=(160, 40, 30))
        y = yy + big[0][2].height + 44
    img = img.crop((0, 0, W, y + 20))
    p = OUT / "R6-24-玩家色-總覽.png"
    img.save(p, optimize=True)
    print("wrote", p.name, img.size)


if __name__ == "__main__":
    art = Path(sys.argv[1])
    BUILD.mkdir(exist_ok=True)
    res = [board(o, n, c, note, art) for o, n, c, note in PALETTES]
    (BUILD / "colours.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
    overview(art, res)
