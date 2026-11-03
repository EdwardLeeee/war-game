"""art-v7's floating-continent edge (D-118: the user chose R11's C; the format design/r11/edge-format.md, agreed with
war-game-client 2026-11-04): the cliff stretches and corners as render_b1 pieces on the diamond camera.

The two seen edges are cut into 16 m slots from the bottom corner (south-west): slot k's middle 16 k m along the edge.
The playable maps are 129 cells of 2 m (雙河關, the random maps): 258 m = 16 x 16 + 2. The bottom corner draws the first
8 m of each edge; stretches 1..15 (three variants a side, in any order) the next 240 m; the left (north-west) and right
(south-east) corners the last 10 m, their rock in the phase of an edge 16 k + 2 m long (on another length, one seam at
that corner). Every piece draws 1 m past its ends over its neighbours.

- What joins: every s-dependent term is a sum of a part periodic in 16 m (the join profile: the rock, the strata, the
  soil band) and a variant's own part (its headland, wobble, soil) that is zero within 2 m of a slot's end. So any
  stretch meets any other, or a corner, with the same face, lip and soil.
- The rock: the scanned face (terrain_r8's field) tiled 4 m along and 4.4 m down by a cross-fade of two samples half a
  tile apart (the rock that stands out wins), each tile row shifted along: R11's mirrored strip drew chevrons. The
  relief from a field blurred to the mesh's spacing first: sampling the 1 cm field at 16 cm folded the mesh (R11's
  shards).
- The top: turf from just past the lip to 1 m into the map (the client fades its ground over the last 0.75 m onto it),
  the leafy_grass of the ground's grass layer tinted to the ground's mean grass a little darker; grass hanging over the
  lip; the soil band under it 0.25-0.65 m, not one stroke.
- Corners: the two legs meet round a curve outside the map's corner (the corner itself stays on land).
The origin is the slot's middle on the map's edge line (a corner's: the map's corner) at ground height; +y north.
"""
import math
import os
import random

import bmesh
import bpy
import numpy as np
from mathutils import Quaternion

import lib
import terrain_r8 as T
from edge_r11 import _n1, _lin, _srgb

HERE = os.path.dirname(os.path.abspath(__file__))
TEXDIR = os.path.join(HERE, "..", "..", "r7", "build", "tex")
H = 13.0
SLOT = 16.0
OWN, JOIN = 3.0, 6.5                # a variant is its own within OWN of its slot's middle, the join profile past JOIN
# linear albedo: ground_run's grass (tint (0.075, 0.12, 0.035) with a quarter of leafy_grass's own colour, mean
# (0.313, 0.23, 0.102)) is (0.134, 0.148, 0.052); the client asked for the ground's mean grass or a little darker
TURF = (0.125, 0.135, 0.04)
SOIL = np.array([0.055, 0.04, 0.025])
BLADE = ((0.045, 0.07, 0.018), (0.11, 0.09, 0.04))      # hanging grass: green, dry (lit from above they read pale)


def _pn(x, seed, n):
    """Smooth value noise 0..1, periodic in SLOT metres with n cells a period."""
    lat = np.random.default_rng(seed).random(n)
    f = np.asarray(x) / SLOT * n
    i = np.floor(f).astype(int)
    t = f - i
    t = t * t * (3 - 2 * t)
    return lat[i % n] * (1 - t) + lat[(i + 1) % n] * t


def _own(u):
    """1 within OWN of the slot's middle, 0 past JOIN."""
    a = np.clip((JOIN - np.abs(u)) / (JOIN - OWN), 0, 1)
    return a * a * (3 - 2 * a)


_FB = {}


def _flt():
    """The scanned field, its relief blurred to the wall mesh's spacing (sigma ~7 cm), its colour to the skin's (~2 cm)."""
    if not _FB:
        F = T.field(T.SID)
        _FB["geo"] = dict(out=T._blur(F["out"], 7), rgb=F["rgb"])
        rgb = np.stack([T._blur(F["rgb"][..., k], 2) for k in range(3)], -1)
        _FB["skin"] = dict(out=T._blur(F["out"], 3), rgb=rgb)
    return _FB


