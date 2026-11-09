"""R16 boards (the user 2026-11-10: 「種田的農民圖看起來好像有點怪」, 「鋤頭太大太白」, 「動作怪」,
「手拿鋤頭感覺不太符合真實拿法」; brief docs/briefs/2026-11-ui-farmer-hoe.md):

  R16-01 鋤頭: one board an option (現在, A 真實大小, B 放大 1.5 倍) and an overview. Each: East and West, the field as the
         iPhone shows it (scene_r16: the camera's default scale, pixel ratio 2 scaled up to the 3x screen) beside a
         spearman, and two farmers enlarged 3 times.
  R16-02 種田動作: the eight frames of the stroke, before and after, East and West (facing 7, enlarged), and GIFs,
         the iPhone's size beside the 3 times enlargement.
  R16-03 西陸農民平常拿鋤頭: idle, walk, attack and fall, before and after (the carry changed too).

python3 design/r16/common/boards_r16.py RENDERS ATLAS OUT
  RENDERS: render_r16.py's output folders (<c>_old, <c>_A, <c>_B, w_old3, w_A3, w_B3)
  ATLAS: a release's x3 (ground/, buildings/, and units/ beside it with atlas_x3/<unit>.json) for the field
  All build output, not in git.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import scene_r16 as R     # noqa: E402

BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
TC = 3
BG = (24, 26, 30)
NAME = {"E": "東陸", "W": "西陸"}
SPEAR = {"E": "spear_e", "W": "pike_w"}
OPTS = [("old", "現在", "art-v7.7：刃 34×40 cm，兵器鋼（亮白），刃面朝天舉起、平躺著拖"),
        ("A", "A-真實大小", "刃約 15–19 cm，暗色舊鐵、刃口一條磨亮；照出處的形狀"),
        ("B", "B-放大1.5倍", "形狀、顏色和 A 一樣，放大 1.5 倍（刃約 22–28 cm），遊戲裡比較看得清楚")]
# the field: three farmers hoeing (facing, frame, cell) and one more standing (the West carries his hoe)
ON_FIELD = [(7, 2, 40.6, 41.0), (1, 4, 41.9, 40.4), (0, 6, 42.2, 42.0)]


def font(size, bold=True):
    return ImageFont.truetype(BOLD if bold else REG, size, index=TC)


def label(img, text, size=34, at=(0, 0), fill=(255, 255, 255)):
    d = ImageDraw.Draw(img)
    w = d.textlength(text, font=font(size))
    d.rectangle((at[0], at[1], at[0] + w + 20, at[1] + size + 14), fill=(0, 0, 0))
    d.text((at[0] + 10, at[1] + 4), text, font=font(size), fill=fill)


def prefix(renders, c, opt):
    return f"{renders}/{c.lower()}_{opt}/{c.lower()}{opt}"


def field(renders, atlas, c, opt):
    """The phone's picture of the field (crop 1:1 at 3x), and two farmers from it enlarged 3 times."""
    p = prefix(renders, c, opt)
    fs = [(R.farmer(f"{p}_work_farm_f{f}_{i:02d}"), x, y) for f, i, x, y in ON_FIELD]
    fs.append((R.farmer(f"{p}_idle_f7_00"), 40.2, 42.6))
    img, cam = R.field(atlas, c, fs, [41.5, 41.5, 466, 190], spear=(SPEAR[c], 39.2, 43.4, 7))
    x, y = cam.pt(41.5, 41.5)
    crop = img.crop((int(x * 3 - 520), int(y * 3 - 330), int(x * 3 + 520), int(y * 3 + 250)))
    zooms = []
    for f, i, fx, fy in ON_FIELD[:2]:
        sx, sy = cam.pt(fx, fy)
        z = img.crop((int(sx * 3 - 75), int(sy * 3 - 190), int(sx * 3 + 95), int(sy * 3 + 30)))
        zooms.append(z.resize((z.width * 3, z.height * 3), Image.LANCZOS))
    return crop, zooms


