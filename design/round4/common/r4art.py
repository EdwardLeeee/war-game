"""R4 artboards: R4-01 術士造型（道士／修仙）0/A/B/C, motion GIF, overview with the
farmer-versus-mage hat check.  Reuses the R3 layout code.

python3 common/r4art.py
"""
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROUND4 = HERE.parent
sys.path.insert(0, str(ROUND4.parent / "round3" / "common"))
import r3art   # noqa: E402  (brings round2/round1 helpers along)
from r3art import Image, ImageDraw, artboard, r2art, sprite, place_row, vignette  # noqa: E402

R4 = ROUND4 / "build" / "r4"
OUT = ROUND4 / "out"
R3M0 = ROUND4.parent / "round3" / "build" / "r3" / "mage0"
INK, GREY = artboard.INK, artboard.GREY
BG = (244, 241, 234)

OPTIONS = {
    "0": dict(dir=R3M0, name="現況", sub="選項 0：R2 選定的 C 級術士（白袍、頭冠、頭頂浮空魔晶），當對照",
              lines=[("使用者不喜歡；R3 的三個方向也都不採用，改往道士／修仙者。", "n")], west="—"),
    "A": dict(dir=R4 / "mageTA", name="道長",
              sub="選項 A：年長的道士。黑色道袍配白色交領與白袖口、寬袖、偃月冠加白髮髻、長鬚，左手拂塵、右手法印，背後金色八卦紋",
              lines=[], west="西陸版：年長的學者型晶術師，深色長袍與兜帽、長鬚，拿頂端嵌晶的長杖，腰掛書卷。"),
    "B": dict(dir=R4 / "mageTB", name="劍修",
              sub="選項 B：年輕的劍修。淡色層疊長衫、深色內袍、高馬尾戴玉冠、背著帶穗長劍、玩家色腰帶與長飄帶；法器仍是法印",
              lines=[], west="西陸版：年輕的晶劍士，長外套配短披風，背著晶刃長劍，手上的晶杖較短。"),
    "C": dict(dir=R4 / "mageTC", name="女修",
              sub="選項 C：女修。雙髻插簪、高腰短襦配長裙、寬袖，肩臂之間繞一條玩家色的長披帛",
              lines=[], west="西陸版：女晶術師，長裙配披肩（玩家色），手持晶杖。"),
}


def configure():
    """Point the shared R3 layout code at round4's folders."""
    r3art.OUT = OUT
    r3art.OPTIONS = OPTIONS


def artboard_01(opt):
    o = OPTIONS[opt]
    d = Path(o["dir"])
    label = f"R4-01-術士造型-{opt}-{o['name']}-mobile"
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
        dr.text((x0, yy), "西陸版會怎麼延伸（方向，還沒畫）", font=artboard.font(28), fill=INK)
        yy = r2art._wrap(dr, x0, yy + 46, o["west"], GREY, 24, 780)
    art.save(OUT / f"{label}.png")
    print("wrote", label)


def hat_check():
    """Farmer and each mage side by side at actual size and at phone pixels (the hats must not be confused)."""
    farmer = R4 / "farmer"
    items = [(sprite(farmer, "farmer_e_f7_idle03", "x3"), 3)]
    for o in ("A", "B", "C"):
        items.append((sprite(Path(OPTIONS[o]["dir"]), "mage_e_f7_idle03", "x3", fx=False), 3))
    one = place_row(items, 1, 54, 36)
    three = place_row(items, 3, 58, 40)
    return one, three


def motion_gif():
    label = "R4-99-動作對照"
    cw, ch, M, TOP = 330, 300, 16, 110
    opts = ("0", "A", "B", "C")
    W = M + len(opts) * (cw + 8) + M
    H = TOP + 2 * (ch + 8) + 20
    tmp = Path(tempfile.mkdtemp(prefix="r4gif_", dir=ROUND4 / "build"))
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
                    sp = sprite(Path(OPTIONS[o]["dir"]), f"motion_mage_e_f7_{anim}{f:02d}", "x6")
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


def overview(hat_note):
    opts = ("0", "A", "B", "C")
    cells = []
    for o in opts:
        d = Path(OPTIONS[o]["dir"])
        z = place_row([(sprite(d, "mage_e_f7_idle03", "x6", fx=False), 6), (sprite(d, "mage_e_f7_cast20", "x6"), 6)],
                      4.5, 66, 56)
        v = vignette(d, 2)
        cells.append((o, z, v))
    cw = max(max(z.width, v.width) for _, z, v in cells)
    one, three = hat_check()
    M = 70
    W = 2 * M + 4 * cw + 3 * 40
    body_h = max(z.height + v.height for _, z, v in cells)
    H = 270 + body_h + 12 + 420 + 90 + three.height + 120
    art = Image.new("RGB", (W, H), BG)
    dr = ImageDraw.Draw(art)
    dr.text((M, 40), "R4-99-總覽對照", font=artboard.font(64), fill=INK)
    r2art._wrap(dr, M, 126, "第 4 輪：R4-01 術士造型（道士／修仙）。上排：放大後的造型（左邊待機不含防護罩、右邊晶砲施法）；"
                "下排：混在隊伍裡。最下面是術士與農民的帽子剪影比較。", GREY, 28, W - 2 * M)
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
        dr.text((x, yy + 10), f"R4-01-術士造型-{o}-{OPTIONS[o]['name']}-mobile.png", font=artboard.font(22), fill=INK)
    y = 270 + body_h + 12 + 420
    dr.text((M, y), "帽子剪影比較（由左到右：農夫、A 道長、B 劍修、C 女修）：左 實際大小 1 pt = 1 px，右 手機像素 1 pt = 3 px",
            font=artboard.font(28), fill=INK)
    art.paste(one.convert("RGB"), (M, y + 50))
    art.paste(three.convert("RGB"), (M + one.width + 40, y + 50))
    r2art._wrap(dr, M + one.width + 40 + three.width + 40, y + 50, hat_note[0], r2art._col(hat_note[1]), 26,
                W - (M + one.width + 40 + three.width + 40) - M)
    art.save(OUT / "R4-99-總覽對照.png")
    print("wrote R4-99-總覽對照")


if __name__ == "__main__":
    configure()
    OUT.mkdir(parents=True, exist_ok=True)
    for o in ("0", "A", "B", "C"):
        artboard_01(o)
    motion_gif()
    overview(("（評估待填）", "n"))
