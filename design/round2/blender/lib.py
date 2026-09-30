"""Blender-side helpers: primitives, materials, camera, render passes.

Runs inside Blender 5.2.2 (`blender -b --python ...`). Models are rigid parts
parented in a hierarchy; every part's origin is its joint, so posing is just
setting rotation_euler per frame before rendering (no keyframes, no armature).

Render passes (one model build, several renders per frame):
  beauty  B 立體微縮: full materials, warm sun + sky
  mask    team-colour parts white, everything else black (both B and C recolour)
  albedo  C 水墨戰卷: every material as flat emission of its base colour
  light   C: every material white diffuse under neutral light (toon source)
  shadow  ground shadow only (body invisible to camera, shadow catcher)
  fx      magic effects only, body as holdout (shield, sigil, bolt, shards)
"""
import math
import os

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

D2R = math.pi / 180

# ---------------------------------------------------------------- scene setup

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.max_bounces = 4
    sc.cycles.diffuse_bounces = 2
    sc.cycles.glossy_bounces = 1
    sc.cycles.transparent_max_bounces = 8
    sc.cycles.sample_clamp_indirect = 4.0
    sc.render.film_transparent = True
    sc.cycles.film_transparent_glass = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "8"
    sc.render.filter_size = 1.2
    # render in tiles so large building sprites stay far below the memory cap
    sc.cycles.use_auto_tile = True
    sc.cycles.tile_size = 256
    world = bpy.data.worlds.new("world")
    sc.world = world
    world.use_nodes = True
    return sc


def world_color(rgb, strength):
    w = bpy.context.scene.world
    bg = w.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (*rgb, 1)
    bg.inputs["Strength"].default_value = strength


class Camera:
    """Orthographic camera, 30 degrees above the horizon, looking north-east.

    Screen right = world south-east. px_per_m sets the art scale.
    anchor = pixel (from top-left) where the world origin lands.
    """

    def __init__(self, w, h, px_per_m, anchor):
        sc = bpy.context.scene
        cam_data = bpy.data.cameras.new("cam")
        cam_data.type = "ORTHO"
        self.obj = bpy.data.objects.new("cam", cam_data)
        sc.collection.objects.link(self.obj)
        sc.camera = self.obj
        self.set(w, h, px_per_m, anchor)

    def set(self, w, h, px_per_m, anchor):
        sc = bpy.context.scene
        sc.render.resolution_x = w
        sc.render.resolution_y = h
        sc.render.resolution_percentage = 100
        big = max(w, h)
        cd = self.obj.data
        cd.ortho_scale = big / px_per_m
        cd.shift_x = (w / 2 - anchor[0]) / big
        cd.shift_y = (anchor[1] - h / 2) / big
        cd.clip_start = 0.1
        cd.clip_end = 400
        rot = Euler((60 * D2R, 0, -45 * D2R))
        direction = rot.to_matrix() @ Vector((0, 0, -1))
        self.obj.rotation_euler = rot
        self.obj.location = -direction * 120


def heading_for(facing):
    """Z rotation for a model built facing +Y to face screen direction `facing`."""
    return (45 * facing - 135) * D2R


# ---------------------------------------------------------------- lights

LIGHTS = {}


def make_lights():
    """Two rigs: warm golden sun for B, neutral sun for the C light pass."""
    sc = bpy.context.scene
    for key, (energy, color, angle) in {
        "warm": (4.2, (1.0, 0.86, 0.68), 6),
        "neutral": (3.6, (1, 1, 1), 3),
    }.items():
        ld = bpy.data.lights.new(key, "SUN")
        ld.energy = energy
        ld.color = color
        ld.angle = angle * D2R
        ob = bpy.data.objects.new(key, ld)
        # high sun; shadows fall toward the lower right of the screen (world south)
        ob.rotation_euler = Euler((32 * D2R, 0, 180 * D2R))
        sc.collection.objects.link(ob)
        LIGHTS[key] = ob
    make_rim()


