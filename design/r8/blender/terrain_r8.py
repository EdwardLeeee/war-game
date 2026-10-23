"""R8 batch 2 (D-093): the cliff in the realistic look, as the client draws cliffs (client/src/art/terrain.ts): a post
on a cell where a line turns or ends, an arm from a cell's middle to its neighbour's to the E, S, SE or SW.
The user 2026-10-22 (the first draft): 「懸崖看起來不太真實」; the ceo: continuous rock faces with real strata and
fractures, not stacked slabs; vertical streaks and weathering; a talus cone at the foot blending into the ground; sparse
vegetation in the cracks, no round bushes; true to scale beside a 1.7 m soldier (research/nature-reference 11-13).
So the faces are real rock: two photo-scanned rock faces (Poly Haven CC0, common/scans.py) read from the front into a
field of depth and colour (scan_field); an arm's two flanks carry that field's relief and colour over a swept core.
Every arm holds the same strip of the field (JOIN) within JOIN_IN of each cell middle, and the same height and width
there, so the arms of a straight run meet with no seam whatever their variants; a post covers the turns and the ends.
"""
import math
import os
import random
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.interpolate import poly_3d_calc

import lib
from lib import box, cyl

CELL = 2.0
HERE = os.path.dirname(os.path.abspath(__file__))
SCANS = os.path.join(HERE, "..", "build", "scans")
sys.path.insert(0, os.path.join(HERE, "..", "..", "b1", "common"))       # terrain_tiles: the water tiles' field         # common/scans.py fetch puts them here
RES = 0.01                                                 # the fields' spacing, metres


def scan_field(sid):
    """A scanned rock face (common/scans.py) as a field seen from the front: the scan stood upright (its mean plane
    turned to face -y), rays cast along +y on a RES grid; per sample the depth (y of the hit) and the colour there
    (its colour map at the hit's UV, sRGB 0..1). Cached in build/scans/fields/<sid>.npz.
    -> dict(depth [nz, nx], rgb [nz, nx, 3], hit [nz, nx] bool, x0, z0 (the grid's corner, metres))"""
    cache = os.path.join(SCANS, "fields", f"{sid}.npz")
    if os.path.exists(cache):
        d = np.load(cache)
        return {k: d[k] for k in d.files}
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SCANS, sid, f"{sid}_1k.gltf"))
    obs = [o for o in bpy.data.objects if o not in before]
    ob = next(o for o in obs if o.type == "MESH")
    me = ob.data
    M = ob.matrix_world.copy()
    co = np.array([M @ v.co for v in me.vertices])
    c = co.mean(0)
    n = np.zeros(3)
    for p in me.polygons:
        n += np.array(M.to_3x3() @ p.normal) * p.area
    n /= np.linalg.norm(n)
    # turn the mean normal to -y about the z axis, then about the x axis (the face upright, still facing the camera)
    rz = Matrix.Rotation(math.atan2(n[0], -n[1]), 4, "Z")
    n2 = rz.to_3x3() @ Vector(n)
    rx = Matrix.Rotation(math.atan2(n2.z, -n2.y), 4, "X")
    R = rx @ rz @ Matrix.Translation(Vector(-c)) @ M
    verts = [R @ v.co for v in me.vertices]
    polys = [tuple(p.vertices) for p in me.polygons]
    bvh = BVHTree.FromPolygons(verts, polys)
    uv = me.uv_layers.active.data
    loops = [list(p.loop_indices) for p in me.polygons]
    img = next(t.image for m in me.materials for t in m.node_tree.nodes
               if t.bl_idname == "ShaderNodeTexImage" and t.image and "diff" in t.image.name)
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[..., :3]
    V = np.array(verts)
    x0, x1 = V[:, 0].min(), V[:, 0].max()
    z0, z1 = V[:, 2].min(), V[:, 2].max()
    nx, nz = int((x1 - x0) / RES), int((z1 - z0) / RES)
    depth = np.zeros((nz, nx), np.float32)
    rgb = np.zeros((nz, nx, 3), np.float32)
    hit = np.zeros((nz, nx), bool)
    ystart = V[:, 1].min() - 1.0
    d = Vector((0, 1, 0))
    for j in range(nz):
        z = z0 + (j + 0.5) * RES
        for i in range(nx):
            loc, _, fi, _ = bvh.ray_cast(Vector((x0 + (i + 0.5) * RES, ystart, z)), d)
            if loc is None:
                continue
            pv = polys[fi]
            wts = poly_3d_calc([verts[k] for k in pv], loc)
            u = sum(wt * uv[li].uv[0] for wt, li in zip(wts, loops[fi]))
            v = sum(wt * uv[li].uv[1] for wt, li in zip(wts, loops[fi]))
            depth[j, i] = loc.y
            rgb[j, i] = px[int((v % 1.0) * (h - 1)), int((u % 1.0) * (w - 1))]
            hit[j, i] = True
    for o in obs:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.orphans_purge(do_recursive=True)
    out = dict(depth=depth, rgb=rgb, hit=hit, x0=np.float32(x0), z0=np.float32(z0))
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    np.savez_compressed(cache, **out)
    return out


def _vnoise(n, cells, seed):
    """1D smooth value noise over n samples, `cells` lattice steps, 0..1."""
    rnd = random.Random(seed)
    lat = np.array([rnd.random() for _ in range(cells + 2)])
    f = np.linspace(0, cells, n, endpoint=False)
    i = f.astype(int)
    t = f - i
    t = t * t * (3 - 2 * t)
    return lat[i] * (1 - t) + lat[i + 1] * t


def _blur(a, r):
    """Box blur of radius r pixels (or (rows, cols)), three times (about a Gaussian), edges clamped."""
    rr = r if isinstance(r, tuple) else (r, r)
    for _ in range(3):
        for ax in (0, 1):
            r = rr[ax]
            pad = [(0, 0), (0, 0)]
            pad[ax] = (r + 1, r)
            c = np.cumsum(np.pad(a, pad, mode="edge"), axis=ax)
            a = (np.take(c, range(2 * r + 1, c.shape[ax]), axis=ax) - np.take(c, range(0, c.shape[ax] - 2 * r - 1), axis=ax)) / (2 * r + 1)
    return a


def _fill(a, hit):
    """The samples the rays missed, filled from their neighbours."""
    a = a.copy()
    known = hit.copy()
    while not known.all():
        s = np.zeros_like(a)
        k = np.zeros(known.shape)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            kn = np.roll(known, (dy, dx), (0, 1))
            s += np.roll(np.where(known[..., None] if a.ndim == 3 else known, a, 0), (dy, dx), (0, 1))
            k += kn
        new = (~known) & (k > 0)
        a[new] = (s / np.maximum(k, 1)[..., None] if a.ndim == 3 else s / np.maximum(k, 1))[new]
        known = known | new
    return a


TINT = np.array([0.33, 0.235, 0.165])        # linear: the warm grey-brown of a weathered sandstone (Taihang, ref 11)
_FIELDS = {}


