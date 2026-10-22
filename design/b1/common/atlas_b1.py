"""R6 production: the B1 production renders (run.py prod_* targets) -> the building and resource-point
atlases of design/b1/atlas-buildings.md (agreed with client 2026-10-18).

python3 common/atlas_b1.py [--scale 3] [--page 2048]
  reads  build/b1/prod/<frame>_x3_{beauty,mask,shadow,ao}.png and <frame>_x3.json
  writes build/atlas_x<scale>/buildings/buildings_<E|W>.json, buildings_<c>_{color,team,shadow}_<k>.png, memory.json
         build/atlas_x<scale>/nodes/nodes.json, nodes_{color,shadow}_<k>.png, memory.json
         build/atlas_x<scale>/castle/castle_<E|W>.json and pages (art-v4), terrain/terrain.json and pages (art-v5)
         build/atlas_x<scale>/report.json   every frame's trimmed size and each building's bytes (min, max, total)

The layers are made as the units' (design/production/common/postprocess.py): colour with the ambient
occlusion baked in, trimmed at alpha > 4; the player-colour layer = colour x 1.6 under the mask, trimmed to
itself; the shadow black + alpha, at half resolution (rendered so), alpha under 20 cleared. The smoke of the
damaged buildings and of the rubble is a 2D column (smoke2d.py) at the points the render marked, drawn into
the colour layer (a static image, ceo 2026-10-18); where it covers player colour the player-colour layer
fades with it. 2x is the 3x frame scaled by 2/3.
"""
import argparse
import json
import math
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(1, str(HERE.parents[1] / "production" / "common"))
import config      # noqa: E402
import proj        # noqa: E402
import smoke2d     # noqa: E402
from postprocess import Packer, SHADOW_FLOOR, TEAM_GAIN, TRIM   # noqa: E402

SRC = config.BUILD / "b1" / "prod"
CULTURES = ("E", "W")
PX_PER_M = 60
# BuildingType (sim/src/protocol.ts) -> (number, frame prefix); every state names its frame (atlas-buildings.md 3)
PLAYER = {"MainCity": (0, "main_city", 4), "House": (1, "house", 2), "LumberCamp": (2, "lumber_camp", 2),
          "Mine": (3, "mine", 2), "Granary": (4, "granary", 2), "Barracks": (6, "barracks", 3),
          "Range": (7, "range", 3), "MageHall": (8, "mage_hall", 3), "ArrowTower": (10, "arrow_tower", 2),
          "Stable": (11, "stable", 3)}
NODE_KINDS = {"Tree": 0, "GoldMine": 1, "Berries": 2, "CrystalVein": 3}


def building_table(c):
    t = {}
    for name, (num, k, n) in PLAYER.items():
        t[name] = dict(type=num, footprint=[n, n], states={
            "build1": f"found_{n}x{n}_{c}", "build2": f"{k}_{c}_build2", "build3": f"{k}_{c}_build3",
            "done": f"{k}_{c}_done", "damaged": f"{k}_{c}_damaged", "rubble": f"rubble_{n}x{n}_{c}"})
    t["Farm"] = dict(type=5, footprint=[3, 3], ground=True,
                     states={"build1": f"farm_{c}_build1", "build2": f"farm_{c}_sown", "build3": f"farm_{c}_sown"},
                     crops=[f"farm_{c}_{s}" for s in ("sown", "growing", "ripe")])
    # art-v5.1: 哨所 (D-080; the user approved the drafts 2026-10-22), its own foundation and rubble (blds2.outpost)
    t["Outpost"] = dict(type=12, footprint=[2, 2],
                        states={s: f"outpost_{c}_{s}" for s in ("build1", "build2", "build3", "done", "damaged", "rubble")})
    t["TownTower"] = dict(type=9, footprint=[2, 2], states={s: f"town_tower_{c}_{s}" for s in ("done", "damaged", "rubble")},
                          # art-v4: the 3 x 3 tower of the random maps' neighbouring spawns (sim GameMap.towerSize, D-074)
                          sizes={"3": dict(footprint=[3, 3],
                                           states={s: f"town_tower3_{c}_{s}" for s in ("done", "damaged", "rubble")})})
    return dict(sorted(t.items(), key=lambda kv: kv[1]["type"]))


def building_frames(b):
    """Every frame one building's entry names (its states, crops, and the states of its other sizes)."""
    out = list(b["states"].values()) + b.get("crops", [])
    for v in b.get("sizes", {}).values():
        out += list(v["states"].values())
    return out


