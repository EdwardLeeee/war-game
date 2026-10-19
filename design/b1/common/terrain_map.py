"""R6-51 (the user 2026-10-20: 「地形感覺可以多元一點，石頭好少 我覺得這種天然障礙物可以多些來擋路可能會更好玩」): a first
layout of the natural obstacles on the fixed map, for war-game-core to check (D-089's batch: the sim changes, saved games
end). Base: core's fixed-map-base-grid.json (96 x 96, mirrored on the diagonal x <-> y).

New cells (core gives them protocol values later): R rock (heaps, ridges), K cliff, ~ water (river, lake), f ford,
= bridge, F forest that cannot be cut (乙); forest that can be cut (甲) stays T. Everything is drawn on player 0's side
(x < y, the main city at the bottom left) and mirrored; features on the diagonal are their own mirrors. Rules (core
2026-10-20): `-` cells stay clear; fords and bridges 3 cells wide; rivers 2-3, ridges 1-2, cliffs 1; walking is
8-way without cutting a blocked corner. Detours (ceo): main city to main city 1.1-1.4 times the obstacle-free walk,
main city to any town at most 1.6.

python3 common/terrain_map.py BASE.json OUT_DIR   -> OUT_DIR/fixed-map-terrain-grid.json, …-terrain.png, report
"""
import heapq
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

BLOCK = set("R#K~FWMT")          # T (trees) blocks until it is cut; counted as blocked for the detours
KEEP = set("-WDiOMGBC")          # never overwritten


def load(p):
    d = json.loads(Path(p).read_text())
    return d, [list(r) for r in d["rows"]]


def put(g, x, y, ch):
    n = len(g)
    if 0 <= x < n and 0 <= y < n and g[y][x] not in KEEP:
        g[y][x] = ch


def line(g, pts, width, ch):
    """Cells within width/2 of the polyline (cell middles)."""
    n = len(g)
    r = width / 2
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        L = math.hypot(x1 - x0, y1 - y0)
        for y in range(max(0, int(min(y0, y1) - r - 2)), min(n, int(max(y0, y1) + r + 3))):
            for x in range(max(0, int(min(x0, x1) - r - 2)), min(n, int(max(x0, x1) + r + 3))):
                px, py = x + 0.5, y + 0.5
                t = max(0, min(1, ((px - x0) * (x1 - x0) + (py - y0) * (y1 - y0)) / (L * L))) if L else 0
                if math.hypot(px - (x0 + t * (x1 - x0)), py - (y0 + t * (y1 - y0))) <= r:
                    put(g, x, y, ch)


def blob(g, cx, cy, rx, ry, ch):
    for y in range(int(cy - ry - 1), int(cy + ry + 2)):
        for x in range(int(cx - rx - 1), int(cx + rx + 2)):
            if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1:
                put(g, x, y, ch)


