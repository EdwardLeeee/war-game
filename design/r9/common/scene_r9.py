"""R9's scenes: one phone screen of the map the user saved (雙河關: fixed data since D-115, common/twin_grid.mts), the
ground and the water, the trees, the bridge, units and a main city on it, drawn as the game draws them: before (art-v6.3
as released) and after (R9's ground and water, R9's renders).

python3 design/r9/common/scene_r9.py ART_X3 GRID OUT_DIR [what]     ART_X3: art-v6.3-x3 unpacked (units/spear_e,
    buildings, terrain, ground, nodes); GRID: map-grid.ts's JSON; what: ground (default), ...
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "r8" / "common"))
import ground_r8 as G   # noqa: E402
import ground_r9 as R   # noqa: E402

PPM = 60                    # 3x: the phone's pixels (60 px a metre across, 30 down the screen)
SCREEN = (814, 380)         # the landscape screen in pt (R6), 2442 x 1140 px at 3x
TEAM = {"blue": (0x3f, 0x7f, 0xe0), "red": (0xd9, 0x43, 0x3a), "neutral": (0xd8, 0xd2, 0xc0)}


# ---------------------------------------------------------------- the map

def load_map(path, x0, y0, w, h):
    """(grid, trees) of the window: the sim's Terrain values, and the trees (cell x, y, variant) as map-grid.ts drew them
    (a tree drawn over water is left out: the map put a forest across the river)."""
    d = json.loads(Path(path).read_text())
    n = d["size"]
    t = np.array(d["terrain"], np.int32).reshape(n, n)
    grid = t[y0:y0 + h, x0:x0 + w]
    trees = []
    for y in range(h):
        for x in range(w):
            if d["rows"][y0 + y][x0 + x] == "T" and grid[y, x] in (0,):
                trees.append((x, y, (x * 7 + y * 13) % 3))
    return grid, trees


# ---------------------------------------------------------------- sprites from the released atlases

class Atlas:
    def __init__(self, manifest):
        self.dir = Path(manifest).parent
        self.j = json.loads(Path(manifest).read_text())
        self.pages = {k: [Image.open(self.dir / f).convert("RGBA") for f in v] for k, v in self.j["pages"].items() if v}

    def _crop(self, kind, name):
        f = self.j.get({"color": "frames", "team": "team", "shadow": "shadows"}[kind], {}).get(name)
        if f is None or kind not in self.pages:
            return None
        im = self.pages[kind][f["page"]].crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"]))
        k = 2 if f.get("half_res") else 1
        if k > 1:
            im = im.resize((im.width * k, im.height * k), Image.BILINEAR)
        return im, f["ax"] * k, f["ay"] * k

    def sprite(self, name, team="blue"):
        """(colour with the player colour, anchor), (shadow, anchor) or None."""
        c = self._crop("color", name)
        im, ax, ay = c
        im = im.copy()
        t = self._crop("team", name)
        if t:
            ti, tx, ty = t
            r, g, b, a = ti.split()
            col = TEAM[team]          # the team layer already holds colour x team_gain; the client only tints it
            tint = Image.merge("RGBA", tuple(ch.point(lambda v, k=k: min(255, int(v * k / 255))) for ch, k in zip((r, g, b), col)) + (a,))
            im.alpha_composite(tint, (int(round(ax - tx)), int(round(ay - ty))))
        return (im, ax, ay), self._crop("shadow", name)


def unit_frame(atlas, unit, anim, facing, k):
    """A unit's frame name: mirrored facings (atlas 'facings.mirrored') are the rendered one flipped."""
    mir = atlas.j["facings"]["mirrored"].get(str(facing))
    f = mir if mir is not None else facing
    return f"{unit}_{anim}_f{f}_{k:02d}", mir is not None


# ---------------------------------------------------------------- the scene

