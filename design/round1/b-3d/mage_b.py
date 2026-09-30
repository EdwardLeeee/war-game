"""B 立體微縮: mage GIF, key frames and the 8-direction sheet from the Blender passes.

python3 b-3d/mage_b.py   (after blender/render_mage.py and b-3d/make_b.py)
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "common"))
sys.path.insert(0, str(HERE))

from PIL import Image   # noqa: E402

import compose      # noqa: E402
import config       # noqa: E402
import gif          # noqa: E402
import mage_sheet   # noqa: E402
import make_b       # noqa: E402
import names        # noqa: E402

B = config.BUILD / "b"


def process(d, k):
    """Final B look for one mage frame: shadow + recoloured body + effects with glow."""
    beauty = compose.load(d, k, "beauty")
    mask = compose.load(d, k, "mask")
    body = compose.recolor(beauty.img, mask.img, config.TEAM["blue"])
    W, H = body.size
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sh = compose.load_shadow(d, k, color=(26, 30, 48), strength=0.85)
    out.alpha_composite(sh.img.crop((0, 0, W, H)) if sh.img.width >= W else sh.img, (0, 0))
    out.alpha_composite(body)
    fx = compose.load(d, k, "fx").img
    out.alpha_composite(fx)
    # soft bloom around the effects only, kept transparent where nothing glows
    from PIL import ImageFilter
    glow = fx.filter(ImageFilter.GaussianBlur(10))
    a = glow.split()[3].point(lambda v: int(v * 0.8))
    glow.putalpha(a)
    base = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    base.alpha_composite(glow)
    base.alpha_composite(out)
    return base


def ground_tile():
    g = Image.open(B / "ground.png").convert("RGBA")
    return g.crop((1500, 900, 2200, 1290)).resize((700, 412))


def build():
    frames = mage_sheet.write_frames(process, B / "mage_frames")
    bg = ground_tile()
    lab = names.label("B", "法師動畫")
    gif.make_gif(frames, bg, lab, config.OUT / f"{lab}.gif", warn_ring=mage_sheet.ring_drawer())
    lab = names.label("B", "法師關鍵影格")
    gif.keyframe_sheet(frames, bg, lab, config.OUT / f"{lab}.png",
                       note="術士（東陸、法印）關鍵影格，放大 4 倍；用 Blender 同一套模型與動作算出")
    lab = names.label("B", "法師8方向")
    mage_sheet.dirs_sheet(process, bg, lab, config.OUT / f"{lab}.png",
                          note="同一個 3D 模型由腳本自動轉 8 個方向算圖（每方向 4 個關鍵姿勢，放大 4 倍）")
    print("B mage outputs written")


if __name__ == "__main__":
    build()
