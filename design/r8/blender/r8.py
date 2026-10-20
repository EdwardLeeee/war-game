"""R8 (D-093) on top of R7 version 2 (r7_prod.apply with version 8): what the full set adds.

- Bows (bow_e, bow_w): the string is pulled to the right hand while the attack draws, with an arrow on it, and
  straight and empty after the loose (the flying arrow is the game's own); the approved draw and loose unchanged.
- Hands: MPFB's open fingers closed into a grip (human_r7.curl_fingers), the hands hold spears, bows and tools.
- Rim light: stronger, to lift the soldiers off the realistic ground (the brief's readability rule).
- Spearman (spear_e): both hands on the spear (the user, 2026-10-21), the rear (right) hand near the butt, the front
  (left) hand on the shaft; the thrust is driven by the rear hand and the shaft slides through the front hand, the
  way a two-handed spear is thrust. Set before anims.extend (before_extend), so the death starts from this stance.
- Bows: a full draw to the face (the right hand to the cheek, the elbow up behind it), the hand flying back past the
  ear on the loose; limbs, string and arrow thicker, to read at actual size. The draw and the loose keep their frames
  (spec.HIT: the loose on frame 6 of 10).
"""
import math
import os

import bpy
from mathutils import Matrix, Vector

import lib

BOWS = ("bow_e", "bow_w")
BOW_THICK = 1.5                    # the limbs' thickness, times the R5 bows'
DRAW = 0.74                        # the longest draw, bow grip to the fingers (metres)
SPEAR_SHIFT = 0.5                  # the spear slides this far forward in the right hand: the rear hand 0.5 m from the butt
# the right hand's grip point, where the spear points and where the front hand wants to be (unit space: +x right,
# +y forward, z up; the hips at rest 0.95 m up). The front hand goes to the point on the shaft nearest that.
SPEAR_READY = dict(hand=(0.16, 0.02, 1.03), h=(-0.10, 0.95, 0.30), front=(0.06, 0.48, 1.17))
SPEAR_BACK = dict(hand=(0.18, -0.16, 1.04), h=(-0.08, 0.96, 0.27), front=(0.06, 0.44, 1.16))
SPEAR_THRUST = dict(hand=(0.08, 0.32, 1.12), h=(-0.02, 1.0, 0.10), front=(0.0, 0.56, 1.14))


def _unit_rod(name, r, m, parent):
    """A cylinder of radius r along +z from 0 to 1, to be placed with set_rod."""
    return lib.cyl(name, r, 1.0, m, parent, loc=(0, 0, 0), segs=6, outline=False)


def set_rod(ob, a, b):
    a, b = Vector(a), Vector(b)
    d = b - a
    q = Vector((0, 0, 1)).rotation_difference(d.normalized() if d.length > 1e-6 else Vector((0, 0, 1)))
    ob.matrix_basis = Matrix.Translation(a) @ q.to_matrix().to_4x4() @ Matrix.Diagonal((1, 1, max(d.length, 1e-4), 1))


