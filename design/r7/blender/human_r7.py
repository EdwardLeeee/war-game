"""R7 (D-092) version 2: a realistic human body from MPFB 2 (MakeHuman's Blender add-on; its base mesh, targets and
weights are CC0, the add-on's code GPLv3, outputs unrestricted: THIRD_PARTY_NOTICES.md) in place of our soldiers'
tube bodies, driven by the approved animations.

MPFB's own skeleton came out misfitted in background mode (2.0.18 on Blender 5.2: bone heads and tails from two
different placements), so only its mesh and its skin weights are used:
- its bone weights are merged onto our joints (MERGE);
- where two merged groups meet, the ring of vertices they share gives that joint's place on the MPFB body;
- each body part is moved, turned and scaled (a similarity per joint, blended by the weights) so the joints land on
  ours in our rest pose (arms down, the model facing +Y);
- a Skinner with those weights (WeightSkinner) is put on our rig: every pose of the approved animations moves it.
Clothes: the torso, upper arms and legs of the fitted body, pushed out 1.4 cm, in the design's tunic and trouser
colours (a fitted tunic and trousers under the armour, which stays ours).
"""
import addon_utils
import importlib
import math

import bpy
import numpy as np
from mathutils import Matrix, Vector

import body2
import lib

MPFB = "bl_ext.user_default.mpfb"
JOINTS = ("hips", "torso", "neck", "head", "shoulderR", "elbowR", "wristR", "shoulderL", "elbowL", "wristL",
          "hipR", "kneeR", "ankleR", "hipL", "kneeL", "ankleL")
FACE = ("jaw", "oris", "eye", "tongue", "levator", "special", "orbicularis", "temporalis", "oculi", "risorius", "head")
MACRO = dict(gender=1.0, age=0.5, muscle=0.6, weight=0.5, height=0.5, proportions=0.6)
_TEMPLATE = {}


def our_joint(g):
    """MPFB vertex group -> our joint name (None for the helper and region groups, and anything unsided)."""
    j = _our_joint(g)
    return j if j in JOINTS else None


def _our_joint(g):
    side = "L" if g.endswith(".L") else "R" if g.endswith(".R") else ""
    b = g[:-2] if side else g
    if b.startswith("upperleg"):
        return "hip" + side
    if b.startswith("lowerleg"):
        return "knee" + side
    if b.startswith(("foot", "toe")):
        return "ankle" + side
    if b.startswith("pelvis") or b in ("root", "spine05", "spine04"):
        return "hips"
    if b.startswith(("spine", "breast", "clavicle", "shoulder01")):
        return "torso"
    if b.startswith("upperarm"):
        return "shoulder" + side
    if b.startswith("lowerarm"):
        return "elbow" + side
    if b.startswith(("wrist", "finger", "metacarpal")):
        return "wrist" + side
    if b.startswith("neck"):
        return "neck"
    if b.startswith(FACE):
        return "head"
    return None