def board01(renders, atlas, out):
    pics = {}
    for key, name, note in OPTS:
        rows = [(c, *field(renders, atlas, c, key)) for c in ("E", "W")]
        pics[key] = rows
        cw, ch = rows[0][1].size
        zw, zh = rows[0][2][0].size
        gap, top = 20, 170
        W = cw + 2 * zw + 4 * gap
        H = top + 2 * (max(ch, zh) + 70)
        img = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(img)
        d.text((gap, 12), f"R16-01-鋤頭-{name}-phone", font=font(52), fill=(240, 240, 240))
        d.text((gap, 84), note, font=font(32), fill=(250, 220, 140))
        d.text((gap, 128), "左：iPhone 上的實際大小（預設縮放、像素比 2 放大到螢幕，1:1 像素），旁邊是槍兵；右：同一畫面裡兩名農民放大 3 倍"
               "（草稿算圖）", font=font(26, False), fill=(190, 190, 190))
        y = top
        for c, crop, zooms in rows:
            d.text((gap, y + 6), NAME[c], font=font(40), fill=(240, 240, 240))
            y += 60
            img.paste(crop, (gap, y))
            for k, z in enumerate(zooms):
                img.paste(z, (2 * gap + cw + k * (zw + gap), y))
            label(img, "實際大小", 28, (gap, y))
            label(img, "放大 3 倍：舉起", 28, (2 * gap + cw, y))
            label(img, "放大 3 倍：刃入土", 28, (3 * gap + cw + zw, y))
            y += max(ch, zh) + 10
        img.save(out / f"R16-01-鋤頭-{name}-phone.png", optimize=True)
    # the overview: each option's two fields side by side, a third smaller, one enlarged farmer under each
    k = 0.62
    cw, ch = pics["A"][0][1].size
    zw, zh = pics["A"][0][2][0].size
    tw, th = int(cw * k), int(ch * k)
    gap, top = 20, 150
    W = 3 * (tw + gap) + gap
    H = top + 2 * (th + int(zh * 0.5) + 80)
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.text((gap, 12), "R16-01-鋤頭-總覽-phone", font=font(52), fill=(240, 240, 240))
    d.text((gap, 84), "上：iPhone 實際大小縮成 62%；下：舉起那一格放大 1.5 倍。左到右：現在、A 真實大小、B 放大 1.5 倍",
           font=font(28, False), fill=(200, 200, 200))
    for col, (key, name, _) in enumerate(OPTS):
        y = top
        for c, crop, zooms in pics[key]:
            x = gap + col * (tw + gap)
            d.text((x, y), f"{name}　{NAME[c]}", font=font(32), fill=(250, 220, 140))
            img.paste(crop.resize((tw, th), Image.LANCZOS), (x, y + 44))
            z = zooms[0].resize((zw // 2, zh // 2), Image.LANCZOS)
            img.paste(z, (x, y + 50 + th))
            y += th + zh // 2 + 80
    img.save(out / "R16-01-鋤頭-總覽-phone.png", optimize=True)


def strip(pre, frames, zoom=2, pad=8):
    ims = [Image.open(f"{pre}_{i:02d}_x3_beauty.png").convert("RGBA") for i in frames]
    bb = None
    for im in ims:
        b = im.getchannel("A").getbbox()
        bb = b if bb is None else (min(bb[0], b[0]), min(bb[1], b[1]), max(bb[2], b[2]), max(bb[3], b[3]))
    bb = (bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad)
    cells = []
    for im in ims:
        c = Image.new("RGBA", (bb[2] - bb[0], bb[3] - bb[1]), (104, 122, 76, 255))
        cr = im.crop(bb)
        c.alpha_composite(cr)
        cells.append(c.resize((c.width * zoom, c.height * zoom), Image.LANCZOS).convert("RGB"))
    return cells


def board02(renders, atlas, out):
    rows = []
    for c in ("E", "W"):
        for key, tag in (("old", "改前"), ("B", "改後")):
            rows.append((f"{NAME[c]}　{tag}", strip(f"{prefix(renders, c, key)}_work_farm_f7", range(8))))
    cw, ch = rows[0][1][0].size
    gap, top, lab = 10, 200, 52
    W = 8 * (cw + gap) + gap
    H = top + len(rows) * (ch + lab + gap)
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.text((20, 12), "R16-02-種田動作-關鍵格-phone", font=font(52), fill=(240, 240, 240))
    d.text((20, 84), "改後：兩手都握柄（左手柄尾、右手前面、會沿柄滑）；舉到胸口到頭的高度、刃往下垂；第 3 格刃口先入土，"
           "落在前腳前方約 1 公尺；往腳邊拉 25–30 公分；再舉起", font=font(28), fill=(250, 220, 140))
    d.text((20, 128), "8 格、每秒 10 格、重複播（第 7 格接回第 0 格）；第 3 格是入土那一下（hit 照舊）。方向 7，放大 2 倍，"
           "鋤頭用 B（放大 1.5 倍；選 A 動作一樣）。草稿算圖", font=font(26, False), fill=(200, 200, 200))
    y = top
    for name, cells in rows:
        d.text((20, y + 4), name, font=font(36), fill=(255, 255, 255) if "前" in name else (255, 214, 40))
        y += lab
        for i, cimg in enumerate(cells):
            img.paste(cimg, (gap + i * (cw + gap), y))
            d.text((gap + i * (cw + gap) + 6, y + 4), f"{i}{' 入土' if i == 3 else ''}", font=font(24), fill=(255, 255, 255))
        y += ch + gap
    img.save(out / "R16-02-種田動作-關鍵格-phone.png", optimize=True)
    # GIFs: the farmer on the field as the phone shows him, beside him enlarged 3 times
    for c in ("E", "W"):
        for key, tag in (("old", "改前"), ("B", "改後")):
            frames = []
            for i in range(8):
                spr = R.farmer(f"{prefix(renders, c, key)}_work_farm_f7_{i:02d}")
                pic, cam = R.field(atlas, c, [(spr, 41.0, 41.0)], [41.0, 41.0, 466, 200])
                sx, sy = cam.pt(41.0, 41.0)
                real = pic.crop((int(sx * 3 - 200), int(sy * 3 - 260), int(sx * 3 + 220), int(sy * 3 + 80)))
                z = pic.crop((int(sx * 3 - 80), int(sy * 3 - 200), int(sx * 3 + 100), int(sy * 3 + 30)))
                z = z.resize((z.width * 3, z.height * 3), Image.LANCZOS)
                f = Image.new("RGB", (real.width + z.width + 30, max(real.height, z.height) + 60), BG)
                f.paste(real, (10, 60))
                f.paste(z, (real.width + 20, 60))
                dd = ImageDraw.Draw(f)
                dd.text((10, 8), f"R16-02 {NAME[c]} {tag}　左：iPhone 實際大小　右：放大 3 倍", font=font(30), fill=(240, 240, 240))
                frames.append(f)
            frames[0].save(out / f"R16-02-種田動作-{NAME[c]}-{tag}-phone.gif", save_all=True, append_images=frames[1:],
                           duration=100, loop=0, optimize=True)


def board03(renders, out):
    ROWS = [("idle", range(0, 8, 2), "待機"), ("walk", range(8), "走路"), ("attack", range(10), "攻擊（第 7 格打中）"),
            ("death", range(10), "倒下")]
    blocks = []
    for anim, frames, name in ROWS:
        before = strip(f"{renders}/w_old3/wold3_{anim}_f7", frames, zoom=1)
        after = strip(f"{renders}/w_B3/wB3_{anim}_f7", frames, zoom=1)
        blocks.append((name, before, after))
    gap, top, lab = 8, 200, 48
    W = max(len(b) * (b[0].width + gap) for _, b, _ in blocks) + 40
    H = top + sum(2 * (b[0].height + lab) + 30 for _, b, _ in blocks)
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.text((20, 12), "R16-03-西陸農民平常拿鋤頭-改前改後-phone", font=font(52), fill=(240, 240, 240))
    d.text((20, 84), "平常拿法也改了：改前是握在柄尾、整支柄往前伸 1.3 公尺、刃平放在遠處地上（R5 D-021 的輪廓、R8 調過）；"
           "改後右手垂在身側握柄中段、鋤頭頭朝下在右腳旁、刃離地", font=font(28), fill=(250, 220, 140))
    d.text((20, 128), "攻擊改成兩手握柄、舉過右肩往前劈下（改前是握柄尾往下戳）；倒下時鋤頭鬆手、刃側著和柄一起躺在身旁。"
           "方向 7、x3 原大，鋤頭用 B（放大 1.5 倍）。草稿算圖", font=font(26, False), fill=(200, 200, 200))
    y = top
    for name, before, after in blocks:
        for tag, cells, col in (("改前", before, (255, 255, 255)), ("改後", after, (255, 214, 40))):
            d.text((20, y + 4), f"{name}　{tag}", font=font(32), fill=col)
            y += lab
            for i, cimg in enumerate(cells):
                img.paste(cimg, (20 + i * (cimg.width + gap), y))
            y += cells[0].height
        y += 30
    img.save(out / "R16-03-西陸農民平常拿鋤頭-改前改後-phone.png", optimize=True)


def main():
    renders, atlas, out = sys.argv[1], sys.argv[2], Path(sys.argv[3])
    out.mkdir(parents=True, exist_ok=True)
    board01(renders, atlas, out)
    board02(renders, atlas, out)
    board03(renders, out)
    for p in sorted(out.iterdir()):
        print(p.name)


if __name__ == "__main__":
    main()
