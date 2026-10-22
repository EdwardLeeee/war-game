"""D-096 城門 (the user 2026-10-21: the gates shut and let only the holder's units through; every unit can break one,
given time): the leaves of the castle gates (castle.py), in the looks the client picks by the gate's hp.

  intact    the leaves stand open (art-v4's frame; shown while one of the holder's units goes through)
  closed    the leaves shut across the opening
  damaged   battered: planks smashed out of one leaf, which sags on its hinges; arrows in the other, soot, a small fire
            at the foot of the gate and its smoke (the 受損 look of the other buildings)
  broken    the gate is gone (the sim's gate building): one leaf broken off and flat on the ground, the other hanging
            off its hinge, splinters, thin smoke; the frame (posts, piers, gate tower) still stands
  ruin      (castle.py) the town burnt: everything sooty, the leaves open, anyone walks through

A leaf is built in its own frame: the hinge at the origin, the leaf running along -x * side (toward the middle of the
opening), its faces toward -y (the camera) and +y, from the ground up; an empty per leaf turns it onto the gate's axis,
swings it and tips it.
"""
import math
import random

import lib
from lib import box, cyl, rod, sphere, slab
import states

# the kinds of leaf: planks across a leaf, their thickness, what binds them
KINDS = {
    "plank_e": dict(n=5, t=0.14),      # the east palisade: plain planks, battens on both faces, a brace
    "log_w": dict(n=7, t=0.24),        # the west palisade: pointed logs like its stakes, two rails, a Z brace
    "lacquer_e": dict(n=4, t=0.2),     # the east city gate: red-lacquered planks, rows of gilt studs, a ring knocker
    "oak_w": dict(n=5, t=0.2),         # the west city gate: oak planks, iron straps and studs
}


def _hinge(name, parent, at, axis, side, w=0.0, swing=0.0, sag=0.0, fall=0.0):
    """The empty a leaf hangs from, at its hinge `at`: `swing` turns it open about the hinge (degrees, away from the
    camera), `sag` tips its free end down (the hinge raised so that end stays on the ground; `w` the leaf's width),
    `fall` lays it over toward the camera about its foot."""
    rz = 0.0 if axis == "x" else 90.0
    at = (at[0], at[1], at[2] + w * math.sin(math.radians(sag)))
    return lib.empty(name, parent=parent, loc=at, rot=(fall, -side * sag, rz - side * swing))


def _plank(name, mat, parent, u, pw, t, ph, jag, rnd):
    """One plank of a leaf, its foot on the ground at u; `jag` breaks its top off raggedly."""
    if not jag:
        return box(name, (pw, t, ph), mat, parent, loc=(u, 0, ph / 2))
    pts = [(-pw / 2, 0), (pw / 2, 0), (pw / 2, ph * rnd.uniform(0.86, 0.95)), (pw * 0.12, ph),
           (-pw * 0.18, ph * rnd.uniform(0.78, 0.88)), (-pw / 2, ph * rnd.uniform(0.9, 0.97))]
    return slab(name, pts, t, mat, parent=parent, loc=(u, 0, 0), plane="XZ")