def template():
    """The MPFB body (once a Blender process): the helpers gone, the targets applied, turned to face +Y, weights merged
    onto our joints. Returns (co (n, 3), polygons, W (n, len(JOINTS)))."""
    if _TEMPLATE:
        return _TEMPLATE["co"], _TEMPLATE["polys"], _TEMPLATE["W"]
    addon_utils.enable(MPFB, default_set=True)
    hs = importlib.import_module(MPFB + ".services.humanservice").HumanService
    ts = importlib.import_module(MPFB + ".services.targetservice").TargetService
    macro = ts.get_default_macro_info_dict()
    macro.update(MACRO)
    body = hs.create_human(mask_helpers=True, detailed_helpers=False, extra_vertex_groups=True, feet_on_ground=True,
                           scale=0.1, macro_detail_dict=macro)
    rig = hs.add_builtin_rig(body, "default", import_weights=True)        # only for its weights
    for m in list(body.modifiers):
        if m.type == "ARMATURE":
            body.modifiers.remove(m)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(body.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    me.transform(Matrix.Rotation(math.pi, 4, "Z"))
    names = [g.name for g in body.vertex_groups]
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(n, 3).astype(np.float64)
    col = {j: k for k, j in enumerate(JOINTS)}
    W = np.zeros((n, len(JOINTS)))
    F = {}                          # (side, finger, phalanx) or (side, finger, 0) for its metacarpal -> weights (R8 grip)
    for v in me.vertices:
        for g in v.groups:
            name = names[g.group]
            j = our_joint(name)
            if j is not None:
                W[v.index, col[j]] += g.weight
            if name.startswith(("finger", "metacarpal")) and name[-2:] in (".L", ".R"):
                side = name[-1]
                if name.startswith("finger"):
                    f, p = name[6:-2].split("-")
                    key = (side, int(f), int(p))
                else:
                    key = (side, int(name[10:-2]) + 1, 0)            # metacarpal1 carries finger 2
                F.setdefault(key, np.zeros(n))[v.index] += g.weight
    s = W.sum(1, keepdims=True)
    W = np.where(s > 0, W / np.maximum(s, 1e-9), 0)
    W[s[:, 0] == 0, col["torso"]] = 1.0
    polys = [tuple(p.vertices) for p in me.polygons]
    for ob in (body, rig):
        bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    _TEMPLATE.update(co=co, polys=polys, W=W, F=F)
    return co, polys, W


def _ring(co, W, a, b, thr=0.12):
    c = {j: k for k, j in enumerate(JOINTS)}
    m = np.minimum(W[:, c[a]], W[:, c[b]])
    sel = m > thr
    if sel.sum() < 4:
        sel = m > 0.02
    return (co[sel] * m[sel, None]).sum(0) / m[sel].sum()


def _core(co, W, j, thr=0.85):
    c = {k: i for i, k in enumerate(JOINTS)}
    sel = W[:, c[j]] > thr
    return co[sel].mean(0)


def _sim(a, b, A, B, rotate=True):
    """The similarity that takes segment a-b onto A-B (uniform scale; no turn when rotate is False)."""
    a, b, A, B = (Vector(x) for x in (a, b, A, B))
    d1, d2 = b - a, B - A
    s = d2.length / max(d1.length, 1e-6)
    R = d1.rotation_difference(d2).to_matrix().to_4x4() if rotate else Matrix.Identity(4)
    return Matrix.Translation(A) @ R @ Matrix.Diagonal((s, s, s, 1.0)) @ Matrix.Translation(-a)


def fit(rig):
    """The template's vertices moved onto our rig in its zero pose: (co, W)."""
    co, polys, W = template()
    J = {k: Vector(rig.j[k].matrix_world.translation) for k in JOINTS}
    P = {}
    for s in "RL":
        P["shoulder" + s] = _ring(co, W, "torso", "shoulder" + s)
        P["elbow" + s] = _ring(co, W, "shoulder" + s, "elbow" + s)
        P["wrist" + s] = _ring(co, W, "elbow" + s, "wrist" + s)
        P["hand" + s] = _core(co, W, "wrist" + s)
        P["hip" + s] = _ring(co, W, "hips", "hip" + s)
        P["knee" + s] = _ring(co, W, "hip" + s, "knee" + s)
        P["ankle" + s] = _ring(co, W, "knee" + s, "ankle" + s)
    P["neck"] = _ring(co, W, "torso", "neck")
    P["head"] = _ring(co, W, "neck", "head")
    mid_m = (P["hipR"] + P["hipL"]) / 2
    mid_o = (J["hipR"] + J["hipL"]) / 2
    A = {}
    A["hips"] = A["torso"] = _sim(mid_m, P["neck"], mid_o, J["neck"])
    A["neck"] = _sim(P["neck"], P["head"], J["neck"], J["head"])
    sn = (J["head"] - J["neck"]).length / max(np.linalg.norm(P["head"] - P["neck"]), 1e-6)
    A["head"] = Matrix.Translation(J["head"]) @ Matrix.Diagonal((sn, sn, sn, 1)) @ Matrix.Translation(-Vector(P["head"]))
    for s in "RL":
        A["shoulder" + s] = _sim(P["shoulder" + s], P["elbow" + s], J["shoulder" + s], J["elbow" + s])
        A["elbow" + s] = _sim(P["elbow" + s], P["wrist" + s], J["elbow" + s], J["wrist" + s])
        # the hand keeps its shape, turned with the forearm
        fe = A["elbow" + s]
        A["wrist" + s] = Matrix.Translation(J["wrist" + s]) @ fe.to_3x3().to_4x4() @ Matrix.Translation(-Vector(P["wrist" + s]))
        A["hip" + s] = _sim(P["hip" + s], P["knee" + s], J["hip" + s], J["knee" + s])
        A["knee" + s] = _sim(P["knee" + s], P["ankle" + s], J["knee" + s], J["ankle" + s])
        sk = (J["ankle" + s] - J["knee" + s]).length / max(np.linalg.norm(P["ankle" + s] - P["knee" + s]), 1e-6)
        A["ankle" + s] = (Matrix.Translation(J["ankle" + s]) @ Matrix.Diagonal((sk, sk, sk, 1))
                          @ Matrix.Translation(-Vector(P["ankle" + s])))
    hom = np.hstack([co, np.ones((len(co), 1))])
    out = np.zeros_like(co)
    for k, j in enumerate(JOINTS):
        m = np.array(A[j])
        out += (hom @ m.T)[:, :3] * W[:, k:k + 1]
    if GRIP:
        out = curl_fingers(out, _TEMPLATE["F"])
    return out, polys, W


GRIP = False                      # R8: the fingers closed round a grip (curl_fingers)
CURL = {"finger": (65, 100, 120), "thumb": (25, 40, 45)}     # degrees at each phalanx, added up toward the tip


def curl_fingers(co, F):
    """The fitted hands (arms down, palms toward the thighs) closed: every finger turned at its knuckle toward the
    palm, more at each phalanx; the thumb a little. The knuckle is the ring the finger shares with its metacarpal
    (the thumb: with the wrist's own vertices)."""
    out = co.copy()
    for side, sgn in (("R", 1.0), ("L", -1.0)):
        for f in range(1, 6):
            ws = [F.get((side, f, p)) for p in (1, 2, 3)]
            if any(w is None for w in ws):
                continue
            base = F.get((side, f, 0))
            w1 = ws[0]
            if base is not None:
                m = np.minimum(base, w1)
            else:
                m = np.minimum(w1, 1 - w1) * (w1 > 0)
            if m.sum() < 1e-6:
                continue
            pivot = (co * m[:, None]).sum(0) / m.sum()
            steps = CURL["thumb" if f == 1 else "finger"]
            ang = np.radians(sum(ws[p] * steps[p] for p in range(3)))
            sel = ang > 1e-4
            d = co[sel] - pivot
            a = sgn * ang[sel]
            c, s = np.cos(a), np.sin(a)
            # about the front-back axis (y): the tip goes toward the body
            x = d[:, 0] * c + d[:, 2] * s
            z = -d[:, 0] * s + d[:, 2] * c
            out[sel, 0] = pivot[0] + x
            out[sel, 2] = pivot[2] + z
            out[sel, 1] = co[sel, 1]
    return out


class WeightSkinner(body2.Skinner):
    """body2.Skinner with given weights (top 4) instead of distance ones."""

    def __init__(self, obj, joints, rest, W, top=4):
        self.obj, self.joints, self.rest = obj, joints, rest
        idx = np.argsort(-W, axis=1)[:, :top]
        w = np.take_along_axis(W, idx, 1)
        w /= np.maximum(w.sum(1, keepdims=True), 1e-9)
        self.idx, self.w = idx, w
        bpy.context.view_layer.update()
        self.rest_inv = [np.array(j.matrix_world.inverted()) for j in joints]


def _mesh(name, co, polys, mats, face_mat=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(c) for c in co], [], polys)
    for m in mats:
        me.materials.append(m)
    if face_mat is not None:
        me.polygons.foreach_set("material_index", face_mat)
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    lib.ALL_PARTS.append(ob)
    return ob


