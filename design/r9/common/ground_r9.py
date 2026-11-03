"""R9 (the user 2026-11-01: 「你的畫風不能跟它一樣真實嗎」, after github.com/Leonxlnx/napali): the ground and the water
drawn the way napali draws its coast, for the game's camera (D-088, 30 degrees down, square to the grid) and its sun.

What napali does that the art-v6 ground does not (napali tools/v3_geo.glsl, v3_shade.glsl, v4_water.glsl, read, not
copied):
- a height field with erosion on it, lit by one sun with soft shadows, sky light and ambient occlusion;
- water coloured by its depth over the bed (absorption), the sky reflected by Fresnel on rippled water, sun glints,
  wet ground and foam where water meets land;
- a filmic tone curve over the whole picture.

Here everything stays something the client's ground shader can do on the phone, over any random map:
- `relief_tile()`: ONE tileable relief map (16 m, the same at every place of every map): a periodic height field
  (FFT noise) worn by particle erosion with wrap-around, lit by the game's sun (soft shadows marched across the
  height field, sky light, occlusion). RGB = (light, rill, crown): the light multiplies the art-v6 layers, the rills
  darken and bare the soil, the crowns dry the grass. The shader samples it twice, the second turned and moved (as the
  art-v6 layers already are), so it never repeats on screen.
- `compose()`: the art-v6 layers and weights exactly as ground_r8.compose (the client's ground today), then the relief,
  the banks, the water (depth colour, ripples, Fresnel sky, glints, foam, wet shore) and the grade. Every step reads
  only the position, the weight map's water distance and tileable noise: a shader can do the same per pixel.

python3 design/r9/common/ground_r9.py tile OUT_DIR     the relief map at 3x and 2x (the memory it takes)
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "r8" / "common"))
import ground_r8 as G   # noqa: E402

TILE_M = 16.0
# the game's sun (round2/blender/lib.py make_lights: rotation (32, 0, 180 + az + 45) degrees, az 0 on the square camera):
# toward the sun in the ground's axes (x east, y south = down the picture, z up): west-north, 58 degrees up
SUN = np.array([-0.375, -0.375, 0.848])
SUN /= np.linalg.norm(SUN)
SKY = np.array([0.55, 0.66, 0.85])          # linear, the fill from the sky dome
# the camera to the ground (x east, y south, z up): north and 30 degrees down on the square camera (D-088)
VIEW = np.array([0.0, -math.cos(math.radians(30)), -math.sin(math.radians(30))])
# R9-06 乙 (the diamond camera, art-v2 and before): the camera turned 45 degrees and the sun with it (lib.make_lights
# turns the sun with CAM_AZ), so in the ground's own axes the sun stands due north and the camera looks north-east
SUN_D = np.array([0.0, -0.53, 0.848]) / np.linalg.norm([0.0, -0.53, 0.848])
VIEW_D = np.array([math.sin(math.radians(45)) * math.cos(math.radians(30)), -math.cos(math.radians(45)) * math.cos(math.radians(30)),
                   -math.sin(math.radians(30))])
SUN_RGB = np.array([1.0, 0.95, 0.88])       # R7's sun (look.lights)


# ---------------------------------------------------------------- periodic tools

def fbm(n, beta, seed):
    """Periodic noise n x n with a 1/f^beta spectrum (zero mean, unit deviation)."""
    rng = np.random.default_rng(seed)
    F = np.fft.fft2(rng.standard_normal((n, n)))
    f = np.hypot(np.fft.fftfreq(n)[None, :], np.fft.fftfreq(n)[:, None])
    f[0, 0] = 1.0
    amp = f ** (-beta / 2.0)
    amp[0, 0] = 0.0
    h = np.real(np.fft.ifft2(F * amp))
    return (h - h.mean()) / h.std()


def blur(a, sigma):
    """Periodic Gaussian blur, sigma in samples."""
    n, m = a.shape
    fy, fx = np.fft.fftfreq(n)[:, None], np.fft.fftfreq(m)[None, :]
    k = np.exp(-2 * (math.pi * sigma) ** 2 * (fx ** 2 + fy ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * k))


def upsample(a, size):
    """Periodic bicubic resampling: the tile laid 3 x 3, resized, the middle cut out (still tileable; an FFT resample
    rang round the eroded channels)."""
    n = a.shape[0]
    big = Image.fromarray(np.tile(a, (3, 3)).astype(np.float32), "F").resize((3 * size, 3 * size), Image.BICUBIC)
    return np.asarray(big, np.float32)[size:2 * size, size:2 * size].astype(np.float64)


def bilinear(h, x, y):
    """h at (x, y) (sample units, wrapped) and its gradient."""
    n = h.shape[0]
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = x - x0, y - y0
    x0 %= n
    y0 %= n
    x1, y1 = (x0 + 1) % n, (y0 + 1) % n
    a, b, c, d = h[y0, x0], h[y0, x1], h[y1, x0], h[y1, x1]
    v = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy
    gx = (b - a) * (1 - fy) + (d - c) * fy
    gy = (c - a) * (1 - fx) + (d - b) * fx
    return v, gx, gy, (x0, y0, x1, y1, fx, fy)


def erode(h, drops=60_000, seed=3, steps=48, batch=600, inertia=0.08, capacity=3.0, min_slope=0.01, deposit=0.25,
          erosion=0.35, evaporate=0.025, gravity=4.0):
    """Particle hydraulic erosion (droplets carving and dropping sediment) on a periodic grid; heights in samples.
    Returns the worn height and where the water ran (the summed water of every step)."""
    h = h.copy()
    n = h.shape[0]
    flow = np.zeros_like(h)
    delta = np.zeros_like(h)
    rng = np.random.default_rng(seed)
    # droplets run in small batches (a few hundred on 16k samples): two in one place at once would each take the whole
    # drop of that place, and the pit would run away. Each step's change is also capped per sample.

    def put(idx, amount):
        x0, y0, x1, y1, fx, fy = idx
        for (yy, xx, w) in ((y0, x0, (1 - fx) * (1 - fy)), (y0, x1, fx * (1 - fy)), (y1, x0, (1 - fx) * fy), (y1, x1, fx * fy)):
            np.add.at(delta, (yy, xx), amount * w)

    # erosion takes from a small round brush (radius 2 samples), not one point: no pits, no spikes
    offs = [(ox, oy, max(0.0, 2.0 - math.hypot(ox, oy))) for ox in range(-2, 3) for oy in range(-2, 3)]
    offs = [(ox, oy, w) for ox, oy, w in offs if w > 0]
    tot = sum(w for _, _, w in offs)

    def take_from(px, py, amount):
        cx, cy = np.round(px).astype(int), np.round(py).astype(int)
        for ox, oy, w in offs:
            np.add.at(delta, ((cy + oy) % n, (cx + ox) % n), -amount * w / tot)

    for _ in range(drops // batch):
        px, py = rng.random(batch) * n, rng.random(batch) * n
        dx, dy = np.zeros(batch), np.zeros(batch)
        vel, water, sed = np.ones(batch), np.ones(batch), np.zeros(batch)
        for _s in range(steps):
            hh, gx, gy, idx = bilinear(h, px, py)
            dx = dx * inertia - gx * (1 - inertia)
            dy = dy * inertia - gy * (1 - inertia)
            ln = np.hypot(dx, dy)
            still = ln < 1e-9
            ln[still] = 1.0
            dx, dy = dx / ln, dy / ln
            nx, ny = px + dx, py + dy
            hn = bilinear(h, nx, ny)[0]
            dh = hn - hh
            cap = np.maximum(-dh * vel * water * capacity, min_slope)
            up = dh > 0
            drop = np.where(up, np.minimum(dh, sed), np.where(sed > cap, (sed - cap) * deposit, 0.0))
            take = np.where(~up & (sed <= cap), np.minimum((cap - sed) * erosion, -dh * 0.5), 0.0)
            take = np.where(still, 0.0, take)
            delta[:] = 0.0
            put(idx, drop)
            take_from(px, py, take)
            h += np.clip(delta, -0.25, 0.25)
            sed = sed - drop + take
            vel = np.minimum(np.sqrt(np.maximum(vel ** 2 + dh * gravity, 0.0)), 4.0)
            water *= 1 - evaporate
            np.add.at(flow, (idx[1], idx[0]), water)
            px, py = nx % n, ny % n
    return h, flow


# ---------------------------------------------------------------- the relief tile

def tussocks(size, ppm, seed, count=900, r=(0.16, 0.38), hgt=(0.04, 0.11)):
    """Periodic grass clumps: round bumps of random size and height scattered over the tile (metres)."""
    rng = np.random.default_rng(seed)
    out = np.zeros((size, size))
    k = int(3 * r[1] * ppm)
    yy, xx = np.mgrid[-k:k + 1, -k:k + 1] / ppm
    for _ in range(count):
        cx, cy = rng.integers(0, size, 2)
        rr, hh = rng.uniform(*r), rng.uniform(*hgt)
        bump = hh * np.exp(-(xx ** 2 + yy ** 2) / (2 * (rr / 1.8) ** 2))
        ys = (np.arange(cy - k, cy + k + 1)) % size
        xs = (np.arange(cx - k, cx + k + 1)) % size
        out[np.ix_(ys, xs)] = np.maximum(out[np.ix_(ys, xs)], bump)
    return out


def relief_tile(ppm=60, seed=11, sim_per_m=8, relief_m=0.16, rill_m=0.05, sun=SUN):
    """The tileable relief map (TILE_M square) at ppm: RGB float (light, rill, crown) and the height (m)."""
    n = int(TILE_M * sim_per_m)
    # mounds and hummocks; eroded with a steep relief (so the water carves branching rills), then flattened back to
    # the ground's real relief_m for the light
    h0 = (0.7 * fbm(n, 3.2, seed) + 0.3 * fbm(n, 2.4, seed + 1)) * 10.0
    h, _flow = erode(h0, seed=seed)
    h = blur(h, 1.2)                                                 # soft swales, not cracks (judge r1: 「鉛筆刮痕」)
    carve = blur(np.clip(h0 - h, 0, None), 1.0)
    carve = carve / np.percentile(carve, 99.0)
    size = int(TILE_M * ppm)
    H = upsample((h - h.mean()) / h.std() * relief_m, size)          # metres
    H += rill_m * 0.08 * fbm(size, 2.2, seed + 2)                    # fine grain under the tufts
    H += tussocks(size, ppm, seed + 3)                                # grass clumps, 0.3-0.8 m, lit on the sun's side
    F = np.clip(upsample(carve, size), 0, None)
    dx = 1.0 / ppm
    hx = (np.roll(H, -1, 1) - np.roll(H, 1, 1)) / (2 * dx)
    hy = (np.roll(H, -1, 0) - np.roll(H, 1, 0)) / (2 * dx)
    N = np.stack([-hx, -hy, np.ones_like(H)], -1)
    N /= np.linalg.norm(N, axis=-1, keepdims=True)
    lam = np.clip(N @ sun, 0, None)
    # soft shadows: march toward the sun across the height field (napali: min over the ray of k * clearance / distance)
    hz = math.hypot(sun[0], sun[1])
    tan_e = sun[2] / hz
    ux, uy = sun[0] / hz, sun[1] / hz
    vis = np.ones_like(H)
    for k in range(1, int(1.2 * ppm)):                               # up to 1.2 m toward the sun
        sx, sy = int(round(-ux * k)), int(round(-uy * k))
        dist = math.hypot(sx, sy) / ppm
        ahead = np.roll(np.roll(H, sy, 0), sx, 1)                    # H a step nearer the sun
        clear = H + dist * tan_e - ahead
        vis = np.minimum(vis, np.clip(6.0 * clear / dist + 0.5, 0, 1))
    ao = 1.0 - np.clip((blur(H, 0.15 * ppm) - H) * 6.0 + (blur(H, 0.6 * ppm) - H) * 2.0, 0, 0.6)
    sky = 0.5 + 0.5 * N[..., 2]
    sun_w, sky_w = 3.0, 0.9                                          # the R7 rig's balance (sun 4.2, world 0.38, fill 0.7)
    flat = sun_w * sun[2] + sky_w
    light = (sun_w * lam * vis + sky_w * sky * ao) / flat
    valley = blur(H, 0.25 * ppm) - H                                 # the eroded channels: narrow concave lines
    rill = np.clip((valley - 0.004) / 0.012, 0, 1) * np.clip(F * 1.5, 0.3, 1)
    crown = np.clip((H - blur(H, 1.0 * ppm)) / 0.06, 0, 1)
    return np.stack([light, rill, crown], -1).astype(np.float32), H.astype(np.float32)


def save_tile(tile, out):
    """RGB 8 bit: light 0..2 as 0..255, rill and crown 0..1."""
    a = np.stack([np.clip(tile[..., 0] / 2.0, 0, 1), tile[..., 1], tile[..., 2]], -1)
    Image.fromarray((a * 255).round().astype(np.uint8), "RGB").save(out)


def load_tile(path):
    a = np.asarray(Image.open(path).convert("RGB"), np.float32) / 255.0
    return np.stack([a[..., 0] * 2.0, a[..., 1], a[..., 2]], -1)


# ---------------------------------------------------------------- colour helpers

def to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def aces(x):
    """Narkowicz's fit of the ACES film curve (napali's grade), with an exposure that keeps flat grass where it was."""
    a, b, c, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
    return np.clip(x * (a * x + b) / (x * (c * x + d) + e), 0, 1)


def tsample(tile, mx, my, tile_m=TILE_M):
    """A tileable map at metres, twice (the second turned 37 degrees and moved), mixed by noise: no repeat."""
    a = G.sample(tile, mx / tile_m, my / tile_m)
    rx = (0.8 * mx + 0.6 * my) + 23.7
    ry = (-0.6 * mx + 0.8 * my) + 9.1
    b = G.sample(tile, rx / tile_m, ry / tile_m)
    k = G.smoothstep(0.25, 0.75, G.sample(G.value_noise(128, 8, 5)[..., None], mx / 40.0, my / 40.0))
    return a * (1 - k) + b * k


# ---------------------------------------------------------------- the ground and the water

R9 = dict(
    rill_soil=0.12,          # how far a rill bares the soil (toward the dirt layer, darker: wet)
    crown_dry=0.2,           # how far the crowns dry the grass
    lush_m=6.0,              # greener grass this close to the water
    bank_m=1.0, bank_h=0.35,  # the bank: from this far out the land falls this much into the water
    wet_m=0.9,               # wet ground above the waterline
    shore_m=(1.0, 0.12),      # how far the shoreline wanders off the cells' edge: long bays, small bites (metres)
    edge_depth=0.12,         # a cut bank: the water is already this deep at the line (no grey feather of bed)
    depth_k=0.45, depth_max=1.4, ford_depth=0.2,
    absorb=(1.1, 0.8, 1.0),          # per metre (linear): a lowland river, blue-green, red goes first
    scatter=(0.012, 0.022, 0.024),   # the colour deep water scatters back (linear)
    bed=(0.07, 0.058, 0.035),         # the shallows' bed: olive-brown silt and gravel, seen through the water
    sky_lo=(0.55, 0.66, 0.82), sky_hi=(0.30, 0.46, 0.80), sky_k=2.2,     # Fresnel x sky_k: the sky's tint on the water
    foam=0.5, glint=1.8, exposure=0.95, swath=0.07,
)
LAST_WATER = None
_NZ = G.value_noise(256, 16, 1)[..., None]
_SHORE = G.value_noise(128, 8, 21)[..., None]
RIP_M = 4.0


def _ripple_tex(n=512, seed=9):
    """A tileable ripple field (RIP_M square) and its slopes per metre: (h, dh/dx, dh/dy). FFT noise, round (the camera
    squeezes it about 2:1 on screen; R9 r4: squeezed along the current it read as smeared streaks, and turned with the
    current it swirled at bends), slopes taken once here (value noise's lattice showed through its finite differences)."""
    rng = np.random.default_rng(seed)
    F = np.fft.fft2(rng.standard_normal((n, n)))
    ku = np.fft.fftfreq(n)[None, :] * n / RIP_M          # cycles a metre
    kv = np.fft.fftfreq(n)[:, None] * n / RIP_M
    k = np.hypot(ku, kv)                                 # round: the camera squeezes it ~2:1 on screen (R9 r4: still
    amp = np.exp(-(k / 11.0) ** 2) * np.clip(k, 0.25, None) ** -1.0  # 5:1 and soft at 1.5 / 7); fine and sharp at 3x
    amp[0, 0] = 0.0
    h = np.real(np.fft.ifft2(F * amp))
    h = (h - h.mean()) / h.std()
    dpm = n / RIP_M
    du = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / 2 * dpm
    dv = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / 2 * dpm
    return np.stack([h, du, dv], -1).astype(np.float32)


_RIPT = _ripple_tex()
_FOAM = G.value_noise(256, 24, 13)[..., None]


def compose(grid, nodes, layers, relief, ppm=60, rules=None, p=R9, t=0.0, town=None, strip=240, sun=SUN, view=VIEW):
    """The ground top-down (sRGB 0..1) at ppm, as the R9 shader would draw it (in strips of rows: every step reads only
    its own pixel, its neighbours by sampling the same functions a little to the side)."""
    rules = rules or G.RULES
    nowater = {k: v for k, v in layers.items() if k != "water"}
    n = grid.shape[0]
    size = n * G.CELL_M
    px = int(size * ppm)
    wmap = G.weights(grid, nodes, rules)
    # the current's direction: across the slope of the water distance, smoothed over metres (a direction that varies from
    # pixel to pixel warps the wavelets into marbling)
    k = wmap.shape[0] / n                                       # texels a cell
    wsm = G.blur(wmap[..., 3], 1.5 * k)
    cgx = (np.roll(wsm, -1, 1) - np.roll(wsm, 1, 1)) / 2
    cgy = (np.roll(wsm, -1, 0) - np.roll(wsm, 1, 0)) / 2
    flowmap = np.stack([-cgy, cgx], -1).astype(np.float32)
    fordm = (grid == 4).astype(np.float32)[..., None]
    fordb = G.blur(np.kron(fordm[..., 0], np.ones((4, 4))), 1.2)[..., None]       # the ford's cells, soft (4 texels a cell)
    # the bridges' cells: the shoreline keeps still by them, so a bridge lands on its banks (R9 r7)
    brm = np.isin(grid, (5, 6)).astype(np.float32)
    brb = G.blur(np.kron(brm, np.ones((4, 4))), 3.0)[..., None]
    wa = rules["water"]
    out = np.zeros((px, px, 3), np.float32)
    global LAST_WATER
    LAST_WATER = np.zeros((px, px), np.float32)             # where the water is (for the scene: reflections)
    m = (np.arange(px) + 0.5) / ppm

    def sd_at(mx, my):
        """Metres into the water (+) or out of it (-): the weight map's distance, then the shoreline made to wander."""
        w = G.sample(wmap, mx / size, my / size)[..., 3]
        nz = G.sample(_NZ, mx / 6.0, my / 6.0)[..., 0]
        sd = (w - 0.5) * 2 * wa["range_m"] + (nz - 0.5) * 2 * wa["noise_m"]
        sd = np.maximum(sd, (G.sample(fordb, mx / size, my / size)[..., 0] - 0.5) * 4.0)   # a ford is water too, shallow
        big = G.sample(_SHORE, mx / 40.0, my / 40.0)[..., 0]                 # 5 m lattice: long bays
        mid = G.sample(_SHORE, mx / 17.0 + 0.41, my / 17.0 + 0.13)[..., 0]   # 2 m: the bays broken up (not a sine)
        small = G.sample(_SHORE, mx / 8.0 + 0.3, my / 8.0 + 0.7)[..., 0]     # 1 m: bites
        brv = np.clip(G.sample(brb, mx / size, my / size)[..., 0] * 2.0, 0, 1)
        keep = 1 - 0.9 * brv
        return sd - 0.9 * brv + keep * ((big - 0.5) * 2 * p["shore_m"][0] + (mid - 0.5) * p["shore_m"][0]
                            + (small - 0.5) * 2 * p["shore_m"][1])

    for r0 in range(0, px, strip):
        r1 = min(px, r0 + strip)
        base = G.compose(grid, nodes, nowater, ppm=ppm, rules=rules, grade=dict(brightness=1.0, saturation=1.0), town=town,
                         rows=(r0, r1))
        mx, my = np.meshgrid(m, m[r0:r1])
        e = 0.5 / ppm
        sd = sd_at(mx, my)
        gx = (sd_at(mx + e, my) - sd_at(mx - e, my)) / (2 * e)
        gy = (sd_at(mx, my + e) - sd_at(mx, my - e)) / (2 * e)
        fz = G.sample(_SHORE, mx / 8.0 + 0.6, my / 8.0 + 0.2)[..., 0]
        ford = G.smoothstep(0.35, 0.65, G.sample(fordb, mx / size, my / size)[..., 0] + (fz - 0.5) * 0.5)   # ragged, not the cells

        col = to_lin(base)
        Rr = tsample(relief, mx, my)
        light, rill, crown = Rr[..., 0], Rr[..., 1], Rr[..., 2]
        land = G.smoothstep(0.3, -0.6, sd)
        soil = to_lin(G.sample(layers["dirt"]["img"], mx / layers["dirt"]["tile_m"], my / layers["dirt"]["tile_m"])[..., :3]) * 0.7
        k = (p["rill_soil"] * rill * land)[..., None]
        col = col * (1 - k) + soil * k
        lum = col.mean(-1, keepdims=True)
        col = col + (lum * np.array([1.25, 1.1, 0.7]) - col) * (p["crown_dry"] * crown * land)[..., None]
        near = G.smoothstep(-p["lush_m"], -1.5, sd) * land
        col = col * (1 + np.array([-0.08, 0.05, -0.1]) * near[..., None])
        # wind swaths: long soft patches of lighter (flattened, sheen) and darker grass, all drawn out one way
        sw = G.sample(_SHORE, (0.94 * mx + 0.34 * my) / 30.0, (-0.34 * mx + 0.94 * my) / 9.0)[..., 0]
        col = col * (1 + p["swath"] * (sw - 0.5) * 2 * land)[..., None]
        # the banks: the land falls into the channel. The far bank (water to the south of it) turns its earth face to
        # the camera; the near bank shows only a grass lip over the water.
        g = np.hypot(gx, gy) + 1e-6
        far = np.clip(-(gx * view[0] + gy * view[1]) / (g * math.hypot(view[0], view[1])), 0, 1)   # the water lies toward the camera
        tb = np.clip((sd + p["bank_m"]) / p["bank_m"], 0, 1)
        kb = p["bank_h"] * 6 * tb * (1 - tb) / p["bank_m"] * (sd < 0.3)
        nb = np.stack([kb * gx, kb * gy, np.ones_like(sd)], -1)
        nb /= np.linalg.norm(nb, axis=-1, keepdims=True)
        light = light * (3.0 * np.clip(nb @ sun, 0, None) + 0.9 * (0.5 + 0.5 * nb[..., 2])) / (3.0 * sun[2] + 0.9)
        earth = to_lin(G.sample(layers["bank"]["img"], mx / layers["bank"]["tile_m"], my / layers["bank"]["tile_m"])[..., :3])
        # the far bank's earth face: its height varies along the bank, a crisp sunlit grass edge on top, the face itself in
        # shade (the sun is behind it), streaked down (R9 r7: a soft brown smudge, no height)
        # its height from nothing (grass and slumps reach the water) to ~30 px, in long stretches (R9 r9: 16-24 px all along)
        # (R11: no small bumps on it: a domed top read as a dirt pile on the grass)
        fw = 1.1 * G.smoothstep(0.3, 0.75, G.sample(_SHORE, mx / 22.0 + 0.7, my / 22.0 + 0.4)[..., 0])
        face = G.smoothstep(-fw - 0.03, -fw + 0.03, sd) * G.smoothstep(0.1, -0.05, sd) * far
        tuft = G.sample(_FOAM, mx / 3.0 + 0.5, my / 3.0)[..., 0]
        face = face * (1 - G.smoothstep(0.58, 0.68, tuft) * G.smoothstep(-fw + 0.4, -fw, sd))   # tufts hang over its top
        streak = 0.75 + 0.5 * G.sample(_FOAM, mx / 0.6 + 0.2, my / 6.0 + 0.1)[..., 0]
        col = col * (1 - face[..., None] * 0.9) + earth * (0.72 * streak)[..., None] * face[..., None] * 0.9   # warm mid-brown (R11)
        edge = G.smoothstep(-fw - 0.1, -fw - 0.02, sd) * (1 - G.smoothstep(-fw - 0.02, -fw + 0.02, sd)) * far
        col = col * (1 + 0.18 * edge[..., None])
        col = col * light[..., None]
        wet = G.smoothstep(-p["wet_m"], -0.05, sd)[..., None]
        col = col * (1 - 0.35 * wet)
        # the waterline itself: a thin dark line of wet mud, a few pixels, broken where grass hangs over it
        # the wet line: continuous (R9 r6), its width 0-25 px (R9 r7: an even drawn outline), lighter sandy mud in places
        # a thin contact line (the near bank faces the sun: R9 r9, a dark rim read as ink), a little wider on the far bank
        mw = 0.03 + 0.06 * G.sample(_SHORE, mx / 6.0 + 0.35, my / 6.0 + 0.65)[..., 0] + 0.12 * far
        mud = G.smoothstep(-mw - 0.03, -mw, sd)
        col = col * (1 - ((0.3 - 0.1 * far) * mud)[..., None])          # R11: the far line was near-black (ink)
        grav = to_lin(G.sample(layers["gravel"]["img"], mx / layers["gravel"]["tile_m"], my / layers["gravel"]["tile_m"])[..., :3])
        sand = G.smoothstep(0.6, 0.7, G.sample(_SHORE, mx / 9.0 + 0.8, my / 9.0 + 0.25)[..., 0]) * \
            G.smoothstep(-0.7, -0.35, sd) * G.smoothstep(0.0, -0.1, sd) * (1 - far)
        col = col * (1 - 0.6 * sand[..., None]) + grav * 0.95 * (0.6 * sand)[..., None] * light[..., None]   # gravel, not a flat tan
        # gravel bars: a few pale patches on the shore, on one side more than the other
        bar = G.smoothstep(0.62, 0.72, G.sample(_SHORE, mx / 14.0 + 0.2, my / 14.0 + 0.6)[..., 0]) * \
            G.smoothstep(-0.7, -0.2, sd) * G.smoothstep(0.35, 0.0, sd) * (0.15 + 0.85 * far)   # few on the near bank (R9 r6)
        col = col * (1 - bar[..., None]) + grav * 0.85 * light[..., None] * bar[..., None]

        # the water: grass tufts hang over the line in places; the bars stand out of it
        tuft2 = G.sample(_SHORE, mx / 6.0 + 0.2, my / 6.0 + 0.9)[..., 0] * 0.6 + tuft * 0.4     # irregular, not every 30 px
        over = G.smoothstep(0.62, 0.7, tuft2) * G.smoothstep(0.3, 0.02, sd) * (1 - far)
        inside = G.smoothstep(-0.02, 0.04, sd) * (1 - over) * (1 - bar * G.smoothstep(0.3, 0.0, sd))
        depth = np.clip(p["edge_depth"] + sd * p["depth_k"], 0, p["depth_max"]) * (1 - ford) + np.clip(sd * p["depth_k"], 0, p["ford_depth"]) * ford
        # the far bank's shadow on the water below it (the sun is behind it), ~0.8 m wide
        ux, uy = sun[0] / np.hypot(sun[0], sun[1]), sun[1] / np.hypot(sun[0], sun[1])
        # (R9 r5: two samples drew two hard steps; five, weighted, fade it out over ~1 m along the bank's own outline)
        occ = sum(w * G.smoothstep(0.1, -0.2, sd_at(mx + ux * d, my + uy * d))
                  for d, w in ((0.2, 0.3), (0.4, 0.25), (0.6, 0.2), (0.85, 0.15), (1.1, 0.1)))
        shade = 1.0 - 0.55 * occ * inside
        lo = G.sample(_SHORE, mx / 5.0 + 0.4, my / 5.0 + 0.1)[..., 0]
        bed = np.array(p["bed"]) * (0.8 + 0.4 * lo)[..., None] * shade[..., None]
        bed = bed * (1 - ford[..., None]) + grav * 0.55 * ford[..., None]                 # a ford's stones show through
        pb = G.smoothstep(0.6, 0.08, sd) * (1 - far)                                      # sand and pebbles under the near
        bed = bed * (1 - 0.6 * pb[..., None]) + grav * 0.5 * (0.6 * pb)[..., None]        # bank's shallows (R9 r8)
        T = np.exp(-np.array(p["absorb"]) * depth[..., None] * 2.0)
        under = bed * T + np.array(p["scatter"]) * shade[..., None] * (1 - T)
        # the current runs along the channel: across the distance field's slope, steadied mid-stream (where the slope
        # vanishes) toward the channel's general run, so the wavelets keep one direction
        fv = G.sample(flowmap, mx / size, my / size)
        fx, fy = fv[..., 0], fv[..., 1]
        fl = np.hypot(fx, fy)
        fx, fy = np.where(fl > 1e-4, fx / (fl + 1e-9), 1.0), np.where(fl > 1e-4, fy / (fl + 1e-9), 0.0)
        u = mx * fx + my * fy
        v = -mx * fy + my * fx
        # the ripples are round now (R9 r4): sampled on the map's own axes, drifting with the current, never turned
        # with it (turning the coordinates where the river bends drew wood-grain swirls)
        rt = G.sample(_RIPT, (mx - 0.6 * t * fx) / RIP_M, (my - 0.6 * t * fy) / RIP_M)
        hx, hy = rt[..., 1], rt[..., 2]
        rough = (0.0042 + 0.0066 * ford)                 # the finer field has ~1.6x the slope: more sparkle (R9 r4)
        # current lanes: the ripples strong in long lanes along the flow, glassy between (R9 r9: the same everywhere)
        # (R11: they bend with the banks: shifted across the flow by the shoreline's own wander)
        wob = (G.sample(_SHORE, mx / 40.0, my / 40.0)[..., 0] - 0.5) * 2 * p["shore_m"][0]
        lx = G.sample(_SHORE, mx / 14.0 + 0.11, (my + wob) / 1.8 + 0.37)[..., 0]
        ly = G.sample(_SHORE, (mx + wob) / 1.8 + 0.53, my / 14.0 + 0.71)[..., 0]
        lane = G.smoothstep(0.3, 0.7, lx * fx ** 2 + ly * fy ** 2)
        rough = rough * (0.35 + 1.0 * lane * (1 - ford) + ford)
        Nw = np.stack([-hx * rough, -hy * rough, np.ones_like(hx)], -1)
        Nw /= np.linalg.norm(Nw, axis=-1, keepdims=True)
        dn = (Nw * view).sum(-1, keepdims=True)
        refl = view - 2 * dn * Nw
        cosv = np.clip(-dn[..., 0], 0, 1)
        fres = (0.02 + 0.98 * (1 - cosv) ** 5) * p["sky_k"]
        el = np.clip(refl[..., 2], 0, 1)[..., None]
        sky = np.array(p["sky_lo"]) * (1 - el) + np.array(p["sky_hi"]) * el
        # long soft bands along the current where the surface is smoother and holds the sky
        # long streaks along the current (R9 r8: round blotches read as noise): two fields drawn out along x and along y,
        # mixed by the current's direction (no turned coordinates, so no swirl at bends)
        bx = G.sample(_SHORE, mx / 16.0 + 0.3, my / 2.5 + 0.8)[..., 0]
        by = G.sample(_SHORE, mx / 2.5 + 0.6, my / 16.0 + 0.2)[..., 0]
        band = bx * fx ** 2 + by * fy ** 2
        sky = sky * (0.7 + 0.6 * band[..., None]) * (1 + 0.25 * (1 - lane))[..., None]   # glassy: more sky (R11)
        # the far bank and its grass reflected in the water just below it (the reflected ray runs north, into the bank)
        vx, vy = view[0] / math.hypot(view[0], view[1]), view[1] / math.hypot(view[0], view[1])
        # broken by the ripples (the mirror wobbles), fading over ~1.5 m: no ruler-straight band (R9 r5)
        jx, jy = hx * 0.012, hy * 0.012
        seen = sum(w * G.smoothstep(0.1, -0.3, sd_at(mx + vx * d + jx, my + vy * d + jy))
                   for d, w in ((0.3, 0.3), (0.6, 0.25), (0.9, 0.2), (1.2, 0.15), (1.5, 0.1)))
        sky = sky * (1 - 0.85 * seen[..., None]) + np.array([0.035, 0.045, 0.025]) * seen[..., None]
        gl = np.clip((refl * sun).sum(-1), 0, 1) ** 60
        spark = G.smoothstep(0.78, 0.86, G.sample(_FOAM, mx / 2.5 + 0.1, my / 1.5 + 0.3)[..., 0])
        # sparse near-white glints on the wavelets' crests, more toward the far side (the sun is ahead): the slopes
        # alone never tilt far enough to mirror a sun 58 degrees up (R9 r8: no glints at all)
        # many tiny points of varying brightness, where the ripples are strongest (R9 r9: white rice grains in rows)
        fine = G.sample(_FOAM, mx / 0.28 + 0.45, my / 0.2 + 0.15)[..., 0]
        crest = G.smoothstep(0.9, 0.98, fine) * G.smoothstep(0.8, 2.0, rt[..., 0]) * lane * G.smoothstep(0.3, 0.9, sd) * \
            (0.3 + 0.7 * G.sample(_FOAM, mx / 0.9 + 0.2, my / 0.7 + 0.6)[..., 0]) * (0.5 + 0.5 * far)
        surf = under * (1 - fres[..., None]) + sky * fres[..., None] + SUN_RGB * ((gl * spark + 1.0 * crest) * (1 - ford) * p["glint"])[..., None]
        mid = G.smoothstep(0.5, 1.6, sd)
        surf = surf * (1 - 0.22 * mid[..., None] * np.array([1.0, 0.94, 1.02]))         # the middle darker, greener (R11)
        # a ford: broken white riffle lines across the current, where the water runs over the stones
        fn = G.sample(_FOAM, (u - 0.4 * t) / 1.1, v / 5.0)[..., 0] * 0.7 + G.sample(_FOAM, u / 0.5 + 0.3, v / 2.0)[..., 0] * 0.3
        froth = np.clip(ford * G.smoothstep(0.56, 0.74, fn) * inside, 0, 1) * p["foam"] * 1.3
        surf = surf * (1 - froth[..., None]) + np.array([0.7, 0.72, 0.7]) * froth[..., None]
        # under the near bank's lip (the camera looks over it): the nearest water darker, no drawn line
        lip = (1 - far) * G.smoothstep(0.35, 0.0, sd)
        surf = surf * (1 - 0.3 * lip[..., None])
        # the last few decimetres before the near bank: the shallow bottom shows, olive-brown, not grey (R9 r4)
        # (R9 r6: a pale halo along the near bank; the shallows darker and browner, over ~0.9 m)
        # warm see-through shallows along both banks, widest on the near one (R9 r9: slate blue up to the edge)
        # R11: patchy, narrow, under the water (a 26-35 px brown feather all along read as an airbrushed halo)
        patch = G.smoothstep(0.35, 0.65, G.sample(_SHORE, mx / 5.0 + 0.27, my / 5.0 + 0.61)[..., 0])
        sh_k = G.smoothstep(0.3, 0.03, sd) * (1 - ford) * (0.25 + 0.75 * patch) * (0.5 + 0.5 * (1 - far))
        surf = surf * (1 - 0.6 * sh_k[..., None]) + np.array([0.075, 0.062, 0.032]) * (0.6 * sh_k)[..., None]
        col = col * (1 - inside[..., None]) + surf * inside[..., None]
        LAST_WATER[r0:r1] = inside
        outc = aces(col * p["exposure"])
        out[r0:r1] = np.clip(to_srgb(outc), 0, 1)
    return out


def camera(top):
    """Top-down (y down) to the game's camera: depth squashed to half (1 m across 20 pt, 1 m deep 10 pt)."""
    im = Image.fromarray((np.clip(top, 0, 1) * 255).round().astype(np.uint8), "RGB")
    return im.resize((im.width, im.height // 2), Image.LANCZOS)


if __name__ == "__main__":
    if sys.argv[1] == "tile":
        out = Path(sys.argv[2])
        out.mkdir(parents=True, exist_ok=True)
        info = {}
        for name, ppm, sun in (("x3", 60, SUN), ("x2", 40, SUN), ("x3_d", 60, SUN_D)):
            tile, H = relief_tile(ppm=ppm, sun=sun)
            save_tile(tile, out / f"relief_{name}.png")
            s = tile.shape[0]
            info[name] = dict(px=s, rgba8_bytes=s * s * 4, astc_4x4_bytes=s * s, png_bytes=(out / f"relief_{name}.png").stat().st_size)
            print(name, info[name])
        (out / "relief.json").write_text(json.dumps(info, indent=1))
