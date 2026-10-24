"""D-100 drafts for the user (the keep, the bigger castles), in the R8 look: R8-31 keep East, R8-32 keep West, R8-33
castles East, R8-34 castles West.

python3 design/r8/common/keep_board.py GROUND_DIR RESEARCH_DIR UNITS_DIR
  GROUND_DIR    ground_run.py's output (the R8 ground the castles stand on)
  RESEARCH_DIR  the research worktree (keep-reference)
  UNITS_DIR     the R8 unit atlases (spear_e, pike_w: the scale and the militia)
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import samples_r8 as S   # noqa: E402
B = S.boards
KDIR = S.config.BUILD / "b1" / "r8k"
WDIR = S.config.BUILD / "b1" / "r8w"
SIDE = {"E": "東陸", "W": "西陸"}

REFS = {
    "E": [("03-東陸-莫高窟61窟五臺山圖-圍牆院落角樓與山門.jpg", "03 莫高窟 61 窟〈五臺山圖〉（10 世紀，公有領域）：夯土台上的木構山門 → 主堡的樣子［一手］"),
          ("02-東陸-宋畫黃鶴樓-城台上的平坐樓閣.jpg", "02 宋畫〈黃鶴樓〉（公有領域）：城台上兩重簷、平坐的樓閣［一手］"),
          ("05-東陸-武經總要-皮竹笆垂鐘板-城上掛的擋箭板.jpg", "05《武經總要》皮竹笆、垂鐘板（1044，公有領域）：女牆外掛的擋箭板、箭窗［一手］"),
          ("08-東陸-麻札塔格堡壘1913-夯土層與木筋外露.jpg", "08 麻札塔格堡壘（1913 年照片，公有領域）：夯土層和木筋 → 夯土台的層紋、廢墟［一手實物］"),
          ("06-東陸-漢代陶城堡-四角樓與門樓-類比.jpg", "06 漢代陶城堡（公有領域）：門樓、角樓的配置［類比］")],
    "W": [("10-西陸-羅徹斯特方堡-四角塔與前樓-1890年代.jpg", "10 羅徹斯特方堡（1890 年代照片，公有領域）：四角塔、扁扶壁、前樓［一手實物］"),
          ("14-西陸-維奧萊勒杜克-尚布瓦方堡立面-四角小塔.jpg", "14 尚布瓦方堡（維奧萊勒杜克，公有領域）：方形主堡、四角小塔［二手］"),
          ("16-西陸-維奧萊勒杜克-木外廊剖面-人站在外廊上.jpg", "16 木外廊剖面（維奧萊勒杜克，公有領域）：外廊伸出牆外、人在上面射［二手］"),
          ("11-西陸-卡斯泰爾諾城堡-重建的木外廊-架在石托上.jpg", "11 卡斯泰爾諾城堡（CC0）：重建的木外廊［二手重建］"),
          ("21-西陸-科夫城堡-被拆毀的主堡廢墟-1890年代.jpg", "21 科夫城堡（1890 年代照片，公有領域）：被拆毀的主堡［一手實物］")],
}
POINTS = {
    "E": ("主堡（D-100，使用者 2026-10-23）：每座城鎮正中一座，3×3 格（6×6 公尺），會射箭。東陸照唐末五代州府子城的門樓（譙樓、鼓角樓）做，"
          "考據筆記 research/keep-reference。\n"
          "・寬厚的夯土城台占滿 6×6 公尺，高 3.2 公尺，四面往上收（約 1:4），看得到一層一層的夯土層。正面一個平頂木框門洞（1.8×2.0 公尺，不是磚拱），"
          "朱漆門釘大門。\n"
          "・台上靠後一座三開間、兩層、兩重簷的木樓，頂上歇山加鴟尾，總高約 9 公尺；正面一條走道和女牆，外面掛皮竹笆擋箭板，每塊一個方形箭窗（《武經總要》）；"
          "走道上一面戰鼓（和兵營同一種）。\n"
          "・和箭樓分得開：主堡寬矮、有門洞、三間兩重簷；箭樓窄高、沒門洞。玩家色只在旗子和掛布上，中立是米白。\n"
          "・射箭：箭從擋箭板的箭窗和樓上的窗射出，射的時候那裡閃一下（和城門樓一樣的效果）。\n"
          "・受損（生命剩一半以下）：屋頂燒出破洞、冒火。廢墟（主堡倒了，那 9 格可以走，原地之後重建）：城台剩膝蓋高，上面是崩落的夯土塊、燒黑的木頭和碎瓦。"
          "修理中（治理後倒數重建）：廢墟上搭鷹架，崩角用木板夾著重新夯土。"),
    "W": ("主堡（D-100，使用者 2026-10-23）：每座城鎮正中一座，3×3 格（6×6 公尺），會射箭。西陸照 12 世紀蓋、1250 年還在用的方形主堡做"
          "（羅徹斯特、古德里奇、尚布瓦），考據筆記 research/keep-reference。\n"
          "・4.6×4.6 公尺的亂石方塊，淺色方石轉角，牆腳斜出；每面兩道扁扶壁；四角方塔比垛口高出約 1.2 公尺；一樓只有細縫，上層圓頂窗。\n"
          "・頂上一整圈木外廊，伸出牆外約 0.9 公尺，單坡屋頂，每面兩扇射窗（維奧萊勒杜克的剖面）；裡面一個矮的四角屋頂。\n"
          "・右邊一座矮前樓，石梯沿著正面爬到二樓的門（門檻約 2.5 公尺高）。\n"
          "・和箭樓（圓塔加圓錐頂）、主城的鐘樓（細高、有尖頂）分得開：主堡矮胖、平頂、有木外廊。不用石造突出射口和塔屋（14 世紀以後）。\n"
          "・射箭：從木外廊的射窗射出，射的時候那裡閃一下。受損：木外廊和屋頂著火。廢墟（可以走）：剩膝蓋高的牆腳、碎石和燒黑的木頭。"
          "修理中：廢墟上搭鷹架，新的淺色石塊、一台小吊臂。"),
}


def keep_tile(c, state, pp, team="blue"):
    S.DIR = KDIR
    return S.tile(f"keep_{c}_{state}", "x3", pp, (3, 3), team=team)


def glint(c, pp=3, frame=1):
    """The keep at pp x with the arrow glint (effects.json tower_shot) at every shoot_at point (the render's marks)."""
    S.DIR = KDIR
    meta = json.loads((KDIR / f"keep_{c}_done_x3.json").read_text())
    sp = S.piece(f"keep_{c}_done", "x3", pp)
    ppm = 20 * pp
    img, origin = S.scene.render(S.scene.with_fx(sp), ppm, pad=24, bg=S.b1art.GROUND)
    E = HERE.parents[1] / "production" / "build" / "effects_x3"
    ej = json.loads((E / "effects.json").read_text())
    pg = Image.open(E / ej["pages"][0]).convert("RGBA")
    f = ej["frames"][f"tower_shot_{frame:02d}"]
    g = pg.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"]))
    k = ppm / 60
    g = g.resize((max(1, int(g.width * k)), max(1, int(g.height * k))), Image.LANCZOS)
    img = img.convert("RGBA")
    for n, (x, y, z) in sorted(meta.get("marks", {}).items()):
        if n.startswith("shoot_at_"):
            gx, gy = S.proj.to_px((x, y, z), origin, ppm)
            img.alpha_composite(g, (int(gx - f["ax"] * k), int(gy - f["ay"] * k)))
    return img.convert("RGB")


def board_keep(c, research, units_dir, W=2900):
    label = f"R8-{31 if c == 'E' else 32}-主堡-{SIDE[c]}-mobile"
    row = [B.captioned(keep_tile(c, "done", 2, "blue"), "完好（我方，藍）", 22),
           B.captioned(keep_tile(c, "done", 2, "neutral"), "完好（中立）", 22),
           B.captioned(keep_tile(c, "done", 2, "red"), "完好（敵方，紅）", 22),
           B.captioned(keep_tile(c, "damaged", 2, "blue"), "受損（生命一半以下）", 22),
           B.captioned(keep_tile(c, "rubble", 2, "blue"), "廢墟（可以走）", 22),
           B.captioned(keep_tile(c, "repair", 2, "blue"), "修理中（廢墟上搭鷹架）", 22)]
    W = max(W, sum(t.width + 18 for t in row) + 2 * B.M + 20)          # the row fits
    parts = [B.header(W, label, POINTS[c])]
    parts.append(B.row(row, W, gap=18))
    big = keep_tile(c, "done", 3, "blue")
    sc = _with_soldier(big, c, units_dir, 3)
    parts.append(B.row([B.captioned(sc, "3 倍：旁邊站一名 1.7 公尺的兵", 22),
                        B.captioned(glint(c, 3), "射箭的點（每一點射的時候閃一下，這裡全部一起畫出來）", 22)], W, gap=30))
    small = [B.captioned(keep_tile(c, s, 1, "blue"), n, 20) for s, n in (("done", "完好"), ("damaged", "受損"),
                                                                         ("rubble", "廢墟"), ("repair", "修理中"))]
    parts.append(B.row([B.captioned(B.row(small, W // 2, gap=16), "實際大小（1 倍，手機的點）", 22)], W))
    parts += S.refs_row(W, research / "keep-reference", REFS[c])
    return B.save(B.stack(parts, W), label)


def _with_soldier(tile_im, c, units_dir, pp):
    if not units_dir:
        return tile_im
    import boards_r8 as BR
    u = "spear_e" if c == "E" else "pike_w"
    a = BR.field.Atlas(Path(units_dir) / u / "r7v8" / "prod" / u / "atlas_x3" / f"{u}.json")
    body, (ax, ay), _ = BR.frame(a, u, "idle", 6, 0, "blue")
    k = 20 * pp / 60
    body = body.resize((int(body.width * k), int(body.height * k)), Image.LANCZOS)
    im = tile_im.convert("RGBA").copy()
    gx = int(im.width * 0.86)
    gy = int(im.height * 0.86)
    im.alpha_composite(body, (int(gx - ax * k), int(gy - ay * k)))
    return im.convert("RGB")


def castle_scene(c, L, gdir, units_dir, ppm=30):
    """A walled town of D-100 as the game draws it: the ground, the floor tiles, the walls (castle.placements), the keep,
    militia on their posts, all by their front edge; ppm pixels a metre."""
    import castle as CA
    import ground_r8
    R = L["wall"] + 3
    n = 2 * R + 1
    head = 6                                        # cells of headroom above: the north wall's sprites stand tall
    g = np.zeros((n + head, n + head), dtype=int)  # square (ground_r8.compose): the extra columns split left and right
    gj = json.loads((gdir / "ground" / "ground.json").read_text())
    rules = dict(gj["rules"], dirt=dict(gj["rules"]["dirt"], noise_threshold=0.99))
    ox, oy = R + head // 2, R + head                # the layout's centre cell in the scene
    N = n + head
    town = {ch: np.zeros((N, N), dtype=bool) for ch in ground_r8.TOWN_CHANNELS}
    for (dx, dy), kind in L["cells"].items():       # the floor (D-100): the ground shader's town map, from the cells
        x, y = dx + ox, dy + oy
        town["yard"][y, x] = True
        if kind == "garden":
            town["garden"][y, x] = True
        elif kind in ("street", "gate"):
            town["street"][y, x] = True
        elif kind in ("square", "keep"):
            town["court"][y, x] = True
    for t in CA.floor(L):                           # the roads out of the gates
        if t["tile"] == "street":
            x, y = t["cell"][0] + ox, t["cell"][1] + oy
            town["street"][y, x] = True
            town["yard"][y, x] = True
    top = ground_r8.compose(g, [], S._ground_layers(gdir), ppm=ppm, rules=rules, town=town, culture=c)
    cam = Image.fromarray((top * 255).round().astype(np.uint8), "RGB").resize((top.shape[1], top.shape[0] // 2), Image.LANCZOS)
    cam = cam.convert("RGBA")
    f = ppm / 60.0

    def px(cx, cy):
        return (cx + ox) * 2.0 * ppm, (cy + oy) * 2.0 * ppm * 0.5

    def sprite(d, name):
        im, anc, sh = S._sprite(d, name, "x3", f)
        return im, anc, sh
    flat, items, shadows = [], [], []               # (the floor tiles are gone: the ground draws the floor)
    for p in CA.placements(L):
        im, anc, sh = sprite(WDIR, f"castle_{p['piece']}_{c}_intact")
        X, Y = px(*p["anchor"])
        items.append((p["front"], im, (int(X - anc[0]), int(Y - anc[1]))))
        if sh:
            shadows.append((sh[0], (int(X - sh[1]), int(Y - sh[2]))))
    S.DIR = KDIR
    im, anc, sh = sprite(KDIR, f"keep_{c}_done")
    X, Y = px(0.5, 0.5)
    items.append((2.0, im, (int(X - anc[0]), int(Y - anc[1]))))
    if sh:
        shadows.append((sh[0], (int(X - sh[1]), int(Y - sh[2]))))
    if units_dir:
        import boards_r8 as BR
        u = "spear_e" if c == "E" else "pike_w"
        a = BR.field.Atlas(Path(units_dir) / u / "r7v8" / "prod" / u / "atlas_x3" / f"{u}.json")
        for (mx, my) in L["militia"]:
            body, (ax, ay), _ = BR.frame(a, u, "idle", 6, 0, "neutral" if False else "red")
            body = body.resize((max(1, int(body.width * f)), max(1, int(body.height * f))), Image.LANCZOS)
            X, Y = px(mx + 0.5, my + 0.5)
            items.append((my + 0.6, body, (int(X - ax * f), int(Y - ay * f))))
    for im, xy in flat + shadows + [(im, xy) for _, im, xy in sorted(items, key=lambda q: q[0])]:
        layer = Image.new("RGBA", cam.size, (0, 0, 0, 0))
        layer.paste(im, xy, im)
        cam = Image.alpha_composite(cam, layer)
    return cam.convert("RGB")


# ---------------------------------------------------------------- R8-36: the inside of the walls, three directions

XDIR = S.config.BUILD / "b1" / "r8x"
OPT_LAYERS = {"A": dict(yard="yard", garden="garden", street="dirt", court="dirt"),
              "B": dict(yard="yard", garden="garden", street="yard", court="yard"),
              "C": dict(yard="yard", garden="garden", street="dirt", court="dirt")}


def _decor(option, L):
    """[(piece, x, y)] the decorative pieces of directions B and C, in cells from the keep's middle (+y south), along
    the walls and in the quadrants' outer parts, clear of the lanes and of the square round the keep."""
    W = L["wall"]
    q = W - 1.6                                   # well inside the wall ring
    out = []
    if option == "B":
        for sx in (-1, 1):
            for sy in (-1, 1):
                out += [("hut_a" if sy > 0 else "hut_b", sx * q, sy * q), ("hut_a", sx * (q - 2.0), sy * (q + 0.1)),
                        ("shed", sx * (q + 0.1), sy * (q - 2.1)), ("stack", sx * (q - 1.1), sy * (q - 1.2))]
                if W > 8:                         # the big city: a third hut, a second shed
                    out += [("hut_b", sx * (q - 4.0), sy * q), ("shed", sx * q, sy * (q - 4.2))]
        out += [("well", 2.9, 2.9), ("well", -2.9, -2.9)] if W > 8 else [("well", 2.7, 2.8)]
        out += [("cart", 1.9, 4.2), ("cart", -1.9, -4.6)]
    elif option == "C":
        for sx in (-1, 1):                        # tents in rows in the two north quadrants
            for r in range(2 if W <= 8 else 3):
                out += [("tent_b", sx * (q - 0.2), -(q - r * 1.8)), ("tent_b", sx * (q - 1.9), -(q - r * 1.8))]
        for sx in (-1, 1):                        # racks and supplies in the south quadrants, by the walls
            out += [("rack", sx * (q - 0.5), q - 0.2), ("supplies", sx * q, q - 2.2), ("supplies", sx * (q - 2.3), q)]
            if W > 8:
                out += [("rack", sx * (q - 3.0), q - 0.2), ("supplies", sx * (q - 4.5), q)]
        out += [("posts", -2.6, 3.6), ("posts", 2.6, 3.6), ("flag", 1.9, 2.3)]
    return out


def _town_masks(option, L, ox, oy, N):
    """The ground's town channels for a direction: bool or strength arrays [N, N] (cells of the scene)."""
    import castle as CA
    import ground_r8
    m = {ch: np.zeros((N, N)) for ch in ground_r8.TOWN_CHANNELS}
    W = L["wall"]

    def put(ch, dx, dy, v=1.0):
        x, y = dx + ox, dy + oy
        if 0 <= x < N and 0 <= y < N:
            m[ch][y, x] = max(m[ch][y, x], v)
    # the tracks: from each gate along the middle of its lane to the keep, out past the gate fading into the grass
    for d in range(2, W + 1):
        for dx, dy in ((0, d), (0, -d), (d, 0), (-d, 0)):
            put("street", dx, dy)
    for k, v in enumerate((0.85, 0.6, 0.35, 0.15)):
        for dx, dy in ((0, W + 1 + k), (0, -W - 1 - k), (W + 1 + k, 0), (-W - 1 - k, 0)):
            put("street", dx, dy, v)
    if option == "A":                             # a worn apron round the keep's door, where the tracks meet
        for dx in range(-1, 2):
            put("court", dx, 2, 0.8)
    elif option == "B":                           # packed earth round the keep and round every house
        for dx in range(-2, 3):
            for dy in range(-2, 3):
                if max(abs(dx), abs(dy)) == 2:
                    put("court", dx, dy, 0.9)
        for piece, x, y in _decor("B", L):
            for ddx in (-1, 0, 1):
                for ddy in (-1, 0, 1):
                    put("yard", int(round(x)) + ddx, int(round(y)) + ddy, 0.75 if (ddx or ddy) else 1.0)
    elif option == "C":                           # the whole yard beaten earth, the parade ground before the keep
        for (dx, dy), kind in L["cells"].items():
            put("yard", dx, dy)
        for dx in range(-2, 3):
            for dy in range(2, 5):
                put("court", dx, dy)
        for dx, dy in ((0, d) for d in range(2, W + 1)):
            m["street"][dy + oy, dx + ox] = 0.0   # the south lane is the parade ground's: no track across it
        m["street"] *= np.where(np.abs(np.arange(N)[:, None] - oy) <= W, 0.0, 1.0)     # tracks only outside the walls
    return m


def option_scene(c, L, gdir, units_dir, option, ppm=24):
    """A walled town of D-100 in one of the R8-36 directions: the ground (with its tracks and yards), the walls, the
    keep, the decor, militia."""
    import castle as CA
    import ground_r8
    R = L["wall"] + 5
    n = 2 * R + 1
    head = 6
    N = n + head
    g = np.zeros((N, N), dtype=int)
    gj = json.loads((gdir / "ground" / "ground.json").read_text())
    rules = dict(gj["rules"], dirt=dict(gj["rules"]["dirt"], noise_threshold=0.99))
    rules["town"] = dict(rules["town"], layers=dict(rules["town"]["layers"], **{c: OPT_LAYERS[option]}))
    ox, oy = R + head // 2, R + head
    town = _town_masks(option, L, ox, oy, N)
    top = ground_r8.compose(g, [], S._ground_layers(gdir), ppm=ppm, rules=rules, town=town, culture=c)
    cam = Image.fromarray((top * 255).round().astype(np.uint8), "RGB").resize((top.shape[1], top.shape[0] // 2), Image.LANCZOS)
    cam = cam.convert("RGBA")
    f = ppm / 60.0

    def px(cx, cy):
        return (cx + ox) * 2.0 * ppm, (cy + oy) * 2.0 * ppm * 0.5
    items, shadows = [], []

    def add(d, name, x, y, front):
        im, anc, sh = S._sprite(d, name, "x3", f)
        X, Y = px(x, y)
        items.append((front, im, (int(X - anc[0]), int(Y - anc[1]))))
        if sh:
            shadows.append((sh[0], (int(X - sh[1]), int(Y - sh[2]))))
    for p in CA.placements(L):
        add(WDIR, f"castle_{p['piece']}_{c}_intact", p["anchor"][0], p["anchor"][1], p["front"])
    S.DIR = KDIR
    add(KDIR, f"keep_{c}_done", 0.5, 0.5, 2.0)
    for piece, x, y in _decor(option, L):
        add(XDIR, f"decor_{piece}_{c}", x + 0.5, y + 0.5, y + 1.0)
    if units_dir:
        import boards_r8 as BR
        u = "spear_e" if c == "E" else "pike_w"
        a = BR.field.Atlas(Path(units_dir) / u / "r7v8" / "prod" / u / "atlas_x3" / f"{u}.json")
        for (mx, my) in L["militia"]:
            body, (ax, ay), _ = BR.frame(a, u, "idle", 6, 0, "red")
            body = body.resize((max(1, int(body.width * f)), max(1, int(body.height * f))), Image.LANCZOS)
            X, Y = px(mx + 0.5, my + 0.5)
            items.append((my + 0.6, body, (int(X - ax * f), int(Y - ay * f))))
    for im, xy in shadows + [(im, xy) for _, im, xy in sorted(items, key=lambda q: q[0])]:
        layer = Image.new("RGBA", cam.size, (0, 0, 0, 0))
        layer.paste(im, xy, im)
        cam = Image.alpha_composite(cam, layer)
    return cam.convert("RGB")


OPT_TEXT = {
    "A": ("A 自然地面：牆內和牆外一樣是草地、乾草地，只有從每個城門走到主堡的一條踩出來的土路，土路在主堡門前會合成一小片；"
          "出了城門，土路慢慢淡進草地裡，沒有灰色的方塊。最乾淨，兵最好找。"),
    "B": ("B 有人住的城鎮：沿著牆內邊緣有幾間矮的土牆茅草屋、柴棚、草垛和水缸，一口井、幾台手推車；都是裝飾，不擋路，都在 3 公尺以下，"
          "放在牆邊和四個角落，讓中間的路和主堡周圍空著，兵走在路上看得清楚。路是踩實的土路，房子周圍一小片踩實的土。"),
    "C": ("C 駐軍的堡：牆內整片踩實的土地，主堡前一片操練場（較平的土石地，兩根練兵的草人、一面大旗和戰鼓）；北邊兩塊搭著一排排帳篷，"
          "南邊牆角放兵器架和堆起來的糧草箱子。出了城門一樣是淡進草地的土路。"),
}


def board_option(option, c, gdir, units_dir, W=3000):
    import castle as CA
    label = f"R8-36-牆內-{option}-{ {'A': '自然地面', 'B': '有人住的城鎮', 'C': '駐軍的堡'}[option] }-東陸-mobile".replace("{ ", "").replace(" }", "")
    text = ("牆內的地，三個方向之一（使用者 2026-10-23 看 R8-33、R8-34：「我覺得看起還是不太對 而且那個陸是幹嘛的？」，灰色的磚街和伸出城門的灰色方塊看不懂，"
            "所以三個方向都拿掉了：出了城門只是一條淡進草地的土路）。\n" + OPT_TEXT[option] + "\n"
            "上：遊戲的鏡頭（2 倍）小鎮、大城；下：實際大小（1 倍）。牆、城門、主堡是核准的那一套。")
    sm = option_scene(c, CA.small(), gdir, units_dir, option, ppm=24)
    lg = option_scene(c, CA.large(), gdir, units_dir, option, ppm=24)
    sm1 = option_scene(c, CA.small(), gdir, units_dir, option, ppm=10)
    lg1 = option_scene(c, CA.large(), gdir, units_dir, option, ppm=10)
    W = max(W, sm.width + lg.width + 2 * B.M + 60)
    parts = [B.header(W, label, text)]
    parts.append(B.row([B.captioned(sm, "小鎮（遊戲的鏡頭，2 倍）", 24), B.captioned(lg, "大城（遊戲的鏡頭，2 倍）", 24)], W, gap=30))
    parts.append(B.row([B.captioned(sm1, "小鎮（實際大小）", 22), B.captioned(lg1, "大城（實際大小）", 22)], W, gap=30))
    return B.save(B.stack(parts, W), label)


def town_scene(c, L, gdir, units_dir, ppm=24):
    """A walled town of art-v6 as the client will draw it (R8-36 B): the ground from the layout's `ground` (castle.py:
    lanes, trampled earth), the walls, the keep, the decorative pieces of `decor`, militia."""
    import castle as CA
    import ground_r8
    R = L["wall"] + 5
    n = 2 * R + 1
    head = 6
    N = n + head
    g = np.zeros((N, N), dtype=int)
    gj = json.loads((gdir / "ground" / "ground.json").read_text())
    rules = dict(gj["rules"], dirt=dict(gj["rules"]["dirt"], noise_threshold=0.99))
    ox, oy = R + head // 2, R + head
    town = {ch: np.zeros((N, N)) for ch in ground_r8.TOWN_CHANNELS}
    for e in CA.ground(L):
        x, y = e["cell"][0] + ox, e["cell"][1] + oy
        town[e["kind"]][y, x] = max(town[e["kind"]][y, x], e["w"])
    top = ground_r8.compose(g, [], S._ground_layers(gdir), ppm=ppm, rules=rules, town=town, culture=c)
    cam = Image.fromarray((top * 255).round().astype(np.uint8), "RGB").resize((top.shape[1], top.shape[0] // 2), Image.LANCZOS)
    cam = cam.convert("RGBA")
    f = ppm / 60.0

    def px(cx, cy):
        return (cx + ox) * 2.0 * ppm, (cy + oy) * 2.0 * ppm * 0.5
    items, shadows = [], []

    def add(d, name, x, y, front):
        im, anc, sh = S._sprite(d, name, "x3", f)
        X, Y = px(x, y)
        items.append((front, im, (int(X - anc[0]), int(Y - anc[1]))))
        if sh:
            shadows.append((sh[0], (int(X - sh[1]), int(Y - sh[2]))))
    for p in CA.placements(L):
        add(WDIR, f"castle_{p['piece']}_{c}_intact", p["anchor"][0], p["anchor"][1], p["front"])
    S.DIR = KDIR
    add(KDIR, f"keep_{c}_done", 0.5, 0.5, 2.0)
    for d in CA.decor(L):
        add(XDIR, f"decor_{d['piece']}_{c}", d["at"][0], d["at"][1], d["front"])
    if units_dir:
        import boards_r8 as BR
        u = "spear_e" if c == "E" else "pike_w"
        a = BR.field.Atlas(Path(units_dir) / u / "r7v8" / "prod" / u / "atlas_x3" / f"{u}.json")
        for (mx, my) in L["militia"]:
            body, (ax, ay), _ = BR.frame(a, u, "idle", 6, 0, "red")
            body = body.resize((max(1, int(body.width * f)), max(1, int(body.height * f))), Image.LANCZOS)
            X, Y = px(mx + 0.5, my + 0.5)
            items.append((my + 0.6, body, (int(X - ax * f), int(Y - ay * f))))
    for im, xy in shadows + [(im, xy) for _, im, xy in sorted(items, key=lambda q: q[0])]:
        layer = Image.new("RGBA", cam.size, (0, 0, 0, 0))
        layer.paste(im, xy, im)
        cam = Image.alpha_composite(cam, layer)
    return cam.convert("RGB")


def board_r837(c, gdir, units_dir, W=3000):
    import castle as CA
    label = f"R8-37-牆內-B-定稿-{SIDE[c]}-mobile"
    look = ("東陸：夯土牆、茅草頂的矮屋，柴棚、草垛和水缸、井、手推車。" if c == "E" else
            "西陸：木架、石灰牆、茅草頂的小屋，柴棚、草垛和木桶、有小屋頂的井、手推車。")
    text = ("牆內照使用者 2026-10-23 選的 R8-36 B「有人住的城鎮」做成量產的樣子。" + look + "\n"
            "・裝飾只在畫面上，模擬裡沒有：兵可以走過去；放在牆邊和角落（只放在菜園格，不碰街、主堡周圍、城門、角樓），全部 3 公尺以下。\n"
            "・在城鎮裡蓋建築（例如箭樓）時，占地碰到的裝飾就不畫，那裡變成踩平的土（和世紀帝國 2 建築腳下一塊土一樣）。\n"
            "・從每個城門到主堡是踩實的土路，出了城門走 4 格慢慢淡進草地；主堡外一圈、每間房子周圍是踩平的土；其他照牆外的草地。\n"
            "上：遊戲的鏡頭（2 倍）；下：實際大小。")
    sm = town_scene(c, CA.small(), gdir, units_dir, ppm=24)
    lg = town_scene(c, CA.large(), gdir, units_dir, ppm=24)
    sm1 = town_scene(c, CA.small(), gdir, units_dir, ppm=10)
    lg1 = town_scene(c, CA.large(), gdir, units_dir, ppm=10)
    W = max(W, sm.width + lg.width + 2 * B.M + 60)
    parts = [B.header(W, label, text),
             B.row([B.captioned(sm, "小鎮（遊戲的鏡頭，2 倍）", 24), B.captioned(lg, "大城（遊戲的鏡頭，2 倍）", 24)], W, gap=30),
             B.row([B.captioned(sm1, "小鎮（實際大小）", 22), B.captioned(lg1, "大城（實際大小）", 22)], W, gap=30)]
    return B.save(B.stack(parts, W), label)


def board_r836_overview(gdir, units_dir, W=3000):
    import castle as CA
    label = "R8-36-牆內-總覽-東陸-mobile"
    text = ("牆內的地，三個方向的對照（使用者 2026-10-23：「我覺得看起還是不太對 而且那個陸是幹嘛的？」）。三個方向都拿掉了灰磚街和城門外的灰色方塊；"
            "出了城門只有一條踩出來的土路，走幾格就淡進草地。\n"
            "先看了別的遊戲怎麼畫（只看文字資料，來源記在 ui 的研究筆記）：\n"
            "・世紀帝國 2 決定版：有城牆的地圖，牆內就是自然的空地（草地、樹叢）；每棟建築腳下自動換一小塊土；路只是一種地面貼圖，玩家不能蓋。\n"
            "・世紀帝國 4：路是自動長出來的外觀，建築周圍一圈踩舊的土和小東西；玩家抱怨建築專用的紅土在雪地上很怪。美術總監說建築要像大按鈕，一眼認得出。\n"
            "・萬國覺醒：城內的路是純裝飾，「讓布局好懂」；攻略提醒「路突然斷掉」很難看、物件太多會讓建築難點。\n"
            "・要塞十字軍：主堡正前方是一塊什麼都不能蓋的空場，閒著的人在那裡集合。\n"
            "共通點：牆內地面和牆外一樣自然，只在路和建築腳下踩出土；路出城門慢慢淡掉；主堡前留一塊最乾淨的空地；裝飾少、矮、放牆邊，兵才看得清楚。\n"
            "A 自然地面：只有土路（最接近世紀帝國 2）。B 有人住的城鎮：牆邊加矮屋、柴棚、井、推車，都是裝飾。C 駐軍的堡：整片夯土、帳篷、操練場。")
    tiles = []
    for o, nm in (("A", "A 自然地面"), ("B", "B 有人住的城鎮"), ("C", "C 駐軍的堡")):
        im = option_scene("E", CA.small(), gdir, units_dir, o, ppm=18)
        tiles.append(B.captioned(im, nm + "（小鎮，遊戲的鏡頭）", 24))
    W = max(W, sum(t.width + 24 for t in tiles) + 2 * B.M + 20)
    parts = [B.header(W, label, text), B.row(tiles, W, gap=24)]
    big = [B.captioned(option_scene("E", CA.large(), gdir, units_dir, o, ppm=12), f"{o}（大城）", 22) for o in "ABC"]
    parts.append(B.row(big, W, gap=24))
    return B.save(B.stack(parts, W), label)


def board_castles(c, gdir, units_dir, W=3000):
    import castle as CA
    label = f"R8-{33 if c == 'E' else 34}-城鎮放大與主堡-{SIDE[c]}-mobile"
    text = ("城鎮放大約 1.5 倍、正中一座主堡（D-100，使用者 2026-10-23；格子是 war-game-core 2026-10-23 的提案，core 和 ui 對過）。"
            "小鎮：木柵在離中心第 7 格，牆內 13×13 格，四角各一根角柱；大城：石牆在第 9 格，牆內 17×17 格，四角 2×2 角樓，城門兩旁各一座門柱。"
            "城門都是 3 格寬，在四邊正中，正對主堡。牆片、城門是 D-096 核准的那一套，照寫實設定重出；多了主堡。\n"
            "牆內的地（使用者 2026-10-23：「地板應該要改掉 改成這成仿真的地板」）：不再用一格一格的地磚，改由地面著色器直接畫，"
            "和牆外的草地接在一起。" + ("東陸：踩實的夯土地，灰磚鋪的街和主堡前的院子（唐代州府子城的磚鋪甬道）。" if c == "E" else
                                     "西陸：踩實的土地，亂石鋪的街，鵝卵石的廣場。") +
            "四塊菜園是一畦一畦的菜地，中間是踩實的土路，有的畦種著菜、有的空著；畦稍微斜一點，不跟格子對齊。"
            "邊緣隨磚石和土的起伏斷開，看不出格子。\n"
            "下面是遊戲的鏡頭（方形斜看），站著民兵（小鎮 6 名、大城 12 名，在主堡周圍）。")
    parts = [B.header(W, label, text)]
    sm = castle_scene(c, CA.small(), gdir, units_dir, ppm=24)
    lg = castle_scene(c, CA.large(), gdir, units_dir, ppm=24)
    parts.append(B.row([B.captioned(sm, "小鎮（木柵，牆內 13×13）", 24), B.captioned(lg, "大城（石牆，牆內 17×17）", 24)], W, gap=30))
    return B.save(B.stack(parts, W), label)


if __name__ == "__main__":
    gdir, research = Path(sys.argv[1]), Path(sys.argv[2])
    units = sys.argv[3] if len(sys.argv) > 3 else None
    S.UNITS_DIR = units
    which = sys.argv[4] if len(sys.argv) > 4 else "all"
    if which == "r837":
        for c in ("E", "W"):
            print(board_r837(c, gdir, units))
        sys.exit(0)
    if which == "r836ov":
        print(board_r836_overview(gdir, units))
        sys.exit(0)
    if which.startswith("r836"):
        for o in (which[4:] or "ABC"):
            print(board_option(o, "E", gdir, units))
        sys.exit(0)
    for c in ("E", "W"):
        if which in ("all", "keep"):
            print(board_keep(c, research, units))
        if which in ("all", "castle"):
            print(board_castles(c, gdir, units))
