"""R5-02 level-C models for the units that were still R1 models, plus the new West peasant.

Each keeps its R1 identity (hat, weapon, colours, poses) on the R2 smooth body, with skinned
garments and level-C detail. Player colour is large and faces the camera (R3/R4 lesson).

farmer_e 農夫   wider woven 斗笠 with a chin cord, hemp short robe, player-colour waist wrap
                (front panel to the knees) and sash, leg wraps, straw sandals, axe.
farmer_w 農民   (new) player-colour headscarf and bib apron (chest to knees), short belted russet
                tunic, laced boots, hoe.
xbow_e   弩手   幞頭 cap with two tails, lacquered leather vest over an ochre tunic, player-colour
                skirt, bolt case at the hip, back banner, crossbow with bronze fittings.
bow_w    長弓兵 moss hood with a long tail and a moss shoulder cape, player-colour tabard, quiver of
                arrows on the back, a tall self bow.
pike_w   長矛兵 kettle hat with a rolled brim, quilted cream gambeson, player-colour surcoat, steel
                spaulders, a longer pike with langets.
siege_e  霹靂車 R1 traction trebuchet with spoked wheels, iron bands, rope lashings, stone basket,
                larger player-colour banner with fringe.
siege_w  投石機 R1 torsion catapult with spoked wheels, iron fittings, winch handles, stone pile,
                larger emblem banner.
"""
import math
import os

import bmesh
import bpy

import body2
import humanoid2 as h2
import lib
import mage3
import mage4
import units2
from humanoid import ease, grip
from lib import box, cyl, lathe, mat, rod, slab, sphere

EMBLEM_DIR = os.environ.get("EMBLEM_DIR", "")


def X5():
    return dict(
        hemp=mat("hemp5", (0.62, 0.56, 0.44), 0.85, noise=0.15, noise_scale=6, pattern="cloth", pattern_scale=90),
        straw=mat("straw5", (0.8, 0.66, 0.36), 0.9, noise=0.3, noise_scale=40),
        strawdark=mat("strawdark5", (0.55, 0.43, 0.22), 0.9, noise=0.3, noise_scale=40),
        linen=mat("linen5", (0.84, 0.8, 0.7), 0.85, noise=0.1, noise_scale=6, pattern="cloth", pattern_scale=100),
        russet=mat("russet5", (0.42, 0.27, 0.17), 0.85, noise=0.15, noise_scale=6, pattern="cloth", pattern_scale=90),
        ochre=mat("ochre5", (0.62, 0.44, 0.2), 0.8, noise=0.12, noise_scale=6, pattern="cloth", pattern_scale=90),
        moss=mat("moss5", (0.22, 0.26, 0.14), 0.85, noise=0.15, noise_scale=6, pattern="cloth", pattern_scale=90),
        gambeson=mat("gambeson5", (0.74, 0.67, 0.52), 0.85, noise=0.12, noise_scale=6, pattern="lamellar",
                     pattern_scale=22),
        rope=mat("rope5", (0.55, 0.46, 0.3), 0.9, noise=0.2, noise_scale=60),
        wood=mat("wood5", (0.42, 0.27, 0.14), 0.7, noise=0.3, noise_scale=6),
        wood_dark=mat("wooddark5", (0.24, 0.15, 0.08), 0.7, noise=0.3, noise_scale=6),
        iron=mat("iron5", (0.32, 0.32, 0.34), 0.45, 1.0, pattern="worn_metal"),
        stone=mat("stone5", (0.5, 0.48, 0.45), 0.85, noise=0.35, noise_scale=10),
        feather=mat("feather5", (0.86, 0.83, 0.76), 0.8, sheen=0.4),
    )


def _body(kind, P, cloth, pants, boots, beard=True, bulk=1.0):
    u = units2.Unit(kind)
    r = h2.humanoid2(kind, P["skin"], cloth, pants, boots, detail="C", parent=u.root, bulk=bulk,
                     beard=P["hair"] if beard else None)
    u.rigs["body"] = r
    body2.zero_pose(r)
    return u, r, units2._bones_torso(r), units2._bones_legs(r, bulk)


def _upper_arms(r, b=1.0):
    return mage3._arm(r, "R", b)[:1] + mage3._arm(r, "L", b)[:1]


def _generic(u, r, attack_fn):
    def pose(anim, frame):
        units2.pose_generic(u, r, anim, frame, attack_fn)
        h2.update(r)
    u.pose = pose
    return u


