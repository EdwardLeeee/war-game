"""R11-06 the floating continent's edge on the diamond screen (the user 2026-11-02: 「邊邊可以加個瀑布動畫，感覺像是再一個
浮空大陸上的感覺」): 雙河關's west edge where the north river leaves the map over its ford (rows 49-51), as a still
and as a looping GIF. Layers, back to front: the sea of clouds; (C) far islands in the haze; the wall under the
map's edge (render_b1 piece edge_<A|B>_d, fading into the clouds); the waterfall over it with its spray; the ground
(R9's composer on the diamond camera, cut at the edge); rocks, trees, men.

Everything that moves is a tiling picture moved over time (the way a shader would draw it: no frame-by-frame
pictures): the clouds two layers of one tile drifting, cross-faded so the loop has no seam; the waterfall one tile
scrolling down. cost() measures that against frame-by-frame pictures (a flipbook).

python3 design/r11/common/edge_scene_r11.py ART_X3 GRID OUT STYLE(A|B|C) UNITS [frames]
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
X0, Y0, SIZE = -14, 28, 47           # the window, in cells (x < 0: beyond the map's west edge)
EDGE_M = -X0 * 2.0                   # the edge's x in window metres
FALL = (49, 52)                      # the river's rows where it goes over (cells)
WALL_H = 13.0
FPS, FRAMES = 12, 36                 # the GIF: 3 s loop


def window(gridp):
    """(grid, trees) of the window; beyond the edge the column x 0 carried on (so the river runs to the edge and the
    ground composer sees no bank there), trees only on the map."""
    d = json.loads(Path(gridp).read_text())
    n = d["size"]
    t = np.array(d["terrain"], np.int32).reshape(n, n)
    grid = np.zeros((SIZE, SIZE), np.int32)
    trees = []
    for yy in range(SIZE):
        for xx in range(SIZE):
            X, Y = X0 + xx, Y0 + yy
            grid[yy, xx] = t[Y, max(X, 0)]
            if X >= 0 and d["rows"][Y][X] == "T" and t[Y, X] == 0:
                trees.append((xx, yy, (xx * 7 + yy * 13) % 3))
    return grid, trees


# ---------------------------------------------------------------- the moving tiles (what a shader would sample)

def _fft_tile(n, beta, seed, stretch=(1.0, 1.0)):
    rng = np.random.default_rng(seed)
    F = np.fft.fft2(rng.standard_normal((n, n)))
    ky = np.fft.fftfreq(n)[:, None] * stretch[1]
    kx = np.fft.fftfreq(n)[None, :] * stretch[0]
    k = np.hypot(kx, ky)
    k[0, 0] = 1.0
    a = np.real(np.fft.ifft2(F * k ** (-beta / 2)))
    a[...] = (a - a.min()) / (a.max() - a.min())
    return a.astype(np.float32)


CLOUD_TILE = _fft_tile(512, 3.2, 41)                               # 512 px: one A8 tile, 256 KB
FALL_TILE = _fft_tile(256, 2.2, 43, stretch=(1.0, 7.0))            # streaks, long down the fall: 256 x 256 A8, 64 KB


def _tile(tile, x, y):
    """tile sampled (bilinear, wrapping) at pixel coordinates x, y (arrays)."""
    n = tile.shape[0]
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    tx, ty = x - x0, y - y0
    a = tile[y0 % n, x0 % n] * (1 - tx) + tile[y0 % n, (x0 + 1) % n] * tx
    b = tile[(y0 + 1) % n, x0 % n] * (1 - tx) + tile[(y0 + 1) % n, (x0 + 1) % n] * tx
    return a * (1 - ty) + b * ty


def clouds(w, h, phase, pan=0.0, ox=0, oy=0):
    """The sea of clouds far below (client's bottom layer), lit from the upper left (linear RGB). phase 0..1: the loop's
    time; pan: the camera's sideways move in screen pixels. Two layers of one tile: far (big, slow, 0.2 of the camera's
    move) and near (0.35); each drifts and is cross-faded with itself half a cycle on (a flow-map blend: seamless)."""
    yy, xx = np.mgrid[oy:oy + h, ox:ox + w].astype(np.float32)
    def layer(scale, drift, ph, par):
        out = 0
        for k in (0.0, 0.5):
            t = (ph + k) % 1.0
            wgt = 1 - abs(2 * t - 1)
            # the crop moves with the camera; the layer lags behind it: only par of the move shows on the screen
            out = out + wgt * _tile(CLOUD_TILE, (xx - pan * (1 - par)) / scale + drift[0] * t, yy / (scale * 0.5) + drift[1] * t)
        return out
    a = layer(2.6, (70.0, 20.0), phase, 0.2)
    b = layer(1.0, (120.0, 35.0), (phase + 0.3) % 1.0, 0.35)
    dens = np.clip((0.55 * a + 0.45 * b - 0.32) * 2.2, 0, 1)
    # light from the upper left: the slope of the density
    gx = np.roll(dens, -3, 1) - np.roll(dens, 3, 1)
    gy = np.roll(dens, -3, 0) - np.roll(dens, 3, 0)
    lit = np.clip(0.75 - 2.2 * (gx * 0.6 + gy * 0.8), 0.35, 1.15)
    deep = np.array([0.30, 0.40, 0.55])
    white = np.array([0.92, 0.92, 0.94])
    col = deep * (1 - dens[..., None]) + white * (dens * lit)[..., None]
    return col


def waterfall(lip_a, lip_b, w, h, phase, H=WALL_H, ox=0, oy=0):
    """The waterfall's colour (linear) and alpha on the screen: over the wall, from the lip segment lip_a..lip_b (screen
    points) straight down; a smooth glassy lip, then white streaks scrolling down, thinning to spray and mist."""
    ax, ay = lip_a
    bx, by = lip_b
    yy, xx = np.mgrid[oy:oy + h, ox:ox + w].astype(np.float32)
    u = (xx - ax) / (bx - ax)
    ly = ay + u * (by - ay)
    dep = (yy - ly) / (0.866 * PPM)                    # metres down the fall
    inside = (u > -0.02) & (u < 1.02) & (dep > -0.15) & (dep < H)
    edge = G.smoothstep(0.0, 0.08, u) * G.smoothstep(1.0, 0.92, u)
    # one tile scrolling down: one full tile per loop (2 s), so the loop has no seam
    st = _tile(FALL_TILE, u * 96.0, dep * PPM * 0.866 * 0.35 - phase * FALL_TILE.shape[0])
    st2 = _tile(FALL_TILE, u * 41.0 + 77, dep * PPM * 0.866 * 0.18 - phase * FALL_TILE.shape[0] + 31)
    s = 0.6 * st + 0.4 * st2
    glass = G.smoothstep(0.6, 0.0, dep)                 # the water going over: smooth, dark, holding the sky
    white = np.clip((s - 0.35) * 2.2, 0, 1) * (1 - glass)
    spray = G.smoothstep(4.0, 11.0, dep)
    alpha = (0.92 * glass + (0.35 + 0.6 * white) * (1 - glass)) * (1 - 0.75 * spray) * edge * inside
    col = (np.array([0.10, 0.14, 0.16]) * glass[..., None]
           + (np.array([0.55, 0.62, 0.66]) * (1 - white[..., None]) + np.array([0.92, 0.94, 0.95]) * white[..., None])
           * (1 - glass[..., None]))
    # the mist where the fall goes into the clouds: a soft plume, wider than the fall, drifting
    pu = (u - 0.5) / 1.4
    plume = np.exp(-pu ** 2 * 3.0) * G.smoothstep(6.0, 12.0, dep) * G.smoothstep(18.0, 13.0, dep)
    mist = plume * (0.55 + 0.45 * _tile(CLOUD_TILE, xx * 0.7 + phase * 60, yy * 1.2))
    return col, np.clip(alpha, 0, 1), np.clip(mist, 0, 1)


def _puff(w, h, seed):
    """A loose cloud with soft edges: (linear colour, alpha), lit from the upper left."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    r = np.hypot((xx - w / 2) / (w / 2), (yy - h / 2) / (h / 2))
    ox, oy = rng.uniform(0, 512, 2)
    n = (0.6 * _tile(CLOUD_TILE, xx * 1.1 + ox, yy * 1.6 + oy) + 0.4 * _tile(CLOUD_TILE, xx * 3.1 + oy, yy * 4.4 + ox))
    dens = np.exp(-r ** 2 * 3.0) * np.clip(0.35 + 0.9 * n, 0, 1)             # soft all round (R11 r0: grey cotton)
    gx = np.roll(dens, -4, 1) - np.roll(dens, 4, 1)
    gy = np.roll(dens, -4, 0) - np.roll(dens, 4, 0)
    lit = np.clip(1.0 - 1.2 * (gx * 0.6 + gy * 0.8), 0.8, 1.1)
    col = np.array([0.97, 0.97, 0.98]) * lit[..., None]
    return col, dens * 0.6


