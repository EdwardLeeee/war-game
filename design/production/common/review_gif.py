"""Motion GIFs of the new animations, for ceo to show the user before mass production.

python3 common/review_gif.py --fetch <run_id>     download production-review-<unit> into build/prod/review-<unit>
python3 common/review_gif.py
-> out/P1-0N-<item>-A-初版-動作.gif   one GIF per item
   out/P1-99-總覽對照.png            key frames of every item (start, key moment, end)
   out/P1-99-動作對照.gif            every cell in one GIF, at two-thirds size

Every cell plays on one clock at the speed the game will use (client/docs/sprite-atlas.md: attack
and hit 20 frames a second, shatter 16, falls 12, work 10). Loops (work, walk) repeat seamlessly;
one-shot animations play once and hold their last frame until the GIF starts again. Facing 7
(toward the camera, to the right), phone pixels (1 pt = 3 px), East in blue, West in red, the R5
look (AO, player colour, crystal glow, effects) with each frame's own shadow.
"""
import argparse
import math
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROD = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(1, str(PROD.parent / "round5" / "common"))
import config  # noqa: E402
import r5art   # noqa: E402  (R5 look: player colour, shadow, crystal glow, effects)
import spec    # noqa: E402
from r5art import Image, ImageDraw, artboard, r2art  # noqa: E402

OUT = PROD / "out"
BG = (244, 241, 234)
INK, GREY = artboard.INK, artboard.GREY
TICK = 20                    # GIF frames a second (one sim tick each)
LOOP_TICKS = 16              # work and walk cycles: 8 frames at 10 a second
FPS = dict(spec.FPS, walk=10)
NAMES = {"mage_e": "劍修", "mage_w": "學院大師", "hcav_e": "具裝騎兵", "knight_w": "騎士", "siege_e": "霹靂車",
         "siege_w": "投石機", "farmer_e": "東陸農夫", "farmer_w": "西陸農民"}
ANIM = {"attack": "晶彈", "hit": "受擊", "shatter": "破盾", "fall": "倒下", "death": "倒下", "walk": "走路（輪子轉）",
        "work_chop": "砍樹", "work_mine": "挖礦", "work_farm": "耕田", "work_build": "蓋房子"}
# key frames for the overview (frame numbers inside the animation; the first animation of a
# sequence unless marked with the animation name)
KEYS = {"attack": [0, 4, 9], "hit": [0, 1, 5], "shatter": [0, 2, 6], "death": [0, 5, 9], "walk": [0, 3, 6],
        "work_chop": [0, 3, 5], "work_mine": [0, 3, 5], "work_farm": [0, 3, 5], "work_build": [0, 3, 5],
        "fall": [0, 6, ("dead", 3)]}

# item: (label, description, cells); a cell is (unit, [animations played one after another])
ITEMS = [
    ("P1-01-法師晶彈", "法師的普通攻擊：東陸劍修用劍指往前點，西陸學院大師用晶杖往前刺；出手那一格（第 5 格）閃光。"
     "飛出去的晶彈由遊戲另外畫。", [("mage_e", ["attack"]), ("mage_w", ["attack"])]),
    ("P1-02-法師受擊與破盾", "防護罩被打中時亮一下、人往後縮；防護罩破掉時碎成晶片飛散，人舉手護頭。",
     [("mage_e", ["hit"]), ("mage_w", ["hit"]), ("mage_e", ["shatter"]), ("mage_w", ["shatter"])]),
    ("P1-03-倒下", "法師往後倒、躺著；騎兵的馬前腳跪下、側倒，騎手放開長槍；攻城器械塌下、掉一個輪子、拋竿垂下。",
     [("mage_e", ["fall", "dead"]), ("mage_w", ["fall", "dead"]), ("hcav_e", ["death"]), ("knight_w", ["death"]),
      ("siege_e", ["death"]), ("siege_w", ["death"])]),
    ("P1-04-農民工作", "工作時換工具：砍樹用斧頭、挖礦用十字鎬、耕田用鋤頭、蓋房子用槌子。",
     [("farmer_e", ["work_chop"]), ("farmer_e", ["work_mine"]), ("farmer_e", ["work_farm"]),
      ("farmer_e", ["work_build"]), ("farmer_w", ["work_chop"]), ("farmer_w", ["work_mine"]),
      ("farmer_w", ["work_farm"]), ("farmer_w", ["work_build"])]),
    ("P1-05-攻城器械走路", "攻城器械移動時輪子轉，一個循環轉 90 度；遊戲會依移動速度調整播放快慢，輪子不會打滑。",
     [("siege_e", ["walk"]), ("siege_w", ["walk"])]),
]


