"""Host side: run one Blender job (one model, many frames) and post-process it.

level "0" renders with R1's own code (the R1 baseline); "A" renders R1 models with
the R2 settings; "B"/"C" render the R2 models. ss > 1 renders ss times larger and
downscales (supersampling), writing each requested output scale.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "common"))
import config  # noqa: E402

EMBLEMS = config.BUILD / "emblems"


def run(kind, items, px_per_m, level="A", quality="hq", variant=0, frame_m=None, samples=None, tag="job",
        ss=1, outputs=None, border=None, extra=None):
    """outputs: {suffix: px_per_m} downscaled copies to write, e.g. {"x6": 120, "x3": 60}."""
    from PIL import Image, ImageFilter
    jobdir = config.BUILD / "jobs"
    jobdir.mkdir(parents=True, exist_ok=True)
    render_ppm = px_per_m * ss
    job = dict(kind=kind, variant=variant, px_per_m=render_ppm, emblem_dir=str(EMBLEMS), items=items,
               level=level, quality=quality)
    if frame_m:
        job["frame_m"] = frame_m
    if samples:
        job["samples"] = samples
    if border:
        job["border"] = border
    if extra:
        job.update(extra)
    tag = f"{tag}{(extra or {}).get('mage_style', '')}"
    path = jobdir / f"{tag}_{level}_{kind}_{variant}.json"
    path.write_text(json.dumps(job))
    log = jobdir / f"{tag}_{level}_{kind}_{variant}.log"
    script = (config.ROUND1 / "blender" / "render_units.py") if level == "0" else (HERE / "render_units.py")
    wall = config.blender(script, path, log=log)
    txt = log.read_text()
    if "Traceback" in txt or "Error:" in txt:
        print(txt[-3000:])
        raise SystemExit(f"blender job failed: {log}")
    line = [ln for ln in txt.splitlines() if ln.startswith(("RENDERED", "MAXRSS"))]
    print(f"[{tag}] {level} {kind}: {' | '.join(line)} (wall {wall:.1f}s)", flush=True)
    # downscale into each requested output scale
    for it in items:
        base = Path(it["out"])
        meta = json.loads(Path(str(base) + ".json").read_text())
        for suffix, ppm in (outputs or {"": render_ppm}).items():
            f = ppm / render_ppm
            for p in it["passes"]:
                src = Path(f"{base}_{p}.png")
                im = Image.open(src)
                if border and level == "0":
                    # R1's renderer has no border support: crop the full render here instead
                    x0, y0, x1, y1 = border
                    im = im.crop((round(x0 * im.width), round(y0 * im.height), round(x1 * im.width),
                                  round(y1 * im.height)))
                if f != 1:
                    im = im.resize((max(1, round(im.width * f)), max(1, round(im.height * f))), Image.LANCZOS)
                    if p == "beauty" and quality == "hq":
                        im = im.filter(ImageFilter.UnsharpMask(radius=1.0, percent=40, threshold=2))
                dst = Path(f"{base}{('_' + suffix) if suffix else ''}_{p}.png")
                im.save(dst)
            anc = list(meta["anchor"])
            if border and level == "0":
                anc = [anc[0] - border[0] * meta["size"][0], anc[1] - border[1] * meta["size"][1]]
            m2 = dict(meta, anchor=[anc[0] * f, anc[1] * f], px_per_m=ppm)
            Path(f"{base}{('_' + suffix) if suffix else ''}.json").write_text(json.dumps(m2))
        if outputs:     # drop the full-size render once the scaled copies exist
            for p in it["passes"]:
                Path(f"{base}_{p}.png").unlink(missing_ok=True)
    return wall
