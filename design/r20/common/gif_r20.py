"""R20: before and after moving, a GIF a farmer: each changed action in turn at the game's frames a second; left the
old (art-v7.8's code), right the new, each at the phone's size on the grass and three times that on its colour.
Walking the farmer crosses the ground as the game moves him (ticks stay on it).

python3 design/r20/common/gif_r20.py DRAFTS ART_X3 OUT e|w ...
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import boards_r20 as R    # noqa: E402  (art_r19 as R.A, boards_r19 as R.B)

A, B = R.A, R.B
N = 3
# (action, facing, frames, frames a second, loops, seconds its last frame is held)
ACTS = {"e": [("idle", 7, 8, 8, 2, 0), ("walk", 0, 8, 12, 2, 0), ("attack", 7, 10, 20, 2, 1.0), ("death", 7, 10, 12, 1, 1.2),
              ("work_chop", 7, 8, 10, 2, 0), ("work_mine", 7, 8, 10, 2, 0), ("work_build", 7, 8, 10, 2, 0)],
        "w": [("work_chop", 7, 8, 10, 2, 0), ("work_mine", 7, 8, 10, 2, 0), ("work_build", 7, 8, 10, 2, 0)]}
STEP = 10        # px a frame walking (a cell a second: 120 px over 12 frames)


def gif(D, c, out):
    l = t = r = b = 0
    for anim, face, n, _, _, _ in ACTS[c]:
        bl, bt, br, bb = D.box(c, anim, face, range(n), pad=8)
        l, t, r, b = max(l, bl), max(t, bt), max(r, br + (STEP * n * 2 if anim == "walk" else 0)), max(b, bb)
    w, h = l + r, t + b
    ground = A.grass(D.art, w, h)
    flat = Image.new("RGB", (w, h), D.bg)
    ticked = flat.copy()
    td = ImageDraw.Draw(ticked)
    for x in range(0, w, 10):
        td.line([(x, t + 6), (x, t + (12 if x % 40 else 18))], fill=(255, 255, 255), width=1)
    top, gap = 150, 30
    side = w + 12 + w * N
    W, H = 2 * side + gap, h * N + top
    label = f"R20-農民{R.NAME[c]}-改前改後-phone"
    fh, fb = B.font(34), B.font(28, False)
    frames, times = [], []

    def shot(anim, face, k, dx, text):
        img = Image.new("RGB", (W, H), B.BG)
        d = ImageDraw.Draw(img)
        d.text((8, 4), label, font=fh, fill=B.WHITE)
        d.text((8, 52), text, font=fb, fill=B.PALE)
        for i, new in enumerate((False, True)):
            x0 = i * (side + gap)
            d.text((x0 + 8, 100), ("改後" if new else "改前") + "　左：手機上的大小　右：放大 3 倍", font=B.font(28), fill=(150, 230, 150) if new else (255, 150, 130))
            for base, at, big in ((ground, (x0, top + (h * N - h) // 2), False), (ticked if anim == "walk" else flat, (x0 + w + 12, top), True)):
                st = A.Stage(base)
                st.put(D.spr(c, new, anim, face, k), l + dx, t)
                im = st.render()
                img.paste(A.enlarge(im, N) if big else A.phone(im), at)
        return img

    for anim, face, n, fps, loops, hold in ACTS[c]:
        ms = round(1000 / fps / 10) * 10
        name = f"{A.ANIM_NAME[anim]}　每秒 {fps} 格" + ("，朝右走、照遊戲的速度前進" if anim == "walk" else "")
        for rep in range(loops):
            for k in range(n):
                frames.append(shot(anim, face, k, STEP * (rep * n + k) if anim == "walk" else 0, name))
                times.append(ms)
            if hold:
                times[-1] += round(hold * 1000)
    p = out / f"{label}.gif"
    pal = [f.quantize(colors=255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for f in frames]
    pal[0].save(p, save_all=True, append_images=pal[1:], duration=times, loop=0, disposal=1)
    print(p.name, (W, H), f"{len(frames)} frames, {sum(times) / 1000:.1f} s, {p.stat().st_size / 1e6:.1f} MB")


def main():
    D = R.Drafts(Path(sys.argv[1]), Path(sys.argv[2]))
    out = Path(sys.argv[3])
    out.mkdir(parents=True, exist_ok=True)
    for c in sys.argv[4:] or ("e", "w"):
        gif(D, c, out)


if __name__ == "__main__":
    main()
