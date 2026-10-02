"""B1b-03 boards and GIFs for the 晶砲 warning circle (common/warn.py).

python3 common/warn_art.py   -> out/B1b-03-晶砲預警圈-<A|B>-<名>-mobile.png and -動作.gif
"""
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(1, str(HERE.parents[1] / "round1" / "common"))
sys.path.insert(2, str(HERE.parents[1] / "round2" / "common"))
import artboard   # noqa: E402
import b1art      # noqa: E402
import config     # noqa: E402
import scene      # noqa: E402
import warn       # noqa: E402

OPTS = [("A", "收束圈", "選項 A「收束圈」：外圈是爆炸範圍的邊（半徑 1.5 格），清楚的橘紅線加一圈刻度；一道亮環從邊緣往中心收，"
         "收到中心就落下；亮環走過的地方越來越熱，最後 5 格（0.25 秒）整圈閃亮。"),
        ("B", "符文漸強", "選項 B「符文漸強」：一個原創的晶紋法陣（雙圈、六個晶形記號、六角連線，取魔晶的六個面）慢慢轉；"
         "越來越亮、填色越來越濃，脈動從每秒 3 下加快到每秒 9 下，最後 5 格中心燒成金白色。")]
KEYS = [(0, "1.5 秒前"), (10, "1.0 秒前"), (20, "0.5 秒前"), (27, "落下前一刻")]
CELL = 2.0


def background(kind, ppm, w, h):
    """Grass (the plain ground colour with a little noise) or the paving of the small East town, centred on a
    street crossing."""
    if kind == "grass":
        import numpy as np
        rng = np.random.default_rng(3)
        base = np.array(b1art.GROUND, np.float32)[None, None, :] * (1 + 0.05 * rng.standard_normal((h, w, 1)))
        return Image.fromarray(np.clip(base, 0, 255).astype("uint8"), "RGB").convert("RGBA"), (w / 2, h * 0.55)
    sp = scene.piece(config.BUILD / "b1" / "towns", "tground_E_small", "x3", ppm=ppm, shadow=False)
    img = Image.new("RGBA", (w, h), (*b1art.GROUND, 255))
    origin = (w / 2, h * 0.55)
    cx = cy = 0.0                                # the town square
    gx, gy = __import__("proj").to_px((-cx, -cy), origin, ppm)
    img.alpha_composite(sp.img, (int(round(gx - sp.ax)), int(round(gy - sp.ay))))
    return img, origin


def panel(style_frames, tick, kind, ppm, w, h):
    img, origin = background(kind, ppm, w, h)
    fr, (ax, ay) = style_frames[tick]
    img.alpha_composite(fr, (int(round(origin[0] - ax)), int(round(origin[1] - ay))))
    # three red soldiers inside the circle (the targets), drawn over the ground effect
    items = [scene.unit("spear_e", "red", facing=f, scale=ppm / 60, x=x, y=y)
             for x, y, f in ((-1.3, -0.3, 7), (0.5, -1.2, 6), (0.6, 1.0, 0))]
    units, _ = b1art.render_transparent(items, ppm, origin, img.size)
    img.alpha_composite(units)
    return img