def leaf(name, P, hinge, side, w, h, kind, left=None, seed=1):
    """One leaf under `hinge`, `w` wide and `h` high. left: {plank index from the hinge: fraction of its height left}
    for the planks smashed out of it."""
    rnd = random.Random(seed)
    k = KINDS[kind]
    n, t = k["n"], k["t"]
    left = left or {}
    wood = {"plank_e": P["wood"], "log_w": P["bark"], "lacquer_e": P["post"], "oak_w": P["wood"]}[kind]
    pw = w / n
    tops = []
    for i in range(n):
        u = -side * pw * (i + 0.5)
        f = left.get(i, 1.0)
        if kind == "log_w":
            hh = h * (0.95 + 0.05 * ((i * 37) % 5) / 4) * f
            cyl(f"{name}_log{i}", pw / 2, hh, wood, hinge, loc=(u, 0, 0), segs=8)
            if f >= 1.0:
                cyl(f"{name}_tip{i}", pw / 2, 0.3, wood, hinge, loc=(u, 0, hh), r2=0.02, segs=8)
            tops.append(hh)
        else:
            _plank(f"{name}_pl{i}", wood, hinge, u, pw * 0.97, t, h * f, f < 1.0, rnd)
            tops.append(h * f)
    def reach(z):
        """How far from the hinge a batten at height z still has planks to hold (it breaks off at the smashed ones)."""
        k = next((i for i in range(n) if tops[i] < z + 0.1), n)
        return pw * k

    if kind in ("plank_e", "log_w"):
        bind = P["post"] if kind == "plank_e" else P["beam"]
        zs = (0.45, h * 0.5, h * 0.82) if kind == "plank_e" else (0.6, h * 0.72)
        for face in (-1, 1):
            for z in zs:
                r_ = min(w - 0.04, reach(z)) - 0.04
                if r_ > 0.2:
                    box(f"{name}_bat{face}{z:.1f}", (r_, 0.06, 0.16), bind, hinge, loc=(-side * (r_ / 2 + 0.02), face * (t / 2 + 0.03), z))
            if not left:                     # the brace, foot at the hinge side, rising to the free side
                rod(f"{name}_brace{face}", (-side * 0.15, face * (t / 2 + 0.03), zs[0]), (-side * (w - 0.15), face * (t / 2 + 0.03), zs[-1]),
                    0.05, bind, parent=hinge, segs=6)
    elif kind == "lacquer_e":
        rows, cols = 5, 3
        for r_ in range(rows):
            z = h * (0.16 + 0.68 * r_ / (rows - 1))
            for q in range(cols):
                u = -side * w * (0.2 + 0.6 * q / (cols - 1))
                if z < tops[min(n - 1, int(abs(u) / pw))] - 0.08:
                    sphere(f"{name}_stud{r_}{q}", 0.055, P["gold"], hinge, loc=(u, -t / 2 - 0.01, z), segs=10, rings=6,
                           outline=False)
        # the ring knocker (鋪首) by the meeting edge
        ux = -side * (w - 0.35)
        if tops[-1] > h * 0.6:
            sphere(f"{name}_boss", 0.12, P["gold"], hinge, loc=(ux, -t / 2 - 0.02, h * 0.5), scale=(1, 0.4, 1), segs=12)
            lib.ring(f"{name}_ring", 0.1, 0.14, P["gold"], parent=hinge, loc=(ux, -t / 2 - 0.05, h * 0.44))
    else:
        for z in (h * 0.2, h * 0.5, h * 0.8):
            r_ = min(w - 0.06, reach(z))
            box(f"{name}_strap{z:.1f}", (r_, 0.03, 0.12), P["iron"], hinge, loc=(-side * r_ / 2, -t / 2 - 0.015, z), outline=False)
            for q in range(4):
                u = -side * w * (0.12 + 0.76 * q / 3)
                if abs(u) > r_:
                    continue
                sphere(f"{name}_nail{z:.1f}{q}", 0.035, P["iron"], hinge, loc=(u, -t / 2 - 0.035, z), segs=8, rings=5,
                       outline=False)
    return tops


def _arrows(name, P, parent, pts, rnd):
    """Arrows stuck in a face (unit space points on it), their shafts out toward the camera."""
    for i, (x, y, z) in enumerate(pts):
        dx, dz = rnd.uniform(-0.15, 0.15), rnd.uniform(-0.12, 0.05)
        tail = (x + dx, y - 0.55, z + dz)
        rod(f"{name}{i}", (x, y, z), tail, 0.014, P["beam"], parent=parent, segs=4, outline=False)
        box(f"{name}{i}_f", (0.02, 0.12, 0.07), P["canvas"], parent, loc=(tail[0], tail[1] + 0.06, tail[2]), outline=False)


def splinters(name, P, parent, centre, spread, n, seed, wood):
    rnd = random.Random(seed)
    cx, cy, sx, sy = centre[0], centre[1], spread[0], spread[1]
    for i in range(n):
        L = rnd.uniform(0.25, 0.7)
        box(f"{name}{i}", (L, rnd.uniform(0.07, 0.14), 0.05), wood, parent,
            loc=(cx + rnd.uniform(-sx, sx), cy + rnd.uniform(-sy, sy), 0.04), rot=(0, rnd.uniform(-8, 8), rnd.uniform(0, 180)))


def portcullis(name, P, parent, axis, op, h, across, state, seed=3):
    """The west city gate's iron grille, let down at `across` (the camera side of the leaves): bars and cross-bars,
    spikes at the foot. damaged: two bars bent out, one gone; broken: torn out, a bent piece on the ground."""
    rnd = random.Random(seed)
    along = (lambda t, o, z: (t, o, z)) if axis == "x" else (lambda t, o, z: (o, t, z))
    n = 7
    if state == "broken":
        g = lib.empty(f"{name}_down", parent=parent, loc=along(op * 0.15, across - 0.9, 0.06),
                      rot=(84, 0, (0 if axis == "x" else 90) + 12))
        for i in range(4):
            t = -0.6 + 0.4 * i
            rod(f"{name}_dbar{i}", (t, 0, 0), (t + rnd.uniform(-0.1, 0.1), 0, 1.6), 0.03, P["iron"], parent=g, segs=6,
                outline=False)
        for z in (0.3, 1.2):
            rod(f"{name}_dx{z}", (-0.7, 0, z), (0.7, 0, z), 0.03, P["iron"], parent=g, segs=6, outline=False)
        return
    for i in range(n):
        t = -op / 2 + 0.25 + i * (op - 0.5) / (n - 1)
        if state == "damaged" and i == 4:
            continue
        if state == "damaged" and i in (2, 3):
            kink = along(t + (0.18 if i == 2 else -0.14), across - 0.35, h * 0.45)
            rod(f"{name}_b{i}a", along(t, across, 0.0), kink, 0.03, P["iron"], parent=parent, segs=6, outline=False)
            rod(f"{name}_b{i}b", kink, along(t, across, h), 0.03, P["iron"], parent=parent, segs=6, outline=False)
            continue
        rod(f"{name}_b{i}", along(t, across, 0.0), along(t, across, h), 0.03, P["iron"], parent=parent, segs=6, outline=False)
        cyl(f"{name}_sp{i}", 0.04, 0.18, P["iron"], parent, loc=along(t, across, 0.0), rot=(180, 0, 0), r2=0.0, segs=6,
            outline=False)
    for z in (h * 0.25, h * 0.55, h * 0.85):
        rod(f"{name}_x{z:.1f}", along(-op / 2 + 0.1, across, z), along(op / 2 - 0.1, across, z), 0.028, P["iron"],
            parent=parent, segs=6, outline=False)


