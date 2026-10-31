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


def relief_tile(ppm=60, seed=11, sim_per_m=8, relief_m=0.16, rill_m=0.05):
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
    lam = np.clip(N @ SUN, 0, None)
    # soft shadows: march toward the sun across the height field (napali: min over the ray of k * clearance / distance)
    tan_e = SUN[2] / math.hypot(SUN[0], SUN[1])
    vis = np.ones_like(H)
    for k in range(1, int(0.9 * ppm)):                               # up to 1.27 m along the diagonal
        dist = k * math.sqrt(2) / ppm
        ahead = np.roll(np.roll(H, k, 0), k, 1)                      # toward -x, -y (west, north)
        clear = H + dist * tan_e - ahead
        vis = np.minimum(vis, np.clip(6.0 * clear / dist + 0.5, 0, 1))
    ao = 1.0 - np.clip((blur(H, 0.15 * ppm) - H) * 6.0 + (blur(H, 0.6 * ppm) - H) * 2.0, 0, 0.6)
    sky = 0.5 + 0.5 * N[..., 2]
    sun_w, sky_w = 3.0, 0.9                                          # the R7 rig's balance (sun 4.2, world 0.38, fill 0.7)
    flat = sun_w * SUN[2] + sky_w
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
    shore_m=(0.8, 0.1),      # how far the shoreline wanders off the cells' edge: long bays, small bites (metres)
    depth_k=0.45, depth_max=1.4, ford_depth=0.2,
    absorb=(1.1, 0.8, 1.0),          # per metre (linear): a lowland river, blue-green, red goes first
    scatter=(0.012, 0.022, 0.024),   # the colour deep water scatters back (linear)
    bed=(0.11, 0.09, 0.055),         # the shallows' bed: olive-brown silt and gravel, seen through the water
    sky_lo=(0.55, 0.66, 0.82), sky_hi=(0.30, 0.46, 0.80), sky_k=2.2,     # Fresnel x sky_k: the sky's tint on the water
    foam=0.5, glint=1.0, exposure=0.95, swath=0.07,
)
_NZ = G.value_noise(256, 16, 1)[..., None]
_SHORE = G.value_noise(128, 8, 21)[..., None]
_RIP = G.value_noise(256, 32, 9)[..., None]
_FOAM = G.value_noise(256, 24, 13)[..., None]


