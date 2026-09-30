"""C 水墨戰卷: same Blender passes as B, painted as ink on rice paper (colour only for players and magic).

python3 c-ink/make_c.py  -> build/c/scene.png (2796x1290, no UI yet)
"""
import math
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "common"))
sys.path.insert(0, str(HERE.parent / "blender"))
sys.path.insert(0, str(HERE.parent / "b-3d"))

import cairo                                   # noqa: E402
import numpy as np                             # noqa: E402
from PIL import Image, ImageDraw, ImageFilter  # noqa: E402

import compose        # noqa: E402
import config         # noqa: E402
import magic          # noqa: E402
import scene          # noqa: E402
import stage          # noqa: E402
from make_b import sigil_screen   # noqa: E402
from render_scene import key      # noqa: E402

SPR = config.BUILD / "3d" / "sprites"
OUT = config.BUILD / "c"
S = config.SCALE
W, H = compose.W, compose.H
INK = np.array([24, 20, 18], np.float32)
# team colours dyed a little deeper to sit on the paper, still the brightest thing on screen
TEAM_C = {"blue": (40, 96, 200), "red": (196, 40, 32)}


PAPER = np.array([238, 231, 214], np.float32)


def _noise_like(h, w, cell, seed):
    return compose.value_noise(w, h, cell, seed=seed, octaves=2, stretch_y=1.0)


def toon(albedo, light, mask, team, outline_px=2, seed=0):
    """Ink painting of a rendered sprite: tones of ink on paper, colour only for the
    player-colour parts and the magic, and a brush outline that swells and breaks."""
    A = np.asarray(albedo, np.float32) / 255.0
    Lt = np.asarray(light, np.float32) / 255.0
    M = np.asarray(mask.convert("RGBA"), np.float32) / 255.0
    alpha = A[..., 3]
    rgb = A[..., :3]
    h, w = alpha.shape
    val = rgb[..., 0] * 0.3 + rgb[..., 1] * 0.59 + rgb[..., 2] * 0.11
    lum = Lt[..., 0] * 0.3 + Lt[..., 1] * 0.59 + Lt[..., 2] * 0.11
    # light: paper / light wash / dark wash
    q = 0.58 + 0.2 * compose.smoothstep(0.3, 0.34, lum) + 0.22 * compose.smoothstep(0.6, 0.64, lum)
    # material value -> ink density, a wet-wash wobble on the mid tones
    tone = np.clip(0.18 + 0.95 * val, 0, 1) * q
    tone += (_noise_like(h, w, 6, seed + 3) - 0.5) * 0.12 * (1 - np.abs(tone - 0.5) * 2)
    gray = PAPER / 255.0 * tone[..., None] + INK / 255.0 * (1 - tone[..., None])
    col = gray
    # 魔晶 cyan (emissive; may saturate toward (0.9, 1, 1)) keeps its colour
    magic_px = ((rgb[..., 2] > 0.9) & (rgb[..., 1] > 0.85) & (rgb[..., 0] < 0.975)
                & (rgb[..., 2] - rgb[..., 0] > 0.02))[..., None]
    crystal = np.array([0.35, 0.95, 1.0], np.float32)
    col = np.where(magic_px, rgb * 0.4 + crystal * 0.6, col)
    if team:
        k = (M[..., 0] * M[..., 3])[..., None]
        tc = np.asarray(TEAM_C[team], np.float32) / 255.0
        dyed = tc * (0.55 + 0.45 * q[..., None])
        col = col * (1 - k) + dyed * k
    # wet edge: ink pools along the inside of each shape, like a wash drying on paper
    ab = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(3 + outline_px)), np.float32) / 255.0
    pool = np.clip(alpha - ab, 0, 1)[..., None] * 0.9
    col = col * (1 - pool) + INK / 255.0 * pool
    rgba = np.dstack([np.clip(col, 0, 1) * 255, alpha * 255]).astype(np.uint8)
    body = Image.fromarray(rgba, "RGBA")
    # brush outline: width swells from thin to heavy along the stroke, with dry-brush breaks
    a = body.split()[3]
    widths = [a.filter(ImageFilter.MaxFilter(2 * r + 1)) for r in
              (1, max(1, outline_px - 1), outline_px, outline_px + 1)]
    sel = _noise_like(h, w, 14, seed + 7)
    stack = np.stack([np.asarray(x, np.float32) for x in widths], 0)
    idx = np.clip((sel * 4).astype(int), 0, 3)
    wide = np.take_along_axis(stack, idx[None], 0)[0] / 255.0
    dry = compose.smoothstep(0.12, 0.3, _noise_like(h, w, 3, seed + 11))
    ink_a = np.clip(wide * (0.55 + 0.45 * dry), 0, 1)
    ink = np.zeros((h, w, 4), np.float32)
    ink[..., :3] = INK
    ink[..., 3] = ink_a * 255
    out = Image.fromarray(ink.astype(np.uint8), "RGBA")
    out.alpha_composite(body)
    return out