def bow_string(u, kind):
    """Replace the bow's straight string with one that follows the drawing hand (u.pose wrapped)."""
    string = bpy.data.objects.get(f"{kind}_string")
    if string is None:
        return
    grip = string.parent
    bpy.context.view_layer.update()
    to_grip = grip.matrix_world.inverted() @ string.matrix_world      # the rod's mesh is in its own frame
    co = [to_grip @ Vector(v.co) for v in string.data.vertices]
    tip_a = min(co, key=lambda v: v.y)
    tip_b = max(co, key=lambda v: v.y)
    tip_a, tip_b = Vector((0.0, tip_a.y, tip_a.z)), Vector((0.0, tip_b.y, tip_b.z))
    rest = (tip_a + tip_b) / 2
    m = string.active_material
    string.hide_render = True
    sa = _unit_rod(f"{kind}_r8stra", 0.009, m, grip)      # thicker than a real string: it must read at actual size
    sb = _unit_rod(f"{kind}_r8strb", 0.009, m, grip)
    wood = lib.MATS.get("wood5", {}).get("mat") or m
    feather = lib.MATS.get("feather5", {}).get("mat") or m
    shaft = _unit_rod(f"{kind}_r8arrow", 0.008, wood, grip)
    head = _unit_rod(f"{kind}_r8arrowhead", 0.011, lib.MATS.get("steel2", {}).get("mat") or m, grip)
    fletch = _unit_rod(f"{kind}_r8fletch", 0.016, feather, grip)
    for ob in grip.children:
        if ob.name.startswith(f"{kind}_limb"):            # rods: cylinders along their own z
            ob.scale = (BOW_THICK, BOW_THICK, 1.0)
    rig = u.rigs["body"]
    orig = u.pose
    import humanoid2 as h2
    import motion
    from humanoid import ease

    def draw_arm(t):
        """The right hand on the attack: from where the approved pose has it to the face (the full draw), back past
        the ear on the loose, and back to the approved pose to nock the next arrow."""
        bpy.context.view_layer.update()
        p0 = rig.j["wristR"].matrix_world @ Vector((0.0, 0.0, -0.05))
        g = grip.matrix_world.translation.copy()
        skull = rig.j["head"].matrix_world
        anchor = skull @ Vector((0.07, 0.11, 0.05))          # the right cheek, by the corner of the mouth
        back = (anchor - g).normalized()                     # from the bow toward the archer: the arrow's line
        full = g + back * min((anchor - g).length + 0.03, DRAW)
        up = Vector((0.0, 0.0, 1.0))
        out = back.cross(up).normalized()
        if out.dot(skull.to_3x3() @ Vector((1.0, 0.0, 0.0))) < 0:
            out = -out                                       # toward the archer's right
        loose = full + back * 0.16 + out * 0.10 + up * 0.03  # the fingers open and the hand flies back past the ear
        if t < 0.08:
            return
        if t < 0.38:
            p = p0.lerp(full, ease((t - 0.08) / 0.30))
        elif t < 0.55:
            p = full
        elif t < 0.6:
            p = full.lerp(loose, ease((t - 0.55) / 0.05))
        elif t < 0.72:
            p = loose
        else:
            p = loose.lerp(p0, ease((t - 0.72) / 0.28))
        motion.reach(rig, "R", p, pole=back + up * 0.3)      # the elbow up behind the hand, in line with the arrow
        h2.update(rig)

    def pose(anim, frame):
        orig(anim, frame)
        n = getattr(u, "frames", {}).get(anim, 10)
        t = frame / max(1, n)
        if anim == "attack":
            draw_arm(t)
        bpy.context.view_layer.update()
        gi = grip.matrix_world.inverted()
        hand = gi @ (rig.j["wristR"].matrix_world @ Vector((0.0, 0.015, -0.075)))
        drawing = anim == "attack" and 0.08 <= t < 0.6 and (hand - rest).length > 0.12
        if os.environ.get("R8_DEBUG"):
            print("R8 bow", anim, frame, round(t, 2), [round(c, 3) for c in hand], [round(c, 3) for c in rest], drawing)
        nock = hand if drawing else rest            # the string goes to the fingers, wherever the pose holds them
        set_rod(sa, tip_a, nock)
        set_rod(sb, nock, tip_b)
        on = anim == "attack" and (t < 0.6 or t > 0.85)          # nocked; gone after the loose; a new one picked up
        for ob in (shaft, head, fletch):
            ob.hide_render = not on
        if on:
            start = nock if drawing else rest
            # the arrow from the string through the bow's grip (its middle, the grip's origin) and on
            fwd = (Vector((0.0, 0.0, 0.0)) - start).normalized() if drawing else Vector((0.0, 0.0, -1.0))
            set_rod(shaft, start, start + fwd * 0.78)
            set_rod(head, start + fwd * 0.74, start + fwd * 0.82)
            set_rod(fletch, start + fwd * 0.02, start + fwd * 0.13)
    u.pose = pose