def screen(top, items, shadows, water=None, reflect=()):
    """The ground (top-down) through the camera, then the shadows, then the sprites by their front edge.
    items: (front_y_m, image, (x_px, y_px)); shadows: (image, (x_px, y_px)) in screen pixels.
    water: the compose's water mask (top-down); reflect: (image, (x_px, y_px) of its foot) mirrored into the water."""
    cam = R.camera(top).convert("RGBA")
    if water is not None and reflect:
        wm = Image.fromarray((np.clip(water, 0, 1) * 255).astype(np.uint8), "L").resize(cam.size, Image.BILINEAR)
        layer = Image.new("RGBA", cam.size, (0, 0, 0, 0))
        for im, (fx, fy) in reflect:
            fl = im.transpose(Image.FLIP_TOP_BOTTOM)
            a = np.asarray(fl, np.float32)
            a[..., :3] *= 0.45                                 # a reflection is darker than the thing
            a[..., 3] *= 0.75
            fl = Image.fromarray(a.astype(np.uint8), "RGBA").resize((fl.width, int(fl.height * 0.9)))
            layer.alpha_composite(fl, (int(fx), int(fy))) if fx >= 0 and fy >= 0 else _paste(layer, fl, (int(fx), int(fy)))
        arr = np.asarray(layer, np.float32)
        arr[..., 3] *= np.asarray(wm, np.float32) / 255.0
        layer = Image.fromarray(arr.astype(np.uint8), "RGBA").filter(ImageFilter.GaussianBlur(1.6))
        cam.alpha_composite(layer)
    for im, xy in shadows:
        _paste(cam, im, xy)
    for _, im, xy in sorted(items, key=lambda q: q[0]):
        _paste(cam, im, xy)
    return cam.convert("RGB")


def _paste(dst, im, xy):
    layer = Image.new("RGBA", dst.size, (0, 0, 0, 0))
    layer.paste(im, xy, im)
    dst.alpha_composite(layer)


def place(sprite, x_m, y_m, items, shadows, flip=False):
    """A sprite whose anchor stands at ground (x_m, y_m) (metres from the window's north-west corner)."""
    (im, ax, ay), sh = sprite
    if flip:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
        ax = im.width - ax
    X, Y = x_m * PPM, y_m * PPM * 0.5
    items.append((y_m, im, (int(round(X - ax)), int(round(Y - ay)))))
    if sh:
        si, sx, sy = sh
        if flip:
            si = si.transpose(Image.FLIP_LEFT_RIGHT)
            sx = si.width - sx
        shadows.append((si, (int(round(X - sx)), int(round(Y - sy)))))


def sprites(art, grid, trees, units=(), extra=()):
    """(items, shadows) of what stands on the ground, as the game lays them out (terrain.json's rules for rocks and
    bridges, the trees, the units; extra: (sprite, x_m, y_m, flip) more, e.g. a building)."""
    ta = Atlas(art / "terrain" / "terrain.json")
    na = Atlas(art / "nodes" / "nodes.json")
    items, shadows = [], []
    h, w = grid.shape
    for y in range(h):
        for x in range(w):
            v = int(grid[y, x])
            cx, cy = (x + 0.5) * 2, (y + 0.5) * 2
            if v == 1:
                place(ta.sprite(f"terrain_rock_v{(x * 7 + y * 3) % 6}", "neutral"), cx, cy, items, shadows)
            elif v == 5:                                    # the deck lies on the ground layer, the rails stand
                (im, ax, ay), _ = ta.sprite("terrain_bridge_deck_ns", "neutral")
                items.append((-1e6 + y, im, (int(round(cx * PPM - ax)), int(round(cy * PPM * 0.5 - ay)))))
                for side, nx in ((-1, x - 1), (1, x + 1)):
                    if not (0 <= nx < w) or grid[y, nx] != 5:
                        ex = x * 2 if side < 0 else (x + 1) * 2
                        place(ta.sprite("terrain_bridge_rail_y", "neutral"), ex, cy, items, shadows)
    for x, y, k in trees:
        place(na.sprite(f"tree_E_v{k}", "neutral"), (x + 0.5) * 2, (y + 0.5) * 2, items, shadows)
    if units:
        ua = Atlas(art / "units" / "spear_e" / "spear_e.json")
        for anim, facing, k, team, x, y in units:
            name, flip = unit_frame(ua, "spear_e", anim, facing, k)
            place(ua.sprite(name, team), x, y, items, shadows, flip=flip)
    for spr, x, y, flip in extra:
        place(spr, x, y, items, shadows, flip=flip)
    return items, shadows


def deck_shadows(art, grid, height_m=0.45):
    """R9 r4: the bridge deck's shadow on the water below it (the sun's: east and south of the deck by its height)."""
    ta = Atlas(art / "terrain" / "terrain.json")
    (im, ax, ay), _ = ta.sprite("terrain_bridge_deck_ns", "neutral")
    a = np.asarray(im, np.float32)[..., 3] * 0.55
    sh = Image.fromarray(np.dstack([np.zeros(a.shape + (3,)), a]).astype(np.uint8), "RGBA").filter(ImageFilter.GaussianBlur(2))
    k = height_m / R.SUN[2]
    dx, dy = -R.SUN[0] * k * PPM, -R.SUN[1] * k * PPM * 0.5
    out = []
    for y, x in zip(*np.nonzero(grid == 5)):
        cx, cy = (x + 0.5) * 2, (y + 0.5) * 2
        out.append((sh, (int(round(cx * PPM - ax + dx)), int(round(cy * PPM * 0.5 - ay + dy)))))
    return out


