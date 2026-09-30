"""R3 artboards: R3-01 術士造型 (0/A/B/C), R3-02 騎兵的腿, motion GIF, overview.

python3 common/r3art.py
Inputs: build/r3/<target>/ (CI artifacts via common/fetch_ci.py) and the R2 level-C
renders in design/round2/build/r2/C/ for the units that did not change.
"""
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(1, str(HERE.parents[1] / "round2" / "common"))
sys.path.insert(2, str(HERE.parents[1] / "round1" / "common"))

import numpy as np                            # noqa: E402
from PIL import Image, ImageDraw, ImageFilter  # noqa: E402

import artboard   # noqa: E402
import compose    # noqa: E402
import config     # noqa: E402
import r2art      # noqa: E402

R3 = config.BUILD / "r3"
R2C = config.ROUND.parent / "round2" / "build" / "r2" / "C"
OUT = config.OUT
INK, GREY, GREEN, RED = artboard.INK, artboard.GREY, artboard.GREEN, artboard.RED
BG = (244, 241, 234)

OPTIONS = {
    "0": dict(dir="mage0", name="現況", sub="選項 0：R2 選定的 C 級術士（白袍、頭冠、頭頂浮空魔晶），當對照",
              lines=[("使用者表示不喜歡這個風格。", "n")], west="—"),
    "A": dict(dir="mageA", name="軍裝術士",
              sub="選項 A：像軍官。圓領軍袍、腰間一排魔晶匣、兩翼平伸的官帽、玩家色短披肩、法印套在皮護腕上",
              lines=[("實際大小下最好認：藍色披肩加黑色官帽，混在隊伍裡一眼找得到。", "g"),
                     ("最像「正規軍的精英」。", "g"),
                     ("官帽的兩翼在實際大小下只剩一條細線，要放大才看得出是帽翼。", "n")],
              west="西陸版：立領軍官外套、寬邊羽飾軍帽、魔晶彈匣腰帶，晶杖像長槍一樣持握。"),
    "B": dict(dir="mageB", name="制式秘術兵",
              sub="選項 B：軍隊的秘術兵。灰色制式長大衣＋兜帽肩斗篷、斜背皮帶與銅徽章、玩家色臂章與肩章、臉藏在陰影裡只露青光眼",
              lines=[("同一隊的術士外型一致；兜帽和肩斗篷是剪影重點；放大後最有「秘術兵」的氣氛。", "g"),
                     ("實際大小下灰色大衣和防護罩的顏色接近，混在一起；臂章和肩章太小，幾乎看不到敵我顏色。", "r")],
              west="西陸版：同一套制式大衣，兜帽改成尖兜帽加短披肩，法器換成晶杖，臂章規則相同。"),
    "C": dict(dir="mageC", name="符籙術士",
              sub="選項 C：東方味最重。黑衣外罩一層層發青光的符紙、垂紗寬邊帽、法印拿在手上",
              lines=[("寬邊帽是實際大小下最清楚的剪影。", "g"),
                     ("實際大小下符紙變成下半身一片淺色斑點，看不出是符紙；垂紗看不見。要放大才看得出符籙的樣子。", "r")],
              west="西陸版：符紙換成刻著符文的晶片與羊皮紙卷，寬邊帽換成尖頂旅行帽，晶杖。"),
}


def sprite(d, name, scale, fx=True, team=None):
    """B-look sprite from any render folder; fx=False hides the shield layer."""
    key = f"{name}_{scale}"
    b = compose.load(d, key, "beauty")
    img = b.img
    if (d / f"{key}_ao.png").exists():
        ao = np.asarray(Image.open(d / f"{key}_ao.png").convert("L"), np.float32) / 255.0
        a = np.asarray(img, np.float32)
        a[..., :3] *= (0.7 + 0.3 * ao)[..., None]
        img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")
    if (d / f"{key}_mask.png").exists():
        side = "w" if "_w_f" in name else "e"
        img = compose.recolor(img, Image.open(d / f"{key}_mask.png"), r2art.TEAM[side])
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    if (d / f"{key}_shadow.png").exists():
        sh = compose.load_shadow(d, key, color=(26, 30, 48), strength=0.85)
        out.alpha_composite(sh.img.crop((0, 0, img.width, img.height)))
    out.alpha_composite(img)
    if fx and (d / f"{key}_fx.png").exists():
        f = Image.open(d / f"{key}_fx.png").convert("RGBA")
        out.alpha_composite(f.filter(ImageFilter.GaussianBlur(6 if scale == "x3" else 12)))
        out.alpha_composite(f)
    return compose.Sprite(out, b.anchor)


