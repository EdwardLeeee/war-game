"""R21 boards (D-142: R19's items 6 and 7, the siege engines): options for the user.

  R21-總覽-攻城砲-phone                 both items on one picture, an item a row, its options side by side
  R21-00-參考資料-phone                  what was found (words only)
  R21-01-東陸拉繩-<A|B|C>-…-phone        an option a picture: the throw's 10 frames, the phone's size
  R21-02-西陸移動-<A|B>-…-phone          an option a picture: the walk's 8 frames from two sides
  R21-東陸-發射-各選項-phone.gif, R21-西陸-走路-各選項-phone.gif

The engines are drafts of the local pipeline (render_r21.py; R21_E, R21_W). The East's pullers (B, C) are a farmer
hauling a rope (R21_PULL), rendered apart and laid over the engine where they would stand: a mock-up, said so on the
boards; made into the engine's own pictures only if chosen.

python3 design/r21/common/boards_r21.py DRAFTS ART_X3 OUT [overview refs east west gifs]
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "r20" / "common"))
import boards_r20 as R    # noqa: E402  (join, titled, block, sheet; art_r19 as R.A, boards_r19 as R.B, scene_r16)

A, B, S16 = R.A, R.B, R.S16
sys.path.insert(0, str(HERE.parents[1] / "r14" / "common"))
import scene_r14 as S14   # noqa: E402

PULLERS = {"B": [(-0.38, 2.05), (0.38, 2.05)], "C": [(-0.95, 2.25), (-0.33, 2.0), (0.33, 2.0), (0.95, 2.25)]}   # anims.PULLERS_R21
EAST = [("0", "現況", "四條拉繩垂到地上；發射時砲桿甩出去，繩子還掛在原地。"),
        ("A", "A 繩子跟著動", "拉繩的上端跟著砲桿的短端走，握把留在地上；還是沒有人。只改動作，工最小。"),
        ("B", "B 兩名拽手", "兩個人站在砲前各拉一條繩：往下拉到膝蓋，砲桿甩上去，再站起來。"),
        ("C", "C 四名拽手", "四個人拉四條繩。和 B 一樣，圖更寬。")]
WEST = [("0", "現況", "固定的木架，沒有輪子；走路的 8 格是同一張圖，整台貼著地面滑。"),
        ("A", "A 四個小木輪", "底架四角加實心小木輪（半徑 24 公分），走路時轉。"),
        ("B", "B 墊滾木", "底架下墊五根滾木，走路時往後滾。前面會憑空多一根、後面那根憑空消失（沒有人搬）。")]
EAST_NOTE = ("《武經總要》前集卷十二：最小的手砲「用二人放」，單梢砲「四十人拽，一人定放」；四輪的「炮車」和現在這台對得上。"
             "B、C 的人是另外算再疊上去的示意（用農民的樣子）；選了才正式做進砲的圖裡：人要有玩家色、走路時跟著走、砲垮時一起倒，東陸攻城砲的工從「中」變「大」。")
WEST_NOTE = ("固定木架是 2026-10-21 照史實改的：配重砲是拆開運、到了再組，帶輪子的在中古圖像裡少見。A、B 都是遷就遊戲（單位要會走）。"
             "A 的輪子會跟著前進的距離轉；B 的滾木沒有人搬，循環接起來的地方看得到一根消失、一根出現。")
SRC = "都是本機算的草稿，使用者選了才進 CI 正式算圖。圖在草地的顏色上；「手機」是 iPhone 上的實際大小（最左邊一名槍兵當比例），其餘放大。"


class Shots:
    def __init__(self, root, art):
        self.root, self.art = Path(root), art
        self.spear = A.Unit(art, "spear_e")
        self.bg = A.grass_colour(art)
        self._s = {}

    def spr(self, folder, tag, anim, face, k):
        key = (folder, anim, face, k)
        if key not in self._s:
            (im, ax, ay), sh = S16.farmer(str(self.root / folder / f"{tag}_{anim}_f{face}_{k:02d}"), "blue")
            bb = im.getbbox()
            im, ax, ay = im.crop(bb), ax - bb[0], ay - bb[1]
            if sh:
                si, sx, sy = sh
                sb = si.getbbox()
                sh = (si.crop(sb), sx - sb[0], sy - sb[1]) if sb else None
            self._s[key] = ((im, ax, ay), sh)
        return self._s[key]

    def east(self, opt, anim, k, face):
        """[(sprite, dx, dy)] back to front, px from the engine's anchor: the engine, and for B and C its pullers
        where they stand, turned to it (the engine's facing + 4: the rendered facing mirrored)."""
        items = [(0.0, self.spr(f"e_{opt}", f"e{opt}", anim, face, k), 0, 0)]
        a = math.radians(face * 45)
        for px, py in PULLERS.get(opt, []):
            e, n = px * math.sin(a) + py * math.cos(a), -px * math.cos(a) + py * math.sin(a)
            crew = S14.mirror(self.spr("crew", "cr", anim, {7: 1, 0: 0}[face], k))
            items.append((n, crew, round(60 * e), round(-30 * n)))
        return [(s, dx, dy) for _, s, dx, dy in sorted(items, key=lambda t: -t[0])]

    def west(self, opt, anim, k, face):
        return [(self.spr(f"w_{opt}", f"w{opt}", anim, face, k), 0, 0)]

    def box(self, scenes, pad=6):
        l = t = r = b = 0
        for items in scenes:
            for ((im, ax, ay), sh), dx, dy in items:
                l, t = max(l, ax - dx), max(t, ay - dy)
                r, b = max(r, im.width - ax + dx), max(b, im.height - ay + dy)
                if sh:
                    r, b = max(r, min(sh[0].width - sh[1], im.width - ax + 60) + dx), max(b, min(sh[0].height - sh[2], im.height - ay + 20) + dy)
        return tuple(int(v) + pad for v in (l, t, r, b))

    def big(self, scenes, n, box=None, gap=4):
        """The scenes side by side on the grass's colour, n times."""
        l, t, r, b = box or self.box(scenes)
        cells = []
        for items in scenes:
            st = A.Stage(Image.new("RGB", (l + r, t + b), self.bg))
            for spr, dx, dy in items:
                st.put(spr, l + dx, t + dy)
            cells.append(A.enlarge(st.render(), n))
        return R.join(cells, gap)

    def phone(self, scenes, box=None, step=0):
        """The scenes in a row at the phone's size on the grass, a spearman first."""
        l, t, r, b = box or self.box(scenes, pad=3)
        sl, stp, sr, sb = B.pad(self.spear.box("idle", [7], [0]), 3)
        T, Bm = max(t, stp), max(b, sb)
        st = A.Stage(A.grass(self.art, sl + sr + len(scenes) * (l + r), T + Bm))
        st.put(self.spear.sprite("idle", 7, 0, "blue"), sl, T)
        for i, items in enumerate(scenes):
            for spr, dx, dy in items:
                st.put(spr, sl + sr + i * (l + r) + l + dx, T + dy)
        return A.phone(st.render())

    def area(self, scenes):
        l, t, r, b = self.box(scenes, pad=0)
        return (l + r) * (t + b)


def column(title, line, parts, w=None):
    """An option: its name, a sentence, its pictures under each other."""
    f, ft = B.font(26, False), B.font(34)
    body = R.join(parts, 12, vertical=True)
    w = max(body.width, w or 0)
    lines = B.wrap(B.TMP, line, f, w - f.size)
    img = Image.new("RGB", (w, 50 + len(lines) * 36 + 10 + body.height), B.BG)
    d = ImageDraw.Draw(img)
    d.text((0, 2), title, font=ft, fill=B.YEL if title != "現況" else (255, 150, 130))
    y = 50
    for ln in lines:
        d.text((2, y), ln, font=f, fill=B.WHITE)
        y += 36
    img.paste(body, (0, y + 10))
    return img


def columns(cols, gap=40):
    w = max(c[2][0].width for c in cols)
    done = [column(t, line, parts) for t, line, parts in cols]
    w = max(d.width for d in done)
    return R.join([column(t, line, parts, w) for t, line, parts in cols], gap)


def east_cols(S, n, frames=(0, 2, 3, 4, 6), bigs=(0, 3)):
    all_scenes = [S.east(o, "attack", k, 7) for o, _, _ in EAST for k in range(10)]
    box, pbox = S.box(all_scenes), S.box(all_scenes, pad=3)
    cols = []
    for o, name, line in EAST:
        cols.append((name, line, [R.titled(S.phone([S.east(o, "attack", k, 7) for k in frames], pbox), "手機：發射的第 1、3、4、5、7 格"),
                                  S.big([S.east(o, "attack", k, 7) for k in bigs], n, box)]))
    return cols


def west_cols(S, n):
    all7 = [S.west(o, "walk", k, 7) for o, _, _ in WEST for k in range(8)]
    all0 = [S.west(o, "walk", k, 0) for o, _, _ in WEST for k in range(8)]
    b7, p7, b0 = S.box(all7), S.box(all7, pad=3), S.box(all0)
    cols = []
    for o, name, line in WEST:
        cols.append((name, line, [R.titled(S.phone([S.west(o, "walk", k, 7) for k in (0, 2, 4, 6)], p7), "手機：走路的第 1、3、5、7 格"),
                                  R.join([S.big([S.west(o, "idle", 0, 7)], n, b7), S.big([S.west(o, "walk", 2, 0)], n, b0)], 6)]))
    return cols


def grow(S):
    """How much wider the East's pictures get with the pullers: the area of the throw's frames, against as it is."""
    base = S.area([S.east("0", "attack", k, 7) for k in range(10)])
    return {o: S.area([S.east(o, "attack", k, 7) for k in range(10)]) / base for o in "ABC"}


def overview(S, out):
    g = grow(S)
    e = R.block("6　東陸攻城砲：靠人拉繩發射，可是沒有人，發射時繩子不動", EAST_NOTE + f"　圖的面積：A 不變，B 約多 {g['B'] * 100 - 100:.0f}%，C 約多 {g['C'] * 100 - 100:.0f}%（手機記憶體跟著多）。",
                columns(east_cols(S, 1.0)))
    w = R.block("7　西陸攻城砲：沒有輪子，走路時整台滑行", WEST_NOTE, columns(west_cols(S, 1.0)))
    R.sheet(out, "R21-總覽-攻城砲-phone", [
        ("第 2 批 攻城砲（R19 的第 6、7 項）：每一項一列，最左邊是現況，往右是選項。請各選一個；細的在 R21-01、R21-02。", B.font(32), B.PALE),
        (SRC, B.font(26, False), B.GREY),
    ], [e, w])


def east(S, out):
    all_scenes = [S.east(o, "attack", k, 7) for o, _, _ in EAST for k in range(10)]
    box, pbox = S.box(all_scenes), S.box(all_scenes, pad=3)
    b0 = S.box([S.east(o, "attack", k, 0) for o, _, _ in EAST for k in (0, 3)])
    g = grow(S)
    for o, name, line in EAST[1:]:
        ks = list(range(10))
        body = R.join([R.titled(S.phone([S.east(o, "attack", k, 7) for k in ks], pbox), "手機：發射的 10 格"),
                       R.titled(S.big([S.east(o, "attack", k, 7) for k in ks[:5]], 1.0, box), "放大：第 1–5 格（第 5 格石頭出手）"),
                       R.titled(S.big([S.east(o, "attack", k, 7) for k in ks[5:]], 1.0, box), "第 6–10 格"),
                       R.titled(R.join([S.big([S.east(o, "attack", k, 0) for k in (0, 3)], 1.0, b0), S.big([S.east(o, "idle", 0, 7)], 1.0, box)], 20),
                                "從側面看第 1、4 格；待機")], 14, vertical=True)
        extra = "" if o == "A" else f"　圖的面積約多 {g[o] * 100 - 100:.0f}%。人是另外算再疊上去的示意；選了才正式做（東陸攻城砲的工從「中」變「大」）。"
        R.sheet(out, f"R21-01-東陸拉繩-{name.replace(' ', '-')}-phone", [(line + extra, B.font(32), B.PALE), (SRC, B.font(26, False), B.GREY)],
                [R.block(name, "", body)])


def west(S, out):
    b7 = S.box([S.west(o, "walk", k, 7) for o, _, _ in WEST for k in range(8)])
    p7 = S.box([S.west(o, "walk", k, 7) for o, _, _ in WEST for k in range(8)], pad=3)
    b0 = S.box([S.west(o, "walk", k, 0) for o, _, _ in WEST for k in range(8)])
    for o, name, line in WEST[1:]:
        ks = list(range(8))
        body = R.join([R.titled(S.phone([S.west(o, "walk", k, 7) for k in ks], p7), "手機：走路的 8 格"),
                       R.titled(S.big([S.west(o, "walk", k, 7) for k in ks[:4]], 1.0, b7), "放大：第 1–4 格"),
                       R.titled(S.big([S.west(o, "walk", k, 7) for k in ks[4:]], 1.0, b7), "第 5–8 格"),
                       R.titled(S.big([S.west(o, "walk", k, 0) for k in (0, 2, 4, 6)], 1.0, b0), "從側面看第 1、3、5、7 格")], 14, vertical=True)
        R.sheet(out, f"R21-02-西陸移動-{name.replace(' ', '-')}-phone", [(line + "　不照史實，是遷就遊戲。", B.font(32), B.PALE), (SRC, B.font(26, False), B.GREY)],
                [R.block(name, "", body)])


REFS = [
    ("東陸的砲幾個人拉", ["《武經總要》前集卷十二（1044 年；維基文庫的錄文）：",
                    "・單梢砲「四十人拽，一人定放。放五十步外，石重二斤」；雙梢砲百人拽；五梢砲百五十七人拽；七梢砲二百五十人拽、二人定放。",
                    "・旋風砲「五十人拽，一人定放」；虎蹲砲「七十人拽，一人定放」。",
                    "・手砲「敵近則用之……用二人放，石重半斤」：最少的是兩個人。",
                    "・炮車「大木為床，下施四輪，上建獨竿」：四輪的砲車書裡有，現在東陸這台對得上。"]),
    ("西陸的砲有沒有輪子", ["配重砲（13 世紀起）是固定的木架，拆開用車運、到了再組（2026-10-21 照這個改成固定木架）。",
                     "帶輪子或滑橇底架的在中古圖像裡少見但有（R. Miners 整理的歷史插圖）；現代重建認為小型的可以推著走，輪子還能吸收發射時的晃動（NOVA 的重建）。",
                     "所以加輪子或滾木都不算照史實，是遷就遊戲：遊戲裡攻城砲是會走的單位。"]),
]


def refs(S, out):
    f, fb = B.font(27, False), B.font(30)
    W = 2500
    rows = [(name, [ln for t in lines for ln in B.wrap(B.TMP, t, f, W - 420)]) for name, lines in REFS]
    img = Image.new("RGB", (W, sum(len(ls) * 38 + 30 for _, ls in rows)), B.BG)
    d = ImageDraw.Draw(img)
    y = 0
    for i, (name, ls) in enumerate(rows):
        h = len(ls) * 38 + 30
        d.rectangle([0, y, W, y + h - 6], fill=B.PANEL if i % 2 == 0 else (30, 33, 38))
        d.text((10, y + 12), name, font=fb, fill=B.YEL)
        for k, ln in enumerate(ls):
            d.text((380, y + 12 + 38 * k), ln, font=f, fill=B.WHITE)
        y += h
    R.sheet(out, "R21-00-參考資料-phone", [
        ("第 2 批攻城砲的出處。只給 ceo 判斷用；沒有放參考圖片。", B.font(32), B.PALE),
        ("《武經總要》的句子是從維基文庫的錄文抄的，沒有對過刻本。配重砲那兩條取自搜尋結果的摘要，沒有逐頁打開核對。", B.font(26, False), B.GREY),
    ], [img])


def gifs(S, out):
    fh, fb = B.font(34), B.font(28, False)
    # the East: the throw, every option side by side, at 20 frames a second, held 1.5 s (the engine waits 5 s)
    all_scenes = [S.east(o, "attack", k, 7) for o, _, _ in EAST for k in range(10)]
    box = S.box(all_scenes)
    l, t, r, b = box
    w, h, top = l + r, t + b, 110
    frames, times = [], []
    for rep in range(2):
        for k in range(10):
            img = Image.new("RGB", (4 * (w + 12), top + h), B.BG)
            d = ImageDraw.Draw(img)
            d.text((8, 4), "R21-東陸-發射-各選項-phone", font=fh, fill=B.WHITE)
            for i, (o, name, _) in enumerate(EAST):
                d.text((i * (w + 12) + 8, 60), name, font=fb, fill=B.PALE)
                img.paste(S.big([S.east(o, "attack", k, 7)], 1.0, box), (i * (w + 12), top))
            frames.append(img)
            times.append(50)
        times[-1] += 1500
    _save(out / "R21-東陸-發射-各選項-phone.gif", frames, times)
    # the West: walking to the right as the game moves it (1.2 m a second: 72 px), each option at its own frames a second
    b0 = S.box([S.west(o, "walk", k, 0) for o, _, _ in WEST for k in range(8)])
    l, t, r, b = b0
    travel = 150
    w, h = l + r + travel, t + b
    fps = {"0": 12 * 0.6, "A": 8 * 1.2 / (2 * math.pi * 0.24 / 4), "B": 8 * 1.2 / (2 * 0.62)}
    frames, times = [], []
    for step in range(52):                        # 40 ms a frame, about 2 s
        sec = step * 0.04
        img = Image.new("RGB", (3 * (w + 12), top + h), B.BG)
        d = ImageDraw.Draw(img)
        d.text((8, 4), "R21-西陸-走路-各選項-phone（朝右走，照遊戲的速度；白線釘在地上）", font=fh, fill=B.WHITE)
        for i, (o, name, _) in enumerate(WEST):
            d.text((i * (w + 12) + 8, 60), name, font=fb, fill=B.PALE)
            base = Image.new("RGB", (w, h), S.bg)
            bd = ImageDraw.Draw(base)
            for x in range(0, w, 12):
                bd.line([(x, t + 16), (x, t + (24 if x % 48 else 32))], fill=(255, 255, 255), width=1)
            st = A.Stage(base)
            for spr, dx, dy in S.west(o, "walk", int(sec * fps[o]) % 8, 0):
                st.put(spr, l + round(72 * sec) % travel, t)
            img.paste(st.render(), (i * (w + 12), top))
        frames.append(img)
        times.append(40)
    _save(out / "R21-西陸-走路-各選項-phone.gif", frames, times)


def _save(p, frames, times):
    pal = [f.quantize(colors=255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for f in frames]
    pal[0].save(p, save_all=True, append_images=pal[1:], duration=times, loop=0, disposal=1)
    print(p.name, frames[0].size, f"{len(frames)} frames, {p.stat().st_size / 1e6:.1f} MB")


def main():
    S = Shots(Path(sys.argv[1]), Path(sys.argv[2]))
    out = Path(sys.argv[3])
    out.mkdir(parents=True, exist_ok=True)
    for f in (refs, overview, east, west, gifs):
        if len(sys.argv) < 5 or f.__name__ in sys.argv[4:]:
            f(S, out)


if __name__ == "__main__":
    main()