def reflections(art, trees):
    """The trees mirrored into the water at their feet (screen pixels: the flipped picture's top-left at the foot)."""
    na = Atlas(art / "nodes" / "nodes.json")
    out = []
    for x, y, k in trees:
        (im, ax, ay), _ = na.sprite(f"tree_E_v{k}", "neutral")
        X, Y = (x + 0.5) * 2 * PPM, (y + 0.5) * 2 * PPM * 0.5
        out.append((im, (X - ax, Y + (im.height - ay) * 0.0)))
    return out


def ground_layers(art):
    gj = json.loads((art / "ground" / "ground.json").read_text())
    layers = {L["id"]: dict(img=np.asarray(Image.open(art / "ground" / L["file"]).convert("RGBA"), np.float32) / 255.0,
                            tile_m=L["tile_m"]) for L in gj["layers"]}
    rules = dict(gj["rules"], dirt=dict(gj["rules"]["dirt"], noise_threshold=0.99))
    return layers, rules


def ground_pair(art, grid, relief):
    layers, rules = ground_layers(art)
    before = np.concatenate([G.compose(grid, [], layers, ppm=PPM, rules=rules, rows=(r, min(r + 240, grid.shape[0] * 2 * PPM)))
                             for r in range(0, grid.shape[0] * 2 * PPM, 240)], 0)
    after = R.compose(grid, [], layers, relief, ppm=PPM, rules=rules)
    return before, after


def b1_sprite(dirpath, name, team="blue"):
    """A raw render of render_b1.py (R9's main city) as an atlas sprite: colour with AO and player colour, its shadow."""
    sys.path.insert(0, str(HERE.parents[1] / "b1" / "common"))
    import scene as B1S
    sp = B1S.piece(dirpath, name, "x3", team=team, ppm=PPM)
    sh = None
    if sp.shadow:                     # darker than scene.piece's 0.78 of the pass: R9 r3/r4, the city looked pasted on;
        a = np.asarray(sp.shadow[0], np.float32).copy()             # a solid building's shadow ~0.45 of the lit grass
        a[..., 3] = np.clip(a[..., 3] * 1.3, 0, 255)
        a[..., :3] = (22, 25, 32)                                     # a dark grey, not scene.piece's navy
        sh = (Image.fromarray(a.astype(np.uint8), "RGBA"), sp.shadow[1], sp.shadow[2])
    return (sp.img, sp.ax, sp.ay), sh


# R9's main city's parts on the ground (main_city_r9.py, metres from the footprint's middle, x east, y north):
# the hall's platform and steps, the drum tower's base, the side hall's platform
CITY_FEET = [(-3.0, -1.2, 3.0, 3.2), (-0.7, -2.2, 1.3, -1.2), (-3.8, -3.2, -2.0, -1.4), (2.0, -2.55, 4.0, -0.95)]


def city_town(n, cx, cy):
    """The town weight masks (ground_r8.TOWN_CHANNELS) for a main city whose footprint's middle is at (cx, cy) metres of
    an n x n window: trampled earth along its whole front (round the feet of the drum tower and the side hall) and
    between the platform and the front row, then one lane about the steps' width fading out south (R9 r4: a 4 m
    straight band read as a rug)."""
    tr = np.zeros((n, n), bool)
    x0, y0 = int(round(cx / 2)) - 2, int(round(cy / 2)) - 2
    tr[max(0, y0 + 3):min(n, y0 + 4), max(0, x0):min(n, x0 + 4)] = True
    tr[max(0, y0 + 2):min(n, y0 + 3), max(0, x0 + 1):min(n, x0 + 3)] = True
    lane = np.zeros((n, n), np.float32)
    for k, w in enumerate((1.0, 0.85, 0.6, 0.35, 0.15)):
        y = y0 + 4 + k
        if y < n:
            lane[y, min(n - 1, x0 + 2)] = w
    return dict(lane=lane, trampled=tr)


