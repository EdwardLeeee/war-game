"""R8 batch 2 (D-093): the ground (war-game ground 1, agreed with war-game-client 2026-10-21; client/src/art/ground.ts,
client/src/render/ground-draw.ts). Five tileable layers, already lit (blender/ground_bake.py), the height in alpha;
ground.json; and a sample of the five blended the way the client's shader blends them (the same noise, edges and
heights, ported here to numpy), seen from above and through the game's camera.

python3 design/r8/common/ground_r8.py BAKED_DIR OUT_DIR
  BAKED_DIR  <id>_rgb.png from ground_bake.py (and <id>_disp.png when the set has a displacement map)
  OUT_DIR    ground/ (the layers, ground.json) and sample_top.png, sample_cam.png
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

CELL_M = 2.0
LAYERS = ("grass", "grass_dry", "dirt", "gravel", "bank")
TERRAIN = {"plain": 0, "rock": 1, "water": 3, "cliff": 7}       # the sim's Terrain values the weights look at
# the layers' tile sizes (m) and the rules, as client reads them (GroundJson)
RULES = dict(bank_cells=1, gravel_cells=1, edge_m=1.2, height_k=0.9, dirt=dict(node_cells=1, noise_threshold=0.8, noise_soft=0.3),
             weights=dict(texels_per_cell=4, soft_m=1.6, blur_m=1.0))
# weights: the weight map soft (proposed to war-game-client 2026-10-22, the ceo's note on R8-23: the river bank came out
# in square steps along the cells; the user approved R8-28 the same day): texels_per_cell
# texels a cell; a channel's value a smoothstep of the distance from the nearest seed cell's square, 0.5 at `reach` cells
# past it (where the old on/off map's edge was), soft_m wide; then a Gaussian blur of blur_m (a diagonal river's
# staircase becomes a band). dirt.noise_soft: the width of the dirt patches' ramp (was a fixed 0.06: hard blob edges).
# water (ceo 2026-10-23: the river in the ground shader, not the per-cell tiles; agreed with war-game-client the same
# day): the weight map's A is the signed distance to the water (in the water +, on land -, metres), clamped to
# range_m (at least 3 x blur_m, so a straight bank stays put) and blurred blur_m (a diagonal river's 2 m steps become a
# line); the shader: a wet band outside the edge (wet_m, darkened to wet_dark), the water inside (edge_m soft), its
# colour the water layer's lit ripples tinted from shallow to deep over depth_m (linear RGB), the bed showing through
# the shallows; two copies of the water layer drifting at flow (m/s).
WATER = dict(range_m=4.5, blur_m=1.5, edge_m=0.35, wet_m=0.9, wet_dark=0.62, depth_m=2.5,
             shallow=[0.045, 0.058, 0.045], deep=[0.012, 0.03, 0.036], bed=0.55, bed_shallow=0.45,
             noise_m=0.08, flow=[[0.05, 0.02], [-0.03, 0.04]])
WATER_TILE_M = 4.0
GRADE = dict(brightness=1.0, saturation=0.9)      # the ground a little greyer than the units (R8: 找得到兵)


def value_noise(size, cells, seed):
    """client's valueNoise (ground.ts): xorshift32 lattice, smoothstep between, tileable; 0..1 floats."""
    lattice = np.zeros(cells * cells)
    s = seed & 0xFFFFFFFF or 1
    for i in range(cells * cells):
        s ^= (s << 13) & 0xFFFFFFFF
        s ^= s >> 17
        s ^= (s << 5) & 0xFFFFFFFF
        lattice[i] = s / 4294967296
    lat = lattice.reshape(cells, cells)
    step = size / cells
    f = np.arange(size) / step
    i0 = np.floor(f).astype(int)
    t = f - i0
    t = t * t * (3 - 2 * t)
    x0, x1 = i0 % cells, (i0 + 1) % cells
    a = lat[np.ix_(x0, x0)]                                  # [y, x]
    b = lat[np.ix_(x0, x1)]
    c = lat[np.ix_(x1, x0)]
    d = lat[np.ix_(x1, x1)]
    tx = t[None, :]
    ty = t[:, None]
    top = a * (1 - tx) + b * tx
    bot = c * (1 - tx) + d * tx
    return np.round((top * (1 - ty) + bot * ty) * 255) / 255.0


