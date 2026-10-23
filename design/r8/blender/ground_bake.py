"""R8 batch 2 (D-093): the ground's five layers as client draws them (war-game ground 1, agreed with war-game-client
2026-10-21; client/src/art/ground.ts): tileable textures already lit, the colour as R8's sun leaves it on flat ground
seen from above, the height in alpha. One CC0 PBR set a layer (design/r7/common/textures.py fetches them): its colour,
roughness and normal maps on a plane exactly one tile across, the R7 light rig, an orthographic camera straight down
framing that tile; the height from its displacement map (or its brightness without one).

blender -b --factory-startup --python ground_bake.py -- job.json
job = {"tex_dir": ..., "out": dir, "ppm": 60, "layers": [{"id": "grass", "tex": "leafy_grass", "tile_m": 2.0,
       "tint": [r, g, b] (optional, linear: the colour the layer should take), "contrast": 0.8}]}
writes <out>/<id>.png (RGBA, sRGB colour, height in A) and <out>/bake.json (each layer's mean linear colour)
"""
import glob
import json
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "round2", "blender"))
sys.path.insert(0, os.path.join(HERE, "..", "..", "r7", "blender"))
import lib    # noqa: E402
import look   # noqa: E402

job = json.load(open(sys.argv[sys.argv.index("--") + 1]))


def tex(tid, k):
    got = sorted(glob.glob(os.path.join(job["tex_dir"], f"{tid}_{k}_*.jpg")))
    return got[-1] if got else None


def fresh():
    for lst in (lib.ALL_PARTS, lib.FX_PARTS, lib.HULLS):
        lst.clear()
    for d in (lib.MATS, lib._ORIG, lib._OVR, lib.LIGHTS):
        d.clear()
    lib.reset()
    lib.make_lights()


def bake(layer):
    fresh()
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = job.get("samples", 64)
    sc.cycles.use_denoising = True
    look.lights()
    t = layer["tile_m"]
    bpy.ops.mesh.primitive_plane_add(size=3 * t, location=(0, 0, 0))      # 3 x 3 tiles: the middle one has no edges
    plane = bpy.context.active_object
    m = bpy.data.materials.new(layer["id"])
    m.use_nodes = True
    nt = m.node_tree
    p = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (3.0, 3.0, 1.0)
    nt.links.new(tc.outputs["UV"], mp.inputs["Vector"])
    uv = mp
    imgs = {}
    for k, colour in (("diff", True), ("rough", False), ("nor_gl", False)):
        path = tex(layer["tex"], k)
        if path is None:
            continue
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = bpy.data.images.load(path, check_existing=True)
        n.image.colorspace_settings.name = "sRGB" if colour else "Non-Color"
        nt.links.new(uv.outputs["Vector"], n.inputs["Vector"])
        imgs[k] = n
    col = imgs["diff"].outputs["Color"]
    if layer.get("tint"):
        # recolour to the layer's tint by the photo's own light and dark (like look.texture), keeping `contrast` of it
        bw = nt.nodes.new("ShaderNodeRGBToBW")
        nt.links.new(col, bw.inputs["Color"])
        k = nt.nodes.new("ShaderNodeMath")
        k.operation = "DIVIDE"
        k.inputs[1].default_value = layer["mean_lum"]
        nt.links.new(bw.outputs["Val"], k.inputs[0])
        c = nt.nodes.new("ShaderNodeMath")
        c.operation = "MULTIPLY_ADD"
        c.inputs[1].default_value = layer.get("contrast", 0.8)
        c.inputs[2].default_value = 1 - layer.get("contrast", 0.8)
        nt.links.new(k.outputs[0], c.inputs[0])
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs["A"].default_value = (*layer["tint"], 1.0)
        nt.links.new(c.outputs[0], mix.inputs["B"])
        hue = nt.nodes.new("ShaderNodeMix")              # a little of the photo's own hue back
        hue.data_type = "RGBA"
        hue.inputs["Factor"].default_value = layer.get("hue", 0.25)
        nt.links.new(mix.outputs["Result"], hue.inputs["A"])
        nt.links.new(col, hue.inputs["B"])
        col = hue.outputs["Result"]
    nt.links.new(col, p.inputs["Base Color"])
    if "rough" in imgs:
        nt.links.new(imgs["rough"].outputs["Color"], p.inputs["Roughness"])
    if "nor_gl" in imgs:
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = layer.get("normal", 1.0)
        nt.links.new(imgs["nor_gl"].outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], p.inputs["Normal"])
    plane.data.materials.append(m)
    cam_d = bpy.data.cameras.new("cam")
    cam_d.type = "ORTHO"
    cam_d.ortho_scale = t
    cam = bpy.data.objects.new("cam", cam_d)
    cam.location = (0, 0, 10)
    sc.collection.objects.link(cam)
    sc.camera = cam
    px = int(round(t * job["ppm"]))
    sc.render.resolution_x = sc.render.resolution_y = px
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    out = os.path.join(job["out"], f"{layer['id']}_rgb.png")
    sc.render.filepath = out
    bpy.ops.render.render(write_still=True)
    return out


os.makedirs(job["out"], exist_ok=True)
done = {}
for layer in job["layers"]:
    done[layer["id"]] = bake(layer)
    print("BAKED", layer["id"], done[layer["id"]], flush=True)
json.dump(done, open(os.path.join(job["out"], "bake.json"), "w"))