def field(sid):
    """scan_field made ready to skin with: holes filled; `out` the relief (metres the face stands out of its mean
    surface, the large-scale lean taken away, at most RELIEF); `rgb` the colour (sRGB) pulled half-way to TINT, with
    vertical streaks where water runs down, a damp darker foot."""
    if sid in _FIELDS:
        return _FIELDS[sid]
    f = scan_field(sid)
    hit = f["hit"]
    depth = _fill(f["depth"], hit)
    out = np.clip(-(depth - _blur(depth, 45)), -RELIEF, RELIEF)
    rgb = _fill(f["rgb"], hit)
    lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    lum = (lin * np.array([0.2126, 0.7152, 0.0722])).sum(-1, keepdims=True)
    lin = lin * 0.45 + TINT * (lum / max(float(lum.mean()), 1e-4)) * 0.55
    nz, nx = depth.shape
    # water streaks: narrow dark runs down the face, in patches (long up and down, short across)
    streak = np.clip((_vnoise(nx, nx // 10, 7) * 0.6 + _vnoise(nx, nx // 40, 8) * 0.4 - 0.42) * 3.0, 0, 1)
    run = _blur(np.random.default_rng(9).random((nz, nx)), (60, 3))
    run = (run - run.mean()) / (run.std() + 1e-6)
    lin = lin * (1 - 0.5 * (streak[None, :] * _smooth(-0.5, 0.6, run)))[..., None]
    z = (np.arange(nz) * RES)[:, None, None]
    lin = lin * (0.78 + 0.22 * np.clip(z / 1.2, 0, 1))
    rgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.clip(lin, 0, None) ** (1 / 2.4) - 0.055)
    _FIELDS[sid] = dict(out=out.astype(np.float32), rgb=np.clip(rgb, 0, 1).astype(np.float32), x0=float(f["x0"]),
                        z0=float(f["z0"]), mean=lin.reshape(-1, 3).mean(0))
    return _FIELDS[sid]


RELIEF = 0.32               # metres
TOP_FIELD = 0.9             # how much of the scan above the face's top row the top surface carries
FX_LO, FX_HI = 0.45, 4.45   # the stretch of the scan (metres across) with no holes the rays missed
H_END, W_END = 3.8, 1.0     # an arm's height and half-width (at its foot) within JOIN_IN of a cell middle
W_TOP = 0.62                # its half-width at the top
JOIN_IN, JOIN_OUT = 0.15, 0.35  # the shared strip holds within JOIN_IN of a cell middle, fades out by JOIN_OUT
ARM_PAST = 0.15             # an arm reaches this far past each cell middle (as terrain.py's)
SID = "rock_face_01"
JOIN_X = 2.4                # the shared strip's middle in the field: a quiet stretch, no crack running up it
VARIANT_X = (0.6, 2.25, 1.4)    # where each variant's strip starts in the field
VARIANT_MIRROR = (False, False, True)
VARIANT_BEND = ((0.2, 1.1), (0.15, 1.4), (0.22, 0.9))   # each variant's strata bend gently: (metres, per metre)
Z_OFF = 0.25                # the field row at the cliff's foot (metres up the scan)
TALUS = (0.95, 0.45)        # the scree slope: how far out from the foot, how high against it (metres)


def _smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _sample(F, fx, fz):
    """Field values at field metres (fx, fz) (arrays), bilinear, clamped: (out, rgb)."""
    o, c = F["out"], F["rgb"]
    nz, nx = o.shape
    x = np.clip(fx / RES - 0.5, 0, nx - 1.001)
    y = np.clip(fz / RES - 0.5, 0, nz - 1.001)
    i, j = x.astype(int), y.astype(int)
    tx, ty = x - i, y - j

    def bl(a):
        if a.ndim == 3:
            txx, tyy = tx[..., None], ty[..., None]
        else:
            txx, tyy = tx, ty
        return ((a[j, i] * (1 - txx) + a[j, i + 1] * txx) * (1 - tyy) + (a[j + 1, i] * (1 - txx) + a[j + 1, i + 1] * txx) * tyy)
    return bl(o), bl(c)


def _strip(s, z, L, variant, height_var=True):
    """An arm's skin at arm coordinates s (along it, 0 at its middle; the cell middles at -L/2, L/2) and z (up):
    (out, rgb, top height at s). The variant's own strip, blended to JOIN near the two cell middles."""
    F = field(SID)
    wa = _smooth(JOIN_OUT, JOIN_IN, np.abs(s + L / 2))
    wb = _smooth(JOIN_OUT, JOIN_IN, np.abs(s - L / 2))
    wv = np.clip(1 - wa - wb, 0, 1)
    amp, k = VARIANT_BEND[variant]
    fz = z + Z_OFF
    fzv = fz + wv * amp * np.sin(s * k + variant)            # the variant's own strata bent, straight at the joins
    sv = (s + L / 2 + ARM_PAST)
    if VARIANT_MIRROR[variant]:
        sv = (L + 2 * ARM_PAST) - sv
    ov, cv = _sample(F, VARIANT_X[variant] + sv, fzv)
    oa, ca = _sample(F, JOIN_X + (s + L / 2), fz)
    ob, cb = _sample(F, JOIN_X + (s - L / 2), fz)
    out = ov * wv + oa * wa + ob * wb
    rgb = cv * wv[..., None] + ca * wa[..., None] + cb * wb[..., None]
    rnd = random.Random(31 + variant)
    ph = [rnd.uniform(0, 6.3) for _ in range(2)]
    s1 = s[0] if s.ndim == 2 else s
    w1 = wv[0] if wv.ndim == 2 else wv
    jag, _ = _sample(F, VARIANT_X[variant] + (s1 + L / 2 + ARM_PAST), np.full_like(s1, H_END + Z_OFF))
    bump = 0.2 * np.sin(s1 * 2.1 + ph[0]) + 0.1 * np.sin(s1 * 4.7 + ph[1]) + 0.7 * jag   # broken, not waves
    top = H_END + (bump * w1 if height_var else 0.0)
    return out, rgb, top


SOIL = np.array([0.075, 0.07, 0.04])     # linear: the thin soil and grass on a cliff's top


def _topsoil(rgb, seed):
    """The scan's top made a cliff top: darker, half-way to SOIL in patches (sun on a flat top otherwise glares)."""
    lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    h, w = rgb.shape[:2]
    patch = _blur(np.random.default_rng(seed).random((h, w)), (12, 12))
    patch = _smooth(-0.3, 0.6, (patch - patch.mean()) / (patch.std() + 1e-6))[..., None]
    lum = (lin * np.array([0.2126, 0.7152, 0.0722])).sum(-1, keepdims=True)
    lin = lin * 0.62 * (1 - 0.55 * patch) + SOIL * (lum / max(float(lum.mean()), 1e-4)) * 0.55 * patch
    return np.clip(np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.clip(lin, 0, None) ** (1 / 2.4) - 0.055), 0, 1)


def _image(name, rgb):
    """A bpy image from an sRGB array [rows from the bottom, cols, 3]."""
    h, w = rgb.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.colorspace_settings.name = "sRGB"
    a = np.ones((h, w, 4), np.float32)
    a[..., :3] = rgb
    img.pixels.foreach_set(a.ravel())
    return img


def _skin_mat(name, img):
    """The flanks' material: the strip's colour by UV, its brightness as a fine bump, rough stone."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = img
    t.interpolation = "Cubic"
    nt.links.new(t.outputs["Color"], p.inputs["Base Color"])
    bw = nt.nodes.new("ShaderNodeRGBToBW")
    nt.links.new(t.outputs["Color"], bw.inputs["Color"])
    b = nt.nodes.new("ShaderNodeBump")
    b.inputs["Strength"].default_value = 0.45
    b.inputs["Distance"].default_value = 0.02
    nt.links.new(bw.outputs["Val"], b.inputs["Height"])
    nt.links.new(b.outputs["Normal"], p.inputs["Normal"])
    p.inputs["Roughness"].default_value = 0.92
    return m


def _grid_obj(name, pos, uv, mat, root, outward=None):
    """A mesh from a grid of points pos [nv, nu, 3] with UVs uv [nv, nu, 2]; its faces turned to face `outward`
    on the whole (none: as built, normal = along rows x up columns)."""
    nv, nu = pos.shape[:2]
    bm = bmesh.new()
    vs = [[bm.verts.new(tuple(map(float, pos[j, i]))) for i in range(nu)] for j in range(nv)]
    lay = bm.loops.layers.uv.new()
    for j in range(nv - 1):
        for i in range(nu - 1):
            f = bm.faces.new((vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i]))
            for lp, (jj, ii) in zip(f.loops, ((j, i), (j, i + 1), (j + 1, i + 1), (j + 1, i))):
                lp[lay].uv = tuple(map(float, uv[jj, ii]))
    if outward is not None:
        bm.normal_update()
        n = sum((f.normal * f.calc_area() for f in bm.faces), Vector())
        if n.dot(Vector(outward)) < 0:
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
    ob = lib._mesh_obj(name, bm, mat, root, (0, 0, 0), smooth=True, outline=False)
    ob["no_bevel"] = True
    return ob


def mats():
    m = lib.mat
    F = field(SID)
    lin = tuple(float(v) for v in F["mean"])
    return dict(
        top=m("cliffrock", tuple(v * 0.8 for v in lin), 0.9),          # broken rock: rock_face_03 in the faces' colour
        dark=m("cliffrockdark", tuple(v * 0.55 for v in lin), 0.92),   # the darker stones of the scree
        tuft=m("tuft_r8", (0.11, 0.15, 0.04), 0.85),
        tuftdry=m("tuftdry_r8", (0.24, 0.2, 0.09), 0.85),
    )


def _scree_mat():
    """The talus slope: the ground's gravel (rocks_ground_02, recoloured as ground_run.py's gravel layer), fading out
    at its edge (a vertex attribute) so it lies into the client's ground with no line."""
    if "scree_r8" in bpy.data.materials:
        return bpy.data.materials["scree_r8"]
    tex = os.path.join(HERE, "..", "..", "r7", "build", "tex")
    m = bpy.data.materials.new("scree_r8")
    m.use_nodes = True
    nt = m.node_tree
    out = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeOutputMaterial")
    p = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (0.5, 0.5, 0.5)            # a 2 m tile
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    di = nt.nodes.new("ShaderNodeTexImage")
    di.image = bpy.data.images.load(os.path.join(tex, "rocks_ground_02_diff_1k.jpg"), check_existing=True)
    nt.links.new(mp.outputs["Vector"], di.inputs["Vector"])
    px = np.empty(di.image.size[0] * di.image.size[1] * 4, np.float32)
    di.image.pixels.foreach_get(px)
    px = px.reshape(-1, 4)[::7, :3]
    lin = np.where(px <= 0.04045, px / 12.92, ((px + 0.055) / 1.055) ** 2.4)
    mean_lum = float((lin * np.array([0.2126, 0.7152, 0.0722])).sum(-1).mean())
    bw = nt.nodes.new("ShaderNodeRGBToBW")
    nt.links.new(di.outputs["Color"], bw.inputs["Color"])
    k = nt.nodes.new("ShaderNodeMath")
    k.operation = "MULTIPLY_ADD"
    k.inputs[1].default_value = 0.95 / mean_lum                     # the photo's light and dark round the gravel tint
    k.inputs[2].default_value = 0.05
    nt.links.new(bw.outputs["Val"], k.inputs[0])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    mix.inputs["A"].default_value = (0.11, 0.1, 0.085, 1.0)
    nt.links.new(k.outputs[0], mix.inputs["B"])
    hue = nt.nodes.new("ShaderNodeMix")                              # a tenth of the photo's own hue (ground_run)
    hue.name = "hue"
    hue.data_type = "RGBA"
    hue.inputs["Factor"].default_value = 0.1
    nt.links.new(mix.outputs["Result"], hue.inputs["A"])
    nt.links.new(di.outputs["Color"], hue.inputs["B"])
    nt.links.new(hue.outputs["Result"], p.inputs["Base Color"])
    p.inputs["Roughness"].default_value = 0.95
    no = os.path.join(tex, "rocks_ground_02_nor_gl_1k.jpg")
    if os.path.exists(no):
        ni = nt.nodes.new("ShaderNodeTexImage")
        ni.image = bpy.data.images.load(no, check_existing=True)
        ni.image.colorspace_settings.name = "Non-Color"
        nt.links.new(mp.outputs["Vector"], ni.inputs["Vector"])
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(ni.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], p.inputs["Normal"])
    at = nt.nodes.new("ShaderNodeAttribute")
    at.attribute_name = "fade"
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    ms = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(at.outputs["Fac"], ms.inputs["Fac"])
    nt.links.new(tr.outputs[0], ms.inputs[1])
    nt.links.new(p.outputs[0], ms.inputs[2])
    nt.links.new(ms.outputs[0], out.inputs["Surface"])
    return m


