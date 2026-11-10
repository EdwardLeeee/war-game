"""R20 boards (D-142: all of R19's findings; this batch the farmers, items 1-5 and 12): before and after side by side,
no options (sizes, materials and holds after R16's approved ones), a sentence of what changed each.

  R20-00-參考資料            what was found of the real things (words only)
  R20-總覽-農民-phone        the batch on one picture: an item a row, before | after (the phone's size and enlarged)
  R20-01-工具-改前改後        the axe, the pick and the mallet, both farmers
  R20-02-東陸平常拿斧頭-改前改後   standing, walking, fallen
  R20-03-東陸攻擊-改前改後     the ten frames
  R20-04-砍樹挖礦蓋房-改前改後  every frame of the three work loops, both farmers; the pick's raise from the front

Both sides are drafts of the same local pipeline (render_r20.py; before: R20 unset, art-v7.8's code).

python3 design/r20/common/boards_r20.py DRAFTS ART_X3 OUT
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
for d in ("r16", "r19"):
    sys.path.insert(0, str(HERE.parents[1] / d / "common"))
import art_r19 as A       # noqa: E402
import boards_r19 as B    # noqa: E402
import scene_r16 as S16   # noqa: E402

M = B.M
NAME = {"e": "東陸", "w": "西陸"}
WHAT = {
    "axe": "斧頭（兩國共用）：頭長 41→18.5 公分、刃口 34→11.5 公分；亮鋼改成暗色舊鐵，刃口一條略亮的細線。",
    "carry": "東陸平常拿斧頭：右手握在斧頭下面（斧頭的重心）垂在身側，刃朝下；左手自然垂下，走路時擺動。改前是握柄尾、斧頭擱在一步外的地上。",
    "pick": "十字鎬（兩國共用）：兩尖全長 80→50 公分、根部 9→4 公分粗；亮鋼改成暗色舊鐵，尖端磨亮。",
    "mallet": "木槌（兩國共用）：槌頭 17×34→8.5×16.5 公分；拿掉鐵箍，整支木頭。",
    "attack": "東陸攻擊：兩手握柄，斧頭從右側繞到右肩後面，再往前劈到腰的高度。改前是單手握柄尾、兩臂伸直高舉。格數、打中那一格都不變。",
    "raise": "挖礦舉鎬（兩國共用的動作）：改成舉過右肩，左前臂不再橫在臉前。",
}
SRC = "改前、改後都是本機用同一條流程算的草稿（改前＝art-v7.8 的程式）；使用者核准後才進 CI 正式算圖。圖在草地的顏色上；「手機」是 iPhone 上的實際大小（最左邊一名槍兵當比例），其餘放大。"


class Drafts:
    def __init__(self, root, art):
        self.root, self.art = Path(root), art
        self.spear = A.Unit(art, "spear_e")
        self.bg = A.grass_colour(art)
        self._s = {}

    def spr(self, c, new, anim, face, k, team="blue"):
        key = (c, new, anim, face, k, team)
        if key not in self._s:
            tag = f"{c}{'N' if new else 'O'}"
            (im, ax, ay), sh = S16.farmer(str(self.root / f"{c}_{'new' if new else 'old'}" / f"{tag}_{anim}_f{face}_{k:02d}"), team)
            bb = im.getbbox()                      # the render's frame is far wider than the figure: only what is drawn
            im, ax, ay = im.crop(bb), ax - bb[0], ay - bb[1]
            if sh:
                si, sx, sy = sh
                sb = si.getbbox()
                sh = (si.crop(sb), sx - sb[0], sy - sb[1]) if sb else None
            self._s[key] = ((im, ax, ay), sh)
        return self._s[key]

    def box(self, c, anim, face, frames, pad=6):
        """(l, t, r, b) round the anchor that holds these frames before and after: both sides the same cell."""
        l = t = r = b = 0
        for new in (False, True):
            for k in frames:
                (im, ax, ay), sh = self.spr(c, new, anim, face, k)
                l, t, r, b = max(l, ax), max(t, ay), max(r, im.width - ax), max(b, im.height - ay)
                if sh:                             # room for its shadow, to a point
                    si, sx, sy = sh
                    r, b = max(r, min(si.width - sx, im.width - ax + 45)), max(b, min(si.height - sy, im.height - ay + 14))
        return tuple(int(v) + pad for v in (l, t, r, b))

    def big(self, c, new, anim, face, k, n, box=None):
        l, t, r, b = box or self.box(c, anim, face, [k])
        st = A.Stage(Image.new("RGB", (l + r, t + b), self.bg))
        st.put(self.spr(c, new, anim, face, k), l, t)
        return A.enlarge(st.render(), n)

    def bigs(self, c, new, anim, face, frames, n, gap=4):
        box = self.box(c, anim, face, frames)
        cells = [self.big(c, new, anim, face, k, n, box) for k in frames]
        img = Image.new("RGB", (sum(x.width for x in cells) + gap * (len(cells) - 1), cells[0].height), B.BG)
        x = 0
        for cell in cells:
            img.paste(cell, (x, 0))
            x += cell.width + gap
        return img

    def phone(self, c, new, anim, face, frames, step=0):
        """The frames in a row at the phone's size on the grass, a spearman first; step: px on a frame (walking)."""
        l, t, r, b = self.box(c, anim, face, frames, pad=3)
        sl, stp, sr, sb = B.pad(self.spear.box("idle", [7], [0]), 3)
        T, Bm = max(t, stp), max(b, sb)
        cw = l + r
        st = A.Stage(A.grass(self.art, sl + sr + len(frames) * cw + (step * len(frames) if step else 0), T + Bm))
        st.put(self.spear.sprite("idle", 7, 0, "blue"), sl, T)
        for i, k in enumerate(frames):
            st.put(self.spr(c, new, anim, face, k), sl + sr + i * cw + l, T)
        return A.phone(st.render())


