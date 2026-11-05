"""R14's battlefields, 3 px a pt (814 x 380 pt, the phone held sideways), drawn from the art-v7 diamond atlases as the
client lays them (client/src/camera/projection.ts DIAMOND: a cell 28.28 pt across and 14.14 down a step, +x down-right,
+y down-left; castle-draw.ts: the D-100 castles of castle_<c>.json's layouts, their gates' looks, units on the walls'
walk; structure-art.ts and outpost-crew.ts: buildings by their middle, the 3 x 3 outpost's spearmen on its walk).
Not the client's renderer: the ground is the atlas's grass tile turned and flattened (no relief, no grade).

Two kinds of scene:
- common/r14-scene.js (window.R14_SCENES): world cells. Writes build/<scene>.png and build/r14-layout.js (where every
  unit, building, gate and town is on the screen in pt: r14-world.js draws the game's marks from it).
- design/r13/common/r13-b2-scene.js (window.R13_B2) and R14_B2 in r14-scene.js: R13 B2's screen-placed scenes
  (pt and zoom), drawn as design/r13/common/field_b2.py draws them -> build/r13-b2-<scene>.png.

python3 design/r14/common/scene_r14.py [--atlas DIR] [--units DIR] [scene ...]
  --atlas: art-v7's atlas_x3 (buildings/, castle/, ground/); default $R14_ATLAS, else design/b1/build/v7atlas_dl/atlas_x3
  --units: the unit atlases (r7-v8u-*/.../atlas_x3/<unit>.json); default $R14_UNITS, else design/production/build/v8u_dl
  Both are build output (not in git); paths relative to the repo unless absolute.
"""
import argparse
import json
import math
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
D = REPO / "design"
sys.path.insert(0, str(D / "r9" / "common"))
import scene_r9 as S9    # noqa: E402  (Atlas, unit_frame)

OUT = HERE.parent / "build"
K = 3                                   # px a pt
W, H = 814, 380
STEP_X, STEP_Y = 40 / math.sqrt(2), 20 / math.sqrt(2)      # pt a cell along x - y and x + y (zoom 1)
PT_PER_M = 20
UP_PER_M = math.sqrt(3) / 2             # client/src/render/*.ts: a metre up is this many metres on the plane
TEAMS = {"blue", "red", "neutral"}


def js_object(path, name):
    """The JSON after `window.<name> =` in a .js file."""
    text = path.read_text()
    body = text.split(f"window.{name} =", 1)[1].lstrip()
    return json.JSONDecoder().raw_decode(body)[0]


class Cam:
    """World cells -> the screen (pt): `look` is the cell point in the middle of the screen."""

    def __init__(self, zoom, look=None, focus=None):
        """`focus` [x, y, sx, sy]: the cell point (x, y) on the screen at (sx, sy) pt, in place of `look`."""
        self.z = zoom
        if focus is not None:
            fx, fy, sx, sy = focus
            px, py = self.plane(fx, fy)
            self.ox, self.oy = px - (sx - W / 2) / zoom, py - (sy - H / 2) / zoom
        else:
            self.ox, self.oy = self.plane(*look)

    @staticmethod
    def plane(x, y):
        return (x - y) * STEP_X, (x + y) * STEP_Y

    def pt(self, x, y, up_pt=0.0):
        px, py = self.plane(x, y)
        return ((px - self.ox) * self.z + W / 2, (py - self.oy) * self.z + H / 2 - up_pt * self.z)

    def world(self, sx, sy):
        """Screen pt arrays -> world cells (x, y)."""
        px = (sx - W / 2) / self.z + self.ox
        py = (sy - H / 2) / self.z + self.oy
        a, b = px / STEP_X, py / STEP_Y
        return (a + b) / 2, (b - a) / 2


# ---------------------------------------------------------------- the ground

def _tex(path, tile_m, z):
    t = Image.open(path).convert("RGB")
    n = max(8, round(tile_m * 60 * z))          # 60 px a metre at 3x and zoom 1
    return np.asarray(t.resize((n, n), Image.LANCZOS), np.float32)


def _noise(shape, cells, seed):
    rng = np.random.default_rng(seed)
    g = rng.random((cells + 1, cells + 1)).astype(np.float32)
    im = Image.fromarray((g * 255).astype(np.uint8), "L").resize((shape[1], shape[0]), Image.BICUBIC)
    return np.asarray(im, np.float32) / 255.0


