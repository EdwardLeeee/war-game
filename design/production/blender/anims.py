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
from mathutils import Euler, Matrix, Vector

import humanoid2 as h2
import lib
import motion
from humanoid import blend, ease, fall, fall_root_tilt, idle
from lib import box, fx_mat, ico, rod, slab

CRYSTAL = (0.35, 0.95, 1.0)
MAGE_NEW = ("attack", "hit", "shatter", "fall", "dead")
STAFF_HEAD = {"WA": (0, 1.2, 0), "WB": (0, 1.25, 0), "WC": (0, 1.21, 0)}
SPIN_PER_CYCLE = 90.0       # degrees the siege wheels turn in one 8-frame walk cycle

# P2 mage fall: joints keyed over the 12 frames (time 0..1); the hips carry the body down and over
# (offset from the standing hips, then Euler XYZ: tilt back, roll, turn)
FALL_JOINTS = ("torso", "neck", "shoulderR", "elbowR", "shoulderL", "elbowL", "hipR", "kneeR", "hipL", "kneeL")
FALL_KEYS = [
    # recoil: chest and head thrown back, arms flung out, the knees start to go
    (0.18, dict(hips=(0, -0.03, -0.03), hips_rot=(0, 0, 0), torso=(16, 0, 6), neck=(12, 0, -8),
                shoulderR=(10, -55, 0), elbowR=(30, 0, 0), shoulderL=(-10, 50, 0), elbowL=(35, 0, 0),
                hipR=(10, 0, -4), kneeR=(-20, 0, 0), hipL=(16, 0, 4), kneeL=(-30, 0, 0)), "out"),
    # the knees buckle: the body drops straight down and slumps forward
    (0.42, dict(hips=(0.02, -0.10, -0.42), hips_rot=(-8, 0, 10), torso=(-22, 6, -8), neck=(-18, 0, 10),
                shoulderR=(20, -20, 0), elbowR=(40, 0, 0), shoulderL=(15, 25, 0), elbowL=(50, 0, 0),
                hipR=(70, -8, 0), kneeR=(-125, 0, 0), hipL=(95, 10, 0), kneeL=(-130, 0, 0)), "in"),
    # tipping over backward and to the side, the arms trailing
    (0.62, dict(hips=(-0.05, -0.25, -0.66), hips_rot=(48, -14, 22), torso=(10, -6, 10), neck=(10, 0, 20),
                shoulderR=(100, -40, 0), elbowR=(30, 0, 0), shoulderL=(50, 60, 0), elbowL=(40, 0, 0),
                hipR=(30, -6, 0), kneeR=(-70, 0, 0), hipL=(60, 8, 0), kneeL=(-100, 0, 0)), "lin"),
    # the back hits the ground
    (0.75, dict(hips=(-0.10, -0.38, -0.80), hips_rot=(88, -10, 28), torso=(4, 0, 6), neck=(-6, 0, 30),
                shoulderR=(30, -60, 0), elbowR=(30, 0, 0), shoulderL=(20, 40, 0), elbowL=(30, 0, 0),
                hipR=(8, -12, 0), kneeR=(-18, 0, 0), hipL=(48, 10, 0), kneeL=(-80, 0, 0)), "in"),
    # one small bounce
    (0.84, dict(hips=(-0.10, -0.38, -0.765), hips_rot=(84, -10, 28), torso=(8, 0, 6),
                shoulderR=(34, -56, 0), shoulderL=(24, 36, 0)), "out"),
    # at rest: on the back, turned, one knee up, the right arm flung out toward the camera, the left
    # one by the side (an arm up by the head hides the head under the wide sleeve; an arm pointing
    # away from the camera reads as a tube standing up)
    (1.0, dict(hips=(-0.10, -0.39, -0.81), hips_rot=(89, -10, 28), torso=(3, 0, 6), neck=(-8, 0, 34),
               shoulderR=(4, -40, 0), elbowR=(10, 0, 0), shoulderL=(4, 28, 0), elbowL=(12, 0, 0),
               hipR=(4, -14, 0), kneeR=(-10, 0, 0), hipL=(40, 12, 0), kneeL=(-72, 0, 0)), "smooth"),
]
STAFF_LEN = 1.0                    # hand to the foot of the staff (mage5.staff)
STAFF_LIES = (0.80, 0.55, 0.0)     # where the dropped staff points on the ground (unit space)
MAGE_IMPACT = 8                    # the frame of `fall` where the body lands (for the game's dust)
HIT_K = [0.0, 1.0, 0.8, 0.5, 0.25, 0.0]     # how bright the shield flashes over the 6 frames of `hit`


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
    staff = r.j.get("grip_staff")
    # the West mages stand holding the staff upright (mage5.build's hold pose); every new animation
    # starts and ends there, or the staff would snap flat when the game switches from idle
    hold = {} if east else {"shoulderR": (8, 0, -24), "elbowR": (78, 0, 0)}

    def stand():
        base, off = idle(0)
        base.update(hold)
        return base, off

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
        base, off = stand()
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
        base, off = stand()
        k = HIT_K[min(f, len(HIT_K) - 1)]
        a = blend(base, {"torso": (10, 0, 0), "neck": (8, 0, 0), "shoulderL": (60, 0, 20), "elbowL": (80, 0, 0),
                         "hipR": (-8, 0, -4), "hipL": (8, 0, 4)}, k)
        _pose_body(r, a, {"hips": (0, -0.04 * k, 0)})
        if shield:
            shield.scale = (1 + 0.07 * k,) * 3
            shield_alpha.default_value = alpha0 + (1.0 - alpha0) * k

    def shatter(f):
        base, off = stand()
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
        """P2: the knees give first, the body sinks, tips backward and to one side, lands with a
        small bounce and ends lying askew with the limbs spread. The 學院大師's staff is let go on
        the first frame and topples on its own, pivoting on its foot."""
        t = min(1.0, f / 11.0) if anim == "fall" else 1.0
        base, off = stand()
        k0 = {name: tuple(base.get(name, (0, 0, 0))) for name in FALL_JOINTS}
        k0.update(hips=(0, 0, 0), hips_rot=(0, 0, 0))
        k = motion.sample([(0.0, k0, "lin")] + FALL_KEYS, t)
        ang = {name: k[name] for name in FALL_JOINTS}
        ang["hips"] = k["hips_rot"]
        if staff is not None:
            # where the staff stood in the hand (unit space), before the body moves
            r.pose(base, off)
            bpy.context.view_layer.update()
            M0 = u.root.matrix_world.inverted() @ staff.matrix_world
        r.pose(ang, {"hips": k["hips"]})
        if staff is not None:
            axis0 = (M0.to_3x3() @ Vector((0, 1, 0))).normalized()
            foot = M0 @ Vector((0, -STAFF_LEN, 0))
            foot.z = max(foot.z, 0.03)
            q = motion.ease_in((t - 0.02) / 0.55) - motion.bounce(t, 0.57, 0.8, 0.07)
            axis = axis0.lerp(Vector(STAFF_LIES), motion.clamp(q)).normalized()
            R = motion.frame((M0.to_3x3() @ Vector((1, 0, 0))).cross(axis), axis)     # +Y along the staff
            motion.place(u, staff, foot + axis * STAFF_LEN, R)
        h2.update(r)
        if shield:
            shield.scale = (0.001,) * 3

    def shield_layer(anim, f):
        """The separate shield layer (client/docs/sprite-atlas.md version 2, section 4): only the
        shield is rendered (render_units.py hides the body), so the body pose does not matter."""
        inner("idle", 0)
        if not shield:
            return
        if anim == "shield_hit":
            k = HIT_K[min(f, len(HIT_K) - 1)]
            shield.scale = (1 + 0.07 * k,) * 3
            shield_alpha.default_value = alpha0 + (1.0 - alpha0) * k
        elif anim == "shield_break":            # = the shield in the first two frames of shatter
            shield.scale = (1 + 0.1 * min(f, 1),) * 3
            shield_alpha.default_value = 1.0

    def pose(anim, frame):
        reset()
        if anim.startswith("shield_"):
            shield_layer(anim, frame)
            return
        if anim not in MAGE_NEW:
            inner(anim, frame)
            return
        inner("idle", 0)            # clears the magic circles and bolt
        if fingers is not None:
            fingers.scale = (1, 1, 1) if anim == "attack" else (0.001,) * 3
        {"attack": attack, "hit": hit, "shatter": shatter}.get(anim, lambda f: die(anim, f))(frame)
    u.pose = pose
    return u


