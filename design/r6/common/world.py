"""R6-23: the world interface (drawn by the game on the battlefield, client/src/render/world.ts): battlefield images
with the ground effects baked in, and the screen points the mock (app.js PIECES.world) draws the rest at.

world.build(art, out) -> out/field-<a|b>-world.png, field-<a|b>-town.png, field-<a|b>-fog.png, out/world.js
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import field      # noqa: E402
import scene_r6   # noqa: E402

EFFECTS = HERE.parents[1] / "production" / "build" / "effects_x3"


def warn_circle(tick=20):
    """The 晶砲 warning circle B at a tick (0..29), put together from the six still images by the client's recipe
    (design/b1/README.md): returns (RGBA, ax, ay) at 3x, squashed onto the ground."""
    man = json.loads((EFFECTS / "effects.json").read_text())
    page = Image.open(EFFECTS / "effects_0.png").convert("RGBA")
    k = tick / 29
    t = k * 1.5
    pulse = 0.5 + 0.5 * math.cos(2 * math.pi * (3 * t + 2 * t * t))
    rot = 20 * t
    size = 420
    can = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    def put(name, a, rotate=0.0, scale=1.0):
        f = man["frames"][f"{name}_00"]
        im = page.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"]))
        if scale != 1.0:
            im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
        if rotate:
            im = im.rotate(-rotate, resample=Image.BICUBIC, expand=True)
        arr = np.asarray(im, np.float32).copy()
        arr[..., 3] *= max(0.0, min(1.0, a))
        im = Image.fromarray(arr.astype(np.uint8), "RGBA")
        can.alpha_composite(im, (size // 2 - im.width // 2, size // 2 - im.height // 2))
    sig = min(1, (0.45 + 0.55 * k) * (0.8 + 0.2 * pulse))
    put("warn_fill", (0.12 + 0.35 * k) * (0.75 + 0.25 * pulse))
    put("warn_sigil_glow", 0.6 * sig, rot)
    put("warn_rim", 1.0)
    put("warn_sigil", sig, rot)
    put("warn_sigil_gold", sig * 0.7 * k, rot)
    flat = can.resize((size, size // 2), Image.LANCZOS)
    return flat, size / 2, size / 4


def fog(img, centre, home=(20, 72), seen=7, explored=11):
    """Darken what is explored but not in sight now, black out the rest (INV-146): by distance from home, in cells."""
    W, H = img.size
    scale = W / field.SCREEN[0]
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32) / scale
    cx, cy = field.pt_to_cell(xs, ys, centre)
    d = np.hypot(cx - home[0], cy - home[1])
    k = np.where(d < seen, 1.0, np.where(d < explored, 0.45, 0.0))
    soft = np.asarray(Image.fromarray((k * 255).astype(np.uint8)).resize((W // 8, H // 8), Image.BILINEAR).resize((W, H), Image.BILINEAR),
                      np.float32) / 255.0
    arr = np.asarray(img.convert("RGB"), np.float32) * soft[..., None]
    return Image.fromarray(arr.clip(0, 255).astype(np.uint8), "RGB")


def pts(cells, centre):
    return [[round(v, 1) for v in field.cell_to_pt(x, y, centre)] for x, y in cells]


def build(art, out, rings):
    data = {}
    sc = scene_r6.world()
    c = sc["centre"]
    wimg, wax, way = warn_circle(20)
    sc = dict(sc, decals=[(wimg, wax, way, *sc["warn"])])
    for t, ring in rings.items():
        img, ov = field.render(dict(sc, ring=ring), art)
        img.convert("RGB").save(out / f"field-{t}-world.png")
    mage = ov["selected"][0]
    bl = {}
    batl = field.building_atlas(art, "E")
    for cc, btype, st, x, y, team in sc["buildings"]:
        b = batl.m["buildings"][btype]
        n = b["footprint"][0]
        fr = b["states"].get(st) or b["crops"][-1]
        e = batl.frame(fr)
        mid = field.cell_to_pt(x + n / 2, y + n / 2, c)
        # the corner mark's point: the diamond's right corner; oblique, the middle of the right edge (INV-140)
        mark = field.cell_to_pt(x + n, y + (n / 2 if field.VIEW == "oblique" else 0), c)
        bl.setdefault(btype + ("" if btype != "House" else f"-{st}"), []).append(dict(
            foot=pts(((x, y), (x + n, y), (x + n, y + n), (x, y + n)), c), top=round(mid[1] - e["ay"] / 3, 1),
            right=round(mid[0] + (e["w"] - e["ax"]) / 3, 1), mid=[round(v, 1) for v in mid], w=round(field.foot_w(n), 1),
            mark=[round(v, 1) for v in mark]))
    data["world"] = dict(mage=dict(x=round(mage["x"], 1), y=round(mage["y"], 1), top=round(mage["top"], 1)), buildings=bl,
                         rally=[round(v, 1) for v in field.cell_to_pt(*scene_r6.cell(560, 150), c)],
                         enemy=[round(v, 1) for v in field.cell_to_pt(*sc["warn"], c)])
    ts = scene_r6.town()
    for t, ring in rings.items():
        img, _ = field.render(ts, art)
        img.convert("RGB").save(out / f"field-{t}-town.png")
    tc = ts["centre"]
    r = 6.0
    ring_pts = [field.cell_to_pt(tc[0] + 0.5 + r * math.cos(a), tc[1] + 0.5 + r * math.sin(a), tc) for a in np.linspace(0, 2 * math.pi, 48)]
    wall = pts(((tc[0] - 1, tc[1] - 1), (tc[0] + 2, tc[1] - 1), (tc[0] + 2, tc[1] + 2), (tc[0] - 1, tc[1] + 2)), tc)
    data["town"] = dict(ring=[[round(x, 1), round(y, 1)] for x, y in ring_pts], wall=wall,
                        label=[round(v, 1) for v in field.cell_to_pt(tc[0] + 2, tc[1] + 2, tc)])
    # R6-31: a house ordered while the game is paused: the building see-through where it will stand, in the open
    # ground left of the fields (clear of the message bar and the buttons), on the plain battlefield
    px, py = 130, 335
    hx, hy = scene_r6.footprint_at(px, py, 2)
    plain, _ = field.render(scene_r6.representative(), art)
    body, ax, ay = batl.body(batl.m["buildings"]["House"]["states"]["done"], "blue")
    arr = np.asarray(body, np.float32).copy()
    arr[..., 3] *= 0.5
    gx, gy = field.cell_to_pt(hx + 1, hy + 1, c)
    plain.alpha_composite(Image.fromarray(arr.astype(np.uint8), "RGBA"), (int(round(gx * 3 - ax)), int(round(gy * 3 - ay))))
    for t in rings:
        plain.convert("RGB").save(out / f"field-{t}-planned.png")
    data["world"]["planned"] = dict(foot=pts(((hx, hy), (hx + 2, hy), (hx + 2, hy + 2), (hx, hy + 2)), c),
                                    mid=[round(v, 1) for v in (gx, gy)])
    # R6-31: the same house placed while the game runs: its foundation, and the farmer sent to build it on the way
    sc2 = scene_r6.representative()
    wx, wy = field.pt_to_cell(px - 80, py - 6, c)
    placed, _ = field.render(dict(sc2, buildings=sc2["buildings"] + [("E", "House", "build1", hx, hy, "blue")],
                                  units=sc2["units"] + [("farmer_e", "blue", wx, wy, 0, "walk", 2, False)]), art)
    for t in rings:
        placed.convert("RGB").save(out / f"field-{t}-placed.png")
    base, _ = field.render(scene_r6.representative(), art)
    for t in rings:
        fog(base, scene_r6.CENTRE).save(out / f"field-{t}-fog.png")
    grass = field.ground(field.SCREEN[0] * 3, field.SCREEN[1] * 3).convert("RGB")
    for t in rings:
        grass.save(out / f"field-{t}-grass.png")
    (out / "world.js").write_text("window.R6_WORLD = " + json.dumps(data, ensure_ascii=False) + ";\n")
    return data
