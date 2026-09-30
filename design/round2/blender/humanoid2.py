"""R2 smooth humanoid and horse. Joint layout is identical to R1 humanoid.py,
so every R1 pose (walk, idle, fall, attacks, gallop) drives these bodies.

detail = "B": shaped body, head, hands, boots.
detail = "C": B + face (brows, eyes, nose, mouth, beard), knuckles, boot straps.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector

import body2
import lib
from humanoid import Rig, H_HIP   # R1 rig class and pose conventions
from lib import box, cyl, ico, lathe, mat, sphere


def _head_mesh(name, r, material, parent, detail, face_mats):
    """A shaped head: fuller cranium, narrower jaw, a chin; C adds the face."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=16, radius=r)
    for v in bm.verts:
        x, y, z = v.co
        if z < 0:                       # jaw narrows and comes forward a little
            k = 1 + z / r * 0.28
            v.co.x *= k
            v.co.y = y * (1 + z / r * 0.1) + (-z / r) * 0.02
        if y < 0:                       # rounder back of the skull
            v.co.y *= 1.08
        v.co.z *= 1.08
    ob = lib._mesh_obj(name, bm, material, parent, loc=(0, 0.01, r * 1.0))
    if detail == "C":
        ink, white, lip = face_mats
        fz = r * 1.0
        for s in (-1, 1):
            sphere(f"{name}_eyew{s}", r * 0.16, white, parent, at=(0.042 * s * r / 0.13, r * 0.9, fz + r * 0.12),
                   scale=(1.2, 0.5, 0.8), outline=False)
            sphere(f"{name}_eyep{s}", r * 0.09, ink, parent, at=(0.042 * s * r / 0.13, r * 0.96, fz + r * 0.12),
                   scale=(1, 0.5, 1), outline=False)
            box(f"{name}_brow{s}", (r * 0.34, r * 0.08, r * 0.07), ink, parent,
                at=(0.045 * s * r / 0.13, r * 0.9, fz + r * 0.3), rot=(0, 12 * s, 0), outline=False)
            sphere(f"{name}_ear{s}", r * 0.2, material, parent, at=(r * 0.98 * s, -r * 0.05, fz + r * 0.05),
                   scale=(0.4, 0.8, 1.2))
        lib.rod(f"{name}_nose", (0, r * 0.92, fz + r * 0.14), (0, r * 1.12, fz - r * 0.12), r * 0.08, material,
                parent=parent, r2=r * 0.14, segs=8)
        box(f"{name}_mouth", (r * 0.36, r * 0.05, r * 0.05), lip, parent, at=(0, r * 0.9, fz - r * 0.36),
            outline=False)
    return ob


