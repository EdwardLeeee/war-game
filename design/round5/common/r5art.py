"""R5 artboards: R5-01 西陸晶術師 0/A/B/C, motion GIF, and the overview with the actual-size
"can you tell them apart" row (the mages next to the longbowman and the pikeman).
Reuses the R3/R4 layout code.

python3 common/r5art.py
Inputs: build/r5/<target>/ (CI artifacts via common/fetch_ci.py), option 0 from
design/round3/build/r3/mage0, the East 劍修 from design/round4/build/r4/mageTB, and the
R2/R3 level-C spearmen, cavalry and knights for the battle-line vignette.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROUND5 = HERE.parent
sys.path.insert(0, str(ROUND5.parent / "round3" / "common"))
import r3art   # noqa: E402  (brings round2/round1 helpers along)
from r3art import Image, ImageDraw, ImageFilter, artboard, compose, r2art, place_row  # noqa: E402

R5 = ROUND5 / "build" / "r5"
OUT = ROUND5 / "out"
DESIGN = ROUND5.parent
R3M0 = DESIGN / "round3" / "build" / "r3" / "mage0"
LEGS = DESIGN / "round3" / "build" / "r3" / "legs"
R2C = DESIGN / "round2" / "build" / "r2" / "C"
EAST_MAGE = DESIGN / "round4" / "build" / "r4" / "mageTB"
INK, GREY = artboard.INK, artboard.GREY
BG = (244, 241, 234)
PPM_X3 = 60                      # x3 sprites: 60 px per metre on the ground = 3 px per pt
COS30 = 0.8660254

OPTIONS = {
    "0": dict(dir=R3M0, kind="mage_e", name="現況",
              sub="選項 0：目前遊戲裡的術士（R2 的 C 級白袍術士）。西陸還沒有自己的模型，兩邊共用這一個；當對照",
              lines=[("東陸已經改用劍修（D-019），西陸需要自己的晶術師。", "n"),
                     ("白袍在實際大小下很醒目，但換色區只有袍子下緣一小圈，敵我不好分。", "r")]),
    "A": dict(dir=R5 / "mageWA", kind="mage_w", name="晶劍士",
              sub="選項 A：年輕的晶劍士，和東陸劍修成對。及膝皮外套、淺色襯衫、玩家色大披肩和腰帶；"
                  "背著晶刃長劍（劍柄在左肩），手上是一人高、頂端嵌發光晶刃的長杖",
              lines=[("和東陸劍修成對：一樣年輕、背一把長劍；劍修用劍指施法，晶劍士用晶刃杖。", "g"),
                     ("實際大小下玩家色面積最大（整片肩披風），敵我最好分。", "g"),
                     ("但紅色肩披風加直立長杖，在實際大小下和長弓兵、長矛兵的紅色外衣有點像；"
                      "要靠頭頂發光的晶刃、沒戴帽子和棕色長外套分辨，三款裡最容易混。", "r"),
                     ("背上的劍在實際大小下只剩一條細線，要放大才看得出來。", "n")]),
    "B": dict(dir=R5 / "mageWB", kind="mage_w", name="學院大師",
              sub="選項 B：晶術學院的年長大師。深色學院長袍配米白寬袖口、玩家色披肩、米白聖帶、灰長鬚、軟圓帽"
                  "（不戴兜帽，兜帽留給長弓兵）、腰間書本；多節木杖頂端抱著一簇晶石",
              lines=[("深色長袍拖到腳，是三款裡剪影最特別的：實際大小下一眼就和穿及膝外衣的長弓兵、長矛兵分開。", "g"),
                     ("玩家色披肩在胸口和肩上，實際大小下是清楚的色塊。", "g"),
                     ("杖頭晶石是三款裡最小的，主要靠光暈看出來。", "n"),
                     ("深色長袍遠看和東陸槍兵的深色甲接近；靠杖頭的光和玩家色披肩分辨。", "n")]),
    "C": dict(dir=R5 / "mageWC", kind="mage_w", name="女晶術師",
              sub="選項 C：女晶術師。辮子盤成髮冠、石板灰長裙、寬袖，玩家色披肩在胸前交叉；"
                  "細長淺色木杖頂端是晶球，外圍繞三片小晶片",
              lines=[("灰色長裙到腳，剪影和長弓兵、長矛兵的及膝外衣不同；晶球加三片小晶片在實際大小下是一團亮點。", "g"),
                     ("玩家色披肩在胸前交叉，實際大小下是清楚的色塊。", "g"),
                     ("灰裙和防護罩的淡青色接近，施法開罩時人會變淡；玩家色在身前，敵我還分得出。", "n")]),
}
COMPARE_NOTE = "長弓兵、長矛兵暫用 R1 模型（只比外形）；C 精緻度版在 R5-02 兵種總表再比一次。"


def crystal_mask(img, d=None, key=None):
    """Pixels of the glowing staff crystal in a beauty render.
    The emissive crystal renders almost white with a cool tint (blue and green above red); cloth,
    skin, wood and the untinted player-colour parts are warm or neutral. Option 0's white robe has
    cool highlights too, so with the render's metadata only the part above the head counts
    (every staff head, and option 0's floating crystal, is up there)."""
    a = np.asarray(img, np.int16)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    m = (al > 128) & (r >= 185) & (g - r >= 10) & (b - r >= 10) & (r + g + b >= 640)
    if d is not None and (Path(d) / f"{key}.json").exists():
        meta = json.loads((Path(d) / f"{key}.json").read_text())
        ppm = meta["px_per_m"]
        head_top = meta["anchor"][1] - meta["body_top_m"] * COS30 * ppm
        m[max(0, int(head_top + 0.06 * ppm)):] = False
    return m


def sprite(d, name, scale, fx=True, team="w", glow=True):
    """B-look sprite (AO, player colour, shadow, effects) plus a soft glow round the staff crystal."""
    key = f"{name}_{scale}"
    b = compose.load(d, key, "beauty")
    img = b.img
    crystal = crystal_mask(img, d, key) if glow else None
    if (d / f"{key}_ao.png").exists():
        ao = np.asarray(Image.open(d / f"{key}_ao.png").convert("L"), np.float32) / 255.0
        a = np.asarray(img, np.float32)
        a[..., :3] *= (0.7 + 0.3 * ao)[..., None]
        img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")
    if (d / f"{key}_mask.png").exists():
        img = compose.recolor(img, Image.open(d / f"{key}_mask.png"), r2art.TEAM[team])
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    if (d / f"{key}_shadow.png").exists():
        sh = compose.load_shadow(d, key, color=(26, 30, 48), strength=0.85)
        out.alpha_composite(sh.img.crop((0, 0, img.width, img.height)))
    out.alpha_composite(img)
    if glow and crystal.any():
        layer = np.zeros((img.height, img.width, 4), np.uint8)
        layer[crystal] = (120, 235, 255, 255)
        halo = Image.fromarray(layer, "RGBA").filter(ImageFilter.GaussianBlur(3 if scale == "x3" else 6))
        h = np.asarray(halo, np.float32)
        h[..., 3] = np.clip(h[..., 3] * 1.8, 0, 200)
        out.alpha_composite(Image.fromarray(h.astype(np.uint8), "RGBA"))
        core = np.zeros_like(layer)
        core[crystal] = np.asarray(img)[crystal]
        out.alpha_composite(Image.fromarray(core, "RGBA"))
    if fx and (d / f"{key}_fx.png").exists():
        f = Image.open(d / f"{key}_fx.png").convert("RGBA")
        out.alpha_composite(f.filter(ImageFilter.GaussianBlur(6 if scale == "x3" else 12)))
        out.alpha_composite(f)
    return compose.Sprite(out, b.anchor)


def staff_numbers(opt):
    """Measured at actual size (1 pt = 1 px) from the x3 idle render: crystal size and how far
    its top rises above the head."""
    o = OPTIONS[opt]
    d = Path(o["dir"])
    key = f"{o['kind']}_f7_idle03_x3"
    b = compose.load(d, key, "beauty")
    m = crystal_mask(b.img, d, key)
    ys, xs = np.nonzero(m)
    if len(ys) == 0:
        return None
    meta = json.loads((d / f"{key}.json").read_text())
    head_top = b.anchor[1] - meta["body_top_m"] * COS30 * PPM_X3
    return dict(w=(xs.max() - xs.min() + 1) / 3, h=(ys.max() - ys.min() + 1) / 3,
                above=(head_top - ys.min()) / 3, px=int(m.sum()))


def vignette(opt, px_per_pt):
    """A small battle line: East (blue) on the left with the 劍修, West (red) on the right with this mage."""
    o = OPTIONS[opt]
    d, kind = Path(o["dir"]), o["kind"]
    layout = [(R2C, "spear_e_f0_attack01", 40, 60, "e"), (R2C, "spear_e_f0_attack03", 52, 78, "e"),
              (R2C, "spear_e_f0_attack05", 44, 96, "e"), (LEGS, "hcav_e_f0_walk02", 20, 52, "e"),
              (EAST_MAGE, "mage_e_f0_idle03", 16, 100, "e"),
              (LEGS, "knight_w_f4_walk01", 110, 56, "w"), (LEGS, "knight_w_f4_walk05", 124, 80, "w"),
              (d, f"{kind}_f5_idle03", 132, 106, "w")]
    can = r2art.ground(int(150 * px_per_pt), int(120 * px_per_pt), zoom=px_per_pt / 3)
    for dd, n, x, y, team in sorted(layout, key=lambda t: t[3]):
        sp = sprite(dd, n, "x3", fx=True, team=team)
        f = px_per_pt / 3
        im = sp.img.resize((max(1, int(sp.img.width * f)), max(1, int(sp.img.height * f))), Image.LANCZOS)
        can.alpha_composite(im, (int(x * px_per_pt - sp.anchor[0] * f), int(y * px_per_pt - sp.anchor[1] * f)))
    return can


def artboard_01(opt):
    o = OPTIONS[opt]
    d, k = Path(o["dir"]), o["kind"]
    label = f"R5-01-西陸晶術師-{opt}-{o['name']}-mobile"
    idle7, idle0, idle5, cast7 = f"{k}_f7_idle03", f"{k}_f0_idle03", f"{k}_f5_idle03", f"{k}_f7_cast20"
    r1 = [vignette(opt, 1), place_row([(sprite(d, idle7, "x3", fx=False), 3),
                                       (sprite(d, idle7, "x3", fx=False, team="e"), 3)], 1, 60, 40)]
    r2 = [place_row([(sprite(d, idle7, "x3", fx=False), 3), (sprite(d, idle0, "x3", fx=False), 3),
                     (sprite(d, cast7, "x3"), 3)], 3, 62, 56)]
    r3 = [place_row([(sprite(d, idle7, "x6", fx=False), 6), (sprite(d, idle5, "x6", fx=False), 6),
                     (sprite(d, cast7, "x6"), 6)], 6, 66, 60)]
    M = 70
    W = max(sum(i.width for i in r) + 30 * (len(r) - 1) for r in (r1, r2, r3)) + 2 * M + 820
    heads = ["實際大小：1 pt = 1 px（左：混在隊伍裡，西陸在右邊；右：單獨，紅隊與藍隊）",
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
    s = staff_numbers(opt)
    if s:
        yy += 14
        dr.text((x0, yy), "量測（實際大小，1 pt = 1 px）", font=artboard.font(26), fill=INK)
        what = "頭頂的浮空魔晶" if opt == "0" else "杖頭的發光晶石"
        yy = r2art._wrap(dr, x0, yy + 44, f"{what}約 {s['w']:.0f} × {s['h']:.0f} pt，頂端高出頭頂約 {s['above']:.0f} pt"
                         "（沒算外圍光暈）。杖身約 1 pt 粗。" if opt != "0" else
                         f"{what}約 {s['w']:.0f} × {s['h']:.0f} pt，頂端高出頭頂約 {s['above']:.0f} pt。", GREY, 24, 780)
    art.save(OUT / f"{label}.png")
    print("wrote", label)


def motion_gif():
    label = "R5-99-動作對照"
    cw, ch, M, TOP = 330, 300, 16, 110
    opts = ("0", "A", "B", "C")
    W = M + len(opts) * (cw + 8) + M
    H = TOP + 2 * (ch + 8) + 20
    tmp = Path(tempfile.mkdtemp(prefix="r5gif_", dir=ROUND5 / "build"))
    cache = {}
    for i in range(30):
        can = Image.new("RGBA", (W, H), (*BG, 255))
        dr = ImageDraw.Draw(can)
        dr.text((M, 10), label, font=artboard.font(26), fill=INK)
        dr.text((M, 46), "上：走路　下：晶砲（舉杖、校準 1.5 秒、發射）；雙指放大 2 倍（6 倍素材縮到一半），每秒 12 格",
                font=artboard.font(16, weight="regular"), fill=GREY)
        for c, o in enumerate(opts):
            dr.text((M + c * (cw + 8) + 6, 76), f"{o} {OPTIONS[o]['name']}", font=artboard.font(22), fill=INK)
        for r, (anim, n) in enumerate((("walk", 12), ("cast", 30))):
            f = i % n
            for c, o in enumerate(opts):
                key = (o, anim, f)
                if key not in cache:
                    sp = sprite(Path(OPTIONS[o]["dir"]), f"motion_{OPTIONS[o]['kind']}_f7_{anim}{f:02d}", "x6")
                    im = sp.img.resize((sp.img.width // 2, sp.img.height // 2), Image.LANCZOS)
                    cache[key] = (im, (sp.anchor[0] / 2, sp.anchor[1] / 2))
                im, anc = cache[key]
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


def tell_apart():
    """Longbowman, pikeman and the four mages side by side (red team), at 1x and at phone pixels."""
    cmp_ = R5 / "compare"
    items = [(sprite(cmp_, "bow_w_f7_idle03", "x3", glow=False), 3), (sprite(cmp_, "pike_w_f7_idle03", "x3", glow=False), 3)]
    for o in ("0", "A", "B", "C"):
        items.append((sprite(Path(OPTIONS[o]["dir"]), f"{OPTIONS[o]['kind']}_f7_idle03", "x3", fx=False), 3))
    return place_row(items, 1, 56, 34), place_row(items, 3, 58, 38)


def overview(notes):
    opts = ("0", "A", "B", "C")
    cells = []
    for o in opts:
        d, k = Path(OPTIONS[o]["dir"]), OPTIONS[o]["kind"]
        z = place_row([(sprite(d, f"{k}_f7_idle03", "x6", fx=False), 6), (sprite(d, f"{k}_f7_cast20", "x6"), 6)],
                      4.5, 66, 56)
        cells.append((o, z, vignette(o, 2)))
    cw = max(max(z.width, v.width) for _, z, v in cells)
    one, three = tell_apart()
    M = 70
    W = 2 * M + 4 * cw + 3 * 40
    body_h = max(z.height + v.height for _, z, v in cells)
    H = 270 + body_h + 12 + 900 + 90 + three.height + 60 * (len(notes) + 1) + 80     # cropped at the end
    art = Image.new("RGB", (W, H), BG)
    dr = ImageDraw.Draw(art)
    dr.text((M, 40), "R5-99-總覽對照", font=artboard.font(64), fill=INK)
    r2art._wrap(dr, M, 126, "第 5 輪：R5-01 西陸晶術師。上排：放大後的造型（左邊待機不含防護罩、右邊晶砲施法）；"
                "下排：混在隊伍裡（西陸在右邊，紅色）。最下面是實際大小下和長弓兵、長矛兵的比較。", GREY, 28, W - 2 * M)
    y_text = 0
    for i, (o, z, v) in enumerate(cells):
        x = M + i * (cw + 40)
        dr.text((x, 200), f"{o}  {OPTIONS[o]['name']}", font=artboard.font(44), fill=INK)
        art.paste(z.convert("RGB"), (x, 270))
        art.paste(v.convert("RGB"), (x, 270 + z.height + 12))
        yy = 270 + z.height + v.height + 30
        for t, c in OPTIONS[o]["lines"]:
            yy = r2art._wrap(dr, x, yy, t, r2art._col(c), 24, cw)
        dr.text((x, yy + 10), f"R5-01-西陸晶術師-{o}-{OPTIONS[o]['name']}-mobile.png", font=artboard.font(22), fill=INK)
        y_text = max(y_text, yy + 50)
    y = y_text + 50
    dr.text((M, y), "分不分得出來（由左到右：長弓兵、長矛兵、0 現況、A 晶劍士、B 學院大師、C 女晶術師）："
            "左 實際大小 1 pt = 1 px，右 手機像素 1 pt = 3 px", font=artboard.font(28), fill=INK)
    art.paste(one.convert("RGB"), (M, y + 50))
    art.paste(three.convert("RGB"), (M + one.width + 40, y + 50))
    yy = y + 50 + three.height + 30
    for text, col in notes:
        yy = r2art._wrap(dr, M, yy, text, r2art._col(col), 26, W - 2 * M)
    art = art.crop((0, 0, W, min(H, yy + 60)))
    art.save(OUT / "R5-99-總覽對照.png")
    print("wrote R5-99-總覽對照")


NOTES = [(COMPARE_NOTE, "n"),
         ("B、C 穿到腳的長袍，和長弓兵、長矛兵的及膝外衣，在實際大小下剪影明顯不同。", "g"),
         ("A 的紅色肩披風和長弓兵、長矛兵的紅色外衣最像；靠頭頂發光的晶刃、沒戴帽子和棕色長外套分辨。", "r"),
         ("三款的杖頭晶石都高出頭頂 3–6 pt，加上光暈，在實際大小下看得到。", "g"),
         ("杖身只有約 1 pt 粗，實際大小下是一條細線；認得出「拿著杖」，但看不出杖的造型。", "n")]


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for o in ("0", "A", "B", "C"):
        s = staff_numbers(o)
        print(o, s)
    for o in ("0", "A", "B", "C"):
        artboard_01(o)
    motion_gif()
    overview(NOTES)
