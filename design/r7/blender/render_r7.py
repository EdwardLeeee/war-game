"""R7 (D-092) Blender entry point: one version of the realism comparison, rendered with the R7 light (look.lights) and
the square oblique camera (D-088, 30 degrees, 60 px a metre at 3x).

blender -b -t N --factory-startup --python render_r7.py -- job.json
  job = {"version": 1, "tex_dir": ".../build/tex", "emblem_dir": "...", "out": ".../build/v1", "samples": 64,
         "items": [{"what": "scene"},
                   {"what": "unit", "kind": "spear_e", "team": "blue", "anim": "walk", "frames": 8, "facing": 7}]}
  scene: out/scene_x3.png, the 12 x 8 cell battlefield: ground (ground_r7), barracks, a blue and a red spearman
         and crossbowman each; out/scene_x3.json (the anchor, the size)
  unit:  out/<kind>_<team>_<anim>_f<facing>_<k>.png, one frame each, on a transparent background with the shadow
         (the ground a shadow catcher), for the GIFs and the side-by-side strips
"""
import gc
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
DESIGN = os.path.join(HERE, "..", "..")
sys.path.insert(0, HERE)
for i, p in enumerate(("production", "round5", "round4", "round3", "round2", "round1")):
    sys.path.insert(1 + i, os.path.join(DESIGN, p, "blender"))
sys.path.insert(1, os.path.join(DESIGN, "b1", "blender"))

job = json.load(open(sys.argv[sys.argv.index("--") + 1:][0]))
os.environ["EMBLEM_DIR"] = job.get("emblem_dir", "")

import bpy                                # noqa: E402
import numpy as np                        # noqa: E402
from mathutils import Euler, Vector       # noqa: E402

import lib                                # noqa: E402
import units                              # noqa: E402,F401
lib.QUALITY = "hq"
lib.CAM_ELEV, lib.CAM_AZ = 30.0, 0.0      # the square oblique view (D-088)
import units5                             # noqa: E402
import anims                              # noqa: E402
import body2                              # noqa: E402
import look                               # noqa: E402

V = job["version"]
PPM = job.get("px_per_m", 60)
OUT = job["out"]
os.makedirs(OUT, exist_ok=True)
TEAM = {"blue": (0x3f, 0x7f, 0xe0), "red": (0xd9, 0x43, 0x3a)}      # field.TEAM, sRGB
HEAD = 0.88          # version 1: the head (and its helmet) at 0.88: about 1/7.5 of the height, as a real man's
UNIT_ARGS = {"spear_e": (1, None), "xbow_e": (0, None)}     # (variant, mage style) as production (spec.UNITS)


def lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def tex_path(tid, k):
    res = "2k" if tid in ("leafy_grass", "aerial_grass_rock", "stony_dirt_path", "gravel_ground_01",
                          "brown_mud_rocks_01") else "1k"
    return os.path.join(job["tex_dir"], f"{tid}_{k}_{res}.jpg")


def fresh():
    for lst in (lib.ALL_PARTS, lib.FX_PARTS, lib.HULLS):
        lst.clear()
    for d in (lib.MATS, lib._ORIG, lib._OVR, lib.LIGHTS):
        d.clear()
    lib.GROUND = None
    lib.reset()
    lib.make_lights()
    lib.ground(80)
    bpy.context.scene.cycles.seed = 0


def under(ob, root):
    while ob is not None:
        if ob == root:
            return True
        ob = ob.parent
    return False


def make_unit(kind, team, x, y, facing, anim, frame, n):
    """One approved unit (as production), its own team-colour material; returns (unit, its objects)."""
    before = {id(o) for o in gc.get_objects() if isinstance(o, body2.Skinner)}
    variant, style = UNIT_ARGS[kind]
    u = units5.build(kind, variant, style)
    u = anims.extend(u, kind, style)
    for ob in lib.FX_PARTS:
        ob["fx_on"] = False
        ob.hide_render = True
    sks = [o for o in gc.get_objects() if isinstance(o, body2.Skinner) and id(o) not in before]
    if V >= 1:
        u.rigs["body"].j["head"].scale = (HEAD, HEAD, HEAD)
    u.root.location = (x, y, 0.0)
    u.frames = dict(getattr(u, "frames", {}), **{anim: n})
    u.face(facing)
    u.pose(anim, frame)
    objs = [o for o in bpy.data.objects if under(o, u.root)] + [s.obj for s in sks]
    return dict(u=u, team=team, objs=objs, skinners=sks)


def tint_team(made):
    """Each unit's player-colour parts in its own team's colour (the sprites tint a grey layer later)."""
    for t in made:
        col = tuple(lin(c) * 0.9 for c in TEAM[t["team"]])
        cache = {}
        for ob in t["objs"]:
            for slot in getattr(ob, "material_slots", []):
                m = slot.material
                if m is None or lib.MATS.get(m.name, {}).get("kind") != "team":
                    continue
                if m.name not in cache:
                    c = m.copy()
                    for n in c.node_tree.nodes:
                        if n.name == "r7_tint":
                            n.inputs["A"].default_value = (*col, 1)
                        elif n.name == "r7_hue":
                            n.inputs["A"].default_value = (*col, 1)
                        elif n.bl_idname == "ShaderNodeBsdfPrincipled" and not n.inputs["Base Color"].links:
                            n.inputs["Base Color"].default_value = (*col, 1)
                    cache[m.name] = c
                slot.material = cache[m.name]


