"""R8 (D-093): the East spearman and archer dressed as late-Tang / Five Dynasties soldiers (the user 2026-10-21:
「東陸應該是中國風格不是日本風」), from ceo's reference note (research/east-reference/notes.md, 給美術的要點).

What goes (the parts that read Japanese): the lacquered one-piece cuirass and vest, the square pauldrons, the helmet's
three stepped neck flaps and its plume, the dark round cap, the banner on the back, the open arrow case, the spear's
big tassel. What comes:
- 槍兵 (heavy): lamellar (札甲: rows of small laced plates) body, three-tier 披膊 on the shoulders and a knee-length
  腿裙 split at the front; a bowl helmet (兜鍪) with a small knob and a cloth 頓項 over the neck, ears and shoulders,
  open at the face; under it the round-collar robe in the player's colour (sleeves, the hem to mid-calf, slit at the
  sides); 行縢 (puttees) and boots; a straight 橫刀 with a ring pommel at the left hip.
- 弓手 (light): the round-collar robe (圓領缺胯袍) in the player's colour to mid-calf, slit at the sides; a black
  leather belt; the black soft 幞頭 with two soft tails; a closed 胡祿 (quiver with a lid) at the right hip and an
  empty bow case at the left; puttees and boots; a symmetric horn bow (角弓) gripped at the middle, short working
  limbs and long straight ears (siyahs), 1.22 m strung.
The armour stays iron and the cap black, the same for every player: the player's colour is on cloth only.
Built in the zero pose before anims.extend and before the MPFB body (r8.before_extend): the head parts in the old
head's size, which human_r7.dress shrinks to a real head like the old helmet.
"""
import math

import bmesh
import bpy

import body2
import humanoid2 as h2
import lib
import mage4
import units2
from lib import box, cyl, lathe, rod, slab, sphere

ROW = 0.075            # lamellar: one row of plates, metres (the note: plates about 6-9 cm tall)
PLATE = 0.03           # a plate's width


def _gone(kind, names):
    """Old parts out of every pass: hidden and off the pass list (lib.set_pass shows every listed part again)."""
    for ob in list(bpy.data.objects):
        base = ob.name.split(".")[0]
        rest = base[len(kind) + 1:] if base.startswith(kind + "_") else None
        if rest is None:
            continue
        if any(rest == n or (n.endswith("*") and rest.startswith(n[:-1])) for n in names):
            ob.hide_render = True
            if ob in lib.ALL_PARTS:
                lib.ALL_PARTS.remove(ob)


def _cut(ob, test):
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if test(f.calc_center_median())], context="FACES")
    bm.to_mesh(me)
    bm.free()
    return ob


def _sock(n, ident):
    return next(s for s in n.inputs if s.identifier == ident)


