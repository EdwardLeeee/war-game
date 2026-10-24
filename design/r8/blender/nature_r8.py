"""R8 batch 2 (D-093): the resource points in the realistic look, one cell each, named as art-v5's (b1 PROD_NODES).

Trees (tree_<c>_v0..2, tree_<c>_stump): the B1 species kept (approved), grown instead of modelled: a trunk and branches
as one tapered mesh, bending upward (or drooping) as they go, bark from CC0 photo textures (look.MATCH bark_*); the
foliage as thousands of small leaf or needle cards in clumps at the branch tips, each card a little different in colour,
lit through (translucent), so the crown shades like a real one at sprite size.
  East: 松 a pine with flat layered pads (v0), 曲松 a leaning pine (v1), 樟 a camphor with a broad round crown (v2).
  West: 橡 a broad oak (v0), 冷杉 a narrow fir (v1), 樺 birch: two slender white trunks, a light crown (v2).
Gold (gold_v<k>_<full|mined|depleted>): the cliffs' scanned rock (terrain_r8._mass) with quartz and gold in it; mined:
smaller, timber props at a dug face, a pick; depleted: a low spill of broken rock.
Berries (berry_v<k>_<full|depleted>): a shrub grown like the trees, red berries in bunches; depleted: thinned, bare.
Crystal (crystal_v<k>_<full|depleted>): 魔晶, hexagonal crystals glowing cyan out of dark rock; depleted: broken stumps.
"""
import math
import random

import bmesh
import bpy
from mathutils import Vector

import lib
from lib import box, cyl, rod, sphere

CELL = 2.0


# ---------------------------------------------------------------- materials

def _leaf_mat(name, dark, light, rough=0.6, trans=0.3):
    """Leaf cards: the colour between `dark` and `light` by each card's own random value (attribute "var"), lit
    through from behind (translucent) a little."""
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    out = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeOutputMaterial")
    p = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    at = nt.nodes.new("ShaderNodeAttribute")
    at.attribute_name = "var"
    at.attribute_type = "GEOMETRY"
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["A"].default_value = (*dark, 1)
    mix.inputs["B"].default_value = (*light, 1)
    nt.links.new(at.outputs["Fac"], mix.inputs["Factor"])
    nt.links.new(mix.outputs["Result"], p.inputs["Base Color"])
    p.inputs["Roughness"].default_value = rough
    tl = nt.nodes.new("ShaderNodeBsdfTranslucent")
    nt.links.new(mix.outputs["Result"], tl.inputs["Color"])
    ms = nt.nodes.new("ShaderNodeMixShader")
    ms.inputs["Fac"].default_value = trans
    nt.links.new(p.outputs[0], ms.inputs[1])
    nt.links.new(tl.outputs[0], ms.inputs[2])
    nt.links.new(ms.outputs[0], out.inputs["Surface"])
    lib.MATS.setdefault(name, dict(mat=m, kind="solid", color=light))
    return m


def _mats(c):
    m = lib.mat
    return dict(
        bark_pine=m("bark_pine", (0.16, 0.1, 0.06), 0.9),
        bark_camphor=m("bark_camphor", (0.2, 0.14, 0.09), 0.9),
        bark_oak=m("bark_oak", (0.12, 0.095, 0.06), 0.92),
        bark_birch=m("bark_birch", (0.62, 0.6, 0.55), 0.8),
        logend=m("logend", (0.42, 0.31, 0.19), 0.85),
        needles=_leaf_mat("needles_r8", (0.025, 0.05, 0.02), (0.06, 0.1, 0.035), 0.7, 0.15),
        camphor=_leaf_mat("leaf_camphor_r8", (0.03, 0.07, 0.02), (0.08, 0.16, 0.04), 0.45, 0.25),
        oak=_leaf_mat("leaf_oak_r8", (0.035, 0.07, 0.018), (0.1, 0.16, 0.04), 0.6, 0.3),
        birch=_leaf_mat("leaf_birch_r8", (0.07, 0.12, 0.03), (0.19, 0.25, 0.06), 0.55, 0.35),
        bush=_leaf_mat("leaf_bush_r8", (0.03, 0.06, 0.02), (0.08, 0.13, 0.04), 0.55, 0.3),
        berry=m("berry_r8", (0.35, 0.02, 0.025), 0.3),
        twig=m("bark_oak", (0.12, 0.095, 0.06), 0.92),
    )


