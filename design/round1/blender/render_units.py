"""Blender entry point: build one unit and render the requested frames/passes.

blender -b -t 2 --factory-startup --python render_units.py -- job.json

job.json = {
  "kind": "spear_e", "variant": 0, "px_per_m": 60, "emblem_dir": "...",
  "frame_m": [w, h, ax, ay]            (optional override of units.FRAME_M)
  "items": [{"facing": 0, "anim": "attack", "frame": 3,
             "passes": ["beauty", "mask", "shadow"], "out": "/path/prefix"}]
}
Writes <out>_<pass>.png for each pass, plus <out>.json with the anchor.
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

args = sys.argv[sys.argv.index("--") + 1:]
job = json.load(open(args[0]))
os.environ["EMBLEM_DIR"] = job.get("emblem_dir", "")

import lib      # noqa: E402
import units    # noqa: E402

lib.reset()
lib.make_lights()
lib.ground()
u = units.build(job["kind"], job.get("variant", 0))
w_m, h_m, ax, ay = job.get("frame_m") or units.frame_m(job["kind"])
ppm = job["px_per_m"]
W, H = int(round(w_m * ppm)), int(round(h_m * ppm))
anchor = (W * ax, H * ay)
cam = lib.Camera(W, H, ppm, anchor)

import bpy                       # noqa: E402
from mathutils import Vector     # noqa: E402

# weapons, banners and effects do not count toward the body height
EXCL = ("bpole", "bflag", "shaft", "_tip", "lance", "spear_e_tassel", "haft", "_axe", "pick", "xbow_e_stock", "xbow_e_prod", "xbow_e_str",
        "bow_w_limb", "bow_w_string", "vamplate", "_shield", "fx_", "_flag", "_pole", "_finial")


def body_top():
    bpy.context.view_layer.update()
    z = 0.0
    for ob in lib.ALL_PARTS:
        if any(t in ob.name for t in EXCL):
            continue
        for c in ob.bound_box:
            z = max(z, (ob.matrix_world @ Vector(c)).z)
    return z


t0 = time.time()
n = 0
for it in job["items"]:
    u.face(it["facing"])
    u.pose(it["anim"], it["frame"])
    top = body_top()
    for p in it["passes"]:
        if p == "shadow":
            # shadows fall to the lower right: widen the frame there; render at half size
            # (soft shadows, far less memory), compose scales it back up
            cam.set((W + int(0.45 * h_m * ppm)) // 2, (H + int(0.25 * h_m * ppm)) // 2, ppm / 2,
                    (anchor[0] / 2, anchor[1] / 2))
        lib.set_pass(p, job.get("samples", {}).get(p))
        lib.render(f"{it['out']}_{p}.png")
        if p == "shadow":
            cam.set(W, H, ppm, anchor)
        n += 1
    with open(it["out"] + ".json", "w") as f:
        json.dump({"anchor": anchor, "size": [W, H], "px_per_m": ppm, "kind": job["kind"], "body_top_m": top,
                   "facing": it["facing"], "anim": it["anim"], "frame": it["frame"]}, f)
print(f"RENDERED {n} images in {time.time() - t0:.1f}s ({(time.time() - t0) / max(1, n):.2f}s each)")