def _rock(sf, d, which):
    """Relief (m out) and linear colour of the rock at sf (periodic in 4 m) and d down."""
    F = _flt()[which]
    span, hgt = 4.0, 4.4
    outs, cols, ws = [], [], []
    for kb in (0.0, 0.5):
        g = d / hgt + kb
        vb = np.mod(g, 1.0)
        shift = np.mod(np.floor(g) * 0.381 + kb * 0.27, 1.0)
        wb = 1 - np.abs(2 * vb - 1)
        for ka in (0.0, 0.5):
            ua = np.mod(sf / span + ka + shift, 1.0)
            wa = 1 - np.abs(2 * ua - 1)
            o, rgb = T._sample(F, T.FX_LO + 0.05 + ua * (span - 0.1), 0.15 + vb * hgt)
            outs.append(o)
            cols.append(_lin(rgb))
            ws.append((wa * wb) ** 2 * np.exp(np.clip(o, -0.5, 0.5) / 0.06) + 1e-9)
    wsum = sum(ws)
    out = sum(w * o for w, o in zip(ws, outs)) / wsum
    lin = sum(w[..., None] * c for w, c in zip(ws, cols)) / wsum[..., None]
    return out, lin


def _fields(sf, u, d, w, v, which="geo"):
    """Relief and colour at field phase sf, local u (the variant's own terms, weight w), d down."""
    out, lin = _rock(sf, d, which)
    ph = 2 * math.pi * sf / SLOT
    dd = d + 0.35 * np.sin(ph + 1.3) + 0.15 * np.sin(3 * ph + 0.2)             # strata, dipping gently
    hard = T._smooth(0.5, 0.68, _n1(dd, 21, 0.9))
    lin = lin * (0.82 + 0.26 * hard)[..., None] * np.array([1.0, 0.97, 0.92])
    out = out + 0.18 * hard
    # the soil band: 0.25-0.65 m, the join's own wander and the variant's
    cap = 0.25 + 0.4 * (_pn(sf, 31, 5) * (1 - w) + _n1(u + 50 * v, 61 + v, 1.6) * w) + 0.07 * (_pn(sf, 35, 70) - 0.5)
    soil_k = T._smooth(cap + 0.1, cap - 0.08, d)[..., None]
    crumb = _pn(sf + 2.3 * d, 33, 200)[..., None]
    lin = lin * (1 - soil_k) + SOIL * (0.7 + 0.6 * crumb) * soil_k
    out = out + 0.06 * soil_k[..., 0]                                         # the soil a little proud of the rock
    haze = T._smooth(H * 0.45, H, d)[..., None]
    lin = lin * (1 - 0.35 * haze) + np.array([0.32, 0.36, 0.42]) * 0.35 * haze
    return out, lin


# (centre, metres out, width): flanks no steeper than ~0.6 (R11's steep flanks drew the rock stretched across them)
HEADS = (((0.3, 2.3, 2.3), (-3.2, 0.5, 1.2)),                  # one broad headland
         ((-2.2, 0.9, 1.5), (2.6, 0.6, 1.3)),                  # nearly straight
         ((-2.5, 1.7, 1.6), (2.4, 1.3, 1.5)))                  # two


def _variant(v, u):
    """The variant's headland (m out) and wobble, both zero past JOIN."""
    w = _own(u)
    head = sum(a * np.exp(-0.5 * ((u - c) / sg) ** 2) for c, a, sg in HEADS[v])
    head = head * (0.85 + 0.3 * _n1(u, 71 + v, 1.3))
    wob = 0.45 * (_n1(u + 40 * v, 7 + v, 4.0) - 0.5) + 0.2 * (_n1(u + 40 * v, 9 + v, 1.5) - 0.5)
    return head * w, wob * w, w


def _inward(D):
    """The face's lean: near-vertical, then drawn in under the land."""
    return 0.05 * D + 0.8 * T._smooth(H * 0.55, H, D) * (D - H * 0.55)


