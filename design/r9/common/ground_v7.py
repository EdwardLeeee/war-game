"""art-v7's additions to ground/ (D-118, design/r11/edge-format.md section 3): what the client's ground shader needs to draw R9's ground
and water on the diamond camera, next to the art-v6 layers (they stay, the same files):

- relief.png   the tileable relief map, lit by the diamond camera's sun (ground_r9.relief_tile): R = light / 2, G = rills, B = crowns.
- ripple.png   the water's tileable ripple field: R = height, G, B = its slope along x and y, each stored as 0.5 + v / (2 * scale).
- ground.json  gets "relief", "ripple" and "water" (ground_r9.R9's names, "version": "r9"; a later water changes the version, not the keys).
- memory.json  counts them.

python3 design/r9/common/ground_v7.py GROUND_DIR SCALE      (a folder ground_r8.py export wrote; SCALE 3 or 2)
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import ground_r9 as R    # noqa: E402

RIPPLE_PX = 256
HEIGHT_SCALE = 3.0        # the height is in standard deviations; +-3 keeps all but the rare crest


def lists(v):
    return [round(float(x), 5) for x in v] if isinstance(v, (tuple, list, np.ndarray)) else v


def ripple(d):
    rt = R._ripple_tex(RIPPLE_PX)
    slope = float(np.percentile(np.abs(rt[..., 1:]), 99.9))
    enc = np.stack([rt[..., 0] / HEIGHT_SCALE, rt[..., 1] / slope, rt[..., 2] / slope], -1)
    Image.fromarray(((np.clip(enc, -1, 1) * 0.5 + 0.5) * 255).round().astype(np.uint8), "RGB").save(d / "ripple.png", optimize=True)
    return {"file": "ripple.png", "px": RIPPLE_PX, "tile_m": R.RIP_M, "height_scale": HEIGHT_SCALE, "slope_scale": round(slope, 3),
            "channels": "R height (standard deviations), G dh/dx, B dh/dy (per metre); each 0.5 + v / (2 * scale)"}


def main(d, scale):
    ppm = 20 * scale
    tile, _ = R.relief_tile(ppm=ppm, sun=R.SUN_D)
    R.save_tile(tile, d / "relief.png")
    import hashlib                                   # art-v7.4: the same on every machine (ground_r9.QUANT); the log shows it
    print(f"relief x{scale} sha256 {hashlib.sha256((d / 'relief.png').read_bytes()).hexdigest()}")
    size = tile.shape[0]
    gj = json.loads((d / "ground.json").read_text())
    gj["relief"] = {"file": "relief.png", "px": size, "tile_m": R.TILE_M, "channels": "R light / 2, G rills, B crowns",
                    # the shader samples it twice and mixes them (ground_r9.tsample): no repeat on the screen
                    "second": {"turn": [[0.8, 0.6], [-0.6, 0.8]], "move_m": [23.7, 9.1], "mix_noise_m": 40.0, "mix": [0.25, 0.75]}}
    gj["ripple"] = ripple(d)
    # art-v7.4 (client 2026-11-06: pale dirt blotches with dark specks on the grass at 0.8): the approved R9/R11 boards
    # drew the ground with no dirt blotches (scene_r9.ground_layers: noise_threshold 0.99), so the game draws it so too
    gj["rules"]["dirt"]["noise_threshold"] = 0.99
    gj["water"] = {"version": "r9", **{k: lists(v) for k, v in R.R9.items()},
                   "sun": lists(R.SUN_D), "view": lists(R.VIEW_D), "sun_rgb": lists(R.SUN_RGB)}
    (d / "ground.json").write_text(json.dumps(gj, indent=1, ensure_ascii=False))
    px = sum(np.prod(Image.open(d / n).size) for n in ("relief.png", "ripple.png"))
    mem = json.loads((d / "memory.json").read_text())
    mem["total_rgba8_bytes"] += int(px * 4 * 4 / 3)            # mipmaps a third more, as ground_r8.export
    mem["total_astc_4x4_bytes"] += int(px * 4 / 3)
    mem["relief_px"], mem["ripple_px"] = size, RIPPLE_PX
    (d / "memory.json").write_text(json.dumps(mem, indent=1))
    print(f"ground x{scale}: relief {size}, ripple {RIPPLE_PX}, {mem['total_rgba8_bytes'] / 2 ** 20:.2f} MB RGBA8")


if __name__ == "__main__":
    main(Path(sys.argv[1]), int(sys.argv[2]))