def make_rim():
    """Cool back light for B: a thin bright edge that lifts dark units off the ground."""
    sc = bpy.context.scene
    ld = bpy.data.lights.new("rim", "SUN")
    ld.energy = 2.2
    ld.color = (0.82, 0.9, 1.0)
    ld.angle = 4 * D2R
    ob = bpy.data.objects.new("rim", ld)
    ob.rotation_euler = Euler((65 * D2R, 0, 135 * D2R))   # from behind the units, toward the camera
    sc.collection.objects.link(ob)
    LIGHTS["rim"] = ob


def use_lights(key):
    for k, ob in LIGHTS.items():
        ob.hide_render = not (k == key or (k == "rim" and key == "warm"))
    if key == "warm":
        world_color((0.55, 0.66, 0.85), 0.55)
    else:
        world_color((1, 1, 1), 0.45)


# ---------------------------------------------------------------- materials

QUALITY = "r1"     # "r1": R1 settings; "hq": R2 option A and up (more samples, AO layer)
MATS = {}          # name -> dict(kind, color, mat)
TEAM_GRAY = 0.72   # albedo of team-coloured parts before recolouring


def _bsdf(mat):
    return next(n for n in mat.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")


def mat(name, color=(0.8, 0.8, 0.8), rough=0.7, metal=0.0, kind="solid", noise=0.0,
        noise_scale=18.0, emission=0.0, sheen=0.0, pattern=None, pattern_scale=1.0):
    """Create (once) a material. kind: solid | team | emit | hull | fx."""
    if name in MATS:
        return MATS[name]["mat"]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = _bsdf(m)
    if kind == "team":
        color = (TEAM_GRAY, TEAM_GRAY, TEAM_GRAY)
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if sheen:
        p.inputs["Sheen Weight"].default_value = sheen
    if emission:
        p.inputs["Emission Color"].default_value = (*color, 1)
        p.inputs["Emission Strength"].default_value = emission
    if noise:
        # subtle value variation: multiplies base colour by 1 +/- noise
        tex = nt.nodes.new("ShaderNodeTexNoise")
        tex.inputs["Scale"].default_value = noise_scale
        tex.inputs["Detail"].default_value = 6
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = (*[c * (1 - noise) for c in color], 1)
        ramp.color_ramp.elements[1].color = (*[min(1, c * (1 + noise)) for c in color], 1)
        nt.links.new(tex.outputs["Factor"], ramp.inputs["Factor"])
        nt.links.new(ramp.outputs["Color"], p.inputs["Base Color"])
        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.25
        nt.links.new(tex.outputs["Factor"], bump.inputs["Height"])
        nt.links.new(bump.outputs["Normal"], p.inputs["Normal"])
    if pattern:
        _pattern(nt, p, color, pattern, pattern_scale)
    MATS[name] = dict(kind=kind, color=color, mat=m, rough=rough, metal=metal, emission=emission)
    return m


def _pattern(nt, p, color, pattern, scale):
    """Brick courses on walls (x, z) or tile channels on roofs (along x)."""
    co = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    nt.links.new(co.outputs["Object"], mp.inputs["Vector"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.6
    if pattern == "lamellar":
        # small overlapping plates laced in rows (x, z on the object)
        mp.inputs["Rotation"].default_value = (math.pi / 2, 0, 0)
        br = nt.nodes.new("ShaderNodeTexBrick")
        br.inputs["Scale"].default_value = scale
        br.inputs["Mortar Size"].default_value = 0.035
        for key_, val in (("Brick Width", 0.35), ("Row Height", 0.5)):
            if key_ in br.inputs:
                br.inputs[key_].default_value = val
        br.inputs["Color1"].default_value = (*color, 1)
        br.inputs["Color2"].default_value = (*[c * 0.85 for c in color], 1)
        br.inputs["Mortar"].default_value = (*[c * 0.35 for c in color], 1)
        br.offset = 0.5
        nt.links.new(mp.outputs["Vector"], br.inputs["Vector"])
        nt.links.new(br.outputs["Color"], p.inputs["Base Color"])
        nt.links.new(br.outputs["Fac"], bump.inputs["Height"])
        bump.inputs["Strength"].default_value = 0.8
    elif pattern == "cloth":
        wv = nt.nodes.new("ShaderNodeTexWave")
        wv.wave_type = "BANDS"
        wv.inputs["Scale"].default_value = scale
        wv.inputs["Distortion"].default_value = 2.0
        wv.inputs["Detail"].default_value = 3
        nt.links.new(mp.outputs["Vector"], wv.inputs["Vector"])
        nt.links.new(wv.outputs["Factor"], bump.inputs["Height"])
        bump.inputs["Strength"].default_value = 0.35
    elif pattern == "worn_metal":
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.5
        ramp.color_ramp.elements[0].color = (*color, 1)
        ramp.color_ramp.elements[1].position = 0.56
        ramp.color_ramp.elements[1].color = (*[min(1, c * 1.6 + 0.12) for c in color], 1)
        nt.links.new(geo.outputs["Pointiness"], ramp.inputs["Factor"])
        nt.links.new(ramp.outputs["Color"], p.inputs["Base Color"])
        tex = nt.nodes.new("ShaderNodeTexNoise")
        tex.inputs["Scale"].default_value = 60
        nt.links.new(tex.outputs["Factor"], bump.inputs["Height"])
        bump.inputs["Strength"].default_value = 0.15
    elif pattern in ("brick", "block"):
        mp.inputs["Rotation"].default_value = (math.pi / 2, 0, 0)   # (x, z) -> texture (x, y)
        br = nt.nodes.new("ShaderNodeTexBrick")
        br.inputs["Scale"].default_value = scale
        br.inputs["Mortar Size"].default_value = 0.025
        br.inputs["Color1"].default_value = (*color, 1)
        br.inputs["Color2"].default_value = (*[c * 0.82 for c in color], 1)
        br.inputs["Mortar"].default_value = (*[c * 0.55 for c in color], 1)
        br.offset = 0.5
        br.squash = 1.0
        nt.links.new(mp.outputs["Vector"], br.inputs["Vector"])
        nt.links.new(br.outputs["Color"], p.inputs["Base Color"])
        nt.links.new(br.outputs["Fac"], bump.inputs["Height"])
    else:  # tiles: channels running down the slope, repeating along x
        wv = nt.nodes.new("ShaderNodeTexWave")
        wv.wave_type = "BANDS"
        wv.bands_direction = "X"
        wv.inputs["Scale"].default_value = scale
        wv.inputs["Distortion"].default_value = 0.5
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = (*[c * 0.7 for c in color], 1)
        ramp.color_ramp.elements[1].color = (*[min(1, c * 1.25) for c in color], 1)
        nt.links.new(mp.outputs["Vector"], wv.inputs["Vector"])
        nt.links.new(wv.outputs["Factor"], ramp.inputs["Factor"])
        nt.links.new(ramp.outputs["Color"], p.inputs["Base Color"])
        nt.links.new(wv.outputs["Factor"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], p.inputs["Normal"])


def fx_mat(name, color, strength=4.0, alpha=1.0, fresnel=False, hex_pattern=False):
    """Emissive, see-through effect material (shield, sigil, bolt)."""
    if name in MATS:
        return MATS[name]["mat"]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.bl_idname != "ShaderNodeOutputMaterial":
            nt.nodes.remove(n)
    out = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*color, 1)
    em.inputs["Strength"].default_value = strength
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(tr.outputs["BSDF"], mix.inputs[1])
    nt.links.new(em.outputs["Emission"], mix.inputs[2])
    # factor = alpha * (base + fresnel rim + hex lines)
    val = nt.nodes.new("ShaderNodeValue")
    val.outputs[0].default_value = alpha
    val.name = "alpha"
    fac = val.outputs[0]
    if fresnel or hex_pattern:
        add = nt.nodes.new("ShaderNodeMath")
        add.operation = "ADD"
        add.inputs[0].default_value = 0.035
        add.inputs[1].default_value = 0.0
        if fresnel:
            lw = nt.nodes.new("ShaderNodeLayerWeight")
            lw.inputs["Blend"].default_value = 0.35
            pw = nt.nodes.new("ShaderNodeMath")
            pw.operation = "POWER"
            pw.inputs[1].default_value = 2.2
            nt.links.new(lw.outputs["Facing"], pw.inputs[0])
            nt.links.new(pw.outputs[0], add.inputs[1])
        if hex_pattern:
            vor = nt.nodes.new("ShaderNodeTexVoronoi")
            vor.feature = "DISTANCE_TO_EDGE"
            vor.inputs["Scale"].default_value = 7.0
            co = nt.nodes.new("ShaderNodeTexCoord")
            nt.links.new(co.outputs["Object"], vor.inputs["Vector"])
            lt = nt.nodes.new("ShaderNodeMath")
            lt.operation = "LESS_THAN"
            lt.inputs[1].default_value = 0.035
            nt.links.new(vor.outputs["Distance"], lt.inputs[0])
            sc = nt.nodes.new("ShaderNodeMath")
            sc.operation = "MULTIPLY"
            sc.inputs[1].default_value = 0.32
            nt.links.new(lt.outputs[0], sc.inputs[0])
            add2 = nt.nodes.new("ShaderNodeMath")
            add2.operation = "ADD"
            nt.links.new(add.outputs[0], add2.inputs[0])
            nt.links.new(sc.outputs[0], add2.inputs[1])
            add = add2
        mul = nt.nodes.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        mul.use_clamp = True
        nt.links.new(add.outputs[0], mul.inputs[0])
        nt.links.new(val.outputs[0], mul.inputs[1])
        fac = mul.outputs[0]
    nt.links.new(fac, mix.inputs["Factor"])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    MATS[name] = dict(kind="fx", color=color, mat=m, strength=strength)
    return m


def set_fx(name, alpha=None, strength=None, color=None):
    m = MATS[name]["mat"]
    nt = m.node_tree
    if alpha is not None:
        nt.nodes["alpha"].outputs[0].default_value = alpha
    em = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeEmission")
    if strength is not None:
        em.inputs["Strength"].default_value = strength
    if color is not None:
        em.inputs["Color"].default_value = (*color, 1)


def flag_mat(name, image_path, rough=0.85):
    """Team-coloured cloth with a white emblem image (UV from `slab`)."""
    if name in MATS:
        return MATS[name]["mat"]
    img = bpy.data.images.load(image_path, check_existing=True)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = _bsdf(m)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.extension = "CLIP"
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs[6].default_value = (TEAM_GRAY, TEAM_GRAY, TEAM_GRAY, 1)
    mix.inputs[7].default_value = (0.92, 0.92, 0.9, 1)
    nt.links.new(tex.outputs["Alpha"], mix.inputs[0])
    nt.links.new(mix.outputs[2], p.inputs["Base Color"])
    p.inputs["Roughness"].default_value = rough
    MATS[name] = dict(kind="flag", color=(TEAM_GRAY,) * 3, mat=m, image=img)
    return m


def _flag_override(key, image, mode):
    """mask: 1 - emblem alpha; albedo: team grey / white by alpha."""
    k = f"{mode}_{key}"
    if k in _OVR:
        return _OVR[k]
    m = bpy.data.materials.new("ovr_" + k)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.bl_idname != "ShaderNodeOutputMaterial":
            nt.nodes.remove(n)
    out = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeOutputMaterial")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    tex.extension = "CLIP"
    em = nt.nodes.new("ShaderNodeEmission")
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    if mode == "mask":
        mix.inputs[6].default_value = (1, 1, 1, 1)
        mix.inputs[7].default_value = (0, 0, 0, 1)
    else:
        mix.inputs[6].default_value = (TEAM_GRAY, TEAM_GRAY, TEAM_GRAY, 1)
        mix.inputs[7].default_value = (0.92, 0.92, 0.9, 1)
    nt.links.new(tex.outputs["Alpha"], mix.inputs[0])
    nt.links.new(mix.outputs[2], em.inputs["Color"])
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    _OVR[k] = m
    return m


# pass override materials, built lazily
_OVR = {}


def _emission_mat(key, color, strength=1.0):
    if key in _OVR:
        return _OVR[key]
    m = bpy.data.materials.new("ovr_" + key)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.bl_idname != "ShaderNodeOutputMaterial":
            nt.nodes.remove(n)
    out = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*color, 1)
    em.inputs["Strength"].default_value = strength
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    _OVR[key] = m
    return m


def _ao_mat():
    """Ambient occlusion as a grey emission: crevices dark, open surfaces white."""
    if "ao" in _OVR:
        return _OVR["ao"]
    m = bpy.data.materials.new("ovr_ao")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.bl_idname != "ShaderNodeOutputMaterial":
            nt.nodes.remove(n)
    out = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeOutputMaterial")
    ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
    ao.inputs["Distance"].default_value = 0.25
    ao.samples = 16
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(ao.outputs["AO"], em.inputs["Color"])
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    _OVR["ao"] = m
    return m


def _white_diffuse():
    if "white" in _OVR:
        return _OVR["white"]
    m = bpy.data.materials.new("ovr_white")
    m.use_nodes = True
    p = _bsdf(m)
    p.inputs["Base Color"].default_value = (0.8, 0.8, 0.8, 1)
    p.inputs["Roughness"].default_value = 1.0
    p.inputs["Specular IOR Level"].default_value = 0.0
    _OVR["white"] = m
    return m


# ---------------------------------------------------------------- geometry

ALL_PARTS = []     # every mesh object belonging to the model (for passes)
FX_PARTS = []      # effect objects
HULLS = []         # inverted-hull outline objects (C only)
GROUND = None


def _mesh_obj(name, bm, material, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), smooth=True,
              fx=False, outline=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for poly in me.polygons:
            poly.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(material)
    if parent is not None:
        ob.parent = parent
    ob.location = loc
    ob.rotation_euler = Euler([a * D2R for a in rot])
    if fx:
        FX_PARTS.append(ob)
    else:
        ALL_PARTS.append(ob)
        if outline:
            _add_hull(ob)
    return ob


def empty(name, parent=None, loc=(0, 0, 0), rot=(0, 0, 0)):
    ob = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    ob.location = loc
    ob.rotation_euler = Euler([a * D2R for a in rot])
    return ob


HULL_WIDTH = 0.028   # metres of outline thickness for the C pass


def _add_hull(ob):
    mod = ob.modifiers.new("hull", "SOLIDIFY")
    mod.thickness = HULL_WIDTH
    mod.offset = 1.0
    mod.use_flip_normals = True
    mod.use_rim = False
    mod.material_offset = 1
    mod.show_render = False
    HULLS.append(ob)


def _hull_mat():
    if "hull" in _OVR:
        return _OVR["hull"]
    m = bpy.data.materials.new("ovr_hull")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.bl_idname != "ShaderNodeOutputMaterial":
            nt.nodes.remove(n)
    out = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeOutputMaterial")
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (0.035, 0.03, 0.03, 1)
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    # flipped shell: show only the faces seen from behind (the rim)
    nt.links.new(geo.outputs["Backfacing"], mix.inputs["Factor"])
    nt.links.new(em.outputs[0], mix.inputs[1])
    nt.links.new(tr.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    _OVR["hull"] = m
    return m


def _xform(bm, scale=(1, 1, 1), rot=(0, 0, 0), loc=(0, 0, 0)):
    m = (Matrix.Translation(Vector(loc)) @ Euler([a * D2R for a in rot]).to_matrix().to_4x4()
         @ Matrix.Diagonal((*scale, 1)))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)


def box(name, size, material, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), at=(0, 0, 0),
        bevel=0.0, taper=None, **kw):
    """Box of size (x, y, z). `at` offsets the mesh from the pivot."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    if taper:  # scale top face in x,y
        for v in bm.verts:
            if v.co.z > 0:
                v.co.x *= taper[0]
                v.co.y *= taper[1]
    _xform(bm, scale=size, loc=at)
    ob = _mesh_obj(name, bm, material, parent, loc, rot, smooth=False, **kw)
    if bevel:
        mod = ob.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "NONE"
        ob.modifiers.move(len(ob.modifiers) - 1, 0)
    return ob


def cyl(name, r, h, material, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), at=(0, 0, 0),
        r2=None, segs=16, scale=(1, 1, 1), smooth=True, **kw):
    """Cylinder/cone along +Z from z=0 to z=h (then offset by `at`)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs,
                          radius1=r, radius2=r if r2 is None else r2, depth=h)
    _xform(bm, loc=(0, 0, h / 2))
    _xform(bm, scale=scale, loc=at)
    return _mesh_obj(name, bm, material, parent, loc, rot, smooth=smooth, **kw)