# ---------------------------------------------------------------- cavalry (P2)
#
# death, 10 frames: the horse stumbles on its forelegs (they fold and stay folded), the hindquarters
# follow and it rolls onto its left side with its legs tucked and its neck on the ground; the rider
# is pitched forward out of the saddle, lands face down ahead of the horse and lies sprawled; the
# lance falls beside them. Slow to start, fast into the ground, one small bounce.

HORSE_KEYS = [
    (0.0, dict(body_off=(0, 0, 0), body_rot=(0, 0, 0), neck=(-38, 0, 0), head=(-112, 0, 0), tail=(149, 0, 0),
               legFR=(0, 0, 0), lowFR=(0, 0, 0), legFL=(3, 0, 0), lowFL=(0, 0, 0),
               legBR=(-3, 0, 0), lowBR=(4, 0, 0), legBL=(0, 0, 0), lowBL=(0, 0, 0)), "lin"),
    (0.2, dict(body_off=(0, 0.04, -0.12), body_rot=(-12, 0, 0), neck=(-60, 0, 0), head=(-104, 0, 0),
               tail=(120, 0, 0), legFR=(18, 0, 0), lowFR=(-60, 0, 0), legFL=(10, 0, 0), lowFL=(-85, 0, 0),
               legBR=(-8, 0, 0), lowBR=(6, 0, 0), legBL=(-12, 0, 0), lowBL=(8, 0, 0)), "out"),
    (0.42, dict(body_off=(-0.02, 0.10, -0.36), body_rot=(-24, -8, 0), neck=(-86, 0, 8), head=(-98, 0, 0),
                legFR=(22, 0, 0), lowFR=(-128, 0, 0), legFL=(28, 0, 0), lowFL=(-135, 0, 0),
                legBR=(-14, 0, 0), lowBR=(14, 0, 0), legBL=(-6, 0, 0), lowBL=(10, 0, 0)), "in"),
    (0.62, dict(body_off=(-0.14, 0.10, -0.60), body_rot=(-10, -46, 6), neck=(-84, 0, 16), head=(-108, 0, 0),
                tail=(115, 0, 0), legFR=(30, 0, 0), lowFR=(-118, 0, 0), legFL=(34, 0, 0), lowFL=(-120, 0, 0),
                legBR=(30, 0, 0), lowBR=(-50, 0, 0), legBL=(40, 0, 0), lowBL=(-70, 0, 0)), "lin"),
    (0.78, dict(body_off=(-0.20, 0.06, -0.85), body_rot=(2, -87, 10), neck=(-88, 0, 24), head=(-120, 0, 0),
                tail=(100, 0, 0), legFR=(22, 0, 0), lowFR=(-92, 0, 0), legFL=(40, 0, 0), lowFL=(-118, 0, 0),
                legBR=(38, 0, 0), lowBR=(-72, 0, 0), legBL=(52, 0, 0), lowBL=(-98, 0, 0)), "in"),
    (0.88, dict(body_off=(-0.20, 0.06, -0.80), body_rot=(0, -81, 10)), "out"),
    (1.0, dict(body_off=(-0.21, 0.06, -0.855), body_rot=(2, -88, 10), neck=(-90, 0, 26), tail=(95, 0, 0)),
     "smooth"),
]
# the rider: where the hips are (unit space) and how the body is turned, then the limbs
RIDER_KEYS = [
    (0.2, dict(at=(0, 0.10, 1.40), rot=(-28, 0, 0), torso=(-18, 0, 0), neck=(10, 0, 0),
               shoulderR=(70, -20, 0), elbowR=(40, 0, 0), shoulderL=(60, 25, 0), elbowL=(50, 0, 0)), "out"),
    (0.42, dict(at=(0.14, 0.72, 1.34), rot=(-62, 6, -12), torso=(-10, 0, 0), neck=(20, 0, 0),
                shoulderR=(140, -25, 0), elbowR=(25, 0, 0), shoulderL=(130, 30, 0), elbowL=(30, 0, 0),
                hipR=(30, -12, -10), kneeR=(-50, 0, 0), hipL=(20, 14, 10), kneeL=(-40, 0, 0),
                ankleR=(20, 0, 0), ankleL=(20, 0, 0)), "in"),
    (0.62, dict(at=(0.48, 1.38, 0.74), rot=(-92, 10, -26), torso=(6, 0, 0),
                shoulderR=(160, -30, 0), shoulderL=(140, 40, 0),
                hipR=(10, -6, 0), kneeR=(-30, 0, 0), hipL=(5, 8, 0), kneeL=(-20, 0, 0)), "lin"),
    (0.76, dict(at=(0.70, 1.74, 0.16), rot=(-90, 12, -32), torso=(12, 0, 0), neck=(10, 0, 28),
                shoulderR=(168, -28, 0), elbowR=(35, 0, 0), shoulderL=(118, 52, 0), elbowL=(75, 0, 0),
                hipR=(-4, -5, 0), kneeR=(-8, 0, 0), hipL=(-6, 7, 0), kneeL=(-42, 0, 0),
                ankleR=(35, 0, 0), ankleL=(35, 0, 0)), "in"),
    (0.86, dict(at=(0.72, 1.78, 0.21), rot=(-86, 12, -33), torso=(14, 0, 0)), "out"),
    (1.0, dict(at=(0.75, 1.82, 0.14), rot=(-89, 12, -34), torso=(4, 0, 0)), "smooth"),
]
RIDER_JOINTS = ("torso", "neck", "shoulderR", "elbowR", "shoulderL", "elbowL", "hipR", "kneeR", "hipL", "kneeL",
                "ankleR", "ankleL")
