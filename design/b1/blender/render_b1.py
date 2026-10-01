"""Blender entry point for B1: build buildings, town pieces and resources one at a time and render them.

blender -b -t 2 --factory-startup --python render_b1.py -- job.json

job.json = {
  "px_per_m": 120, "emblem_dir": "...", "quality": "hq", "samples": {"beauty": 64, ...},
  "pieces": [{"kind": "house", "culture": "E", "state": "done", "opts": {}, "out": "/path/prefix",
              "passes": ["beauty", "mask", "shadow", "ao"], "probe": true}]
}
Writes <out>_<pass>.png and <out>.json: the anchor (the footprint centre on the ground) in the colour
frame, the shadow frame's own anchor (rendered at half size), the footprint, and with "probe" the
occlusion measurement (how much of a soldier standing behind the building still shows).

Every piece is built in a fresh scene, with the camera and lights of the unit renders (lib.Camera,
lib.make_lights), so buildings and units can be drawn together.
"""
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(1, os.path.join(HERE, "..", "..", "round2", "blender"))   # lib (R2: quality settings, passes)
sys.path.insert(2, os.path.join(HERE, "..", "..", "round1", "blender"))   # R1 buildings (roof, banner, lumpy)

args = sys.argv[sys.argv.index("--") + 1:]
job = json.load(open(args[0]))
os.environ["EMBLEM_DIR"] = job.get("emblem_dir", "")

import bpy                           # noqa: E402
from mathutils import Euler, Vector  # noqa: E402

import lib                           # noqa: E402
import kit                           # noqa: E402
import blds                          # noqa: E402
import towns                         # noqa: E402

REG = dict(blds.BUILDERS)
REG.update(towns.BUILDERS)
FOOT = dict(blds.FOOTPRINT)
FOOT.update(towns.FOOTPRINT)
HOUSES = ("th22", "th21", "th12", "th11")

lib.QUALITY = job.get("quality", "hq")
ppm = job["px_per_m"]
RM = Euler((60 * lib.D2R, 0, -45 * lib.D2R)).to_matrix()
RIGHT, UP = RM @ Vector((1, 0, 0)), RM @ Vector((0, 1, 0))
TO_CAM = RM @ Vector((0, 0, 1))
MARGIN = 0.35            # metres of room around the model in each frame


def fresh():
    """A new empty scene: lib's bookkeeping cleared, lights and the shadow-catcher ground."""
    for lst in (lib.ALL_PARTS, lib.FX_PARTS, lib.HULLS):
        lst.clear()
    for d in (lib.MATS, lib._ORIG, lib._OVR, lib.LIGHTS):
        d.clear()
    lib.GROUND = None
    lib.reset()
    lib.make_lights()
    lib.ground(80)
    bpy.context.scene.cycles.seed = 0


def corners():
    bpy.context.view_layer.update()
    pts = []
    for ob in lib.ALL_PARTS:
        if ob.hide_render:
            continue
        mw = ob.matrix_world
        pts += [mw @ Vector(c) for c in ob.bound_box]
    return pts


def extents(pts):
    xs = [0.0] + [p.dot(RIGHT) for p in pts]
    ys = [0.0] + [p.dot(UP) for p in pts]
    return -min(xs) + MARGIN, max(xs) + MARGIN, max(ys) + MARGIN, -min(ys) + MARGIN


def sun_dir():
    return lib.LIGHTS["warm"].matrix_world.to_3x3() @ Vector((0, 0, -1))


def shadow_points(pts):
    d = sun_dir()
    out = []
    for p in pts:
        if d.z < -1e-6 and p.z > 0:
            t = -p.z / d.z
            out.append(Vector((p.x + d.x * t, p.y + d.y * t, 0.0)))
    return out


