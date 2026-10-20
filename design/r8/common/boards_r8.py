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
    "spear_e": "東陸槍兵：MPFB 寫實人體（真人比例、手握住槍桿），札甲、尖盔、靛藍衣，玩家色是包住腰下一圈的裙甲和背旗。",
    "bow_e": "東陸弓手（新兵種，東陸改拿弓）：弩手的東陸服裝（赭色長衣、漆背心、黑帽），左手一把東方反曲弓（1.25 m，弓梢反翹），"
             "右腰箭袋；拉弓放箭沿用長弓兵核准的動作，弓弦跟著右手拉開、搭箭，放箭後箭由遊戲另外畫。玩家色是一圈裙子和背旗。",
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


if __name__ == "__main__":
    main(sys.argv[1:])
