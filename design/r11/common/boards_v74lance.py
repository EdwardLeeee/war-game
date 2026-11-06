"""art-v7.4 (the user 2026-11-06: 「它武器為啥掛一個藍藍的東西？應該要拿掉吧，武器不就是長槍嗎」): the two cavalry's lances
without their pennants, before and after, idle in facings 7, 1 and 6, blue and red side by side at the phone's size, and
how much of each picture is the player's colour (the team layer's share of the unit's own pixels).

python3 design/r11/common/boards_v74lance.py ART_X3 NEW_ROOT OUT      (as boards_v74cav.py)
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "r9" / "common"))
sys.path.insert(0, str(HERE))
import boards_r9 as B9          # noqa: E402
import boards_v74cav as CAV     # noqa: E402  (grass, cell)
import scene_r9 as S9           # noqa: E402

FACINGS = (7, 1, 6)


def share(a, nm):
    """The player-colour layer's share of the frame's visible pixels."""
    c = a._crop("color", nm)
    t = a._crop("team", nm)
    if c is None:
        return 0.0
    ca = np.asarray(c[0].getchannel("A")) > 128
    if t is None:
        return 0.0
    ti, tx, ty = t
    m = np.zeros(ca.shape, bool)
    ox, oy = int(round(c[1] - tx)), int(round(c[2] - ty))
    ta = np.asarray(ti.getchannel("A")) > 64
    h, w = ta.shape
    ys, xs = slice(max(0, oy), min(ca.shape[0], oy + h)), slice(max(0, ox), min(ca.shape[1], ox + w))
    m[ys, xs] = ta[ys.start - oy:ys.stop - oy, xs.start - ox:xs.stop - ox]
    return float((m & ca).sum()) / max(1, ca.sum())


def main(art, new_root, out):
    out.mkdir(parents=True, exist_ok=True)
    grass = Image.open(art / "ground/grass.png").convert("RGBA")
    rows, lines = [], []
    for unit, label in (("hcav_e", "東陸重騎"), ("knight_w", "西陸騎士")):
        a = S9.Atlas(art / f"units/{unit}/{unit}.json")
        b = S9.Atlas(next(Path(new_root).rglob(f"atlas_x3/{unit}.json")))
        cells, txt = [], []
        for f in FACINGS:
            for at, when in ((a, "現在"), (b, "改後")):
                nm, _ = S9.unit_frame(at, unit, "idle", f, 0)
                for team in ("blue", "red"):
                    (im, ax, ay), _ = at.sprite(nm, team)
                    cells.append((f"方向 {f} {when} {'藍' if team == 'blue' else '紅'}", CAV.cell(grass, im, ax, ay, at._crop("shadow", nm), (250, 230))))
                txt.append(f"方向 {f} {when} {share(at, nm) * 100:.1f}%")
        strip = Image.new("RGB", (len(cells) * 254, 262), B9.BG)
        d = ImageDraw.Draw(strip)
        for i, (cap, c) in enumerate(cells):
            strip.paste(c, (i * 254, 30))
            d.text((i * 254, 2), cap, font=B9.font(18), fill=B9.INK)
        rows.append((f"{label}（實際大小）；玩家色佔畫面：" + "、".join(txt), strip))
        lines += txt
    note = ("art-v7.4（使用者 2026-11-06：「它武器為啥掛一個藍藍的東西？應該要拿掉吧，武器不就是長槍嗎」）：兩陸騎兵長槍上的玩家色小旗拿掉。"
            "東陸重騎補在盪胸（胸前）和搭後（臀後）的下緣，和身甲兩側的布帶一樣，正面、背面也看得到；西陸騎士靠馬衣。"
            "每個方向藍紅並排，數字是玩家色佔這張圖的比例。其他兵種的武器上沒有玩家色的東西。")
    B9.board("V74-06-騎兵長槍拿掉小旗-前後對照-phone", note, rows, out)
    print("\n".join(lines))


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