LANCE_LIES = dict(at=(1.25, 0.10, 0.05), tip=(0.10, 0.99, 0.0))     # the grip point and where the tip points
CAV_IMPACT = 7                     # the frame where the horse's body lands (for the game's dust)


def extend_cav(u, kind):
    hr, rider = u.rigs["horse"], u.rigs["body"]
    inner = u.pose
    lance = rider.j.get("grip_lance")
    root_rest = rider.root.matrix_basis.copy()

    def pose(anim, frame):
        hr.root.rotation_euler = (0, 0, 0)
        hr.root.location = (0, 0, 0)
        rider.root.matrix_basis = root_rest.copy()
        if anim != "death":
            inner(anim, frame)
            return
        n = u.frames.get("death", 10)
        t = min(1.0, frame / (n - 1.0))
        # where the rider sat and the lance was held (unit space), before anything moves
        inner("idle", 0)
        bpy.context.view_layer.update()
        Wi = u.root.matrix_world.inverted()
        seat = Wi @ rider.j["hips"].matrix_world.translation
        L0 = Wi @ lance.matrix_world if lance is not None else None
        # the horse
        k = motion.sample(HORSE_KEYS, t)
        ang = {name: k[name] for name in k if name not in ("body_off", "body_rot")}
        ang["body"] = k["body_rot"]
        hr.pose(ang, {"body": k["body_off"]})
        # the rider, thrown clear
        k0 = {name: tuple(rider.rest.get(name, (0, 0, 0))) for name in RIDER_JOINTS}
        k0.update(at=tuple(seat), rot=(0, 0, 0))
        rk = motion.sample([(0.0, k0, "lin")] + RIDER_KEYS, t)
        ra = dict(rider.rest)
        ra.update({name: rk[name] for name in RIDER_JOINTS})
        rider.pose(ra, {})
        R = Euler([a * lib.D2R for a in rk["rot"]]).to_matrix()
        hips = Vector(rider.rest_loc["hips"])
        motion.place(u, rider.root, Vector(rk["at"]) - R @ hips, R)
        if lance is not None:
            q = motion.ease_in((t - 0.12) / 0.55) - motion.bounce(t, 0.67, 0.9, 0.05)
            q = motion.clamp(q)
            tip0 = (L0.to_3x3() @ Vector((0, 0, -1))).normalized()
            tip = tip0.lerp(Vector(LANCE_LIES["tip"]), q).normalized()
            at = L0.translation.lerp(Vector(LANCE_LIES["at"]), q)
            at.z += 0.5 * math.sin(math.pi * min(1.0, q * 1.2)) * (1 - q)      # tossed up a little first
            motion.place(u, lance, at, motion.frame(-tip, L0.to_3x3() @ Vector((0, 1, 0))))
        h2.update(hr)
        h2.update(rider)
    u.pose = pose
    return u


# ---------------------------------------------------------------- siege engines
#
# walk (approved in P1): the wheels turn, 90 degrees a cycle.
# death (P2), 10 frames: the machine comes apart. The frame's posts splay and fall from their feet,
# the throwing arm crashes onto the base, the banner pole topples with its flag, two wheels come
# off, the cart drops on one corner, and planks and shot scatter. Each part falls with gravity
# (slow, then fast), lands around frame 6 and settles; the pieces stay in the last frame.

SIEGE_IMPACT = 6                   # the frame where the frame hits the ground (for the game's dust)


def _adopt(child, parent):
    """Make `child` follow `parent` without moving it."""
    if child is None or parent is None:
        return
    bpy.context.view_layer.update()
    mw = child.matrix_world.copy()
    child.parent = parent
    child.matrix_world = mw


def _drop(t, t0, t1, rebound=0.06):
    """0 -> 1 between t0 and t1 like something falling, then one small rebound."""
    return motion.clamp(motion.ease_in((t - t0) / (t1 - t0)) - motion.bounce(t, t1, min(1.0, t1 + 0.22), rebound))


def _debris(u, kind, mat_, n=5):
    """Loose planks, hidden until the machine breaks up: (object, where it lands, spin)."""
    out = []
    for k in range(n):
        a = 2.4 * k + 0.6
        ob = box(f"{kind}_debris{k}", (0.09, 0.42 + 0.1 * (k % 3), 0.045), mat_, u.root, bevel=0.01)
        ob.scale = (0.001,) * 3
        land = Vector((1.25 * math.cos(a) + 0.15, 1.15 * math.sin(a) - 0.1, 0.03))
        out.append((ob, land, (40 * k, 25 * k + 10, 70 * k)))
    return out