def _cut_head(ob, test):
    """Open a face in a head covering (faces whose centre passes `test`, in mesh space)."""
    mage3._cut(ob, test)


# ---------------------------------------------------------------- 農夫 (East farmer)

def build_farmer_e(P):
    import units as U1
    X = X5()
    u, r, tb, lg = _body("farmer_e", P, X["hemp"], X["hemp"], X["straw"], beard=False)
    mage4.folded_lathe("farmer_e_robe", [(0.158, 1.45), (0.18, 1.26), (0.176, 1.02), (0.2, 0.8), (0.215, 0.66)],
                       X["hemp"], r, tb + lg, folds=(8, 0.04), scale=(1, 0.8, 1))
    # player colour: a wide waist wrap whose front panel reaches the knees, and the sash
    mage4.folded_lathe("farmer_e_wrap", [(0.19, 1.03), (0.205, 0.92), (0.232, 0.7), (0.24, 0.5)], P["team"], r,
                       tb[:1] + lg, folds=(7, 0.05), scale=(1, 0.84, 1), cut=lambda c: c.y < -0.06)
    h2.skinned_lathe("farmer_e_sash", [(0.186, 0.99), (0.19, 1.09)], P["team"], r, tb, scale=(1, 0.84, 1), segs=28)
    for side, k in (("R", 0), ("L", 2)):
        x = 0.1 * (1 if side == "R" else -1)
        h2.skinned_lathe(f"farmer_e_legwrap{side}", [(0.066, 0.1), (0.07, 0.25), (0.066, 0.4)], X["linen"], r,
                         lg[k:k + 2], at=(x, 0, 0), segs=14)
    r.pose()
    head = r.j["head"]
    lathe("farmer_e_hat", [(0.37, 0.115), (0.355, 0.13), (0.22, 0.19), (0.07, 0.275), (0.0, 0.3)], X["straw"], head,
          segs=36)
    lathe("farmer_e_hatrim", [(0.372, 0.108), (0.378, 0.118), (0.372, 0.128)], X["strawdark"], head, segs=36)
    for k in range(3):      # woven rings
        rr = 0.12 + 0.08 * k
        z = 0.275 - (rr - 0.07) / 0.3 * 0.16
        lathe(f"farmer_e_hatring{k}", [(rr, z - 0.004), (rr + 0.004, z), (rr, z + 0.004)], X["strawdark"], head,
              segs=36, outline=False)
    for s in (-1, 1):
        rod(f"farmer_e_cord{s}", (0.12 * s, 0.02, 0.13), (0.03 * s, 0.09, -0.02), 0.006, X["rope"], parent=head,
            outline=False)
    g = grip(r, "R", "axe")
    rod("farmer_e_haft", (0, 0, 0.12), (0, 0, -0.64), 0.017, X["wood"], parent=g)
    cyl("farmer_e_haftwrap", 0.021, 0.12, P["leather"], g, at=(0, 0, -0.06))
    slab("farmer_e_axe", [(0, 0.02), (0.1, 0.05), (0.19, 0.08), (0.2, -0.1), (0.1, -0.08), (0, -0.07)], 0.022,
         P["steel"], parent=g, loc=(0, 0, -0.54), rot=(0, 0, 90))
    return _generic(u, r, U1.chop)


# ---------------------------------------------------------------- 農民 (West peasant, new)

def hoe_attack(t):
    """Hoeing: raise the hoe over the shoulder, chop it down into the ground, pull back."""
    up = {"torso": (6, 0, -8), "shoulderR": (150, 0, -8), "elbowR": (30, 0, 0),
          "shoulderL": (130, 0, 12), "elbowL": (35, 0, 0), "hipL": (16, 0, 6), "hipR": (-8, 0, -6)}
    down = {"torso": (-32, 0, 0), "shoulderR": (50, 0, -5), "elbowR": (15, 0, 0),
            "shoulderL": (46, 0, 10), "elbowL": (18, 0, 0), "hipL": (26, 0, 6), "kneeL": (-22, 0, 0)}
    import humanoid as HU
    if t < 0.5:
        a = HU.blend(down, up, ease(t / 0.5))
    elif t < 0.68:
        a = HU.blend(up, down, ease((t - 0.5) / 0.18))
    else:
        a = HU.blend(down, {"torso": (-26, 0, 0), "shoulderR": (40, 0, -5), "elbowR": (30, 0, 0)},
                     ease((t - 0.68) / 0.32))
    return a, {"hips": (0, 0, -0.03)}


