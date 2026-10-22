"""R8 (D-093): a realistic horse in place of R2's tube horse (horse2), for the cavalry.

The horse: Lyndon Daniels' "Realtime Rancher's" horse (CC0, OpenGameArt, 2012), with the skeleton and weights ChadM
added ("rigged horse", CC0, OpenGameArt): one body mesh (3,696 faces) with 2k colour, normal and AO maps, a mane and a
tail of hair cards, two eyes. THIRD_PARTY_NOTICES.md has the pages, the licence and the files' sha256. The files are
not in the repo: R8_HORSE points at a folder with riggedHorse.blend and horse/ (horse.zip unpacked); CI downloads them.

Fitted onto our horse rig the way human_r7 fits MPFB:
- the horse turned to face +y and scaled so the spread of its legs (elbow to stifle) is ours;
- its neck raised and its head turned to our rig's rest pose (the source stands with its head low);
- our rig's joints moved to its own: the legs bend at its elbows, knees, stifles and hocks, the neck and head turn at
  its withers and poll; the saddle sits on its back;
- skinned to our joints with its own weights (bones merged onto ours), so the approved gallop and fall drive it.
What R2 hung on the old horse's barrel (the caparison, the horse armour) is rebuilt on the new horse's: BARREL()
gives its cross-sections at R2's stations.
"""
import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree

import body2
import lib

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.environ.get("R8_HORSE") or os.path.join(HERE, "..", "build", "horse", "src")
TEX = os.path.join(SRC, "zip", "horse")
LEG_SPREAD = 1.02          # our rig: the front legs' tops at y 0.5, the hind legs' at -0.52
OLD_PARTS = ("body", "hoof*", "mane", "forelock", "tailhair", "ear*", "eye*", "nostril*", "noseband", "browband")
_DATA = {}


def _load():
    """The source horse in its own space: meshes (world co, polygons, uv) and the skeleton (bone heads and tails)."""
    if _DATA:
        return _DATA
    names = ["Plane", "BezierCurve", "BezierCurve.005", "Sphere", "Sphere.002", "Armature"]
    with bpy.data.libraries.load(os.path.join(SRC, "riggedHorse.blend"), link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n in names]
    coll = bpy.data.collections.new("r8_horse_src")
    bpy.context.scene.collection.children.link(coll)
    for ob in dst.objects:
        coll.objects.link(ob)
    bpy.context.view_layer.update()
    arm = next(ob for ob in dst.objects if ob.type == "ARMATURE")
    bones = {b.name: (np.array(arm.matrix_world @ b.head_local), np.array(arm.matrix_world @ b.tail_local))
             for b in arm.data.bones}

    def mesh(ob):
        me = ob.data
        co = np.array([ob.matrix_world @ v.co for v in me.vertices])
        return dict(co=co, me=me.copy())
    body = next(ob for ob in dst.objects if ob.type == "MESH" and len(ob.vertex_groups))
    parts = {"body": mesh(body)}
    groups = [g.name for g in body.vertex_groups]
    W = np.zeros((len(body.data.vertices), len(groups)))
    for v in body.data.vertices:
        for g in v.groups:
            W[v.index, g.group] = g.weight
    others = [ob for ob in dst.objects if ob.type == "MESH" and ob is not body]
    for ob in others:
        m = mesh(ob)
        y = m["co"][:, 1].mean()
        key = "eye" + str(len([k for k in parts if k.startswith("eye")])) if len(ob.data.vertices) < 600 else \
            ("mane" if y < 0 else "tail")
        parts[key] = m
    for ob in dst.objects:
        bpy.data.objects.remove(ob)
    bpy.data.collections.remove(coll)
    _DATA.update(bones=bones, parts=parts, groups=groups, W=W)
    return _DATA


def _rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def _elev(d):
    """Elevation of a direction that points along -y (the source faces -y), radians above the horizontal."""
    return math.atan2(d[2], -d[1])


