"""R21 draft renders (D-142: R19's findings; this batch the siege engines): chosen frames of a unit at
x3 with the production rig and look (R8 + R9 units: R7_VERSION 8, R9_UNIT), for the boards (boards_r21.py). As
design/r20/common/render_r20.py, for any unit.

python3 design/r21/common/render_r21.py TARGET OUTDIR TAG ANIM:FRAMES[:FACINGS] ...   e.g. walk:0-7:7,0 idle:0:7
  FRAMES all, a-b or a,b,c; FACINGS default 7. Env: R21_W (A wheels, B rollers under the West's trebuchet), R21_E (A
  the East's ropes follow the arm; B, C held by two or four pullers), R21_RESUME=1 (skip frames already there), R21_FRAME=w,h,ax,ay (metres and the anchor's fractions: a wreck is wider than spec's frame),
  R21_SS (supersampling), R21_SAMPLES (beauty samples). Needs the CC0 textures (design/r7/common/textures.py fetch)
  and MPFB in the local Blender, as the r7 CI round."""
import os
import sys
from pathlib import Path

PROD = Path(__file__).resolve().parents[2] / "production"
os.environ.setdefault("R7_VERSION", "8")
os.environ.setdefault("R9_UNIT", "1")
os.environ.setdefault("R7_TEX", str(PROD.parent / "r7" / "build" / "tex"))
sys.path.insert(0, str(PROD / "common"))
sys.path.insert(0, str(PROD / "blender"))
import batch   # noqa: E402
import config  # noqa: E402
import spec    # noqa: E402

target, out, tag = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
out.mkdir(parents=True, exist_ok=True)
u = spec.UNITS[target]
items = []
for arg in sys.argv[4:]:
    parts = arg.split(":")
    anim, fr = parts[0], parts[1]
    fac = [int(x) for x in parts[2].split(",")] if len(parts) > 2 else [7]
    n = dict((a, n) for a, n, _, _ in u["anims"])[anim]
    frames = range(n) if fr == "all" else (range(int(fr.split("-")[0]), int(fr.split("-")[1]) + 1) if "-" in fr else [int(x) for x in fr.split(",")])
    for f in fac:
        for i in frames:
            name = out / f"{tag}_{anim}_f{f}_{i:02d}"
            if os.environ.get("R21_RESUME") and Path(f"{name}_x3_shadow.png").exists():      # the last pass written
                continue
            items.append(dict(facing=f, anim=anim, frame=i, n=n, passes=["beauty", "mask", "shadow"], out=str(name)))
# (the production run grows the frame to the unit's reach first, render_prod.fit_frame; a draft takes spec's, or R21_FRAME)
FRAME = [float(v) for v in os.environ["R21_FRAME"].split(",")] if os.environ.get("R21_FRAME") else u["frame"]
extra = dict(shadow_extra=list(spec.SHADOW_EXTRA), new_anims=True)
if items:
    batch.run(u["kind"], items, spec.PX_PER_M, level="C", frame_m=FRAME, tag=f"r21{tag}", outputs={"x3": spec.PX_PER_M}, ss=int(os.environ.get("R21_SS", "1")),
              samples={"beauty": int(os.environ.get("R21_SAMPLES", "24")), "shadow": 8, "ao": 6, "mask": 4}, variant=u.get("variant", 0),
              extra=extra)
print("done", len(items))
