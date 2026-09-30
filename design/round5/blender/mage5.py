"""R5-01 西陸晶術師 (West mage) designs, level C on the R2 body, R4 garment helpers.

WA 晶劍士   young crystal swordsman, paired with the East 劍修: knee-length leather coat over a
            light shirt, player-colour shoulder mantle and front sash; the staff is his sword, a
            person-high shaft topped with a glowing crystal blade.
WB 學院大師 elder academy master: dark academic robe with wide sleeves and cream cuffs,
            player-colour shoulder capelet, cream stole down the front, long grey beard, soft round
            cap (no hood: hoods belong to the longbowmen), book at the belt, a tall gnarled staff
            holding a crystal cluster.
WC 女晶術師 woman crystal mage: braided crown of hair, slate-grey gown, player-colour shawl crossed
            over the chest, a slender staff with a large crystal orb and three orbiting shards.
Rules: the army's elite, no metal armour, never fly, the staff is at least person-high and its
crystal glows (emissive, plus a compose-time glow) so it reads at actual size, player colour large and in front.
"""
import math

import bpy

import body2
import humanoid2 as h2
import lib
import mage3
import mage4
from humanoid import ease, idle, walk
from lib import box, ico, lathe, mat, rod, sphere


def M5():
    return dict(
        coat=mat("coat5", (0.26, 0.17, 0.1), 0.55, noise=0.35, noise_scale=12),
        shirt=mat("shirt5", (0.8, 0.76, 0.66), 0.8, noise=0.1, noise_scale=6, pattern="cloth", pattern_scale=100),
        trousers=mat("trousers5", (0.14, 0.13, 0.12), 0.75, noise=0.2, noise_scale=6, pattern="cloth", pattern_scale=100),
        robe=mat("robe5", (0.1, 0.1, 0.11), 0.7, noise=0.2, noise_scale=6, pattern="cloth", pattern_scale=100),
        cream=mat("cape5", (0.82, 0.78, 0.68), 0.8, noise=0.1, noise_scale=6, pattern="cloth", pattern_scale=100),
        gown=mat("gown5", (0.33, 0.35, 0.37), 0.75, noise=0.15, noise_scale=6, pattern="cloth", pattern_scale=110),
        greyhair=mat("greyhair5", (0.72, 0.71, 0.68), 0.6, sheen=0.4),
        brownhair=mat("brownhair5", (0.28, 0.17, 0.09), 0.6, sheen=0.4),
        auburn=mat("auburn5", (0.42, 0.18, 0.08), 0.6, sheen=0.4),
        wood=mat("staffwood5", (0.33, 0.22, 0.12), 0.6, noise=0.4, noise_scale=10),
        palewood=mat("palewood5", (0.72, 0.64, 0.5), 0.55, noise=0.2, noise_scale=10),
        leather=mat("belt5", (0.2, 0.12, 0.07), 0.55, noise=0.3, noise_scale=20),
        book=mat("book5", (0.35, 0.1, 0.08), 0.6),
    )