def _reposed(rig):
    """The source horse posed as our rig's rest (neck and head angles), turned, scaled and placed: returns the moved
    meshes' co, the bones' new heads and tails, and the per-vertex weights merged onto our joints."""
    D = _load()
    B = {k: (h.copy(), t.copy()) for k, (h, t) in D["bones"].items()}
    # our rig's rest directions (world): the neck's and head's +z
    bpy.context.view_layer.update()
    zn = np.array(rig.j["neck"].matrix_world.to_3x3() @ Vector((0, 0, 1)))
    zh = np.array(rig.j["head"].matrix_world.to_3x3() @ Vector((0, 0, 1)))
    # in the source's frame (facing -y) our forward +y is -y: elevations as seen along the horse's forward
    tn, th = math.atan2(zn[2], zn[1]), math.atan2(zh[2], zh[1])
    nh, nt = B["Bone.001"]
    hh, ht = B["Bone.002"]
    an = -(tn - _elev(nt - nh))                 # rotation about x (the source faces -y: raising is negative)
    Rn = _rot_x(an)
    hh2, ht2 = nh + Rn @ (hh - nh), nh + Rn @ (ht - nh)
    ah = -(th - _elev(ht2 - hh2))
    Rh = _rot_x(ah)
    groups, W = D["groups"], D["W"]
    neck_w = W[:, groups.index("Bone.001")]
    head_w = sum(W[:, groups.index(g)] for g in ("Bone.002", "Bone.001_L", "Bone.001_R"))
    tot = np.maximum(W.sum(1), 1e-6)
    neck_w, head_w = neck_w / tot, head_w / tot

    def pose(co, wn, wh):
        p_n = nh + (co - nh) @ Rn.T
        p_h = hh2 + (p_n - hh2) @ Rh.T
        rest = 1 - wn - wh
        return co * rest[:, None] + p_n * wn[:, None] + p_h * wh[:, None]
    body = D["parts"]["body"]["co"]
    kd = KDTree(len(body))
    for i, p in enumerate(body):
        kd.insert(p, i)
    kd.balance()
    out = {"body": pose(body, neck_w, head_w)}
    near = {}
    for key, m in D["parts"].items():
        if key == "body":
            continue
        idx = np.array([kd.find(p)[1] for p in m["co"]])
        near[key] = idx
        if key.startswith("eye"):
            out[key] = pose(m["co"], np.zeros(len(idx)), np.ones(len(idx)))
        else:
            out[key] = pose(m["co"], neck_w[idx], head_w[idx])
    # the skeleton's joints posed the same way
    for name, (h, t) in list(B.items()):
        wn = 1.0 if name == "Bone.001" else 0.0
        wh = 1.0 if name in ("Bone.002", "Bone.001_L", "Bone.001_R") else 0.0
        if wn or wh:
            B[name] = tuple(pose(np.array([h, t]), np.full(2, wn), np.full(2, wh)))
    # turn to face +y, scale to our legs' spread, stand the hooves on the ground at our legs' middle
    front, hind = B["Bone_L.001"][0], B["Bone_L.004"][0]
    s = LEG_SPREAD / abs(front[1] - hind[1])
    turn = np.diag([-1.0, -1.0, 1.0])
    low = min(c[:, 2].min() for c in out.values())
    mid_src = (front[1] + hind[1]) / 2

    def place(p):
        q = (np.asarray(p) - np.array([0.0, mid_src, low])) @ turn.T * s
        return q + np.array([0.0, -0.01, 0.0])
    out = {k: place(v) for k, v in out.items()}
    B = {k: (place(h), place(t)) for k, (h, t) in B.items()}
    return out, B, s, near


def _merge(rig, B, W, groups):
    """The source's bone weights merged onto our joints (by where each bone ends up, not by its name)."""
    J = ["body", "neck", "head", "tail", "legFR", "lowFR", "legFL", "lowFL", "legBR", "lowBR", "legBL", "lowBL"]
    M = np.zeros((W.shape[0], len(J)))
    for gi, g in enumerate(groups):
        if g not in B:
            j = "body"                                   # a group without a bone (Bone.005: the rump)
        elif g == "Bone.001":
            j = "neck"
        elif g in ("Bone.002", "Bone.001_L", "Bone.001_R"):
            j = "head"
        elif g in ("Bone.003", "Bone.004"):
            j = "tail"
        else:
            h, t = B[g]
            side = "R" if (h[0] + t[0]) / 2 > 0 else "L"
            end = "F" if (h[1] + t[1]) / 2 > 0 else "B"
            if g.endswith((".001", ".004")):
                j = f"leg{end}{side}"
            elif g.endswith((".002", ".005")):
                j = f"low{end}{side}"
            else:
                j = "body"                               # shoulder blade and thigh: inside the barrel
        M[:, J.index(j)] += W[:, gi]
    M /= np.maximum(M.sum(1, keepdims=True), 1e-6)
    return [rig.j[k] for k in J], M, J