def probe(fx, fy):
    """Occlusion test: a soldier (1.8 m) standing in the cells behind the building, along the two back
    faces (+x, +y) and at the back corner, k = 1..5 cells away. For each spot, how many metres of
    the soldier still show (rays from the soldier toward the camera that miss the building; three
    rays across the body, two of three must be clear). Returns per distance the worst spot and
    the mean, and the first distance where the worst spot shows its upper half (0.9 m)."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    sc = bpy.context.scene
    if lib.GROUND is not None:
        lib.GROUND.hide_viewport = True
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    hx, hy = fx * kit.CELL / 2, fy * kit.CELL / 2
    zs = [i * 0.05 for i in range(37)]           # 0 .. 1.8 m

    def shows(x, y):
        top_hidden = 0.0
        for z in zs:
            clear = 0
            for off in (-0.18, 0.0, 0.18):
                o = Vector((x, y, z)) + RIGHT * off
                hit = sc.ray_cast(dg, o + TO_CAM * 0.01, TO_CAM)[0]
                clear += 0 if hit else 1
            if clear < 2:
                top_hidden = z
        return round(max(0.0, 1.8 - top_hidden - 0.05) if top_hidden else 1.8, 2)

    res = {}
    for k in range(1, 6):
        d = (k - 0.5) * kit.CELL
        spots = []
        for i in range(fy):                       # behind the +x face
            spots.append(("x", i, shows(hx + d, -hy + (i + 0.5) * kit.CELL)))
        for i in range(fx):                       # behind the +y face
            spots.append(("y", i, shows(-hx + (i + 0.5) * kit.CELL, hy + d)))
        spots.append(("corner", 0, shows(hx + d, hy + d)))
        vals = [s[2] for s in spots]
        worst = min(spots, key=lambda s: s[2])
        res[k] = dict(worst=worst[2], worst_at=[worst[0], worst[1]], mean=round(sum(vals) / len(vals), 2),
                      spots=[list(s) for s in spots])
    upper = next((k for k in range(1, 6) if res[k]["worst"] >= 0.9), None)
    if lib.GROUND is not None:
        lib.GROUND.hide_viewport = False
    return dict(by_cells=res, upper_half_from_cells=upper)


t0 = time.time()
n = 0
for pc in job["pieces"]:
    fresh()
    root = lib.empty("root")
    kind, c = pc["kind"], pc["culture"]
    builder = REG[kind]
    builder(root, c, **pc.get("opts", {})) if pc.get("opts") else builder(root, c)
    st = pc.get("state", "done")
    if kind in blds.BUILDERS and st != "done":
        import states                # noqa: E402
        states.apply(root, kind, c, st, **pc.get("state_opts", {}))
    elif kind in HOUSES and st not in ("done", "intact"):
        towns.house_state(root, kind, c, st)
    elif kind == "ttower" and st not in ("done", "intact"):
        towns.tower_state(root, c, st)
    pts = corners()
    L, R, U, D = extents(pts)
    W, H = int(math.ceil((L + R) * ppm)), int(math.ceil((U + D) * ppm))
    anchor = (L * ppm, U * ppm)
    sL, sR, sU, sD = extents(pts + shadow_points(pts))
    sW, sH = int(math.ceil((sL + sR) * ppm / 2)), int(math.ceil((sU + sD) * ppm / 2))
    s_anchor = (sL * ppm / 2, sU * ppm / 2)
    cam = lib.Camera(W, H, ppm, anchor)
    fx, fy = FOOT.get(kind, (1, 1))
    smoke_at = [list(o.matrix_world.translation) for o in bpy.data.objects if o.name.startswith("smoke_at")]
    smoke = [dict(pos=list(o.matrix_world.translation), h=o["smoke"][0], r0=o["smoke"][1], r1=o["smoke"][2],
                  dark=o["smoke"][3], alpha=o["smoke"][4], drift=[o["smoke"][5], o["smoke"][6]])
             for o in bpy.data.objects if "smoke" in o.keys()]
    meta = dict(kind=kind, culture=c, state=pc.get("state", "done"), footprint=[fx, fy], cell_m=kit.CELL,
                smoke_at=smoke_at, smoke=smoke, opts={k: v for k, v in pc.get("opts", {}).items() if k != "plan"},
                anchor=list(anchor), size=[W, H], px_per_m=ppm, shadow_anchor=list(s_anchor), shadow_size=[sW, sH],
                top_m=round(max((p.z for p in pts), default=0.0), 2))
    if pc.get("probe"):
        meta["probe"] = probe(fx, fy)
    for p in pc["passes"]:
        lib.set_pass(p, job.get("samples", {}).get(p))
        for ob in lib.ALL_PARTS:                 # smoke and flames: colour image only
            if ob.get("beauty_only") and p != "beauty":
                ob.hide_render = True
        if p == "shadow":
            cam.set(sW, sH, ppm / 2, s_anchor)
            if "rim" in lib.LIGHTS:
                lib.LIGHTS["rim"].hide_render = True
        lib.render(f"{pc['out']}_{p}.png")
        if p == "shadow":
            cam.set(W, H, ppm, anchor)
        n += 1
    with open(pc["out"] + ".json", "w") as f:
        json.dump(meta, f)
    print(f"PIECE {kind} {c} {pc.get('state', 'done')}: {W}x{H} px, top {meta['top_m']} m"
          + (f", upper half from {meta['probe']['upper_half_from_cells']} cells" if pc.get("probe") else ""), flush=True)
print(f"RENDERED {n} images in {time.time() - t0:.1f}s")
