"""R6: the battlefield behind the interface boards, put together from the production atlases (art-v2: units,
buildings, resource points) the way the client draws them (client/docs/sprite-atlas.md, design/b1/atlas-buildings.md).

field.render(scene, art_dir, scale=3) -> (RGBA image of the 814 x 380 pt screen at `scale` px per pt, overlay data)

Two cameras (VIEW, set before drawing):
- "diamond" (art-v1, art-v2; D-085): map (0, 0) at the top corner, sim +x down-right, +y down-left; at zoom 1 a cell's
  diamond is 56.6 pt wide (PT_PER_M 20, 2 m cells). Far to near = x + y.
- "oblique" (方形斜看, art-v3 on; D-088, the user 2026-10-19): square to the grid, sim +x right, +y down; a cell is
  40 x 20 pt. Far to near = the front edge's y (a building cellY + n, a resource point cellY + 1, a unit its y), then x
  (design/b1/atlas-buildings.md 6, agreed with client 2026-10-19).
The 3x atlases are 60 px a metre, so at scale 3 every sprite is drawn 1:1. Ground layer first (fields, stumps), then
every shadow, then units and buildings far to near; the player colour tints the team layer (multiply), as the client
does.
"""
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

SCREEN = (814, 380)
HALF_W = 28.284          # pt: half a cell's diamond, across
HALF_H = 14.142          # pt: half a cell's diamond, down
CELL_W, CELL_D = 40.0, 20.0   # pt: a cell across and down, oblique
VIEW = "diamond"
OVERRIDE = {}            # "E", "W", "nodes": atlases to draw from in place of the art's (rawart.use)
# the player colours the user chose (R6-24 甲, 2026-10-18): 藍 紅 黃 紫, and the neutral
TEAM = {"blue": (0x3f, 0x7f, 0xe0), "red": (0xd9, 0x43, 0x3a), "yellow": (0xe8, 0xc4, 0x2e), "purple": (0x9a, 0x5c, 0xe0),
        "neutral": (0xd8, 0xd2, 0xc0)}
GROUND = (112, 126, 92)


def cell_to_pt(x, y, centre):
    """Sim cell (fractional) -> screen pt, the camera on `centre`."""
    dx, dy = x - centre[0], y - centre[1]
    if VIEW == "oblique":
        return SCREEN[0] / 2 + dx * CELL_W, SCREEN[1] / 2 + dy * CELL_D
    return SCREEN[0] / 2 + (dx - dy) * HALF_W, SCREEN[1] / 2 + (dx + dy) * HALF_H


def pt_to_cell(px, py, centre):
    if VIEW == "oblique":
        return centre[0] + (px - SCREEN[0] / 2) / CELL_W, centre[1] + (py - SCREEN[1] / 2) / CELL_D
    u = (px - SCREEN[0] / 2) / HALF_W
    v = (py - SCREEN[1] / 2) / HALF_H
    return centre[0] + (u + v) / 2, centre[1] + (v - u) / 2


def depth(x, y, n=0.0):
    """Far to near: x, y the footprint's corner (n cells; a unit: its point, n = 0)."""
    if VIEW == "oblique":
        return (y + n, x)
    return (x + y + n, 0.0)


class Atlas:
    def __init__(self, path):
        path = Path(path)
        self.m = json.loads(path.read_text())
        self.pages = {k: [Image.open(path.parent / p).convert("RGBA" if k != "shadow" else "LA") for p in v]
                      for k, v in self.m["pages"].items() if v}

    def _crop(self, layer, table, name):
        e = self.m.get(table, {}).get(name)
        if not e:
            return None
        pg = self.pages[layer][e["page"]]
        return pg.crop((e["x"], e["y"], e["x"] + e["w"], e["y"] + e["h"])), e["ax"], e["ay"]

    def body(self, name, team):
        """Colour with the tinted player colour over it: (image, ax, ay)."""
        col, ax, ay = self._crop("color", "frames", name)
        img = col.copy()
        t = self._crop("team", "team", name) if "team" in self.pages else None
        if t:
            ti, tax, tay = t
            arr = np.asarray(ti, np.float32)
            arr[..., :3] *= np.array(TEAM[team], np.float32) / 255.0
            img.alpha_composite(Image.fromarray(arr.astype(np.uint8), "RGBA"), (int(round(ax - tax)), int(round(ay - tay))))
        return img, ax, ay

    def frame(self, name):
        return self.m["frames"][name]

    def shadow(self, name):
        s = self._crop("shadow", "shadows", name)
        if not s:
            return None
        si, sax, say = s
        a = si.getchannel("A")
        img = Image.merge("RGBA", (Image.new("L", a.size, 0),) * 3 + (a,))
        return img.resize((img.width * 2, img.height * 2), Image.BILINEAR), sax * 2, say * 2


