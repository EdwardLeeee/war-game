"""art-v7's sea of clouds (design/r11/edge-format.md section 2: clouds.far, clouds.near): square tiles seamless on all
four sides, tiled on the screen, the light already in them (the sun at the screen's upper left like everything else).

R11's open point: its cloud sea was a height noise shaded flat, read as crinkled snow. Here the clouds are billows: a
height field of domes heaped on domes (a union of spheres: the creases between them), seen from 30 degrees up with
the near billows hiding the far ones (a height-field ray cast, column by column), lit with their own shadows, the
hollows blue-grey.

python3 design/r11/common/clouds_v7.py OUT_DIR     writes clouds_far.png (2048 px), clouds_near.png (1024 px), 3x
"""
import argparse
import math
from pathlib import Path

import numpy as np
from PIL import Image

SIN, COS = 0.5, math.sqrt(3) / 2           # the camera's elevation 30 degrees: depth x 0.5 on the screen, height x 0.87
LIGHT = np.array([-0.5, 0.5, 0.71])        # toward the sun: screen left, away from the camera (screen up), up
LIGHT = LIGHT / np.linalg.norm(LIGHT)


def _domes(h, rng, count, r_lo, r_hi, k=1.0, where=None, add=False):
    """Heap `count` domes (a cosine bump radius r_lo..r_hi px, k x radius high: no face steeper than ~k x 1.6, so none
    is seen edge on from 30 degrees up) on h, wrapping: the higher wins (the creases between heaps), or add: riding on
    what is under them. where: a 0..1 field the domes prefer."""
    ny, nx = h.shape
    placed = 0
    tries = 0
    while placed < count and tries < count * 20:
        tries += 1
        cx, cy = rng.uniform(0, nx), rng.uniform(0, ny)
        if where is not None and rng.random() > where[int(cy) % ny, int(cx) % nx]:
            continue
        r = rng.uniform(r_lo, r_hi)
        R = int(math.ceil(r)) + 1
        ix = np.arange(int(cx) - R, int(cx) + R + 1)
        iy = np.arange(int(cy) - R, int(cy) + R + 1)
        dx = ix[None, :] - cx
        dy = iy[:, None] - cy
        d2 = dx * dx + dy * dy
        q = np.sqrt(np.clip(d2, 0, r * r)) / r
        z = k * r * np.sqrt(np.clip(1 - q * q, 0, 1)) * (1 - 0.25 * q ** 8)      # round tops (a cosine read as peaks)
        base = h[np.ix_(iy % ny, ix % nx)]
        h[np.ix_(iy % ny, ix % nx)] = base + z if add else np.maximum(base, z + 6.0 * nx / 1024 * 0)
        placed += 1
    return h


def _blur_wrap(a, r):
    """A box blur of radius r px, three times, wrapping (a tile)."""
    for _ in range(3):
        for ax in (0, 1):
            c = np.cumsum(np.concatenate([np.take(a, range(-r - 1, 0), axis=ax), a, np.take(a, range(0, r), axis=ax)], ax), axis=ax)
            n = a.shape[ax]
            a = (np.take(c, range(2 * r + 1, 2 * r + 1 + n), axis=ax) - np.take(c, range(0, n), axis=ax)) / (2 * r + 1)
    return a


def _band(ny, nx, f, seed):
    """Zero-mean noise periodic ny x nx, its features about 1/f of the width across (round in pixels), unit std."""
    rng = np.random.default_rng(seed)
    F = np.fft.fft2(rng.standard_normal((ny, nx)))
    ky = np.fft.fftfreq(ny)[:, None] * ny / nx
    kx = np.fft.fftfreq(nx)[None, :]
    k = np.hypot(kx, ky) * nx                     # cycles a tile width
    amp = np.exp(-((np.log(np.maximum(k, 1e-3)) - math.log(f)) / 0.45) ** 2)
    a = np.real(np.fft.ifft2(F * amp))
    return (a / a.std()).astype(np.float32)