def _mix(a, b, k):
    return {n: tuple(x + (y - x) * k for x, y in zip(a[n], b[n])) for n in a}


def _spear_keys(t):
    """The hands and the spear on the attack, on the approved thrust's timing (units.spear_attack)."""
    from humanoid import ease
    if t < 0.3:
        return _mix(SPEAR_READY, SPEAR_BACK, ease(t / 0.3))
    if t < 0.5:
        return _mix(SPEAR_BACK, SPEAR_THRUST, ease((t - 0.3) / 0.2))
    return _mix(SPEAR_THRUST, SPEAR_READY, ease((t - 0.5) / 0.5))


def spear_two_hands(u, kind):
    """The spearman's own pose with both hands on the spear (u.pose replaced; anims.extend wraps it afterward)."""
    import humanoid2 as h2
    import motion
    import units as U1
    import units2
    from humanoid import idle, walk
    r = u.rigs["body"]
    grip = r.j["grip_spear"]
    for ob in grip.children:
        ob.location.z -= SPEAR_SHIFT
    hips0 = Vector(r.rest_loc["hips"])
    debug = os.environ.get("R8_DEBUG")

    def hold(k):
        bpy.context.view_layer.update()
        W = u.root.matrix_world
        d = W.inverted() @ r.j["hips"].matrix_world.translation - hips0     # the bob and the lunge carry the hands
        R = W.to_3x3()
        h = (R @ Vector(k["h"])).normalized()
        motion.reach(r, "R", W @ (Vector(k["hand"]) + d))
        bpy.context.view_layer.update()
        o = r.j["wristR"].matrix_world @ Vector((0.0, 0.0, -0.05))        # the right hand's grip point, as reached
        grip.matrix_world = Matrix.Translation(o) @ motion.frame(-h, R @ Vector((0.0, 0.0, 1.0))).to_4x4()
        f = W @ (Vector(k["front"]) + d)
        target = o + h * min(max((f - o).dot(h), 0.18), 1.2)
        motion.reach(r, "L", target)
        if debug:
            bpy.context.view_layer.update()
            got = r.j["wristL"].matrix_world @ Vector((0.0, 0.0, -0.05))
            print("R8 spear", [round(c, 3) for c in k["hand"]], "front off the shaft", round((got - target).length, 3))

    def pose(anim, frame):
        n = u.frames.get(anim, 8)
        t = (frame % n) / n
        r.root.rotation_euler = (0, 0, 0)
        if anim == "death":
            units2.pose_generic(u, r, anim, frame, U1.spear_attack)
            h2.update(r)
            return
        if anim == "attack":
            a, o = U1.spear_attack(t)
            k = _spear_keys(t)
        else:
            a, o = U1.spear_attack(0.0)                     # the ready stance, left foot forward
            a, o = dict(a), dict(o)
            if anim == "walk":
                w, wo = walk(t, arms=False)
                a.update({j: v for j, v in w.items() if j.startswith(("hip", "knee", "ankle"))})
                a["torso"] = (w["torso"][0], 0, -16 + w["torso"][2])
                o = wo
            else:
                i, io = idle(t)
                a["torso"] = (a["torso"][0] + i["torso"][0], 0, a["torso"][2])
                a["neck"] = i["neck"]
                o = {"hips": tuple(x + y for x, y in zip(o.get("hips", (0, 0, 0)), io["hips"]))}
            k = SPEAR_READY
        r.pose(a, o)
        hold(k)
        h2.update(r)
    u.pose = pose


def before_extend(u, kind):
    """R8 changes that anims.extend must see (it keeps the unit's own pose for the deaths' first frame)."""
    import east_r8
    if kind == "spear_e":
        east_r8.dress_spear(u)
        spear_two_hands(u, kind)
    elif kind == "bow_e":
        east_r8.dress_bow(u)


def rim(energy=2.6):
    if "rim" in lib.LIGHTS:
        lib.LIGHTS["rim"].data.energy = energy
