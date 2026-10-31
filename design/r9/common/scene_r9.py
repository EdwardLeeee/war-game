"""R9's scenes: one phone screen of the map the user saved (雙河關, random map seed 2106939660: sim/src/map-grid.ts), the
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
from PIL import Image

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
            gain = self.j.get("team_gain", 1.0)
            col = TEAM[team]
            tint = Image.merge("RGBA", tuple(ch.point(lambda v, k=k: min(255, int(v * k / 255 * gain))) for ch, k in zip((r, g, b), col)) + (a,))
            im.alpha_composite(tint, (int(round(ax - tx)), int(round(ay - ty))))
        return (im, ax, ay), self._crop("shadow", name)


def unit_frame(atlas, unit, anim, facing, k):
    """A unit's frame name: mirrored facings (atlas 'facings.mirrored') are the rendered one flipped."""
    mir = atlas.j["facings"]["mirrored"].get(str(facing))
    f = mir if mir is not None else facing
    return f"{unit}_{anim}_f{f}_{k:02d}", mir is not None


# ---------------------------------------------------------------- the scene

def screen(top, items, shadows):
    """The ground (top-down) through the camera, then the shadows, then the sprites by their front edge.
    items: (front_y_m, image, (x_px, y_px)); shadows: (image, (x_px, y_px)) in screen pixels."""
    cam = R.camera(top).convert("RGBA")
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


if __name__ == "__main__":
    art, gridp, out = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
    out.mkdir(parents=True, exist_ok=True)
    grid, trees = load_map(gridp, 24, 40, 21, 21)                     # square (the composer's maps are square)
    relief = R.load_tile(HERE.parent / "build" / "relief_x3.png") if (HERE.parent / "build" / "relief_x3.png").exists() else R.relief_tile(PPM)[0]
    b, a = ground_pair(art, grid, relief)
    units = [("idle", 7, 0, "blue", 15.2, 17.5), ("walk", 6, 3, "blue", 17.4, 16.8), ("idle", 1, 2, "blue", 13.6, 26.0),
             ("attack", 2, 5, "red", 24.0, 30.5)]
    items, shadows = sprites(art, grid, trees, units)
    for name, top in (("before", b), ("after", a)):
        R.camera(top).crop((0, 0, SCREEN[0] * 3, SCREEN[1] * 3)).save(out / f"ground_{name}.png")
        im = screen(top, items, shadows).crop((0, 0, SCREEN[0] * 3, SCREEN[1] * 3))
        im.save(out / f"scene_{name}.png")
    print("ok", b.shape)
