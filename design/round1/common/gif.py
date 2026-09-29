"""Mage animation GIF and key-frame sheet, the same for every option.

Frame contract (each option writes this):
  <dir>/<anim>_<NN>.png   RGBA, 4x art scale (80 px per metre), final look (shadow, fx included)
  <dir>/<anim>_<NN>.json  {"anchor": [x, y]}  ground point under the feet, in pixels
  anims and counts = MAGE_FRAMES, played at 12 fps.
The option also passes a background tile (RGBA or RGB) for the ground.
"""
import json
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

import artboard
import config

MAGE_FRAMES = [("idle", 12), ("walk", 12), ("cast", 30), ("hit", 6), ("shatter", 8), ("fall", 12), ("dead", 4)]
CAPTION = {
    "idle": "待機", "walk": "走路", "hit": "防護罩中彈（閃爍）", "shatter": "防護罩碎裂", "fall": "倒下",
    "dead": "倒下（陣亡，魔晶散落）",
}
FPS = 12


def caption_for(anim, f):
    if anim == "cast":
        if f < 6:
            return "晶砲：舉起法印"
        if f < 24:
            return f"晶砲：原地校準 1.5 秒（{(f - 6) / 12:.1f} 秒）"
        return "晶砲：發射"
    return CAPTION[anim]


def cover(bg, w, h):
    """Scale to cover (w, h) keeping the aspect ratio, then centre-crop."""
    bg = bg.convert("RGBA")
    k = max(w / bg.width, h / bg.height)
    im = bg.resize((max(w, int(bg.width * k + 0.5)), max(h, int(bg.height * k + 0.5))), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def load_frames(d):
    d = Path(d)
    out = []
    for anim, n in MAGE_FRAMES:
        for f in range(n):
            img = Image.open(d / f"{anim}_{f:02d}.png").convert("RGBA")
            meta = json.loads((d / f"{anim}_{f:02d}.json").read_text())
            out.append((anim, f, img, tuple(meta["anchor"])))
    return out


def make_gif(frames_dir, background, label, out_gif, walk_px_per_frame=0, warn_ring=None, ink=(30, 30, 34)):
    """Left: actual size (1x of the 4x art = 1 pt per px). Right: 4x. Caption at the bottom."""
    frames = load_frames(frames_dir)
    W4, H4 = 560, 330                 # right panel (4x)
    W1, H1 = 150, H4                  # left panel (1x)
    PAD, TOP, BOT = 16, 64, 50
    WW = PAD + W1 + PAD + W4 + PAD
    HH = TOP + H4 + BOT
    ftitle = artboard.font(20)
    fcap = artboard.font(22)
    fsmall = artboard.font(14, weight="regular")
    bg = background.convert("RGBA")
    tmp = Path(tempfile.mkdtemp(prefix="gif_", dir=config.BUILD))
    ax4 = (W4 * 0.32, H4 * 0.78)      # where the mage stands in the 4x panel
    for i, (anim, f, img, anchor) in enumerate(frames):
        can = Image.new("RGBA", (WW, HH), (244, 241, 234, 255))
        d = ImageDraw.Draw(can)
        d.text((PAD, 10), label, font=ftitle, fill=ink)
        d.text((PAD, 38), "左：實際大小（1 pt = 1 px）　右：放大 4 倍　每秒 12 格", font=fsmall, fill=(110, 110, 110))
        # right panel
        panel = Image.new("RGBA", (W4, H4))
        panel.alpha_composite(cover(bg, W4, H4))
        if warn_ring:
            warn_ring(panel, anim, f)
        dx = 0
        panel.alpha_composite(img, (int(ax4[0] - anchor[0] + dx), int(ax4[1] - anchor[1])))
        can.alpha_composite(panel, (PAD + W1 + PAD, TOP))
        # left panel: the same frame at actual size
        small = img.resize((max(1, img.width // 4), max(1, img.height // 4)), Image.LANCZOS)
        lp = Image.new("RGBA", (W1, H1))
        # the 1x panel shows the ground at 1x too: a 4x-smaller piece of the same texture
        lp.alpha_composite(cover(bg.resize((max(1, bg.width // 3), max(1, bg.height // 3))), W1, H1))
        lp.alpha_composite(small, (int(W1 * 0.4 - anchor[0] / 4), int(H1 * 0.62 - anchor[1] / 4)))
        can.alpha_composite(lp, (PAD, TOP))
        d.rectangle((PAD - 1, TOP - 1, PAD + W1, TOP + H1), outline=(150, 150, 150))
        d.rectangle((PAD + W1 + PAD - 1, TOP - 1, PAD + W1 + PAD + W4, TOP + H4), outline=(150, 150, 150))
        d.text((PAD + W1 + PAD, TOP + H4 + 12), caption_for(anim, f), font=fcap, fill=ink)
        can.convert("RGB").save(tmp / f"{i:04d}.png")
    pal = tmp / "palette.png"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", str(FPS), "-i", str(tmp / "%04d.png"),
                    "-vf", "palettegen=stats_mode=full:max_colors=256", str(pal)], check=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", str(FPS), "-i", str(tmp / "%04d.png"),
                    "-i", str(pal), "-lavfi", "paletteuse=dither=sierra2_4a:diff_mode=rectangle", "-loop", "0",
                    str(out_gif)], check=True)
    for p in tmp.iterdir():
        p.unlink()
    tmp.rmdir()
    return out_gif


KEYS = [("idle", 3, "待機"), ("walk", 3, "走路"), ("cast", 8, "晶砲：校準開始"), ("cast", 20, "晶砲：校準完成"),
        ("cast", 25, "晶砲：發射"), ("hit", 0, "防護罩中彈"), ("shatter", 2, "防護罩碎裂"), ("fall", 6, "倒下"),
        ("dead", 0, "陣亡")]


def keyframe_sheet(frames_dir, background, label, out_png, note=None):
    frames = {(a, f): (img, anc) for a, f, img, anc in load_frames(frames_dir)}
    cw, ch = 300, 280
    cols = len(KEYS)
    W = 40 + cols * (cw + 12)
    H = 150 + ch + 90
    can = Image.new("RGB", (W, H), (244, 241, 234))
    d = ImageDraw.Draw(can)
    d.text((40, 30), label, font=artboard.font(40), fill=(30, 30, 34))
    d.text((40, 88), note or "術士（東陸、法印）關鍵影格，放大 4 倍", font=artboard.font(24, weight="regular"),
           fill=(110, 110, 110))
    for i, (a, f, cap) in enumerate(KEYS):
        img, anc = frames[(a, f)]
        cell = Image.new("RGBA", (cw, ch))
        cell.alpha_composite(cover(background, cw, ch))
        cell.alpha_composite(img, (int(cw * 0.42 - anc[0]), int(ch * 0.8 - anc[1])))
        x = 40 + i * (cw + 12)
        can.paste(cell.convert("RGB"), (x, 150))
        d.text((x, 150 + ch + 14), cap, font=artboard.font(24), fill=(30, 30, 34))
    can.save(out_png)
    return out_png
