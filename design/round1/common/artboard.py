"""Turn a 2796x1290 screen into a labelled artboard.

Layout: label (= file name) top-left, phone with rounded corners, dynamic
island and dashed safe area, then a strip with the actual-size view and the
unit-height ruler. Measurement text: green = passes, red = problem, grey = note.
"""
from PIL import Image, ImageDraw, ImageFont

import config

S = config.SCALE
SW, SH = config.SCREEN_W * S, config.SCREEN_H * S
GREEN, RED, GREY = (46, 140, 70), (200, 40, 36), (110, 110, 110)
INK = (30, 30, 34)


def font(size, serif=False, weight="bold"):
    f = config.fonts()
    path = f["serif"] if serif else (f["sans"] if weight == "bold" else f["sans_regular"])
    # Noto CJK .ttc: pick the Traditional Chinese face
    for idx in range(10):
        try:
            ft = ImageFont.truetype(path, size, index=idx)
        except OSError:
            break
        if "TC" in " ".join(ft.getname()):
            return ft
    return ImageFont.truetype(path, size)


def phone(screen):
    """Rounded display, dynamic island, safe-area guides; returns RGBA with bezel."""
    bez = 22 * S // 3 * 2
    W, H = SW + 2 * bez, SH + 2 * bez
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(out)
    r = config.CORNER_RADIUS * S
    d.rounded_rectangle((0, 0, W - 1, H - 1), radius=r + bez, fill=(18, 18, 20, 255))
    d.rounded_rectangle((3, 3, W - 4, H - 4), radius=r + bez - 3, outline=(70, 70, 76, 255), width=3)
    mask = Image.new("L", (SW, SH), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, SW - 1, SH - 1), radius=r, fill=255)
    out.paste(screen.convert("RGBA"), (bez, bez), mask)
    d = ImageDraw.Draw(out)
    isl = config.ISLAND
    ix0 = bez + isl["inset"] * S
    iy0 = bez + (SH - isl["h"] * S) // 2
    d.rounded_rectangle((ix0, iy0, ix0 + isl["w"] * S, iy0 + isl["h"] * S), radius=isl["w"] * S // 2,
                        fill=(0, 0, 0, 255))
    # safe area (dashed magenta) and home indicator
    sa = config.SAFE
    col = (255, 60, 200, 210)
    x0, x1 = bez + sa["left"] * S, bez + SW - sa["right"] * S
    y1 = bez + SH - sa["bottom"] * S

    def dashed(p0, p1):
        (a, b), (c, e) = p0, p1
        n = int(max(abs(c - a), abs(e - b)) / 24)
        for k in range(n):
            if k % 2:
                continue
            t0, t1 = k / n, (k + 1) / n
            d.line((a + (c - a) * t0, b + (e - b) * t0, a + (c - a) * t1, b + (e - b) * t1), fill=col, width=3)
    dashed((x0, bez), (x0, y1))
    dashed((x1, bez), (x1, y1))
    dashed((x0, y1), (x1, y1))
    hw = 200 * S
    d.rounded_rectangle((bez + SW / 2 - hw / 2, bez + SH - 13 * S, bez + SW / 2 + hw / 2, bez + SH - 8 * S),
                        radius=3 * S, fill=(255, 255, 255, 200))
    f = font(26)
    d.text((x0 + 10, y1 - 40), "安全區", font=f, fill=col)
    return out, bez


def compose_artboard(screen, label, subtitle, ruler, notes, out_path):
    """ruler: list of (name, sprite RGBA at 3x, body_pt, total_pt); notes: list of (text, colour)."""
    ph, bez = phone(screen)
    M = 90
    head_h = 190
    one_x = screen.convert("RGB").resize((config.SCREEN_W, config.SCREEN_H), Image.LANCZOS)
    strip_h = 60 + config.SCREEN_H + 40
    W = ph.width + 2 * M
    H = head_h + ph.height + strip_h + 40
    art = Image.new("RGB", (W, H), (244, 241, 234))
    d = ImageDraw.Draw(art)
    d.text((M, 40), label, font=font(56), fill=INK)
    d.text((M, 118), subtitle, font=font(32, weight="regular"), fill=GREY)
    art.paste(ph, (M, head_h), ph)
    y = head_h + ph.height + 50
    # actual size (1 pt = 1 px)
    d.text((M, y), "實際大小（1 pt = 1 px；一般電腦螢幕上約是 iPhone 實物的 1.5 倍大）", font=font(28), fill=INK)
    art.paste(one_x, (M, y + 50))
    d.rectangle((M - 1, y + 49, M + config.SCREEN_W, y + 50 + config.SCREEN_H), outline=(160, 160, 160), width=1)
    # ruler with unit sprites at phone pixel scale (3x)
    rx = M + config.SCREEN_W + 70
    d.text((rx, y), "兵種高度（圖為 3 倍、與手機像素相同；pt = 手機上的點）", font=font(28), fill=INK)
    base_y = y + 50 + 250
    x = rx
    fs = font(24)
    fs_s = font(20, weight="regular")
    for name, spr, body_pt, total_pt, ok in ruler:
        bb = spr.getbbox()
        im = spr.crop(bb)
        if x + im.width > W - M:
            break
        art.paste(im, (x, base_y - im.height), im)
        d.line((x - 6, base_y, x + im.width + 6, base_y), fill=(120, 120, 120), width=2)
        d.text((x, base_y + 10), name, font=fs, fill=INK)
        d.text((x, base_y + 42), f"身體 {body_pt:.0f} pt", font=fs_s, fill=GREEN if ok else RED)
        d.text((x, base_y + 68), f"含旗械 {total_pt:.0f}", font=fs_s, fill=GREY)
        x += max(im.width, 120) + 26
    ny = base_y + 110
    for text, col in notes:
        d.text((rx, ny), text, font=font(24, weight="regular"), fill=col)
        ny += 36
    art.save(out_path)
    return out_path
