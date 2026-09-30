"""Download the design-render artifacts of one CI run into build/r2/.

python3 common/fetch_ci.py <run_id>
-> build/r2/<level>/... (renders) and build/r2/logs-<level>/... (Blender job logs)
"""
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import config  # noqa: E402

run = sys.argv[1]
R2 = config.BUILD / "r2"
for level in ("0", "A", "B", "C"):
    dl = R2 / f"dl-{level}"
    shutil.rmtree(dl, ignore_errors=True)
    r = subprocess.run(["gh", "run", "download", run, "-n", f"r2-{level}", "-D", str(dl)])
    if r.returncode != 0:
        print("no artifact for level", level)
        continue
    src = next(dl.rglob(f"r2/{level}"), None)
    if src:
        dst = R2 / level
        shutil.rmtree(dst, ignore_errors=True)
        shutil.move(str(src), str(dst))
    logs = R2 / f"logs-{level}"
    shutil.rmtree(logs, ignore_errors=True)
    logs.mkdir(parents=True)
    for p in dl.rglob("*.log"):
        shutil.move(str(p), str(logs / p.name))
    shutil.rmtree(dl, ignore_errors=True)
    n = len(list((R2 / level).glob("*.png"))) if (R2 / level).exists() else 0
    print(f"level {level}: {n} png")