def _move_joints(rig, B):
    """Our joints onto the posed source's: the legs at its elbows and knees, stifles and hocks; neck at the withers,
    head at the poll; the tail at its root. Positions only (the rest angles stay ours)."""
    bpy.context.view_layer.update()
    want = {"neck": B["Bone.001"][0], "head": B["Bone.002"][0], "tail": B["Bone.003"][0]}
    for g, (h, t) in B.items():
        if g.endswith((".001", ".004")) and g.startswith("Bone_"):
            side = "R" if h[0] > 0 else "L"
            end = "F" if h[1] > 0 else "B"
            want[f"leg{end}{side}"] = h
        elif g.endswith((".002", ".005")) and g.startswith("Bone_"):
            side = "R" if h[0] > 0 else "L"
            end = "F" if h[1] > 0 else "B"
            want[f"low{end}{side}"] = h
    order = ["neck", "tail", "legFR", "legFL", "legBR", "legBL", "head", "lowFR", "lowFL", "lowBR", "lowBL"]
    for name in order:
        if name not in want:
            continue
        ob = rig.j[name]
        bpy.context.view_layer.update()
        local = ob.parent.matrix_world.inverted() @ Vector(want[name])
        rig.rest_loc[name] = tuple(local)
        ob.location = local
    bpy.context.view_layer.update()


def barrel(co, W_body):
    """The new horse's barrel at R2's stations (units2.BARREL rows: y, centre z, half-width, half-height)."""
    import units2
    rows = []
    sel = (W_body > 0.3) | (co[:, 2] > 0.95)
    for y, _, rx0, ry0 in units2.BARREL:
        band = co[sel & (np.abs(co[:, 1] - y) < 0.06) & (co[:, 2] > 0.7)]
        if len(band) < 8:
            rows.append((y, _, rx0, ry0))
            continue
        z0, z1 = band[:, 2].min(), band[:, 2].max()
        rows.append((y, (z0 + z1) / 2, np.abs(band[:, 0]).max(), (z1 - z0) / 2))
    return rows


def _texture(name, colour, diff, nor=None, alpha=False, rough=0.6):
    m = lib.mat(name, colour, rough)
    nt = m.node_tree
    p = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    for n in list(nt.nodes):
        if n.bl_idname not in ("ShaderNodeBsdfPrincipled", "ShaderNodeOutputMaterial"):
            nt.nodes.remove(n)
    tx = nt.nodes.new("ShaderNodeTexImage")
    tx.image = bpy.data.images.load(os.path.join(TEX, diff), check_existing=True)
    nt.links.new(tx.outputs["Color"], p.inputs["Base Color"])
    if alpha:
        nt.links.new(tx.outputs["Alpha"], p.inputs["Alpha"])
    if nor:
        nm = nt.nodes.new("ShaderNodeNormalMap")
        ti = nt.nodes.new("ShaderNodeTexImage")
        ti.image = bpy.data.images.load(os.path.join(TEX, nor), check_existing=True)
        ti.image.colorspace_settings.name = "Non-Color"
        nt.links.new(ti.outputs["Color"], nm.inputs["Color"])
        nm.inputs["Strength"].default_value = 0.6
        nt.links.new(nm.outputs["Normal"], p.inputs["Normal"])
    return m