def fetch(run_id):
    """Download every review artifact into build/prod/review-<unit> (the artifact root holds raw/)."""
    for unit in spec.REVIEW_ANIMS:
        d = config.BUILD / "prod" / f"review-{unit}"
        r = subprocess.run(["gh", "run", "download", str(run_id), "-n", f"production-review-{unit}", "-D", str(d)])
        n = len(list((d / "raw").glob("*_beauty.png"))) if (d / "raw").exists() else 0
        print(f"review-{unit}: {'ok' if r.returncode == 0 else 'no artifact'}, {n} colour frames")


def _sprite(d, base, team, mage, glow):
    """R5 look (AO, player colour, crystal glow, effects) with the frame's whole shadow: the shadow
    frame is larger than the colour frame (right and below), so the two are aligned on the ground
    anchor."""
    import numpy as np
    compose = r5art.compose
    key = f"{base}_x3"
    b = compose.load(d, key, "beauty")
    img = b.img
    # the staff crystal of the 學院大師 (no glowing trim on these robes, so no head-height limit:
    # the crystal keeps its glow while the mage falls)
    crystal = r5art.crystal_mask(img) if glow else None
    ao = np.asarray(Image.open(d / f"{key}_ao.png").convert("L"), np.float32) / 255.0
    a = np.asarray(img, np.float32)
    a[..., :3] *= (0.7 + 0.3 * ao)[..., None]
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")
    img = compose.recolor(img, Image.open(d / f"{key}_mask.png"), r2art.TEAM[team])
    if crystal is not None and crystal.any():
        layer = np.zeros((img.height, img.width, 4), np.uint8)
        layer[crystal] = (120, 235, 255, 255)
        halo = Image.fromarray(layer, "RGBA").filter(r5art.ImageFilter.GaussianBlur(3))
        h = np.asarray(halo, np.float32)
        h[..., 3] = np.clip(h[..., 3] * 1.8, 0, 200)
        img.alpha_composite(Image.fromarray(h.astype(np.uint8), "RGBA"))
    if mage and (d / f"{key}_fx.png").exists():
        f = Image.open(d / f"{key}_fx.png").convert("RGBA")
        img.alpha_composite(f.filter(r5art.ImageFilter.GaussianBlur(6)))
        img.alpha_composite(f)
    sh = compose.load_shadow(d, key, color=(26, 30, 48), strength=0.85)
    ax, ay = b.anchor
    left, top = max(ax, sh.anchor[0]), max(ay, sh.anchor[1])
    right = max(img.width - ax, sh.img.width - sh.anchor[0])
    bottom = max(img.height - ay, sh.img.height - sh.anchor[1])
    out = Image.new("RGBA", (int(left + right) + 1, int(top + bottom) + 1), (0, 0, 0, 0))
    out.alpha_composite(sh.img, (int(round(left - sh.anchor[0])), int(round(top - sh.anchor[1]))))
    out.alpha_composite(img, (int(round(left - ax)), int(round(top - ay))))
    # trim the empty frame around the unit and its shadow (the frames are sized for every facing)
    bb = out.getchannel("A").point(lambda v: 255 if v > 6 else 0).getbbox() or (0, 0, 1, 1)
    return compose.Sprite(out.crop(bb), (left - bb[0], top - bb[1]))