class Path:
    """Where a column u of a piece runs on the ground: point and outward normal at outward offset o (arrays)."""

    def __init__(self, n, t, legs=None):
        self.n, self.t, self.legs = np.array(n, float), np.array(t, float), legs

    def at(self, u, o):
        if self.legs is None:
            p = u[..., None] * self.t + o[..., None] * self.n
            return p, np.broadcast_to(self.n, p.shape)
        (n1, t1), (n2, t2) = [(np.array(a, float), np.array(b, float)) for a, b in self.legs]
        U0 = np.maximum(2.0, 2.0 - o)
        p1 = o[..., None] * n1 + (-u)[..., None] * t1
        p2 = o[..., None] * n2 + u[..., None] * t2
        tau = np.clip((u + U0) / (2 * U0), 0, 1)[..., None]
        A = o[..., None] * n1 + U0[..., None] * t1
        K = o[..., None] * (n1 + n2)
        B = o[..., None] * n2 + U0[..., None] * t2
        pb = (1 - tau) ** 2 * A + 2 * tau * (1 - tau) * K + tau ** 2 * B
        tg = 2 * (1 - tau) * (K - A) + 2 * tau * (B - K)
        sgn = np.sign((-t1[0]) * n1[1] - (-t1[1]) * n1[0])          # turns -t1 onto n1
        nb = np.stack([-sgn * tg[..., 1], sgn * tg[..., 0]], -1)
        nb = nb / np.linalg.norm(nb, axis=-1, keepdims=True)
        left = (u <= -U0)[..., None]
        right = (u >= U0)[..., None]
        p = np.where(left, p1, np.where(right, p2, pb))
        nn = np.where(left, n1, np.where(right, n2, nb))
        return p, nn


EDGE_M = 258.0                      # the seen edges' length (129 cells): the far corners' rock phase


def _phase(path, u, sig):
    """[(sf, weight)]: the field phases a column samples (a corner cross-fades its two legs' phases round the curve).
    sig: each leg's sign, or (sign, offset): a far corner's seen leg is EDGE_M - a from the bottom corner."""
    if path.legs is None:
        return [(u, np.ones_like(u))]
    b = T._smooth(-2.5, 2.5, u)
    (s0, o0), (s1, o1) = [(s, 0.0) if not isinstance(s, tuple) else s for s in sig]
    return [(-s0 * u + o0, 1 - b), (s1 * u + o1, b)]


def _blend(path, u, d, w, v, sig, which, slide=None):
    out, lin = 0.0, 0.0
    for sf, k in _phase(path, u, sig):
        if slide is not None:
            sf = sf + slide(u)
        o, c = _fields(sf, u, d, w, v, which)
        out = out + k * o
        lin = lin + k[..., None] * c
    return out, lin


