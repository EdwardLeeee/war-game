"""Render some pieces of a design/b1/common/run.py target on their own (one Blender process, under the memory cap):
python3 design/r9/common/one_piece.py TARGET NAME... [--preview]   (env SS overrides the supersampling).
Copies every per-target setting (CAMERA, FOLDER, LOOK) to the stand-in target, so the look is the target's."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "b1" / "common"))
import run   # noqa: E402

args = [a for a in sys.argv[1:] if not a.startswith("--")]
target, names = args[0], set(args[1:])
pcs = [pc for pc in run.TARGETS[target] if run.piece_name(pc) in names]
missing = names - {run.piece_name(pc) for pc in pcs}
assert not missing, missing
run.TARGETS["one"] = pcs
for table in (run.CAMERA, run.FOLDER, run.LOOK):
    if target in table:
        table["one"] = table[target]
if "SS" in os.environ:
    run.SS = int(os.environ["SS"])
run.run("one", preview="--preview" in sys.argv)
