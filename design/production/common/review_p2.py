"""P2 approval sheets: the redone animations next to their first version.

The user on P1 (2026-10-01): 「p1-03 p1-04看起來不夠精緻」. P2 redoes the falls and the farmers'
works; the farmers' enlarged tools change their approved R5 silhouette, so they get their own item.

python3 common/review_p2.py [--fetch <run_id>]
-> out/P2-03-倒下-B-精修-動作.gif            every unit: A 初版 | B 精修 (B with the shared landing dust)
   out/P2-04-農民工作-B-精修-動作.gif        every work: A 初版 | B 精修
   out/P2-06-農民工具-A-現況-mobile.png      idle and walk with the R5 tools: actual size, phone pixels, zoomed
   out/P2-06-農民工具-B-放大-mobile.png      the same with the enlarged tools
   out/P2-06-農民工具-B-放大-動作.gif        idle and walk: A 現況 | B 放大
   out/P2-99-總覽對照.png                   key frames of everything, with an actual-size row

Sources (build/prod/, CI artifacts): review1-<unit>/raw the P1 renders (A), review-<unit>/raw the P2
renders (B), <unit>/raw the production renders with the R5 tools (A of P2-06).
Facing 7, phone pixels (1 pt = 3 px) unless a row says otherwise; East blue, West red; the R5 look.
The dust is not part of the unit's images: the game draws one shared dust animation at the unit's
feet when the fall reaches its `impact` frame (client/docs/sprite-atlas.md, section 11).
"""
import argparse
import math
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import effects      # noqa: E402
import review_gif   # noqa: E402  (the R5-look sprite with its whole shadow)
import spec         # noqa: E402
from review_gif import BG, GREY, INK, Image, ImageDraw, artboard, config, r2art  # noqa: E402

OUT = review_gif.OUT
PROD = config.BUILD / "prod"
TICK = 20
FPS = dict(spec.FPS, walk=10, idle=8)       # idle 8 x 2.5 ticks + walk 8 x 2 ticks: a 36-tick loop
NAMES = review_gif.NAMES
P1_COUNTS = {"fall": 12, "dead": 4, "death": 10, "work_chop": 8, "work_mine": 8, "work_farm": 8, "work_build": 8,
             "idle": 8, "walk": 8}
WORK_NAMES = {"work_chop": "砍樹（斧頭）", "work_mine": "挖礦（十字鎬）", "work_farm": "耕田（鋤頭）",
              "work_build": "蓋房子（木槌）"}
WHITE = (250, 248, 240)


def fetch(run_id):
    for unit in spec.P2_ANIMS:
        d = PROD / f"review-{unit}"
        subprocess.run(["rm", "-rf", str(d)])
        r = subprocess.run(["gh", "run", "download", str(run_id), "-n", f"production-review-{unit}", "-D", str(d)])
        n = len(list((d / "raw").glob("*_beauty.png"))) if (d / "raw").exists() else 0
        print(f"review-{unit}: {'ok' if r.returncode == 0 else 'no artifact'}, {n} colour frames")


_DUST = {}


def dust(scale):
    """The shared dust frames, scaled for a big unit: [(image, anchor)]."""
    if scale not in _DUST:
        fr = effects.dust_frames(3)
        if scale != 1:
            fr = [(im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS),
                   (a[0] * scale, a[1] * scale)) for im, a in fr]
        _DUST[scale] = fr
    return _DUST[scale]


