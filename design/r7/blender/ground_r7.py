"""R7 (D-092): the 12 x 8 cell (24 x 16 m) battlefield ground shared by versions 1-3: grass, a dirt road, gravel and a
stretch of river bank, CC0 textures (look.TEX) blended through soft masks, with tufts of grass and pebbles on top.

The masks are painted here (numpy, 4 px a metre... 16 px a metre), noisy at the edges; where two grounds meet, the
lower texture's bright spots show through (height blending), so a road frays into the grass instead of ending on a
line. Render axes: +x east, +y north, the patch centred on the origin.
"""
import math
import random

import bpy
import numpy as np

import lib
import look

W_M, D_M = 24.0, 16.0
PX = 16                                  # mask pixels a metre
ROAD = [(-13.0, -2.6), (-6.0, -1.2), (0.0, -1.6), (6.0, -0.4), (13.0, 1.2)]
GRAVEL = [(-6.0, 0.6, 2.4, 1.6), (-2.5, 2.8, 1.4, 1.0), (8.0, -4.8, 1.8, 1.2)]   # (x, y, rx, ry)
# the river: water north of this line in the north-east corner, the bank 1.6 m wide along it
RIVER = [(2.0, 8.5), (5.5, 6.2), (9.0, 5.0), (12.5, 4.4)]
BANK_M = 1.6


def _noise(shape, scale, seed):
    """Smooth value noise in [0, 1], `scale` pixels a cell."""
    rng = np.random.default_rng(seed)
    h, w = shape
    gh, gw = h // scale + 3, w // scale + 3
    g = rng.random((gh, gw))
    yy = np.arange(h) / scale
    xx = np.arange(w) / scale
    y0, x0 = yy.astype(int), xx.astype(int)
    fy, fx = yy - y0, xx - x0
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a = g[y0][:, x0] * (1 - fx) + g[y0][:, x0 + 1] * fx
    b = g[y0 + 1][:, x0] * (1 - fx) + g[y0 + 1][:, x0 + 1] * fx
    return a * (1 - fy)[:, None] + b * fy[:, None]


