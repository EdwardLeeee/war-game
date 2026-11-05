"""art-v7.4 item 4 (the review 2026-11-04; ceo: the user sees it once before the release): the East heavy cavalry's
具裝 and the West knight's caparison, before (the release's atlas) and after (production renders of this branch, the
player colour and the shadow put on as the atlas does), idle in facings 7, 1 and 6, on the game's grass.

python3 design/r11/common/boards_v74cav.py ART_X3 NEW_ROOT OUT
  ART_X3: art-v7.3 x3 unpacked; NEW_ROOT: where <unit>/atlas_x3/<unit>.json of this branch's renders are (CI's r7-v8u
  artifacts, or design/production/build/r7v8u/prod after common/postprocess.py)
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "r9" / "common"))
import boards_r9 as B9    # noqa: E402
import scene_r9 as S9     # noqa: E402

BLUE = np.array([0x3f, 0x7f, 0xe0], np.float32) / 255
TEAM_GAIN = 1.6
FACINGS = (7, 1, 6)
NAMES = {"hcav_e": "東陸重騎（具裝）", "knight_w": "西陸騎士（馬衣）"}


def grass_bg(grass, w, h):
    bg = Image.new("RGBA", (w, h))
    for x in range(0, w, grass.width):
        for y in range(0, h, grass.height):
            bg.paste(grass, (x, y))
    return bg


def put_shadow(bg, sh, x, y):
    s = sh.copy()
    s.putalpha(s.getchannel("A").point(lambda v: int(v * 0.55)))
    dark = Image.new("RGBA", s.size, (22, 28, 46, 0))
    dark.putalpha(s.getchannel("A"))
    bg.alpha_composite(dark, (int(x), int(y)))


def raw_sprite(raw, unit, f):
    """The raw passes made into what the atlas holds: colour with the player colour put in, and the shadow."""
    p = raw / unit / "raw" / f"{unit}_idle_f{f}_00_x3_"
    b = np.asarray(Image.open(f"{p}beauty.png").convert("RGBA"), np.float32)
    m = np.asarray(Image.open(f"{p}mask.png").convert("RGBA"), np.float32)[..., 0:1] / 255
    rgb = b[..., :3] * (1 - m) + np.clip(b[..., :3] * TEAM_GAIN, 0, 255) * BLUE * m
    col = Image.fromarray(np.concatenate([rgb, b[..., 3:]], -1).astype(np.uint8), "RGBA")
    sh = Image.open(f"{p}shadow.png").convert("RGBA")
    return col, sh


def cell(grass, col, ax, ay, sh, size=(330, 300)):
    bg = grass_bg(grass, *size)
    X, Y = size[0] // 2, int(size[1] * 0.75)
    if sh is not None:
        si, sx, sy = sh
        put_shadow(bg, si, X - sx, Y - sy)
    bg.alpha_composite(col, (int(round(X - ax)), int(round(Y - ay))))
    return bg.convert("RGB")


def main(art, raw, out):
    out.mkdir(parents=True, exist_ok=True)
    grass = Image.open(art / "ground/grass.png").convert("RGBA")
    rows = []
    raw = Path(raw)
    for unit in ("hcav_e", "knight_w"):
        a = S9.Atlas(art / f"units/{unit}/{unit}.json")
        cells = []
        for f in FACINGS:
            nm, flip = S9.unit_frame(a, unit, "idle", f, 0)
            (old, ax, ay), _ = a.sprite(nm, "blue")
            cells.append(cell(grass, old, ax, ay, a._crop("shadow", nm)))
            b = S9.Atlas(next(raw.rglob(f"atlas_x3/{unit}.json")))
            nb, _ = S9.unit_frame(b, unit, "idle", f, 0)
            (new, bx, by), _ = b.sprite(nb, "blue")
            cells.append(cell(grass, new, bx, by, b._crop("shadow", nb)))
        strip = Image.new("RGB", (len(cells) * 336, 330), B9.BG)
        d = ImageDraw.Draw(strip)
        for i, c in enumerate(cells):
            x = i * 336 + (12 if i % 2 else 0)
            strip.paste(c, (x - (12 if i % 2 else 0), 30))
            d.text((x - (12 if i % 2 else 0), 2), f"方向 {FACINGS[i // 2]}：{'現在' if i % 2 == 0 else '改後'}", font=B9.font(22), fill=B9.INK)
        rows.append((f"{NAMES[unit]}：實際大小（3 倍畫質，一點三個像素）", strip))
        zoom = Image.new("RGB", (2 * 660 + 20, 600), B9.BG)
        zoom.paste(cells[0].resize((660, 600), Image.LANCZOS), (0, 0))
        zoom.paste(cells[1].resize((660, 600), Image.LANCZOS), (680, 0))
        rows.append((f"{NAMES[unit]}：方向 7 放大 2 倍（左現在、右改後）", zoom))
    note = ("art-v7.4 第 4 件（評審 2026-11-04：具裝、馬衣不夠寫實）。東陸具裝照唐末五代的甲騎具裝（《武經總要》的面簾、雞頸、"
            "盪胸、身甲、搭後）：甲片原本照人身繞直軸分片，馬身側面分不出片、只剩一排排橘色綁繩，看起來像條紋毯；改成沿馬身分片、"
            "每排下緣疊在下一排上（做成真的段差，陰影裡也看得出）、綁繩改深褐色。西陸馬衣照 13–14 世紀的布馬衣（Manesse 古抄本等）："
            "原本是硬挺的一塊；改成裙片有真的垂褶、越往下緣越深。兵的動作、玩家色的位置不變。")
    B9.board("V74-04-具裝與馬衣-前後對照-phone", note, rows, out)
    print("board in", out)


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
