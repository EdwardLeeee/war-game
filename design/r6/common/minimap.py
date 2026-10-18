"""R6: the minimap image for the boards (a stand-in drawn from a made-up 96 x 96 map like the fixed map: our base at
the left spawn, the enemy's at the right one still in the fog, a small town and the big city between), in the two
shapes of R6-03:

square   the map's grid as it is (+x right, +y down): the camera's view is a tilted frame, because the battlefield
         is drawn turned 45 degrees (D-085);
diamond  the map turned like the battlefield and flattened 2:1: north is up as on the screen, the camera's view is a
         plain rectangle.
"""
import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from field import SCREEN, pt_to_cell

N = 96
GRASS = (86, 118, 66)
ROCK = (110, 102, 92)
FOREST = (40, 74, 38)
GOLD = (242, 194, 48)
CRYSTAL = (122, 240, 255)
OWN = (79, 143, 240)
OWN_UNIT = (156, 196, 255)
ENEMY = (224, 71, 61)
NEUTRAL = (216, 210, 192)


def world(seed=3):
    """RGB cells (N x N) and a 0 / 0.55 / 1 visibility mask."""
    rng = np.random.default_rng(seed)
    img = np.zeros((N, N, 3), np.float32)
    img[:] = GRASS
    yy, xx = np.mgrid[0:N, 0:N]
    noise = rng.standard_normal((N, N)) * 6
    img += noise[..., None]
    for cx, cy, r in ((40, 30, 7), (60, 70, 6), (14, 40, 5), (76, 54, 6)):
        img[(xx - cx) ** 2 + (yy - cy) ** 2 < r * r] = ROCK
    for cx, cy, r in ((30, 58, 6), (22, 88, 5), (52, 80, 7), (64, 30, 7), (82, 34, 6), (10, 62, 4), (44, 14, 6), (88, 70, 5)):
        m = ((xx - cx) ** 2 + (yy - cy) ** 2 < r * r) & (rng.random((N, N)) < 0.75)
        img[m] = FOREST
    for x, y in ((25, 70), (26, 71), (70, 24), (71, 25), (47, 60), (60, 47)):
        img[y, x] = GOLD
    for x, y in ((38, 40), (56, 56)):
        img[y, x] = CRYSTAL
    vis = np.zeros((N, N), np.float32)
    d_home = np.hypot(xx - 20, yy - 72)
    vis[d_home < 34] = 0.55                                   # explored by 6:42
    vis[d_home < 18] = 1.0                                    # in sight now
    for cx, cy, r in ((36, 58, 12), (48, 48, 12), (60, 70, 8)):   # scouted toward the towns
        m = np.hypot(xx - cx, yy - cy) < r
        vis[m] = np.maximum(vis[m], 0.55)
    vis[np.hypot(xx - 30, yy - 69) < 8] = 1.0                 # the squad's sight
    return img, vis


def marks(dr, to_px, s, scene):
    """The scene's buildings and units, the towns, in minimap pixels."""
    sizes = {"MainCity": 4, "Farm": 3, "Barracks": 3, "Range": 3, "MageHall": 3, "Stable": 3}
    for c, btype, st, x, y, team in scene["buildings"]:
        n = sizes.get(btype, 2)
        pts = [to_px(x, y), to_px(x + n, y), to_px(x + n, y + n), to_px(x, y + n)]
        dr.polygon(pts, fill=OWN if team == "blue" else ENEMY)
    for unit, team, x, y, *_ in scene["units"]:
        px, py = to_px(x, y)
        dr.ellipse([px - s, py - s, px + s, py + s], fill=OWN_UNIT if team == "blue" else ENEMY)
    for (x, y), r in (((36, 58), 4), ((48, 48), 6)):
        pts = [to_px(x + r * math.cos(a), y + r * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 40)]
        dr.line(pts + [pts[0]], fill=NEUTRAL, width=max(1, int(s)))