def extend_siege(u, kind):
    base, arm = _obj(f"{kind}_base"), u.rigs["arm"]
    # the four wheel empties (spoked_wheel): <kind>_w-1a, _w1a, _w-1b, _w1b (not the catapult's winch)
    wheels = [o for o in (_obj(f"{kind}_w{s}{e}") for s in (-1, 1) for e in "ab") if o is not None]
    rest = {o.name: (o.location.copy(), o.rotation_euler.copy()) for o in wheels + [base]}
    inner = u.pose
    spin_axis_rot = Euler((0, 90 * lib.D2R, 0)).to_matrix()
    east = kind == "siege_e"
    O = lambda name: _obj(f"{kind}_{name}")          # noqa: E731
    # pieces that belong together fall together (nothing moves: the built pose is kept)
    pole = O("bpole")
    _adopt(O("bfinial"), pole)
    _adopt(O("flag"), pole)
    if east:
        for s in (-1, 1):
            for yy, e in ((1, "a"), (-1, "b")):
                for kk in (0, 1):
                    _adopt(O(f"band{s}{kk}{yy}"), O(f"post{s}{e}"))
                _adopt(O(f"lash{s}{yy}"), O(f"post{s}{e}"))
    else:
        for name in ("bar", "pad", "upband-1", "upband1"):
            _adopt(O(name), O("up-1"))
    arm_rest = arm.location.copy()
    wreck = motion.Wreck([])
    planks = _debris(u, kind, lib.MATS["wood5"]["mat"] if "wood5" in lib.MATS else None)
    loose_shot = [o for o in (O("stone"), O("sling")) if o is not None] if east else []

    def reset():
        for o in wheels + [base]:
            loc, rot = rest[o.name]
            o.location, o.rotation_euler = loc.copy(), rot.copy()
        wreck.reset()
        arm.location = arm_rest.copy()
        for ob, _, _ in planks:
            ob.scale = (0.001,) * 3
        for ob in loose_shot:
            ob.scale = (1, 1, 1)

    def spin(o, deg):
        o.rotation_euler = (spin_axis_rot @ Euler((0, 0, deg * lib.D2R)).to_matrix()).to_euler("XYZ")

    def scatter(t, t0, t1):
        """The planks fly out from the middle of the machine and land around it."""
        q = motion.clamp((t - t0) / (t1 - t0))
        if q <= 0:
            return
        src = Vector((0.1, 0.0, 1.3 if east else 0.9))
        for ob, land, sp in planks:
            p = src.lerp(land, q)
            p.z += 0.9 * math.sin(math.pi * q) * (1 - 0.4 * q)
            ob.location = p
            ob.rotation_euler = [a * lib.D2R * q for a in sp[:2]] + [sp[2] * lib.D2R]
            if q >= 1:
                ob.rotation_euler = (0, 0, sp[2] * lib.D2R)
            ob.scale = (1, 1, 1)

    def jolt(t):
        """The hit: the whole machine rocks once before it starts to come apart."""
        return math.sin(math.pi * motion.clamp(t / 0.3)) * (1 - motion.clamp(t / 0.3))

    def collapse_e(t):
        k = _drop(t, 0.02, 0.64)                       # the frame
        ka = _drop(t, 0.08, 0.68, 0.04)                # the throwing arm, a moment later
        # the two posts on the right splay outward and end flat beside the cart
        wreck.move(O("post1a"), k, shift=(0.20, 0.10, -0.47), rot=(-22, 88, 0))
        wreck.move(O("post1b"), k, shift=(0.25, -0.10, -0.47), rot=(24, 84, 0))
        # the two on the left fall forward and backward across the cart
        wreck.move(O("post-1a"), k, shift=(0.0, 0.25, -0.45), rot=(-84, -8, 0))
        wreck.move(O("post-1b"), k, shift=(0.0, -0.20, -0.45), rot=(86, 10, 0))
        wreck.move(O("axle"), k, shift=(0.10, -0.15, -2.0), rot=(0, 10, 24))
        # the arm drops onto the base and lies across it, its long end on the ground
        arm.location = arm_rest + Vector((0.10, 0.25, -1.98)) * ka
        arm.rotation_euler = ((55 - 44 * ka) * lib.D2R, 0, 22 * ka * lib.D2R)
        for ob in loose_shot:                             # the sling and its stone are thrown clear
            ob.scale = (0.001,) * 3 if ka > 0.5 else (1, 1, 1)
        for n_ in range(4):                               # the pull ropes go slack, fall and end under the wreck
            x = -0.21 + n_ * 0.14
            kr = _drop(t, 0.05, 0.6, 0.0)
            wreck.move(O(f"pull{n_}"), kr, rot=(-70 - 6 * n_, 0, 0), pivot=(x * 2.2, 1.45 + 0.08 * n_, 0.05))
            if kr > 0.8:
                O(f"pull{n_}").scale = (0.001,) * 3
        # the banner pole topples to the right with its flag
        wreck.move(pole, _drop(t, 0.04, 0.68), shift=(0.95, -0.35, -2.47), rot=(10, 86, 0))
        # the basket tips over and the shot rolls out
        kb = _drop(t, 0.1, 0.66)
        wreck.move(O("basket"), kb, shift=(0.55, -0.35, -0.62), rot=(0, 75, 0), pivot=(0.28, -1.0, 0.68))
        for n_ in range(4):
            a = n_ * 1.6
            wreck.move(O(f"bstone{n_}"), kb, shift=(0.75 + 0.3 * math.cos(a), -0.45 + 0.35 * math.sin(a), -0.82))
        # two wheels come off; the cart drops on its right front corner
        kw = _drop(t, 0.04, 0.55)
        wreck.move(O("w1a"), kw, shift=(0.55, 0.25, -0.34), rot=(0, -82, 30), pivot=(0.64, 0.8, 0.42))
        wreck.move(O("w-1b"), _drop(t, 0.12, 0.66), shift=(-0.25, -0.2, -0.12), rot=(0, 38, -12), pivot=(-0.64, -0.8, 0.0))
        kc = _drop(t, 0.04, 0.6, 0.1)
        base.location = Vector(rest[base.name][0]) + Vector((0, 0, -0.20)) * kc
        base.rotation_euler = (-5 * kc * lib.D2R, (11 * kc - 3.5 * jolt(t)) * lib.D2R, 0)
        scatter(t, 0.12, 0.74)

    def collapse_w(t):
        k = _drop(t, 0.02, 0.62)
        # the upright frame (with its crossbar) falls forward; the braces fall to either side
        wreck.move(O("up-1"), k, shift=(0, 0.05, -0.38), rot=(-88, 0, 6))
        wreck.move(O("up1"), k, shift=(0, 0.10, -0.38), rot=(-80, 0, -10))
        wreck.move(O("brace1"), _drop(t, 0.06, 0.64), shift=(0.15, 0, -0.38), rot=(10, 78, 0))
        wreck.move(O("brace-1"), _drop(t, 0.10, 0.68), shift=(-0.15, 0, -0.38), rot=(-8, -74, 0))
        # the arm breaks off its skein and lies on the ground behind, to the right
        ka = _drop(t, 0.06, 0.66, 0.04)
        arm.location = arm_rest + Vector((0.50, -0.25, -0.48)) * ka
        arm.rotation_euler = ((70 + 19 * ka) * lib.D2R, 0, 38 * ka * lib.D2R)
        wreck.move(O("winch"), _drop(t, 0.1, 0.66), shift=(-0.15, -0.55, -0.43), rot=(0, 0, 24))
        wreck.move(pole, _drop(t, 0.04, 0.68), shift=(0.75, 0.15, -1.47), rot=(22, 84, 0))
        kw = _drop(t, 0.04, 0.55)
        wreck.move(O("w1a"), kw, shift=(0.55, 0.30, -0.29), rot=(0, -82, 30), pivot=(0.6, 0.75, 0.36))
        wreck.move(O("w-1b"), _drop(t, 0.12, 0.66), shift=(-0.25, -0.2, -0.10), rot=(0, 38, -12), pivot=(-0.6, -0.75, 0.0))
        wreck.move(O("rail1"), _drop(t, 0.12, 0.66), shift=(0.22, 0.0, -0.05), rot=(0, 0, -9), pivot=(0.45, -1.1, 0.45))
        kc = _drop(t, 0.04, 0.6, 0.1)
        base.location = Vector(rest[base.name][0]) + Vector((0, 0, -0.16)) * kc
        base.rotation_euler = (-4 * kc * lib.D2R, (10 * kc - 3.5 * jolt(t)) * lib.D2R, 0)
        scatter(t, 0.12, 0.74)

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
        n = u.frames.get("death", 10)
        (collapse_e if east else collapse_w)(min(1.0, frame / (n - 1.0)))
    u.pose = pose
    return u


