"""R7 (D-092) version 3, a test only: the shapes Hunyuan3D 2.1 made from our own concept pictures (common/hunyuan.py;
the Space without an account made shapes only, no textures), put back where the concept's model stood, given our
CC0 materials by part, and (the soldier) skinned to our rig for the approved animations.

- Register: the generated mesh comes in its own size, its front toward -y like our models. It is scaled and moved so
  its outline, seen through the concept's camera, covers the concept picture's (the overlap is printed), then it
  stands where our concept model stood.
- Parts: the concept was also rendered as a material ID picture (render_r7.concept). Every face the camera sees
  takes the material under it; faces it cannot see (the back) take the nearest seen face's. The time this took is
  printed (it is the production cost of the AI route; the review is by eye on the boards).
- Skin (units): body2.Skinner's distance weights to our rig's bones in the zero pose the concept was drawn in.
"""
import json
import math
import time

import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector
from mathutils.kdtree import KDTree

import body2
import lib


def load(path, tris):
    """The generated .glb as one mesh in world space, cut down to about `tris` triangles."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    for o in bpy.context.view_layer.objects:
        o.select_set(o in meshes)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.parent = None
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in new:
        if o is not ob and o.name in bpy.data.objects:
            bpy.data.objects.remove(o)
    have = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if have > tris:
        m = ob.modifiers.new("cut", "DECIMATE")
        m.ratio = tris / have
        bpy.ops.object.modifier_apply(modifier=m.name)
    ob.data.materials.clear()
    lib.ALL_PARTS.append(ob)
    return ob


def _camera(meta):
    rm = Euler(meta["rotation"]).to_matrix()
    return rm @ Vector((1, 0, 0)), rm @ Vector((0, 1, 0)), rm @ Vector((0, 0, 1)), Vector(meta["target"])


def _project(P, meta):
    """World points (n, 3) -> concept pixels (n, 2) and depth toward the camera."""
    right, up, back, tgt = (np.array(v) for v in _camera(meta))
    px, size = meta["px"], meta["ortho_scale"]
    d = P - tgt
    x = d @ right / size * px + px / 2
    y = px / 2 - d @ up / size * px
    return np.stack([x, y], 1), d @ back


def _mask(uv, px, r=2):
    m = np.zeros((px, px), bool)
    ij = np.round(uv).astype(int)
    ok = (ij[:, 0] >= 0) & (ij[:, 0] < px) & (ij[:, 1] >= 0) & (ij[:, 1] < px)
    ij = ij[ok]
    for dx in range(-r, r + 1):
        for dy in range(-r, r + 1):
            x = np.clip(ij[:, 0] + dx, 0, px - 1)
            y = np.clip(ij[:, 1] + dy, 0, px - 1)
            m[y, x] = True
    return m


def register(ob, alpha, meta):
    """Turn (about z), scale and move ob so its outline through the concept camera covers the picture's."""
    co = np.array([v.co[:] for v in ob.data.vertices])
    target = alpha > 128
    ty, tx = np.nonzero(target)
    # the box of the picture's main body: a few stray pixels (a thin part left in the concept) must not stretch it
    tbox = (np.percentile(tx, 0.3), np.percentile(ty, 0.3), np.percentile(tx, 99.7), np.percentile(ty, 99.7))
    right, up, back, tgt = (np.array(v) for v in _camera(meta))
    px, size = meta["px"], meta["ortho_scale"]
    best = (-1, None)
    c0 = co.mean(0)

    def place(theta):
        R = np.array(Matrix.Rotation(theta, 3, "Z"))
        P = (co - c0) @ R.T
        uv, _ = _project(P + tgt, meta)
        # scale and shift so the outline's box matches the picture's (an orthographic camera: one scale)
        bx = (uv[:, 0].min(), uv[:, 1].min(), uv[:, 0].max(), uv[:, 1].max())
        s = (tbox[3] - tbox[1]) / max(bx[3] - bx[1], 1e-6)
        P = P * s
        uv, _ = _project(P + tgt, meta)
        shift = np.array([(tbox[0] + tbox[2]) / 2 - (uv[:, 0].min() + uv[:, 0].max()) / 2,
                          (tbox[1] + tbox[3]) / 2 - (uv[:, 1].min() + uv[:, 1].max()) / 2])
        world_shift = (shift[0] * right - shift[1] * up) * size / px
        return P + tgt + world_shift, R, s, world_shift

    # the outline is compared at a quarter of the picture's size, where the vertices fill it without holes
    q = 4
    small = target.reshape(px // q, q, px // q, q).any(axis=(1, 3))

    def iou(theta):
        P, *_ = place(theta)
        uv, _ = _project(P, meta)
        m = _mask(uv / q, px // q, r=1)
        return (m & small).sum() / max((m | small).sum(), 1)
    # no turn: the generator puts the model's front toward -y whatever angle the picture was taken from (checked by
    # eye against the concept, 2026-10-21); a search over turns could not tell front, back and sides apart (a standing
    # man's outline is nearly the same from four sides: overlaps 0.69-0.75)
    best = (iou(0.0), 0.0)
    P, R, s, sh = place(best[1])
    # the outline fixes the place across the picture, not along the view: slide along the view until the feet (the
    # lowest point) stand on the ground, which keeps the outline where it was
    P = P - np.array(back) * (P[:, 2].min() / back[2])
    ob.data.vertices.foreach_set("co", P.astype(np.float32).ravel())
    ob.data.update()
    return dict(iou=round(float(best[0]), 3), turn_deg=round(math.degrees(best[1]), 1), scale=round(float(s), 4))


def parts(ob, ids_img, ids_map, meta, materials):
    """Each face's material from the ID picture where the camera sees it, the nearest seen face's elsewhere.
    materials: name -> material (ours, already textured)."""
    t0 = time.time()
    me = ob.data
    n = len(me.polygons)
    cen = np.array([p.center[:] for p in me.polygons])
    nrm = np.array([p.normal[:] for p in me.polygons])
    uv, depth = _project(cen, meta)
    px = meta["px"]
    right, up, back, tgt = _camera(meta)
    facing = nrm @ np.array(back) > 0.05
    # visibility: a depth buffer of the face centres (the nearest one in each pixel cell wins)
    ij = np.clip(np.round(uv).astype(int), 0, px - 1)
    zbuf = np.full((px, px), -1e9)
    order = np.argsort(depth)
    for k in order:
        if facing[k]:
            x, y = ij[k]
            zbuf[y, x] = max(zbuf[y, x], depth[k])
    seen = np.zeros(n, bool)
    for k in range(n):
        if facing[k]:
            x, y = ij[k]
            seen[k] = depth[k] >= zbuf[y, x] - 0.03
    ids = ids_img                                   # uint8 RGBA rows from the top
    keys = {tuple(int(v) for v in k.split(",")): name for k, name in ids_map.items()}
    pal = np.array(list(keys.keys()), float)
    names = list(keys.values())
    label = np.full(n, -1)
    for k in np.nonzero(seen)[0]:
        x, y = ij[k]
        c = ids[y, x]
        if c[3] < 200:
            continue
        label[k] = int(np.argmin(((pal - c[:3]) ** 2).sum(1)))
    known = np.nonzero(label >= 0)[0]
    kd = KDTree(len(known))
    for i, k in enumerate(known):
        kd.insert(cen[k], i)
    kd.balance()
    for k in np.nonzero(label < 0)[0]:
        _, i, _ = kd.find(cen[k])
        label[k] = label[known[i]]
    used = sorted(set(label.tolist()))
    slot = {}
    for li in used:
        m = materials.get(names[li])
        if m is None:
            continue
        slot[li] = len(me.materials)
        me.materials.append(m)
    fallback = 0
    me.polygons.foreach_set("material_index", [slot.get(int(li), fallback) for li in label])
    return dict(faces=n, seen=int(seen.sum()), from_picture=int(len(known)), materials=len(slot),
                seconds=round(time.time() - t0, 1))


def skin(ob, rig):
    """Distance weights to our rig's bones, in the zero pose (the concept's pose)."""
    J = rig.j
    bpy.context.view_layer.update()
    w = {k: Vector(J[k].matrix_world.translation) for k in J}
    bones = [(J["hips"], tuple(w["hips"] - Vector((0, 0, 0.12))), tuple(w["torso"])),
             (J["torso"], tuple(w["torso"]), tuple(w["neck"])),
             (J["neck"], tuple(w["neck"]), tuple(w["head"])),
             (J["head"], tuple(w["head"]), tuple(w["head"] + Vector((0, 0, 0.32))))]
    for s in "RL":
        bones += [(J["shoulder" + s], tuple(w["shoulder" + s]), tuple(w["elbow" + s])),
                  (J["elbow" + s], tuple(w["elbow" + s]), tuple(w["wrist" + s])),
                  (J["wrist" + s], tuple(w["wrist" + s]), tuple(w["wrist" + s] - Vector((0, 0, 0.16)))),
                  (J["hip" + s], tuple(w["hip" + s]), tuple(w["knee" + s])),
                  (J["knee" + s], tuple(w["knee" + s]), tuple(w["ankle" + s])),
                  (J["ankle" + s], tuple(w["ankle" + s]), tuple(w["ankle" + s] + Vector((0, 0.18, -0.07))))]
    arm = [k for k, (j, _, _) in enumerate(bones) if j.name.split("_")[-1].startswith(("shoulder", "elbow", "wrist"))]
    wristp = {s: np.array(w["wrist" + s]) for s in "RL"}

    def arms_off_the_body(rest, wt):
        # the generated body has its arms grown into its sides: an arm bone may move only what is outside the
        # torso, or the hand itself (the hand fix, by rule; ~20 minutes of trying by eye, 2026-10-21)
        x, z = rest[:, 0], rest[:, 2]
        near = np.minimum(np.linalg.norm(rest - wristp["R"], axis=1), np.linalg.norm(rest - wristp["L"], axis=1))
        ok = ((np.abs(x) > 0.19) & (z > 1.0)) | (near < 0.09)
        wt = wt.copy()
        wt[:, arm] *= ok[:, None]
        return wt
    sk = body2.Skinner(ob, bones, falloff=5.0, top=2, overrides=[arms_off_the_body])
    return sk
