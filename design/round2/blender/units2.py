"""R2 option B/C models for the four sample units (the poses are R1's).

Garments are meshes built in the zero pose and skinned to the same joints as
the body, so robes, skirts and caparisons follow the legs instead of staying
rigid cones. Player colour stays only in banner, surcoat, caparison, skirt, sash.
"""
import math
import os

import bmesh
import bpy

import body2
import humanoid2 as h2
import lib
from humanoid import blend, ease, fall, fall_root_tilt, gallop, idle, walk   # R1 poses
from lib import box, cyl, fx_mat, ico, lathe, mat, rod, slab, sphere

EMBLEM_DIR = os.environ.get("EMBLEM_DIR", "")


def palette(detail):
    P = dict(
        skin=mat("skin2", (0.8, 0.6, 0.46), 0.55, sheen=0.2),
        lacquer=mat("lacquer2", (0.3, 0.2, 0.11), 0.3, 0.35, pattern="lamellar", pattern_scale=16),
        bronze=mat("bronze2", (0.72, 0.5, 0.22), 0.35, 1.0, pattern="worn_metal"),
        steel=mat("steel2", (0.6, 0.62, 0.66), 0.3, 1.0, pattern="worn_metal"),
        mail=mat("mail2", (0.44, 0.45, 0.48), 0.45, 1.0, noise=0.5, noise_scale=160),
        indigo=mat("indigo2", (0.1, 0.13, 0.26), 0.8, sheen=0.4, pattern="cloth", pattern_scale=90),
        dark=mat("darkcloth2", (0.08, 0.075, 0.07), 0.75, pattern="cloth", pattern_scale=90),
        leather=mat("leather2", (0.3, 0.19, 0.1), 0.55, noise=0.25, noise_scale=30),
        boots=mat("boots2", (0.12, 0.09, 0.07), 0.55, noise=0.2, noise_scale=40),
        cream=mat("cream2", (0.74, 0.67, 0.52), 0.8, sheen=0.3, pattern="cloth", pattern_scale=90),
        wood=mat("wood2", (0.42, 0.27, 0.14), 0.6, noise=0.3, noise_scale=6),
        shaft=mat("shaft2", (0.2, 0.12, 0.07), 0.45, noise=0.2, noise_scale=8),
        tassel=mat("tassel2", (0.86, 0.83, 0.76), 0.8, sheen=0.4),
        hair=mat("hair2", (0.06, 0.05, 0.045), 0.6, sheen=0.3),
        horse_bay=mat("bay2", (0.3, 0.16, 0.08), 0.5, sheen=0.5),
        horse_grey=mat("grey2", (0.62, 0.6, 0.57), 0.5, sheen=0.5),
        mane=mat("mane2", (0.06, 0.05, 0.04), 0.7),
        hoof=mat("hoof2", (0.12, 0.1, 0.08), 0.55),
        team=mat("team2", kind="team", rough=0.75, sheen=0.35, pattern="cloth", pattern_scale=90),
        robe=mat("robe2", (0.84, 0.81, 0.72), 0.75, sheen=0.5, pattern="cloth", pattern_scale=110),
        crystal=mat("crystal2", (0.35, 0.95, 1.0), 0.1, emission=3.0, kind="emit"),
        rope=mat("rope2", (0.55, 0.46, 0.3), 0.9),
        gold=mat("gold2", (0.85, 0.62, 0.22), 0.3, 1.0),
    )
    return P


class Unit:
    frames = {"idle": 8, "walk": 8, "attack": 8, "death": 8}

    def __init__(self, kind):
        self.kind = kind
        self.root = lib.empty(kind + "_unit")
        self.rigs = {}

    def face(self, facing):
        self.root.rotation_euler = (0, 0, lib.heading_for(facing))


def _bones_torso(r):
    J = r.j
    return [(J["hips"], (0, 0, 0.84), (0, 0, 1.03)), (J["torso"], (0, 0, 1.03), (0, 0, 1.45))]


