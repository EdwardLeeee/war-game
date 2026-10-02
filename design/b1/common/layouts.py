"""B1-03: the proposed town layouts (for ceo and war-game-core to confirm before they go into the sim).

Cells are 2 m (client M_PER_CELL, provisional). Both layouts are the same when turned by 90 degrees
(and mirrored), so every approach into the town is the same; the streets are 3 (small town) and
4 (big city) cells wide, enough for a siege engine.

Small town (radius 5 cells, sim/src/core/rules.ts TOWNS): the centre is the middle of a cell, as in
the sim (townX/townY + half a cell). A 3 x 3 square in the middle with the flagpole on the centre
cell; four streets 3 cells wide; in each quarter a 2 x 2 house and two 2 x 1 / 1 x 2 houses.

Big city (radius 7 cells): the sim puts the 2 x 2 tower with its corner on the town's centre cell
(map.ts tower = centre - 1), so the tower's middle is a cell corner, half a cell from the centre
the sim measures the radius from. The layout is symmetric about the tower's middle; we propose that
the sim measures the big city's radius from there too (otherwise the circle is 0.7 m off). A 6 x 6
square round the tower; four avenues 4 cells wide; in each quarter a 2 x 2 house, two 1 x 2 / 2 x 1
houses, two longer ones on the edge and a garden.

Cell kinds: square, street, garden (walkable, flat); house (blocks: the piece standing on it);
tower (blocks while it stands; the sim frees it when it is torn down); outside.
"""
import math

CELL = 2.0


def _quarters(pieces_q):
    """Mirror one quarter's pieces (kind, ci, cj in quarter cell units) into all four quarters."""
    out = []
    for sx in (1, -1):
        for sy in (1, -1):
            for kind, ci, cj, var in pieces_q:
                out.append((kind, sx * ci, sy * cj, var + (0 if sx > 0 else 1) + (0 if sy > 0 else 2)))
    return out


def small():
    """Cells (i, j): integers, cell centre (i, j) x CELL from the town centre."""
    R = 5
    cells = {}
    for i in range(-R, R + 1):
        for j in range(-R, R + 1):
            if i * i + j * j > R * R:
                continue
            if max(abs(i), abs(j)) <= 1:
                cells[(i, j)] = "square"
            elif abs(i) <= 1 or abs(j) <= 1:
                cells[(i, j)] = "street"
            else:
                cells[(i, j)] = "garden"
    # quarter (+, +): 2 x 2 at cells 2..3 x 2..3 (centre 2.5, 2.5); th21 at 2..3 x 4; th12 at 4 x 2..3
    q = [("th22", 2.5, 2.5, 0), ("th21", 2.5, 4.0, 0), ("th12", 4.0, 2.5, 0)]
    pieces = _quarters(q)
    for kind, ci, cj, _ in pieces:
        fx, fy = {"th22": (2, 2), "th21": (2, 1), "th12": (1, 2), "th11": (1, 1)}[kind]
        for a in range(fx):
            for b in range(fy):
                cells[(round(ci - (fx - 1) / 2 + a), round(cj - (fy - 1) / 2 + b))] = "house"
    # the map is mirrored along its diagonal (x <-> y): every post is its own mirror or has its mirror in the
    # list (ceo and war-game-core 2026-10-02): the square's four corners, one cell right of and below the centre
    militia = [(-1, -1), (1, -1), (-1, 1), (1, 1), (1, 0), (0, 1)]      # cell units
    garrison = [(-0.5, -0.5)]
    flag = (0.0, 0.0)
    return dict(name="small", radius=R, centre=(0.0, 0.0), cells=cells, pieces=pieces, militia=militia,
                garrison=garrison, flag=flag, tower=None, posts=_posts(R, 1.5 + 0.0, (0.0, 0.0)),
                cell_centre=lambda i, j: (i, j))


def large():
    """Cells (i, j): integers, cell centre (i + 0.5, j + 0.5) x CELL from the tower's middle."""
    R = 7
    cells = {}
    for i in range(-R, R):
        for j in range(-R, R):
            a, b = i + 0.5, j + 0.5
            if a * a + b * b > R * R:
                continue
            if i in (-1, 0) and j in (-1, 0):
                cells[(i, j)] = "tower"
            elif max(abs(a), abs(b)) <= 2.5:
                cells[(i, j)] = "square"
            elif abs(a) <= 1.5 or abs(b) <= 1.5:
                cells[(i, j)] = "street"
            else:
                cells[(i, j)] = "garden"
    # quarter (+, +) in cell-centre units a, b (= i + 0.5): 2 x 2 at a, b 3.5..4.5 (centre 4, 4);
    # 1 x 2 at a 2.5, b 3.5..4.5 and its mirror; 1 x 2 at a 2.5, b 5.5..6.5 and its mirror; gardens at (3.5, 5.5)
    q = [("th22", 4.0, 4.0, 0), ("th12", 2.5, 4.0, 1), ("th21", 4.0, 2.5, 1), ("th12", 2.5, 6.0, 2),
         ("th21", 6.0, 2.5, 2)]
    pieces = _quarters(q)
    for kind, ca, cb, _ in pieces:
        fx, fy = {"th22": (2, 2), "th21": (2, 1), "th12": (1, 2), "th11": (1, 1)}[kind]
        for u in range(fx):
            for v in range(fy):
                a = ca - (fx - 1) / 2 + u
                b = cb - (fy - 1) / 2 + v
                cells[(int(math.floor(a)), int(math.floor(b)))] = "house"
    militia = [(1.5, 0.5), (1.5, -0.5), (-1.5, 0.5), (-1.5, -0.5), (0.5, 1.5), (-0.5, 1.5), (0.5, -1.5), (-0.5, -1.5),
               (2.5, 2.5), (-2.5, 2.5), (2.5, -2.5), (-2.5, -2.5)]
    garrison = [(-1.0, -2.2), (-2.2, -1.0), (-1.5, -1.5)]
    flag = (-2.0, -2.0)            # the front corner of the square, between the militia posts
    return dict(name="large", radius=R, centre=(0.0, 0.0), cells=cells, pieces=pieces, militia=militia,
                garrison=garrison, flag=flag, tower=(0.0, 0.0), posts=_posts(R, 2.0 + 0.3, (0.0, 0.0)),
                cell_centre=lambda i, j: (i + 0.5, j + 0.5))


def _posts(R, half_street, centre):
    """Boundary posts on the circle (direction B): two flanking each street mouth, one on each diagonal."""
    out = []
    a0 = math.degrees(math.asin(min(1.0, (half_street + 0.4) / R)))
    for base in (0, 90, 180, 270):
        for s in (-1, 1):
            out.append(base + s * a0)
    out += [45, 135, 225, 315]
    return [(centre[0] + R * math.cos(math.radians(a)), centre[1] + R * math.sin(math.radians(a))) for a in sorted(out)]


def piece_fp(kind):
    return {"th22": (2, 2), "th21": (2, 1), "th12": (1, 2), "th11": (1, 1)}[kind]


def ground_plan(L):
    """[(x, y, kind)] in metres for the ground piece."""
    out = []
    for (i, j), k in L["cells"].items():
        if k in ("square", "street", "garden", "tower"):
            k = "square" if k == "tower" else k        # paved under the tower (seen once it is torn down)
            a, b = L["cell_centre"](i, j)
            out.append((a * CELL, b * CELL, k))
    return out


def counts(L):
    from collections import Counter
    return Counter(L["cells"].values())


if __name__ == "__main__":
    for L in (small(), large()):
        print(L["name"], dict(counts(L)), len(L["pieces"]), "houses")
