"""R4 術士 designs in the direction the user asked for: 道士 or 修仙者 (level C, R2 body).

TA 道長  an elder Taoist: black robe with white bands and wide sleeves, crescent crown on a
         white topknot, long beard, horsetail whisk in the left hand, the seal in the right,
         gold trigram marks on the back.
TB 劍修  a young sword cultivator: pale layered robe over a dark inner robe, high ponytail with
         a jade crown, a tasselled sword across the back, player-colour sash with long ties.
TC 女修  a female cultivator: double hair buns with pins, high-waisted jacket and long skirt,
         a long player-colour 披帛 looped behind the back and over both arms.
Rules kept: they serve as the army's elite (look only changes), never fly, no metal armour,
the seal is the implement, player colour only on sash / ties / 披帛.
Robes get vertical folds so they no longer read as cones.
"""
import math

import bmesh
import bpy
from mathutils import Vector

import body2
import humanoid2 as h2
import lib
import mage3
from lib import box, cyl, ico, lathe, mat, rod, slab, sphere


def M4():
    return dict(
        black=mat("black4", (0.04, 0.04, 0.045), 0.7, noise=0.25, noise_scale=6, pattern="cloth", pattern_scale=100),
        white=mat("white4", (0.86, 0.85, 0.8), 0.8, noise=0.1, noise_scale=6, pattern="cloth", pattern_scale=100),
        jade=mat("jade4", (0.82, 0.86, 0.83), 0.78, noise=0.12, noise_scale=6, pattern="cloth", pattern_scale=110),
        slate=mat("slate4", (0.26, 0.28, 0.29), 0.8, noise=0.2, noise_scale=6, pattern="cloth", pattern_scale=100),
        cream=mat("cream4", (0.9, 0.83, 0.72), 0.8, noise=0.1, noise_scale=6, pattern="cloth", pattern_scale=110),
        taupe=mat("taupe4", (0.42, 0.36, 0.33), 0.8, noise=0.15, noise_scale=6, pattern="cloth", pattern_scale=110),
        greyhair=mat("greyhair4", (0.78, 0.77, 0.74), 0.6, sheen=0.4),
        wood=mat("wood4", (0.35, 0.22, 0.12), 0.55, noise=0.3, noise_scale=8),
        lacquer=mat("scabbard4", (0.08, 0.06, 0.05), 0.35, noise=0.1, noise_scale=10),
        jadestone=mat("jadestone4", (0.35, 0.62, 0.52), 0.25, sheen=0.3),
    )


def folded_lathe(name, profile, material, rig, bones, folds=(9, 0.05), segs=48, scale=(1, 1, 1), at=(0, 0, 0),
                 cut=None):
    """A skinned garment with vertical folds that deepen toward the hem."""
    ob = lathe(name, profile, material, None, segs=segs, scale=scale, at=at, cap=False)
    zs = [p[1] for p in profile]
    ztop, zbot = max(zs), min(zs)
    n, amp = folds
    for v in ob.data.vertices:
        x, y, z = v.co.x - at[0], v.co.y - at[1], v.co.z
        th = math.atan2(y, x)
        depth = max(0.0, min(1.0, (ztop - z) / max(1e-6, ztop - zbot)))
        k = 1 + amp * depth ** 1.5 * math.sin(n * th + 0.7 * math.sin(3 * th))
        v.co.x = at[0] + x * k
        v.co.y = at[1] + y * k
    if cut:
        me = ob.data
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if cut(f.calc_center_median())], context="FACES")
        bm.to_mesh(me)
        bm.free()
    bpy.context.view_layer.update()
    rig.skinners.append(body2.Skinner(ob, bones, base=rig.root.matrix_world.copy()))
    return ob