def _bones_legs(r, bulk=1.0):
    J = r.j
    out = []
    for side, s in (("R", 1), ("L", -1)):
        x = 0.1 * s * bulk
        out += [(J[f"hip{side}"], (x, 0, 0.92), (x, 0, 0.47)), (J[f"knee{side}"], (x, 0, 0.47), (x, 0, 0.05))]
    return out


def _bones_arm(r, side, bulk=1.0):
    J = r.j
    s = 1 if side == "R" else -1
    x = 0.215 * s * bulk
    return [(J[f"shoulder{side}"], (0.19 * s * bulk, 0, 1.41), (x, 0, 1.14)),
            (J[f"elbow{side}"], (x, 0, 1.14), (x, 0, 0.88))]


def banner2(r, P, h=0.75, w=0.28, fh=0.4, detail="B"):
    """Back banner with a waving flag (subdivided cloth, player colour)."""
    torso = r.j["torso"]
    rod(r.name + "_bpole", (0.06, -0.14, 0.2), (0.06, -0.16, 0.2 + h + 0.6), 0.013, P["shaft"], parent=torso)
    sphere(r.name + "_bfinial", 0.025, P["bronze"], torso, at=(0.06, -0.16, 0.2 + h + 0.63))
    bm = bmesh.new()
    nu, nv = 8, 6
    verts = [[bm.verts.new((0.0, u * w / nu, -v * fh / nv)) for v in range(nv + 1)] for u in range(nu + 1)]
    for u in range(nu):
        for v in range(nv):
            bm.faces.new((verts[u][v], verts[u + 1][v], verts[u + 1][v + 1], verts[u][v + 1]))
    for u in range(nu + 1):
        for v in range(nv + 1):
            vv = verts[u][v]
            vv.co.x = 0.03 * math.sin(u / nu * math.pi * 1.6) * (u / nu)
    ob = lib._mesh_obj(r.name + "_bflag", bm, P["team"], torso, loc=(0.07, -0.16, 0.2 + h + 0.56), rot=(0, 0, -90))
    m = ob.modifiers.new("thick", "SOLIDIFY")
    m.thickness = 0.01
    if detail == "C":
        for k in range(6):   # gold fringe along the bottom edge
            y = w * (k + 0.5) / 6
            rod(f"{r.name}_fringe{k}", (0, y, -fh), (0, y, -fh - 0.05), 0.007, P["gold"], parent=ob,
                outline=False)


def east_helmet2(r, P, detail):
    head = r.j["head"]
    n = r.name
    hr = 0.13
    lathe(n + "_helm", [(0.148, 0.1), (0.152, 0.16), (0.142, 0.23), (0.11, 0.29), (0.05, 0.325), (0.0, 0.33)],
          P["lacquer"], head, segs=24, at=(0, 0, 0.0))
    lathe(n + "_helmrim", [(0.156, 0.085), (0.162, 0.1), (0.158, 0.115)], P["bronze"], head, segs=24)
    box(n + "_brow", (0.2, 0.05, 0.04), P["bronze"], head, at=(0, 0.14, 0.13), bevel=0.01)
    # lamellar neck guard: three layered flaps around the back and sides
    for k, (rr, z0, z1) in enumerate([(0.16, 0.1, 0.02), (0.175, 0.04, -0.05), (0.19, -0.02, -0.1)]):
        ob = lathe(f"{n}_ng{k}", [(rr, z0), (rr + 0.03, z1)], P["lacquer"], head, segs=24, cap=False,
                   at=(0, -0.02, 0))
        # open at the face: delete the front quarter
        me = ob.data
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().y > 0.05], context="FACES")
        bm.to_mesh(me)
        bm.free()
    cyl(n + "_spike", 0.013, 0.1, P["bronze"], head, at=(0, 0, 0.32), r2=0.004)
    sphere(n + "_tassel", 0.045, P["tassel"], head, at=(0, -0.01, 0.43), scale=(1, 1, 1.5))
    if detail == "C":
        for k in range(12):
            a = 2 * math.pi * k / 12
            sphere(f"{n}_rivet{k}", 0.009, P["bronze"], head, at=(0.15 * math.cos(a), 0.15 * math.sin(a), 0.105),
                   outline=False)


