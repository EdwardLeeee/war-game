"""R7 (D-092) version 1 and the shared look of versions 1-3: the existing models' flat materials turned into textured
ones (CC0, design/r7/common/textures.py), the bevels and the grime of a real building, and the one light rig every
version is rendered with.

Materials: each lib.mat material is matched to a texture by its name (MATCH). The colour stays the design's colour:
the texture's brightness (divided by its mean, so the mean colour is unchanged) multiplies it, with a little of the
texture's own hue; its roughness map moves the material's roughness by up to +/- 0.2; its brightness is the bump.
Coordinates: a box projection in the object's space (a skinned body's rest position, so the cloth does not slide
over a moving body); this stands in for an unwrapped UV and has no seams.

Light: the same sun as the sprites (direction), now neutral white and a little softer, a cool fill from the other
side without shadows, the rim light from behind, a sky-coloured world; Cycles' bounces give the contact shadows
(ambient occlusion). No outlines.
"""
import math

import bpy

import lib

TEX = {}                    # texture id -> {"diff": path, "nor_gl": path, "rough": path}
SIZE = {"rough_linen": 0.27, "hessian_230": 0.27, "brown_leather": 0.4, "fabric_leather_02": 0.5, "metal_plate": 0.5,
        "rusty_metal_02": 1.0, "fine_grained_wood": 0.6, "medieval_wood": 2.0, "old_planks_02": 2.0,
        "castle_brick_01": 1.5, "clay_plaster": 2.0, "thatch_roof_angled": 0.54, "clay_roof_tiles_02": 2.5,
        "leafy_grass": 2.0, "aerial_grass_rock": 15.0, "stony_dirt_path": 2.17, "gravel_ground_01": 3.0,
        "brown_mud_rocks_01": 1.3}
# the texture's mean linear colour (common/textures.py, measured 2026-10-20): the brightness is divided by it
MEAN = {"rough_linen": (0.284, 0.408, 0.613), "hessian_230": (0.264, 0.189, 0.101), "brown_leather": (0.082, 0.027, 0.005),
        "fabric_leather_02": (0.22, 0.076, 0.011), "metal_plate": (0.049, 0.033, 0.012), "rusty_metal_02": (0.412, 0.287, 0.133),
        "fine_grained_wood": (0.055, 0.03, 0.015), "medieval_wood": (0.18, 0.144, 0.113), "old_planks_02": (0.122, 0.091, 0.063),
        "castle_brick_01": (0.254, 0.196, 0.121), "clay_plaster": (0.169, 0.102, 0.045), "thatch_roof_angled": (0.091, 0.081, 0.068),
        "clay_roof_tiles_02": (0.305, 0.084, 0.026), "leafy_grass": (0.313, 0.23, 0.102), "aerial_grass_rock": (0.169, 0.121, 0.025),
        "stony_dirt_path": (0.068, 0.039, 0.02), "gravel_ground_01": (0.29, 0.228, 0.141), "brown_mud_rocks_01": (0.088, 0.066, 0.04)}
# lib.mat name (without its round suffix) -> (texture, scale factor on its size, hue mix, bump strength)
MATCH = {
    # cloth
    "indigo": ("rough_linen", 1.0, 0.1, 0.25), "darkcloth": ("rough_linen", 1.0, 0.1, 0.25),
    "cream": ("rough_linen", 1.0, 0.1, 0.25), "tassel": ("rough_linen", 0.6, 0.05, 0.2),
    "robe": ("rough_linen", 1.0, 0.1, 0.25), "linen": ("rough_linen", 1.0, 0.1, 0.25),
    "russet": ("rough_linen", 1.0, 0.1, 0.25), "ochre": ("rough_linen", 1.0, 0.1, 0.25),
    "moss": ("rough_linen", 1.0, 0.1, 0.25), "gambeson": ("hessian_230", 1.0, 0.1, 0.35),
    "hemp": ("hessian_230", 1.0, 0.15, 0.35), "sack": ("hessian_230", 1.0, 0.2, 0.35),
    "canvas": ("hessian_230", 1.5, 0.1, 0.3), "target": ("hessian_230", 1.5, 0.1, 0.3),
    "team": ("rough_linen", 1.0, 0.0, 0.25), "rope": ("hessian_230", 0.5, 0.2, 0.3),
    "feather": ("rough_linen", 0.4, 0.0, 0.1),
    # leather
    "leather": ("fabric_leather_02", 1.0, 0.15, 0.3), "boots": ("brown_leather", 1.0, 0.1, 0.3),
    "strap": ("brown_leather", 1.0, 0.1, 0.3), "lacquer": ("fabric_leather_02", 0.8, 0.05, 0.2),
    # metal
    "bronze": ("metal_plate", 1.0, 0.0, 0.25), "steel": ("metal_plate", 1.0, 0.0, 0.25),
    "mail": ("rusty_metal_02", 0.25, 0.05, 0.6), "gold": ("metal_plate", 1.0, 0.0, 0.2),
    "iron": ("rusty_metal_02", 0.6, 0.15, 0.35),
    # wood
    "wood": ("medieval_wood", 0.6, 0.2, 0.3), "wooddark": ("medieval_wood", 0.6, 0.2, 0.3),
    "shaft": ("fine_grained_wood", 0.5, 0.15, 0.2), "timber": ("medieval_wood", 1.0, 0.2, 0.35),
    "lattice": ("fine_grained_wood", 0.6, 0.1, 0.2), "red_post": ("fine_grained_wood", 1.0, 0.05, 0.25),
    "logend": ("medieval_wood", 0.5, 0.2, 0.3), "bark": ("medieval_wood", 0.5, 0.2, 0.5),
    # stone, plaster, roofs, earth
    "stone": ("castle_brick_01", 1.0, 0.2, 0.6), "brick": ("castle_brick_01", 1.0, 0.25, 0.6),
    "pave": ("castle_brick_01", 1.2, 0.2, 0.5), "rock": ("castle_brick_01", 1.0, 0.2, 0.6),
    "plaster": ("clay_plaster", 1.0, 0.05, 0.3), "paper": ("clay_plaster", 0.5, 0.0, 0.1),
    "thatch": ("thatch_roof_angled", 1.0, 0.25, 0.6), "straw": ("thatch_roof_angled", 1.0, 0.25, 0.5),
    "strawdark": ("thatch_roof_angled", 1.0, 0.25, 0.5), "hay": ("thatch_roof_angled", 1.0, 0.25, 0.5),
    "tile": ("clay_roof_tiles_02", 0.6, 0.0, 0.6), "ridge": ("clay_roof_tiles_02", 0.6, 0.0, 0.5),
    "roof_ridge": ("clay_roof_tiles_02", 0.6, 0.0, 0.5), "earth": ("stony_dirt_path", 1.0, 0.3, 0.4),
}


