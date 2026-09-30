"""B 立體微縮: full artboard = scene + HUD + phone frame + ruler.

python3 b-3d/build_b.py   (after blender/render_scene.py and blender/render_mage.py portrait)
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "common"))
sys.path.insert(0, str(HERE.parent / "blender"))
sys.path.insert(0, str(HERE))

from PIL import Image, ImageFilter   # noqa: E402

import artboard   # noqa: E402
import compose    # noqa: E402
import config     # noqa: E402
import hud        # noqa: E402
import make_b     # noqa: E402
import names      # noqa: E402
import scene      # noqa: E402
from render_scene import key   # noqa: E402

OPT = "B"
B = config.BUILD / "b"
SPR = config.BUILD / "3d" / "sprites"
MAGE = config.BUILD / "3d" / "mage"

PAL = dict(bg=(0, 0, 0, 0), grass=(92, 118, 56), grass2=(128, 142, 70), forest=(44, 78, 40), road=(170, 146, 106),
           water=(70, 120, 160), blue=config.TEAM["blue"], red=config.TEAM["red"], neutral=(200, 196, 180),
           ruin=(60, 56, 52), frame=(20, 18, 16), view=(255, 250, 230), alert=(255, 90, 60))


def ruler_items():
    items = []
    for kind in names.RULER_ORDER:
        u = next(u for u in scene.UNITS if u[0] == kind)
        k = key(kind, u[3], u[4][0], u[4][1], u[5])
        meta = json.loads((SPR / f"{k}.json").read_text())
        sp = compose.load(SPR, k, "beauty")
        mk = compose.load(SPR, k, "mask")
        img = compose.recolor(sp.img, mk.img, config.TEAM[scene.TEAM_OF[kind[-1]]])
        bb = img.getbbox()
        total = (bb[3] - bb[1]) / config.SCALE
        items.append((names.UNIT_NAMES[kind], img, names.body_pt(meta.get("body_top_m", 0)), total, True))
    return items


def build(notes=None):
    B.mkdir(parents=True, exist_ok=True)
    make_b.build()
    sc = Image.open(B / "scene.png").convert("RGBA")
    pb = compose.load(MAGE / "portrait", "mage", "beauty")
    pm = compose.load(MAGE / "portrait", "mage", "mask")
    hud.portrait(compose.recolor(pb.img, pm.img, config.TEAM["blue"]), B / "portrait.png", bg=(30, 40, 44),
                 top_frac=0.75)
    hud.minimap(B / "minimap.png", PAL)
    hud.render(B, "skin-b.css", "skin-b", B / "minimap.png", B / "portrait.png", B / "ui.png")
    ui = Image.open(B / "ui.png").convert("RGBA")
    screen = sc.copy()
    screen.alpha_composite(ui)
    screen.save(B / "screen.png")
    lab = names.label(OPT, "mobile")
    o = names.OPTIONS[OPT]
    sub = f"{OPT} {o['name']}：{o['pipeline']} · {o['tone']} · iPhone 14 Pro Max 橫向 932×430 pt（3 倍輸出）"
    out = config.OUT / f"{lab}.png"
    config.OUT.mkdir(parents=True, exist_ok=True)
    artboard.compose_artboard(screen, lab, sub, ruler_items(), notes or [], out)
    print("wrote", out)


if __name__ == "__main__":
    build()