def join(parts, gap=10, vertical=False):
    parts = [p for p in parts if p is not None]
    if vertical:
        img = Image.new("RGB", (max(p.width for p in parts), sum(p.height for p in parts) + gap * (len(parts) - 1)), B.BG)
        y = 0
        for p in parts:
            img.paste(p, (0, y))
            y += p.height + gap
        return img
    img = Image.new("RGB", (sum(p.width for p in parts) + gap * (len(parts) - 1), max(p.height for p in parts)), B.BG)
    x = 0
    for p in parts:
        img.paste(p, (x, 0))
        x += p.width + gap
    return img


def titled(img, text, colour=B.GREY, size=26, bold=False):
    f = B.font(size, bold)
    out = Image.new("RGB", (max(img.width, round(B.TMP.textlength(text, font=f)) + 8), img.height + size + 12), B.BG)
    ImageDraw.Draw(out).text((2, 0), text, font=f, fill=colour)
    out.paste(img, (0, size + 12))
    return out


def pair(before, after, vertical=False):
    """改前 | 改後, each under its word."""
    return join([titled(before, "改前", (255, 150, 130), 30, True), titled(after, "改後", (150, 230, 150), 30, True)], gap=36, vertical=vertical)


def block(title, line, body, W=None):
    """An item: its title, a sentence of what changed, the pictures."""
    ft, fl = B.font(36), B.font(27, False)
    w = max(body.width, W or 0)
    lines = B.wrap(B.TMP, line, fl, w - fl.size) if line else []
    img = Image.new("RGB", (w, 54 + len(lines) * 38 + 8 + body.height + 26), B.BG)
    d = ImageDraw.Draw(img)
    d.line([(0, 4), (w, 4)], fill=(70, 74, 82), width=2)
    d.text((0, 12), title, font=ft, fill=B.WHITE)
    y = 60
    for ln in lines:
        d.text((4, y), ln, font=fl, fill=B.PALE)
        y += 38
    img.paste(body, (0, y + 8))
    return img


def sheet(out, label, lines, blocks):
    W = max(b.width for b in blocks) + 2 * M
    hd = []
    y = 16 + 78
    for text, f, col in lines:
        for ln in B.wrap(B.TMP, text, f, W - 2 * M - f.size):
            hd.append((ln, f, col, y))
            y += f.size + 14
    img = Image.new("RGB", (W, y + 16 + sum(b.height for b in blocks) + M), B.BG)
    d = ImageDraw.Draw(img)
    d.text((M, 16), label, font=B.font(56), fill=B.WHITE)
    for ln, f, col, yy in hd:
        d.text((M, yy), ln, font=f, fill=col)
    y += 16
    for b in blocks:
        img.paste(b, (M, y))
        y += b.height
    p = out / f"{label}.png"
    img.save(p, optimize=True)
    print(p.name, img.size)