def key_of(name):
    """lib.mat name -> MATCH key: the name without its round suffix (2, 5, _b1, _e) and any .001."""
    n = name.split(".")[0]
    for suf in ("_b1", "_e", "2", "5"):
        if n.endswith(suf) and n[: -len(suf)] in MATCH:
            return n[: -len(suf)]
    return n if n in MATCH else None


def _img(path, colour):
    im = bpy.data.images.load(path, check_existing=True)
    im.colorspace_settings.name = "sRGB" if colour else "Non-Color"
    return im


def texture(m, tid, colour, rough, scale=1.0, hue=0.1, bump=0.3, coords=None, dirt=0.0, contrast=0.7):
    """Rebuild material m with texture tid tinted to colour (linear RGB)."""
    nt = m.node_tree
    p = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    for n in list(nt.nodes):
        if n not in (p,) and n.bl_idname not in ("ShaderNodeOutputMaterial",):
            nt.nodes.remove(n)
    if coords:
        src = nt.nodes.new("ShaderNodeAttribute")
        src.attribute_name = coords
        vec = src.outputs["Vector"]
    else:
        tc = nt.nodes.new("ShaderNodeTexCoord")
        vec = tc.outputs["Object"]
    mp = nt.nodes.new("ShaderNodeMapping")
    s = 1.0 / (SIZE[tid] * scale)
    mp.inputs["Scale"].default_value = (s, s, s)
    nt.links.new(vec, mp.inputs["Vector"])
    t = {}
    for k, col in (("diff", True), ("rough", False)):
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = _img(TEX[tid][k], col)
        n.projection = "BOX"
        n.projection_blend = 0.25
        nt.links.new(mp.outputs["Vector"], n.inputs["Vector"])
        t[k] = n
    mean = MEAN[tid]
    lum_mean = 0.2126 * mean[0] + 0.7152 * mean[1] + 0.0722 * mean[2]
    bw = nt.nodes.new("ShaderNodeRGBToBW")
    nt.links.new(t["diff"].outputs["Color"], bw.inputs["Color"])
    k = nt.nodes.new("ShaderNodeMath")
    k.operation = "DIVIDE"
    k.inputs[1].default_value = max(lum_mean, 1e-3)
    nt.links.new(bw.outputs["Val"], k.inputs[0])
    c = nt.nodes.new("ShaderNodeMath")              # the texture's light and dark at `contrast` of its own
    c.operation = "MULTIPLY_ADD"
    c.inputs[1].default_value = contrast
    c.inputs[2].default_value = 1 - contrast
    nt.links.new(k.outputs[0], c.inputs[0])
    k = c
    tint = nt.nodes.new("ShaderNodeMix")
    tint.name = "r7_tint"
    tint.data_type = "RGBA"
    tint.blend_type = "MULTIPLY"
    tint.inputs["Factor"].default_value = 1.0
    tint.inputs["A"].default_value = (*colour, 1.0)
    nt.links.new(k.outputs[0], tint.inputs["B"])
    # a little of the texture's own hue, scaled to the design's colour
    hue_n = nt.nodes.new("ShaderNodeMix")
    hue_n.name = "r7_hue"
    hue_n.data_type = "RGBA"
    hue_n.blend_type = "MULTIPLY"
    hue_n.inputs["Factor"].default_value = 1.0
    hue_n.inputs["A"].default_value = (*[c / max(mm, 1e-3) for c, mm in zip(colour, mean)], 1.0)
    nt.links.new(t["diff"].outputs["Color"], hue_n.inputs["B"])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["Factor"].default_value = hue
    nt.links.new(tint.outputs["Result"], mix.inputs["A"])
    nt.links.new(hue_n.outputs["Result"], mix.inputs["B"])
    out = mix.outputs["Result"]
    if dirt:
        # grime toward the ground: earth colour up to `dirt` strength at z = 0, gone by 0.9 m (world height)
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(geo.outputs["Position"], sep.inputs["Vector"])
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.inputs["From Min"].default_value = 0.0
        mr.inputs["From Max"].default_value = 0.9
        mr.inputs["To Min"].default_value = dirt
        mr.inputs["To Max"].default_value = 0.0
        nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
        g = nt.nodes.new("ShaderNodeMix")
        g.data_type = "RGBA"
        g.blend_type = "MULTIPLY"
        g.inputs["B"].default_value = (0.42, 0.33, 0.22, 1.0)
        nt.links.new(mr.outputs["Result"], g.inputs["Factor"])
        nt.links.new(out, g.inputs["A"])
        out = g.outputs["Result"]
    nt.links.new(out, p.inputs["Base Color"])
    r = nt.nodes.new("ShaderNodeMapRange")
    r.inputs["To Min"].default_value = max(0.05, rough - 0.2)
    r.inputs["To Max"].default_value = min(1.0, rough + 0.2)
    nt.links.new(t["rough"].outputs["Color"], r.inputs["Value"])
    nt.links.new(r.outputs["Result"], p.inputs["Roughness"])
    b = nt.nodes.new("ShaderNodeBump")
    b.inputs["Strength"].default_value = bump
    b.inputs["Distance"].default_value = 0.01 * SIZE[tid] * scale
    nt.links.new(bw.outputs["Val"], b.inputs["Height"])
    nt.links.new(b.outputs["Normal"], p.inputs["Normal"])