PUFFS = [_puff(520, 230, 51), _puff(420, 190, 53), _puff(640, 260, 57)]


def _over(base, col, a):
    return base * (1 - a[..., None]) + col * a[..., None]


def _from8(im):
    a = np.asarray(im, np.float32) / 255.0
    return R.to_lin(a[..., :3]), a[..., 3]


# ---------------------------------------------------------------- the scene

def build(art, gridp, style, units_dir):
    """The static layers of the scene (screen RGBA images and positions) and the waterfall's lip, for frame()."""
    grid, trees = window(gridp)
    layers, rules = S9.ground_layers(art)
    relief = R.load_tile(SR.RELIEF_D)
    top = R.compose(grid, [], layers, relief, ppm=PPM, rules=rules, sun=R.SUN_D, view=R.VIEW_D)
    n = top.shape[0]
    m = (np.arange(n) + 0.5) / PPM
    alpha = np.broadcast_to(G.smoothstep(EDGE_M - 0.04, EDGE_M + 0.04, m)[None, :], (n, n))
    ground = SR.turn(top, alpha)
    water = R.LAST_WATER.copy() * alpha
    st = SR.Stage(n)
    h, w = grid.shape
    for y in range(h):
        for x in range(w):
            if grid[y, x] == 1 and X0 + x >= 0:
                st.put(SR.piece(f"terrain_rock_v{(x * 7 + y * 3) % 6}_d", "neutral"), (x + 0.5) * 2, (y + 0.5) * 2)
    for x, y, k in trees:
        st.put(SR.piece(f"tree_E_v{k}_d", "neutral"), (x + 0.5) * 2, (y + 0.5) * 2)
    dy = (35 - Y0) * 2.0                       # (the men were placed for a window starting at row 35)
    for anim, f, k, x, y in (("idle", 7, 0, 36.0, 40.0 + dy), ("walk", 6, 3, 38.0, 41.5 + dy), ("idle", 1, 2, 34.5, 42.5 + dy)):
        spr, flip = SR.unit(units_dir, anim, f, k)
        st.put(spr, x, y, flip=flip)
    gy_mid = (FALL[0] + FALL[1]) / 2 * 2.0 - Y0 * 2.0
    walls = [(SR.piece(f"edge_{'A' if style == 'C' else style}{k}_d", "neutral"), SR.at(EDGE_M, gy_mid + 16.0 * (k - 1), n))
             for k in (-1, 0, 1, 2, 3)]                       # three 16 m stretches, each at its own middle
    lip_a = SR.at(EDGE_M - 0.25, (FALL[0] - Y0) * 2.0 + 0.4, n)
    lip_b = SR.at(EDGE_M - 0.25, (FALL[1] - Y0) * 2.0 - 0.4, n)
    isles = []
    if style == "C":
        mx_, my_ = (lip_a[0] + lip_b[0]) / 2, (lip_a[1] + lip_b[1]) / 2
        for k, (dx, dy) in enumerate(((-620, 430), (-900, 250), (-380, 610))):     # in the screen's lower left
            isles.append((SR.piece(f"isle_{k}_d", "neutral"), (mx_ + dx, my_ + dy), 0.0))
    return dict(n=n, ground=ground, water=water, stage=st, walls=walls, wall_at=SR.at(EDGE_M, gy_mid, n),
                lip=(lip_a, lip_b), isles=isles, size=ground.size)


