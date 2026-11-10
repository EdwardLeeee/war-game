"""R19: the sheets the frames are looked over on, an action a sheet: a row a rendered facing, a column a frame, twice
the art's size on the grass's colour, ticks every 20 px of a cell along its top and left (a finding's circle is given
in a cell's px from its top-left).

python3 design/r19/common/inspect_r19.py ART_X3 OUT unit [anim ...]
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
import art_r19 as A   # noqa: E402

REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
N = 2


def sheet(art, unit, anim, team="blue"):
    u = A.Unit(art, unit)
    info = u.anims[anim]
    l, t, r, b = u.box(anim)
    cw, ch = l + r + 8, t + b + 8
    n = info["frames"]
    pad_l, pad_t = 150, 60
    bg = A.grass_colour(art)
    img = Image.new("RGB", (pad_l + n * cw * N, pad_t + len(A.FACES) * ch * N), (24, 26, 30))
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(REG, 26, index=3)
    d.text((8, 8), f"{unit} {anim} {A.ANIM_NAME.get(anim, '')}  {n} 格 fps {info.get('fps')} hit {info.get('hit', info.get('impact', '-'))}  cell {cw}x{ch} anchor ({l + 4},{t + 4})", font=f, fill=(255, 255, 255))
    for row, face in enumerate(A.FACES):
        st = A.Stage(Image.new("RGB", (n * cw, ch), bg))
        for k in range(n):
            st.put(u.sprite(anim, face, k, team), k * cw + l + 4, t + 4)
        strip = A.enlarge(st.render(), N)
        y = pad_t + row * ch * N
        img.paste(strip, (pad_l, y))
        d.text((8, y + 8), f"f{face} {A.FACE_NAME[face]}", font=f, fill=(250, 220, 140))
        for k in range(n):
            x = pad_l + k * cw * N
            d.line([(x, y), (x, y + ch * N)], fill=(24, 26, 30), width=2)
            d.text((x + 6, y + 4), str(k), font=f, fill=(255, 255, 255))
            for q in range(0, cw, 20):
                d.line([(x + q * N, y), (x + q * N, y + (10 if q % 100 else 20))], fill=(255, 255, 255), width=1)
            for q in range(0, ch, 20):
                d.line([(x, y + q * N), (x + (10 if q % 100 else 20), y + q * N)], fill=(255, 255, 255), width=1)
        d.line([(pad_l, y), (img.width, y)], fill=(24, 26, 30), width=2)
    return img


def main():
    art, out, unit = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
    out.mkdir(parents=True, exist_ok=True)
    u = A.Unit(art, unit)
    for anim in (sys.argv[4:] or list(u.anims)):
        p = out / f"{unit}_{anim}.png"
        im = sheet(art, unit, anim)
        im.save(p)
        print(p.name, im.size)


if __name__ == "__main__":
    main()
