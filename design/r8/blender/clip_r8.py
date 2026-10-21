"""R8: the weapons against the bodies, on every frame of every animation in every facing (the user 2026-10-21:
「你的槍穿過身體了」). render_units runs it as a job of its own (job["clip"]) after the unit is built and dressed,
and writes a report; render_prod runs that job before rendering and prints the frames that fail.

What is tested: points along every edge of the weapon's meshes, 2 cm apart (a shaft's mesh has vertices only at its
two ends), against each body near them (the MPFB body of every rider and soldier, the realistic horse): the signed
distance to the body's surface (its nearest face, by the face's outward normal). A point fails when it is inside the
body or closer to the skin than MARGIN (the clothes stand 1.4 cm off the skin, the armour up to 4 cm; the horse's
caparison 3.5 cm off its coat). Points within HAND of a hand's grip point are not tested (the hand holds the shaft
there), nor the hands' own faces.
"""
import json
import os

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

MARGIN = {"human": 0.03, "horse": 0.03, "arm": 0.012}      # the arms: their sleeves only (1.2 cm), not armour
HAND = 0.11
FIST = 0.2           # an arm's own fist and wrist: points this close to a hand are not tested against that arm
PALM = 0.11          # the body's own faces this close to a hand's grip point are the hand (left out)
FIST_AT = {"R": (-0.04, 0.0, -0.07), "L": (0.04, 0.0, -0.07)}     # as r8.FIST: the fist in the wrist's frame
STEP = 0.02
# the weapon of each unit: the joint it hangs on (every mesh under it), names left out (the bowstring, the arrow:
# drawn to the face on purpose)
WEAPONS = {
    "spear_e": ("body", "grip_spear", ()), "pike_w": ("body", "grip_pike", ()),
    "hcav_e": ("body", "grip_lance", ()), "knight_w": ("body", "grip_lance", ()),
    "bow_e": ("body", "grip_bow", ("string", "r8str", "r8arrow", "r8fletch")),
    "bow_w": ("body", "grip_bow", ("string", "r8str", "r8arrow", "r8fletch")),
    "mage_w": ("body", "grip_staff", ()),
    "farmer_e": ("body", "grip_axe", ()), "farmer_w": ("body", "grip_hoe", ()),
}
# where the weapon's root is not the joint itself (the farmers' tools hang on an empty under the grip)
ROOTS = {"farmer_e": "farmer_e_tool_root", "farmer_w": "farmer_w_tool_root",
}


def _descendants(ob):
    out, stack = [], list(ob.children)
    while stack:
        o = stack.pop()
        out.append(o)
        stack.extend(o.children)
    return out


def _visible(ob):
    if ob.type != "MESH" or ob.hide_render:
        return False
    s = ob.matrix_world.to_scale()
    return min(abs(s.x), abs(s.y), abs(s.z)) > 0.01


def signed(p, hit, deepest=0.25):
    """Signed distance from p to the body's surface: the nearest face's distance, negative when p is behind its
    outward normal (inside). (The normal's projection alone is ~0 for a far point beside a face: false contacts.)
    Nothing is deeper than `deepest` inside a body part (an arm is 4 cm round): a point that far 'behind' a face is
    outside, past an open edge of the mesh (where the hands' faces are left out)."""
    d = p - hit[0]
    if d.dot(hit[1]) >= 0 or d.length > deepest:
        return d.length
    return -d.length


def _samples(ob):
    """World points along the mesh's edges, STEP apart, and its vertices."""
    me = ob.data
    M = np.array(ob.matrix_world)
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3) @ M[:3, :3].T + M[:3, 3]
    ed = np.empty(len(me.edges) * 2, np.int64)
    me.edges.foreach_get("vertices", ed)
    ed = ed.reshape(-1, 2)
    pts = [co]
    for a, b in ed:
        d = co[b] - co[a]
        n = int(np.linalg.norm(d) / STEP)
        if n > 1:
            k = np.arange(1, n)[:, None] / n
            pts.append(co[a] + d * k)
    return np.vstack(pts)


