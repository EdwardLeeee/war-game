"""Download B1 render artifacts of a CI run into build/b1/<folder>/.

python3 common/fetch_b1.py <run_id> [target ...]      (default: every b1-* artifact of the run)
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import config  # noqa: E402


def artifacts(run):
    r = subprocess.run(["gh", "api", f"repos/EdwardLeeee/war-game/actions/runs/{run}/artifacts", "-q",
                        ".artifacts[].name"], capture_output=True, text=True, check=True)
    return [n for n in r.stdout.split() if n.startswith("b1-")]


def fetch(run, targets=None):
    names = [f"b1-{t}" for t in targets] if targets else artifacts(run)
    tmp = config.BUILD / "dl"
    for n in names:
        d = tmp / n
        shutil.rmtree(d, ignore_errors=True)
        r = subprocess.run(["gh", "run", "download", str(run), "-n", n, "-D", str(d)])
        if r.returncode:
            print(n, "not found")
            continue
        moved = 0
        for f in d.rglob("*_x3*"):
            folder = f.parent.name
            dst = config.BUILD / "b1" / folder
            dst.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, dst / f.name)
            moved += 1
        print(n, moved, "files")


if __name__ == "__main__":
    fetch(sys.argv[1], sys.argv[2:] or None)
