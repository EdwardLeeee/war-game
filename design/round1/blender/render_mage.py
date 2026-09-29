"""Host side: the 術士 animation (one direction), 8-direction key poses, portrait.

python3 blender/render_mage.py [anim|dirs|portrait ...]
Output: build/3d/mage/{anim,dirs,portrait}/...  (4x = 80 px per metre)
"""
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "common"))
sys.path.insert(0, str(HERE))
import batch   # noqa: E402
import config  # noqa: E402

OUT = config.BUILD / "3d" / "mage"
PASSES = ["beauty", "mask", "albedo", "light", "shadow", "fx"]
MAGE_FRAMES = [("idle", 12), ("walk", 12), ("cast", 30), ("hit", 6), ("shatter", 8), ("fall", 12), ("dead", 4)]
KEY_POSES = [("idle", 3), ("walk", 3), ("cast", 20), ("dead", 0)]
PPM = 80


def main(parts):
    t0 = time.time()
    if "anim" in parts:
        items = []
        for anim, n in MAGE_FRAMES:
            for f in range(n):
                items.append(dict(facing=0, anim=anim, frame=f, passes=PASSES,
                                  out=str(OUT / "anim" / f"{anim}_{f:02d}")))
        (OUT / "anim").mkdir(parents=True, exist_ok=True)
        batch.run("mage_e", items, PPM, frame_m=[4.4, 3.4, 0.36, 0.76], tag="mage_anim")
    if "dirs" in parts:
        items = []
        for facing in range(8):
            for anim, f in KEY_POSES:
                items.append(dict(facing=facing, anim=anim, frame=f, passes=PASSES,
                                  out=str(OUT / "dirs" / f"f{facing}_{anim}{f:02d}")))
        (OUT / "dirs").mkdir(parents=True, exist_ok=True)
        batch.run("mage_e", items, PPM, frame_m=[3.4, 3.2, 0.5, 0.74], tag="mage_dirs")
    if "portrait" in parts:
        (OUT / "portrait").mkdir(parents=True, exist_ok=True)
        batch.run("mage_e", [dict(facing=7, anim="idle", frame=3, passes=["beauty", "mask", "albedo", "light"],
                                  out=str(OUT / "portrait" / "mage"))], 130,
                  frame_m=[1.5, 1.5, 0.5, 1.3], tag="mage_portrait")
    print(f"mage renders done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    args = sys.argv[1:]
    if "--passes" in args:            # e.g. --passes fx : re-render only these layers
        i = args.index("--passes")
        PASSES[:] = args[i + 1].split(",")
        args = args[:i] + args[i + 2:]
    main(set(args) or {"anim", "dirs", "portrait"})
