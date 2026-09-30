"""Rigid-part humanoid and horse rigs shared by every unit.

Built facing +Y, right hand on +X, feet on z=0. Angles in degrees.
Positive X rotation swings a hanging limb forward; knees bend with negative X.
Proportions are slightly heroic (large head, thick limbs) so the silhouette
still reads at ~30 pt on a phone.
"""
import math

from mathutils import Euler

import lib
from lib import D2R, box, cyl, empty, lathe, sphere

H_HIP = 0.95


class Rig:
    def __init__(self, name):
        self.name = name
        self.root = empty(name + "_root")
        self.j = {}           # joint name -> empty/object
        self.rest = {}        # joint name -> rest rotation (deg)
        self.rest_loc = {}

    def joint(self, name, parent, loc, rot=(0, 0, 0)):
        ob = empty(f"{self.name}_{name}", parent=parent, loc=loc, rot=rot)
        self.j[name] = ob
        self.rest[name] = tuple(rot)
        self.rest_loc[name] = tuple(loc)
        return ob

    def pose(self, angles=None, offsets=None):
        angles = angles or {}
        offsets = offsets or {}
        for name, ob in self.j.items():
            r = angles.get(name, self.rest[name])
            ob.rotation_euler = Euler([a * D2R for a in r])
            base = self.rest_loc[name]
            off = offsets.get(name, (0, 0, 0))
            ob.location = (base[0] + off[0], base[1] + off[1], base[2] + off[2])

    def face(self, facing):
        self.root.rotation_euler = Euler((0, 0, lib.heading_for(facing)))


def humanoid(name, skin, cloth, pants, boots, head_r=0.14, bulk=1.0, parent=None, sit=False):
    """Body only; callers add armour, hats and weapons to the joints."""
    rig = Rig(name)
    if parent is not None:
        rig.root.parent = parent
    j = rig.joint
    hips = j("hips", rig.root, (0, 0, H_HIP))
    box(f"{name}_pelvis", (0.32 * bulk, 0.2 * bulk, 0.18), pants, hips, at=(0, 0, 0.02), bevel=0.04)
    torso = j("torso", hips, (0, 0, 0.08))
    box(f"{name}_chest", (0.36 * bulk, 0.22 * bulk, 0.46), cloth, torso, at=(0, 0, 0.23),
        taper=(1.12, 1.05), bevel=0.05)
    neck = j("neck", torso, (0, 0, 0.47))
    cyl(f"{name}_neckm", 0.055, 0.09, skin, neck)
    head = j("head", neck, (0, 0, 0.08))
    sphere(f"{name}_head", head_r, skin, head, at=(0, 0.01, head_r * 0.95), scale=(1, 1.02, 1.05))
    for s in (-1, 1):
        sphere(f"{name}_eye{s}", 0.018, lib.mat("eye", (0.05, 0.04, 0.04), 0.4), head,
               at=(0.05 * s, head_r * 0.92, head_r * 1.02), outline=False)
    for side, s in (("R", 1), ("L", -1)):
        sh = j(f"shoulder{side}", torso, (0.215 * s * bulk, 0, 0.41))
        sphere(f"{name}_sh{side}", 0.075 * bulk, cloth, sh)
        cyl(f"{name}_uarm{side}", 0.058 * bulk, 0.3, cloth, sh, at=(0, 0, -0.3))
        el = j(f"elbow{side}", sh, (0, 0, -0.3))
        cyl(f"{name}_farm{side}", 0.05 * bulk, 0.26, cloth, el, at=(0, 0, -0.26), r2=0.046 * bulk)
        wr = j(f"wrist{side}", el, (0, 0, -0.26))
        sphere(f"{name}_hand{side}", 0.052, skin, wr, at=(0, 0, -0.045))
        th = j(f"hip{side}", hips, (0.1 * s * bulk, 0, -0.03))
        cyl(f"{name}_thigh{side}", 0.078 * bulk, 0.45, pants, th, at=(0, 0, -0.45), r2=0.07 * bulk)
        kn = j(f"knee{side}", th, (0, 0, -0.45))
        cyl(f"{name}_shin{side}", 0.066 * bulk, 0.42, boots, kn, at=(0, 0, -0.42), r2=0.055)
        ft = j(f"ankle{side}", kn, (0, 0, -0.42))
        box(f"{name}_foot{side}", (0.1, 0.22, 0.08), boots, ft, at=(0, 0.05, -0.035), bevel=0.02)
    if sit:
        rig.rest.update({
            "hipR": (80, -18, 0), "hipL": (80, 18, 0),
            "kneeR": (-78, 0, 0), "kneeL": (-78, 0, 0),
        })
    rig.pose()
    return rig


