"""R3 術士 designs (R3-01), all at R2 detail level C on the R2 smooth body.

A 軍裝術士  officer mage: round-collar field coat, belt of crystal cartridges, winged cap,
            player-colour capelet, the seal mounted on a leather bracer.
B 制式秘術兵 uniformed arcanist: issue coat and hooded mantle, player-colour armband and
            shoulder marks, face in shadow with cyan eye-glints, the seal hanging on the chest.
C 符籙術士  talisman mage: dark close-fitting clothes under layers of talisman strips with
            glowing script, a wide hat with a gauze veil, the seal held in the hand.
Shared: no metal armour, player colour only on sash/capelet/stole, magic fx as in R1.
"""
import math
import random

import bmesh
import bpy

import body2
import humanoid2 as h2
import lib
from humanoid import ease, idle, walk
from lib import box, cyl, fx_mat, ico, lathe, mat, rod, slab, sphere

CRYSTAL = (0.35, 0.95, 1.0)


class Unit:
    frames = {"idle": 12, "walk": 12, "cast": 30}

    def __init__(self, kind):
        self.kind = kind
        self.root = lib.empty(kind + "_unit")
        self.rigs = {}

    def face(self, facing):
        self.root.rotation_euler = (0, 0, lib.heading_for(facing))


def mats():
    return dict(
        skin=mat("skin3", (0.8, 0.6, 0.46), 0.55, sheen=0.2),
        hair=mat("hair3", (0.06, 0.05, 0.045), 0.6, sheen=0.3),
        charcoal=mat("charcoal3", (0.13, 0.125, 0.12), 0.75, noise=0.25, noise_scale=6, pattern="cloth",
                     pattern_scale=90),
        ash=mat("ash3", (0.36, 0.34, 0.31), 0.8, noise=0.3, noise_scale=5, pattern="cloth", pattern_scale=80),
        umber=mat("umber3", (0.2, 0.15, 0.11), 0.8, noise=0.3, noise_scale=5, pattern="cloth", pattern_scale=80),
        black=mat("black3", (0.045, 0.045, 0.05), 0.7, noise=0.2, noise_scale=6, pattern="cloth", pattern_scale=90),
        leather=mat("leather3", (0.28, 0.17, 0.09), 0.55, noise=0.45, noise_scale=14),
        boots=mat("boots3", (0.1, 0.075, 0.06), 0.5, noise=0.25, noise_scale=30),
        gold=mat("gold3", (0.85, 0.62, 0.22), 0.3, 1.0, pattern="worn_metal"),
        bronze=mat("bronze3", (0.72, 0.5, 0.22), 0.35, 1.0, pattern="worn_metal"),
        paper=mat("paper3", (0.86, 0.78, 0.52), 0.85, noise=0.2, noise_scale=12),
        ink=mat("ink3", (0.05, 0.045, 0.04), 0.6),
        straw=mat("straw3", (0.62, 0.52, 0.3), 0.85, noise=0.3, noise_scale=40),
        team=mat("team3", kind="team", rough=0.75, sheen=0.35, noise=0.12, noise_scale=5, pattern="cloth",
                 pattern_scale=90),
        crystal=mat("crystal3", CRYSTAL, 0.1, emission=3.0, kind="emit"),
        glyph=mat("glyph3", CRYSTAL, 0.2, emission=2.2, kind="emit"),
    )


