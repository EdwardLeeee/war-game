"""R6 production: the B1 production renders (run.py prod_* targets) -> the building and resource-point
atlases of design/b1/atlas-buildings.md (agreed with client 2026-10-18).

python3 common/atlas_b1.py [--scale 3] [--page 2048]
  reads  build/b1/prod/<frame>_x3_{beauty,mask,shadow,ao}.png and <frame>_x3.json
  writes build/atlas_x<scale>/buildings/buildings_<E|W>.json, buildings_<c>_{color,team,shadow}_<k>.png, memory.json
         build/atlas_x<scale>/nodes/nodes.json, nodes_{color,shadow}_<k>.png, memory.json
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
    t["TownTower"] = dict(type=9, footprint=[2, 2], states={s: f"town_tower_{c}_{s}" for s in ("done", "damaged", "rubble")})
    return dict(sorted(t.items(), key=lambda kv: kv[1]["type"]))


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
    colour = Image.fromarray(np.clip(c, 0, 255).astype(np.uint8), "RGBA")
    weight = Image.fromarray((w * 255).astype(np.uint8), "L")
    smokes = []
    for k, sm in enumerate(meta.get("smoke", [])):
        img, (sx, sy) = smoke2d.column(PX_PER_M, h=sm["h"], r0=sm["r0"], r1=sm["r1"], dark=sm["dark"], alpha=sm["alpha"],
                                       drift=tuple(sm["drift"]), seed=k + 1)
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


def pack(frames, prefix, out, page, f, with_team=True):
    """frames: list of names -> pages <prefix>_<layer>_<k>.png; returns (tables, pages, px, per-frame px)."""
    todo = {"color": [], "team": [], "shadow": []} if with_team else {"color": [], "shadow": []}
    per = {}
    for name in frames:
        col, team, sh, (ax, ay), (sax, say) = layers(name)
        bb = _bbox(col.getchannel("A"))
        im = _scaled(col.crop(bb), f)
        todo["color"].append((name, im, _anchor(ax, ay, bb, f)))
        per[name] = {"color": im.width * im.height}
        if with_team:
            tbb = _bbox(team.getchannel("A"))
            if tbb:
                ti = _scaled(team.crop(tbb), f)
                todo["team"].append((name, ti, _anchor(ax, ay, tbb, f)))
                per[name]["team"] = ti.width * ti.height
        sbb = _bbox(sh.getchannel("A"))
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
        frames = sorted({n for b in table.values() for n in list(b["states"].values()) + b.get("crops", [])})
        missing = [n for n in frames if not (SRC / f"{n}_x3.json").exists()]
        if missing:
            raise SystemExit(f"missing renders: {missing}")
        tables, pages, px, per = pack(frames, f"buildings_{c}", bdir, page, f)
        man = {"format": "war-game buildings 1", "culture": c, "scale": scale, "px_per_m": PX_PER_M * f, "cell_m": 2,
               "team_gain": TEAM_GAIN, "pages": pages, "buildings": table,
               "frames": tables["color"], "team": tables["team"], "shadows": tables["shadow"]}
        (bdir / f"buildings_{c}.json").write_text(json.dumps(man, separators=(",", ":")))
        mem_all[c] = memory(px, tables)
        report["frames"].update(per)
        # each building's own frames (the shared foundation and rubble counted once, under "shared")
        shared = {n for n in frames if n.startswith(("found_", "rubble_"))}
        for bname, b in table.items():
            own = sorted({n for n in list(b["states"].values()) + b.get("crops", []) if n not in shared})
            report["buildings"][f"{bname}_{c}"] = sum(sum(per[n].values()) for n in own)
        report["buildings"][f"shared_{c}"] = sum(sum(per[n].values()) for n in shared)
    (bdir / "memory.json").write_text(json.dumps(dict(
        {f"buildings_{c}": m for c, m in mem_all.items()},
        total_rgba8_bytes=sum(m["total_rgba8_bytes"] for m in mem_all.values()),
        total_astc_4x4_bytes=sum(m["total_astc_4x4_bytes"] for m in mem_all.values())), indent=1))
    ndir = root / "nodes"
    ndir.mkdir()
    nf = node_frames()
    tables, pages, px, per = pack(nf, "nodes", ndir, page, f, with_team=False)
    man = {"format": "war-game nodes 1", "scale": scale, "px_per_m": PX_PER_M * f, "cell_m": 2, "pages": pages,
           "nodes": node_table(), "frames": tables["color"], "shadows": tables["shadow"]}
    (ndir / "nodes.json").write_text(json.dumps(man, separators=(",", ":")))
    mem_n = memory(px, tables)
    (ndir / "memory.json").write_text(json.dumps(mem_n, indent=1))
    report["frames"].update(per)
    report["pages"] = {**{f"buildings_{c}": mem_all[c]["total_rgba8_bytes"] for c in CULTURES},
                       "nodes": mem_n["total_rgba8_bytes"]}
    (root / "report.json").write_text(json.dumps(report, indent=1))
    b = {k: v for k, v in report["buildings"].items() if not k.startswith("shared")}
    lo, hi = min(b, key=b.get), max(b, key=b.get)
    print(f"x{scale:g}: buildings {sum(m['total_rgba8_bytes'] for m in mem_all.values()) / 2 ** 20:.1f} MB RGBA8 "
          f"(E {mem_all['E']['total_rgba8_bytes'] / 2 ** 20:.1f}, W {mem_all['W']['total_rgba8_bytes'] / 2 ** 20:.1f}), "
          f"nodes {mem_n['total_rgba8_bytes'] / 2 ** 20:.1f} MB; one building's frames: {lo} {b[lo] * 4 / 2 ** 20:.2f} MB "
          f"to {hi} {b[hi] * 4 / 2 ** 20:.2f} MB")
    return report


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--scale", type=float, default=3.0)
    ap.add_argument("--page", type=int, default=2048)
    a = ap.parse_args()
    run(a.scale, a.page)