def grip(rig, side, name, loc=(0, 0, -0.05), rot=(0, 0, 0)):
    """An attachment point in a hand; weapons are parented to it."""
    return rig.joint(f"grip_{name}", rig.j[f"wrist{side}"], loc, rot)


# ------------------------------------------------------------------ poses

def blend(a, b, t):
    out = dict(a)
    for k, v in b.items():
        base = a.get(k, (0, 0, 0))
        out[k] = tuple(x + (y - x) * t for x, y in zip(base, v))
    return out


def ease(t):
    return t * t * (3 - 2 * t)


def walk(t, arms=True, stride=28):
    """Walk cycle, t in [0,1)."""
    a = math.sin(2 * math.pi * t)
    b = math.cos(2 * math.pi * t)
    p = {
        "hipR": (stride * a, 0, 0), "hipL": (-stride * a, 0, 0),
        "kneeR": (-max(0, 40 * -b) - 6, 0, 0), "kneeL": (-max(0, 40 * b) - 6, 0, 0),
        "ankleR": (8 * a, 0, 0), "ankleL": (-8 * a, 0, 0),
        "torso": (-4, 0, 6 * a),
    }
    if arms:
        p.update({"shoulderR": (-22 * a, 0, -6), "shoulderL": (22 * a, 0, 6),
                  "elbowR": (20, 0, 0), "elbowL": (20, 0, 0)})
    bob = (0, 0, -0.025 * abs(b))
    return p, {"hips": bob}


def idle(t):
    s = math.sin(2 * math.pi * t)
    return {
        "torso": (-1 + 1.5 * s, 0, 0), "neck": (-1 * s, 0, 0),
        "shoulderR": (4, 0, -8), "shoulderL": (4, 0, 8),
        "elbowR": (12 + 3 * s, 0, 0), "elbowL": (12 + 3 * s, 0, 0),
        "hipR": (2, 0, -4), "hipL": (-2, 0, 4),
    }, {"hips": (0, 0, 0.008 * s)}


def fall(t):
    """Death: knees give, body falls backwards; t 0..1."""
    e = ease(min(1, t))
    k = ease(min(1, t * 1.6))
    return {
        "hipR": (40 * k - 20 * e, 0, -8), "hipL": (46 * k - 30 * e, 0, 8),
        "kneeR": (-70 * k + 60 * e, 0, 0), "kneeL": (-80 * k + 70 * e, 0, 0),
        "torso": (20 * e, 0, 10 * e), "neck": (15 * e, 0, 0),
        "shoulderR": (30 - 60 * e, 0, -40 * e), "shoulderL": (20 - 70 * e, 0, 50 * e),
        "elbowR": (30 * (1 - e), 0, 0), "elbowL": (20, 0, 0),
    }, {"hips": (0, 0, -0.22 * k * (1 - e))}


def fall_root_tilt(t):
    """Extra rotation for the whole body lying on its back at the end of a fall."""
    e = ease(min(1, max(0, (t - 0.25) / 0.75)))
    return (82 * e, 0, 0)


# ------------------------------------------------------------------ horse