def _wall_mat(name, img, z0, z1, slot=None):
    """terrain_r8's skin (the colour by UV, its brightness as a fine bump, rough stone) that fades out below z1 to
    nothing at z0, raggedly, darkening into the shade under the land as it goes: the client draws the clouds under the
    cliff, so the wall sinks into them. slot: past this (object x or y) is the metre drawn over a neighbour; there the
    fading part is left out, so two translucent copies never stack (a denser seam every 16 m)."""
    m = T._skin_mat(name, img)
    nt = m.node_tree
    p = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    col_link = next(l for l in nt.links if l.to_socket == p.inputs["Base Color"])
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sep.inputs["Vector"])
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 0.35
    noise.inputs["Detail"].default_value = 4.0
    nt.links.new(geo.outputs["Position"], noise.inputs["Vector"])
    add = nt.nodes.new("ShaderNodeMath")
    add.operation = "MULTIPLY_ADD"
    add.inputs[1].default_value = 3.0
    add.inputs[2].default_value = -1.5
    nt.links.new(noise.outputs["Fac"], add.inputs[0])
    zz = nt.nodes.new("ShaderNodeMath")
    zz.operation = "ADD"
    nt.links.new(sep.outputs["Z"], zz.inputs[0])
    nt.links.new(add.outputs[0], zz.inputs[1])
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.interpolation_type = "SMOOTHSTEP"
    mr.inputs["From Min"].default_value = z0
    mr.inputs["From Max"].default_value = z1
    nt.links.new(zz.outputs[0], mr.inputs["Value"])
    fade = mr.outputs["Result"]
    # the colour toward the shade under the land as it fades
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["B"].default_value = (0.1, 0.13, 0.2, 1.0)
    inv = nt.nodes.new("ShaderNodeMath")
    inv.operation = "MULTIPLY_ADD"
    inv.inputs[1].default_value = -0.65
    inv.inputs[2].default_value = 0.65
    nt.links.new(fade, inv.inputs[0])
    nt.links.new(inv.outputs[0], mix.inputs["Factor"])
    nt.links.new(col_link.from_socket, mix.inputs["A"])
    nt.links.new(mix.outputs["Result"], p.inputs["Base Color"])
    if slot is not None:
        tc = nt.nodes.new("ShaderNodeTexCoord")
        sx = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(tc.outputs["Object"], sx.inputs["Vector"])
        ax_, ay_ = nt.nodes.new("ShaderNodeMath"), nt.nodes.new("ShaderNodeMath")
        ax_.operation = ay_.operation = "ABSOLUTE"
        nt.links.new(sx.outputs["X"], ax_.inputs[0])
        nt.links.new(sx.outputs["Y"], ay_.inputs[0])
        mx = nt.nodes.new("ShaderNodeMath")
        mx.operation = "MAXIMUM"
        nt.links.new(ax_.outputs[0], mx.inputs[0])
        nt.links.new(ay_.outputs[0], mx.inputs[1])
        inside = nt.nodes.new("ShaderNodeMath")
        inside.operation = "LESS_THAN"
        inside.inputs[1].default_value = slot
        nt.links.new(mx.outputs[0], inside.inputs[0])
        solid = nt.nodes.new("ShaderNodeMath")
        solid.operation = "GREATER_THAN"
        solid.inputs[1].default_value = 0.995
        nt.links.new(fade, solid.inputs[0])
        keep = nt.nodes.new("ShaderNodeMath")
        keep.operation = "MAXIMUM"
        nt.links.new(inside.outputs[0], keep.inputs[0])
        nt.links.new(solid.outputs[0], keep.inputs[1])
        a = nt.nodes.new("ShaderNodeMath")
        a.operation = "MULTIPLY"
        nt.links.new(fade, a.inputs[0])
        nt.links.new(keep.outputs[0], a.inputs[1])
        fade = a.outputs[0]
    nt.links.new(fade, p.inputs["Alpha"])
    return m


def _turf_mat():
    """The ground's grass (leafy_grass, 2 m a tile like ground_run's grass layer), tinted to TURF, in world xy."""
    import look
    look.TEX.setdefault("leafy_grass", {k: os.path.join(TEXDIR, f"leafy_grass_{k}_2k.jpg") for k in ("diff", "rough", "nor_gl")})
    m = lib.mat("turf_v7", TURF, 0.9)
    look.texture(m, "leafy_grass", TURF, 0.9, scale=1.0, hue=0.25, bump=0.5, contrast=1.05)     # (0.85 read flat)
    return m


def _drape(name, root, pts, rnd, mats):
    """Grass hanging over the lip: at each (point, normal, along) a tuft of blades that leave the turf outward and bend
    down under their own weight."""
    bms = [bmesh.new(), bmesh.new()]
    for (px, py), (nx, ny), (tx, ty) in pts:
        for b in range(rnd.randint(9, 16)):
            bm = bms[1 if rnd.random() < 0.28 else 0]
            L = rnd.uniform(0.22, 0.7) * (1.5 if rnd.random() < 0.12 else 1.0)
            psi = rnd.uniform(-0.6, 0.6)
            f0, f1 = rnd.uniform(0.15, 0.6), rnd.uniform(-1.55, -0.9)
            w0 = rnd.uniform(0.012, 0.024)
            dx = math.cos(psi) * nx + math.sin(psi) * tx
            dy = math.cos(psi) * ny + math.sin(psi) * ty
            sx, sy = -math.sin(psi) * nx + math.cos(psi) * tx, -math.sin(psi) * ny + math.cos(psi) * ty
            off = rnd.uniform(-0.09, 0.09)
            c = [px - 0.06 * nx + off * tx, py - 0.06 * ny + off * ty, rnd.uniform(0.0, 0.03)]
            prev = None
            seg = 5
            for i in range(seg + 1):
                tt = i / seg
                wd = w0 * (1 - 0.85 * tt)
                vs = (bm.verts.new((c[0] - wd * sx, c[1] - wd * sy, c[2])), bm.verts.new((c[0] + wd * sx, c[1] + wd * sy, c[2])))
                if prev:
                    bm.faces.new((prev[0], prev[1], vs[1], vs[0]))
                prev = vs
                f = f0 + (f1 - f0) * (tt + 0.5 / seg) ** 1.3
                step = L / seg
                c = [c[0] + step * math.cos(f) * dx, c[1] + step * math.cos(f) * dy, c[2] + step * math.sin(f)]
    for k, bm in enumerate(bms):
        ob = lib._mesh_obj(f"{name}_drape{k}", bm, mats[k], root, (0, 0, 0), smooth=False, outline=False)
        ob["no_bevel"] = True


