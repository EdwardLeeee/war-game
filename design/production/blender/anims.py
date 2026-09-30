"""New animations for production, to be approved by the user before mass production
(ceo 2026-09-30/10-01). They extend an approved unit's pose(anim, frame) with new animation names;
every other animation goes to the unit's own pose unchanged.

mages   attack (晶彈, the basic shot, 10 frames, released on frame 4):
          東陸劍修: the right hand draws the sword fingers to the chest, then jabs them forward; the
                    fingertip flashes; the left hand rests behind the back.
          西陸學院大師: the staff jabs forward; the crystal cluster flashes; the left hand opens forward.
        hit (the shield takes a blow), shatter (the shield breaks into shards), fall, dead
cavalry death: the horse's forelegs buckle, it rolls onto its side with the rider
siege   walk: the wheels turn (90 degrees a cycle: the 8 spokes loop seamlessly);
        death: the frame drops and leans, a front wheel comes off, the arm falls
farmers work_chop (axe), work_mine (pick), work_farm (hoe), work_build (hammer): the tool in the
        hand changes with the work; idle, walk, attack and death keep the unit's own tool

The root of every rig is reset at the start of each pose, so a fall does not leak into the next
animation rendered in the same Blender process.
"""
import math

import bpy
from mathutils import Euler, Vector

import humanoid2 as h2
import lib
from humanoid import blend, ease, fall, fall_root_tilt, idle
from lib import box, fx_mat, ico, rod, slab

CRYSTAL = (0.35, 0.95, 1.0)
MAGE_NEW = ("attack", "hit", "shatter", "fall", "dead")
WORK = ("work_chop", "work_mine", "work_farm", "work_build")
STAFF_HEAD = {"WA": (0, 1.2, 0), "WB": (0, 1.25, 0), "WC": (0, 1.21, 0)}
SPIN_PER_CYCLE = 90.0       # degrees the siege wheels turn in one 8-frame walk cycle


def _obj(name):
    return bpy.data.objects.get(name)


def _local(u, world):
    """A world point in the unit's own space (fx empties are children of the unit root)."""
    bpy.context.view_layer.update()
    loc = u.root.matrix_world.inverted() @ world
    return (loc.x, loc.y, loc.z)


def _pose_body(r, a, o=None):
    r.pose(a, o or {})
    h2.update(r)


# ---------------------------------------------------------------- mages

def _shards(u, n=18):
    """Shield fragments (effect layer only), hidden until the shield breaks. Solid, not edge-lit:
    a flat shard seen face-on is almost transparent with the shield's fresnel material."""
    m = fx_mat("fx_shard", CRYSTAL, strength=3.0, alpha=1.0, fresnel=False)
    out = []
    ga = math.pi * (3 - math.sqrt(5))
    for k in range(n):
        z = 1 - (k + 0.5) / n * 1.4            # upper part of the dome and a little below the middle
        rr = math.sqrt(max(0.0, 1 - z * z))
        th = ga * k
        d = Vector((rr * math.cos(th), rr * math.sin(th), z)).normalized()
        p0 = Vector((0, 0, 0.95)) + Vector((d.x * 0.78, d.y * 0.78, d.z * 0.78 * 1.18))
        ob = ico(f"fx_shard{k}", 0.11, m, u.root, at=(0, 0, 0), subdiv=1, smooth=False, scale=(1.0, 0.45, 0.8),
                 fx=True)
        ob.location = p0
        ob.rotation_euler = (th, z * 2, th * 0.5)
        ob.scale = (0.001,) * 3
        out.append((ob, p0, d))
    return out


