"""R6-50: the ground under the R6 representative battlefield (the oblique layout, scene_r6.LAYOUT["oblique"]), for the
ground patch render (design/b1/blender/ground.py gpatch) and the boards (common/r650.py).

plan() -> dict(dirt, gravel, dark, road, decals) in metres from the patch's middle, the render's axes (+x east, +y
north = the sim's -y). The patch is W x D metres round the scene's centre cell.
"""
import math
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

W, D = 52.0, 40.0          # metres: 26 x 20 cells, a little more than the 814 x 380 pt screen


def _scene():
    import field
    import scene_r6
    old = field.VIEW
    field.VIEW = "oblique"
    try:
        sc = scene_r6.representative()
    finally:
        field.VIEW = old
    return sc, scene_r6.CENTRE


def to_m(x, y, centre):
    """Sim cells -> patch metres (render axes)."""
    return (x - centre[0]) * 2.0, -(y - centre[1]) * 2.0


def _blob(cx, cy, rx, ry, rnd, n=14, j=0.22):
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        k = 1 + rnd.uniform(-j, j)
        pts.append((cx + rx * k * math.cos(a), cy + ry * k * math.sin(a)))
    return pts


def plan(seed=3):
    rnd = random.Random(seed)
    sc, centre = _scene()
    m = lambda x, y: to_m(x, y, centre)
    foot = {}
    for c, btype, st, x, y, team in sc["buildings"]:
        n = {"MainCity": 4, "House": 2, "Barracks": 3, "Farm": 3, "ArrowTower": 2}[btype]
        foot.setdefault(btype, []).append((x, y, n))
    dirt, gravel, dark, decals = [], [], [], []
    # trampled earth round the main city and in front of the barracks and the houses
    for x, y, n in foot["MainCity"]:
        cx, cy = m(x + n / 2, y + n / 2 + 0.6)
        dirt.append(_blob(cx, cy, n + 2.6, n + 1.6, rnd, n=18, j=0.12))
    for btype in ("Barracks", "House", "ArrowTower"):
        for x, y, n in foot.get(btype, []):
            cx, cy = m(x + n / 2, y + n + 0.4)
            dirt.append(_blob(cx, cy, n + 0.6, 1.2, rnd, n=12, j=0.2))
    # the road: out of the main city's front, east between the barracks and the fields to the screen's edge (toward
    # the small town); it keeps off the fields
    mx, my, mn = foot["MainCity"][0]
    gate = (mx + mn / 2, my + mn + 0.4)
    pts = [gate, (gate[0] + 0.8, gate[1] + 1.0), (gate[0] + 3.0, gate[1] + 1.1), (gate[0] + 6.0, gate[1] + 1.2),
           (gate[0] + 8.5, gate[1] + 2.1), (gate[0] + 12.0, gate[1] + 2.6), (gate[0] + 16.0, gate[1] + 2.3),
           (gate[0] + 24.0, gate[1] + 3.0)]
    road = [[m(x, y) for x, y in pts]]
    # darker grass and gravel patches, not under the buildings
    taken = [(x - 1, y - 1, x + n + 1, y + n + 1) for v in foot.values() for x, y, n in v]

    def free(x, y):
        return not any(a <= x <= c and b <= y <= d for a, b, c, d in taken)
    for _ in range(22):
        x, y = rnd.uniform(centre[0] - 13, centre[0] + 13), rnd.uniform(centre[1] - 10, centre[1] + 10)
        cx, cy = m(x, y)
        dark.append(_blob(cx, cy, rnd.uniform(2.0, 5.0), rnd.uniform(1.5, 3.5), rnd, n=12, j=0.3))
    for gx, gy in ((centre[0] + 8.5, centre[1] + 0.5), (centre[0] + 10.5, centre[1] - 6.5), (centre[0] - 9.0, centre[1] + 7.5)):
        cx, cy = m(gx, gy)
        gravel.append(_blob(cx, cy, rnd.uniform(2.0, 3.2), rnd.uniform(1.2, 2.0), rnd, n=12, j=0.3))
    # the small things: clumps, avoiding the buildings and the road
    kinds = ["flower"] * 5 + ["tuft"] * 8 + ["pebble"] * 4 + ["bush"]
    road_cells = [p for p in pts]
    for _ in range(170):
        x, y = rnd.uniform(centre[0] - 13, centre[0] + 13), rnd.uniform(centre[1] - 10, centre[1] + 10)
        if not free(x, y) or any(math.hypot(x - a, y - b) < 1.3 for a, b in road_cells):
            continue
        decals.append((rnd.choice(kinds), *m(x, y), rnd.uniform(0.8, 1.3)))
    return dict(dirt=dirt, gravel=gravel, dark=dark, road=road, decals=decals)


if __name__ == "__main__":
    p = plan()
    print({k: len(v) for k, v in p.items()})
