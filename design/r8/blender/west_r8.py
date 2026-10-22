"""R8 (D-093): the West units as High Middle Ages soldiers of about 1250 (the Morgan / Maciejowski Bible), from ceo's
reference note (research/west-reference/notes.md, 給美術的要點) and ceo's decisions of 2026-10-21:
- 長矛兵: a gambeson with upright quilting, a kettle hat, a plain surcoat in the player's colour, a falchion; a
  two-handed pike, no shield (a design choice: two-handed pike formations are clear from about 1298/1302).
- 長弓兵: an undyed knee-length tunic, the hood with its shoulder cape in the player's colour, a bracer; a self bow
  about as tall as the archer, the arrows in a sheaf at the belt (never on the back).
- 騎士: mail, a surcoat in the player's colour, a flat-topped great helm, the heater shield with the kingdom's arms;
  the realistic horse (horse_r8) in a cloth caparison of the player's colour; a wooden lance with a pennon.
- 村民: an undyed knee-length belted tunic, linen braies, a white linen coif and a hood in the player's colour.
- 晶術師: the closed round cloak of the masters (black, heel-length), its hood up, in the player's colour on the hood;
  the long beard and the staff of wood and roots holding the crystal are design choices; the girdle book is a leather
  bag at the belt. No pointed hat.
- 投石機: a counterweight trebuchet on a fixed timber frame (built in siege_w_r8).
Built in the zero pose before anims.extend and before the MPFB body (r8.before_extend); head parts in the old head's
frame, which human_r7 shrinks to a real head, sized over the MPFB head (east_r8._hair_cap).
"""
import math

import bpy
import numpy as np

import body2
import humanoid2 as h2
import lib
import mage4
import units2
from east_r8 import _cut, _gone, _hair_cap, _materials, _sock
from lib import box, cyl, lathe, rod, slab, sphere


