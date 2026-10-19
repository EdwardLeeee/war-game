"""R6 representative battlefield (brief B.2, ceo 2026-10-18): the diamond battlefield near our base, one squad of
ours selected (6 spearmen, 4 crossbowmen) facing an enemy squad coming in, our main city, houses, barracks and a
field, trees and a gold mine. Positions are given on the screen (pt) and turned into cells, so the composition is
set by eye; the camera is on CENTRE.
"""
from field import pt_to_cell, squad

CENTRE = (24.0, 70.0)          # near our spawn (16, 78), the left corner of the diamond


def cell(px, py):
    return pt_to_cell(px, py, CENTRE)


def footprint_at(px, py, n):
    """Top-left cell of an n x n footprint whose centre is drawn at (px, py)."""
    x, y = cell(px, py)
    return round(x - n / 2), round(y - n / 2)


# where things are drawn (pt), per camera: the diamond composition, and the oblique one (D-088) after R6-04 甲, which
# the user saw (the square cells are narrower, so the diamond's places crowd the buildings together)
LAYOUT = {
    "diamond": dict(
        buildings=(("MainCity", "done", (215, 118), 4), ("House", "done", (330, 62), 2), ("House", "done", (120, 178), 2),
                   ("Barracks", "done", (352, 140), 3), ("Farm", "ripe", (205, 222), 3), ("Farm", "growing", (300, 252), 3),
                   ("ArrowTower", "done", (448, 92), 2)),
        trees=((560, 52), (600, 70), (640, 48), (668, 84), (615, 104), (700, 60), (560, 92), (645, 128), (520, 70), (690, 116)),
        gold=((626, 168), (652, 184)), squad=(470, 190), enemy=(642, 252),
        farmers=((176, 214), (232, 236), (300, 236)), near_house=(120, 178),
        mage=(470, 196), guards=(430, 176), raid=(250, 262), raid_farmers=((176, 214), (205, 238)),
        rally=(560, 150), world_tower=None),
    "oblique": dict(
        buildings=(("MainCity", "done", (170, 150), 4), ("House", "done", (300, 92), 2), ("House", "done", (84, 252), 2),
                   ("Barracks", "done", (318, 182), 3), ("Farm", "ripe", (230, 262), 3), ("Farm", "growing", (360, 282), 3),
                   ("ArrowTower", "done", (44, 160), 2)),
        trees=((560, 52), (604, 72), (648, 48), (676, 92), (612, 112), (700, 58), (556, 98), (652, 136), (520, 66), (734, 104)),
        gold=((630, 196), (672, 206)), squad=(500, 165), enemy=(670, 262),
        farmers=((200, 262), (256, 252), (150, 222)), near_house=(84, 252),
        mage=(500, 176), guards=(452, 150), raid=(250, 292), raid_farmers=((200, 262), (230, 280)),
        # R6-23: the arrow tower within range of the enemy squad (it shoots, INV-145), the rally point clear of it
        rally=(455, 228), world_tower=(600, 140)),
}


def L():
    import field
    return LAYOUT[field.VIEW]


def representative():
    lay = L()
    b = []
    for btype, st, (px, py), n in lay["buildings"]:
        x, y = footprint_at(px, py, n)
        b.append(("E", btype, st, x, y, "blue"))
    nodes = []
    for i, (px, py) in enumerate(lay["trees"]):
        x, y = cell(px, py)
        nodes.append((f"tree_E_v{i % 3}", int(x), int(y)))
    for v, (px, py) in enumerate(lay["gold"]):
        x, y = cell(px, py)
        nodes.append((f"gold_v{v}_full", int(x), int(y)))
    units = []
    sx, sy = cell(*lay["squad"])
    pos = squad(sx, sy, 5, 2)
    for i, (x, y) in enumerate(pos):              # front row 5 spearmen; back row 1 spearman, 4 crossbowmen
        units.append(("spear_e" if i < 6 else "xbow_e", "blue", x, y, 7, "idle", (i * 3) % 8, True))
    ex, ey = cell(*lay["enemy"])
    for i, (x, y) in enumerate(squad(ex, ey, 4, 2)):
        units.append(("pike_w" if i < 4 else "bow_w", "red", x, y, 3, "walk", (i * 2) % 8, False))
    for i, (px, py) in enumerate(lay["farmers"]):
        x, y = cell(px, py)
        units.append(("farmer_e", "blue", x, y, (6, 7, 0)[i], "idle", i * 2, False))
    return dict(centre=CENTRE, buildings=b, nodes=nodes, units=units)


