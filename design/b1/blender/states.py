"""B1-02: the states of a player building, two looks each (A and B), built from the finished model.

state names (render_b1.py piece "state"):
  build_a1, build_a2, build_a3   A 分三階段: foundations staked out on the whole footprint -> the
                                 timber frame rising with scaffolding -> walls done, roof frame
  build_b1, build_b2, build_b3   B 由下往上長: the finished building revealed from the ground up
                                 inside a full-height scaffold with canvas, 30 / 60 / 85 %
  damaged_a                      A 著火: roof holes with flames, black smoke, scorched walls
  damaged_b                      B 不著火: missing tiles, cracks, soot, one thin smoke trail
  destroyed_a                    A 瓦礫堆: a low heap of rubble, tiles and charred beams
  destroyed_b                    B 焦黑地基: knee-high scorched wall stubs on the foundations

Rules from ceo (2026-10-01):
- the sim blocks a building's cells from the moment it is placed: every construction stage shows
  the whole footprint;
- a destroyed player building is removed at once and its cells are walkable: what is left stays
  low (rubble under 0.6 m, wall stubs under knee height, 0.45 m).

R6 production (design/b1/atlas-buildings.md): B1-02 was drawn on the main city, the house and the
barracks (APPROVED), which keep exactly that code. The other buildings get the same looks with three
generalisations: build_a2 cuts at most at 45 % of the height and frames only the wall blocks that start
below the cut (a tower's tagged block is its top room); damaged_a lights a fire at the top when the
building has no tagged roof or wall to burn (the West round tower); the farm's build_a1 is the bare
field staked out (no crop, no water, no scarecrow).
"""
import math
import random

import bmesh
import bpy
from mathutils import Vector

import lib
from lib import box, cyl, ico, rod, sphere
import kit
import buildings as B1

KNEE = 0.45
APPROVED = ("main_city", "house", "barracks")      # B1-02 was drawn on these: keep them as approved
R8 = False          # set by apply() for the R8 buildings (design/r8/blender/arch_r8.py, arch2_r8.py): their own fire,
                    # ruin and construction frame (the realistic look); the B1 buildings keep theirs


# ---------------------------------------------------------------- helpers

def _bbox(ob):
    pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    return (min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts),
            max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))


def _drop(ob):
    for lst in (lib.ALL_PARTS, lib.HULLS, lib.FX_PARTS):
        if ob in lst:
            lst.remove(ob)
    bpy.data.objects.remove(ob, do_unlink=True)


def _tagged(root, key):
    out, stack = [], [root]
    while stack:
        o = stack.pop()
        stack.extend(o.children)
        if key in o.keys():
            v = list(o[key])
            if key == "roof":
                v[7] = "x" if v[7] == 0 else "y"     # stored as a number (ID properties hold no strings)
            out.append((o, v))
    return out


def _is_flag(ob):
    n = ob.name
    return any(t in n for t in ("_flag", "_pole", "_finial", "_bar", "flag"))


def _body_top(root):
    bpy.context.view_layer.update()
    z = 0.5
    for ob in kit.parts_under(root):
        if _is_flag(ob):
            continue
        z = max(z, _bbox(ob)[5])
    return z


def _cutter(name, z0, z1=200.0, x=0.0, y=0.0, size=400.0):
    ob = box(name, (size, size, z1 - z0), lib.mat("cutter", (1, 0, 1)), None, loc=(x, y, (z0 + z1) / 2), outline=False)
    _forget(ob)
    ob.hide_render = True
    ob.display_type = "WIRE"
    return ob


def _forget(ob):
    for lst in (lib.ALL_PARTS, lib.HULLS):
        if ob in lst:
            lst.remove(ob)


def _surface(ob):
    """A thin surface thickened by a Solidify modifier (the East roofs): Booleans on it come out empty,
    so it is edited as a mesh before the modifier instead."""
    return any(m.type == "SOLIDIFY" and m.name == "thick" for m in ob.modifiers)


def _bisect_surface(ob, z):
    """Remove the part of a surface mesh above world height z."""
    mi = ob.matrix_world.inverted()
    co = mi @ Vector((0, 0, z))
    no = (mi.to_3x3().transposed().inverted() @ Vector((0, 0, 1))).normalized()
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, clear_outer=True)
    bm.to_mesh(ob.data)
    bm.free()


