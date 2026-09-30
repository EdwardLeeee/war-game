"""Download the design-render artifacts of one CI run into build/r5/.

python3 common/fetch_ci.py <run_id> [target ...]
-> build/r5/<target>/... (renders) and build/r5/logs-<target>/... (Blender job logs)
"""
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import config  # noqa: E402

run = sys.argv[1]
targets = sys.argv[2:] or ["mageWA", "mageWB", "mageWC", "compare"]
R5 = config.BUILD / "r5"
for t in targets:
    dl = R5 / f"dl-{t}"
    shutil.rmtree(dl, ignore_errors=True)
    r = subprocess.run(["gh", "run", "download", run, "-n", f"round5-{t}", "-D", str(dl)])
    if r.returncode != 0:
        print("no artifact for target", t)
        continue
    src = next(dl.rglob(f"r5/{t}"), None)
    if src:
        dst = R5 / t
        shutil.rmtree(dst, ignore_errors=True)
        shutil.move(str(src), str(dst))
    logs = R5 / f"logs-{t}"
    shutil.rmtree(logs, ignore_errors=True)
    logs.mkdir(parents=True)
    for p in dl.rglob("*.log"):
        shutil.move(str(p), str(logs / p.name))
    shutil.rmtree(dl, ignore_errors=True)
    n = len(list((R5 / t).glob("*.png"))) if (R5 / t).exists() else 0
    print(f"target {t}: {n} png")