def _fade_attr(ob, fade):
    """fade [nv, nu] onto the grid object's vertices (row-major, as _grid_obj made them)."""
    a = ob.data.attributes.new("fade", "FLOAT", "POINT")
    a.data.foreach_set("value", fade.astype(np.float32).ravel())


def _rock(name, r, mat, root, loc, rnd):
    """A broken stone: a few flat faces at random (an icosphere cut by planes), sharp-edged, lying flat."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r)
    for _ in range(5):                                    # sliced flat on a few sides: fracture faces
        n = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.6, 1))).normalized()
        d = r * rnd.uniform(0.45, 0.8)
        for v in bm.verts:
            k = v.co.dot(n) - d
            if k > 0:
                v.co -= n * k
    bmesh.ops.scale(bm, vec=(rnd.uniform(0.9, 1.4), rnd.uniform(0.8, 1.2), rnd.uniform(0.5, 0.75)), verts=bm.verts)
    ob = lib._mesh_obj(name, bm, mat, root, loc, rot=(rnd.uniform(-15, 15), rnd.uniform(-15, 15), rnd.uniform(0, 360)),
                       smooth=False, outline=False)
    ob["no_bevel"] = True
    return ob


def _tuft(name, P, root, loc, rnd, dry=False):
    """A tuft of grass rooted in a crack: thin blades fanning out and up."""
    bm = bmesh.new()
    for k in range(rnd.randint(14, 24)):
        a = rnd.uniform(0, 2 * math.pi)
        lean = rnd.uniform(0.15, 0.75)
        L = rnd.uniform(0.14, 0.38)
        w = rnd.uniform(0.01, 0.02)
        tip = (L * lean * math.cos(a), L * lean * math.sin(a), L * (1 - lean * 0.5))
        b0 = bm.verts.new((-w * math.sin(a), w * math.cos(a), 0.0))
        b1 = bm.verts.new((w * math.sin(a), -w * math.cos(a), 0.0))
        t = bm.verts.new(tip)
        bm.faces.new((b0, b1, t))
    ob = lib._mesh_obj(name, bm, P["tuftdry" if dry else "tuft"], root, loc, smooth=False, outline=False)
    ob["no_bevel"] = True
    return ob


def _frame(a, b):
    """An arm's frame: its middle, the unit vector along it, the unit vector to its left (from a to b)."""
    mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
    return (mx, my), (ux, uy), (-uy, ux), L


