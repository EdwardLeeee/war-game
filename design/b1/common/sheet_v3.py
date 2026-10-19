"""art-v3 (D-088): every building and resource-point frame of the packed atlases, at actual size (3x frames / 3), with
its player-colour share, for review before the release.

python3 common/sheet_v3.py ATLAS_X3 RAW
  ATLAS_X3  the packed 3x atlases (atlas_b1.py: buildings/, nodes/)
  RAW       the renders they were packed from (<frame>_x3_{beauty,mask}.png), for the player-colour share
-> out/B1-05-方形斜看-建築總表-<東陸|西陸>.png, out/B1-05-方形斜看-資源點總表.png
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "round1" / "common"))
import artboard  # noqa: E402

OUT = HERE.parent / "out"
BG, INK, GREY = (244, 241, 234), (40, 40, 40), (96, 96, 96)
BLUE = np.array((0x3f, 0x7f, 0xe0), np.float32) / 255.0
NAMES = {"MainCity": "主城", "House": "民居", "LumberCamp": "伐木場", "Mine": "礦場", "Granary": "糧倉", "Farm": "農田",
         "Barracks": "兵營", "Range": "射場", "MageHall": "法術營", "TownTower": "大城箭樓", "ArrowTower": "箭樓", "Stable": "馬廄",
         "Tree": "樹", "GoldMine": "金礦", "Berries": "野果", "CrystalVein": "晶脈"}
STATE = {"build1": "施工 1", "build2": "施工 2", "build3": "施工 3", "done": "完成", "damaged": "受損", "rubble": "瓦礫"}


def font(size, bold=True):
    return artboard.font(size, weight="bold" if bold else "regular")


def share(raw, frame):
    a = np.asarray(Image.open(raw / f"{frame}_x3_beauty.png").getchannel("A")) > 128
    m = np.asarray(Image.open(raw / f"{frame}_x3_mask.png").convert("L")) > 128
    return float((a & m).sum()) / max(1, a.sum())


class Pages:
    def __init__(self, man_path):
        self.dir = man_path.parent
        self.m = json.loads(man_path.read_text())
        self.pages = {k: [Image.open(self.dir / p).convert("RGBA") for p in v] for k, v in self.m["pages"].items() if k != "shadow"}

    def body(self, name):
        e = self.m["frames"][name]
        img = self.pages["color"][e["page"]].crop((e["x"], e["y"], e["x"] + e["w"], e["y"] + e["h"])).copy()
        t = self.m.get("team", {}).get(name)
        if t:
            ti = self.pages["team"][t["page"]].crop((t["x"], t["y"], t["x"] + t["w"], t["y"] + t["h"]))
            arr = np.asarray(ti, np.float32).copy()
            arr[..., :3] *= BLUE
            img.alpha_composite(Image.fromarray(arr.astype(np.uint8), "RGBA"), (round(e["ax"] - t["ax"]), round(e["ay"] - t["ay"])))
        return img.resize((max(1, img.width // 3), max(1, img.height // 3)), Image.LANCZOS)


def sheet(rows, title, sub, out):
    """rows: [(row label, [(frame image, caption)])]"""
    pad, gap, cap = 24, 18, 34
    W = max(240 + sum(im.width + gap for im, _ in cells) for _, cells in rows) + 2 * pad
    head = 150
    H = head + sum(max(im.height for im, _ in cells) + cap + 20 for _, cells in rows) + pad
    art = Image.new("RGB", (W, H), BG)
    dr = ImageDraw.Draw(art)
    dr.text((pad, 20), title, font=font(40), fill=INK)
    dr.text((pad, 80), sub, font=font(18, False), fill=GREY)
    y = head
    for label, cells in rows:
        h = max(im.height for im, _ in cells)
        dr.text((pad, y + h // 2 - 12), label, font=font(20), fill=INK)
        x = pad + 240
        for im, c in cells:
            art.paste(Image.alpha_composite(Image.new("RGBA", im.size, (*(112, 126, 92), 255)), im).convert("RGB"), (x, y + h - im.height))
            dr.text((x, y + h + 6), c, font=font(14, False), fill=GREY)
            x += im.width + gap
        y += h + cap + 20
    OUT.mkdir(exist_ok=True)
    art.save(out, optimize=True)
    print("wrote", out.name, art.size)


def main(atlas, raw):
    atlas, raw = Path(atlas), Path(raw)
    for c, cn in (("E", "東陸"), ("W", "西陸")):
        P = Pages(atlas / "buildings" / f"buildings_{c}.json")
        rows = []
        for btype, b in P.m["buildings"].items():
            cells = []
            for st, fr in b["states"].items():
                cap = STATE.get(st, st)
                if st in ("done", "damaged") and btype != "TownTower":
                    cap += f" {share(raw, fr) * 100:.1f}%"
                cells.append((P.body(fr), cap))
            for k, fr in enumerate(b.get("crops", [])):
                cap = ("播種", "生長", "成熟")[k] + (f" {share(raw, fr) * 100:.1f}%" if k == 2 else "")
                cells.append((P.body(fr), cap))
            rows.append((NAMES.get(btype, btype), cells))
        sheet(rows, f"B1-05-方形斜看-建築總表-{cn}",
              "art-v3（D-088）打包好的圖集，實際大小（1 pt = 1 px），玩家色用藍。百分比是玩家色比例（B1：至少 5%）。大城箭樓是中立的，沒有玩家色。",
              OUT / f"B1-05-方形斜看-建築總表-{cn}.png")
    N = Pages(atlas / "nodes" / "nodes.json")
    rows = []
    for kind, nd in N.m["nodes"].items():
        names = []
        if isinstance(nd["variants"], dict):
            for c, vs in nd["variants"].items():
                names += vs + [nd["depleted"][c]]
        else:
            names = [f"{v}_{s}" for v in nd["variants"] for s in nd["stages"]]
        rows.append((NAMES.get(kind, kind), [(N.body(n), n) for n in names]))
    sheet(rows, "B1-05-方形斜看-資源點總表", "art-v3（D-088）打包好的圖集，實際大小。樹分東陸、西陸；金礦、野果、晶脈兩陸共用。",
          OUT / "B1-05-方形斜看-資源點總表.png")


if __name__ == "__main__":
    main(*sys.argv[1:3])
