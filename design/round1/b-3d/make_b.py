"""B 立體微縮: assemble the battle scene from the Blender sprites.

python3 b-3d/make_b.py  -> build/b/scene.png (2796x1290, no UI yet)
"""
import math
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "common"))
sys.path.insert(0, str(HERE.parent / "blender"))

import numpy as np            # noqa: E402
from PIL import Image, ImageDraw, ImageFilter   # noqa: E402

import compose               # noqa: E402
import config                # noqa: E402
import magic                 # noqa: E402
import scene                 # noqa: E402
import stage                 # noqa: E402
from render_scene import key  # noqa: E402

SPR = config.BUILD / "3d" / "sprites"
OUT = config.BUILD / "b"
S = config.SCALE
W, H = compose.W, compose.H


def sigil_screen(x, y, facing, local=(0.18, 0.95, 1.3)):
    a = math.radians(45 * facing - 135)
    lx, ly, lz = local
    X = lx * math.cos(a) - ly * math.sin(a)
    Y = lx * math.sin(a) + ly * math.cos(a)
    k = config.PT_PER_M
    return (x + k * 0.7071 * (X - Y), y - k * 0.3536 * (X + Y) - k * 0.866 * lz)


def ground():
    n1 = compose.value_noise(W, H, 240, seed=1, octaves=4)
    n2 = compose.value_noise(W, H, 60, seed=2, octaves=3)
    n3 = compose.value_noise(W, H, 16, seed=3, octaves=2)
    grass_dark, grass_light, grass_dry = (70, 96, 44), (122, 140, 64), (150, 146, 78)
    rgb = compose.lerp_rgb(grass_dark, grass_light, compose.smoothstep(0.25, 0.75, n1))
    rgb = compose.lerp_rgb(rgb, grass_dry, compose.smoothstep(0.62, 0.85, n2) * 0.45)
    rgb *= (0.92 + 0.16 * n3)[..., None]
    # packed earth: battlefield, road, around the mine and the buildings
    edge = compose.value_noise(W, H, 40, seed=4, octaves=3)
    bf = scene.BATTLEFIELD
    m_bf = compose.ellipse_mask(bf["x"], bf["y"], bf["rx"], bf["ry"], edge, soft=0.25, amount=0.6)
    m_road = compose.polyline_mask(scene.PATHS[0], 16, edge, amount=0.7)
    m_mine = compose.ellipse_mask(258, 272, 60, 30, edge, soft=0.3, amount=0.6)
    m_town = compose.ellipse_mask(706, 128, 110, 50, edge, soft=0.3, amount=0.5)
    m_city = compose.ellipse_mask(110, 190, 150, 60, edge, soft=0.3, amount=0.5)
    m_tower = compose.ellipse_mask(792, 192, 40, 20, edge, soft=0.3, amount=0.5)
    dirt_n = compose.value_noise(W, H, 30, seed=5, octaves=3)
    dirt = compose.lerp_rgb((104, 84, 58), (150, 126, 90), dirt_n)
    trampled = np.clip(m_bf * (0.55 + 0.45 * compose.smoothstep(0.3, 0.7, n2)), 0, 1)
    rgb = compose.lerp_rgb(rgb, dirt, np.clip(trampled * 0.85, 0, 1))
    road = compose.lerp_rgb((140, 118, 84), (170, 146, 106), n3)
    rgb = compose.lerp_rgb(rgb, road, np.clip(np.maximum(m_road, np.maximum(m_town, m_tower)) * 0.9, 0, 1))
    rgb = compose.lerp_rgb(rgb, (118, 106, 90), m_mine * 0.8)
    rgb = compose.lerp_rgb(rgb, (132, 120, 100), m_city * 0.85)
    img = compose.to_img(rgb)
    # grass blades and flowers
    rnd = random.Random(9)
    dr = ImageDraw.Draw(img)
    grassy = 1 - np.clip(trampled + m_road + m_town + m_city + m_mine, 0, 1)
    for _ in range(26000):
        x, y = rnd.randrange(W), rnd.randrange(H)
        if grassy[y, x] < 0.5:
            continue
        base = rgb[y, x]
        k = rnd.uniform(0.75, 1.25)
        c = tuple(int(min(255, v * k)) for v in base)
        L = rnd.randint(4, 9)
        dr.line((x, y, x + rnd.randint(-2, 2), y - L), fill=c, width=1)
    for _ in range(420):
        x, y = rnd.randrange(W), rnd.randrange(H)
        if grassy[y, x] < 0.8:
            continue
        c = rnd.choice([(236, 226, 190), (240, 206, 90), (210, 150, 190)])
        dr.ellipse((x - 2, y - 1, x + 2, y + 2), fill=c)
    # pebbles on the battlefield and the road
    for _ in range(900):
        x, y = rnd.randrange(W), rnd.randrange(H)
        if trampled[y, x] < 0.5 and m_road[y, x] < 0.5:
            continue
        g = rnd.randint(90, 150)
        dr.ellipse((x - 2, y - 1, x + 2, y + 1), fill=(g, g - 8, g - 20))
    return img