DU = 0.025                  # the faces' mesh spacing along and up (metres)


def _neighbours(root, mx, my, ux, uy, L, length=4.0):
    """Stand-ins for the rock beyond an arm's two ends (the run going on): they cast its shadow on this arm's face and
    scree, so every arm is lit as if in a long run (alone, each lit its own end: a light strip every cell). Never
    seen; only in the colour image (render_b1.py "caster_only"), the shadow image is the arm's own."""
    for e in (-1, 1):
        c = e * (L / 2 + ARM_PAST + length / 2 + 0.02)
        ob = lib.box(f"cl_next{e}", (length, 2 * W_END * 0.9, H_END * 0.95), lib.mat("cl_caster", (0.3, 0.3, 0.3), 0.9),
                     root, loc=(mx + ux * c, my + uy * c, H_END * 0.95 / 2))
        ob.rotation_euler = (0.0, 0.0, math.atan2(uy, ux))
        ob["caster_only"] = True
        ob["no_bevel"] = True


def cliff_arm(root, direction="E", variant=0):
    """An arm (terrain.ts): a rock ridge from this cell's middle to the neighbour's, its middle on the anchor. Two
    flanks of scanned rock over a core narrowing to W_TOP, a rough top, the talus on each flank the camera sees,
    grass tufts on a few ledges."""
    P = mats()
    (mx, my), (ux, uy), (lx, ly), L = _frame(*ARMS[direction])
    rnd = random.Random(900 + variant + 17 * list(ARMS).index(direction))
    _neighbours(root, mx, my, ux, uy, L)
    s = np.arange(-L / 2 - ARM_PAST, L / 2 + ARM_PAST + 1e-6, DU)
    nz = int(H_END * 1.2 / DU)
    _, _, top = _strip(s, np.zeros_like(s), L, variant)
    # the skin's colour, finer than the mesh: (s, t) with t the fraction of the height at s
    s0, s1 = s[0], s[-1]
    sf = np.arange(s0, s1, RES)
    tf = np.linspace(0, 1, int(H_END * 1.15 / RES))[:, None]
    _, _, topf = _strip(sf, np.zeros_like(sf), L, variant)
    _, rgbf, _ = _strip(np.broadcast_to(sf[None, :], (len(tf), len(sf))), tf * topf[None, :], L, variant)
    skin = _skin_mat(f"cliffskin_{direction}{variant}", _image(f"cliffskin_{direction}{variant}", rgbf))
    for side in (1, -1):                       # +1: the flank on the arm's left
        nxs, nys = lx * side, ly * side
        if direction == "E" and side == 1:     # the far flank of an E-W arm, edge-on at its ends: never seen
            continue
        t = np.linspace(0, 1, nz)[:, None]
        Z = t * top[None, :]
        S = np.broadcast_to(s[None, :], Z.shape)
        out, _, _ = _strip(S, Z, L, variant)
        w = W_END + (W_TOP - W_END) * (Z / H_END)
        o = w + out * _smooth(0.0, 0.25, Z)    # the relief dies into the ground at the very foot
        pos = np.stack([mx + ux * S + nxs * o, my + uy * S + nys * o, Z], -1)
        uv = np.stack([(S - s0) / (s1 - s0), np.broadcast_to(t, Z.shape)], -1)
        _grid_obj(f"cl_flank{side}", pos, uv, skin, root, outward=(nxs, nys, 0.0))
        if nys < 0.3:                          # the talus on a flank facing the camera (or edge-on)
            _talus(root, P, rnd, s, L, top, mx, my, ux, uy, nxs, nys, w_foot=W_END, variant=variant, side=side)
        if nys < 0.3:
            _ledge_tufts(root, P, rnd, s, L, out, Z, top, mx, my, ux, uy, nxs, nys, w)
    # the top: from the front's top edge to the back's, the scan carried on over it (the rock's own weathered top, its
    # moss and grass, the scan above the face), its relief as bumps
    nt = 24
    tt = np.linspace(-1, 1, nt)[:, None]                  # -1: the front edge (the right flank, -l)
    S = np.broadcast_to(s[None, :], (nt, len(s)))
    outL, _, _ = _strip(s, top, L, variant)
    o_edge = W_END + (W_TOP - W_END) * (top / H_END) + outL
    over = (tt + 1) / 2 * TOP_FIELD
    outT, _, _ = _strip(S, top[None, :] + 0.03 + over, L, variant)
    Ztop = top[None, :] + 0.1 * (1 - tt ** 2) + 0.5 * outT * _smooth(1.0, 0.8, np.abs(tt))
    off = tt * o_edge[None, :]
    pos = np.stack([mx + ux * S + lx * off, my + uy * S + ly * off, Ztop], -1)
    tf2 = np.linspace(0, 1, int(TOP_FIELD / RES))[:, None]
    _, rgbT, _ = _strip(np.broadcast_to(sf[None, :], (len(tf2), len(sf))), topf[None, :] + 0.03 + tf2 * TOP_FIELD, L, variant)
    topmat = _skin_mat(f"clifftop_{direction}{variant}", _image(f"clifftop_{direction}{variant}", _topsoil(rgbT, 70 + variant)))
    uv = np.stack([(S - s0) / (s1 - s0), np.broadcast_to((tt + 1) / 2, S.shape)], -1)
    _grid_obj("cl_top", pos, uv, topmat, root, outward=(0, 0, 1))
    for k in range(int(L * 3)):                # a few tufts on the top, away from the joins
        sk = rnd.uniform(-L / 2 + 0.35, L / 2 - 0.35)
        i = int((sk - s[0]) / DU)
        tk = rnd.uniform(-0.6, 0.6)
        _tuft(f"cl_toptuft{k}", P, root, (mx + ux * sk + lx * tk * o_edge[i], my + uy * sk + ly * tk * o_edge[i], top[i] + 0.1),
              rnd, dry=rnd.random() < 0.5)


