"""The 晶砲 warning circle and the calibration arc in the caster's player colour (the user 2026-11-05, D-129: 「法師法圈顏色跟該陣營
一樣」): before (orange for everyone) and after (our blue, their red), four moments of the calibration, composed the way the
client does (client/src/render/world.ts drawWarningsArt and the arc in drawUnits; design/b1/README.md 「給 client：晶砲預警圈 B」).

The circle's layers are effects.py's own pictures (warn_images), laid on the diamond camera's ground; the mage is art-v7's.

python3 design/production/common/boards_warn_tint.py ART OUT      ART: art-v7 (or later) x3 unpacked
"""
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
D = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(D / "r9" / "common"))
sys.path.insert(0, str(D / "r11" / "common"))
import boards_r9 as B9          # noqa: E402
import boards_v7astc as V7A     # noqa: E402  (the diamond ground)
import effects as FX            # noqa: E402
import scene_r9 as S9           # noqa: E402

PPM = 60                         # x3: device pixels a metre
WARNING = (0xff, 0x8a, 0x2a)     # client/src/render/atlas.ts WARNING_TINT
OWN, ENEMY = (0x3f, 0x7f, 0xe0), (0xd9, 0x43, 0x3a)   # OWN_TINT, ENEMY_TINT (R6-24 甲)
ARC_R_M, ARC_W_M = 32 * 0.55 / 16, 3 / 16            # TILE_PX 32 is 2 m: r = TILE_PX * 0.55, stroke 3 (world px)
MOMENTS = [(30, "校準剛開始（1.5 秒前）"), (20, "1.0 秒前"), (10, "0.5 秒前"), (2, "落下前一刻")]
MAGE, CIRCLE = (120, 205), (300, 150)                # points on the 814 x 380 screen (closer than in a game, to fit)
CROP = (40, 60, 420, 260)