def horse(name, coat, mane, hoof, parent=None, barding=None, caparison=None):
    """Horse built facing +Y. Returns a Rig; rider sits on joint 'saddle'."""
    rig = Rig(name)
    if parent is not None:
        rig.root.parent = parent
    j = rig.joint
    body = j("body", rig.root, (0, 0, 1.18))
    sphere(f"{name}_barrel", 0.36, coat, body, at=(0, 0, 0), scale=(0.95, 2.05, 1.0), segs=20, rings=12)
    sphere(f"{name}_chest", 0.3, coat, body, at=(0, 0.55, 0.05), scale=(0.95, 0.9, 1.0))
    sphere(f"{name}_rump", 0.31, coat, body, at=(0, -0.55, 0.05), scale=(1.0, 0.95, 1.0))
    neck = j("neck", body, (0, 0.62, 0.18), (-38, 0, 0))
    cyl(f"{name}_neckm", 0.17, 0.62, coat, neck, r2=0.12, scale=(0.8, 1, 1))
    lathe(f"{name}_mane", [(0.03, 0.05), (0.05, 0.3), (0.03, 0.62)], mane, neck,
          at=(0, -0.12, 0), scale=(0.6, 1, 1), segs=8)
    head = j("head", neck, (0, 0, 0.6), (-112, 0, 0))
    box(f"{name}_headm", (0.2, 0.2, 0.52), coat, head, at=(0, 0, 0.22), taper=(0.75, 0.8), bevel=0.06)
    for s in (-1, 1):
        cyl(f"{name}_ear{s}", 0.035, 0.12, coat, head, at=(0.06 * s, -0.08, -0.02), r2=0.005,
            rot=(180, 0, 0))
        sphere(f"{name}_eye{s}", 0.022, lib.mat("eye", (0.05, 0.04, 0.04), 0.4), head,
               at=(0.1 * s, 0.02, 0.1), outline=False)
    tail = j("tail", body, (0, -0.72, 0.18), (150, 0, 0))
    cyl(f"{name}_tailm", 0.07, 0.55, mane, tail, r2=0.03)
    for leg, (x, y) in {"FR": (0.16, 0.5), "FL": (-0.16, 0.5), "BR": (0.17, -0.52), "BL": (-0.17, -0.52)}.items():
        up = j(f"leg{leg}", body, (x, y, -0.1))
        cyl(f"{name}_u{leg}", 0.085, 0.5, coat, up, at=(0, 0, -0.5), r2=0.06)
        lo = j(f"low{leg}", up, (0, 0, -0.5))
        cyl(f"{name}_l{leg}", 0.05, 0.5, coat, lo, at=(0, 0, -0.5), r2=0.045)
        cyl(f"{name}_h{leg}", 0.065, 0.1, hoof, lo, at=(0, 0, -0.6))
    saddle = j("saddle", body, (0, -0.05, 0.3))
    if barding is not None:
        barding(rig, body, neck, head)
    if caparison is not None:
        caparison(rig, body, neck, head)
    rig.pose()
    return rig


def gallop(t, amp=1.0):
    a = math.sin(2 * math.pi * t)
    b = math.sin(2 * math.pi * t + 1.2)
    p = {
        "legFR": (35 * a * amp, 0, 0), "legFL": (35 * b * amp, 0, 0),
        "legBR": (-30 * b * amp, 0, 0), "legBL": (-30 * a * amp, 0, 0),
        "lowFR": (-50 * max(0, -a) * amp, 0, 0), "lowFL": (-50 * max(0, -b) * amp, 0, 0),
        "lowBR": (40 * max(0, b) * amp, 0, 0), "lowBL": (40 * max(0, a) * amp, 0, 0),
        "body": (4 * a * amp, 0, 0), "neck": (-38 - 8 * a * amp, 0, 0),
        "tail": (140 + 10 * b, 0, 0),
    }
    return p, {"body": (0, 0, 0.06 * abs(a) * amp)}