def build_farmer_w(P):
    X = X5()
    u, r, tb, lg = _body("farmer_w", P, X["russet"], P["dark"], P["leather"], beard=True)
    mage4.folded_lathe("farmer_w_tunic", [(0.158, 1.45), (0.18, 1.26), (0.176, 1.02), (0.2, 0.84), (0.215, 0.72)],
                       X["russet"], r, tb + lg, folds=(8, 0.035), scale=(1, 0.8, 1))
    h2.skinned_lathe("farmer_w_belt", [(0.181, 1.0), (0.184, 1.05)], P["leather"], r, tb, scale=(1, 0.82, 1), segs=28)
    # player colour: a bib apron from the chest to the knees, straps over the shoulders
    mage4.ribbon("farmer_w_apron", [(0, 0.15, 1.38), (0, 0.165, 1.22), (0, 0.172, 1.04), (0, 0.2, 0.84),
                                    (0, 0.215, 0.66), (0, 0.22, 0.52)], 0.27, P["team"], r, tb + lg, thick=0.012)
    for s in (1, -1):
        mage4.ribbon(f"farmer_w_strap{s}", [(0.1 * s, 0.14, 1.38), (0.12 * s, 0.07, 1.47), (0.11 * s, -0.08, 1.44),
                                            (0.08 * s, -0.14, 1.28)], 0.035, P["team"], r, tb)
    r.pose()
    head = r.j["head"]
    # player colour, seen from every side (the apron is edge-on in side view): a loose kerchief,
    # fuller than the skull, knotted at the nape with two tails to the shoulders
    sc = lathe("farmer_w_scarf", [(0.15, 0.02), (0.158, 0.13), (0.153, 0.24), (0.1, 0.315), (0.03, 0.34), (0.0, 0.345)],
               P["team"], head, segs=28, at=(0, -0.02, 0))
    _cut_head(sc, lambda c: c.y > 0.04 and c.z < 0.24)
    sphere("farmer_w_knot", 0.052, P["team"], head, at=(0, -0.17, 0.1), scale=(1.3, 1, 0.9))
    for s in (-1, 1):
        rod(f"farmer_w_scarftail{s}", (0.02 * s, -0.18, 0.08), (0.075 * s, -0.22, -0.17), 0.03, P["team"],
            parent=head, r2=0.012)
    g = grip(r, "R", "hoe")
    rod("farmer_w_haft", (0, 0, 0.3), (0, 0, -1.1), 0.018, X["wood"], parent=g)
    box("farmer_w_hoe", (0.17, 0.2, 0.016), P["steel"], g, at=(0, -0.09, -1.1), bevel=0.004)
    box("farmer_w_hoesock", (0.05, 0.05, 0.08), X["iron"], g, at=(0, 0, -1.08))
    return _generic(u, r, hoe_attack)


# ---------------------------------------------------------------- 弩手 (East crossbowman)