def compose(grid, nodes, layers, relief, ppm=60, rules=None, p=R9, t=0.0, town=None, strip=240):
    """The ground top-down (sRGB 0..1) at ppm, as the R9 shader would draw it (in strips of rows: every step reads only
    its own pixel, its neighbours by sampling the same functions a little to the side)."""
    rules = rules or G.RULES
    nowater = {k: v for k, v in layers.items() if k != "water"}
    n = grid.shape[0]
    size = n * G.CELL_M
    px = int(size * ppm)
    wmap = G.weights(grid, nodes, rules)
    fordm = (grid == 4).astype(np.float32)[..., None]
    wa = rules["water"]
    out = np.zeros((px, px, 3), np.float32)
    m = (np.arange(px) + 0.5) / ppm

    def sd_at(mx, my):
        """Metres into the water (+) or out of it (-): the weight map's distance, then the shoreline made to wander."""
        w = G.sample(wmap, mx / size, my / size)[..., 3]
        nz = G.sample(_NZ, mx / 6.0, my / 6.0)[..., 0]
        sd = (w - 0.5) * 2 * wa["range_m"] + (nz - 0.5) * 2 * wa["noise_m"]
        big = G.sample(_SHORE, mx / 40.0, my / 40.0)[..., 0]                 # 5 m lattice: long bays
        small = G.sample(_SHORE, mx / 8.0 + 0.3, my / 8.0 + 0.7)[..., 0]     # 1 m: bites
        return sd + (big - 0.5) * 2 * p["shore_m"][0] + (small - 0.5) * 2 * p["shore_m"][1]

    def ripple(mx, my, fx, fy):
        u = mx * fx + my * fy
        v = -mx * fy + my * fx
        # wavelets drawn out along the current: 31 x 8 cm and 12 x 4 cm lattices (nothing below a few pixels)
        return (G.sample(_RIP, (u - 0.6 * t) / 10.0, v / 2.5)[..., 0] * 0.6
                + G.sample(_RIP, (u - 0.9 * t) / 4.0 + 0.37, v / 1.2 + 0.19)[..., 0] * 0.4), u, v

    for r0 in range(0, px, strip):
        r1 = min(px, r0 + strip)
        base = G.compose(grid, nodes, nowater, ppm=ppm, rules=rules, grade=dict(brightness=1.0, saturation=1.0), town=town,
                         rows=(r0, r1))
        mx, my = np.meshgrid(m, m[r0:r1])
        e = 0.5 / ppm
        sd = sd_at(mx, my)
        gx = (sd_at(mx + e, my) - sd_at(mx - e, my)) / (2 * e)
        gy = (sd_at(mx, my + e) - sd_at(mx, my - e)) / (2 * e)
        ford = G.smoothstep(0.2, 0.8, G.sample(fordm, mx / size, my / size)[..., 0])

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
        far = np.clip(gy / g, 0, 1)                                   # 1 where the water lies south (down the screen)
        tb = np.clip((sd + p["bank_m"]) / p["bank_m"], 0, 1)
        kb = p["bank_h"] * 6 * tb * (1 - tb) / p["bank_m"] * (sd < 0.3)
        nb = np.stack([kb * gx, kb * gy, np.ones_like(sd)], -1)
        nb /= np.linalg.norm(nb, axis=-1, keepdims=True)
        light = light * (3.0 * np.clip(nb @ SUN, 0, None) + 0.9 * (0.5 + 0.5 * nb[..., 2])) / (3.0 * SUN[2] + 0.9)
        earth = to_lin(G.sample(layers["bank"]["img"], mx / layers["bank"]["tile_m"], my / layers["bank"]["tile_m"])[..., :3])
        face = G.smoothstep(-0.9, -0.15, sd) * G.smoothstep(0.1, -0.05, sd) * far
        tuft = G.sample(_FOAM, mx / 3.0 + 0.5, my / 3.0)[..., 0]
        face = face * (1 - G.smoothstep(0.55, 0.7, tuft))              # grass hangs down over the earth here and there
        col = col * (1 - face[..., None] * 0.85) + earth * 0.8 * face[..., None] * 0.85
        col = col * light[..., None]
        wet = G.smoothstep(-p["wet_m"], -0.05, sd)[..., None]
        col = col * (1 - 0.35 * wet)
        # gravel bars: a few pale patches on the shore, on one side more than the other
        bar = G.smoothstep(0.62, 0.72, G.sample(_SHORE, mx / 14.0 + 0.2, my / 14.0 + 0.6)[..., 0]) * \
            G.smoothstep(-0.7, -0.2, sd) * G.smoothstep(0.35, 0.0, sd) * (1 - far * 0.7)
        grav = to_lin(G.sample(layers["gravel"]["img"], mx / layers["gravel"]["tile_m"], my / layers["gravel"]["tile_m"])[..., :3])
        col = col * (1 - bar[..., None]) + grav * 0.85 * light[..., None] * bar[..., None]

        # the water: grass tufts hang over the line in places; the bars stand out of it
        over = G.smoothstep(0.6, 0.72, tuft) * G.smoothstep(0.35, 0.05, sd) * (1 - far)
        inside = G.smoothstep(-0.04, 0.1, sd) * (1 - over) * (1 - bar * G.smoothstep(0.3, 0.0, sd))
        depth = np.clip(sd * p["depth_k"], 0, p["depth_max"]) * (1 - ford) + np.clip(sd * p["depth_k"], 0, p["ford_depth"]) * ford
        # the far bank's shadow on the water below it (the sun is behind it), ~0.8 m wide
        ux, uy = SUN[0] / np.hypot(SUN[0], SUN[1]), SUN[1] / np.hypot(SUN[0], SUN[1])
        shade = 1.0 - 0.5 * np.maximum(G.smoothstep(0.1, -0.2, sd_at(mx + ux * 0.5, my + uy * 0.5)),
                                       0.6 * G.smoothstep(0.1, -0.2, sd_at(mx + ux * 0.9, my + uy * 0.9))) * inside
        lo = G.sample(_SHORE, mx / 5.0 + 0.4, my / 5.0 + 0.1)[..., 0]
        bed = np.array(p["bed"]) * (0.8 + 0.4 * lo)[..., None] * shade[..., None]
        T = np.exp(-np.array(p["absorb"]) * depth[..., None] * 2.0)
        under = bed * T + np.array(p["scatter"]) * shade[..., None] * (1 - T)
        fx, fy = -gy / g, gx / g
        hgt, u, v = ripple(mx, my, fx, fy)
        hx = (ripple(mx + e, my, fx, fy)[0] - ripple(mx - e, my, fx, fy)[0]) / (2 * e)
        hy = (ripple(mx, my + e, fx, fy)[0] - ripple(mx, my - e, fx, fy)[0]) / (2 * e)
        rough = (0.010 + 0.03 * ford)
        Nw = np.stack([-hx * rough, -hy * rough, np.ones_like(hx)], -1)
        Nw /= np.linalg.norm(Nw, axis=-1, keepdims=True)
        view = np.array([0.0, -math.cos(math.radians(30)), -math.sin(math.radians(30))])   # camera to ground: north, down
        dn = (Nw * view).sum(-1, keepdims=True)
        refl = view - 2 * dn * Nw
        cosv = np.clip(-dn[..., 0], 0, 1)
        fres = (0.02 + 0.98 * (1 - cosv) ** 5) * p["sky_k"]
        el = np.clip(refl[..., 2], 0, 1)[..., None]
        sky = np.array(p["sky_lo"]) * (1 - el) + np.array(p["sky_hi"]) * el
        # long soft bands along the current where the surface is smoother and holds the sky
        band = G.sample(_SHORE, u / 18.0 + 0.3, v / 2.2 + 0.8)[..., 0]
        sky = sky * (0.7 + 0.6 * band[..., None])
        # the far bank and its grass reflected in the water just below it (the reflected ray runs north, into the bank)
        seen = np.maximum(G.smoothstep(0.1, -0.3, sd_at(mx, my - 0.6)), 0.7 * G.smoothstep(0.1, -0.3, sd_at(mx, my - 1.3)))
        sky = sky * (1 - 0.85 * seen[..., None]) + np.array([0.035, 0.045, 0.025]) * seen[..., None]
        gl = np.clip((refl * SUN).sum(-1), 0, 1) ** 120
        spark = G.smoothstep(0.82, 0.9, G.sample(_FOAM, u / 2.5 + 0.1, v / 0.8 + 0.3)[..., 0])
        surf = under * (1 - fres[..., None]) + sky * fres[..., None] + SUN_RGB * (gl * spark * p["glint"])[..., None]
        fn = G.sample(_FOAM, (u - 0.4 * t) / 6.0, v / 1.5)[..., 0]
        froth = np.clip(ford * G.smoothstep(0.58, 0.82, fn) * inside, 0, 1) * p["foam"]
        surf = surf * (1 - froth[..., None]) + np.array([0.7, 0.72, 0.7]) * froth[..., None]
        # the wet line where water meets land: dark, 2-3 px
        line = G.smoothstep(0.09, 0.0, np.abs(sd)) * (1 - bar) * 0.55
        col = col * (1 - inside[..., None]) + surf * inside[..., None]
        col = col * (1 - line[..., None])
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
        for name, ppm in (("x3", 60), ("x2", 40)):
            tile, H = relief_tile(ppm=ppm)
            save_tile(tile, out / f"relief_{name}.png")
            s = tile.shape[0]
            info[name] = dict(px=s, rgba8_bytes=s * s * 4, astc_4x4_bytes=s * s, png_bytes=(out / f"relief_{name}.png").stat().st_size)
            print(name, info[name])
        (out / "relief.json").write_text(json.dumps(info, indent=1))
