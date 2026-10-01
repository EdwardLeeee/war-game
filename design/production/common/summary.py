"""Collect the per-unit CI reports into one table (for the README and the report to ceo).

python3 common/fetch_reports.py <run_id>    (downloads production-<unit>-report into build/reports/)
python3 common/summary.py
"""
import glob
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import config  # noqa: E402
import spec    # noqa: E402

REP = config.BUILD / "reports"


def _find(t, pattern):
    hits = glob.glob(str(REP / t / "**" / pattern), recursive=True)
    return Path(hits[0]) if hits else None


def main():
    rows = []
    tot = {"x3": {}, "x2": {}}
    for t in spec.UNITS:
        rp, st = _find(t, f"{t}_report.json"), _find(t, "render_stats.json")
        if not rp:
            rows.append(f"| {t} | （沒有報告） | | | | | |")
            continue
        r = json.loads(rp.read_text())
        s = json.loads(st.read_text()) if st else {}
        mem = {}
        for sc in ("x3", "x2"):
            # memory from this run's CI report; the local post-processing only when the report has none
            mp = _find(t, f"atlas_{sc}/memory.json") or config.BUILD / "prod" / t / f"atlas_{sc}" / "memory.json"
            if mp.exists():
                mem[sc] = json.loads(mp.read_text())
                for k, v in mem[sc].items():
                    if isinstance(v, (int, float)):
                        tot[sc][k] = tot[sc].get(k, 0) + v
        fm = s.get("frame_m", ["?"] * 4)
        mb3 = mem.get("x3", {}).get("total_rgba8_bytes", 0) / 2 ** 20
        mb2 = mem.get("x2", {}).get("total_astc_4x4_bytes", 0) / 2 ** 20
        rows.append(f"| {t} | {round((s.get('seconds') or 0) / 60)} 分 | {r['unique_frames']} | "
                    f"{fm[0]} × {fm[1]} m | {len(r['errors'])} / {r['warnings_total']} | "
                    f"{mb3:.1f} / {mb2:.1f} MB | {'、'.join(r['placeholders']) or '—'} |")
    head = ["| 兵種 | 算圖時間 | 影格（不含鏡像） | 畫框 | 錯誤 / 警告 | 記憶體：3 倍未壓縮 / 2 倍 ASTC | 還是替代動作 |",
            "|---|---|---|---|---|---|---|"]
    print("\n".join(head + rows))
    for sc in ("x3", "x2"):
        m = tot[sc]
        if not m:
            continue
        mb = {k: round(v / 2 ** 20) for k, v in m.items()}
        n = sum(1 for t in spec.UNITS if _find(t, f"atlas_{sc}/memory.json")
                or (config.BUILD / "prod" / t / f"atlas_{sc}" / "memory.json").exists())
        print(f"\n{sc}（{n} 個兵種）：顏色 {mb['color_bytes']} MB、玩家色 {mb['team_bytes']}、影子 {mb['shadow_bytes']}、"
              f"特效 {mb['fx_bytes']}、防護罩 {m.get('shield_bytes', 0) / 2 ** 20:.1f}；合計 {mb['total_rgba8_bytes']} MB（未壓縮 RGBA8），ASTC 4×4 {mb['total_astc_4x4_bytes']} MB")


if __name__ == "__main__":
    main()
