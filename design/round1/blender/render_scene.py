"""Host side: render every sprite the battle scene needs (B and C share them).

python3 blender/render_scene.py            -> build/3d/sprites/<key>_<pass>.png + <key>.json
Each Blender process builds one model and renders all of its frames, one
process at a time under the memory cap.
"""
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "common"))
sys.path.insert(0, str(HERE))
import batch   # noqa: E402
import config  # noqa: E402
import scene   # noqa: E402

OUT = config.BUILD / "3d" / "sprites"
PPM = config.PT_PER_M * config.SCALE        # 60 px per metre at 3x
UNIT_PASSES = ["beauty", "mask", "albedo", "light", "shadow"]


def key(kind, facing, anim, frame, variant):
    return f"{kind}_v{variant}_f{facing}_{anim}{frame}"


def main(only=None):
    OUT.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    groups = {}
    for kind, facing, anim, frame, variant in scene.needed_sprites():
        groups.setdefault((kind, variant), []).append((facing, anim, frame))
    for (kind, variant), items in sorted(groups.items()):
        if only and kind not in only:
            continue
        jobs = []
        for facing, anim, frame in items:
            passes = list(UNIT_PASSES)
            if kind == "mage_e":
                passes.append("fx")
            jobs.append(dict(facing=facing, anim=anim, frame=frame, passes=passes,
                             out=str(OUT / key(kind, facing, anim, frame, variant))))
        batch.run(kind, jobs, PPM, variant=variant, tag="scene")
    props = [("citygate_e", 0), ("town_e", 0), ("tower_w", 0), ("goldmine", 0), ("tree", 0), ("tree", 1),
             ("tree", 2), ("rock", 0), ("tuft", 0)]
    for kind, variant in props:
        if only and kind not in only:
            continue
        big = kind in ("citygate_e", "town_e")
        # big buildings: one Blender process per pass so memory stays well under the cap
        for passes in ([[p] for p in UNIT_PASSES] if big else [UNIT_PASSES]):
            batch.run(kind, [dict(facing=0, anim="idle", frame=0, passes=passes,
                                  out=str(OUT / key(kind, 0, "idle", 0, variant)))], PPM, variant=variant,
                      tag="scene")
    print(f"scene sprites done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main(set(sys.argv[1:]) or None)