# ---------------------------------------------------------------- the castles (art-v4, D-089)

import castle as CASTLE     # noqa: E402  (common/castle.py: the cells, the pieces on them)
TILES = ("square", "street", "garden")


def castle_table(c):
    """castle_<c>.json's "pieces", "tiles" and "layouts": every piece's frame in each look and the cells it stands
    on in each layout (CASTLE.placements), the floor tiles (CASTLE.floor)."""
    pieces = {k: dict(footprint=list(f), frames={s: f"castle_{k}_{c}_{s}" for s in ("intact", "ruin")})
              for k, f in CASTLE.PIECE_FOOT.items()}
    tiles = {t: f"castle_tile_{t}_{c}" for t in TILES}
    layouts = {}
    for L in (CASTLE.small(), CASTLE.large(), CASTLE.large3()):
        layouts[L["name"]] = dict(
            walls=[dict(piece=p["piece"], anchor=p["anchor"], front=p["front"], cells=p["cells"]) for p in CASTLE.placements(L)],
            floor=CASTLE.floor(L))
    return pieces, tiles, layouts


def castle_frames(c):
    pieces, tiles, _ = castle_table(c)
    return sorted([n for p in pieces.values() for n in p["frames"].values()] + list(tiles.values()))


# ---------------------------------------------------------------- the terrain (art-v5, R6-51, war-game-core #245)

import terrain_rules as TR  # noqa: E402  (common/terrain_rules.py: which frame on which cell)
TILE_PX = (120, 60)         # a water tile at 3x: one cell across (2 m x 60 px/m) and one deep (2 m x 30 px/m)
DECK_TOP_M = 0.44           # the bridge's planks stand this high over the ground (terrain.tbridge_deck)


def terrain_table():
    """terrain.json's "rules": what each Terrain value draws (the code is TR.pieces; atlas-buildings.md 12)."""
    return dict(
        values=TR.VALUES, wet=list(TR.WET), ground_order=list(TR.GROUND_ORDER),
        variant="(x * 31 + y * 17 + ((x ^ y) & 7)) % n",
        rock=dict(value=1, frames=[f"terrain_rock_v{v}" for v in range(TR.ROCK_VARIANTS)], anchor="centre", front="y + 1"),
        water=dict(values=list(TR.WET), frames={str(m): f"terrain_water_m{m}" for m in range(1, 16)}, anchor="corner",
                   mask="bit 0 cell (X-1, Y-1), bit 1 (X, Y-1), bit 2 (X-1, Y), bit 3 (X, Y): wet; off the map: the nearest cell",
                   tile_px_3x=list(TILE_PX), layer="water"),
        ford=dict(value=4, frames=[f"terrain_ford_v{v}" for v in range(TR.FORDS)], anchor="centre", layer="ford"),
        bridge={"5": dict(deck="terrain_bridge_deck_ns", rail="terrain_bridge_rail_y",
                          rails="west edge (x, y + 0.5) where cell (x-1, y) is not 5; east edge (x + 1, y + 0.5) where (x+1, y) is not 5",
                          front="y + 1"),
                "6": dict(deck="terrain_bridge_deck_ew", rail="terrain_bridge_rail_x",
                          rails="north edge (x + 0.5, y) front y + 0.01 where cell (x, y-1) is not 6; south edge (x + 0.5, y + 1) front y + 1 where (x, y+1) is not 6"),
                "layer": "deck", "deck_top_m": DECK_TOP_M},
        cliff=dict(value=7, posts=[f"terrain_cliff_post_v{v}" for v in range(TR.CLIFF_POSTS)], post_front="y + 1",
                   post_when="the cell's links (the cliff neighbours on its four sides, and on a corner only where neither "
                             "side cell between is cliff) are not exactly two opposite ones",
                   arm_variant="variant(x, y, 3) of the cell (x, y) the arm starts from",
                   arms={"E": dict(frames=[f"terrain_cliff_arm_E_v{v}" for v in range(TR.CLIFF_ARMS)], when="(x+1, y) is 7",
                                   anchor="(x + 1, y + 0.5)", front="y + 0.99"),
                         "S": dict(frames=[f"terrain_cliff_arm_S_v{v}" for v in range(TR.CLIFF_ARMS)], when="(x, y+1) is 7",
                                   anchor="(x + 0.5, y + 1)", front="y + 1.99"),
                         "SE": dict(frames=[f"terrain_cliff_arm_SE_v{v}" for v in range(TR.CLIFF_ARMS)],
                                    when="(x+1, y+1) is 7, (x+1, y) and (x, y+1) are not", anchor="(x + 1, y + 1)", front="y + 1.99"),
                         "SW": dict(frames=[f"terrain_cliff_arm_SW_v{v}" for v in range(TR.CLIFF_ARMS)],
                                    when="(x-1, y+1) is 7, (x-1, y) and (x, y+1) are not", anchor="(x, y + 1)", front="y + 1.99")}))


