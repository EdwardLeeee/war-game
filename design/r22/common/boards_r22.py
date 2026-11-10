"""R22 boards (D-142: R19's items 8 and 9, the fall), before and after, no options:

  R22-總覽-倒下-phone                 both items on one picture
  R22-01-倒下的開頭-改前改後-phone     the fall of four units of the East, every frame; its first frames from the front
  R22-02-倒地後的腰刀-改前改後-phone   the four units that carry a sword at the hip, the last frames
  R22-倒下-改前改後-phone.gif          the four falls moving, before over after

Before: the published pack's frames (art-v7.9). After: drafts of the local pipeline with R22=1
(design/r21/common/render_r21.py; design/r22/build/run_drafts.sh).

python3 design/r22/common/boards_r22.py DRAFTS ART_X3 OUT [overview fall swords gif]
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "r21" / "common"))
import boards_r21 as R21   # noqa: E402
import final_r21 as F21    # noqa: E402

R, A, B = R21.R, R21.A, R21.B
SRC = "改前是已發布的圖（art-v7.9）；改後是本機算的草稿，使用者核准後才進 CI 正式算圖。圖在草地的顏色上；「手機」是 iPhone 上的實際大小（最左邊一名槍兵當比例），其餘放大。"
# (unit, name, tag, the fall's animation, its frames, the frames of the recoil)
FALL = [("farmer_e", "農民東陸", "fN", "death", 10, [1, 2]), ("spear_e", "槍兵東陸", "sN", "death", 10, [1, 2]),
        ("bow_e", "遠程兵東陸", "bN", "death", 10, [1, 2]), ("mage_e", "法師東陸", "mN", "fall", 12, [2, 3])]
# (unit, name, tag, the facings the lying body is shown from)
SWORD = [("spear_e", "槍兵東陸", "sN", [7, 0]), ("pike_w", "槍兵西陸", "pN", [7, 0]),
         ("hcav_e", "騎兵東陸", "hN", [0, 1]), ("knight_w", "騎兵西陸", "kN", [0, 1])]
WHAT8 = "倒下一開始那兩三格，兩臂不再向兩側平舉成 T 字：右臂彎起來抬到胸前（像胸口挨了一下），左臂垂在身側。時間、落地那一格都不變。步兵和法師共用，8 個兵種一起變。"
WHAT9 = "倒地以後，腰上的刀（連鞘）轉到貼著大腿躺平：槍兵的不再插進地裡，騎兵的不再朝天豎著。站著、走路、攻擊時不變。"


def pair_of(S, unit, tag):
    return F21.Pair(S, unit, {a: (f"{unit}_new", tag) for a in ("death", "fall")})


def recoil(S, n=3.0):
    """Item 8, a unit a column: the recoil's frames from the front, before over after."""
    cols = []
    for unit, name, tag, anim, frames, ks in FALL:
        P = pair_of(S, unit, tag)
        box = S.box([P.scene(new, anim, 6, k) for new in (False, True) for k in ks])
        cells = [R.titled(S.big([P.scene(new, anim, 6, k) for k in ks], n, box), word, col, 28, True)
                 for new, word, col in ((False, "改前", (255, 150, 130)), (True, "改後", (150, 230, 150)))]
        cols.append(R.titled(R.join(cells, 10, vertical=True), f"{name}　第 {ks[0] + 1}、{ks[1] + 1} 格", B.WHITE, 30, True))
    return R.join(cols, 30)


def lying(S, n=2.0):
    """Item 9, a unit a column: the last frame from two sides, before over after."""
    cols = []
    for unit, name, tag, faces in SWORD:
        P = pair_of(S, unit, tag)
        cells = []
        for new, word, col in ((False, "改前", (255, 150, 130)), (True, "改後", (150, 230, 150))):
            parts = []
            for f in faces:
                box = S.box([P.scene(nw, "death", f, 9) for nw in (False, True)])
                parts.append(S.big([P.scene(new, "death", f, 9)], n, box))
            cells.append(R.titled(R.join(parts, 6), word, col, 28, True))
        cols.append(R.titled(R.join(cells, 10, vertical=True), f"{name}　最後一格", B.WHITE, 30, True))
    return R.join(cols, 30)


