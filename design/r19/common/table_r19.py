"""R19-13: every finding in one table, read by itself: the oddest first (高, 中, 低; within one, what more units
share first), a row a finding: its numbers on the units' boards, the units, the actions, a small picture with the
place circled, the problem, the fix, the cost. The same thing on several units is one row. Under the table: what can
be rendered together.

python3 design/r19/common/table_r19.py ART_X3 OUT
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import art_r19 as A            # noqa: E402
import boards_r19 as B         # noqa: E402
import findings_r19 as F       # noqa: E402

M = B.M
COLS = [("", 70), ("嚴重", 90), ("", 290), ("編號・兵種・動作", 470), ("問題", 880), ("建議的改法", 800), ("估工", 90)]
FOOT = [
    "估工只算改的工：小＝只改數值或材質；中＝改一個動作或加一個小零件；大＝改模型或好幾個動作。另外每個改到的兵種要在 CI 重算一次（約 1.5–2 小時，可以好幾個同時算），再發一版美術包。",
    "可以併在一起的：",
    "・農民（斧頭、十字鎬、木槌、東陸的拿法和攻擊、挖礦的手臂）：東陸、西陸各重算一次，全部一起做最划算。",
    "・攻城砲兩項各自重算一次；遠程兵、騎兵、法師的項目也是各自的兵種重算一次。",
    "・倒下的 T 字是共用的動作，改一次程式、8 個兵種都要重算；建議只在那個兵種有別的項目要重算時順便帶上。",
    "沒列進來的：走路量過腳滑（差約 5 pt，看不出明顯在滑）、馬的腳步快慢，都寫在各兵種「依據」那張的走路底下。動起來順不順我只能看停格，請看 GIF 判斷。",
    "看了多少：農民兩國 5 個方向每一格都看過。其餘 10 個兵種，正面三個方向（朝右下、朝右、朝下）每一格都看過，背面兩個方向（朝右上、朝上）每個動作看了關鍵格。另外三個方向是鏡像。",
    "「真的多大」是一般常識的數字，沒有逐項查出處；挑中要改的項目，動手前會像 R16 那樣先查文物和出處。各兵種看過、沒問題的（武器大小、拿法、玩家色）寫在各自小卡那張的下面。",
]


def rows():
    out, seen = [], {}
    for unit, spec in F.UNITS.items():
        for f in spec["findings"]:
            tag = f"{spec['tag']}-{f['id']}"
            key = f.get("key")
            if key and key in seen:
                r = seen[key]
                r["tags"].append(tag)
                r["units"].append(spec["name"])
                r["sev"] = max(r["sev"], f["sev"])
                continue
            r = dict(unit=unit, f=f, sev=f["sev"], tags=[tag], units=[spec["name"]], order=len(out))
            out.append(r)
            if key:
                seen[key] = r
    return sorted(out, key=lambda r: (-r["sev"], -len(r["units"]), r["order"]))


def unit_names(names):
    """農民東陸, 農民西陸 -> 農民（東陸、西陸）."""
    kinds = {}
    for n in names:
        kinds.setdefault(n[:-2], []).append(n[-2:])
    return "、".join(k if len(v) == 2 else f"{k}{v[0]}" for k, v in kinds.items()) + ("（兩國）" if all(len(v) == 2 for v in kinds.values()) else "")


def main():
    art, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    rs = rows()
    W = 2 * M + sum(w for _, w in COLS)
    f, fb, fh = B.font(27, False), B.font(27), B.font(30)
    boards = {}
    drawn = []
    for i, r in enumerate(rs):
        b = boards.setdefault(r["unit"], B.Board(art, r["unit"]))
        _, pic, _, _, _ = b.card(r["f"], 600)
        k = min(1.0, (COLS[2][1] - 24) / pic.width, 230 / pic.height)
        pic = pic.resize((max(1, round(pic.width * k)), max(1, round(pic.height * k))), Image.LANCZOS)
        who = [unit_names(r["units"]), "、".join(A.ANIM_NAME[a] for a in r["f"]["anims"])]
        cells = [
            B.wrap(B.TMP, "、".join(r["tags"]), fb, COLS[3][1] - 30) + [ln for t in who for ln in B.wrap(B.TMP, t, f, COLS[3][1] - 30)],
            B.wrap(B.TMP, r["f"]["problem"], f, COLS[4][1] - 50),
            B.wrap(B.TMP, r["f"]["fix"], f, COLS[5][1] - 50),
        ]
        h = max(pic.height, max(len(c) for c in cells) * 38) + 28
        drawn.append((r, pic, cells, h, len(B.wrap(B.TMP, "、".join(r["tags"]), fb, COLS[3][1] - 30))))
    n = {s: sum(r["sev"] == s for r in rs) for s in (3, 2, 1)}
    units = sum(len(s["findings"]) for s in F.UNITS.values())
    anims = sum(len(A.Unit(art, u).anims) for u in F.UNITS)
    head = [
        (f"12 個兵種、{anims} 個動作都看過，挑出 {len(rs)} 項（高 {n[3]}、中 {n[2]}、低 {n[1]}）；同一件事出現在好幾個兵種的併成一列（各兵種看板上共 {units} 張小卡）。最怪的在最前面。", B.font(32), B.PALE),
        (f"看的是已發布的 {B.TAG}（main 現在釘的版本）。只挑問題，還沒有改任何東西；要改哪幾項請挑，挑了再排進下一版美術包。嚴重程度是照手機上看起來有多怪：高＝一眼就怪；中＝注意看會覺得怪；低＝放大或停格才看得到。每個兵種的小卡和每一格的排列在 R19-01 到 R19-12。", B.font(26, False), B.GREY),
    ]
    y = 16 + 78
    hd = []
    for text, ft, col in head:
        for ln in B.wrap(B.TMP, text, ft, W - 2 * M - ft.size):
            hd.append((ln, ft, col, y))
            y += ft.size + 14
    top = y + 14
    foot = [ln for t in FOOT for ln in B.wrap(B.TMP, t, f, W - 2 * M - 30)]
    H = top + 52 + sum(d[3] for d in drawn) + 24 + len(foot) * 38 + M
    img = Image.new("RGB", (W, H), B.BG)
    d = ImageDraw.Draw(img)
    d.text((M, 16), "R19-13-總表-phone", font=B.font(56), fill=B.WHITE)
    for ln, ft, col, yy in hd:
        d.text((M, yy), ln, font=ft, fill=col)
    xs = [M]
    for _, w in COLS:
        xs.append(xs[-1] + w)
    y = top
    for (name, _), x in zip(COLS, xs):
        d.text((x + 10, y + 6), name, font=fh, fill=B.WHITE)
    y += 52
    for i, (r, pic, cells, h, ntag) in enumerate(drawn):
        d.rectangle([M, y, W - M, y + h - 6], fill=B.PANEL if i % 2 == 0 else (30, 33, 38))
        d.text((xs[0] + 14, y + 12), str(i + 1), font=fh, fill=B.WHITE)
        d.text((xs[1] + 22, y + 12), B.SEV[r["sev"]], font=fh, fill=B.SEV_COL[r["sev"]])
        img.paste(pic, (xs[2] + 10, y + 10))
        for c, x in zip(cells, xs[3:6]):
            yy = y + 12
            for k, ln in enumerate(c):
                tag = x == xs[3] and k < ntag
                d.text((x + 10, yy), ln, font=fb if tag else f, fill=B.YEL if tag else B.WHITE if x != xs[3] else B.GREY)
                yy += 38
        d.text((xs[6] + 26, y + 12), r["f"]["cost"], font=fh, fill=B.WHITE)
        y += h
    y += 24
    for ln in foot:
        d.text((M + (0 if ln[0] in "估可・沒看「" else 27), y), ln, font=f, fill=(210, 210, 210))
        y += 38
    p = out / "R19-13-總表-phone.png"
    img.save(p, optimize=True)
    print(p.name, img.size)


if __name__ == "__main__":
    main()