def ground(atlas, cam, yard_cells, seed=3):
    """The grass tile on the ground through the camera, the dry grass in soft patches, yard (packed earth) by cell weights
    {(x, y): w} (the castles' lanes and trampled earth)."""
    gdir = atlas / "ground"
    spec = {l["id"]: l for l in json.loads((gdir / "ground.json").read_text())["layers"]}
    ys, xs = np.mgrid[0:H * K, 0:W * K].astype(np.float32)
    wx, wy = cam.world((xs + 0.5) / K, (ys + 0.5) / K)
    mx, my = wx * 2, wy * 2                     # metres (2 a cell)

    def layer(name):
        t = _tex(gdir / spec[name]["file"], spec[name]["tile_m"], cam.z)
        n = t.shape[0]
        u = np.floor(np.mod(mx / spec[name]["tile_m"] * n, n)).astype(np.int32)
        v = np.floor(np.mod(my / spec[name]["tile_m"] * n, n)).astype(np.int32)
        return t[v, u]
    out = layer("grass")
    dry = layer("grass_dry")
    # dry patches by the world position (they stay put under the camera)
    nz = _noise((64, 64), 6, seed)
    iu = np.clip(np.mod(mx / 40.0, 1.0) * 63, 0, 63).astype(np.int32)
    iv = np.clip(np.mod(my / 40.0, 1.0) * 63, 0, 63).astype(np.int32)
    w = np.clip((nz[iv, iu] - 0.45) * 2.2, 0, 0.75)[..., None]
    out = out * (1 - w) + dry * w
    if yard_cells:
        yard = layer("yard")
        cx0 = int(np.floor(wx.min())) - 2
        cy0 = int(np.floor(wy.min())) - 2
        cw = int(np.ceil(wx.max())) - cx0 + 3
        ch = int(np.ceil(wy.max())) - cy0 + 3
        grid = np.zeros((ch, cw), np.float32)
        for (x, y), wt in yard_cells.items():
            if 0 <= x - cx0 < cw and 0 <= y - cy0 < ch:
                grid[y - cy0, x - cx0] = max(grid[y - cy0, x - cx0], wt)
        # bilinear between cell middles, then a little blur on the screen
        fx = wx - cx0 - 0.5
        fy = wy - cy0 - 0.5
        x0 = np.clip(np.floor(fx).astype(np.int32), 0, cw - 2)
        y0 = np.clip(np.floor(fy).astype(np.int32), 0, ch - 2)
        tx = np.clip(fx - x0, 0, 1)
        ty = np.clip(fy - y0, 0, 1)
        g00, g10, g01, g11 = grid[y0, x0], grid[y0, x0 + 1], grid[y0 + 1, x0], grid[y0 + 1, x0 + 1]
        wy_ = (g00 * (1 - tx) + g10 * tx) * (1 - ty) + (g01 * (1 - tx) + g11 * tx) * ty
        m = Image.fromarray((np.clip(wy_, 0, 1) * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(6 * cam.z))
        a = (np.asarray(m, np.float32) / 255.0)[..., None]
        out = out * (1 - a) + yard * a
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


# ---------------------------------------------------------------- sprites

def scaled(im, z):
    return im if abs(z - 1) < 1e-6 else im.resize((max(1, round(im.width * z)), max(1, round(im.height * z))), Image.LANCZOS)


def mirror(spr):
    (im, ax, ay), sh = spr
    im = im.transpose(Image.FLIP_LEFT_RIGHT)
    out_sh = None
    if sh:
        si, sx, sy = sh
        out_sh = (si.transpose(Image.FLIP_LEFT_RIGHT), si.width - sx, sy)
    return (im, im.width - ax, ay), out_sh


class Canvas:
    def __init__(self, base, cam):
        self.base = base.convert("RGBA")
        self.cam = cam
        self.shadow = np.zeros((base.height, base.width), np.float32)
        self.items = []                          # (depth, image, x, y) in px

    def add(self, spr, x, y, depth, up_pt=0.0, shadow=True):
        """A sprite whose anchor stands at world cell point (x, y), `up_pt` points up (zoom 1)."""
        (im, ax, ay), sh = spr
        z = self.cam.z
        sx, sy = self.cam.pt(x, y, up_pt)
        if sh and shadow:
            gx, gy = self.cam.pt(x, y)
            si, shx, shy = sh
            si = scaled(si, z)
            a = np.asarray(si.getchannel("A"), np.float32) / 255.0
            x0, y0 = round(gx * K - shx * z), round(gy * K - shy * z)
            xa, ya = max(0, x0), max(0, y0)
            xb, yb = min(self.base.width, x0 + si.width), min(self.base.height, y0 + si.height)
            if xa < xb and ya < yb:
                self.shadow[ya:yb, xa:xb] = np.maximum(self.shadow[ya:yb, xa:xb], a[ya - y0:yb - y0, xa - x0:xb - x0])
        im = scaled(im, z)
        self.items.append((depth, im, round(sx * K - ax * z), round(sy * K - ay * z)))
        return sx, sy - ay * z / K               # the foot on the screen, the picture's top (pt)

    def render(self):
        g = np.asarray(self.base, np.float32).copy()
        g[..., :3] *= 1 - self.shadow[..., None] * (1 - np.array([0.45, 0.46, 0.50]))
        out = Image.fromarray(np.clip(g, 0, 255).astype(np.uint8), "RGBA")
        for _, im, x, y in sorted(self.items, key=lambda t: t[0]):
            cx, cy = max(0, -x), max(0, -y)
            if cx >= im.width or cy >= im.height:
                continue
            out.alpha_composite(im.crop((cx, cy, im.width, im.height)), (max(0, x), max(0, y)))
        return out.convert("RGB")


class Art:
    def __init__(self, atlas, units):
        self.atlas, self.units_dir = atlas, units
        self._b, self._c, self._u = {}, {}, {}

    def buildings(self, c):
        if c not in self._b:
            self._b[c] = S9.Atlas(self.atlas / "buildings" / f"buildings_{c}.json")
        return self._b[c]

    def castle(self, c):
        if c not in self._c:
            self._c[c] = S9.Atlas(self.atlas / "castle" / f"castle_{c}.json")
        return self._c[c]

    def unit(self, u):
        if u not in self._u:
            self._u[u] = S9.Atlas(next(self.units_dir.rglob(f"atlas_x3/{u}.json")))
        return self._u[u]

    def unit_sprite(self, u, anim, face, k, team):
        a = self.unit(u)
        n = a.j["anims"].get(anim, a.j["anims"]["idle"])["frames"]
        name, flip = S9.unit_frame(a, u, anim if anim in a.j["anims"] else "idle", face % 8, k % n)
        spr = a.sprite(name, team)
        return mirror(spr) if flip else spr


def screen_face(dx, dy):
    """The atlas facing (0 right, 2 up, 4 left, 6 down on the screen) of a step (dx, dy) in world cells."""
    px, py = (dx - dy) * STEP_X, (dx + dy) * STEP_Y
    return round(math.atan2(-py, px) / (math.pi / 4)) % 8


# ---------------------------------------------------------------- an R14 scene

GATE_SIDE = lambda p: ("n" if p["anchor"][1] < 0 else "s") if "gate_x" in p["piece"] else ("w" if p["anchor"][0] < 0 else "e")
INWARD = {"n": (0, 1), "s": (0, -1), "w": (1, 0), "e": (-1, 0)}


def piece_side(p):
    if "gate" in p["piece"]:
        return GATE_SIDE(p)
    tail = p["piece"].split("_")[-1]
    return tail if tail in INWARD else None


def draw_scene(art, name, sc):
    cam = Cam(sc["zoom"], sc.get("look"), sc.get("focus"))
    cul = sc.get("culture", "E")
    lay = {"zoom": sc["zoom"], "cam": [sc["zoom"], cam.ox, cam.oy], "units": [], "buildings": {}, "towns": {}, "gates": {}}
    yard = {}
    plan = []                                    # (depth, kind, args)
    towns = {}
    for t in sc.get("towns", []):
        c = t.get("culture", cul)
        ca = art.castle(c)
        L = ca.j["layouts"][t["layout"]]
        tx, ty = t["at"]
        ruin = t.get("ruin", False)
        team = t.get("team", "neutral")
        towns[t["id"]] = (t, L, ca)
        for g in L["ground"]:
            yard[(tx + g["cell"][0], ty + g["cell"][1])] = g["w"] * (0.9 if g["kind"] == "lane" else 0.7)
        pieces = []
        for i, p in enumerate(L["walls"]):
            info = ca.j["pieces"][p["piece"]]
            fr = info["frames"]
            side = piece_side(p)
            if ruin:
                look = "ruin"
            elif "gate" in p["piece"]:
                look = t.get("gates", {}).get(side, "closed")
            else:
                look = "intact"
            ax, ay = tx + p["anchor"][0], ty + p["anchor"][1]
            depth = ax + ay
            pieces.append(dict(p=p, info=info, depth=depth, side=side))
            plan.append((depth, "sprite", (ca.sprite(fr.get(look, fr["intact"]), team), ax, ay, 0.0)))
            front = fr.get("ruin_front" if ruin else "intact_front")
            if front and look not in ("broken",):
                plan.append((depth + 0.002, "sprite", (ca.sprite(front, team), ax, ay, 0.0, False)))
            if "gate" in p["piece"]:
                xs = [tx + cc[0] for cc in p["cells"]]
                yss = [ty + cc[1] for cc in p["cells"]]
                foot = [cam.pt(min(xs), min(yss)), cam.pt(max(xs) + 1, min(yss)), cam.pt(max(xs) + 1, max(yss) + 1), cam.pt(min(xs), max(yss) + 1)]
                gx, gy = cam.pt(ax, ay)
                sprite_h = ca.j["frames"][fr["intact"]]["ay"] / K * cam.z
                lay["gates"][f"{t['id']}.{side}"] = dict(at=[gx, gy], foot=foot, top=gy - sprite_h * 0.75, look=look)
        if not ruin or t.get("decor_ruin", True):
            for dd in L.get("decor", []):
                key = (ca.j["decor_ruin"] if ruin else ca.j["decor"])[dd["piece"]]
                plan.append((tx + dd["at"][0] + ty + dd["at"][1], "sprite", (ca.sprite(key, team), tx + dd["at"][0], ty + dd["at"][1], 0.0)))
        kp = t.get("keep", "done")
        ba = art.buildings(c)
        kx, ky = tx + 0.5, ty + 0.5
        if kp:
            st = ba.j["buildings"]["Keep"]["states"][kp]
            plan.append((kx + ky, "sprite", (ba.sprite(st, "neutral" if kp == "rubble" else team), kx, ky, 0.0)))
            kh = ba.j["frames"][st]["ay"] / K * cam.z
            kcx, kcy = cam.pt(kx, ky)
            lay["buildings"][f"{t['id']}.keep"] = dict(at=[kcx, kcy], foot=foot_pts(cam, kx, ky, 3, 3), top=kcy - kh * 0.8)
        n = L["walls"]
        wx = [tx + cc[0] for p in n for cc in p["cells"]]
        wy = [ty + cc[1] for p in n for cc in p["cells"]]
        x0, x1, y0, y1 = min(wx), max(wx) + 1, min(wy), max(wy) + 1
        lay["towns"][t["id"]] = dict(centre=list(cam.pt(kx, ky)), ring=[cam.pt(x0, y0), cam.pt(x1, y0), cam.pt(x1, y1), cam.pt(x0, y1)],
                                     south=list(cam.pt(x1 + 0.4, y1 + 0.4)), top=list(cam.pt(kx, ky, 120)))
        towns[t["id"]] = (t, L, ca, pieces)
    for b in sc.get("buildings", []):
        c = b.get("culture", cul)
        ba = art.buildings(c)
        info = ba.j["buildings"][b["b"]]
        fw, fh = info["footprint"]
        st = info["states"][b.get("state", "done")]
        x, y = b["at"]
        team = b.get("team", "blue")
        plan.append((x + y, "sprite", (ba.sprite(st, team), x, y, 0.0)))
        fronts = info.get("fronts", {})
        if b.get("state", "done") in fronts:
            plan.append((x + y + 0.002, "sprite", (ba.sprite(fronts[b.get("state", "done")], team), x, y, 0.0, False)))
        hgt = ba.j["frames"][st]["ay"] / K * cam.z
        bx, by = cam.pt(x, y)
        lay["buildings"][b["id"]] = dict(at=[bx, by], foot=foot_pts(cam, x, y, fw, fh), top=by - hgt * 0.85, name=b.get("name"))
    # units
    uid = 0
    for u in sc.get("units", []):
        for one in expand(u):
            uid += 1
            team = one.get("team", "blue")
            face = one.get("face", 6)
            k = one.get("k", (uid * 3) % 8)
            spr = art.unit_sprite(one["u"], one.get("anim", "idle"), face, k, team)
            up = 0.0
            if "wall" in one:
                tid, dx, dy = one["wall"]
                t, L, ca, pieces = towns[tid]
                x, y, up, depth = wall_spot(t, pieces, dx, dy)
            elif "post" in one:
                bid, i = one["post"]
                b = next(bb for bb in sc["buildings"] if bb["id"] == bid)
                info = art.buildings(b.get("culture", cul)).j["buildings"]["Outpost"]
                mx, my, mz = info["stand_m"][i]
                x, y = b["at"][0] + mx / 2, b["at"][1] + my / 2
                up = mz * PT_PER_M * UP_PER_M
                depth = b["at"][0] + b["at"][1] + 0.001
            else:
                x, y = one["at"]
                depth = x + y
            if "face_to" in one:
                tx2, ty2 = one["face_to"]
                spr = art.unit_sprite(one["u"], one.get("anim", "idle"), screen_face(tx2 - x, ty2 - y), k, team)
            plan.append((depth, "unit", (spr, x, y, up, one)))
    canvas = Canvas(ground(art.atlas, cam, yard), cam)
    for depth, kind, args in plan:
        if kind == "sprite":
            spr, x, y, up = args[:4]
            canvas.add(spr, x, y, depth, up, shadow=args[4] if len(args) > 4 else True)
        else:
            spr, x, y, up, one = args
            fx, top = canvas.add(spr, x, y, depth, up, shadow=up == 0)
            sx, sy = canvas.cam.pt(x, y, up)
            lay["units"].append(dict(id=one.get("id"), group=one.get("group"), u=one["u"], team=one.get("team", "blue"), at=[round(sx, 1), round(sy, 1)],
                                     top=round(top, 1), sel=bool(one.get("sel")), hp=one.get("hp", 100), up=up > 0))
    canvas.render().save(OUT / f"{name}.png")
    return lay


def foot_pts(cam, x, y, w, h):
    return [cam.pt(x - w / 2, y - h / 2), cam.pt(x + w / 2, y - h / 2), cam.pt(x + w / 2, y + h / 2), cam.pt(x - w / 2, y + h / 2)]


def wall_spot(t, pieces, dx, dy):
    """Where someone on the wall cell (dx, dy) of town t stands (world cells), how high (pt at zoom 1) and their depth."""
    tx, ty = t["at"]
    for pc in pieces:
        p, info = pc["p"], pc["info"]
        if [dx, dy] not in p["cells"]:
            continue
        x, y = tx + dx + 0.5, ty + dy + 0.5
        if "stand_m" in info:
            minx = min(c[0] for c in p["cells"])
            miny = min(c[1] for c in p["cells"])
            key = f"{dx - minx},{dy - miny}"
            if key in info["stand_m"]:
                mx, my, mz = info["stand_m"][key]
                return tx + p["anchor"][0] + mx / 2, ty + p["anchor"][1] + my / 2, mz * PT_PER_M * UP_PER_M, pc["depth"] + 0.001
            # over a gate (D-119: the walk runs over it while it stands)
            return x, y, info.get("walk_m", 4.8) * PT_PER_M * UP_PER_M, pc["depth"] + 0.001
        if "walk_m" in info and pc["side"] in INWARD:
            ix, iy = INWARD[pc["side"]]
            k = info.get("stand_in_m", 0) / 2
            return x + ix * k, y + iy * k, info["walk_m"] * PT_PER_M * UP_PER_M, pc["depth"] + 0.001
        return x, y, info.get("walk_m", 4.3) * PT_PER_M * UP_PER_M, pc["depth"] + 0.001
    raise ValueError(f"no wall at {dx},{dy} in {t['id']}")


def expand(u):
    """A unit, or a group of them in ranks: `n` from `at` along +x by `gap`, `cols` a rank, the ranks along +y."""
    if "group" not in u or "n" not in u:
        return [u]
    out = []
    cols = u.get("cols", 3)
    gap = u.get("gap", 0.9)
    ax, ay = u["at"]
    ox, oy = u.get("dir", [1, 0])
    rx, ry = u.get("rank", [0, 1])
    for i in range(u["n"]):
        c, r = i % cols, i // cols
        j = ((i * 37) % 7 - 3) * 0.04
        one = {k: v for k, v in u.items() if k not in ("n", "at", "cols", "gap", "dir", "rank")}
        one["at"] = [ax + (c * ox + r * rx) * gap + j, ay + (c * oy + r * ry) * gap - j]
        one["id"] = f"{u['group']}.{i}"
        out.append(one)
    return out


# ---------------------------------------------------------------- R13 B2's screen-placed scenes (field_b2.py)

B2_RINGS = [[0, 0], [24, 10], [-22, 8], [10, 26], [-30, 28], [38, 30], [-8, -18], [30, -14], [-40, -8], [52, 6], [-54, 16], [58, 28]]
B2_KINDS = ["spear_e"] * 6 + ["bow_e"] * 4 + ["mage_e"] * 2


def draw_b2(art, name, sc):
    """R13 B2's scene: buildings at screen points (pt, zoom), the squad round its point; the ground of R14."""
    z = sc["zoom"]
    cam = Cam(z, (0, 0))
    canvas = Canvas(ground(art.atlas, cam, {}), cam)
    b = art.buildings("E")
    c = art.castle("E")
    to_world = lambda x, y: cam.world(np.array(x, np.float32), np.array(y, np.float32))
    for bd in sc["buildings"]:
        x, y = bd["at"]
        if not (-120 < x < 934 and -60 < y < 480):
            continue
        a = c if bd["frame"].startswith("castle") else b
        wx, wy = to_world(x, y)
        canvas.add(a.sprite(bd["frame"], "blue"), float(wx), float(wy), y)
        # R14: spearmen on the 3 x 3 outpost's walk (D-121), its front part over them
        if bd.get("crew"):
            info = b.j["buildings"]["Outpost"]
            for i, (mx, my, mz) in enumerate(info["stand_m"][:bd["crew"]]):
                face = screen_face(mx, my)
                canvas.add(art.unit_sprite("spear_e", "idle", face, i, "blue"), float(wx) + mx / 2, float(wy) + my / 2, y + 0.001,
                           mz * PT_PER_M * UP_PER_M, shadow=False)
            front = info.get("fronts", {}).get("done")
            if front:
                canvas.add(b.sprite(front, "blue"), float(wx), float(wy), y + 0.002, shadow=False)
    sx, sy = sc["squad"]["at"]
    k = z * 1.25
    for i, (dx, dy) in enumerate(B2_RINGS[:sc["squad"]["n"]]):
        u = B2_KINDS[i] if sc["squad"]["n"] > 6 else "spear_e"
        x, y = sx + dx * k, sy + dy * k
        if -40 < x < 854 and -40 < y < 420:
            wx, wy = to_world(x, y)
            canvas.add(art.unit_sprite(u, "idle", 7, 0, "blue"), float(wx), float(wy), y)
    canvas.render().save(OUT / f"r13-b2-{name}.png")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--atlas", default=os.environ.get("R14_ATLAS", "design/b1/build/v7atlas_dl/atlas_x3"))
    ap.add_argument("--units", default=os.environ.get("R14_UNITS", "design/production/build/v8u_dl"))
    ap.add_argument("only", nargs="*")
    a = ap.parse_args()
    at = lambda p: Path(p) if Path(p).is_absolute() else REPO / p
    art = Art(at(a.atlas), at(a.units))
    if not (art.atlas / "castle").is_dir():
        sys.exit(f"no art-v7 atlas at {art.atlas} (pass --atlas or set R14_ATLAS)")
    OUT.mkdir(parents=True, exist_ok=True)
    scenes = js_object(HERE / "r14-scene.js", "R14_SCENES")
    b2 = js_object(D / "r13" / "common" / "r13-b2-scene.js", "R13_B2")
    b2.update(js_object(HERE / "r14-scene.js", "R14_B2"))
    layout = {}
    lay_path = OUT / "r14-layout.js"
    if lay_path.exists() and a.only:
        layout = json.loads(lay_path.read_text().split("=", 1)[1].rstrip().rstrip(";"))
    for name, sc in scenes.items():
        if a.only and name not in a.only:
            continue
        layout[name] = draw_scene(art, name, sc)
        print(name, "ok")
    for name, sc in b2.items():
        if a.only and f"b2:{name}" not in a.only and name not in a.only:
            continue
        draw_b2(art, name, sc)
        print("b2", name, "ok")
    rnd = lambda v: [rnd(x) for x in v] if isinstance(v, (list, tuple)) else round(v, 1) if isinstance(v, float) else {k: rnd(x) for k, x in v.items()} if isinstance(v, dict) else v
    lay_path.write_text("window.R14_LAYOUT = " + json.dumps(rnd(layout), ensure_ascii=False) + ";\n")


if __name__ == "__main__":
    main()
