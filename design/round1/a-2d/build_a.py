"""A 彩繪桌遊: regenerate every A output with one command.

python3 a-2d/build_a.py [scene] [mage]
  scene -> out/R1-01-畫面風格-A-彩繪桌遊-mobile.png
  mage  -> build/a/mage_frames/ + out/...-法師動畫.gif + out/...-法師關鍵影格.png
"""
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "common"))
sys.path.insert(0, str(HERE))

import numpy as np                      # noqa: E402
from PIL import Image, ImageFilter      # noqa: E402

import artboard     # noqa: E402
import buildings_a  # noqa: E402
import compose      # noqa: E402
import config       # noqa: E402
import gif          # noqa: E402
import hud          # noqa: E402
import mage_a       # noqa: E402
import mage_sheet   # noqa: E402
import magic        # noqa: E402
import names        # noqa: E402
import paint as pt  # noqa: E402
import scene        # noqa: E402
import stage        # noqa: E402
import terrain_a    # noqa: E402
import units_a      # noqa: E402

OPT = "A"
A = config.BUILD / "a"
S = config.SCALE
W, H = compose.W, compose.H
STYLE = dict(line=pt.OUTLINE, ring_w=2.0, dust=(0.86, 0.72, 0.5), dust_alpha=0.3, shaft=(0.55, 0.36, 0.18),
             fletch=(1, 1, 1), stone=(0.66, 0.63, 0.58), spark=(1, 0.95, 0.6))


def cast_shadow(img, anchor, strength=0.3, color=(34, 70, 30)):
    """Sun from the upper left: project the silhouette onto the ground toward the lower right."""
    ay = anchor[1]
    a = img.split()[3]
    arr = np.asarray(a).copy()
    arr[int(ay):, :] = 0                    # only what stands above the ground line casts a shadow
    pad_w = int(img.height * 1.2)
    big = Image.new("L", (img.width + pad_w, img.height + int(img.height * 0.4)), 0)
    big.paste(Image.fromarray(arr), (0, 0))
    # shadow point: x' = x + 0.55 (ay - y), y' = ay + 0.25 (ay - y); PIL wants the inverse mapping
    sh = big.transform(big.size, Image.AFFINE, (1, -2.2, 2.2 * ay, 0, -4, 5 * ay), resample=Image.BILINEAR)
    sh = sh.filter(ImageFilter.GaussianBlur(2 * S))
    arr = np.asarray(sh, np.float32) / 255 * strength
    rgb = np.empty(arr.shape + (3,), np.float32)
    rgb[:] = color
    return compose.Sprite(compose.to_img(rgb, arr), anchor)


class SourceA:
    def __init__(self):
        self.cache = {}

    def _get(self, o):
        k = (o["kind"], o["anim"], o["frame"], o["variant"], o["team"])
        if k not in self.cache:
            kind = o["kind"]
            if o["cat"] == "unit":
                base, mask, anchor, top = units_a.draw(kind, o["anim"], o["frame"], o["variant"], k=S)
            else:
                base, mask, anchor = buildings_a.draw(kind, o["variant"], k=S)
            img = pt.flat_recolor(base, mask, config.TEAM[o["team"]]) if o["team"] else base
            self.cache[k] = compose.Sprite(img, anchor)
        return self.cache[k]

    def sprite(self, o):
        flip = o["cat"] == "unit" and o["facing"] in (3, 4, 5)
        return self._get(o), flip

    def shadow(self, o):
        if o["cat"] in ("building", "tree"):
            sp = self._get(o)
            return cast_shadow(sp.img, sp.anchor, 0.28 if o["cat"] == "tree" else 0.32), False
        return None

    def fx(self, o):
        return None


def build_scene_image():
    A.mkdir(parents=True, exist_ok=True)
    canvas = terrain_a.ground()
    canvas.save(A / "ground.png")
    src = SourceA()

    def ground_fx(c):
        surf, ctx = compose.cairo_layer()
        magic.warning_circle(ctx, STYLE)
        c.alpha_composite(compose.cairo_to_pil(surf))

    stage.draw(canvas, src, ground_fx=ground_fx, depth_bias={"citygate_e": -40, "town_e": -10})
    surf, ctx = compose.cairo_layer()
    gsurf, gctx = compose.cairo_layer()
    magic.dust(ctx, STYLE)
    magic.missiles(ctx, STYLE)
    mx, my = scene.MAGE_POS
    ox, oy = mage_a.sigil_pt()
    magic.cannon(ctx, STYLE, (mx + ox, my + oy), glow_ctx=gctx)
    magic.sparks(ctx, STYLE)
    canvas.alpha_composite(compose.cairo_to_pil(surf))
    glow = compose.cairo_to_pil(gsurf)
    canvas = compose.add_glow(canvas, glow, radius_pt=4, strength=0.7)
    canvas.convert("RGB").save(A / "scene.png")
    return src


