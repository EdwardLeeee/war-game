"""R19: does a walking unit's foot slide? Facing right, a frame's pixels near the ground (the lowest `band` px of
the body) as runs along x, moved on by the game's step a frame: a foot on the ground should keep its place.

python3 design/r19/common/feet_r19.py ART_X3 unit [band]
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import art_r19 as A   # noqa: E402


def main():
    art, unit = Path(sys.argv[1]), sys.argv[2]
    band = int(sys.argv[3]) if len(sys.argv) > 3 else 5
    u = A.Unit(art, unit)
    info = u.anims["walk"]
    n = info["frames"]
    step = info["stride_m"] * 60 / n if info.get("stride_m") else 120 / info["fps"]
    print(f"{unit}: {n} frames, {step:.1f} px a frame, {step * n:.0f} px a cycle ({step * n / 60:.2f} m)")
    for k in range(n):
        (im, ax, ay), _ = u.sprite("walk", 0, k)
        a = np.asarray(im.getchannel("A")) > 128
        ys, xs = np.nonzero(a)
        low = ys.max()
        out = []
        for y0 in (low,):
            cols = np.nonzero(a[y0 - band + 1:y0 + 1].any(0))[0]
            runs = np.split(cols, np.nonzero(np.diff(cols) > 2)[0] + 1)
            for r in runs:
                rows = np.nonzero(a[:, r[0]:r[-1] + 1].any(1))[0]
                out.append(f"x {r[0] - ax:+.0f}..{r[-1] - ax:+.0f} (world {r[0] - ax + step * k:+.0f}..{r[-1] - ax + step * k:+.0f})")
        # each foot by itself: the lowest pixel of the left and right halves of the legs
        print(f"  frame {k + 1}: lowest y {low - ay:+.0f} | " + " ; ".join(out))


if __name__ == "__main__":
    main()