def swap(u, kind):
    """Our horse rig (u.rigs["horse"]) gets the realistic horse; R2's horse meshes go. Returns the new barrel."""
    import sys
    r7 = os.path.join(HERE, "..", "..", "r7", "blender")
    if r7 not in sys.path:                      # (before anims.extend: render_units adds it only afterwards)
        sys.path.insert(0, r7)
    import human_r7
    hr = u.rigs["horse"]
    hr.pose()                                  # the rest pose: what the horse is built and skinned in
    bpy.context.view_layer.update()
    out, B, s, near = _reposed(hr)
    _move_joints(hr, B)
    hr.pose()
    bpy.context.view_layer.update()
    D = _load()
    joints, Wm, J = _merge(hr, B, D["W"], D["groups"])
    coat = _texture("horsecoat_r8", (0.45, 0.28, 0.16), "HorseMain2k00.png", "HorseMain2k00Norm00.png", rough=0.55)
    hair = _texture("horsehair_r8", (0.3, 0.2, 0.12), "Hair12Main2k.png", "Hair12Main2kNorm.png", alpha=True,
                    rough=0.6)
    eye = lib.mat("eye_r8", (0.03, 0.02, 0.015), 0.15)
    sks = []
    for key, co in out.items():
        me = D["parts"][key]["me"]
        me.vertices.foreach_set("co", co.astype(np.float32).ravel())
        me.materials.clear()
        me.materials.append(coat if key == "body" else eye if key.startswith("eye") else hair)
        me.update()
        ob = bpy.data.objects.new(f"{hr.name}_r8{key}", me)
        bpy.context.scene.collection.objects.link(ob)
        lib.ALL_PARTS.append(ob)
        W = Wm if key == "body" else Wm[near[key]]
        if key.startswith("eye"):
            W = np.zeros((len(co), len(J)))
            W[:, J.index("head")] = 1.0
        sks.append(human_r7.WeightSkinner(ob, joints, co, W))
    hr.skinners = list(getattr(hr, "skinners", [])) + sks
    for ob in list(bpy.data.objects):
        base = ob.name.split(".")[0]
        rest = base[len(hr.name) + 1:] if base.startswith(hr.name + "_") else None
        if rest is not None and any(rest == n or (n.endswith("*") and rest.startswith(n[:-1])) for n in OLD_PARTS):
            ob.hide_render = True
            if ob in lib.ALL_PARTS:
                lib.ALL_PARTS.remove(ob)
    wb = Wm[:, J.index("body")]
    rows = barrel(out["body"], wb)
    if os.environ.get("R8_DEBUG"):
        print("R8 horse scale", round(s, 4), "barrel", [tuple(round(float(v), 3) for v in r) for r in rows])
        print("R8 horse joints", {k: tuple(round(float(v), 3) for v in hr.rest_loc[k]) for k in J})
        for key, co in out.items():
            print("R8 horse part", key, co.mean(0).round(3).tolist(), co.min(0).round(3).tolist(), co.max(0).round(3).tolist())
        for sk in sks:
            sk.update()
            got = np.array([v.co[:] for v in sk.obj.data.vertices])
            print("R8 horse skinned", sk.obj.name, got.mean(0).round(3).tolist())
        print("R8 horse head joint", [round(v, 3) for v in hr.j["head"].matrix_world.translation],
              "neck", [round(v, 3) for v in hr.j["neck"].matrix_world.translation],
              "root", [round(v, 3) for v in hr.root.matrix_world.translation], hr.root.matrix_world.to_euler())
    return dict(rows=rows, B=B, co=out["body"], neck_w=Wm[:, J.index("neck")], head_w=Wm[:, J.index("head")],
                sks=sks)


def _keep_live(rig):
    """Skinners of parts that are gone are dropped (their rest was taken with the old joints)."""
    rig.skinners = [sk for sk in getattr(rig, "skinners", []) if sk.obj in lib.ALL_PARTS]


def refit(u, kind, mat_top, mat_skirt, hem_drop=0.14):
    """The realistic horse (swap) and what hangs on its barrel rebuilt on it: R2's caparison (top, skirts) on the new
    cross-sections, a neck cover along the new neck, the saddle on the new back. Returns the new barrel rows and the
    skirt's hem height."""
    import units2
    hr = u.rigs["horse"]
    new = swap(u, kind)
    rows = new["rows"]
    for ob in list(bpy.data.objects):
        base = ob.name.split(".")[0]
        if base in (f"{hr.name}_captop", f"{hr.name}_capskirtR", f"{hr.name}_capskirtL", f"{hr.name}_neckcover") \
                or base.startswith(f"{hr.name}_hemt"):
            ob.hide_render = True
            if ob in lib.ALL_PARTS:
                lib.ALL_PARTS.remove(ob)
            ob.name = base + "_r2"
    _keep_live(hr)
    hem = min(zc - ry for _, zc, _, ry in rows) - hem_drop
    old_barrel = units2.BARREL
    units2.BARREL = rows
    hr.pose()
    units2.caparison(hr, units2.palette("C"), "B", mat_top, mat_skirt, hem=hem)
    # the caparison's own neck cover follows R2's neck: replaced by one along the new neck
    for ob in list(bpy.data.objects):
        if ob.name.split(".")[0] == f"{hr.name}_neckcover" and ob.name != f"{hr.name}_neckcover_r2":
            ob.hide_render = True
            if ob in lib.ALL_PARTS:
                lib.ALL_PARTS.remove(ob)
    _keep_live(hr)
    neck_cover(hr, mat_top, new)
    u.horse_fit = new
    # the saddle on the back: R2's sat 7 cm below the barrel's top above the girth
    y_s = -0.05
    top = np.interp(y_s, [r[0] for r in rows], [r[1] + r[3] for r in rows])
    sad = hr.j["saddle"]
    bpy.context.view_layer.update()
    w = sad.matrix_world.translation.copy()
    w.z = top - 0.07
    local = sad.parent.matrix_world.inverted() @ w
    hr.rest_loc["saddle"] = tuple(local)
    sad.location = local
    hr.pose()
    return rows, hem, old_barrel