def shut(parent, P, c, axis, op, h, kind, state, across=0.0, mouth=-0.5, seed=1):
    """The two leaves across an opening `op` wide on `axis`, centred on the piece (`across` off its line): closed,
    damaged or broken. `mouth`: how far across (toward the camera, or the side for an east-west gate) the fire burns
    and the splinters lie, where the camera sees them."""
    rnd = random.Random(seed)
    along = (lambda t, o=0.0, z=0.0: (t, o, z)) if axis == "x" else (lambda t, o=0.0, z=0.0: (o, t, z))
    w = op / 2
    n = KINDS[kind]["n"]
    wood = {"plank_e": P["wood"], "log_w": P["bark"], "lacquer_e": P["post"], "oak_w": P["wood"]}[kind]
    hinges = []
    for side in (-1, 1):
        at = along(side * op / 2, across)
        nm = f"gl{side}"
        if state == "closed":
            g = _hinge(nm, parent, at, axis, side)
            leaf(nm, P, g, side, w, h, kind, seed=seed + side)
        elif state == "damaged" and side > 0:
            # smashed: the planks by the meeting edge broken out from the top, the leaf sagging on its hinges
            g = _hinge(nm, parent, at, axis, side, w, swing=3.0, sag=2.5)
            gone = {n - 1: 0.3, n - 2: 0.42, n - 3: 0.7} if n > 4 else {n - 1: 0.38, n - 2: 0.55}
            leaf(nm, P, g, side, w, h, kind, left=gone, seed=seed + side)
        elif state == "damaged":
            g = _hinge(nm, parent, at, axis, side)
            leaf(nm, P, g, side, w, h, kind, seed=seed + side)
            o = across - KINDS[kind]["t"] / 2 - 0.01
            _arrows("ga_arrow", P, parent, [along(side * w * f, o, h * z) for f, z in ((0.35, 0.62), (0.6, 0.4), (0.75, 0.7))],
                    rnd)
        elif side < 0:
            # broken off at the hinges and down on its face, toward the camera; its top half broken away
            at = along(side * op / 2, across - 0.05, KINDS[kind]["t"] / 2 + 0.03)
            g = _hinge(nm, parent, at, axis, side, fall=86.0)
            g.rotation_euler.z += math.radians(-side * 14)
            leaf(nm, P, g, side, w * 0.96, h * 0.55, kind, left={n - 1: 0.6}, seed=seed + side)
        else:
            # hanging off its upper hinge, swung half open, its free end down on the ground, half its planks gone
            g = _hinge(nm, parent, at, axis, side, w, swing=30.0, sag=13.0)
            leaf(nm, P, g, side, w, h, kind, left={n - 1: 0.3, n - 2: 0.55, n - 3: 0.8}, seed=seed + side)
        hinges.append(g)
    if state == "broken":
        for g in hinges:
            states._char_all(g, above=0.0)
    if state in ("damaged", "broken"):
        x, y, _ = along(w * 0.45, across + mouth)
        splinters("gs_spl", P, parent, (x, y), (0.6, 0.4) if axis == "x" else (0.4, 0.6), 6 if state == "damaged" else 11,
                  seed + 5, wood)
        if state == "broken":
            x2, y2, _ = along(-w * 0.5, across + mouth * 0.6)
            splinters("gs_spl2", P, parent, (x2, y2), (0.5, 0.35) if axis == "x" else (0.35, 0.5), 7, seed + 9, wood)
    if state == "damaged":
        fx, fy, _ = along(w * 0.4, across + mouth)
        states.flames(parent, P, "gd_fire", (fx, fy, 0.05), size=0.85, n=6, seed=seed + 11)
        states.smoke(parent, "gd", (fx, fy, h * 0.7), height=3.4, r0=0.3, r1=0.85, n=9, dark=0.2, alpha=0.85)
    elif state == "broken":
        fx, fy, _ = along(-w * 0.3, across + mouth * 0.5)
        states.smoke(parent, "gb", (fx, fy, 0.6), height=2.6, r0=0.25, r1=0.7, n=7, dark=0.12, alpha=0.55)
    return hinges
