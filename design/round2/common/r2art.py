"""R2 artboards: R2-01 模型精緻度 (0/A/B/C), R2-02 放大清晰度, motion GIF, overview.

Inputs are the renders in build/r2/<level>/ (from GitHub Actions or a local run).
python3 common/r2art.py [01] [02] [gif] [overview]
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(1, str(HERE.parents[1] / "round1" / "common"))

import numpy as np                            # noqa: E402
from PIL import Image, ImageDraw, ImageFilter  # noqa: E402

import artboard   # noqa: E402  (R1 fonts and colours)
import compose    # noqa: E402
import config     # noqa: E402
import r2data     # noqa: E402

R2 = config.BUILD / "r2"
OUT = config.OUT
INK, GREY, GREEN, RED = artboard.INK, artboard.GREY, artboard.GREEN, artboard.RED
BG = (244, 241, 234)
GROUND = config.ROUND1 / "build" / "b" / "ground.png"
TEAM = {"e": config.TEAM["blue"], "w": config.TEAM["red"]}


def sprite(level, name, scale):
    """Final B-look sprite: AO-deepened, player colour, shadow and effects composed."""
    d = R2 / level
    key = f"{name}_{scale}"
    b = compose.load(d, key, "beauty")
    img = b.img
    if (d / f"{key}_ao.png").exists():
        ao = np.asarray(Image.open(d / f"{key}_ao.png").convert("L"), np.float32) / 255.0
        a = np.asarray(img, np.float32)
        a[..., :3] *= (0.7 + 0.3 * ao)[..., None]
        img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")
    if (d / f"{key}_mask.png").exists():
        side = "w" if "_w_f" in name else "e"          # West kinds end in _w, East in _e
        img = compose.recolor(img, Image.open(d / f"{key}_mask.png"), TEAM[side])
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    if (d / f"{key}_shadow.png").exists():
        sh = compose.load_shadow(d, key, color=(26, 30, 48), strength=0.85)
        out.alpha_composite(sh.img.crop((0, 0, img.width, img.height)))
    out.alpha_composite(img)
    if (d / f"{key}_fx.png").exists():
        fx = Image.open(d / f"{key}_fx.png").convert("RGBA")
        glow = fx.filter(ImageFilter.GaussianBlur(6 if scale == "x3" else 12))
        out.alpha_composite(glow)
        out.alpha_composite(fx)
    return compose.Sprite(out, b.anchor)


def ground(w, h, zoom=1.0):
    g = Image.open(GROUND).convert("RGBA")
    g = g.crop((1300, 700, 2700, 1290))
    if zoom != 1.0:
        g = g.resize((int(g.width * zoom), int(g.height * zoom)), Image.LANCZOS)
    k = max(w / g.width, h / g.height)
    g = g.resize((int(g.width * k) + 1, int(g.height * k) + 1), Image.LANCZOS)
    return g.crop((0, 0, w, h))


def stage(level, names, scale, px_per_pt, spacing_pt, h_pt, pad_pt=10):
    """Units standing in a row on the ground, displayed at px_per_pt pixels per point."""
    s3 = {"x3": 3, "x6": 6}[scale]
    f = px_per_pt / s3
    sprites = [sprite(level, n, scale) for n in names]
    w_pt = pad_pt * 2 + spacing_pt * len(names)
    can = ground(int(w_pt * px_per_pt), int(h_pt * px_per_pt), zoom=px_per_pt / 3)
    for i, sp in enumerate(sprites):
        im = sp.img
        if f != 1:
            im = im.resize((max(1, int(im.width * f)), max(1, int(im.height * f))), Image.LANCZOS)
        ax, ay = sp.anchor[0] * f, sp.anchor[1] * f
        x = (pad_pt + spacing_pt * (i + 0.5)) * px_per_pt
        y = (h_pt - 8) * px_per_pt
        can.alpha_composite(im, (int(x - ax), int(y - ay)))
    return can


def vignette(level, px_per_pt):
    """A small battle line (East left, West right) at the given display scale."""
    layout = [("spear_e_f0_attack01", 40, 60), ("spear_e_f0_attack03", 52, 78), ("spear_e_f0_attack05", 44, 96),
              ("hcav_e_f0_walk02", 20, 52), ("mage_e_f0_idle03", 14, 98),
              ("knight_w_f4_walk01", 110, 60), ("knight_w_f4_walk05", 122, 88)]
    w_pt, h_pt = 150, 120
    can = ground(int(w_pt * px_per_pt), int(h_pt * px_per_pt), zoom=px_per_pt / 3)
    for n, x, y in sorted(layout, key=lambda t: t[2]):
        sp = sprite(level, n, "x3")
        f = px_per_pt / 3
        im = sp.img.resize((max(1, int(sp.img.width * f)), max(1, int(sp.img.height * f))), Image.LANCZOS)
        can.alpha_composite(im, (int(x * px_per_pt - sp.anchor[0] * f), int(y * px_per_pt - sp.anchor[1] * f)))
    return can


def building(level, which, scale, px_per_pt):
    d = R2 / level
    key = f"{which}_{scale}"
    b = compose.load(d, key, "beauty")
    img = b.img
    if (d / f"{key}_ao.png").exists():
        ao = np.asarray(Image.open(d / f"{key}_ao.png").convert("L"), np.float32) / 255.0
        a = np.asarray(img, np.float32)
        a[..., :3] *= (0.7 + 0.3 * ao)[..., None]
        img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")
    if (d / f"{key}_mask.png").exists():
        team = TEAM["e"] if which.startswith("citygate") else TEAM["w"]
        img = compose.recolor(img, Image.open(d / f"{key}_mask.png"), team)
    s3 = {"x3": 3, "x6": 6}[scale]
    f = px_per_pt / s3
    if f != 1:
        img = img.resize((max(1, int(img.width * f)), max(1, int(img.height * f))), Image.LANCZOS)
    can = ground(img.width + 20, img.height + 20, zoom=px_per_pt / 3)
    can.alpha_composite(img, (10, 10))
    return can


DETAIL = ["spear_e_f7_attack00", "hcav_e_f7_walk02", "mage_e_f7_idle03", "knight_w_f5_walk01"]


def artboard_01(level):
    info = r2data.OPTIONS_01[level]
    label = f"R2-01-模型精緻度-{level}-{info['name']}-mobile"
    rows = []
    # row 1: at actual size (1 pt = 1 px)
    r1 = [vignette(level, 1), stage(level, DETAIL, "x3", 1, 60, 60), building(level, "citygate_e_full", "x3", 1),
          building(level, "tower_w_full", "x3", 1)]
    # row 2: phone pixels (1 pt = 3 px)
    r2 = [stage(level, DETAIL, "x3", 3, 58, 62)]
    # row 3: pinch-zoomed 2x (6x sprites)
    r3 = [stage(level, DETAIL, "x6", 6, 56, 64), building(level, "citygate_e_zoom", "x6", 6),
          building(level, "tower_w_zoom", "x6", 6)]
    M = 70
    W = max(sum(i.width for i in r) + 30 * (len(r) - 1) for r in (r1, r2, r3)) + 2 * M + 900
    heads = ["實際大小：1 pt = 1 px（電腦螢幕上約為 iPhone 實物的 1.5 倍）",
             "手機像素：1 pt = 3 px（放大看實際大小時手機上到底有哪些像素）",
             "雙指放大 2 倍：用 6 倍素材（1 pt = 6 px）"]
    H = 200 + sum(max(i.height for i in r) + 90 for r in (r1, r2, r3)) + 60
    art = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(art)
    d.text((M, 40), label, font=artboard.font(56), fill=INK)
    d.text((M, 118), info["sub"], font=artboard.font(30, weight="regular"), fill=GREY)
    y = 200
    for head, row in zip(heads, (r1, r2, r3)):
        d.text((M, y), head, font=artboard.font(28), fill=INK)
        y += 50
        x = M
        for im in row:
            art.paste(im.convert("RGB"), (x, y))
            x += im.width + 30
        y += max(i.height for i in row) + 40
    # notes and costs on the right
    x0 = W - 900 + 20
    yy = 200
    d.text((x0, yy), "這個選項改了什麼", font=artboard.font(30), fill=INK)
    yy += 50
    for t, c in info["changes"]:
        yy = _wrap(d, x0, yy, t, _col(c), 24, 820)
    yy += 30
    d.text((x0, yy), "成本（完整量產，估計）", font=artboard.font(30), fill=INK)
    yy += 50
    for k, v in r2data.costs(level):
        d.text((x0, yy), k, font=artboard.font(24), fill=INK)
        yy = _wrap(d, x0 + 250, yy, v, GREY, 24, 560)
    art.save(OUT / f"{label}.png")
    print("wrote", label)
    return label


def _col(c):
    return {"g": GREEN, "r": RED, "n": GREY}[c]


def _wrap(d, x, y, text, col, size, width):
    f = artboard.font(size, weight="regular")
    line = ""
    for ch in text:
        if d.textlength(line + ch, font=f) > width:
            d.text((x, y), line, font=f, fill=col)
            y += size + 12
            line = ch
        else:
            line += ch
    if line:
        d.text((x, y), line, font=f, fill=col)
        y += size + 12
    return y + 6


def artboard_02(opt, level="C"):
    """Same zoomed view (2x pinch, shown at 1 pt = 6 px) from 3x / 4.5x / 6x sprites."""
    info = r2data.OPTIONS_02[opt]
    label = f"R2-02-放大清晰度-{opt}-{info['name']}-mobile"
    names = ["spear_e_f7_attack00", "knight_w_f5_walk01"]
    tiles = []
    for n in names:
        sp = sprite(level, n, "x6")
        img = sp.img.crop(sp.img.getbbox())
        if info["scale"] != 6:
            k = info["scale"] / 6
            small = img.resize((max(1, int(img.width * k)), max(1, int(img.height * k))), Image.LANCZOS)
            img = small.resize(img.size, Image.BILINEAR)      # what the GPU does when zooming in
        tile = ground(img.width + 40, img.height + 40, zoom=2)
        tile.alpha_composite(img, (20, 20))
        tiles.append(tile)
    M = 70
    W = sum(t.width for t in tiles) + 40 * (len(tiles) - 1) + 2 * M + 700
    H = 260 + max(t.height for t in tiles) + 80
    art = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(art)
    d.text((M, 40), label, font=artboard.font(56), fill=INK)
    d.text((M, 118), info["sub"], font=artboard.font(30, weight="regular"), fill=GREY)
    d.text((M, 190), "雙指放大 2 倍時手機上的樣子（1 pt = 6 px）；模型用選項 C", font=artboard.font(28), fill=INK)
    x = M
    for t in tiles:
        art.paste(t.convert("RGB"), (x, 250))
        x += t.width + 40
    u, m, b, tot = r2data.memory_at(info["scale"])
    x0 = W - 700 + 20
    d.text((x0, 250), "手機貼圖記憶體（完整量產、未壓縮 RGBA8）", font=artboard.font(28), fill=INK)
    yy = 310
    for k, v in (("兵種", u), ("玩家色遮罩", m), ("建築與城鎮", b)):
        d.text((x0, yy), f"{k}：約 {v:.0f} MB", font=artboard.font(26, weight="regular"), fill=GREY)
        yy += 44
    col = GREY if tot < 400 else RED        # uncompressed totals are notes, not a pass
    d.text((x0, yy + 10), f"合計：約 {tot:.0f} MB", font=artboard.font(32), fill=col)
    d.text((x0, yy + 70), "壓縮貼圖能省多少，第二階段由 core 實測。", font=artboard.font(24, weight="regular"),
           fill=GREY)
    art.save(OUT / f"{label}.png")
    print("wrote", label)
    return label


def motion_gif():
    """0 / A / B / C side by side: spearman walk, knight gallop, mage walk (2x zoom, 12 fps)."""
    rows = [("spear_e", 7, "walk", 8), ("knight_w", 5, "walk", 8), ("mage_e", 7, "walk", 12)]
    levels = [lv for lv in ("0", "A", "B", "C") if (R2 / lv).exists()]
    cw, ch = 330, 290
    M, TOP = 16, 110
    W = M + len(levels) * (cw + 8) + M
    H = TOP + len(rows) * (ch + 8) + 20
    tmp = Path(tempfile.mkdtemp(prefix="r2gif_", dir=config.BUILD))
    names = {"0": "0 現況", "A": "A 算圖升級", "B": "B 造型升級", "C": "C 細節升級"}
    label = "R2-99-動作對照"
    cache = {}
    for i in range(24):
        can = Image.new("RGBA", (W, H), (*BG, 255))
        d = ImageDraw.Draw(can)
        d.text((M, 10), label, font=artboard.font(26), fill=INK)
        d.text((M, 46), "槍兵走路／騎士奔馳／術士走路，雙指放大 2 倍（6 倍素材縮到一半顯示），每秒 12 格",
               font=artboard.font(16, weight="regular"), fill=GREY)
        for c, lv in enumerate(levels):
            d.text((M + c * (cw + 8) + 6, 76), names[lv], font=artboard.font(22), fill=INK)
        for r, (kind, facing, anim, n) in enumerate(rows):
            f = i % n
            for c, lv in enumerate(levels):
                key = (lv, kind, f)
                if key not in cache:
                    sp = sprite(lv, f"motion_{kind}_f{facing}_{anim}{f:02d}", "x6")
                    im = sp.img.resize((sp.img.width // 2, sp.img.height // 2), Image.LANCZOS)
                    cache[key] = (im, (sp.anchor[0] / 2, sp.anchor[1] / 2))
                im, anc = cache[key]
                cell = ground(cw, ch, zoom=2).copy()
                cell.alpha_composite(im, (int(cw * 0.5 - anc[0]), int(ch * 0.82 - anc[1])))
                can.alpha_composite(cell, (M + c * (cw + 8), TOP + r * (ch + 8)))
        can.convert("RGB").save(tmp / f"{i:03d}.png")
    out = OUT / f"{label}.gif"
    pal = tmp / "pal.png"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", "12", "-i", str(tmp / "%03d.png"), "-vf",
                    "palettegen=stats_mode=full", str(pal)], check=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", "12", "-i", str(tmp / "%03d.png"), "-i",
                    str(pal), "-lavfi", "paletteuse=dither=sierra2_4a", "-loop", "0", str(out)], check=True)
    for p in tmp.iterdir():
        p.unlink()
    tmp.rmdir()
    print("wrote", label)


def overview():
    labels = [f"R2-01-模型精緻度-{lv}-{r2data.OPTIONS_01[lv]['name']}-mobile" for lv in ("0", "A", "B", "C")]
    cells = []
    for lv, lab in zip(("0", "A", "B", "C"), labels):
        v = vignette(lv, 3)
        z = stage(lv, DETAIL[:3], "x6", 3, 60, 70)
        cells.append((lv, lab, v, z))
    cw = max(max(v.width, z.width) for _, _, v, z in cells)
    M = 70
    W = 2 * M + 4 * cw + 3 * 40
    ch = max(v.height + z.height for _, _, v, z in cells) + 260
    H = 220 + ch + 520
    art = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(art)
    d.text((M, 40), "R2-99-總覽對照", font=artboard.font(64), fill=INK)
    d.text((M, 126), "第 2 輪 模型精緻度：上排是手機實際像素（1 pt = 3 px），下排是雙指放大 2 倍的樣子（縮成一半顯示）。"
                     "綠字＝通過，紅字＝問題，灰字＝備註。", font=artboard.font(28, weight="regular"), fill=GREY)
    for i, (lv, lab, v, z) in enumerate(cells):
        x = M + i * (cw + 40)
        d.text((x, 200), f"{lv}  {r2data.OPTIONS_01[lv]['name']}", font=artboard.font(44), fill=INK)
        art.paste(v.convert("RGB"), (x, 270))
        art.paste(z.convert("RGB"), (x, 270 + v.height + 10))
        yy = 270 + v.height + z.height + 30
        for t, c in r2data.OPTIONS_01[lv]["changes"][:3]:
            yy = _wrap(d, x, yy, t, _col(c), 24, cw)
        costs = dict(r2data.costs(lv))
        yy = _wrap(d, x, yy + 6, "每兵種：" + costs["每個兵種"], GREY, 22, cw)
        yy = _wrap(d, x, yy, "全套算圖：" + costs["全套算圖"], GREY, 22, cw)
        d.text((x, yy + 10), lab + ".png", font=artboard.font(22), fill=INK)
    d.text((M, H - 170), "R2-02 放大清晰度（和模型精緻度分開選）：3 倍素材（現在）／4.5 倍／6 倍；記憶體分別約 "
           + "／".join(f"{r2data.memory_at(s)[3]:.0f}" for s in (3, 4.5, 6)) + " MB（完整量產、未壓縮 RGBA8）。",
           font=artboard.font(28, weight="regular"), fill=GREY)
    d.text((M, H - 110), "動作的差別請看 R2-99-動作對照.gif。", font=artboard.font(28, weight="regular"), fill=GREY)
    art.save(OUT / "R2-99-總覽對照.png")
    print("wrote R2-99-總覽對照")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    parts = set(sys.argv[1:]) or {"01"}
    if "01" in parts:
        for lv in ("0", "A", "B", "C"):
            if (R2 / lv).exists():
                artboard_01(lv)
    if "02" in parts:
        for opt in ("A", "B", "C"):
            artboard_02(opt)
    if "gif" in parts:
        motion_gif()
    if "overview" in parts:
        overview()
