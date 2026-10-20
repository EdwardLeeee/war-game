"""R8 (D-093) on top of R7 version 2 (r7_prod.apply with version 8): what the full set adds.

- Bows (bow_e, bow_w): the string is pulled to the right hand while the attack draws, with an arrow on it, and
  straight and empty after the loose (the flying arrow is the game's own); the approved draw and loose unchanged.
- Hands: MPFB's open fingers closed into a grip (human_r7.curl_fingers), the hands hold spears, bows and tools.
- Rim light: stronger, to lift the soldiers off the realistic ground (the brief's readability rule).
"""
import math
import os

import bpy
from mathutils import Matrix, Vector

import lib

BOWS = ("bow_e", "bow_w")


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
    sa = _unit_rod(f"{kind}_r8stra", 0.006, m, grip)      # a little thicker than a real string: it must read at 3x
    sb = _unit_rod(f"{kind}_r8strb", 0.006, m, grip)
    wood = lib.MATS.get("wood5", {}).get("mat") or m
    feather = lib.MATS.get("feather5", {}).get("mat") or m
    shaft = _unit_rod(f"{kind}_r8arrow", 0.006, wood, grip)
    head = _unit_rod(f"{kind}_r8arrowhead", 0.008, lib.MATS.get("steel2", {}).get("mat") or m, grip)
    fletch = _unit_rod(f"{kind}_r8fletch", 0.011, feather, grip)
    rig = u.rigs["body"]
    orig = u.pose

    def pose(anim, frame):
        orig(anim, frame)
        bpy.context.view_layer.update()
        n = getattr(u, "frames", {}).get(anim, 10)
        t = frame / max(1, n)
        gi = grip.matrix_world.inverted()
        hand = gi @ (rig.j["wristR"].matrix_world @ Vector((0.0, 0.015, -0.075)))
        drawing = anim == "attack" and 0.12 <= t < 0.6 and (hand - rest).length > 0.12
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


def rim(energy=2.6):
    if "rim" in lib.LIGHTS:
        lib.LIGHTS["rim"].data.energy = energy