class Cell:
    """One unit playing a sequence of animations from one render folder."""

    def __init__(self, unit, anims, src, counts=None, with_dust=False):
        self.unit, self.anims = unit, anims
        self.dir = PROD / src / "raw"
        counts = counts or P1_COUNTS
        self.seq = []                                   # (sprite key, ticks shown)
        self.impact_tick = None
        imp = spec.IMPACT.get(unit) if with_dust else None
        t = 0.0
        for a in anims:
            per = TICK / FPS.get(a, 12)
            for i in range(counts[a]):
                if imp and a == imp[0] and i == imp[1]:
                    self.impact_tick = t
                self.seq.append((spec.frame_name(unit, a, 7, i), per))
                t += per
        self.dust = dust(imp[2]) if imp else None
        self.loop = anims[-1] in ("walk", "idle") or anims[-1].startswith("work_")
        self.length = t
        self.team = "e" if unit.endswith("_e") else "w"
        mage = unit.startswith("mage")
        self.cache = {k: review_gif._sprite(self.dir, k, self.team, mage, unit == "mage_w") for k, _ in self.seq}
        ims = list(self.cache.values())
        left = max(s.anchor[0] for s in ims)
        top = max(s.anchor[1] for s in ims)
        right = max(s.img.width - s.anchor[0] for s in ims)
        bottom = max(s.img.height - s.anchor[1] for s in ims)
        if self.dust:
            d0, a0 = self.dust[-1]
            left, right = max(left, a0[0]), max(right, d0.width - a0[0])
            top, bottom = max(top, a0[1]), max(bottom, d0.height - a0[1])
        self.left, self.top = left, top
        self.w, self.h = int(left + right) + 8, int(top + bottom) + 8
        self._ground = {}

    def key(self, anim, i):
        return spec.frame_name(self.unit, anim, 7, i)

    def at(self, tick):
        t = tick % self.length if self.loop else min(tick, self.length - 1e-6)
        for key, h in self.seq:
            if t < h:
                return key
            t -= h
        return self.seq[-1][0]

    def ground(self, w, h):
        if (w, h) not in self._ground:
            self._ground[(w, h)] = r2art.ground(w, h, zoom=1.0)
        return self._ground[(w, h)].copy()

    def image(self, key, w, h, dust_frame=None):
        """One frame on the ground; every frame of the cell shares one ground point."""
        sp = self.cache[key]
        can = self.ground(w, h)
        ax = (w - self.w) / 2 + self.left + 4
        ay = (h - self.h) / 2 + self.top + 4
        can.alpha_composite(sp.img, (int(ax - sp.anchor[0]), int(ay - sp.anchor[1])))
        if self.dust and dust_frame is not None and 0 <= dust_frame < len(self.dust):
            d, a = self.dust[dust_frame]
            can.alpha_composite(d, (int(ax - a[0]), int(ay - a[1])))
        return can

    def frame(self, tick, w, h):
        df = None
        if self.impact_tick is not None and not self.loop:
            df = int(math.floor((min(tick, self.length + 1e9) - self.impact_tick) * effects.DUST_FPS / TICK))
        return self.image(self.at(tick), w, h, df)


def _caption(dr, x, y, text, size=17):
    f = artboard.font(size)
    dr.text((x + 1, y + 1), text, font=f, fill=(20, 22, 18))
    dr.text((x, y), text, font=f, fill=WHITE)


def _length(cells, hold=1.0):
    need = max([c.length + TICK * hold for c in cells if not c.loop] + [32])
    loops = [c.length for c in cells if c.loop]
    step = int(max(loops)) if loops else 16
    return int(math.ceil(need / step) * step)


def _header(label, sub, width):
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    h = r2art._wrap(probe, 0, 50, sub, GREY, 17, width) + 6

    def draw(dr, x):
        dr.text((x, 10), label, font=artboard.font(28), fill=INK)
        r2art._wrap(dr, x, 50, sub, GREY, 17, width)
    return h, draw


def gif_pairs(label, sub, pairs, path, cols, names=("A 初版", "B 精修"), dither="sierra2_4a"):
    """pairs: [(title, cell A, cell B)]. Each pair is two tiles of the same size, side by side."""
    tw = max(max(a.w, b.w) for _, a, b in pairs) + 12
    th = max(max(a.h, b.h) for _, a, b in pairs) + 10
    pw = tw * 2 + 4                                           # a pair
    cols = min(cols, len(pairs))
    rows = (len(pairs) + cols - 1) // cols
    M, LAB = 16, 28
    W = max(M * 2 + cols * pw + (cols - 1) * 14, 780)
    top, draw_header = _header(label, sub, W - 2 * M)
    H = top + rows * (LAB + th + 12) + 6
    tmp = Path(tempfile.mkdtemp(prefix="p2gif_", dir=config.BUILD))
    n = _length([c for _, a, b in pairs for c in (a, b)])
    for i in range(n):
        can = Image.new("RGBA", (W, H), (*BG, 255))
        dr = ImageDraw.Draw(can)
        draw_header(dr, M)
        for k, (title, a, b) in enumerate(pairs):
            x = M + (k % cols) * (pw + 14)
            y = top + (k // cols) * (LAB + th + 12)
            dr.text((x + 2, y + 2), title, font=artboard.font(18), fill=INK)
            for j, (c, nm) in enumerate(((a, names[0]), (b, names[1]))):
                can.alpha_composite(c.frame(i, tw, th), (x + j * (tw + 4), y + LAB))
                _caption(dr, x + j * (tw + 4) + 6, y + LAB + 4, nm)
        can.convert("RGB").save(tmp / f"{i:03d}.png")
    pal = tmp / "pal.png"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", str(TICK), "-i", str(tmp / "%03d.png"), "-vf",
                    "palettegen=stats_mode=full", str(pal)], check=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", str(TICK), "-i", str(tmp / "%03d.png"), "-i",
                    str(pal), "-lavfi", f"paletteuse=dither={dither}", "-loop", "0", str(path)], check=True)
    for p in tmp.iterdir():
        p.unlink()
    tmp.rmdir()
    print(f"wrote {path.name} {W}x{H}, {n} frames ({n / TICK:.1f} s), {path.stat().st_size / 2 ** 20:.1f} MB")