def ruler_items():
    items = []
    for kind in names.RULER_ORDER:
        u = next(u for u in scene.UNITS if u[0] == kind)
        base, mask, anchor, top = units_a.draw(kind, u[4][0], u[4][1], u[5], k=S)
        img = pt.flat_recolor(base, mask, config.TEAM[scene.TEAM_OF[kind[-1]]])
        if u[3] in (3, 4, 5):
            img = img.transpose(Image.FLIP_LEFT_RIGHT)
        bb = img.getbbox()
        items.append((names.UNIT_NAMES[kind], img, top, (bb[3] - bb[1]) / S, True))
    return items


PAL = dict(bg=(0, 0, 0, 0), grass=(130, 192, 76), grass2=(160, 208, 92), forest=(56, 140, 70), road=(232, 204, 146),
           water=(80, 180, 230), blue=config.TEAM["blue"], red=config.TEAM["red"], neutral=(250, 244, 226),
           ruin=(70, 56, 46), frame=(43, 29, 20), view=(255, 255, 255), alert=(255, 110, 40))


def portrait():
    P = pt.Painter(60, 60, (24, 50), k=8)
    mage_a.paint_frame(P, "idle", 3, with_shadow=False)
    base, mask = P.images()
    img = pt.flat_recolor(base, mask, config.TEAM["blue"])
    hud.portrait(img, A / "portrait.png", bg=(168, 216, 240), top_frac=0.55)


def build_scene(notes=None):
    t0 = time.time()
    build_scene_image()
    portrait()
    hud.minimap(A / "minimap.png", PAL)
    hud.render(A, "skin-a.css", "skin-a", A / "minimap.png", A / "portrait.png", A / "ui.png")
    screen = Image.open(A / "scene.png").convert("RGBA")
    screen.alpha_composite(Image.open(A / "ui.png").convert("RGBA"))
    screen.save(A / "screen.png")
    lab = names.label(OPT, "mobile")
    o = names.OPTIONS[OPT]
    sub = f"{OPT} {o['name']}：{o['pipeline']} · {o['tone']} · iPhone 14 Pro Max 橫向 932×430 pt（3 倍輸出）"
    config.OUT.mkdir(parents=True, exist_ok=True)
    artboard.compose_artboard(screen, lab, sub, ruler_items(), notes or NOTES, config.OUT / f"{lab}.png")
    print(f"wrote {lab} in {time.time() - t0:.0f}s")


def build_mage():
    t0 = time.time()
    frames = mage_a.write_frames(A / "mage_frames", config.TEAM["blue"], k=4.0)
    bg = Image.open(A / "ground.png").convert("RGBA").crop((1500, 900, 2200, 1290)).resize((700, 412))
    lab = names.label(OPT, "法師動畫")
    gif.make_gif(frames, bg, lab, config.OUT / f"{lab}.gif", warn_ring=mage_sheet.ring_drawer())
    lab = names.label(OPT, "法師關鍵影格")
    gif.keyframe_sheet(frames, bg, lab, config.OUT / f"{lab}.png",
                       note="術士（東陸、法印）關鍵影格，放大 4 倍；純 2D 程式向量繪製，只畫了 1 個方向（右）")
    print(f"mage outputs in {time.time() - t0:.0f}s")


NOTES = [
    ("可讀性與敵我：1 倍下靠剪影分得出兵種；東陸藍背旗、西陸紅罩袍（遮罩＋程式換色）", artboard.GREEN),
    ("東西協調：同一套粗描邊與平塗陰影，東陸城樓、小鎮和西陸石塔放一起不突兀", artboard.GREEN),
    ("8 方向：純 2D 這輪只畫 1 個方向（向左用鏡像）；量產要手畫 5 個方向＋鏡像 3 個", artboard.RED),
]


if __name__ == "__main__":
    parts = set(sys.argv[1:]) or {"scene", "mage"}
    if "scene" in parts:
        build_scene()
    if "mage" in parts:
        build_mage()
