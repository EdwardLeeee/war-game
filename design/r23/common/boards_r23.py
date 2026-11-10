"""R23 boards (D-142: R19's items 10, 11, 13, 14 and 15, the small ones):

  R23-總覽-其他小項-phone             the five items on one picture, an item a row, as it is and its options side by side
  R23-00-參考資料-phone                what the options rest on (words only)
  R23-01-遠程兵的右手-改前改後-phone    item 10, no options
  R23-02-護盾碎片-選項-phone           item 11: as they are, A, B
  R23-03-西陸農民玩家色-選項-phone      item 13: as he is, A, B
  R23-04-東陸法陣-選項-phone           item 14: as it is, A, B
  R23-05-東陸法師玩家色-選項-phone      item 15: as he is, A, B

All drafts of the local pipeline, as it is and each option alike (design/r23/build/run_drafts.sh). A mage's frames
have their effects layer laid over (the circle, the shards); the shield's ball is not drawn.

python3 design/r23/common/boards_r23.py DRAFTS ART_X3 OUT [overview refs bow shards farmer sigil mage]
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "r21" / "common"))
import boards_r21 as R21   # noqa: E402

R, A, B, S16 = R21.R, R21.A, R21.B, R21.S16
SRC = "都是本機算的草稿，現況和每個選項用同一條流程；使用者選了才進 CI 正式算圖。圖在草地的顏色上；「手機」是 iPhone 上的實際大小（最左邊一名槍兵當比例），其餘放大。"
RED = (255, 150, 130)


class Shots(R21.Shots):
    def one(self, folder, tag, anim, face, k, team="blue"):
        """[(sprite, 0, 0)]: a draft frame, its player colour tinted in, its effects layer over it when it has one."""
        key = (folder, anim, face, k, team)
        if key not in self._s:
            prefix = self.root / folder / f"{tag}_{anim}_f{face}_{k:02d}"
            (im, ax, ay), sh = S16.farmer(str(prefix), team)
            fx = Path(f"{prefix}_x3_fx.png")
            if fx.exists():
                im.alpha_composite(Image.open(fx).convert("RGBA"))
            bb = im.getbbox()
            im, ax, ay = im.crop(bb), ax - bb[0], ay - bb[1]
            if sh:
                si, sx, sy = sh
                sb = si.getbbox()
                sh = (si.crop(sb), sx - sb[0], sy - sb[1]) if sb else None
            self._s[key] = ((im, ax, ay), sh)
        return [(self._s[key], 0, 0)]


def options(S, opts, phone, bigs, n):
    """Columns, an option each: (name, sentence, folder, tag). phone: [(anim, face, frame, team)] in a row at the
    phone's size; bigs: the same, enlarged n times. Every column's cells the same size."""
    pbox = S.box([S.one(f, t, a, fc, k, tm) for _, _, f, t in opts for a, fc, k, tm in phone], pad=3)
    boxes = [S.box([S.one(f, t, a, fc, k, tm) for _, _, f, t in opts]) for a, fc, k, tm in bigs]
    cols = []
    for name, line, f, t in opts:
        cells = [S.big([S.one(f, t, a, fc, k, tm)], n, box) for (a, fc, k, tm), box in zip(bigs, boxes)]
        cols.append((name, line, [R.titled(S.phone([S.one(f, t, a, fc, k, tm) for a, fc, k, tm in phone], pbox), "手機"), R.join(cells, 6)]))
    return R21.columns(cols, gap=36)


BOW = [("改前", "右手空著、手肘彎著平舉在腰前（搭箭的位置），走路時不動。", "bow_e_0", "b0"),
       ("改後", "右臂自然垂在身側，走路時前後擺。持弓的左手不變；攻擊不變。", "bow_e_new", "bN")]
BOW_W = [("改前", "", "bow_w_0", "c0"), ("改後", "", "bow_w_new", "cN")]
SHARD = [("現況", "純白、不透明的小塊。", "mage_e_fx0", "x0"),
         ("A 同色半透明", "和護盾一樣的淡青色，半透明。", "mage_e_shA", "hA"),
         ("B 同色不透明", "和護盾一樣的淡青色，不透明（折衷：半透明在手機上太淡的話用這個）。", "mage_e_shB", "hB")]
FARMER = [("現況", "玩家色只有肩上的披肩（兜帽垂在背後），頭上是白色的亞麻頭巾。", "farmer_w_0", "w0"),
          ("A 兜帽戴起來", "把披肩連著的兜帽戴到頭上：頭和肩都是玩家色（西陸遠程兵也是這樣戴）。白頭巾拿掉。", "farmer_w_A", "wA"),
          ("B 加玩家色圍裙", "腰帶以下到膝蓋加一條玩家色的圍裙，圍住前面和兩側（和東陸農民一樣的做法）。", "farmer_w_B", "wB")]
SIGIL = [("現況", "六芒星的圓，和西陸法師的一樣。", "mage_e_fx0", "x0"),
         ("A 八卦", "兩圈之間排八個卦（後天八卦的次序）。唐代的銅鏡上有這樣鑄的。", "mage_e_sigA", "sA"),
         ("B 北斗七星", "圈裡是連起來的北斗七星。唐代道教的鏡子上有畫北斗的。", "mage_e_sigB", "sB")]
MAGE = [("現況", "玩家色是搭在兩肩的帔（胸前兩條）和腰帶。", "mage_e_0", "m0"),
        ("A 帔加寬", "帔從 12 公分加寬到 22 公分，胸前幾乎整片是玩家色。", "mage_e_A", "mA"),
        ("B 領子和袖口", "帔不變；外袍的領子、兩個寬袖口各加一圈玩家色（袖口那圈 20 公分寬）。", "mage_e_B", "mB")]
NOTE11 = "碎片當初是故意做成不透明的（程式註解：用護盾那種邊緣發亮的材質，正面看幾乎是透明的）。A、B 都只把顏色從純白改回護盾的淡青色，差在透不透明。草稿沒有畫護盾的球，只有碎片。"
NOTE14 = "手前出現法陣是 D-018 定的，這裡只換圖樣。手機上法陣約 19 pt 寬，看得出是不同的圖、看不清細節；所以另外放大 6 倍。太極圖（陰陽魚）是宋代以後才有的，沒有用。"
NOTE13 = "A、B 都照中古的樣子：兜帽本來就是連著披肩的一件，戴不戴都可以；農民繫圍裙也常見（R8 拿掉的是有圍兜的那種）。"
NOTE15 = "帔是照唐代道士的法服做的（R8），所以兩個選項都留著它。紅色是給你看另一個玩家色的樣子。"


def rows(S, n=2.0):
    """The five items' pictures: (title, note, body)."""
    b, r = "blue", "red"
    bow = options(S, BOW, [("idle", 7, 0, b), ("walk", 0, 2, b), ("walk", 0, 6, b)], [("idle", 7, 0, b), ("walk", 0, 2, b), ("walk", 6, 2, b)], n)
    shard = options(S, SHARD, [("shatter", 7, 1, b), ("shatter", 7, 2, b), ("shatter", 7, 3, b)], [("shatter", 7, 1, b), ("shatter", 7, 3, b)], n)
    farmer = options(S, FARMER, [("idle", 7, 0, b), ("idle", 7, 0, r), ("idle", 6, 0, b)], [("idle", 7, 0, b), ("idle", 6, 0, b), ("idle", 6, 0, r)], n)
    sigil = options(S, SIGIL, [("cast", 7, 19, b), ("cast", 0, 19, b)], [("cast", 7, 19, b), ("cast", 0, 19, b)], n)
    mage = options(S, MAGE, [("idle", 7, 0, b), ("idle", 7, 0, r), ("idle", 6, 0, b)], [("idle", 7, 0, b), ("idle", 6, 0, b), ("idle", 6, 0, r)], n)
    return [("10　遠程兵待機、走路時右手空著平舉（兩國）", "沒有選項。東陸、西陸的遠程兵用同一組動作，這裡畫東陸。", bow),
            ("11　法師護盾的碎片是純白、不透明的小塊（兩國）", NOTE11, shard),
            ("13　西陸農民的玩家色只有肩上一小塊", NOTE13, farmer),
            ("14　東陸法師的法陣是六芒星，和西陸一樣", NOTE14, sigil),
            ("15　東陸法師的玩家色只有細細的帔和腰帶", NOTE15, mage)]


