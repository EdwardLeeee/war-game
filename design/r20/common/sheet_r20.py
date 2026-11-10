"""R20: draft frames (render_r20.py) side by side, enlarged, to look at.

python3 design/r20/common/sheet_r20.py OUT.png N PREFIX[:team] ...     PREFIX: OUTDIR/TAG_anim_fF_II
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
for d in ("r16", "r19"):
    sys.path.insert(0, str(HERE.parents[1] / d / "common"))
import art_r19 as A       # noqa: E402
import scene_r16 as S16   # noqa: E402

REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
GROUND = (138, 134, 91)


def main():
    out, n = Path(sys.argv[1]), float(sys.argv[2])
    cells = []
    for spec in sys.argv[3:]:
        prefix, _, team = spec.partition(":")
        (im, ax, ay), sh = S16.farmer(prefix, team or "blue")
        l, t, r, b = int(ax) + 6, int(ay) + 6, im.width - int(ax) + 6, im.height - int(ay) + 6
        st = A.Stage(Image.new("RGB", (l + r, t + b), GROUND))
        st.put(((im, ax, ay), sh), l, t)
        cells.append((Path(prefix).name, A.enlarge(st.render(), n)))
    rows, cur, x = [], [], 4
    for name, c in cells:
        if cur and x + c.width + 4 > 1990:
            rows.append(cur)
            cur, x = [], 4
        cur.append((name, c))
        x += c.width + 4
    rows.append(cur)
    img = Image.new("RGB", (max(sum(c.width + 4 for _, c in row) + 4 for row in rows), sum(max(c.height for _, c in row) + 40 for row in rows)), (24, 26, 30))
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(REG, 22, index=3)
    y = 0
    for row in rows:
        x = 4
        for name, c in row:
            d.text((x, y + 6), name, font=f, fill=(255, 255, 255))
            img.paste(c, (x, y + 36))
            x += c.width + 4
        y += max(c.height for _, c in row) + 40
    img.save(out)
    print(out.name, img.size)


if __name__ == "__main__":
    main()