def crossing(g, pts, t, ch, width=3, across=5):
    """A ford or bridge 3 cells wide across the river at fraction t of the polyline: the river cells there turn into
    `ch`, `across` cells long so the river's whole width is crossed."""
    segs = list(zip(pts, pts[1:]))
    lens = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in segs]
    s = t * sum(lens)
    for (a, b), L in zip(segs, lens):
        if s <= L:
            break
        s -= L
    ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
    cx, cy = a[0] + ux * s, a[1] + uy * s
    for i in range(-across // 2 * 2, across // 2 * 2 + 1):
        for j in range(-(width // 2) * 2, (width // 2) * 2 + 1):
            px, py = cx + (-uy) * i * 0.5 + ux * j * 0.5, cy + ux * i * 0.5 + uy * j * 0.5
            x, y = int(px), int(py)
            if 0 <= y < len(g) and 0 <= x < len(g) and g[y][x] == "~":
                g[y][x] = ch
    return (cx, cy)


def mirror(g):
    """Copy player 0's side (x < y) onto player 1's (x > y); the diagonal is kept as drawn."""
    n = len(g)
    for y in range(n):
        for x in range(n):
            if x < y:
                g[x][y] = g[y][x]


def walk(g, starts, goals):
    """8-way walking cost from the start cells to the nearest goal cell; diagonal 1.414, no cutting blocked corners."""
    n = len(g)
    goals = set(goals)
    dist = {s: 0.0 for s in starts}
    q = [(0.0, s) for s in starts]
    heapq.heapify(q)
    while q:
        d, (x, y) = heapq.heappop(q)
        if (x, y) in goals:
            return d
        if d > dist.get((x, y), 1e9):
            continue
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if not dx and not dy:
                    continue
                nx, ny = x + dx, y + dy
                if not (0 <= nx < n and 0 <= ny < n) or g[ny][nx] in BLOCK and (nx, ny) not in goals:
                    continue
                if dx and dy and (g[y][nx] in BLOCK or g[ny][x] in BLOCK):
                    continue
                nd = d + (1.414 if dx and dy else 1.0)
                if nd < dist.get((nx, ny), 1e9):
                    dist[(nx, ny)] = nd
                    heapq.heappush(q, (nd, (nx, ny)))
    return math.inf


def ring_of(g, chars):
    """The walkable cells next to a group of cells (a main city's door cells)."""
    n = len(g)
    cells = {(x, y) for y in range(n) for x in range(n) if g[y][x] in chars}
    out = set()
    for x, y in cells:
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                p = (x + dx, y + dy)
                if 0 <= p[0] < n and 0 <= p[1] < n and p not in cells and g[p[1]][p[0]] not in BLOCK:
                    out.add(p)
    return out


def draw(g):
    """Player 0's features. Returns the crossings, for the report."""
    marks = {}
    # 1. each home's river, between the main city and the middle: from the west edge, round the home, to the south edge
    river = [(0.0, 57.0), (12.0, 58.5), (24.0, 61.0), (32.0, 65.5), (37.5, 72.0), (40.0, 80.0), (40.5, 88.0), (41.0, 96.0)]
    line(g, river, 2.6, "~")
    marks["bridge (home to the middle and the north-west towns)"] = crossing(g, river, 0.28, "=")
    marks["ford (home to the south-east town)"] = crossing(g, river, 0.86, "f")
    # 2. a rock ridge west of the middle with a 3-cell gap, and the two rock heaps there made longer
    line(g, [(22.0, 42.0), (28.0, 46.0)], 1.6, "R")
    line(g, [(32.0, 48.5), (38.0, 52.0)], 1.6, "R")
    blob(g, 15.0, 46.0, 3.2, 2.6, "R")
    # 3. a cliff on the home side of the south-east town's road
    line(g, [(52.0, 70.0), (56.0, 75.0), (57.0, 82.0)], 1.0, "K")
    # 4. a lake on the diagonal between the middle and the south-east town (its own mirror)
    blob(g, 63.0, 63.0, 4.2, 4.2, "~")
    # 5. forests: one that cannot be cut beside the home's river (乙), the rest stay trees (甲)
    blob(g, 30.0, 86.0, 3.5, 2.6, "F")
    blob(g, 6.0, 70.0, 2.6, 3.4, "T")
    return marks


COL = {".": (120, 150, 90), "-": (176, 170, 132), "#": (100, 98, 94), "R": (128, 122, 112), "K": (90, 70, 56), "~": (60, 110, 170),
       "f": (130, 170, 196), "=": (170, 120, 70), "F": (26, 64, 30), "T": (44, 96, 42), "G": (230, 200, 40), "B": (200, 40, 80),
       "C": (60, 200, 220), "M": (40, 90, 220), "W": (60, 50, 40), "D": (240, 170, 60), "i": (215, 205, 185), "O": (160, 60, 50)}


def picture(g, path, k=7):
    n = len(g)
    im = Image.new("RGB", (n * k, n * k))
    dr = ImageDraw.Draw(im)
    for y in range(n):
        for x in range(n):
            dr.rectangle([x * k, y * k, x * k + k - 1, y * k + k - 1], fill=COL[g[y][x]])
    im.save(path)
    return im


def main(base, out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    meta, g0 = load(base)
    n = len(g0)
    open_g = [["." if ch in "T#" else ch for ch in r] for r in g0]       # nothing in the way but the castles and cities
    open_g = [[ch if ch not in "W" else "." for ch in r] for r in open_g]
    g = [r[:] for r in g0]
    marks = draw(g)
    mirror(g)
    for y in range(n):
        for x in range(n):
            if g0[y][x] in KEEP and g[y][x] != g0[y][x]:
                raise SystemExit(f"cell {x},{y} must stay {g0[y][x]!r}")
    # the detours
    m0 = ring_of([[c if not (c == "M" and x > y) else "." for x, c in enumerate(r)] for y, r in enumerate(g)], "M")
    m1 = {(y, x) for x, y in m0}
    towns = {}
    for y in range(n):
        for x in range(n):
            if g[y][x] == "i":
                towns.setdefault((x // 1, y // 1), None)
    # a town's goal: any cell inside its walls; group the inside cells by castle
    insides, seen = [], set()
    for (x, y) in list(towns):
        if (x, y) in seen:
            continue
        st, comp = [(x, y)], set()
        while st:
            p = st.pop()
            if p in comp:
                continue
            comp.add(p)
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                q = (p[0] + dx, p[1] + dy)
                if 0 <= q[0] < n and 0 <= q[1] < n and g[q[1]][q[0]] in "iO" and q not in comp:
                    st.append(q)
        seen |= comp
        insides.append(comp)
    rep = {}
    base_mm = walk(open_g, m0, m1)
    rep["main to main"] = (walk(g0, m0, m1) / base_mm, walk(g, m0, m1) / base_mm)
    for k, comp in enumerate(sorted(insides, key=lambda c: min(c))):
        cx = sum(p[0] for p in comp) / len(comp)
        b = walk(open_g, m0, comp)
        rep[f"main 0 to the town at ({cx:.0f}, {cx:.0f})"] = (walk(g0, m0, comp) / b, walk(g, m0, comp) / b)
        b1 = walk(open_g, m1, comp)
        rep[f"main 1 to the town at ({cx:.0f}, {cx:.0f})"] = (walk(g0, m1, comp) / b1, walk(g, m1, comp) / b1)
    rows = ["".join(r) for r in g]
    from collections import Counter
    cnt = Counter("".join(rows))
    res = dict(meta, rows=rows, legend=dict(meta["legend"], R="rock: heaps and ridges (blocks)", K="cliff (blocks)",
                                           **{"~": "water: river, lake (blocks)"}, f="ford (walkable, 3 wide)",
                                           **{"=": "bridge (walkable, 3 wide)"}, F="forest that cannot be cut (乙, blocks)"),
               note="R6-51 first layout by war-game-ui (2026-10-20), for war-game-core to check; T stays the forest that can be cut (甲)",
               detours={k: [round(a, 3), round(b, 3)] for k, (a, b) in rep.items()}, crossings={k: [round(v, 1) for v in p] for k, p in marks.items()})
    (out / "fixed-map-terrain-grid.json").write_text(json.dumps(res, ensure_ascii=False, indent=1) + "\n")
    picture(g, out / "fixed-map-terrain.png")
    print({k: v for k, v in cnt.items() if k in "R#K~f=FT"})
    for k, (a, b) in rep.items():
        print(f"{k}: now {a:.2f}, with the obstacles {b:.2f}")
    print("crossings", marks)


if __name__ == "__main__":
    main(*sys.argv[1:3])