def overview(S, out):
    R.sheet(out, "R23-總覽-其他小項-phone", [
        ("第 4 批 其他小項（R19 的第 10、11、13、14、15 項）：每一項一列。第 10 項是改前改後；其餘四項最左邊是現況、往右是選項，請各選一個。細的在 R23-01 到 R23-05。", B.font(32), B.PALE),
        (SRC, B.font(26, False), B.GREY),
    ], [R.block(t, note, body) for t, note, body in rows(S)])


def bow(S, out):
    b = "blue"
    e = options(S, BOW, [("idle", 7, 0, b)] + [("walk", 0, k, b) for k in range(8)], [("idle", 7, 0, b), ("idle", 6, 0, b)] + [("walk", 0, k, b) for k in (0, 2, 4, 6)] + [("walk", 6, 2, b), ("walk", 6, 6, b)], 2.0)
    w = options(S, BOW_W, [("idle", 7, 0, b), ("walk", 0, 2, b), ("walk", 0, 6, b)], [("idle", 7, 0, b), ("walk", 0, 2, b), ("walk", 0, 6, b)], 2.0)
    R.sheet(out, "R23-01-遠程兵的右手-改前改後-phone", [
        ("第 10 項：遠程兵待機和走路時，右臂從平舉在腰前改成自然垂下、走路時擺動。兩國同一組動作。攻擊（拉弓）不變。", B.font(32), B.PALE),
        (SRC, B.font(26, False), B.GREY),
    ], [R.block("東陸：待機（兩個方向）、走路的 8 格（手機）和第 1、3、5、7 格、從正面看第 3、7 格", "", e), R.block("西陸：待機、走路第 3、7 格", "", w)])