def paper(w, h, seed=1):
    """Rice paper: near white, faint warm mottling and fibres (the 留白)."""
    n1 = compose.value_noise(w, h, 300, seed=seed, octaves=4, stretch_y=1.0)
    n2 = compose.value_noise(w, h, 8, seed=seed + 1, octaves=2, stretch_y=1.0)
    rgb = compose.lerp_rgb((226, 216, 194), (242, 236, 220), n1)
    rgb *= (0.97 + 0.05 * n2)[..., None]
    img = compose.to_img(rgb)
    rnd = random.Random(seed)
    dr = ImageDraw.Draw(img)
    for _ in range(2600):
        x, y = rnd.randrange(w), rnd.randrange(h)
        a = rnd.uniform(0, math.pi)
        L = rnd.uniform(6, 22)
        c = rnd.choice([(212, 200, 176), (250, 246, 236)])
        dr.line((x, y, x + L * math.cos(a), y + L * math.sin(a)), fill=c, width=1)
    return img


def wash(mask, color, alpha, edge_noise, bleed=6):
    """Ink wash: soft wet edge plus a darker rim where the pigment pooled."""
    m = compose.smoothstep(0.3, 0.7, np.clip(mask + (edge_noise - 0.5) * 0.5, 0, 1))
    rim = np.clip(m - np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(bleed)), np.float32) / 255.0, 0, 1)
    a = np.clip(m * alpha + rim * 0.8 * alpha, 0, 1)
    rgb = np.empty(m.shape + (3,), np.float32)
    rgb[:] = color
    return compose.to_img(rgb, a)


def brush_edge(mask, width=0.06, seed=0, alpha=0.55, color=(30, 26, 22)):
    """Dry-brush contour along the edge of a soft mask (the painter outlining a patch)."""
    band = compose.smoothstep(0.5 - width, 0.5, mask) * (1 - compose.smoothstep(0.5, 0.5 + width, mask))
    dry = compose.smoothstep(0.35, 0.7, compose.value_noise(W, H, 5, seed=seed, octaves=2, stretch_y=1.0))
    streak = compose.value_noise(W, H, 60, seed=seed + 1, octaves=2)
    a = band * 2.2 * dry * (0.5 + 0.5 * streak) * alpha
    rgb = np.empty(mask.shape + (3,), np.float32)
    rgb[:] = color
    return compose.to_img(rgb, np.clip(a, 0, 1))


def soft_wash(mask, color, alpha):
    rgb = np.empty(mask.shape + (3,), np.float32)
    rgb[:] = color
    return compose.to_img(rgb, np.clip(mask * alpha, 0, 1))