def side(D, c, new, anim, phone_frames, bigs, n=3, face=7):
    """One side of a pair: the phone's row, then enlarged cells [(face, [frames])]."""
    parts = [titled(D.phone(c, new, anim, face, phone_frames), "手機")]
    parts.append(join([D.bigs(c, new, anim, f, ks, n) for f, ks in bigs], gap=4))
    return join(parts, gap=18)


def overview(D, out):
    def one(c, anim, face, phone_frames, bigs, n=2.2):       # a side: the phone's row over the enlarged frames
        return lambda new: join([titled(D.phone(c, new, anim, face, phone_frames), "手機"),
                                 join([D.bigs(cc, new, a, f, ks, n) for cc, a, f, ks in bigs], 8)], 10, vertical=True)
    rows = [
        ("1　斧頭太大太白", WHAT["axe"], one("e", "work_chop", 7, [0, 4, 6], [("e", "work_chop", 0, [6]), ("e", "death", 7, [9])])),
        ("2　東陸農民平常拿斧頭", WHAT["carry"], one("e", "walk", 0, [0, 2, 6], [("e", "idle", 7, [0]), ("e", "walk", 0, [2])])),
        ("3　十字鎬太大太白", WHAT["pick"], one("e", "work_mine", 7, [1, 4, 6], [("e", "work_mine", 0, [1]), ("w", "work_mine", 7, [4])])),
        ("4　木槌的槌頭和人頭一樣大", WHAT["mallet"], one("e", "work_build", 7, [0, 2, 4], [("e", "work_build", 6, [0]), ("w", "work_build", 7, [2])])),
        ("5　東陸農民攻擊", WHAT["attack"], one("e", "attack", 7, [0, 5, 7], [("e", "attack", 0, [5, 7])])),
        ("12　挖礦時左前臂橫在臉前", WHAT["raise"], one("e", "work_mine", 7, [1, 2], [("e", "work_mine", 6, [1, 2])])),
    ]
    bodies = [(t, line, pair(f(False), f(True))) for t, line, f in rows]
    W = max(b.width for _, _, b in bodies)
    blocks = [block(t, line, b, W) for t, line, b in bodies]
    grid, cols = [], 3                           # three columns: read across, then down
    for k in range(0, len(blocks), cols):
        part = blocks[k:k + cols]
        row = Image.new("RGB", (cols * W + (cols - 1) * 60, max(b.height for b in part)), B.BG)
        for i, b in enumerate(part):
            row.paste(b, (i * (W + 60), 0))
        grid.append(row)
    sheet(out, "R20-總覽-農民-phone", [
        ("第 1 批 農民（R19 的第 1–5、12 項）：工具照鋤頭（R16 選 A）的標準改成真實大小、暗色舊鐵；拿法和攻擊照真的做法。每一項左邊改前、右邊改後。可以或不行，看這一張就夠；細的在 R20-01 到 R20-04。", B.font(32), B.PALE),
        (SRC, B.font(26, False), B.GREY),
    ], grid)


def tools(D, out):
    blocks = []
    for title, key, anim, bigs in (("斧頭（砍樹）", "axe", "work_chop", [(7, [4]), (0, [6])]), ("十字鎬（挖礦）", "pick", "work_mine", [(7, [4]), (0, [1])]),
                                   ("木槌（蓋房）", "mallet", "work_build", [(7, [2]), (6, [0])])):
        body = join([titled(pair(side(D, c, False, anim, list(range(8)), bigs), side(D, c, True, anim, list(range(8)), bigs)), NAME[c], B.WHITE, 30, True)
                     for c in ("e", "w")], gap=20, vertical=True)
        blocks.append(block(title, WHAT[key], body))
    sheet(out, "R20-01-工具-改前改後-phone", [
        ("三樣工具照鋤頭（R16 選 A）的標準：真實大小、暗色舊鐵。兩國農民用同一把。出處在 R20-00。", B.font(32), B.PALE),
        (SRC, B.font(26, False), B.GREY),
    ], blocks)