def one_item(S, out, label, title, note, opts, phone, bigs, n=2.0, extra=None):
    blocks = [R.block(title, "", options(S, opts, phone, bigs, n))]
    if extra is not None:
        blocks.append(extra)
    R.sheet(out, label, [(note, B.font(30), B.PALE), (SRC, B.font(26, False), B.GREY)], blocks)


def shards(S, out):
    b = "blue"
    one_item(S, out, "R23-02-護盾碎片-選項-phone", "第 11 項：護盾碎掉的 8 格（手機），和第 2、3、4、5 格放大", NOTE11, SHARD,
             [("shatter", 7, k, b) for k in range(8)], [("shatter", 7, k, b) for k in (1, 2, 3, 4)])


def farmer(S, out):
    b, r = "blue", "red"
    one_item(S, out, "R23-03-西陸農民玩家色-選項-phone", "第 13 項：待機三個方向（藍），走路、種田各一格，和紅色的待機", NOTE13, FARMER,
             [("idle", 7, 0, b), ("idle", 6, 0, b), ("idle", 0, 0, b), ("idle", 7, 0, r), ("idle", 6, 0, r), ("walk", 7, 2, b), ("work_farm", 7, 3, b)],
             [("idle", 7, 0, b), ("idle", 6, 0, b), ("idle", 0, 0, b), ("idle", 7, 0, r), ("walk", 7, 2, b), ("work_farm", 7, 3, b)])


def circle(S, opts, n=6.0):
    """The circle before the hand, cast frame 19 facing right-down, n times: each option's, the same window (as wide
    as the effects layer above the circle at the feet, down to that circle's top)."""
    import numpy as np
    shots, box = [], None
    for name, _, f, t in opts:
        prefix = S.root / f / f"{t}_cast_f7_19"
        (im, ax, ay), _ = S16.farmer(str(prefix), "blue")
        fx = Image.open(f"{prefix}_x3_fx.png").convert("RGBA")
        a = np.asarray(fx)[..., 3] > 40
        a[int(ay) - 28:] = False                 # (the circle at the feet reaches 28 px up from the anchor)
        ys, xs = np.nonzero(a)
        b = (xs.min() - 6, ys.min() - 6, xs.max() + 7, int(ay) - 14)
        box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
        im.alpha_composite(fx)
        shots.append((name, im))
    cells = []
    for name, im in shots:
        bg = Image.new("RGBA", im.size, (*S.bg, 255))
        bg.alpha_composite(im)
        cells.append(R.titled(A.enlarge(bg.convert("RGB").crop(box), n), name, B.YEL if name != "現況" else RED, 30, True))
    return R.join(cells, 24)