def sample(tex, u, v):
    """Bilinear, repeating: tex [h, w, c] at texture coordinates u, v (any range)."""
    h, w = tex.shape[:2]
    x = (u % 1.0) * w - 0.5
    y = (v % 1.0) * h - 0.5
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx = (x - x0)[..., None]
    fy = (y - y0)[..., None]
    x0 %= w
    y0 %= h
    x1 = (x0 + 1) % w
    y1 = (y0 + 1) % h
    a = tex[y0, x0]
    b = tex[y0, x1]
    c = tex[y1, x0]
    d = tex[y1, x1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def blur(a, sigma):
    """Gaussian blur, sigma in texels, edges clamped (separable)."""
    if sigma <= 0:
        return a
    r = int(3 * sigma) + 1
    x = np.arange(-r, r + 1)
    k = np.exp(-x * x / (2 * sigma * sigma))
    k /= k.sum()
    for ax in (0, 1):
        pad = [(0, 0), (0, 0)]
        pad[ax] = (r, r)
        b = np.pad(a, pad, mode="edge")
        a = sum(k[i] * np.take(b, range(i, i + a.shape[ax]), axis=ax) for i in range(len(k)))
    return a


def weights(grid, nodes, rules=RULES):
    """client's groundWeights: R bank (cells by water), G gravel (by rock and cliffs), B dirt (by resource points).
    With rules.weights (see RULES): soft, texels_per_cell a cell. Without: the first version, one texel a cell,
    Chebyshev reach, 1 or 0."""
    n = grid.shape[0]
    wr = rules.get("weights")
    if wr:
        k = wr["texels_per_cell"]
        t = (np.arange(n * k) + 0.5) / k * CELL_M
        X, Y = np.meshgrid(t, t)
        out = np.zeros((n * k, n * k, 3))

        def near(ch, seeds, reach):
            d = np.full(X.shape, 1e9)
            for y, x in zip(*np.nonzero(seeds)):
                dx = np.maximum(np.abs(X - (x + 0.5) * CELL_M) - CELL_M / 2, 0)
                dy = np.maximum(np.abs(Y - (y + 0.5) * CELL_M) - CELL_M / 2, 0)
                d = np.minimum(d, np.hypot(dx, dy))
            r = reach * CELL_M
            out[..., ch] = blur(smoothstep(r + wr["soft_m"] / 2, r - wr["soft_m"] / 2, d), wr["blur_m"] * k / CELL_M)
    else:
        out = np.zeros((n, n, 3))

        def near(ch, seeds, reach):
            ys, xs = np.nonzero(seeds)
            for y, x in zip(ys, xs):
                out[max(0, y - reach):y + reach + 1, max(0, x - reach):x + reach + 1, ch] = 1.0
    near(0, (grid >= 3) & (grid <= 6), rules["bank_cells"])
    if wr and rules.get("water"):
        out = np.concatenate([out, water_distance(grid, rules)[..., None]], -1)
    near(1, (grid == 1) | (grid == 7), rules["gravel_cells"])
    seeds = np.zeros_like(grid, dtype=bool)
    for x, y in nodes:
        seeds[y, x] = True
    near(2, seeds, rules["dirt"]["node_cells"])
    return out


def water_distance(grid, rules):
    """The weight map's A: 0.5 + clamp(signed distance to the water, -range, range) / range / 2, blurred; off the map the
    nearest cell's ground (as the water tiles take it), so a river running off the edge grows no bank there."""
    wr, wa = rules["weights"], rules["water"]
    k = wr["texels_per_cell"]
    n = grid.shape[0]
    pad = int(math.ceil((wa["range_m"] + 3 * wa["blur_m"]) / CELL_M)) + 1
    wet = np.pad((grid >= 3) & (grid <= 6), pad, mode="edge")
    N = n + 2 * pad
    t = (np.arange(N * k) + 0.5) / k * CELL_M
    X, Y = np.meshgrid(t, t)

    def dist(seeds):
        d = np.full(X.shape, 1e9)
        for y, x in zip(*np.nonzero(seeds)):
            dx = np.maximum(np.abs(X - (x + 0.5) * CELL_M) - CELL_M / 2, 0)
            dy = np.maximum(np.abs(Y - (y + 0.5) * CELL_M) - CELL_M / 2, 0)
            d = np.minimum(d, np.hypot(dx, dy))
        return d
    # only the cells along the water's edge matter (the nearest water to a land point is a water cell beside land)
    edge_w = wet & ~(np.roll(wet, 1, 0) & np.roll(wet, -1, 0) & np.roll(wet, 1, 1) & np.roll(wet, -1, 1))
    edge_l = ~wet & (np.roll(wet, 1, 0) | np.roll(wet, -1, 0) | np.roll(wet, 1, 1) | np.roll(wet, -1, 1))
    # in a water cell: + the distance to the nearest land; on land: - the distance to the nearest water (both 0 at the
    # shore; war-game-client 2026-10-23: the difference of the two plateaued a cell in from the bank of a wide river)
    in_w = np.kron(wet, np.ones((k, k), dtype=bool))
    sd = np.where(in_w, np.minimum(dist(edge_l), 1e3), -np.minimum(dist(edge_w), 1e3))
    sd = np.clip(sd, -wa["range_m"], wa["range_m"])
    sd = blur(sd, wa.get("blur_m", wr["blur_m"]) * k / CELL_M)
    a = 0.5 + sd / wa["range_m"] / 2
    return a[pad * k:(pad + n) * k, pad * k:(pad + n) * k]


def water_layer(size=512, tile_m=WATER_TILE_M, seed=7):
    """The water layer (lit, like the others; sRGB, height in A): small waves (periodic value noise, our own) seen from
    the game's camera (30 degrees up, looking north): a dark body, the sky in it by the rippled surface's fresnel."""
    # waves in every direction (war-game-client 2026-10-23: value noise lined up with the grid looked blocky): sines with
    # whole wave numbers across the tile, so it still tiles, random directions, longer waves stronger
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float64) / size
    h = np.zeros((size, size))
    for _ in range(48):
        while True:
            kx, ky = rng.integers(-28, 29, 2)
            kk = math.hypot(kx, ky)
            if 5 <= kk <= 28:
                break
        h += np.sin(2 * math.pi * (kx * xx + ky * yy) + rng.uniform(0, 2 * math.pi)) / kk ** 1.1
    h = (h - h.min()) / (h.max() - h.min())
    px = tile_m / size
    gy, gx = np.gradient(h * 0.06, px)                  # ripples a few centimetres high: a river, not the sea
    nrm = np.dstack([-gx, gy, np.ones_like(h)])         # image y runs south: north is -row
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    v = np.array([0.0, math.cos(math.radians(30)), -math.sin(math.radians(30))])   # camera to surface
    cosv = np.clip(-(nrm @ v), 0.0, 1.0)
    fres = 0.02 + 0.98 * (1 - cosv) ** 5
    r = v[None, None, :] - 2 * (nrm @ v)[..., None] * nrm
    up = np.clip(r[..., 2], 0, 1)[..., None]
    sky = np.array([0.55, 0.6, 0.64]) * (1 - up) + np.array([0.3, 0.42, 0.58]) * up
    body = np.array(WATER["deep"])
    lin = body * (1 - fres[..., None]) + sky * fres[..., None] * 2.1
    rgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.clip(lin, 0, None) ** (1 / 2.4) - 0.055)
    return np.dstack([np.clip(rgb, 0, 1), h])