class Cell:
    def __init__(self, unit, anims):
        self.unit, self.anims = unit, anims
        self.dir = config.BUILD / "prod" / f"review-{unit}" / "raw"
        n = dict(spec.REVIEW_ANIMS[unit])
        self.seq = []                       # (sprite key, ticks shown)
        for a in anims:
            per = TICK / FPS.get(a, 12)
            self.seq += [(spec.frame_name(unit, a, 7, i), per) for i in range(n[a])]
        self.loop = anims[-1] == "walk" or anims[-1].startswith("work_")
        self.length = sum(h for _, h in self.seq)
        self.team = "e" if unit.endswith("_e") else "w"
        mage = unit.startswith("mage")
        self.cache = {k: _sprite(self.dir, k, self.team, mage, unit == "mage_w") for k, _ in self.seq}
        ims = list(self.cache.values())
        self.left = max(s.anchor[0] for s in ims)
        self.top = max(s.anchor[1] for s in ims)
        self.w = int(max(s.img.width - s.anchor[0] for s in ims) + self.left) + 8
        self.h = int(max(s.img.height - s.anchor[1] for s in ims) + self.top) + 8
        self.keys = self._keys()
        self._ground = {}

    def _keys(self):
        first = self.anims[0]
        out = []
        for k in KEYS.get(first, [0, len(self.seq) // 2, len(self.seq) - 1]):
            a, i = (k if isinstance(k, tuple) else (first, k))
            out.append(spec.frame_name(self.unit, a, 7, i))
        return out

    def at(self, tick):
        """The sprite key shown at this tick: loops wrap, one-shots hold their last frame."""
        t = tick % self.length if self.loop else min(tick, self.length - 1e-6)
        for key, h in self.seq:
            if t < h:
                return key
            t -= h
        return self.seq[-1][0]

    def label(self):
        return f"{NAMES[self.unit]}｜{'→'.join(ANIM[a] for a in self.anims if a != 'dead')}"

    def ground(self, w, h):
        if (w, h) not in self._ground:
            self._ground[(w, h)] = r2art.ground(w, h, zoom=1.0)
        return self._ground[(w, h)].copy()

    def image(self, key, w, h):
        """One frame on the ground; every frame of the cell shares one ground point."""
        sp = self.cache[key]
        can = self.ground(w, h)
        ax = (w - self.w) / 2 + self.left
        ay = 4 + self.top
        can.alpha_composite(sp.img, (int(ax - sp.anchor[0]), int(ay - sp.anchor[1])))
        return can


def _length(cells):
    """GIF length in ticks: the longest one-shot plus 0.6 s holding its last frame, rounded up to
    whole work/walk cycles so the loops join seamlessly."""
    need = max([c.length + TICK * 0.6 for c in cells if not c.loop] + [2 * LOOP_TICKS])
    return int(math.ceil(need / LOOP_TICKS) * LOOP_TICKS)


def _header(label, sub, width):
    """Heading and description; returns (height, draw function)."""
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    h = r2art._wrap(probe, 0, 50, sub, GREY, 17, width) + 6

    def draw(dr, x):
        dr.text((x, 10), label, font=artboard.font(28), fill=INK)
        r2art._wrap(dr, x, 50, sub, GREY, 17, width)
    return h, draw


def gif(label, sub, cells, path, cols=4, scale=1.0):
    cw = max(c.w for c in cells) + 20
    ch = max(c.h for c in cells) + 14
    cols = min(cols, len(cells))
    rows = (len(cells) + cols - 1) // cols
    M, LAB = 16, 30
    W = max(M * 2 + cols * cw + (cols - 1) * 8, 760)
    top, draw_header = _header(label, sub, W - 2 * M)
    H = top + rows * (LAB + ch + 8) + 8
    tmp = Path(tempfile.mkdtemp(prefix="p1gif_", dir=config.BUILD))
    n = _length(cells)
    for i in range(n):
        can = Image.new("RGBA", (W, H), (*BG, 255))
        dr = ImageDraw.Draw(can)
        draw_header(dr, M)
        for k, c in enumerate(cells):
            x = M + (k % cols) * (cw + 8)
            y = top + (k // cols) * (LAB + ch + 8)
            dr.text((x + 4, y + 4), c.label(), font=artboard.font(18), fill=INK)
            can.alpha_composite(c.image(c.at(i), cw, ch), (x, y + LAB))
        out = can.convert("RGB")
        if scale != 1.0:
            out = out.resize((round(W * scale), round(H * scale)), Image.LANCZOS)
        out.save(tmp / f"{i:03d}.png")
    pal = tmp / "pal.png"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", str(TICK), "-i", str(tmp / "%03d.png"), "-vf",
                    "palettegen=stats_mode=full", str(pal)], check=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", str(TICK), "-i", str(tmp / "%03d.png"), "-i",
                    str(pal), "-lavfi", "paletteuse=dither=sierra2_4a", "-loop", "0", str(path)], check=True)
    for p in tmp.iterdir():
        p.unlink()
    tmp.rmdir()
    print(f"wrote {path.name} {W}x{H}, {n} frames ({n / TICK:.1f} s), {path.stat().st_size / 2 ** 20:.1f} MB")


