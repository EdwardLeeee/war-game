"""R5-02 兵種總表: the 12 units at level C.

python3 common/r5roster.py
-> out/R5-02-兵種總表-A-C精緻度-mobile.png   formations at actual size (both colour pairings),
                                              the same battle at phone pixels, every unit in
                                              blue and red, evaluations and texture memory
   out/R5-02-兵種總表-A-C精緻度-放大.png       12 cells: R1 next to R5 (idle and action), what changed
Inputs: build/r5/roster{E1,E2,W1,W2,W3}/ (CI artifacts via common/fetch_ci.py) and the R1
sprites in design/round1/build/3d/sprites for the before/after thumbnails and memory baseline.
"""
import glob
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import r5art   # noqa: E402
from r5art import Image, ImageDraw, artboard, r2art  # noqa: E402

R5 = r5art.R5
OUT = r5art.OUT
R1S = r5art.DESIGN / "round1" / "build" / "3d" / "sprites"
INK, GREY = artboard.INK, artboard.GREY
BG = r5art.BG

# key, render folder, kind, name, action frame, R1 thumbnail (None: R1 had no such model), what changed
UNITS = {
    "e": [
        ("farmer_e", "rosterE1", "農夫", "attack04", "farmer_e_v0_f1_chop3",
         "斗笠加大，加上編織紋和繫繩；麻布短袍有褶子；玩家色從細腰帶改成腰帶加一片垂到膝的前片；加綁腿；斧柄纏皮。"),
        ("spear_e", "rosterE1", "槍兵", "attack04", "spear_e_v0_f0_attack1",
         "R2 已經做到 C，這輪沒改：漆甲、頭盔與頸甲、背旗與金流蘇。"),
        ("xbow_e", "rosterE1", "弩手", "attack01", "xbow_e_v0_f0_attack0",
         "漆皮背心改成貼身；玩家色從背旗再加上整圈下裙（身前看得到）；幞頭加頂髻和兩根硬腳；腰側加箭匣；弩加銅機和扳機。"),
        ("hcav_e", "rosterE2", "具裝騎兵", "walk02", "hcav_e_v0_f0_walk2",
         "R2 已經做到 C；R3 修正騎手的腿（跨坐、加馬鐙）。這輪沒改。"),
        ("siege_e", "rosterE2", "霹靂車", "attack03", "siege_e_v0_f0_attack5",
         "實心輪改成輻條輪加鐵箍；立柱與拋竿加鐵箍和繩綁；拉索加握把；加一籃石彈；旗子加大、加金流蘇。"),
        ("mage_e", "rosterE2", "術士（劍修）", "cast20", "mage_e_v0_f0_cast22",
         "R4 選定的劍修（D-019）：淡色長衫、玉冠馬尾、背劍、玩家色腰帶和身前飄帶，用劍指施法。"),
    ],
    "w": [
        ("farmer_w", "rosterW1farmer", "農民", "attack04", None,
         "新兵種：R1 沒有西陸農民，兩邊共用東陸農夫。赭紅短衫、綁帶靴、鋤頭；玩家色是頭巾和胸前到膝的圍裙"
         "（圍裙在正側面只剩一條線，頭巾從哪個方向都看得到）。"),
        ("pike_w", "rosterW1", "長矛兵", "attack04", "pike_w_v0_f4_attack0",
         "棉甲改成有縫線的絎縫布；玩家色罩袍加長到膝、兩側開衩；鐵帽加捲邊、帽脊和帽帶；長矛加長到約 3.8 公尺，加矛頭護條。"),
        ("bow_w", "rosterW1", "長弓兵", "attack04", "bow_w_v0_f4_attack1",
         "苔綠兜帽加長尾巴，加上鋸齒下擺的短披肩；玩家色罩衣加長；箭袋加箭羽；長弓加長並加握把。"),
        ("knight_w", "rosterW2", "騎士", "walk02", "knight_w_v0_f4_walk1",
         "R2 已經做到 C；R3 修正騎手的腿（跨坐、加馬鐙）。這輪沒改。"),
        ("siege_w", "rosterW2", "投石機", "attack02", "siege_w_v0_f4_attack2",
         "實心輪改成輻條輪；加扭力繩束、絞盤把手和鐵件；加一堆石彈；旗子加大（雙塔徽章）。"),
        ("mage_w", "rosterW3", "晶術師（學院大師）", "cast20", None,
         "R5-01 選定的 B 學院大師（使用者 2026-09-30）：深色學院長袍、玩家色披肩、晶簇木杖。R1 沒有西陸自己的法師。"),
    ],
}
SIDE = {"e": 0, "w": 4}
TEAM_OF = {"blue": "e", "red": "w"}      # r2art.TEAM keys: e = blue, w = red