def _static(L):
    """The layers that do not move, once: the islands' hazed colours, the wall stretches with their fade, the water mask."""
    if "static" in L:
        return L["static"]
    isles = []
    for (spr, sh), (X, Y), sink in L["isles"]:
        im, ax, ay = spr
        k_ = 0.42                                        # far off: smaller (R11 r0: as big as the map's own trees)
        im = im.resize((max(1, int(im.width * k_)), max(1, int(im.height * k_))), Image.LANCZOS)
        ax, ay = ax * k_, ay * k_
        a = np.asarray(im, np.float32) / 255.0
        c = R.to_lin(a[..., :3]) * 0.7 + np.array([0.55, 0.62, 0.72]) * 0.3            # a little haze
        yy_ = np.arange(a.shape[0], dtype=np.float32)[:, None] / a.shape[0]
        a[..., 3] *= 1 - 0.85 * np.clip((yy_ - 0.55) / 0.45, 0, 1)                      # the rock foot lost in mist
        isles.append((c, a[..., 3] * 0.95, int(X - ax), int(Y + sink * 0.866 * PPM - ay), X))
    (ax_, ay_), (bx_, by_) = L["lip"]
    slope = (by_ - ay_) / (bx_ - ax_)
    walls = []
    for ((wim, wax, way), _), (WX, WY) in L["walls"]:
        wc, wa = _from8(wim)
        x0, y0 = int(round(WX - wax)), int(round(WY - way))
        hh, ww = wa.shape
        yy, xx = np.mgrid[0:hh, 0:ww].astype(np.float32)
        dep = (yy + y0 - (WY + (xx + x0 - WX) * slope)) / (0.866 * PPM)
        walls.append((wc, wa * G.smoothstep(WALL_H * 0.95, WALL_H * 0.4, dep), x0, y0))
    wimg = Image.fromarray((np.clip(L["water"], 0, 1) * 255).astype(np.uint8), "L").rotate(45, expand=True)
    wm = wimg.resize((wimg.width, wimg.height // 2), Image.BILINEAR)
    L["static"] = dict(isles=isles, walls=walls, wm=wm)
    return L["static"]


def frame(L, phase, pan=0.0, box=None):
    """One picture of the scene at the loop's phase 0..1 (RGBA), of box (x0, y0, x1, y1) of the turned window (all of it
    if None). pan: the camera moved this many pixels to the right: the map, the wall and the waterfall move by all of
    it (the caller moves box by pan), the sea of clouds by 0.2-0.35 of it."""
    if box is None:
        box = (0, 0) + tuple(L["size"])
    ox, oy = box[0], box[1]
    w, h = box[2] - box[0], box[3] - box[1]
    S = _static(L)
    col = clouds(w, h, phase, pan, ox, oy)
    for c, al, x0, y0, X in S["isles"]:                     # far islands in the haze, bobbing a little
        bob = int(round(3.0 * math.sin(2 * math.pi * phase + X * 0.01)))
        _blit(col, c, al, x0 - ox, y0 - oy + bob)
    for wc, wa, x0, y0 in S["walls"]:                       # the wall, fading into the clouds
        _blit(col, wc, wa, x0 - ox, y0 - oy)
    fc, fa, mist = waterfall(L["lip"][0], L["lip"][1], w, h, phase, ox=ox, oy=oy)
    col = _over(col, fc, fa)
    col = _over(col, np.array([0.85, 0.88, 0.92]), mist * 0.85)
    gc, ga = _from8(L["ground"].crop(box))                  # the ground and what stands on it
    col = _over(col, gc, ga)
    img = Image.fromarray((np.clip(R.to_srgb(col), 0, 1) * 255).round().astype(np.uint8), "RGB").convert("RGBA")
    wm = np.asarray(S["wm"].crop(box), np.float32) / 255.0
    st = L["stage"]
    items = [(f, im, (xy[0] - ox, xy[1] - oy)) for f, im, xy in st.items]
    shadows = [(im, (xy[0] - ox, xy[1] - oy)) for im, xy in st.shadows]
    refl = [(im, (xy[0] - ox, xy[1] - oy)) for im, xy in st.refl]
    img = S9.screen_layers(img, items, shadows, wm, refl)
    # the client's top layer: a few clouds passing over the map, each drifting in and out over the loop (seamless)
    a = np.asarray(img, np.float32) / 255.0
    col = R.to_lin(a[..., :3])
    (ax_, ay_), _ = L["lip"]
    for k, (pc, pa) in enumerate(PUFFS):
        t = (phase + k / len(PUFFS)) % 1.0
        fade = math.sin(math.pi * t) ** 2
        _blit(col, pc, pa * fade * 0.85, int(ax_ - 900 + k * 520 + 260 * t) - ox, int(ay_ + 160 + k * 170 - 60 * t) - oy)
    return Image.fromarray((np.clip(R.to_srgb(col), 0, 1) * 255).round().astype(np.uint8), "RGB").convert("RGBA")


def _blit(col, c, a, x0, y0):
    """c (linear RGB [h, w, 3]) with alpha a over col at (x0, y0), cut to col's edges."""
    H, W = col.shape[:2]
    h, w = a.shape
    l, t = max(0, -x0), max(0, -y0)
    r, b = min(w, W - x0), min(h, H - y0)
    if r <= l or b <= t:
        return
    sub = col[y0 + t:y0 + b, x0 + l:x0 + r]
    aa = a[t:b, l:r, None]
    col[y0 + t:y0 + b, x0 + l:x0 + r] = sub * (1 - aa) + c[t:b, l:r] * aa


def crop_box(L, w=SR.SCREEN[0], h=SR.SCREEN[1]):
    """The phone screen around the waterfall: the fall a little left of the middle, the map to the upper right."""
    (ax_, ay_), (bx_, by_) = L["lip"]
    cx, cy = (ax_ + bx_) / 2 + 180, (ay_ + by_) / 2 + 120
    return int(cx - w // 2), int(cy - h // 2), int(cx - w // 2) + w, int(cy - h // 2) + h


def _size(b):
    return f"{b / 1e6:.2f} MB" if b >= 1e5 else f"{b / 1e3:.0f} KB"


def cost(L, box, out, frames=FRAMES):
    """What the moving parts cost, as drawn here (3x): (a) tiles moved over time, (b) frame-by-frame pictures."""
    cloud = CLOUD_TILE.size                     # one A8 tile, both sea layers and the mist sample it
    fall = FALL_TILE.size
    puffs = sum(a.size for _, a in PUFFS)       # RGBA sprites: 4 bytes a pixel, ASTC 4x4 1 byte
    (ax_, ay_), (bx_, by_) = L["lip"]
    fall_px = int((abs(bx_ - ax_) + 80) * (abs(by_ - ay_) + WALL_H * 0.866 * PPM + 60))
    ga = np.asarray(L["ground"].crop(box), np.float32)[..., 3] / 255.0
    sea_px = 2 * CLOUD_TILE.size                # a flipbook of each sea layer's tile
    a_total = cloud + fall + puffs              # A8 tiles + ASTC sprites
    b_rgba = frames * (fall_px + sea_px) * 4
    b_astc = frames * (fall_px + sea_px)
    c = dict(cloud_tile=f"512×512 {_size(cloud)}", fall_tile=f"256×256 {_size(fall)}", puffs_n=len(PUFFS),
             puffs_rgba=_size(puffs * 4), puffs_astc=_size(puffs), a_total=_size(a_total),
             void_share=f"{(1 - ga).mean() * 100:.0f}%", fps=FPS, frames=frames,
             fall_flip_rgba=_size(frames * fall_px * 4), fall_flip_astc=_size(frames * fall_px),
             sea_flip_rgba=_size(frames * sea_px * 4), sea_flip_astc=_size(frames * sea_px),
             b_total=f"{_size(b_rgba)} RGBA8／{_size(b_astc)} ASTC",
             note="(a) A8 tiles + ASTC sprites; (b) frames x (the waterfall's box + two 512 px sea tiles)")
    (out / "cost.json").write_text(json.dumps(c, ensure_ascii=False, indent=1))
    return c


def main(art, gridp, out, style, units_dir, frames=FRAMES):
    out.mkdir(parents=True, exist_ok=True)
    L = build(art, gridp, style, units_dir)
    box = crop_box(L)
    cost(L, box, out, frames)
    still = frame(L, 0.0, 0.0, box).convert("RGB")
    still.save(out / f"edge_{style}.png")
    gif = []
    gb = (box[0] + 500, box[1] + 140, box[0] + 500 + 1080, box[1] + 140 + 810)   # a 3x crop round the fall, shown at 2/3
    for k in range(frames):
        pan = 60.0 * math.sin(2 * math.pi * k / frames)               # the camera drifting right and back: parallax
        box_k = (gb[0] + int(pan), gb[1], gb[2] + int(pan), gb[3])
        im = frame(L, k / frames, pan, box_k).convert("RGB").resize((600, 450), Image.LANCZOS)
        gif.append(im)
    pal = gif[0].quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    q = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in gif]
    q[0].save(out / f"edge_{style}.gif", save_all=True, append_images=q[1:], duration=int(1000 / FPS), loop=0, optimize=True)
    return still


if __name__ == "__main__":
    a = sys.argv
    main(Path(a[1]), a[2], Path(a[3]), a[4], a[5], int(a[6]) if len(a) > 6 else FRAMES)
    print("ok", a[4])