# ---------------------------------------------------------------- farmers (P2)
#
# Every work loop is 8 frames: two or three slow frames of wind-up, one or two fast frames of
# strike, a held frame on the hit, then the recovery. The feet stay planted and the hips carry
# the weight from the back foot to the front one (motion.plant); both hands stay on the haft
# (motion.reach). The four works differ in the path of the tool, not only in the tool:
#   chop   a sideways swing at trunk height, the body coiling to the right and unwinding
#   mine   the pick lifted high overhead and driven into the ground in front of the feet, in a squat
#   farm   the hoe reached forward, dropped, and dragged back along the ground
#   build  two quick mallet strokes at chest height, the left hand steadying the work
# The tool frame: butt at the origin, +Z toward the head, +Y toward the working edge.

def _n(x, y, z):
    d = math.sqrt(x * x + y * y + z * z)
    return (x / d, y / d, z / d)


WORKS = {
    "work_chop": dict(
        tool="axe", hit=4, two_hands=True,
        feet={"L": (-0.12, 0.24, 0.05), "R": (0.20, -0.14, 0.05)},
        edge=lambda h: (-h[1], h[0], 0.25),
        keys=[
            (0.0, dict(hips=(0.04, -0.03, -0.06), hips_rot=(0, 0, -28), torso=(-6, 0, -12), neck=(4, 0, 22),
                       hand=(0.36, 0.26, 1.08), h=_n(0.62, 0.15, 0.77), g=(0.50,), gl=(0.10,)), "smooth"),
            (0.25, dict(hips=(0.09, -0.09, -0.04), hips_rot=(0, 0, -40), torso=(8, 0, -38), neck=(-2, 0, 48),
                        hand=(0.54, 0.02, 1.36), h=_n(0.58, -0.52, 0.63), g=(0.56,)), "out"),
            (0.375, dict(hips=(0.03, 0.02, -0.08), hips_rot=(0, 0, -24), torso=(-6, 0, -8), neck=(4, 0, 20),
                         hand=(0.52, 0.36, 1.22), h=_n(0.85, 0.50, 0.15), g=(0.44,)), "in"),
            (0.5, dict(hips=(-0.05, 0.11, -0.12), hips_rot=(0, 0, -6), torso=(-16, 0, 24), neck=(8, 0, -12),
                       hand=(0.04, 0.50, 1.00), h=_n(-0.38, 0.92, -0.08), g=(0.30,)), "lin"),
            (0.625, dict(hips=(-0.04, 0.09, -0.10), torso=(-14, 0, 20), hand=(0.06, 0.48, 1.01),
                         h=_n(-0.33, 0.94, -0.06)), "out"),
            (0.75, dict(hips=(0.0, 0.02, -0.07), hips_rot=(0, 0, -18), torso=(-10, 0, 4), neck=(6, 0, 6),
                        hand=(0.16, 0.42, 1.02), h=_n(-0.10, 0.96, 0.25), g=(0.38,)), "smooth"),
        ]),
    "work_mine": dict(
        tool="pick", hit=4, two_hands=True,
        feet={"L": (-0.20, 0.14, 0.05), "R": (0.20, -0.04, 0.05)},
        edge=lambda h: (0, h[2], -h[1]),
        keys=[
            (0.0, dict(hips=(0, 0.0, -0.06), hips_rot=(0, 0, 0), torso=(-10, 0, 0), neck=(6, 0, 0),
                       hand=(0.10, 0.36, 1.05), h=_n(0, 0.75, 0.66), g=(0.50,), gl=(0.10,)), "smooth"),
            (0.25, dict(hips=(0, -0.05, 0.0), torso=(14, 0, 0), neck=(-6, 0, 0), hand=(0.10, -0.02, 1.90),
                        h=_n(0, -0.50, 0.87), g=(0.40,)), "out"),
            (0.375, dict(hips=(0, 0.03, -0.10), torso=(-14, 0, 0), neck=(10, 0, 0), hand=(0.09, 0.42, 1.60),
                         h=_n(0, 0.72, 0.69), g=(0.34,)), "in"),
            (0.5, dict(hips=(0, 0.07, -0.23), torso=(-38, 0, 0), neck=(24, 0, 0), hand=(0.07, 0.56, 0.70),
                       h=_n(0, 0.58, -0.81), g=(0.28,)), "lin"),
            (0.625, dict(hips=(0, 0.06, -0.20), torso=(-35, 0, 0), hand=(0.07, 0.55, 0.72)), "out"),
            (0.75, dict(hips=(0, 0.02, -0.16), torso=(-22, 0, 0), neck=(14, 0, 0), hand=(0.09, 0.44, 0.86),
                        h=_n(0, 0.80, -0.60), g=(0.36,)), "smooth"),
        ]),
    "work_farm": dict(
        tool="hoe", hit=3, two_hands=True,
        feet={"L": (-0.11, 0.27, 0.05), "R": (0.15, -0.15, 0.05)},
        edge=lambda h: (0, h[2], -h[1]),
        keys=[
            (0.0, dict(hips=(0.02, -0.02, -0.05), hips_rot=(0, 0, -10), torso=(-6, 0, -8), neck=(8, 0, 8),
                       hand=(0.18, 0.36, 1.12), h=_n(0, 0.97, 0.25), g=(0.46,), gl=(0.10,)), "smooth"),
            (0.125, dict(hips=(0.03, -0.06, -0.03), torso=(4, 0, -12), neck=(2, 0, 10), hand=(0.20, 0.28, 1.36),
                         h=_n(0, 0.80, 0.60)), "out"),
            (0.25, dict(hips=(0.0, 0.02, -0.06), torso=(-8, 0, -4), hand=(0.16, 0.46, 1.18),
                        h=_n(0, 0.92, 0.38)), "in"),
            (0.375, dict(hips=(-0.02, 0.11, -0.12), hips_rot=(0, 0, -4), torso=(-24, 0, 8), neck=(16, 0, -4),
                         hand=(0.10, 0.56, 0.88), h=_n(0, 0.62, -0.78)), "in"),
            (0.5, dict(hips=(0.0, 0.04, -0.11), torso=(-20, 0, 2), hand=(0.13, 0.44, 0.90),
                       h=_n(0, 0.58, -0.81)), "lin"),
            (0.625, dict(hips=(0.03, -0.07, -0.09), hips_rot=(0, 0, -12), torso=(-10, 0, -8), neck=(10, 0, 8),
                         hand=(0.17, 0.30, 0.93), h=_n(0, 0.54, -0.84)), "out"),
            (0.75, dict(hips=(0.03, -0.06, -0.05), torso=(-4, 0, -10), hand=(0.19, 0.30, 1.02),
                        h=_n(0, 0.80, -0.60)), "smooth"),
            (0.875, dict(hips=(0.03, -0.04, -0.05), torso=(-4, 0, -9), hand=(0.19, 0.32, 1.08),
                         h=_n(0, 0.97, -0.15)), "smooth"),
        ]),
    "work_build": dict(
        tool="hammer", hit=2, two_hands=False,
        feet={"L": (-0.10, 0.30, 0.05), "R": (0.14, -0.12, 0.05)},
        edge=lambda h: (0, h[2], -h[1]),
        keys=[
            (0.0, dict(hips=(0.0, 0.03, -0.07), hips_rot=(0, 0, -12), torso=(-10, 0, -14), neck=(10, 0, 10),
                       hand=(0.44, 0.14, 1.50), h=_n(0.35, -0.45, 0.82), g=(0.10,), handL=(-0.10, 0.58, 1.00)), "out"),
            (0.125, dict(hips=(0.0, 0.07, -0.09), torso=(-18, 0, -2), hand=(0.24, 0.44, 1.34),
                         h=_n(0, 0.70, 0.71)), "in"),
            (0.25, dict(hips=(-0.01, 0.11, -0.12), hips_rot=(0, 0, -6), torso=(-26, 0, 10), neck=(16, 0, -4),
                        hand=(0.14, 0.50, 1.08), h=_n(-0.08, 0.93, -0.36), handL=(-0.10, 0.58, 0.98)), "lin"),
            (0.375, dict(hips=(0.0, 0.07, -0.09), torso=(-18, 0, 2), hand=(0.20, 0.44, 1.24),
                         h=_n(0, 0.86, 0.50), handL=(-0.10, 0.58, 1.00)), "out"),
            (0.5, dict(hips=(0.0, 0.04, -0.07), hips_rot=(0, 0, -12), torso=(-12, 0, -12), neck=(10, 0, 10),
                       hand=(0.42, 0.18, 1.44), h=_n(0.35, -0.30, 0.89)), "out"),
            (0.625, dict(hips=(0.0, 0.08, -0.10), torso=(-20, 0, 0), hand=(0.23, 0.45, 1.32),
                         h=_n(0, 0.72, 0.69)), "in"),
            (0.75, dict(hips=(-0.01, 0.12, -0.13), hips_rot=(0, 0, -5), torso=(-28, 0, 12), neck=(18, 0, -4),
                        hand=(0.14, 0.50, 1.07), h=_n(-0.08, 0.92, -0.38), handL=(-0.10, 0.58, 0.975)), "lin"),
            (0.875, dict(hips=(0.0, 0.06, -0.08), torso=(-16, 0, -4), hand=(0.22, 0.40, 1.28),
                         h=_n(0.05, 0.80, 0.60), handL=(-0.10, 0.58, 1.00)), "out"),
        ]),
}
# how the unit's own tool is carried outside the work loops: as in R5, a continuation of the
# forearm (tool +Z along the hand's -Z), the hand 0.12 m (axe) or 0.30 m (hoe) from the butt
CARRY = {"axe": ((0, 0, 0.12), (0, 180, 0)), "hoe": ((0, 0, 0.30), (180, 0, 0))}