def strip(cell):
    """The cell's key frames side by side on one piece of ground, with its label."""
    LAB, gap = 30, 6
    w = len(cell.keys) * cell.w + (len(cell.keys) - 1) * gap
    can = Image.new("RGBA", (w, LAB + cell.h), (*BG, 255))
    dr = ImageDraw.Draw(can)
    dr.text((2, 4), cell.label(), font=artboard.font(18), fill=INK)
    for k, key in enumerate(cell.keys):
        can.alpha_composite(cell.image(key, cell.w, cell.h), (k * (cell.w + gap), LAB))
    return can


def overview(items, max_w=2600):
    M, gap = 60, 28
    blocks = []
    for label, sub, cells in items:
        strips = [strip(c) for c in cells]
        rows, row, rw = [], [], 0          # wrap the strips of one item into rows
        for s in strips:
            if row and rw + gap + s.width > max_w:
                rows.append(row)
                row, rw = [], 0
            row.append(s)
            rw += (gap if rw else 0) + s.width
        rows.append(row)
        blocks.append((label, sub, rows))
    W = 2 * M + max(sum(s.width for s in r) + gap * (len(r) - 1) for _, _, rows in blocks for r in rows)
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    H = 180
    for label, sub, rows in blocks:
        H = r2art._wrap(probe, M, H + 46, sub, GREY, 22, W - 2 * M) + 8
        H += sum(max(s.height for s in r) + 16 for r in rows) + 40
    art = Image.new("RGB", (W, H), BG)
    dr = ImageDraw.Draw(art)
    dr.text((M, 36), "P1-99-總覽對照", font=artboard.font(52), fill=INK)
    r2art._wrap(dr, M, 110, "量產前要核准的新動作。每一項另有一個動作 GIF；這張每個動作取三格：開始、關鍵的一格、結束"
                "（循環的工作與走路是：開始、舉起、打下去）。朝向右前，手機像素（1 pt = 3 px），東陸藍、西陸紅。",
                GREY, 24, W - 2 * M)
    y = 180
    for label, sub, rows in blocks:
        dr.text((M, y), f"{label}-A-初版", font=artboard.font(32), fill=INK)
        y = r2art._wrap(dr, M, y + 46, sub, GREY, 22, W - 2 * M) + 8
        for r in rows:
            x = M
            for s in r:
                art.paste(s.convert("RGB"), (x, y))
                x += s.width + gap
            y += max(s.height for s in r) + 16
        y += 40
    art.save(OUT / "P1-99-總覽對照.png")
    print(f"wrote P1-99-總覽對照.png {W}x{H}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", metavar="RUN_ID", help="download the review renders of this CI run first")
    ap.add_argument("--no-all", action="store_true", help="skip the combined P1-99 GIF")
    a = ap.parse_args()
    if a.fetch:
        fetch(a.fetch)
    OUT.mkdir(parents=True, exist_ok=True)
    items = [(label, sub, [Cell(u, an) for u, an in cells]) for label, sub, cells in ITEMS]
    for label, sub, cells in items:
        gif(f"{label}-A-初版-動作", sub, cells, OUT / f"{label}-A-初版-動作.gif")
    overview(items)
    if not a.no_all:
        allcells = [c for _, _, cells in items for c in cells]
        gif("P1-99-動作對照", "全部新動作，依 P1-01 到 P1-05 的順序排列（縮成三分之二大小）。", allcells,
            OUT / "P1-99-動作對照.gif", cols=6, scale=2 / 3)
