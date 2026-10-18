"""R6: the battlefield behind the interface boards, put together from the production atlases (art-v2: units,
buildings, resource points) the way the client draws them (client/docs/sprite-atlas.md, design/b1/atlas-buildings.md).

field.render(scene, art_dir, scale=3) -> (RGBA image of the 814 x 380 pt screen at `scale` px per pt, overlay data)

The screen is the diamond battlefield (D-085, ceo 2026-10-18): map (0, 0) at the top corner, sim +x down-right,
+y down-left; at zoom 1 a cell's diamond is 56.6 pt wide (PT_PER_M 20, 2 m cells). The 3x atlases are 60 px a metre,
so at scale 3 every sprite is drawn 1:1. Ground layer first (fields, stumps), then every shadow, then units and
buildings far to near; the player colour tints the team layer (multiply), as the client does.
"""
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

SCREEN = (814, 380)
HALF_W = 28.284          # pt: half a cell's diamond, across
HALF_H = 14.142          # pt: half a cell's diamond, down
TEAM = {"blue": (46, 110, 214), "red": (200, 48, 44), "neutral": (216, 210, 192)}
GROUND = (112, 126, 92)


def cell_to_pt(x, y, centre):
    """Sim cell (fractional) -> screen pt, the camera on `centre`."""
    dx, dy = x - centre[0], y - centre[1]
    return SCREEN[0] / 2 + (dx - dy) * HALF_W, SCREEN[1] / 2 + (dx + dy) * HALF_H


def pt_to_cell(px, py, centre):
    u = (px - SCREEN[0] / 2) / HALF_W
    v = (py - SCREEN[1] / 2) / HALF_H
    return centre[0] + (u + v) / 2, centre[1] + (v - u) / 2


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

    def shadow(self, name):
        s = self._crop("shadow", "shadows", name)
        if not s:
            return None
        si, sax, say = s
        a = si.getchannel("A")
        img = Image.merge("RGBA", (Image.new("L", a.size, 0),) * 3 + (a,))
        return img.resize((img.width * 2, img.height * 2), Image.BILINEAR), sax * 2, say * 2


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


def render(scene, art, scale=3):
    """scene: dict(centre=(x, y), units=[(unit, team, x, y, facing, anim, frame, selected)], buildings=[(kind atlas
    'E'|'W', BuildingType name, state, cellX, cellY, team)], nodes=[(frame, x, y)]). Returns (image, overlay) where
    overlay lists the selected units' screen points (pt) and the visible buildings' boxes, for the interface layer."""
    art = Path(art)
    W, H = SCREEN[0] * scale, SCREEN[1] * scale
    s = scale / 3.0                                   # the atlases are 3x
    img = ground(W, H)
    centre = scene["centre"]
    batl = {c: Atlas(art / "buildings" / f"buildings_{c}.json") for c in ("E", "W")}
    natl = Atlas(art / "nodes" / "nodes.json")
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
        entry = (mx + my, body, ax * s, ay * s, gx, gy)
        (ground_items if b.get("ground") else items).append(entry)
        sh = a.shadow(fr)
        if sh and not b.get("ground"):
            shadows.append((sh[0], sh[1] * s, sh[2] * s, gx, gy))
    for fr, x, y in scene.get("nodes", []):
        body, ax, ay = natl.body(fr, "neutral")
        gx, gy = at(x + 0.5, y + 0.5)
        entry = (x + y + 1, body, ax * s, ay * s, gx, gy)
        (ground_items if fr.endswith(("stump", "depleted")) else items).append(entry)
        sh = natl.shadow(fr)
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
        items.append((x + y, body, ax * s, ay * s, gx, gy))
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
    """Cells of a block formation (密集: 1 cell apart) centred on (cx, cy), front row first along +x - y."""
    out = []
    for r in range(rows):
        for c in range(cols):
            u = (c - (cols - 1) / 2) * gap
            v = (r - (rows - 1) / 2) * gap
            out.append((cx + u * 0.7 + v * 0.7, cy - u * 0.7 + v * 0.7))
    return out


if __name__ == "__main__":
    import sys
    sc = dict(centre=(40, 40), units=[("spear_e", "blue", 40, 40, 7, "idle", 0, True)])
    im, ov = render(sc, sys.argv[1])
    im.save(sys.argv[2])
    print(im.size, ov)
