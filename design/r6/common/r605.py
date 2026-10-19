"""R6-05 (D-088, the user 2026-10-19: 「我覺得地圖還是正方形好」, 甲 方形斜看): the approved buildings (art-v2, the
diamond camera) beside the same buildings with the oblique camera, before every piece is rendered again for art-v3.
ceo 2026-10-19: a big and a small one and one of the west; each board gives both player-colour shares.

python3 common/r605.py ART V2RAW NEW
  ART    an extracted art-v2-x3.tar.gz (units/, buildings/)
  V2RAW  the art-v2 renders of the buildings (<frame>_x3_{beauty,mask}.png), for the player-colour share
  NEW    the oblique renders (design/b1/common/run.py sqdone_*: <frame>_x3_*.png, <frame>_x3.json)
-> out/R6-05-方形斜看建築-<棟>-mobile.png, out/R6-05-方形斜看建築-總覽.png
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(1, str(HERE.parents[1] / "b1" / "common"))
import boards     # noqa: E402
import field      # noqa: E402

SCALE = 3
# (frame kind, culture, BuildingType, the name on the board, the soldier standing by it, what changed)
PIECES = [
    ("main_city", "E", "MainCity", "主城東陸", "spear_e", "大建築（4×4 格）。模型沒有改：旗和正面的布幔本來就朝鏡頭。"),
    ("house", "E", "House", "民居東陸", "spear_e",
     "小建築（2×2 格）。核准稿的玩家色是側牆上的布幔，正對格線以後側牆看不到，所以把布幔移到正面、門的右邊。"),
    ("barracks", "W", "Barracks", "兵營西陸", "pike_w", "西陸（3×3 格）。"),
]
AT = (10, 10)          # the footprint's corner, in cells


class RawAtlas:
    """The renders of design/b1/common/run.py, read the way atlas_b1 packs them (the same interface as field.Atlas)."""

    def __init__(self, src, c):
        import atlas_b1
        self.src, self.ab = Path(src), atlas_b1
        self.m = {"buildings": atlas_b1.building_table(c)}

    def _layers(self, name):
        self.ab.SRC = self.src
        return self.ab.layers(name)

    def body(self, name, team):
        col, tm, _, (ax, ay), _ = self._layers(name)
        arr = np.asarray(tm, np.float32).copy()
        arr[..., :3] *= np.array(field.TEAM[team], np.float32) / 255.0
        col = col.copy()
        col.alpha_composite(Image.fromarray(arr.astype(np.uint8), "RGBA"))
        return col, ax, ay

    def shadow(self, name):
        _, _, sh, _, (sax, say) = self._layers(name)
        a = sh.getchannel("A")
        img = Image.merge("RGBA", (Image.new("L", a.size, 0),) * 3 + (a,))
        return img.resize((img.width * 2, img.height * 2), Image.BILINEAR), sax * 2, say * 2


def share(src, frame):
    """The player colour's share of the building's pixels (b1art.team_share: mask over half, alpha over half)."""
    a = np.asarray(Image.open(Path(src) / f"{frame}_x3_beauty.png").getchannel("A")) > 128
    m = np.asarray(Image.open(Path(src) / f"{frame}_x3_mask.png").convert("L")) > 128
    return float((a & m).sum()) / max(1, a.sum())


def grid_decal(n, centre, extra=2):
    """Faint cells around the footprint and the footprint's outline (the boards only; the game has no grid)."""
    W, H = field.SCREEN[0] * SCALE, field.SCREEN[1] * SCALE
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    x0, y0 = AT[0] - extra, AT[1] - extra
    pt = lambda x, y: tuple(v * SCALE for v in field.cell_to_pt(x, y, centre))
    for i in range(n + 2 * extra + 1):
        dr.line([pt(x0 + i, y0), pt(x0 + i, y0 + n + 2 * extra)], fill=(40, 50, 30, 40), width=2)
        dr.line([pt(x0, y0 + i), pt(x0 + n + 2 * extra, y0 + i)], fill=(40, 50, 30, 40), width=2)
    corners = [pt(*AT), pt(AT[0] + n, AT[1]), pt(AT[0] + n, AT[1] + n), pt(AT[0], AT[1] + n)]
    dr.line(corners + corners[:1], fill=(250, 246, 230, 170), width=3)
    return im, W / 2, H / 2, centre[0], centre[1]