class Body:
    """A body mesh posed by its skinner; its faces less the hands', as a BVH tree each frame."""

    def __init__(self, ob, kind, skip_verts=None, part_of=None):
        self.ob, self.kind = ob, kind
        polys = [tuple(p.vertices) for p in ob.data.polygons]
        if skip_verts is not None:
            polys = [p for p in polys if not any(skip_verts[i] for i in p)]
        self.polys = polys
        self.part_of = part_of               # vertex -> the body part's name (the joint it mostly follows)

    def tree(self, hands=()):
        """The BVH of the posed body; the faces near a hand left out too (the fist around the weapon: MPFB's palm is
        partly weighted to the forearm, so the hand by weight is not the whole hand)."""
        me = self.ob.data
        M = np.array(self.ob.matrix_world)
        co = np.empty(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3) @ M[:3, :3].T + M[:3, 3]
        polys = self.polys
        if len(hands) and self.kind == "human":
            near = np.zeros(len(co), bool)
            for h in hands:
                near |= np.linalg.norm(co - h, axis=1) < PALM
            polys = [p for p in polys if not all(near[i] for i in p)]
        self.used = polys
        return BVHTree.FromPolygons([tuple(c) for c in co], polys)


def setup(u, kind):
    """The bodies and the weapon of a dressed unit (after r7_prod.apply), or None when the unit carries none."""
    import human_r7
    if kind not in WEAPONS:
        return None
    rig_name, joint, skip = WEAPONS[kind]
    rig = u.rigs.get(rig_name)
    if rig is None or joint not in rig.j:
        return None
    bodies = []
    for r in [v for v in u.rigs.values() if hasattr(v, "j")]:
        for sk in getattr(r, "skinners", []):
            name = sk.obj.name.split(".")[0]
            if name.endswith("_r7body") and isinstance(sk, human_r7.WeightSkinner):
                J = list(human_r7.JOINTS)
                hand = np.isin(sk.idx[:, 0], [J.index("wristR"), J.index("wristL")])
                bodies.append(Body(sk.obj, "human", hand, [J[i] for i in sk.idx[:, 0]]))
            elif name.endswith("_r8body"):
                bodies.append(Body(sk.obj, "horse"))
    grips = [rig.j[k] for k in ("wristR", "wristL")]
    root = bpy.data.objects.get(ROOTS[kind]) if kind in ROOTS else rig.j[joint]
    return dict(rig=rig, joint=root, skip=skip, bodies=bodies, grips=grips)


def check(S):
    """One posed frame: the worst point of the weapon against each body. Returns (ok, worst) with worst a list of
    dicts {part, body, gap} for the points that fail (gap: signed distance to the skin, negative inside)."""
    bpy.context.view_layer.update()
    parts = [o for o in _descendants(S["joint"]) if _visible(o) and not any(k in o.name for k in S["skip"])]
    if not parts:
        return True, []
    hands = [np.array(g.matrix_world @ Vector(FIST_AT[s])) for g, s in zip(S["grips"], "RL")]
    side_of = {"R": hands[0], "L": hands[1]}
    fails = []
    trees = [(b, b.tree(hands)) for b in S["bodies"]]
    for ob in parts:
        P = _samples(ob)
        keep = np.ones(len(P), bool)
        for h in hands:
            keep &= np.linalg.norm(P - h, axis=1) > HAND
        P = P[keep]
        for b, tr in trees:
            worst, where = None, None
            for p in P:
                hit = tr.find_nearest(Vector(p), 0.5)
                if hit[0] is None:
                    continue
                loc, nrm, fi, dist = hit
                part = b.part_of[b.used[fi][0]] if b.part_of else None
                arm = bool(part and part.startswith(("shoulder", "elbow")))
                gap = signed(Vector(p), hit, 0.06 if arm else (0.25 if b.kind == "human" else 0.45))
                if part and part.startswith(("shoulder", "elbow")) and np.linalg.norm(p - side_of[part[-1]]) < FIST:
                    continue                                   # the arm's own fist around the weapon
                m = MARGIN["arm"] if part and part.startswith(("shoulder", "elbow")) else MARGIN[b.kind]
                if gap < m and (worst is None or gap < worst):
                    worst = gap
                    where = part
                    if os.environ.get("R8_CLIPDBG"):
                        w = S["rig"].j["wristR"].matrix_world.inverted()
                        print("CLIPDBG", ob.name, part, round(float(gap), 3), "from fists",
                              [round(float(np.linalg.norm(p - h)), 3) for h in hands],
                              "in wristR", [round(c, 3) for c in (w @ Vector(p))], "face at", [round(c, 3) for c in (w @ loc)],
                              "face verts", [b.part_of[i] for i in b.used[fi]], len(b.used), flush=True)
            if worst is not None:
                fails.append(dict(part=ob.name, body=b.ob.name, gap=round(float(worst), 3), where=where))
    return not fails, fails


