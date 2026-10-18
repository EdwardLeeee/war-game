"""R6 production review boards: the building and resource-point atlases drawn the way the game draws them
(design/b1/atlas-buildings.md), and next to the approved B1-02 look (ceo 2026-10-18: before art-v2, two or
three buildings side by side, approved and production, a large one and a small one at least).

python3 common/compare_b1.py compare --approved DIR   DIR/core3, DIR/states: the B1 renders the approved boards
                                                      were made from -> out/R6-A1-量產對照-<建築>-mobile.png
python3 common/compare_b1.py sheet                    -> out/R6-A2-建築量產總表-<東陸|西陸>-mobile.png,
                                                         out/R6-A3-資源點量產總表-mobile.png
Both read build/atlas_x3/ (atlas_b1.py). The approved side is put together as the B1 boards were (scene.piece,
the smoke columns over it); the production side from the atlas pages as the client draws them: the shadow
(half resolution, scaled 2x), the colour layer, the player-colour layer tinted with the player colour.
"""
import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(1, str(HERE.parents[1] / "round1" / "common"))
import artboard   # noqa: E402
import b1art      # noqa: E402
import config     # noqa: E402
import scene      # noqa: E402

ATLAS = config.BUILD / "atlas_x3"
TINT = {"blue": config.TEAM["blue"], "red": config.TEAM["red"], "neutral": (216, 210, 192)}
STATES = [("done", "完成", "done"), ("build1", "施工 1", "build_a1"), ("build2", "施工 2", "build_a2"),
          ("build3", "施工 3", "build_a3"), ("damaged", "受損", "damaged_a"), ("rubble", "瓦礫", "destroyed_a")]
COMPARE = [("main_city", "MainCity", "E", "主城", "大建築"), ("house", "House", "W", "民居", "小建築"),
           ("barracks", "Barracks", "E", "兵營", "中建築")]