def sphere(name, r, material, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), at=(0, 0, 0),
           scale=(1, 1, 1), segs=16, rings=10, **kw):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    _xform(bm, scale=scale, loc=at)
    return _mesh_obj(name, bm, material, parent, loc, rot, **kw)


def ico(name, r, material, parent=None, loc=(0, 0, 0), subdiv=2, scale=(1, 1, 1), at=(0, 0, 0),
        smooth=True, **kw):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    _xform(bm, scale=scale, loc=at)
    return _mesh_obj(name, bm, material, parent, loc, smooth=smooth, **kw)


def lathe(name, profile, material, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), segs=20,
          scale=(1, 1, 1), at=(0, 0, 0), cap=True, **kw):
    """Surface of revolution around Z. profile = [(radius, z), ...] bottom to top."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        ring = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
        rings.append(ring)
    for j in range(len(rings) - 1):
        for i in range(segs):
            a, b = rings[j][i], rings[j][(i + 1) % segs]
            c, d = rings[j + 1][(i + 1) % segs], rings[j + 1][i]
            bm.faces.new((a, b, c, d))
    if cap:
        if profile[0][0] > 1e-4:
            bm.faces.new(list(reversed(rings[0])))
        if profile[-1][0] > 1e-4:
            bm.faces.new(rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    _xform(bm, scale=scale, loc=at)
    return _mesh_obj(name, bm, material, parent, loc, rot, **kw)


def slab(name, pts, thick, material, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), plane="XZ",
         smooth=False, **kw):
    """Extrude a 2D polygon (list of (u, v)) by `thick`. plane XZ: u->x, v->z, thickness along y."""
    bm = bmesh.new()
    front, back = [], []
    for u, v in pts:
        if plane == "XZ":
            front.append(bm.verts.new((u, -thick / 2, v)))
            back.append(bm.verts.new((u, thick / 2, v)))
        elif plane == "YZ":
            front.append(bm.verts.new((-thick / 2, u, v)))
            back.append(bm.verts.new((thick / 2, u, v)))
        else:  # XY
            front.append(bm.verts.new((u, v, -thick / 2)))
            back.append(bm.verts.new((u, v, thick / 2)))
    n = len(pts)
    ff = bm.faces.new(front)
    fb = bm.faces.new(list(reversed(back)))
    for i in range(n):
        bm.faces.new((front[i], front[(i + 1) % n], back[(i + 1) % n], back[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # planar UV over the polygon's bounding box (for emblems); the back face mirrors
    us = [p[0] for p in pts]
    vs = [p[1] for p in pts]
    u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
    uv = bm.loops.layers.uv.new("uv")
    idx = {v: k for k, v in enumerate(front)}
    idx.update({v: k for k, v in enumerate(back)})
    for face in bm.faces:
        for loop in face.loops:
            k = idx[loop.vert]
            u = (pts[k][0] - u0) / max(1e-6, u1 - u0)
            if face is fb:
                u = 1 - u
            loop[uv].uv = (u, (pts[k][1] - v0) / max(1e-6, v1 - v0))
    return _mesh_obj(name, bm, material, parent, loc, rot, smooth=smooth, **kw)


def ring(name, r_in, r_out, material, parent=None, loc=(0, 0, 0), segs=48, **kw):
    """Flat annulus in the XZ plane (faces +Y)."""
    bm = bmesh.new()
    inner, outer = [], []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        inner.append(bm.verts.new((r_in * math.cos(a), 0, r_in * math.sin(a))))
        outer.append(bm.verts.new((r_out * math.cos(a), 0, r_out * math.sin(a))))
    for i in range(segs):
        bm.faces.new((inner[i], outer[i], outer[(i + 1) % segs], inner[(i + 1) % segs]))
    return _mesh_obj(name, bm, material, parent, loc, smooth=False, **kw)


def rod(name, p0, p1, r, material, parent=None, segs=8, r2=None, **kw):
    """Cylinder from p0 to p1 (in parent space)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    h = d.length
    ob = cyl(name, r, h, material, parent=parent, loc=p0, segs=segs, r2=r2, **kw)
    ob.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    return ob