def extend_mage(u, style):
    r = u.rigs["body"]
    inner = u.pose
    shield = _obj("fx_shield_ob")
    shield_alpha = bpy.data.materials["fx_shield"].node_tree.nodes["alpha"].outputs[0] if shield else None
    alpha0 = shield_alpha.default_value if shield_alpha else 0.7
    sig = _obj("fx_sigil_root")
    fingers = r.j.get("fingers")
    shards = _shards(u)
    glow = ico("fx_flash", 0.09, fx_mat("fx_flash", CRYSTAL, strength=4.0, alpha=1.0, fresnel=False), u.root,
               subdiv=2, fx=True)
    glow.scale = (0.001,) * 3
    east = style.startswith("T")

    def tip():
        if east:
            w = r.j["fingers"].matrix_world @ Vector((0, 0.006, -0.105))
        else:
            w = r.j["grip_staff"].matrix_world @ Vector(STAFF_HEAD.get(style, (0, 1.25, 0)))
        return _local(u, w)

    def reset():
        r.root.rotation_euler = (0, 0, 0)
        if shield:
            shield.scale = (1, 1, 1)
            shield_alpha.default_value = alpha0
        for ob, p0, _ in shards:
            ob.location = p0
            ob.scale = (0.001,) * 3
        glow.scale = (0.001,) * 3

    def flash(at, s):
        """A small magic ring and a glowing orb where the shot leaves (the 晶彈 itself is drawn by the game)."""
        sig.location = (at[0], at[1] + 0.05, at[2])
        sig.scale = (s,) * 3
        glow.location = at
        glow.scale = (s * 4,) * 3

    def attack(f):
        base, off = idle(0)
        if east:
            ready = {"shoulderR": (35, 0, -12), "elbowR": (115, 0, 0), "wristR": (10, 0, 0), "torso": (0, 0, 12),
                     "shoulderL": (-30, 0, 12), "elbowL": (80, 0, 0)}
            strike = {"shoulderR": (88, 0, -4), "elbowR": (6, 0, 0), "wristR": (-8, 0, 0), "torso": (-4, 0, -14),
                      "shoulderL": (-30, 0, 12), "elbowL": (80, 0, 0), "hipL": (14, 0, 6), "kneeL": (-10, 0, 0)}
        else:
            ready = {"shoulderR": (20, 0, -24), "elbowR": (85, 0, 0), "torso": (0, 0, 8),
                     "shoulderL": (30, 0, 14), "elbowL": (40, 0, 0)}
            strike = {"shoulderR": (62, 0, -16), "elbowR": (22, 0, 0), "wristR": (-28, 0, 0), "torso": (-5, 0, -10),
                      "shoulderL": (45, 0, 18), "elbowL": (25, 0, 0), "hipL": (12, 0, 6), "kneeL": (-8, 0, 0)}
        if f <= 2:
            a = blend(base, ready, ease(f / 2))
        elif f <= 4:
            a = blend(blend(base, ready, 1), strike, ease((f - 2) / 2))
        elif f <= 5:
            a = blend(base, strike, 1)
        else:
            a = blend(blend(base, strike, 1), base, ease((f - 5) / 4))
        _pose_body(r, a, off)
        if f in (4, 5):
            flash(tip(), 0.36 if f == 4 else 0.18)

    def hit(f):
        base, off = idle(0)
        k = [0.0, 1.0, 0.8, 0.5, 0.25, 0.0][min(f, 5)]
        a = blend(base, {"torso": (10, 0, 0), "neck": (8, 0, 0), "shoulderL": (60, 0, 20), "elbowL": (80, 0, 0),
                         "hipR": (-8, 0, -4), "hipL": (8, 0, 4)}, k)
        _pose_body(r, a, {"hips": (0, -0.04 * k, 0)})
        if shield:
            shield.scale = (1 + 0.07 * k,) * 3
            shield_alpha.default_value = alpha0 + (1.0 - alpha0) * k

    def shatter(f):
        base, off = idle(0)
        guard = {"torso": (14, 0, 0), "neck": (10, 0, 0), "shoulderR": (100, 0, -20), "elbowR": (100, 0, 0),
                 "shoulderL": (100, 0, 20), "elbowL": (100, 0, 0), "hipL": (14, 0, 6), "kneeL": (-16, 0, 0),
                 "kneeR": (-8, 0, 0)}
        k = ease(min(1, f / 2)) if f < 4 else 1 - 0.5 * ease((f - 4) / 3)
        _pose_body(r, blend(base, guard, k), {"hips": (0, -0.05 * k, -0.03 * k)})
        if shield:
            if f <= 1:
                shield.scale = (1 + 0.1 * f,) * 3
                shield_alpha.default_value = 1.0
            else:
                shield.scale = (0.001,) * 3
        if f >= 1:
            t = (f - 1) / 6
            for ob, p0, d in shards:
                p = p0 + d * (1.6 * t)
                p.z -= 1.4 * t * t
                ob.location = (p.x, p.y, max(0.02, p.z))
                ob.scale = (max(0.001, 1 - 0.5 * t),) * 3

    def die(anim, f):
        t = min(1.0, f / 11.0) if anim == "fall" else 1.0
        a, o = fall(t)
        r.pose(a, o)
        # tilt the whole body before the skinned robe follows the joints
        r.root.rotation_euler = [x * lib.D2R for x in fall_root_tilt(t)]
        h2.update(r)
        if shield:
            shield.scale = (0.001,) * 3

    def pose(anim, frame):
        reset()
        if anim not in MAGE_NEW:
            inner(anim, frame)
            return
        inner("idle", 0)            # clears the magic circles and bolt
        if fingers is not None:
            fingers.scale = (1, 1, 1) if anim == "attack" else (0.001,) * 3
        {"attack": attack, "hit": hit, "shatter": shatter}.get(anim, lambda f: die(anim, f))(frame)
    u.pose = pose
    return u