def overview(S, out):
    R.sheet(out, "R22-總覽-倒下-phone", [
        ("第 3 批 倒下（R19 的第 8、9 項）：上面改前、下面改後。可以或不行，看這一張就夠；細的在 R22-01、R22-02，動起來的樣子看 GIF。", B.font(32), B.PALE),
        (SRC, B.font(26, False), B.GREY),
    ], [R.block("8　倒下一開始兩臂平舉成 T 字", WHAT8, recoil(S)), R.block("9　倒地後腰刀穿進地裡或朝天豎著", WHAT9, lying(S))])


def fall(S, out):
    blocks = []
    for unit, name, tag, anim, frames, ks in FALL:
        P = pair_of(S, unit, tag)
        blocks.append(P.row(f"{name}（{frames} 格）", "", anim, (7, list(range(frames))), [(7, list(range(0, 5))), (6, ks)], 2.0))
    R.sheet(out, "R22-01-倒下的開頭-改前改後-phone", [
        (WHAT8, B.font(32), B.PALE),
        (SRC + "每個兵種：整個倒下的過程（手機大小），前 5 格放大，再加從正面看的那兩格。", B.font(26, False), B.GREY),
    ], blocks)


def swords(S, out):
    blocks = []
    for unit, name, tag, faces in SWORD:
        P = pair_of(S, unit, tag)
        blocks.append(P.row(name, "", "death", (7, [3, 5, 7, 9]), [(7, [5, 7, 9])] + [(f, [9]) for f in faces if f != 7], 1.6))
    R.sheet(out, "R22-02-倒地後的腰刀-改前改後-phone", [
        (WHAT9, B.font(32), B.PALE),
        (SRC, B.font(26, False), B.GREY),
    ], blocks)


def gif(S, out):
    """The four falls at 12 frames a second, before over after, the last frame held; three times the art's size."""
    n = 2.0
    pairs = [(pair_of(S, unit, tag), name, anim, frames) for unit, name, tag, anim, frames, _ in FALL]
    boxes = [S.box([P.scene(new, anim, 7, k) for new in (False, True) for k in range(frames)]) for P, _, anim, frames in pairs]
    w = [round((b[0] + b[2]) * n) for b in boxes]
    h = max(round((b[1] + b[3]) * n) for b in boxes)
    top = 100
    W, H = sum(w) + 12 * (len(w) - 1), top + 2 * (h + 44)
    fh, fb = B.font(34), B.font(28, False)
    out_frames, times = [], []
    for i in range(12):
        img = Image.new("RGB", (W, H), B.BG)
        d = ImageDraw.Draw(img)
        d.text((8, 4), "R22-倒下-改前改後-phone（每秒 12 格）", font=fh, fill=B.WHITE)
        x = 0
        for (P, name, anim, frames), box, ww in zip(pairs, boxes, w):
            d.text((x + 6, 56), name, font=fb, fill=B.PALE)
            k = min(i, frames - 1)
            for row, (new, word, col) in enumerate(((False, "改前", (255, 150, 130)), (True, "改後", (150, 230, 150)))):
                y = top + row * (h + 44)
                d.text((x + 6, y), word, font=B.font(28), fill=col)
                img.paste(S.big([P.scene(new, anim, 7, k)], n, box), (x, y + 40))
            x += ww + 12
        out_frames.append(img)
        times.append(80)
    times[-1] += 1500
    R21._save(out / "R22-倒下-改前改後-phone.gif", out_frames, times)


def main():
    S = R21.Shots(Path(sys.argv[1]), Path(sys.argv[2]))
    out = Path(sys.argv[3])
    out.mkdir(parents=True, exist_ok=True)
    for f in (overview, fall, swords, gif):
        if len(sys.argv) < 5 or f.__name__ in sys.argv[4:]:
            f(S, out)


if __name__ == "__main__":
    main()
