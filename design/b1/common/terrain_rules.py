"""Which terrain frames the client draws, and where (art-v5, R6-51; the Terrain values are war-game-core's, PR #245,
sim/PROTOCOL.md 3.6): worked out from each cell's Terrain value and its neighbours only. The reference for the
client's code and for atlas-buildings.md section 12; the R6 boards draw the terrain with it.

  pieces(T, W, H) -> [dict(frame, x, y, front, ground)], T(x, y) the Terrain value of a cell (off the map: the
                     nearest cell's), x, y the anchor in cells (a cell spans x .. x + 1), front the draw order key
                     (as the buildings' and units' front edge, D-088), ground True for the ground layer
                     (drawn under everything that stands, in the order GROUND_ORDER, no shadow)

Run as a script it composes a stretch of the fixed map from the renders, for checking the joins:
  python3 common/terrain_rules.py GRID.json RAW ART OUT.png [cx cy]
    GRID  war-game-core's fixed-map-final-grid.json (rows, terrain)
    RAW   the terrain renders (run.py prod_terrain_*) or a packed terrain/terrain.json (3x); ART an extracted
          art-vN-x3 (trees, buildings)
"""
VALUES = dict(Open=0, Rock=1, Wall=2, Water=3, Ford=4, BridgeNS=5, BridgeEW=6, Cliff=7)
WET = (3, 4, 5, 6)                       # water for the banks: fords and bridges stand in the river
ROCK_VARIANTS = 6
CLIFF_POSTS = 2
FORDS = 2
GROUND_ORDER = ("water", "ford", "deck")


def variant(x, y, n):
    """A cell's look among n, the same on every device: small integers only."""
    return (x * 31 + y * 17 + ((x ^ y) & 7)) % n


def cliff_links(at, x, y):
    """The directions (dx, dy) a cliff cell joins its neighbours in: the four sides, and a corner only where neither
    side cell between is cliff."""
    out = []
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            if (dx, dy) == (0, 0) or at(x + dx, y + dy) != 7:
                continue
            if dx and dy and (at(x + dx, y) == 7 or at(x, y + dy) == 7):
                continue
            out.append((dx, dy))
    return out


def pieces(T, W, H):
    out = []

    def at(x, y):
        return T(min(W - 1, max(0, x)), min(H - 1, max(0, y)))

    # water: one tile on every cell corner (X, Y) whose four cells are not all dry, picked by which are wet
    for Y in range(H + 1):
        for X in range(W + 1):
            m = sum(b for b, (dx, dy) in ((1, (-1, -1)), (2, (0, -1)), (4, (-1, 0)), (8, (0, 0)))
                    if at(X + dx, Y + dy) in WET)
            if m:
                out.append(dict(frame=f"terrain_water_m{m}", x=X, y=Y, front=Y, ground="water"))
    for y in range(H):
        for x in range(W):
            v = T(x, y)
            cx, cy = x + 0.5, y + 0.5
            if v == 1:
                out.append(dict(frame=f"terrain_rock_v{variant(x, y, ROCK_VARIANTS)}", x=cx, y=cy, front=y + 1))
            elif v == 4:
                out.append(dict(frame=f"terrain_ford_v{variant(x, y, FORDS)}", x=cx, y=cy, front=y + 1, ground="ford"))
            elif v in (5, 6):
                ns = v == 5
                out.append(dict(frame=f"terrain_bridge_deck_{'ns' if ns else 'ew'}", x=cx, y=cy, front=y + 1, ground="deck"))
                # the rails on the bridge's two long sides: where the next cell across the way is not this bridge
                if ns:
                    if at(x - 1, y) != 5:
                        out.append(dict(frame="terrain_bridge_rail_y", x=x, y=cy, front=y + 1))
                    if at(x + 1, y) != 5:
                        out.append(dict(frame="terrain_bridge_rail_y", x=x + 1, y=cy, front=y + 1))
                else:
                    if at(x, y - 1) != 6:
                        out.append(dict(frame="terrain_bridge_rail_x", x=cx, y=y, front=y + 0.01))
                    if at(x, y + 1) != 6:
                        out.append(dict(frame="terrain_bridge_rail_x", x=cx, y=y + 1, front=y + 1))
            elif v == 7:
                # the rock face: an arm to each cliff neighbour E, S, and SE / SW only where the two cells between
                # are not cliff (a staircase line joins through them instead); a post where the line turns, ends or
                # branches (arms in a straight run overlap into one face); the arms are drawn just before the posts
                # of their southern row so the posts cover the joins
                links = cliff_links(at, x, y)
                straight = len(links) == 2 and links[0][0] == -links[1][0] and links[0][1] == -links[1][1]
                if not straight:
                    out.append(dict(frame=f"terrain_cliff_post_v{variant(x, y, CLIFF_POSTS)}", x=cx, y=cy, front=y + 1))
                if at(x + 1, y) == 7 and x + 1 < W:
                    out.append(dict(frame="terrain_cliff_arm_E", x=x + 1, y=cy, front=y + 0.99))
                if at(x, y + 1) == 7 and y + 1 < H:
                    out.append(dict(frame="terrain_cliff_arm_S", x=cx, y=y + 1, front=y + 1.99))
                if at(x + 1, y + 1) == 7 and at(x + 1, y) != 7 and at(x, y + 1) != 7 and x + 1 < W and y + 1 < H:
                    out.append(dict(frame="terrain_cliff_arm_SE", x=x + 1, y=y + 1, front=y + 1.99))
                if at(x - 1, y + 1) == 7 and at(x - 1, y) != 7 and at(x, y + 1) != 7 and x > 0 and y + 1 < H:
                    out.append(dict(frame="terrain_cliff_arm_SW", x=x, y=y + 1, front=y + 1.99))
    return out