class Atlas:
    """One atlas folder (buildings_<c>.json or nodes.json) and its pages."""

    def __init__(self, path):
        self.man = json.loads(Path(path).read_text())
        d = Path(path).parent
        self.pages = {k: [Image.open(d / p) for p in v] for k, v in self.man["pages"].items()}

    def _crop(self, layer, table, name):
        e = self.man[table].get(name)
        if not e:
            return None
        pg = self.pages[layer][e["page"]]
        return pg.crop((e["x"], e["y"], e["x"] + e["w"], e["y"] + e["h"])), e["ax"], e["ay"]

    def sprite(self, name, team, ppm, footprint, ground=False):
        """A scene sprite as the client draws the frame: colour, then the tinted player colour, over its shadow."""
        s = ppm / self.man["px_per_m"]
        col, ax, ay = self._crop("color", "frames", name)
        img = col.convert("RGBA")
        t = self._crop("team", "team", name) if "team" in self.man else None
        if t:
            ti, tax, tay = t
            r, g, b, a = ti.convert("RGBA").split()
            tr, tg, tb = TINT[team]
            tinted = Image.merge("RGBA", (r.point(lambda v: v * tr // 255), g.point(lambda v: v * tg // 255),
                                          b.point(lambda v: v * tb // 255), a))
            img.alpha_composite(tinted, (int(round(ax - tax)), int(round(ay - tay))))
        img = scene._scaled(img, s)
        sh = None
        sd = self._crop("shadow", "shadows", name)
        if sd:
            si, sax, say = sd
            a = si.getchannel("A")
            black = Image.merge("RGBA", (Image.new("L", a.size, 0),) * 3 + (a,))
            sh = (scene._scaled(black, 2 * s), sax * 2 * s, say * 2 * s)
        fx, fy = footprint
        hx, hy = fx * self.man["cell_m"] / 2, fy * self.man["cell_m"] / 2      # half the footprint, metres
        return scene.Spr(img, ax * s, ay * s, (-hx, hx, -hy, hy), sh, ground=ground)


def approved_sprites(src, kind, c, state, ppm, team):
    d = Path(src) / ("core3" if state == "done" else "states")
    name = f"{kind}_{c}" if state == "done" else f"{kind}_{c}_{state}"
    return scene.with_fx(scene.piece(d, name, "x3", ppm=ppm, team=team))


def _board(label, sub, rows, M=50, lab_w=230, gap=12):
    """rows: [(title, [images])] -> the board, saved as out/<label>.png."""
    W = M * 2 + lab_w + max(sum(i.width + gap for i in r) for _, r in rows)
    top = b1art.header_height(sub, W - 2 * M)
    H = top + sum(max(i.height for i in r) + 30 for _, r in rows) + 40
    art = Image.new("RGB", (W, H), b1art.BG)
    y = b1art.draw_header(art, label, sub, M)
    dr = ImageDraw.Draw(art)
    for title, r in rows:
        h = max(i.height for i in r)
        b1art.wrap(dr, M, y + 6, title, lab_w - 16, size=22, fill=b1art.INK)
        x = M + lab_w
        for im in r:
            art.paste(im.convert("RGB"), (x, y + h - im.height))
            x += im.width + gap
        y += h + 30
    art = art.crop((0, 0, W, y + 10))
    p = config.OUT / f"{label}.png"
    art.save(p)
    print("wrote", p.name, art.size)
    return p


def compare(src):
    out = []
    for kind, btype, c, name, size in COMPARE:
        atlas = Atlas(ATLAS / "buildings" / f"buildings_{c}.json")
        b = atlas.man["buildings"][btype]
        team = "blue" if c == "E" else "red"
        rows = []
        for pp, pp_lab in ((1.5, "放大（1 pt = 1.5 px）"), (1.0, "實際大小（1 pt = 1 px）")):
            ppm = 20 * pp
            ap, pr = [], []
            for st, lab, ast in STATES:
                a_items = approved_sprites(src, kind, c, ast, ppm, team)
                ap.append(b1art.caption(b1art.tile(a_items, pp, footprint=tuple(b["footprint"]), pad=14),
                                        f"核准・{lab}", 16 if pp > 1 else 13))
                fr = b["states"][st]
                p_items = [atlas.sprite(fr, team, ppm, b["footprint"])]
                pr.append(b1art.caption(b1art.tile(p_items, pp, footprint=tuple(b["footprint"]), pad=14),
                                        f"量產・{lab}", 16 if pp > 1 else 13))
            rows += [(f"核准稿\n{pp_lab}", ap), (f"量產圖集\n{pp_lab}", pr)]
        label = f"R6-A1-量產對照-{name}{b1art.CULT[c]}-mobile"
        sub = (f"{name}（{b1art.CULT[c]}，{size}，占地 {b['footprint'][0]}×{b['footprint'][1]}）。上：使用者核准的 B1-02 A（施工中分三階段、受損著火、"
               "被摧毀瓦礫堆）；下：art-v2 的量產圖集，照遊戲的畫法（影子、顏色層、玩家色層）組起來。"
               "施工 1（地基）和瓦礫是依占地大小共用的那張；受損的火和煙是靜態的，畫在圖裡。黃框是占地。")
        out.append(_board(label, sub, rows))
    return out


def sheet():
    out = []
    for c in ("E", "W"):
        atlas = Atlas(ATLAS / "buildings" / f"buildings_{c}.json")
        team = "blue" if c == "E" else "red"
        rows = []
        for btype, b in atlas.man["buildings"].items():
            cells = []
            names = [(lab, b["states"].get(st)) for st, lab, _ in STATES] + [
                (f"作物 {i + 1}", n) for i, n in enumerate(b.get("crops", []))]
            for lab, fr in names:
                if not fr:
                    continue
                tm = "neutral" if btype == "TownTower" else team
                sp = atlas.sprite(fr, tm, 30, b["footprint"], ground=b.get("ground", False))
                cells.append(b1art.caption(b1art.tile([sp], 1.5, footprint=tuple(b["footprint"]), pad=12),
                                           f"{lab}・{fr}", 13))
            rows.append((f"{btype}\n（{b['footprint'][0]}×{b['footprint'][1]}）", cells))
        mem = json.loads((ATLAS / "buildings" / "memory.json").read_text())[f"buildings_{c}"]
        label = f"R6-A2-建築量產總表-{b1art.CULT[c]}-mobile"
        sub = (f"{b1art.CULT[c]}的每一張建築影格，照遊戲的畫法組起來（1 pt = 1.5 px，黃框是占地；大城箭樓用中立灰白）。"
               f"這一組頁 3 倍未壓縮 {mem['total_rgba8_bytes'] / 2 ** 20:.1f} MB、ASTC 4×4 {mem['total_astc_4x4_bytes'] / 2 ** 20:.1f} MB。")
        out.append(_board(label, sub, rows))
    atlas = Atlas(ATLAS / "nodes" / "nodes.json")
    rows = []
    for nk, n in atlas.man["nodes"].items():
        if isinstance(n["variants"], dict):
            groups = [(f"{nk} {c}", n["variants"][c] + [n["depleted"][c]]) for c in ("E", "W")]
        else:
            groups = [(nk, [f"{v}_{s}" for v in n["variants"] for s in n["stages"]])]
        for title, frames in groups:
            cells = [b1art.caption(b1art.tile([atlas.sprite(fr, "blue", 30, (1, 1))], 1.5, footprint=(1, 1), pad=12),
                                   fr, 13) for fr in frames]
            rows.append((title, cells))
    out.append(_board("R6-A3-資源點量產總表-mobile", "每一張資源點影格，照遊戲的畫法組起來（1 pt = 1.5 px，黃框是一格）。", rows))
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["compare", "sheet"])
    ap.add_argument("--approved", help="folder with core3/ and states/ of the B1 renders (compare)")
    a = ap.parse_args()
    config.OUT.mkdir(parents=True, exist_ok=True)
    compare(a.approved) if a.what == "compare" else sheet()