def build_xbow_e(P):
    import units as U1
    X = X5()
    u, r, tb, lg = _body("xbow_e", P, X["ochre"], P["indigo"], P["dark"])
    h2.skinned_lathe("xbow_e_vest", [(0.155, 1.02), (0.178, 1.12), (0.19, 1.26), (0.19, 1.37), (0.16, 1.45)],
                     P["lacquer"], r, tb, scale=(1, 0.74, 1))
    h2.skinned_lathe("xbow_e_belt", [(0.16, 1.0), (0.164, 1.06)], P["leather"], r, tb, scale=(1, 0.76, 1))
    # player colour: the skirt below the vest, all round
    mage4.folded_lathe("xbow_e_skirt", [(0.165, 1.02), (0.2, 0.9), (0.238, 0.64), (0.245, 0.58)], P["team"], r,
                       tb[:1] + lg, folds=(9, 0.05), scale=(1, 0.8, 1))
    for side in ("R", "L"):
        lathe(f"xbow_e_bracer{side}", [(0.05, -0.05), (0.052, -0.2)], P["leather"], r.j["elbow" + side], segs=12)
    r.pose()
    J = r.j
    head = J["head"]
    lathe("xbow_e_cap", [(0.148, 0.1), (0.154, 0.18), (0.132, 0.27), (0.062, 0.31), (0.0, 0.32)], P["dark"], head,
          segs=24)
    box("xbow_e_capknot", (0.12, 0.08, 0.1), P["dark"], head, at=(0, -0.02, 0.33), bevel=0.03)
    for s in (-1, 1):
        box(f"xbow_e_capt{s}", (0.028, 0.22, 0.045), P["dark"], head, at=(0.075 * s, -0.24, 0.2), rot=(22, 0, 0),
            bevel=0.008)
    units2.banner2(r, P, h=0.6, w=0.22, fh=0.3, detail="C")
    case = lib.empty("xbow_e_caseroot", parent=J["hips"], loc=(0.2, 0.02, -0.02), rot=(8, 0, 0))
    box("xbow_e_case", (0.08, 0.12, 0.3), P["leather"], case, at=(0, 0, -0.1), bevel=0.012)
    for k in range(4):
        rod(f"xbow_e_bolt{k}", (-0.02 + 0.013 * k, -0.02 + 0.01 * (k % 2), 0.05),
            (-0.02 + 0.013 * k, -0.02 + 0.01 * (k % 2), 0.12), 0.006, X["feather"], parent=case, outline=False)
    g = grip(r, "R", "xbow", loc=(0, 0.0, -0.06), rot=(-90, 0, 0))
    box("xbow_e_stock", (0.07, 0.72, 0.08), X["wood"], g, at=(0, -0.08, 0), bevel=0.014)
    box("xbow_e_lock", (0.05, 0.1, 0.05), P["bronze"], g, at=(0, 0.02, 0.045), bevel=0.008)
    rod("xbow_e_trig", (0, -0.02, -0.04), (0, 0.03, -0.12), 0.01, P["bronze"], parent=g)
    lathe("xbow_e_prod", [(0.0, -0.4), (0.03, -0.36), (0.034, 0.0), (0.03, 0.36), (0.0, 0.4)], X["wood_dark"], g,
          rot=(0, 90, 0), at=(0, 0, 0), segs=10, scale=(1, 0.8, 1), loc=(0, 0.25, 0.02))
    for s in (-1, 1):
        sphere(f"xbow_e_prodtip{s}", 0.03, P["bronze"], g, at=(0.4 * s, 0.24, 0.02))
        rod(f"xbow_e_str{s}", (0.39 * s, 0.23, 0.02), (0, 0.02, 0.03), 0.005, X["rope"], parent=g)
    return _generic(u, r, U1.xbow_attack)


# ---------------------------------------------------------------- 長弓兵 (West longbowman)

def build_bow_w(P):
    import units as U1
    X = X5()
    u, r, tb, lg = _body("bow_w", P, X["moss"], P["leather"], P["leather"])
    # player colour: a tabard to mid-thigh
    mage4.folded_lathe("bow_w_tabard", [(0.155, 1.44), (0.182, 1.28), (0.176, 1.06), (0.2, 0.9), (0.228, 0.64)],
                       P["team"], r, tb + lg, folds=(8, 0.035), scale=(1, 0.78, 1))
    h2.skinned_lathe("bow_w_belt", [(0.181, 1.0), (0.184, 1.05)], P["leather"], r, tb, scale=(1, 0.8, 1), segs=28)
    # moss shoulder cape of the hood, dagged hem
    # (the hem is cut into points before skinning: the skinner keeps the rest shape it is given)
    cape = lathe("bow_w_cape", [(0.09, 1.53), (0.2, 1.47), (0.245, 1.38), (0.25, 1.31)], X["moss"], None, segs=32,
                 scale=(1, 0.8, 1), cap=False)
    me = cape.data
    bm = bmesh.new()
    bm.from_mesh(me)
    for v in bm.verts:
        if v.co.z < 1.32:
            th = math.atan2(v.co.y, v.co.x)
            v.co.z -= 0.035 * (1 if int((th + math.pi) / (2 * math.pi) * 16) % 2 else 0)
    bm.to_mesh(me)
    bm.free()
    bpy.context.view_layer.update()
    r.skinners.append(body2.Skinner(cape, tb + _upper_arms(r), base=r.root.matrix_world.copy()))
    for side in ("R", "L"):
        lathe(f"bow_w_bracer{side}", [(0.05, -0.05), (0.053, -0.2)], P["leather"], r.j["elbow" + side], segs=12)
    r.pose()
    J = r.j
    head = J["head"]
    hood = lathe("bow_w_hood", [(0.172, -0.02), (0.168, 0.1), (0.163, 0.2), (0.125, 0.28), (0.045, 0.325),
                                (0.0, 0.335)], X["moss"], head, segs=28, at=(0, -0.02, 0))
    _cut_head(hood, lambda c: c.y > 0.05 and 0.0 < c.z < 0.24)
    rod("bow_w_hoodtail", (0, -0.15, 0.25), (0, -0.34, 0.02), 0.05, X["moss"], parent=head, r2=0.008)
    q = lib.empty("bow_w_quiverroot", parent=J["torso"], loc=(0.1, -0.2, 0.28), rot=(0, -18, 0))
    cyl("bow_w_quiver", 0.055, 0.46, P["leather"], q, at=(0, 0, -0.26), scale=(1, 0.8, 1))
    for k in range(5):
        dx, dy = 0.022 * math.cos(k * 1.3), 0.018 * math.sin(k * 1.3)
        rod(f"bow_w_arrow{k}", (dx, dy, 0.18), (dx, dy, 0.3), 0.004, X["wood"], parent=q, outline=False)
        slab(f"bow_w_fletch{k}", [(0, 0), (0.025, 0.02), (0.025, 0.1), (0, 0.09)], 0.004, X["feather"], parent=q,
             loc=(dx, dy, 0.2), rot=(0, 0, 60 * k), outline=False)
    g = grip(r, "L", "bow")
    pts = []
    for k in range(11):
        a = -0.9 + k * 0.18
        pts.append((0.0, 1.13 * math.sin(a), -0.2 * (math.cos(a) - 1.0) * 1.6))
    for k in range(10):
        rod(f"bow_w_limb{k}", pts[k], pts[k + 1], 0.019 - 0.007 * abs(k - 4.5) / 4.5, X["wood"], parent=g)
    rod("bow_w_string", pts[0], pts[-1], 0.004, X["rope"], parent=g)
    cyl("bow_w_bowgrip", 0.024, 0.14, P["leather"], g, rot=(90, 0, 0), at=(0, 0, -0.07))
    return _generic(u, r, U1.bow_attack)


