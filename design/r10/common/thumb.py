"""R10-02 B: the small terrain map of the chosen random map, from the simulation's own cells (sim/src/map-grid.ts).
Only what a player can read as ground: water, bridges, fords, rock, cliffs, forest. No towns, mines or bases: on this
map they are still found by scouting, as on any random map.

python3 design/r10/common/thumb.py GRID.json OUT.png   (node sim/src/map-grid.ts --map random --seed 2106939660 > GRID.json)
"""
import json
import sys

from PIL import Image, ImageDraw

GRASS = (86, 118, 66)                  # the R6 minimap's (design/r6/common/minimap.py)
ROCK = (110, 102, 92)
FOREST = (40, 74, 38)
WATER = (58, 104, 140)
FORD = (112, 160, 178)
BRIDGE = (186, 146, 88)
CLIFF = (54, 46, 40)
CELL = {".": GRASS, "T": FOREST, "R": ROCK, "~": WATER, "f": FORD, "|": BRIDGE, "=": BRIDGE, "K": CLIFF}


# drawn thicker than they are (cells round each one, in draw order: thin rivers vanish at 92 pt, and they are the point)
THICK = (("T", 0), ("R", 1), ("K", 1), ("~", 2), ("f", 2), ("|", 2), ("=", 2))


def main(grid, out, px=4):
    d = json.load(open(grid))
    n = d["size"]
    im = Image.new("RGB", (n * px, n * px), GRASS)           # W, O, M, G, B, C: left as grass
    dr = ImageDraw.Draw(im)
    for chars, r in THICK:
        for y, row in enumerate(d["rows"]):
            for x, ch in enumerate(row):
                if ch == chars:
                    dr.rectangle([(x - r) * px, (y - r) * px, (x + r + 1) * px - 1, (y + r + 1) * px - 1], fill=CELL[ch])
    im.save(out)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