class SourceB:
    def __init__(self):
        self.cache = {}

    def _key(self, o):
        if o["cat"] == "unit":
            return key(o["kind"], o["facing"], o["anim"], o["frame"], o["variant"])
        return key(o["kind"], 0, "idle", 0, o["variant"])

    def sprite(self, o):
        k = self._key(o) + str(o["team"])
        if k not in self.cache:
            sp = compose.load(SPR, self._key(o), "beauty")
            if o["team"]:
                mk = compose.load(SPR, self._key(o), "mask")
                sp.img = compose.recolor(sp.img, mk.img, config.TEAM[o["team"]])
            self.cache[k] = sp
        return self.cache[k], False

    def shadow(self, o):
        return compose.load_shadow(SPR, self._key(o), color=(26, 30, 48), strength=0.85), False

    def fx(self, o):
        if o["kind"] != "mage_e":
            return None
        return compose.load(SPR, self._key(o), "fx"), False


STYLE = dict(line=None, ring_w=2.0, dust=(0.74, 0.64, 0.48), dust_alpha=0.2)


def grade(img):
    a = np.asarray(img, np.float32)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    # warm light from the upper left, soft vignette
    light = 1.06 - 0.12 * (xx / W * 0.6 + yy / H * 0.4)
    d = np.sqrt(((xx - W / 2) / (W * 0.62)) ** 2 + ((yy - H / 2) / (H * 0.75)) ** 2)
    vig = 1 - 0.28 * compose.smoothstep(0.55, 1.15, d)
    k = (light * vig)[..., None]
    rgb = a[..., :3] * k
    rgb[..., 0] *= 1.03
    rgb[..., 2] *= 0.95
    a[..., :3] = rgb
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    canvas = ground()
    canvas.save(OUT / "ground.png")
    src = SourceB()
    tuft = compose.load(SPR, key("tuft", 0, "idle", 0, 0), "beauty")
    rnd = random.Random(21)
    for _ in range(60):
        x, y = rnd.uniform(70, 870), rnd.uniform(20, 420)
        bf = scene.BATTLEFIELD
        if ((x - bf["x"]) / bf["rx"]) ** 2 + ((y - bf["y"]) / bf["ry"]) ** 2 < 1.1:
            continue
        compose.place(canvas, tuft, x, y, flip=rnd.random() < 0.5, scale=rnd.uniform(0.6, 1.2))

    def ground_fx(c):
        surf, ctx = compose.cairo_layer()
        magic.warning_circle(ctx, STYLE)
        c.alpha_composite(compose.cairo_to_pil(surf))

    stage.draw(canvas, src, ground_fx=ground_fx, depth_bias={"citygate_e": -40, "town_e": -10})
    surf, ctx = compose.cairo_layer()
    gsurf, gctx = compose.cairo_layer()
    magic.dust(ctx, STYLE)
    magic.missiles(ctx, dict(STYLE, shaft=(0.3, 0.22, 0.14)))
    mx, my = scene.MAGE_POS
    magic.cannon(ctx, STYLE, sigil_screen(mx, my, 0), glow_ctx=gctx)
    magic.sparks(ctx, STYLE)
    canvas.alpha_composite(compose.cairo_to_pil(surf))
    # bloom: the bolt, the warning ring, and the mage's shield/sigil
    glow = compose.cairo_to_pil(gsurf)
    wsurf, wctx = compose.cairo_layer()
    magic.warning_circle(wctx, STYLE)
    glow.alpha_composite(compose.cairo_to_pil(wsurf))
    fx = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for o in stage.objects():
        if o["kind"] == "mage_e":
            compose.place(fx, src.fx(o)[0], o["x"], o["y"])
    glow.alpha_composite(fx)
    canvas = compose.add_glow(canvas, glow, radius_pt=5, strength=0.9)
    canvas = compose.add_glow(canvas, glow, radius_pt=14, strength=0.5)
    canvas = grade(canvas)
    canvas.convert("RGB").save(OUT / "scene.png")
    print("wrote", OUT / "scene.png")


if __name__ == "__main__":
    build()
