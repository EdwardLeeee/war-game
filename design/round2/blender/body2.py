"""Smooth bodies for R2 (option B and C): one continuous mesh grown along a
skeleton with Blender's Skin modifier, then deformed every frame by our own
linear-blend skinning from the same joint empties the R1 poses already drive.

No Blender armature or automatic weights are involved, so it runs headless
and every R1 pose/animation function keeps working unchanged.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

import lib


def skin_mesh(name, verts, edges, radii, material, root=0, subsurf=2, smooth=True):
    """verts: list of (x, y, z); radii: list of (rx, ry). Returns an applied mesh object."""
    me = bpy.data.meshes.new(name + "_skel")
    me.from_pydata([tuple(v) for v in verts], [tuple(e) for e in edges], [])
    ob = bpy.data.objects.new(name + "_skel", me)
    bpy.context.scene.collection.objects.link(ob)
    mod = ob.modifiers.new("skin", "SKIN")
    mod.use_smooth_shade = smooth
    mod.branch_smoothing = 0.6
    sv = me.skin_vertices[0].data
    for i, r in enumerate(radii):
        sv[i].radius = (r[0], r[1])
        sv[i].use_root = (i == root)
    if subsurf:
        ss = ob.modifiers.new("sub", "SUBSURF")
        ss.levels = subsurf
        ss.render_levels = subsurf
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    mesh = bpy.data.meshes.new_from_object(ev)
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    out = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(out)
    mesh.materials.clear()
    mesh.materials.append(material)
    for p in mesh.polygons:
        p.use_smooth = smooth
    lib.ALL_PARTS.append(out)
    return out


def loft(name, rings, material, segs=18, subsurf=1, cap=True, side_axis=(1, 0, 0)):
    """Tube through elliptical cross-sections. rings: [(center_xyz, rx, ry), ...].
    rx lies along side_axis (made perpendicular to the path), ry along the remaining axis."""
    from mathutils import Vector
    pts = [Vector(c) for c, _, _ in rings]
    bm = bmesh.new()
    loops = []
    for i, (c, rx, ry) in enumerate(rings):
        a = pts[max(0, i - 1)]
        b = pts[min(len(pts) - 1, i + 1)]
        t = (b - a).normalized()
        side = Vector(side_axis)
        side = (side - side.dot(t) * t)
        if side.length < 1e-4:
            side = Vector((0, 1, 0)) - Vector((0, 1, 0)).dot(t) * t
        side.normalize()
        up = t.cross(side).normalized()
        ring = []
        for k in range(segs):
            ang = 2 * math.pi * k / segs
            ring.append(bm.verts.new(pts[i] + side * (rx * math.cos(ang)) + up * (ry * math.sin(ang))))
        loops.append(ring)
    for i in range(len(loops) - 1):
        for k in range(segs):
            bm.faces.new((loops[i][k], loops[i][(k + 1) % segs], loops[i + 1][(k + 1) % segs], loops[i + 1][k]))
    if cap:
        bm.faces.new(list(reversed(loops[0])))
        bm.faces.new(loops[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name + "_raw")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name + "_raw", me)
    bpy.context.scene.collection.objects.link(ob)
    if subsurf:
        ss = ob.modifiers.new("sub", "SUBSURF")
        ss.levels = subsurf
        ss.render_levels = subsurf
    dg = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    out = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(out)
    mesh.materials.clear()
    mesh.materials.append(material)
    for p in mesh.polygons:
        p.use_smooth = True
    lib.ALL_PARTS.append(out)
    return out


def join(name, objs, material=None):
    """Merge several applied meshes into one object (so one Skinner deforms them)."""
    import bmesh as _bm
    bm = _bm.new()
    mats = []
    for ob in objs:
        me = ob.data
        tmp = _bm.new()
        tmp.from_mesh(me)
        off = len(mats)
        for m in me.materials:
            mats.append(m)
        for f in tmp.faces:
            f.material_index += off
        me2 = bpy.data.meshes.new("tmp")
        tmp.to_mesh(me2)
        tmp.free()
        bm.from_mesh(me2)
        bpy.data.meshes.remove(me2)
        lib.ALL_PARTS.remove(ob)
        bpy.data.objects.remove(ob)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    out = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(out)
    for m in mats:
        me.materials.append(material or m)
    for p in me.polygons:
        p.use_smooth = True
    lib.ALL_PARTS.append(out)
    return out


def _seg_dist(p, a, b):
    ab = b - a
    t = np.clip(((p - a) @ ab) / max(1e-9, ab @ ab), 0, 1)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1)


class Skinner:
    """Linear-blend skinning of a static mesh by joint empties.

    bones: list of (joint_empty, seg_start_xyz, seg_end_xyz) in rest world space.
    The rest pose is the pose the mesh was built in (all joints at zero rotation).
    """

    def __init__(self, obj, bones, falloff=4.0, top=2, overrides=None, base=None):
        """base: the rig root's world matrix when the mesh was designed at the origin;
        the mesh and bone segments are moved by it before binding."""
        self.obj = obj
        if base is not None:
            obj.data.transform(base)
            bones = [(j, tuple(base @ Vector(a)), tuple(base @ Vector(b))) for j, a, b in bones]
        me = obj.data
        n = len(me.vertices)
        co = np.empty(n * 3, np.float32)
        me.vertices.foreach_get("co", co)
        self.rest = co.reshape(n, 3).astype(np.float64)
        self.joints = [b[0] for b in bones]
        d = np.stack([_seg_dist(self.rest, np.array(b[1], float), np.array(b[2], float)) for b in bones], 1)
        w = 1.0 / (d + 0.015) ** falloff
        if overrides:
            for fn in overrides:
                w = fn(self.rest, w)
        # keep the strongest `top` bones per vertex
        idx = np.argsort(-w, axis=1)[:, :top]
        ww = np.take_along_axis(w, idx, 1)
        ww /= ww.sum(1, keepdims=True)
        self.idx, self.w = idx, ww
        bpy.context.view_layer.update()
        self.rest_inv = [np.array(j.matrix_world.inverted()) for j in self.joints]

    def update(self):
        bpy.context.view_layer.update()
        mats = np.stack([np.array(j.matrix_world) @ ri for j, ri in zip(self.joints, self.rest_inv)])  # J,4,4
        n = len(self.rest)
        hom = np.hstack([self.rest, np.ones((n, 1))])
        out = np.zeros((n, 3))
        for k in range(self.idx.shape[1]):
            m = mats[self.idx[:, k]]                   # N,4,4
            v = np.einsum("nij,nj->ni", m[:, :3, :], hom)
            out += v * self.w[:, k:k + 1]
        self.obj.data.vertices.foreach_set("co", out.astype(np.float32).ravel())
        self.obj.data.update()


def zero_pose(rig):
    """Put every joint at zero rotation (the pose meshes are built in)."""
    for ob in rig.j.values():
        ob.rotation_euler = (0, 0, 0)
    rig.root.rotation_euler = (0, 0, 0)
    bpy.context.view_layer.update()


def world(ob):
    return tuple(ob.matrix_world.translation)
