"""R8 (D-093) approval drafts for the units: one board per unit, a GIF of its animations, and the readability numbers
measured on every frame of every direction (not a sample: the brief's must-pass rule).

python3 design/r8/common/boards_r8.py UNIT ATLAS_DIR [UNIT ATLAS_DIR ...]
  ATLAS_DIR  the unit's 3x atlas (atlas_x3/ with <unit>.json: the production pipeline with R7_VERSION=8)
  writes design/r8/out/R8-<nn>-<名>-<東陸|西陸>-mobile.png, ...-動作.gif, and design/r8/out/readability.json

Readability, per frame and per team colour (blue, red), on the R8 ground graded by GRADE (a clean stretch of grass):
  contrast   |L*(unit) - L*(ground)|: the soldier's mean lightness against the ground's (CIE L*, 0-100)
  visible    the share of the soldier's pixels at least 20 apart from the ground's colour (CIE Lab, delta E 1976):
             lightness and colour both count (blue and red on green read by hue as much as by lightness)
  team       the share of the soldier's pixels in the player colour (the team layer's coverage)
GRADE is the ground's "grade" in client's ground.json (agreed 2026-10-21): linear RGB, saturation toward the
luminance, then brightness. 1.1 / 0.85 measured best on the East archer (lightness gap up, colour gap held).
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
R8 = HERE.parent
sys.path.insert(0, str(R8.parent / "r6" / "common"))
import boards   # noqa: E402
import field    # noqa: E402

OUT = R8 / "out"
BUILD = R8 / "build"
boards.OUT = OUT
PPM = 60
FACINGS = range(8)
GRADE = dict(brightness=1.1, saturation=0.85)
# the units' numbers and names on the boards (the brief's table)
UNITS = {
    "farmer_e": (1, "村民", "東陸"), "farmer_w": (2, "村民", "西陸"), "spear_e": (3, "槍兵", "東陸"),
    "pike_w": (4, "長矛兵", "西陸"), "bow_e": (5, "弓手", "東陸"), "bow_w": (6, "長弓兵", "西陸"),
    "hcav_e": (7, "具裝騎兵", "東陸"), "knight_w": (8, "騎士", "西陸"), "siege_e": (9, "霹靂車", "東陸"),
    "siege_w": (10, "投石機", "西陸"), "mage_e": (11, "術士", "東陸"), "mage_w": (12, "晶術師", "西陸"),
}
WHAT = {
    "spear_e": "東陸槍兵（唐末五代的樣子，照 ceo 的考據筆記）：MPFB 寫實人體；札甲（一排排小甲片）、三層披膊、及膝腿裙，"
               "碗形兜鍪加頓項，甲下圓領袍，行縢加靴，左腰直的橫刀；雙手持槍，紮槍由後手推。玩家色是袍子（袖子、袍腳）和頓項。",
    "bow_e": "東陸弓手（唐末五代的樣子，照 ceo 的考據筆記）：MPFB 寫實人體；圓領缺胯袍、黑革帶、黑色軟幞頭，右腰有蓋的胡祿、"
             "左腰弓袋，行縢加靴；角弓上下對稱、握中間。拉弓拉到臉頰，放箭時手往耳後甩；弓弦跟著右手，放箭後箭由遊戲另外畫。"
             "玩家色是袍子。",
}
# the reference pictures beside each board (ceo's note, research/east-reference/: R8_REFS points there; only the
# public-domain and CC0 ones, LICENSES.md: the CC BY-SA ones stay out of the repo and the pictures) and the points
# taken from them, each with how well it is known: 一手 (period text, object or picture), 二手 (modern work), 推論
# (inferred), 設計選擇 (ours)
REFS = {
    "spear_e": dict(
        images=[
            ("01-張議潮統軍出行圖-甲騎旗隊與樂舞.jpg", (1000, 880, 1560, 1260),
             "圖 01　敦煌莫高窟 156 窟〈張議潮統軍出行圖〉局部（約 851–867 年）：甲騎的札甲畫成一排排橫條，兜鍪連頓項包住頭和後頸，"
             "槍豎著拿。公有領域（PD-Art），Wikimedia Commons。"),
            ("06-前蜀永陵-抬棺力士背面-兜鍪頓項.jpg", (900, 240, 1920, 1350),
             "圖 06　前蜀王建墓（永陵，918 年）抬棺力士背面：碗形兜鍪，後面垂一大片頓項蓋住後頸到肩。"
             "CC0，攝影 Gary Todd，Wikimedia Commons。"),
            ("04-榆林窟25窟-中唐甲士-長牌與札甲.jpg", (384, 256, 1056, 1376),
             "圖 04　榆林窟 25 窟（中唐，781–848 年）甲士：札甲的排數、披膊、腿裙一段一段分開。公有領域（PD-Art），Wikimedia Commons。"),
        ],
        points=[
            "① 札甲：一排排小甲片用繩子串起來；甲身、三層披膊、及膝的腿裙前面開口。〔一手：圖 01、04，唐代甲片實物〕拿掉整片上漆的板甲和方方的肩板。",
            "② 兜鍪加頓項：碗形鐵盔，頂上一顆小圓珠；後面和兩側垂頓項，蓋住後頸、耳朵和肩頭，臉露出來。〔一手：圖 06、04〕"
            "頓項做成布、用玩家色，是設計選擇〔筆記：布或甲片都有〕。拿掉盔纓和三層階梯形的頸甲。",
            "③ 甲下穿圓領袍：袖子、甲裙下的袍腳到小腿，兩側開衩。〔一手：《新唐書·車服志》「缺骻衫」〕"
            "袍子用玩家色：一支部隊一個顏色合乎史實〔一手：李克用的「鴉軍」皆衣黑〕。",
            "④ 雙手持槍：後手握在離槍尾 0.5 m，前手在槍桿上；紮槍由後手推，槍桿從前手裡滑過去。"
            "〔推論：《太白陰經》只有兩成配盾；沒有找到畫雙手刺槍的圖〕",
            "⑤ 槍全長 3 m，素木桿，細長的葉形槍頭，拿掉槍上的大纓。〔長度是設計選擇；一手：《唐六典》「木槍長，步兵用之」〕",
            "⑥ 左腰掛直的橫刀，環首。〔一手：《唐六典》「橫刀，佩刀也，兵士所佩」；唐代環首刀實物〕",
            "⑦ 小腿綁行縢，穿靴。〔一手：《新唐書·兵志》、《舊唐書·輿服志》〕　⑧ 拿掉背旗：旗由旗手拿。〔筆記〕",
        ]),
    "bow_e": dict(
        images=[
            ("01-張議潮統軍出行圖-甲騎旗隊與樂舞.jpg", (0, 450, 560, 960),
             "圖 01　同一幅〈出行圖〉局部：沒穿甲的隨行和樂隊，圓領長袍、頭包黑色幞頭（壁畫很小，細節看不清）。"
             "公有領域（PD-Art），Wikimedia Commons。"),
            ("02-敦煌晚唐壁畫-持長牌步兵出城-出處待查.jpg", (400, 640, 654, 992),
             "圖 02　敦煌晚唐壁畫（哪一窟待查，只當晚唐敦煌畫風參考）：出城的隊伍，圓領長袍、黑色幞頭。公有領域（PD-Art），Wikimedia Commons。"),
        ],
        points=[
            "① 角弓：上下對稱，握在正中間；彎的那段短，弓梢長而直、往前翹；上弦後全長 1.22 m。"
            "〔二手：Selby；長度是推論，筆記建議 1.2–1.4 m〕這批參考圖裡沒有清楚的唐五代弓，形狀照文字做。",
            "② 拉弓：右手拉到臉頰、手肘抬在後面，放箭時手往耳後甩；手指勾弦，不做扳指。〔一手：《射經》的「中國法」；動作是設計〕",
            "③ 圓領缺胯袍到小腿，兩側開衩，黑革帶。〔一手：《新唐書·車服志》；圖 01、02〕袍子用玩家色（同槍兵）。",
            "④ 黑色軟幞頭：包住頭頂的髻，後面垂兩條軟腳。〔一手：《新唐書·車服志》、《夢溪筆談》、《宋史·輿服志》：五代是軟腳或略硬的短腳〕"
            "不戴紅抹額：紅色會和紅方的玩家色混在一起。",
            "⑤ 右腰有蓋的胡祿（看不到箭），左腰空的弓袋。〔一手：《新唐書·兵志》「弓一，矢三十，胡祿」；掛法是二手：Dwyer〕",
            "⑥ 小腿綁行縢，穿靴。　⑦ 拿掉：漆背心、黑圓帽、背旗、開口的箭袋。",
        ]),
}
# what is still missing next to Age of Empires and StarCraft (honest; on every board)
GAP = ("和世紀帝國、星海爭霸比還差：①貼圖是現成的 CC0 照片材質平鋪，不是美術依模型畫的貼圖，所以沒有手繪的磨損、縫線、刻紋；"
       "②模型的盔甲、衣服是程式拼的形狀，沒有雕刻的褶皺和厚度；③動作是逐格的關節角度，沒有動作捕捉的重心和慣性；"
       "④31 pt 的大小下，這些細節大多看不到，能拉近的主要是光、材質、輪廓和玩家色。")


def _lin(rgb):
    c = rgb / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lab(rgb):
    """sRGB (n, 3) 0-255 -> CIE Lab (D65)."""
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = _lin(rgb) @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])], 1)


def graded(img):
    """The ground with GRADE applied (what the client draws)."""
    a = np.asarray(img.convert("RGBA"), np.float32)
    lin = _lin(a[..., :3])
    Y = (lin @ np.array([0.2126, 0.7152, 0.0722]))[..., None]
    lin = (Y + (lin - Y) * GRADE["saturation"]) * GRADE["brightness"]
    out = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.clip(lin, 0, None) ** (1 / 2.4) - 0.055)
    a[..., :3] = np.clip(out * 255, 0, 255)
    return Image.fromarray(a.astype(np.uint8), "RGBA")


def ground():
    im = graded(Image.open(BUILD / "ground" / "ground_x3.png"))
    meta = json.loads((BUILD / "ground" / "ground_x3.json").read_text())
    return im, meta


def swatch(w, h):
    """A clean strip of the R8 ground's grass (south-west of the patch), repeated to w x h."""
    im, meta = ground()
    ax, ay = meta["anchor"]
    x, y = int(ax - 9.5 * PPM), int(ay + 6.6 * PPM * 0.5)
    x = min(max(x, w // 2), im.width - w // 2)
    band = im.crop((x - w // 2, y - 36, x + w // 2, y + 36))
    out = Image.new("RGBA", (w, h))
    for k in range(0, h, band.height):
        out.paste(band if (k // band.height) % 2 == 0 else band.transpose(Image.FLIP_TOP_BOTTOM), (0, k))
    return out


def frame(a, unit, anim, facing, k, team):
    mirrored = a.m["facings"]["mirrored"]
    f = int(mirrored.get(str(facing), facing))
    name = f"{unit}_{anim}_f{f}_{k:02d}"
    if name not in a.m["frames"]:
        return None
    body, ax, ay = a.body(name, team)
    if str(facing) in mirrored:
        body = body.transpose(Image.FLIP_LEFT_RIGHT)
        ax = body.width - ax
    sh = a.shadow(f"{unit}_{anim}_f{facing}_{k:02d}")
    return body, (ax, ay), sh


def team_share(a, unit, anim, facing, k):
    mirrored = a.m["facings"]["mirrored"]
    f = int(mirrored.get(str(facing), facing))
    name = f"{unit}_{anim}_f{f}_{k:02d}"
    col = a._crop("color", "frames", name)
    t = a._crop("team", "team", name) if "team" in a.pages else None
    if col is None:
        return None
    ca = np.asarray(col[0], np.float32)[..., 3] / 255.0
    if t is None:
        return 0.0
    ti, tax, tay = t
    canvas = Image.new("L", col[0].size, 0)
    canvas.paste(ti.getchannel("A"), (int(round(col[1] - tax)), int(round(col[2] - tay))))
    ta = np.asarray(canvas, np.float32) / 255.0
    body = ca > 0.5
    return float((ta[body] > 0.5).sum() / max(body.sum(), 1))


def measure(unit, a, ground_lab):
    """Every frame of every animation in every direction, both teams."""
    rows = []
    for anim, d in a.m["anims"].items():
        for facing in FACINGS:
            for k in range(d["frames"]):
                ts = team_share(a, unit, anim, facing, k)
                if ts is None:
                    continue
                rec = dict(anim=anim, facing=facing, frame=k, team=ts)
                for team in ("blue", "red"):
                    body, _, _ = frame(a, unit, anim, facing, k, team)
                    px = np.asarray(body, np.float32)
                    m = px[..., 3] > 128
                    L = lab(px[m][:, :3])
                    rec[f"contrast_{team}"] = float(abs(L[:, 0].mean() - ground_lab[0]))
                    rec[f"visible_{team}"] = float((np.linalg.norm(L - ground_lab, axis=1) >= 20).mean())
                rows.append(rec)
    return rows


def summary(rows):
    out = {}
    for key in ("contrast_blue", "contrast_red", "visible_blue", "visible_red", "team"):
        vals = [r[key] for r in rows]
        lo, hi = min(vals), max(vals)
        r_lo = min(rows, key=lambda r: r[key])
        out[key] = dict(min=round(lo, 3), max=round(hi, 3), min_at=f"{r_lo['anim']} 朝向 {r_lo['facing']} 第 {r_lo['frame']} 格")
    out["frames"] = len(rows)
    return out


def cell(a, unit, anim, facing, k, team, bg):
    canvas = bg.copy()
    got = frame(a, unit, anim, facing, k, team)
    if got is None:
        return canvas
    body, (ax, ay), sh = got
    fx, fy = canvas.width // 2, canvas.height - 50
    if sh is not None:
        im, sax, say = sh
        canvas.alpha_composite(im, (int(round(fx - sax)), int(round(fy - say))))
    canvas.alpha_composite(body, (int(round(fx - ax)), int(round(fy - ay))))
    return canvas


def strip(cells, scale=1.0):
    W = sum(c.width for c in cells)
    out = Image.new("RGBA", (W, cells[0].height))
    x = 0
    for c in cells:
        out.paste(c, (x, 0))
        x += c.width
    if scale != 1.0:
        out = out.resize((round(out.width * scale), round(out.height * scale)), Image.LANCZOS)
    return out.convert("RGB")


def faceoff(a, unit, bg_full):
    """Same culture, blue against red: four a side, facing each other, on the R8 ground (3x crop)."""
    g, meta = bg_full
    ax, ay = meta["anchor"]
    img = g.copy()
    spots = [(-3.5, -3.0), (-2.6, -4.6), (-4.4, -5.6), (-3.0, -6.4)]
    items = []
    for x, y in spots:
        items.append(("blue", x, y, 1))
        items.append(("red", -x + 1.0, y + 0.3, 5))
    anims = list(a.m["anims"])
    use = "attack" if "attack" in anims else anims[0]
    for team, x, y, f in sorted(items, key=lambda t: -t[2]):
        got = frame(a, unit, use, f, 3, team) or frame(a, unit, anims[0], f, 0, team)
        if got is None:
            continue
        body, (bx, by), sh = got
        px, py = ax + x * PPM, ay - y * PPM * 0.5
        if sh is not None:
            im, sax, say = sh
            img.alpha_composite(im, (int(round(px - sax)), int(round(py - say))))
        img.alpha_composite(body, (int(round(px - bx)), int(round(py - by))))
    x0, y0 = int(ax - 7.0 * PPM), int(ay - 2.0 * PPM * 0.5)
    y1 = min(img.height, int(ay + 7.6 * PPM * 0.5))
    return img.crop((x0, y0, x0 + int(15.0 * PPM), y1)).convert("RGB")


def refrow(unit, W):
    """The reference pictures and the points (REFS), or None without R8_REFS."""
    import os
    ref = REFS.get(unit)
    folder = os.environ.get("R8_REFS")
    if not ref or not folder:
        return None
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    tiles = []
    for name, box, caption in ref["images"]:
        im = Image.open(Path(folder) / name).convert("RGB").crop(box)
        h = 560
        im = im.resize((round(im.width * h / im.height), h), Image.LANCZOS)
        w = max(im.width, 420)
        th = boards.wrap(probe, 0, 0, caption, w, size=22) + 10
        tile = Image.new("RGB", (w, h + th + 12), boards.BG)
        tile.paste(im, (0, 0))
        boards.wrap(ImageDraw.Draw(tile), 0, h + 12, caption, w, size=22)
        tiles.append(tile)
    text = "\n".join(ref["points"])
    th = boards.wrap(probe, 0, 0, text, W - 2 * boards.M, size=26) + 20
    gap = 30
    inner = Image.new("RGB", (sum(t.width for t in tiles) + gap * (len(tiles) - 1), max(t.height for t in tiles)),
                      boards.BG)
    x = 0
    for t in tiles:
        inner.paste(t, (x, 0))
        x += t.width + gap
    top = boards.row([boards.captioned(inner, "參考（文物和壁畫，只當參考：照著重新做 3D，圖不放進遊戲）", 26)], W)
    out = Image.new("RGB", (W, top.height + th + 20), boards.BG)
    out.paste(top, (0, 0))
    boards.wrap(ImageDraw.Draw(out), boards.M, top.height, text, W - 2 * boards.M, size=26, fill=boards.INK)
    return out


def board(unit, a, nums):
    n, name, side = UNITS[unit]
    label = f"R8-{n:02d}-{name}-{side}"
    bg = swatch(240, 270)
    s = nums
    text = (f"{WHAT.get(unit, '')}\n"
            f"好不好認（程式量，{s['frames']} 格＝全部動作 × 8 個方向的每一格，藍紅各量一次）："
            f"兵和地面的亮度差 ΔL* 藍 {s['contrast_blue']['min']:.0f}–{s['contrast_blue']['max']:.0f}、紅 {s['contrast_red']['min']:.0f}–{s['contrast_red']['max']:.0f}"
            f"（最低在 {s['contrast_blue']['min_at']}）；和地面色差 ΔE 20 以上的像素 藍 {s['visible_blue']['min']:.0%}–{s['visible_blue']['max']:.0%}、"
            f"紅 {s['visible_red']['min']:.0%}–{s['visible_red']['max']:.0%}；玩家色佔兵的面積 {s['team']['min']:.0%}–{s['team']['max']:.0%}"
            f"（最低在 {s['team']['min_at']}）。\n{GAP}\n"
            "上：8 個方向（idle，3 倍）；中：每個動作（朝向 1，3 倍）；下：同文化藍紅對上（3 倍和實際大小）、8 個方向實際大小。")
    W = 2500
    parts = [boards.header(W, label + "-mobile", text)]
    refs = refrow(unit, W)
    if refs is not None:
        parts.append(refs)
    parts.append(boards.row([boards.captioned(strip([cell(a, unit, "idle", f, 0, "blue", bg) for f in FACINGS]),
                                              "8 個方向（藍）", 24)], W))
    for anim, d in a.m["anims"].items():
        k = list(range(d["frames"]))[:10]
        parts.append(boards.row([boards.captioned(strip([cell(a, unit, anim, 1, i, "blue", bg) for i in k]),
                                                  f"{anim}（{d['frames']} 格）", 24)], W))
    fo = faceoff(a, unit, ground())
    parts.append(boards.row([boards.captioned(fo, "同文化藍紅對上（3 倍）", 24),
                             boards.captioned(fo.resize((fo.width // 3, fo.height // 3), Image.LANCZOS), "實際大小", 24)], W))
    parts.append(boards.row([boards.captioned(strip([cell(a, unit, "idle", f, 0, t, bg) for t in ("blue", "red")
                                                     for f in (1, 3, 5, 7)], 1 / 3), "實際大小：藍、紅各 4 個方向", 24)], W))
    p = boards.save(boards.stack(parts, W), label + "-mobile")
    # the GIF: every animation, facings 1 and 7
    frames = []
    for t in range(40):
        row = []
        for f in (1, 7):
            for anim, d in a.m["anims"].items():
                fps = d.get("fps", 12)
                i = int(t * fps / 20) % d["frames"] if d.get("loop") else min(int(t * fps / 20), d["frames"] - 1)
                row.append(cell(a, unit, anim, f, i, "blue", bg))
        frames.append(strip(row, 0.6))
    g = OUT / f"{label}-動作.gif"
    frames[0].save(g, save_all=True, append_images=frames[1:], duration=50, loop=0, optimize=True)
    print("wrote", g.name)
    return p


def main(args):
    OUT.mkdir(parents=True, exist_ok=True)
    g, meta = ground()
    sw = np.asarray(swatch(240, 270), np.float32)
    ground_lab = lab(sw[..., :3].reshape(-1, 3)).mean(0)
    report = {"ground_lab": [round(float(v), 1) for v in ground_lab], "grade": GRADE}
    rp = OUT / "readability.json"
    if rp.exists():
        report.update(json.loads(rp.read_text()))
    for unit, adir in zip(args[0::2], args[1::2]):
        a = field.Atlas(Path(adir) / f"{unit}.json")
        rows = measure(unit, a, ground_lab)
        s = summary(rows)
        report[unit] = s
        board(unit, a, s)
        print(unit, s)
    rp.write_text(json.dumps(report, ensure_ascii=False, indent=1))
    overview({u: field.Atlas(Path(d) / f"{u}.json") for u, d in zip(args[0::2], args[1::2])})



def overview(atlases):
    """R8-99: the units of this batch together, blue against red on the R8 ground, 3x and actual size, with the
    readability numbers of each (readability.json)."""
    g, meta = ground()
    ax, ay = meta["anchor"]
    img = g.copy()
    units = list(atlases)
    items = []
    for i, u in enumerate(units):
        for j in range(3):
            items.append((u, "blue", -4.6 + 1.0 * j, -2.4 - 1.6 * i, 1))
            items.append((u, "red", 2.6 + 1.0 * j, -2.0 - 1.6 * i, 5))
    for u, team, x, y, f in sorted(items, key=lambda t: -t[3]):
        a = atlases[u]
        got = frame(a, u, "attack", f, 4, team)
        if got is None:
            continue
        body, (bx, by), sh = got
        px, py = ax + x * PPM, ay - y * PPM * 0.5
        if sh is not None:
            im, sax, say = sh
            img.alpha_composite(im, (int(round(px - sax)), int(round(py - say))))
        img.alpha_composite(body, (int(round(px - bx)), int(round(py - by))))
    x0, y0 = int(ax - 7.0 * PPM), int(ay - 1.5 * PPM * 0.5)
    y1 = min(img.height, int(ay + (2.4 + 1.6 * len(units)) * PPM * 0.5 + 40))
    crop = img.crop((x0, y0, x0 + int(14.0 * PPM), y1)).convert("RGB")
    rep = json.loads((OUT / "readability.json").read_text())
    names = "、".join(f"{UNITS[u][2]}{UNITS[u][1]}" for u in units)
    lines = [f"{UNITS[u][2]}{UNITS[u][1]}：ΔL* {rep[u]['contrast_blue']['min']:.0f}–{rep[u]['contrast_blue']['max']:.0f}、色差 ΔE≥20 "
             f"{rep[u]['visible_blue']['min']:.0%}–{rep[u]['visible_blue']['max']:.0%}、玩家色 {rep[u]['team']['min']:.0%}–{rep[u]['team']['max']:.0%}"
             for u in units]
    W = 2500
    text = (f"這一批：{names}。左邊藍、右邊紅，同文化對上（攻擊的姿勢），寫實地面（地面調色 亮度 {GRADE['brightness']}、彩度 {GRADE['saturation']}）。\n"
            "好不好認（全部方向全部影格，最小–最大）：" + "；".join(lines) + "。\n" + GAP)
    parts = [boards.header(W, "R8-99-兵-總覽", text)]
    parts.append(boards.row([boards.captioned(crop, "手機像素（3 倍）", 26)], W))
    parts.append(boards.row([boards.captioned(crop.resize((crop.width // 3, crop.height // 3), Image.LANCZOS),
                                              "實際大小（兵約 31 pt）", 26)], W))
    return boards.save(boards.stack(parts, W), "R8-99-兵-總覽")


if __name__ == "__main__":
    main(sys.argv[1:])