def building_atlas(art, c):
    return OVERRIDE.get(c) or Atlas(Path(art) / "buildings" / f"buildings_{c}.json")


def foot_w(n):
    """pt: an n-cell footprint across the screen."""
    return n * CELL_W if VIEW == "oblique" else n * 2 * HALF_W


def ground(w, h, seed=5):
    """Plain meadow (the terrain is B2's): the B1 ground colour, soft large patches, a fine grain."""
    rng = np.random.default_rng(seed)
    big = rng.standard_normal((h // 64 + 2, w // 64 + 2)).astype(np.float32)
    big = np.asarray(Image.fromarray(((big * 0.5 + 0.5).clip(0, 1) * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC),
                     np.float32) / 255.0 - 0.5
    fine = rng.standard_normal((h, w)).astype(np.float32) * 0.025
    base = np.array(GROUND, np.float32)[None, None, :]
    tint = np.array([0.94, 1.04, 0.92], np.float32)[None, None, :]
    img = base * (1 + big[..., None] * 0.10 * tint + fine[..., None])
    return Image.fromarray(img.clip(0, 255).astype(np.uint8), "RGB").convert("RGBA")


def render(scene, art, scale=3, atlases=None):
    """scene: dict(centre=(x, y), units=[(unit, team, x, y, facing, anim, frame, selected)], buildings=[(kind atlas
    'E'|'W', BuildingType name, state, cellX, cellY, team)], nodes=[(frame, x, y)]). Returns (image, overlay) where
    overlay lists the selected units' screen points (pt) and the visible buildings' boxes, for the interface layer.
    atlases: {"E": .., "W": ..} in place of the art's building atlases (the same interface as Atlas)."""
    art = Path(art)
    W, H = SCREEN[0] * scale, SCREEN[1] * scale
    s = scale / 3.0                                   # the atlases are 3x
    img = ground(W, H)
    centre = scene["centre"]
    batl = atlases or {c: building_atlas(art, c) for c in ("E", "W")}
    natl = OVERRIDE.get("nodes") or Atlas(art / "nodes" / "nodes.json")
    uatl = {}
    ground_items, items, shadows = [], [], []
    overlay = {"selected": [], "units": []}

    def at(x, y):
        px, py = cell_to_pt(x, y, centre)
        return px * scale, py * scale

    for c, btype, state, cx, cy, team in scene.get("buildings", []):
        a = batl[c]
        b = a.m["buildings"][btype]
        n = b["footprint"][0]
        fr = b["states"].get(state) or (b.get("crops") or [None])[{"sown": 0, "growing": 1, "ripe": 2}.get(state, 2)]
        body, ax, ay = a.body(fr, team)
        mx, my = cx + n / 2, cy + n / 2
        gx, gy = at(mx, my)
        entry = (depth(cx, cy, n), body, ax * s, ay * s, gx, gy)
        (ground_items if b.get("ground") else items).append(entry)
        sh = a.shadow(fr)
        if sh and not b.get("ground"):
            shadows.append((sh[0], sh[1] * s, sh[2] * s, gx, gy))
    for fr, x, y in scene.get("nodes", []):
        body, ax, ay = natl.body(fr, "neutral")
        gx, gy = at(x + 0.5, y + 0.5)
        entry = (depth(x, y, 1), body, ax * s, ay * s, gx, gy)
        (ground_items if fr.endswith(("stump", "depleted")) else items).append(entry)
        sh = natl.shadow(fr)
        if sh:
            shadows.append((sh[0], sh[1] * s, sh[2] * s, gx, gy))
    # other pieces (R6-06: a town's paving, houses, landmark, posts): dict(atlas, frame, x, y (the anchor, cells),
    # front (the footprint's front-edge y, for the order), team, ground)
    for pc in scene.get("props", []):
        body, ax, ay = pc["atlas"].body(pc["frame"], pc.get("team", "neutral"))
        gx, gy = at(pc["x"], pc["y"])
        entry = ((pc["front"], pc["x"]) if VIEW == "oblique" else (pc["x"] + pc["y"], 0.0), body, ax * s, ay * s, gx, gy)
        (ground_items if pc.get("ground") else items).append(entry)
        sh = pc["atlas"].shadow(pc["frame"]) if not pc.get("ground") else None
        if sh:
            shadows.append((sh[0], sh[1] * s, sh[2] * s, gx, gy))
    for unit, team, x, y, facing, anim, frame, selected in scene.get("units", []):
        if unit not in uatl:
            uatl[unit] = Atlas(art / "units" / unit / f"{unit}.json")
        a = uatl[unit]
        mirrored = a.m["facings"]["mirrored"]
        f_draw = mirrored.get(str(facing), facing)
        name = f"{unit}_{anim}_f{f_draw}_{frame:02d}"
        body, ax, ay = a.body(name, team)
        if str(facing) in mirrored:
            body = body.transpose(Image.FLIP_LEFT_RIGHT)
            ax = body.width - ax
        gx, gy = at(x, y)
        items.append((depth(x, y), body, ax * s, ay * s, gx, gy))
        sh = a.shadow(f"{unit}_{anim}_f{facing}_{frame:02d}")
        if sh:
            shadows.append((sh[0], sh[1] * s, sh[2] * s, gx, gy))
        rec = dict(x=gx / scale, y=gy / scale, unit=unit, team=team, top=(gy - ay * s) / scale)
        overlay["units"].append(rec)
        if selected:
            overlay["selected"].append(rec)

    def paste(im, ax, ay, gx, gy):
        if s != 1:
            im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
        img.alpha_composite(im, (int(round(gx - ax)), int(round(gy - ay))))

    for _, im, ax, ay, gx, gy in sorted(ground_items, key=lambda t: t[0]):
        paste(im, ax, ay, gx, gy)
    for im, ax, ay, x, y in scene.get("decals", []):          # ground effects (the warning circle), under every unit
        gx, gy = at(x, y)
        img.alpha_composite(im, (int(round(gx - ax)), int(round(gy - ay))))
    sh_layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    for im, ax, ay, gx, gy in shadows:
        if s != 1:
            im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.BILINEAR)
        sh_layer.alpha_composite(im, (int(round(gx - ax)), int(round(gy - ay))))
    img.alpha_composite(sh_layer.filter(ImageFilter.GaussianBlur(1.2 * scale / 3)))
    ring = scene.get("ring")              # (RGBA, line width in pt): the selection ring on the ground, under the unit
    if ring:
        from PIL import ImageDraw
        k = 4                             # drawn 4x and scaled down, for smooth edges
        rl = Image.new("RGBA", (img.width * k // 2, img.height * k // 2), (0, 0, 0, 0))
        dr = ImageDraw.Draw(rl)
        rx = 0.62 * 20 * scale * k / 2
        for rec in overlay["selected"]:
            cx, cy = rec["x"] * scale * k / 2, rec["y"] * scale * k / 2
            dr.ellipse([cx - rx, cy - rx / 2, cx + rx, cy + rx / 2], outline=ring[0], width=int(ring[1] * scale * k / 2))
        img.alpha_composite(rl.resize(img.size, Image.LANCZOS))
    for _, im, ax, ay, gx, gy in sorted(items, key=lambda t: t[0]):
        paste(im, ax, ay, gx, gy)
    return img, overlay


def squad(cx, cy, cols, rows, gap=1.0):
    """Cells of a block formation (密集: 1 cell apart) centred on (cx, cy), front row first along the screen's
    across (diamond: +x - y; oblique: +x)."""
    out = []
    for r in range(rows):
        for c in range(cols):
            u = (c - (cols - 1) / 2) * gap
            v = (r - (rows - 1) / 2) * gap
            if VIEW == "oblique":
                out.append((cx + u, cy + v))
            else:
                out.append((cx + u * 0.7 + v * 0.7, cy - u * 0.7 + v * 0.7))
    return out


if __name__ == "__main__":
    import sys
    sc = dict(centre=(40, 40), units=[("spear_e", "blue", 40, 40, 7, "idle", 0, True)])
    im, ov = render(sc, sys.argv[1])
    im.save(sys.argv[2])
    print(im.size, ov)