def surface(root, name, path, u0, u1, v=0, sig=(1, 1), corner_head=0.0, seed=3, slot=SLOT / 2):
    """The wall of columns u0..u1 along `path` and its top. v: the variant (its own terms within JOIN of u = 0);
    corner_head: a corner's lip this far out round the curve (the map's corner stays on land)."""
    du, dz = 0.16, 0.13
    u = np.arange(u0, u1 + du * 0.5, du)
    d = np.arange(0.0, H + dz * 0.5, dz)
    U, D = np.meshgrid(u, d)
    if path.legs is None:
        head, wob, w = _variant(v, U)
    else:
        w = _own(U)
        wob = (0.35 * (_n1(U, 7 + seed, 3.0) - 0.5)) * w
        head = corner_head * T._smooth(5.0, 2.5, np.abs(U))
    base = wob + head - _inward(D)                              # metres out from the map's edge line, before the rock
    P, N = path.at(U, base)
    # the plan's own normal (round a headland, a corner's curve), for the rock to stand out of the face it is on
    tg = np.gradient(P, axis=1)
    nl = np.stack([tg[..., 1], -tg[..., 0]], -1)
    nl = nl * np.sign((nl * N).sum(-1, keepdims=True))
    nl = nl / np.linalg.norm(nl, axis=-1, keepdims=True)
    slide = None
    if path.legs is None:
        # the rock along the lip's own length (no stretch across a headland's flank), slid back to u at both ends
        arc = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(P[0], axis=0), axis=-1))]) + u[0]
        extra = arc - u
        ramp = T._smooth(-JOIN, JOIN, u)
        slide = lambda x: np.interp(x, u, extra - extra[-1] * ramp)      # noqa: E731
    out, _ = _blend(path, U, D, w, v, sig, "geo", slide)
    e = base + 0.9 * out
    pos = np.concatenate([P + 0.9 * out[..., None] * nl, -D[..., None]], -1)
    uv = np.stack([(U - u0) / (u1 - u0), 1.0 - D / H], -1)
    fu = np.arange(u0, u1, 0.04)
    fd = np.arange(H, 0.0, -0.04)
    FU, FD = np.meshgrid(fu, fd)
    wf = _own(FU) if path.legs is not None else _variant(v, FU)[2]
    _, lin = _blend(path, FU, FD, wf, v, sig, "skin", slide)
    img = T._image(f"{name}_skin", _srgb(lin))       # rows from the bottom (fd runs up from d = H; R11 had it flipped)
    mid_n = path.at(np.array([0.5 * (u0 + u1)]), np.array([0.0]))[1][0]
    ob = T._grid_obj(f"{name}_wall", pos, uv, _wall_mat(f"{name}_mat", img, -H + 0.3, -H + 5.5, slot=slot), root,
                     outward=(mid_n[0], mid_n[1], 0))
    ob["no_bevel"] = True
    # the top: from just past the lip (ragged) to 1 m into the map
    e0 = e[0]
    rag = 0.1 + 0.16 * _n1(u * 3.0 + 17 * v + seed, 43, 0.5)        # (turf over turf where pieces overlap)
    lip0 = pos[0, :, :2]
    tp = [lip0 + rag[:, None] * nl[0], lip0 + 0.5 * rag[:, None] * nl[0]]
    for o in (0.5 * base[0], np.zeros_like(u), np.full_like(u, -1.0)):
        tp.append(path.at(u, o)[0])
    tp = np.stack([np.concatenate([p, np.zeros((len(u), 1))], -1) for p in tp], 0)
    tp = np.stack(tp, 0)
    tp[0, :, 2] = -0.03                                           # the outer edge rolls over the lip
    tuv = np.zeros(tp.shape[:2] + (2,))
    top = T._grid_obj(f"{name}_turf", tp, tuv, _turf_mat(), root, outward=(0, 0, 1))
    top["no_bevel"] = True
    # grass hanging over the lip, every 0.12-0.2 m
    rnd = random.Random(seed)
    pts = []
    x = u0 + rnd.uniform(0, 0.12)
    lip, nrm = lip0 + 0.6 * rag[:, None] * nl[0], nl[0]
    while x < u1:
        i = int(np.clip(np.searchsorted(u, x), 0, len(u) - 1))
        nx, ny = nrm[i]
        pts.append(((lip[i][0], lip[i][1]), (nx, ny), (-ny, nx)))
        x += rnd.uniform(0.12, 0.2)
    mats = [lib.mat("drape_v7", BLADE[0], 0.85), lib.mat("drapedry_v7", BLADE[1], 0.85)]
    _drape(name, root, pts, rnd, mats)
    # (no upright tufts along it: terrain_r8's dark tufts read as black marks on the turf at phone size)
    return e


