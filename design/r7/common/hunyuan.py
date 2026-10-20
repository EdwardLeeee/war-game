"""R7 (D-092) version 3, a test only (ceo 2026-10-20): our own concept picture (render_r7.py concept) to a textured
3D model with Tencent Hunyuan3D 2.1's public Hugging Face Space, without an account (the 2.0 Space's generation
failed on its side, NameError, 2026-10-20). Not for production: the model's licence does not apply in the EU, the UK
and South Korea and using its outputs there is not licensed, and products over 1 million monthly users need Tencent's
permission (2.1 LICENSE sections 1(l), 4, 5(c); Tencent claims no rights in outputs, 6(d)). Its outputs are not put
in any public release.

python design/r7/common/hunyuan.py CONCEPT.png OUT_DIR [seed]     (gradio_client needed: Blender's python + --target)
  writes OUT_DIR/<name>_shape.glb, <name>_textured.glb, <name>_stats.json
"""
import json
import shutil
import sys
import time
from pathlib import Path

from gradio_client import Client, handle_file
from PIL import Image

SPACE = "tencent/Hunyuan3D-2.1"


def run(concept, out, seed=1234):
    concept, out = Path(concept), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    name = concept.stem.replace("concept_", "")
    im = Image.open(concept).convert("RGBA")
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
    bg.alpha_composite(im)
    white = out / f"{name}_input.png"
    bg.convert("RGB").save(white)
    c = Client(SPACE, verbose=False)
    t0 = time.time()
    res = c.predict(image=handle_file(str(white)), mv_image_front=None, mv_image_back=None,
                    mv_image_left=None, mv_image_right=None, steps=30, guidance_scale=5.0, seed=seed,
                    octree_resolution=256, check_box_rembg=True, num_chunks=8000, randomize_seed=False,
                    api_name="/generation_all")
    shape, textured, _html, stats, used_seed = res
    shutil.copy(shape, out / f"{name}_shape.glb")
    shutil.copy(textured, out / f"{name}_textured.glb")
    (out / f"{name}_stats.json").write_text(json.dumps(dict(stats=stats, seed=used_seed, space=SPACE,
                                                            seconds=round(time.time() - t0, 1)), indent=1))
    print(name, "done in", round(time.time() - t0), "s", stats)


if __name__ == "__main__":
    run(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 1234)