# ---------------------------------------------------------------- growing

class Tree:
    """Branches as polylines with radii, leaf anchors; built into two meshes at the end."""

    def __init__(self, rnd):
        self.rnd = rnd
        self.branches = []       # [(points, radii)]
        self.anchors = []        # [(point, size)]: where the foliage clumps go

    def grow(self, p, d, length, r0, r1, depth, sp, steps=None):
        """A branch from p along d (unit), `length` m, radius r0 to r1; children by sp (species parameters)."""
        rnd = self.rnd
        n = steps or max(3, int(length / 0.25))
        pts, rad = [Vector(p)], [r0]
        d = Vector(d).normalized()
        q = Vector(p)
        for i in range(n):
            t = (i + 1) / n
            d = (d + Vector((rnd.gauss(0, sp["wiggle"]), rnd.gauss(0, sp["wiggle"]), rnd.gauss(0, sp["wiggle"] * 0.5)))
                 + Vector((0, 0, sp["up"] if depth else sp.get("trunk_up", 0.0)))).normalized()
            if depth and sp.get("droop"):
                d = (d + Vector((0, 0, -sp["droop"] * t))).normalized()
            q = q + d * (length / n)
            pts.append(q.copy())
            rad.append(r0 + (r1 - r0) * t)
        self.branches.append((pts, rad))
        if depth >= sp["depth"]:
            for k, pt in enumerate(pts[max(1, len(pts) - sp["leafy"]):]):
                self.anchors.append((pt, sp["clump"] * rnd.uniform(0.75, 1.2)))
            return
        # children: along the branch from a start fraction, round it, angled away
        start = sp["start"][depth] if isinstance(sp["start"], (list, tuple)) else sp["start"]
        kids = sp["kids"][depth]
        for k in range(kids):
            t = start + (1 - start) * (k + rnd.uniform(0.1, 0.9)) / kids
            i = min(len(pts) - 2, int(t * (len(pts) - 1)))
            base = pts[i].lerp(pts[i + 1], rnd.random())
            axis = (pts[i + 1] - pts[i]).normalized()
            side = axis.orthogonal().normalized()
            rot = (k * 2.39996 + rnd.uniform(-0.4, 0.4))          # the golden angle round the parent
            side.rotate(_axis_angle(axis, rot))
            ang = math.radians(sp["angle"][depth] + rnd.uniform(-12, 12))
            nd = (axis * math.cos(ang) + side * math.sin(ang)).normalized()
            ln = length * sp["ratio"][depth] * (1.15 - 0.5 * t if sp.get("taper_kids", True) else 1.0) * rnd.uniform(0.8, 1.15)
            rr = rad[i] * sp["rr"]
            self.grow(base, nd, ln, rr, rr * 0.25, depth + 1, sp)

    def build(self, name, bark, leaf, root, segs=8, leaves_per=60, card=(0.16, 0.09), flat=1.0, needles=False):
        """The branches as one tapered tube mesh; the leaves as one mesh of cards scattered round the anchors."""
        bm = bmesh.new()
        for pts, rad in self.branches:
            sg = segs if rad[0] > 0.05 else 5
            rings = []
            for i, (pt, r) in enumerate(zip(pts, rad)):
                a = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
                u = a.orthogonal().normalized()
                v = a.cross(u).normalized()
                rings.append([bm.verts.new(pt + (u * math.cos(2 * math.pi * k / sg) + v * math.sin(2 * math.pi * k / sg)) * r)
                              for k in range(sg)])
            for r0, r1 in zip(rings, rings[1:]):
                for k in range(sg):
                    bm.faces.new((r0[k], r0[(k + 1) % sg], r1[(k + 1) % sg], r1[k]))
            tip = bm.verts.new(pts[-1] + (pts[-1] - pts[-2]).normalized() * rad[-1])
            for k in range(sg):
                bm.faces.new((rings[-1][k], rings[-1][(k + 1) % sg], tip))
        ob = lib._mesh_obj(name + "_wood", bm, bark, root, (0, 0, 0), smooth=True, outline=False)
        ob["no_bevel"] = True
        rnd = self.rnd
        bm = bmesh.new()
        var = []
        for pt, size in self.anchors:
            for k in range(int(leaves_per * size / 0.5)):
                off = Vector((rnd.gauss(0, 0.45), rnd.gauss(0, 0.45), rnd.gauss(0, 0.45 * flat))) * size
                if off.z < -0.2 * size:                  # clumps hang their leaves on top, not under
                    off.z *= 0.4
                c = pt + off
                n = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), abs(rnd.gauss(0, 1)) + 0.6)).normalized()
                u = n.orthogonal().normalized()
                u.rotate(_axis_angle(n, rnd.uniform(0, 2 * math.pi)))
                v = n.cross(u)
                L, W = card[0] * rnd.uniform(0.7, 1.3), card[1] * rnd.uniform(0.7, 1.3)
                if needles:              # a tuft: fine blades fanning from a point
                    for j in range(5):
                        dj = (u * math.cos(j * 1.26) + v * math.sin(j * 1.26) + n * 0.3).normalized()
                        w = dj.cross(n).normalized() * 0.006
                        f = bm.faces.new((bm.verts.new(c - w), bm.verts.new(c + w), bm.verts.new(c + dj * L)))
                        var.append(rnd.random())
                else:
                    q = [c - u * L / 2 - v * W / 2, c + u * L / 2 - v * W / 2 * 0.6, c + u * L / 2 + v * W / 2 * 0.6,
                         c - u * L / 2 + v * W / 2]
                    bm.faces.new([bm.verts.new(x) for x in q])
                    var.append(rnd.random())
        lob = lib._mesh_obj(name + "_leaves", bm, leaf, root, (0, 0, 0), smooth=False, outline=False)
        lob["no_bevel"] = True
        a = lob.data.attributes.new("var", "FLOAT", "FACE")
        a.data.foreach_set("value", var)
        return ob, lob


