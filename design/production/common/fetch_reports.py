"""Download the small per-unit report artifacts of one production run into build/reports/.

python3 common/fetch_reports.py <run_id> [unit ...]
(The large production-<unit> artifacts with the 3x renders and atlases stay on GitHub for 90 days;
download one with: gh run download <run_id> -n production-<unit> -D build/prod/<unit>)
"""
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import config  # noqa: E402
import spec    # noqa: E402

run = sys.argv[1]
for t in sys.argv[2:] or list(spec.UNITS):
    d = config.BUILD / "reports" / t
    shutil.rmtree(d, ignore_errors=True)
    r = subprocess.run(["gh", "run", "download", run, "-n", f"production-{t}-report", "-D", str(d)])
    print(t, "ok" if r.returncode == 0 else "no report")