def terrain_prep(name, col, sh, anchor, s_anchor):
    """The water tiles cut to exactly their cell-sized square round the corner (shifted by the anchor's fraction of
    a pixel first, premultiplied, so neighbours meet edge to edge with no half-transparent seam; the render reaches
    a little past the square); the bridge decks with their own shadow drawn under them (the deck is on the ground
    layer, under the shadow layer); the other ground pieces without a shadow."""
    ax, ay = anchor
    if name.startswith("terrain_water_"):
        fx, fy = ax - math.floor(ax), ay - math.floor(ay)
        w, h = TILE_PX
        x0, y0 = math.floor(ax) - w // 2, math.floor(ay) - h // 2
        pm = col.convert("RGBa").transform(col.size, Image.AFFINE, (1, 0, fx, 0, 1, fy), resample=Image.BICUBIC)
        return pm.convert("RGBA").crop((x0, y0, x0 + w, y0 + h)), (w / 2, h / 2), False, False
    if name.startswith("terrain_bridge_deck_"):
        sax, say = s_anchor
        a = sh.getchannel("A").resize((sh.width * 2, sh.height * 2), Image.BILINEAR)
        ox, oy = int(round(ax - sax * 2)), int(round(ay - say * 2))     # the shadow's corner in the colour's pixels
        x0, y0 = min(0, ox), min(0, oy)
        x1, y1 = max(col.width, ox + a.width), max(col.height, oy + a.height)
        big = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
        big.paste(Image.merge("RGBA", (Image.new("L", a.size, 0),) * 3 + (a,)), (ox - x0, oy - y0))
        big.alpha_composite(col, (-x0, -y0))
        return big, (ax - x0, ay - y0), False, True
    if name.startswith("terrain_ford_"):
        return col, anchor, False, True
    return col, anchor, True, True


def node_table():
    return {
        "Tree": dict(kind=0, footprint=[1, 1], variants={c: [f"tree_{c}_v{v}" for v in range(3)] for c in CULTURES},
                     depleted={c: f"tree_{c}_stump" for c in CULTURES}),
        "GoldMine": dict(kind=1, footprint=[1, 1], variants=["gold_v0", "gold_v1"], stages=["full", "mined", "depleted"]),
        "Berries": dict(kind=2, footprint=[1, 1], variants=["berry_v0", "berry_v1"], stages=["full", "depleted"]),
        "CrystalVein": dict(kind=3, footprint=[1, 1], variants=["crystal_v0", "crystal_v1"], stages=["full", "depleted"]),
    }


def node_frames():
    t = node_table()
    out = [n for c in CULTURES for n in t["Tree"]["variants"][c] + [t["Tree"]["depleted"][c]]]
    for k in ("GoldMine", "Berries", "CrystalVein"):
        out += [f"{v}_{s}" for v in t[k]["variants"] for s in t[k]["stages"]]
    return out


def _bbox(alpha, thr=TRIM):
    return alpha.point(lambda v: 255 if v > thr else 0).getbbox()


def _scaled(img, f):
    if f == 1:
        return img
    return img.resize((max(1, round(img.width * f)), max(1, round(img.height * f))), Image.LANCZOS)


