"""R9's boards (napali realism trial, ceo 2026-11-01): before and after at the phone's actual size (1x, 814 x 380 pt) and
at its pixels (3x), the label top left, the latest judge's scores under it.

python3 design/r9/common/boards_r9.py SCENES_DIR UNITS_BEFORE UNITS_AFTER OUT_DIR
  SCENES_DIR   scene_r9.py's output: scene_, grass_, city_ before/after.png (modes ground, grass, city), scene06_現在/甲/乙.png
               and scene06_edge.png (modes 06, edge)
  UNITS_*      spear_e atlases (art-v6.3's, R9's postprocess output)
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import scene_r9 as SC   # noqa: E402

BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
BG, INK, GREY = (244, 241, 234), (40, 40, 40), (105, 105, 105)
M = 32


def font(n, bold=True):
    return ImageFont.truetype(BOLD if bold else REG, n)


def wrap(d, text, f, w):
    out = []
    for para in text.split("\n"):
        cur = ""
        for ch in para:
            if d.textlength(cur + ch, font=f) > w:
                out.append(cur)
                cur = ch
            else:
                cur += ch
        out.append(cur)
    return out


def board(label, sub, rows, out, W=None):
    """rows: [(caption, image)], each image as is (the caller scales); stacked, captions above."""
    W = W or max(im.width for _, im in rows) + 2 * M
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    sub_lines = wrap(probe, sub, font(22, False), W - 2 * M)
    H = M + 60 + len(sub_lines) * 34 + 16 + sum(im.height + 54 for _, im in rows) + M
    o = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(o)
    d.text((M, M), label, font=font(40), fill=INK)
    y = M + 64
    for ln in sub_lines:
        d.text((M, y), ln, font=font(22, False), fill=GREY)
        y += 34
    y += 16
    for cap, im in rows:
        d.text((M, y), cap, font=font(24), fill=INK)
        y += 40
        o.paste(im, (M, y))
        y += im.height + 14
    o.save(out / f"{label}.png")
    return o


def pair(a, b, gap=24, scale=1.0):
    if scale != 1.0:
        a = a.resize((int(a.width * scale), int(a.height * scale)), Image.LANCZOS)
        b = b.resize((int(b.width * scale), int(b.height * scale)), Image.LANCZOS)
    o = Image.new("RGB", (a.width + gap + b.width, max(a.height, b.height)), BG)
    o.paste(a, (0, 0))
    o.paste(b, (a.width + gap, 0))
    return o


def one_x(im):
    return im.resize((im.width // 3, im.height // 3), Image.LANCZOS)


def spear_strip(atlas_dir, ground, team="blue"):
    canvas = ground.copy().convert("RGBA")
    poses = [("idle", 7, 0), ("walk", 7, 3), ("attack", 7, 5), ("idle", 1, 0), ("walk", 1, 6), ("attack", 1, 4)]
    for i, (anim, f, k) in enumerate(poses):
        (spr, flip) = SC.unit_sprite(atlas_dir, anim, f, k, team)
        (im, ax, ay), sh = spr
        X, Y = 90 + i * 150, ground.height - 60
        if sh:
            si, sx, sy = sh
            SC._paste(canvas, si, (int(X - sx), int(Y - sy)))
        if flip:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
            ax = im.width - ax
        SC._paste(canvas, im, (int(X - ax), int(Y - ay)))
    return canvas.convert("RGB")


def zoom2(strip):
    """The first three poses of a spear strip at 2x (to see the materials; the phone shows the 3x rows)."""
    c = strip.crop((0, 20, 480, 280))
    return c.resize((c.width * 2, c.height * 2), Image.LANCZOS)


def spear_gif(atlas_dir, ground, out, team="blue"):
    """idle, walk, attack on facing 7, at 2x the phone's pixels (so the motion reads on a monitor)."""
    a = SC.Atlas(Path(atlas_dir) / "spear_e.json")
    frames = []
    for anim in ("idle", "walk", "attack"):
        n = sum(1 for k in a.j["frames"] if k.startswith(f"spear_e_{anim}_f7_"))
        fps = a.j["anims"][anim]["fps"]
        for k in range(n):
            canvas = ground.crop((0, 0, 360, 300)).convert("RGBA")
            (im, ax, ay), sh = a.sprite(f"spear_e_{anim}_f7_{k:02d}", team)
            X, Y = 160, 250
            if sh:
                si, sx, sy = sh
                SC._paste(canvas, si, (int(X - sx), int(Y - sy)))
            SC._paste(canvas, im, (int(X - ax), int(Y - ay)))
            c = canvas.convert("RGB").resize((720, 600), Image.LANCZOS)
            ImageDraw.Draw(c).text((12, 8), anim, font=font(28), fill=(250, 250, 250))
            frames.append((c, int(1000 / fps)))
    pal = frames[0][0].quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    q = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f, _ in frames]
    q[0].save(out, save_all=True, append_images=q[1:], duration=[d for _, d in frames], loop=0, optimize=True)


