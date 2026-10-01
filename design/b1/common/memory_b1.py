"""B1 texture memory, measured on the renders the way the unit atlases are (design/production
postprocess.py): each image trimmed (alpha > 4), a player-colour layer trimmed to its own area, a
half-resolution shadow (alpha >= 20); pages filled to 86 % (the units' packing); 4 bytes a pixel
uncompressed, 1 byte with ASTC 4 x 4; 2x is (2/3)^2 of the 3x area.

python3 common/memory_b1.py [x3|prev]   -> printed table, build/b1/memory.json

The finished buildings, the town pieces and the resource points are counted as they are. The states
(B1-02) are rendered for three buildings only; for all fifteen they are estimated two ways:
- per building (each building has its own state images): the three buildings' state-to-finished area
  ratio x the finished area of all fifteen;
- shared overlays (one set per footprint size and culture, drawn over or instead of the building):
  the scaffolds, rubble and so on of the three sample sizes (2 x 2, 3 x 3, 4 x 4).
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import config  # noqa: E402

FILL = 0.86
TRIM = 4
SHADOW_FLOOR = 20


def _bbox_area(mask):
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return 0
    return int((xs.max() - xs.min() + 1) * (ys.max() - ys.min() + 1))


def piece_px(base, ppm_ratio=1.0):
    """(colour, team, shadow) trimmed pixel areas at 3x for one rendered piece."""
    b = np.asarray(Image.open(f"{base}_beauty.png").convert("RGBA"))
    a = b[..., 3] > TRIM
    col = _bbox_area(a)
    team = 0
    mp = Path(f"{base}_mask.png")
    if mp.exists():
        m = np.asarray(Image.open(mp).convert("RGBA"))
        team = _bbox_area((m[..., 0] > TRIM) & (m[..., 3] > TRIM) & a)
    sh = 0
    sp = Path(f"{base}_shadow.png")
    if sp.exists():
        s = np.asarray(Image.open(sp).convert("RGBA"))[..., 3] >= SHADOW_FLOOR
        sh = _bbox_area(s)
    r = ppm_ratio ** 2
    return col * r, team * r, sh * r


def folder(name, suffix, select=lambda n: True):
    d = config.BUILD / "b1" / name
    out = {}
    for meta in sorted(d.glob(f"*_{suffix}.json")):
        n = meta.name[:-len(f"_{suffix}.json")]
        if not select(n):
            continue
        m = json.loads(meta.read_text())
        out[n] = piece_px(str(meta)[:-5], 60.0 / m["px_per_m"])
    return out


def mb(px_tuple, scale="x3", astc=False):
    area = sum(px_tuple)
    if scale == "x2":
        area *= (2 / 3) ** 2
    return area / FILL * (1 if astc else 4) / 2 ** 20


def total(d):
    return tuple(sum(v[k] for v in d.values()) for k in range(3))


def run(suffix="x3"):
    done = folder("core3", suffix)
    done.update(folder("b101", suffix))
    towns = folder("towns", suffix, lambda n: not n.startswith("tground"))
    res = folder("b104", suffix, lambda n: not n.startswith("forest"))
    states = folder("states", suffix)
    rows = {"建築（完成，15 種 × 2 文化，含城牆、城門）": total(done), "城鎮零件（不含地面鋪面）": total(towns),
            "資源點（含作物三階段）": total(res)}
    # the states, two ways
    core = ("main_city", "house", "barracks")
    groups = {"施工中 A": ("build_a1", "build_a2", "build_a3"), "施工中 B": ("build_b1", "build_b2", "build_b3"),
              "受損 A": ("damaged_a",), "受損 B": ("damaged_b",), "被摧毀 A": ("destroyed_a",),
              "被摧毀 B": ("destroyed_b",)}
    est = {}
    done_all = sum(total(done))
    done_core = sum(sum(done[f"{k}_{c}"]) for k in core for c in ("E", "W") if f"{k}_{c}" in done)
    for g, sts in groups.items():
        st_core = sum(sum(states[f"{k}_{c}_{s}"]) for k in core for c in ("E", "W") for s in sts
                      if f"{k}_{c}_{s}" in states)
        per_building = st_core / max(1, done_core) * done_all
        # shared: one set per footprint size (the three sample buildings are the three sizes)
        shared = st_core
        est[g] = (per_building, shared)
    out = {"rows": {k: [mb(v), mb(v, "x2", True)] for k, v in rows.items()},
           "states": {g: dict(per_building=[mb((v[0], 0, 0)), mb((v[0], 0, 0), "x2", True)],
                              shared=[mb((v[1], 0, 0)), mb((v[1], 0, 0), "x2", True)]) for g, v in est.items()}}
    print("| | 3 倍未壓縮 | 2 倍 ASTC 4×4 |")
    print("|---|---|---|")
    for k, (a, b) in out["rows"].items():
        print(f"| {k} | {a:.1f} MB | {b:.1f} MB |")
    base3 = sum(a for a, _ in out["rows"].values())
    base2 = sum(b for _, b in out["rows"].values())
    print(f"| **小計** | **{base3:.1f} MB** | **{base2:.1f} MB** |")
    print("\n狀態（全部 15 種建築；兩種製作方式）")
    print("| | 每棟各自畫：3 倍 / 2 倍 ASTC | 共用疊圖：3 倍 / 2 倍 ASTC |")
    print("|---|---|---|")
    for g, v in out["states"].items():
        print(f"| {g} | {v['per_building'][0]:.1f} / {v['per_building'][1]:.1f} MB | "
              f"{v['shared'][0]:.1f} / {v['shared'][1]:.1f} MB |")
    out["subtotal"] = [base3, base2]
    (config.BUILD / "b1" / f"memory_{suffix}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    return out


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "x3")
