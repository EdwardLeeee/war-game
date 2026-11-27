"""R27-04: the check boards of art-v7.12's outpost, drawn from the packed atlas as the client draws it.

python3 design/r27/common/facings_board.py ATLAS_X3 OUT
  ATLAS_X3: a buildings-atlas artifact's atlas_x3 folder (buildings/buildings_<c>.json and its pages)
  OUT:      the boards

- R27-04-正式圖-東陸-八朝向-phone.png, -西陸-: every state (rows) in every facing (columns, facings[f]).
- R27-04-正式圖-牆頂的兵-phone.png: the done look in every facing, both cultures, six men on the walk (the most it
  holds) at that facing's stand_m.

Drawn as client/src/render/structure-art.ts draws an outpost:
- the picture's anchor on the footprint's middle;
- the shadow under it;
- the colour with the team layer tinted;
- the men at stand_m (outpost-crew.ts crewSpots: metres x east, y south, z up; the diamond projection's
  x' = (x - y) / sqrt 2, y' = (x + y) / (2 sqrt 2) - z sqrt 3 / 2, a metre = ppx), each looking out from the middle;
- the front layer over them.

The dashed diamond is the 3 x 3 it blocks. The gold arrow is the facing's way out (design/r27/spec.md section 1).
"""
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import compose as C           # noqa: E402  (unit_frame, tinted, facing_of, paste_scaled, dashed, arrow)

FACING = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]      # spec section 1
FACING_NAME = ["東西", "西北東南", "南北", "東北西南", "東西", "西北東南", "南北", "東北西南"]
STATES = [("build1", "施工 1"), ("build2", "施工 2"), ("build3", "施工 3"), ("done", "蓋好"), ("damaged", "受損"), ("rubble", "瓦礫")]
CREW = 6
BG = (24, 26, 31)
GROUND = (104, 116, 74)
INK = (236, 236, 236)
DIM = (170, 174, 182)
GOLD = (242, 200, 98)
FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
FONT_R = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"


def font(size, bold=True):
    return ImageFont.truetype(FONT if bold else FONT_R, size, index=3)      # (index 3: Noto Sans CJK TC)


class Atlas:
    def __init__(self, root, c):
        self.dir = Path(root) / "buildings"
        self.j = json.loads((self.dir / f"buildings_{c}.json").read_text())
        self.pages = {k: [Image.open(self.dir / p).convert("RGBA") for p in v] for k, v in self.j["pages"].items()}
        self.ppm = self.j["px_per_m"]

    def crop(self, table, name):
        fr = self.j[table].get(name)
        if fr is None:
            return None, None
        im = self.pages[{"frames": "color", "team": "team", "shadows": "shadow"}[table]][fr["page"]]
        return im.crop((fr["x"], fr["y"], fr["x"] + fr["w"], fr["y"] + fr["h"])), fr

    def picture(self, name, owner):
        """The colour with its team layer tinted (C.tinted), and its anchor."""
        color, fr = self.crop("frames", name)
        team, tr = self.crop("team", name)
        if team is not None:
            full = Image.new("RGBA", color.size, (0, 0, 0, 0))
            full.alpha_composite(team, (round(fr["ax"] - tr["ax"]), round(fr["ay"] - tr["ay"])))
            color = C.tinted(color, full, owner, self.j.get("team_gain", 1.6))
        return color, (fr["ax"], fr["ay"])

    def shadow(self, name):
        im, fr = self.crop("shadows", name)
        if im is None:
            return None, None, None
        return im, (fr["ax"], fr["ay"]), self.ppm / 2 if fr.get("half_res") else self.ppm


def screen(mx, my, mz, ppx):
    """The client's diamond projection of a point metres from the anchor (x east, y south, z up), in board px."""
    return ((mx - my) / math.sqrt(2) * ppx, (mx + my) / (2 * math.sqrt(2)) * ppx - mz * math.sqrt(3) / 2 * ppx)


def tile(at, c, f, state, ppx, crew=0, size=(560, 460), owner=C.BLUE):
    """One outpost on a patch of ground: facing f, `state`, `crew` men on its walk; ppx board px a metre."""
    e = at.j["buildings"]["Outpost"]
    fe = e["facings"][f]
    img = Image.new("RGBA", size, GROUND + (255,))
    centre = (size[0] / 2, size[1] * 0.62)
    d = ImageDraw.Draw(img)
    corners = [screen(x, y, 0, ppx) for x, y in ((-3, -3), (3, -3), (3, 3), (-3, 3))]
    corners = [(centre[0] + x, centre[1] + y) for x, y in corners]
    name = fe["states"][state]
    sh, sa, sppm = at.shadow(name)
    if sh is not None:
        C.paste_scaled(img, sh, centre, sa, ppx / sppm)
    pic, anc = at.picture(name, owner)
    C.paste_scaled(img, pic, centre, anc, ppx / at.ppm)
    if crew and state in fe.get("fronts", {}):
        men = []
        for mx, my, mz in fe["stand_m"][:crew]:
            x, y = screen(mx, my, mz, ppx)
            gx, gy = screen(mx, my, 0, ppx)
            men.append((y, x, C.facing_of(gx, gy)))
        unit = "spear_e" if c == "E" else "pike_w"
        for y, x, fa in sorted(men):
            im, a, upm = C.unit_frame(unit, "idle", fa, 0, owner)
            C.paste_scaled(img, im, (centre[0] + x, centre[1] + y), a, ppx / upm)
        fr, fa = at.picture(fe["fronts"][state], owner)
        C.paste_scaled(img, fr, centre, fa, ppx / at.ppm)
    top = Image.new("RGBA", size, (0, 0, 0, 0))
    t = ImageDraw.Draw(top)
    for i in range(4):
        C.dashed(t, corners[i], corners[(i + 1) % 4], (255, 236, 150, 190), 2, dash=8, gap=6)
    dx, dy = FACING[f]
    n = math.hypot(dx, dy)
    a = screen(dx / n * 3.6, dy / n * 3.6, 0, ppx)
    b = screen(dx / n * 5.4, dy / n * 5.4, 0, ppx)
    C.arrow(t, (centre[0] + a[0], centre[1] + a[1]), (centre[0] + b[0], centre[1] + b[1]), GOLD + (255,), width=5)
    img.alpha_composite(top)
    return img