def sigil(S, out):
    b = "blue"
    one_item(S, out, "R23-04-東陸法陣-選項-phone", "第 14 項：施法的第 18–23 格（手機），第 20 格兩個方向放大", NOTE14, SIGIL,
             [("cast", 7, k, b) for k in range(17, 23)], [("cast", 7, 19, b), ("cast", 0, 19, b)], 2.5,
             extra=R.block("法陣放大 6 倍（朝右下的第 20 格）", "", circle(S, SIGIL)))


def mage(S, out):
    b, r = "blue", "red"
    one_item(S, out, "R23-05-東陸法師玩家色-選項-phone", "第 15 項：待機三個方向，藍、紅各一排", NOTE15, MAGE,
             [("idle", 7, 0, b), ("idle", 6, 0, b), ("idle", 0, 0, b), ("idle", 7, 0, r), ("idle", 6, 0, r), ("idle", 0, 0, r)],
             [("idle", 7, 0, b), ("idle", 6, 0, b), ("idle", 0, 0, b), ("idle", 7, 0, r), ("idle", 6, 0, r), ("idle", 0, 0, r)])


REFS = [
    ("第 14 項 東陸的法陣", ["唐代的銅鏡有鑄八卦的：",
                       "・克里夫蘭藝術博物館 1995.351（8 世紀中晚期），銘文「上圓下方，象于天地。中列八卦，備著陰陽」。",
                       "・京都國立博物館「日月貞明八卦鏡」（唐）；聖路易藝術博物館八卦紋的八瓣鏡（8–9 世紀）。",
                       "唐代道教的鏡子也有畫北斗和北極星的（Early China 期刊〈A Tang Taoist Mirror〉）。",
                       "太極圖（陰陽魚）一般認為宋代才有，比唐末五代晚，沒有用。雲雷紋是商周青銅器的紋樣，也沒有用。"]),
    ("第 13 項 西陸農民", ["兜帽連著披肩是一件衣服（R8 查過），戴起來或垂在背後都有。", "圍裙：R8 把 R5 有圍兜的圍裙拿掉了；B 是只圍腰以下的布，沒有另外查出處。"]),
    ("第 15 項 東陸法師", ["帔和芙蓉冠是照唐代道士的法服做的（R8：《洞玄靈寶三洞奉道科戒營始》、《三洞法服科戒文》），兩個選項都留著。", "袖口、領子鑲別的顏色沒有另外查出處，是設計上的選擇。"]),
    ("第 11 項 護盾碎片", ["沒有出處可查。當初不透明是技術上的原因（半透明的碎片正面看幾乎看不到）。"]),
]


def refs(S, out):
    f, fb = B.font(27, False), B.font(30)
    W = 2500
    rs = [(name, [ln for t in lines for ln in B.wrap(B.TMP, t, f, W - 440)]) for name, lines in REFS]
    img = Image.new("RGB", (W, sum(len(ls) * 38 + 30 for _, ls in rs)), B.BG)
    d = ImageDraw.Draw(img)
    y = 0
    for i, (name, ls) in enumerate(rs):
        h = len(ls) * 38 + 30
        d.rectangle([0, y, W, y + h - 6], fill=B.PANEL if i % 2 == 0 else (30, 33, 38))
        d.text((10, y + 12), name, font=fb, fill=B.YEL)
        for k, ln in enumerate(ls):
            d.text((400, y + 12 + 38 * k), ln, font=f, fill=B.WHITE)
        y += h
    R.sheet(out, "R23-00-參考資料-phone", [
        ("第 4 批的出處。只給 ceo 判斷用；沒有放參考圖片。", B.font(32), B.PALE),
        ("館藏的說法取自搜尋結果的摘要，沒有逐頁打開核對；R8 的出處是當時查的。", B.font(26, False), B.GREY),
    ], [img])


def main():
    S = Shots(Path(sys.argv[1]), Path(sys.argv[2]))
    out = Path(sys.argv[3])
    out.mkdir(parents=True, exist_ok=True)
    for f in (refs, overview, bow, shards, farmer, sigil, mage):
        if len(sys.argv) < 5 or f.__name__ in sys.argv[4:]:
            f(S, out)


if __name__ == "__main__":
    main()
