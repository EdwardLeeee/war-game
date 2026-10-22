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
from mathutils import Euler, Matrix, Vector       # noqa: E402

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
    if V == 1:
        u.rigs["body"].j["head"].scale = (HEAD, HEAD, HEAD)
    if V == 2 or (V == 3 and kind != "spear_e"):  # version 3 generated the spearman only; the crossbowman is version 2's
        import human_r7
        more, _ = human_r7.dress(u, kind)
        sks += more
    if V == 3 and kind == "spear_e":
        sks += ai_unit(u, kind)
    u.root.location = (x, y, 0.0)
    u.frames = dict(getattr(u, "frames", {}), **{anim: n})
    u.face(facing)
    u.pose(anim, frame)
    objs = [o for o in bpy.data.objects if under(o, u.root)] + [s.obj for s in sks]
    return dict(u=u, team=team, objs=objs, skinners=sks)


AI = os.path.join(os.path.dirname(OUT), "ai")
CONCEPT = os.path.join(os.path.dirname(OUT), "concept")
AI_LOG = {}


def _material(name):
    """Our material for an ID picture's name (the concept's team copies are 'team2.001' ...)."""
    base = name.split(".")[0]
    m = lib.MATS.get(base, {}).get("mat") or bpy.data.materials.get(base)
    if m is None and base == "r7_skin":
        m = lib.mat("r7_skin", (0.55, 0.38, 0.27), 0.5)
    return m


def _png(path):
    """A PNG as uint8 RGBA rows from the top (Blender's own reader: its python has no PIL)."""
    im = bpy.data.images.load(path, check_existing=False)
    im.colorspace_settings.name = "Non-Color"
    w, h = im.size
    a = np.empty(w * h * 4, np.float32)
    im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    return np.flipud((a.reshape(h, w, 4) * 255 + 0.5).astype(np.uint8))


def _ai(kind, tris):
    import ai_r7
    t0 = time.time()
    ob = ai_r7.load(os.path.join(AI, f"{kind}_shape.glb"), tris)
    meta = json.load(open(os.path.join(CONCEPT, f"concept_{kind}.json")))
    alpha = _png(os.path.join(CONCEPT, f"concept_{kind}.png"))[..., 3]
    reg = ai_r7.register(ob, alpha, meta)
    ids = json.load(open(os.path.join(CONCEPT, f"concept_{kind}_id.json")))
    mats = {name: _material(name) for name in ids.values()}
    part = ai_r7.parts(ob, _png(os.path.join(CONCEPT, f"concept_{kind}_id.png")), ids, meta, mats)
    AI_LOG[kind] = dict(register=reg, parts=part, seconds=round(time.time() - t0, 1))
    print("R7 v3 AI", kind, AI_LOG[kind], flush=True)
    return ob


def ai_unit(u, kind):
    """Version 3: the generated soldier in place of ours, skinned to our rig; our weapons and banner kept."""
    import ai_r7
    rig = u.rigs["body"]
    keep = [o for o in bpy.data.objects if under(o, u.root) and any(w in o.name for w in WEAPON)]
    for o in [o for o in bpy.data.objects if under(o, u.root)] + [s.obj for s in getattr(rig, "skinners", [])]:
        if o not in keep and o.type in ("MESH", "CURVE"):
            o.hide_render = True
    body2.zero_pose(rig)
    ob = _ai(kind, 24000)
    ob.name = f"{kind}_r7ai"
    co = np.array([v.co[:] for v in ob.data.vertices])
    ours = next(sk.obj for sk in getattr(rig, "skinners", []) if sk.obj.name.split(".")[0] == f"{kind}_body")
    bpy.context.view_layer.update()
    oc = np.array([ours.matrix_world @ v.co for v in ours.data.vertices])
    print("R7 v3 bbox ai", co.min(0).round(3), co.max(0).round(3), "ours", oc.min(0).round(3), oc.max(0).round(3),
          "joints", {k: [round(c, 2) for c in rig.j[k].matrix_world.translation] for k in ("hips", "neck", "wristR", "ankleL")})
    sk = ai_r7.skin(ob, rig)
    rig.skinners = list(getattr(rig, "skinners", [])) + [sk]
    rig.pose()
    return [sk]


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