def run(u, kind, items, out):
    """Pose every item (render_units' fit items: every frame of every animation in every facing) and write the
    report: the failing frames and, per animation, how many."""
    S = setup(u, kind)
    rep = dict(unit=kind, margin=MARGIN, hand=HAND, frames=0, failing=0, by_anim={}, fails=[])
    if S is None:
        rep["note"] = "no weapon to test"
    else:
        for it in items:
            if it.get("n"):
                u.frames = dict(getattr(u, "frames", {}), **{it["anim"]: it["n"]})
            u.face(it["facing"])
            u.pose(it["anim"], it["frame"])
            ok, fails = check(S)
            rep["frames"] += 1
            a = rep["by_anim"].setdefault(it["anim"], [0, 0])
            a[0] += 1
            if not ok:
                rep["failing"] += 1
                a[1] += 1
                rep["fails"].append(dict(anim=it["anim"], facing=it["facing"], frame=it["frame"], parts=fails))
    with open(out, "w") as f:
        json.dump(rep, f, ensure_ascii=False, indent=1)
    print(f"CLIP {kind}: {rep['failing']} of {rep['frames']} frames fail "
          + " ".join(f"{k} {v[1]}/{v[0]}" for k, v in rep["by_anim"].items()), flush=True)
    if os.environ.get("R8_DEBUG"):
        for fl in rep["fails"][:40]:
            print("CLIP", fl["anim"], fl["facing"], fl["frame"], fl["parts"])
    return rep


DEATHS = ("death", "fall", "shatter", "dead")


def _arm_free(sk):
    """Vertices of the arms (shoulder, elbow, wrist): left out where the weapon's own hands move with it."""
    import human_r7
    J = list(human_r7.JOINTS)
    return np.isin(sk.idx[:, 0], [J.index(n) for n in ("shoulderR", "elbowR", "wristR", "shoulderL", "elbowL",
                                                        "wristL")])


