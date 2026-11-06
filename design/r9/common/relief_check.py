"""art-v7.4: is the relief the same on every machine? relief_tile as it is, and again with every FFT result nudged by a
relative 1e-15 (what another CPU's or numpy's last bit does); the two must be the same bytes. Before QUANT (ground_r9.py)
they were not: max 255, mean 3.05 of 255, the size of the difference between two CI runs.

python3 design/r9/common/relief_check.py      -> the two sha256s and "same" or a non-zero exit
"""
import hashlib
import io
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ground_r9 as R    # noqa: E402


def tile_bytes():
    t, _ = R.relief_tile(ppm=60, sun=R.SUN_D)
    buf = io.BytesIO()
    a = np.stack([np.clip(t[..., 0] / 2.0, 0, 1), t[..., 1], t[..., 2]], -1)
    from PIL import Image
    Image.fromarray((a * 255).round().astype(np.uint8), "RGB").save(buf, "PNG")
    return buf.getvalue()


def main():
    plain = hashlib.sha256(tile_bytes()).hexdigest()
    rng = np.random.default_rng(99)
    real = np.fft.ifft2
    np.fft.ifft2 = lambda a, *k, **kw: (lambda r: r * (1 + 1e-15 * rng.standard_normal(r.shape)))(real(a, *k, **kw))
    try:
        nudged = hashlib.sha256(tile_bytes()).hexdigest()
    finally:
        np.fft.ifft2 = real
    print("plain ", plain)
    print("nudged", nudged)
    if plain != nudged:
        sys.exit("the relief depends on the last bits: not the same on every machine")
    print("same")


if __name__ == "__main__":
    main()