def _hole_surface(ob, centres, r):
    """Delete the faces of a surface mesh within r of each world point (subdivided first, so the hole is round)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=3, use_grid_fill=True)
    M = ob.matrix_world
    dead = [f for f in bm.faces if any((M @ f.calc_center_median() - c).length < r for c in centres)]
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    bm.to_mesh(ob.data)
    bm.free()


def cut_above(root, z, keep_flags=False):
    """Everything above height z is gone: parts wholly above are deleted, the rest are cut."""
    bpy.context.view_layer.update()
    cutter = _cutter("cut_above_%d" % int(z * 100), z)
    for ob in kit.parts_under(root):
        if keep_flags and _is_flag(ob):
            continue
        if ob.get("no_cut"):             # the ground the building stands on (the West mine's hillock, a scan grid:
            continue                     # an EXACT Boolean on it ran for hours on CI)
        b = _bbox(ob)
        if b[2] >= z - 1e-4:
            _drop(ob)
        elif b[5] > z and _surface(ob):
            _bisect_surface(ob, z)
        elif b[5] > z:
            m = ob.modifiers.new("cut", "BOOLEAN")
            m.operation = "DIFFERENCE"
            m.object = cutter
            m.solver = "EXACT"
    return cutter


def cut_holes(obs, centres, r):
    """Holes (spheres of radius r at world points) through the given objects."""
    for ob in obs:
        if _surface(ob):
            _hole_surface(ob, centres, r)
    obs = [o for o in obs if not _surface(o)]
    for k, c in enumerate(centres):
        h = B1.lumpy(f"hole{k}_{int(c.x * 10)}_{int(c.y * 10)}", r, lib.mat("cutter", (1, 0, 1)), None, tuple(c),
                     seed=k * 7 + int(abs(c.x * 13)), squash=1.0, subdiv=2, amp=0.35)
        for lst in (lib.HULLS,):
            if h in lst:
                lst.remove(h)
        _forget(h)
        h.hide_render = True
        h.display_type = "WIRE"
        bb = (c.x - r, c.y - r, c.z - r, c.x + r, c.y + r, c.z + r)
        for ob in obs:
            b = _bbox(ob)
            if b[0] > bb[3] or b[3] < bb[0] or b[1] > bb[4] or b[4] < bb[1] or b[2] > bb[5] or b[5] < bb[2]:
                continue
            m = ob.modifiers.new(f"hole{k}", "BOOLEAN")
            m.operation = "DIFFERENCE"
            m.object = h
            m.solver = "EXACT"


def _no_shadow(ob):
    ob.visible_shadow = False
    return ob


def front_slope(M, ww, dd, x_frac, y_frac, z):
    """A point on the roof slope that faces the camera (the side nearer the (-x, -y) corner), in world."""
    a = M @ Vector((x_frac * ww / 2, -y_frac * dd / 2, z))
    b = M @ Vector((x_frac * ww / 2, y_frac * dd / 2, z))
    return a if a.x + a.y < b.x + b.y else b


def footprint(kind):
    import blds
    foot = blds.FOOTPRINT.get(kind)
    if foot is None:                     # R8 batch 2's buildings (design/r8/blender/arch_r8.py, arch2_r8.py)
        import arch_r8
        import arch2_r8
        import keep_r8
        foot = {**arch_r8.FOOTPRINT, **arch2_r8.FOOTPRINT, **keep_r8.FOOTPRINT}[kind]
    fx, fy = foot
    return fx * kit.CELL, fy * kit.CELL


# ---------------------------------------------------------------- parts for the states

def stakes(root, P, w, d):
    """Survey stakes at the footprint corners and every 2 m, with a rope around: the whole footprint."""
    hx, hy = w / 2 - 0.15, d / 2 - 0.15
    pts = []
    for (x0, y0), (x1, y1) in (((-hx, -hy), (hx, -hy)), ((hx, -hy), (hx, hy)), ((hx, hy), (-hx, hy)),
                               ((-hx, hy), (-hx, -hy))):
        n = max(1, int(math.hypot(x1 - x0, y1 - y0) / 2.0))
        for i in range(n):
            pts.append((x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n))
    for k, (x, y) in enumerate(pts):
        rod(f"st_stake{k}", (x, y, 0), (x, y, 0.75), 0.045, P["wood"], parent=root, segs=6)
        cyl(f"st_tag{k}", 0.06, 0.12, P["team"], root, loc=(x, y, 0.6), segs=6)
    for k in range(len(pts)):
        a, b = pts[k], pts[(k + 1) % len(pts)]
        rod(f"st_rope{k}", (a[0], a[1], 0.55), (b[0], b[1], 0.55), 0.015, P["rope"], parent=root, segs=4, outline=False)


def materials_pile(root, P, c, w, d, seed=3):
    """Building materials on the site: logs, stone blocks, a stack of tiles."""
    rnd = random.Random(seed)
    kit.logs("st_logs", P, root, (-w * 0.18, d * 0.15, 0.1), n=6, length=min(2.4, w * 0.45), r=0.15)
    for k in range(5):
        box(f"st_blk{k}", (0.6, 0.45, 0.4), P["stone"], root,
            loc=(w * 0.18 + (k % 3) * 0.62 - 0.6, -d * 0.18 + (k // 3) * 0.5, 0.3 + (k // 3) * 0.0), bevel=0.03,
            rot=(0, 0, rnd.uniform(-6, 6)))
    for k in range(6):
        box(f"st_tiles{k}", (0.7, 0.45, 0.08), P["tile"], root, loc=(w * 0.2, d * 0.22, 0.14 + k * 0.085),
            rot=(0, 0, rnd.uniform(-5, 5)))


def scaffold(root, P, c, x0, x1, y0, y1, h, z0=0.0, canvas=False, name="sc"):
    """Poles round a rectangle, ledgers every 1.4 m, planks on the camera faces, braces; East
    bamboo with rope ties, West sawn timber. canvas: hanging sheets on the camera faces."""
    pole = lib.mat("bamboo", (0.72, 0.66, 0.38), 0.6, noise=0.2, noise_scale=20) if c == "E" else P["wood"]
    r = 0.045 if c == "E" else 0.06
    pts = []
    for (ax, ay), (bx, by) in (((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))):
        n = max(1, int(round(math.hypot(bx - ax, by - ay) / 1.6)))
        for i in range(n):
            pts.append((ax + (bx - ax) * i / n, ay + (by - ay) * i / n))
    for k, (x, y) in enumerate(pts):
        rod(f"{name}_pole{k}", (x, y, z0), (x, y, z0 + h + 0.5), r, pole, parent=root, segs=6)
    levels = [z0 + 1.4 * (i + 1) for i in range(max(1, int(h / 1.4)))]
    for lz in levels:
        for (ax, ay), (bx, by) in (((x0, y0), (x1, y0)), ((x0, y0), (x0, y1)), ((x1, y0), (x1, y1)), ((x0, y1), (x1, y1))):
            rod(f"{name}_led{int(lz * 10)}_{ax:.1f}{ay:.1f}{bx:.1f}", (ax, ay, lz), (bx, by, lz), r * 0.8, pole,
                parent=root, segs=6)
        # planks on the two camera faces
        box(f"{name}_plkY{int(lz * 10)}", (x1 - x0, 0.45, 0.05), P["wood"], root, loc=((x0 + x1) / 2, y0 - 0.2, lz + 0.03))
        box(f"{name}_plkX{int(lz * 10)}", (0.45, y1 - y0, 0.05), P["wood"], root, loc=(x0 - 0.2, (y0 + y1) / 2, lz + 0.03))
    if len(levels) and h > 1.5:
        rod(f"{name}_brY", (x0, y0, z0), ((x0 + x1) / 2, y0, levels[-1]), r * 0.8, pole, parent=root, segs=6)
        rod(f"{name}_brX", (x0, y1, z0), (x0, (y0 + y1) / 2, levels[-1]), r * 0.8, pole, parent=root, segs=6)
    if canvas:
        cm = P["canvas"]
        top = z0 + h
        for k, t in enumerate((0.25, 0.75)):
            x = x0 + (x1 - x0) * t
            box(f"{name}_cvY{k}", ((x1 - x0) * 0.32, 0.03, top * 0.55), cm, root, loc=(x, y0 - 0.32, top - top * 0.3))
            y = y0 + (y1 - y0) * t
            box(f"{name}_cvX{k}", (0.03, (y1 - y0) * 0.32, top * 0.55), cm, root, loc=(x0 - 0.32, y, top - top * 0.3))


def skeleton(root, P, c, blocks, z_top_frac=1.0):
    """The timber frame of every wall block: posts round it and the top beams."""
    beam = P["beam"] if c == "W" or R8 else P["post"]       # R8: raw timber, not lacquered yet (east notes 九)
    for n, (g, (cx, cy, w, d, z0, wall_h)) in enumerate(blocks):
        M = g.matrix_world
        top = wall_h * z_top_frac
        hx, hy = w / 2, d / 2
        corners = [(-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy)]
        pts = []
        for i in range(4):
            (ax, ay), (bx, by) = corners[i], corners[(i + 1) % 4]
            m = max(1, int(round(math.hypot(bx - ax, by - ay) / 1.3)))
            for j in range(m):
                pts.append((ax + (bx - ax) * j / m, ay + (by - ay) * j / m))
        for k, (x, y) in enumerate(pts):
            p0 = M @ Vector((x, y, 0))
            p1 = M @ Vector((x, y, top))
            rod(f"sk{n}_post{k}", tuple(p0), tuple(p1), 0.09, beam, parent=root, segs=8)
        for i in range(4):
            (ax, ay), (bx, by) = corners[i], corners[(i + 1) % 4]
            rod(f"sk{n}_beam{i}", tuple(M @ Vector((ax, ay, top))), tuple(M @ Vector((bx, by, top))), 0.08, beam,
                parent=root, segs=8)


def roof_frame(root, P, roofs):
    """Rafters and a ridge pole where the tiles are not on yet."""
    for n, (g, (cx, cy, z, w, d, h, over, ridge)) in enumerate(roofs):
        M = g.matrix_world
        ww, dd = (w, d) if ridge == "x" else (d, w)
        rx = max(0.05, ww / 2 - dd / 2)
        rod(f"rf{n}_ridge", tuple(M @ Vector((-rx - 0.2, 0, h))), tuple(M @ Vector((rx + 0.2, 0, h))), 0.08, P["beam"],
            parent=root, segs=8)
        m = max(3, int(ww / 0.7))
        for i in range(m + 1):
            x = -ww / 2 + ww * i / m
            xr = max(-rx, min(rx, x))
            for s in (-1, 1):
                rod(f"rf{n}_raf{i}{s}", tuple(M @ Vector((x, s * (dd / 2 + 0.2), -0.05))), tuple(M @ Vector((xr, 0, h))),
                    0.045, P["beam"], parent=root, segs=6)


def beauty_only(ob):
    """Smoke and flames are drawn in the colour image only (no shadow, no AO, no player colour)."""
    ob["beauty_only"] = True
    ob.visible_shadow = False
    return ob


def smoke(root, name, base, height=3.5, r0=0.3, r1=0.85, n=8, dark=0.18, drift=(0.35, 0.25), alpha=0.8):
    """Where a smoke column rises. The smoke itself is drawn in 2D when the images are put together
    (common/smoke2d.py), like the shared landing dust: in the game it is an overlay the client draws
    and can animate, not part of the building image."""
    e = lib.empty(f"smoke_src_{name}", parent=root, loc=base)
    e["smoke"] = [height, r0, r1, dark, alpha, drift[0], drift[1]]
    return []


def _flame_mat():
    """R8: fire that is not a solid cone: emission from a hot pale-yellow core through orange to a dull red at the
    tips, the tongues' edges ragged and see-through (a noise rising up each tongue), bright enough to light the roof
    round it (Cycles lights from emitting surfaces)."""
    if "flame_r8" in bpy.data.materials:
        return bpy.data.materials["flame_r8"]
    m = bpy.data.materials.new("flame_r8")
    m.use_nodes = True
    nt = m.node_tree
    for n_ in list(nt.nodes):
        if n_.bl_idname != "ShaderNodeOutputMaterial":
            nt.nodes.remove(n_)
    out = next(n_ for n_ in nt.nodes if n_.bl_idname == "ShaderNodeOutputMaterial")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs["Vector"])           # z 0 at the tongue's foot, 1 at its tip
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.elements[0].position, cr.elements[0].color = 0.0, (1.0, 0.86, 0.45, 1)
    cr.elements[1].position, cr.elements[1].color = 1.0, (0.55, 0.08, 0.01, 1)
    e = cr.elements.new(0.4)
    e.color = (1.0, 0.45, 0.07, 1)
    nt.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(ramp.outputs["Color"], em.inputs["Color"])
    st = nt.nodes.new("ShaderNodeMapRange")
    st.inputs["From Min"].default_value, st.inputs["From Max"].default_value = 0.0, 1.0
    st.inputs["To Min"].default_value, st.inputs["To Max"].default_value = 9.0, 2.0
    nt.links.new(sep.outputs["Z"], st.inputs["Value"])
    nt.links.new(st.outputs["Result"], em.inputs["Strength"])
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (5.0, 5.0, 1.6)                    # licks stretched upward
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 3.0
    nz.inputs["Detail"].default_value = 4.0
    nt.links.new(mp.outputs["Vector"], nz.inputs["Vector"])
    edge = nt.nodes.new("ShaderNodeMath")                                # thinner toward the tip
    edge.operation = "MULTIPLY_ADD"
    edge.inputs[1].default_value = 0.45
    edge.inputs[2].default_value = 0.32
    nt.links.new(sep.outputs["Z"], edge.inputs[0])
    cut = nt.nodes.new("ShaderNodeMath")
    cut.operation = "GREATER_THAN"
    nt.links.new(nz.outputs["Fac"], cut.inputs[0])
    nt.links.new(edge.outputs[0], cut.inputs[1])
    soft = nt.nodes.new("ShaderNodeMapRange")
    soft.inputs["From Min"].default_value, soft.inputs["From Max"].default_value = 0.3, 0.6
    nt.links.new(nz.outputs["Fac"], soft.inputs["Value"])
    a = nt.nodes.new("ShaderNodeMath")
    a.operation = "MULTIPLY"
    nt.links.new(cut.outputs[0], a.inputs[0])
    nt.links.new(soft.outputs["Result"], a.inputs[1])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(a.outputs[0], mix.inputs["Fac"])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return m


def flames(root, P, name, base, size=1.0, n=5, seed=1):
    rnd = random.Random(seed)
    if R8:                           # tongues of see-through fire, a cluster of tall and short, leaning a little
        m = _flame_mat()
        lib.MATS.setdefault("flame_r8", dict(mat=m, kind="emit", color=(1.0, 0.5, 0.1), emission=6.0))
        for i in range(n + 4):
            h = size * rnd.uniform(0.6, 1.5)
            x, y = base[0] + rnd.uniform(-0.38, 0.38) * size, base[1] + rnd.uniform(-0.38, 0.38) * size
            ob = cyl(f"{name}{i}", 0.2 * size * rnd.uniform(0.7, 1.1), h, m, root, loc=(x, y, base[2] - 0.05), r2=0.02,
                     segs=10, rot=(rnd.uniform(-12, 12), rnd.uniform(-12, 12), rnd.uniform(0, 360)), outline=False)
            beauty_only(ob)
        return
    core = lib.mat("flame_core", (1.0, 0.72, 0.25), 0.5, emission=2.6)
    for i in range(n):
        h = size * rnd.uniform(0.5, 1.0)
        x, y = base[0] + rnd.uniform(-0.3, 0.3) * size, base[1] + rnd.uniform(-0.3, 0.3) * size
        beauty_only(cyl(f"{name}{i}", 0.16 * size, h, P["fire"], root, loc=(x, y, base[2]), r2=0.0, segs=8,
                        rot=(rnd.uniform(-10, 10), rnd.uniform(-10, 10), 0), outline=False))
        beauty_only(cyl(f"{name}{i}c", 0.08 * size, h * 0.6, core, root, loc=(x, y - 0.05, base[2]), r2=0.0, segs=6,
                        outline=False))


def scorch(root, name, centre, normal_axis, w, h, seed=0):
    """A sooty patch on a wall face: a thin dark irregular slab just off the face."""
    rnd = random.Random(seed)
    m = lib.mat("soot", (0.06, 0.05, 0.045), 0.95)
    pts = []
    for i in range(9):
        a = 2 * math.pi * i / 9
        rr = rnd.uniform(0.6, 1.0)
        pts.append((math.cos(a) * w / 2 * rr, max(0.0, math.sin(a)) * h * rr + (0 if math.sin(a) > 0 else math.sin(a) * h * 0.15)))
    if normal_axis == "y":
        return lib.slab(name, pts, 0.02, m, parent=root, loc=centre, plane="XZ", outline=False)
    return lib.slab(name, pts, 0.02, m, parent=root, loc=centre, rot=(0, 0, 90), plane="XZ", outline=False)


def cracks(root, name, start, axis, length=1.2, seed=0):
    rnd = random.Random(seed)
    m = lib.mat("crack", (0.05, 0.04, 0.035), 0.9)
    x, y, z = start
    for i in range(5):
        dz = -length / 5
        dt = rnd.uniform(-0.18, 0.18)
        if axis == "y":
            p1 = (x + dt, y, z + dz)
        else:
            p1 = (x, y + dt, z + dz)
        rod(f"{name}{i}", (x, y, z), p1, 0.022, m, parent=root, segs=4, outline=False)
        x, y, z = p1


def rubble(root, P, c, w, d, seed=5, h=0.55, cover=0.8):
    """A low heap over the footprint: rubble, tile shards and charred beams; nothing above h."""
    rnd = random.Random(seed)
    mats = [P["stone"], P["wall"], P["brick"]]
    n = int(w * d * 0.9)
    for i in range(n):
        x, y = rnd.uniform(-w / 2, w / 2) * cover, rnd.uniform(-d / 2, d / 2) * cover
        fall = 1 - (abs(x) / (w / 2) + abs(y) / (d / 2)) / 2
        r = rnd.uniform(0.25, 0.5)
        zz = r * 0.25 + fall * h * 0.35
        B1.lumpy(f"rb_lump{i}", r, mats[i % 3], root, (x, y, zz), seed=seed * 100 + i, squash=0.45)
    for i in range(int(n * 0.8)):
        x, y = rnd.uniform(-w / 2, w / 2) * (cover + 0.1), rnd.uniform(-d / 2, d / 2) * (cover + 0.1)
        box(f"rb_tile{i}", (0.32, 0.22, 0.05), P["tile"], root, loc=(x, y, rnd.uniform(0.05, h * 0.6)),
            rot=(rnd.uniform(-30, 30), rnd.uniform(-30, 30), rnd.uniform(0, 180)))
    for i in range(max(3, int(w))):
        x, y = rnd.uniform(-w / 2, w / 2) * 0.7, rnd.uniform(-d / 2, d / 2) * 0.7
        a = rnd.uniform(0, math.pi)
        L = rnd.uniform(1.2, 2.2)
        p0 = (x - math.cos(a) * L / 2, y - math.sin(a) * L / 2, 0.12)
        p1 = (x + math.cos(a) * L / 2, y + math.sin(a) * L / 2, rnd.uniform(0.25, h - 0.05))
        rod(f"rb_beam{i}", p0, p1, 0.1, P["char"], parent=root, segs=6)
    if c == "E":
        for i in range(2):
            x, y = rnd.uniform(-w / 3, w / 3), rnd.uniform(-d / 3, d / 3)
            rod(f"rb_post{i}", (x, y, 0.15), (x + 1.2, y + 0.3, 0.3), 0.11, P["post"], parent=root, segs=8)


def ash(root, name, w, d, seed=7):
    rnd = random.Random(seed)
    m = lib.mat("ash", (0.16, 0.15, 0.14), 1.0)
    for i in range(4):
        x, y = rnd.uniform(-w / 3, w / 3), rnd.uniform(-d / 3, d / 3)
        cyl(f"{name}{i}", rnd.uniform(0.5, 1.0), 0.03, m, root, loc=(x, y, 0.2), scale=(1, rnd.uniform(0.6, 1), 1),
            outline=False)


def _hollow(root, blocks, z_from):
    """Hollow every wall block (a box cutter inside the walls, from z_from up), so a cut wall is a rim
    of wall and not a solid lid."""
    cut = []
    for g, (cx, cy, bw, bd, z0, wh) in blocks:
        o = g.matrix_world.translation
        inner = box("hollow", (max(0.3, bw - 0.36), max(0.3, bd - 0.36), 8.0), lib.mat("cutter", (1, 0, 1)), None,
                    loc=(o.x, o.y, max(z_from, z0 + 0.12) + 4.0), outline=False)
        _forget(inner)
        inner.hide_render = True
        cut.append((inner, (o.x - bw / 2, o.x + bw / 2, o.y - bd / 2, o.y + bd / 2)))
    for ob in kit.parts_under(root):
        b = _bbox(ob)
        for k, (inner, (x0, x1, y0, y1)) in enumerate(cut):
            if b[3] < x0 or b[0] > x1 or b[4] < y0 or b[1] > y1:
                continue
            m = ob.modifiers.new(f"hollow{k}", "BOOLEAN")
            m.operation = "DIFFERENCE"
            m.object = inner
            m.solver = "EXACT"


def _drop_cloth(root):
    """Burnt: every player-colour cloth and flag is gone."""
    for ob in list(kit.parts_under(root)):
        names = [s.material.name for s in ob.material_slots if s.material]
        if any(n.startswith(("team", "flag_")) for n in names):
            _drop(ob)


def _char_all(root, above=0.25):
    """Every part above the base turns sooty (materials swapped for a darker copy)."""
    bpy.context.view_layer.update()
    for ob in kit.parts_under(root):
        if _bbox(ob)[5] <= above + 0.01:
            continue
        for slot in ob.material_slots:
            m = slot.material
            if m is None or m.name.startswith(("team", "cutter")):
                continue
            key = "sooty_" + m.name
            if key not in lib.MATS:
                info = lib.MATS.get(m.name.split(".")[0], {})
                col = info.get("color", (0.4, 0.4, 0.4))
                lib.mat(key, tuple(v * 0.2 for v in col), 0.95, noise=0.45, noise_scale=6)
            slot.material = lib.MATS[key]["mat"]


# ---------------------------------------------------------------- the states

def _extent(root):
    """(x0, y0, x1, y1, top) of the building's parts, flags left out; x and y of the parts that rise over 1 m
    (the walls, not the paving round them)."""
    bpy.context.view_layer.update()
    bb = [_bbox(ob) for ob in kit.parts_under(root) if not _is_flag(ob)]
    tall = [b for b in bb if b[5] > 1.0] or bb
    return (min(b[0] for b in tall), min(b[1] for b in tall), max(b[3] for b in tall), max(b[4] for b in tall),
            max(b[5] for b in bb))


def fire_at_top(root, P, seed):
    """A building with no tagged roof or wall to burn: flames and black smoke at the top on the camera
    side (the look of 受損 A). No soot patches: on a round or tapered wall they float off the face."""
    x0, y0, x1, y1, top = _extent(root)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    p = (cx + (x0 - cx) * 0.35, cy + (y0 - cy) * 0.35, top - 0.35)
    flames(root, P, "dm_firegen", p, size=1.8, n=8, seed=seed + 7)
    smoke(root, "dm_smokegen", (p[0], p[1], p[2] + 0.8), height=3.0, r0=0.35, r1=0.9, n=11, dark=0.16, alpha=0.9)


def _soot_mat():
    """R8: soot on stone: dark, its edge soft and ragged (a radial fade broken by noise), see-through outside."""
    if "soot_r8" in bpy.data.materials:
        return bpy.data.materials["soot_r8"]
    m = bpy.data.materials.new("soot_r8")
    m.use_nodes = True
    nt = m.node_tree
    out = next(n_ for n_ in nt.nodes if n_.bl_idname == "ShaderNodeOutputMaterial")
    p = next(n_ for n_ in nt.nodes if n_.bl_idname == "ShaderNodeBsdfPrincipled")
    p.inputs["Base Color"].default_value = (0.025, 0.022, 0.02, 1)
    p.inputs["Roughness"].default_value = 1.0
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
    r = nt.nodes.new("ShaderNodeVectorMath")
    r.operation = "DISTANCE"
    r.inputs[1].default_value = (0.5, 0.5, 0.0)
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(sep.outputs["X"], comb.inputs["X"])
    nt.links.new(sep.outputs["Y"], comb.inputs["Y"])
    nt.links.new(comb.outputs[0], r.inputs[0])
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 6.0
    nz.inputs["Detail"].default_value = 5.0
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    add = nt.nodes.new("ShaderNodeMath")
    add.operation = "MULTIPLY_ADD"
    add.inputs[1].default_value = 0.35
    nt.links.new(nz.outputs["Fac"], add.inputs[0])
    nt.links.new(r.outputs["Value"], add.inputs[2])
    fade = nt.nodes.new("ShaderNodeMapRange")
    fade.inputs["From Min"].default_value, fade.inputs["From Max"].default_value = 0.62, 0.3
    fade.inputs["To Min"].default_value, fade.inputs["To Max"].default_value = 0.0, 0.85
    nt.links.new(add.outputs[0], fade.inputs["Value"])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(fade.outputs["Result"], mix.inputs["Fac"])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(p.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return m


def r8_ruin(root, P, c, w, d, blocks, seed):
    """R8's ruin (east notes 九: 台基＋柱礎格子＋斷柱＋瓦礫, the plan still readable; west notes 十五: a low heap, the
    footings): everything cut at knee height (the platform, the wall footings), the cloth gone; the columns' stone
    bases back on the cut platform where they stood, a few charred stubs and fallen column pieces; broken stone and
    brick (angular), tile shards and charred beams over it, soot and ash. Stone and rammed earth do not burn (only
    soot): the textures stay. Nothing above 0.6 m (the cells walk again)."""
    import terrain_r8
    import arch_r8
    AP = arch_r8.palette(c)
    bpy.context.view_layer.update()
    bases = []                                         # the column bases (hall_e's *_base<k>) where they stood
    for ob in ([] if root.get("no_bases") else kit.parts_under(root)):
        if "_base" in ob.name and ob.type == "MESH" and "hall" in ob.name or "_col" in ob.name and ob.type == "MESH":
            x0, y0, z0, x1, y1, z1 = _bbox(ob)
            if "_col" in ob.name:
                bases.append(((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2))
    _drop_cloth(root)
    _hollow(root, blocks, 0.12)
    cut_above(root, KNEE)
    rnd = random.Random(seed + 9)
    zt = KNEE
    for k, (x, y, r) in enumerate(bases):              # bases on the cut platform, some with a burnt stub
        cyl(f"rb_base{k}", r * 1.5, 0.1, AP["stone"], root, loc=(x, y, zt - 0.02), r2=r * 1.25, segs=14)
        if rnd.random() < 0.4:
            cyl(f"rb_stub{k}", r * 0.95, rnd.uniform(0.06, 0.14), P["char"], root, loc=(x, y, zt + 0.08), r2=r * 0.7, segs=10)
    burnt = lib.mat("wooddark", (0.03, 0.026, 0.022), 0.95)   # charred timber: the wood's grain, black
    for k in range(min(3, len(bases))):                # fallen pieces of the columns, burnt through, broken short
        x, y, r = bases[rnd.randrange(len(bases))]
        a = rnd.uniform(0, math.pi)
        L = rnd.uniform(0.6, 1.1)
        rod(f"rb_colfall{k}", (x, y, zt + r * 0.6), (x + math.cos(a) * L, y + math.sin(a) * L, zt + r * 0.5), r * 0.6, burnt,
            parent=root, segs=7)
    stone = AP["stone"] if c == "W" else AP["brick"]
    n = int(w * d * 1.6)
    for i in range(n):
        x, y = rnd.uniform(-w / 2, w / 2) * 0.85, rnd.uniform(-d / 2, d / 2) * 0.85
        fall = 1 - (abs(x) / (w / 2) + abs(y) / (d / 2)) / 2
        r = rnd.uniform(0.08, 0.24)
        terrain_r8._rock(f"rb_stone{i}", r, stone if i % 4 else P["char"], root, (x, y, 0.06 + KNEE * 0.4 * fall + r * 0.2), rnd)
    for i in range(int(n * 0.9)):
        x, y = rnd.uniform(-w / 2, w / 2) * 0.9, rnd.uniform(-d / 2, d / 2) * 0.9
        box(f"rb_tile{i}", (0.26, 0.18, 0.035), AP["tile"], root, loc=(x, y, rnd.uniform(0.04, KNEE + 0.05)),
            rot=(rnd.uniform(-35, 35), rnd.uniform(-35, 35), rnd.uniform(0, 180)))
    for i in range(max(3, int(w * 1.2))):
        x, y = rnd.uniform(-w / 2, w / 2) * 0.7, rnd.uniform(-d / 2, d / 2) * 0.7
        a = rnd.uniform(0, math.pi)
        L = rnd.uniform(1.0, 2.0)
        rod(f"rb_beam{i}", (x - math.cos(a) * L / 2, y - math.sin(a) * L / 2, 0.1),
            (x + math.cos(a) * L / 2, y + math.sin(a) * L / 2, rnd.uniform(0.2, 0.55)), 0.07, burnt, parent=root, segs=6)
    soot = _soot_mat()
    bpy.context.view_layer.update()
    tops = {}
    for ob in kit.parts_under(root):                   # the soot lies on whatever is left: the cut platform, the floor
        x0, y0, z0, x1, y1, z1 = _bbox(ob)
        if x1 - x0 > 1.5 and y1 - y0 > 1.5:
            tops[ob.name] = (x0, y0, x1, y1, z1)
    for i in range(7):
        x, y = rnd.uniform(-w / 2.6, w / 2.6), rnd.uniform(-d / 2.6, d / 2.6)
        z = max([t[4] for t in tops.values() if t[0] < x < t[2] and t[1] < y < t[3]] or [0.08])
        ob = cyl(f"rb_soot{i}", rnd.uniform(0.7, 1.3), 0.01, soot, root, loc=(x, y, min(z, KNEE) + 0.012),
                 scale=(1, rnd.uniform(0.55, 1), 1), outline=False)
        ob["no_bevel"] = True
    smoke(root, "ds_wisp", (0.3, -0.2, 0.5), height=2.2, r0=0.15, r1=0.35, n=7, dark=0.5, alpha=0.55)


def apply(root, kind, c, state, **opts):
    global R8
    R8 = kind.startswith("r8_")
    P = kit.palette(c)
    w, d = footprint(kind)
    blocks = _tagged(root, "block")
    roofs = _tagged(root, "roof")
    H = _body_top(root)
    seed = sum(map(ord, kind)) + (0 if c == "E" else 50)

    if state == "build_a1" and "farm" in kind:          # farm, farm_fine, r8_farm
        for ob in list(kit.parts_under(root)):
            if ob.name.startswith(("ff_rice", "ff_panicle", "ff_wheat", "ff_ears", "ff_water", "ff_sc")):
                _drop(ob)
        stakes(root, P, w, d)
    elif state == "build_a1":
        cut_above(root, 0.35)
        stakes(root, P, w, d)
        materials_pile(root, P, c, w, d, seed)
    elif state == "build_a2":
        wall_tops = [g.matrix_world.translation.z + wh for g, (cx, cy, ww, dd, z0, wh) in blocks] or [H * 0.5]
        z_cut = min(z0w + 0.45 * (top - z0w) for z0w, top in
                    [(g.matrix_world.translation.z, g.matrix_world.translation.z + v[5]) for g, v in blocks]) \
            if blocks else H * 0.3
        framed = blocks
        if kind not in APPROVED:
            z_cut = min(z_cut, 0.45 * H)
            framed = [(g, v) for g, v in blocks if g.matrix_world.translation.z < z_cut]
        cut_above(root, z_cut)
        skeleton(root, P, c, framed)
        scaffold(root, P, c, -w / 2 + 0.2, w / 2 - 0.2, -d / 2 + 0.2, d / 2 - 0.2, max(wall_tops) - 0.2, canvas=False)
    elif state == "build_a3":
        z_cut = (min(g.matrix_world.translation.z for g, v in roofs) + 0.35) if roofs else H * 0.7
        roof_tops = [g.matrix_world.translation.z + v[5] for g, v in roofs] or [H]
        cut_above(root, z_cut)
        roof_frame(root, P, roofs)
        scaffold(root, P, c, -w / 2 + 0.2, w / 2 - 0.2, -d / 2 + 0.2, d / 2 - 0.2, z_cut + 0.6, canvas=False)
    elif state in ("build_b1", "build_b2", "build_b3"):
        frac = {"build_b1": 0.3, "build_b2": 0.6, "build_b3": 0.85}[state]
        cut_above(root, max(0.3, H * frac))
        scaffold(root, P, c, -w / 2 + 0.15, w / 2 - 0.15, -d / 2 + 0.15, d / 2 - 0.15, H, canvas=True)
    elif state == "damaged_a":
        roof_parts = []
        for g, v in roofs:
            roof_parts += [o for o in kit.parts_under(g)]
        centres = []
        for k, (g, (cx, cy, z, rw, rd, rh, over, ridge)) in enumerate(roofs[:2]):
            ww, dd = (rw, rd) if ridge == "x" else (rd, rw)
            centres.append(front_slope(g.matrix_world, ww, dd, -0.25, 0.5, rh * 0.45))
        cut_holes(roof_parts, centres, 0.75)
        lit = bool(centres)
        if blocks:
            g, (cx, cy, bw, bd, z0, wh) = max(blocks, key=lambda t: t[0].matrix_world.translation.z + t[1][5])
            top = g.matrix_world.translation.z + wh
            covered = any(abs(rg.matrix_world.translation.z - top) < 0.6 for rg, _ in roofs)
            if not covered and top > 3.0:
                o = g.matrix_world.translation
                p = Vector((o.x + bw * 0.22, o.y - bd * 0.22, top + 0.45))     # clear of a front corner turret
                flames(root, P, "dm_firetop", (p.x, p.y, p.z), size=2.2, n=9, seed=seed + 5)
                lit = True
                smoke(root, "dm_smoketop", (p.x, p.y, p.z + 0.8), height=3.0, r0=0.35, r1=0.9, n=11, dark=0.16,
                      alpha=0.9)
        for k, cc in enumerate(centres):
            for i in range(3):
                rod(f"dm_raf{k}{i}", (cc.x - 0.7, cc.y - 0.3 + i * 0.3, cc.z - 0.2), (cc.x + 0.7, cc.y - 0.2 + i * 0.3,
                                                                                 cc.z - 0.05), 0.05, P["char"],
                    parent=root, segs=6)
            flames(root, P, f"dm_fire{k}", (cc.x, cc.y, cc.z - 0.15), size=1.4, n=7, seed=seed + k)
            smoke(root, f"dm_smoke{k}", (cc.x, cc.y, cc.z + 0.6), height=3.0, r0=0.35, r1=0.9, n=11, dark=0.16, alpha=0.9)
        for k, (g, (cx, cy, bw, bd, z0, wh)) in enumerate(blocks[:2]):
            M = g.matrix_world
            # the soot on the wall itself, behind the hangings (art-v3: a hanging moved to the front face must not be
            # blacked out; house_E_damaged's player colour fell to 4.9%)
            scorch(root, f"dm_scY{k}", tuple(M @ Vector((bw * 0.15, -bd / 2 - 0.035, wh * 0.45))), "y", 1.3, 1.0,
                   seed=seed + k)
            scorch(root, f"dm_scX{k}", tuple(M @ Vector((-bw / 2 - 0.13, bd * 0.1, wh * 0.4))), "x", 1.1, 0.9,
                   seed=seed + k + 9)
        if not lit and kind not in APPROVED:
            fire_at_top(root, P, seed)
    elif state == "damaged_b":
        roof_parts = []
        for g, v in roofs:
            roof_parts += [o for o in kit.parts_under(g)]
        centres = []
        rnd = random.Random(seed)
        for k, (g, (cx, cy, z, rw, rd, rh, over, ridge)) in enumerate(roofs[:2]):
            ww, dd = (rw, rd) if ridge == "x" else (rd, rw)
            for i in range(3):
                yf = rnd.uniform(0.36, 0.7)
                centres.append(front_slope(g.matrix_world, ww, dd, rnd.uniform(-0.7, 0.7), yf, rh * (1 - yf) ** 1.2 * 0.9))
        cut_holes(roof_parts, centres, 0.32)
        for k, (g, (cx, cy, bw, bd, z0, wh)) in enumerate(blocks[:2]):
            M = g.matrix_world
            cracks(root, f"dm_crY{k}", tuple(M @ Vector((-bw * 0.2, -bd / 2 - 0.14, wh * 0.92))), "y", wh * 0.7, seed + k)
            cracks(root, f"dm_crX{k}", tuple(M @ Vector((-bw / 2 - 0.14, bd * 0.25, wh * 0.9))), "x", wh * 0.6,
                   seed + k + 3)
            scorch(root, f"dm_scY{k}", tuple(M @ Vector((bw * 0.25, -bd / 2 - 0.13, 0.2))), "y", 1.0, 0.7, seed=seed + k)
        rnd = random.Random(seed + 1)
        for i in range(7):
            box(f"dm_fallen{i}", (0.3, 0.2, 0.05), P["tile"], root,
                loc=(-w / 2 + 0.5 + rnd.uniform(0, 1.2), -d / 2 + 0.4 + rnd.uniform(0, 0.6), 0.12),
                rot=(rnd.uniform(-20, 20), rnd.uniform(-20, 20), rnd.uniform(0, 180)))
        top = max(c.z for c in centres) if centres else H
        cc = centres[0] if centres else Vector((0, 0, H))
        smoke(root, "dm_wisp", (cc.x, cc.y, cc.z + 0.2), height=3.0, r0=0.18, r1=0.45, n=10, dark=0.55, alpha=0.6,
              drift=(0.25, 0.18))
    elif state == "destroyed_a" and R8:
        r8_ruin(root, P, c, w, d, blocks, seed)
    elif state == "destroyed_a":
        for ob in list(kit.parts_under(root)):
            if _bbox(ob)[5] > 0.3:
                _drop(ob)
        rubble(root, P, c, w, d, seed)
        ash(root, "ds_ash", w, d, seed)
        _char_all(root, above=0.3)
        smoke(root, "ds_wisp", (0.3, -0.2, 0.5), height=2.2, r0=0.15, r1=0.35, n=7, dark=0.5, alpha=0.55)
    elif state == "destroyed_b":
        _drop_cloth(root)
        _hollow(root, blocks, 0.12)
        cut_above(root, KNEE)
        _char_all(root)
        rnd2 = random.Random(seed + 2)
        for g, (cx, cy, bw, bd, z0, wh) in blocks:
            o = g.matrix_world.translation
            # a hall on a platform (or an upper storey) falls onto the cut platform: its debris lies at knee height
            for i in range(int(bw * bd)):
                B1.lumpy(f"ds_deb{len(blocks)}_{i}_{int(o.x * 10)}", rnd2.uniform(0.15, 0.3), P["char"], root,
                         (o.x + rnd2.uniform(-bw / 3, bw / 3), o.y + rnd2.uniform(-bd / 3, bd / 3), min(o.z, KNEE) + 0.05),
                         seed=i, squash=0.4)
        ash(root, "ds_ash", w, d, seed)
        rnd = random.Random(seed)
        for i in range(10):
            box(f"ds_tile{i}", (0.3, 0.2, 0.05), P["tile"], root,
                loc=(rnd.uniform(-w / 2, w / 2) * 0.85, rnd.uniform(-d / 2, d / 2) * 0.85, 0.24),
                rot=(rnd.uniform(-20, 20), rnd.uniform(-20, 20), rnd.uniform(0, 180)))
        a = rnd.uniform(0, math.pi)
        rod("ds_beam", (-math.cos(a) * 1.2, -math.sin(a) * 1.2, 0.25), (math.cos(a) * 1.2, math.sin(a) * 1.2, 0.35),
            0.1, P["char"], parent=root, segs=6)
    else:
        raise ValueError(state)