def _tools(kind, grip, P):
    """Four tools, larger than R5's so each reads at actual size (heads 0.3-0.4 m across, hafts
    5 cm thick). R5's own tool in the hand is hidden; the unit carries the new one in every
    animation. Returns (tool root, {name: group}, the unit's own tool)."""
    for ob in list(grip.children):          # R5's axe or hoe
        ob.scale = (0.001,) * 3
    haft = lib.mat("toolhaft_p2", (0.60, 0.45, 0.26), 0.6, noise=0.25, noise_scale=10)
    pale = lib.mat("mallet_p2", (0.76, 0.64, 0.44), 0.6, noise=0.3, noise_scale=8)
    iron = lib.mat("tooliron_p2", (0.30, 0.30, 0.32), 0.45, 1.0, pattern="worn_metal")
    steel = P["steel"]
    root = lib.empty(f"{kind}_tool_root", parent=grip)
    groups = {name: lib.empty(f"{kind}_tool_{name}", parent=root) for name in ("axe", "pick", "hoe", "hammer")}
    n = f"{kind}_tool"
    g = groups["axe"]
    rod(f"{n}_axe_haft", (0, 0, 0), (0, 0, 0.84), 0.026, haft, parent=g, r2=0.022)
    slab(f"{n}_axe_head", [(-0.075, 0.67), (-0.075, 0.81), (0.06, 0.80), (0.20, 0.87), (0.30, 0.91), (0.33, 0.74),
                           (0.30, 0.57), (0.20, 0.61), (0.06, 0.68)], 0.055, steel, parent=g, plane="YZ")
    g = groups["pick"]
    rod(f"{n}_pick_haft", (0, 0, 0), (0, 0, 0.88), 0.027, haft, parent=g, r2=0.024)
    box(f"{n}_pick_eye", (0.075, 0.11, 0.10), iron, g, at=(0, 0, 0.85), bevel=0.012)
    rod(f"{n}_pick_a", (0, 0.04, 0.86), (0, 0.42, 0.72), 0.044, steel, parent=g, r2=0.008)
    rod(f"{n}_pick_b", (0, -0.04, 0.86), (0, -0.38, 0.74), 0.044, steel, parent=g, r2=0.012)
    g = groups["hoe"]
    rod(f"{n}_hoe_haft", (0, 0, 0), (0, 0, 1.43), 0.023, haft, parent=g, r2=0.02)
    box(f"{n}_hoe_socket", (0.06, 0.08, 0.10), iron, g, at=(0, 0.0, 1.40), bevel=0.01)
    # folded 40 degrees toward the haft: with the head resting on the ground in the idle pose the
    # blade lies flat and shows its face to the camera (at 28 degrees it was seen almost edge-on)
    box(f"{n}_hoe_blade", (0.34, 0.40, 0.045), steel, g, loc=(0, 0.02, 1.42), rot=(-40, 0, 0), at=(0, 0.20, 0),
        bevel=0.008)
    g = groups["hammer"]
    rod(f"{n}_hammer_haft", (0, 0, 0), (0, 0, 0.46), 0.024, haft, parent=g, r2=0.022)
    box(f"{n}_hammer_head", (0.17, 0.34, 0.17), pale, g, at=(0, 0, 0.42), bevel=0.03)
    for s in (-1, 1):
        box(f"{n}_hammer_band{s}", (0.18, 0.035, 0.18), iron, g, at=(0, 0.11 * s, 0.42), bevel=0.01)
    return root, groups, ("axe" if kind == "farmer_e" else "hoe")