# ---------------------------------------------------------------- 長矛兵 (West pikeman)

def build_pike_w(P):
    import units as U1
    X = X5()
    u, r, tb, lg = _body("pike_w", P, X["gambeson"], P["leather"], P["leather"])
    mage4.folded_lathe("pike_w_gambeson", [(0.162, 1.45), (0.19, 1.28), (0.186, 1.04), (0.205, 0.9), (0.215, 0.8)],
                       X["gambeson"], r, tb + lg, folds=(10, 0.02), scale=(1, 0.8, 1))
    # player colour: surcoat over the gambeson to the knees, split at the sides
    mage4.folded_lathe("pike_w_surcoat", [(0.165, 1.44), (0.196, 1.28), (0.19, 1.06), (0.215, 0.9), (0.25, 0.54)],
                       P["team"], r, tb + lg, folds=(8, 0.035), scale=(1, 0.8, 1),
                       cut=lambda c: abs(c.x) > 0.18 and c.z < 0.9)
    h2.skinned_lathe("pike_w_belt", [(0.194, 1.0), (0.197, 1.055)], P["leather"], r, tb, scale=(1, 0.82, 1), segs=28)
    r.pose()
    J = r.j
    head = J["head"]
    lathe("pike_w_kettle", [(0.3, 0.115), (0.29, 0.13), (0.172, 0.155), (0.165, 0.25), (0.125, 0.31), (0.0, 0.335)],
          P["steel"], head, segs=32)
    lathe("pike_w_kettlerim", [(0.302, 0.105), (0.31, 0.118), (0.302, 0.131)], P["steel"], head, segs=32)
    rod("pike_w_kettleridge", (0, -0.17, 0.2), (0, 0.17, 0.2), 0.012, P["steel"], parent=head)
    for s in (-1, 1):
        rod(f"pike_w_chin{s}", (0.14 * s, 0.0, 0.13), (0.05 * s, 0.07, -0.04), 0.006, P["leather"], parent=head,
            outline=False)
        sh = J["shoulder" + ("R" if s == 1 else "L")]
        lathe(f"pike_w_spaulder{s}", [(0.0, 0.07), (0.075, 0.06), (0.105, 0.0), (0.11, -0.08)], P["steel"], sh,
              segs=16, at=(0.02 * s, 0, 0.0), scale=(1.1, 1.0, 1.0))
    g = grip(r, "R", "pike")
    rod("pike_w_shaft", (0, 0, 1.3), (0, 0, -2.5), 0.021, X["wood"], parent=g)
    lathe("pike_w_tip", [(0.0, 0.0), (0.03, 0.06), (0.026, 0.22), (0.0, 0.34)], P["steel"], g, segs=8,
          at=(0, 0, 2.5), rot=(180, 0, 0), scale=(1, 0.4, 1))
    for s in (-1, 1):
        box(f"pike_w_langet{s}", (0.008, 0.016, 0.3), P["steel"], g, at=(0.02 * s, 0, -2.36))
    return _generic(u, r, U1.spear_attack)