# ---------------------------------------------------------------- cavalry

def extend_cav(u, kind):
    import units2
    hr, rider = u.rigs["horse"], u.rigs["body"]
    inner = u.pose
    lance = rider.j.get("grip_lance")
    P = units2.palette("C")
    # the rider lets go as the horse goes down: the lance then lies on the ground beside it
    dropped = lib.empty(f"{kind}_droppedlance", parent=u.root)
    rod(f"{kind}_droppedlance_shaft", (-1.05, 1.7, 0.03), (-1.0, -1.5, 0.05), 0.024,
        P["shaft"] if kind == "hcav_e" else P["team"], parent=dropped, r2=0.014)
    lib.lathe(f"{kind}_droppedlance_tip", [(0.0, 0.0), (0.032, 0.24), (0.014, 0.3)], P["steel"], dropped, segs=8,
              rot=(-90, 0, 0), at=(0, 0, 0), loc=(-1.06, 2.0, 0.03))
    dropped.scale = (0.001,) * 3

    def pose(anim, frame):
        hr.root.rotation_euler = (0, 0, 0)
        hr.root.location = (0, 0, 0)
        dropped.scale = (0.001,) * 3
        if lance is not None:
            lance.scale = (1, 1, 1)
        if anim != "death":
            inner(anim, frame)
            return
        t = min(1.0, frame / 9.0)
        a = ease(min(1, t / 0.35))                 # forelegs buckle, head drops
        b = ease(max(0.0, (t - 0.3) / 0.7))        # rolls onto its side
        ha = {"legFR": (25 * a - 15 * b, 0, 0), "legFL": (30 * a - 20 * b, 0, 0),
              "lowFR": (-100 * a + 90 * b, 0, 0), "lowFL": (-110 * a + 100 * b, 0, 0),
              "legBR": (-10 * a, 0, 0), "legBL": (-15 * a, 0, 0), "lowBR": (20 * a - 20 * b, 0, 0),
              "lowBL": (25 * a - 25 * b, 0, 0),
              "body": (-12 * a + 12 * b, 0, 0), "neck": (-38 + 25 * a, 0, 0), "tail": (150 - 40 * b, 0, 0)}
        hr.pose(ha, {"body": (0, 0, -0.35 * a * (1 - b))})
        hr.root.rotation_euler = (0, 78 * b * lib.D2R, 0)
        hr.root.location = (-0.55 * b, 0, 0.14 * b)
        ra = dict(rider.rest)
        ra.update({"torso": (30 * a + 10 * b, 0, 0), "neck": (20 * a, 0, 0), "shoulderR": (45 - 20 * b, 0, -30 * b),
                   "shoulderL": (35 - 40 * b, 0, 40 * b), "elbowL": (30, 0, 0)})
        rider.pose(ra, {})
        if lance is not None and b > 0.35:
            lance.scale = (0.001,) * 3
            dropped.scale = (1, 1, 1)
        h2.update(hr)
        h2.update(rider)
    u.pose = pose
    return u


