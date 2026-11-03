"""R11 (ceo 2026-11-02: the user chose 乙 菱形斜看, 「1方案好，我覺得邊邊可以加個瀑布動畫，感覺像是再一個浮空大陸上的感覺」):
R9's scenes on the diamond camera. The ground and the water are composed on the map's own axes (R9's ground_r9 with the
diamond camera's sun and view: what the client's shader does in world space), then turned 45 degrees and squeezed 2:1;
the trees, rocks, bridge and main city are render_b1 pieces on the diamond camera (b1/build/b1/r11, r9); the units are
the oblique atlases a facing on (the sun stays at the screen's upper left, so a unit seen from a camera turned 45
degrees is the same picture as the unit turned one facing).

python3 design/r11/common/scene_r11.py ART_X3 GRID OUT WHAT [UNITS]
  WHAT: river (the 雙河關 bridge), city (the main city on open ground), grass (open ground for the unit board)
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
DESIGN = HERE.parents[1]
sys.path.insert(0, str(DESIGN / "r9" / "common"))
import ground_r9 as R      # noqa: E402
import scene_r9 as S9      # noqa: E402

PPM = S9.PPM
SCREEN = (S9.SCREEN[0] * 3, S9.SCREEN[1] * 3)
PIECES = DESIGN / "b1" / "build" / "b1" / "r11"
CITY = DESIGN / "b1" / "build" / "b1" / "r9"
RELIEF_D = DESIGN / "r9" / "build" / "relief_x3_d.png"


def to8(a):
    return (np.clip(a, 0, 1) * 255).round().astype(np.uint8)


def turn(top, alpha=None):
    """A top-down picture (float RGB [n, n, 3], alpha [n, n] or None) to the diamond screen: turned 45 degrees (PIL,
    counter-clockwise: north to the upper left, west to the lower left), squeezed 2:1. RGBA."""
    img = Image.fromarray(to8(top), "RGB").convert("RGBA")
    if alpha is not None:
        img.putalpha(Image.fromarray(to8(alpha), "L"))
    r = img.rotate(45, expand=True, resample=Image.BICUBIC)
    return r.resize((r.width, r.height // 2), Image.LANCZOS)


def at(gx, gy, n):
    """Screen pixel (of turn()'s picture) of ground point (gx, gy) metres in an n-pixel top-down window."""
    X, Y = S9.rotate_xy(gx * PPM, gy * PPM, n, n)
    return X, Y / 2


class Stage:
    """The sprites of one diamond screen: put() them at ground points, then draw() over the turned ground."""

    def __init__(self, n):
        self.n = n
        self.items, self.shadows, self.refl = [], [], []

    def put(self, sprite, gx, gy, flip=False, front=None, reflect=False, z_m=0.0):
        (im, ax, ay), sh = sprite
        if flip:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
            ax = im.width - ax
        X, Y = at(gx, gy, self.n)
        Y -= z_m * PPM * 0.866
        self.items.append((Y if front is None else front, im, (int(round(X - ax)), int(round(Y - ay)))))
        if sh:
            si, sx, sy = sh
            if flip:
                si = si.transpose(Image.FLIP_LEFT_RIGHT)
                sx = si.width - sx
            self.shadows.append((si, (int(round(X - sx)), int(round(Y - sy)))))
        if reflect:
            self.refl.append((im, (X - ax, Y)))

    def draw(self, cam, water=None):
        """cam: the turned ground (RGBA); water: the compose's water mask, top-down (turned here)."""
        wm = None
        if water is not None:
            wimg = Image.fromarray(to8(water), "L").rotate(45, expand=True, resample=Image.BILINEAR)
            wm = np.asarray(wimg.resize((wimg.width, wimg.height // 2), Image.BILINEAR), np.float32) / 255.0
        return S9.screen_layers(cam, self.items, self.shadows, wm, self.refl)


def piece(name, team="blue", d=PIECES):
    return S9.b1_sprite(str(d), name, team)


def unit(units_dir, anim, facing, k, team="blue"):
    """An oblique-atlas unit on the diamond screen: one facing on (see the module note)."""
    spr, flip = S9.unit_sprite(units_dir, anim, (facing + 1) % 8, k, team)
    return spr, flip


def crop_mid(im, cx=None, cy=None, size=SCREEN):
    cx = im.width // 2 if cx is None else int(cx)
    cy = im.height // 2 if cy is None else int(cy)
    w, h = size
    return im.crop((cx - w // 2, cy - h // 2, cx - w // 2 + w, cy - h // 2 + h))


def river(art, gridp, out, units_dir):
    """The 雙河關 bridge (R9's river window, centred the same) on the diamond camera: ground and water, the bridge,
    rocks and trees on the diamond camera, spearmen."""
    x0, y0, size = 19, 35, 31
    grid, trees = S9.load_map(gridp, x0, y0, size, size)
    layers, rules = S9.ground_layers(art)
    relief = R.load_tile(RELIEF_D)
    top = R.compose(grid, [], layers, relief, ppm=PPM, rules=rules, sun=R.SUN_D, view=R.VIEW_D, town=S9.bridge_lanes(grid))
    water = R.LAST_WATER.copy()
    n = top.shape[0]
    cam = turn(top)
    st = Stage(n)
    h, w = grid.shape
    for y in range(h):
        for x in range(w):
            v = int(grid[y, x])
            cx, cy = (x + 0.5) * 2, (y + 0.5) * 2
            if v == 1:
                near_water = any(0 <= y + dy < h and 0 <= x + dx < w and grid[y + dy, x + dx] in (3, 4)
                                 for dy, dx in ((1, 0), (0, -1), (-1, 0), (0, 1)))
                st.put(piece(f"terrain_rock_v{(x * 7 + y * 3) % 6}_d", "neutral"), cx, cy, reflect=near_water)
            elif v in (5, 6):
                axis = "ns" if v == 5 else "ew"
                st.put(piece(f"terrain_bridge_deck_{axis}_d", "neutral"), cx, cy, front=-1e6 + y + x)
                for side, (nx, ny) in ((-1, (x - 1, y)), (1, (x + 1, y))) if v == 5 else ((-1, (x, y - 1)), (1, (x, y + 1))):
                    if not (0 <= nx < w and 0 <= ny < h) or grid[ny, nx] != v:
                        if v == 5:
                            st.put(piece("terrain_bridge_rail_y_d", "neutral"), x * 2 if side < 0 else (x + 1) * 2, cy)
                        else:
                            st.put(piece("terrain_bridge_rail_x_d", "neutral"), cx, y * 2 if side < 0 else (y + 1) * 2)
    for x, y, k in trees:
        cx, cy = (x + 0.5) * 2, (y + 0.5) * 2
        near_water = any(0 <= y + dy < h and 0 <= x + dx < w and grid[y + dy, x + dx] in (3, 4)
                         for dy, dx in ((1, 0), (0, -1), (-1, 0), (0, 1), (1, 1), (1, -1)))
        st.put(piece(f"tree_E_v{k}_d", "neutral"), cx, cy, reflect=near_water)
    # the men of R9's river scene, at the same ground points (R9's window began 5 cells further in each way)
    for anim, f, k, team, x, y in [("idle", 7, 0, "blue", 15.2, 17.5), ("walk", 6, 3, "blue", 17.4, 16.8),
                                   ("idle", 1, 2, "blue", 13.6, 26.0), ("attack", 2, 5, "red", 24.0, 30.5)]:
        spr, flip = unit(units_dir, anim, f, k, team)
        st.put(spr, x + 10.0, y + 10.0, flip=flip)
    im = st.draw(cam, water)
    mx, my = at(34.0 + 0.0, 34.0, n)          # R9's window middle: (24 + 10.5, 40 + 10.5) cells -> 2 x 15.5 + 2 m in
    crop_mid(im, mx, my).convert("RGB").save(out / "river_d.png")
    return im


def city(art, out):
    """R9's main city (main_city_E_r9_d) on open ground, diamond: trampled earth before it, a lane, its contact shadow."""
    grid, c = np.zeros((21, 21), np.int32), (20.0, 20.0)
    layers, rules = S9.ground_layers(art)
    relief = R.load_tile(RELIEF_D)
    top = R.compose(grid, [], layers, relief, ppm=PPM, rules=rules, sun=R.SUN_D, view=R.VIEW_D,
                    town=S9.city_town(21, *c))
    top = S9.contact_ao(top, *c)
    n = top.shape[0]
    st = Stage(n)
    st.put(piece("main_city_E_r9_d", "blue", CITY), *c)
    im = st.draw(turn(top))
    X, Y = at(*c, n)
    crop_mid(im, X, Y - 120, (1200, 780)).convert("RGB").save(out / "city_d.png")
    grass = turn(R.compose(np.zeros((31, 31), np.int32), [], layers, relief, ppm=PPM, rules=rules, sun=R.SUN_D,
                           view=R.VIEW_D))
    crop_mid(grass).convert("RGB").save(out / "grass_d.png")


if __name__ == "__main__":
    art, gridp, out, what = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3]), sys.argv[4]
    out.mkdir(parents=True, exist_ok=True)
    if what == "river":
        river(art, gridp, out, sys.argv[5])
    elif what == "city":
        city(art, out)
    print("ok", what)