def layers(name):
    """(colour, team, shadow, anchor, shadow anchor) at 3x for one rendered piece, smoke drawn in."""
    meta = json.loads((SRC / f"{name}_x3.json").read_text())
    if meta["px_per_m"] != PX_PER_M:
        raise SystemExit(f"{name}: px_per_m {meta['px_per_m']}")
    b = Image.open(SRC / f"{name}_x3_beauty.png").convert("RGBA")
    c = np.asarray(b, np.float32).copy()
    ao_p = SRC / f"{name}_x3_ao.png"
    if ao_p.exists():
        ao = np.asarray(Image.open(ao_p).convert("L"), np.float32) / 255.0
        c[..., :3] *= (0.7 + 0.3 * ao)[..., None]
    m = np.asarray(Image.open(SRC / f"{name}_x3_mask.png").convert("RGBA"), np.float32)
    w = (m[..., 0] / 255.0) * (m[..., 3] / 255.0) * (c[..., 3] / 255.0)
    ax, ay = meta["anchor"]
    proj.use_camera(meta.get("camera"))           # the smoke columns stand where this render's camera saw them
    colour = Image.fromarray(np.clip(c, 0, 255).astype(np.uint8), "RGBA")
    weight = Image.fromarray((w * 255).astype(np.uint8), "L")
    smokes = []
    for k, sm in enumerate(meta.get("smoke", [])):
        img, (sx, sy) = smoke2d.column(PX_PER_M, h=sm["h"], r0=sm["r0"], r1=sm["r1"], dark=sm["dark"], alpha=sm["alpha"],
                                       drift=tuple(sm["drift"]), seed=k)   # the seed of the approved boards
        px, py = proj.to_px(sm["pos"], (ax, ay), PX_PER_M)
        smokes.append((img, int(round(px - sx)), int(round(py - sy))))
    if smokes:
        # grow the canvas to hold the columns, then draw them over the building
        x0 = min([0] + [x for _, x, _ in smokes])
        y0 = min([0] + [y for _, _, y in smokes])
        x1 = max([colour.width] + [x + im.width for im, x, _ in smokes])
        y1 = max([colour.height] + [y + im.height for im, _, y in smokes])
        big = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
        big.paste(colour, (-x0, -y0))
        bw = Image.new("L", big.size, 0)
        bw.paste(weight, (-x0, -y0))
        cover = Image.new("RGBA", big.size, (0, 0, 0, 0))
        for im, x, y in smokes:
            big.alpha_composite(im, (x - x0, y - y0))
            cover.alpha_composite(im, (x - x0, y - y0))
        cov = np.asarray(cover, np.float32)[..., 3] / 255.0
        weight = Image.fromarray((np.asarray(bw, np.float32) * (1 - cov)).astype(np.uint8), "L")
        colour, ax, ay = big, ax - x0, ay - y0
    ca = np.asarray(colour, np.float32)
    team = np.zeros_like(ca)
    team[..., :3] = np.clip(ca[..., :3] * TEAM_GAIN, 0, 255)
    team[..., 3] = np.asarray(weight, np.float32)
    team = Image.fromarray(team.astype(np.uint8), "RGBA")
    a = Image.open(SRC / f"{name}_x3_shadow.png").convert("RGBA").getchannel("A")
    a = a.point(lambda v: v if v >= SHADOW_FLOOR else 0)
    shadow = Image.merge("LA", (Image.new("L", a.size, 0), a))
    return colour, team, shadow, (ax, ay), tuple(meta["shadow_anchor"])


def _anchor(ax, ay, bb, f):
    return dict(ax=round((ax - bb[0]) * f, 2), ay=round((ay - bb[1]) * f, 2))


