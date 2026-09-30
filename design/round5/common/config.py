"""Shared constants, paths and the memory-capped runner for round 1.

Every heavy tool (Blender, headless Chrome) goes through `capped()`, which
wraps the command in a systemd scope with a hard memory limit and refuses to
start while the machine is short of memory (see README, "記憶體規則").
"""
import os
import subprocess
import sys
import time
from pathlib import Path

ROUND = Path(__file__).resolve().parents[1]          # design/round1
BUILD = ROUND / "build"                              # intermediate, git-ignored
OUT = ROUND / "out"                                  # final labelled images

BLENDER = Path(os.environ.get("BLENDER", Path.home() / ".local/opt/blender-5.2.2/blender"))
ROUND1 = ROUND.parent / "round1"
CHROME = "google-chrome"

# iPhone 14 Pro Max, landscape. Source: useyourloaf.com/blog/iphone-14-screen-sizes
# (portrait 430x932 pt @3x; landscape safe-area insets top 0, bottom 21,
# left 59, right 59). Dynamic island is drawn on the left edge. 待實機確認.
SCREEN_W, SCREEN_H = 932, 430
SCALE = 3
SAFE = dict(left=59, right=59, top=0, bottom=21)
CORNER_RADIUS = 55          # pt, display corner radius (approximate)
ISLAND = dict(w=37, h=126, inset=11)   # pt, pill rotated to the left edge

# Art scale shared by every pipeline: 20 pt per metre on the ground plane,
# camera 30 degrees above the horizon (2:1 ground diamonds).
PT_PER_M = 20
CAM_ELEVATION_DEG = 30

TEAM = {
    "blue": (46, 110, 214),    # 我方 南溟
    "red": (200, 48, 44),      # 敵方 布倫莫爾
}

MEM_MAX = "1500M"
MIN_AVAILABLE_MB = 2000


def available_mb():
    with open("/proc/meminfo") as f:
        for line in f:
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) // 1024
    return 0


ON_CI = os.environ.get("GITHUB_ACTIONS") == "true"
THREADS = str(os.cpu_count() or 2) if ON_CI else "2"


def capped(cmd, log=None, wait_s=600):
    """Run cmd inside a memory-capped scope; wait while memory is short.
    On GitHub Actions the runner is ours alone: run directly with all cores."""
    if ON_CI:
        t = time.time()
        with open(log, "w") if log else open(os.devnull, "w") as fh:
            r = subprocess.run([str(c) for c in cmd], stdout=fh, stderr=subprocess.STDOUT)
        if r.returncode != 0:
            sys.exit(f"command failed ({r.returncode}); see {log}")
        return time.time() - t
    waited = 0
    while available_mb() < MIN_AVAILABLE_MB:
        if waited >= wait_s:
            sys.exit(f"memory stays below {MIN_AVAILABLE_MB} MB available; stopping (report to ceo)")
        print(f"[capped] available {available_mb()} MB < {MIN_AVAILABLE_MB}, waiting...", flush=True)
        time.sleep(30)
        waited += 30
    full = ["systemd-run", "--user", "--scope", "-q", "-p", f"MemoryMax={MEM_MAX}",
            "-p", "MemorySwapMax=0", "/usr/bin/time", "-f", "MAXRSS_KB %M WALL %e"] + [str(c) for c in cmd]
    t = time.time()
    if log:
        with open(log, "w") as fh:
            r = subprocess.run(full, stdout=fh, stderr=subprocess.STDOUT)
    else:
        r = subprocess.run(full)
    if r.returncode == 137:
        sys.exit(f"killed by the {MEM_MAX} memory cap (exit 137): lower resolution/samples; see {log}")
    if r.returncode != 0:
        sys.exit(f"command failed ({r.returncode}): {' '.join(map(str, cmd[:3]))} ... see {log}")
    return time.time() - t


def blender(script, *args, log=None):
    """Run a Blender python script headless, 2 threads, capped."""
    cmd = [BLENDER, "-b", "-t", THREADS, "--factory-startup", "--python", script, "--", *args]
    return capped(cmd, log=log)


def chrome_screenshot(html_path, png_path, w=SCREEN_W, h=SCREEN_H, scale=SCALE):
    prof = BUILD / "chrome-profile"
    prof.mkdir(parents=True, exist_ok=True)
    cmd = [CHROME, "--headless=new", "--disable-gpu", "--no-first-run",
           "--no-default-browser-check", f"--user-data-dir={prof}", "--hide-scrollbars",
           f"--force-device-scale-factor={scale}", f"--window-size={w},{h}",
           "--default-background-color=00000000", "--virtual-time-budget=2000",
           f"--screenshot={png_path}", f"file://{Path(html_path).resolve()}"]
    log = BUILD / "logs" / (Path(png_path).stem + ".chrome.log")
    log.parent.mkdir(parents=True, exist_ok=True)
    return capped(cmd, log=log)


def fonts():
    return dict(
        sans="/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
        sans_regular="/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        serif="/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc",
    )


if __name__ == "__main__":
    print("available MB:", available_mb())
    for k, v in fonts().items():
        print(k, v, os.path.exists(v))
