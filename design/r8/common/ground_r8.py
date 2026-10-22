"""R8 batch 2 (D-093): the ground (war-game ground 1, agreed with war-game-client 2026-10-21; client/src/art/ground.ts,
client/src/render/ground-draw.ts). Five tileable layers, already lit (blender/ground_bake.py), the height in alpha;
ground.json; and a sample of the five blended the way the client's shader blends them (the same noise, edges and
heights, ported here to numpy), seen from above and through the game's camera.

python3 design/r8/common/ground_r8.py BAKED_DIR OUT_DIR
  BAKED_DIR  <id>_rgb.png from ground_bake.py (and <id>_disp.png when the set has a displacement map)
  OUT_DIR    ground/ (the layers, ground.json) and sample_top.png, sample_cam.png
"""
import json
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
# weights: the weight map soft (proposed to war-game-client 2026-10-22, the user's 「河岸一格一格的方塊」): texels_per_cell
# texels a cell; a channel's value a smoothstep of the distance from the nearest seed cell's square, 0.5 at `reach` cells
# past it (where the old on/off map's edge was), soft_m wide; then a Gaussian blur of blur_m (a diagonal river's
# staircase becomes a band). dirt.noise_soft: the width of the dirt patches' ramp (was a fixed 0.06: hard blob edges).
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
    near(1, (grid == 1) | (grid == 7), rules["gravel_cells"])
    seeds = np.zeros_like(grid, dtype=bool)
    for x, y in nodes:
        seeds[y, x] = True
    near(2, seeds, rules["dirt"]["node_cells"])
    return out


def compose(grid, nodes, layers, ppm=24, rules=RULES, grade=GRADE, high=True):
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
    gj = dict(format="war-game ground 1", layers=entries, rules=RULES, grade=GRADE)
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


if __name__ == "__main__":
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