# ---------------------------------------------------------------- siege engines

def extend_siege(u, kind):
    base, arm = _obj(f"{kind}_base"), u.rigs["arm"]
    # the four wheel empties (spoked_wheel): <kind>_w-1a, _w1a, _w-1b, _w1b (not the catapult's winch)
    wheels = [o for o in (_obj(f"{kind}_w{s}{e}") for s in (-1, 1) for e in "ab") if o is not None]
    rest = {o.name: (o.location.copy(), o.rotation_euler.copy()) for o in wheels + [base]}
    inner = u.pose
    spin_axis_rot = Euler((0, 90 * lib.D2R, 0)).to_matrix()
    loose = _obj(f"{kind}_w1a")          # a front wheel on the +x side

    def reset():
        for o in wheels + [base]:
            loc, rot = rest[o.name]
            o.location, o.rotation_euler = loc.copy(), rot.copy()

    def spin(o, deg):
        o.rotation_euler = (spin_axis_rot @ Euler((0, 0, deg * lib.D2R)).to_matrix()).to_euler("XYZ")

    def pose(anim, frame):
        reset()
        if anim == "walk":
            inner("idle", 0)
            n = u.frames.get("walk", 8)
            for o in wheels:
                spin(o, -SPIN_PER_CYCLE * (frame % n) / n)
            return
        if anim != "death":
            inner(anim, frame)
            return
        inner("idle", 0)
        t = min(1.0, frame / 9.0)
        e = ease(t)
        base.location = (rest[base.name][0].x, rest[base.name][0].y, -0.22 * e)
        base.rotation_euler = (6 * e * lib.D2R, -16 * e * lib.D2R, 0)
        if kind == "siege_e":
            arm.rotation_euler = ((55 + 70 * ease(min(1, t * 1.4))) * lib.D2R, 0, 0)
        else:
            # the catapult's arm rests pulled back (70 degrees); broken, it slumps further back onto the
            # frame and twists to one side (swinging it up would read as a shot)
            k = ease(min(1, t * 1.4))
            arm.rotation_euler = ((70 + 32 * k) * lib.D2R, 0, 14 * k * lib.D2R)
        if loose is not None:
            loc0, _ = rest[loose.name]
            w = ease(min(1, t * 1.3))
            loose.location = (loc0.x + 0.45 * w, loc0.y + 0.1 * w, loc0.z - 0.3 * w)
            loose.rotation_euler = (0, (90 - 80 * w) * lib.D2R, 25 * w * lib.D2R)
    u.pose = pose
    return u


# ---------------------------------------------------------------- farmers

def mine(t):
    """Pick swing: higher lift, a deeper bend and a strike close to the feet."""
    up = {"torso": (6, 0, -10), "shoulderR": (165, 0, -10), "elbowR": (25, 0, 0),
          "shoulderL": (150, 0, 15), "elbowL": (30, 0, 0), "hipL": (18, 0, 6), "hipR": (-8, 0, -6)}
    down = {"torso": (-42, 0, 0), "neck": (-10, 0, 0), "shoulderR": (55, 0, -5), "elbowR": (5, 0, 0),
            "shoulderL": (52, 0, 10), "elbowL": (8, 0, 0), "hipL": (32, 0, 6), "kneeL": (-30, 0, 0),
            "hipR": (-4, 0, -6), "kneeR": (-12, 0, 0)}
    if t < 0.5:
        a = blend(down, up, ease(t / 0.5))
    elif t < 0.66:
        a = blend(up, down, ease((t - 0.5) / 0.16))
    else:
        a = down
    return a, {"hips": (0, 0, -0.06)}


def build_work(t):
    """Hammering at chest height: quick strokes, the left hand steadying the work."""
    up = {"torso": (-22, 0, -6), "shoulderR": (125, 0, -12), "elbowR": (95, 0, 0), "wristR": (-20, 0, 0),
          "shoulderL": (55, 0, 12), "elbowL": (60, 0, 0), "hipL": (20, 0, 6), "kneeL": (-18, 0, 0)}
    down = dict(up, shoulderR=(70, 0, -8), elbowR=(25, 0, 0), wristR=(10, 0, 0))
    if t < 0.4:
        a = blend(down, up, ease(t / 0.4))
    elif t < 0.55:
        a = blend(up, down, ease((t - 0.4) / 0.15))
    else:
        a = blend(down, down, 1)
    return a, {"hips": (0, 0, -0.04)}