def realistic(tex, dirt=0.0, skinned_attr=None):
    """Every lib.mat material that MATCH knows, textured. tex: textures.path-like function (tid, map) -> path."""
    for tid in SIZE:
        TEX[tid] = {k: str(tex(tid, k)) for k in ("diff", "rough", "nor_gl")}
    done = 0
    for name, info in list(lib.MATS.items()):
        k = key_of(name)
        if k is None or info.get("kind") not in ("solid", "team", None):
            continue
        tid, sc, hue, bump = MATCH[k]
        m = info["mat"]
        colour = info.get("color", (0.5, 0.5, 0.5))
        texture(m, tid, colour, info.get("rough", 0.7) or 0.7, sc, hue, bump, coords=skinned_attr, dirt=dirt)
        p = next(n for n in m.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
        p.inputs["Metallic"].default_value = info.get("metal", 0.0) or 0.0
        done += 1
    return done


def rest_coords(skinners, name="rest"):
    """Store each skinned mesh's rest position as an attribute, for its texture to stay put on the cloth."""
    import numpy as np
    for sk in skinners:
        me = sk.obj.data
        a = me.attributes.get(name) or me.attributes.new(name, "FLOAT_VECTOR", "POINT")
        a.data.foreach_set("vector", sk.rest.astype(np.float32).ravel())


def bevel_all(objs, width=0.025):
    """A small rounded edge on every hard-edged part (real timber, stone and iron are never knife-sharp)."""
    for ob in objs:
        if ob.type != "MESH" or any(m.type == "BEVEL" for m in ob.modifiers):
            continue
        m = ob.modifiers.new("r7_bevel", "BEVEL")
        m.width = width
        m.segments = 2
        m.limit_method = "ANGLE"
        m.angle_limit = math.radians(40)
        m.harden_normals = False


def lights():
    """The R7 rig (versions 1-3): the sprites' sun direction, neutral and softer; a cool fill with no shadow from the
    other side; the rim light; a sky world."""
    for ob in list(lib.LIGHTS.values()):
        ob.hide_render = True
    sc = bpy.context.scene
    sun = lib.LIGHTS["warm"]
    sun.hide_render = False
    sun.data.energy = 4.2
    sun.data.color = (1.0, 0.95, 0.88)
    sun.data.angle = math.radians(3)
    rim = lib.LIGHTS["rim"]
    rim.hide_render = False
    rim.data.energy = 1.4
    fd = bpy.data.lights.new("r7_fill", "SUN")
    fd.energy = 0.7
    fd.color = (0.78, 0.86, 1.0)
    fd.use_shadow = False
    fo = bpy.data.objects.new("r7_fill", fd)
    e = sun.rotation_euler
    fo.rotation_euler = (math.radians(55), 0, e.z + math.pi)
    sc.collection.objects.link(fo)
    lib.world_color((0.62, 0.72, 0.88), 0.38)          # the sky lower than the sun: shadows read at phone size
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"     # Base Contrast read grey and hazy at phone size
    sc.cycles.max_bounces = 6
    sc.cycles.diffuse_bounces = 3
    sc.cycles.glossy_bounces = 2
    return fo
