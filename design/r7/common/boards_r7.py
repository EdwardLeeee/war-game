"""R7 (D-092) boards: one picture per version, the overview, and a GIF (walk and attack) per version.

python3 design/r7/common/boards_r7.py ART [versions...]
  ART  an extracted art-v4-x3 (version 0: the game's own art, on the game's two-green cells)
  reads design/r7/build/v<k>/ (common/run.py), writes design/r7/out/R7-0<k>-寫實-<k>-<名>-mobile.png,
  R7-99-寫實-總覽.png, R7-0<k>-寫實-<k>-<名>-動作.gif
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
R7 = HERE.parent
sys.path.insert(0, str(R7.parent / "r6" / "common"))
import boards   # noqa: E402
import field    # noqa: E402

BUILD = R7 / "build"
OUT = R7 / "out"
boards.OUT = OUT
PPM = 60
CENTRE = (48.0, 48.0)                  # version 0: the cell under the patch's middle
GROUND = [(86, 116, 64), (92, 123, 69)]          # client/src/render/world.ts GROUND_RGB, GROUND_LIGHT_RGB
# the battlefield (render_r7.scene): (unit, team, x, y metres, facing, animation, frame)
UNITS = [("spear_e", "blue", -3.2, -4.4, 1, "attack", 5), ("xbow_e", "blue", -1.2, -5.2, 1, "attack", 3),
         ("spear_e", "red", 3.0, -4.0, 5, "attack", 2), ("xbow_e", "red", 5.4, -5.0, 5, "idle", 0)]
BARRACKS = (-6.0, 3.0)
FPS = {"walk": 12, "attack": 20, "idle": 8}

NAMES = {
    0: ("現在", "art-v4 原樣：Python 腳本用基本形狀拼的模型、單色材質；地面是遊戲現在的兩種綠格子。"),
    1: ("現在形狀加工序", "模型的形狀不變，頭和頭盔縮到身高的 1/7.5；材質全部換成 CC0 寫實貼圖（布、皮、鐵、木、石、灰泥、瓦），"
        "建築加倒角和靠地面的髒污；換成寫實打光（主光、補光、輪廓光、天空光），拿掉描邊；地面是 CC0 草地、土路、碎石、河岸混合。"),
    2: ("寫實人體底模", "版本 1 再把兵的身體換成 MPFB 的寫實人體（真人比例、手指、臉），衣服貼著身體；盔甲、頭盔、武器沿用。"
        "動作沿用核准過的 idle、walk、attack。"),
    3: ("AI生成", "形狀是 AI 生成（Hunyuan3D 2.1 試用頁），材質是我們的 CC0 材質庫；授權在歐盟、英國、南韓不適用、"
        "月活超過 100 萬要另外申請，正式量產不會用這個。"),
}
LIGHT_NOTE = "注意：版本 1–3 的打光也改了（同一套寫實打光），不只是模型和材質；相機和太陽方向和現在一樣。"


def label(k):
    return f"R7-0{k}-寫實-{k}-{NAMES[k][0]}"


# ---------------------------------------------------------------- version 0 from art-v4

def _checker(w, h, centre):
    s = w / field.SCREEN[0]
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32) / s
    cx, cy = field.pt_to_cell(xs, ys, centre)
    odd = (np.floor(cx) + np.floor(cy)).astype(int) % 2
    img = np.zeros((h, w, 3), np.uint8)
    img[odd == 0] = GROUND[0]
    img[odd == 1] = GROUND[1]
    return Image.fromarray(img, "RGB").convert("RGBA")


def to_cell(x, y):
    return CENTRE[0] + x / 2.0, CENTRE[1] - y / 2.0


def v0_scene(art, size, anchor):
    field.VIEW = "oblique"
    field.ground = lambda w, h, seed=5: _checker(w, h, CENTRE)
    units = []
    for u, team, x, y, f, a, fr in UNITS:
        cx, cy = to_cell(x, y)
        units.append((u, team, cx, cy, f, a, fr, False))
    bx, by = to_cell(*BARRACKS)
    sc = dict(centre=CENTRE, units=units, buildings=[("E", "Barracks", "done", bx - 1.5, by - 1.5, "blue")], nodes=[])
    img, _ = field.render(sc, art, scale=3)
    ox, oy = img.width / 2, img.height / 2               # the patch's middle (CENTRE) at the screen's middle
    x0, y0 = int(round(ox - anchor[0])), int(round(oy - anchor[1]))
    return img.crop((x0, y0, x0 + size[0], y0 + size[1])).convert("RGB")


def v0_frame(art, unit, team, anim, facing, k):
    a = field.Atlas(Path(art) / "units" / unit / f"{unit}.json")
    mirrored = a.m["facings"]["mirrored"]
    f = int(mirrored.get(str(facing), facing))
    body, ax, ay = a.body(f"{unit}_{anim}_f{f}_{k:02d}", team)
    if str(facing) in mirrored:
        body = body.transpose(Image.FLIP_LEFT_RIGHT)
        ax = body.width - ax
    sh = a.shadow(f"{unit}_{anim}_f{facing}_{k:02d}")
    return body, (ax, ay), sh


# ---------------------------------------------------------------- versions 1-3 from their renders

UNIT_ANCHOR = (1.7 * PPM, (1.6 * 0.5 + 2.6 * math.sin(math.radians(60)) + 0.1) * PPM)   # render_r7.unit_frames' camera


def vk_frame(k, unit, team, anim, facing, i):
    p = BUILD / f"v{k}" / f"{unit}_{team}_{anim}_f{facing}_{i:02d}.png"
    return Image.open(p).convert("RGBA"), UNIT_ANCHOR, None


def frame(k, art, unit, team, anim, facing, i):
    return v0_frame(art, unit, team, anim, facing, i) if k == 0 else vk_frame(k, unit, team, anim, facing, i)


def cell_image(k, art, unit, team, anim, facing, i, w=240, h=260, bg=None):
    """One unit frame on a swatch of its version's ground, the feet at (w/2, h - 50)."""
    canvas = (bg.copy() if bg is not None else Image.new("RGBA", (w, h), GROUND[0] + (255,))).convert("RGBA")
    body, (ax, ay), sh = frame(k, art, unit, team, anim, facing, i)
    fx, fy = w // 2, h - 50
    if sh is not None:
        im, sax, say = sh
        canvas.alpha_composite(im, (int(round(fx - sax)), int(round(fy - say))))
    canvas.alpha_composite(body, (int(round(fx - ax)), int(round(fy - ay))))
    return canvas