def compose(grid, nodes, layers, ppm=24, rules=RULES, grade=GRADE, high=True, t=0.0):
    """The ground top-down (sRGB 0..1), `ppm` pixels a metre, as ground-draw.ts's fragment shader colours it."""
    n = grid.shape[0]
    size = n * CELL_M
    px = int(size * ppm)
    m = (np.arange(px) + 0.5) / ppm
    mx, my = np.meshgrid(m, m)                         # metres; y down the picture (north at the top)
    w = sample(weights(grid, nodes, rules), mx / size, my / size)
    noise = value_noise(256, 16, 1)[..., None]
    macro = value_noise(128, 4, 2)[..., None]
    nz = sample(noise, mx / 6.0, my / 6.0)[..., 0]
    big = sample(macro, mx / 64.0, my / 64.0)[..., 0]

    def tile(t, tile_m, nn):
        a = sample(t, mx / tile_m, my / tile_m)
        if not high:
            return a
        rx = (0.8 * mx + 0.6 * my) * 0.73 + 17.3          # mat2(0.8, -0.6, 0.6, 0.8) * m * 0.73 + vec2(17.3, 5.1)
        ry = (-0.6 * mx + 0.8 * my) * 0.73 + 5.1
        b = sample(t, rx / tile_m, ry / tile_m)
        k = smoothstep(0.3, 0.7, nn)[..., None]
        return a * (1 - k) + b * k

    def over(base, layer, mask, nn):
        e = mask * 2.0 - 1.0 + (nn - 0.5) * 1.2 + (layer[..., 3] - base[..., 3]) * rules["height_k"]
        f = np.clip(e * (CELL_M / rules["edge_m"]) * 0.5 + 0.5, 0.0, 1.0)[..., None]
        return base * (1 - f) + layer * f

    L = {k: v for k, v in layers.items()}
    dry = smoothstep(0.35, 0.65, big)[..., None]
    g = tile(L["grass"]["img"], L["grass"]["tile_m"], nz)
    gd = tile(L["grass_dry"]["img"], L["grass_dry"]["tile_m"], 1.0 - nz)
    c = g * (1 - dry) + gd * dry
    patch = sample(noise, mx / 72.0 + 0.31, my / 72.0 + 0.31)[..., 0]
    th, soft = rules["dirt"]["noise_threshold"], rules["dirt"].get("noise_soft")
    ramp = smoothstep(th - soft / 2, th + soft / 2, patch) if soft else smoothstep(th, th + 0.06, patch)
    dirt = np.maximum(w[..., 2], ramp)
    c = over(c, sample(L["dirt"]["img"], mx / L["dirt"]["tile_m"], my / L["dirt"]["tile_m"]), dirt, nz)
    c = over(c, sample(L["gravel"]["img"], mx / L["gravel"]["tile_m"], my / L["gravel"]["tile_m"]), w[..., 1], nz)
    c = over(c, sample(L["bank"]["img"], mx / L["bank"]["tile_m"], my / L["bank"]["tile_m"]), w[..., 0], nz)
    if w.shape[-1] > 3 and "water" in L:
        wa = rules["water"]
        sd = (w[..., 3] - 0.5) * 2 * wa["range_m"] + (nz - 0.5) * 2 * wa["noise_m"]
        wetf = smoothstep(-wa["wet_m"], 0.0, sd)[..., None]
        c = c * (1 - (1 - wa["wet_dark"]) * wetf)
        inside = smoothstep(-wa["edge_m"], wa["edge_m"], sd)[..., None]
        tm = L["water"]["tile_m"]
        f0, f1 = wa["flow"]
        a = sample(L["water"]["img"], (mx + f0[0] * t) / tm, (my + f0[1] * t) / tm)
        if high:
            rx = (0.8 * mx - 0.6 * my) * 1.3 + f1[0] * t
            ry = (0.6 * mx + 0.8 * my) * 1.3 + f1[1] * t
            a = 0.5 * (a + sample(L["water"]["img"], rx / tm, ry / tm))
        depth = smoothstep(0.0, wa["depth_m"], sd)[..., None]
        sh = np.array(wa["shallow"])
        sh = np.where(sh <= 0.0031308, sh * 12.92, 1.055 * sh ** (1 / 2.4) - 0.055)
        under = (c[..., :3] * wa["bed"] + sh) * 0.5          # the bed seen through the shallows, tinted
        op = (wa["bed_shallow"] + (1 - wa["bed_shallow"]) * depth) if high else 1.0
        wcol = under * (1 - op) + a[..., :3] * op           # the water layer is the deep water, lit
        c = np.concatenate([c[..., :3] * (1 - inside) + wcol * inside, c[..., 3:]], -1)
    col = c[..., :3] * (0.9 + 0.2 * big[..., None]) * grade["brightness"]
    lum = (col * np.array([0.2126, 0.7152, 0.0722])).sum(-1, keepdims=True)
    col = lum + (col - lum) * grade["saturation"]
    return np.clip(col, 0, 1)


