"""R6-50 (the user 2026-10-20: 「地面也可以美化一下現在感覺太陽春」): three looks for the battlefield's ground, on the R6
representative battlefield (oblique, art-v3 buildings and units). Only the picture: the sim does not change, saved games
go on.

python3 common/r650.py ART RAW
  ART  an extracted art-v3-x3.tar.gz (units, buildings, nodes)
  RAW  the ground renders (design/b1/common/run.py r650_*: ground_<A|B|C>_x3_*)
-> out/R6-50-地面-<A|B|C>-<名>-mobile.png, out/R6-50-地面-總覽.png
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import boards       # noqa: E402
import field        # noqa: E402
import ground_plan  # noqa: E402
import rawart       # noqa: E402
import scene_r6     # noqa: E402

SCALE = 3
OPTS = [
    ("A", "自然草地", "草有深淺斑塊，零星的花和草叢；主城到城鎮之間一條土路；迷霧邊緣柔和地暗下去。"),
    ("B", "田野與碎石", "A 再加：主城周圍踩出來的泥土、幾塊碎石地和小石子；土路上有車轍；迷霧邊緣像一層霧。"),
    ("C", "手繪地圖風", "顏色比較飽和、草地有筆觸紋路；土路有畫出來的邊；迷霧外面像一張羊皮紙地圖。"),
]
# the ground atlas each look needs in the game (2x, the size the client loads; px): tiles of 4 x 4 cells (320 x 160),
# blot sprites for the patches (256 x 128), road pieces of one cell (80 x 40, 16 for the joins), decals (48 x 40)
ATLAS = {
    "A": dict(tiles=4, blots=2, road=16, decals=12, fog=0),
    "B": dict(tiles=8, blots=4, road=16 * 2, decals=16, fog=0),
    "C": dict(tiles=4, blots=2, road=16 * 2, decals=6, fog=1),
}


def atlas_px(k):
    a = ATLAS[k]
    return a["tiles"] * 320 * 160 + a["blots"] * 256 * 128 + a["road"] * 80 * 40 + a["decals"] * 48 * 40 + a["fog"] * 512 * 512


def cost(k):
    px = atlas_px(k)
    page = "1024×512" if px <= 1024 * 512 * 0.85 else "1024×1024"
    return (f"代價：只改畫面，不改規則，存著的局可以繼續。地面圖集是新加的一頁 {page}（2 倍）："
            f"未壓縮約 {px * 4 / 2 ** 20:.1f} MB、ASTC 約 {px / 2 ** 20:.2f} MB（照這個樣子要的圖塊清單算：草地 {ATLAS[k]['tiles']} 塊、"
            f"斑塊 {ATLAS[k]['blots']} 張、路 {ATLAS[k]['road']} 塊、花草石子 {ATLAS[k]['decals']} 張" + ("、羊皮紙 1 張" if ATLAS[k]["fog"] else "")
            + "）；選定後量產時實測。ui 約 1 天，client 要改地面的畫法（現在是兩種綠的格子）。")


def fog(img, style, centre, home=(17, 70), seen=12.5, explored=17.0):
    """The fog's edge in the look's style: seen as it is, explored darker, never seen hidden (INV-146)."""
    W, H = img.size
    s = W / field.SCREEN[0]
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32) / s
    cx, cy = field.pt_to_cell(xs, ys, centre)
    d = np.hypot(cx - home[0], (cy - home[1]) * 1.0)
    arr = np.asarray(img.convert("RGB"), np.float32)
    rng = np.random.default_rng(4)
    if style == "A":                                  # soft: a wide smooth fall-off into dark
        k = np.clip((d - seen) / 3.0, 0, 1)
        k2 = np.clip((d - explored) / 2.5, 0, 1)
        out = arr * (1 - 0.55 * k)[..., None] * (1 - 0.85 * k2)[..., None]
    elif style == "B":                                # a mist: pale, desaturated, a ragged edge
        n = np.asarray(Image.fromarray((rng.random((H // 24 + 2, W // 24 + 2)) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC),
                       np.float32) / 255.0
        dd = d + (n - 0.5) * 2.4
        k = np.clip((dd - seen) / 2.2, 0, 1)
        k2 = np.clip((dd - explored) / 2.0, 0, 1)
        grey = arr.mean(axis=2, keepdims=True)
        mist = np.array([206, 212, 214], np.float32)
        a = arr * (1 - 0.6 * k[..., None]) + grey * 0.6 * k[..., None]
        a = a * (1 - 0.45 * k[..., None]) + mist * 0.45 * k[..., None]
        out = a * (1 - k2[..., None]) + (mist * 0.78) * k2[..., None]
    else:                                             # a parchment map past the edge, an ink line along it
        paper = np.array([226, 210, 172], np.float32)
        n = np.asarray(Image.fromarray((rng.random((H // 6 + 2, W // 6 + 2)) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC),
                       np.float32) / 255.0
        k = np.clip((d - seen) / 1.2, 0, 1)
        k2 = np.clip((d - explored) / 0.6, 0, 1)
        tinted = arr * 0.55 + paper * 0.45
        a = arr * (1 - k[..., None]) + tinted * k[..., None]
        pap = paper * (0.92 + 0.08 * n[..., None])
        out = a * (1 - k2[..., None]) + pap * k2[..., None]
        line = np.exp(-((d - explored) / 0.12) ** 2)
        out = out * (1 - 0.75 * line[..., None]) + np.array([92, 64, 38], np.float32) * 0.75 * line[..., None]
    return Image.fromarray(out.clip(0, 255).astype(np.uint8), "RGB")


def battlefield(k, art, raw):
    field.VIEW = "oblique"
    sc = scene_r6.representative()
    gp = rawart.RawAtlas(raw)
    patch = dict(atlas=gp, frame=f"ground_{k}", x=scene_r6.CENTRE[0], y=scene_r6.CENTRE[1], front=-999, ground=True)
    img, _ = field.render(dict(sc, props=[patch]), art, scale=SCALE)
    return img.convert("RGB"), sc


def main(art, raw):
    field.VIEW = "oblique"
    shots = {}
    for k, name, what in OPTS:
        img, sc = battlefield(k, art, raw)
        fogged = fog(img, k, sc["centre"])
        shots[k] = (img, fogged)
        W = boards.M * 2 + img.width
        label = f"R6-50-地面-{k}-{name}-mobile"
        head = boards.header(W, label, f"選項 {k}「{name}」：{what}\n{cost(k)}\n"
                             "同一個戰場（方形斜看，建築和兵是 art-v3 的圖），沒有介面。上：手機像素（3 倍）；中：迷霧的邊緣（右邊是探過但現在看不到、再遠是沒探過）；"
                             "下：實際大小。")
        top = Image.new("RGB", (W, img.height + 20), boards.BG)
        top.paste(img, (boards.M, 0))
        mid = Image.new("RGB", (W, fogged.height + 20), boards.BG)
        mid.paste(fogged, (boards.M, 0))
        act = boards.row([boards.captioned(img.resize((814, 380), Image.LANCZOS), "實際大小", 22),
                          boards.captioned(fogged.resize((814, 380), Image.LANCZOS), "實際大小：迷霧邊緣", 22)], W)
        boards.save(boards.stack([head, top, boards.captioned(mid, "迷霧的邊緣", 28), act], W), label)
    # the overview: the three at actual size, with the prototype's ground today for comparison
    today = Image.open(HERE.parent / "build" / "field-a-plain.png").convert("RGB").resize((814, 380), Image.LANCZOS)
    W = boards.M * 2 + 2 * 814 + 40
    parts = [boards.header(W, "R6-50-地面-總覽", "三種地面，實際大小（1 pt = 1 px），右邊是同一張加上迷霧的邊緣。左上是現在設計稿的地面（遊戲裡現在是兩種綠的格子）。")]
    parts.append(boards.row([boards.captioned(today, "現在（設計稿用的草地）", 24)], W))
    for k, name, _ in OPTS:
        img, fogged = shots[k]
        parts.append(boards.row([boards.captioned(img.resize((814, 380), Image.LANCZOS), f"{k}「{name}」", 24),
                                 boards.captioned(fogged.resize((814, 380), Image.LANCZOS), f"{k}：迷霧邊緣", 24)], W))
    boards.save(boards.stack(parts, W), "R6-50-地面-總覽")


if __name__ == "__main__":
    main(*sys.argv[1:3])
