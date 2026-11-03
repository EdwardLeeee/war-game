"""art-v7's edge on the diamond screen, drawn from the edge/ folder the way the client will draw it (design/r11/
edge-format.md): the review boards of PR4, and a check of the format itself.

Back to front: clouds.far and clouds.near tiled on the screen (parallax, drift, each cross-faded with itself half a
cycle on); the islands (with the far layer's parallax); the cliff stretches at their 16 m slots and the corners; the
waterfall (loop scrolled down and widening, spray, mouth); the ground cut straight at the map's edge, its last 0.75 m
fading onto the cliff top; trees, rocks, men; the puffs.

python3 design/r11/common/edge_board_v7.py EDGE_X3 ART_X3 GRID OUT UNITS
  EDGE_X3: atlas_x3/edge (edge_pack.py); ART_X3: art-v6.3's x3 (its ground layers); GRID: 雙河關 (r9 grid_twin.json)
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import scene_r11 as SR    # noqa: E402

R, S9, PPM = SR.R, SR.S9, SR.PPM
G = S9.G
FPS, FRAMES = 12, 36
FALL = (49, 52)
S2 = math.sqrt(0.5)                           # 雙河關: the north river leaves the west edge over rows 49-51


def window(gridp, X0, Y0, SIZE):
    """(grid, trees) of a window of cells (x0, y0) .. +SIZE; past the map's edges the edge cells carried on (the ground
    is cut at the edge anyway), trees only on the map."""
    d = json.loads(Path(gridp).read_text())
    n = d["size"]
    t = np.array(d["terrain"], np.int32).reshape(n, n)
    grid = np.zeros((SIZE, SIZE), np.int32)
    trees = []
    for yy in range(SIZE):
        for xx in range(SIZE):
            X, Y = X0 + xx, Y0 + yy
            grid[yy, xx] = t[min(max(Y, 0), n - 1), min(max(X, 0), n - 1)]
            if grid[yy, xx] == 4 and X <= 3:
                grid[yy, xx] = 3          # as R11-06: the river runs to the lip as water (the map's ford there read as tiles)
            if 0 <= X < n and 0 <= Y < n and d["rows"][Y][X] == "T" and t[Y, X] == 0:
                trees.append((xx, yy, (xx * 7 + yy * 13) % 3))
    return grid, trees


def _load(d, name):
    a = np.asarray(Image.open(d / name).convert("RGBA"), np.float32) / 255.0
    return R.to_lin(a[..., :3]), a[..., 3]


def _blit(col, c, a, x0, y0):
    h, w = a.shape
    H, W = col.shape[:2]
    xa, ya, xb, yb = max(0, x0), max(0, y0), min(W, x0 + w), min(H, y0 + h)
    if xa >= xb or ya >= yb:
        return
    sa = a[ya - y0:yb - y0, xa - x0:xb - x0, None]
    col[ya:yb, xa:xb] = col[ya:yb, xa:xb] * (1 - sa) + c[ya - y0:yb - y0, xa - x0:xb - x0] * sa


def _tile(t, x, y):
    """A tile (H, W, C) sampled bilinear, wrapping, at pixel coordinates x, y (arrays)."""
    n, m = t.shape[:2]
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = (x - x0)[..., None], (y - y0)[..., None]
    a = t[y0 % n, x0 % m] * (1 - fx) + t[y0 % n, (x0 + 1) % m] * fx
    b = t[(y0 + 1) % n, x0 % m] * (1 - fx) + t[(y0 + 1) % n, (x0 + 1) % m] * fx
    return a * (1 - fy) + b * fy


def build(edge_dir, art, gridp, X0, Y0, SIZE, units_dir=None, fall=None, men=()):
    E = json.loads((edge_dir / "edge.json").read_text())
    assert E["format"] == "war-game edge 1" and E["view"] == "diamond" and E["pxPerM"] == PPM, E["format"]
    grid, trees = window(gridp, X0, Y0, SIZE)
    N = json.loads(Path(gridp).read_text())["size"]        # 129 cells: 258 m a side
    layers, rules = S9.ground_layers(art)
    relief = R.load_tile(SR.RELIEF_D)
    cache = HERE.parent / "build" / "v7board_cache" / f"ground_{X0}_{Y0}_{SIZE}.npz"
    if cache.exists():                                  # the ground's compose takes ~10 min a window
        z = np.load(cache)
        top, R.LAST_WATER = z["top"], z["water"]
    else:
        top = R.compose(grid, [], layers, relief, ppm=PPM, rules=rules, sun=R.SUN_D, view=R.VIEW_D)
        cache.parent.mkdir(parents=True, exist_ok=True)
        np.savez(cache, top=top.astype(np.float32), water=np.asarray(R.LAST_WATER, np.float32))
    n = top.shape[0]
    m = (np.arange(n) + 0.5) / PPM
    wx = -X0 * 2.0                                     # the map's west edge, window metres
    sy = (N - Y0) * 2.0                                # its south edge
    edge_m = N * 2.0
    # the client's ground: cut straight at the map's edge, its last 0.75 m fading onto the cliff's top
    alpha = G.smoothstep(wx, wx + 0.75, m[None, :]) * G.smoothstep(sy, sy - 0.75, m[:, None])
    alpha = alpha * (m[None, :] >= wx) * (m[:, None] <= sy)
    ground = SR.turn(top, alpha)
    water = R.LAST_WATER.copy() * alpha
    st = SR.Stage(n)
    for y in range(grid.shape[0]):
        for x in range(grid.shape[1]):
            if grid[y, x] == 1 and 0 <= X0 + x < N and Y0 + y < N:
                st.put(SR.piece(f"terrain_rock_v{(x * 7 + y * 3) % 6}_d", "neutral"), (x + 0.5) * 2, (y + 0.5) * 2)
    for x, y, k in trees:
        st.put(SR.piece(f"tree_E_v{k}_d", "neutral"), (x + 0.5) * 2, (y + 0.5) * 2)
    for anim, f, k, gx, gy in men:
        spr, flip = SR.unit(units_dir, anim, f, k)
        st.put(spr, gx, gy, flip=flip)
    # the cliff: slot k's middle 16 k m from the corner, its variant by the slot
    cl = E["cliff"]
    pieces = []
    span = n / PPM
    for k in range(1, int((edge_m - 18) // 16) + 1):
        gy = sy - 16.0 * k                              # the west edge, from the SW corner north
        if -18 < gy < span + 18 and wx > -18:
            p = cl["sw"][(k * 7 + 3) % 3]
            pieces.append((p, SR.at(wx, gy, n)))
        gx = wx + 16.0 * k                              # the south edge, from the SW corner east
        if -18 < gx < span + 18 and sy < span + 18:
            p = cl["se"][(k * 5 + 1) % 3]
            pieces.append((p, SR.at(gx, sy, n)))
    for key, (gx, gy) in (("bottom", (wx, sy)), ("left", (wx, sy - edge_m)), ("right", (wx + edge_m, sy))):
        if -18 < gx < span + 18 and -18 < gy < span + 18:
            pieces.append((cl["corner"][key], SR.at(gx, gy, n)))
    pieces.sort(key=lambda q: q[1][1])
    cliff = [(_load(edge_dir, p["file"]), p["anchor"], at) for p, at in pieces]
    L = dict(E=E, n=n, ground=ground, water=water, stage=st, cliff=cliff, size=ground.size, edge_dir=edge_dir,
             far=_load(edge_dir, E["clouds"]["far"]["file"]), near=_load(edge_dir, E["clouds"]["near"]["file"]),
             isles=[(_load(edge_dir, i["file"]), i["anchor"]) for i in E["islands"]],
             puffs=[(_load(edge_dir, p["file"]), p) for p in E["puffs"]])
    if fall:
        r0, r1 = fall
        L["lip"] = (SR.at(wx, (r0 - Y0) * 2.0, n), SR.at(wx, (r1 - Y0) * 2.0, n))
        L["mouth"] = (_load(edge_dir, E["fall"]["mouth"]["file"]), E["fall"]["mouth"]["anchor"],
                      SR.at(wx, ((r0 + r1) / 2 - Y0) * 2.0, n))
        L["loop"] = _load(edge_dir, E["fall"]["loop"]["file"])
        L["spray"] = (_load(edge_dir, E["fall"]["spray"]["file"]), E["fall"]["spray"]["anchor"])
    return L


def clouds(L, w, h, ox, oy, phase, pan):
    """The two cloud layers as the client draws them: tiled on the screen, parallax, drift, each cross-faded with itself
    half a cycle on (phase 0..1: one cross-fade cycle)."""
    E = L["E"]["clouds"]
    yy, xx = np.mgrid[oy:oy + h, ox:ox + w].astype(np.float32)
    out = None
    for key in ("far", "near"):
        c, a = L[key]
        t = np.dstack([c, a])
        spec = E[key]
        acc = 0.0
        for k in (0.0, 0.5):
            tau = (phase + k) % 1.0
            wgt = 1 - abs(2 * tau - 1)
            dx, dy = (v * spec["fade_s"] * tau for v in spec["drift_px_s"])
            s = _tile(t, xx - pan * (1 - spec["parallax"]) - dx, yy - dy)
            acc = acc + wgt * np.dstack([s[..., :3] * s[..., 3:], s[..., 3:]])
        if key == "far":
            out = acc[..., :3] / np.maximum(acc[..., 3:], 1e-4)
        else:
            al = acc[..., 3:]
            out = out * (1 - al) + acc[..., :3]
    return out


def waterfall(L, col, ox, oy, phase):
    """The loop hung from the lip and scrolled down one period a loop (the board's), widening, fading into the spray."""
    spec = L["E"]["fall"]["loop"]
    # the loop hangs from the lip moved out_m out (the west edge: out is -x, the screen's lower left) and starts drop_m
    # below it, where the mouth's arc ends
    (ax, ay), (bx, by) = [(x - spec["out_m"] * S2 * PPM, y + spec["out_m"] * 0.5 * S2 * PPM) for x, y in L["lip"]]
    c, a = L["loop"]
    b0, b1 = spec["body_px"]
    per = spec["period_px"]
    H, W = col.shape[:2]
    xs = np.arange(int(ax - (b0 + 40)), int(bx + (c.shape[1] - b1) + 40))
    yy = np.arange(H)[:, None] + oy
    slope = (by - ay) / (bx - ax)
    X = xs[None, :]
    ylip = ay + (X - ax) * slope
    dpx = yy - ylip
    dm = dpx / (0.866 * PPM)
    mid = (b0 + b1) / 2
    cx = mid + (X - (ax + bx) / 2) / (1 + spec["widen_per_m"] * np.clip(dm, 0, None))
    cy = (dpx - phase * per) % per
    top = spec["drop_m"] * 0.866 * PPM
    ok = (dpx >= top - 12) & (cx >= 0) & (cx < c.shape[1] - 1)
    s = _tile(np.dstack([c, a]), np.clip(cx, 0, c.shape[1] - 1.01), cy)
    fa = s[..., 3] * ok * G.smoothstep(13.0, 9.0, dm) * np.clip((dpx - top + 12) / 24.0, 0, 1)
    for j, x in enumerate(xs):
        xi = x - ox
        if 0 <= xi < W:
            col[:, xi] = col[:, xi] * (1 - fa[:, j, None]) + s[:, j, :3] * fa[:, j, None]
    sc, sa = L["spray"][0]
    sx, sy = L["spray"][1]
    _blit(col, sc, sa, int((ax + bx) / 2 - sx) - ox, int((ay + by) / 2 + 10.5 * 0.866 * PPM - sy) - oy)


def frame(L, phase, pan=0.0, box=None):
    if box is None:
        box = (0, 0) + tuple(L["size"])
    ox, oy = box[0], box[1]
    w, h = box[2] - box[0], box[3] - box[1]
    col = clouds(L, w, h, ox, oy, phase, pan)
    E = L["E"]
    base = L.get("lip", [(L["size"][0] * 0.3, L["size"][1] * 0.4)])[0]
    for k, ((ic, ia), (iax, iay)) in enumerate(L["isles"]):
        X = base[0] - 700 - 520 * k + pan * (1 - 0.2)
        Y = base[1] + 380 + 210 * (k % 2) + 120 * k
        bob = E["islands"][k]["bob_px"] * math.sin(2 * math.pi * phase + k)
        _blit(col, ic, ia, int(X - iax) - ox, int(Y - iay + bob) - oy)
    for (cc, ca), (pax, pay), (X, Y) in L["cliff"]:
        _blit(col, cc, ca, int(round(X - pax)) - ox, int(round(Y - pay)) - oy)
    if "lip" in L:                                       # the loop, the mouth's arc over its top, the spray
        waterfall(L, col, ox, oy, phase)
        (mc, ma), (max_, may), (MX, MY) = L["mouth"]
        _blit(col, mc, ma, int(round(MX - max_)) - ox, int(round(MY - may)) - oy)
    g = np.asarray(L["ground"].crop(box), np.float32) / 255.0
    ga = g[..., 3]
    col = col * (1 - ga[..., None]) + R.to_lin(g[..., :3]) * ga[..., None]
    img = Image.fromarray((np.clip(R.to_srgb(col), 0, 1) * 255).round().astype(np.uint8), "RGB").convert("RGBA")
    wimg = Image.fromarray((np.clip(L["water"], 0, 1) * 255).astype(np.uint8), "L").rotate(45, expand=True)
    wm = np.asarray(wimg.resize((wimg.width, wimg.height // 2), Image.BILINEAR).crop(box), np.float32) / 255.0
    st = L["stage"]
    items = [(f, im, (xy[0] - ox, xy[1] - oy)) for f, im, xy in st.items]
    shadows = [(im, (xy[0] - ox, xy[1] - oy)) for im, xy in st.shadows]
    refl = [(im, (xy[0] - ox, xy[1] - oy)) for im, xy in st.refl]
    img = S9.screen_layers(img, items, shadows, wm, refl)
    a = np.asarray(img, np.float32) / 255.0
    col = R.to_lin(a[..., :3])
    for k, ((pc, pa), spec) in enumerate(L["puffs"]):
        t = (phase + k / len(L["puffs"])) % 1.0
        fade = math.sin(math.pi * t) ** 2
        X = base[0] - 1300 + k * 420 + spec["drift_px_s"][0] * 30 * t
        Y = base[1] + 380 + k * 160 + spec["drift_px_s"][1] * 30 * t
        _blit(col, pc, pa * fade * spec["alpha_max"] / max(pa.max(), 1e-3), int(X) - ox, int(Y) - oy)
    return Image.fromarray((np.clip(R.to_srgb(col), 0, 1) * 255).round().astype(np.uint8), "RGB")


def crop_box(L, cx, cy, w=SR.SCREEN[0], h=SR.SCREEN[1]):
    return (int(cx - w / 2), int(cy - h / 2), int(cx - w / 2) + w, int(cy - h / 2) + h)


def main(edge_dir, art, gridp, out, units_dir):
    out.mkdir(parents=True, exist_ok=True)
    # 1. the west edge where the north river goes over (R11-06's window)
    X0, Y0, SIZE = -14, 28, 47
    men = (("idle", 7, 0, 36.0, 40.0 + 14.0), ("walk", 6, 3, 38.0, 41.5 + 14.0), ("idle", 1, 2, 34.5, 42.5 + 14.0))
    L = build(edge_dir, art, gridp, X0, Y0, SIZE, units_dir, fall=FALL, men=men)
    (ax, ay), (bx, by) = L["lip"]
    box = crop_box(L, (ax + bx) / 2 - 150, (ay + by) / 2 + 120)
    frame(L, 0.0, 0.0, box).save(out / "west_fall.png")
    gif = []
    gb = (int(ax) - 640, int(ay) - 260, int(ax) - 640 + 1350, int(ay) - 260 + 1010)
    for k in range(FRAMES):
        pan = 60.0 * math.sin(2 * math.pi * k / FRAMES)
        bk = (gb[0] + int(pan), gb[1], gb[2] + int(pan), gb[3])
        gif.append(frame(L, k / FRAMES, pan, bk).resize((675, 505), Image.LANCZOS))
    pal = gif[0].quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    q = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in gif]
    q[0].save(out / "west_fall.gif", save_all=True, append_images=q[1:], duration=int(1000 / FPS), loop=0, optimize=True)
    # 2. the south-west corner: both seen faces and the convex corner
    X0, Y0, SIZE = -12, 99, 48
    L2 = build(edge_dir, art, gridp, X0, Y0, SIZE, units_dir)
    cx, cy = SR.at(-X0 * 2.0, (129 - Y0) * 2.0, L2["n"])
    frame(L2, 0.0, 0.0, crop_box(L2, cx + 150, cy - 40)).save(out / "corner_sw.png")


if __name__ == "__main__":
    a = sys.argv
    main(Path(a[1]), Path(a[2]), a[3], Path(a[4]), a[5])
    print("ok")