def ground(size=40):
    """Shadow-catcher ground plane (only visible in the shadow pass)."""
    global GROUND
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size / 2)
    me = bpy.data.meshes.new("ground")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("ground", me)
    bpy.context.scene.collection.objects.link(ob)
    ob.is_shadow_catcher = True
    ob.hide_render = True
    GROUND = ob
    return ob


# ---------------------------------------------------------------- passes

_ORIG = {}


def _remember():
    for ob in ALL_PARTS + FX_PARTS:
        if ob.name not in _ORIG:
            _ORIG[ob.name] = [s.material for s in ob.material_slots]


def _assign(ob, materials):
    for slot, m in zip(ob.material_slots, materials):
        slot.material = m


def _set_hull(on):
    for ob in HULLS:
        mod = ob.modifiers.get("hull")
        mod.show_render = on
        if on and len(ob.material_slots) < 2:
            ob.data.materials.append(_hull_mat())


def set_pass(name, samples=None):
    """Switch every object's materials/visibility for one render pass."""
    _remember()
    sc = bpy.context.scene
    sc.view_settings.view_transform = "AgX" if name == "beauty" else "Standard"
    sc.view_settings.look = "None"
    use_lights("warm" if name in ("beauty", "shadow") else "neutral")
    body_visible = name != "shadow"
    for ob in ALL_PARTS:
        info = [MATS.get(m.name.split(".")[0], {}) for m in _ORIG[ob.name]]
        ob.visible_camera = body_visible
        ob.is_holdout = name == "fx"
        ob.hide_render = False
        if name in ("beauty", "shadow", "fx"):
            _assign(ob, _ORIG[ob.name])
        elif name == "mask":
            mats = []
            for i, m in zip(info, _ORIG[ob.name]):
                if i.get("kind") == "flag":
                    mats.append(_flag_override(m.name, i["image"], "mask"))
                else:
                    on = i.get("kind") == "team"
                    mats.append(_emission_mat("team_on" if on else "team_off",
                                              (1, 1, 1) if on else (0, 0, 0)))
            _assign(ob, mats)
        elif name == "albedo":
            mats = []
            for i, m in zip(info, _ORIG[ob.name]):
                if i.get("kind") == "flag":
                    mats.append(_flag_override(m.name, i["image"], "albedo"))
                    continue
                c = i.get("color", (0.5, 0.5, 0.5))
                strength = 1.0 + (i.get("emission", 0) or 0) * 0.5
                mats.append(_emission_mat("alb_" + m.name, c, strength))
            _assign(ob, mats)
        elif name == "ao":
            _assign(ob, [_ao_mat()] * len(_ORIG[ob.name]))
        elif name == "light":
            mats = []
            for i in info:
                if i.get("kind") == "emit":
                    mats.append(_emission_mat("light_emit", (1, 1, 1), 1.0))
                else:
                    mats.append(_white_diffuse())
            _assign(ob, mats)
    _set_hull(name in ("albedo", "light"))
    for ob in FX_PARTS:
        ob.hide_render = name != "fx" or not ob.get("fx_on", True)
    if GROUND is not None:
        GROUND.hide_render = name != "shadow"
    table = {"beauty": 24, "mask": 6, "albedo": 6, "light": 16, "shadow": 24, "fx": 16, "ao": 8}
    if QUALITY == "hq":
        table = {"beauty": 64, "mask": 8, "albedo": 8, "light": 32, "shadow": 32, "fx": 32, "ao": 16}
        sc.cycles.max_bounces = 6
        sc.cycles.diffuse_bounces = 3
        sc.cycles.glossy_bounces = 2
    sc.cycles.samples = samples or table[name]
    sc.cycles.use_denoising = name in ("beauty", "light")


def render(path):
    sc = bpy.context.scene
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
