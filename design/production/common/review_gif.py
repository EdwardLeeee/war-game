"""Motion GIFs of the new animations, for ceo to show the user before mass production.

python3 common/fetch_ci.py is not used here: download the review renders with
  gh run download <run_id> -n production-review-<unit> -D build/prod/review-<unit>
then
  python3 common/review_gif.py
-> out/P1-0N-<item>-A-初版-動作.gif, out/P1-99-動作對照.gif, out/P1-99-總覽對照.png

Every cell plays on one clock at the speed the game will use (client/docs/sprite-atlas.md: attack
and hit 20 frames a second, shatter 16, falls 12, work 10). One-shot animations hold their last
frame, then start again. Facing 7 (toward the camera, to the right), phone pixels (1 pt = 3 px).
East in blue, West in red, the look approved in R5.
"""
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
SECONDS = 2.4
FPS = dict(spec.FPS, walk=10)
NAMES = {"mage_e": "劍修", "mage_w": "學院大師", "hcav_e": "具裝騎兵", "knight_w": "騎士", "siege_e": "霹靂車",
         "siege_w": "投石機", "farmer_e": "東陸農夫", "farmer_w": "西陸農民"}
ANIM = {"attack": "晶彈", "hit": "受擊", "shatter": "破盾", "fall": "倒下", "death": "倒下", "walk": "走路（輪子轉）",
        "work_chop": "砍樹", "work_mine": "挖礦", "work_farm": "耕田", "work_build": "蓋房子"}

# item: (label, cells); a cell is (unit, [animations played one after another])
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


def _sprite(d, base, team, mage):
    """R5 look (AO, player colour, crystal glow, effects) with the whole shadow: the shadow frame is
    larger than the colour frame (right and below), so the two are aligned on the ground anchor."""
    import numpy as np
    compose = r5art.compose
    key = f"{base}_x3"
    b = compose.load(d, key, "beauty")
    img = b.img
    crystal = r5art.crystal_mask(img, d, key) if mage else None
    ao = np.asarray(Image.open(d / f"{key}_ao.png").convert("L"), np.float32) / 255.0
    a = np.asarray(img, np.float32)
    a[..., :3] *= (0.7 + 0.3 * ao)[..., None]
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")
    img = compose.recolor(img, Image.open(d / f"{key}_mask.png"), r2art.TEAM[team])
    if mage and crystal is not None and crystal.any():
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
    return r5art.compose.Sprite(out, (left, top))


def _frames(unit, anims):
    """[(sprite key, hold ticks)] for the cell's sequence; one-shots hold the last frame 0.6 s."""
    n = dict(spec.REVIEW_ANIMS[unit])
    seq = []
    for a in anims:
        per = TICK / FPS.get(a, 12)
        for i in range(n[a]):
            seq.append((spec.frame_name(unit, a, 7, i), per))
    loop = anims[-1] in ("walk",) or anims[-1].startswith("work_")
    if not loop:
        seq.append((seq[-1][0], TICK * 0.6))
    return seq


def _at(seq, tick):
    total = sum(h for _, h in seq)
    t = tick % total
    for key, h in seq:
        if t < h:
            return key
        t -= h
    return seq[-1][0]


class Cell:
    def __init__(self, unit, anims):
        self.unit, self.anims = unit, anims
        self.dir = config.BUILD / "prod" / f"review-{unit}" / "raw"
        self.seq = _frames(unit, anims)
        self.cache = {}
        self.team = "e" if unit.endswith("_e") else "w"
        mage = unit.startswith("mage")
        for key, _ in self.seq:
            if key not in self.cache:
                self.cache[key] = _sprite(self.dir, key, self.team, mage)
        ims = list(self.cache.values())
        self.left = max(s.anchor[0] for s in ims)
        self.top = max(s.anchor[1] for s in ims)
        self.w = int(max(s.img.width - s.anchor[0] for s in ims) + self.left) + 8
        self.h = int(max(s.img.height - s.anchor[1] for s in ims) + self.top) + 8

    def label(self):
        return f"{NAMES[self.unit]}｜{'→'.join(ANIM[a] for a in self.anims if a != 'dead')}"

    def image(self, tick, w, h):
        sp = self.cache[_at(self.seq, tick)]
        can = r2art.ground(w, h, zoom=1.0).copy()
        ax = (w - self.w) / 2 + self.left           # the same ground point in every frame of the cell
        ay = 4 + self.top
        can.alpha_composite(sp.img, (int(ax - sp.anchor[0]), int(ay - sp.anchor[1])))
        return can