def pack(frames, prefix, out, page, f, with_team=True, prep=None):
    """frames: list of names -> pages <prefix>_<layer>_<k>.png; returns (tables, pages, px, per-frame px).
    prep(name, colour, shadow, anchor, shadow anchor) -> (colour, anchor, keep the shadow, trim): a frame's own cut
    (the terrain's water tiles, the bridge decks)."""
    todo = {"color": [], "team": [], "shadow": []} if with_team else {"color": [], "shadow": []}
    per = {}
    for name in frames:
        col, team, sh, (ax, ay), (sax, say) = layers(name)
        keep_shadow, trim = True, True
        if prep:
            col, (ax, ay), keep_shadow, trim = prep(name, col, sh, (ax, ay), (sax, say))
        bb = _bbox(col.getchannel("A")) if trim else (0, 0, col.width, col.height)
        im = _scaled(col.crop(bb), f)
        todo["color"].append((name, im, _anchor(ax, ay, bb, f)))
        per[name] = {"color": im.width * im.height}
        if with_team:
            tbb = _bbox(team.getchannel("A"))
            if tbb:
                ti = _scaled(team.crop(tbb), f)
                todo["team"].append((name, ti, _anchor(ax, ay, tbb, f)))
                per[name]["team"] = ti.width * ti.height
        sbb = _bbox(sh.getchannel("A")) if keep_shadow else None
        if sbb:
            si = _scaled(sh.crop(sbb), f)
            todo["shadow"].append((name, si, dict(_anchor(sax, say, sbb, f), half_res=True)))
            per[name]["shadow"] = si.width * si.height
    tables, pages, px = {}, {}, {}
    for layer, items in todo.items():
        packer, table = Packer(page), {}
        for name, im, anc in sorted(items, key=lambda t: (-t[1].height, -t[1].width, t[0])):
            k, x, y = packer.add(im)
            table[name] = dict(page=k, x=x, y=y, w=im.width, h=im.height, **anc)
        files, area = [], 0
        for k, content in enumerate(packer.pages):
            if not content:
                continue
            h = min(page, (packer.used_height(k) + 3) // 4 * 4)
            mode = "LA" if layer == "shadow" else "RGBA"
            pg = Image.new(mode, (page, h), (0, 0) if mode == "LA" else (0, 0, 0, 0))
            for x, y, im in content:
                pg.paste(im, (x, y))
            p = out / f"{prefix}_{layer}_{k}.png"
            pg.save(p, optimize=True)
            files.append(p.name)
            area += pg.width * pg.height
        tables[layer], pages[layer], px[layer] = dict(sorted(table.items())), files, area
    return tables, pages, px, per


def memory(px, tables):
    mem = {f"{k}_bytes": v * 4 for k, v in px.items()}
    mem["total_rgba8_bytes"] = sum(px.values()) * 4
    mem["total_astc_4x4_bytes"] = sum(px.values())
    mem["frames_px"] = {k: sum(v["w"] * v["h"] for v in t.values()) for k, t in tables.items()}
    return mem


def view_of(frames):
    """The camera every frame was rendered with, for the manifests' "view" (D-088): "oblique" (方形斜看) or None
    (the diamond camera; the art-v2 manifests have no "view"). Frames from two cameras are an error."""
    views = set()
    for n in frames:
        cam = json.loads((SRC / f"{n}_x3.json").read_text()).get("camera") or proj.DIAMOND
        if cam == proj.OBLIQUE:
            views.add("oblique")
        elif cam == proj.DIAMOND:
            views.add(None)
        else:
            raise SystemExit(f"{n}: camera {cam} is neither the diamond nor the oblique one")
    if len(views) != 1:
        raise SystemExit(f"frames from two cameras: {views}")
    return views.pop()


def run(scale=3.0, page=2048):
    f = scale / 3.0
    root = config.BUILD / f"atlas_x{scale:g}"
    shutil.rmtree(root, ignore_errors=True)
    report = {"scale": scale, "buildings": {}, "frames": {}}
    bdir = root / "buildings"
    bdir.mkdir(parents=True)
    mem_all = {}
    for c in CULTURES:
        table = building_table(c)
        frames = sorted({n for b in table.values() for n in building_frames(b)})
        missing = [n for n in frames if not (SRC / f"{n}_x3.json").exists()]
        if missing:
            raise SystemExit(f"missing renders: {missing}")
        view = view_of(frames)
        tables, pages, px, per = pack(frames, f"buildings_{c}", bdir, page, f)
        man = {"format": "war-game buildings 1", "culture": c, "scale": scale, "px_per_m": PX_PER_M * f, "cell_m": 2,
               **({"view": view} if view else {}),
               "team_gain": TEAM_GAIN, "pages": pages, "buildings": table,
               "frames": tables["color"], "team": tables["team"], "shadows": tables["shadow"]}
        (bdir / f"buildings_{c}.json").write_text(json.dumps(man, separators=(",", ":")))
        mem_all[c] = memory(px, tables)
        report["frames"].update(per)
        # each building's own frames (the shared foundation and rubble counted once, under "shared")
        shared = {n for n in frames if n.startswith(("found_", "rubble_"))}
        for bname, b in table.items():
            own = sorted({n for n in building_frames(b) if n not in shared})
            report["buildings"][f"{bname}_{c}"] = sum(sum(per[n].values()) for n in own)
        report["buildings"][f"shared_{c}"] = sum(sum(per[n].values()) for n in shared)
    (bdir / "memory.json").write_text(json.dumps(dict(
        {f"buildings_{c}": m for c, m in mem_all.items()},
        total_rgba8_bytes=sum(m["total_rgba8_bytes"] for m in mem_all.values()),
        total_astc_4x4_bytes=sum(m["total_astc_4x4_bytes"] for m in mem_all.values())), indent=1))
    # the castles: one set of pages per culture, the floor tiles with them (no player colour on the tiles)
    cdir = root / "castle"
    cdir.mkdir()
    mem_c = {}
    for c in CULTURES:
        frames = castle_frames(c)
        missing = [n for n in frames if not (SRC / f"{n}_x3.json").exists()]
        if missing:
            raise SystemExit(f"missing renders: {missing}")
        view = view_of(frames)
        tables, pages, px, per = pack(frames, f"castle_{c}", cdir, page, f)
        pieces, tiles, layouts = castle_table(c)
        man = {"format": "war-game castle 1", "culture": c, "scale": scale, "px_per_m": PX_PER_M * f, "cell_m": 2,
               **({"view": view} if view else {}), "team_gain": TEAM_GAIN, "pages": pages,
               "pieces": pieces, "tiles": tiles, "layouts": layouts,
               "frames": tables["color"], "team": tables["team"], "shadows": tables["shadow"]}
        (cdir / f"castle_{c}.json").write_text(json.dumps(man, separators=(",", ":")))
        mem_c[c] = memory(px, tables)
        report["frames"].update(per)
    (cdir / "memory.json").write_text(json.dumps(dict(
        {f"castle_{c}": m for c, m in mem_c.items()},
        total_rgba8_bytes=sum(m["total_rgba8_bytes"] for m in mem_c.values()),
        total_astc_4x4_bytes=sum(m["total_astc_4x4_bytes"] for m in mem_c.values())), indent=1))
    # the terrain: one set of pages for both cultures, no player colour
    tdir = root / "terrain"
    tdir.mkdir()
    tf = TR.frames()
    missing = [n for n in tf if not (SRC / f"{n}_x3.json").exists()]
    if missing:
        raise SystemExit(f"missing renders: {missing}")
    view = view_of(tf)
    tables, pages, px, per = pack(tf, "terrain", tdir, page, f, with_team=False, prep=terrain_prep)
    man = {"format": "war-game terrain 1", "scale": scale, "px_per_m": PX_PER_M * f, "cell_m": 2,
           **({"view": view} if view else {}), "pages": pages, "rules": terrain_table(),
           "frames": tables["color"], "shadows": tables["shadow"]}
    (tdir / "terrain.json").write_text(json.dumps(man, separators=(",", ":")))
    mem_t = memory(px, tables)
    (tdir / "memory.json").write_text(json.dumps(mem_t, indent=1))
    report["frames"].update(per)
    ndir = root / "nodes"
    ndir.mkdir()
    nf = node_frames()
    view = view_of(nf)
    tables, pages, px, per = pack(nf, "nodes", ndir, page, f, with_team=False)
    man = {"format": "war-game nodes 1", "scale": scale, "px_per_m": PX_PER_M * f, "cell_m": 2,
           **({"view": view} if view else {}), "pages": pages,
           "nodes": node_table(), "frames": tables["color"], "shadows": tables["shadow"]}
    (ndir / "nodes.json").write_text(json.dumps(man, separators=(",", ":")))
    mem_n = memory(px, tables)
    (ndir / "memory.json").write_text(json.dumps(mem_n, indent=1))
    report["frames"].update(per)
    report["pages"] = {**{f"buildings_{c}": mem_all[c]["total_rgba8_bytes"] for c in CULTURES},
                       **{f"castle_{c}": mem_c[c]["total_rgba8_bytes"] for c in CULTURES},
                       "nodes": mem_n["total_rgba8_bytes"], "terrain": mem_t["total_rgba8_bytes"]}
    (root / "report.json").write_text(json.dumps(report, indent=1))
    b = {k: v for k, v in report["buildings"].items() if not k.startswith("shared")}
    lo, hi = min(b, key=b.get), max(b, key=b.get)
    print(f"x{scale:g}: buildings {sum(m['total_rgba8_bytes'] for m in mem_all.values()) / 2 ** 20:.1f} MB RGBA8 "
          f"(E {mem_all['E']['total_rgba8_bytes'] / 2 ** 20:.1f}, W {mem_all['W']['total_rgba8_bytes'] / 2 ** 20:.1f}), "
          f"nodes {mem_n['total_rgba8_bytes'] / 2 ** 20:.1f} MB, terrain {mem_t['total_rgba8_bytes'] / 2 ** 20:.1f} MB; one building's frames: {lo} {b[lo] * 4 / 2 ** 20:.2f} MB "
          f"to {hi} {b[hi] * 4 / 2 ** 20:.2f} MB")
    return report


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--scale", type=float, default=3.0)
    ap.add_argument("--page", type=int, default=2048)
    a = ap.parse_args()
    run(a.scale, a.page)