def ground_swatch(k, w, h):
    """A piece of the version's own battlefield ground (an empty spot of the scene) behind the unit cells."""
    sc = Image.open(BUILD / f"v{k}" / "scene_x3.png").convert("RGBA") if k else None
    if sc is None:
        return Image.new("RGBA", (w, h), GROUND[0] + (255,))
    meta = json.loads((BUILD / f"v{k}" / "scene_x3.json").read_text())
    ax, ay = meta["anchor"]
    # a clean strip of grass in the south-west corner (2.4 m deep), repeated down the swatch
    x, y = int(ax - 9.5 * PPM), int(ay + 6.6 * PPM * 0.5)
    x = min(max(x, w // 2), sc.width - w // 2)
    band = sc.crop((x - w // 2, y - 36, x + w // 2, y + 36))
    out = Image.new("RGBA", (w, h))
    for k in range(0, h, band.height):
        out.paste(band if (k // band.height) % 2 == 0 else band.transpose(Image.FLIP_TOP_BOTTOM), (0, k))
    return out


def strip(k, art, scale=1.0):
    """The four units side by side (spear and crossbow, blue and red), idle, at 3x or shrunk to actual size."""
    sw = ground_swatch(k, 240, 260)
    cells = [cell_image(k, art, u, t, "idle", f, 0, bg=sw)
             for u, t, f in (("spear_e", "blue", 1), ("xbow_e", "blue", 1), ("spear_e", "red", 5), ("xbow_e", "red", 5))]
    W = sum(c.width for c in cells)
    out = Image.new("RGBA", (W, cells[0].height))
    x = 0
    for c in cells:
        out.paste(c, (x, 0))
        x += c.width
    if scale != 1.0:
        out = out.resize((round(out.width * scale), round(out.height * scale)), Image.LANCZOS)
    return out.convert("RGB")


def gif(k, art):
    sw = ground_swatch(k, 240, 260)
    frames = []
    for t in range(40):                                     # 2 s at 20 frames a second
        row = []
        for u in ("spear_e", "xbow_e"):
            row.append(cell_image(k, art, u, "blue", "walk", 1, int(t * FPS["walk"] / 20) % 8, bg=sw))
            row.append(cell_image(k, art, u, "blue", "attack", 1, t % 10, bg=sw))
        im = Image.new("RGB", (sum(c.width for c in row), row[0].height))
        x = 0
        for c in row:
            im.paste(c.convert("RGB"), (x, 0))
            x += c.width
        frames.append(im)
    dr = [ImageDraw.Draw(f) for f in frames]
    for d in dr:
        for i, txt in enumerate(("槍兵 walk", "槍兵 attack", "弩手 walk", "弩手 attack")):
            d.text((8 + i * 240, 6), txt, font=boards.font(18), fill=(255, 255, 255))
    p = OUT / f"{label(k)}-動作.gif"
    OUT.mkdir(parents=True, exist_ok=True)
    frames[0].save(p, save_all=True, append_images=frames[1:], duration=50, loop=0, optimize=True)
    print("wrote", p.name)
    return frames[0]


def scene_of(k, art, ref):
    if k == 0:
        return v0_scene(art, ref["size"], ref["anchor"])
    return Image.open(BUILD / f"v{k}" / "scene_x3.png").convert("RGB")


def board(k, art, ref, cost):
    sc = scene_of(k, art, ref)
    W = max(sc.width + 2 * boards.M, 1900)
    name, what = NAMES[k]
    text = f"版本 {k}「{name}」：{what}\n{cost}"
    if k:
        text += "\n" + LIGHT_NOTE
    text += ("\n同一塊 12×8 格的地面、一座兵營、東陸槍兵與弩手（藍＝我方、紅＝敵方），方形斜看。上：手機像素（3 倍）；"
             "中：實際大小（1 pt = 1 px，兵約 31 pt 高）；下：四名兵並排，3 倍和實際大小。")
    parts = [boards.header(W, label(k) + "-mobile", text)]
    parts.append(boards.row([boards.captioned(sc, "手機像素（3 倍）", 26)], W))
    act = sc.resize((round(sc.width / 3), round(sc.height / 3)), Image.LANCZOS)
    parts.append(boards.row([boards.captioned(act, "實際大小", 26)], W))
    s3, s1 = strip(k, art), strip(k, art, 1 / 3)
    parts.append(boards.row([boards.captioned(s3, "四名兵（3 倍）：槍兵藍、弩手藍、槍兵紅、弩手紅", 24),
                             boards.captioned(s1, "實際大小", 24)], W))
    return boards.save(boards.stack(parts, W), label(k) + "-mobile"), act, s1


COST = {
    0: "代價：不用重做。圖集照 art-v4 實測：兵 12 種 3 倍未壓縮 309 MB、2 倍 ASTC 36 MB；建築每個文化 3 倍約 46 MB。",
    1: "代價（估計）：12 種兵 1.5–2 天（補材質對應、頭的比例、全部動作重算並逐張檢查）、14 種建築 1–1.5 天、城牆 0.5 天、"
       "資源點 0.5 天、地形 0.5 天、地面 1 天（做成可以無縫重複的地面圖塊加混合遮罩給 client）；合計約 5–6 天加 CI。"
       "圖集：影格大小和現在一樣，記憶體約不變（兵 2 倍 ASTC 約 36 MB），地面多一頁約 1–2 MB（ASTC）。授權：CC0，沒有限制。",
    2: "代價（估計）：12 種兵 4–6 天（每種兵的衣服貼身要逐一調；長袍、裙甲、騎兵的騎手要重做；馬沒有寫實底模，要另找 CC0 的馬或沿用現在的）、"
       "建築、城牆、資源點、地形、地面同版本 1（約 3.5–4 天）；合計約 8–10 天加 CI。圖集約不變。授權：MPFB 的人體素材 CC0，沒有限制。",
    3: "代價（估計，這次實測）：AI 生成一個形狀約 20 秒（試用頁不登入只能生成形狀，加貼圖要 270 秒 GPU，超過免費額度）；"
       "放回原位、分部位、綁骨架的程式約 2 秒，但手動修正（手臂和身體長在一起、伸手時拉出一片）一個兵花了約 20 分鐘試，還沒修乾淨。"
       "12 種兵、14 種建築估計 6–9 天。完整的 AI 貼圖要付費方案（HF PRO 約每月 9 美元，或 Meshy、Tripo 的付費方案），"
       "要不要花由使用者看過比較再決定。弩手沒有用 AI 生成（brief 只要槍兵和兵營），沿用版本 2。",
}


def main(art, versions):
    ref = json.loads((BUILD / "v1" / "scene_x3.json").read_text())
    acts = {}
    for k in versions:
        _, act, s1 = board(k, art, ref, COST.get(k, ""))
        acts[k] = (act, s1)
        gif(k, art)
    W = boards.M * 2 + 2 * (max(a.width for a, _ in acts.values()) + 40)
    parts = [boards.header(W, "R7-99-寫實-總覽", "四個版本並排，實際大小（1 pt = 1 px）。每格下面是四名兵並排（實際大小）。"
                          + LIGHT_NOTE)]
    ks = sorted(acts)
    for i in range(0, len(ks), 2):
        cells = []
        for k in ks[i:i + 2]:
            a, s1 = acts[k]
            col = Image.new("RGB", (max(a.width, s1.width), a.height + s1.height + 10), boards.BG)
            col.paste(a, (0, 0))
            col.paste(s1, (0, a.height + 10))
            cells.append(boards.captioned(col, f"{k}「{NAMES[k][0]}」", 26))
        parts.append(boards.row(cells, W))
    boards.save(boards.stack(parts, W), "R7-99-寫實-總覽")


if __name__ == "__main__":
    main(sys.argv[1], [int(v) for v in sys.argv[2:]] or [0, 1, 2])