def frames():
    """Every frame the rules can ask for (the atlas packs these)."""
    return sorted([f"terrain_water_m{m}" for m in range(1, 16)]
                  + [f"terrain_rock_v{v}" for v in range(ROCK_VARIANTS)]
                  + [f"terrain_cliff_post_v{v}" for v in range(CLIFF_POSTS)]
                  + [f"terrain_cliff_arm_{d}" for d in ("E", "S", "SE", "SW")]
                  + [f"terrain_ford_v{v}" for v in range(FORDS)]
                  + [f"terrain_bridge_deck_{a}" for a in ("ns", "ew")]
                  + [f"terrain_bridge_rail_{a}" for a in ("x", "y")])


def scene(grid, raw, cx, cy, span=(22, 22)):
    """A field.render scene of the fixed map round (cx, cy): the terrain from the renders in `raw`, the trees and
    resource points from the art (the battlefield's own nodes), no buildings."""
    import field
    import rawart
    rows, terr = grid["rows"], grid["terrain"]
    W = H = len(rows)

    def T(x, y):
        return terr[y * W + x]
    atl = field.Atlas(raw) if str(raw).endswith(".json") else rawart.RawAtlas(raw)
    x0, x1, y0, y1 = cx - span[0] // 2, cx + span[0] // 2, cy - span[1] // 2, cy + span[1] // 2
    props = []
    order = {k: i for i, k in enumerate(GROUND_ORDER)}
    for p in pieces(T, W, H):
        if not (x0 - 1 <= p["x"] <= x1 + 1 and y0 - 1 <= p["y"] <= y1 + 1):
            continue
        g = p.get("ground")
        # field sorts the ground layer by front too: the water first, then the fords, then the decks
        props.append(dict(atlas=atl, frame=p["frame"], x=p["x"], y=p["y"],
                          front=(-3000 + 1000 * order[g] + p["front"]) if g else p["front"], ground=bool(g)))
    nodes = []
    for y in range(max(0, y0 - 1), min(H, y1 + 2)):
        for x in range(max(0, x0 - 1), min(W, x1 + 2)):
            ch = rows[y][x]
            if ch == "T":
                nodes.append((f"tree_E_v{variant(x, y, 3)}", x, y))
            elif ch == "G":
                nodes.append(("gold_v0_full", x, y))
            elif ch == "B":
                nodes.append(("berry_v0_full", x, y))
            elif ch == "C":
                nodes.append(("crystal_v0_full", x, y))
    return dict(centre=(cx, cy), props=props, nodes=nodes, units=[], buildings=[])


if __name__ == "__main__":
    import json
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "r6" / "common"))
    import field  # noqa: E402
    grid = json.loads(Path(sys.argv[1]).read_text())
    cx, cy = (int(sys.argv[5]), int(sys.argv[6])) if len(sys.argv) > 6 else (18, 55)
    field.VIEW = "oblique"
    img, _ = field.render(scene(grid, sys.argv[2], cx, cy), sys.argv[3], scale=3)
    img.convert("RGB").save(sys.argv[4])
