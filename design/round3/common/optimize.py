"""Lossless PNG compression of out/ (run with the tools venv that has pyoxipng).

~/.local/opt/war-game-tools-venv/bin/python common/optimize.py
"""
from pathlib import Path

import oxipng

OUT = Path(__file__).resolve().parents[1] / "out"


def main():
    before = after = 0
    for p in sorted(OUT.glob("*.png")):
        b = p.stat().st_size
        oxipng.optimize(p, level=4, strip=oxipng.StripChunks.safe())
        a = p.stat().st_size
        before += b
        after += a
        print(f"{p.name}: {b / 2**20:.2f} -> {a / 2**20:.2f} MB")
    gifs = sum(p.stat().st_size for p in OUT.glob("*.gif"))
    print(f"PNG total {before / 2**20:.1f} -> {after / 2**20:.1f} MB; GIF total {gifs / 2**20:.1f} MB; "
          f"all {(after + gifs) / 2**20:.1f} MB")


if __name__ == "__main__":
    main()