def place_row(items, px_per_pt, h_pt, spacing_pt, pad=10):
    """items: list of Sprite at scale x3 or x6 (with their scale)."""
    w_pt = pad * 2 + spacing_pt * len(items)
    can = r2art.ground(int(w_pt * px_per_pt), int(h_pt * px_per_pt), zoom=px_per_pt / 3)
    for i, (sp, s3) in enumerate(items):
        f = px_per_pt / s3
        im = sp.img.resize((max(1, int(sp.img.width * f)), max(1, int(sp.img.height * f))), Image.LANCZOS)
        x = (pad + spacing_pt * (i + 0.5)) * px_per_pt
        y = (h_pt - 8) * px_per_pt
        can.alpha_composite(im, (int(x - sp.anchor[0] * f), int(y - sp.anchor[1] * f)))
    return can


def vignette(mdir, px_per_pt):
    legs = R3 / "legs"
    layout = [(R2C, "spear_e_f0_attack01", 40, 60), (R2C, "spear_e_f0_attack03", 52, 78),
              (R2C, "spear_e_f0_attack05", 44, 96), (legs, "hcav_e_f0_walk02", 20, 52),
              (mdir, "mage_e_f0_idle03", 16, 100), (legs, "knight_w_f4_walk01", 110, 60),
              (legs, "knight_w_f4_walk05", 122, 88)]
    can = r2art.ground(int(150 * px_per_pt), int(120 * px_per_pt), zoom=px_per_pt / 3)
    for d, n, x, y in sorted(layout, key=lambda t: t[3]):
        sp = sprite(d, n, "x3", fx=True)
        f = px_per_pt / 3
        im = sp.img.resize((max(1, int(sp.img.width * f)), max(1, int(sp.img.height * f))), Image.LANCZOS)
        can.alpha_composite(im, (int(x * px_per_pt - sp.anchor[0] * f), int(y * px_per_pt - sp.anchor[1] * f)))
    return can


def _wrap(d, x, y, text, col, size, width, bold=False):
    return r2art._wrap(d, x, y, text, col, size, width) if not bold else r2art._wrap(d, x, y, text, col, size, width)


def artboard_01(opt):
    o = OPTIONS[opt]
    d = R3 / o["dir"]
    label = f"R3-01-術士造型-{opt}-{o['name']}-mobile"
    idle7, idle0, idle5, cast7 = "mage_e_f7_idle03", "mage_e_f0_idle03", "mage_e_f5_idle03", "mage_e_f7_cast20"
    r1 = [vignette(d, 1), place_row([(sprite(d, idle7, "x3", fx=False), 3)], 1, 60, 50)]
    r2 = [place_row([(sprite(d, idle7, "x3", fx=False), 3), (sprite(d, idle0, "x3", fx=False), 3),
                     (sprite(d, cast7, "x3"), 3)], 3, 62, 56)]
    r3 = [place_row([(sprite(d, idle7, "x6", fx=False), 6), (sprite(d, idle5, "x6", fx=False), 6),
                     (sprite(d, cast7, "x6"), 6)], 6, 66, 60)]
    M = 70
    W = max(sum(i.width for i in r) + 30 * (len(r) - 1) for r in (r1, r2, r3)) + 2 * M + 820
    heads = ["實際大小：1 pt = 1 px（左：混在隊伍裡；右：單獨）",
             "手機像素：1 pt = 3 px（右前、側面、晶砲施法；前兩張把防護罩拿掉看造型）",
             "雙指放大 2 倍：6 倍素材（右前、左前、晶砲施法）"]
    H = 210 + sum(max(i.height for i in r) + 90 for r in (r1, r2, r3)) + 40
    art = Image.new("RGB", (W, H), BG)
    dr = ImageDraw.Draw(art)
    dr.text((M, 40), label, font=artboard.font(56), fill=INK)
    r2art._wrap(dr, M, 118, o["sub"], GREY, 28, W - 2 * M - 820)
    y = 210
    for head, row in zip(heads, (r1, r2, r3)):
        dr.text((M, y), head, font=artboard.font(28), fill=INK)
        y += 50
        x = M
        for im in row:
            art.paste(im.convert("RGB"), (x, y))
            x += im.width + 30
        y += max(i.height for i in row) + 40
    x0 = W - 820 + 10
    yy = 210
    dr.text((x0, yy), "評估", font=artboard.font(30), fill=INK)
    yy += 50
    for t, c in o["lines"]:
        yy = r2art._wrap(dr, x0, yy, t, r2art._col(c), 24, 780)
    if o["west"] != "—":
        yy += 20
        dr.text((x0, yy), "西陸版會怎麼延伸（下一輪畫）", font=artboard.font(28), fill=INK)
        yy = r2art._wrap(dr, x0, yy + 46, o["west"], GREY, 24, 780)
    art.save(OUT / f"{label}.png")
    print("wrote", label)
    return label