def contact_ao(top, cx, cy, feet=CITY_FEET, k=0.42, r=0.35):
    """Darken the ground at the foot of the walls (ambient light blocked): top-down picture, footprint middle (cx, cy)."""
    h, w = top.shape[:2]
    X = (np.arange(w) + 0.5) / PPM - cx
    Y = cy - (np.arange(h) + 0.5) / PPM
    X, Y = np.meshgrid(X, Y)
    d = np.full(X.shape, 1e9)
    for (x0, y0, x1, y1) in feet:
        dx = np.maximum(np.maximum(x0 - X, X - x1), 0)
        dy = np.maximum(np.maximum(y0 - Y, Y - y1), 0)
        d = np.minimum(d, np.hypot(dx, dy))
    return top * (1 - k * np.exp(-d / r))[..., None]


def unit_sprite(atlas_dir, anim, facing, k, team):
    """spear_e from an atlas folder (art-v6.3's, or R9's postprocess output)."""
    a = Atlas(Path(atlas_dir) / "spear_e.json")
    name, flip = unit_frame(a, "spear_e", anim, facing, k)
    return a.sprite(name, team), flip


def rotate_xy(x, y, w, h, deg=45.0):
    """Where ground point (x, y) (pixels of a w x h top-down picture) lands after PIL's rotate(deg, expand=True)."""
    t = math.radians(deg)
    W = abs(w * math.cos(t)) + abs(h * math.sin(t))
    H = abs(w * math.sin(t)) + abs(h * math.cos(t))
    dx, dy = x - w / 2, y - h / 2
    return W / 2 + dx * math.cos(t) + dy * math.sin(t), H / 2 - dx * math.sin(t) + dy * math.cos(t)