def _axis_angle(axis, ang):
    from mathutils import Quaternion
    return Quaternion(axis, ang)


def _ground_bits(root, rnd, P, r=0.7):
    """Leaf litter and a few roots round a trunk's foot, so it stands in the ground."""
    for k in range(4):
        a = rnd.uniform(0, 2 * math.pi)
        rod(f"tr_root{k}", (0.05 * math.cos(a), 0.05 * math.sin(a), 0.22), (0.5 * math.cos(a), 0.5 * math.sin(a), 0.0), 0.06,
            P["twig"], parent=root, segs=6, r2=0.02)


SPECIES = {
    # East
    ("E", 0): dict(name="pine", bark="bark_pine", leaf="needles", h=4.2, r=0.17, trunk_up=0.06, wiggle=0.07, up=0.02,
                   depth=2, kids=(7, 4), start=(0.45, 0.2), angle=(78, 50), ratio=(0.42, 0.45), rr=0.5, leafy=3, clump=0.5,
                   leaves=320, card=(0.09, 0.0), flat=0.28, needles=True),
    ("E", 1): dict(name="pine_lean", bark="bark_pine", leaf="needles", h=4.4, r=0.18, lean=(0.5, 0.15), trunk_up=0.0,
                   wiggle=0.1, up=0.0, depth=2, kids=(5, 4), start=(0.5, 0.25), angle=(70, 55), ratio=(0.45, 0.45), rr=0.5,
                   leafy=3, clump=0.55, leaves=320, card=(0.09, 0.0), flat=0.26, needles=True),
    ("E", 2): dict(name="camphor", bark="bark_camphor", leaf="camphor", h=2.4, r=0.2, trunk_up=0.05, wiggle=0.12, up=0.06,
                   depth=3, kids=(4, 3, 3), start=(0.75, 0.3, 0.3), angle=(38, 45, 50), ratio=(0.9, 0.6, 0.55), rr=0.62,
                   leafy=3, clump=0.42, leaves=330, card=(0.07, 0.04), flat=0.75),
    # West
    ("W", 0): dict(name="oak", bark="bark_oak", leaf="oak", h=2.9, r=0.27, trunk_up=0.06, wiggle=0.11, up=0.08,
                   depth=3, kids=(5, 3, 3), start=(0.8, 0.3, 0.3), angle=(46, 44, 44), ratio=(0.7, 0.6, 0.55), rr=0.6,
                   leafy=3, clump=0.42, leaves=320, card=(0.075, 0.05), flat=0.65),
    ("W", 1): dict(name="fir", bark="bark_pine", leaf="needles", h=4.6, r=0.15, trunk_up=0.1, wiggle=0.03, up=-0.02,
                   droop=0.25, depth=1, kids=(26,), start=(0.12,), angle=(80,), ratio=(0.3,), rr=0.4, leafy=5, clump=0.32,
                   leaves=300, card=(0.08, 0.0), flat=0.4, needles=True, taper_kids=True),
    ("W", 2): dict(name="birch", bark="bark_birch", leaf="birch", h=3.6, r=0.1, trunk_up=0.08, wiggle=0.06, up=0.05,
                   droop=0.12, depth=2, kids=(8, 4), start=(0.45, 0.3), angle=(40, 45), ratio=(0.4, 0.5), rr=0.55, leafy=3,
                   clump=0.32, leaves=260, card=(0.05, 0.035), flat=0.85),
}


