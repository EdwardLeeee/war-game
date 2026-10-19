"""R6-06 城堡 (the user 2026-10-19: 「希望像一個城堡」; ceo: walls block walking, only the gates are open, the gates
always open to everyone; the small town a palisade, the big city stone walls with gate towers and corner towers; the
town's area becomes 「牆以內」; the walls never break and do not stop shots): which cells the walls, the gates and
the towers take, for war-game-core to put into the sim (the numbers are the ones core and ui agree on).

Cells are sim cells, as offsets from the town (sim/src/core/map.ts):
  small town: (dx, dy) from the town's centre cell (the town's middle is that cell's middle);
  big city:   (dx, dy) from the town's centre cell too, the tower on dx, dy in {-1, 0} (map.ts tower = centre - 1),
              so the layout is symmetric about the cell corner (0, 0) and a cell's middle is (dx + 0.5, dy + 0.5).
+x is east (screen right), +y south (toward the camera).

Kinds: wall (blocks), gate (walkable, always open), corner (wall cell at a corner: blocks), ctower (big city corner
tower, 2 x 2: blocks), tower (the TownTower, 2 x 2: blocks while it stands), square, street, garden (walkable).
The walls stand where the enclosed area is about the old circle's: the small town 9 x 9 = 81 cells inside (the
circle of radius 5 holds 81 cell middles), the big city 12 x 12 = 144 (the circle of radius 7 holds 156).

python3 common/castle.py      -> ../r6/out/R6-06-城堡-格子-小鎮.png, …-大城.png, ../castle-layout.json
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "round1" / "common"))

BLOCKS = {"wall", "corner", "ctower", "tower"}


def small():
    W = 5                                     # the wall ring: max(|dx|, |dy|) == 5
    cells = {}
    for dx in range(-W, W + 1):
        for dy in range(-W, W + 1):
            m = max(abs(dx), abs(dy))
            if m == W:
                if abs(dx) == W and abs(dy) == W:
                    k = "corner"
                elif (abs(dy) == W and abs(dx) <= 1) or (abs(dx) == W and abs(dy) <= 1):
                    k = "gate"                # where the 3-cell streets meet the wall
                else:
                    k = "wall"
            elif m <= 1:
                k = "square"
            elif abs(dx) <= 1 or abs(dy) <= 1:
                k = "street"
            else:
                k = "garden"
            cells[(dx, dy)] = k
    militia = [(-1, -1), (1, -1), (-1, 1), (1, 1), (1, 0), (0, 1)]    # B1-03 (cell offsets, the cell's middle)
    return dict(name="small", wall=W, cells=cells, militia=militia, garrison=[(0, 0)], flag=(0, 0), mid=lambda dx, dy: (dx + 0.5, dy + 0.5))


def large():
    cells = {}
    for dx in range(-7, 7):
        for dy in range(-7, 7):
            a, b = dx + 0.5, dy + 0.5             # from the tower's middle
            m = max(abs(a), abs(b))
            if m == 6.5:                          # the wall ring
                if abs(a) >= 5.5 and abs(b) >= 5.5:
                    k = "ctower"                  # the corner towers, 2 x 2 (the corner and its two neighbours)
                elif (abs(b) == 6.5 and abs(a) == 0.5) or (abs(a) == 6.5 and abs(b) == 0.5):
                    k = "gate"                    # 2 cells open; the avenue's other two cells are the gate towers' piers
                else:
                    k = "wall"
            elif abs(a) == 5.5 and abs(b) == 5.5:
                k = "ctower"                      # the corner towers' fourth cell, inside the wall
            elif dx in (-1, 0) and dy in (-1, 0):
                k = "tower"
            elif m <= 2.5:
                k = "square"
            elif abs(a) <= 1.5 or abs(b) <= 1.5:
                k = "street"
            else:
                k = "garden"
            cells[(dx, dy)] = k
    militia = [(1, 0), (1, -1), (-2, 0), (-2, -1), (0, 1), (-1, 1), (0, -2), (-1, -2), (2, 2), (-3, 2), (2, -3), (-3, -3)]
    return dict(name="large", wall=6.5, cells=cells, militia=militia, garrison=[(-2, -3), (-3, -2), (-2, -2)], flag=None,
                mid=lambda dx, dy: (dx + 0.5, dy + 0.5))


def circle_count(L):
    """Cells whose middle lies within the old radius (the sim's rule today), measured from the town's middle."""
    r = 5 if L["name"] == "small" else 7
    if L["name"] == "small":
        return sum(1 for (dx, dy) in L["cells"] if dx * dx + dy * dy <= r * r)
    return sum(1 for (dx, dy) in L["cells"] if (dx + 0.5) ** 2 + (dy + 0.5) ** 2 <= r * r)


def counts(L):
    """(cells of each kind, cells inside the wall ring: the town's area from now on)."""
    from collections import Counter
    off = 0.0 if L["name"] == "small" else 0.5
    inner = L["wall"] - 1
    inside = sum(1 for (dx, dy) in L["cells"] if max(abs(dx + off), abs(dy + off)) <= inner)
    return dict(Counter(L["cells"].values())), inside


def ground_plan(L):
    """[(x, y, kind)] in metres from the layout's middle, for towns.tground: the square, the streets (the gates too) and
    the gardens inside the walls; the tower's cells paved (seen once it is torn down)."""
    from layouts import CELL
    off = 0.0 if L["name"] == "small" else 0.5
    out = []
    for (dx, dy), k in L["cells"].items():
        k = {"gate": "street", "tower": "square"}.get(k, k)
        if k in ("square", "street", "garden"):
            out.append(((dx + off) * CELL, -(dy + off) * CELL, k))    # the render's +y is the sim's north
    return out


COL = {"wall": (96, 88, 80), "corner": (70, 62, 56), "ctower": (60, 52, 46), "tower": (120, 60, 50), "gate": (232, 196, 120),
       "square": (214, 206, 186), "street": (196, 186, 164), "garden": (150, 178, 112)}
NAMES = {"wall": "牆（擋路）", "corner": "牆角（擋路）", "ctower": "角樓 2×2（擋路）", "tower": "大城箭樓 2×2（擋路，拆掉後可走）",
         "gate": "城門（可走，一直開著）", "square": "廣場", "street": "街", "garden": "菜園"}


def diagram(L, title, sub, out):
    import artboard
    f = lambda s, b=True: artboard.font(s, weight="bold" if b else "regular")
    C = 34
    xs = [dx for dx, _ in L["cells"]]
    ys = [dy for _, dy in L["cells"]]
    x0, y0 = min(xs), min(ys)
    n = max(xs) - x0 + 1
    left, top = 70, 250
    W = max(left + n * C + 460, 1260)
    H = top + n * C + 140
    img = Image.new("RGB", (W, H), (244, 241, 234))
    dr = ImageDraw.Draw(img)
    dr.text((40, 26), title, font=f(40), fill=(40, 40, 40))
    y = 86
    for line in sub:
        dr.text((40, y), line, font=f(18, False), fill=(90, 90, 90))
        y += 26
    for (dx, dy), k in L["cells"].items():
        px, py = left + (dx - x0) * C, top + (dy - y0) * C
        dr.rectangle([px, py, px + C - 1, py + C - 1], fill=COL[k], outline=(244, 241, 234))
        if k in BLOCKS:
            dr.line([px + 4, py + 4, px + C - 5, py + C - 5], fill=(30, 26, 24), width=2)
    # the old circle, for comparison
    r = 5 if L["name"] == "small" else 7
    cx = left + (0 - x0 + (0.5 if L["name"] == "small" else 0)) * C
    cy = top + (0 - y0 + (0.5 if L["name"] == "small" else 0)) * C
    dr.ellipse([cx - r * C, cy - r * C, cx + r * C, cy + r * C], outline=(200, 60, 50), width=3)
    for mx, my in L["militia"]:
        px, py = left + (mx - x0 + 0.5) * C, top + (my - y0 + 0.5) * C
        dr.ellipse([px - 7, py - 7, px + 7, py + 7], fill=(250, 250, 250), outline=(40, 40, 40), width=2)
    for gx, gy in L["garrison"]:
        px, py = left + (gx - x0 + 0.5) * C, top + (gy - y0 + 0.5) * C
        dr.rectangle([px - 6, py - 6, px + 6, py + 6], fill=(63, 127, 224), outline=(20, 30, 60), width=2)
    # axis labels: dx along the top, dy down the left
    for i in range(n):
        dr.text((left + i * C + 8, top - 24), str(x0 + i), font=f(13, False), fill=(110, 110, 110))
        dr.text((left - 34, top + i * C + 9), str(y0 + i), font=f(13, False), fill=(110, 110, 110))
    lx, ly = left + n * C + 30, top
    for k in ("wall", "corner", "ctower", "tower", "gate", "square", "street", "garden"):
        if k not in L["cells"].values():
            continue
        dr.rectangle([lx, ly, lx + 26, ly + 26], fill=COL[k])
        if k in BLOCKS:
            dr.line([lx + 3, ly + 3, lx + 23, ly + 23], fill=(30, 26, 24), width=2)
        dr.text((lx + 36, ly + 2), NAMES[k], font=f(17, False), fill=(50, 50, 50))
        ly += 38
    dr.ellipse([lx + 6, ly + 6, lx + 20, ly + 20], fill=(250, 250, 250), outline=(40, 40, 40), width=2)
    dr.text((lx + 36, ly + 2), "民兵（B1-03 的位置）", font=f(17, False), fill=(50, 50, 50))
    ly += 38
    dr.rectangle([lx + 7, ly + 7, lx + 19, ly + 19], fill=(63, 127, 224), outline=(20, 30, 60), width=2)
    dr.text((lx + 36, ly + 2), "駐軍（示意，位置照 core）", font=f(17, False), fill=(50, 50, 50))
    ly += 38
    dr.ellipse([lx + 2, ly + 2, lx + 24, ly + 24], outline=(200, 60, 50), width=3)
    dr.text((lx + 36, ly + 2), f"原本的範圍（半徑 {r} 格）", font=f(17, False), fill=(50, 50, 50))
    img.save(out, optimize=True)
    print("wrote", out.name, img.size)


def export(Ls):
    out = {}
    for L in Ls:
        c, inside = counts(L)
        out[L["name"]] = dict(
            origin="small: the town's centre cell; large: the town's centre cell, tower on dx, dy in {-1, 0}",
            cells={k: sorted([list(p) for p, kk in L["cells"].items() if kk == k]) for k in sorted(set(L["cells"].values()))},
            militia=L["militia"], garrison=L["garrison"], counts=c, inside_walls=inside, old_circle=circle_count(L))
    p = HERE.parent / "castle-layout.json"
    p.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print("wrote", p.name)
    return out


if __name__ == "__main__":
    OUT = HERE.parents[1] / "r6" / "out"
    S, Lg = small(), large()
    info = export((S, Lg))
    for L, nm in ((S, "小鎮"), (Lg, "大城")):
        i = info[L["name"]]
        c = i["counts"]
        sub = [f"牆以內 {i['inside_walls']} 格（原本的圓圈 {i['old_circle']} 格）；擋路的牆 {c.get('wall', 0) + c.get('corner', 0)} 格"
               + (f"、角樓 {c.get('ctower', 0)} 格" if 'ctower' in c else "") + f"；城門 {c.get('gate', 0)} 格（四個門，一直開著）。",
               "格子是 sim 的格，原點：" + ("小鎮中心那一格。" if L["name"] == "small" else "城鎮中心那一格（箭樓占 dx、dy 為 −1、0 的四格）。")
               + "+x 往東（畫面右），+y 往南（離鏡頭近）。打叉的格子擋路。",
               "牆只擋走路，不擋射擊（遠程兵、法師、箭樓可以隔著牆打）；牆不會壞，廢墟時照舊站著。",
               "城鎮範圍改成牆以內（含牆和門那一圈不算在內）。"]
        diagram(L, f"R6-06-城堡-格子-{nm}", sub, OUT / f"R6-06-城堡-格子-{nm}.png")
