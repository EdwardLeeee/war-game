"""B1-03: a whole town composed from its pieces, in one state, with direction A, B or both.

States: neutral, ours (blue holds it), enemy (red holds it), ruins, plunder (being plundered), repair
(being repaired by blue), neutral_notower (the big city after its tower fell and it went back to neutral).

Direction A 「旗與炊煙」: the flag on the square (pale 鄉勇 banner / the holder's colour / half-way up
while repairing / broken), cooking smoke over the houses and the taxes stacked by the flag while
governed. Direction B 「界樁圍一圈」: posts on the town's circle (lanterns / the holder's pennants /
bare / knocked down). Both: everything. The houses' own state is the same in every direction
(ruins burnt but standing, burning while plundered, scaffolding while repaired).

Militia: placeholder, the town's own culture's spearman in the neutral grey-white (ceo 2026-10-01).
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import config   # noqa: E402
import layouts  # noqa: E402
import scene    # noqa: E402

CELL = layouts.CELL
SOLDIER = {"E": "spear_e", "W": "pike_w"}
STATES = ["neutral", "ours", "enemy", "ruins", "plunder", "repair"]
NAMES = {"neutral": "中立", "ours": "我方治理", "enemy": "敵方治理", "ruins": "廢墟", "plunder": "正在搶",
         "repair": "修繕中", "neutral_notower": "中立（箭樓已拆）"}


def _house_state(state, ci, cj):
    front = ci + cj < 0                       # the two quarters nearer the camera
    if state == "ruins":
        return "ruin"
    if state == "plunder":
        return "burning" if (ci < 0) != (cj < 0) or front and ci < 0 else "intact"
    if state == "repair":
        return "scaffold" if (ci < 0) == (cj < 0) else "intact"
    return "intact"


def town(c, L, state, direction, suffix="prev", units=True):
    d = config.BUILD / "b1" / "towns"
    ppm = 30 if suffix == "prev" else 60
    us = ppm / 60.0
    A, B = "A" in direction, "B" in direction
    holder = {"ours": "blue", "enemy": "red", "repair": "blue", "plunder": "red"}.get(state)
    items = [scene.piece(d, f"tground_{c}_{L['name']}", suffix, ground=True, shadow=False)]
    houses = []
    for kind, ci, cj, var in L["pieces"]:
        hs = _house_state(state, ci, cj)
        sp = scene.piece(d, f"{kind}_{c}_{hs}_v{var % 2}", suffix, x=ci * CELL, y=cj * CELL)
        items += scene.with_fx(sp)
        houses.append((sp, ci * CELL, cj * CELL))
    if L["tower"] is not None:
        if state in ("neutral",):
            items.append(scene.piece(d, f"ttower_{c}_intact", suffix, x=0, y=0))
        elif state in ("plunder", "repair"):
            items.append(scene.piece(d, f"ttower_{c}_rubble", suffix, x=0, y=0))
    fx, fy = L["flag"][0] * CELL, L["flag"][1] * CELL
    if A:
        fs = {"neutral": "neutral", "neutral_notower": "neutral", "ours": "team", "enemy": "team", "repair": "half",
              "plunder": "broken", "ruins": "broken"}[state]
        items.append(scene.piece(d, f"tflag_{c}_{fs}", suffix, team=holder or "blue", x=fx, y=fy))
        if state in ("ours", "enemy"):
            items.append(scene.piece(d, f"ttax_{c}", suffix, x=fx + 1.4, y=fy - 0.2))
            for sp, x, y in houses:
                for sx, sy, sz in sp.meta.get("smoke_at", [])[:1]:
                    items.append(scene.smoke(ppm, x + sx, y + sy, sz, h=2.0, r0=0.14, r1=0.4, dark=0.78, alpha=0.5,
                                             drift=(0.3, 0.2), seed=int(abs(x * 5 + y * 3))))
    if B:
        ps = {"neutral": "lantern", "neutral_notower": "lantern", "ours": "pennant", "enemy": "pennant",
              "repair": "pennant", "plunder": "bare", "ruins": "fallen"}[state]
        for k, (px, py) in enumerate(L["posts"]):
            sp = scene.piece(d, f"tpost_{c}_{ps}", suffix, team=holder or "blue", x=px * CELL, y=py * CELL)
            r = 0.3
            sp.rect = (px * CELL - r, px * CELL + r, py * CELL - r, py * CELL + r)
            items.append(sp)
    if state == "plunder":
        for k, (x, y) in enumerate(((-1.0, 3.2), (3.0, -1.2))):
            items.append(scene.piece(d, f"tcart_{c}", suffix, x=x, y=y))
    if state == "repair":
        for k, (x, y) in enumerate(((-1.4, 1.6), (1.6, -1.4))):
            items.append(scene.piece(d, f"tlumber_{c}", suffix, x=x, y=y))
    if units:
        sol = SOLDIER[c]
        if state in ("neutral", "neutral_notower"):
            posts = L["militia"] if state == "neutral" else L["militia"][:len(L["militia"]) // 2]
            for k, (mx, my) in enumerate(posts):
                items.append(scene.unit(sol, "neutral", facing=(6, 7, 0)[k % 3], scale=us, x=mx * CELL, y=my * CELL))
        elif state in ("ours", "enemy", "repair"):
            for k, (gx, gy) in enumerate(L["garrison"]):
                items.append(scene.unit(sol, holder, facing=(7, 6)[k % 2], scale=us, x=gx * CELL, y=gy * CELL))
        elif state == "plunder":
            for k, (gx, gy) in enumerate(((0.6, -0.8), (-0.8, 0.5), (1.4, 0.4), (-0.2, 1.3))):
                items.append(scene.unit(sol, "red", facing=(7, 1, 6, 0)[k], scale=us, x=gx * CELL, y=gy * CELL))
    img, origin = scene.render(items, ppm)
    return img, origin


if __name__ == "__main__":
    from PIL import Image
    c = sys.argv[1] if len(sys.argv) > 1 else "E"
    size = sys.argv[2] if len(sys.argv) > 2 else "small"
    direction = sys.argv[3] if len(sys.argv) > 3 else "AB"
    L = layouts.small() if size == "small" else layouts.large()
    ims = [town(c, L, s, direction)[0] for s in STATES]
    W = sum(i.width for i in ims) + 6 * len(ims)
    H = max(i.height for i in ims)
    out = Image.new("RGB", (W, H), (40, 40, 40))
    x = 0
    for im in ims:
        out.paste(im.convert("RGB"), (x, 0))
        x += im.width + 6
    p = config.BUILD / "b1" / "towns" / f"town_{c}_{size}_{direction}.png"
    out.save(p)
    print(p, out.size)