def ribbon(name, pts, width, material, rig, bones, thick=0.008):
    """A flat cloth strip along a path, face turned outward from the body axis; skinned."""
    bm = bmesh.new()
    P = [Vector(p) for p in pts]
    rows = []
    for i, p in enumerate(P):
        a, b = P[max(0, i - 1)], P[min(len(P) - 1, i + 1)]
        t = (b - a).normalized()
        out = Vector((p.x, p.y, 0.0))
        out = out.normalized() if out.length > 1e-4 else Vector((0, -1, 0))
        wdir = t.cross(out)
        if wdir.length < 1e-4:
            wdir = Vector((0, 0, 1))
        wdir.normalize()
        rows.append((bm.verts.new(p - wdir * width / 2), bm.verts.new(p + wdir * width / 2)))
    for i in range(len(rows) - 1):
        bm.faces.new((rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(material)
    so = ob.modifiers.new("thick", "SOLIDIFY")
    so.thickness = thick
    ss = ob.modifiers.new("sub", "SUBSURF")
    ss.levels = 1
    dg = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    out_ob = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(out_ob)
    mesh.materials.clear()
    mesh.materials.append(material)
    for p in mesh.polygons:
        p.use_smooth = True
    lib.ALL_PARTS.append(out_ob)
    lib._add_hull(out_ob)
    bpy.context.view_layer.update()
    rig.skinners.append(body2.Skinner(out_ob, bones, base=rig.root.matrix_world.copy()))
    return out_ob


def _wide_sleeves(r, mat_, b, cuff=None, flare=0.19):
    for side in ("R", "L"):
        x = 0.215 * (1 if side == "R" else -1) * b
        folded_lathe(f"mage_e_sleeve{side}", [(0.075, 1.42), (0.09, 1.2), (0.14, 1.02), (flare, 0.86), (flare + 0.01, 0.8)],
                     mat_, r, mage3._arm(r, side, b), folds=(7, 0.06), segs=24, at=(x, 0, 0))
        if cuff:
            folded_lathe(f"mage_e_cuff{side}", [(flare + 0.004, 0.8), (flare + 0.006, 0.86)], cuff, r,
                         mage3._arm(r, side, b), folds=(7, 0.06), segs=24, at=(x, 0, 0))


# ---------------------------------------------------------------- TA 道長

def style_ta(u, M):
    X = M4()
    b = 0.95
    r = h2.humanoid2("mage_e", M["skin"], X["black"], X["black"], M["boots"], detail="C", parent=u.root, bulk=b,
                     head_r=0.125)
    body2.zero_pose(r)
    tb, lg = mage3._torso(r), mage3._legs(r, b)
    folded_lathe("mage_e_robe", [(0.155, 1.46), (0.176, 1.26), (0.176, 1.02), (0.21, 0.7), (0.245, 0.35), (0.26, 0.05)],
                 X["black"], r, tb + lg, folds=(10, 0.06), scale=(1, 0.84, 1))
    folded_lathe("mage_e_hem", [(0.258, 0.05), (0.262, 0.16)], X["white"], r, tb + lg, folds=(10, 0.06),
                 scale=(1, 0.84, 1))
    h2.skinned_lathe("mage_e_sash", [(0.18, 0.99), (0.184, 1.09)], M["team"], r, tb, scale=(1, 0.82, 1), segs=28)
    _wide_sleeves(r, X["black"], b, cuff=X["white"])
    r.pose()
    J = r.j
    # crossed white collar bands
    for s in (-1, 1):
        box(f"mage_e_collar{s}", (0.045, 0.02, 0.34), X["white"], J["torso"], at=(0.045 * s, 0.108, 0.3),
            rot=(0, -24 * s, 0))
    # sash ties hanging in front
    for s in (-1, 1):
        slab(f"mage_e_tie{s}", [(0, 0), (0.05, 0), (0.055, -0.46), (0.0, -0.44)], 0.01, M["team"], parent=J["torso"],
             loc=(0.05 * s - 0.025, 0.14, 0.02), rot=(-5, 0, 6 * s))
    # gold trigram marks in a ring on the back
    for k in range(8):
        a = 2 * math.pi * k / 8
        box(f"mage_e_gua{k}", (0.05, 0.01, 0.012), M["gold"], J["torso"],
            loc=(0.09 * math.cos(a), -0.128, 0.28 + 0.09 * math.sin(a)), rot=(0, -math.degrees(a) + 90, 0),
            outline=False)
    sphere("mage_e_taiji", 0.028, X["white"], J["torso"], at=(0, -0.13, 0.28), scale=(1, 0.3, 1), outline=False)
    # white hair, topknot and crescent crown, long beard and moustache
    head = J["head"]
    sphere("mage_e_hair", 0.133, X["greyhair"], head, at=(0, -0.025, 0.15), scale=(1, 1, 0.95))
    sphere("mage_e_knot", 0.055, X["greyhair"], head, at=(0, -0.02, 0.3))
    crescent = [(-0.07, 0.0), (0.07, 0.0), (0.06, 0.05), (0.03, 0.03), (0.0, 0.025), (-0.03, 0.03), (-0.06, 0.05)]
    slab("mage_e_crown", crescent, 0.03, M["gold"], parent=head, loc=(0, -0.02, 0.33), rot=(0, 0, 90))
    rod("mage_e_pin", (-0.09, -0.02, 0.33), (0.09, -0.02, 0.33), 0.008, X["jadestone"], parent=head)
    lathe("mage_e_beard", [(0.0, -0.3), (0.035, -0.22), (0.07, -0.08), (0.08, 0.02), (0.06, 0.07)], X["greyhair"], head,
          at=(0, 0.08, 0.1), scale=(1, 0.6, 1), segs=14)
    for s in (-1, 1):
        rod(f"mage_e_moust{s}", (0.0, 0.125, 0.085), (0.07 * s, 0.1, 0.02), 0.012, X["greyhair"], parent=head, r2=0.004)
    # horsetail whisk in the left hand, the seal in the right
    gl = r.joint("grip_whisk", J["wristL"], (0, 0.0, -0.06))
    rod("mage_e_whiskhandle", (0, 0, 0.1), (0, 0, -0.18), 0.014, X["wood"], parent=gl)
    lathe("mage_e_whisk", [(0.015, 0.0), (0.05, -0.08), (0.045, -0.3), (0.0, -0.42)], X["white"], gl, at=(0, 0, -0.17),
          segs=12)
    gr = r.joint("grip_seal", J["wristR"], (0, 0.02, -0.1))
    mage3.seal("mage_e_seal", M, gr, 1.0)
    return r


# ---------------------------------------------------------------- TB 劍修

def style_tb(u, M):
    X = M4()
    b = 0.95
    r = h2.humanoid2("mage_e", M["skin"], X["slate"], X["slate"], M["boots"], detail="C", parent=u.root, bulk=b,
                     head_r=0.122)
    body2.zero_pose(r)
    tb, lg = mage3._torso(r), mage3._legs(r, b)
    # outer pale robe, open at the front below the waist; dark inner robe shows through
    folded_lathe("mage_e_inner", [(0.15, 1.46), (0.168, 1.25), (0.166, 1.02), (0.19, 0.7), (0.21, 0.4)], X["slate"], r,
                 tb + lg, folds=(8, 0.04), scale=(1, 0.82, 1))
    folded_lathe("mage_e_robe", [(0.16, 1.46), (0.18, 1.26), (0.178, 1.02), (0.22, 0.7), (0.25, 0.3), (0.26, 0.12)],
                 X["jade"], r, tb + lg, folds=(9, 0.055), scale=(1, 0.84, 1),
                 cut=lambda c: c.y > 0.08 and abs(c.x) < 0.1 and c.z < 1.0)
    h2.skinned_lathe("mage_e_sash", [(0.182, 0.99), (0.186, 1.08)], M["team"], r, tb, scale=(1, 0.84, 1), segs=28)
    _wide_sleeves(r, X["jade"], b, cuff=X["slate"], flare=0.16)
    # long player-colour sash ties flowing behind
    ribbon("mage_e_tieR", [(0.12, -0.14, 1.03), (0.16, -0.24, 0.9), (0.2, -0.36, 0.7), (0.26, -0.46, 0.5)], 0.06,
           M["team"], r, tb + lg)
    ribbon("mage_e_tieL", [(0.06, -0.15, 1.03), (0.04, -0.26, 0.88), (0.02, -0.38, 0.66), (0.0, -0.48, 0.44)], 0.05,
           M["team"], r, tb + lg)
    r.pose()
    J = r.j
    head = J["head"]
    sphere("mage_e_hair", 0.13, M["hair"], head, at=(0, -0.02, 0.15), scale=(1, 1, 0.95))
    cyl("mage_e_guan", 0.045, 0.07, X["jadestone"], head, at=(0, -0.01, 0.28))
    rod("mage_e_pin", (-0.08, -0.01, 0.31), (0.08, -0.01, 0.31), 0.007, M["gold"], parent=head)
    lathe("mage_e_tail", [(0.04, 0.0), (0.05, -0.12), (0.04, -0.34), (0.0, -0.5)], M["hair"], head,
          at=(0, -0.12, 0.3), rot=(-25, 0, 0), segs=12, scale=(1, 0.7, 1))
    # sword across the back, hilt over the right shoulder
    sw = lib.empty("mage_e_swordroot", parent=J["torso"], loc=(0.0, -0.15, 0.25), rot=(0, 38, 0))
    cyl("mage_e_scabbard", 0.03, 0.8, X["lacquer"], sw, at=(0, 0, -0.45), scale=(1, 0.45, 1))
    cyl("mage_e_guard", 0.055, 0.025, M["gold"], sw, at=(0, 0, 0.35), scale=(1, 0.4, 1))
    cyl("mage_e_hilt", 0.018, 0.18, X["wood"], sw, at=(0, 0, 0.375))
    sphere("mage_e_pommel", 0.025, M["gold"], sw, at=(0, 0, 0.56))
    rod("mage_e_swordtassel", (0, 0, 0.56), (0.02, -0.03, 0.4), 0.018, X["white"], parent=sw, r2=0.004)
    gr = r.joint("grip_seal", J["wristR"], (0, 0.02, -0.1))
    mage3.seal("mage_e_seal", M, gr, 1.0)
    return r


# ---------------------------------------------------------------- TC 女修

def style_tc(u, M):
    X = M4()
    b = 0.88
    r = h2.humanoid2("mage_e", M["skin"], X["cream"], X["taupe"], M["boots"], detail="C", parent=u.root, bulk=b,
                     head_r=0.118)
    body2.zero_pose(r)
    tb, lg = mage3._torso(r), mage3._legs(r, b)
    # high-waisted: short jacket, sash under the chest, long skirt to the ground
    folded_lathe("mage_e_skirt", [(0.15, 1.3), (0.16, 1.1), (0.2, 0.75), (0.25, 0.35), (0.28, 0.03)], X["taupe"], r,
                 tb + lg, folds=(12, 0.06), scale=(1, 0.86, 1))
    folded_lathe("mage_e_jacket", [(0.145, 1.46), (0.16, 1.34), (0.165, 1.26)], X["cream"], r, tb, folds=(6, 0.02),
                 scale=(1, 0.8, 1))
    h2.skinned_lathe("mage_e_sash", [(0.165, 1.25), (0.168, 1.32)], M["team"], r, tb, scale=(1, 0.8, 1), segs=28)
    _wide_sleeves(r, X["cream"], b, flare=0.15)
    # 披帛: from the left hand up the outside of the arm, behind the back, down the right arm, ends hanging
    arms = mage3._arm(r, "R", b) + mage3._arm(r, "L", b)
    x = 0.215 * b
    path = [(-x - 0.12, 0.02, 0.55), (-x - 0.1, 0.02, 0.8), (-x - 0.09, 0.0, 1.05), (-x - 0.06, -0.06, 1.28),
            (-0.12, -0.2, 1.3), (0.0, -0.22, 1.24), (0.12, -0.2, 1.3), (x + 0.06, -0.06, 1.28), (x + 0.09, 0.0, 1.05),
            (x + 0.1, 0.02, 0.8), (x + 0.12, 0.02, 0.55)]
    ribbon("mage_e_pibo", path, 0.075, M["team"], r, arms + tb)
    r.pose()
    J = r.j
    head = J["head"]
    sphere("mage_e_hair", 0.128, M["hair"], head, at=(0, -0.02, 0.14), scale=(1, 1, 0.95))
    for s in (-1, 1):
        sphere(f"mage_e_bun{s}", 0.06, M["hair"], head, at=(0.07 * s, -0.02, 0.3))
        rod(f"mage_e_hairpin{s}", (0.07 * s, -0.08, 0.3), (0.11 * s, 0.06, 0.34), 0.006, M["gold"], parent=head)
        ico(f"mage_e_pingem{s}", 0.018, M["crystal"], head, at=(0.11 * s, 0.06, 0.34), subdiv=1, smooth=False)
    gr = r.joint("grip_seal", J["wristR"], (0, 0.02, -0.1))
    mage3.seal("mage_e_seal", M, gr, 0.95)
    return r


mage3.STYLES.update({"TA": style_ta, "TB": style_tb, "TC": style_tc})


def build(style):
    return mage3.build(style)