def lamellar2(r, P, detail, skirt_len=0.42):
    """Cuirass + tassets skinned to the body; pauldrons rigid on the shoulders."""
    n = r.name
    body2.zero_pose(r)
    tb = _bones_torso(r)
    h2.skinned_lathe(n + "_cuirass", [(0.15, 0.98), (0.172, 1.1), (0.186, 1.24), (0.19, 1.36), (0.16, 1.45)],
                     P["lacquer"], r, tb, scale=(1, 0.72, 1))
    h2.skinned_lathe(n + "_belt", [(0.158, 1.0), (0.162, 1.06)], P["leather"], r, tb, scale=(1, 0.74, 1))
    h2.skinned_lathe(n + "_tassets", [(0.162, 1.0), (0.2, 0.86), (0.235, 0.98 - skirt_len)], P["lacquer"], r,
                     tb[:1] + _bones_legs(r), scale=(1, 0.8, 1))
    for side, s in (("R", 1), ("L", -1)):
        sh = r.j["shoulder" + side]
        lathe(f"{n}_pauld{side}", [(0.0, 0.07), (0.07, 0.06), (0.1, 0.0), (0.105, -0.07)], P["lacquer"], sh,
              segs=16, at=(0.02 * s, 0, 0.0), scale=(1.1, 1.0, 1.0))
        if detail == "C":
            lathe(f"{n}_bracer{side}", [(0.05, -0.05), (0.052, -0.2)], P["leather"], r.j["elbow" + side], segs=12)
    r.pose()


def spear2(r, P, detail, length=2.7):
    g = r.joint("grip_spear", r.j["wristR"], (0, 0, -0.05))
    rod(r.name + "_shaft", (0, 0, 1.0), (0, 0, -length + 1.0), 0.02, P["shaft"], parent=g)
    # leaf blade: tip at the far end (-z), widest a third of the way back
    lathe(r.name + "_blade", [(0.0, 0.0), (0.03, 0.1), (0.036, 0.2), (0.012, 0.3)], P["steel"], g,
          segs=8, at=(0, 0, -length + 0.7), scale=(1, 0.35, 1))
    cyl(r.name + "_socket", 0.024, 0.08, P["bronze"], g, at=(0, 0, -length + 1.0 - 0.02))
    sphere(r.name + "_speartassel", 0.042, P["tassel"], g, at=(0, 0, -length + 1.1), scale=(1, 1, 1.4))
    return g


def attack_spear(t):
    import units as U1   # R1 spear attack keeps the same timing
    return U1.spear_attack(t)


def pose_generic(u, r, anim, frame, attack_fn):
    n = u.frames.get(anim, 8)
    t = (frame % n) / n
    r.root.rotation_euler = (0, 0, 0)
    if anim == "idle":
        a, o = idle(t)
        a = dict(attack_fn(0.0)[0], **{k: v for k, v in a.items() if k.startswith(("torso", "neck", "hip"))})
        r.pose(a, o)
    elif anim == "walk":
        a, o = walk(t, arms=False)
        a.update({k: v for k, v in attack_fn(0.0)[0].items() if k.startswith(("shoulder", "elbow", "wrist"))})
        r.pose(a, o)
    elif anim in ("attack", "chop", "mine"):
        a, o = attack_fn(t)
        r.pose(a, o)
    elif anim == "death":
        tt = frame / max(1, n - 1)
        a, o = fall(tt)
        r.pose(a, o)
        r.root.rotation_euler = [x * lib.D2R for x in fall_root_tilt(tt)]


