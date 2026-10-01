"""P3 approval sheets: the foot soldiers' deaths with the fall the user approved for the mages (P2-03).

The six infantry (spearman, crossbowman, pikeman, longbowman, both farmers) still fell the R1 way,
which the user had turned down in P1-03 for the other units. ceo 2026-10-01: give them the approved
fall and show it as P3-01. The weapon or tool is let go and ends lying flat beside the body.

python3 common/review_p3.py [--fetch <run_id> [unit ...]]
-> out/P3-01-步兵倒下-A-現況-mobile.png      key frames of the R1 death, phone pixels and actual size
   out/P3-01-步兵倒下-B-精修-mobile.png      the same for the new death (with the shared landing dust)
   out/P3-01-步兵倒下-B-精修-動作.gif        every unit: A 現況 | B 精修
   out/P3-99-總覽對照.png                    A over B for every unit, and an actual-size row

Sources (build/prod/, CI artifacts): <unit>/raw the production renders (A, the R1 death),
review3-<unit>/raw the P3 renders (B; render_prod.py --review, facing 7).
Facing 7, phone pixels (1 pt = 3 px) unless a row says otherwise; East blue, West red.
"""
import argparse
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import review_p2    # noqa: E402  (cells, strips and the GIF writer of P2)
import spec         # noqa: E402
from review_p2 import BG, GREY, INK, OUT, PROD, Cell, Image, ImageDraw, artboard, r2art, strip  # noqa: E402

NAMES = {"spear_e": "東陸槍兵", "xbow_e": "東陸弩手", "farmer_e": "東陸農夫", "pike_w": "西陸長矛兵",
         "bow_w": "西陸長弓兵", "farmer_w": "西陸農民"}
DEATH = {"death": 10}
KEYS = [("death", 0), ("death", 3), ("death", 5), ("death", spec.IMPACT["spear_e"][1]), ("death", 9)]
# key index -> dust frame: the landing frame shows the dust one frame on, where it reads best; the last
# frame is shown without it, as the game holds it for 3 seconds after the half-second dust is gone
DUST_AT = {3: 1}
SUB = ("A 現況是 R1 的倒法：整個人像木板一樣往後直直倒下，武器跟著身體轉。B 精修套用 P2-03 核准的倒法：膝蓋先軟、"
       "垮下、往後斜倒、落地彈一下；武器一開始就脫手，最後平躺在身體旁邊。東陸農夫的斗笠飛出去平放在頭旁邊。"
       "落地的塵土是遊戲另外畫的共用效果（P2 已核准），不在人物圖裡。農夫、農民手上是 P2-06 核准的放大工具。")


def fetch(run_id, units):
    for unit in units:
        d = PROD / f"review3-{unit}"
        subprocess.run(["rm", "-rf", str(d)])
        r = subprocess.run(["gh", "run", "download", str(run_id), "-n", f"production-review-{unit}", "-D", str(d)])
        nested = d / "prod" / f"review-{unit}" / "raw"          # artifacts uploaded with a wider root
        if nested.exists():
            nested.rename(d / "raw")
            subprocess.run(["rm", "-rf", str(d / "prod")])
        n = len(list((d / "raw").glob("*_beauty.png"))) if (d / "raw").exists() else 0
        print(f"review3-{unit}: {'ok' if r.returncode == 0 else 'no artifact'}, {n} colour frames")


def option_board(opt, name, pairs, which):
    """One option: every unit's key frames at phone pixels, then its last frame at actual size."""
    label = f"P3-01-步兵倒下-{opt}-{name}-mobile"
    M = 60
    rows = []
    for unit, a, b in pairs:
        cell = a if which == 0 else b
        big = strip(cell, KEYS, 1.0, dust_at=DUST_AT if which else None)
        small = strip(cell, [("death", 0), ("death", 9)], 1 / 3)
        rows.append((unit, big, small))
    W = 2 * M + max(r[1].width + r[2].width + 40 for r in rows)
    sub = ("選項 A：現在量產圖裡的倒法（R1）。人像木板一樣直直往後倒，武器跟著身體一起轉到地上。" if which == 0 else
           "選項 B：套用 P2-03 核准的倒法。膝蓋先軟、垮下、往後斜倒、落地彈一下；武器脫手、平躺在身體旁邊，"
           "不會穿過身體也不會浮在空中；東陸農夫的斗笠飛出去平放。第 4 張是落地那一格，遊戲在那裡畫共用的落地塵土；"
           "最後一格遊戲會停 3 秒，那時塵土已經散了，所以最後一張不畫塵土。")
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    top = r2art._wrap(probe, M, 118, sub, GREY, 26, W - 2 * M) + 20
    H = top + sum(max(r[1].height, r[2].height) + 80 for r in rows) + 30
    art = Image.new("RGB", (W, H), BG)
    dr = ImageDraw.Draw(art)
    dr.text((M, 40), label, font=artboard.font(52), fill=INK)
    r2art._wrap(dr, M, 118, sub, GREY, 26, W - 2 * M)
    y = top
    for unit, big, small in rows:
        dr.text((M, y), f"{NAMES[unit]}：開始、第 3、5 格、落地（第 7 格）、最後一格（手機像素 1 pt = 3 px）｜"
                        f"右：站著與最後一格的實際大小（1 pt = 1 px）", font=artboard.font(24), fill=INK)
        hh = max(big.height, small.height)
        art.paste(big.convert("RGB"), (M, y + 40 + hh - big.height))
        art.paste(small.convert("RGB"), (M + big.width + 40, y + 40 + hh - small.height))
        y += hh + 80
    art.save(OUT / f"{label}.png")
    print(f"wrote {label}.png {W}x{H}")


