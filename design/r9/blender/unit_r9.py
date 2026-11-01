"""R9-03 (napali realism trial): the R8 units' materials and light, a step nearer a photograph, when R9_UNIT=1
(design/r7/blender/r7_prod.py calls apply() after the R8 look). Judge round 1 of the ground and the R8 frames at phone
size: the player's cloth read as a flat cyan cut-out, the faces as black holes under the helmets, the iron as grey
stripes. So:
- cloth: a woven bump and a soft sheen (wool and hemp catch a little light at the folds), less flat colour;
- skin: a little subsurface (light through the ears, the nose: faces stop being holes);
- iron: the plates' bump deeper, the roughness varied plate to plate (some polished, some dull);
- light: the same sun as the ground (R9's ground_r9.SUN, R8's rig), plus the light the sunlit grass throws back up
  (a weak green-brown fill from below, no shadow) so faces and undersides are not black.
"""
import math

import bpy

import lib


def _p(m):
    return next((n for n in m.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled"), None)


def _scale_base(m, k):
    """Base Color x k, whether it is a plain value or fed by the realistic look's texture chain."""
    nt = m.node_tree
    p = _p(m)
    inp = p.inputs["Base Color"]
    if not inp.is_linked:
        c = inp.default_value
        inp.default_value = (c[0] * k, c[1] * k, c[2] * k, c[3])
        return
    src = inp.links[0].from_socket
    nt.links.remove(inp.links[0])
    sc = nt.nodes.new("ShaderNodeVectorMath")
    sc.operation = "SCALE"
    nt.links.new(src, sc.inputs[0])
    [i for i in sc.inputs if i.name == "Scale"][0].default_value = k
    nt.links.new(sc.outputs["Vector"], inp)


def _bump(m, scale, strength, distance=0.002):
    nt = m.node_tree
    p = _p(m)
    if p is None:
        return
    prev = p.inputs["Normal"].links[0].from_socket if p.inputs["Normal"].is_linked else None
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = scale
    nz.inputs["Detail"].default_value = 6
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    b = nt.nodes.new("ShaderNodeBump")
    b.inputs["Strength"].default_value = strength
    b.inputs["Distance"].default_value = distance
    nt.links.new(nz.outputs["Fac"], b.inputs["Height"])
    if prev is not None:                              # on top of the texture's normal map
        nt.links.new(prev, b.inputs["Normal"])
    nt.links.new(b.outputs["Normal"], p.inputs["Normal"])


def apply(u=None, kind=None):
    print("R9UNIT apply", flush=True)
    cloth = ("team", "linen", "sack", "russet", "ochre", "darkcloth", "tunic", "robe", "cloth", "hessian")
    for name, info in lib.MATS.items():
        m = info.get("mat")
        if m is None or not m.use_nodes:
            continue
        p = _p(m)
        if p is None:
            continue
        n = name.lower()
        if info.get("kind") == "team":
            # the player's cloth darker before the client multiplies its colour in (team layer = colour x 1.6, clipped):
            # at lib.TEAM_GRAY 0.72 sunlit folds clipped to white and the cloth came out one flat cyan
            _scale_base(m, 0.55)
        if info.get("kind") == "team" or any(k in n for k in cloth):
            p.inputs["Sheen Weight"].default_value = 0.35
            p.inputs["Sheen Roughness"].default_value = 0.4
            p.inputs["Roughness"].default_value = max(0.82, p.inputs["Roughness"].default_value)
            _bump(m, 900.0, 0.18)
        elif "skin" in n:
            p.inputs["Subsurface Weight"].default_value = 0.25
            p.inputs["Subsurface Radius"].default_value = (0.012, 0.005, 0.003)
        elif "lamellar" in n:
            for nd in m.node_tree.nodes:
                if nd.bl_idname == "ShaderNodeBump":
                    nd.inputs["Strength"].default_value = 0.95
            if not p.inputs["Roughness"].is_linked:
                nt = m.node_tree
                wn = nt.nodes.new("ShaderNodeTexNoise")
                wn.inputs["Scale"].default_value = 60.0
                mr = nt.nodes.new("ShaderNodeMapRange")
                mr.inputs["To Min"].default_value = 0.3
                mr.inputs["To Max"].default_value = 0.62
                nt.links.new(wn.outputs["Fac"], mr.inputs["Value"])
                nt.links.new(mr.outputs["Result"], p.inputs["Roughness"])
    # the grass's light thrown back up: a sun shining up from the ground, green-brown, no shadow
    d = bpy.data.lights.new("r9_bounce", "SUN")
    d.energy = 1.0
    d.color = (0.62, 0.66, 0.42)
    d.use_shadow = False
    ob = bpy.data.objects.new("r9_bounce", d)
    ob.rotation_euler = (math.radians(180 - 25), 0, math.radians(30))     # pointing up, a little from the front
    bpy.context.scene.collection.objects.link(ob)
    return ob
