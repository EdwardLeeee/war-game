"""R19: some frames closer, to look at what a sheet showed small.

python3 design/r19/common/zoom_r19.py ART_X3 OUT.png N unit:anim:face:frame[,frame...][:team] ...
  team `grid`: blue, with a grid in the px of inspect_r19.py's cell (a line every 10, a number every 20): a finding's
  circle is read off it.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
import art_r19 as A   # noqa: E402

REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"


def main():
    art, out, n = Path(sys.argv[1]), Path(sys.argv[2]), float(sys.argv[3])
    bg = A.grass_colour(art)
    cells = []
    units = {}
    for spec in sys.argv[4:]:
        p = spec.split(":")
        unit, anim, face, frames = p[0], p[1], int(p[2]), [int(k) for k in p[3].split(",")]
        team = p[4] if len(p) > 4 else "blue"
        grid = team == "grid"
        team = "blue" if grid else team
        u = units.setdefault(unit, A.Unit(art, unit))
        l, t, r, b = u.box(anim, [face], frames)
        L, T, _, _ = u.box(anim)
        for k in frames:
            st = A.Stage(Image.new("RGB", (l + r + 8, t + b + 8), bg))
            st.put(u.sprite(anim, face, k, team), l + 4, t + 4)
            im = A.enlarge(st.render(), n)
            if grid:
                g = ImageDraw.Draw(im)
                gf = ImageFont.truetype(REG, 16, index=3)
                for X in range(0, 400, 10):
                    x = (X - L + l) * n
                    if 0 <= x < im.width:
                        g.line([(x, 0), (x, im.height)], fill=(255, 255, 255) if X % 20 == 0 else (60, 60, 60), width=1)
                        if X % 20 == 0:
                            g.text((x + 2, 0), str(X), font=gf, fill=(255, 255, 0))
                for Y in range(0, 400, 10):
                    y = (Y - T + t) * n
                    if 0 <= y < im.height:
                        g.line([(0, y), (im.width, y)], fill=(255, 255, 255) if Y % 20 == 0 else (60, 60, 60), width=1)
                        if Y % 20 == 0:
                            g.text((2, y + 1), str(Y), font=gf, fill=(255, 255, 0))
            cells.append((f"{unit} {anim} f{face} {k}", im))
    W = sum(c.width for _, c in cells) + 4 * (len(cells) + 1)
    H = max(c.height for _, c in cells) + 40
    img = Image.new("RGB", (W, H), (24, 26, 30))
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(REG, 22, index=3)
    x = 4
    for name, c in cells:
        d.text((x, 6), name, font=f, fill=(255, 255, 255))
        img.paste(c, (x, 36))
        x += c.width + 4
    img.save(out)
    print(out.name, img.size)


if __name__ == "__main__":
    main()
