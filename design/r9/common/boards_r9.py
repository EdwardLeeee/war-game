"""R9's boards (napali realism trial, ceo 2026-11-01): before and after at the phone's actual size (1x, 814 x 380 pt) and
at its pixels (3x), the label top left, the latest judge's scores under it.

python3 design/r9/common/boards_r9.py SCENES_DIR UNITS_BEFORE UNITS_AFTER CITY_DIR OUT_DIR
  SCENES_DIR   scene_r9.py's output (scene_before/after.png, scene06_甲/乙.png, scene06_edge.png)
  UNITS_*      spear_e atlases (art-v6.3's, R9's postprocess output)
  CITY_DIR     render_b1 output with main_city_E_r9 (and art-v6.3's buildings atlas for the old one: ART_X3 env)
"""
import json
import os
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
    frames[0][0].save(out, save_all=True, append_images=[f for f, _ in frames[1:]], duration=[d for _, d in frames], loop=0)


def city_on(ground, sprite):
    canvas = ground.copy().convert("RGBA")
    (im, ax, ay), sh = sprite
    X, Y = canvas.width // 2, int(canvas.height * 0.6)
    if sh:
        si, sx, sy = sh
        SC._paste(canvas, si, (int(X - sx), int(Y - sy)))
    SC._paste(canvas, im, (int(X - ax), int(Y - ay)))
    return canvas.convert("RGB")


def scores_line():
    rows = [ln for ln in (HERE.parent / "scores.md").read_text().splitlines() if ln.startswith("| ") and ln[2].isdigit()]
    return rows[-1] if rows else ""


def main(scenes, ub, ua, city_dir, out):
    out.mkdir(parents=True, exist_ok=True)
    art = Path(os.environ["ART_X3"])
    b = Image.open(scenes / "scene_before.png").convert("RGB")
    a = Image.open(scenes / "scene_after.png").convert("RGB")
    last = scores_line()
    note = ("R9（使用者 2026-11-01：「你的畫風不能跟它一樣真實嗎」）：學 napali 的做法。只是試驗圖，沒有上線。"
            "場景是使用者存下來的「雙河關」那張圖（隨機地圖種子 2106939660）。左邊／上面是現在（art-v6.3），右邊／下面是 R9。")
    # 01 ground
    board("R9-01-地面-A-侵蝕起伏-phone",
          note + "\n地面：同一套地面圖層，加上可接縫的 16 公尺起伏圖（雜訊加侵蝕，照遊戲的太陽算軟陰影、天光、遮蔽）、"
          "成叢的草和被風吹倒的長條草色、小沖溝的濕土。隨機地圖在手機上生成也一樣接得起來（起伏圖取兩次、轉一個角度混合，不會重複）。",
          [("實際大小（1 倍，814×380 pt）：現在 → R9", pair(one_x(b), one_x(a))),
           ("手機像素（3 倍）一角：現在", b.crop((1300, 700, 2442, 1140))),
           ("手機像素（3 倍）一角：R9", a.crop((1300, 700, 2442, 1140)))], out)
    # 02 water edge
    board("R9-02-水邊-A-深淺與倒影-phone",
          note + "\n水邊：水照深淺變色（看得到淺處的河床），天空照菲涅耳反射成沿水流拉長的亮紋，對岸和岸上的樹倒映在水裡，"
          "對岸的土坎朝鏡頭露出來、近岸是一圈草唇，水邊濕土，岸線不再沿著格子走；淺灘有石頭和白色的碎浪。",
          [("實際大小（1 倍）：現在 → R9", pair(one_x(b), one_x(a))),
           ("手機像素（3 倍）河段：現在", b.crop((0, 380, 1300, 840))),
           ("手機像素（3 倍）河段：R9", a.crop((0, 380, 1300, 840)))], out)
    # 03 spearman
    grass = a.crop((1500, 760, 2442, 1140))
    sb, sa = spear_strip(ub, grass), spear_strip(ua, grass)
    board("R9-03-槍兵-A-布料與打光-phone",
          note + "\n槍兵（東陸，唐末五代，雙手持槍）：玩家色的袍子以前過曝成一整片青色，現在保留布紋、皺褶和光澤；"
          "皮膚透一點光、臉不再是黑洞；甲片凹凸加深、每片粗糙度不同；加上草地往上反的光。動作見同名 GIF。",
          [("實際大小（1 倍）：現在（上）、R9（下）", pair(one_x(sb), one_x(sa), gap=10)),
           ("手機像素（3 倍）：現在", sb), ("手機像素（3 倍）：R9", sa)], out)
    spear_gif(ub, grass, out / "R9-03-槍兵-0-現況-動作.gif")
    spear_gif(ua, grass, out / "R9-03-槍兵-A-布料與打光-動作.gif")
    # 04 main city
    old = SC.Atlas(art / "buildings" / "buildings_E.json").sprite("main_city_E_done", "blue")
    new = SC.b1_sprite(city_dir, "main_city_E_r9")
    g2 = a.crop((0, 0, 1000, 760))
    cb, ca = city_on(g2, old), city_on(g2, new)
    board("R9-04-主城-A-不規則輪廓-phone",
          note + "\n主城：州府院落。正堂在比 4×4 小的台基上，左前角一座夯土墩台上的鼓樓高出屋簷，右邊一座橫著的偏殿，"
          "後面一棵松樹，屋簷伸出台基；不再鋪滿方形的地坪，輪廓不是方塊。屋瓦改成細的筒瓦一路到簷口，簷口一排瓦當，正脊疊瓦。",
          [("實際大小（1 倍）：現在 → R9", pair(one_x(cb), one_x(ca))),
           ("手機像素（3 倍）：現在 → R9", pair(cb, ca, scale=0.75))], out)
    # 06 cameras
    for cam, name, text in (("甲", "方形斜看", "照現在的鏡頭（D-088）。另一張是地圖邊緣的收邊：河流出地圖變成湖，兩旁是森林，地圖外面暗一點、灰一點（玩家去不了）。"),
                            ("乙", "菱形斜看", "鏡頭轉 45 度（art-v2 以前），建築的角朝向玩家；主城用這個角度重算，地面、水、太陽跟著轉。模擬照舊是正方形的格子。")):
        im = Image.open(scenes / f"scene06_{cam}.png").convert("RGB")
        rows = [("實際大小（1 倍）", one_x(im)), ("手機像素（3 倍）", im.resize((im.width * 2 // 3, im.height * 2 // 3), Image.LANCZOS))]
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
    main(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]), Path(sys.argv[5]))