# ---------------------------------------------------------------- siege engines

def spoked_wheel(name, P, X, parent, loc, r=0.42):
    w = lib.empty(name, parent=parent, loc=loc, rot=(0, 90, 0))
    lathe(name + "_rim", [(r - 0.05, 0.04), (r - 0.05, -0.04), (r, -0.045), (r, 0.045), (r - 0.05, 0.04)],
          X["wood_dark"], w, segs=24, cap=False)
    lathe(name + "_tyre", [(r, -0.03), (r + 0.012, -0.03), (r + 0.012, 0.03), (r, 0.03)], X["iron"], w, segs=24,
          cap=False, outline=False)
    for k in range(8):
        a = 2 * math.pi * k / 8
        rod(f"{name}_spoke{k}", (0.07 * math.cos(a), 0.07 * math.sin(a), 0),
            ((r - 0.045) * math.cos(a), (r - 0.045) * math.sin(a), 0), 0.018, X["wood"], parent=w, segs=6)
    cyl(name + "_hub", 0.09, 0.14, P["bronze"], w, at=(0, 0, -0.07), segs=12)
    return w


def banner_big(name, P, parent, loc, w=0.55, h=0.8, emblem=False):
    rod(name + "_bpole", (loc[0], loc[1], loc[2] - 1.0), (loc[0], loc[1], loc[2] + 0.1), 0.022,
        P["shaft"], parent=parent)
    sphere(name + "_bfinial", 0.03, P["bronze"], parent, at=(loc[0], loc[1], loc[2] + 0.12))
    fm = P["team"]
    if emblem:
        try:
            fm = lib.flag_mat(name + "_emb", os.path.join(EMBLEM_DIR, "twintowers.png"))
        except RuntimeError:
            fm = P["team"]
    pts = [(0, 0), (w, 0), (w, -h), (w / 2, -h + 0.14), (0, -h)] if emblem else [(0, 0), (w, 0), (w, -h), (0, -h)]
    fl = slab(name + "_flag", pts, 0.015, fm, parent=parent, loc=(loc[0] + 0.02, loc[1], loc[2]), rot=(0, 0, 90))
    if not emblem:
        for k in range(7):
            y = w * (k + 0.5) / 7
            rod(f"{name}_fringe{k}", (y, 0, -h), (y, 0, -h - 0.06), 0.008, P["gold"], parent=fl, outline=False)
    return fl