def gif(label, sub, cells, path, cols=4):
    cw = max(c.w for c in cells) + 20
    ch = max(c.h for c in cells) + 44
    cols = min(cols, len(cells))
    rows = (len(cells) + cols - 1) // cols
    M, TOP = 16, 96
    W, H = M * 2 + cols * cw + (cols - 1) * 8, TOP + rows * (ch + 8) + 8
    tmp = Path(tempfile.mkdtemp(prefix="p1gif_", dir=config.BUILD))
    n = int(TICK * SECONDS)
    for i in range(n):
        can = Image.new("RGBA", (W, H), (*BG, 255))
        dr = ImageDraw.Draw(can)
        dr.text((M, 10), label, font=artboard.font(28), fill=INK)
        r2art._wrap(dr, M, 50, sub, GREY, 17, W - 2 * M)
        for k, c in enumerate(cells):
            x = M + (k % cols) * (cw + 8)
            y = TOP + (k // cols) * (ch + 8)
            can.alpha_composite(c.image(i, cw, ch - 30), (x, y + 30))
            dr.text((x + 4, y + 4), c.label(), font=artboard.font(18), fill=INK)
        can.convert("RGB").save(tmp / f"{i:03d}.png")
    pal = tmp / "pal.png"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", str(TICK), "-i", str(tmp / "%03d.png"), "-vf",
                    "palettegen=stats_mode=full", str(pal)], check=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", str(TICK), "-i", str(tmp / "%03d.png"), "-i",
                    str(pal), "-lavfi", "paletteuse=dither=sierra2_4a", "-loop", "0", str(path)], check=True)
    first = Image.open(tmp / "010.png")
    for p in tmp.iterdir():
        p.unlink()
    tmp.rmdir()
    print("wrote", path.name, (W, H))
    return first


def overview(strips):
    """Key frames of every item in one still image (the GIFs show the motion)."""
    M = 60
    W = max(s.width for _, s in strips) + 2 * M
    H = 180 + sum(s.height + 70 for _, s in strips)
    art = Image.new("RGB", (W, H), BG)
    dr = ImageDraw.Draw(art)
    dr.text((M, 36), "P1-99-總覽對照", font=artboard.font(52), fill=INK)
    r2art._wrap(dr, M, 110, "量產前要核准的新動作。每一項各有一個動作 GIF；這張是各項中間的一格。朝向右前，手機像素（1 pt = 3 px），"
                "東陸藍、西陸紅。", GREY, 24, W - 2 * M)
    y = 180
    for label, s in strips:
        dr.text((M, y), label, font=artboard.font(30), fill=INK)
        art.paste(s.convert("RGB"), (M, y + 46))
        y += s.height + 70
    art.save(OUT / "P1-99-總覽對照.png")
    print("wrote P1-99-總覽對照.png")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    strips = []
    allcells = []
    for label, sub, cells in ITEMS:
        cs = [Cell(u, a) for u, a in cells]
        allcells += cs
        first = gif(f"{label}-A-初版-動作", sub, cs, OUT / f"{label}-A-初版-動作.gif")
        strips.append((label, first))
    overview(strips)
    gif("P1-99-動作對照", "全部新動作：由左到右、由上到下依 P1-01 到 P1-05 排列。", allcells, OUT / "P1-99-動作對照.gif", cols=6)