def _talus(root, P, rnd, s, L, top, mx, my, ux, uy, nx, ny, w_foot, variant, side):
    """The scree slope against a flank's foot: TALUS out and up, its reach varying away from the joins, its outer part
    fading into the ground; broken stones on it, bigger near the face."""
    wv = np.clip(1 - _smooth(JOIN_OUT, JOIN_IN, np.abs(s + L / 2)) - _smooth(JOIN_OUT, JOIN_IN, np.abs(s - L / 2)), 0, 1)
    ph = random.Random(51 + variant).uniform(0, 6.3)
    reach = TALUS[0] * (1 + 0.3 * wv * np.sin(s * 2.3 + ph))
    hgt = TALUS[1] * (1 + 0.35 * wv * np.sin(s * 3.1 + ph * 2))
    nr = 14
    r = np.linspace(0, 1, nr)[:, None]
    S = np.broadcast_to(s[None, :], (nr, len(s)))
    d = w_foot - 0.12 + r * reach[None, :]                  # from just inside the rock face outward
    z = hgt[None, :] * (1 - r) ** 1.7 + 0.01
    pos = np.stack([mx + ux * S + nx * d, my + uy * S + ny * d, z], -1)
    uv = np.zeros(pos.shape[:2] + (2,))
    ob = _grid_obj(f"cl_talus{side}", pos, uv, _scree_mat(), root, outward=(0, 0, 1))
    ob.visible_shadow = False
    edge = 0.75 + 0.2 * wv[None, :] * np.sin(S * 5.0 + ph)   # where the fade starts, wavering away from the joins
    _fade_attr(ob, 1 - _smooth(edge * 0.8, 1.0, np.broadcast_to(r, S.shape)))
    for k in range(int(L * 24)):                             # the stones, away from the joins
        sk = rnd.uniform(-L / 2 + JOIN_OUT, L / 2 - JOIN_OUT)
        rk = rnd.random() ** 1.3
        rad = (0.035 + 0.13 * (1 - rk) ** 2) * rnd.uniform(0.6, 1.2)
        i = int((sk - s[0]) / DU)
        dk = w_foot - 0.05 + rk * reach[i] * 0.85
        zk = hgt[i] * (1 - rk) ** 1.7 + rad * 0.25
        _rock(f"cl_stone{side}_{k}", rad, P["dark"] if rnd.random() < 0.85 else P["top"], root,
              (mx + ux * sk + nx * dk, my + uy * sk + ny * dk, zk), rnd)


def _ledge_tufts(root, P, rnd, s, L, out, Z, top, mx, my, ux, uy, nx, ny, w):
    """Grass where the face steps back: a ledge (the face juts out below and goes in above), a few of them."""
    step = out[:-3] - out[3:]                                # >0: the face goes in going up
    cand = np.argwhere((step > 0.04) & (Z[:-3] > 0.7) & (Z[:-3] < top[None, :] - 0.3))
    cand = [(j, i) for j, i in cand if abs(s[i]) < L / 2 - 0.35]
    rnd.shuffle(cand)
    picked = []
    for j, i in cand:                                        # spread out: no two within 0.5 m
        if all(abs(s[i] - s[i2]) + abs(Z[j, i] - Z[j2, i2]) > 0.5 for j2, i2 in picked):
            picked.append((j, i))
        if len(picked) >= max(3, int(L * 2.2)):
            break
    for k, (j, i) in enumerate(picked):
        o = w[j + 3, i] + out[j + 3, i] + 0.02
        _tuft(f"cl_tuft{k}", P, root, (mx + ux * s[i] + nx * o, my + uy * s[i] + ny * o, Z[j + 2, i]), rnd, dry=rnd.random() < 0.4)


ARMS = {"E": ((-1.0, 0.0), (1.0, 0.0)), "S": ((0.0, 1.0), (0.0, -1.0)), "SE": ((-1.0, 1.0), (1.0, -1.0)),
        "SW": ((1.0, 1.0), (-1.0, -1.0))}       # render axes (+y north), as terrain.py's


def _mass(tag, root, P, rnd, cx=0.0, cy=0.0, radius=(1.12, 1.3), H=4.0, nk=6, sgn=1, fx_mid=2.9, round_top=0.12,
          taper=0.22, cap=0.18, tilt=0.0):
    """A block of rock: its plan a polygon of nk joint faces (rock breaks along flat joints) radius[0]..radius[1]
    from (cx, cy), H high, narrowing by `taper` up its height and rounding over at the top; the scanned face wrapped
    round it (its front 240 degrees on 3.3 m of the scan round fx_mid, mirrored when sgn is -1), the scan's top with
    soil on its top. -> plan(angle) (the radius at the foot, 0: towards the camera) and the top height by angle."""
    th0 = rnd.uniform(0, 2 * math.pi / nk)
    faces = [(th0 + 2 * math.pi * k / nk + rnd.uniform(-0.2, 0.2), rnd.uniform(*radius)) for k in range(nk)]

    def plan(aa):
        r = np.full(np.shape(aa), 9.0)
        for th, d in faces:
            c = np.cos(aa - th)
            r = np.where(c > 0.05, np.minimum(r, d / np.maximum(c, 0.05)), r)
        return r
    na = 180
    a = np.linspace(-math.pi, math.pi, na)
    F = field(SID)
    ph = rnd.uniform(0, 6.3)
    R = plan(a)
    seg = np.hypot(np.diff(R * np.sin(a)), np.diff(-R * np.cos(a)))
    arc = np.concatenate([[0], np.cumsum(seg)])
    arc -= np.interp(0.0, a, arc)
    front = np.interp(2 * math.pi / 3, a, arc) - np.interp(-2 * math.pi / 3, a, arc)
    k = min(1.0, 3.3 / front)                             # never stretched; squeezed only round a big mass

    def fx_of(aa):                                        # folded back at the scan's good edges, no smeared fill
        x = (fx_mid + sgn * np.interp(aa, a, arc) * k - FX_LO) % (2 * (FX_HI - FX_LO))
        return FX_LO + np.where(x > FX_HI - FX_LO, 2 * (FX_HI - FX_LO) - x, x)
    jag, _ = _sample(F, fx_of(a), np.full_like(a, H + Z_OFF))
    top = H + 0.04 * H * np.sin(a * 2 + ph) + 0.6 * jag * min(1.0, H / 3.0) ** 2 + tilt * np.sin(a + ph)
    nz = max(12, int(H * 1.2 / DU))
    t = np.linspace(0, 1, nz)[:, None]
    Z = t * top[None, :]
    A = np.broadcast_to(a[None, :], Z.shape)
    out, _ = _sample(F, fx_of(A), Z + Z_OFF)
    rel = min(1.0, H / 3.0)                               # small stones: less relief
    shrink = 1 - taper * (Z / H) - round_top * _smooth(H * 0.6, H, Z) * (H / max(H, 1e-3))
    rr = R[None, :] * shrink + out * rel * _smooth(0.0, 0.25, Z)
    pos = np.stack([cx + rr * np.sin(A), cy - rr * np.cos(A), Z], -1)
    af = np.linspace(-math.pi, math.pi, max(64, int((arc[-1] - arc[0]) * k / RES)))
    tf = np.linspace(0, 1, max(32, int(H * 1.2 / RES)))[:, None]
    topf = np.interp(af, a, top)
    _, rgbf = _sample(F, fx_of(np.broadcast_to(af[None, :], (len(tf), len(af)))), tf * topf[None, :] + Z_OFF)
    uv = np.stack([(A + math.pi) / (2 * math.pi), np.broadcast_to(t, Z.shape)], -1)
    _grid_obj(f"{tag}_side", pos, uv, _skin_mat(f"skin_{tag}", _image(f"skin_{tag}", rgbf)), root)
    rc = np.linspace(1, 0, 12)[:, None]
    edge = rr[-1][None, :]
    xs, ys = edge * rc * np.sin(a)[None, :], -edge * rc * np.cos(a)[None, :]
    zc = top[None, :] * rc + float(top.mean()) * (1 - rc) + cap * (1 - rc ** 2)
    pos = np.stack([cx + xs, cy + ys, zc], -1)
    span = float(edge.max()) * 1.05
    n = max(16, int(2 * span / RES))
    gx = np.linspace(-span, span, n)
    GX, GY = np.meshgrid(gx, gx)
    _, rgbT = _sample(F, fx_mid + GX * 0.8, H + Z_OFF + 0.05 + (GY + span) / (2 * span) * min(TOP_FIELD, 2 * span))
    topmat = _skin_mat(f"top_{tag}", _image(f"top_{tag}", _topsoil(rgbT, rnd.randint(0, 999))))
    uv = np.stack([(xs + span) / (2 * span), (ys + span) / (2 * span)], -1)
    _grid_obj(f"{tag}_cap", pos, uv, topmat, root, outward=(0, 0, 1))
    return plan, a, top