def staff(r, M, X, kind):
    """Staff in the right hand, planted-length (foot near the ground), upright while the forearm is
    level: its axis is the hand's local +Y. The crystal is emissive; the soft glow is added in compose
    (a see-through halo mesh would turn solid in the mask/albedo/light passes)."""
    g = r.joint("grip_staff", r.j["wristR"], (0, 0.0, -0.06))
    if kind == "blade":
        rod("mage_staff", (0, -1.0, 0), (0, 0.95, 0), 0.02, X["wood"], parent=g)
        box("mage_staffguard", (0.14, 0.035, 0.035), M["gold"], g, at=(0, 0.96, 0), bevel=0.008)
        # built along +Z then turned onto the staff axis (+Y): pre-rotation z becomes y
        lathe("mage_staffblade", [(0.0, 0.0), (0.05, 0.06), (0.045, 0.28), (0.0, 0.42)], M["crystal"], g,
              at=(0, 0, 0.98), rot=(-90, 0, 0), scale=(1, 0.35, 1), segs=8, outline=False)
        return g, (0, 1.2, 0)
    if kind == "cluster":
        rod("mage_staff", (0, -1.0, 0), (0.01, 1.1, 0.02), 0.026, X["wood"], parent=g, r2=0.019)
        for k in range(3):
            a = 2 * math.pi * k / 3
            rod(f"mage_staffprong{k}", (0.01, 1.08, 0.02), (0.075 * math.cos(a), 1.28, 0.075 * math.sin(a)), 0.013,
                X["wood"], parent=g, r2=0.006)
        for k, (dx, dy, dz, s_) in enumerate([(0, 1.23, 0, 1.0), (0.045, 1.18, 0.03, 0.7), (-0.045, 1.19, -0.02, 0.75)]):
            ico(f"mage_staffcrystal{k}", 0.065 * s_, M["crystal"], g, at=(dx, dy, dz), subdiv=1, smooth=False,
                scale=(0.7, 1.6, 0.7), outline=False)
        return g, (0, 1.25, 0)
    rod("mage_staff", (0, -1.0, 0), (0, 1.08, 0), 0.017, X["palewood"], parent=g)
    lathe("mage_staffcup", [(0.0, 1.06), (0.038, 1.11), (0.032, 1.15)], M["gold"], g, segs=12, rot=(-90, 0, 0))
    ico("mage_stafforb", 0.08, M["crystal"], g, at=(0, 1.21, 0), subdiv=2, outline=False)
    for k in range(3):
        a = 2 * math.pi * k / 3
        ico(f"mage_staffshard{k}", 0.027, M["crystal"], g, at=(0.14 * math.cos(a), 1.21 + 0.04 * math.sin(3 * a),
                                                              0.14 * math.sin(a)), subdiv=1, smooth=False,
            scale=(0.6, 1.4, 0.6), outline=False)
    return g, (0, 1.21, 0)


# ---------------------------------------------------------------- WA 晶劍士

def style_wa(u, M):
    X = M5()
    b = 0.95
    r = h2.humanoid2("mage_w", M["skin"], X["shirt"], X["trousers"], M["boots"], detail="C", parent=u.root, bulk=b,
                     head_r=0.122)
    body2.zero_pose(r)
    tb, lg = mage3._torso(r), mage3._legs(r, b)
    mage4.folded_lathe("mage_w_coat", [(0.16, 1.44), (0.18, 1.26), (0.178, 1.02), (0.21, 0.75), (0.24, 0.5)], X["coat"],
                       r, tb + lg, folds=(8, 0.04), scale=(1, 0.84, 1),
                       cut=lambda c: c.y > 0.08 and abs(c.x) < 0.09 and c.z < 1.3)
    h2.skinned_lathe("mage_w_sash", [(0.182, 0.98), (0.186, 1.1)], M["team"], r, tb, scale=(1, 0.84, 1), segs=28)
    # player-colour shoulder mantle, open in front, falling to the chest
    h2.skinned_lathe("mage_w_mantle", [(0.09, 1.52), (0.21, 1.46), (0.27, 1.34), (0.28, 1.22)], M["team"], r,
                     tb + mage3._arm(r, "R", b)[:1] + mage3._arm(r, "L", b)[:1], scale=(1, 0.8, 1), segs=30)
    for side in ("R", "L"):
        x = 0.215 * (1 if side == "R" else -1) * b
        h2.skinned_lathe(f"mage_w_sleeve{side}", [(0.068, 1.4), (0.064, 1.14), (0.056, 0.92)], X["coat"], r,
                         mage3._arm(r, side, b), at=(x, 0, 0), segs=14)
    r.pose()
    J = r.j
    head = J["head"]
    sphere("mage_w_hair", 0.13, X["brownhair"], head, at=(0, -0.02, 0.14), scale=(1, 1.02, 0.92))
    box("mage_w_belt", (0.39, 0.3, 0.04), X["leather"], J["torso"], at=(0, 0, 0.0), bevel=0.01)
    g, head_at = staff(r, M, X, "blade")
    return r, head_at


