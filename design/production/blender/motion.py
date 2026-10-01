"""Motion helpers for the refined (P2) animations.

- sample(): keyframes with per-segment easing (slow wind-up, fast strike, settle).
- plant(): leg angles that keep both feet where they are while the hips move and turn
  (two-bone IK), so a swing shifts the weight instead of bending only at the waist.
- reach(): an arm that puts its hand on a point (two-bone IK): both hands stay on a tool.
- aim_tool(): a tool held in the right hand, pointed in a given direction in the unit's space.
- place(): an object (dropped staff, thrown rider) put at a pose in the unit's space,
  whatever it is parented to.
- Wreck: rigid parts of a machine that fall apart and are put back for the next animation.

Conventions (humanoid.py): the unit faces +Y, its right hand is on +X, angles are degrees in
Euler XYZ; +X on a hanging limb swings it forward, knees bend with -X, +X on the torso leans back.
"""
import math

import bpy
from mathutils import Euler, Matrix, Vector

D2R = math.pi / 180.0
R2D = 180.0 / math.pi


def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else hi if v > hi else v


def smooth(k):
    k = clamp(k)
    return k * k * (3 - 2 * k)


def ease_in(k):          # accelerating, like something falling
    k = clamp(k)
    return k * k


def ease_out(k):         # decelerating, like something thrown upward
    k = clamp(k)
    return 1 - (1 - k) * (1 - k)


EASE = {"lin": clamp, "smooth": smooth, "in": ease_in, "out": ease_out}


def lerp(a, b, k):
    return tuple(x + (y - x) * k for x, y in zip(a, b))


def sample(keys, t, loop=False):
    """keys: [(time, {channel: tuple}, ease)] in time order; `ease` is how the segment that ENDS at
    that key is travelled. A channel missing from a key is not a key for that channel. With loop,
    time wraps at 1.0 and the first key is also the end of the cycle."""
    chans = {}
    for tm, vals, ez in keys:
        for name, v in vals.items():
            chans.setdefault(name, []).append((tm, tuple(v), ez))
    out = {}
    for name, ks in chans.items():
        if loop:
            ks = ks + [(ks[0][0] + 1.0, ks[0][1], ks[0][2])]
            tt = t % 1.0
            if tt < ks[0][0]:
                tt += 1.0
        else:
            tt = clamp(t, ks[0][0], ks[-1][0])
        val = ks[-1][1]
        for (t0, v0, _), (t1, v1, ez) in zip(ks, ks[1:]):
            if t0 <= tt <= t1:
                k = 0.0 if t1 <= t0 else (tt - t0) / (t1 - t0)
                val = lerp(v0, v1, EASE[ez](k))
                break
        out[name] = val
    return out


# ---------------------------------------------------------------- legs

def plant(rig, hips_off=(0, 0, 0), hips_rot=(0, 0, 0), feet=None, toe=None):
    """Angles for both legs so the ankles stay at `feet` ({"R": (x, y, z), "L": ...} in the rig's
    root space; default: the rest stance) while the hips sit at rest + hips_off, turned by hips_rot.
    The feet keep pointing forward (the hip joints take back the pelvis turn) and stay flat;
    toe = {"R": degrees} lifts a heel (positive) for a push-off."""
    rl = rig.rest_loc
    hips = Vector(rl["hips"]) + Vector(hips_off)
    Rh = Euler([a * D2R for a in hips_rot]).to_matrix()
    out = {}
    for side in ("R", "L"):
        o = Vector(rl["hip" + side])
        L1 = abs(rl["knee" + side][2])
        L2 = abs(rl["ankle" + side][2])
        ankle_z = hips.z - (hips_off[2]) + o.z - L1 - L2        # ankle height in the rest stance
        A = Vector(feet[side]) if feet and side in feet else Vector((o.x, 0.0, ankle_z))
        J = hips + Rh @ o
        psi = -hips_rot[2] * D2R
        F = Rh @ Euler((0, 0, psi)).to_matrix()
        v = F.transposed() @ (A - J)
        gamma = math.atan2(-v.x, -v.z)
        dy, dz = v.y, math.hypot(v.x, v.z)
        D = clamp(math.hypot(dy, dz), abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3)
        alpha = math.atan2(dy, dz)
        beta = math.acos(clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1))
        theta = alpha + beta
        knee = math.acos(clamp((L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2), -1, 1))
        phi = -(math.pi - knee)
        lift = (toe or {}).get(side, 0.0)
        out["hip" + side] = (theta * R2D, gamma * R2D, psi * R2D)
        out["knee" + side] = (phi * R2D, 0, 0)
        out["ankle" + side] = (-(theta + phi) * R2D - hips_rot[0] + lift, 0, 0)
    return out


# ---------------------------------------------------------------- arms

