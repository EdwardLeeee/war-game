"""art-v7.5 (the user 2026-11-06: 「西陸騎士的槍尖顏色怪怪的」): does any weapon's wooden shaft show through its metal head, or stop
short of it? Builds a unit as render_units.py does (no rendering) and, for every long wooden part with a metal part beside it under
one joint, measures along the shaft's axis: where the shaft ends, the metal's range, and at the end towards the metal how much of
the last stretch is wood (the shaft wider than the metal there) and how big the gap is between them.

blender -b --factory-startup --python tips_audit.py -- UNIT...      (env R7_VERSION=8 R9_UNIT=1 R7_TEX=...)
python3 blender/tips_audit.py runs every unit, one Blender each, and prints the table; a non-zero exit if any weapon is bad
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
UNITS = ["farmer_e", "spear_e", "bow_e", "hcav_e", "mage_e", "farmer_w", "pike_w", "bow_w", "knight_w", "mage_w"]
SHAFT = re.compile(r"(shaft|lance|haft|staff|handle|_pole|arrow|bolt)", re.I)
METAL = re.compile(r"(steel|iron|bronze|blade)", re.I)
BAD_M = 0.01          # worth a report: more than 1 cm of exposed wood, or of gap


def main_outer():
    bad = []
    sys.path.insert(0, str(HERE.parent / "common"))
    import config
    for u in UNITS:
        r = subprocess.run([str(config.BLENDER), "-b", "--factory-startup", "--python", str(HERE / "tips_audit.py"), "--", u],
                           capture_output=True, text=True, env=dict(os.environ, R7_VERSION="8", R9_UNIT="1"))
        lines = [ln[6:] for ln in r.stdout.splitlines() if ln.startswith("TIPS: ")]
        if "Traceback" in r.stdout or "Traceback" in r.stderr:
            print(u, "FAILED", r.stdout[-600:], r.stderr[-300:])
            bad.append(dict(unit=u))
        if not lines:
            print(f"{u:9s} no wooden shaft with a metal head")
            continue
        for ln in lines:
            rec = json.loads(ln)
            flag = ""
            if rec["exposed_m"] > BAD_M:
                flag = "  <- wood shows at the tip"
            elif rec["gap_m"] > BAD_M:
                flag = "  <- head stands off the shaft"
            if flag:
                bad.append(rec)
            print(f'{u:9s} {rec["shaft"]:26s} shaft end {rec["shaft_end"]:7.3f}  metal {rec["metal_near"]:7.3f}..{rec["metal_far"]:7.3f}'
                  f'  exposed {rec["exposed_m"] * 100:5.1f} cm  gap {rec["gap_m"] * 100:5.1f} cm  [{",".join(rec["metal"])}]{flag}')
    print(f"{len(bad)} bad")
    sys.exit(1 if bad else 0)


def main_blender(kind):
    import bpy
    from mathutils import Vector
    for sub in ("production", "round5", "round4", "round3", "round2", "round1"):
        sys.path.insert(0, str(HERE.parents[1] / sub / "blender"))
    sys.path.insert(0, str(HERE.parents[1] / "round2" / "blender"))
    os.environ.setdefault("EMBLEM_DIR", str(HERE.parent / "build" / "emblems"))
    import lib
    lib.QUALITY = "hq"
    lib.reset()
    import units5
    u = units5.build(kind, 0, "WC" if kind == "mage_w" else ("TA" if kind == "mage_e" else None))
    sys.path.insert(0, str(HERE.parents[1] / "r8" / "blender"))
    import r8
    r8.before_extend(u, kind)
    import anims
    u = anims.extend(u, kind, None)
    bpy.context.view_layer.update()
    parts = [o for o in lib.ALL_PARTS if o.type == "MESH" and not o.hide_render and o.data.vertices]
    by_parent = {}
    for o in parts:
        by_parent.setdefault(o.parent, []).append(o)

    def segs(o, to_parent):
        """(z0, r0, z1, r1) of every edge, in the parent's space along its z."""
        vs = [to_parent @ v.co for v in o.data.vertices]
        return [(vs[a], vs[b]) for a, b in (e.vertices for e in o.data.edges)]

    def radius_at(edges, z, axis, c):
        best = 0.0
        for a, b in edges:
            za, zb = a.dot(axis), b.dot(axis)
            if min(za, zb) <= z <= max(za, zb) and abs(zb - za) > 1e-9:
                p = a.lerp(b, (z - za) / (zb - za))
                q = p - axis * z - c
                best = max(best, q.length)
        return best

    for par, kids in by_parent.items():
        for sh in kids:
            if not SHAFT.search(sh.name) or METAL.search(sh.data.materials[0].name if sh.data.materials else ""):
                continue
            vs = [sh.matrix_local @ v.co for v in sh.data.vertices]
            lo = Vector((min(v[i] for v in vs) for i in range(3)))
            hi = Vector((max(v[i] for v in vs) for i in range(3)))
            d = hi - lo
            i = max(range(3), key=lambda k: d[k])
            if d[i] < 0.3:
                continue
            axis = Vector((1.0 if k == i else 0.0 for k in range(3)))
            c = (lo + hi) / 2
            c[i] = 0.0
            metals = []
            for m in kids:
                if m is sh or not m.data.materials or not METAL.search(m.data.materials[0].name or "") and not METAL.search(m.name):
                    continue
                mv = [m.matrix_local @ v.co for v in m.data.vertices]
                if min((v - axis * v.dot(axis) - c).length for v in mv) > 0.08:   # off the shaft's line (a hilt, a buckle)
                    continue
                metals.append((m, segs(m, m.matrix_local), min(v[i] for v in mv), max(v[i] for v in mv)))
            if not metals:
                continue
            # the head's at the shaft's far end from the metal's middle
            mid = sum(a + b for _, _, a, b in metals) / (2 * len(metals))
            sgn = 1.0 if abs(hi[i] - mid) < abs(lo[i] - mid) else -1.0
            end = hi[i] if sgn > 0 else lo[i]
            far = max((b if sgn > 0 else -a) for _, _, a, b in metals) * sgn
            near = min((a if sgn > 0 else -b) for _, _, a, b in metals) * sgn
            se = segs(sh, sh.matrix_local)
            # 5 mm steps over the stretch where the metal is, from its near end to the tip (nothing behind the metal counts):
            # wood showing = the shaft wider than every metal part there; a gap = neither wood nor metal there
            exposed = gap = 0.0
            step = 0.005
            n = int(round(sgn * (far - near) / step))
            for k in range(n):
                t = near + sgn * (k + 0.5) * step
                rs = radius_at(se, t, axis, c)
                rm = max(radius_at(e, t, axis, c) for _, e, _, _ in metals)
                if rs > rm + 1e-4:
                    exposed += step
                elif rs < 1e-5 and rm < 1e-5:
                    gap += step
            print("TIPS: " + json.dumps(dict(shaft=sh.name, shaft_end=round(end, 3), metal_near=round(near, 3), metal_far=round(far, 3),
                                             exposed_m=round(exposed, 3), gap_m=round(gap, 3), metal=[m.name for m, _, _, _ in metals])), flush=True)


if __name__ == "__main__":
    if "--" in sys.argv:
        main_blender(sys.argv[sys.argv.index("--") + 1])
    else:
        main_outer()