# ---------------------------------------------------------------- stills

def strip(cell, keys, scale=1.0, dust_at=None, caption=None):
    """Frames of one cell side by side. keys: [(anim, frame)]; dust_at: {index in keys: dust frame}."""
    ims = []
    for n, (a, i) in enumerate(keys):
        im = cell.image(cell.key(a, i), cell.w, cell.h, (dust_at or {}).get(n))
        if scale != 1.0:
            im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))),
                           Image.LANCZOS if scale < 1 else Image.BILINEAR)
        ims.append(im)
    gap = max(2, round(6 * scale))
    W = sum(i.width for i in ims) + gap * (len(ims) - 1)
    out = Image.new("RGBA", (W, ims[0].height), (*BG, 255))
    x = 0
    for im in ims:
        out.alpha_composite(im, (x, 0))
        x += im.width + gap
    if caption:
        _caption(ImageDraw.Draw(out), 6, 4, caption)
    return out


def _row(art, dr, x, y, items, gap=24):
    """Paste [(title, image)] left to right; returns the row's height."""
    h = 0
    for title, im in items:
        if title:
            dr.text((x, y), title, font=artboard.font(18), fill=INK)
        art.paste(im.convert("RGB"), (x, y + (26 if title else 0)))
        x += im.width + gap
        h = max(h, im.height + (26 if title else 0))
    return h


def fall_keys(cell_unit, b):
    """(start, the landing, the last frame) for A; B's landing is its impact frame."""
    if cell_unit.startswith("mage"):
        return [("fall", 0), ("fall", spec.IMPACT[cell_unit][1] if b else 7), ("dead", 3)]
    return [("death", 0), ("death", spec.IMPACT[cell_unit][1] if b else 5), ("death", 9)]