def extend_farmer(u, kind):
    import units2
    r = u.rigs["body"]
    grip = r.j["grip_axe"] if kind == "farmer_e" else r.j["grip_hoe"]
    tool_root, groups, own = _tools(kind, grip, units2.palette("C"))
    inner = u.pose

    def show(tool):
        for name, g in groups.items():
            g.scale = (1, 1, 1) if name == tool else (0.001,) * 3

    def pose(anim, frame):
        r.root.rotation_euler = (0, 0, 0)
        if anim not in WORKS:
            show(own)
            tool_root.location = CARRY[own][0]
            tool_root.rotation_euler = [a * lib.D2R for a in CARRY[own][1]]
            tool_root.scale = (1, 1, 1)
            inner(anim, frame)
            return
        w = WORKS[anim]
        show(w["tool"])
        n = u.frames.get(anim, 8)
        k = motion.sample(w["keys"], (frame % n) / n, loop=True)
        hips_rot = k.get("hips_rot", (0, 0, 0))
        ang = {"hips": hips_rot, "torso": k["torso"], "neck": k.get("neck", (0, 0, 0))}
        ang.update(motion.plant(r, k["hips"], hips_rot, w["feet"]))
        r.pose(ang, {"hips": k["hips"]})
        W = u.root.matrix_world
        motion.reach(r, "R", W @ Vector(k["hand"]))
        M = motion.aim_tool(u, grip, tool_root, k["h"], w["edge"](k["h"]), k["g"][0])
        if w["two_hands"]:
            motion.reach(r, "L", M @ Vector((0, 0, k["gl"][0])))
        else:
            motion.reach(r, "L", W @ Vector(k["handL"]))
        h2.update(r)
    u.pose = pose
    return u


# ---------------------------------------------------------------- infantry deaths (P3)
#
# The infantry (spearman, crossbowman, longbowman, pikeman, both farmers) fall the way the user
# approved for the mages in P2-03 (the same keys, FALL_KEYS): the knees give, the body sinks, tips
# backward and to one side, lands with a small bounce and ends lying askew. The weapon or tool is
# let go at once and falls on its own; it ends lying flat on the ground beside the body, along the
# body, on the side of the hand that held it, never through the body and never below the ground.

INFANTRY_FALL = True               # ceo 2026-10-01; False keeps the R1 death for the infantry
INF_IMPACT = 7                     # the frame of `death` where the body lands (for the game's dust)
# what each unit drops: the joint or object that carries the weapon, the hand that held it, the
# weapon's long axis and the axis that points up when it lies flat (in that object's own frame)
# weapon's long axis and the axis that points up when it lies flat (in that object's own frame), and
# how far beside the body it lands (metres from the hand, outward)
DROPS = {
    "spear_e": ("grip_spear", "R", (0, 0, -1), (0, 1, 0), 0.18),
    "pike_w": ("grip_pike", "R", (0, 0, -1), (0, 1, 0), 0.18),
    "xbow_e": ("grip_xbow", "R", (0, 1, 0), (0, 0, 1), 0.18),
    "bow_w": ("grip_bow", "L", (0, 1, 0), (1, 0, 0), 0.55),        # the bow is 2.3 m long: clear of the body
    "farmer_e": ("tool_root", "R", (0, 0, 1), (1, 0, 0), 0.18),
    "farmer_w": ("tool_root", "R", (0, 0, 1), (1, 0, 0), 0.18),
}
# hats that come off: a straw hat stays on a head lying on its back as a disc standing on edge;
# it flies off and lands flat beside the head (helmets and scarves stay on)
HATS = {"farmer_e": ("farmer_e_hat", "farmer_e_cord")}
HAT_OFF = 0.18                     # the moment the hat comes off: the end of the recoil