def build_siege_e(P):
    X = X5()
    u = units2.Unit("siege_e")
    base = lib.empty("siege_e_base", parent=u.root)
    for s in (-1, 1):
        box(f"siege_e_rail{s}", (0.12, 2.4, 0.16), X["wood"], base, at=(0.5 * s, 0, 0.5), bevel=0.02)
        spoked_wheel(f"siege_e_w{s}a", P, X, base, (0.64 * s, 0.8, 0.42))
        spoked_wheel(f"siege_e_w{s}b", P, X, base, (0.64 * s, -0.8, 0.42))
        rod(f"siege_e_post{s}a", (0.5 * s, 0.7, 0.55), (0.35 * s, 0.05, 2.6), 0.06, X["wood_dark"], parent=base)
        rod(f"siege_e_post{s}b", (0.5 * s, -0.7, 0.55), (0.35 * s, -0.05, 2.6), 0.06, X["wood_dark"], parent=base)
        for k, f in enumerate((0.3, 0.62)):       # iron bands on the posts
            for yy in (1, -1):
                p = (0.5 * s + (0.35 * s - 0.5 * s) * f, yy * (0.7 - 0.65 * f), 0.55 + 2.05 * f)
                cyl(f"siege_e_band{s}{k}{yy}", 0.066, 0.05, X["iron"], base, loc=p, at=(0, 0, -0.025), outline=False)
        for yy in (1, -1):                         # rope lashing at the top
            cyl(f"siege_e_lash{s}{yy}", 0.07, 0.12, X["rope"], base, loc=(0.37 * s, 0.08 * yy, 2.52),
                at=(0, 0, -0.06), outline=False)
    for y in (-0.9, 0.0, 0.9):
        box(f"siege_e_cross{y}", (1.1, 0.12, 0.12), X["wood"], base, at=(0, y, 0.6), bevel=0.02)
    for s in (-1, 1):
        box(f"siege_e_railiron{s}", (0.13, 0.05, 0.17), X["iron"], base, at=(0.5 * s, 1.18, 0.5))
    rod("siege_e_axle", (-0.45, 0, 2.6), (0.45, 0, 2.6), 0.07, P["bronze"], parent=base)
    arm = lib.empty("siege_e_arm", parent=base, loc=(0, 0, 2.6))
    u.rigs["arm"] = arm
    rod("siege_e_beam", (0, 1.0, 0), (0, -2.6, 0), 0.075, X["wood_dark"], parent=arm, r2=0.045)
    for k, yb in enumerate((0.5, -0.6, -1.6)):
        cyl(f"siege_e_beamband{k}", 0.08 - 0.01 * k, 0.05, X["iron"], arm, loc=(0, yb, 0), rot=(90, 0, 0),
            at=(0, 0, -0.025), outline=False)
    for k in range(4):
        x = -0.21 + k * 0.14
        rod(f"siege_e_pull{k}", (x * 0.3, 0.57, 3.42), (x * 2.2, 1.45 + 0.08 * k, 0.05), 0.018,
            X["rope"], parent=base, outline=False)
        cyl(f"siege_e_pullgrip{k}", 0.028, 0.14, X["wood"], base, loc=(x * 2.2, 1.45 + 0.08 * k, 0.1),
            rot=(0, 90, 0), at=(0, 0, -0.07), outline=False)
    rod("siege_e_sling", (0, -2.6, 0), (0, -2.75, -0.6), 0.012, X["rope"], parent=arm)
    sphere("siege_e_stone", 0.14, X["stone"], arm, at=(0, -2.75, -0.68))
    lathe("siege_e_basket", [(0.2, 0.0), (0.26, 0.24), (0.27, 0.27)], X["straw"], base, loc=(0.28, -1.0, 0.68),
          segs=16)
    for k in range(4):
        a = k * 1.6
        sphere(f"siege_e_bstone{k}", 0.08, X["stone"], base, at=(0.28 + 0.1 * math.cos(a), -1.0 + 0.1 * math.sin(a),
                                                                 0.9))
    banner_big("siege_e", P, base, (0.42, 0.0, 3.55), w=0.5, h=0.75)

    def pose(anim, frame):
        n = u.frames.get(anim, 8)          # production renders the attack with 10 frames
        t = (frame % n) / n
        if anim == "attack":
            ang = 55 - 150 * ease(min(1, t / 0.5)) if t < 0.5 else -95 + 150 * ease((t - 0.5) / 0.5)
        else:
            ang = 55
        arm.rotation_euler = (ang * lib.D2R, 0, 0)
    u.pose = pose
    return u