def build_spear_e(P, detail):
    u = Unit("spear_e")
    r = h2.humanoid2("spear_e", P["skin"], P["indigo"], P["dark"], P["boots"], detail=detail, parent=u.root,
                     beard=P["hair"])
    u.rigs["body"] = r
    lamellar2(r, P, detail)
    east_helmet2(r, P, detail)
    banner2(r, P, detail=detail)
    spear2(r, P, detail)

    def pose(anim, frame):
        pose_generic(u, r, anim, frame, attack_spear)
        h2.update(r)
    u.pose = pose
    return u


# ---------------------------------------------------------------- horses with armour / caparison

def drape(name, stations, material, rig, bones, zb_default=0.6, segs=18):
    """Cloth hanging over a horse: arch over the back, straight sides down to a hem.
    stations: [(y, zc, half_width, half_height_above_centre, z_hem)]"""
    bm = bmesh.new()
    loops = []
    for y, zc, w, hh, zb in stations:
        ring = []
        for k in range(segs + 1):
            a = math.pi * k / segs               # 0 = right side, pi = left side, over the top
            x = w * math.cos(a)
            z = zc + hh * math.sin(a)
            ring.append((x, y, z))
        # add the hanging sides below the arch
        full = [(w, y, zb), (w, y, (zb + zc) / 2)] + ring + [(-w, y, (zb + zc) / 2), (-w, y, zb)]
        loops.append([bm.verts.new(p) for p in full])
    for i in range(len(loops) - 1):
        for k in range(len(loops[i]) - 1):
            bm.faces.new((loops[i][k], loops[i][k + 1], loops[i + 1][k + 1], loops[i + 1][k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name + "_raw")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name + "_raw", me)
    bpy.context.scene.collection.objects.link(ob)
    ss = ob.modifiers.new("sub", "SUBSURF")
    ss.levels = 1
    so = ob.modifiers.new("thick", "SOLIDIFY")
    so.thickness = 0.015
    dg = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    out = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(out)
    mesh.materials.clear()
    mesh.materials.append(material)
    for p in mesh.polygons:
        p.use_smooth = True
    lib.ALL_PARTS.append(out)
    lib._add_hull(out)
    bpy.context.view_layer.update()
    rig.skinners.append(body2.Skinner(out, bones, base=rig.root.matrix_world.copy()))
    return out


def horse_bones(hr):
    J = hr.j
    b = [(J["body"], (0, -0.62, 1.2), (0, 0.55, 1.2)), (J["neck"], (0, 0.62, 1.36), (0, 0.99, 1.83))]
    for leg, (x, y) in {"FR": (0.16, 0.5), "FL": (-0.16, 0.5), "BR": (0.17, -0.52), "BL": (-0.17, -0.52)}.items():
        b += [(J[f"leg{leg}"], (x, y, 1.08), (x, y, 0.58)), (J[f"low{leg}"], (x, y, 0.58), (x, y, -0.02))]
    return b


def caparison(hr, P, detail, mat_top, mat_skirt, zb=0.62):
    """Knight: full cloth over body and neck.  Armoured horse: lamellar top + player-colour skirt."""
    n = hr.name
    st = [(-0.82, 1.26, 0.25, 0.14, zb + 0.05), (-0.6, 1.22, 0.34, 0.22, zb), (-0.3, 1.2, 0.36, 0.24, zb),
          (0.0, 1.19, 0.36, 0.25, zb), (0.3, 1.2, 0.35, 0.24, zb), (0.52, 1.26, 0.3, 0.22, zb + 0.02),
          (0.64, 1.36, 0.22, 0.18, zb + 0.1)]
    bones = horse_bones(hr)
    drape(n + "_capa", st, mat_top, hr, bones)
    if mat_skirt is not mat_top:   # a second, lower hem band in the player colour
        st2 = [(y, zc - 0.18, w + 0.012, hh * 0.5, z) for y, zc, w, hh, z in st]
        drape(n + "_capskirt", st2, mat_skirt, hr, bones)
    # neck cover
    J = hr.j
    body2.loft(n + "_neckcover", [((0, 0.62, 1.4), 0.19, 0.24), ((0, 0.78, 1.62), 0.14, 0.17),
                                   ((0, 0.93, 1.82), 0.1, 0.11)], mat_top, subsurf=1)
    hr.skinners.append(body2.Skinner(lib.ALL_PARTS[-1], [(J["body"], (0, 0.4, 1.3), (0, 0.62, 1.36)),
                                                         (J["neck"], (0, 0.62, 1.36), (0, 0.99, 1.83))],
                                     base=hr.root.matrix_world.copy()))
    if detail == "C":
        for k in range(14):   # tassels along the hem
            y = -0.7 + k * 0.1
            for s in (-1, 1):
                sphere(f"{n}_hemt{k}{s}", 0.022, P["gold"], J["body"], at=(0.37 * s, y, zb - 1.18 - 0.02),
                       scale=(1, 1, 1.6), outline=False)


def build_cav(kind, P, detail):
    u = Unit(kind)
    east = kind == "hcav_e"
    hr = h2.horse2(kind + "_h", P["horse_bay"] if east else P["horse_grey"], P["mane"], P["hoof"], detail=detail,
                   parent=u.root)
    u.rigs["horse"] = hr
    if east:
        caparison(hr, P, detail, P["lacquer"], P["team"])
        box(kind + "_chamfron", (0.2, 0.18, 0.4), P["bronze"], hr.j["head"], at=(0, 0.02, 0.2), taper=(0.75, 0.8),
            bevel=0.03)
        sphere(kind + "_plume", 0.1, P["team"], hr.j["head"], at=(0, -0.1, -0.1), scale=(1, 1, 1.7))
    else:
        caparison(hr, P, detail, P["team"], P["team"])
        try:
            fm = lib.flag_mat("knight_emblem2", os.path.join(EMBLEM_DIR, "twintowers.png"))
            for s in (-1, 1):
                slab(f"{kind}_capemb{s}", [(-0.26, -0.26), (0.26, -0.26), (0.26, 0.26), (-0.26, 0.26)], 0.01, fm,
                     parent=hr.j["body"], loc=(0.385 * s, -0.25, -0.18), rot=(0, 0, 90), outline=False)
        except RuntimeError:
            pass
        box(kind + "_chamfron", (0.19, 0.17, 0.38), P["steel"], hr.j["head"], at=(0, 0.02, 0.2), taper=(0.75, 0.8),
            bevel=0.03)
    rider = h2.humanoid2(kind + "_r", P["skin"], P["indigo"] if east else P["mail"],
                         P["dark"] if east else P["mail"], P["boots"] if east else P["steel"], detail=detail,
                         parent=hr.j["saddle"], beard=P["hair"])
    u.rigs["body"] = rider
    rider.root.location = (0, 0, -0.93)          # hips sit on the saddle (as in R1)
    if east:
        lamellar2(rider, P, detail, skirt_len=0.3)
        east_helmet2(rider, P, detail)
        banner2(rider, P, h=0.8, w=0.3, fh=0.44, detail=detail)
    else:
        body2.zero_pose(rider)
        h2.skinned_lathe(kind + "_r_surcoat", [(0.155, 1.45), (0.18, 1.3), (0.172, 1.1), (0.2, 0.95), (0.26, 0.6)],
                         P["team"], rider, _bones_torso(rider) + _bones_legs(rider), scale=(1, 0.75, 1))
        rider.pose()
        head = rider.j["head"]
        lathe(kind + "_helm", [(0.155, -0.02), (0.16, 0.2), (0.15, 0.3), (0.1, 0.34), (0.0, 0.345)], P["steel"],
              head, segs=24)
        box(kind + "_slit", (0.2, 0.04, 0.022), lib.mat("dark_slit", (0.03, 0.03, 0.03), 0.6), head,
            at=(0, 0.15, 0.17), outline=False)
        if detail == "C":
            box(kind + "_cross", (0.03, 0.03, 0.3), P["gold"], head, at=(0, 0.155, 0.12))
            for k in range(6):
                sphere(f"{kind}_breath{k}", 0.008, lib.mat("dark_slit", (0.03, 0.03, 0.03), 0.6), head,
                       at=(0.04 + (k % 3) * 0.02, 0.15, 0.06 - (k // 3) * 0.03), outline=False)
        sh = lib.empty(kind + "_shieldj", parent=rider.j["elbowL"], loc=(-0.08, 0.02, -0.14))
        fm = lib.flag_mat("shield_emblem2", os.path.join(EMBLEM_DIR, "twintowers.png"))
        heater = [(-0.2, 0.22), (0.2, 0.22), (0.2, 0.0), (0.12, -0.2), (0, -0.3), (-0.12, -0.2), (-0.2, 0.0)]
        slab(kind + "_shield", heater, 0.04, fm, parent=sh, rot=(0, 0, 90))
    g = rider.joint("grip_lance", rider.j["wristR"], (0, 0, -0.05))
    rod(kind + "_lance", (0, 0, 1.0), (0, 0, -2.3), 0.024, P["shaft"] if east else P["team"], parent=g, r2=0.014)
    lathe(kind + "_lancetip", [(0.0, 0.0), (0.032, 0.24), (0.014, 0.3)], P["steel"], g, segs=8,
          at=(0, 0, -2.6))
    rider.rest.update({"shoulderR": (45, 0, -12), "elbowR": (60, 0, 0)})
    import units as U1

    def pose(anim, frame):
        n = u.frames.get(anim, 8)
        t = (frame % n) / n
        ha, ho = gallop(t) if anim in ("walk", "attack") else gallop(0, amp=0.1)
        hr.pose(ha, ho)
        ra = dict(rider.rest)
        ra.update(U1.rider_pose(t))
        rider.pose(ra, {})
        h2.update(hr)
        h2.update(rider)
    u.pose = pose
    return u


# ---------------------------------------------------------------- mage

def build_mage_e(P, detail):
    import units as U1
    u = Unit("mage_e")
    r = h2.humanoid2("mage_e", P["skin"], P["robe"], P["robe"], P["boots"], detail=detail, parent=u.root,
                     bulk=0.92, head_r=0.125, sleeve_skin=False)
    u.rigs["body"] = r
    body2.zero_pose(r)
    b = 0.92
    tb = _bones_torso(r)
    legs = _bones_legs(r, b)
    h2.skinned_lathe("mage_e_robe", [(0.16, 1.42), (0.175, 1.22), (0.17, 1.02), (0.22, 0.7), (0.3, 0.35),
                                     (0.37, 0.05)], P["robe"], r, tb + legs, scale=(1, 0.86, 1), segs=32)
    h2.skinned_lathe("mage_e_hem", [(0.372, 0.04), (0.378, 0.14)], P["team"], r, tb + legs, scale=(1, 0.86, 1),
                     segs=32)
    h2.skinned_lathe("mage_e_hemglow", [(0.36, 0.17), (0.365, 0.2)], P["crystal"], r, tb + legs,
                     scale=(1, 0.86, 1), segs=32)
    h2.skinned_lathe("mage_e_sash", [(0.176, 0.98), (0.18, 1.08)], P["team"], r, tb, scale=(1, 0.8, 1))
    for side, s in (("R", 1), ("L", -1)):
        x = 0.215 * s * b
        h2.skinned_lathe(f"mage_e_sleeve{side}", [(0.075, 1.42), (0.08, 1.2), (0.12, 1.02), (0.17, 0.9)],
                         P["robe"], r, _bones_arm(r, side, b), at=(x, 0, 0), segs=16)
        h2.skinned_lathe(f"mage_e_cuff{side}", [(0.168, 0.9), (0.172, 0.93)], P["crystal"], r,
                         _bones_arm(r, side, b), at=(x, 0, 0), segs=16)
    r.pose()
    J = r.j
    # crossed collar (dark inner robe showing in a V)
    for s in (-1, 1):
        box(f"mage_e_collar{s}", (0.05, 0.02, 0.3), P["dark"], J["torso"], at=(0.04 * s, 0.1, 0.3),
            rot=(0, -22 * s, 0))
    sphere("mage_e_hair", 0.135, P["hair"], J["head"], at=(0, -0.02, 0.15), scale=(1, 1, 0.95))
    cyl("mage_e_knot", 0.055, 0.1, P["hair"], J["head"], at=(0, -0.02, 0.27))
    lathe("mage_e_crown", [(0.07, 0.3), (0.1, 0.38), (0.06, 0.46)], P["gold"], J["head"], segs=12)
    ico("mage_e_gem", 0.05, P["crystal"], J["head"], at=(0, 0.06, 0.4), subdiv=1, smooth=False)
    halo = r.joint("halo", J["head"], (0, 0, 0.62))
    for k in range(3):
        a = 2 * math.pi * k / 3
        ico(f"mage_e_float{k}", 0.055, P["crystal"], halo, at=(0.2 * math.cos(a), 0.2 * math.sin(a), 0),
            subdiv=1, smooth=False, scale=(0.7, 0.7, 1.5), outline=False)
    g = r.joint("grip_seal", J["wristR"], (0, 0.02, -0.1))
    box("mage_e_seal", (0.17, 0.17, 0.14), P["bronze"], g, at=(0, 0, -0.03), bevel=0.014)
    box("mage_e_sealface", (0.15, 0.02, 0.12), P["crystal"], g, at=(0, 0.09, -0.03), outline=False)
    sphere("mage_e_sealknob", 0.04, P["bronze"], g, at=(0, 0, 0.06))
    if detail == "C":
        for k in range(5):   # jade beads on the seal cord
            sphere(f"mage_e_bead{k}", 0.014, lib.mat("jade", (0.25, 0.55, 0.45), 0.3), g,
                   at=(0.0, -0.02, 0.1 + k * 0.03), outline=False)
        for s in (-1, 1):   # ribbons from the crown
            slab(f"mage_e_ribbon{s}", [(0, 0), (0.03, 0), (0.04, -0.55), (0.0, -0.5)], 0.008, P["team"],
                 parent=J["head"], loc=(0.07 * s, -0.08, 0.34), rot=(-12, 0, 8 * s))
    # effects reuse R1's builder pieces
    shield = ico("fx_shield_ob", 0.78, fx_mat("fx_shield", U1.CRYSTAL, strength=1.5, alpha=0.7, fresnel=True,
                                               hex_pattern=True), u.root, at=(0, 0, 0.95), subdiv=3,
                 scale=(1, 1, 1.18), fx=True)

    def pose(anim, frame):
        t = (frame % 12) / 12
        if anim == "walk":
            a, o = walk(t, arms=True, stride=22)
        elif anim == "cast":
            a = {"shoulderR": (86, 0, -6), "elbowR": (8, 0, 0), "wristR": (-10, 0, 0), "shoulderL": (50, 0, 30),
                 "elbowL": (110, 0, 0), "torso": (-6, 0, -8), "hipR": (-6, 0, -6), "hipL": (12, 0, 6),
                 "kneeL": (-10, 0, 0)}
            o = {}
        else:
            a, o = idle(t)
        r.pose(a, o)
        halo.rotation_euler = (0, 0, t * 2 * math.pi / 3)
        h2.update(r)
    u.pose = pose
    return u


def build(kind, variant=0, detail="B"):
    P = palette(detail)
    if kind == "spear_e":
        return build_spear_e(P, detail)
    if kind in ("hcav_e", "knight_w"):
        return build_cav(kind, P, detail)
    if kind == "mage_e":
        return build_mage_e(P, detail)
    import buildings2
    return buildings2.build(kind, variant, detail)