def check_text(texts):
    """Every character is in the font (Noto CJK has no check or cross marks): one drawn as the font's empty box is
    an error (boards_r27.check_glyphs)."""
    f = font(40)

    def ink(ch):
        im = Image.new("L", (80, 80), 0)
        ImageDraw.Draw(im).text((10, 5), ch, font=f, fill=255)
        return im

    tofu = ink("\ue000")
    bad = sorted({ch for s in texts for ch in s if not ch.isspace() and ImageChops.difference(ink(ch), tofu).getbbox() is None})
    if bad:
        raise SystemExit(f"no glyph in the font for: {' '.join(bad)}")


def board(title, lines, body, out, texts):
    check_text([title, *lines, *texts])
    pad = 40
    head = 64 + 40 * len(lines)
    img = Image.new("RGBA", (body.width + 2 * pad, body.height + head + pad), BG + (255,))
    d = ImageDraw.Draw(img)
    d.text((pad, 24), title, font=font(44), fill=INK)
    for i, s in enumerate(lines):
        d.text((pad, 84 + 40 * i), s, font=font(26, i == 0), fill=GOLD if i == 0 else DIM)
    img.alpha_composite(body, (pad, head))
    img.convert("RGB").save(out)
    print(out.name, img.size)


def states_board(root, c, out):
    at = Atlas(root, c)
    tw, th, lw, hh = 340, 300, 110, 70
    body = Image.new("RGBA", (lw + 8 * tw, hh + len(STATES) * th), BG + (255,))
    d = ImageDraw.Draw(body)
    texts = []
    for f in range(8):
        s = f"f{f} {FACING_NAME[f]}"
        texts.append(s)
        d.text((lw + f * tw + 8, 6), s, font=font(26), fill=INK)
        s2 = "縮小" if f % 2 else ""
        if s2:
            d.text((lw + f * tw + 8, 38), s2, font=font(20, False), fill=DIM)
    for r, (st, label) in enumerate(STATES):
        texts.append(label)
        d.text((8, hh + r * th + th // 2 - 16), label, font=font(26), fill=INK)
        for f in range(8):
            t = tile(at, c, f, st, 30, crew=CREW if st in ("done", "damaged") else 0, size=(tw - 8, th - 8))
            body.alpha_composite(t, (lw + f * tw, hh + r * th))
    culture = "東陸" if c == "E" else "西陸"
    board(f"R27-04-正式圖-{culture}-八朝向-phone",
          [f"{culture}哨所的 6 個狀態 × 8 個朝向，照 client 的畫法從 art-v7.12 的圖集畫出來（facings[f]）。",
           "淡黃虛線＝擋路的 3×3；金色箭頭＝朝向 f 的路朝外的方向（spec 第 1 節）；斜的（f 奇數）是縮小版。",
           f"蓋好、受損的牆頂站 {CREW} 名槍兵（駐守最多 6 名），站在那個朝向的 stand_m，前面那層蓋在兵上面。"],
          body, out / f"R27-04-正式圖-{culture}-八朝向-phone.png", texts)


def crew_board(root, out):
    tw, th = 600, 520
    body = Image.new("RGBA", (4 * tw, 4 * th + 4 * 44), BG + (255,))
    d = ImageDraw.Draw(body)
    texts = []
    for ci, c in enumerate("EW"):
        at = Atlas(root, c)
        for f in range(8):
            r, col = ci * 2 + f // 4, f % 4
            x, y = col * tw, r * (th + 44)
            s = f"{'東陸' if c == 'E' else '西陸'} f{f} {FACING_NAME[f]}{'（縮小）' if f % 2 else ''}"
            texts.append(s)
            d.text((x + 6, y + 4), s, font=font(26), fill=INK)
            body.alpha_composite(tile(at, c, f, "done", 60, crew=CREW, size=(tw - 10, th)), (x, y + 44))
    board("R27-04-正式圖-牆頂的兵-phone",
          [f"每個朝向蓋好時牆頂站 {CREW} 名（駐守最多 6 名），照 client 的畫法：stand_m 的點、前面那層蓋在兵上面。",
           "要看：兵站在牆頂的走道上，斜的四個站在縮小後的牆上，沒有浮在半空、沒有掉到牆外。原尺寸（x3 的 60 px 一公尺）。"],
          body, out / "R27-04-正式圖-牆頂的兵-phone.png", texts)


def main():
    root, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    for c in "EW":
        states_board(root, c, out)
    crew_board(root, out)


if __name__ == "__main__":
    main()