def overview(falls, works, tools):
    M = 60
    W = 3000
    art = Image.new("RGB", (W, 9000), BG)
    dr = ImageDraw.Draw(art)
    dr.text((M, 36), "P2-99-總覽對照", font=artboard.font(52), fill=INK)
    y = r2art._wrap(dr, M, 110, "P1-03 倒下、P1-04 農民工作重做（使用者：「p1-03 p1-04看起來不夠精緻」）。每一項上面是初版 A、下面是精修 B；"
                    "另有動作 GIF。朝向右前，手機像素（1 pt = 3 px），東陸藍、西陸紅。標「實際大小」的是 1 pt = 1 px。",
                    GREY, 24, W - 2 * M) + 20

    def section(title, sub):
        nonlocal y
        dr.text((M, y), title, font=artboard.font(34), fill=INK)
        y = r2art._wrap(dr, M, y + 48, sub, GREY, 22, W - 2 * M) + 10

    # ---- falls
    section("P2-03-倒下-B-精修", "開始、落地、最後一格（遊戲會停在最後一格 3 秒）。B 落地那一格的塵土是遊戲另外畫的共用效果，不在人物圖裡。")
    x, row_h = M, 0
    for unit, a, b in falls:
        sa = strip(a, fall_keys(unit, False), caption="A 初版")
        sb = strip(b, fall_keys(unit, True), dust_at={1: 1}, caption="B 精修")
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
    for unit, a, b in falls:
        first = ("fall", 0) if unit.startswith("mage") else ("death", 0)
        last = ("dead", 3) if unit.startswith("mage") else ("death", 9)
        s = [strip(b, [first], 1 / 3), strip(a, [last], 1 / 3), strip(b, [last], 1 / 3)]
        w_ = sum(i.width for i in s) + 8
        t = Image.new("RGBA", (w_, max(i.height for i in s)), (*BG, 255))
        xx = 0
        for i in s:
            t.alpha_composite(i, (xx, t.height - i.height))
            xx += i.width + 4
        items.append((NAMES[unit], t))
    y += _row(art, dr, M, y, items) + 40

    # ---- works
    section("P2-04-農民工作-B-精修", "每種工作取三格：開始、蓄力、打到。工具放大；四種動作各有自己的路徑；腳踩穩、重心會移動。")
    for unit in ("farmer_e", "farmer_w"):
        x, row_h = M, 0
        for (u, anim, a, b) in [w_ for w_ in works if w_[0] == unit]:
            hit = spec.WORK_HIT[anim]
            sa = strip(a, [(anim, 0), (anim, 3), (anim, 5)], caption="A 初版")
            sb = strip(b, [(anim, 0), (anim, 2), (anim, hit)], caption="B 精修")
            dr.text((x, y), f"{NAMES[unit]}｜{WORK_NAMES[anim]}", font=artboard.font(22), fill=INK)
            art.paste(sa.convert("RGB"), (x, y + 30))
            art.paste(sb.convert("RGB"), (x, y + 30 + sa.height + 6))
            row_h = max(row_h, 30 + sa.height + 6 + sb.height)
            x += max(sa.width, sb.width) + 36
        y += row_h + 30
    dr.text((M, y), "實際大小（1 pt = 1 px）：四種工作打到的那一格，左 A、右 B", font=artboard.font(22), fill=INK)
    y += 34
    items = []
    for (u, anim, a, b) in works:
        s = [strip(a, [(anim, 5)], 1 / 3), strip(b, [(anim, spec.WORK_HIT[anim])], 1 / 3)]
        t = Image.new("RGBA", (s[0].width + s[1].width + 4, max(i.height for i in s)), (*BG, 255))
        t.alpha_composite(s[0], (0, t.height - s[0].height))
        t.alpha_composite(s[1], (s[0].width + 4, t.height - s[1].height))
        items.append((f"{NAMES[u][2:]}{WORK_NAMES[anim][:2]}", t))
    y += _row(art, dr, M, y, items, gap=18) + 40

    # ---- tools
    section("P2-06-農民工具（A 現況／B 放大）", "工具放大後，待機和走路時手上的工具也跟著變大，會改到 R5 核准的農夫、農民輪廓（只有工具）。"
            "左：實際大小（1 pt = 1 px）；中：手機像素；右：放大 2 倍。")
    for unit, a, b in tools:
        x = M
        for cell, nm in ((a, "A 現況"), (b, "B 放大")):
            s1 = strip(cell, [("idle", 0), ("walk", 2)], 1 / 3)
            s3 = strip(cell, [("idle", 0), ("walk", 2), ("walk", 6)], 1.0, caption=nm)
            s6 = strip(cell, [("idle", 0)], 2.0)
            dr.text((x, y), f"{NAMES[unit]}｜{nm}", font=artboard.font(22), fill=INK)
            hh = max(s1.height, s3.height, s6.height)
            xx = x
            for s in (s1, s3, s6):
                art.paste(s.convert("RGB"), (xx, y + 30 + hh - s.height))
                xx += s.width + 14
            x = xx + 40
        y += 30 + hh + 30
    art = art.crop((0, 0, W, y + 30))
    art.save(OUT / "P2-99-總覽對照.png")
    print(f"wrote P2-99-總覽對照.png {art.size[0]}x{art.size[1]}")


