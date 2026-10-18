"""R6 B.2: everything the mock pages read, into design/r6/build/ (git-ignored).

python3 common/build.py ART_DIR     ART_DIR: an extracted art-v2-x3.tar.gz (units/, buildings/, nodes/)
-> build/field-<a|b|c>.png   the battlefield at 3 px a pt, with the theme's selection ring
   build/overlay.js          the selected squad's screen points (for the health bars)
   build/minimap-square.png, build/minimap-diamond.png
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import field      # noqa: E402
import minimap    # noqa: E402
import scene_r6   # noqa: E402

OUT = HERE.parent / "build"
RING = {"a": ((240, 207, 138, 235), 1.4), "b": ((222, 190, 104, 235), 1.2), "c": ((250, 242, 220, 235), 1.4)}

if __name__ == "__main__":
    art = Path(sys.argv[1])
    OUT.mkdir(exist_ok=True)
    sc = scene_r6.representative()
    ov = None
    for t, ring in RING.items():
        img, ov = field.render(dict(sc, ring=ring), art)
        img.convert("RGB").save(OUT / f"field-{t}.png")
    sel = [dict(x=round(u["x"], 1), top=round(u["top"], 1), hp=hp) for u, hp in zip(ov["selected"], (100, 100, 85, 100, 60, 100, 100, 92, 100, 100))]
    (OUT / "overlay.js").write_text("window.R6_OVERLAY = " + json.dumps({"selected": sel}) + ";\n")
    minimap.square(312, sc).save(OUT / "minimap-square.png")
    minimap.diamond(504, sc).save(OUT / "minimap-diamond.png")
    for mode in ("start", "hit", "hint"):
        minimap.diamond(504, sc, mode=mode).save(OUT / f"minimap-diamond-{mode}.png")
        minimap.square(312, sc, mode=mode).save(OUT / f"minimap-square-{mode}.png")
    # the battlefield without the selection rings, and home under a raid (R6-13)
    for t in RING:
        img, _ = field.render(sc, art)
        img.convert("RGB").save(OUT / f"field-{t}-plain.png")
    one = dict(sc, units=[u if i == 0 else (*u[:7], False) for i, u in enumerate(sc["units"])])   # one spearman selected
    for t, ring in RING.items():
        img, _ = field.render(dict(one, ring=ring), art)
        img.convert("RGB").save(OUT / f"field-{t}-one.png")
    img, _ = field.render(scene_r6.raid(), art)
    for t in RING:
        img.convert("RGB").save(OUT / f"field-{t}-raid.png")
    import world        # noqa: E402  R6-23: the world interface
    world.build(art, OUT, {t: r for t, r in RING.items() if t in ("a", "b")})
    print("wrote", sorted(p.name for p in OUT.iterdir()))
