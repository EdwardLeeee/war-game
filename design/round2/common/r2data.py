"""R2 option texts and cost numbers (measured where possible, 估計 where extrapolated)."""
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(1, str(HERE.parents[1] / "round1" / "common"))

import config        # noqa: E402
import prodnotes     # noqa: E402  (R1 asset counts)

OPTIONS_01 = {
    "0": dict(name="現況", sub="選項 0：R1 的 B 原樣（基本形組合的模型、直接算到 3 倍、24 次取樣），當對照",
              changes=[("模型與算圖都和 R1 一樣。", "n")]),
    "A": dict(name="算圖升級", sub="選項 A：模型不動，只改算圖：2 倍超取樣、64 次取樣、環境遮蔽、銳化",
              changes=[("邊緣更清楚、縫隙與接合處有陰影，立體感較強。", "g"),
                       ("造型完全沒變：圓球頭、圓柱手臂、三角錐長袍依舊。", "r")]),
    "B": dict(name="造型升級", sub="選項 B：A＋平滑連續的身體、重做的馬、衣物跟著身體動、材質細節",
              changes=[("身體是一整塊平滑網格，有腰身、肩膀、手掌、靴子；走路時身體與衣物一起彎。", "g"),
                       ("馬用剖面曲線重做：馬身、頸、頭、腿的形狀像真的馬。", "g"),
                       ("甲片花紋、布紋、金屬邊緣磨亮、木紋；城樓有斗拱、椽子、格子窗與匾額。", "g"),
                       ("實際大小下看得出剪影變自然；材質花紋要放大才看得清楚。", "n")]),
    "C": dict(name="細節升級", sub="選項 C：B＋臉（眉眼鼻口、鬍子）、頭盔鉚釘、護腕、馬韁繩、流蘇、門釘、燈籠",
              changes=[("臉、鉚釘、流蘇、韁繩這些細節，實際大小下幾乎看不到，只有放大 2 倍才看得到。", "n"),
                       ("對遊戲畫面的差別最小，工時增加最多。", "r")]),
}

# AI work per asset (minutes). R1 figures from design/round1/worklog.md; R2 from design/round2/worklog.md.
MINUTES = {
    "0": dict(unit="約 1–2 分初版；量產品質估計 20–40 分", horse="含在騎兵內", building="初版約 1 分；量產估計 15–30 分"),
    "A": dict(unit="同 0（只改算圖設定，一次做好全部適用）", horse="同 0", building="同 0"),
    "B": dict(unit="估計 45–90 分／兵種（造型、衣物蒙皮、材質、2–3 輪修正）", horse="估計 60–90 分（兩種馬鎧各一次）",
              building="估計 30–60 分／棟"),
    "C": dict(unit="B 再加 20–40 分／兵種", horse="B 再加 20–30 分", building="B 再加 20–40 分／棟"),
}


def ci_seconds(level):
    """Mean seconds per rendered image from the job logs (build/r2/jobs-<level>/*.log)."""
    logs = list((config.BUILD / "r2" / f"logs-{level}").glob("*.log")) + list(
        (config.BUILD / "r2" / f"logs-{level}").glob("**/*.log"))
    tot_n, tot_s = 0, 0.0
    for p in logs:
        if "r2_" not in p.name or "r2m" in p.name or "r2b" in p.name or "r2z" in p.name:
            continue
        m = re.search(r"RENDERED (\d+) images in ([\d.]+)s", p.read_text(errors="ignore"))
        if m:
            tot_n += int(m.group(1))
            tot_s += float(m.group(2))
    return tot_s / tot_n if tot_n else None


def costs(level):
    m = MINUTES[level]
    frames = prodnotes.unit_frames(True)
    per = ci_seconds(level)
    if per and level == "0":
        per /= 4      # level 0 logs keep the 6x run; R1 production renders at 3x (a quarter of the pixels)
    if per and level in ("A", "B", "C"):
        # CI runners differ in speed run to run; use the slowest measured level so the options compare fairly
        per = max(filter(None, (ci_seconds(lv) for lv in ("A", "B", "C"))))
    passes = 3 if level == "0" else 4
    if per:
        # CI renders at 2x ss for A/B/C; per-image seconds already include that
        hours = frames * passes * per / 3600
        render = (f"約 {hours:.0f} 小時（GitHub Actions 4 核，每張約 {per:.1f} 秒 × {frames:,} 格 × {passes} 層；"
                  f"CI 機器速度每次不同，A／B／C 取最慢的一次；估計）")
    else:
        render = "待 CI 實測"
    mem = prodnotes.memory_table(20384, 240000)[0]
    return [("每個兵種", m["unit"]), ("馬", m["horse"]), ("每棟建築", m["building"]), ("全套算圖", render),
            ("手機記憶體", f"3 倍素材未壓縮 RGBA8 約 {mem[4]:.0f} MB（和模型精緻度無關，見 R2-02）")]


OPTIONS_02 = {
    "A": dict(name="3倍素材", scale=3, sub="選項 A：素材做成 3 倍（現在的規格）；雙指放大 2 倍時由手機放大，會變糊"),
    "B": dict(name="4.5倍素材", scale=4.5, sub="選項 B：素材做成 4.5 倍；放大 2 倍時略糊，記憶體約 2.25 倍"),
    "C": dict(name="6倍素材", scale=6, sub="選項 C：素材做成 6 倍；放大 2 倍仍清楚，記憶體約 4 倍"),
}


def memory_at(scale):
    """Uncompressed RGBA8 MB for the full production at a given sprite scale."""
    u, m, b, t = prodnotes.memory_table(20384, 240000)[0][1:]
    k = (scale / 3) ** 2
    return u * k, m * k, b * k, t * k