SIDES = {"sw": ((-1.0, 0.0), (0.0, 1.0)), "se": ((0.0, -1.0), (1.0, 0.0))}
# corners: (leg 1: the seen face, its normal and the way away from the corner; leg 2), each leg's field phase sign
CORNERS = {"bottom": ((((-1, 0), (0, 1)), ((0, -1), (1, 0))), (1, 1), (-9.0, 9.0)),
           "left": ((((-1, 0), (0, -1)), ((0, 1), (1, 0))), ((-1, EDGE_M % SLOT), 1), (-11.0, 4.0)),
           "right": ((((0, -1), (-1, 0)), ((1, 0), (0, 1))), ((-1, EDGE_M % SLOT), 1), (-11.0, 4.0))}


def v7_cliff(root, c="E", edge="sw", variant=0):
    """Slot k's stretch (16 m + 1 m each end), its middle at the origin: sw the west edge (faces -x), se the south."""
    n, t = SIDES[edge]
    surface(root, f"cl_{edge}{variant}", Path(n, t), -9.0, 9.0, v=variant, seed=3 + variant + (10 if edge == "se" else 0))


def v7_corner(root, c="E", which="bottom"):
    """A corner and the half slot each side of it: bottom (SW) both legs seen; left (NW) the west leg and the start of
    the hidden north face; right (SE) the south leg and the start of the hidden east face."""
    legs, sig, (u0, u1) = CORNERS[which]
    surface(root, f"co_{which}", Path(legs[0][0], legs[0][1], legs), u0, u1, sig=sig, corner_head=0.9,
            seed=23 + len(which), slot=-u0 - 1.0)