def unit_dir(folder, kind):
    d = R5 / folder
    if kind == "mage_w" and not (d / "mage_w_f4_idle03_x3.json").exists():
        return R5 / "mageWB"        # R5-01 renders until rosterW3 arrives (no facing-4 frames there)
    return d


def usp(folder, kind, name, scale, colour, fx=False):
    """A unit sprite in the given player colour ("blue" or "red")."""
    d = unit_dir(folder, kind)
    key = f"{kind}_{name}"
    if not (d / f"{key}_{scale}.json").exists() and kind == "mage_w":
        key = key.replace("_f4_", "_f5_").replace("walk02", "idle03").replace("walk06", "idle03")
    return r5art.sprite(d, key, scale, fx=fx, team=TEAM_OF[colour], glow=kind.startswith("mage"))


# ---------------------------------------------------------------- formations

def _layout():
    """(side, key, x_pt, y_pt, frame) for one battle: East on the left facing right, West mirrored."""
    east = [("farmer_e", 14, 128, "idle03"), ("farmer_e", 28, 141, "walk02"),
            ("siege_e", 40, 80, "idle03"),
            ("hcav_e", 78, 44, "walk02"), ("hcav_e", 102, 34, "walk06"),
            ("mage_e", 84, 120, "idle03"),
            ("xbow_e", 104, 74, "idle03"), ("xbow_e", 110, 97, "walk02"), ("xbow_e", 104, 120, "walk06"),
            ("spear_e", 132, 64, "idle03"), ("spear_e", 138, 86, "walk02"), ("spear_e", 132, 108, "walk06"),
            ("spear_e", 138, 130, "idle03")]
    west_of = {"farmer_e": "farmer_w", "siege_e": "siege_w", "hcav_e": "knight_w", "mage_e": "mage_w",
               "xbow_e": "bow_w", "spear_e": "pike_w"}
    out = [("e", k, x, y, f) for k, x, y, f in east]
    out += [("w", west_of[k], 330 - x, y, f) for k, x, y, f in east]
    return out


def _folder(side, key):
    return next(u[1] for u in UNITS[side] if u[0] == key)


def formation(colours, px_per_pt, crop=None):
    """colours = {"e": "blue", "w": "red"}; the battle at px_per_pt display pixels per point."""
    w_pt, h_pt = 330, 152
    can = r2art.ground(int(w_pt * px_per_pt), int(h_pt * px_per_pt), zoom=px_per_pt / 3)
    for side, key, x, y, fr in sorted(_layout(), key=lambda t: t[3]):
        sp = usp(_folder(side, key), key, f"f{SIDE[side]}_{fr}", "x3", colours[side], fx=key.startswith("mage"))
        f = px_per_pt / 3
        im = sp.img if f == 1 else sp.img.resize((max(1, int(sp.img.width * f)), max(1, int(sp.img.height * f))),
                                                 Image.LANCZOS)
        can.alpha_composite(im, (int(x * px_per_pt - sp.anchor[0] * f), int(y * px_per_pt - sp.anchor[1] * f)))
    if crop:
        can = can.crop([int(c * px_per_pt) for c in crop])
    return can


# ---------------------------------------------------------------- line-ups