def lamellar(name, plate, lace):
    """Rows of small plates laced together, from the part's rest coordinates ("rest", r7_prod.apply): each row's lower
    edge a dark band of lacing and shadow (the cue that survives at actual size: a row is 4-5 px at 3x), faint seams
    between the plates, each plate a little lighter or darker than the next."""
    if name in lib.MATS:
        return lib.MATS[name]["mat"]
    m = lib.mat(name, plate, 0.42, 0.7)
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
    u = op("MULTIPLY", op("ARCTAN2", xyz.outputs["Y"], xyz.outputs["X"]), 0.17 / PLATE)
    zr = op("DIVIDE", xyz.outputs["Z"], ROW)
    f = op("FRACT", zr)
    idx = op("FLOOR", zr)
    col_u = op("ADD", u, op("MULTIPLY", idx, 0.5))           # each row's plates half a plate along
    g = op("FRACT", col_u)
    seam = op("SUBTRACT", 1.0, op("MULTIPLY", op("LESS_THAN", g, 0.1), 0.3))
    ramp = N("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.17
    ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
    ramp.color_ramp.elements[1].position = 0.27
    ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
    L(f, ramp.inputs["Fac"])
    t = ramp.outputs["Color"]
    cell = N("ShaderNodeCombineXYZ")
    L(op("FLOOR", col_u), cell.inputs["X"])
    L(idx, cell.inputs["Y"])
    wn = N("ShaderNodeTexWhiteNoise")
    wn.noise_dimensions = "3D"
    L(cell.outputs[0], wn.inputs["Vector"])
    var = op("MULTIPLY_ADD", wn.outputs["Value"], 0.3)
    var.node.inputs[2].default_value = 0.85
    grad = op("MULTIPLY_ADD", f, 0.25)                      # a plate a little lighter toward its top
    grad.node.inputs[2].default_value = 0.8
    bright = op("MULTIPLY", op("MULTIPLY", var, seam), grad)
    pc = N("ShaderNodeRGB")
    pc.outputs[0].default_value = (*plate, 1)
    lc = N("ShaderNodeRGB")
    lc.outputs[0].default_value = (*lace, 1)
    sc = N("ShaderNodeVectorMath")
    sc.operation = "SCALE"
    L(pc.outputs[0], sc.inputs[0])
    L(bright, _sock(sc, "Scale"))
    mix = N("ShaderNodeMix")
    mix.data_type = "RGBA"
    L(t, _sock(mix, "Factor_Float"))
    L(lc.outputs[0], _sock(mix, "A_Color"))
    L(sc.outputs["Vector"], _sock(mix, "B_Color"))
    L(next(s for s in mix.outputs if s.identifier == "Result_Color"), p.inputs["Base Color"])
    bw = N("ShaderNodeRGBToBW")
    L(t, bw.inputs[0])
    L(op("MULTIPLY", bw.outputs[0], 0.75), p.inputs["Metallic"])
    p.inputs["Roughness"].default_value = 0.42
    bump = N("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.6
    bump.inputs["Distance"].default_value = 0.004
    L(op("ADD", op("MULTIPLY", bw.outputs[0], 0.6), op("MULTIPLY", seam, 0.4)), bump.inputs["Height"])
    L(bump.outputs["Normal"], p.inputs["Normal"])
    return m


def _materials():
    P = units2.palette("C")
    return dict(
        P=P,
        team=P["team"],
        armour=lamellar("lamellar_r8", (0.30, 0.31, 0.33), (0.09, 0.06, 0.04)),
        iron=lib.mat("iron5", (0.32, 0.32, 0.34), 0.45, 1.0, pattern="worn_metal"),
        black=lib.mat("darkcloth_e", (0.035, 0.033, 0.032), 0.8),       # the 幞頭: black soft cloth (silk gauze)
        belt=lib.mat("strap_e", (0.05, 0.035, 0.025), 0.5),
        leather=P["leather"],
        linen=lib.mat("linen5", (0.84, 0.8, 0.7), 0.85, noise=0.1, noise_scale=6, pattern="cloth", pattern_scale=100),
        bronze=P["bronze"],
        wood_dark=lib.mat("wooddark5", (0.24, 0.15, 0.08), 0.7, noise=0.3, noise_scale=6),
        wood=lib.mat("wood5", (0.42, 0.27, 0.14), 0.7, noise=0.3, noise_scale=6),
        horn=lib.mat("cream_e", (0.74, 0.67, 0.52), 0.6),
        rope=lib.mat("rope5", (0.55, 0.46, 0.3), 0.9, noise=0.2, noise_scale=60),
    )


def _robe_hem(r, name, M, top=1.12, slit=0.62):
    """The round-collar robe below the waist (or below the armour skirt), to mid-calf, slit at both sides (缺胯)."""
    tb, lg = units2._bones_torso(r), units2._bones_legs(r)
    # sized over the MPFB body and its clothes (R8_DEBUG "R8 girth": the hips 0.12 m in front, the clothes 1.4 cm out)
    # (R8_DEBUG "R8 girth", the trunk alone: half-width 0.137 at 1.1 m, 0.164 at 1.0, 0.2 at the hips): the top ring
    # hugs the waist, or the camera looks down into the gap and sees the trousers
    prof = [(0.16, 1.12), (0.185, 1.0), (0.232, 0.86), (0.25, 0.62), (0.254, 0.42), (0.258, 0.33)]
    prof = [p for p in prof if p[1] <= top + 1e-6]
    return mage4.folded_lathe(name, prof, M["team"], r, tb[:1] + lg, folds=(9, 0.035), scale=(1, 0.9, 1),
                              cut=lambda c: abs(c.y) < 0.035 and c.z < slit)


def _puttees(r, name, M):
    for side in ("R", "L"):
        # over the MPFB calf and its trousers (about 0.06 m round, 1.4 cm out)
        lathe(f"{name}{side}", [(0.078, -0.07), (0.074, -0.2), (0.064, -0.36)], M["linen"], r.j["knee" + side],
              segs=14, cap=False)
        for k in range(3):                 # the wrapping's turns
            z = -0.12 - 0.09 * k
            lathe(f"{name}{side}{k}", [(0.077 - 0.004 * k, z - 0.008), (0.08 - 0.004 * k, z + 0.008)], M["linen"],
                  r.j["knee" + side], segs=14, cap=False)


def _sword(r, kind, M):
    """橫刀 at the left hip: straight, single-edged, about 1 m, its scabbard hung from the belt by two straps, the hilt
    forward, a ring pommel (環首); no guard to speak of."""
    root = lib.empty(f"{kind}_swordroot", parent=r.j["hips"], loc=(-0.2, 0.06, 0.04), rot=(-62, 0, -8))
    box(f"{kind}_scabbard", (0.034, 0.02, 0.8), M["belt"], root, at=(0, 0, -0.42), bevel=0.008)
    for k, z in enumerate((-0.1, -0.3)):
        box(f"{kind}_scabmount{k}", (0.04, 0.026, 0.025), M["bronze"], root, at=(0, 0, z), bevel=0.004)
    box(f"{kind}_scabtip", (0.038, 0.024, 0.04), M["bronze"], root, at=(0, 0, -0.81), bevel=0.006)
    cyl(f"{kind}_hilt", 0.015, 0.17, M["belt"], root, at=(0, 0, 0.0))
    lathe(f"{kind}_ring", [(0.026, -0.007), (0.034, 0.0), (0.026, 0.007), (0.019, 0.0)], M["bronze"], root, segs=14,
          rot=(0, 90, 0), loc=(0, 0, 0.2), cap=False)


def dress_spear(u):
    kind = "spear_e"
    r = u.rigs["body"]
    M = _materials()
    _gone(kind, ["cuirass", "tassets", "belt", "pauldR", "pauldL", "drape", "helm", "helmrim", "brow", "ng*", "spike",
                 "tassel", "rivet*", "bpole", "bfinial", "bflag", "fringe*", "speartassel", "bracerR", "bracerL"])
    body2.zero_pose(r)
    tb, lg = units2._bones_torso(r), units2._bones_legs(r)
    _robe_hem(r, f"{kind}_r8robe", M, top=0.62)
    h2.skinned_lathe(f"{kind}_r8cuirass", [(0.18, 0.96), (0.19, 1.06), (0.2, 1.2), (0.205, 1.33), (0.18, 1.44),
                                           (0.125, 1.5)], M["armour"], r, tb, scale=(1, 0.8, 1))
    h2.skinned_lathe(f"{kind}_r8belt", [(0.2, 0.99), (0.204, 1.045)], M["belt"], r, tb, scale=(1, 0.82, 1))
    # the 腿裙, open at the front (cut before it is skinned: the skinner keeps the vertices it is given)
    mage4.folded_lathe(f"{kind}_r8skirt", [(0.2, 1.0), (0.222, 0.88), (0.246, 0.64), (0.252, 0.53)], M["armour"], r,
                       tb[:1] + lg, folds=(1, 0.0), segs=32, scale=(1, 0.86, 1),
                       cut=lambda c: abs(c.x) < 0.028 and c.y > 0 and c.z < 0.9)
    for side, s in (("R", 1), ("L", -1)):
        sh = r.j["shoulder" + side]
        tiers = [[(0.0, 0.075), (0.07, 0.066), (0.1, 0.012), (0.108, -0.05)],
                 [(0.1, -0.01), (0.116, -0.1)], [(0.108, -0.07), (0.124, -0.165)]]
        for k, prof in enumerate(tiers):
            ob = lathe(f"{kind}_r8pibo{side}{k}", prof, M["armour"], sh, segs=18, at=(0.018 * s, 0, 0), cap=k == 0)
            _cut(ob, lambda c, s=s, k=k: c.x * s < -0.035 and (k > 0 or c.z < 0.0))
        lathe(f"{kind}_r8sleeve{side}", [(0.05, -0.02), (0.046, -0.22)], M["team"], r.j["elbow" + side], segs=12,
              cap=False)
    _puttees(r, f"{kind}_r8puttee", M)
    _sword(r, kind, M)
    r.pose()
    head = r.j["head"]
    # 兜鍪: an iron bowl, a leather band at the rim, a small knob on top (no plume)
    # (over the MPFB head, R8_DEBUG "R8 head box" in this frame: x +-0.141, y -0.139..0.221 with the nose, top 0.325)
    lathe(f"{kind}_r8helm", [(0.166, 0.075), (0.172, 0.15), (0.164, 0.23), (0.142, 0.29), (0.1, 0.338), (0.05, 0.36),
                             (0.0, 0.366)], M["iron"], head, segs=24, at=(0, 0.02, 0))
    lathe(f"{kind}_r8helmband", [(0.173, 0.068), (0.178, 0.086), (0.174, 0.104)], M["belt"], head, segs=24,
          at=(0, 0.02, 0), cap=False)
    sphere(f"{kind}_r8knob", 0.028, M["iron"], head, at=(0, 0.02, 0.375))
    cyl(f"{kind}_r8point", 0.011, 0.07, M["iron"], head, at=(0, 0.02, 0.39), r2=0.003)
    # 頓項: cloth hanging from the rim over the neck, the ears and the tops of the shoulders, open at the face
    ng = lathe(f"{kind}_r8dunxiang", [(0.172, 0.085), (0.182, 0.0), (0.2, -0.1), (0.228, -0.18)], M["team"], head,
               segs=28, at=(0, 0.01, 0), cap=False)
    _cut(ng, lambda c: c.y > 0.045)
    return u


def _horn_bow(r, kind, M):
    """角弓: symmetric, gripped at the middle; short working limbs bending back toward the archer, long straight ears
    angled forward of the string; 1.22 m tip to tip strung. The grip's frame as R5's bow: y along the bow, +z toward
    the archer."""
    _gone(kind, ["limb*", "nock*", "bowgrip"])
    old = bpy.data.objects.get(f"{kind}_string")
    old.name = f"{kind}_string_r5"
    old.hide_render = True
    if old in lib.ALL_PARTS:
        lib.ALL_PARTS.remove(old)
    g = r.j["grip_bow"]
    pts = []
    for k in range(9):                     # the working limb, grip to knee
        y = 0.07 + 0.35 * k / 8
        pts.append((y, 0.10 * ((y - 0.07) / 0.35) ** 1.5))
    knee, tip = pts[-1], (0.61, 0.17)
    for s in (1, -1):
        for k in range(len(pts) - 1):
            a, b = pts[k], pts[k + 1]
            rod(f"{kind}_hlimb{s}{k}", (0, s * a[0], a[1]), (0, s * b[0], b[1]), 0.021 - 0.004 * k / 7,
                M["wood_dark"], parent=g)
        rod(f"{kind}_siyah{s}", (0, s * knee[0], knee[1]), (0, s * tip[0], tip[1]), 0.02, M["wood"], parent=g,
            r2=0.016)
        sphere(f"{kind}_bridge{s}", 0.016, M["horn"], g, at=(0, s * knee[0], knee[1] + 0.012))
        sphere(f"{kind}_tip{s}", 0.014, M["horn"], g, at=(0, s * tip[0], tip[1]))
    rod(f"{kind}_hgrip", (0, -0.075, 0.0), (0, 0.075, 0.0), 0.026, M["belt"], parent=g)
    rod(f"{kind}_string", (0, -tip[0], tip[1]), (0, tip[0], tip[1]), 0.004, M["rope"], parent=g)


def dress_bow(u):
    kind = "bow_e"
    r = u.rigs["body"]
    M = _materials()
    _gone(kind, ["vest", "belt", "skirt", "cap", "capknot", "capt*", "bpole", "bfinial", "bflag", "fringe*", "case",
                 "arrow*", "fletch*"])
    body2.zero_pose(r)
    tb = units2._bones_torso(r)
    _robe_hem(r, f"{kind}_r8robe", M)
    h2.skinned_lathe(f"{kind}_r8collar", [(0.1, 1.44), (0.104, 1.46), (0.092, 1.5)], M["team"], r, tb,
                     scale=(1, 0.92, 1))
    h2.skinned_lathe(f"{kind}_r8belt", [(0.194, 0.98), (0.198, 1.035)], M["belt"], r, tb, scale=(1, 0.92, 1))
    _puttees(r, f"{kind}_r8puttee", M)
    hips = r.j["hips"]
    # 胡祿: a closed quiver with a lid, on the right hip, its foot a little forward
    q = lib.empty(f"{kind}_r8quiverroot", parent=hips, loc=(0.24, -0.03, -0.05), rot=(-10, 6, 0))
    lathe(f"{kind}_r8quiver", [(0.0, -0.66), (0.04, -0.65), (0.046, -0.4), (0.052, -0.1), (0.058, 0.0), (0.0, 0.01)],
          M["leather"], q, segs=16, scale=(1, 0.72, 1))
    lathe(f"{kind}_r8quiverlid", [(0.0, -0.06), (0.062, -0.05), (0.066, 0.02), (0.05, 0.06), (0.0, 0.07)], M["belt"],
          q, segs=16, scale=(1, 0.72, 1))
    for k, z in enumerate((-0.12, -0.5)):
        lathe(f"{kind}_r8quiverband{k}", [(0.056 - 0.005 * k, z - 0.012), (0.057 - 0.005 * k, z + 0.012)], M["bronze"],
              q, segs=16, scale=(1, 0.72, 1), cap=False)
    # the bow case (弓韜) on the left hip, empty: the bow is in the hand
    bc = lib.empty(f"{kind}_r8bowcaseroot", parent=hips, loc=(-0.235, 0.0, -0.02), rot=(-18, 0, 0))
    slab(f"{kind}_r8bowcase", [(-0.07, 0.0), (0.08, 0.0), (0.1, -0.12), (0.06, -0.42), (0.0, -0.58), (-0.04, -0.5),
                               (-0.08, -0.2)], 0.035, M["leather"], parent=bc, plane="YZ")
    _horn_bow(r, kind, M)
    r.pose()
    head = r.j["head"]
    # 幞頭: black soft cloth tied over the head, the topknot's bump at the top, two soft tails hanging at the back
    cap = lathe(f"{kind}_r8futou", [(0.164, 0.06), (0.17, 0.15), (0.162, 0.23), (0.14, 0.29), (0.1, 0.332),
                                   (0.05, 0.352), (0.0, 0.357)], M["black"], head, segs=24, at=(0, 0.02, 0))
    _cut(cap, lambda c: c.y > 0.1 and c.z < 0.15)                    # the forehead and face
    sphere(f"{kind}_r8futoubun", 0.08, M["black"], head, at=(0, -0.01, 0.35), scale=(0.9, 1.0, 0.85))
    sphere(f"{kind}_r8futouknot", 0.036, M["black"], head, at=(0, -0.155, 0.16), scale=(1.4, 0.8, 0.8))
    for s in (-1, 1):
        box(f"{kind}_r8futoutail{s}", (0.04, 0.008, 0.32), M["black"], head, at=(0.034 * s, -0.175, 0.0),
            rot=(-10, 0, 4 * s), bevel=0.003)
    return u