def tree(root, c, variant=0, state="full"):
    P = _mats(c)
    rnd = random.Random(400 + variant * 7 + (0 if c == "E" else 3))
    if state == "stump":
        stump(root, c, P, rnd)
        return
    sp = SPECIES[(c, variant)]
    T = Tree(rnd)
    trunks = [(0.0, 0.0)] if sp["name"] != "birch" else [(-0.15, 0.05), (0.22, 0.12)]
    for k, (x, y) in enumerate(trunks):
        lean = sp.get("lean", (rnd.uniform(-0.08, 0.08), rnd.uniform(-0.05, 0.05)))
        d = Vector((lean[0], lean[1], 1.0)).normalized()
        h = sp["h"] * (1.0 if k == 0 else 0.82)
        T.grow((x, y, 0.0), d, h, sp["r"] * (1.0 if k == 0 else 0.8), sp["r"] * 0.3, 0, sp)
    T.build("tr", P[sp["bark"]], P[sp["leaf"]], root, leaves_per=sp["leaves"], card=sp["card"], flat=sp["flat"],
            needles=sp.get("needles", False))
    _ground_bits(root, rnd, P)


def stump(root, c, P, rnd):
    """A felled tree: the cut stump with its rings, roots spreading, chips, a few branches left lying."""
    bark = P["bark_pine"] if c == "E" else P["bark_oak"]
    cyl("st_trunk", 0.24, 0.42, bark, root, loc=(0, 0, 0), r2=0.21, segs=16)
    cyl("st_cut", 0.205, 0.03, P["logend"], root, loc=(0, 0, 0.42), segs=16)
    for k in range(5):
        a = 2 * math.pi * k / 5 + rnd.uniform(-0.3, 0.3)
        rod(f"st_root{k}", (0.12 * math.cos(a), 0.12 * math.sin(a), 0.2), (0.55 * math.cos(a), 0.55 * math.sin(a), 0.0), 0.08,
            bark, parent=root, segs=6, r2=0.025)
    for k in range(12):
        box(f"st_chip{k}", (0.08, 0.04, 0.015), P["logend"], root,
            loc=(rnd.uniform(-0.7, 0.7), rnd.uniform(-0.7, 0.7), 0.01), rot=(0, 0, rnd.uniform(0, 180)))
    for k in range(2):
        a = rnd.uniform(0, math.pi)
        x, y = rnd.uniform(-0.4, 0.4), rnd.uniform(-0.6, -0.2)
        rod(f"st_branch{k}", (x - 0.5 * math.cos(a), y - 0.3 * math.sin(a), 0.05), (x + 0.5 * math.cos(a), y + 0.3 * math.sin(a), 0.07),
            0.035, bark, parent=root, segs=6)


# ---------------------------------------------------------------- gold, berries, crystal

def _gold_mats():
    return dict(gold=lib.mat("gold_ore_r8", (0.9, 0.62, 0.2), 0.28, 1.0),
                quartz=lib.mat("quartz_r8", (0.6, 0.58, 0.52), 0.35))