def _world_box(ob):
    """World-space bounding-box corners of every mesh under `ob` (visible ones only)."""
    pts = []
    stack = [ob]
    while stack:
        o = stack.pop()
        stack.extend(o.children)
        if o.type == "MESH" and min(o.matrix_world.to_scale()) > 0.01:
            pts += [o.matrix_world @ Vector(c) for c in o.bound_box]
    return pts


def extend_infantry(u, kind):
    r = u.rigs["body"]
    inner = u.pose
    joint, side, long_ax, up_ax, beside = DROPS[kind]
    cache = {}
    hat = None
    if kind in HATS:
        hat = lib.empty(f"{kind}_hatroot", parent=r.j["head"])
        for o in [o for o in bpy.data.objects if o.name.startswith(HATS[kind]) and o.type == "MESH"]:
            _adopt(o, hat)

    def drop_obj():
        if joint == "tool_root":
            return bpy.data.objects.get(f"{kind}_tool_root")
        return r.j.get(joint)

    def stand():
        """The unit's own standing pose (its idle frame 0, weapon in hand): joint angles in degrees,
        and where the weapon is (unit space)."""
        inner("idle", 0)
        bpy.context.view_layer.update()
        ang = {name: tuple(a * motion.R2D for a in r.j[name].rotation_euler) for name in FALL_JOINTS}
        ob = drop_obj()
        Wi = u.root.matrix_world.inverted()
        return ang, (Wi @ ob.matrix_world if ob is not None else None)

    def body(t, base):
        k0 = dict(base)
        k0.update(hips=(0, 0, 0), hips_rot=(0, 0, 0))
        k = motion.sample([(0.0, k0, "lin")] + FALL_KEYS, t)
        ang = {name: k[name] for name in FALL_JOINTS}
        ang["hips"] = k["hips_rot"]
        r.pose(ang, {"hips": k["hips"]})
        r.root.rotation_euler = (0, 0, 0)

    def lying(base, M0):
        """Where the weapon ends (unit space): flat on the ground along the body, beside the hand
        that held it, its grip by that hand."""
        body(1.0, base)
        bpy.context.view_layer.update()
        Wi = u.root.matrix_world.inverted()
        P = lambda name: Wi @ r.j[name].matrix_world.translation          # noqa: E731
        head, hips = P("neck"), P("hips")
        along = Vector((hips.x - head.x, hips.y - head.y, 0)).normalized()        # toward the feet
        outward = Vector((-along.y, along.x, 0))
        hand = P("wrist" + side)
        if (hand - hips).dot(outward) < 0:
            outward = -outward
        a0 = (M0.to_3x3() @ Vector(long_ax)).normalized()
        a1 = along if a0.dot(along) >= 0 else -along          # keep the weapon's own end toward the feet
        up = Vector((0, 0, 1))
        # the rotation that maps the weapon's long axis to a1 and its flat-side axis to up
        L, U = Vector(long_ax), Vector(up_ax)
        Ml = Matrix((L, U, L.cross(U))).transposed()
        Mw = Matrix((a1, up, a1.cross(up))).transposed()
        R1 = Mw @ Ml.inverted()
        grip_at = Vector((hand.x, hand.y, 0.0)) + outward * beside
        hat_at = None
        if hat is not None:
            back = -along                                  # past the head, a little to the side
            hat_at = Vector((head.x, head.y, 0.0)) + back * 0.42 - outward * 0.25
        return R1, grip_at, hat_at

    def lift(ob, loc, R):
        """Put `ob` at loc/R (unit space), raised so that no part is below the ground."""
        motion.place(u, ob, loc, R)
        bpy.context.view_layer.update()
        zs = [p.z for p in _world_box(ob)]
        if zs:
            low = min(zs) - u.root.matrix_world.translation.z
            if low < 0.02:
                motion.place(u, ob, loc + Vector((0, 0, 0.02 - low)), R)

    def pose(anim, frame):
        r.root.rotation_euler = (0, 0, 0)
        if hat is not None:
            hat.matrix_basis = Matrix.Identity(4)
        if anim != "death" or not INFANTRY_FALL:
            inner(anim, frame)
            return
        n = u.frames.get("death", 10)
        t = min(1.0, frame / (n - 1.0))
        base, M0 = stand()
        ob = drop_obj()
        if hat is not None and "hat0" not in cache:
            body(HAT_OFF, base)               # where the hat is when it comes off (the head thrown back)
            bpy.context.view_layer.update()
            cache["hat0"] = u.root.matrix_world.inverted() @ hat.matrix_world
        if "end" not in cache:
            cache["end"] = lying(base, M0)
        R1, grip_at, hat_at = cache["end"]
        body(t, base)
        if hat is not None:
            H0 = cache["hat0"]
            qh = motion.clamp(motion.ease_in((t - HAT_OFF) / 0.52) - motion.bounce(t, HAT_OFF + 0.52, 0.95, 0.05))
            Rh = H0.to_3x3().to_quaternion().slerp(Matrix.Identity(3).to_quaternion(), qh).to_matrix()
            p = H0.translation.lerp(hat_at, qh)
            p.z += 0.3 * math.sin(math.pi * qh) * (1 - qh)
            if t <= HAT_OFF:
                # still on the head: follow it
                bpy.context.view_layer.update()
                hat.matrix_basis = Matrix.Identity(4)
            else:
                lift(hat, p, Rh)
        if ob is not None:
            # the grip point in the weapon's own frame: where the hand was in the standing pose
            hand0 = cache.setdefault("hand0", None)
            if hand0 is None:
                inner("idle", 0)
                bpy.context.view_layer.update()
                Wi = u.root.matrix_world.inverted()
                hand0 = (Wi @ ob.matrix_world).inverted() @ (Wi @ r.j["wrist" + side].matrix_world.translation)
                cache["hand0"] = hand0
                body(t, base)
            q = motion.clamp(motion.ease_in((t - 0.02) / 0.6) - motion.bounce(t, 0.62, 0.85, 0.06))
            R0 = M0.to_3x3()
            R = R0.to_quaternion().slerp(R1.to_quaternion(), q).to_matrix()
            g0 = M0 @ hand0
            g = g0.lerp(grip_at, q)
            g.z += 0.25 * math.sin(math.pi * min(1.0, q)) * (1 - q)      # it is tossed up a little first
            lift(ob, g - R @ hand0, R)          # never below the ground
        h2.update(r)
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
        u = extend_farmer(u, kind)
    if kind in DROPS:
        return extend_infantry(u, kind)
    return u