def assemble(baked, out, spec):
    """The layers as client loads them: RGBA PNG, the height in A (the displacement map, else the brightness)."""
    out.mkdir(parents=True, exist_ok=True)
    layers, entries = {}, []
    for lid, tile_m in spec:
        rgb = np.asarray(Image.open(baked / f"{lid}_rgb.png").convert("RGB"), np.float32) / 255.0
        dp = baked / f"{lid}_disp.png"
        if dp.exists():
            hgt = np.asarray(Image.open(dp).convert("L").resize(rgb.shape[1::-1], Image.LANCZOS), np.float32) / 255.0
        else:
            lum = (rgb * np.array([0.2126, 0.7152, 0.0722])).sum(-1)
            hgt = np.clip((lum - lum.mean()) / (lum.std() * 4 + 1e-6) + 0.5, 0, 1)
        rgba = np.dstack([rgb, hgt])
        Image.fromarray((rgba * 255).round().astype(np.uint8), "RGBA").save(out / f"{lid}.png", optimize=True)
        lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
        entries.append(dict(id=lid, file=f"{lid}.png", tile_m=tile_m, mean=[round(float(x), 4) for x in lin.reshape(-1, 3).mean(0)]))
        layers[lid] = dict(img=rgba, tile_m=tile_m)
    # the water layer (art-v6, ceo 2026-10-23): our own ripples, lit; the water drawn by the ground shader
    wl = water_layer()
    Image.fromarray((wl * 255).round().astype(np.uint8), "RGBA").save(out / "water.png", optimize=True)
    lin = np.where(wl[..., :3] <= 0.04045, wl[..., :3] / 12.92, ((wl[..., :3] + 0.055) / 1.055) ** 2.4)
    entries.append(dict(id="water", file="water.png", tile_m=WATER_TILE_M, mean=[round(float(x), 4) for x in lin.reshape(-1, 3).mean(0)]))
    layers["water"] = dict(img=wl, tile_m=WATER_TILE_M)
    gj = dict(format="war-game ground 1", layers=entries, rules=dict(RULES, water=WATER), grade=GRADE)
    (out / "ground.json").write_text(json.dumps(gj, indent=1))
    return layers