def rest_everywhere(made):
    """The texture coordinates every mesh keeps while it moves: a skinned body's bind position, a rigid part's own."""
    for t in made:
        look.rest_coords(t["skinners"])
    for ob in bpy.data.objects:
        if ob.type == "MESH" and "rest" not in ob.data.attributes:
            me = ob.data
            co = np.empty(len(me.vertices) * 3, np.float32)
            me.vertices.foreach_get("co", co)
            a = me.attributes.new("rest", "FLOAT_VECTOR", "POINT")
            a.data.foreach_set("vector", co)


def camera_for(points, margin=0.4):
    rm = Euler(((90 - lib.CAM_ELEV) * lib.D2R, 0, lib.CAM_AZ * lib.D2R)).to_matrix()
    right, up = rm @ Vector((1, 0, 0)), rm @ Vector((0, 1, 0))
    xs = [p.dot(right) for p in points]
    ys = [p.dot(up) for p in points]
    L, R, U, D = -min(xs) + margin, max(xs) + margin, max(ys) + margin, -min(ys) + margin
    W, H = int(math.ceil((L + R) * PPM)), int(math.ceil((U + D) * PPM))
    anchor = (L * PPM, U * PPM)
    return lib.Camera(W, H, PPM, anchor), (W, H), anchor


def setup_look():
    if V >= 1:
        look.lights()
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = job.get("samples", 64)
    sc.cycles.use_denoising = True


def scene():
    import blds
    import ground_r7
    fresh()
    root = lib.empty("r7_root")
    look.TEX.update({tid: {k: tex_path(tid, k) for k in ("diff", "rough", "nor_gl")} for tid in look.SIZE})
    ground_r7.build(root)
    broot = lib.empty("r7_barracks", parent=root, loc=(-6.0, 3.0, 0.0))
    blds.BUILDERS["barracks"](broot, "E")
    bobjs = [o for o in bpy.data.objects if under(o, broot)]
    made = [make_unit("spear_e", "blue", -3.2, -4.4, 1, "attack", 5, 10),
            make_unit("xbow_e", "blue", -1.2, -5.2, 1, "attack", 3, 10),
            make_unit("spear_e", "red", 3.0, -4.0, 5, "attack", 2, 10),
            make_unit("xbow_e", "red", 5.4, -5.0, 5, "idle", 0, 8)]
    rest_everywhere(made)
    setup_look()
    if V >= 1:
        look.realistic(tex_path, dirt=0.35, skinned_attr="rest")
        look.bevel_all(bobjs)
    tint_team(made + [dict(team="blue", objs=bobjs)])
    # the frame: the ground's four corners and everything standing on it (not the shadow catcher)
    bpy.context.view_layer.update()
    pts = [Vector((x, y, 0)) for x in (-12, 12) for y in (-8, 8)]
    for ob in bpy.data.objects:
        if ob.type == "MESH" and ob is not lib.GROUND and ob.name not in ("r7_ground", "r7_water") and not ob.hide_render:
            pts += [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    pts = [p for p in pts if -12.5 <= p.x <= 12.5 and -8.5 <= p.y <= 8.5]
    cam, size, anchor = camera_for(pts, margin=0.0)
    sc = bpy.context.scene
    sc.render.film_transparent = False
    sc.render.filepath = os.path.join(OUT, "scene_x3.png")
    bpy.ops.render.render(write_still=True)
    json.dump(dict(size=size, anchor=anchor, px_per_m=PPM, version=V), open(os.path.join(OUT, "scene_x3.json"), "w"))


def unit_frames(it):
    fresh()
    look.TEX.update({tid: {k: tex_path(tid, k) for k in ("diff", "rough", "nor_gl")} for tid in look.SIZE})
    t = make_unit(it["kind"], it["team"], 0.0, 0.0, it["facing"], it["anim"], 0, it["frames"])
    rest_everywhere([t])
    setup_look()
    if V >= 1:
        look.realistic(tex_path, dirt=0.35, skinned_attr="rest")
    tint_team([t])
    sc = bpy.context.scene
    sc.render.film_transparent = True
    lib.GROUND.hide_render = False            # the shadow catcher: the shadow in the alpha
    pts = [Vector((x, y, z)) for x in (-1.6, 1.6) for y in (-1.6, 1.6) for z in (0, 2.6)]
    camera_for(pts, margin=0.1)
    u = t["u"]
    for k in range(it["frames"]):
        u.face(it["facing"])
        u.pose(it["anim"], k)
        sc.render.filepath = os.path.join(OUT, f"{it['kind']}_{it['team']}_{it['anim']}_f{it['facing']}_{k:02d}.png")
        bpy.ops.render.render(write_still=True)


t0 = time.time()
for it in job["items"]:
    if it["what"] == "scene":
        scene()
    else:
        unit_frames(it)
    print(f"R7 v{V} {it['what']} {it.get('kind', '')} {it.get('anim', '')} done at {time.time() - t0:.0f}s", flush=True)