def humanoid2(name, skin, cloth, pants, boots, detail="B", head_r=0.13, bulk=1.0, parent=None, sit=False,
              sleeve_skin=False, beard=None):
    rig = Rig(name)
    if parent is not None:
        rig.root.parent = parent
    j = rig.joint
    hips = j("hips", rig.root, (0, 0, H_HIP))
    torso = j("torso", hips, (0, 0, 0.08))
    neck = j("neck", torso, (0, 0, 0.47))
    head = j("head", neck, (0, 0, 0.08))
    for side, s in (("R", 1), ("L", -1)):
        sh = j(f"shoulder{side}", torso, (0.215 * s * bulk, 0, 0.41))
        el = j(f"elbow{side}", sh, (0, 0, -0.3))
        j(f"wrist{side}", el, (0, 0, -0.26))
        th = j(f"hip{side}", hips, (0.1 * s * bulk, 0, -0.03))
        kn = j(f"knee{side}", th, (0, 0, -0.45))
        j(f"ankle{side}", kn, (0, 0, -0.42))
    body2.zero_pose(rig)
    rig.base = rig.root.matrix_world.copy()     # the body is designed at the origin, then moved here
    b = bulk
    V = [(0, 0, 0.93), (0, 0, 1.07), (0, 0, 1.24), (0, 0, 1.39), (0, 0, 1.47), (0, 0, 1.585)]
    R = [(0.15 * b, 0.105 * b), (0.122 * b, 0.09 * b), (0.158 * b, 0.1 * b), (0.172 * b, 0.1 * b),
         (0.062, 0.062), (0.052, 0.052)]
    E = [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5)]
    for s in (1, -1):
        x0 = 0.215 * s * b
        base = len(V)
        V += [(0.19 * s * b, 0, 1.4), (x0, 0, 1.28), (x0, 0, 1.14), (x0, 0.005, 1.02), (x0, 0.01, 0.9)]
        R += [(0.064 * b, 0.064 * b), (0.055 * b, 0.055 * b), (0.044 * b, 0.046 * b), (0.043 * b, 0.043 * b),
              (0.033, 0.03)]
        E += [(3, base), (base, base + 1), (base + 1, base + 2), (base + 2, base + 3), (base + 3, base + 4)]
        xl = 0.1 * s * b
        base = len(V)
        V += [(xl, 0, 0.9), (xl, 0.005, 0.7), (xl, 0.01, 0.48), (xl, -0.01, 0.3), (xl, 0, 0.1)]
        R += [(0.082 * b, 0.082 * b), (0.072 * b, 0.075 * b), (0.054 * b, 0.058 * b), (0.056 * b, 0.058 * b),
              (0.038, 0.04)]
        E += [(0, base), (base, base + 1), (base + 1, base + 2), (base + 2, base + 3), (base + 3, base + 4)]
    bodyob = body2.skin_mesh(name + "_body", V, E, R, cloth, root=1, subsurf=2)
    # material per region: 0 cloth (torso, sleeves), 1 pants (legs), 2 skin (neck, bare forearms)
    me = bodyob.data
    me.materials.append(pants)
    me.materials.append(skin)
    J = rig.j
    bones = [(J["hips"], (0, 0, 0.84), (0, 0, 1.03)), (J["torso"], (0, 0, 1.03), (0, 0, 1.45)),
             (J["neck"], (0, 0, 1.46), (0, 0, 1.6))]
    for side, s in (("R", 1), ("L", -1)):
        x0 = 0.215 * s * b
        bones += [(J[f"shoulder{side}"], (0.19 * s * b, 0, 1.41), (x0, 0, 1.14)),
                  (J[f"elbow{side}"], (x0, 0, 1.14), (x0, 0, 0.88)),
                  (J[f"hip{side}"], (0.1 * s * b, 0, 0.92), (0.1 * s * b, 0, 0.47)),
                  (J[f"knee{side}"], (0.1 * s * b, 0, 0.47), (0.1 * s * b, 0, 0.05))]
    sk = body2.Skinner(bodyob, bones, base=rig.base)
    dom = sk.idx[:, 0]
    region = np.zeros(len(bones), int)
    for k, (jt, _, _) in enumerate(bones):
        nm = jt.name.split("_")[-1]
        if nm.startswith(("hip", "knee")) and nm != "hips":
            region[k] = 1
        elif nm == "neck" or (sleeve_skin and nm.startswith("elbow")):
            region[k] = 2
    for p in me.polygons:
        votes = np.bincount(region[dom[list(p.vertices)]], minlength=3)
        p.material_index = int(np.argmax(votes))
    rig.skinners = [sk]
    # rigid parts: head, hands, boots
    face_mats = (mat("ink_face", (0.06, 0.05, 0.05), 0.5), mat("eye_white", (0.85, 0.83, 0.78), 0.4),
                 mat("lip", (0.45, 0.22, 0.18), 0.6))
    _head_mesh(name + "_head", head_r, skin, J["head"], detail, face_mats)
    if beard and detail == "C":
        lathe(name + "_beard", [(0.0, -0.07), (0.07, -0.02), (0.085, 0.05), (0.07, 0.1)], beard, J["head"],
              at=(0, 0.06, head_r * 0.62), scale=(1, 0.7, 1), segs=12)
    for side, s in (("R", 1), ("L", -1)):
        wr = J[f"wrist{side}"]
        sphere(f"{name}_hand{side}", 0.048, skin, wr, at=(0, 0.005, -0.055), scale=(0.8, 0.55, 1.15))
        lib.rod(f"{name}_thumb{side}", (-0.02 * s, 0.03, -0.02), (-0.03 * s, 0.05, -0.07), 0.016, skin, parent=wr,
                segs=8)
        if detail == "C":
            for k in range(4):
                sphere(f"{name}_knuckle{side}{k}", 0.012, skin, wr,
                       at=((-0.021 + k * 0.014) * s, 0.03, -0.085), outline=False)
        an = J[f"ankle{side}"]
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co.x *= 0.1
            v.co.y *= 0.24
            v.co.z *= 0.1
            if v.co.y > 0 and v.co.z > 0:
                v.co.z -= 0.035          # toe slopes down
            v.co.y += 0.045
            v.co.z -= 0.03
        ob = lib._mesh_obj(f"{name}_boot{side}", bm, boots, an, smooth=False)
        m = ob.modifiers.new("bevel", "BEVEL")
        m.width = 0.022
        m.segments = 3
        cyl(f"{name}_bootcuff{side}", 0.052, 0.14, boots, an, at=(0, 0, 0.0), r2=0.06)
        if detail == "C":
            cyl(f"{name}_strap{side}", 0.061, 0.018, mat("strap", (0.2, 0.14, 0.09), 0.6), an, at=(0, 0, 0.09),
                outline=False)
    if sit:
        rig.rest.update({"hipR": (80, -18, 0), "hipL": (80, 18, 0), "kneeR": (-78, 0, 0), "kneeL": (-78, 0, 0)})
    rig.pose()
    return rig


