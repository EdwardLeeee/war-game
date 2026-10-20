"""The terrain tiles (the user 2026-10-20, R6-51: 「全部照整張地圖加」): what the client draws for each terrain cell, worked
out from that cell's Terrain value and its neighbours only (no extra data in the protocol).

Water (rivers and lakes; fords and bridges count as water for the banks): a dual grid. A tile sits on every cell
CORNER, its four corners on the middles of the four cells round it; which of those four are water (a 4-bit mask, bit 0
north-west, 1 north-east, 2 south-west, 3 south-east; north = the sim's -y) picks one of 15 tiles (mask 0 is no tile).
The bank and the water's edge follow the 0.5 line of a smoothed bilinear blend of the four corners, so along a shared
edge two tiles depend on the same two cells and meet without a seam.

water_polygons(mask) -> dict(bank=[...], water=[...]) polygons in metres, the tile's middle at the origin, render axes
(+x east, +y north), from a marching-squares trace of that field. Each tile reaches OVER (a few pixels) past its own
square so neighbours overlap instead of leaving a hairline of half-transparent edge pixels; smoothstep is flat at 0 and
1, so the field held at the edge and the neighbour's field agree there.
"""
import math

CELL = 2.0
N = 48                     # samples across a tile
OVER = 0.15                # the overlap past each edge, a fraction of the tile (0.3 m: 9 px deep at 3x, room for the
                           # cut to the exact square, terrain_prep in atlas_b1)


def _smooth(t):
    return t * t * (3 - 2 * t)


def field(mask, u, v):
    """u, v in [0, 1] across the tile (u east, v south, sim axes); the four corners' water flags blended."""
    nw, ne, sw, se = ((mask >> i) & 1 for i in range(4))
    a, b = _smooth(min(1.0, max(0.0, u))), _smooth(min(1.0, max(0.0, v)))
    return (nw * (1 - a) + ne * a) * (1 - b) + (sw * (1 - a) + se * a) * b


def _contour(mask, level):
    """The region field >= level as polygons (closed loops of the boundary, including the tile's own edge where the
    region touches it), in metres, render axes."""
    # a fine grid of inside/outside, traced cell by cell: the polygon is the union of the inside samples' squares,
    # cut along the iso-line by linear interpolation (marching squares)
    def uv(i):
        return -OVER + i / N * (1 + 2 * OVER)

    def f(i, j):
        return field(mask, uv(i), uv(j))
    segs = []

    def pt(i, j):
        # sample (i, j) -> metres, render axes (the tile's middle at 0; v grows south = render -y)
        return (uv(i) - 0.5) * CELL, -(uv(j) - 0.5) * CELL

    def lerp(p0, p1, f0, f1):
        t = (level - f0) / (f1 - f0) if f1 != f0 else 0.5
        return (p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t)

    for i in range(N):
        for j in range(N):
            c = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            vals = [f(*q) for q in c]
            ins = [v >= level for v in vals]
            if all(ins):
                continue
            if not any(ins):
                continue
            pts = []
            for k in range(4):
                q0, q1 = c[k], c[(k + 1) % 4]
                v0, v1 = vals[k], vals[(k + 1) % 4]
                if ins[k]:
                    pts.append(pt(*q0))
                if ins[k] != ins[(k + 1) % 4]:
                    pts.append(lerp(pt(*q0), pt(*q1), v0, v1))
            segs.append(pts)
    full = []                                     # the squares wholly inside, merged into runs along each row
    for j in range(N):
        run = None
        for i in range(N + 1):
            inside = i < N and all(f(*q) >= level
                                   for q in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)))
            if inside and run is None:
                run = i
            elif not inside and run is not None:
                full.append([pt(run, j), pt(i, j), pt(i, j + 1), pt(run, j + 1)])
                run = None
    return full + segs


def water_polygons(mask):
    """Small convex pieces (one per grid square crossed or inside), drawn as one mesh by the tile builder: the bank
    (field >= 0.12: about 0.55 m of earth on the dry side, as wide as on the approved R6-51 boards) and the water
    (>= 0.5: the edge on the line between a wet and a dry cell), one over the other."""
    return dict(bank=_contour(mask, 0.12), water=_contour(mask, 0.5))


if __name__ == "__main__":
    for m in range(1, 16):
        p = water_polygons(m)
        print(m, len(p["bank"]), len(p["water"]))
