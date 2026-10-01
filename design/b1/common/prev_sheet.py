"""Quick look at renders: each piece on the ground with its cell grid (footprint in yellow).

python3 common/prev_sheet.py <target> [prev|x3] [scale]  -> build/b1/<target>/sheet_<suffix>.png
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import config  # noqa: E402
import proj    # noqa: E402

GROUND = (118, 128, 104)


def tile(meta_p, beauty_p, scale=1.0):
    meta = json.loads(meta_p.read_text())
    im = Image.open(beauty_p).convert("RGBA")
    ppm, anc = meta["px_per_m"], meta["anchor"]
    pad = 40
    can = Image.new("RGBA", (im.width + 2 * pad, im.height + 2 * pad), (*GROUND, 255))
    dr = ImageDraw.Draw(can)
    fx, fy = meta["footprint"]
    a = (anc[0] + pad, anc[1] + pad)
    for (p0, p1) in proj.grid_lines(fx, fy, meta["cell_m"], extra=1):
        dr.line([proj.to_px(p0, a, ppm), proj.to_px(p1, a, ppm)], fill=(95, 105, 84), width=1)
    hx, hy = fx * meta["cell_m"] / 2, fy * meta["cell_m"] / 2
    poly = [proj.to_px(p, a, ppm) for p in ((-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy))]
    dr.polygon(poly, outline=(240, 210, 80))
    can.alpha_composite(im, (pad, pad))
    dr = ImageDraw.Draw(can)
    pr = meta.get("probe")
    label = f"{meta['kind']} {meta['culture']} {meta['state']}  top {meta['top_m']} m"
    if pr:
        b = pr["by_cells"]
        label += f"  1格露{b['1']['worst']}m 2格露{b['2']['worst']}m 上半身起{pr['upper_half_from_cells']}格"
    dr.text((4, 4), label, fill=(255, 255, 255))
    if scale != 1:
        can = can.resize((round(can.width * scale), round(can.height * scale)), Image.LANCZOS)
    return can


def sheet(target, suffix="prev", scale=1.0):
    d = config.BUILD / "b1" / target
    tiles = [tile(m, Path(str(m)[:-5] + "_beauty.png"), scale) for m in sorted(d.glob(f"*_{suffix}.json"))]
    W = sum(t.width for t in tiles) + 6 * len(tiles)
    H = max(t.height for t in tiles)
    out = Image.new("RGB", (W, H), (40, 40, 40))
    x = 0
    for t in tiles:
        out.paste(t.convert("RGB"), (x, H - t.height))
        x += t.width + 6
    p = d / f"sheet_{suffix}.png"
    out.save(p)
    print(p, out.size)


if __name__ == "__main__":
    sheet(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "prev", float(sys.argv[3]) if len(sys.argv) > 3 else 1.0)