def carry(D, out):
    def body(anim, phone_frames, bigs, n=3):
        return pair(side(D, "e", False, anim, phone_frames, bigs, n), side(D, "e", True, anim, phone_frames, bigs, n))
    blocks = [
        block("待機", WHAT["carry"], body("idle", [0, 2, 4, 6], [(7, [0]), (0, [0]), (6, [0])])),
        block("走路", "", pair(join([titled(D.phone("e", False, "walk", 0, list(range(8))), "手機"), D.bigs("e", False, "walk", 0, [0, 2, 4, 6], 2.5), D.bigs("e", False, "walk", 7, [2, 6], 2.5)], 14, True),
                             join([titled(D.phone("e", True, "walk", 0, list(range(8))), "手機"), D.bigs("e", True, "walk", 0, [0, 2, 4, 6], 2.5), D.bigs("e", True, "walk", 7, [2, 6], 2.5)], 14, True))),
        block("倒下（斧頭鬆手、落在身旁；倒下的動作這一批沒有改）", "", pair(join([titled(D.phone("e", False, "death", 7, [0, 3, 6, 9]), "手機"), D.bigs("e", False, "death", 7, [9], 3), D.bigs("e", False, "death", 0, [9], 3)], 18),
                                                      join([titled(D.phone("e", True, "death", 7, [0, 3, 6, 9]), "手機"), D.bigs("e", True, "death", 7, [9], 3), D.bigs("e", True, "death", 0, [9], 3)], 18))),
    ]
    sheet(out, "R20-02-東陸平常拿斧頭-改前改後-phone", [
        ("東陸農民不工作時怎麼拿斧頭（待機、走路、倒下）。拿法照美國林務署的手工具守則：握在靠近斧頭、拿起來平衡的地方，刃朝下，手臂自然垂在身側。", B.font(32), B.PALE),
        (SRC, B.font(26, False), B.GREY),
    ], blocks)


def attack(D, out):
    ks = list(range(10))
    def rows(new):
        return join([titled(D.phone("e", new, "attack", 7, ks), "手機"), titled(D.bigs("e", new, "attack", 7, ks, 2.2), "朝右下，第 1–10 格（第 8 格打中）"),
                     titled(D.bigs("e", new, "attack", 0, ks, 2.2), "朝右")], 12, True)
    sheet(out, "R20-03-東陸攻擊-改前改後-phone", [
        (WHAT["attack"], B.font(32), B.PALE),
        (SRC, B.font(26, False), B.GREY),
    ], [block("攻擊的 10 格", "", pair(rows(False), rows(True), vertical=True))])


def works(D, out):
    ks = list(range(8))
    blocks = []
    for title, key, anim in (("砍樹", "axe", "work_chop"), ("挖礦", "pick", "work_mine"), ("蓋房", "mallet", "work_build")):
        body = join([titled(pair(D.bigs(c, False, anim, 7, ks, 2), D.bigs(c, True, anim, 7, ks, 2)), NAME[c], B.WHITE, 30, True) for c in ("e", "w")], 16, True)
        blocks.append(block(f"{title}的 8 格", WHAT[key], body))
    arm = join([titled(pair(D.bigs(c, False, "work_mine", 6, [1, 2], 3), D.bigs(c, True, "work_mine", 6, [1, 2], 3)), NAME[c] + "，從正面看第 2、3 格", B.WHITE, 30, True)
                for c in ("e", "w")], 40)
    blocks.append(block("挖礦舉鎬時的左手", WHAT["raise"], arm))
    sheet(out, "R20-04-砍樹挖礦蓋房-改前改後-phone", [
        ("三個工作動作每一格，兩國。入土／打中的那一格不變（砍樹、挖礦第 5 格，蓋房第 3 格）。", B.font(32), B.PALE),
        (SRC, B.font(26, False), B.GREY),
    ], blocks)