def skinned_lathe(name, profile, material, rig, bones, segs=28, scale=(1, 1, 1), at=(0, 0, 0)):
    """A garment (robe, skirt, sleeve) built at rest in world space and skinned to the rig."""
    ob = lathe(name, profile, material, None, segs=segs, scale=scale, at=at, cap=False)
    bpy.context.view_layer.update()
    sk = body2.Skinner(ob, bones, base=rig.root.matrix_world.copy())   # designed at the origin
    rig.skinners.append(sk)
    return ob


def update(rig):
    for sk in getattr(rig, "skinners", []):
        sk.update()


# ------------------------------------------------------------------ horse

def horse2(name, coat, mane, hoof, detail="B", parent=None):
    """Horse with one continuous body mesh; joints as in R1 horse()."""
    rig = Rig(name)
    if parent is not None:
        rig.root.parent = parent
    j = rig.joint
    body = j("body", rig.root, (0, 0, 1.18))
    neck = j("neck", body, (0, 0.62, 0.18), (-38, 0, 0))
    head = j("head", neck, (0, 0, 0.6), (-112, 0, 0))
    j("tail", body, (0, -0.72, 0.18), (150, 0, 0))
    for leg, (x, y) in {"FR": (0.16, 0.5), "FL": (-0.16, 0.5), "BR": (0.17, -0.52), "BL": (-0.17, -0.52)}.items():
        up = j(f"leg{leg}", body, (x, y, -0.1))
        j(f"low{leg}", up, (0, 0, -0.5))
    saddle = j("saddle", body, (0, -0.05, 0.3))
    rig.pose()
    bpy.context.view_layer.update()
    rig.base = rig.root.matrix_world.copy()
    spine = [((0, -0.84, 1.31), 0.07, 0.07), ((0, -0.72, 1.28), 0.2, 0.2), ((0, -0.58, 1.23), 0.27, 0.28),
             ((0, -0.4, 1.2), 0.3, 0.33), ((0, -0.12, 1.17), 0.31, 0.35), ((0, 0.16, 1.17), 0.3, 0.35),
             ((0, 0.4, 1.2), 0.27, 0.33), ((0, 0.57, 1.28), 0.21, 0.3), ((0, 0.69, 1.44), 0.16, 0.22),
             ((0, 0.81, 1.64), 0.115, 0.15), ((0, 0.92, 1.8), 0.09, 0.1), ((0, 0.99, 1.85), 0.085, 0.095),
             ((0, 1.05, 1.76), 0.09, 0.105), ((0, 1.11, 1.63), 0.085, 0.1), ((0, 1.17, 1.52), 0.068, 0.078),
             ((0, 1.22, 1.43), 0.062, 0.07), ((0, 1.245, 1.39), 0.04, 0.045)]
    parts = [body2.loft(name + "_spine", spine, coat, segs=20)]
    legs = {"FR": (0.16, 0.5, 1), "FL": (-0.16, 0.5, 1), "BR": (0.17, -0.52, 0), "BL": (-0.17, -0.52, 0)}
    for leg, (x, y, front) in legs.items():
        if front:
            rings = [((x, y - 0.02, 1.16), 0.09, 0.12), ((x, y + 0.02, 0.86), 0.06, 0.075),
                     ((x, y, 0.58), 0.044, 0.05), ((x, y, 0.36), 0.03, 0.036), ((x, y + 0.01, 0.17), 0.04, 0.042),
                     ((x, y + 0.025, 0.08), 0.034, 0.036)]
        else:
            rings = [((x, y + 0.02, 1.18), 0.11, 0.17), ((x, y + 0.1, 0.9), 0.085, 0.11),
                     ((x, y - 0.02, 0.7), 0.06, 0.07), ((x, y - 0.09, 0.53), 0.042, 0.05),
                     ((x, y - 0.05, 0.31), 0.03, 0.036), ((x, y - 0.02, 0.16), 0.04, 0.042),
                     ((x, y, 0.08), 0.034, 0.036)]
        parts.append(body2.loft(f"{name}_leg{leg}", rings, coat, segs=12, side_axis=(1, 0, 0)))
    bodyob = body2.join(name + "_body", parts)
    J = rig.j
    bones = [(J["body"], (0, -0.62, 1.2), (0, 0.55, 1.2)), (J["neck"], (0, 0.62, 1.36), (0, 0.99, 1.83)),
             (J["head"], (0, 0.99, 1.83), (0, 1.23, 1.41)), (J["tail"], (0, -0.72, 1.36), (0, -1.0, 0.88))]
    for leg, (x, y, front) in legs.items():
        bones += [(J[f"leg{leg}"], (x, y, 1.08), (x, y, 0.58)), (J[f"low{leg}"], (x, y, 0.58), (x, y, -0.02))]

    def body_pull(p, w):
        # everything above the leg tops belongs to the body (no leg bones pulling the barrel)
        top = p[:, 2] > 1.02
        for k in range(4, len(bones)):
            w[top, k] *= 0.01
        return w
    sk = body2.Skinner(bodyob, bones, overrides=[body_pull], base=rig.base)
    rig.skinners = [sk]
    # hooves, mane, tail, ears, eyes: rigid to their joints
    for leg in legs:
        cyl(f"{name}_hoof{leg}", 0.058, 0.09, hoof, J[f"low{leg}"], at=(0, 0.01, -0.6), r2=0.05)
    lathe(f"{name}_mane", [(0.02, -0.02), (0.08, 0.2), (0.075, 0.5), (0.04, 0.68)], mane, J["neck"],
          at=(0, -0.11, 0), scale=(0.45, 1, 1), segs=12)
    lathe(f"{name}_forelock", [(0.0, 0.0), (0.04, 0.05), (0.0, 0.14)], mane, J["head"], at=(0, 0.05, -0.02),
          scale=(0.8, 0.5, 1), segs=8)
    tail = J["tail"]
    lathe(f"{name}_tailhair", [(0.05, 0.0), (0.12, 0.2), (0.11, 0.5), (0.06, 0.78), (0.0, 0.84)], mane, tail,
          segs=12, scale=(0.75, 0.55, 1))
    for s in (-1, 1):
        cyl(f"{name}_ear{s}", 0.03, 0.13, coat, J["head"], at=(0.055 * s, -0.08, -0.04), r2=0.006,
            rot=(180, 0, 0))
        sphere(f"{name}_eye{s}", 0.022, lib.mat("eye", (0.05, 0.04, 0.04), 0.4), J["head"],
               at=(0.085 * s, 0.03, 0.1), outline=False)
        if detail == "C":
            sphere(f"{name}_nostril{s}", 0.014, lib.mat("eye", (0.05, 0.04, 0.04), 0.4), J["head"],
                   at=(0.035 * s, 0.07, 0.42), outline=False)
    if detail == "C":   # bridle
        strap = mat("bridle", (0.16, 0.1, 0.06), 0.55)
        lib.ring(f"{name}_noseband", 0.075, 0.09, strap, J["head"], loc=(0, 0.0, 0.3)).rotation_euler = (
            math.pi / 2, 0, 0)
        lib.ring(f"{name}_browband", 0.1, 0.115, strap, J["head"], loc=(0, -0.02, 0.02)).rotation_euler = (
            math.pi / 2, 0, 0)
    rig.pose()
    return rig
