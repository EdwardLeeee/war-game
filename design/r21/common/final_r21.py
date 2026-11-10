"""R21, what the user chose (D-143: the East's two pullers, the West's four small wheels), before and after:

  R21-03-東陸兩名拽手-改前改後-phone     standing, throwing, moving, wrecked
  R21-04-西陸四個小木輪-改前改後-phone   standing, moving, wrecked

Before: the published pack's frames (art-v7.9's engines are art-v7.8's). After: drafts of the local pipeline
(render_r21.py; the East in e_B2, the West in w_A and w_A2).

python3 design/r21/common/final_r21.py DRAFTS ART_X3 OUT
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import boards_r21 as R21   # noqa: E402

R, A, B = R21.R, R21.A, R21.B
SRC = "改前是已發布的圖（art-v7.9 的攻城砲和 v7.8 一樣）；改後是本機算的草稿，ceo 看過才進 CI 正式算圖。圖在草地的顏色上；「手機」是 iPhone 上的實際大小（最左邊一名槍兵當比例），其餘放大。"


class Pair:
    def __init__(self, S, unit, after):
        self.S, self.old, self.after = S, A.Unit(S.art, unit), after      # after: anim -> (folder, tag)

    def scene(self, new, anim, face, k):
        if not new:
            return [(self.old.sprite(anim, face, k), 0, 0)]
        folder, tag = self.after[anim]
        return [(self.S.spr(folder, tag, anim, face, k), 0, 0)]

    def row(self, title, line, anim, phone, bigs, n=1.0):
        """改前 | 改後: the phone's strip (face, frames), then enlarged cells [(face, frames)], the same cells both sides."""
        S = self.S
        pf, pks = phone
        pbox = S.box([self.scene(new, anim, pf, k) for new in (False, True) for k in pks], pad=3)
        sides = []
        for new in (False, True):
            cells = []
            for face, ks in bigs:
                box = S.box([self.scene(nw, anim, face, k) for nw in (False, True) for k in ks])
                cells.append(S.big([self.scene(new, anim, face, k) for k in ks], n, box))
            sides.append(R.join([R.titled(S.phone([self.scene(new, anim, pf, k) for k in pks], pbox), "手機"), R.join(cells, 8)], 10, vertical=True))
        return R.block(title, line, R.pair(sides[0], sides[1]))


def east(S, out):
    P = Pair(S, "siege_e", {a: ("e_B2", "eB") for a in ("idle", "attack", "walk", "death")})
    blocks = [
        P.row("待機", "兩名東陸的兵站在砲前、面向砲，各握一條拉繩（另外兩條繩和地上的握把拿掉）。穿玩家色的圓領袍、黑幞頭、綁腿，不帶武器。", "idle", (7, [0]), [(7, [0]), (0, [0]), (6, [0])]),
        P.row("發射（10 格，第 5 格石頭出手，不變）", "蹲下把繩往下拉，砲桿甩上去，再站起來。繩子接在手上、跟著砲桿走。", "attack", (7, [0, 2, 3, 5, 7]), [(7, [0, 3, 5]), (0, [3])]),
        P.row("走路（8 格）", "轉向前、把繩拉過右肩，小步拖著車走。輪子一個循環從轉 90 度改成 135 度（前進 0.66 → 0.99 公尺），人的一步才有半公尺。", "walk", (7, [0, 2, 4, 6]), [(7, [0, 4]), (0, [2]), (6, [2])]),
        P.row("砲垮（10 格）", "兩個人被甩開、各往車頭的一側倒下（步兵的倒法），第二個人慢一拍。", "death", (7, [0, 3, 5, 9]), [(7, [3, 9]), (0, [9])]),
    ]
    W = max(b.width for b in blocks)
    R.sheet(out, "R21-03-東陸兩名拽手-改前改後-phone", [
        ("東陸攻城砲加兩名拽手（使用者選 B）。左邊改前、右邊改後。人是做進砲的圖裡的，不是另外疊的。", B.font(32), B.PALE),
        (SRC, B.font(26, False), B.GREY),
    ], blocks)


def west(S, out):
    P = Pair(S, "siege_w", {"idle": ("w_A", "wA"), "walk": ("w_A", "wA"), "death": ("w_A2", "wA")})
    blocks = [
        P.row("待機", "底架四角加實心小木輪（半徑 24 公分），整台抬高 14 公分；石堆留在地上。不照史實，是遷就遊戲。", "idle", (7, [0]), [(7, [0])], 1.2),
        P.row("走路（8 格）", "輪子跟著前進的距離轉（一個循環 0.38 公尺）。改前 8 格是同一張圖。", "walk", (7, [0, 2, 4, 6]), [(0, [0, 2, 4])], 1.2),
        P.row("砲垮（10 格）", "底架落到四個輪子中間：一個輪子脫落平躺、一個斜靠，另外兩個留在原地。", "death", (7, [0, 5, 9]), [(7, [5, 9]), (0, [9])], 1.0),
    ]
    R.sheet(out, "R21-04-西陸四個小木輪-改前改後-phone", [
        ("西陸攻城砲加四個小木輪（使用者選 A）。左邊改前、右邊改後。", B.font(32), B.PALE),
        (SRC, B.font(26, False), B.GREY),
    ], blocks)


def main():
    S = R21.Shots(Path(sys.argv[1]), Path(sys.argv[2]))
    out = Path(sys.argv[3])
    out.mkdir(parents=True, exist_ok=True)
    east(S, out)
    west(S, out)


if __name__ == "__main__":
    main()