REFS = [
    ("斧頭", "頭長 41 公分、刃口 34 公分，亮鋼色",
     ["中古出土的鐵斧：長 15.5–17.5 公分、刃口 12–15 公分。",
      "・蘇格蘭 Dingwall 出土（Highland HER MHG9044，只寫「中古」）：長 15.5、刃口 12.3 公分",
      "・Caerlaverock 城出土（Historic Environment Scotland，只寫「中古」）：17.5 × 15 公分",
      "館藏的鐵斧頭，年代和出土地沒查到：Worcester Art Museum（原 Higgins Armory）10.2 × 19.1 公分，哪一邊是刃口不確定。",
      "唐代鐵斧的出土尺寸沒有查到，東陸也用同一個大小。"],
     "頭長 18.5、刃口 11.5 公分，暗色舊鐵、刃口磨亮"),
    ("十字鎬", "兩尖全長 80 公分、根部 9 公分粗，亮鋼色",
     ["羅馬軍用的鎬（dolabra）：全長 33–52.5 公分（羅馬尼亞 Transylvania 國立歷史博物館的館藏紀錄）。",
      "現在的 5 磅鎬頭：48–55 公分（Garant、Truper、Nupla 的商品規格）。",
      "唐宋礦工的工具尺寸沒有查到，東陸也用同一個大小。"],
     "全長 50 公分、根部 3.8 公分粗，暗色舊鐵、尖端磨亮"),
    ("木槌", "槌頭 17 × 34 公分，兩道鐵箍",
     ["細木工的木槌：槌頭 6 × 12 到 8 × 14 公分（Narex、Stubai 的商品規格）。",
      "老式的做法槌頭長 15–16.5 公分（The Woodwright's Shop「Big Ash Mallet」）。"],
     "槌頭 8.5 × 16.5 公分，整支木頭"),
    ("平常怎麼拿斧頭", "握柄尾、整根往前伸，斧頭擱在一步外的地上",
     ["美國林務署的手工具守則（USDA Forest Service《An Ax to Grind》和志工手冊）：",
      "握在靠近斧頭、拿起來平衡的地方，刃朝下，手臂自然垂在身側；不要扛在肩上。"],
     "右手握在斧頭下面、垂在身側，刃朝下"),
    ("用斧頭攻擊", "單手握柄尾，兩臂伸直舉過頭",
     ["沒有另外找出處。照西陸農民用鋤頭攻擊的做法（R16 使用者核准）：兩手握柄，舉過右肩往前劈。"],
     "兩手握柄，從右側繞到右肩後面，往前劈到腰的高度"),
]


def refs(D, out):
    cols = [("", 300), ("現在（art-v7.8）", 520), ("查到的", 1300), ("改後", 560)]
    f, fb = B.font(27, False), B.font(30)
    W = sum(w for _, w in cols)
    rows = []
    for name, now, found, after in REFS:
        cells = [[name], B.wrap(B.TMP, now, f, cols[1][1] - 40), [ln for t in found for ln in B.wrap(B.TMP, t, f, cols[2][1] - 40)],
                 B.wrap(B.TMP, after, f, cols[3][1] - 40)]
        rows.append((cells, max(len(c) for c in cells) * 38 + 28))
    img = Image.new("RGB", (W, 56 + sum(h for _, h in rows)), B.BG)
    d = ImageDraw.Draw(img)
    xs = [0]
    for _, w in cols:
        xs.append(xs[-1] + w)
    for (name, _), x in zip(cols, xs):
        d.text((x + 10, 8), name, font=fb, fill=B.WHITE)
    y = 56
    for i, (cells, h) in enumerate(rows):
        d.rectangle([0, y, W, y + h - 6], fill=B.PANEL if i % 2 == 0 else (30, 33, 38))
        for k, (c, x) in enumerate(zip(cells, xs)):
            yy = y + 12
            for ln in c:
                d.text((x + 10, yy), ln, font=fb if k == 0 else f, fill=B.YEL if k == 0 else B.WHITE)
                yy += 38
        y += h
    sheet(out, "R20-00-參考資料-phone", [
        ("第 1 批農民的出處：三樣工具真的多大、斧頭平常怎麼拿。只給 ceo 判斷用；沒有放參考圖片。", B.font(32), B.PALE),
        ("數字取自各館藏紀錄和商品頁在搜尋結果裡的摘要，沒有逐頁打開核對。之前的工具是故意做大的（程式註解寫「放大到手機上看得出來」）；R16 使用者選了真實大小，這一批照同一個標準。", B.font(26, False), B.GREY),
    ], [img])


def main():
    drafts, art, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    out.mkdir(parents=True, exist_ok=True)
    D = Drafts(drafts, art)
    for f in (refs, overview, tools, carry, attack, works):
        if len(sys.argv) < 5 or f.__name__ in sys.argv[4:]:
            f(D, out)


if __name__ == "__main__":
    main()