def _embed(h, rng, count, r_lo, r_hi, k=0.8, e=0.4):
    """Heap round domes on h, each sunk e x its radius into the surface under its middle (its rim stays under the
    surface round it: no steps), the higher wins: convex tops, sharp creases between them, as cumulus."""
    ny, nx = h.shape
    for _ in range(count):
        cx, cy = rng.uniform(0, nx), rng.uniform(0, ny)
        r = rng.uniform(r_lo, r_hi)
        R = int(math.ceil(r)) + 1
        ix = np.arange(int(cx) - R, int(cx) + R + 1)
        iy = np.arange(int(cy) - R, int(cy) + R + 1)
        d2 = (ix[None, :] - cx) ** 2 + (iy[:, None] - cy) ** 2
        sub = np.ix_(iy % ny, ix % nx)
        base = h[sub]
        seat = float(base[base.shape[0] // 2, base.shape[1] // 2]) - e * r
        top = np.where(d2 < r * r, seat + k * np.sqrt(np.clip(r * r - d2, 0, None)), -1e9)
        h[sub] = np.maximum(base, top)
    return h


def cumulus(nx, ny, seed, size=1.0):
    """The cloud tops (px), periodic: a rolling deck, big domes on it, smaller ones sunk into them, smaller again.
    size: the billows' size (and fewer of them) against the 1024 px tile's."""
    rng = np.random.default_rng(seed)
    s = nx / 1024.0 * size
    h = 30.0 * s * _band(ny, nx, 2.0 / size, seed + 1) + 60.0 * s * _band(ny, nx, 1.0, seed + 3)   # + heaps and troughs a tile across
    area = nx * ny / (1024.0 * 2048.0) / size ** 2
    for count, r_lo, r_hi, k, e in ((90, 110, 230, 0.5, 0.3), (600, 40, 95, 0.6, 0.5), (1600, 14, 34, 0.6, 0.55)):
        h = _embed(h, rng, int(count * area), r_lo * s, r_hi * s, k, e)
    return _blur_wrap(h, max(1, int(2.5 * s)))          # (a rim left standing on a slope drew a step)


def billows(nx, ny, seed):
    """The cloud tops' height (px), periodic nx by ny (ny counts depth rows): billow noise, the sum of |band noise|
    octaves: round tops, sharp creases between them (cauliflower), over big heaps."""
    s = nx / 1024.0
    h = np.zeros((ny, nx), np.float32)
    amp = 22.0 * s                                 # (46 drew a field of crystals: seen 30 degrees up heights read 1.7x)
    for o, f in enumerate((3.0, 6.0, 12.0, 24.0, 48.0)):
        n = _band(ny, nx, f, seed + 7 * o)
        h += amp * np.abs(n) * (1.0 if o else 2.0)
        amp *= 0.42
    heaps = _band(ny, nx, 1.6, seed + 99)
    h += 48.0 * s * heaps
    return _blur_wrap(h, max(1, int(1.5 * s)))


def field(nx, ny, seed, cover=1.0):
    """The cloud tops' height (px), periodic nx by ny (ny counts depth rows: twice the screen's rows)."""
    rng = np.random.default_rng(seed)
    h = np.zeros((ny, nx), np.float32)
    s = nx / 1024.0
    lump = _blur_wrap(rng.random((ny, nx)).astype(np.float32), int(70 * s))
    lump = (lump - lump.min()) / (lump.max() - lump.min())
    if cover >= 1.0:
        deck = _blur_wrap(rng.random((ny, nx)).astype(np.float32), int(30 * s))
        h += 60.0 * s * (deck - deck.mean()) / (deck.std() * 4 + 1e-6)              # the lower deck, not flat
        where = 0.35 + 0.65 * lump                                                   # heaps and gaps, not a carpet
        h = _domes(h, rng, int(60 * s * s * ny / nx), 110 * s, 250 * s, k=0.42, where=where)   # the big heaps
    else:
        h -= 30.0 * s
        where = np.clip((lump - (1 - cover)) * 6.0, 0, 1)
        h = _domes(h, rng, int(40 * s * s * ny / nx), 60 * s, 150 * s, k=0.22, where=where)
        h = np.maximum(h, -30.0 * s)
    # the billows and the cauliflower on them: summed domes squashed to a ceiling (tanh), so they round the heaps over
    # and never stack into spires (stacked freely they drew icicles at full size)
    kk = 1.0 if cover >= 1.0 else 0.6
    on = np.ones_like(h) if cover >= 1.0 else (h > -29.0 * s).astype(np.float32)
    B = _domes(np.zeros_like(h), rng, int(700 * s * s * ny / nx), 26 * s, 75 * s, k=0.5, where=on, add=True)
    C = _domes(np.zeros_like(h), rng, int(4200 * s * s * ny / nx), 7 * s, 22 * s, k=0.6, where=on, add=True)
    Ab, Ac = 20.0 * s * kk, 6.0 * s * kk
    h = h + on * (Ab * np.tanh(B / Ab) + Ac * np.tanh(C / Ac))
    return _blur_wrap(h, max(1, int(1.0 * s)))


def shade(h, alpha=None, size=1.0):
    """Linear colour of the tops: lit by the sun with their own shadows, the sky's blue in the hollows."""
    ny, nx = h.shape
    sc = nx / 1024 * size                 # the billows' scale in px
    gy, gx = np.gradient(h)
    # +x right; rows run toward the camera, so the field's "away" is -row
    n = np.stack([-gx, gy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    lam = np.clip(((n * LIGHT).sum(-1) + 0.15) / 1.15, 0, 1)          # wrapped: light goes round a cloud
    # shadow: march toward the sun; soft (how far under the ray the field rises)
    yy, xx = np.mgrid[0:ny, 0:nx].astype(np.float32)
    occ = np.zeros_like(h)
    step = 3.0 * sc
    for k in range(1, 48):
        t = k * step
        sx = (xx + LIGHT[0] / math.hypot(LIGHT[0], LIGHT[1]) * t) % nx
        sy = (yy - LIGHT[1] / math.hypot(LIGHT[0], LIGHT[1]) * t) % ny
        rise = h[sy.astype(int), sx.astype(int)] - (h + t * LIGHT[2] / math.hypot(LIGHT[0], LIGHT[1]))
        occ = np.maximum(occ, np.clip(rise / (6.0 * sc), 0, 1))
    occ = _blur_wrap(occ, max(1, int(2 * sc)))          # (r4: small hollows shaded to grey specks)
    sun = lam * (1 - 0.85 * occ)
    # the hollows: how far below the neighbourhood's mean (wide and close)
    ao = np.clip(1 - (_blur_wrap(h, int(40 * sc)) - h) / (70.0 * sc), 0.0, 1.0)
    ao2 = np.clip(1 - (_blur_wrap(h, int(8 * sc)) - h) / (14.0 * sc), 0.0, 1.0)
    amb = 0.45 * ao + 0.55 * ao2
    sunc = np.array([1.0, 0.95, 0.86])                  # warm white in the sun (#f4f1ea), blue-grey in the shade (r3)
    skyc = np.array([0.36, 0.45, 0.6])
    skyc = np.array([0.5, 0.62, 0.82])
    col = 0.64 * sunc * sun[..., None] + skyc * (0.12 + 0.27 * amb[..., None])     # (R11-v7 r1: 217 on average read white foam)
    # the lit rims glow (light through their thin edges)
    rim = np.clip(1 - n[..., 2], 0, 1) * (1 - occ) * lam
    col = col + 0.08 * rim[..., None]
    lo = h.min()
    deep = np.clip((h - lo) / (max(h.max() - lo, 1e-6) * 0.5), 0, 1) ** 0.8
    # the troughs between the heaps blue-grey (#8f9db3, R11-v7 r1), in the shade of the heaps round them
    col = col * (0.5 + 0.5 * deep[..., None]) + np.array([0.27, 0.34, 0.45]) * 0.45 * (1 - deep[..., None])
    return col


def view(h, col, rows_out, alpha=None, ss=1, base_h=0.0):
    """The field seen from 30 degrees up: screen rows_out x nx, periodic like the field (one screen period: ny / 2
    rows). For every screen pixel the nearest field row whose top reaches it (a height-field ray cast)."""
    ny, nx = h.shape
    reps = 3
    H3 = np.tile(h, (reps, 1))
    C3 = np.tile(col, (reps, 1, 1))
    A3 = np.tile(alpha, (reps, 1)) if alpha is not None else None
    J = np.arange(ny * reps)[:, None]
    ytop = J * SIN - H3 * COS                               # screen rows (down) of each field row's top
    off = ny * SIN                                           # the middle period's first screen row
    Hs = int(ny * reps * SIN) + 2
    shift = int(math.ceil(max(0.0, -(ytop.min()))))
    b = np.clip(np.ceil(ytop + shift).astype(int), 0, Hs + shift - 1)
    arr = np.full((Hs + shift, nx), -1, np.int64)
    cols = np.broadcast_to(np.arange(nx)[None, :], b.shape)
    X = np.arange(nx)[None, :]
    Y = (np.arange(rows_out) + int(off))[:, None].astype(np.float32)

    def colour(sel):
        """The row's colour, blended toward the next nearer row's across the band between their tops (a steep face
        facing the camera is many pixels a row: one colour a row drew streaks)."""
        s0 = np.clip(sel, 0, len(J) - 2)
        t0, t1 = ytop[s0, X], ytop[s0 + 1, X]
        f = np.clip((Y - t0) / np.maximum(t1 - t0, 1e-3), 0, 1)[..., None]
        return C3[s0, X] * (1 - f) + C3[s0 + 1, X] * f

    if A3 is None:
        np.maximum.at(arr, (b.ravel(), cols.ravel()), np.broadcast_to(J, b.shape).ravel())
        g = np.maximum.accumulate(arr, axis=0)
        y0 = int(off) + shift
        sel = g[y0:y0 + rows_out]
        return colour(sel), None
    # with alpha: the near layer's clouds are separate lumps over nothing; the nearest lump row that reaches a pixel
    # covers it by its own alpha, the rest shows the next one behind... one layer is enough at its sparse cover
    keep = A3 > 0.02
    vals = np.where(keep, np.broadcast_to(J, b.shape), -1)
    np.maximum.at(arr, (b.ravel(), cols.ravel()), vals.ravel())
    g = np.maximum.accumulate(arr, axis=0)
    y0 = int(off) + shift
    sel = g[y0:y0 + rows_out]
    selc = np.clip(sel, 0, None)
    # a lump is not solid down to the ground: its row covers the screen only down to the cloud's base
    ybot = selc * SIN - base_h * COS
    ok = (sel >= 0) & (Y <= ybot)
    a = np.where(ok, A3[selc, X], 0.0)
    return colour(sel), a


def _srgb(lin):
    lin = np.clip(lin, 0, 1)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)


def _down(a, f):
    """Mean of f x f blocks (the supersampling)."""
    h, w = a.shape[:2]
    return a.reshape(h // f, f, w // f, f, *a.shape[2:]).mean(axis=(1, 3))


def far(n=2048, seed=61, ss=1, size=1.5):
    """The far layer: 2048 px at 3x, the billows three times the first draft's (r1: 1-2 m a billow beside 1.8 m men)."""
    N = n * ss
    h = cumulus(N, 2 * N, seed, size)
    col = shade(h, size=size)
    img, _ = view(h, col, N)
    img = _down(img, ss)
    # a breath of haze: the far sea is below and away
    img = img * 0.93 + np.array([0.55, 0.62, 0.72]) * 0.07
    return (np.clip(_srgb(img), 0, 1) * 255 + 0.5).astype(np.uint8)


def near(n=1024, seed=67, ss=2, cover=0.42, size=2.0):
    """A nearer deck of the same clouds broken into patches: the deck drawn whole, then holes cut by a soft mask on the
    screen (as floating lumps over a floor it drew boxes and curtains)."""
    N = n * ss
    h = cumulus(N, 2 * N, seed, size)
    col = shade(h, size=size)
    img, _ = view(h, col, N)
    img = _down(img, ss)
    rng = np.random.default_rng(seed + 5)
    m = _blur_wrap(rng.random((n, n)).astype(np.float32), int(55 * n / 1024))
    m2 = _blur_wrap(rng.random((n, n)).astype(np.float32), int(14 * n / 1024))
    m = (m - m.mean()) / m.std() + 0.35 * (m2 - m2.mean()) / m2.std()
    thr = np.quantile(m, 1 - cover)
    # its edges frayed into wisps along the wind (3:1), a smooth threshold (r4: fine noise cut hard read as spatter)
    F = np.fft.fft2(rng.standard_normal((n, n)))
    kx = np.fft.fftfreq(n)[None, :] * n
    ky = np.fft.fftfreq(n)[:, None] * n
    m3 = np.real(np.fft.ifft2(F * np.exp(-((kx * 3.0) ** 2 + ky ** 2) / (2 * 40.0 ** 2))))
    m3 = (m3 - m3.mean()) / m3.std()
    al = np.clip((m - thr + 0.3 * m3) / 1.25, 0, 1) ** 0.9
    img = img * 0.92                                                  # the near layer a little darker than the far
    rgb = (np.clip(_srgb(img), 0, 1) * 255 + 0.5).astype(np.uint8)
    return np.dstack([rgb, (np.clip(al * 0.92, 0, 1) * 255 + 0.5).astype(np.uint8)])


def scaled_tile(img, n2):
    """The tile at another size, still seamless: resized as 3 x 3 tiles, the middle cut out."""
    n = img.shape[0]
    big = Image.fromarray(np.tile(img, (3, 3, 1)))
    big = big.resize((3 * n2, 3 * n2), Image.LANCZOS)
    return np.asarray(big)[n2:2 * n2, n2:2 * n2]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out", type=Path)
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    Image.fromarray(far()).save(a.out / "clouds_far.png")
    Image.fromarray(near(), "RGBA").save(a.out / "clouds_near.png")


if __name__ == "__main__":
    main()