def lineup(side, px_per_pt=3):
    """Every unit of one culture at facing 7, blue then red, at phone pixels."""
    sprites = []
    for key, folder, name, act, _, _ in UNITS[side]:
        for col in ("blue", "red"):
            sp = usp(folder, key, "f7_idle03", "x3", col)
            bb = sp.img.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
            sprites.append((sp, bb, name if col == "blue" else ""))
    gap = 10 * px_per_pt
    f = px_per_pt / 3
    widths = [int((bb[2] - bb[0]) * f) for _, bb, _ in sprites]
    W = sum(widths) + gap * (len(sprites) + 1) + 12 * px_per_pt * (len(sprites) // 2 - 1)
    H = int(96 * px_per_pt)
    can = r2art.ground(W, H, zoom=px_per_pt / 3)
    dr = ImageDraw.Draw(can)
    x = gap
    for i, ((sp, bb, name), w) in enumerate(zip(sprites, widths)):
        im = sp.img.resize((max(1, int(sp.img.width * f)), max(1, int(sp.img.height * f))), Image.LANCZOS)
        foot = int(H - 14 * px_per_pt)
        can.alpha_composite(im, (int(x - bb[0] * f), int(foot - sp.anchor[1] * f)))
        if name:
            dr.text((x, H - 11 * px_per_pt), name, font=artboard.font(22), fill=(250, 248, 240))
        x += w + gap + (12 * px_per_pt if i % 2 == 1 else 0)
    return can


# ---------------------------------------------------------------- texture memory

FRAMES_DIR = {"farmer": 8 + 8 + 10 + 10 + 4 * 8, "mage": 80, "other": 8 + 8 + 10 + 10}   # R1 production counts
DIRS_UNIQUE = 5
CULTURES_KEYS = {"e": ["farmer_e", "spear_e", "xbow_e", "hcav_e", "siege_e", "mage_e"],
                 "w": ["farmer_w", "pike_w", "bow_w", "knight_w", "siege_w", "mage_w"]}
R1_REPORTED = {"3x": (227, 57, 82, 366), "2x": (101, 25, 37, 163), "astc": (25, 6, 9, 41)}
BUILDINGS_MB = {"3x": 82, "2x": 37, "astc": 9}       # buildings are not part of this round: R1 values


def _trim_area(path):
    im = Image.open(path)
    bb = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    return (bb[2] - bb[0]) * (bb[3] - bb[1]) if bb else 0


def _fpd(key):
    return FRAMES_DIR["farmer" if key.startswith("farmer") else "mage" if key.startswith("mage") else "other"]


def areas_r5(side_only=True):
    """Mean trimmed area per unit. side_only: only the side views (East facing 0, West facing 4),
    which is how the R1 samples were taken, so the two are comparable; side views are also the
    widest (spears, lances), so this is the higher estimate."""
    out = {}
    for side in ("e", "w"):
        for key, folder, *_ in UNITS[side]:
            d = unit_dir(folder, key)
            pat = f"{key}_f{SIDE[side]}_*_x3_beauty.png" if side_only else f"{key}_f*_x3_beauty.png"
            fs = glob.glob(str(d / pat))
            out[key] = float(np.mean([_trim_area(p) for p in fs]))
    return out


def areas_r1():
    out = {}
    for key in CULTURES_KEYS["e"] + CULTURES_KEYS["w"]:
        k1 = {"farmer_w": "farmer_e", "mage_w": "mage_e"}.get(key, key)   # R1 had no West peasant or mage
        fs = [p for p in glob.glob(str(R1S / f"{k1}_v*_beauty.png"))]
        out[key] = float(np.mean([_trim_area(p) for p in fs]))
    return out


def memory(areas):
    """MB for (3x RGBA8, 2x RGBA8, 2x ASTC 4x4): units, mask, buildings (R1), total."""
    px = sum(_fpd(k) * a for k, a in areas.items()) * DIRS_UNIQUE      # both cultures
    rows = {}
    for spec, scale, bpp in (("3x", 1.0, 32), ("2x", 4 / 9, 32), ("astc", 4 / 9, 8)):
        u = px * scale * bpp / 8 / 2 ** 20
        m = px * scale * (8 if bpp == 32 else 2) / 8 / 2 ** 20
        b = BUILDINGS_MB[spec]
        rows[spec] = (u, m, b, u + m + b)
    return rows, px / (sum(_fpd(k) for k in areas) * DIRS_UNIQUE)


# ---------------------------------------------------------------- boards

EVAL = []          # (text, colour) filled in after looking at the renders
MEMO_NOTES = []


def roster_board():
    label = "R5-02-兵種總表-A-C精緻度-mobile"
    f1 = formation({"e": "blue", "w": "red"}, 1)
    f2 = formation({"e": "red", "w": "blue"}, 1)
    f3 = formation({"e": "blue", "w": "red"}, 3, crop=(60, 20, 270, 152))
    le, lw = lineup("e"), lineup("w")
    M = 70
    right = 900
    left_w = max(f1.width + 40 + f2.width, f3.width, le.width, lw.width)
    W = M + left_w + 60 + right + M
    heads = ["實際大小：1 pt = 1 px（左：東陸藍、西陸紅；右：顏色對調）",
             "手機像素：1 pt = 3 px（同一場仗的中間一段；東陸藍、西陸紅）",
             "手機像素：1 pt = 3 px，每個兵種藍紅並排（上：東陸，下：西陸）"]
    H = 220 + 60 + f1.height + 60 + 60 + f3.height + 60 + 60 + le.height + 20 + lw.height + 80
    art = Image.new("RGB", (W, max(H, 1800)), BG)
    dr = ImageDraw.Draw(art)
    dr.text((M, 40), label, font=artboard.font(56), fill=INK)
    r2art._wrap(dr, M, 118, "東陸、西陸各 6 種兵，全部是 C 精緻度（D-015），3 倍素材（D-017）。"
                "西陸法師是 R5-01 選定的 B 學院大師。第一次精緻化的兵種：農夫、弩手、長弓兵、長矛兵、霹靂車、投石機，"
                "加上新的西陸農民；和 R1 的差別在另一張放大圖。", GREY, 28, left_w)
    y = 230
    dr.text((M, y), heads[0], font=artboard.font(28), fill=INK)
    y += 50
    art.paste(f1.convert("RGB"), (M, y))
    art.paste(f2.convert("RGB"), (M + f1.width + 40, y))
    y += f1.height + 50
    dr.text((M, y), heads[1], font=artboard.font(28), fill=INK)
    y += 50
    art.paste(f3.convert("RGB"), (M, y))
    y += f3.height + 50
    dr.text((M, y), heads[2], font=artboard.font(28), fill=INK)
    y += 50
    art.paste(le.convert("RGB"), (M, y))
    y += le.height + 16
    art.paste(lw.convert("RGB"), (M, y))
    y_left = y + lw.height + 60
    x0 = M + left_w + 60
    yy = 230
    dr.text((x0, yy), "評估（實際大小）", font=artboard.font(30), fill=INK)
    yy += 52
    for t, c in EVAL:
        yy = r2art._wrap(dr, x0, yy, t, r2art._col(c), 24, right)
    yy += 24
    dr.text((x0, yy), "貼圖記憶體（完整量產，估計）", font=artboard.font(30), fill=INK)
    yy += 52
    yy = memory_table(dr, x0, yy, right)
    art = art.crop((0, 0, W, max(y_left, yy + 40)))
    art.save(OUT / f"{label}.png")
    print("wrote", label)


def memory_table(dr, x0, y, width):
    a5, a1 = areas_r5(), areas_r1()
    m5, mean5 = memory(a5)
    m1, mean1 = memory(a1)
    cols = [20, 330, 470, 610, 760]
    head = ["", "兵種 MB", "遮罩 MB", "建築 MB", "合計 MB"]
    f = artboard.font(22)
    fr = artboard.font(22, weight="regular")
    for c, h in zip(cols, head):
        dr.text((x0 + c, y), h, font=f, fill=INK)
    y += 38
    names = {"3x": "3 倍、未壓縮 RGBA8", "2x": "2 倍、未壓縮 RGBA8", "astc": "2 倍、ASTC 4×4 壓縮"}
    for spec in ("3x", "2x", "astc"):
        dr.text((x0, y), names[spec], font=f, fill=INK)
        y += 34
        for tag, row, col in (("R5（這輪）", m5[spec], INK), ("R1 用同樣算法重算", m1[spec], GREY),
                              ("R1 當時報告", R1_REPORTED[spec], GREY)):
            txt = [tag] + [f"{v:.0f}" for v in row]
            for c, t in zip(cols, txt):
                dr.text((x0 + c, y), t, font=f if tag.startswith("R5") else fr, fill=col)
            y += 32
        y += 12
    MEMO_NOTES.clear()
    MEMO_NOTES.extend(memo_notes(m5, m1, mean5, mean1, a5, a1))
    y += 6
    for t, c in MEMO_NOTES:
        y = r2art._wrap(dr, x0, y, t, r2art._col(c), 22, width)
    return y


def memo_notes(m5, m1, mean5, mean1, a5, a1):
    t5, t1 = m5["3x"][3], m1["3x"][3]
    ratio = (m5["3x"][0] + m5["3x"][1]) / (m1["3x"][0] + m1["3x"][1])
    big = sorted(((a5[k] / a1[k], k) for k in a5), reverse=True)[:3]
    names = {k: n for side in UNITS.values() for k, _, n, *_ in side}
    t_all = memory(areas_r5(side_only=False))[0]["3x"][3]
    out = [(f"3 倍未壓縮合計約 {t5:.0f} MB（R1 用同樣算法重算是 {t1:.0f} MB，R1 當時報告 366 MB）；"
            f"兵種加遮罩是 R1 的 {ratio:.2f} 倍，沒有明顯變大。", "r" if t5 > 1.1 * max(t1, 366) else "g"),
           (f"表裡的 R5 只取側面的影格（和 R1 的取樣一樣，也是最寬的方向）；把右前方向也算進去是 {t_all:.0f} MB。"
            "所以實際約在這兩個數字之間。", "n"),
           ("3 倍未壓縮本來就放不進手機記憶體；量產仍建議 2 倍＋ASTC 壓縮。", "n"),
           (f"平均修邊面積：R5 約 {mean5:.0f} px，R1 約 {mean1:.0f} px（3 倍，依各兵種影格數加權）。", "n"),
           ("變大最多的："
            + "、".join(f"{names[k]} {r:.1f} 倍" for r, k in big) + "（長武器、舉起的工具和更長的罩袍讓修邊框變大）。", "n"),
           ("算法和 R1 相同：影格數 × 平均修邊面積 × 每像素位元組；影格數照 R1 的量產估計"
            "（每方向待機 8、走路 8、攻擊 10、倒下 10，法師 80，農夫另加 32；8 方向裡 3 個用鏡像）。"
            "建築這輪沒改，沿用 R1。", "n")]
    return out


def zoom_sheet():
    label = "R5-02-兵種總表-A-C精緻度-放大"
    cw, M, disp = 1100, 60, 4.5      # cell width px, margin, display pixels per point
    tiles = []
    for side in ("e", "w"):
        for key, folder, name, act, r1, changed in UNITS[side]:
            col = "blue" if side == "e" else "red"
            items = []
            if r1 and (R1S / f"{r1}.json").exists():
                items.append((r5art.sprite(R1S, r1, None, fx=False, team=TEAM_OF[col], glow=False), 3, "R1"))
            items += [(usp(folder, key, "f7_idle03", "x6", col), 6, "R5 待機"),
                      (usp(folder, key, f"f7_{act}", "x6", col, fx=key.startswith("mage")), 6, "R5 動作")]
            ims = []
            for sp, s3, cap in items:
                f = disp / s3
                im = sp.img.resize((max(1, int(sp.img.width * f)), max(1, int(sp.img.height * f))), Image.LANCZOS)
                bb = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
                ims.append((im, bb, sp.anchor[1] * f, cap))
            up = max(anc - bb[1] for im, bb, anc, _ in ims)          # tallest part above the feet
            down = max(bb[3] - anc for im, bb, anc, _ in ims)        # lowest part below the feet
            tiles.append((side, name, ims, up, down, changed, r1 is None))
    cols = 3
    art_rows = [tiles[i:i + cols] for i in range(0, len(tiles), cols)]
    W = M * 2 + cols * cw + (cols - 1) * 40
    heights = [int(max(t[3] for t in row) + max(t[4] for t in row)) + 110 for row in art_rows]
    H = 220 + sum(h + 50 + 120 for h in heights) + 40
    art = Image.new("RGB", (W, H), BG)
    dr = ImageDraw.Draw(art)
    dr.text((M, 40), label, font=artboard.font(56), fill=INK)
    r2art._wrap(dr, M, 118, "每一格：左邊是 R1 的模型，右邊是這輪的 C 版待機與動作，同樣放大（1 pt = 4.5 px，接近雙指放大）；"
                "下面寫和 R1 相比改了什麼。東陸用藍、西陸用紅。", GREY, 28, W - 2 * M)
    y = 220
    for row, th in zip(art_rows, heights):
        foot = max(t[3] for t in row) + 40
        for c, (side, name, ims, up, down, changed, new) in enumerate(row):
            x = M + c * (cw + 40)
            dr.text((x, y), f"{'東陸' if side == 'e' else '西陸'}｜{name}{'（新）' if new else ''}",
                    font=artboard.font(32), fill=INK)
            tile = r2art.ground(cw, th, zoom=disp / 3)
            td = ImageDraw.Draw(tile)
            xx = 24
            for im, bb, anc, cap in ims:
                tile.alpha_composite(im, (int(xx - bb[0]), int(foot - anc)))
                td.text((xx, th - 34), cap, font=artboard.font(22), fill=(250, 248, 240))
                xx += bb[2] - bb[0] + 36
            art.paste(tile.convert("RGB"), (x, y + 50))
            r2art._wrap(dr, x, y + 50 + th + 12, changed, GREY, 24, cw)
        y += th + 50 + 120
    art = art.crop((0, 0, W, y + 20))
    art.save(OUT / f"{label}.png")
    print("wrote", label)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    a5, a1 = areas_r5(), areas_r1()
    for k in a5:
        print(f"{k:10s} R5 {a5[k]:8.0f}  R1 {a1[k]:8.0f}  x{a5[k] / a1[k]:.2f}")
    print(memory(a5)[0]["3x"], memory(a1)[0]["3x"])
    roster_board()
    zoom_sheet()