def scores_line():
    """The latest score of each item (scores.md: the last round that scored it), e.g. 「地面 4 → 5（第 5 輪）、…」."""
    rows = [[c.strip() for c in ln.strip().strip("|").split("|")]
            for ln in (HERE.parent / "scores.md").read_text().splitlines() if ln.startswith("| ") and ln[2].isdigit()]
    out = []
    for k, name in ((1, "地面"), (2, "水邊"), (3, "槍兵"), (4, "主城")):
        got = [r for r in rows if len(r) > k and r[k] not in ("—", "")]
        if got:
            out.append(f"{name} {got[-1][k]}（第 {got[-1][0]} 輪）")
    return "、".join(out)


def main(scenes, ub, ua, out):
    out.mkdir(parents=True, exist_ok=True)
    b = Image.open(scenes / "scene_before.png").convert("RGB")
    a = Image.open(scenes / "scene_after.png").convert("RGB")
    last = scores_line()
    note = ("R9（使用者 2026-11-01：「你的畫風不能跟它一樣真實嗎」）：學 napali 的做法。只是試驗圖，沒有上線。"
            "場景是使用者存下來的「雙河關」（D-115 起是固定的一張地圖）。左邊／上面是現在（art-v6.3），右邊／下面是 R9。"
            f"\n評審最後一輪分數（0–10，現在 → R9）：{last}")
    # 01 ground
    board("R9-01-地面-A-侵蝕起伏-phone",
          note + "\n地面：同一套地面圖層，加上可接縫的 16 公尺起伏圖（雜訊加侵蝕，照遊戲的太陽算軟陰影、天光、遮蔽）、"
          "成叢的草和被風吹倒的長條草色、小沖溝的濕土。隨機地圖在手機上生成也一樣接得起來（起伏圖取兩次、轉一個角度混合，不會重複）。"
          "\n記憶體（2 倍，GPU 用 ASTC 4×4）：art-v6.3 地面 0.33 MB → R9 約 0.8 MB（多一張起伏圖 0.41 MB、漣漪圖 0.07 MB）；"
          "3 倍 0.7 → 約 1.7 MB。PNG 檔：起伏圖 3 倍 1.4 MB、2 倍 0.63 MB。",
          [("實際大小（1 倍，814×380 pt）：現在 → R9", pair(one_x(b), one_x(a))),
           ("手機像素（3 倍）一角：現在", b.crop((1300, 700, 2442, 1140))),
           ("手機像素（3 倍）一角：R9", a.crop((1300, 700, 2442, 1140)))], out)
    # 02 water edge
    board("R9-02-水邊-A-深淺與倒影-phone",
          note + "\n水邊：水照深淺變色（淺處看得到河底），細的漣漪反射天空，對岸的土坎朝鏡頭露出來、它的倒影和影子落在水上，"
          "岸線一道濕泥細線、不沿著格子走，河寬有寬有窄；淺灘有石頭和白色的碎浪；橋板在水上有影子。",
          [("實際大小（1 倍）：現在 → R9", pair(one_x(b), one_x(a))),
           ("手機像素（3 倍）河段：現在", b.crop((0, 380, 1300, 840))),
           ("手機像素（3 倍）河段：R9", a.crop((0, 380, 1300, 840)))], out)
    # 03 spearman: each on its own ground
    gb = Image.open(scenes / "grass_before.png").convert("RGB").crop((600, 720, 1600, 1000))
    ga = Image.open(scenes / "grass_after.png").convert("RGB").crop((600, 720, 1600, 1000))
    sb, sa = spear_strip(ub, gb), spear_strip(ua, ga)
    board("R9-03-槍兵-A-甲片與打光-phone",
          note + "\n槍兵（東陸，唐末五代，雙手持槍）：甲片一片一片亮暗、角度、粗糙度各不同（反光碎成點），甲片間的縫更深；"
          "頓項（護頸）改成甲片列，不再是一整片玩家色；玩家色布料稍暗、有布紋；草地往上反的光改暖。動作見同名 GIF。"
          "\n註：前幾輪的評審圖把玩家色多乘了一次 1.6（遊戲沒有），兩邊都被畫成過曝的青色；這張照遊戲的算法合成。",
          [("實際大小（1 倍）：現在 → R9", pair(one_x(sb), one_x(sa), gap=10)),
           ("手機像素（3 倍）：現在", sb), ("手機像素（3 倍）：R9", sa),
           ("放大 2 倍看細節（前三個動作）：現在 → R9", pair(zoom2(sb), zoom2(sa), gap=10))], out)
    spear_gif(ub, gb, out / "R9-03-槍兵-0-現況-動作.gif")
    spear_gif(ua, ga, out / "R9-03-槍兵-A-甲片與打光-動作.gif")
    # 04 main city
    cb = Image.open(scenes / "city_before.png").convert("RGB")
    ca = Image.open(scenes / "city_after.png").convert("RGB")
    board("R9-04-主城-A-不規則輪廓-phone",
          note + "\n主城：州府院落。正堂在比 4×4 小的台基上，左前角夯土墩台上的鼓樓高出屋簷，右前方一座較矮的偏殿門朝鏡頭，"
          "後面一棵松樹，屋簷伸出台基，輪廓不是方塊。屋瓦是細的筒瓦一路到簷口，簷口一排瓦當，正脊疊瓦。夯土台一層一層、有雨水沖痕。"
          "門前和正面一排踩實的土、一條小路走出去（遊戲裡城內地面已經有這個圖層），牆腳有接地的陰影，影子比現在深。",
          [("實際大小（1 倍）：現在 → R9", pair(one_x(cb), one_x(ca))),
           ("手機像素（3 倍）：現在", cb), ("手機像素（3 倍）：R9", ca)], out)
    # 06 cameras
    for cam, name, text in (("甲", "方形斜看", "照現在的鏡頭（D-088）。另一張是地圖邊緣的收邊：河流出地圖變成湖，兩旁是森林，地圖外面暗一點、灰一點（玩家去不了）。"),
                            ("乙", "菱形斜看", "鏡頭轉 45 度（art-v2 以前），建築的角朝向玩家；主城和槍兵用這個角度重算，地面、水、太陽跟著轉"
                                            "（樹和石頭還是方形鏡頭的圖）。模擬照舊是正方形的格子。")):
        im = Image.open(scenes / f"scene06_{cam}.png").convert("RGB")
        rows = [("實際大小（1 倍）", one_x(im)), ("手機像素（3 倍的 2/3）", im.resize((im.width * 2 // 3, im.height * 2 // 3), Image.LANCZOS))]
        if cam == "甲":
            e = Image.open(scenes / "scene06_edge.png").convert("RGB")
            rows += [("地圖邊緣的收邊（1 倍）", one_x(e)), ("地圖邊緣的收邊（3 倍的 2/3）", e.resize((e.width * 2 // 3, e.height * 2 // 3), Image.LANCZOS))]
        board(f"R9-06-鏡頭-{cam}-{name}-phone", "R9-06（使用者 2026-11-01：「為啥我們的地圖是長方形的？建築也是」）：同一個畫面，新的地面、水邊、槍兵、主城。\n" + text,
              rows, out)
    # overview
    j = one_x(Image.open(scenes / "scene06_甲.png").convert("RGB"))
    y = one_x(Image.open(scenes / "scene06_乙.png").convert("RGB"))
    now = one_x(Image.open(scenes / "scene06_現在.png").convert("RGB"))
    board("R9-99-總覽-phone", note + "\n同一個畫面，手機實際大小（1 倍）：新的地面、水邊、槍兵、主城放在一起。上：現在；中：R9 方形斜看；下：R9 菱形斜看。",
          [("現在（art-v6.3）", now), ("R9 方形斜看（甲）", j), ("R9 菱形斜看（乙）", y)], out)
    print("boards in", out)


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]))