def _apron(tag, root, P, rnd, plan, reach, height, cx=0.0, cy=0.0, half=0.62 * math.pi, stones=40, ph=0.0):
    """The scree round a rock's front: from just inside its foot out `reach`, `height` against it, fading out at its
    edge and towards the back; broken stones on it."""
    nr = 14
    r = np.linspace(0, 1, nr)[:, None]
    ar = np.linspace(-half, half, 80)
    rch = reach * (1 + 0.25 * np.sin(ar * 3 + ph))
    d = plan(ar)[None, :] - 0.12 + r * rch[None, :]
    z = np.broadcast_to(height * (1 - r) ** 1.7 + 0.01, d.shape)
    AR = np.broadcast_to(ar[None, :], d.shape)
    pos = np.stack([cx + d * np.sin(AR), cy - d * np.cos(AR), z], -1)
    ob = _grid_obj(f"{tag}_talus", pos, np.zeros(pos.shape[:2] + (2,)), _scree_mat(), root, outward=(0, 0, 1))
    ob.visible_shadow = False
    _fade_attr(ob, (1 - _smooth(0.65, 1.0, np.broadcast_to(r, d.shape))) * _smooth(half, half * 0.65, np.abs(AR)))
    for k in range(stones):
        ak = rnd.uniform(-half * 0.8, half * 0.8)
        rk = rnd.random() ** 1.3
        rad = (0.035 + 0.13 * (1 - rk) ** 2) * rnd.uniform(0.6, 1.2) * min(1.0, 0.5 + reach)
        dk = float(plan(np.array(ak))) - 0.05 + rk * reach * 0.85
        _rock(f"{tag}_stone{k}", rad, P["dark"] if rnd.random() < 0.85 else P["top"], root,
              (cx + dk * math.sin(ak), cy - dk * math.cos(ak), height * (1 - rk) ** 1.7 + rad * 0.25), rnd)


def cliff_post(root, variant=0):
    """A post (terrain.ts): the rock mass on a cell's middle where a line turns or ends, a little taller and wider than
    an arm's end so it covers every join. Its plan a polygon of joint faces (rock breaks along flat joints, so no
    round tower), the scanned face round its front, the scan's top on its top, the talus round its front."""
    P = mats()
    rnd = random.Random(1100 + variant)
    plan, a, top = _mass("cl_post", root, P, rnd, radius=(1.12, 1.3), H=H_END + 0.25, nk=6 + variant % 2,
                         sgn=-1 if variant % 2 else 1, fx_mid=2.9 + 0.25 * (variant % 2))
    _apron("cl_p", root, P, rnd, plan, TALUS[0], TALUS[1], ph=rnd.uniform(0, 6.3))
    for k in range(6):
        ak = rnd.uniform(-1.2, 1.2)
        rk = rnd.uniform(0.15, 0.7)
        _tuft(f"cl_ptuft{k}", P, root, (rk * math.sin(ak), -rk * math.cos(ak), float(np.interp(ak, a, top)) + 0.15),
              rnd, dry=k % 2 == 0)


def rock_heap(root, variant=0):
    """Blocked ground (1, terrain.ts terrain_rock_v*): a heap of broken rock on one cell, the same rock as the cliffs:
    variants 0-2 a big heap (a block about 1.5 m high and two or three smaller against it), 3-5 a smaller one;
    neighbouring cells make heaps and ridges. Scree round the front, a tuft or two."""
    P = mats()
    rnd = random.Random(1300 + variant)
    big = variant < 3
    sc = 1.0 if big else 0.75
    blocks = [(0.0, 0.15, 0.72 * sc, 1.3 * sc)]
    n = rnd.randint(4, 5) if big else rnd.randint(3, 4)
    for k in range(n):                                     # broken blocks round it, more toward the front
        ang = -2.4 + 4.8 * (k + rnd.uniform(0.2, 0.8)) / n
        dist = rnd.uniform(0.6, 0.9) * sc
        size = rnd.uniform(0.28, 0.5) * sc
        blocks.append((dist * math.sin(ang), 0.15 - dist * math.cos(ang) * 0.85, size, size * rnd.uniform(0.8, 1.4)))
    tops = []
    for k, (bx, by, R, H) in enumerate(blocks):
        plan, a, top = _mass(f"tr_b{k}", root, P, rnd, cx=bx, cy=by, radius=(R * 0.75, R), H=H, nk=rnd.randint(5, 6),
                             sgn=rnd.choice((-1, 1)), fx_mid=rnd.uniform(1.8, 3.6), round_top=0.1, taper=0.12,
                             cap=0.05 * H, tilt=rnd.uniform(0.1, 0.25) * H)
        tops.append((bx, by, float(top.mean())))
        if k == 0:
            main_plan = plan
    _apron("tr", root, P, rnd, lambda aa: main_plan(aa) + 0.25, 0.55 if big else 0.4, 0.22 if big else 0.15,
           stones=26 if big else 16, ph=rnd.uniform(0, 6.3))
    for k in range(rnd.randint(1, 3)):                     # grass in the cracks between the blocks, on a top or two
        bx, by, tz = tops[rnd.randrange(len(tops))]
        _tuft(f"tr_tuft{k}", P, root, (bx + rnd.uniform(-0.15, 0.15), by + rnd.uniform(-0.15, 0.15), tz + 0.05), rnd,
              dry=rnd.random() < 0.5)