def neck_cover(hr, mat, new):
    """A cover along the new neck, withers to poll, 3 cm off the neck, skinned to the body and the neck."""
    import units2
    B, co, wn = new["B"], new["co"], new["neck_w"]
    h, t = np.array(B["Bone.001"][0]), np.array(B["Bone.001"][1])
    d = t - h
    L = np.linalg.norm(d)
    d /= L
    sel = co[wn > 0.4]
    rel = sel - h
    along = rel @ d
    rings = []
    for f in (0.12, 0.3, 0.5, 0.7, 0.86, 0.97):
        band = sel[np.abs(along - f * L) < 0.05]
        c = h + d * f * L
        if len(band) < 6:
            continue
        off = band - c
        rings.append(((float(c[0]), float(c[1]), float(c[2])), float(np.abs(off[:, 0]).max() + 0.03),
                      float(np.abs(off[:, 2]).max() + 0.03)))
    if os.environ.get("R8_DEBUG"):
        print("R8 neck cover", [(tuple(round(v, 3) for v in c), round(a, 3), round(b, 3)) for c, a, b in rings],
              "neck bone", h.round(3).tolist(), t.round(3).tolist(), "selected", len(sel))
    ob = body2.loft(f"{hr.name}_r8neckcover", rings, mat, subsurf=1)
    bpy.context.view_layer.update()
    J = hr.j
    hr.skinners.append(body2.Skinner(ob, [(J["body"], tuple(h - d * 0.3), tuple(h)), (J["neck"], tuple(h), tuple(t))],
                                     base=hr.root.matrix_world.copy()))
    return ob


def face_mask(hr, mat, new, name="r8facemask"):
    """面簾: a plate over the forehead and the nose, poll to above the nostrils, 1.5 cm off the face; rigid on the head
    joint. From the new horse's own head (its vertices weighted to the head)."""
    B, co, wh = new["B"], new["co"], new["head_w"]
    h, t = np.array(B["Bone.002"][0]), np.array(B["Bone.002"][1])
    d = t - h
    L = np.linalg.norm(d)
    d /= L
    sel = co[wh > 0.5]
    along = (sel - h) @ d
    side = np.array([1.0, 0.0, 0.0])
    up = np.cross(d, side)                      # the face's front: perpendicular to the head line and to x
    if up[1] < 0:
        up = -up
    rings = []
    for f in (0.02, 0.2, 0.4, 0.6, 0.78):
        band = sel[np.abs(along - f * L) < 0.04]
        if len(band) < 6:
            continue
        c = h + d * f * L
        off = band - c
        rx = float(np.abs(off @ side).max() + 0.015)
        fr = float((off @ up).max() + 0.015)
        rings.append(((float(c[0]), float(c[1]), float(c[2])), rx, fr))
    ob = body2.loft(f"{hr.name}_{name}", rings, mat, subsurf=1)
    me = ob.data
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    hv = Vector(tuple(h))
    dv, uv = Vector(tuple(d)), Vector(tuple(up))
    # keep the front half (toward the face's front), drop the jaw side
    bmesh.ops.delete(bm, geom=[f_ for f_ in bm.faces if (f_.calc_center_median() - hv - dv * (
        (f_.calc_center_median() - hv).dot(dv))).dot(uv) < 0.0], context="FACES")
    bm.to_mesh(me)
    bm.free()
    bpy.context.view_layer.update()
    head = hr.j["head"]
    ob.parent = head
    ob.matrix_parent_inverse = head.matrix_world.inverted()
    return ob
