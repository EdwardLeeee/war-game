"""R8 batch 2: bake the ground's five layers (blender/ground_bake.py) and put the set together (ground_r8.py).

python3 design/r8/common/ground_run.py OUT_DIR [--ppm 60] [--samples 64]
The layers: which CC0 texture each one starts from (design/r7/common/textures.py), its tile (metres) and the colour it
is recoloured to (linear; the photo's own light and dark kept, `contrast` of them). The colours keep the ground darker
and less saturated than the units (R8: 找得到兵), the grass green, the dry grass olive.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
R8 = HERE.parent
sys.path.insert(0, str(R8.parent / "r7" / "common"))
import textures   # noqa: E402

LAYERS = [
    dict(id="grass", tex="leafy_grass", tile_m=2.0, tint=(0.075, 0.12, 0.035), contrast=0.85),
    dict(id="grass_dry", tex="aerial_grass_rock", tile_m=8.0, tint=(0.14, 0.13, 0.06), contrast=0.8),
    dict(id="dirt", tex="stony_dirt_path", tile_m=2.17, tint=(0.16, 0.115, 0.07), contrast=0.85),
    dict(id="gravel", tex="rocks_ground_02", tile_m=2.0, tint=(0.11, 0.1, 0.085), contrast=0.95, hue=0.1),
    dict(id="bank", tex="brown_mud_rocks_01", tile_m=1.3, tint=(0.12, 0.1, 0.075), contrast=0.85),
]


def mean_lum(path):
    a = np.asarray(Image.open(path).convert("RGB").resize((256, 256)), np.float32) / 255.0
    lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    return float((lin * np.array([0.2126, 0.7152, 0.0722])).sum(-1).mean())


def main(out, ppm, samples):
    out = Path(out)
    baked = out / "baked"
    baked.mkdir(parents=True, exist_ok=True)
    layers = []
    for L in LAYERS:
        d = dict(L)
        d["mean_lum"] = mean_lum(textures.path(L["tex"], "diff"))
        layers.append(d)
    job = dict(tex_dir=str(textures.DIR), out=str(baked), ppm=ppm, samples=samples, layers=layers)
    jp = baked / "job.json"
    jp.write_text(json.dumps(job))
    blender = Path.home() / ".local/opt/blender-5.2.2/blender"
    r = subprocess.run([str(blender), "-b", "-t", "2", "--factory-startup", "--python", str(R8 / "blender" / "ground_bake.py"),
                        "--", str(jp)], capture_output=True, text=True)
    if r.returncode != 0 or "Traceback" in r.stdout + r.stderr:
        print((r.stdout + r.stderr)[-3000:])
        raise SystemExit("bake failed")
    (baked / "spec.json").write_text(json.dumps([[L["id"], L["tile_m"]] for L in LAYERS]))
    subprocess.run([sys.executable, str(HERE / "ground_r8.py"), str(baked), str(out)], check=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--ppm", type=int, default=60)
    ap.add_argument("--samples", type=int, default=64)
    a = ap.parse_args()
    main(a.out, a.ppm, a.samples)