def ground():
    """Mostly paper; the land is suggested with light and dark ink washes and brush edges."""
    img = paper(W, H)
    edge = compose.value_noise(W, H, 50, seed=7, octaves=3)
    big = compose.value_noise(W, H, 360, seed=8, octaves=3)
    img.alpha_composite(soft_wash(compose.smoothstep(0.45, 0.85, big), (128, 130, 118), 0.28))
    img.alpha_composite(soft_wash(compose.smoothstep(0.7, 0.95, big), (80, 84, 76), 0.22))
    bf = scene.BATTLEFIELD
    m_bf = compose.ellipse_mask(bf["x"], bf["y"], bf["rx"], bf["ry"], edge, soft=0.35, amount=0.7)
    img.alpha_composite(soft_wash(m_bf, (150, 140, 124), 0.35))
    img.alpha_composite(soft_wash(m_bf * compose.value_noise(W, H, 40, seed=9, octaves=3), (70, 66, 60), 0.3))
    img.alpha_composite(brush_edge(m_bf, width=0.035, seed=21, alpha=0.45))
    m_road = compose.polyline_mask(scene.PATHS[0], 18, edge, amount=0.8)
    img.alpha_composite(soft_wash(m_road, (246, 240, 226), 0.8))
    img.alpha_composite(brush_edge(m_road, width=0.06, seed=22, alpha=0.4))
    forest = compose.ellipse_mask(340, 80, 150, 50, edge, soft=0.4, amount=0.6)
    img.alpha_composite(soft_wash(forest, (50, 52, 48), 0.35))
    for i, (cx, cy, rx, ry) in enumerate([(258, 272, 60, 30), (706, 128, 110, 50), (110, 190, 150, 60),
                                          (792, 192, 40, 20)]):
        m = compose.ellipse_mask(cx, cy, rx, ry, edge, soft=0.3, amount=0.5)
        img.alpha_composite(brush_edge(m, seed=30 + i, alpha=0.3))
    rnd = random.Random(12)
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
    ctx = cairo.Context(surf)
    for _ in range(300):
        cx, cy = rnd.uniform(0, W), rnd.uniform(0, H)
        if ((cx / S - bf["x"]) / bf["rx"]) ** 2 + ((cy / S - bf["y"]) / bf["ry"]) ** 2 < 1.0:
            continue
        a0 = rnd.uniform(0.35, 0.75)
        for k in range(rnd.randint(3, 6)):
            x = cx + rnd.uniform(-10, 10)
            L = rnd.uniform(14, 32)
            lean = rnd.uniform(-8, 10)
            w0 = rnd.uniform(2.0, 3.6)
            ctx.set_source_rgba(0.1, 0.09, 0.08, a0)
            ctx.move_to(x - w0 / 2, cy)
            ctx.curve_to(x - w0 / 3, cy - L * 0.5, x + lean * 0.6, cy - L * 0.85, x + lean, cy - L)
            ctx.curve_to(x + lean * 0.6 + 0.6, cy - L * 0.85, x + w0 / 3, cy - L * 0.5, x + w0 / 2, cy)
            ctx.close_path()
            ctx.fill()
    img.alpha_composite(compose.cairo_to_pil(surf))
    return img


def dusk(img):
    """Ink framing: mist (paper) fading in at the top, ink wash creeping in at the corners."""
    a = np.asarray(img, np.float32)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    top = 1 - compose.smoothstep(0.0, 0.2, yy / H)
    n = compose.value_noise(W, H, 120, seed=41, octaves=3)
    mist = np.clip(top * (0.55 + 0.45 * n), 0, 1)[..., None] * 0.55
    a[..., :3] = a[..., :3] * (1 - mist) + PAPER * mist
    d = np.sqrt(((xx - W * 0.55) / (W * 0.62)) ** 2 + ((yy - H * 0.52) / (H * 0.75)) ** 2)
    corner = compose.smoothstep(0.75, 1.35, d + (n - 0.5) * 0.25)[..., None] * 0.55
    a[..., :3] = a[..., :3] * (1 - corner) + INK * corner
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")