def unclip(u, kind, target=0.045, tries=16, step=0.06):
    """u.pose wrapped: after each pose, the weapon moved out of the bodies (the user 2026-10-21: 「你的槍穿過身體了」).
    Held (every animation but the deaths): the weapon and the hands on it move together, the arms re-reached, against
    the trunk, head, legs and the horse (the arms move with it). Dropped (the deaths): the weapon alone, against
    everything but the hands. Each try moves it by the mean of (normal x how far short of `target`) over the points that
    are too close, at most `step`."""
    import motion
    S = setup(u, kind)
    if S is None:
        return
    rig = S["rig"]
    held_bodies, drop_bodies = [], []
    for b in S["bodies"]:
        drop_bodies.append(b)
        if b.kind == "human":
            sk = next(s for s in rig.skinners + [s for r in u.rigs.values() for s in getattr(r, "skinners", [])]
                      if s.obj == b.ob)
            free = _arm_free(sk)
            held = Body(b.ob, "human", free | np.array([False] * len(free)), b.part_of)
            held.polys = [p for p in b.polys if not any(free[i] for i in p)]
            held_bodies.append(held)
        else:
            held_bodies.append(b)
    orig = u.pose
    debug = os.environ.get("R8_DEBUG")
    human = next((b for b in S["bodies"] if b.kind == "human"), None)
    arm_faces = {}
    if human is not None:
        sk = next(s for r in u.rigs.values() for s in getattr(r, "skinners", []) if s.obj == human.ob)
        import human_r7
        J = list(human_r7.JOINTS)
        for side in "RL":
            mine = np.isin(sk.idx[:, 0], [J.index("shoulder" + side), J.index("elbow" + side)])
            arm_faces[side] = [p for p in human.polys if all(mine[i] for i in p)]

    def parts_now(root):
        return [o for o in _descendants(root) if _visible(o) and not any(k in o.name for k in S["skip"])]

    def arms_clear(parts, target_arm=0.02):
        """An arm the weapon runs into: the same hand on the same point, the elbow turned away from the weapon (the
        IK's pole), the weapon kept where it was (it hangs on the right hand)."""
        if human is None or not parts:
            return
        root = S["joint"]
        for side in "RL":
            for _ in range(4):
                bpy.context.view_layer.update()
                human_sk = next(s for r in u.rigs.values() for s in getattr(r, "skinners", []) if s.obj == human.ob)
                human_sk.update()
                M = np.array(human.ob.matrix_world)
                co = np.array([v.co[:] for v in human.ob.data.vertices]) @ M[:3, :3].T + M[:3, 3]
                tr = BVHTree.FromPolygons([tuple(c) for c in co], arm_faces[side])
                hand = np.array(rig.j["wrist" + side].matrix_world @ Vector(FIST_AT[side]))
                bad = []
                for ob in parts:
                    P = _samples(ob)
                    P = P[np.linalg.norm(P - hand, axis=1) > FIST]
                    for p in P:
                        hit = tr.find_nearest(Vector(p), 0.3)
                        if hit[0] is not None and signed(Vector(p), hit, 0.06) < target_arm:
                            bad.append(p)
                if not bad:
                    break
                el = rig.j["elbow" + side].matrix_world.translation
                away = Vector(tuple(np.array(el) - np.mean(bad, axis=0)))
                if away.length < 1e-4:
                    break
                g = rig.j["wrist" + side].matrix_world @ Vector((0.0, 0.0, -0.05))
                keep = root.matrix_world.copy()
                motion.reach(rig, side, g, pole=away.normalized())
                bpy.context.view_layer.update()
                root.matrix_world = keep

    def too_close(bodies, parts, hands):
        trees = [(b, b.tree(hands)) for b in bodies]
        pts, push = 0, Vector((0.0, 0.0, 0.0))
        for ob in parts:
            P = _samples(ob)
            keep = np.ones(len(P), bool)
            for h in hands:
                keep &= np.linalg.norm(P - h, axis=1) > HAND
            for p in P[keep]:
                v = Vector(p)
                for b, tr in trees:
                    hit = tr.find_nearest(v, 0.5)
                    if hit[0] is None:
                        continue
                    gap = signed(v, hit, 0.25 if b.kind == "human" else 0.45)
                    if gap < target:
                        push += hit[1] * (target - gap)
                        pts += 1
        return pts, (push / pts if pts else push)

    def pose(anim, frame):
        orig(anim, frame)
        for r in u.rigs.values():
            for sk in getattr(r, "skinners", []):
                if sk.obj.name.split(".")[0].endswith(("_r7body", "_r8body")):
                    sk.update()
        bpy.context.view_layer.update()
        dead = anim in DEATHS and frame > 0          # a death's first frame is the stance, the weapon still in hand
        root = S["joint"]
        grips = {s: rig.j["wrist" + s].matrix_world @ Vector((0.0, 0.0, -0.05)) for s in "RL"}     # the IK's points
        fists = {s: rig.j["wrist" + s].matrix_world @ Vector(FIST_AT[s]) for s in "RL"}
        moved = Vector((0.0, 0.0, 0.0))
        cap = 0.5 if dead else 0.22                   # held: never more than 22 cm from where the animation has it
        for i in range(tries):
            parts = [o for o in _descendants(root) if _visible(o) and not any(k in o.name for k in S["skip"])]
            hands = [np.array(f) for f in fists.values()]
            n, push = too_close(drop_bodies if dead else held_bodies, parts, [] if dead else hands)
            if debug:
                print("R8 unclip try", kind, anim, frame, i, n, [round(c, 3) for c in push], flush=True)
            if not n:
                break
            if push.length > step:
                push = push * (step / push.length)
            if (moved + push).length > cap:
                break
            moved += push
            bpy.context.view_layer.update()
            M = root.matrix_world.copy()
            if not dead:
                pts = np.vstack([_samples(o) for o in parts])
                for s, g in grips.items():
                    if np.min(np.linalg.norm(pts - np.array(fists[s]), axis=1)) < 0.12:     # this hand is on it
                        motion.reach(rig, s, g + push)
                        grips[s] = g + push
                        fists[s] = fists[s] + push
                bpy.context.view_layer.update()
            root.matrix_world = Matrix.Translation(push) @ M
            for r in u.rigs.values():
                for sk in getattr(r, "skinners", []):
                    if sk.obj.name.split(".")[0].endswith(("_r7body", "_r8body")):
                        sk.update()
            bpy.context.view_layer.update()
        if not dead:
            arms_clear(parts_now(root))
        if debug and i:
            print("R8 unclip", kind, anim, frame, "tries", i + 1)
        import humanoid2 as h2
        for r in u.rigs.values():
            if hasattr(r, "skinners"):
                h2.update(r)
    u.pose = pose