def raid():
    """Home is hit (NEW-02, INV-37): an enemy squad at our fields attacking the farmers; nothing of ours selected."""
    sc = representative()
    units = [u for u in sc["units"] if u[1] == "blue" and u[0] != "farmer_e"]
    units = [(u[0], u[1], u[2], u[3], u[4], u[5], u[6], False) for u in units]
    ex, ey = cell(*L()["raid"])
    for i, (x, y) in enumerate(squad(ex, ey, 3, 2)):
        units.append(("pike_w" if i < 3 else "bow_w", "red", x, y, 3, "attack", (i * 3) % 10, False))
    for i, (px, py) in enumerate(L()["raid_farmers"]):
        x, y = cell(px, py)
        units.append(("farmer_e", "blue", x, y, 7, "walk", i * 3, False))
    return dict(sc, units=units)


def world():
    """R6-23: the world interface on our base. Our mage selected and calibrating the 晶砲 on the enemy squad (its
    warning circle on the ground), the barracks with a rally point, a house going up, the arrow tower shooting."""
    sc = representative()
    lay = L()
    b = sc["buildings"]
    nodes = sc["nodes"]
    if lay["world_tower"]:
        tx, ty = footprint_at(*lay["world_tower"], 2)
        b = [x if x[1] != "ArrowTower" else (*x[:3], tx, ty, x[5]) for x in b]
        nodes = [n for n in nodes if not (tx - 1.5 <= n[1] <= tx + 2.5 and ty - 2.5 <= n[2] <= ty + 2.5)]
    hx, hy = footprint_at(*lay["near_house"], 2)         # the house nearest the camera is going up
    b = [x for x in b if not (x[1] == "House" and x[3] == hx and x[4] == hy)] + [("E", "House", "build2", hx, hy, "blue")]
    mx, my = cell(*lay["mage"])
    units = [("mage_e", "blue", mx, my, 7, "idle", 0, True)]
    for i, (x, y) in enumerate(squad(*cell(*lay["guards"]), 3, 1)):
        units.append(("spear_e", "blue", x, y, 7, "idle", i * 2, False))
    ex, ey = cell(*lay["enemy"])
    for i, (x, y) in enumerate(squad(ex, ey, 4, 2)):
        units.append(("pike_w" if i < 4 else "bow_w", "red", x, y, 3, "walk", (i * 2) % 8, False))
    for i, (px, py) in enumerate(lay["farmers"][:2]):
        x, y = cell(px, py)
        units.append(("farmer_e", "blue", x, y, (6, 7)[i], "idle", i * 2, False))
    return dict(sc, buildings=b, nodes=nodes, units=units, warn=(ex, ey))


def town():
    """R6-23: the small town near home (cell 36, 58), its militia (neutral) and our squad coming in."""
    c = (36.0, 58.0)
    nodes = []
    for i, (dx, dy) in enumerate(((-6, -4), (-7, -2), (-5, -6), (6, -5), (7, -3), (5, 6), (-6, 5), (8, 2))):
        nodes.append((f"tree_W_v{i % 3}", int(c[0] + dx), int(c[1] + dy)))
    units = [("spear_e", "neutral", c[0] + dx, c[1] + dy, 6, "idle", i * 2, False)
             for i, (dx, dy) in enumerate(((-0.8, 0.6), (0.9, -0.5), (0.4, 1.2)))]
    for i, (x, y) in enumerate(squad(c[0] - 3.5, c[1] + 3.5, 3, 2)):
        units.append(("spear_e" if i < 3 else "xbow_e", "blue", x, y, 1, "walk", i, False))
    return dict(centre=c, buildings=[], nodes=nodes, units=units, town=c)