def _foot_px(sp, facing, scale_px_per_m):
    """Screen position (in the sprite) of the rider's visible foot, for the highlight ring."""
    import math
    best = None
    for side in (1, -1):
        lx, ly, lz = 0.56 * side, 0.02, 0.98          # seated foot in unit-local metres (units3.SEAT)
        a = math.radians(45 * facing - 135)
        X = lx * math.cos(a) - ly * math.sin(a)
        Y = lx * math.sin(a) + ly * math.cos(a)
        k = scale_px_per_m
        px = sp.anchor[0] + k * 0.7071 * (X - Y)
        py = sp.anchor[1] - k * 0.3536 * (X + Y) - k * 0.866 * lz
        toward_camera = -(X + Y)
        if best is None or toward_camera > best[0]:
            best = (toward_camera, px, py)
    return best[1], best[2]


def artboard_02():
    label = "R3-02-騎兵的腿-A-跨坐修正-mobile"
    pairs = [("hcav_e_f7_walk02", 7, "具裝騎兵（右前方）"), ("hcav_e_f0_walk02", 0, "具裝騎兵（側面）"),
             ("knight_w_f5_walk01", 5, "騎士（左前方）"), ("knight_w_f4_walk01", 4, "騎士（側面）")]
    rows = []
    for n, facing, cap in pairs:
        cells = []
        for d, tag in ((R2C, "修前（R2-C）"), (R3 / "legs", "修後")):
            sp = sprite(d, n, "x6")
            tile = r2art.ground(sp.img.width, sp.img.height, zoom=2)
            tile.alpha_composite(sp.img)
            if tag == "修後":
                fx, fy = _foot_px(sp, facing, 120)
                dr = ImageDraw.Draw(tile)
                dr.ellipse((fx - 70, fy - 110, fx + 70, fy + 40), outline=(255, 214, 64, 255), width=6)
            bb = sp.img.getbbox()
            tile = tile.crop((max(0, bb[0] - 30), max(0, bb[1] - 20), min(tile.width, bb[2] + 30),
                              min(tile.height, bb[3] + 30)))
            cells.append((tile, tag))
        rows.append((cap, cells))
    M = 70
    cw = max(t.width for _, cells in rows for t, _ in cells)
    ch = max(t.height for _, cells in rows for t, _ in cells)
    W = 2 * M + 2 * cw + 40
    H = 260 + len(rows) * (ch + 110) + 20
    art = Image.new("RGB", (W, H), BG)
    dr = ImageDraw.Draw(art)
    dr.text((M, 40), label, font=artboard.font(56), fill=INK)
    r2art._wrap(dr, M, 118, "R2 的騎手少了坐姿，腿直直插進馬身裡、完全看不到；改成大腿跨過馬身、小腿垂在馬衣外，加馬鐙。"
                "只有這一種改法。黃圈是修後露出來的腿。（放大 2 倍，6 倍素材）", GREY, 28, W - 2 * M)
    y = 250
    for cap, cells in rows:
        dr.text((M, y), cap, font=artboard.font(30), fill=INK)
        for i, (t, tag) in enumerate(cells):
            x = M + i * (cw + 40)
            dr.text((x, y + 44), tag, font=artboard.font(24, weight="regular"), fill=GREY)
            art.paste(t.convert("RGB"), (x, y + 80))
        y += ch + 110
    art.save(OUT / f"{label}.png")
    print("wrote", label)