def quilted(name, colour, stitch=(0.2, 0.18, 0.14)):
    """A gambeson's cloth with upright quilting: dark stitch lines every 4 cm round the body (from the part's rest
    coordinates, "rest"); the cloth puffs between them."""
    if name in lib.MATS:
        return lib.MATS[name]["mat"]
    m = lib.mat(name, colour, 0.85)
    nt = m.node_tree
    p = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    for n in list(nt.nodes):
        if n.bl_idname not in ("ShaderNodeBsdfPrincipled", "ShaderNodeOutputMaterial"):
            nt.nodes.remove(n)
    N, L = nt.nodes.new, nt.links.new

    def op(kind, a, b=None):
        n = N("ShaderNodeMath")
        n.operation = kind
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L(v, n.inputs[i])
        return n.outputs[0]
    at = N("ShaderNodeAttribute")
    at.attribute_name = "rest"
    xyz = N("ShaderNodeSeparateXYZ")
    L(at.outputs["Vector"], xyz.inputs[0])
    u = op("MULTIPLY", op("ARCTAN2", xyz.outputs["Y"], xyz.outputs["X"]), 0.18 / 0.04)
    f = op("FRACT", u)
    puff = op("SINE", op("MULTIPLY", f, math.pi))          # 0 at the seams, 1 between
    ramp = N("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (*stitch, 1)
    ramp.color_ramp.elements[1].position = 0.35
    ramp.color_ramp.elements[1].color = (*colour, 1)
    L(puff, ramp.inputs["Fac"])
    L(ramp.outputs["Color"], p.inputs["Base Color"])
    p.inputs["Roughness"].default_value = 0.85
    bump = N("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.5
    bump.inputs["Distance"].default_value = 0.006
    L(puff, bump.inputs["Height"])
    L(bump.outputs["Normal"], p.inputs["Normal"])
    return m


def _west_materials():
    M = _materials()
    M.update(
        undyed=lib.mat("linen_w", (0.66, 0.6, 0.48), 0.85),                      # undyed wool / linen
        braies=lib.mat("cream_w", (0.82, 0.79, 0.7), 0.85),                      # white linen
        hose=lib.mat("russet_w", (0.33, 0.17, 0.11), 0.85),                      # madder red-brown, faded
        gambeson=quilted("gambeson_r8", (0.72, 0.64, 0.48)),
        mail=lib.mat("mail_w", (0.42, 0.43, 0.45), 0.45, 0.9),
        wood=lib.mat("wood5", (0.42, 0.27, 0.14), 0.7, noise=0.3, noise_scale=6),
        cloak=lib.mat("robe_w", (0.06, 0.06, 0.07), 0.75),                       # the masters' black
        bag=lib.mat("leather_w", (0.25, 0.15, 0.08), 0.55),
    )
    return M


def _body_cloth(kind, tunic=None, trousers=None):
    """The material human_r7 dresses the MPFB body in (our hidden body's slots: 0 tunic, 1 trousers)."""
    for ob in bpy.data.objects:
        if ob.name.split(".")[0] == f"{kind}_body" and ob.type == "MESH":
            if tunic is not None:
                ob.data.materials[0] = tunic
            if trousers is not None and len(ob.data.materials) > 1:
                ob.data.materials[1] = trousers


def _skirt(r, name, mat, top=1.12, bottom=0.55, slit=None, flare=1.0):
    """A garment from the waist down over the MPFB body (sizes as east_r8._robe_hem), to `bottom`."""
    tb, lg = units2._bones_torso(r), units2._bones_legs(r)
    prof = [(0.16, 1.12), (0.185, 1.0), (0.232, 0.86), (0.25 * flare, 0.62), (0.254 * flare, 0.42),
            (0.258 * flare, 0.33)]
    prof = [p for p in prof if bottom - 1e-6 <= p[1] <= top + 1e-6]
    cut = (lambda c: abs(c.y) < 0.035 and c.z < slit) if slit else None
    return mage4.folded_lathe(name, prof, mat, r, tb[:1] + lg, folds=(9, 0.035), scale=(1, 0.9, 1), cut=cut)


def _chest(r, name, mat, top=1.47, bottom=1.0, sy=0.8):
    """A garment over the MPFB chest (R8_DEBUG girth: half-width 0.186 at 1.3 m, the clothes 1.4 cm out)."""
    tb = units2._bones_torso(r)
    prof = [(0.18, 1.0), (0.2, 1.1), (0.212, 1.25), (0.214, 1.35), (0.19, 1.44), (0.13, 1.5)]
    prof = [p for p in prof if bottom - 1e-6 <= p[1] <= top + 1e-6]
    return h2.skinned_lathe(name, prof, mat, r, tb, scale=(1, sy, 1))


def _hood(r, name, mat, up=False):
    """The hood with its short shoulder cape (連肩頭巾), its edge cut into points; down on the shoulders or up over
    the head."""
    tb = units2._bones_torso(r)
    cape = lathe(f"{name}cape", [(0.1, 1.52), (0.215, 1.47), (0.262, 1.38), (0.27, 1.3)], mat, None, segs=32,
                 scale=(1, 0.82, 1), cap=False)
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(cape.data)
    for v in bm.verts:
        if v.co.z < 1.31:
            th = math.atan2(v.co.y, v.co.x)
            v.co.z -= 0.04 * (1 if int((th + math.pi) / (2 * math.pi) * 18) % 2 else 0)
    bm.to_mesh(cape.data)
    bm.free()
    bpy.context.view_layer.update()
    r.skinners.append(body2.Skinner(cape, tb + [b for side in "RL" for b in units2._bones_arm(r, side)[:1]],
                                    base=r.root.matrix_world.copy()))
    return cape


def _hood_head(r, mat, name):
    """The hood over the head (on the head joint, the old head's frame), open at the face, its tail (liripipe kept
    short: the long tail is 14th-century) hanging at the back."""
    head = r.j["head"]
    hood = lathe(name, [(0.21, -0.06), (0.2, 0.05), (0.186, 0.17), (0.17, 0.26), (0.13, 0.33), (0.06, 0.375),
                        (0.0, 0.385)], mat, head, segs=28, at=(0, 0.0, 0))
    _cut(hood, lambda c: c.y > 0.07 and -0.04 < c.z < 0.3)               # the face opening
    rod(f"{name}tail", (0, -0.16, 0.3), (0, -0.3, 0.12), 0.05, mat, parent=head, r2=0.01)
    return head


def dress_pike(u):
    """長矛兵: the 1181 Assize's commoner (gambeson, iron hat, spear) with the richer man's plain surcoat in the player's
    colour; R5's steel shoulder plates go (plate is 14th-century); a falchion at the left hip; the pike rebuilt
    3.6 m long and held in both hands (r8.spear_two_hands)."""
    kind = "pike_w"
    r = u.rigs["body"]
    M = _west_materials()
    _gone(kind, ["gambeson", "surcoat", "belt", "spaulder*", "kettle", "kettlerim", "kettleridge", "chin*", "shaft",
                 "tip", "langet*"])
    _body_cloth(kind, tunic=M["gambeson"], trousers=M["hose"])
    body2.zero_pose(r)
    tb, lg = units2._bones_torso(r), units2._bones_legs(r)
    _chest(r, f"{kind}_r8gambeson", M["gambeson"])
    _skirt(r, f"{kind}_r8gambesonskirt", M["gambeson"], bottom=0.62)
    # the surcoat over it, to below the knee, slit front and back (sleeveless)
    sur = [(0.13, 1.5), (0.205, 1.44), (0.225, 1.3), (0.222, 1.12), (0.2, 1.0), (0.245, 0.86), (0.262, 0.62),
           (0.268, 0.48)]
    mage4.folded_lathe(f"{kind}_r8surcoat", sur, M["team"], r, tb + lg, folds=(9, 0.03), scale=(1, 0.82, 1),
                       cut=lambda c: (abs(c.x) < 0.03 and c.z < 0.8) or (abs(c.x) > 0.2 and c.z > 1.18))
    h2.skinned_lathe(f"{kind}_r8belt", [(0.205, 0.99), (0.209, 1.04)], M["belt"], r, tb, scale=(1, 0.85, 1))
    r.pose()
    head = r.j["head"]
    # kettle hat (chapel de fer): a crown over the MPFB head, a broad brim
    lathe(f"{kind}_r8kettle", [(0.31, 0.105), (0.3, 0.125), (0.182, 0.15), (0.178, 0.25), (0.15, 0.32), (0.08, 0.36),
                               (0.0, 0.372)], M["iron"], head, segs=32, at=(0, 0.02, 0))
    lathe(f"{kind}_r8kettlerim", [(0.31, 0.098), (0.318, 0.112), (0.31, 0.126)], M["iron"], head, segs=32,
          at=(0, 0.02, 0), cap=False)
    for s in (-1, 1):
        rod(f"{kind}_r8chin{s}", (0.15 * s, 0.02, 0.13), (0.05 * s, 0.1, -0.05), 0.006, M["belt"], parent=head,
            outline=False)
    # falchion: a broad single-edged blade with a cross guard, scabbarded at the left hip
    root = lib.empty(f"{kind}_r8falchionroot", parent=r.j["hips"], loc=(-0.21, 0.04, 0.04), rot=(-58, 0, -6))
    box(f"{kind}_r8scabbard", (0.06, 0.022, 0.7), M["bag"], root, at=(0, 0, -0.38), bevel=0.008)
    box(f"{kind}_r8guard", (0.16, 0.025, 0.025), M["iron"], root, at=(0, 0, 0.0), bevel=0.004)
    cyl(f"{kind}_r8grip", 0.015, 0.11, M["bag"], root, at=(0, 0, 0.015))
    sphere(f"{kind}_r8pommel", 0.022, M["iron"], root, at=(0, 0, 0.14), scale=(1, 0.6, 1))
    # the pike: ash, the rear hand 0.45 m from the butt, a leaf head with langets
    g = r.j["grip_pike"]
    rod(f"{kind}_r8shaft", (0, 0, 0.45), (0, 0, -2.85), 0.02, M["wood"], parent=g)
    lathe(f"{kind}_r8head", [(0.0, 0.0), (0.028, 0.08), (0.03, 0.18), (0.012, 0.3)], M["steel"], g, segs=8,
          at=(0, 0, 2.85), rot=(180, 0, 0), scale=(1, 0.38, 1))           # (turned: z 2.85..3.15 becomes -2.85..-3.15)
    cyl(f"{kind}_r8socket", 0.023, 0.08, M["iron"], g, at=(0, 0, -2.9))
    for s in (-1, 1):
        box(f"{kind}_r8langet{s}", (0.008, 0.014, 0.28), M["iron"], g, at=(0.021 * s, 0, -2.72))
    return u


def dress_bow(u):
    """長弓兵: an undyed tunic (R5's moss green goes), the hood and its cape in the player's colour (R5's tabard goes),
    the arrows in a sheaf at the belt, right hip (R5's back quiver goes: no medieval evidence for one)."""
    kind = "bow_w"
    r = u.rigs["body"]
    M = _west_materials()
    _gone(kind, ["tabard", "belt", "cape", "hood", "hoodtail", "quiver", "arrow*", "fletch*"])
    _body_cloth(kind, tunic=M["undyed"], trousers=M["hose"])
    body2.zero_pose(r)
    tb = units2._bones_torso(r)
    _chest(r, f"{kind}_r8tunic", M["undyed"])
    _skirt(r, f"{kind}_r8tunicskirt", M["undyed"], bottom=0.55, slit=0.75)
    h2.skinned_lathe(f"{kind}_r8belt", [(0.198, 0.99), (0.202, 1.04)], M["belt"], r, tb, scale=(1, 0.88, 1))
    _hood(r, f"{kind}_r8hood", M["team"])
    r.pose()
    _hood_head(r, M["team"], f"{kind}_r8hoodhead")
    # a sheaf of arrows through the belt at the right hip, points down, feathers up
    sh = lib.empty(f"{kind}_r8sheafroot", parent=r.j["hips"], loc=(0.21, -0.02, 0.06), rot=(8, -10, 0))
    for k in range(7):
        a = k * 0.9
        dx, dy = 0.018 * math.cos(a), 0.018 * math.sin(a)
        rod(f"{kind}_r8sheaf{k}", (dx, dy, -0.55), (dx, dy, 0.2), 0.005, M["wood"], parent=sh, outline=False)
        slab(f"{kind}_r8sheaffl{k}", [(0, 0), (0.022, 0.02), (0.022, 0.1), (0, 0.09)], 0.003, M["horn"], parent=sh,
             loc=(dx, dy, 0.1), rot=(0, 0, 50 * k), outline=False)
    lathe(f"{kind}_r8sheafband", [(0.04, -0.02), (0.042, 0.02)], M["belt"], sh, segs=12, cap=False)
    return u


def dress_farmer(u):
    """村民: an undyed knee-length tunic, belted (R5's russet one sat inside the MPFB body), white linen braies, a
    white linen coif and the hood with its cape in the player's colour (R5's bib apron and kerchief go)."""
    kind = "farmer_w"
    r = u.rigs["body"]
    M = _west_materials()
    _gone(kind, ["tunic", "belt", "apron", "strap*", "scarf", "knot", "scarftail*"])
    _body_cloth(kind, tunic=M["undyed"], trousers=M["braies"])
    body2.zero_pose(r)
    tb = units2._bones_torso(r)
    _chest(r, f"{kind}_r8tunic", M["undyed"])
    _skirt(r, f"{kind}_r8tunicskirt", M["undyed"], bottom=0.55, slit=0.75)
    h2.skinned_lathe(f"{kind}_r8belt", [(0.198, 0.99), (0.202, 1.04)], M["belt"], r, tb, scale=(1, 0.88, 1))
    _hood(r, f"{kind}_r8hood", M["team"])
    r.pose()
    head = _hair_cap(r, M, M["braies"], f"{kind}_r8coif")                 # the coif: white linen, tied under the chin
    for s in (-1, 1):
        rod(f"{kind}_r8coiftie{s}", (0.13 * s, 0.06, 0.08), (0.03 * s, 0.12, -0.08), 0.008, M["braies"], parent=head,
            outline=False)
    return u


def dress_mage(u):
    """晶術師: the masters' closed round cloak (1215 Paris statute: black, round, to the heels) with its hood up in the
    player's colour; the wide sleeves go (narrow sleeves of the gown under it), the cream stole and the cap go; the
    book in a leather bag at the belt; the staff of wood and roots (R5) stays: no metal near the crystal."""
    kind = "mage_w"
    r = u.rigs["body"]
    M = _west_materials()
    _gone(kind, ["stole*", "cap", "hair", "sleeveR", "sleeveL", "cuffR", "cuffL", "book"])
    for ob in bpy.data.objects:
        if ob.name.split(".")[0] == "mage_w_robe" and ob.type == "MESH":
            ob.data.materials[0] = M["cloak"]
    _body_cloth(kind, tunic=M["cloak"], trousers=M["cloak"])
    r.pose()
    _hood_head(r, M["team"], f"{kind}_r8hood")
    hips = r.j["hips"]
    bag = lib.empty(f"{kind}_r8bagroot", parent=hips, loc=(-0.22, 0.05, -0.04), rot=(0, 0, 20))
    box(f"{kind}_r8bag", (0.07, 0.15, 0.2), M["bag"], bag, at=(0, 0, -0.1), bevel=0.03)
    rod(f"{kind}_r8bagstrap", (0, 0, 0.0), (0.03, 0.02, 0.12), 0.01, M["bag"], parent=bag, outline=False)
    return u


def dress_knight(u):
    """騎士 (about 1250): mail under a surcoat of the player's colour, slit front and back for the saddle; a flat-topped
    great helm with its eye slit and breaths; R2's heater shield with the kingdom's arms stays; the lance in ash with a
    two-tailed pennon of the player's colour (R2's shaft was all player colour); a cross-hilted sword at the left hip.
    The horse: the realistic horse (horse_r8) in a cloth caparison of the player's colour to its shins; R2's flank
    badges and steel chanfron go (the chanfron is after 1250)."""
    import horse_r8
    kind = "knight_w"
    r = u.rigs["body"]
    M = _west_materials()
    _gone(kind, ["r_surcoat", "helm", "slit", "cross", "breath*", "lance", "capemb*", "chamfron"])
    body2.zero_pose(r)
    tb, lg = units2._bones_torso(r), units2._bones_legs(r)
    sur = [(0.13, 1.5), (0.205, 1.44), (0.225, 1.3), (0.222, 1.12), (0.2, 1.0), (0.25, 0.8), (0.27, 0.6)]
    mage4.folded_lathe(f"{kind}_r_r8surcoat", sur, M["team"], r, tb + lg, folds=(9, 0.03), scale=(1, 0.82, 1),
                       cut=lambda c: (abs(c.x) < 0.03 and c.z < 0.92) or (abs(c.x) > 0.2 and c.z > 1.18))
    h2.skinned_lathe(f"{kind}_r_r8belt", [(0.206, 0.99), (0.21, 1.04)], M["belt"], r, tb, scale=(1, 0.85, 1))
    r.pose()
    head = r.j["head"]
    lathe(f"{kind}_r8helm", [(0.205, -0.06), (0.208, 0.12), (0.205, 0.28), (0.19, 0.345), (0.0, 0.352)], M["iron"],
          head, segs=28, at=(0, 0.02, 0))
    dark = lib.mat("dark_slit", (0.03, 0.03, 0.03), 0.6)
    for s in (-1, 1):
        box(f"{kind}_r8slit{s}", (0.11, 0.03, 0.022), dark, head, at=(0.065 * s, 0.205, 0.16), rot=(0, 0, 18 * s),
            outline=False)
    box(f"{kind}_r8nasal", (0.04, 0.03, 0.34), M["iron"], head, at=(0, 0.222, 0.12), bevel=0.006)
    box(f"{kind}_r8brow", (0.3, 0.03, 0.04), M["iron"], head, at=(0, 0.21, 0.205), bevel=0.006)
    for k in range(6):
        sphere(f"{kind}_r8breath{k}", 0.008, dark, head, at=(0.05 + 0.025 * (k % 3), 0.218, 0.06 - 0.03 * (k // 3)),
               outline=False)
    # the lance: ash, the R2 steel head kept; a two-tailed pennon a little behind the head
    g = r.j["grip_lance"]
    # the butt only 0.3 m behind the hand (it ran 1 m back through the rider's upper arm: clip_r8); R2's steel head
    # at -2.6 kept, so the lance reaches it
    rod(f"{kind}_r8lance", (0, 0, 0.12), (0, 0, -2.6), 0.022, M["wood"], parent=g, r2=0.016)
    slab(f"{kind}_r8pennon", [(0.0, 0.0), (0.0, -0.32), (0.34, -0.3), (0.22, -0.16), (0.34, -0.02)], 0.006, M["team"],
         parent=g, loc=(0.02, 0, -2.1), rot=(0, 90, 0))
    # the sword: cross-hilted, about 95 cm, at the left hip
    root = lib.empty(f"{kind}_r8swordroot", parent=r.j["hips"], loc=(-0.22, 0.05, 0.04), rot=(-60, 0, -8))
    box(f"{kind}_r8scabbard", (0.05, 0.022, 0.8), M["bag"], root, at=(0, 0, -0.42), bevel=0.008)
    box(f"{kind}_r8guard", (0.2, 0.025, 0.025), M["iron"], root, at=(0, 0, 0.0), bevel=0.004)
    cyl(f"{kind}_r8grip", 0.014, 0.12, M["bag"], root, at=(0, 0, 0.015))
    sphere(f"{kind}_r8pommel", 0.026, M["iron"], root, at=(0, 0, 0.15), scale=(1, 0.55, 1))
    _rows, _hem, _old = horse_r8.refit(u, kind, M["team"], M["team"], hem_drop=0.3)
    return u


def dress_siege(u):
    """投石機: a counterweight trebuchet (ceo 2026-10-21; the West from about 1215, the note's 圖 06 and 13) on a fixed
    timber frame: two sills and cross beams, an A-frame each side holding the axle, a throwing arm 3.4 m long with a
    hinged counterweight box on its short end and a sling on its long end, a winch at the back. R5's wheeled torsion
    machine with a cup (an onager: no medieval evidence) goes. Parts keep R5's names where anims.extend_siege's fall
    moves them (up, brace, bar, winch, rail). The throw: the arm cocked with its long end down at the back, the box
    up; on frame 3 the box drops and the arm swings over (spec.HIT 3); then it is winched down again."""
    kind = "siege_w"
    M = _west_materials()
    P = units2.palette("C")
    keep = ("base", "arm", "bpole", "bfinial", "flag", "pile")
    for ob in list(bpy.data.objects):
        base_name = ob.name.split(".")[0]
        if not base_name.startswith(kind + "_") or base_name[len(kind) + 1:].startswith(keep):
            continue
        ob.hide_render = True
        if ob in lib.ALL_PARTS:
            lib.ALL_PARTS.remove(ob)
        ob.name = base_name + "_r5"
    base = bpy.data.objects[f"{kind}_base"]
    old_arm = u.rigs["arm"]
    for ob in list(old_arm.children):
        ob.hide_render = True
        if ob in lib.ALL_PARTS:
            lib.ALL_PARTS.remove(ob)
    wood, dark, iron = M["wood"], lib.mat("wooddark5", (0.24, 0.15, 0.08), 0.7, noise=0.3, noise_scale=6), M["iron"]
    AX = 2.0                                   # the axle's height
    for s in (-1, 1):
        box(f"{kind}_rail{s}", (0.18, 3.2, 0.2), wood, base, at=(0.55 * s, -0.1, 0.1), bevel=0.02)
        rod(f"{kind}_up{s}", (0.48 * s, 0.62, 0.2), (0.48 * s, 0.0, AX + 0.08), 0.075, wood, parent=base)
        rod(f"{kind}_brace{s}", (0.48 * s, -0.62, 0.2), (0.48 * s, 0.0, AX + 0.08), 0.075, wood, parent=base)
        rod(f"{kind}_tie{s}", (0.48 * s, -0.35, 1.0), (0.48 * s, 0.35, 1.0), 0.05, wood, parent=base)
        box(f"{kind}_axlebox{s}", (0.18, 0.2, 0.16), iron, base, at=(0.48 * s, 0.0, AX), bevel=0.02)
    for y in (-1.5, -0.62, 0.62, 1.3):
        box(f"{kind}_cross{y}", (1.28, 0.16, 0.16), wood, base, at=(0, y, 0.12), bevel=0.02)
    rod(f"{kind}_bar", (-0.62, 0, AX), (0.62, 0, AX), 0.06, iron, parent=base)
    wi = lib.empty(f"{kind}_winch", parent=base, loc=(0, -1.45, 0.42))
    cyl(f"{kind}_winchdrum", 0.12, 0.8, dark, wi, rot=(0, 90, 0), at=(0, 0, -0.4))
    for s in (-1, 1):
        rod(f"{kind}_winchpost{s}", (0.42 * s, 0, -0.3), (0.42 * s, 0, 0.05), 0.05, wood, parent=wi)
        for k in range(4):
            a = math.pi / 2 * k + 0.4
            rod(f"{kind}_spoke{s}{k}", (0.46 * s, 0, 0), (0.46 * s, 0.3 * math.cos(a), 0.3 * math.sin(a)), 0.018, wood,
                parent=wi, segs=6)
    # the arm: about the axle; its own +z runs from the counterweight end (-0.85) to the sling end (+2.55)
    arm = lib.empty(f"{kind}_r8arm", parent=base, loc=(0, 0, AX))
    rod(f"{kind}_beam", (0, 0, -0.85), (0, 0, 2.55), 0.08, dark, parent=arm, r2=0.05)
    for z in (-0.6, 0.3, 1.4):
        cyl(f"{kind}_beamband{z}", 0.088, 0.06, iron, arm, at=(0, 0, z), outline=False)
    hinge = lib.empty(f"{kind}_r8hinge", parent=arm, loc=(0, 0, -0.8))
    box(f"{kind}_box", (0.8, 0.7, 0.62), wood, hinge, at=(0, 0, -0.55), bevel=0.03)
    for z in (-0.32, -0.78):
        box(f"{kind}_boxband{z}", (0.82, 0.72, 0.05), iron, hinge, at=(0, 0, z))
    rod(f"{kind}_hang", (0, 0, 0), (0, 0, -0.26), 0.03, iron, parent=hinge)
    # the player's colour: cloth hung round the counterweight box (the flag alone gave 0-6% of the machine)
    for name, size, at in (("f", (0.84, 0.012, 0.5), (0, 0.36, -0.58)), ("b", (0.84, 0.012, 0.5), (0, -0.36, -0.58)),
                           ("r", (0.012, 0.74, 0.5), (0.41, 0, -0.58)), ("l", (0.012, 0.74, 0.5), (-0.41, 0, -0.58))):
        box(f"{kind}_r8boxcloth{name}", size, M["team"], hinge, at=at)
    sling = lib.empty(f"{kind}_r8sling", parent=arm, loc=(0, 0, 2.55))
    for s in (-1, 1):
        rod(f"{kind}_cord{s}", (0, 0, 0), (0.06 * s, 0, -0.75), 0.008, M["rope"], parent=sling, outline=False)
    lathe(f"{kind}_pouch", [(0.0, -0.86), (0.1, -0.8), (0.11, -0.74)], P["leather"], sling, segs=12, cap=False)
    stone = sphere(f"{kind}_stone", 0.1, lib.mat("stone5", (0.5, 0.48, 0.45), 0.85, noise=0.35, noise_scale=10), sling,
                   at=(0, 0, -0.79))
    # the banner to the back corner, clear of the arm's sweep
    for name in ("bpole", "bfinial", "flag"):
        ob = bpy.data.objects.get(f"{kind}_{name}")
        if ob is not None:
            ob.location.x += 0.25
            ob.location.y -= 0.55
    u.rigs["arm"] = arm
    from humanoid import ease

    def pose(anim, frame):
        n = u.frames.get(anim, 8)
        t = (frame % n) / n
        cocked, thrown = 127.0, -32.0
        if anim == "attack":
            if t < 0.25:
                ang = cocked
            elif t < 0.45:
                ang = cocked + (thrown - cocked) * ease((t - 0.25) / 0.2)
            elif t < 0.55:
                ang = thrown
            else:
                ang = thrown + (cocked - thrown) * ease((t - 0.55) / 0.45)
        else:
            ang = cocked
        arm.rotation_euler = (ang * lib.D2R, 0, 0)
        hinge.rotation_euler = (-ang * lib.D2R, 0, 0)          # the box hangs straight down
        # the sling hangs from the tip; it flies out along the arm at the throw
        fly = anim == "attack" and 0.3 <= t < 0.62
        sling.rotation_euler = ((-ang + (180 if fly else 0)) * lib.D2R, 0, 0)
        stone.scale = (1e-4,) * 3 if anim == "attack" and 0.3 <= t < 0.85 else (1, 1, 1)
    u.pose = pose
    pose("idle", 0)
    return u