def scene(kind, c, btype, soldier, view, atlases, art):
    field.VIEW = view
    n = {"MainCity": 4, "House": 2, "Barracks": 3}[btype]
    mx, my = AT[0] + n / 2, AT[1] + n / 2
    centre = (mx, my)
    # three soldiers by the front right corner, the same cells for both cameras
    units = [(soldier, "blue", AT[0] + n + 0.9, AT[1] + n - 0.6, 4, "idle", 0, False),
             (soldier, "blue", AT[0] + n + 1.0, AT[1] + n + 0.5, 4, "idle", 3, False),
             (soldier, "blue", AT[0] + n - 0.2, AT[1] + n + 1.1, 4, "idle", 6, False)]
    sc = dict(centre=centre, buildings=[(c, btype, "done", AT[0], AT[1], "blue")], units=units,
              decals=[grid_decal(n, centre)])
    img, _ = field.render(sc, art, scale=SCALE, atlases=atlases)
    return img, field.cell_to_pt(mx, my, centre)


def panel(img, anchor_pt, n, top_pt):
    """The building and its soldiers cut out of the screen, the same box for both cameras (pt)."""
    w, below = 50 * n + 170, 16 * n + 60
    x0 = anchor_pt[0] - w * 0.45
    y0 = anchor_pt[1] - top_pt
    return img.crop(tuple(int(round(v * SCALE)) for v in (x0, y0, x0 + w, anchor_pt[1] + below))).convert("RGB")


def main(art, v2raw, new):
    art, v2raw, new = Path(art), Path(v2raw), Path(new)
    v2atl = {c: field.Atlas(art / "buildings" / f"buildings_{c}.json") for c in ("E", "W")}
    newatl = {c: RawAtlas(new, c) for c in ("E", "W")}
    rows = []
    for kind, c, btype, label_name, soldier, note in PIECES:
        frame = f"{kind}_{c}_done"
        s_old, s_new = share(v2raw, frame), share(new, frame)
        n = {"MainCity": 4, "House": 2, "Barracks": 3}[btype]
        # the taller of the two sprites sets the box, so both panels are the same size
        tops = [v2atl[c].body(frame, "blue")[2], newatl[c].body(frame, "blue")[2]]
        top_pt = max(tops) / 3 + 24
        old_img, old_a = scene(kind, c, btype, soldier, "diamond", v2atl, art)
        new_img, new_a = scene(kind, c, btype, soldier, "oblique", newatl, art)
        p_old, p_new = panel(old_img, old_a, n, top_pt), panel(new_img, new_a, n, top_pt)
        cap_old = f"左：核准稿（art-v2，斜 45°）· 玩家色 {s_old * 100:.1f}%"
        cap_new = f"右：方形斜看（art-v3 會用這個）· 玩家色 {s_new * 100:.1f}%"
        big = boards.row([boards.captioned(p_old, cap_old, 30), boards.captioned(p_new, cap_new, 30)],
                         boards.M * 2 + p_old.width * 2 + 40)
        W = big.width
        small = [p.resize((p.width // 3, p.height // 3), Image.LANCZOS) for p in (p_old, p_new)]
        label = f"R6-05-方形斜看建築-{label_name}-mobile"
        head = boards.header(W, label,
                             f"{label_name}：{note}\n"
                             f"玩家色比例（建築畫面裡換成玩家色的部分，至少要 5%）：核准稿 {s_old * 100:.1f}%，方形斜看 {s_new * 100:.1f}%。\n"
                             "方形斜看：鏡頭仰角照舊 30 度，正對格線（D-088）；一格在畫面上是 40×20 pt。兵是 art-v2 的圖，不用重算。"
                             "淡淡的格線和白框是占地，只畫在設計稿上，遊戲裡沒有。玩家色用藍（R6-24 甲）。上：手機像素（3 倍）；下：實際大小。")
        act = boards.row([boards.captioned(small[0], "實際大小：核准稿", 22), boards.captioned(small[1], "實際大小：方形斜看", 22)], W)
        boards.save(boards.stack([head, big, act], W), label)
        rows.append((label_name, s_old, s_new, small))
    # overview: the three at actual size, one row each, approved left, oblique right
    def pair(a, b, gap=30):
        out = Image.new("RGB", (a.width + gap + b.width, max(a.height, b.height)), boards.BG)
        out.paste(a, (0, 0))
        out.paste(b, (a.width + gap, 0))
        return out
    cells = [boards.captioned(pair(*sm), f"{nm}：{a * 100:.1f}% → {b * 100:.1f}%", 24)
             for nm, a, b, sm in rows]
    W = boards.M * 2 + max(max(c.width for c in cells), 900)
    parts = [boards.header(W, "R6-05-方形斜看建築-總覽",
                           "三棟的核准稿（左，斜 45°）和方形斜看（右），實際大小（1 pt = 1 px）。百分比是玩家色比例（至少要 5%）。")]
    parts += [boards.row([c], W) for c in cells]
    boards.save(boards.stack(parts, W), "R6-05-方形斜看建築-總覽")
    for nm, a, b, _ in rows:
        print(f"{nm}: {a * 100:.1f}% -> {b * 100:.1f}%")


if __name__ == "__main__":
    main(*sys.argv[1:4])
