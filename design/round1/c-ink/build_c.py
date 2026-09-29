"""C 水墨戰卷: full artboard, mage GIF, key frames and 8-direction sheet.

python3 c-ink/build_c.py [scene] [mage]
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "common"))
sys.path.insert(0, str(HERE.parent / "blender"))
sys.path.insert(0, str(HERE))

import numpy as np                      # noqa: E402
from PIL import Image, ImageFilter      # noqa: E402

import artboard     # noqa: E402
import compose      # noqa: E402
import config       # noqa: E402
import gif          # noqa: E402
import hud          # noqa: E402
import mage_sheet   # noqa: E402
import make_c       # noqa: E402
import names        # noqa: E402
import scene        # noqa: E402
from render_scene import key   # noqa: E402

OPT = "C"
C = config.BUILD / "c"
SPR = config.BUILD / "3d" / "sprites"
MAGE = config.BUILD / "3d" / "mage"


def ink_minimap(img):
    a = np.asarray(img, np.float32)
    g = a[..., :3].mean(axis=2, keepdims=True)
    a[..., :3] = g + (a[..., :3] - g) * 0.55
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")


PAL = dict(bg=(0, 0, 0, 0), grass=(150, 136, 104), grass2=(120, 116, 86), forest=(52, 54, 42), road=(200, 180, 140),
           water=(70, 84, 90), blue=make_c.TEAM_C["blue"], red=make_c.TEAM_C["red"], neutral=(214, 204, 180),
           ruin=(30, 26, 22), frame=(18, 16, 14), view=(250, 240, 220), alert=(200, 50, 30), post=ink_minimap)


def ruler_items():
    items = []
    for kind in names.RULER_ORDER:
        u = next(u for u in scene.UNITS if u[0] == kind)
        k = key(kind, u[3], u[4][0], u[4][1], u[5])
        meta = json.loads((SPR / f"{k}.json").read_text())
        img = make_c.toon(compose.load(SPR, k, "albedo").img, compose.load(SPR, k, "light").img,
                          compose.load(SPR, k, "mask").img, scene.TEAM_OF[kind[-1]])
        bb = img.getbbox()
        items.append((names.UNIT_NAMES[kind], img, names.body_pt(meta.get("body_top_m", 0)),
                      (bb[3] - bb[1]) / config.SCALE, True))
    return items


def build_scene(notes=None):
    C.mkdir(parents=True, exist_ok=True)
    make_c.build()
    sc = Image.open(C / "scene.png").convert("RGBA")
    pal = compose.load(MAGE / "portrait", "mage", "albedo")
    plt = compose.load(MAGE / "portrait", "mage", "light")
    pmk = compose.load(MAGE / "portrait", "mage", "mask")
    hud.portrait(make_c.toon(pal.img, plt.img, pmk.img, "blue", outline_px=3), C / "portrait.png",
                 bg=(58, 48, 38), top_frac=0.75)
    hud.minimap(C / "minimap.png", PAL)
    hud.render(C, "skin-c.css", "skin-c", C / "minimap.png", C / "portrait.png", C / "ui.png")
    screen = sc.copy()
    screen.alpha_composite(Image.open(C / "ui.png").convert("RGBA"))
    screen.save(C / "screen.png")
    lab = names.label(OPT, "mobile")
    o = names.OPTIONS[OPT]
    sub = f"{OPT} {o['name']}：{o['pipeline']} · {o['tone']} · iPhone 14 Pro Max 橫向 932×430 pt（3 倍輸出）"
    config.OUT.mkdir(parents=True, exist_ok=True)
    artboard.compose_artboard(screen, lab, sub, ruler_items(), notes or [], config.OUT / f"{lab}.png")
    print("wrote", lab)


def process(d, k):
    body = make_c.toon(compose.load(d, k, "albedo").img, compose.load(d, k, "light").img,
                       compose.load(d, k, "mask").img, "blue", outline_px=3)
    W, H = body.size
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sh = compose.load_shadow(d, k, color=(34, 28, 24), strength=0.55, blur_px=5)
    out.alpha_composite(sh.img.crop((0, 0, W, H)))
    out.alpha_composite(body)
    fx = compose.load(d, k, "fx").img
    glow = fx.filter(ImageFilter.GaussianBlur(12))
    glow.putalpha(glow.split()[3].point(lambda v: int(v * 0.85)))
    base = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    base.alpha_composite(glow)
    base.alpha_composite(out)
    base.alpha_composite(fx)
    return base


def build_mage():
    frames = mage_sheet.write_frames(process, C / "mage_frames")
    g = Image.open(C / "ground.png").convert("RGBA")
    bg = make_c.dusk(g).crop((1500, 900, 2200, 1290)).resize((700, 412))
    lab = names.label(OPT, "法師動畫")
    gif.make_gif(frames, bg, lab, config.OUT / f"{lab}.gif",
                 warn_ring=mage_sheet.ring_drawer(color=(0.85, 0.2, 0.1), ink=True))
    lab = names.label(OPT, "法師關鍵影格")
    gif.keyframe_sheet(frames, bg, lab, config.OUT / f"{lab}.png",
                       note="術士（東陸、法印）關鍵影格，放大 4 倍；和 B 同一套 3D 模型與動作，只換著色")
    lab = names.label(OPT, "法師8方向")
    mage_sheet.dirs_sheet(process, bg, lab, config.OUT / f"{lab}.png",
                          note="和 B 同一套模型，腳本自動轉 8 個方向（每方向 4 個關鍵姿勢，放大 4 倍）")


if __name__ == "__main__":
    parts = set(sys.argv[1:]) or {"scene", "mage"}
    if "scene" in parts:
        build_scene()
    if "mage" in parts:
        build_mage()