def gold(root, c, variant=0, state="full"):
    import terrain_r8
    rnd = random.Random(600 + variant)
    TP = terrain_r8.mats()
    G = _gold_mats()
    if state == "depleted":
        terrain_r8._apron("go_spill", root, TP, rnd, lambda a: 0.35 + 0 * a, 0.75, 0.22, half=math.pi, stones=34)
        for k in range(3):
            sphere(f"go_fleck{k}", 0.025, G["gold"], root, loc=(rnd.uniform(-0.5, 0.5), rnd.uniform(-0.6, 0.0), 0.06),
                   segs=6, rings=4)
        return
    H = 1.35 if state == "full" else 0.8
    R = (0.75, 0.9) if state == "full" else (0.6, 0.75)
    plan, a, top = terrain_r8._mass("go_rock", root, TP, rnd, radius=R, H=H, nk=7, round_top=0.3, taper=0.25, cap=0.12,
                                    tilt=0.12, fx_mid=rnd.uniform(1.8, 3.6))
    n = 22 if state == "full" else 10
    for k in range(n):                                  # gold in quartz, on the faces toward the camera
        ang = rnd.uniform(-1.3, 1.3)
        z = rnd.uniform(0.2, H * 0.85)
        rr = float(plan(ang)) * (1 - 0.25 * z / H) + 0.02
        x, y = rr * math.sin(ang), -rr * math.cos(ang)
        box(f"go_vein{k}", (rnd.uniform(0.15, 0.35), 0.04, 0.04), G["quartz"], root, loc=(x, y, z),
            rot=(0, rnd.uniform(-30, 30), math.degrees(ang)))
        terrain_r8._rock(f"go_nug{k}", rnd.uniform(0.05, 0.1), G["gold"], root, (x, y - 0.02, z + 0.02), rnd)
    if state == "mined":                                # a dug face propped with timber, a pick, ore on the ground
        wood = lib.mat("timber", (0.2, 0.13, 0.08), 0.8)
        for sx in (-1, 1):
            rod(f"go_prop{sx}", (sx * 0.3, -0.75, 0.0), (sx * 0.27, -0.7, 0.75), 0.05, wood, parent=root, segs=6)
        rod("go_cap", (-0.38, -0.71, 0.75), (0.38, -0.71, 0.75), 0.05, wood, parent=root, segs=6)
        rod("go_pick", (0.6, -0.6, 0.0), (0.75, -0.95, 0.7), 0.02, wood, parent=root, segs=5)
        box("go_pickhead", (0.35, 0.04, 0.05), lib.mat("iron_r8", (0.12, 0.12, 0.13), 0.5, 1.0), root, loc=(0.75, -0.95, 0.7),
            rot=(0, 15, 25))
        for k in range(5):
            terrain_r8._rock(f"go_ore{k}", rnd.uniform(0.05, 0.1), TP["top"] if k % 2 else G["gold"], root,
                             (rnd.uniform(-0.6, 0.2), rnd.uniform(-1.0, -0.75), 0.04), rnd)
    terrain_r8._apron("go_scree", root, TP, rnd, plan, 0.45, 0.15, stones=18)


def berry(root, c, variant=0, state="full"):
    """A berry shrub (a bramble), grown like the trees but low and dense; red berries in bunches on the outside."""
    P = _mats(c)
    rnd = random.Random(700 + variant)
    sp = dict(name="bush", trunk_up=0.0, wiggle=0.2, up=0.08, depth=2, kids=(6, 3), start=(0.05, 0.3), angle=(55, 45),
              ratio=(0.75, 0.55), rr=0.6, leafy=3, clump=0.35, droop=0.1)
    T = Tree(rnd)
    for k in range(3):
        a = 2 * math.pi * k / 3 + rnd.uniform(-0.3, 0.3)
        T.grow((0.1 * math.cos(a), 0.1 * math.sin(a), 0.0), Vector((0.35 * math.cos(a), 0.35 * math.sin(a), 1.0)), 0.75,
               0.035, 0.012, 1, dict(sp, depth=2))
    if state == "depleted":
        T.anchors = T.anchors[::3]
    T.build("be", P["twig"], P["bush"], root, leaves_per=150 if state == "full" else 70, card=(0.07, 0.05), flat=0.8)
    if state == "full":
        for k, (pt, size) in enumerate(T.anchors):
            if rnd.random() < 0.35:
                continue
            for j in range(rnd.randint(5, 9)):
                off = Vector((rnd.gauss(0, 0.06), rnd.gauss(0, 0.06) - 0.05, rnd.gauss(0, 0.05)))
                p = pt + off + Vector((0, -0.12, 0))
                sphere(f"be_b{k}_{j}", 0.03, P["berry"], root, loc=tuple(p), segs=8, rings=6)


