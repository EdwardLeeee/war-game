"""art-v7.5 (the user 2026-11-06: 「西陸騎士的槍尖顏色怪怪的 不是應該是銀色的嗎」): the lance points of the West knight and the East
heavy cavalry, before (a release's atlas) and after (this branch's CI atlases), in the five rendered facings, blue and red: the unit
at the phone's size and its point enlarged, with the point's brightness and how grey it is. The tip is the opaque pixel furthest
from the feet; in facings 6 and 7, where the lance points down the screen past a tall helmet, the furthest sideways around and below
the feet.

python3 design/r11/common/boards_v75lance.py ART_X3 NEW_ROOT OUT
  ART_X3: the release before, x3 unpacked; NEW_ROOT: where <unit>/atlas_x3/<unit>.json of the new renders are
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "r9" / "common"))
sys.path.insert(0, str(HERE))
import boards_r9 as B9          # noqa: E402
import boards_v74cav as CAV     # noqa: E402  (the unit on the game's grass)
import scene_r9 as S9           # noqa: E402

FACINGS = (0, 1, 2, 6, 7)
R_MEASURE = 8                   # px at x3 round the tip: the head alone (at 15 the socket falls inside and darkens it)
R_CROP, ZOOM = 24, 6


def tip(a, unit, f):
    nm, _ = S9.unit_frame(a, unit, "idle", f, 0)
    im, ax, ay = a._crop("color", nm)
    ys, xs = np.nonzero(np.asarray(im.getchannel("A")) > 128)
    if f in (6, 7):
        keep = ys >= ay - 30
        ys, xs = ys[keep], xs[keep]
        i = int(np.argmax((xs - ax) ** 2))
    else:
        i = int(np.argmax((xs - ax) ** 2 + (ys - ay) ** 2))
    return nm, int(xs[i]), int(ys[i])


def measure(a, nm, x, y):
    """The mean luminance (0-255) and the share of near-grey pixels round the tip: wood is warm, steel is grey."""
    im, _, _ = a._crop("color", nm)
    px = np.asarray(im.convert("RGBA"), np.float32) / 255
    yy, xx = np.mgrid[0:px.shape[0], 0:px.shape[1]]
    m = ((xx - x) ** 2 + (yy - y) ** 2 <= R_MEASURE ** 2) & (px[..., 3] > 0.5)
    p = px[m][:, :3]
    lum = float((p @ np.array([0.2126, 0.7152, 0.0722])).mean()) * 255
    grey = float((((p.max(1) - p.min(1)) / np.maximum(p.max(1), 1e-3)) < 0.3).mean()) * 100
    return lum, grey


def crop(a, nm, x, y, team):
    (im, _, _), _ = a.sprite(nm, team)
    bg = Image.new("RGBA", im.size, (92, 120, 72, 255))
    bg.alpha_composite(im)
    big = Image.new("RGBA", (bg.width + 2 * R_CROP, bg.height + 2 * R_CROP), (92, 120, 72, 255))
    big.alpha_composite(bg, (R_CROP, R_CROP))
    c = big.crop((x, y, x + 2 * R_CROP, y + 2 * R_CROP)).convert("RGB")
    return c.resize((2 * R_CROP * ZOOM, 2 * R_CROP * ZOOM), Image.NEAREST)


def rows_for(unit, label, old, new, grass):
    rows, lines = [], []
    gap = 6
    size = (250, 230)
    for team, tname in (("blue", "藍"), ("red", "紅")):
        phone = Image.new("RGB", (2 * len(FACINGS) * (size[0] + gap), size[1] + 30), B9.BG)
        d = ImageDraw.Draw(phone)
        for i, f in enumerate(FACINGS):
            for j, (at, when) in enumerate(((old, "改前"), (new, "改後"))):
                nm, _ = S9.unit_frame(at, unit, "idle", f, 0)
                (im, ax, ay), _ = at.sprite(nm, team)
                x = (2 * i + j) * (size[0] + gap)
                phone.paste(CAV.cell(grass, im, ax, ay, at._crop("shadow", nm), size), (x, 30))
                d.text((x, 2), f"方向 {f} {when}", font=B9.font(20), fill=B9.INK)
        rows.append((f"{label}（{tname}）：手機大小（3 倍畫質，一點三個像素）", phone))
    side = 2 * R_CROP * ZOOM
    for team, tname in (("blue", "藍"), ("red", "紅")):
        zoom = Image.new("RGB", (len(FACINGS) * (side + gap), 2 * (side + 56)), B9.BG)
        d = ImageDraw.Draw(zoom)
        for i, f in enumerate(FACINGS):
            for j, (at, when) in enumerate(((old, "改前"), (new, "改後"))):
                nm, x, y = tip(at, unit, f)
                lum, grey = measure(at, nm, x, y)
                if team == "blue":
                    lines.append(f"{label} 方向 {f} {when}：亮度 {lum:.0f}、偏灰 {grey:.0f}%")
                px = i * (side + gap)
                py = j * (side + 56)
                zoom.paste(crop(at, nm, x, y, team), (px, py + 56))
                d.text((px, py + 2), f"方向 {f} {when}", font=B9.font(20), fill=B9.INK)
                d.text((px, py + 28), f"亮度 {lum:.0f}、偏灰 {grey:.0f}%", font=B9.font(20, False), fill=B9.GREY)
        rows.append((f"{label}（{tname}）：槍尖放大 {ZOOM} 倍（3 倍畫質的像素）", zoom))
    return rows, lines


def main(art, new_root, out):
    out.mkdir(parents=True, exist_ok=True)
    grass = Image.open(art / "ground/grass.png").convert("RGBA")
    rows, lines = [], []
    for unit, label in (("knight_w", "西陸騎士"), ("hcav_e", "東陸重騎")):
        old = S9.Atlas(art / f"units/{unit}/{unit}.json")
        new = S9.Atlas(next(Path(new_root).rglob(f"atlas_x3/{unit}.json")))
        r, l = rows_for(unit, label, old, new, grass)
        rows += r
        lines += l
    note = ("art-v7.5（使用者 2026-11-06：「西陸騎士的槍尖顏色怪怪的 不是應該是銀色的嗎」）。西陸騎士：木桿原本一路畫到槍頭的尖端，比變細的鋼頭粗，"
            "最後 13 公分露出來的是木頭；現在木桿停在套管裡，換成和東陸重騎同樣的扁葉形鋼頭加鐵套管（原本的圓鋼頭只改長度時，又小又暗，預覽量到比另外兩者暗約兩成）。"
            "東陸重騎：同一次檢查量到槍頭和木桿之間空了 3 公分，套管加長蓋住。其他武器（槍兵、長矛兵、農具）量過都沒有這個問題（design/production/blender/tips_audit.py）。"
            "「亮度」是槍尖周圍 8 像素的平均亮度（0–255），「偏灰」是其中偏灰的比例：木頭偏暖、鋼偏灰。西陸長矛兵現況的亮度是 208、199、218、－、215（方向 0、1、2、6、7；方向 6 被身體擋住，沒量）。")
    B9.board("V75-01-西陸騎士槍尖-前後對照-phone", note, rows, out)
    print("\n".join(lines))


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