def overview(pairs):
    M, W = 60, 3000
    art = Image.new("RGB", (W, 6000), BG)
    dr = ImageDraw.Draw(art)
    dr.text((M, 36), "P3-99-總覽對照", font=artboard.font(52), fill=INK)
    y = r2art._wrap(dr, M, 110, "P3-01 步兵倒下：上面是現況 A，下面是精修 B（開始、落地、最後一格）。" + SUB
                    + " 朝向右前，手機像素（1 pt = 3 px），東陸藍、西陸紅。標「實際大小」的是 1 pt = 1 px。",
                    GREY, 24, W - 2 * M) + 24
    dr.text((M, y), "P3-01-步兵倒下（A 現況／B 精修）", font=artboard.font(34), fill=INK)
    y += 56
    x, row_h = M, 0
    keys = [("death", 0), ("death", 7), ("death", 9)]
    for unit, a, b in pairs:
        sa = strip(a, keys, caption="A 現況")
        sb = strip(b, keys, dust_at={1: 1}, caption="B 精修")
        w = max(sa.width, sb.width)
        if x + w > W - M:
            x, y, row_h = M, y + row_h + 30, 0
        dr.text((x, y), NAMES[unit], font=artboard.font(22), fill=INK)
        art.paste(sa.convert("RGB"), (x, y + 30))
        art.paste(sb.convert("RGB"), (x, y + 30 + sa.height + 6))
        row_h = max(row_h, 30 + sa.height + 6 + sb.height)
        x += w + 36
    y += row_h + 30
    dr.text((M, y), "實際大小（1 pt = 1 px）：站著 → A 最後一格 → B 最後一格", font=artboard.font(22), fill=INK)
    y += 34
    items = []
    for unit, a, b in pairs:
        s = [strip(b, [("death", 0)], 1 / 3), strip(a, [("death", 9)], 1 / 3), strip(b, [("death", 9)], 1 / 3)]
        t = Image.new("RGBA", (sum(i.width for i in s) + 8, max(i.height for i in s)), (*BG, 255))
        xx = 0
        for i in s:
            t.alpha_composite(i, (xx, t.height - i.height))
            xx += i.width + 4
        items.append((NAMES[unit], t))
    y += review_p2._row(art, dr, M, y, items) + 40
    art = art.crop((0, 0, W, y))
    art.save(OUT / "P3-99-總覽對照.png")
    print(f"wrote P3-99-總覽對照.png {art.size[0]}x{art.size[1]}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", nargs="+", metavar=("RUN_ID", "UNIT"),
                    help="download the P3 review renders of this CI run first (all six, or the units given)")
    a = ap.parse_args()
    if a.fetch:
        fetch(a.fetch[0], a.fetch[1:] or spec.INFANTRY)
    OUT.mkdir(parents=True, exist_ok=True)
    pairs = [(u, Cell(u, ["death"], u, DEATH), Cell(u, ["death"], f"review3-{u}", DEATH, with_dust=True))
             for u in spec.INFANTRY]
    review_p2.gif_pairs("P3-01-步兵倒下-B-精修-動作", "每一格左邊是現況 A，右邊是精修 B。" + SUB,
                        [(NAMES[u], a_, b_) for u, a_, b_ in pairs], OUT / "P3-01-步兵倒下-B-精修-動作.gif", cols=3,
                        names=("A 現況", "B 精修"), dither="bayer:bayer_scale=4")   # no team-colour specks in the dust
    option_board("A", "現況", pairs, 0)
    option_board("B", "精修", pairs, 1)
    overview(pairs)
