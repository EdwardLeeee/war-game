"""R8 batch 2 (D-093): the cliff in the realistic look. The ceo's brief: 「懸崖不能看起來像城牆」— at a glance it must
read as natural rock, never as masonry (research/nature-reference): so everything a wall is not:
  - the run wanders in plan and its top line is jagged (a wall is straight and level);
  - the face is broken into strata: ledges stepping in and out, overhangs, cracks (a wall is one plane);
  - two rock colours, weathered light above and dark and damp below, with moss and grass on the ledges and shrubs on
    top (a wall is one stone colour and bare);
  - talus at the foot: a slope of broken rock spilling outward (a wall stands clean on the ground).
"""
import math
import random

import bmesh

import lib
from lib import ico

CELL = 2.0


def _noise(seed):
    """A smooth 2D noise from a few sines with random phases and directions (deterministic, no libraries)."""
    rnd = random.Random(seed)
    waves = [(rnd.uniform(0.6, 1.8) * f, rnd.uniform(0.3, 1.2) * f, rnd.uniform(0, 6.3), 1.0 / f) for f in (1.0, 2.1, 4.3, 8.7)]

    def n(a, b):
        return sum(amp * math.sin(fa * a + fb * b + ph) for fa, fb, ph, amp in waves) / 1.9
    return n


def mats():
    m = lib.mat
    return dict(
        rock=m("cliffrock", (0.36, 0.33, 0.29), 0.9),           # the weathered upper face
        rockdark=m("cliffrockdark", (0.2, 0.18, 0.16), 0.92),   # the damp foot, the cracks, the scree
        moss=m("moss_r8", (0.09, 0.14, 0.05), 0.95),
        grass=m("grass_r8", (0.16, 0.22, 0.07), 0.95),
        shrub=m("shrub_r8", (0.05, 0.09, 0.035), 0.95),
    )