def v7_isle(root, c="E", size=5.0, seed=7, trees=4):
    """A far island floating in the clouds (R11's C, its open point: more to it): an irregular turf top (radius ~size),
    the soil band, a deep rock root under it hanging in lobes, grass over its rim, small trees (a big island far off:
    trees at 0.15 of the map's). Origin: the top's middle at turf height."""
    import nature_r8
    rnd = random.Random(seed)
    nseg, nring = 72, 30
    depth = size * 2.3
    lobes = [size * (0.72 + 0.4 * rnd.random()) for _ in range(14)]

    def r_at(a):
        f = (a / (2 * math.pi)) % 1.0 * 14
        i = int(f) % 14
        t = f - int(f)
        t = t * t * (3 - 2 * t)
        return lobes[i] * (1 - t) + lobes[(i + 1) % 14] * t
    per = 2 * math.pi * size
    per = SLOT * max(1, round(per / SLOT))                    # the rock's phase seamless all round
    hang = [(rnd.uniform(0, 2 * math.pi), rnd.uniform(0.25, 0.55), rnd.uniform(0.35, 0.8)) for _ in range(7)]
    pos = np.zeros((nring + 1, nseg + 1, 3))
    uv = np.zeros((nring + 1, nseg + 1, 2))
    A = 2 * math.pi * np.arange(nseg + 1) / nseg
    T_ = np.arange(nring + 1) / nring
    AA, TT = np.meshgrid(A, T_)
    out, _ = _fields(AA / (2 * math.pi) * per, AA * 0, TT * depth, np.zeros_like(AA), 0, "geo")
    for j in range(nring + 1):
        t = j / nring
        for i in range(nseg + 1):
            a = A[i]
            r = r_at(a) * (0.82 * (1 - t) ** 1.6 + 0.18 * (1 - t)) * (1 + 0.12 * math.sin(math.pi * min(1.0, t / 0.18)))
            # lobes of rock hanging lower than the rest (the root is not one cone)
            for ha, hw, hd in hang:
                da = math.atan2(math.sin(a - ha), math.cos(a - ha))
                r += r_at(a) * hd * 0.35 * math.exp(-(da / hw) ** 2) * math.sin(math.pi * min(1.0, t / 0.75)) ** 1.5
            r = max(r + 0.6 * float(out[j, i]) * (1 - t), 0.05)
            pos[j, i] = (r * math.cos(a), r * math.sin(a), -depth * t ** 0.9)
            uv[j, i] = (i / nseg, 1 - t)
    FA, FT = np.meshgrid(np.linspace(0, per, 1024), np.linspace(depth, 0, 512))
    _, lin = _fields(FA, FA * 0, FT, np.zeros_like(FA), 0, "skin")
    img = T._image(f"isle_skin{seed}", _srgb(lin))
    T._grid_obj(f"isle_root{seed}", pos, uv, _wall_mat(f"isle_mat{seed}", img, -depth * 0.97, -depth * 0.5), root,
                outward=(1, 0, 0))
    # the top: a fan of the rim at turf height
    bm = bmesh.new()
    cv = bm.verts.new((0, 0, 0.04))
    rim = [bm.verts.new(tuple(pos[0, i, :2]) + (0.0,)) for i in range(nseg)]
    for i in range(nseg):
        bm.faces.new((cv, rim[i], rim[(i + 1) % nseg]))
    top = lib._mesh_obj(f"isle_top{seed}", bm, _turf_mat(), root, (0, 0, 0), smooth=True, outline=False)
    top["no_bevel"] = True
    # grass over the rim
    pts = []
    for i in range(0, nseg * 3):
        a = 2 * math.pi * i / (nseg * 3)
        r = r_at(a) + 0.04
        pts.append(((r * math.cos(a), r * math.sin(a)), (math.cos(a), math.sin(a)), (-math.sin(a), math.cos(a))))
    _drape(f"isle{seed}", root, pts, rnd, [lib.mat("drape_v7", BLADE[0], 0.85), lib.mat("drapedry_v7", BLADE[1], 0.85)])
    for k in range(trees):
        a = rnd.uniform(0, 2 * math.pi)
        rr = rnd.uniform(0, size * 0.55)
        e = lib.empty(f"isle_tree{seed}_{k}", parent=root, loc=(rr * math.cos(a), rr * math.sin(a), 0.0))
        nature_r8.tree(e, "E", k % 3, "full")
        sc = rnd.uniform(0.12, 0.18)
        e.scale = (sc, sc, sc)
    P8 = T.mats()
    for k in range(int(size * 6)):
        a = rnd.uniform(0, 2 * math.pi)
        rr = math.sqrt(rnd.random()) * size * 0.8
        tf = T._tuft(f"isle_tuft{seed}_{k}", P8, root, (rr * math.cos(a), rr * math.sin(a), 0.0), rnd, dry=rnd.random() < 0.4)
        tf.scale = (0.5, 0.5, 0.45)


FOOTPRINT = {"v7_cliff": (1, 1), "v7_corner": (1, 1), "v7_isle": (1, 1)}
BUILDERS = {"v7_cliff": v7_cliff, "v7_corner": v7_corner, "v7_isle": v7_isle}