def board(opt, name, sub, ppm_big=30, ppm_small=20):
    label = f"B1b-03-晶砲預警圈-{opt}-{name}-mobile"
    fr_big = warn.frames(opt, ppm_big)
    fr_small = warn.frames(opt, ppm_small)
    W1, H1 = int(8.5 * ppm_big), int(4.6 * ppm_big)
    W2, H2 = int(8.5 * ppm_small), int(4.6 * ppm_small)
    rows = []
    for kind, kname in (("grass", "草地"), ("paving", "城鎮鋪面")):
        cells = [b1art.caption(panel(fr_big, t, kind, ppm_big, W1, H1), f"{kname}・{lab}", 15) for t, lab in KEYS]
        rows.append((f"{kname}（1 pt = 1.5 px）", cells))
    small = []
    for kind, kname in (("grass", "草地"), ("paving", "城鎮鋪面")):
        for t, lab in ((0, "1.5 秒前"), (20, "0.5 秒前")):
            small.append(b1art.caption(panel(fr_small, t, kind, ppm_small, W2, H2), f"{kname}・{lab}", 13))
    rows.append(("實際大小（1 pt = 1 px）", small))
    M, lab_w, gap = 50, 250, 10
    W = M * 2 + lab_w + max(sum(i.width + gap for i in r) for _, r in rows)
    sub2 = sub + ("\n半徑 1.5 格（3 公尺），校準 1.5 秒（30 個 tick）。橘紅色，和魔晶青、防護罩分得開；敵我看到的是同一個圈。"
                  "畫在地面上、單位底下（圈裡站三名紅色士兵）。另附動作 GIF。")
    top = b1art.header_height(sub2, W - 2 * M)
    H = top + sum(max(i.height for i in r) + 24 for _, r in rows) + 30
    art = Image.new("RGB", (W, H), b1art.BG)
    y = b1art.draw_header(art, label, sub2, M)
    dr = ImageDraw.Draw(art)
    for name_, r in rows:
        h = max(i.height for i in r)
        dr.text((M, y + h // 2 - 14), name_, font=artboard.font(22), fill=b1art.INK)
        x = M + lab_w
        for im in r:
            art.paste(im.convert("RGB"), (x, y + h - im.height))
            x += im.width + gap
        y += h + 24
    art = art.crop((0, 0, W, y + 10))
    p = config.OUT / f"{label}.png"
    art.save(p)
    print("wrote", p.name, art.size)
    gp = 45
    gif(opt, name, warn.frames(opt, gp), gp, int(8.5 * gp), int(4.6 * gp))
    return p


def gif(opt, name, fr, ppm, w, h):
    label = f"B1b-03-晶砲預警圈-{opt}-{name}-動作"
    tmp = Path(tempfile.mkdtemp(prefix="warn_", dir=config.BUILD))
    pads = 8                                          # a short pause after it lands, then it loops
    n = 0
    for t in list(range(warn.TICKS)) + [None] * pads:
        can = Image.new("RGB", (2 * w + 30, h + 74), b1art.BG)
        d = ImageDraw.Draw(can)
        d.text((10, 8), label, font=artboard.font(20), fill=b1art.INK)
        d.text((10, 38), "左：草地　右：城鎮鋪面（1 pt = 2.25 px，每秒 20 格；校準 1.5 秒後落下，停一下再重播）",
               font=artboard.font(15), fill=b1art.GREY)
        for k, kind in enumerate(("grass", "paving")):
            if t is None:
                img, _ = background(kind, ppm, w, h)
                items = [scene.unit("spear_e", "red", facing=f, scale=ppm / 60, x=x, y=y)
                         for x, y, f in ((-1.3, -0.3, 7), (0.5, -1.2, 6), (0.6, 1.0, 0))]
                origin = (w / 2, h * 0.55)
                u, _ = b1art.render_transparent(items, ppm, origin, img.size)
                img.alpha_composite(u)
            else:
                img = panel(fr, t, kind, ppm, w, h)
            can.paste(img.convert("RGB"), (10 + k * (w + 10), 64))
        can.save(tmp / f"{n:03d}.png")
        n += 1
    out = config.OUT / f"{label}.gif"
    pal = tmp / "pal.png"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", "20", "-i", str(tmp / "%03d.png"), "-vf",
                    "palettegen=stats_mode=full", str(pal)], check=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", "20", "-i", str(tmp / "%03d.png"), "-i",
                    str(pal), "-lavfi", "paletteuse=dither=bayer:bayer_scale=4", "-loop", "0", str(out)], check=True)
    for p in tmp.iterdir():
        p.unlink()
    tmp.rmdir()
    print("wrote", out.name, f"{out.stat().st_size / 2 ** 20:.1f} MB")


if __name__ == "__main__":
    config.OUT.mkdir(parents=True, exist_ok=True)
    for o, n, s in OPTS:
        board(o, n, s)