# ---------------------------------------------------------------- WB 學院大師

def style_wb(u, M):
    X = M5()
    b = 0.95
    r = h2.humanoid2("mage_w", M["skin"], X["robe"], X["robe"], M["boots"], detail="C", parent=u.root, bulk=b,
                     head_r=0.125)
    body2.zero_pose(r)
    tb, lg = mage3._torso(r), mage3._legs(r, b)
    mage4.folded_lathe("mage_w_robe", [(0.155, 1.46), (0.176, 1.26), (0.178, 1.02), (0.21, 0.7), (0.245, 0.3),
                                       (0.255, 0.05)], X["robe"], r, tb + lg, folds=(10, 0.05), scale=(1, 0.84, 1))
    # player-colour capelet over the shoulders: the biggest area facing the camera
    h2.skinned_lathe("mage_w_capelet", [(0.08, 1.53), (0.2, 1.46), (0.25, 1.36), (0.26, 1.26)], M["team"], r,
                     tb + mage3._arm(r, "R", b)[:1] + mage3._arm(r, "L", b)[:1], scale=(1, 0.8, 1), segs=28)
    mage4._wide_sleeves(r, X["robe"], b, cuff=X["cream"], flare=0.16)
    # cream academic stole: two strips from under the capelet down the front to the knees
    for s_ in (1, -1):
        mage4.ribbon(f"mage_w_stole{s_}", [(0.075 * s_, 0.12, 1.44), (0.085 * s_, 0.17, 1.2), (0.09 * s_, 0.2, 0.95),
                                           (0.1 * s_, 0.22, 0.7), (0.1 * s_, 0.24, 0.5)], 0.09, X["cream"], r, tb + lg)
    r.pose()
    J = r.j
    head = J["head"]
    sphere("mage_w_hair", 0.128, X["greyhair"], head, at=(0, -0.03, 0.12), scale=(1, 1, 0.8))
    lathe("mage_w_cap", [(0.135, 0.2), (0.15, 0.24), (0.13, 0.3), (0.0, 0.31)], X["robe"], head, segs=20)
    lathe("mage_w_beard", [(0.0, -0.32), (0.04, -0.22), (0.075, -0.08), (0.08, 0.02), (0.06, 0.07)], X["greyhair"],
          head, at=(0, 0.08, 0.1), scale=(1, 0.6, 1), segs=14)
    box("mage_w_book", (0.12, 0.05, 0.16), X["book"], J["torso"], at=(-0.19, 0.06, -0.08), rot=(0, 0, 20), bevel=0.01)
    g, head_at = staff(r, M, X, "cluster")
    return r, head_at


# ---------------------------------------------------------------- WC 女晶術師

def style_wc(u, M):
    X = M5()
    b = 0.88
    r = h2.humanoid2("mage_w", M["skin"], X["gown"], X["gown"], M["boots"], detail="C", parent=u.root, bulk=b,
                     head_r=0.118)
    body2.zero_pose(r)
    tb, lg = mage3._torso(r), mage3._legs(r, b)
    mage4.folded_lathe("mage_w_gown", [(0.145, 1.46), (0.16, 1.26), (0.155, 1.06), (0.2, 0.75), (0.25, 0.35),
                                       (0.275, 0.03)], X["gown"], r, tb + lg, folds=(12, 0.055), scale=(1, 0.86, 1))
    mage4._wide_sleeves(r, X["gown"], b, flare=0.12)
    # player-colour shawl: over both shoulders, crossing low on the chest
    for s_ in (1, -1):
        mage4.ribbon(f"mage_w_shawl{s_}", [(-0.2 * s_, -0.06, 1.44), (-0.14 * s_, 0.06, 1.46), (-0.05 * s_, 0.15, 1.34),
                                           (0.06 * s_, 0.17, 1.18), (0.15 * s_, 0.16, 1.02), (0.19 * s_, 0.17, 0.84),
                                           (0.2 * s_, 0.2, 0.68)],
                     0.19, M["team"], r, tb + lg[:1] + lg[2:3] + mage3._arm(r, "R", b)[:1] + mage3._arm(r, "L", b)[:1])
    r.pose()
    J = r.j
    head = J["head"]
    sphere("mage_w_hair", 0.126, X["auburn"], head, at=(0, -0.02, 0.14), scale=(1, 1, 0.95))
    lathe("mage_w_braid", [(0.1, 0.23), (0.125, 0.26), (0.11, 0.3), (0.06, 0.32)], X["auburn"], head, segs=18)
    g, head_at = staff(r, M, X, "orb")
    return r, head_at


