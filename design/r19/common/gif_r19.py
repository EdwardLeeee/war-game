"""R19: a unit's every action moving, a GIF: at the phone's size on the pack's grass on the left, three times that
on the grass's colour on the right (a flat ground keeps the file small; walking, ticks stay on it), each action at the frames a second the client plays it at (client/src/art/spec.ts: fpsOf, walkFps at a
cell a second). Walking it crosses the ground to the right as the game moves it, so a sliding foot shows; an attack
holds its first frame between swings as the client does; a fall holds its last frame.

python3 design/r19/common/gif_r19.py ART_X3 OUT unit [unit ...]
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import art_r19 as A            # noqa: E402
import boards_r19 as B         # noqa: E402
import findings_r19 as F       # noqa: E402

N = 3
ONCE_HOLD_S = {"attack": 0.5, "sling": 0.5, "cast": 0.5, "hit": 0.4, "shatter": 0.6, "death": 1.2, "fall": 1.0, "dead": 1.0}


def gif(art, unit, out):
    spec = F.UNITS[unit]
    u = A.Unit(art, unit)
    label = f"R19-{spec['no']:02d}-{spec['name']}"
    walk = u.anims["walk"]
    step = walk["stride_m"] * 60 / walk["frames"] if walk.get("stride_m") else 120 / walk["fps"]
    travel = round(step * walk["frames"] * 2)
    l = t = r = b = 0
    for anim in u.anims:
        bl, bt, br, bb = B.pad(u.box(anim, [0] if anim == "walk" else [B.MAIN]), 8)
        l, t, r, b = max(l, bl), max(t, bt), max(r, br + (travel if anim == "walk" else 0)), max(b, bb)
    wn, hn = l + r, t + b
    ground = A.grass(art, wn, hn)
    W, H, top = wn + 16 + wn * N, hn * N, 96
    fh, fb = B.font(34), B.font(26, False)
    frames, times = [], []

    flat = Image.new("RGB", (wn, hn), A.grass_colour(art))
    ticked = flat.copy()
    td = ImageDraw.Draw(ticked)
    for x in range(0, wn, 10):
        td.line([(x, t + 6), (x, t + (12 if x % 40 else 18))], fill=(255, 255, 255), width=1)

    def shot(anim, face, k, x, text):
        img = Image.new("RGB", (W, H + top), B.BG)
        d = ImageDraw.Draw(img)
        d.text((8, 4), label, font=fh, fill=B.WHITE)
        d.text((8, 52), text, font=fb, fill=B.PALE)
        for base, place, big in ((ground, (0, top + (H - hn) // 2), False), (ticked if anim == "walk" else flat, (wn + 16, top), True)):
            st = A.Stage(base)
            st.put(u.sprite(anim, face, k), x, t)
            im = st.render()
            img.paste(A.enlarge(im, N) if big else A.phone(im), place)
        return img

    for anim, info in u.anims.items():
        n, fps = info["frames"], info["fps"]
        ms = round(1000 / fps / 10) * 10
        name = f"{A.ANIM_NAME[anim]}　每秒 {fps} 格"
        if anim == "walk":
            for k in range(2 * n):
                frames.append(shot(anim, 0, k % n, l + round(step * k), name + "，朝右走、照遊戲的速度前進；白線釘在地上"))
                times.append(ms)
        elif info.get("loop"):
            for k in range(2 * n):
                frames.append(shot(anim, B.MAIN, k % n, l, name))
                times.append(ms)
        else:
            hold = round(ONCE_HOLD_S.get(anim, 0.5) * 1000)
            for rep in range(1 if anim in ("death", "fall", "dead") else 2):
                for k in range(n):
                    frames.append(shot(anim, B.MAIN, k, l, name))
                    times.append(ms)
                if anim in ("death", "fall", "dead", "shatter"):
                    times[-1] += hold                        # lies there
                else:
                    frames.append(shot(anim, B.MAIN, 0, l, name + "（兩次之間停在第 1 格）"))
                    times.append(hold)
    path = out / f"{label}-動作-phone.gif"
    pal = [f.quantize(colors=255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for f in frames]
    pal[0].save(path, save_all=True, append_images=pal[1:], duration=times, loop=0, disposal=1)
    return path, (W, H + top), len(frames), sum(times) / 1000


def main():
    art, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    for unit in sys.argv[3:]:
        p, size, n, secs = gif(art, unit, out)
        print(p.name, size, f"{n} frames, {secs:.1f} s, {p.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