def veil_mat():
    m = mat("veil3", (0.3, 0.3, 0.32), 0.8)
    p = next(n for n in m.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    p.inputs["Alpha"].default_value = 0.32
    return m


def _torso(r):
    J = r.j
    return [(J["hips"], (0, 0, 0.84), (0, 0, 1.03)), (J["torso"], (0, 0, 1.03), (0, 0, 1.45))]


def _legs(r, b):
    J = r.j
    out = []
    for side, s in (("R", 1), ("L", -1)):
        x = 0.1 * s * b
        out += [(J[f"hip{side}"], (x, 0, 0.92), (x, 0, 0.47)), (J[f"knee{side}"], (x, 0, 0.47), (x, 0, 0.05))]
    return out


def _arm(r, side, b):
    J = r.j
    s = 1 if side == "R" else -1
    x = 0.215 * s * b
    return [(J[f"shoulder{side}"], (0.19 * s * b, 0, 1.41), (x, 0, 1.14)), (J[f"elbow{side}"], (x, 0, 1.14), (x, 0, 0.88))]


def _cut(ob, test):
    """Delete the faces whose centre (in the object's own mesh space) passes `test`."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if test(f.calc_center_median())], context="FACES")
    bm.to_mesh(me)
    bm.free()


def seal(name, M, parent, big=1.0):
    box(name, (0.16 * big, 0.16 * big, 0.13 * big), M["bronze"], parent, at=(0, 0, -0.03), bevel=0.014)
    box(name + "_face", (0.14 * big, 0.02, 0.11 * big), M["crystal"], parent, at=(0, 0.085 * big, -0.03),
        outline=False)
    sphere(name + "_knob", 0.035 * big, M["bronze"], parent, at=(0, 0, 0.06 * big))


# ---------------------------------------------------------------- A 軍裝術士

def style_a(u, M):
    b = 0.95
    r = h2.humanoid2("mage_e", M["skin"], M["charcoal"], M["charcoal"], M["boots"], detail="C", parent=u.root,
                     bulk=b, head_r=0.125, beard=M["hair"])
    body2.zero_pose(r)
    tb, lg = _torso(r), _legs(r, b)
    # round-collar field coat: fitted chest, flared skirt to mid-shin, split at the sides
    coat = h2.skinned_lathe("mage_e_coat", [(0.15, 1.46), (0.17, 1.3), (0.165, 1.08), (0.2, 0.8), (0.25, 0.45),
                                            (0.27, 0.35)], M["charcoal"], r, tb + lg, scale=(1, 0.8, 1), segs=32)
    h2.skinned_lathe("mage_e_collar", [(0.075, 1.47), (0.085, 1.53)], M["gold"], r, tb, segs=16)
    h2.skinned_lathe("mage_e_hem", [(0.268, 0.35), (0.272, 0.39)], M["gold"], r, tb + lg, scale=(1, 0.8, 1), segs=32)
    # wide belt with crystal cartridges
    h2.skinned_lathe("mage_e_belt", [(0.172, 1.0), (0.176, 1.08)], M["leather"], r, tb, scale=(1, 0.82, 1), segs=24)
    for k in range(7):
        a = math.radians(-60 + k * 20)
        x, y = 0.18 * math.sin(a), 0.15 * math.cos(a)
        box(f"mage_e_cart{k}", (0.035, 0.03, 0.07), M["leather"], r.j["torso"], loc=(x, y, -0.04), rot=(0, 0, -math.degrees(a)))
        cyl(f"mage_e_cartgem{k}", 0.012, 0.05, M["crystal"], r.j["torso"], loc=(x * 1.04, y * 1.04, -0.02), outline=False)
    # player-colour capelet over the shoulders
    h2.skinned_lathe("mage_e_capelet", [(0.08, 1.52), (0.2, 1.44), (0.27, 1.3), (0.29, 1.18)], M["team"], r,
                     tb + _arm(r, "R", b)[:1] + _arm(r, "L", b)[:1], scale=(1, 0.75, 1), segs=28)
    for side in ("R", "L"):
        x = 0.215 * (1 if side == "R" else -1) * b
        h2.skinned_lathe(f"mage_e_sleeve{side}", [(0.07, 1.4), (0.065, 1.14), (0.058, 0.95)], M["charcoal"], r,
                         _arm(r, side, b), at=(x, 0, 0), segs=14)
    r.pose()
    J = r.j
    # winged cap (展翅帽): a rounded crown and two long flat wings — the silhouette at 1x
    lathe("mage_e_cap", [(0.135, 0.12), (0.138, 0.2), (0.12, 0.27), (0.07, 0.3), (0.0, 0.305)], M["black"], J["head"],
          segs=20)
    box("mage_e_capback", (0.18, 0.08, 0.14), M["black"], J["head"], at=(0, -0.1, 0.26), bevel=0.02)
    for s in (-1, 1):
        box(f"mage_e_wing{s}", (0.36, 0.015, 0.045), M["black"], J["head"], at=(0.28 * s, -0.1, 0.27), bevel=0.006)
        box(f"mage_e_wingtip{s}", (0.03, 0.02, 0.05), M["gold"], J["head"], at=(0.46 * s, -0.1, 0.27))
    ico("mage_e_capgem", 0.03, M["crystal"], J["head"], at=(0, 0.13, 0.21), subdiv=1, smooth=False)
    # bracer with the seal on the back of the right hand
    lathe("mage_e_bracer", [(0.052, -0.06), (0.056, -0.22)], M["leather"], J["elbowR"], segs=14)
    g = r.joint("grip_seal", J["wristR"], (0, 0.03, -0.04))
    seal("mage_e_seal", M, g, 1.05)
    return r


# ---------------------------------------------------------------- B 制式秘術兵

def style_b(u, M):
    """Uniformed arcanist: issue coat and hooded shoulder mantle (every mage of a unit looks the
    same), leather belt and cross-strap, bronze badge, player-colour armband and shoulder marks;
    the face stays in the hood's shadow with two cyan eye-glints."""
    b = 0.93
    r = h2.humanoid2("mage_e", M["skin"], M["ash"], M["black"], M["boots"], detail="C", parent=u.root,
                     bulk=b, head_r=0.125)
    body2.zero_pose(r)
    tb, lg = _torso(r), _legs(r, b)
    coat = h2.skinned_lathe("mage_e_coat", [(0.15, 1.46), (0.172, 1.28), (0.168, 1.04), (0.2, 0.75), (0.24, 0.4),
                                            (0.25, 0.3)], M["ash"], r, tb + lg, scale=(1, 0.8, 1), segs=34)
    _cut(coat, lambda c: c.y > 0.1 and abs(c.x) < 0.07 and c.z < 0.98)          # front vent for walking
    h2.skinned_lathe("mage_e_coathem", [(0.248, 0.3), (0.252, 0.34)], M["black"], r, tb + lg, scale=(1, 0.8, 1),
                     segs=34)
    h2.skinned_lathe("mage_e_belt", [(0.174, 1.0), (0.178, 1.07)], M["leather"], r, tb, scale=(1, 0.82, 1), segs=24)
    # hooded shoulder mantle (the issue cut: straight hem at mid-upper-arm)
    h2.skinned_lathe("mage_e_mantle", [(0.09, 1.52), (0.21, 1.45), (0.28, 1.32), (0.3, 1.22)], M["ash"], r,
                     tb + _arm(r, "R", b)[:1] + _arm(r, "L", b)[:1], scale=(1, 0.78, 1), segs=30)
    h2.skinned_lathe("mage_e_mantlehem", [(0.298, 1.22), (0.302, 1.25)], M["glyph"], r,
                     tb + _arm(r, "R", b)[:1] + _arm(r, "L", b)[:1], scale=(1, 0.78, 1), segs=30)
    for side in ("R", "L"):
        x = 0.215 * (1 if side == "R" else -1) * b
        h2.skinned_lathe(f"mage_e_sleeve{side}", [(0.07, 1.4), (0.066, 1.14), (0.06, 0.94)], M["ash"], r,
                         _arm(r, side, b), at=(x, 0, 0), segs=14)
    # player-colour unit marks: armband on the left arm, a mark on each shoulder
    xl = -0.215 * b
    h2.skinned_lathe("mage_e_armband", [(0.074, 1.27), (0.075, 1.33)], M["team"], r, _arm(r, "L", b), at=(xl, 0, 0),
                     segs=14)
    r.pose()
    J = r.j
    for side, s in (("R", 1), ("L", -1)):
        box(f"mage_e_epaulet{side}", (0.13, 0.12, 0.025), M["team"], J["shoulder" + side], at=(0.02 * s, 0, 0.085),
            bevel=0.01)
    # cross-strap and badge
    box("mage_e_strap", (0.05, 0.02, 0.5), M["leather"], J["torso"], at=(0.0, 0.118, 0.25), rot=(0, 34, 0))
    cyl("mage_e_badge", 0.03, 0.012, M["bronze"], J["torso"], at=(-0.08, 0.12, 0.34), rot=(90, 0, 0))
    # hood up; the face inside stays in shadow with two cyan eye-glints
    hood = lathe("mage_e_hood", [(0.2, -0.08), (0.2, 0.08), (0.185, 0.22), (0.13, 0.32), (0.05, 0.37), (0.0, 0.38)],
                 M["ash"], J["head"], segs=24, at=(0, 0.01, 0.0))
    _cut(hood, lambda c: c.y > 0.08 and -0.02 < c.z < 0.26)
    sphere("mage_e_shadow", 0.12, M["black"], J["head"], at=(0, 0.04, 0.13), scale=(1, 0.8, 1.05))
    for s in (-1, 1):
        sphere(f"mage_e_eyeglow{s}", 0.016, M["crystal"], J["head"], at=(0.042 * s, 0.13, 0.15), scale=(1.3, 0.5, 0.7),
               outline=False)
    # the seal hangs on a chain at the chest and glows
    rod("mage_e_chain", (0.0, 0.14, 0.44), (0.0, 0.2, 0.22), 0.006, M["gold"], parent=J["torso"])
    g = r.joint("grip_seal", J["torso"], (0, 0.2, 0.2))
    seal("mage_e_seal", M, g, 0.9)
    return r


# ---------------------------------------------------------------- C 符籙術士

def style_c(u, M):
    b = 0.93
    r = h2.humanoid2("mage_e", M["skin"], M["black"], M["black"], M["boots"], detail="C", parent=u.root,
                     bulk=b, head_r=0.125)
    body2.zero_pose(r)
    tb, lg = _torso(r), _legs(r, b)
    h2.skinned_lathe("mage_e_tunic", [(0.15, 1.46), (0.168, 1.25), (0.165, 1.02), (0.19, 0.8), (0.21, 0.7)],
                     M["black"], r, tb + lg, scale=(1, 0.8, 1), segs=28)
    h2.skinned_lathe("mage_e_sash", [(0.172, 1.0), (0.176, 1.08)], M["team"], r, tb, scale=(1, 0.82, 1), segs=24)
    r.pose()
    J = r.j
    rnd = random.Random(3)
    # a skirt of talisman strips from the belt (paper, ink script, a glowing glyph each)
    for k in range(16):
        a = 2 * math.pi * k / 16 + rnd.uniform(-0.08, 0.08)
        x, y = 0.19 * math.sin(a), 0.16 * math.cos(a)
        L = rnd.uniform(0.34, 0.46)
        t = slab(f"mage_e_tal{k}", [(-0.028, 0), (0.028, 0), (0.028, -L), (-0.028, -L)], 0.004, M["paper"],
                 parent=J["hips"], loc=(x, y, 0.02), rot=(rnd.uniform(-8, 8), 0, -math.degrees(a)))
        box(f"mage_e_talink{k}", (0.03, 0.006, L * 0.5), M["ink"], t, loc=(0, 0, -L * 0.45), outline=False)
        box(f"mage_e_talglow{k}", (0.022, 0.007, 0.03), M["glyph"], t, loc=(0, 0, -L * 0.18), outline=False)
    # crossed bands of talismans over the chest
    for s in (-1, 1):
        for k in range(5):
            t = slab(f"mage_e_band{s}{k}", [(-0.03, 0), (0.03, 0), (0.03, -0.07), (-0.03, -0.07)], 0.004, M["paper"],
                     parent=J["torso"], loc=(s * (-0.12 + k * 0.06), 0.125, 0.42 - k * 0.07), rot=(0, 35 * s, 0))
            box(f"mage_e_bandglow{s}{k}", (0.02, 0.006, 0.025), M["glyph"], t, loc=(0, 0.004, -0.035), outline=False)
    for side in ("R", "L"):
        el = J["elbow" + side]
        lathe(f"mage_e_wrap{side}", [(0.05, -0.02), (0.052, -0.24)], M["paper"], el, segs=12)
    # wide hat with a gauze veil
    head = J["head"]
    lathe("mage_e_hat", [(0.31, 0.2), (0.26, 0.225), (0.15, 0.28), (0.11, 0.34), (0.0, 0.36)], M["straw"], head, segs=28)
    lathe("mage_e_hatband", [(0.14, 0.26), (0.135, 0.3)], M["team"], head, segs=24)
    lathe("mage_e_veil", [(0.26, 0.2), (0.245, 0.02), (0.235, -0.06)], veil_mat(), head, segs=28, cap=False,
          outline=False)
    g = r.joint("grip_seal", J["wristR"], (0, 0.02, -0.1))
    seal("mage_e_seal", M, g, 1.0)
    return r


STYLES = {"A": style_a, "B": style_b, "C": style_c}


# ---------------------------------------------------------------- effects and poses

def add_fx(u, shield=True):
    shield = None if not shield else ico("fx_shield_ob", 0.78, fx_mat("fx_shield", CRYSTAL, strength=1.5, alpha=0.7, fresnel=True,
                                              hex_pattern=True), u.root, at=(0, 0, 0.95), subdiv=3,
                 scale=(1, 1, 1.18), fx=True)
    sm = fx_mat("fx_sigil", CRYSTAL, strength=1.8, alpha=1.0)
    gm = fx_mat("fx_ground", CRYSTAL, strength=1.5, alpha=0.85)
    bm_ = fx_mat("fx_bolt", (0.3, 0.9, 1.0), strength=2.0, alpha=1.0)
    sig = lib.empty("fx_sigil_root", parent=u.root, loc=(0.18, 0.95, 1.3))
    spin = lib.empty("fx_sigil_spin", parent=sig)
    for k, (rad, w) in enumerate([(0.42, 0.022), (0.34, 0.012), (0.2, 0.014)]):
        lib.ring(f"fx_ring{k}", rad - w, rad + w, sm, spin, fx=True)
    for k in range(6):
        a0 = 2 * math.pi * k / 6
        a1 = a0 + 2 * math.pi / 3
        rod(f"fx_hex{k}", (0.32 * math.cos(a0), 0, 0.32 * math.sin(a0)), (0.32 * math.cos(a1), 0, 0.32 * math.sin(a1)),
            0.008, sm, parent=spin, fx=True, segs=6)
    gsig = lib.empty("fx_gsig_root", parent=u.root, loc=(0, 0, 0.03))
    for k, (rad, w) in enumerate([(0.95, 0.03), (0.78, 0.015)]):
        lib.ring(f"fx_gring{k}", rad - w, rad + w, gm, gsig, fx=True).rotation_euler = (math.pi / 2, 0, 0)
    bolt = lib.empty("fx_bolt_root", parent=u.root, loc=(0.18, 1.0, 1.3))
    lathe("fx_bolt_core", [(0.0, -0.9), (0.09, -0.45), (0.14, 0.0), (0.06, 0.3), (0.0, 0.42)], bm_, bolt,
          rot=(-90, 0, 0), segs=10, fx=True)
    return dict(shield=shield, sig=sig, spin=spin, gsig=gsig, bolt=bolt)


def build(style):
    """style "0" is the current (R2 level C) mage with the same effects and poses, for comparison."""
    M = mats()
    if style == "0":
        import units2
        u = units2.build_mage_e(units2.palette("C"), "C")    # has its own shield
        r = u.rigs["body"]
        u.frames = dict(Unit.frames)
        fx = add_fx(u, shield=False)
    else:
        u = Unit("mage_e")
        r = STYLES[style](u, M)
        u.rigs["body"] = r
        fx = add_fx(u)

    def cast_arms(e):
        if style == "B":   # both hands lift toward the seal at the chest
            return {"shoulderR": (20 + 40 * e, 0, -10), "elbowR": (40 + 60 * e, 0, 0),
                    "shoulderL": (20 + 40 * e, 0, 10), "elbowL": (40 + 60 * e, 0, 0), "torso": (-4 * e, 0, 0),
                    "neck": (-8 * e, 0, 0)}
        return {"shoulderR": (8 + 78 * e, 0, -10 + 4 * e), "elbowR": (20 - 12 * e, 0, 0), "wristR": (-10 * e, 0, 0),
                "shoulderL": (20 + 30 * e, 0, 30 * e), "elbowL": (40 + 70 * e, 0, 0),
                "torso": (-2 - 4 * e, 0, -8 * e), "hipR": (-6 * e, 0, -6), "hipL": (12 * e, 0, 6),
                "kneeL": (-10 * e, 0, 0)}

    sig_home = (0.0, 0.62, 1.2) if style == "B" else (0.18, 0.95, 1.3)

    def pose(anim, frame):
        fx["sig"].scale = (0.001,) * 3
        fx["gsig"].scale = (0.001,) * 3
        fx["bolt"].scale = (0.001,) * 3
        fx["sig"].location = sig_home
        fx["sig"].rotation_euler = (30 * lib.D2R, 0, 135 * lib.D2R - u.root.rotation_euler[2])
        if anim == "walk":
            a, o = walk(frame / 12, arms=True, stride=22)
            r.pose(a, o)
        elif anim == "cast":
            f = frame
            if f < 6:
                e = ease(f / 6)
                r.pose(cast_arms(e), {})
                fx["sig"].scale = (0.3 * e + 0.001,) * 3
                fx["gsig"].scale = (0.5 * e + 0.001,) * 3
            elif f < 24:
                e = (f - 6) / 18
                r.pose(cast_arms(1.0), {})
                fx["sig"].scale = (0.35 + 0.65 * ease(min(1, e * 1.4)),) * 3
                fx["gsig"].scale = (0.5 + 0.5 * ease(min(1, e * 1.6)),) * 3
                fx["gsig"].rotation_euler = (0, 0, e * 1.5)
                fx["spin"].rotation_euler = (0, e * 2.6, 0)
            else:
                e = (f - 24) / 6
                r.pose(cast_arms(1.0 - 0.6 * max(0, e - 0.4)), {})
                fx["sig"].scale = (max(0.001, 1.0 - e),) * 3
                fx["gsig"].scale = (max(0.001, 1.0 - e),) * 3
                fx["bolt"].scale = (1.0 + 0.5 * (1 - e),) * 3
                fx["bolt"].location = (sig_home[0], sig_home[1] + 0.05 + 3.2 * e + 0.4, sig_home[2] + 0.1 * e)
        else:
            a, o = idle(frame / 12)
            r.pose(a, o)
        h2.update(r)
    u.pose = pose
    return u