def motion_gif():
    label = "R3-99-動作對照"
    cw, ch, M, TOP = 330, 300, 16, 110
    opts = [o for o in ("0", "A", "B", "C") if (R3 / OPTIONS[o]["dir"]).exists()]
    W = M + len(opts) * (cw + 8) + M
    H = TOP + 2 * (ch + 8) + 20
    tmp = Path(tempfile.mkdtemp(prefix="r3gif_", dir=config.BUILD))
    cache = {}
    for i in range(30):
        can = Image.new("RGBA", (W, H), (*BG, 255))
        dr = ImageDraw.Draw(can)
        dr.text((M, 10), label, font=artboard.font(26), fill=INK)
        dr.text((M, 46), "上：走路　下：晶砲（舉法印、校準 1.5 秒、發射）；雙指放大 2 倍（6 倍素材縮到一半），每秒 12 格",
                font=artboard.font(16, weight="regular"), fill=GREY)
        for c, o in enumerate(opts):
            dr.text((M + c * (cw + 8) + 6, 76), f"{o} {OPTIONS[o]['name']}", font=artboard.font(22), fill=INK)
        for r, (anim, n) in enumerate((("walk", 12), ("cast", 30))):
            f = i % n
            for c, o in enumerate(opts):
                k = (o, anim, f)
                if k not in cache:
                    sp = sprite(R3 / OPTIONS[o]["dir"], f"motion_mage_e_f7_{anim}{f:02d}", "x6")
                    im = sp.img.resize((sp.img.width // 2, sp.img.height // 2), Image.LANCZOS)
                    cache[k] = (im, (sp.anchor[0] / 2, sp.anchor[1] / 2))
                im, anc = cache[k]
                cell = r2art.ground(cw, ch, zoom=2).copy()
                cell.alpha_composite(im, (int(cw * 0.35 - anc[0]), int(ch * 0.8 - anc[1])))
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
    opts = ("0", "A", "B", "C")
    cells = []
    for o in opts:
        d = R3 / OPTIONS[o]["dir"]
        z = place_row([(sprite(d, "mage_e_f7_idle03", "x6", fx=False), 6), (sprite(d, "mage_e_f7_cast20", "x6"), 6)],
                      4.5, 66, 56)
        v = vignette(d, 2)
        cells.append((o, z, v))
    cw = max(max(z.width, v.width) for _, z, v in cells)
    M = 70
    W = 2 * M + 4 * cw + 3 * 40
    H = 270 + max(z.height + v.height for _, z, v in cells) + 12 + 420
    art = Image.new("RGB", (W, H), BG)
    dr = ImageDraw.Draw(art)
    dr.text((M, 40), "R3-99-總覽對照", font=artboard.font(64), fill=INK)
    r2art._wrap(dr, M, 126, "第 3 輪：R3-01 術士造型（上排：放大後的造型，左邊待機不含防護罩、右邊晶砲施法；下排：混在隊伍裡）。"
                "R3-02 騎兵的腿見另一張。", GREY, 28, W - 2 * M)
    for i, (o, z, v) in enumerate(cells):
        x = M + i * (cw + 40)
        dr.text((x, 200), f"{o}  {OPTIONS[o]['name']}", font=artboard.font(44), fill=INK)
        art.paste(z.convert("RGB"), (x, 270))
        art.paste(v.convert("RGB"), (x, 270 + z.height + 12))
        yy = 270 + z.height + v.height + 30
        for t, c in OPTIONS[o]["lines"]:
            yy = r2art._wrap(dr, x, yy, t, r2art._col(c), 24, cw)
        if OPTIONS[o]["west"] != "—":
            yy = r2art._wrap(dr, x, yy + 6, OPTIONS[o]["west"], GREY, 22, cw)
        dr.text((x, yy + 10), f"R3-01-術士造型-{o}-{OPTIONS[o]['name']}-mobile.png", font=artboard.font(22), fill=INK)
    art.save(OUT / "R3-99-總覽對照.png")
    print("wrote R3-99-總覽對照")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for o in ("0", "A", "B", "C"):
        if (R3 / OPTIONS[o]["dir"]).exists():
            artboard_01(o)
    artboard_02()
    motion_gif()
    overview()