def _seg_dist(px, py, pts):
    d = np.full(px.shape, 1e9)
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        dx, dy = x1 - x0, y1 - y0
        t = np.clip(((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy), 0, 1)
        d = np.minimum(d, np.hypot(px - (x0 + t * dx), py - (y0 + t * dy)))
    return d


def _side(px, py, pts):
    """Signed: > 0 north of the polyline (y above the line's y at that x)."""
    xs = np.array([p[0] for p in pts])
    ys = np.array([p[1] for p in pts])
    return py - np.interp(px, xs, ys)


def masks():
    """road, gravel, bank, water in [0, 1], rows from north to south (image order flipped later)."""
    h, w = int(D_M * PX), int(W_M * PX)
    px = (np.arange(w) + 0.5) / PX - W_M / 2
    py = D_M / 2 - (np.arange(h) + 0.5) / PX
    px, py = np.meshgrid(px, py)
    n1 = _noise((h, w), 10, 1) - 0.5
    n2 = _noise((h, w), 3, 2) - 0.5
    edge = n1 * 0.9 + n2 * 0.35
    road = np.clip((1.25 + edge - _seg_dist(px, py, ROAD)) / 0.6, 0, 1)
    gravel = np.zeros((h, w))
    for x, y, rx, ry in GRAVEL:
        r = np.hypot((px - x) / rx, (py - y) / ry)
        gravel = np.maximum(gravel, np.clip((1.0 + edge * 0.8 - r) / 0.35, 0, 1))
    s = _side(px, py, RIVER) + edge * 0.5
    water = np.clip(s / 0.25, 0, 1)
    bank = np.clip((s + BANK_M) / 0.5, 0, 1) * (1 - water)
    return dict(road=road, gravel=gravel, bank=bank, water=water)


def _mask_image(name, a):
    h, w = a.shape
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    px = np.repeat(np.flipud(a)[:, :, None], 4, axis=2).astype(np.float32)
    px[:, :, 3] = 1.0
    img.pixels.foreach_set(px.ravel())
    img.pack()
    return img


def _tex_layer(nt, vec, tid, colour, scale=1.0, contrast=0.55):
    """(colour socket, height socket) of one ground texture, tinted like look.texture."""
    mp = nt.nodes.new("ShaderNodeMapping")
    s = 1.0 / (look.SIZE[tid] * scale)
    mp.inputs["Scale"].default_value = (s, s, s)
    nt.links.new(vec, mp.inputs["Vector"])
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = look._img(look.TEX[tid]["diff"], True)
    nt.links.new(mp.outputs["Vector"], t.inputs["Vector"])
    mean = look.MEAN[tid]
    lum_mean = 0.2126 * mean[0] + 0.7152 * mean[1] + 0.0722 * mean[2]
    bw = nt.nodes.new("ShaderNodeRGBToBW")
    nt.links.new(t.outputs["Color"], bw.inputs["Color"])
    k = nt.nodes.new("ShaderNodeMath")
    k.operation = "DIVIDE"
    k.inputs[1].default_value = lum_mean
    nt.links.new(bw.outputs["Val"], k.inputs[0])
    c = nt.nodes.new("ShaderNodeMath")              # the texture's light and dark, toned down: dark photos divided by a
    c.operation = "MULTIPLY_ADD"                    # small mean blew up their bright spots (the road looked like wood chips)
    c.inputs[1].default_value = contrast
    c.inputs[2].default_value = 1 - contrast
    nt.links.new(k.outputs[0], c.inputs[0])
    k = c
    hue = nt.nodes.new("ShaderNodeMix")
    hue.data_type = "RGBA"
    hue.blend_type = "MULTIPLY"
    hue.inputs["Factor"].default_value = 1.0
    hue.inputs["A"].default_value = (*[c / m for c, m in zip(colour, mean)], 1)
    nt.links.new(t.outputs["Color"], hue.inputs["B"])
    tint = nt.nodes.new("ShaderNodeMix")
    tint.data_type = "RGBA"
    tint.blend_type = "MULTIPLY"
    tint.inputs["Factor"].default_value = 1.0
    tint.inputs["A"].default_value = (*colour, 1)
    nt.links.new(k.outputs[0], tint.inputs["B"])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["Factor"].default_value = 0.35
    nt.links.new(tint.outputs["Result"], mix.inputs["A"])
    nt.links.new(hue.outputs["Result"], mix.inputs["B"])
    return mix.outputs["Result"], bw.outputs["Val"]


def _blend(nt, base, layer, mask_sock, height, sharp=6.0, lift=0.0):
    """base where the mask is 0, layer where it is 1; the edge moved by the layer's height (height blending)."""
    a = nt.nodes.new("ShaderNodeMath")
    a.operation = "MULTIPLY_ADD"                # mask * 2 - 1 + (height - 0.5) * 0.8 ...
    a.inputs[1].default_value = 2.0
    a.inputs[2].default_value = -1.0 + lift
    nt.links.new(mask_sock, a.inputs[0])
    hb = nt.nodes.new("ShaderNodeMath")
    hb.operation = "MULTIPLY_ADD"
    hb.inputs[1].default_value = 0.8
    hb.inputs[2].default_value = -0.4
    nt.links.new(height, hb.inputs[0])
    s = nt.nodes.new("ShaderNodeMath")
    s.operation = "ADD"
    nt.links.new(a.outputs[0], s.inputs[0])
    nt.links.new(hb.outputs[0], s.inputs[1])
    f = nt.nodes.new("ShaderNodeMath")
    f.operation = "MULTIPLY_ADD"
    f.inputs[1].default_value = sharp
    f.inputs[2].default_value = 0.5
    f.use_clamp = True
    nt.links.new(s.outputs[0], f.inputs[0])
    m = nt.nodes.new("ShaderNodeMix")
    m.data_type = "RGBA"
    nt.links.new(f.outputs[0], m.inputs["Factor"])
    nt.links.new(base, m.inputs["A"])
    nt.links.new(layer, m.inputs["B"])
    return m.outputs["Result"], f.outputs[0]


GRASS = (0.075, 0.115, 0.04)       # linear albedo: a calm, slightly dry green (AoE-like meadow, not saturated)
GRASS2 = (0.09, 0.12, 0.045)
EARTH = (0.13, 0.095, 0.06)
GRAVEL_C = (0.17, 0.15, 0.12)
BANK_C = (0.13, 0.1, 0.07)


def build(root, seed=3):
    """The ground plane, the water, the tufts and pebbles under root."""
    M = masks()
    imgs = {k: _mask_image(f"r7_mask_{k}", v) for k, v in M.items()}
    bpy.ops.mesh.primitive_plane_add(size=1.0)
    plane = bpy.context.active_object
    plane.name = "r7_ground"
    plane.scale = (W_M, D_M, 1)
    bpy.ops.object.transform_apply(scale=True)
    plane.parent = root
    m = bpy.data.materials.new("r7_ground")
    m.use_nodes = True
    nt = m.node_tree
    p = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    p.inputs["Roughness"].default_value = 0.95
    tc = nt.nodes.new("ShaderNodeTexCoord")
    obj = tc.outputs["Object"]
    uv = tc.outputs["UV"]
    sock = {}
    for k, img in imgs.items():
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = img
        n.interpolation = "Cubic"
        n.extension = "EXTEND"
        nt.links.new(uv, n.inputs["Vector"])
        sock[k] = n.outputs["Color"]
    g1, h1 = _tex_layer(nt, obj, "leafy_grass", GRASS, 1.0)
    g2, h2 = _tex_layer(nt, obj, "aerial_grass_rock", GRASS2, 0.7)
    big = nt.nodes.new("ShaderNodeTexNoise")
    big.inputs["Scale"].default_value = 0.12
    nt.links.new(obj, big.inputs["Vector"])
    gm = nt.nodes.new("ShaderNodeMix")
    gm.data_type = "RGBA"
    nt.links.new(big.outputs["Fac"], gm.inputs["Factor"])
    nt.links.new(g1, gm.inputs["A"])
    nt.links.new(g2, gm.inputs["B"])
    base = gm.outputs["Result"]
    dirt, hd = _tex_layer(nt, obj, "stony_dirt_path", EARTH, 1.0, 0.35)
    grav, hg = _tex_layer(nt, obj, "gravel_ground_01", GRAVEL_C, 0.6)
    bank, hb = _tex_layer(nt, obj, "brown_mud_rocks_01", BANK_C, 1.0, 0.4)
    base, _ = _blend(nt, base, bank, sock["bank"], hb, sharp=5)
    base, _ = _blend(nt, base, dirt, sock["road"], hd, sharp=5)
    base, _ = _blend(nt, base, grav, sock["gravel"], hg, sharp=6)
    nt.links.new(base, p.inputs["Base Color"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    bump.inputs["Distance"].default_value = 0.02
    hsum = nt.nodes.new("ShaderNodeMath")
    hsum.operation = "ADD"
    nt.links.new(h1, hsum.inputs[0])
    nt.links.new(hd, hsum.inputs[1])
    nt.links.new(hsum.outputs[0], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], p.inputs["Normal"])
    plane.data.materials.append(m)
    _water(root, M["water"])
    _scatter(root, M, seed)
    return plane


def _water(root, water):
    """A sheet of water over the river part of the patch (its mask as the alpha), a hair above the ground."""
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0, 0, 0.03))
    w = bpy.context.active_object
    w.name = "r7_water"
    w.scale = (W_M, D_M, 1)
    bpy.ops.object.transform_apply(scale=True)
    w.parent = root
    m = bpy.data.materials.new("r7_water")
    m.use_nodes = True
    nt = m.node_tree
    p = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    p.inputs["Base Color"].default_value = (0.012, 0.026, 0.028, 1)
    # smooth: the sun stands north of the camera, a rough surface spread its reflection over the whole river
    p.inputs["Roughness"].default_value = 0.05
    p.inputs["IOR"].default_value = 1.33
    out = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeOutputMaterial")
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = bpy.data.images["r7_mask_water"]
    n.extension = "EXTEND"
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nt.links.new(tc.outputs["UV"], n.inputs["Vector"])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(n.outputs["Color"], mix.inputs["Fac"])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(p.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    ripple = nt.nodes.new("ShaderNodeTexNoise")
    ripple.inputs["Scale"].default_value = 3.0
    nt.links.new(tc.outputs["Object"], ripple.inputs["Vector"])
    b = nt.nodes.new("ShaderNodeBump")
    b.inputs["Strength"].default_value = 0.15
    nt.links.new(ripple.outputs["Fac"], b.inputs["Height"])
    nt.links.new(b.outputs["Normal"], p.inputs["Normal"])
    w.data.materials.append(m)


def _scatter(root, M, seed):
    """Tufts of grass on the grass, pebbles on the road and gravel, stones along the bank."""
    rnd = random.Random(seed)
    tuft = lib.mat("r7_tuft", (0.11, 0.16, 0.05), 0.8, sheen=0.3)
    tuft2 = lib.mat("r7_tuft2", (0.16, 0.17, 0.07), 0.85, sheen=0.3)
    stone = lib.mat("r7_pebble", (0.2, 0.19, 0.17), 0.85)
    h, w = M["road"].shape

    def at(x, y, k):
        i = min(h - 1, max(0, int((D_M / 2 - y) * PX)))
        j = min(w - 1, max(0, int((x + W_M / 2) * PX)))
        return M[k][i, j]
    n = 0
    for _ in range(900):
        x, y = rnd.uniform(-W_M / 2, W_M / 2), rnd.uniform(-D_M / 2, D_M / 2)
        if at(x, y, "water") > 0.1:
            continue
        open_ = 1 - max(at(x, y, "road"), at(x, y, "gravel"), at(x, y, "bank"))
        if open_ > 0.8 and rnd.random() < 0.55:
            m = tuft if rnd.random() < 0.6 else tuft2
            s = rnd.uniform(0.7, 1.3)
            for b in range(rnd.randint(8, 14)):
                a = rnd.uniform(0, 2 * math.pi)
                r = rnd.uniform(0, 0.12 * s)
                lib.cyl(f"r7_tuft{n}_{b}", 0.016 * s, rnd.uniform(0.08, 0.18) * s, m, root,
                        loc=(x + r * math.cos(a), y + r * math.sin(a), 0.0), r2=0.001, segs=4,
                        rot=(rnd.uniform(-25, 25), rnd.uniform(-25, 25), 0), outline=False)
            n += 1
        elif open_ < 0.5 and rnd.random() < 0.5:
            for b in range(rnd.randint(1, 3)):
                lib.ico(f"r7_peb{n}_{b}", rnd.uniform(0.03, 0.09), stone, root,
                        loc=(x + rnd.uniform(-0.15, 0.15), y + rnd.uniform(-0.15, 0.15), 0.015), subdiv=1,
                        scale=(1, rnd.uniform(0.7, 1.0), 0.55), outline=False)
            n += 1
    return n