def layer(im, alpha, tint=None, rot=0.0, scale=1.0):
    a = np.asarray(im, np.float32) / 255
    if tint is not None:
        a[..., :3] *= tint
    a[..., 3] *= alpha
    out = Image.fromarray((np.clip(a, 0, 1) * 255).round().astype(np.uint8), "RGBA")
    if scale != 1.0:
        w = out.width
        s = out.resize((max(1, round(w * scale)),) * 2, Image.LANCZOS)
        out = Image.new("RGBA", (w, w))
        out.alpha_composite(s, ((w - s.width) // 2, (w - s.height) // 2))
    return out.rotate(-math.degrees(rot), Image.BICUBIC) if rot else out


def circle_top(left, colour, seconds):
    """The warning circle seen from above (x3): world.ts's alphas; colour None = today's orange set."""
    imgs = FX.warn_images(3.0)
    k = 1 - left / 30
    t = k * 1.5
    pulse = 0.5 + 0.5 * math.cos(2 * math.pi * (3 * t + 2 * t * t))
    sig = min(1, (0.45 + 0.55 * k) * (0.8 + 0.2 * pulse))
    turn = math.radians(20) * seconds
    g = (5 - left) / 5 if left <= 5 else -1
    size = max(im.width for im, _ in imgs.values())
    top = Image.new("RGBA", (size, size))

    def put(name, alpha, rot=0.0, scale=1.0):
        im = imgs[name][0]
        tint = np.array(FX.warn_tint(colour, name), np.float32) if name.endswith("_t") else None
        L = layer(im, alpha, tint, rot, scale)
        top.alpha_composite(L, ((size - L.width) // 2, (size - L.height) // 2))
    sfx = "" if colour is None else "_t"
    put("warn_fill" + sfx, (0.12 + 0.35 * k) * (0.75 + 0.25 * pulse))
    put("warn_sigil_glow" + sfx, 0.6 * sig, turn)
    put("warn_rim" + sfx, 1)
    put("warn_sigil" + sfx, sig, turn)
    put("warn_sigil_gold", sig * (0.7 if colour is None else 0.35) * k, turn)   # after: the gold only a touch
    if g >= 0:
        put("warn_core" + sfx, 0.5 + 0.4 * g, scale=(1 / 3 + 2 / 3 * g))
    return top


def arc_top(cast, colour):
    """The calibration arc round the mage's feet (world.ts: from the top, cast/30 of a turn, 0.95 opaque)."""
    r, w = ARC_R_M * PPM, ARC_W_M * PPM
    n = int(2 * (r + w)) + 4
    k = 4                                            # drawn large, then down: smooth
    im = Image.new("RGBA", (n * k, n * k))
    c = n * k / 2
    end = -90 + 360 * min(cast, 30) / 30
    ImageDraw.Draw(im).arc([c - r * k, c - r * k, c + r * k, c + r * k], -90, end, fill=(*colour, 242), width=round(w * k))
    return im.resize((n, n), Image.LANCZOS)


def project(top):
    """Top-down (x east, y south) to the diamond camera's ground: screen x = (x + y) / sqrt 2, y = (y - x) / (2 sqrt 2)."""
    S = top.width
    W, H = round(S * math.sqrt(2)), round(S / math.sqrt(2))
    cu = cv = S / 2
    cx, cy = W / 2, H / 2
    r2 = math.sqrt(2)
    data = (1 / r2, -r2, cu - cx / r2 + r2 * cy, 1 / r2, r2, cv - cx / r2 - r2 * cy)
    return top.transform((W, H), Image.AFFINE, data, Image.BICUBIC)


def panel(art, ground, unit, team, left, colour):
    base = ground.convert("RGBA")
    cast = 30 - left
    seconds = 4.0 + 1.5 * (1 - left / 30)
    ring = project(circle_top(left, colour, seconds))
    base.alpha_composite(ring, (round(CIRCLE[0] * 3 - ring.width / 2), round(CIRCLE[1] * 3 - ring.height / 2)))
    arc = project(arc_top(cast, WARNING if colour is None else colour))
    base.alpha_composite(arc, (round(MAGE[0] * 3 - arc.width / 2), round(MAGE[1] * 3 - arc.height / 2)))
    a = art[unit]
    nm, flip = S9.unit_frame(a, unit, "cast", 1, min(29, cast))
    (im, ax, ay), sh = a.sprite(nm, team)
    if flip:
        im, ax = im.transpose(Image.FLIP_LEFT_RIGHT), im.width - ax
    rgb = base.convert("RGB")
    V7A.put(rgb, ((im, ax, ay), sh if not flip else None), MAGE[0], MAGE[1], 3)
    return rgb.crop(tuple(v * 3 for v in CROP))


def main(art_dir, out):
    out.mkdir(parents=True, exist_ok=True)
    ground = V7A.ground(art_dir, 3)
    art = {u: S9.Atlas(art_dir / f"units/{u}/{u}.json") for u in ("mage_e", "mage_w")}
    rowsets = [("現在：我方法師（大家看到的都是橘金色）", "mage_e", "blue", None),
               ("改後：我方法師（藍）", "mage_e", "blue", OWN),
               ("現在：敵方法師（大家看到的都是橘金色）", "mage_w", "red", None),
               ("改後：敵方法師（紅）", "mage_w", "red", ENEMY)]
    gap = 20
    cw, ch = (CROP[2] - CROP[0]) * 2, (CROP[3] - CROP[1]) * 2      # shown at 2/3 of the phone's pixels
    rows = []
    for cap, unit, team, colour in rowsets:
        strip = Image.new("RGB", (len(MOMENTS) * (cw + gap) - gap, ch + 36), B9.BG)
        d = ImageDraw.Draw(strip)
        for i, (left, label) in enumerate(MOMENTS):
            p = panel(art, ground, unit, team, left, colour).resize((cw, ch), Image.LANCZOS)
            strip.paste(p, (i * (cw + gap), 36))
            d.text((i * (cw + gap), 2), label, font=B9.font(24), fill=B9.INK)
        rows.append((cap, strip))
    note = ("D-129（使用者 2026-11-05：「法師法圈顏色跟該陣營一樣」）：晶砲的落點預警圈和法師腳下的校準弧，改成施法那一方的玩家色"
            "（我方藍 #3f7fe0、敵方紅 #d9433a，圈用同一色相調到最亮）；金色符紋留一點當點綴（最亮時 0.35，原本 0.7），最後中心燒亮也照玩家色；"
            "校準弧直接用玩家色；防護罩不動。"
            "照 client 的組法和透明度公式畫四個時間點，壓在菱形鏡頭的地面上（art-v7）；法師放得比實際近，好放進同一格。"
            "每格是手機像素的 2/3。")
    B9.board("V7W-01-晶砲預警圈-施法方玩家色-前後對照-phone", note, rows, out)
    print("board in", out)


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