def _crystal_mat(dim=False):
    name = "crystal_dim_r8" if dim else "crystal_r8"
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    p.inputs["Base Color"].default_value = (0.05, 0.45, 0.6, 1) if not dim else (0.25, 0.32, 0.35, 1)
    p.inputs["Roughness"].default_value = 0.08
    p.inputs["Transmission Weight"].default_value = 0.6 if not dim else 0.1
    p.inputs["IOR"].default_value = 1.55
    p.inputs["Emission Color"].default_value = (0.02, 0.7, 0.95, 1)
    p.inputs["Emission Strength"].default_value = 3.5 if not dim else 0.0
    lib.MATS.setdefault(name, dict(mat=m, kind="emit" if not dim else "solid", color=(0.1, 0.7, 0.85), emission=1.8))
    return m


def _crystals(name, root, mat, base, size, n, rnd):
    """Hexagonal prisms with pointed tips, fanning out of one point."""
    for k in range(n):
        h = size * rnd.uniform(0.45, 1.0)
        r = size * rnd.uniform(0.07, 0.13)
        a = rnd.uniform(0, 2 * math.pi)
        tilt = rnd.uniform(5, 38)
        rot = (tilt * math.sin(a), tilt * math.cos(a), rnd.uniform(0, 60))
        g = lib.empty(f"{name}{k}", parent=root, loc=(base[0] + rnd.uniform(-0.12, 0.12), base[1] + rnd.uniform(-0.12, 0.12),
                                                      base[2]), rot=rot)
        cyl(f"{name}{k}_p", r, h * 0.8, mat, g, segs=6, smooth=False, outline=False)
        cyl(f"{name}{k}_t", r, h * 0.2, mat, g, loc=(0, 0, h * 0.8), r2=0.0, segs=6, smooth=False, outline=False)


def crystal(root, c, variant=0, state="full"):
    import terrain_r8
    rnd = random.Random(800 + variant)
    TP = terrain_r8.mats()
    dark = lib.mat("cliffrockdark", (0.12, 0.11, 0.1), 0.92)
    TPd = dict(TP, top=dark)
    if state == "depleted":
        plan, a, top = terrain_r8._mass("cr_rock", root, TPd, rnd, radius=(0.55, 0.7), H=0.45, nk=6, round_top=0.3, taper=0.2,
                                        cap=0.06)
        _crystals("cr_stub", root, _crystal_mat(dim=True), (0.0, -0.05, 0.38), 0.35, 5, rnd)
        terrain_r8._apron("cr_scree", root, TP, rnd, plan, 0.4, 0.12, stones=12)
        return
    plan, a, top = terrain_r8._mass("cr_rock", root, TPd, rnd, radius=(0.65, 0.8), H=0.65, nk=6, round_top=0.3, taper=0.2,
                                    cap=0.08)
    m = _crystal_mat()
    _crystals("cr_main", root, m, (0.0, -0.05, 0.55), 1.7, 7, rnd)
    _crystals("cr_side", root, m, (0.45, 0.25, 0.35), 0.8, 4, rnd)
    _crystals("cr_side2", root, m, (-0.45, -0.2, 0.3), 0.6, 3, rnd)
    terrain_r8._apron("cr_scree", root, TP, rnd, plan, 0.45, 0.14, stones=14)


def r8_tree(root, c, variant=0, state="full"):
    tree(root, c, variant, state)


FOOTPRINT = {"r8_tree": (1, 1), "r8_gold": (1, 1), "r8_berry": (1, 1), "r8_crystal": (1, 1)}
BUILDERS = {"r8_tree": r8_tree, "r8_gold": gold, "r8_berry": berry, "r8_crystal": crystal}