def scene06(art, gridp, out, city_dir, units_dir, relief, relief_d):
    """R9-06: the same screen on the square camera (甲) and on the diamond one (乙): the new ground and water, the new
    spearmen, the new main city (on 乙 rendered on the diamond camera), trees and rocks."""
    grid, trees = load_map(gridp, 51, 33, 21, 21)
    layers, rules = ground_layers(art)
    n = grid.shape[0] * 2 * PPM
    city = (8.0, 16.0)                                   # the 4 x 4 footprint's middle, metres in the window
    trees = [t for t in trees if not (abs((t[0] + 0.5) * 2 - city[0]) < 5 and abs((t[1] + 0.5) * 2 - city[1]) < 5)]
    men = [("idle", 7, 0, "blue", 13.5, 27.0), ("walk", 7, 4, "blue", 15.0, 28.6), ("attack", 7, 5, "blue", 17.0, 27.4),
           ("idle", 1, 0, "blue", 19.5, 22.5)]
    res = {}
    # 現在: the same screen as the game draws it today (art-v6.3: its ground, its main city, its spearman)
    before = np.concatenate([G.compose(grid, [], layers, ppm=PPM, rules=rules, rows=(r, min(r + 240, n))) for r in range(0, n, 240)], 0)
    items, shadows = sprites(art, grid, trees)
    place(Atlas(art / "buildings" / "buildings_E.json").sprite("main_city_E_done", "blue"), city[0], city[1], items, shadows)
    for anim, f, k, team, x, y in men:
        spr, flip = unit_sprite(art / "units" / "spear_e", anim, f, k, team)
        place(spr, x, y, items, shadows, flip=flip)
    im = screen(before, items, shadows).crop((0, 0, SCREEN[0] * 3, SCREEN[1] * 3))
    im.save(out / "scene06_現在.png")
    for cam in ("甲", "乙"):
        sun, view, rel = (R.SUN, R.VIEW, relief) if cam == "甲" else (R.SUN_D, R.VIEW_D, relief_d)
        if cam == "乙":       # a window 5 cells wider each way: the turned map must reach the screen's corners
            pad, off = 5, 10.0
            grid, trees = load_map(gridp, 51 - pad, 33 - pad, 21 + 2 * pad, 21 + 2 * pad)
            city = (city[0] + off, city[1] + off)
            trees = [t for t in trees if not (abs((t[0] + 0.5) * 2 - city[0]) < 5 and abs((t[1] + 0.5) * 2 - city[1]) < 5)]
            men = [(a_, f_, k_, tm, x + off, y + off) for a_, f_, k_, tm, x, y in men]
            n = grid.shape[0] * 2 * PPM
        top = R.compose(grid, [], layers, rel, ppm=PPM, rules=rules, sun=sun, view=view, town=city_town(grid.shape[0], *city))
        top = contact_ao(top, *city)
        items, shadows = sprites(art, grid, trees)
        cs = b1_sprite(city_dir, "main_city_E_r9" if cam == "甲" else "main_city_E_r9_d")
        place(cs, city[0], city[1], items, shadows)
        for anim, f, k, team, x, y in men:
            spr, flip = unit_sprite(units_dir, anim, f, k, team)
            place(spr, x, y, items, shadows, flip=flip)
        if cam == "甲":
            im = screen(top, items, shadows).crop((0, 0, SCREEN[0] * 3, SCREEN[1] * 3))
        else:
            # turn the ground 45 degrees, squash it, and move every sprite with it (anchors are ground points)
            img = Image.fromarray((np.clip(top, 0, 1) * 255).round().astype(np.uint8), "RGB").rotate(45, expand=True, resample=Image.BICUBIC)
            cam_img = img.resize((img.width, img.height // 2), Image.LANCZOS).convert("RGBA")
            def moved(xy, anchor_ground):
                return xy
            canvas = cam_img
            def put(im, gx, gy, ax, ay):
                X, Y = rotate_xy(gx, gy, n, n)
                _paste(canvas, im, (int(round(X - ax)), int(round(Y / 2 - ay))))
            # rebuild the sprite list in ground metres: (front, sprite, ground x, y)
            objs = []
            for x, y, k in trees:
                objs.append((Atlas(art / "nodes" / "nodes.json").sprite(f"tree_E_v{k}", "neutral"), (x + 0.5) * 2, (y + 0.5) * 2, False))
            for yy in range(grid.shape[0]):
                for xx in range(grid.shape[1]):
                    if grid[yy, xx] == 1:
                        objs.append((Atlas(art / "terrain" / "terrain.json").sprite(f"terrain_rock_v{(xx * 7 + yy * 3) % 6}", "neutral"),
                                     (xx + 0.5) * 2, (yy + 0.5) * 2, False))
            objs.append((cs, city[0], city[1], False))
            for anim, f, k, team, x, y in men:
                spr, flip = unit_sprite(units_dir, anim, (f + 1) % 8, k, team)   # the same men, a facing on
                objs.append((spr, x, y, flip))
            for (spr, gx, gy, flip) in objs:
                sh = spr[1]
                if sh:
                    si, sx, sy = sh
                    if flip:
                        si = si.transpose(Image.FLIP_LEFT_RIGHT); sx = si.width - sx
                    put(si, gx * PPM, gy * PPM, sx, sy)
            def depth(o):
                X, Y = rotate_xy(o[1] * PPM, o[2] * PPM, n, n)
                return Y
            for (spr, gx, gy, flip) in sorted(objs, key=depth):
                im, ax, ay = spr[0]
                if flip:
                    im = im.transpose(Image.FLIP_LEFT_RIGHT); ax = im.width - ax
                put(im, gx * PPM, gy * PPM, ax, ay)
            cx, cy = canvas.width // 2, canvas.height // 2
            w, h = SCREEN[0] * 3, SCREEN[1] * 3
            im = canvas.crop((cx - w // 2, cy - h // 2, cx + w // 2, cy + h // 2)).convert("RGB")
        im.save(out / f"scene06_{cam}.png")
        res[cam] = im
    return res


def edge_grid(gridp, x0=-8, y0=38, size=21, seed=4):
    """The map's west edge (雙河關: the river and its ford leave the map there) with what the client would draw beyond
    the edge: the river opening into a lake, forest on either side, its edge ragged. Returns (grid, trees, beyond_m):
    beyond_m the metres (from the window's west side) where the map ends."""
    d = json.loads(Path(gridp).read_text())
    n = d["size"]
    t = np.array(d["terrain"], np.int32).reshape(n, n)
    rng = np.random.default_rng(seed)
    grid = np.zeros((size, size), np.int32)
    trees = []
    for yy in range(size):
        for xx in range(size):
            X, Y = x0 + xx, y0 + yy
            if X >= 0:
                grid[yy, xx] = t[Y, X]
                if d["rows"][Y][X] == "T" and t[Y, X] == 0:
                    trees.append((xx, yy, (xx * 7 + yy * 13) % 3))
                continue
            out = -X                                                  # cells beyond the edge
            half = 1.5 + out * 0.55 + rng.uniform(-0.4, 0.4)         # the river opening into a lake
            if abs(Y - 50) <= half:
                grid[yy, xx] = 3
            elif abs(Y - 50) > half + 1 and rng.random() < min(0.95, 0.35 + 0.18 * out):
                trees.append((xx, yy, int(rng.integers(0, 3))))
    return grid, trees, -x0 * 2.0


def scene_edge(art, gridp, out, relief, units_dir):
    grid, trees, beyond = edge_grid(gridp)
    layers, rules = ground_layers(art)
    top = R.compose(grid, [], layers, relief, ppm=PPM, rules=rules)
    # beyond the map's edge: the same world, a little darker and hazier (the player cannot go there)
    m = (np.arange(top.shape[1]) + 0.5) / PPM
    k = np.clip((beyond - m) / 4.0, 0, 1)[None, :, None] * 0.5
    top = top * (1 - k) + np.array([0.42, 0.47, 0.5]) * k * 0.6
    items, shadows = sprites(art, grid, trees)
    for anim, f, kk, team, x, y in [("idle", 7, 0, "blue", 21.0, 27.0), ("walk", 7, 4, "blue", 23.5, 28.5)]:
        spr, flip = unit_sprite(units_dir, anim, f, kk, team)
        place(spr, x, y, items, shadows, flip=flip)
    im = screen(top, items, shadows).crop((0, 0, SCREEN[0] * 3, SCREEN[1] * 3))
    im.save(out / "scene06_edge.png")
    return im


if __name__ == "__main__":
    art, gridp, out = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
    out.mkdir(parents=True, exist_ok=True)
    what = sys.argv[4] if len(sys.argv) > 4 else "ground"
    if what == "edge":
        scene_edge(art, gridp, out, R.load_tile(HERE.parent / "build" / "relief_x3.png"), sys.argv[5])
        sys.exit(0)
    if what == "grass":                                               # open grass, for the unit and the city boards
        grid = np.zeros((21, 21), np.int32)
        b, a = ground_pair(art, grid, R.load_tile(HERE.parent / "build" / "relief_x3.png"))
        for name, top in (("before", b), ("after", a)):
            R.camera(top).crop((0, 0, SCREEN[0] * 3, SCREEN[1] * 3)).save(out / f"grass_{name}.png")
        sys.exit(0)
    if what == "city":                                                # 04: the main city on open ground, before/after
        grid, city = np.zeros((13, 13), np.int32), (14.0, 16.0)
        layers, rules = ground_layers(art)
        relief = R.load_tile(HERE.parent / "build" / "relief_x3.png")
        n = grid.shape[0] * 2 * PPM
        b = np.concatenate([G.compose(grid, [], layers, ppm=PPM, rules=rules, rows=(r, min(r + 240, n))) for r in range(0, n, 240)], 0)
        a = contact_ao(R.compose(grid, [], layers, relief, ppm=PPM, rules=rules, town=city_town(13, *city)), *city)
        for name, top, spr in (("before", b, Atlas(art / "buildings" / "buildings_E.json").sprite("main_city_E_done", "blue")),
                               ("after", a, b1_sprite(sys.argv[5], "main_city_E_r9"))):
            items, shadows = [], []
            place(spr, city[0], city[1], items, shadows)
            screen(top, items, shadows).crop((240, 0, 1440, 780)).save(out / f"city_{name}.png")
        sys.exit(0)
    if what == "06":
        B = HERE.parent / "build"
        scene06(art, gridp, out, sys.argv[5], sys.argv[6], R.load_tile(B / "relief_x3.png"), R.load_tile(B / "relief_x3_d.png"))
        sys.exit(0)
    grid, trees = load_map(gridp, 24, 40, 21, 21)                     # square (the composer's maps are square)
    relief = R.load_tile(HERE.parent / "build" / "relief_x3.png") if (HERE.parent / "build" / "relief_x3.png").exists() else R.relief_tile(PPM)[0]
    b, a = ground_pair(art, grid, relief)
    units = [("idle", 7, 0, "blue", 15.2, 17.5), ("walk", 6, 3, "blue", 17.4, 16.8), ("idle", 1, 2, "blue", 13.6, 26.0),
             ("attack", 2, 5, "red", 24.0, 30.5)]
    items, shadows = sprites(art, grid, trees, units)
    water = R.LAST_WATER.copy()
    for name, top in (("before", b), ("after", a)):
        R.camera(top).crop((0, 0, SCREEN[0] * 3, SCREEN[1] * 3)).save(out / f"ground_{name}.png")
        refl = reflections(art, trees) if name == "after" else ()
        sh = shadows + (deck_shadows(art, grid) if name == "after" else [])
        im = screen(top, items, sh, water if name == "after" else None, refl).crop((0, 0, SCREEN[0] * 3, SCREEN[1] * 3))
        im.save(out / f"scene_{name}.png")
    print("ok", b.shape)