def camera_poly(centre, to_px):
    corners = [pt_to_cell(px, py, centre) for px, py in ((0, 0), (SCREEN[0], 0), SCREEN, (0, SCREEN[1]))]
    return [to_px(x, y) for x, y in corners]


def square(size_px, scene, k=4):
    img, vis = world()
    S = size_px * k
    cells = Image.fromarray((img * vis[..., None]).clip(0, 255).astype(np.uint8), "RGB").resize((S, S), Image.NEAREST)
    can = cells.convert("RGBA")
    dr = ImageDraw.Draw(can)
    to_px = lambda x, y: (x / N * S, y / N * S)
    marks(dr, to_px, 1.2 * k * size_px / 312, scene)
    cam = camera_poly(scene["centre"], to_px)
    dr.line(cam + [cam[0]], fill=(255, 255, 255, 235), width=int(2.2 * k * size_px / 312))
    return can.resize((size_px, size_px), Image.LANCZOS)


def diamond(w_px, scene, k=4, mode="mid"):
    """The map turned 45 degrees and flattened 2:1, like the battlefield: width w, height w / 2.
    mode: mid (6:42 in), start (a random map just begun: only home seen), hit (two places under attack: red
    rings), hint (the opening hint's cyan ring on the nearest small town)."""
    img, vis = world()
    if mode == "start":
        yy, xx = np.mgrid[0:N, 0:N]
        vis = np.where(np.hypot(xx - 20, yy - 72) < 14, 1.0, 0.0).astype(np.float32)
    W, H = w_px * k, w_px * k // 2
    # every output pixel back to a cell: u = x - y in [-N, N], v = x + y in [0, 2N]
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    u = (xs / W) * 2 * N - N
    v = (ys / H) * 2 * N
    cx = (u + v) / 2
    cy = (v - u) / 2
    inside = (cx >= 0) & (cx < N) & (cy >= 0) & (cy < N)
    ix = np.clip(cx.astype(int), 0, N - 1)
    iy = np.clip(cy.astype(int), 0, N - 1)
    rgb = (img * vis[..., None])[iy, ix]
    out = np.zeros((H, W, 4), np.float32)
    out[..., :3] = rgb
    out[..., 3] = inside * 255
    can = Image.fromarray(out.clip(0, 255).astype(np.uint8), "RGBA")
    dr = ImageDraw.Draw(can)
    to_px = lambda x, y: ((x - y + N) / (2 * N) * W, (x + y) / (2 * N) * H)
    marks(dr, to_px, 1.2 * k * w_px / 492, scene)
    cam = camera_poly(scene["centre"], to_px)
    dr.line(cam + [cam[0]], fill=(255, 255, 255, 235), width=int(2.2 * k * w_px / 492))
    unit = k * w_px / 492
    if mode == "hit":                       # where something is under attack: a red dot and its pulse ring
        for x, y in ((26, 74), (40, 60)):
            px, py = to_px(x, y)
            dr.ellipse([px - 5 * unit, py - 5 * unit, px + 5 * unit, py + 5 * unit], fill=(255, 59, 48, 255))
            dr.ellipse([px - 11 * unit, py - 11 * unit, px + 11 * unit, py + 11 * unit], outline=(255, 59, 48, 220), width=int(2.5 * unit))
    if mode == "hint":                      # the opening hint: the nearest small town, a thick cyan ring
        px, py = to_px(36, 58)
        for r, w in ((26, 7), (18, 4)):
            dr.ellipse([px - r * unit, py - r * 0.55 * unit, px + r * unit, py + r * 0.55 * unit], outline=(122, 240, 255, 255), width=int(w * unit))
    # a thin rim along the map's edge
    edge = [to_px(0, 0), to_px(N, 0), to_px(N, N), to_px(0, N)]
    dr.line(edge + [edge[0]], fill=(0, 0, 0, 200), width=int(1.5 * k))
    return can.resize((w_px, w_px // 2), Image.LANCZOS)