def dress(u, kind, helmet_scale=0.78, team_tunic=False):
    """Version 2 on one built unit: our body, head and hands hidden, the MPFB body and its clothes skinned to our rig,
    the helmet scaled to a real head; the clothes in our body's own tunic and trouser materials."""
    rig = u.rigs["body"]
    body2.zero_pose(rig)
    co, polys, W = fit(rig)
    J = [rig.j[k] for k in JOINTS]
    skin = lib.mat("r7_skin", (0.55, 0.38, 0.27), 0.5)
    skin.node_tree.nodes["Principled BSDF"].inputs["Subsurface Weight"].default_value = 0.15
    # the feet go: our boots stand on the ankles, the bare feet stuck out under them
    c = {k: i for i, k in enumerate(JOINTS)}
    foot = W[:, c["ankleR"]] + W[:, c["ankleL"]]
    bpolys = [p for p in polys if foot[list(p)].mean() < 0.5]
    bodyob = _mesh(f"{kind}_r7body", co, bpolys, [skin])
    sks = [WeightSkinner(bodyob, J, co, W)]
    # the clothes: faces whose vertices are mostly torso / upper arm (tunic) or hips / legs above the ankle (trousers)
    tunic = W[:, [c["torso"], c["shoulderR"], c["shoulderL"], c["neck"]]].sum(1) * (1 - W[:, c["neck"]])
    trousers = W[:, [c["hips"], c["hipR"], c["hipL"], c["kneeR"], c["kneeL"]]].sum(1)
    keep, mat = [], []
    for p in polys:
        t, r = tunic[list(p)].mean(), trousers[list(p)].mean()
        if max(t, r) > 0.6:
            keep.append(p)
            mat.append(0 if t >= r else 1)
    used = sorted({i for p in keep for i in p})
    remap = {o: k for k, o in enumerate(used)}
    cpolys = [tuple(remap[i] for i in p) for p in keep]
    # pushed out along the vertex normals of the fitted body
    tmp = bpy.data.meshes.new("tmp_normals")
    tmp.from_pydata([tuple(x) for x in co], [], polys)
    tmp.update()
    nrm = np.empty(len(co) * 3, np.float32)
    tmp.vertices.foreach_get("normal", nrm)
    nrm = nrm.reshape(-1, 3)
    bpy.data.meshes.remove(tmp)
    cco = co[used] + nrm[used] * 0.014
    ours = next(o for o in bpy.data.objects if o.name.split(".")[0] == f"{kind}_body" and not o.hide_render)
    tunic_m = ours.data.materials[0]
    if team_tunic:                                # R8: the tunic in the player's colour (front, sides and sleeves)
        tunic_m = next((v["mat"] for v in lib.MATS.values() if v.get("kind") == "team"), tunic_m)
    cloth = _mesh(f"{kind}_r7clothes", cco, cpolys, [tunic_m, ours.data.materials[1]], mat)
    sks.append(WeightSkinner(cloth, J, cco, W[used]))
    rig.skinners = list(getattr(rig, "skinners", [])) + sks
    # hide our own body, head, hands and face; shrink the helmet to a real head
    # hide our own body, hands and head with its face (brows, ears, eyes, nose, mouth, beard); keep the helmet that
    # hangs on the head, shrunk to a real head
    hidden, helmet = [], []
    for ob in list(bpy.data.objects):
        base = ob.name.split(".")[0]
        if not base.startswith(kind + "_") or "r7" in base or ob.hide_render:
            continue
        rest = base[len(kind) + 1:]
        if rest in ("body", "head", "beard") or rest.startswith(("head_", "hand", "thumb", "knuckle")):
            ob.hide_render = True
            hidden.append(rest)
    for ch in rig.j["head"].children:             # the helmet's parts hang on the head joint (units2.east_helmet2)
        if not ch.hide_render and ch.type == "MESH":
            ch.location = ch.location * helmet_scale
            ch.scale = ch.scale * helmet_scale
            helmet.append(ch.name)
    print("R7 v2", kind, "hid", hidden, "helmet", helmet)
    rig.pose()
    return sks, [bodyob, cloth]