def sample_map(n=20):
    """A sample stretch: grass everywhere, a river along the south with its bank, a rock ridge and a cliff (gravel at
    their feet), a gold mine and berries (dirt round them)."""
    g = np.zeros((n, n), dtype=int)
    for x in range(n):                          # the river: three cells wide, a bend
        y0 = n - 5 + (1 if 6 <= x <= 12 else 0)
        g[y0:y0 + 3, x] = 3
    g[4, 3:8] = 7                               # a cliff line
    g[3:5, 13:15] = 1                           # rocks
    nodes = [(10, 8), (16, 11), (4, 11)]
    return g, nodes


def camera_view(top, ppm):
    """The top-down picture through the game's camera (方形斜看, 30 degrees up): the ground's depth halved."""
    h, w = top.shape[:2]
    im = Image.fromarray((top * 255).round().astype(np.uint8), "RGB")
    return im.resize((w, h // 2), Image.LANCZOS)


def export(src, out, scale):
    """The release's ground/ at `scale` (3 or 2): ground.json (with "scale") and the layers, resized from the 3x bake;
    memory.json (each layer's RGBA8 bytes, mipmaps a third more; ASTC 4x4 a quarter of it), like the atlases'."""
    out.mkdir(parents=True, exist_ok=True)
    gj = json.loads((src / "ground.json").read_text())
    gj["scale"] = float(scale)
    px = 0
    for L in gj["layers"]:
        im = Image.open(src / L["file"])
        if scale != 3:
            im = im.resize((max(1, round(im.width * scale / 3)), max(1, round(im.height * scale / 3))), Image.LANCZOS)
        im.save(out / L["file"], optimize=True)
        px += im.width * im.height
    (out / "ground.json").write_text(json.dumps(gj, indent=1))
    mem = dict(total_rgba8_bytes=int(px * 4 * 4 / 3), total_astc_4x4_bytes=int(px * 4 / 3), layers=len(gj["layers"]))
    (out / "memory.json").write_text(json.dumps(mem, indent=1))
    print(f"ground x{scale}: {len(gj['layers'])} layers, {mem['total_rgba8_bytes'] / 2 ** 20:.2f} MB RGBA8")


if __name__ == "__main__" and sys.argv[1] == "export":
    export(Path(sys.argv[2]), Path(sys.argv[3]), int(sys.argv[4]))
elif __name__ == "__main__":
    baked, out = Path(sys.argv[1]), Path(sys.argv[2])
    spec = json.loads((baked / "spec.json").read_text())       # [[id, tile_m], ...] in LAYERS order
    layers = assemble(baked, out / "ground", spec)
    g, nodes = sample_map()
    top = compose(g, nodes, layers, ppm=24)
    water = np.kron((g == 3).astype(float), np.ones((48, 48)))[..., None]
    top = top * (1 - water * 0.85) + np.array([0.16, 0.27, 0.33]) * water * 0.85
    Image.fromarray((top * 255).round().astype(np.uint8), "RGB").save(out / "sample_top.png")
    camera_view(top, 24).save(out / "sample_cam.png")
    print("wrote", out)
