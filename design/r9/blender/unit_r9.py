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


def _bump(m, scale, strength, distance=0.002, stretch=None):
    """A noise bump on top of the existing normal, on the part's rest coordinates in metres (r7_prod's "rest"
    attribute; R11: on Object coordinates the folds were invisible, the units' meshes are not in metres).
    stretch: (sx, sy, sz) to draw the noise out, e.g. folds hanging down."""
    nt = m.node_tree
    p = _p(m)
    if p is None:
        return
    prev = p.inputs["Normal"].links[0].from_socket if p.inputs["Normal"].is_linked else None
    at = nt.nodes.new("ShaderNodeAttribute")
    at.attribute_name = "rest"
    vec = at.outputs["Vector"]
    if stretch:
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = stretch
        nt.links.new(vec, mp.inputs["Vector"])
        vec = mp.outputs["Vector"]
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = scale
    nz.inputs["Detail"].default_value = 6
    nt.links.new(vec, nz.inputs["Vector"])
    b = nt.nodes.new("ShaderNodeBump")
    b.inputs["Strength"].default_value = strength
    b.inputs["Distance"].default_value = distance
    nt.links.new(nz.outputs["Fac"], b.inputs["Height"])
    if prev is not None:                              # on top of the texture's normal map
        nt.links.new(prev, b.inputs["Normal"])
    nt.links.new(b.outputs["Normal"], p.inputs["Normal"])


def _plates(m):
    """east_r8.lamellar's plates, read at phone size (R9 r3: rows of corrugation, no plates; a plate is 1.6 px at 3x):
    each plate's tone further from the next, its seam darker, each plate tilted a little its own way (the highlight
    breaks into flecks) and its own roughness (some polished, some dull)."""
    nt = m.node_tree
    p = _p(m)
    nodes = list(nt.nodes)
    wn = next((n for n in nodes if n.bl_idname == "ShaderNodeTexWhiteNoise"), None)
    bump = next((n for n in nodes if n.bl_idname == "ShaderNodeBump"), None)
    if wn is None or bump is None:
        return
    g = None
    for n in nodes:
        if n.bl_idname != "ShaderNodeMath":
            continue
        if n.operation == "MULTIPLY_ADD" and n.inputs[0].is_linked and n.inputs[0].links[0].from_node is wn:
            n.inputs[1].default_value = 0.55                  # tone plate to plate: 0.72..1.27 (was 0.85..1.15)
            n.inputs[2].default_value = 0.72
        if n.operation == "MULTIPLY" and n.inputs[0].is_linked and n.inputs[0].links[0].from_node.bl_idname == "ShaderNodeMath" \
                and n.inputs[0].links[0].from_node.operation == "LESS_THAN":
            n.inputs[1].default_value = 0.55                  # the seams darker
            g = n.inputs[0].links[0].from_node.inputs[0].links[0].from_socket
    bump.inputs["Strength"].default_value = 0.95
    if g is not None:                                         # the tilt: (random - 0.5) x (across the plate - 0.5)
        a = nt.nodes.new("ShaderNodeMath"); a.operation = "SUBTRACT"
        nt.links.new(wn.outputs["Value"], a.inputs[0]); a.inputs[1].default_value = 0.5
        b = nt.nodes.new("ShaderNodeMath"); b.operation = "SUBTRACT"
        nt.links.new(g, b.inputs[0]); b.inputs[1].default_value = 0.5
        t = nt.nodes.new("ShaderNodeMath"); t.operation = "MULTIPLY"
        nt.links.new(a.outputs[0], t.inputs[0]); nt.links.new(b.outputs[0], t.inputs[1])
        h = nt.nodes.new("ShaderNodeMath"); h.operation = "MULTIPLY_ADD"
        nt.links.new(t.outputs[0], h.inputs[0]); h.inputs[1].default_value = 1.6
        nt.links.new(bump.inputs["Height"].links[0].from_socket, h.inputs[2])
        nt.links.new(h.outputs[0], bump.inputs["Height"])
    r = nt.nodes.new("ShaderNodeMapRange")                     # roughness plate by plate
    nt.links.new(wn.outputs["Value"], r.inputs["Value"])
    r.inputs["To Min"].default_value = 0.25
    r.inputs["To Max"].default_value = 0.68
    nt.links.new(r.outputs["Result"], p.inputs["Roughness"])


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
            _bump(m, 6.0, 1.0, 0.05, stretch=(1.0, 1.0, 0.22))   # deep folds hanging down (R9 r5, R11; art-v7: still flat)
        elif "skin" in n:
            # a little light through the skin, no more (R9 r3: more, with the green bounce, gave grey-green flecks)
            p.inputs["Subsurface Weight"].default_value = 0.1
            p.inputs["Subsurface Radius"].default_value = (0.012, 0.005, 0.003)
        elif "lamellar" in n:
            _plates(m)
        elif n.startswith("iron"):
            # the helmet: dull, a little dark, not polished steel (R9 r5)
            _scale_base(m, 0.8)
            if not p.inputs["Roughness"].is_linked:
                p.inputs["Roughness"].default_value = max(0.62, p.inputs["Roughness"].default_value)
            else:                                     # the texture's roughness, never below 0.6 (R11: a clean steel dome)
                src = p.inputs["Roughness"].links[0].from_socket
                mx_ = m.node_tree.nodes.new("ShaderNodeMath")
                mx_.operation = "MAXIMUM"
                mx_.inputs[1].default_value = 0.6
                m.node_tree.links.new(src, mx_.inputs[0])
                m.node_tree.links.new(mx_.outputs[0], p.inputs["Roughness"])
    # R9 r3: the 頓項 one flat slab of the player's colour read as a hood; Tang/Former Shu figures (王建墓 抬棺力士,
    # ref 06) hang rows of lamellae over the nape: give it the body's lamellar
    lam = next((info["mat"] for name, info in lib.MATS.items() if name == "lamellar_r8"), None)
    if lam is not None:
        for ob in bpy.data.objects:
            if ob.name.endswith("_r8dunxiang") and ob.type == "MESH":
                ob.data.materials.clear()
                ob.data.materials.append(lam)
    # the grass's light thrown back up: a sun shining up from the ground, green-brown, no shadow
    d = bpy.data.lights.new("r9_bounce", "SUN")
    d.energy = 0.8
    d.color = (0.66, 0.62, 0.44)                      # warmer: earth and dry grass as much as green
    d.use_shadow = False
    ob = bpy.data.objects.new("r9_bounce", d)
    ob.rotation_euler = (math.radians(180 - 25), 0, math.radians(30))     # pointing up, a little from the front
    bpy.context.scene.collection.objects.link(ob)
    return ob