def _tools(kind, grip, P, X):
    """Four tools under the grip (identity transform, the hand's own axes: the haft runs down -Z)."""
    import roster5
    groups = {}
    for name in ("axe", "pick", "hoe", "hammer"):
        g = lib.empty(f"{kind}_tool_{name}", parent=grip)
        groups[name] = g
    # the unit's own tool goes into its group
    own = "axe" if kind == "farmer_e" else "hoe"
    for ob in list(grip.children):
        if ob.name.startswith(f"{kind}_") and "_tool_" not in ob.name:
            mw = ob.matrix_world.copy()
            ob.parent = groups[own]
            ob.matrix_world = mw
    n = f"{kind}_tool"
    if own != "axe":
        g = groups["axe"]
        rod(f"{n}_axe_haft", (0, 0, 0.12), (0, 0, -0.64), 0.017, X["wood"], parent=g)
        slab(f"{n}_axe_head", [(0, 0.02), (0.1, 0.05), (0.19, 0.08), (0.2, -0.1), (0.1, -0.08), (0, -0.07)], 0.022,
             P["steel"], parent=g, loc=(0, 0, -0.54), rot=(0, 0, 90))
    if own != "hoe":
        g = groups["hoe"]
        rod(f"{n}_hoe_haft", (0, 0, 0.3), (0, 0, -1.1), 0.018, X["wood"], parent=g)
        box(f"{n}_hoe_blade", (0.17, 0.2, 0.016), P["steel"], g, at=(0, -0.09, -1.1), bevel=0.004)
    g = groups["pick"]
    rod(f"{n}_pick_haft", (0, 0, 0.12), (0, 0, -0.68), 0.017, X["wood"], parent=g)
    rod(f"{n}_pick_a", (0, 0, -0.62), (0, 0.25, -0.69), 0.02, P["steel"], parent=g, r2=0.004)
    rod(f"{n}_pick_b", (0, 0, -0.62), (0, -0.23, -0.67), 0.02, P["steel"], parent=g, r2=0.004)
    g = groups["hammer"]
    rod(f"{n}_hammer_haft", (0, 0, 0.08), (0, 0, -0.36), 0.015, X["wood"], parent=g)
    box(f"{n}_hammer_head", (0.055, 0.16, 0.07), X["iron"], g, at=(0, 0.02, -0.38), bevel=0.008)
    return groups, own


def extend_farmer(u, kind):
    import roster5
    import units2
    r = u.rigs["body"]
    grip = r.j["grip_axe"] if kind == "farmer_e" else r.j["grip_hoe"]
    groups, own = _tools(kind, grip, units2.palette("C"), roster5.X5())
    inner = u.pose
    motions = {"work_chop": ("axe", None), "work_mine": ("pick", mine), "work_farm": ("hoe", roster5.hoe_attack),
               "work_build": ("hammer", build_work)}

    def show(tool):
        for name, g in groups.items():
            g.scale = (1, 1, 1) if name == tool else (0.001,) * 3

    def pose(anim, frame):
        r.root.rotation_euler = (0, 0, 0)
        if anim not in WORK:
            show(own)
            inner(anim, frame)
            return
        tool, fn = motions[anim]
        show(tool)
        n = u.frames.get(anim, 8)
        t = (frame % n) / n
        if fn is None:
            import units as U1
            fn = U1.chop
        a, o = fn(t)
        _pose_body(r, a, o)
    u.pose = pose
    return u


def extend(u, kind, style=None):
    if kind.startswith("mage"):
        return extend_mage(u, style or "")
    if kind in ("hcav_e", "knight_w"):
        return extend_cav(u, kind)
    if kind.startswith("siege"):
        return extend_siege(u, kind)
    if kind.startswith("farmer"):
        return extend_farmer(u, kind)
    return u