# ---------------------------------------------------------------- water, fords, bridges

def _pnoise(size, cells, seed):
    """Tileable value noise (size square, a lattice of `cells` a side, smoothstep between), 0..1."""
    rnd = np.random.default_rng(seed)
    lat = rnd.random((cells, cells))
    f = np.arange(size) * cells / size
    i = f.astype(int)
    t = f - i
    t = t * t * (3 - 2 * t)
    i0, i1 = i % cells, (i + 1) % cells
    a = lat[np.ix_(i0, i0)] * (1 - t[None, :]) + lat[np.ix_(i0, i1)] * t[None, :]
    b = lat[np.ix_(i1, i0)] * (1 - t[None, :]) + lat[np.ix_(i1, i1)] * t[None, :]
    return a * (1 - t[:, None]) + b * t[:, None]


def _ripples():
    """The water's small waves as a height image, tileable over one cell (2 m), so the tiles meet."""
    if "ripples_r8" in bpy.data.images:
        return bpy.data.images["ripples_r8"]
    h = sum(_pnoise(512, c, 40 + c) * w for c, w in ((4, 0.55), (8, 0.3), (16, 0.15)))
    img = bpy.data.images.new("ripples_r8", 512, 512, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    a = np.ones((512, 512, 4), np.float32)
    a[..., :3] = h[..., None]
    img.pixels.foreach_set(a.ravel())
    return img


def _node(nt, kind, **inputs):
    n = nt.nodes.new(kind)
    for k, v in inputs.items():
        n.inputs[k].default_value = v
    return n


def _range(nt, src, lo, hi):
    """smoothstep(lo, hi, src) as a Map Range node."""
    m = nt.nodes.new("ShaderNodeMapRange")
    m.interpolation_type = "SMOOTHSTEP"
    m.inputs["From Min"].default_value = lo
    m.inputs["From Max"].default_value = hi
    nt.links.new(src, m.inputs["Value"])
    return m.outputs["Result"]


def _ripple_normal(nt, strength):
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = _node(nt, "ShaderNodeMapping", Scale=(0.5, 0.5, 0.5))      # one image a cell: the tiles meet
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    im = nt.nodes.new("ShaderNodeTexImage")
    im.image = _ripples()
    im.interpolation = "Cubic"
    nt.links.new(mp.outputs["Vector"], im.inputs["Vector"])
    b = _node(nt, "ShaderNodeBump", Strength=strength, Distance=0.02)
    nt.links.new(im.outputs["Color"], b.inputs["Height"])
    return b.outputs["Normal"]


def _sky_sheen(nt, body, strength, ripple):
    """The sky in the water: its colour by the fresnel of the rippled surface, added to `body` (a shader output)."""
    lw = _node(nt, "ShaderNodeLayerWeight", Blend=0.35)
    nt.links.new(_ripple_normal(nt, ripple), lw.inputs["Normal"])
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (0.42, 0.5, 0.58, 1.0)
    k = nt.nodes.new("ShaderNodeMath")
    k.operation = "MULTIPLY"
    k.inputs[1].default_value = strength
    nt.links.new(lw.outputs["Fresnel"], k.inputs[0])
    nt.links.new(k.outputs[0], em.inputs["Strength"])
    add = nt.nodes.new("ShaderNodeAddShader")
    nt.links.new(body, add.inputs[0])
    nt.links.new(em.outputs[0], add.inputs[1])
    return add


def _water_mat():
    """Water over the ground's own river bank (ground.json's bank layer): clear of the bank where the blend of the four
    cells (terrain_tiles.field, the vertex attribute "f") is under the water's edge, a dark wet band just outside it,
    then silty shallows going darker and bluer to the middle; small waves catching the sky."""
    if "water_r8" in bpy.data.materials:
        return bpy.data.materials["water_r8"]
    m = bpy.data.materials.new("water_r8")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.bl_idname != "ShaderNodeOutputMaterial":
            nt.nodes.remove(n)
    out = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeOutputMaterial")
    f = nt.nodes.new("ShaderNodeAttribute")
    f.attribute_name = "f"
    deep = _range(nt, f.outputs["Fac"], 0.55, 0.95)
    col = nt.nodes.new("ShaderNodeMix")
    col.data_type = "RGBA"
    col.inputs["A"].default_value = (0.035, 0.045, 0.032, 1.0)     # silty shallows
    col.inputs["B"].default_value = (0.006, 0.016, 0.02, 1.0)       # the deep middle
    nt.links.new(deep, col.inputs["Factor"])
    base = nt.nodes.new("ShaderNodeBsdfPrincipled")        # the water's body: no lamp glints (the sun mirrors into
    nt.links.new(col.outputs["Result"], base.inputs["Base Color"])   # the camera here: the whole river went white)
    base.inputs["Roughness"].default_value = 0.4
    base.inputs["Specular IOR Level"].default_value = 0.0
    w = _sky_sheen(nt, base.outputs[0], 0.4, 0.18)
    wet = _node(nt, "ShaderNodeBsdfPrincipled", Roughness=0.35)
    wet.inputs["Base Color"].default_value = (0.03, 0.024, 0.017, 1.0)
    m1 = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(_range(nt, f.outputs["Fac"], 0.45, 0.53), m1.inputs["Fac"])
    nt.links.new(wet.outputs[0], m1.inputs[1])
    nt.links.new(w.outputs[0], m1.inputs[2])
    half = nt.nodes.new("ShaderNodeMath")
    half.operation = "MULTIPLY"
    half.inputs[1].default_value = 0.5
    nt.links.new(_range(nt, f.outputs["Fac"], 0.28, 0.47), half.inputs[0])
    mx = nt.nodes.new("ShaderNodeMath")
    mx.operation = "MAXIMUM"
    nt.links.new(half.outputs[0], mx.inputs[0])
    nt.links.new(_range(nt, f.outputs["Fac"], 0.47, 0.56), mx.inputs[1])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    m2 = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(mx.outputs[0], m2.inputs["Fac"])
    nt.links.new(tr.outputs[0], m2.inputs[1])
    nt.links.new(m1.outputs[0], m2.inputs[2])
    nt.links.new(m2.outputs[0], out.inputs["Surface"])
    return m


def water_tile(root, mask=15):
    """Water (terrain.ts terrain_water_m<mask>): the tile on a cell corner for one mask of its four cells, as
    terrain_tiles.py lays them; the water's surface only (the R8 ground paints the river bank round the water)."""
    import terrain_tiles as tt
    n = 64
    us = np.linspace(-tt.OVER, 1 + tt.OVER, n + 1)
    pos = np.zeros((n + 1, n + 1, 3))
    fv = np.zeros((n + 1, n + 1))
    for j, v in enumerate(us):
        for i, u in enumerate(us):
            pos[j, i] = ((u - 0.5) * CELL, -(v - 0.5) * CELL, 0.01)
            fv[j, i] = tt.field(mask, u, v)
    ob = _grid_obj("tw_water", pos, np.zeros(pos.shape[:2] + (2,)), _water_mat(), root, outward=(0, 0, 1))
    ob.visible_shadow = False
    a = ob.data.attributes.new("f", "FLOAT", "POINT")
    a.data.foreach_set("value", fv.astype(np.float32).ravel())


def _ford_mat():
    """A ford's bed: the ground's gravel (rocks_ground_02), wet and a little greener, under a skin of shallow water
    (its small waves, its sheen); opaque on its cell, fading out over the skirt (the scree's "fade" attribute)."""
    if "ford_r8" in bpy.data.materials:
        return bpy.data.materials["ford_r8"]
    m = _scree_mat().copy()
    m.name = "ford_r8"
    nt = m.node_tree
    p = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    hue = nt.nodes["hue"]
    film = nt.nodes.new("ShaderNodeMix")
    film.data_type = "RGBA"
    film.inputs["Factor"].default_value = 0.5
    film.inputs["B"].default_value = (0.012, 0.03, 0.036, 1.0)     # the water over it: ground.json's deep colour
    nt.links.new(hue.outputs["Result"], film.inputs["A"])
    nt.links.new(film.outputs["Result"], p.inputs["Base Color"])
    for lk in list(nt.links):
        if lk.to_node == p and lk.to_socket.name == "Roughness":
            nt.links.remove(lk)
    p.inputs["Roughness"].default_value = 0.4
    p.inputs["Specular IOR Level"].default_value = 0.1
    ms = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeMixShader")      # body + the sky's sheen, then the fade
    sheen = _sky_sheen(nt, p.outputs[0], 0.12, 0.15)
    nt.links.new(sheen.outputs[0], ms.inputs[2])
    return m


def ford_tile(root, variant=0):
    """Ford (4, terrain.ts terrain_ford_v*): a cell of shallow water over gravel with stepping stones, on the ground
    layer over the water; opaque on its cell, its skirt (half a metre round) fading into the water beside it."""
    P = mats()
    rnd = random.Random(1500 + variant)
    n = 60
    xs = np.linspace(-1.5, 1.5, n + 1)
    X, Y = np.meshgrid(xs, -xs)
    pos = np.stack([X, Y, np.full_like(X, 0.02)], -1)
    ob = _grid_obj("tf_bed", pos, np.zeros(pos.shape[:2] + (2,)), _ford_mat(), root, outward=(0, 0, 1))
    ob.visible_shadow = False
    # round, not square: the fords of a crossing overlap into one band whatever the river's line (the water is the
    # ground shader's, art-v6), the gravel strongest in the middle
    edge = np.hypot(X, Y)
    wob = 0.15 * np.sin(X * 3.1 + variant) * np.cos(Y * 2.7 + variant)
    _fade_attr(ob, 0.8 * _smooth(1.75, 0.55, edge + wob))
    for k in range(rnd.randint(12, 16)):                  # stepping stones and cobbles, wet, just out of the water
        r = rnd.uniform(0.08, 0.22)
        _rock(f"tf_stone{k}", r, P["dark"] if rnd.random() < 0.7 else P["top"], root,
              (rnd.uniform(-0.95, 0.95), rnd.uniform(-0.95, 0.95), 0.02), rnd)


def bridge_deck(root, axis="ns"):
    """Bridge (5 north-south, 6 east-west; terrain_bridge_deck_*): one cell of timber deck, planks across the way on
    two stringers and a pile bent in the water, on the ground layer (the rails are bridge_rail)."""
    wood = lib.mat("wood", (0.13, 0.085, 0.05), 0.75)          # weathered planks
    beam = lib.mat("timber", (0.09, 0.06, 0.04), 0.8)
    rnd = random.Random(1700 + (axis == "ew"))
    for i in range(9):                                     # planks across the way, uneven, a little gap between
        t = -0.89 + i * 0.2225
        L = 2.0 + rnd.uniform(-0.04, 0.04)
        sz = (L, 0.2, 0.06) if axis == "ns" else (0.2, L, 0.06)
        ob = box(f"tb_plank{i}", sz, wood, root, loc=(rnd.uniform(-0.03, 0.03), t, 0.42) if axis == "ns"
                 else (t, rnd.uniform(-0.03, 0.03), 0.42))
        ob.rotation_euler = (math.radians(rnd.uniform(-1, 1)), math.radians(rnd.uniform(-1, 1)), 0.0)
    for sx in (-1, 1):
        if axis == "ns":
            box(f"tb_str{sx}", (0.18, 2.04, 0.22), beam, root, loc=(sx * 0.72, 0, 0.28))
        else:
            box(f"tb_str{sx}", (2.04, 0.18, 0.22), beam, root, loc=(0, sx * 0.72, 0.28))
    for sx in (-1, 1):                                     # a pile under each stringer, the cap beam across them
        x, y = (sx * 0.72, 0.0) if axis == "ns" else (0.0, sx * 0.72)
        cyl(f"tb_pile{sx}", 0.1, 0.4, beam, root, loc=(x, y, -0.15), segs=10)
    box("tb_cap", (1.7, 0.2, 0.14) if axis == "ns" else (0.2, 1.7, 0.14), beam, root, loc=(0, 0, 0.12))


def bridge_rail(root, axis="x"):
    """A bridge's rail along one edge of a cell (terrain_bridge_rail_*, its anchor the edge's middle): posts a metre
    apart, a hand rail and a mid rail, rough timber."""
    beam = lib.mat("timber", (0.09, 0.06, 0.04), 0.8)
    for i in (-0.5, 0.5):
        x, y = (i, 0.0) if axis == "x" else (0.0, i)
        box(f"tb_post{i}", (0.12, 0.12, 1.1), beam, root, loc=(x, y, 0.55 + 0.4))
    box("tb_rail", (2.02, 0.1, 0.1) if axis == "x" else (0.1, 2.02, 0.1), beam, root, loc=(0, 0, 1.45))
    box("tb_mid", (2.02, 0.07, 0.07) if axis == "x" else (0.07, 2.02, 0.07), beam, root, loc=(0, 0, 1.0))


def r8_water(root, c, mask=15):
    water_tile(root, mask)


def r8_ford(root, c, variant=0):
    ford_tile(root, variant)


def r8_bridge_deck(root, c, axis="ns"):
    bridge_deck(root, axis)


def r8_bridge_rail(root, c, axis="x"):
    bridge_rail(root, axis)


def r8_cliff_post(root, c, variant=0):
    cliff_post(root, variant)


def r8_cliff_arm(root, c, variant=0, direction="E"):
    cliff_arm(root, direction, variant)


def r8_rock(root, c, variant=0):
    rock_heap(root, variant)


FOOTPRINT = {"r8_cliff_post": (1, 1), "r8_cliff_arm": (1, 1), "r8_rock": (1, 1), "r8_water": (1, 1), "r8_ford": (1, 1),
             "r8_bridge_deck": (1, 1), "r8_bridge_rail": (1, 1)}
BUILDERS = {"r8_cliff_post": r8_cliff_post, "r8_cliff_arm": r8_cliff_arm, "r8_rock": r8_rock, "r8_water": r8_water,
            "r8_ford": r8_ford, "r8_bridge_deck": r8_bridge_deck, "r8_bridge_rail": r8_bridge_rail}