def tool_board(opt, name, tools, which):
    """P2-06 option artboard: both farmers, idle and walk, at three sizes."""
    label = f"P2-06-農民工具-{opt}-{name}-mobile"
    M = 60
    rows = []
    for unit, a, b in tools:
        cell = a if which == 0 else b
        rows.append((unit, strip(cell, [("idle", 0), ("walk", 0), ("walk", 2), ("walk", 4), ("walk", 6)], 1 / 3),
                     strip(cell, [("idle", 0), ("walk", 0), ("walk", 2), ("walk", 4), ("walk", 6)], 1.0),
                     strip(cell, [("idle", 0), ("walk", 2)], 2.0)))
    W = 2 * M + max(r[1].width + r[2].width + r[3].width + 60 for r in rows)
    sub = ("選項 A：R5 核准的樣子。斧頭和鋤頭在實際大小下只是一條細線，看不出是什麼工具。" if which == 0 else
           "選項 B：工具放大（斧頭、鋤頭的頭約 0.3 公尺寬，柄加粗）。實際大小下看得出斧頭和鋤頭；"
           "人物本身不變，只有手上的工具變大。工作時換成十字鎬、木槌也是這個大小。")
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    top = r2art._wrap(probe, M, 118, sub, GREY, 26, W - 2 * M) + 20
    H = top + sum(max(r[1].height, r[2].height, r[3].height) + 90 for r in rows) + 30
    art = Image.new("RGB", (W, H), BG)
    dr = ImageDraw.Draw(art)
    dr.text((M, 40), label, font=artboard.font(52), fill=INK)
    r2art._wrap(dr, M, 118, sub, GREY, 26, W - 2 * M)
    y = top
    for unit, s1, s3, s6 in rows:
        dr.text((M, y), f"{NAMES[unit]}：待機、走路（左：實際大小 1 pt = 1 px；中：手機像素 1 pt = 3 px；右：放大 2 倍）",
                font=artboard.font(26), fill=INK)
        hh = max(s1.height, s3.height, s6.height)
        x = M
        for s in (s1, s3, s6):
            art.paste(s.convert("RGB"), (x, y + 44 + hh - s.height))
            x += s.width + 30
        y += hh + 90
    art.save(OUT / f"{label}.png")
    print(f"wrote {label}.png {W}x{H}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", metavar="RUN_ID", help="download the P2 review renders of this CI run first")
    ap.add_argument("--only", help="comma list of: falls, works, tools, overview")
    a = ap.parse_args()
    if a.fetch:
        fetch(a.fetch)
    only = set(a.only.split(",")) if a.only else {"falls", "works", "tools", "overview"}
    OUT.mkdir(parents=True, exist_ok=True)
    B = {u: dict(spec.P2_ANIMS[u]) for u in spec.P2_ANIMS}
    falls = []
    for u in ("mage_e", "mage_w", "hcav_e", "knight_w", "siege_e", "siege_w"):
        an = ["fall", "dead"] if u.startswith("mage") else ["death"]
        falls.append((u, Cell(u, an, f"review1-{u}"), Cell(u, an, f"review-{u}", B[u], with_dust=True)))
    works = [(u, w, Cell(u, [w], f"review1-{u}"), Cell(u, [w], f"review-{u}", B[u]))
             for u in ("farmer_e", "farmer_w") for w in ("work_chop", "work_mine", "work_farm", "work_build")]
    tools = [(u, Cell(u, ["idle", "walk"], u), Cell(u, ["idle", "walk"], f"review-{u}", B[u]))
             for u in ("farmer_e", "farmer_w")]
    if "falls" in only:
        gif_pairs("P2-03-倒下-B-精修-動作", "每一格左邊是初版 A，右邊是精修 B。B：先慢後快、落地彈一下；法師膝蓋先軟、垮下、斜躺，"
                  "學院大師的杖脫手；騎手被摔下馬、長槍落地；攻城器械整台垮掉。落地的塵土是遊戲另外畫的共用效果，不在人物圖裡。",
                  [(NAMES[u], a_, b_) for u, a_, b_ in falls], OUT / "P2-03-倒下-B-精修-動作.gif", cols=2)
    if "works" in only:
        gif_pairs("P2-04-農民工作-B-精修-動作", "每一格左邊是初版 A，右邊是精修 B。B：工具放大；砍樹側向揮砍、挖礦過頭往下鑿、"
                  "耕田前伸回拉、蓋房子木槌連敲；腳踩穩、重心會移動、雙手握柄。",
                  [(f"{NAMES[u]}｜{WORK_NAMES[w]}", a_, b_) for u, w, a_, b_ in works],
                  OUT / "P2-04-農民工作-B-精修-動作.gif", cols=4)
    if "tools" in only:
        tool_board("A", "現況", tools, 0)
        tool_board("B", "放大", tools, 1)
        gif_pairs("P2-06-農民工具-B-放大-動作", "待機接走路。左邊 A 是 R5 核准的工具，右邊 B 是放大後的工具；人物本身不變。",
                  [(NAMES[u], a_, b_) for u, a_, b_ in tools], OUT / "P2-06-農民工具-B-放大-動作.gif", cols=2,
                  names=("A 現況", "B 放大"))
    if "overview" in only:
        overview(falls, works, tools)