def build_siege_w(P):
    X = X5()
    u = units2.Unit("siege_w")
    base = lib.empty("siege_w_base", parent=u.root)
    for s in (-1, 1):
        box(f"siege_w_rail{s}", (0.14, 2.2, 0.2), X["wood"], base, at=(0.45 * s, 0, 0.45), bevel=0.02)
        spoked_wheel(f"siege_w_w{s}a", P, X, base, (0.6 * s, 0.75, 0.36), r=0.36)
        spoked_wheel(f"siege_w_w{s}b", P, X, base, (0.6 * s, -0.75, 0.36), r=0.36)
        rod(f"siege_w_up{s}", (0.45 * s, 0.35, 0.5), (0.45 * s, 0.35, 1.5), 0.07, X["wood"], parent=base)
        rod(f"siege_w_brace{s}", (0.45 * s, -0.3, 0.5), (0.45 * s, 0.33, 1.45), 0.05, X["wood"], parent=base)
        cyl(f"siege_w_upband{s}", 0.076, 0.06, X["iron"], base, loc=(0.45 * s, 0.35, 1.3), at=(0, 0, -0.03),
            outline=False)
        # twisted rope skein (the torsion spring) beside the arm
        cyl(f"siege_w_skein{s}", 0.1, 0.22, X["rope"], base, loc=(0.2 * s, -0.7, 0.62), rot=(0, 90, 0),
            at=(0, 0, -0.11))
    box("siege_w_bar", (1.05, 0.16, 0.16), X["wood_dark"], base, at=(0, 0.35, 1.5), bevel=0.03)
    box("siege_w_pad", (0.5, 0.14, 0.14), P["leather"], base, at=(0, 0.35, 1.61), bevel=0.04)
    for y in (-0.9, -0.2, 0.9):
        box(f"siege_w_cross{y}", (1.0, 0.14, 0.14), X["wood"], base, at=(0, y, 0.5), bevel=0.02)
    wi = lib.empty("siege_w_winch", parent=base, loc=(0, -1.0, 0.55))
    cyl("siege_w_winchdrum", 0.1, 0.9, X["wood_dark"], wi, rot=(0, 90, 0), at=(0, 0, -0.45))
    for s in (-1, 1):
        for k in range(4):
            a = math.pi / 2 * k + 0.4
            rod(f"siege_w_handle{s}{k}", (0.5 * s, 0, 0), (0.5 * s, 0.26 * math.cos(a), 0.26 * math.sin(a)), 0.018,
                X["wood"], parent=wi, segs=6)
    for y in (-0.62, 0.62):
        box(f"siege_w_iron{y}", (1.02, 0.05, 0.22), X["iron"], base, at=(0, y, 0.45))
    arm = lib.empty("siege_w_arm", parent=base, loc=(0, -0.7, 0.62))
    u.rigs["arm"] = arm
    rod("siege_w_beam", (0, 0, 0), (0, 0, 1.6), 0.075, X["wood_dark"], parent=arm)
    cyl("siege_w_beamband", 0.082, 0.06, X["iron"], arm, at=(0, 0, 1.2), outline=False)
    lathe("siege_w_cup", [(0.02, 0), (0.18, 0.04), (0.22, 0.14), (0.2, 0.15)], X["wood_dark"], arm, at=(0, 0, 1.6),
          segs=16)
    lathe("siege_w_cupband", [(0.222, 0.1), (0.226, 0.14)], X["iron"], arm, at=(0, 0, 1.6), segs=16, outline=False)
    sphere("siege_w_stone", 0.14, X["stone"], arm, at=(0, 0, 1.73))
    for k in range(5):
        a = k * 1.25
        sphere(f"siege_w_pile{k}", 0.09, X["stone"], base, at=(0.75 + 0.12 * math.cos(a), -1.45 + 0.12 * math.sin(a),
                                                               0.09 + (0.1 if k == 4 else 0)))
    banner_big("siege_w", P, base, (0.5, -0.9, 2.5), w=0.56, h=0.72, emblem=True)

    def pose(anim, frame):
        n = u.frames.get(anim, 8)          # production renders the attack with 10 frames
        t = (frame % n) / n
        if anim == "attack":
            ang = 70 - 80 * ease(min(1, t / 0.35)) if t < 0.35 else -10 + 80 * ease((t - 0.35) / 0.65)
        else:
            ang = 70
        arm.rotation_euler = (ang * lib.D2R, 0, 0)
    u.pose = pose
    return u


# ---------------------------------------------------------------- 槍兵 option A (R5-03)

def build_spear_e_drape(P):
    """R2's spearman with a player-colour cloth drape over the (neutral) lamellar tassets: front and
    both sides, open at the back. Same rule as the crossbowman: the armour itself never takes the
    player colour, a cloth layer does (ceo 2026-09-30)."""
    u = units2.build_spear_e(P, "C")
    r = u.rigs["body"]
    body2.zero_pose(r)
    tb, lg = units2._bones_torso(r), units2._bones_legs(r)
    mage4.folded_lathe("spear_e_drape", [(0.176, 1.02), (0.214, 0.88), (0.25, 0.62), (0.256, 0.54)], P["team"], r,
                       tb[:1] + lg, folds=(8, 0.045), scale=(1, 0.84, 1), cut=lambda c: c.y < -0.05)
    r.pose()
    return u


BUILDERS = {"farmer_e": build_farmer_e, "farmer_w": build_farmer_w, "xbow_e": build_xbow_e, "bow_w": build_bow_w,
            "pike_w": build_pike_w, "siege_e": build_siege_e, "siege_w": build_siege_w}


def build(kind, variant=0):
    if kind == "spear_e" and variant == 1:
        return build_spear_e_drape(units2.palette("C"))
    return BUILDERS[kind](units2.palette("C"))