def smoke(canvas):
    surf, ctx = compose.cairo_layer()
    rnd = random.Random(31)
    for sx, sy in [(470, 200), (640, 220), (560, 150), (760, 250)]:
        for k in range(10):
            x = sx + rnd.uniform(-20, 20) + k * 3
            y = sy - k * 14 - rnd.uniform(0, 10)
            r = 14 + k * 4
            g = cairo.RadialGradient(x, y, 0, x, y, r)
            g.add_color_stop_rgba(0, 0.25, 0.22, 0.2, 0.16 * (1 - k / 12))
            g.add_color_stop_rgba(1, 0.25, 0.22, 0.2, 0)
            ctx.set_source(g)
            ctx.arc(x, y, r, 0, 2 * math.pi)
            ctx.fill()
    canvas.alpha_composite(compose.cairo_to_pil(surf))


class SourceC:
    def __init__(self):
        self.cache = {}

    def _key(self, o):
        if o["cat"] == "unit":
            return key(o["kind"], o["facing"], o["anim"], o["frame"], o["variant"])
        return key(o["kind"], 0, "idle", 0, o["variant"])

    def sprite(self, o):
        k = self._key(o)
        ck = k + str(o["team"])
        if ck not in self.cache:
            al = compose.load(SPR, k, "albedo")
            lt = compose.load(SPR, k, "light")
            mk = compose.load(SPR, k, "mask")
            self.cache[ck] = compose.Sprite(toon(al.img, lt.img, mk.img, o["team"], seed=len(self.cache)),
                                            al.anchor)
        return self.cache[ck], False

    def shadow(self, o):
        return compose.load_shadow(SPR, self._key(o), color=(60, 58, 54), strength=0.4, blur_px=5), False

    def fx(self, o):
        if o["kind"] != "mage_e":
            return None
        return compose.load(SPR, self._key(o), "fx"), False


STYLE = dict(line=(0.09, 0.08, 0.07), ink=True, ring_w=2.4, warn=(0.85, 0.2, 0.1), dust=(0.35, 0.34, 0.32),
             dust_alpha=0.2, shaft=(0.1, 0.09, 0.08), fletch=(0.85, 0.8, 0.7), stone=(0.2, 0.18, 0.16),
             spark=(1, 0.85, 0.55))


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    canvas = ground()
    canvas.save(OUT / "ground.png")
    src = SourceC()

    def ground_fx(c):
        surf, ctx = compose.cairo_layer()
        magic.warning_circle(ctx, STYLE)
        c.alpha_composite(compose.cairo_to_pil(surf))

    stage.draw(canvas, src, ground_fx=ground_fx, depth_bias={"citygate_e": -40, "town_e": -10})
    smoke(canvas)
    surf, ctx = compose.cairo_layer()
    gsurf, gctx = compose.cairo_layer()
    magic.dust(ctx, STYLE)
    magic.missiles(ctx, STYLE)
    mx, my = scene.MAGE_POS
    magic.cannon(ctx, STYLE, sigil_screen(mx, my, 0), glow_ctx=gctx)
    magic.sparks(ctx, STYLE)
    canvas.alpha_composite(compose.cairo_to_pil(surf))
    canvas = dusk(canvas)
    # magic glows through the dusk: added after grading so it stays the brightest thing
    glow = compose.cairo_to_pil(gsurf)
    fx = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for o in stage.objects():
        if o["kind"] == "mage_e":
            compose.place(fx, src.fx(o)[0], o["x"], o["y"])
    glow.alpha_composite(fx)
    canvas.alpha_composite(fx)
    canvas = compose.add_glow(canvas, glow, radius_pt=5, strength=0.9)
    canvas = compose.add_glow(canvas, glow, radius_pt=16, strength=0.6)
    canvas.convert("RGB").save(OUT / "scene.png")
    print("wrote", OUT / "scene.png")


if __name__ == "__main__":
    build()