def cliff_run(root, length, seed=11, h=3.0, depth=2.2):
    """A rock ridge along x from -length/2 to length/2, its front (the camera side, -y) broken into strata."""
    P = mats()
    rnd = random.Random(seed)
    n1, n2, n3 = _noise(seed), _noise(seed + 1), _noise(seed + 2)
    nu = max(40, int(length / 0.12))
    nv = 36

    def at(u, v):
        x = (u - 0.5) * length
        wander = 0.35 * n1(x * 0.25, 0.0)                         # the run wanders in plan
        top = h * (0.85 + 0.25 * n2(x * 0.45, 1.0)) + 0.25 * n3(x * 1.7, 2.0)
        end = min(1.0, (0.5 - abs(u - 0.5)) * length / 1.2)        # the ends slope down into the ground
        top *= 0.35 + 0.65 * math.sqrt(max(0.0, end))
        if v <= 0.5:                                               # the front face, foot (v 0) to the top edge (v .5)
            t = v / 0.5
            z = top * t
            band = 0.42 + 0.12 * n1(x * 0.3, 7.0)                  # strata: bands that step in at their tops
            strata = 0.3 * ((z / band) % 1.0) ** 2
            over = 0.3 * math.sin(math.pi * t) ** 3 * (0.5 + 0.5 * n3(x * 0.8, 5.0))  # overhangs
            crack = 0.22 * max(0.0, math.sin(x * 2.9 + 1.3 * n1(x, 3.0))) ** 12     # vertical cracks
            y = -depth / 2 * (1 - 0.18 * t) + strata - over + crack + wander
            y += 0.1 * n2(x * 2.2, z * 2.0)
        else:                                                      # over the top and down the back
            t = (v - 0.5) / 0.5
            z = top * (1 - t ** 1.6) + 0.12 * n1(x * 1.3, t * 3.0)
            y = -depth / 2 * 0.45 + depth * 0.95 * t + wander
        return (x, y, max(0.0, z))

    bm = bmesh.new()
    vs = [[bm.verts.new(at(i / nu, j / nv)) for j in range(nv + 1)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((vs[i][j], vs[i + 1][j], vs[i + 1][j + 1], vs[i][j + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # the colour: weathered light above 40 % of the height, damp and dark below (two material slots)
    me_obj = lib._mesh_obj("cl_face", bm, P["rock"], root, (0, 0, 0), smooth=True, outline=False)
    me_obj.data.materials.append(P["rockdark"])
    for poly in me_obj.data.polygons:
        zc = sum(me_obj.data.vertices[k].co.z for k in poly.vertices) / len(poly.vertices)
        if zc < h * 0.32 + 0.25 * n2(poly.center.x * 1.1, 9.0):
            poly.material_index = 1
    # turf over the top: a skin of grass following the rock, its edge ragged and hanging a little over the face
    def turf(u, v):
        x, y, z = at(u, 0.47 + 0.53 * v)
        return (x, y, z + 0.06 + 0.05 * n3(x * 3.0, v * 4.0))
    bm2 = bmesh.new()
    ts = [[bm2.verts.new(turf(i / nu, j / 12)) for j in range(13)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(12):
            bm2.faces.new((ts[i][j], ts[i + 1][j], ts[i + 1][j + 1], ts[i][j + 1]))
    bmesh.ops.recalc_face_normals(bm2, faces=bm2.faces)
    lib._mesh_obj("cl_turf", bm2, P["grass"], root, (0, 0, 0), smooth=True, outline=False)
    # moss in the ledges: small flattened clumps in irregular groups
    for k in range(int(length * 6)):
        u = rnd.uniform(0.04, 0.96)
        v = rnd.uniform(0.18, 0.46)
        x, y, z = at(u, v)
        if z < 0.5:
            continue
        for q in range(rnd.randint(1, 3)):
            ico(f"cl_moss{k}_{q}", rnd.uniform(0.05, 0.12), P["moss"], root,
                loc=(x + rnd.uniform(-0.15, 0.15), y - 0.04, z + rnd.uniform(-0.05, 0.05)), subdiv=2,
                scale=(rnd.uniform(1.2, 2.0), 0.7, rnd.uniform(0.3, 0.5)))
    # shrubs on the top: clusters of rounded clumps, dark green
    for k in range(int(length * 0.9)):
        u = rnd.uniform(0.08, 0.92)
        x, y, z = at(u, rnd.uniform(0.52, 0.66))
        for q in range(rnd.randint(3, 6)):
            r = rnd.uniform(0.14, 0.3)
            ico(f"cl_shrub{k}_{q}", r, P["shrub"], root,
                loc=(x + rnd.uniform(-0.3, 0.3), y + rnd.uniform(-0.15, 0.35), z + r * 0.7 + rnd.uniform(0, 0.15)), subdiv=2,
                scale=(1.0, 1.0, rnd.uniform(0.7, 1.0)))
    # the talus: broken rock spilling out from the foot, big near the face, small further out
    for k in range(int(length * 7)):
        u = rnd.uniform(0.0, 1.0)
        x, y, _ = at(u, 0.0)
        out = rnd.uniform(0.0, 1.0) ** 1.5
        r = 0.42 * (1 - out) + 0.08
        ico(f"cl_talus{k}", rnd.uniform(0.6, 1.0) * r, P["rockdark"] if rnd.random() < 0.6 else P["rock"], root,
            loc=(x + rnd.uniform(-0.2, 0.2), y - 0.15 - out * 1.1, r * 0.35), subdiv=1,
            scale=(rnd.uniform(0.9, 1.4), rnd.uniform(0.8, 1.2), rnd.uniform(0.5, 0.8)))


def cliff_sample(root, c, variant=0):
    """The comparison's cliff: a 3-cell run."""
    cliff_run(root, 3 * CELL, seed=11 + variant)


FOOTPRINT = {"r8_cliff_sample": (3, 1)}
BUILDERS = {"r8_cliff_sample": cliff_sample}