def scene(empty=False):
    """The battlefield; empty: the ground only (R8's boards put the units on it from their atlases)."""
    import blds
    import ground_r7
    fresh()
    root = lib.empty("r7_root")
    look.TEX.update({tid: {k: tex_path(tid, k) for k in ("diff", "rough", "nor_gl")} for tid in look.SIZE})
    ground_r7.build(root)
    broot = lib.empty("r7_barracks", parent=root, loc=(-6.0, 3.0, 0.0))
    if not empty:
        blds.BUILDERS["barracks"](broot, "E")
    bobjs = [o for o in bpy.data.objects if under(o, broot)]
    if V == 3:                                    # the generated barracks where ours stood; ours only lends materials
        for o in bobjs:
            o.hide_render = True
        ab = _ai("barracks", 60000)
        ab.data.transform(Matrix.Translation((-6.0, 3.0, 0.0)))
        bobjs = [ab]
    made = [] if empty else [make_unit("spear_e", "blue", -3.2, -4.4, 1, "attack", 5, 10),
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
    name = "ground_x3" if empty else "scene_x3"
    sc.render.filepath = os.path.join(OUT, f"{name}.png")
    bpy.ops.render.render(write_still=True)
    json.dump(dict(size=size, anchor=anchor, px_per_m=PPM, version=V), open(os.path.join(OUT, f"{name}.json"), "w"))


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


WEAPON = ("bpole", "bflag", "shaft", "_tip", "speartassel", "tassel", "_flag", "_pole", "_finial", "_bfinial",
          "_socket", "_blade", "banner", "xbow_e_stock", "xbow_e_prod", "xbow_e_str", "_xbow", "_quiver", "bolt")


def concept(it):
    """Version 3's input: our own model as a picture for the image-to-3D generator, front three-quarter, plain white,
    the weapons and banner left out (they are put back on the generated body's hands)."""
    fresh()
    look.TEX.update({tid: {k: tex_path(tid, k) for k in ("diff", "rough", "nor_gl")} for tid in look.SIZE})
    if it["kind"] == "barracks":
        import blds
        root = lib.empty("r7_concept")
        blds.BUILDERS["barracks"](root, "E")
        objs = [o for o in bpy.data.objects if under(o, root)]
        made = [dict(team="blue", objs=objs, skinners=[])]
        rest_everywhere(made)
        size, target_z = None, None
    else:
        t = make_unit(it["kind"], "blue", 0.0, 0.0, 7, "idle", 0, 8)     # facing 7: toward the camera
        body2.zero_pose(t["u"].rigs["body"])                               # arms down: the pose it is bound in
        bpy.context.view_layer.update()
        for sk in t["skinners"]:
            sk.update()
        rest_everywhere([t])
        made = [t]
        for ob in t["objs"]:
            if any(w in ob.name for w in WEAPON):
                ob.hide_render = True
        size, target_z = 2.3, 0.95
    setup_look()
    if V >= 1:
        look.realistic(tex_path, dirt=0.35, skinned_attr="rest")
        if it["kind"] == "barracks":
            look.bevel_all(made[0]["objs"])
    tint_team(made)
    sc = bpy.context.scene
    sc.render.resolution_x = sc.render.resolution_y = it.get("px", 768)
    cd = bpy.data.cameras.new("concept")
    cd.type = "ORTHO"
    co = bpy.data.objects.new("concept", cd)
    sc.collection.objects.link(co)
    sc.camera = co
    co.rotation_euler = Euler((math.radians(75), 0, math.radians(-30)))
    rm = co.rotation_euler.to_matrix()
    if size is None:                              # fit the camera to what shows
        bpy.context.view_layer.update()
        pts = [ob.matrix_world @ Vector(c) for ob in made[0]["objs"] if ob.type == "MESH" and not ob.hide_render
               for c in ob.bound_box]
        right, up = rm @ Vector((1, 0, 0)), rm @ Vector((0, 1, 0))
        xs, ys = [p.dot(right) for p in pts], [p.dot(up) for p in pts]
        size = max(max(xs) - min(xs), max(ys) - min(ys)) * 1.12
        mid = right * ((max(xs) + min(xs)) / 2) + up * ((max(ys) + min(ys)) / 2)
        target = mid
    else:
        target = Vector((0, 0, target_z))
    cd.ortho_scale = size
    co.location = target + rm @ Vector((0, 0, 30))
    json.dump(dict(rotation=[math.radians(75), 0, math.radians(-30)], ortho_scale=size, target=list(target),
                   px=it.get("px", 768)), open(os.path.join(OUT, f"concept_{it['kind']}.json"), "w"))
    sc.render.film_transparent = True             # put on white afterwards (common/concepts.py): the light stays R7's
    sc.render.filepath = os.path.join(OUT, f"concept_{it['kind']}.png")
    bpy.ops.render.render(write_still=True)
    # the material ID picture, the same camera: every material one flat colour (version 3 reads its parts off it)
    ids, k = {}, 0
    for ob in [o for o in bpy.data.objects if o.type == "MESH" and not o.hide_render]:
        for slot in ob.material_slots:
            m = slot.material
            if m is None:
                continue
            if m.name not in ids:
                k += 1
                ids[m.name] = (k * 37 % 251 + 4, k * 91 % 251 + 4, k * 53 % 251 + 4)
            em = bpy.data.materials.get("id_" + m.name) or bpy.data.materials.new("id_" + m.name)
            em.use_nodes = True
            nt = em.node_tree
            for n in list(nt.nodes):
                if n.bl_idname != "ShaderNodeOutputMaterial":
                    nt.nodes.remove(n)
            e = nt.nodes.new("ShaderNodeEmission")
            e.inputs["Color"].default_value = (*[lin(c) for c in ids[m.name]], 1)
            nt.links.new(e.outputs[0], next(n for n in nt.nodes if n.bl_idname == "ShaderNodeOutputMaterial").inputs[0])
            slot.material = em
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.cycles.samples = 1
    sc.cycles.use_denoising = False
    sc.cycles.filter_width = 0.01
    sc.render.filepath = os.path.join(OUT, f"concept_{it['kind']}_id.png")
    bpy.ops.render.render(write_still=True)
    json.dump({"%d,%d,%d" % c: name for name, c in ids.items()},
              open(os.path.join(OUT, f"concept_{it['kind']}_id.json"), "w"), indent=1)


t0 = time.time()
for it in job["items"]:
    if it["what"] == "scene":
        scene(it.get("empty", False))
    elif it["what"] == "concept":
        concept(it)
    else:
        unit_frames(it)
    print(f"R7 v{V} {it['what']} {it.get('kind', '')} {it.get('anim', '')} done at {time.time() - t0:.0f}s", flush=True)