STYLES = {"WA": style_wa, "WB": style_wb, "WC": style_wc}


def build(style):
    M = mage3.mats()
    u = mage3.Unit("mage_w")
    r, head_local = STYLES[style](u, M)
    u.rigs["body"] = r
    fx = mage3.add_fx(u)
    hold = {"shoulderR": (8, 0, -24), "elbowR": (78, 0, 0)}   # staff upright, a little out to the side

    def cast_arms(e):
        # the staff is raised and thrust forward (head about 25 degrees past upright), the free
        # hand points ahead at chest height
        return {"shoulderR": (8 + 67 * e, 0, -24 + 14 * e), "elbowR": (78 - 63 * e, 0, 0), "wristR": (-25 * e, 0, 0),
                "shoulderL": (20 + 40 * e, 0, 20 * e), "elbowL": (40 - 10 * e, 0, 0),
                "torso": (-2 - 4 * e, 0, -8 * e), "hipR": (-6 * e, 0, -6), "hipL": (12 * e, 0, 6),
                "kneeL": (-10 * e, 0, 0)}

    def staff_tip_home():
        """Where the staff crystal is now, in the unit's own space (the magic circle goes there)."""
        from mathutils import Vector
        bpy.context.view_layer.update()
        w = r.j["grip_staff"].matrix_world @ Vector(head_local)
        loc = u.root.matrix_world.inverted() @ w
        return (loc.x, loc.y + 0.08, loc.z)

    def pose(anim, frame):
        fx["sig"].scale = (0.001,) * 3
        fx["gsig"].scale = (0.001,) * 3
        fx["bolt"].scale = (0.001,) * 3
        fx["sig"].rotation_euler = (30 * lib.D2R, 0, 135 * lib.D2R - u.root.rotation_euler[2])
        if anim == "walk":
            a, o = walk(frame / 12, arms=True, stride=22)
            a.update(hold)
            r.pose(a, o)
        elif anim == "cast":
            f = frame
            if f < 6:
                e = ease(f / 6)
                r.pose(cast_arms(e), {})
                fx["sig"].location = staff_tip_home()
                fx["sig"].scale = (0.3 * e + 0.001,) * 3
                fx["gsig"].scale = (0.5 * e + 0.001,) * 3
            elif f < 24:
                e = (f - 6) / 18
                r.pose(cast_arms(1.0), {})
                fx["sig"].location = staff_tip_home()
                fx["sig"].scale = (0.35 + 0.65 * ease(min(1, e * 1.4)),) * 3
                fx["gsig"].scale = (0.5 + 0.5 * ease(min(1, e * 1.6)),) * 3
                fx["gsig"].rotation_euler = (0, 0, e * 1.5)
                fx["spin"].rotation_euler = (0, e * 2.6, 0)
            else:
                e = (f - 24) / 6
                r.pose(cast_arms(1.0), {})
                home = staff_tip_home()
                fx["sig"].location = home
                fx["sig"].scale = (max(0.001, 1.0 - e),) * 3
                fx["gsig"].scale = (max(0.001, 1.0 - e),) * 3
                fx["bolt"].scale = (1.0 + 0.5 * (1 - e),) * 3
                fx["bolt"].location = (home[0], home[1] + 0.05 + 3.2 * e + 0.4, home[2] + 0.1 * e)
        else:
            a, o = idle(frame / 12)
            a.update(hold)
            r.pose(a, o)
        h2.update(r)
    u.pose = pose
    return u
