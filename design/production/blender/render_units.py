"""Blender entry point for production: build one approved unit and render the requested frames/passes.
(Copied from round5; models come from design/round5/blender/units5.py, which dispatches to
R5, R4, R3 and R2 code. job["frames"] overrides the unit's frames per animation.)

blender -b -t 2 --factory-startup --python render_units.py -- job.json

job.json = {
  "kind": "spear_e", "variant": 0, "px_per_m": 60, "emblem_dir": "...",
  "frame_m": [w, h, ax, ay]            (optional override of units.FRAME_M)
  "items": [{"facing": 0, "anim": "attack", "frame": 3,
             "passes": ["beauty", "mask", "shadow"], "out": "/path/prefix"}]
}
Writes <out>_<pass>.png for each pass, plus <out>.json with the anchor.
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(1, os.path.join(HERE, "..", "..", "round5", "blender"))   # R5 roster, 晶術師, units5 dispatcher
sys.path.insert(2, os.path.join(HERE, "..", "..", "round4", "blender"))   # R4 劍修 and garment helpers
sys.path.insert(3, os.path.join(HERE, "..", "..", "round3", "blender"))   # R3 mage kit and fixed riders
sys.path.insert(4, os.path.join(HERE, "..", "..", "round2", "blender"))   # R2 bodies and level-C models
sys.path.insert(5, os.path.join(HERE, "..", "..", "round1", "blender"))   # R1 models and poses

args = sys.argv[sys.argv.index("--") + 1:]
job = json.load(open(args[0]))
os.environ["EMBLEM_DIR"] = job.get("emblem_dir", "")

import lib      # noqa: E402  (round2 lib: R1 API plus quality settings)
import units    # noqa: E402  (R1 models; option A renders these with the new settings)

lib.QUALITY = job.get("quality", "r1")
level = job.get("level", "A")
lib.reset()
lib.make_lights()
lib.ground()
bpy_scene = __import__("bpy").context.scene
bpy_scene.cycles.seed = 0
import units5    # noqa: E402
u = units5.build(job["kind"], job.get("variant", 0), job.get("mage_style"))
if job.get("new_anims"):              # the approved new animations (anims.py)
    import anims  # noqa: E402
    if job.get("infantry_fall") is not None:
        anims.INFANTRY_FALL = bool(job["infantry_fall"])
    u = anims.extend(u, job["kind"], job.get("mage_style"))
if job.get("frames"):
    u.frames = dict(getattr(u, "frames", {}), **job["frames"])
# the flying 晶砲 bolt is a projectile the game draws itself (client/docs/sprite-atlas.md): not in the unit images
for _ob in lib.FX_PARTS:
    if "fx_bolt" in _ob.name:
        _ob["fx_on"] = False
w_m, h_m, ax, ay = job.get("frame_m") or units.frame_m(job["kind"])
ppm = job["px_per_m"]
W, H = int(round(w_m * ppm)), int(round(h_m * ppm))
anchor = (W * ax, H * ay)
cam = lib.Camera(W, H, ppm, anchor)
if job.get("border"):          # render only a region (fractions x0, y0, x1, y1 from top-left)
    x0, y0, x1, y1 = job["border"]
    bpy_scene.render.use_border = True
    bpy_scene.render.use_crop_to_border = True
    bpy_scene.render.border_min_x, bpy_scene.render.border_max_x = x0, x1
    bpy_scene.render.border_min_y, bpy_scene.render.border_max_y = 1 - y1, 1 - y0

import bpy                       # noqa: E402
from mathutils import Vector     # noqa: E402

# weapons, banners and effects do not count toward the body height
EXCL = ("bpole", "bflag", "shaft", "_tip", "lance", "spear_e_tassel", "haft", "_axe", "pick", "xbow_e_stock", "xbow_e_prod", "xbow_e_str",
        "_blade", "_socket", "speartassel", "_float", "_fringe", "_bfinial", "mage_staff", "_hoe", "_tool",
        "_bowlimb", "_bowstring", "_xbow", "_scabbard", "_hilt", "_pommel", "_swordguard",
        "bow_w_limb", "bow_w_string", "vamplate", "_shield", "fx_", "_flag", "_pole", "_finial")


def body_top():
    bpy.context.view_layer.update()
    z = 0.0
    for ob in lib.ALL_PARTS:
        if any(t in ob.name for t in EXCL):
            continue
        for c in ob.bound_box:
            z = max(z, (ob.matrix_world @ Vector(c)).z)
    return z


def extents():
    """How far the unit reaches from the ground anchor on screen, in metres: (left, right, up, down).
    Effects count (shield, magic circles) except the ones switched off (the flying bolt)."""
    from mathutils import Euler as _E
    bpy.context.view_layer.update()
    rm = _E((60 * lib.D2R, 0, -45 * lib.D2R)).to_matrix()
    right, up = rm @ Vector((1, 0, 0)), rm @ Vector((0, 1, 0))
    xs, ys = [0.0], [0.0]
    for ob in list(lib.ALL_PARTS) + [o for o in lib.FX_PARTS if o.get("fx_on", True)]:
        if ob.hide_render and not ob.visible_camera and ob not in lib.FX_PARTS:
            continue
        mw = ob.matrix_world
        for c in ob.bound_box:
            p = mw @ Vector(c)
            xs.append(p.dot(right))
            ys.append(p.dot(up))
    return -min(xs), max(xs), max(ys), -min(ys)


if job.get("fit"):
    # measure only: pose every item and keep the largest reach in each direction
    ext = [0.0, 0.0, 0.0, 0.0]
    for it in job["items"]:
        if it.get("n"):
            u.frames = dict(getattr(u, "frames", {}), **{it["anim"]: it["n"]})
        u.face(it["facing"])
        u.pose(it["anim"], it["frame"])
        ext = [max(a, b) for a, b in zip(ext, extents())]
    with open(job["fit_out"], "w") as f:
        json.dump(dict(left=ext[0], right=ext[1], up=ext[2], down=ext[3], items=len(job["items"])), f)
    print(f"FIT {len(job['items'])} poses: left {ext[0]:.2f} right {ext[1]:.2f} up {ext[2]:.2f} down {ext[3]:.2f} m",
          flush=True)
    os._exit(0)                  # nothing to render

def _front_only(ob):
    """Give the shield a copy of its material that is clear on back faces: only the half of the shell
    that faces the camera is drawn (the far half, seen from inside, is the part the body used to hide)."""
    if ob is None or ob.get("front_only"):
        return
    for slot in ob.material_slots:
        m = slot.material.copy()
        nt = m.node_tree
        out = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeOutputMaterial")
        link = out.inputs["Surface"].links[0]
        src = link.from_socket
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        clear = nt.nodes.new("ShaderNodeBsdfTransparent")
        mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.remove(link)
        nt.links.new(geo.outputs["Backfacing"], mix.inputs[0])
        nt.links.new(src, mix.inputs[1])
        nt.links.new(clear.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs["Surface"])
        slot.material = m
    ob["front_only"] = True


# A stand-in for the mage's body, used only as a holdout in the shield layer. The approved look drew
# the shield's far half only where the body did not hide it; the shield layer has no body, so this
# body-sized shape (robe, shoulders, head of the standing mage) hides the far half in the same place.
# The near half, in front of it, is not affected. (radius, height) from the ground up, metres.
BODY_PROXY = [(0.27, 0.0), (0.27, 0.15), (0.23, 0.6), (0.21, 1.05), (0.23, 1.3), (0.2, 1.42), (0.08, 1.5),
              (0.11, 1.58), (0.12, 1.72), (0.08, 1.84), (0.0, 1.88)]


def _body_proxy(u):
    if bpy.data.objects.get("shield_body_proxy"):
        return
    ob = lib.lathe("shield_body_proxy", BODY_PROXY, lib.mat("proxy_grey", (0.5, 0.5, 0.5)), u.root, segs=24,
                   scale=(1, 0.8, 1), outline=False)
    if ob in lib.ALL_PARTS:
        lib.ALL_PARTS.remove(ob)
    ob.is_holdout = True
    ob.hide_render = False


t0 = time.time()
n = 0
for it in job["items"]:
    if it.get("n"):                     # frames of this animation (production: attack 10, work loops 8, ...)
        u.frames = dict(getattr(u, "frames", {}), **{it["anim"]: it["n"]})
    u.face(it["facing"])
    u.pose(it["anim"], it["frame"])
    top = body_top()
    for p in it["passes"]:
        if p == "shadow":
            # shadows fall to the lower right: widen the frame there; render at half size
            # (soft shadows, far less memory), compose scales it back up
            ex, ey = job.get("shadow_extra", (0.45, 0.25))    # room right and below, in frame heights
            cam.set((W + int(ex * h_m * ppm)) // 2, (H + int(ey * h_m * ppm)) // 2, ppm / 2,
                    (anchor[0] / 2, anchor[1] / 2))
        if p == "shield":
            # the mage's shield on its own layer (client/docs/sprite-atlas.md version 2, section 4):
            # the effect render settings, the body not rendered at all (not cut out), only the shield
            lib.set_pass("fx", job.get("samples", {}).get("fx"))
            for ob in lib.ALL_PARTS:
                ob.hide_render = True
            for ob in lib.FX_PARTS:
                ob.hide_render = ob.name != "fx_shield_ob"
            if job.get("shield_front_only"):
                _front_only(bpy.data.objects.get("fx_shield_ob"))
            if job.get("shield_proxy", True):
                _body_proxy(u)
        else:
            lib.set_pass(p, job.get("samples", {}).get(p))
            if p == "fx" and job.get("split_shield"):
                for ob in lib.FX_PARTS:          # the effect layer no longer contains the shield
                    if ob.name == "fx_shield_ob":
                        ob.hide_render = True
        if p == "shadow" and "rim" in lib.LIGHTS:
            # only the sun casts the ground shadow; the cool back light would add a second one toward the camera
            lib.LIGHTS["rim"].hide_render = True
        lib.render(f"{it['out']}_{p}.png")
        if p == "shadow":
            cam.set(W, H, ppm, anchor)
        n += 1
    with open(it["out"] + ".json", "w") as f:
        anc = anchor
        if job.get("border"):
            anc = (anchor[0] - job["border"][0] * W, anchor[1] - job["border"][1] * H)
        json.dump({"anchor": anc, "size": [W, H], "px_per_m": ppm, "kind": job["kind"], "body_top_m": top,
                   "facing": it["facing"], "anim": it["anim"], "frame": it["frame"]}, f)
print(f"RENDERED {n} images in {time.time() - t0:.1f}s ({(time.time() - t0) / max(1, n):.2f}s each)")