def reach(rig, side, target, pole=None, hand=0.05):
    """Turn the shoulder and bend the elbow so the grip point of that hand (hand metres past the
    wrist) lands on `target` (world space). pole: world direction the elbow leans toward.
    Call after the body is posed; the joints are set directly."""
    bpy.context.view_layer.update()
    sh, el = rig.j["shoulder" + side], rig.j["elbow" + side]
    Mt = sh.parent.matrix_world
    Rt = Mt.to_3x3().normalized()
    S = Mt @ Vector(rig.rest_loc["shoulder" + side])
    L1 = abs(rig.rest_loc["elbow" + side][2])
    L2 = abs(rig.rest_loc["wrist" + side][2]) + hand
    d = Vector(target) - S
    D = clamp(d.length, abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3)
    dn = d.normalized()
    if pole is None:
        s = 1 if side == "R" else -1
        pole = Rt @ Vector((0.8 * s, -0.4, -0.45))
    p = Vector(pole) - Vector(pole).dot(dn) * dn
    p = p.normalized() if p.length > 1e-5 else dn.orthogonal().normalized()
    A = math.acos(clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1))
    a = (math.cos(A) * dn + math.sin(A) * p).normalized()          # upper arm
    E = S + a * L1
    f = (S + dn * D - E).normalized()                               # forearm
    phi = math.acos(clamp(a.dot(f), -1, 1))                         # elbow flexion, 0 = straight
    y = f - f.dot(a) * a
    y = y.normalized() if y.length > 1e-5 else -p
    z = -a
    x = y.cross(z)
    Rw = Matrix((x, y, z)).transposed()
    Rl = Rt.transposed() @ Rw
    sh.rotation_euler = Rl.to_euler("XYZ")
    el.rotation_euler = (phi, 0, 0)


# ---------------------------------------------------------------- objects in the unit's space

def frame(z_dir, y_hint):
    """Rotation whose +Z is z_dir and whose +Y is as close to y_hint as it can be."""
    z = Vector(z_dir).normalized()
    y = Vector(y_hint) - Vector(y_hint).dot(z) * z
    y = y.normalized() if y.length > 1e-5 else z.orthogonal().normalized()
    x = y.cross(z)
    return Matrix((x, y, z)).transposed()


def place(u, ob, loc, rot):
    """Put `ob` at loc (unit space) with rotation matrix `rot` (unit space), whatever its parent."""
    bpy.context.view_layer.update()
    ob.matrix_world = u.root.matrix_world @ (Matrix.Translation(Vector(loc)) @ rot.to_4x4())


def unit_point(u, world):
    """A world point in the unit's own space."""
    return u.root.matrix_world.inverted() @ Vector(world)


def aim_tool(u, grip, tool_root, h, e, g):
    """The tool's frame has its butt at the origin, +Z toward the head and +Y toward the working
    edge. Point it along h with the edge toward e (unit space) so the point g metres up the haft
    sits in the right hand. Returns the tool's world matrix (for the other hand)."""
    bpy.context.view_layer.update()
    Ru = u.root.matrix_world.to_3x3()
    R = frame(Ru @ Vector(h), Ru @ Vector(e))
    hand = grip.matrix_world.translation
    M = Matrix.Translation(hand - R.col[2] * g) @ R.to_4x4()
    tool_root.matrix_world = M
    return M


# ---------------------------------------------------------------- machines that fall apart

class Wreck:
    """Rigid parts moved away from their built pose and put back by reset()."""

    def __init__(self, parts):
        self.rest = {ob: ob.matrix_basis.copy() for ob in parts if ob is not None}

    def add(self, ob):
        self.rest.setdefault(ob, ob.matrix_basis.copy())

    def reset(self):
        for ob, m in self.rest.items():
            ob.matrix_basis = m.copy()

    def move(self, ob, k, shift=(0, 0, 0), rot=(0, 0, 0), pivot=None):
        """k = 0: as built; k = 1: turned by rot (degrees, about the parent's axes, around `pivot`
        in the parent's space, default the part's own origin) and moved by shift."""
        if ob is None:
            return
        self.add(ob)
        m0 = self.rest[ob]
        pv = Vector(pivot) if pivot is not None else m0.translation.copy()
        R = Euler([a * D2R * k for a in rot]).to_matrix().to_4x4()
        T = Matrix.Translation(Vector(shift) * k)
        ob.matrix_basis = T @ Matrix.Translation(pv) @ R @ Matrix.Translation(-pv) @ m0


def bounce(t, t_hit, t_end, amount=0.12):
    """0 before the landing, then one small rebound that dies out by t_end (for a 'thud')."""
    if t <= t_hit or t >= t_end:
        return 0.0
    k = (t - t_hit) / (t_end - t_hit)
    return amount * math.sin(math.pi * k) * (1 - k)
