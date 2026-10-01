"""Post-processing: 3x source renders -> trimmed frames packed into atlas pages.

python3 common/postprocess.py --target farmer_e [--scale 3] [--page 2048] [--team-gain 1.6] [--astc 4x4]
-> build/prod/<unit>/atlas_x<scale>/<unit>_color_<k>.png   RGBA8, AO baked in, player-colour parts grey
                                    <unit>_team_<k>.png    RGBA8 player-colour layer (own trim and layout)
                                    <unit>_shadow_<k>.png  black + alpha (LA), half the colour resolution
                                    <unit>_fx_<k>.png      RGBA8 (mages: magic circle, flashes, shards)
                                    <unit>_shield_<k>.png  RGBA8 (mages: the shield alone, one facing)
                                    <unit>.json            format "war-game atlas 2"
                                    memory.json            runtime bytes (the GPU keeps every PNG as RGBA8)

Format: client/docs/sprite-atlas.md version 2 (war-game-client, 2026-10-01).
- colour: straight alpha; the client draws it normally.
- team: RGB = the colour layer at that point x team_gain (1.6, clipped at white), A = mask weight x colour alpha;
  the client draws it over the colour layer tinted with the player colour (a multiply in effect).
- shadow: rendered for all eight facings, stored at half resolution, the client scales it by 2.
- frames/team/fx list the rendered facings only; mirrored facings are drawn flipped (scale.x = -1
  about the anchor). shadows list all eight. Frames with nothing in a layer are not listed.
- shield (mages): its own pages and a `shield` block {anims, frames}; frames are named
  <unit>_shield_<anim>_<ii>, have no facing and are never mirrored. The effect layer no longer
  contains the shield (render_units.py split_shield).
- anims: fps; hit on attack (the blow) and on the work loops (the tool lands); impact (and
  impact_scale when not 1) on a death or a mage's fall, where the game plays the shared dust
  (common/effects.py); stride_m on a siege engine's walk.

The scale and the compression are parameters: the renders stay at 3x, and when the client has
measured on the iPhone (D-017 is provisional) only this step is run again. --astc runs astcenc
if it is installed (not in this repo); without it only the PNG pages are written.
"""
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import config  # noqa: E402
import spec    # noqa: E402

TRIM = 4               # alpha above this counts as part of the frame
SHADOW_FLOOR = 20      # shadow alpha below this (under ~7% darkening) is render noise: cleared, so frames trim


def _bbox(alpha, thr=TRIM):
    return alpha.point(lambda v: 255 if v > thr else 0).getbbox()


def _colour(raw, base):
    b = Image.open(raw / f"{base}_x3_beauty.png").convert("RGBA")
    ao_p = raw / f"{base}_x3_ao.png"
    if ao_p.exists():
        ao = np.asarray(Image.open(ao_p).convert("L"), np.float32) / 255.0
        a = np.asarray(b, np.float32)
        a[..., :3] *= (0.7 + 0.3 * ao)[..., None]
        b = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")
    return b


def _team(raw, base, colour, gain):
    """Player-colour layer: the colour layer's pixels x gain (clipped at white), alpha = mask weight x
    colour alpha. The gain 1.6 (= 1 / 0.62, R5's reference grey) makes the client's multiply match
    the approved R5 recolouring; checked in blue, red, yellow and near-white (common/team_compare.py)."""
    m = np.asarray(Image.open(raw / f"{base}_x3_mask.png").convert("RGBA"), np.float32)
    c = np.asarray(colour, np.float32)
    w = (m[..., 0] / 255.0) * (m[..., 3] / 255.0) * (c[..., 3] / 255.0)
    out = np.zeros_like(c)
    out[..., :3] = np.clip(c[..., :3] * gain, 0, 255)
    out[..., 3] = w * 255
    return Image.fromarray(out.astype(np.uint8), "RGBA")


def _shadow(raw, base):
    a = Image.open(raw / f"{base}_x3_shadow.png").convert("RGBA").getchannel("A")
    a = a.point(lambda v: v if v >= SHADOW_FLOOR else 0)
    return Image.merge("LA", (Image.new("L", a.size, 0), a))       # black + alpha


class Packer:
    """Shelf packing into pages of a fixed width; frames are added tallest first."""

    def __init__(self, page):
        self.page = page
        self.pages = [[]]            # list of (x, y, img)
        self.x = self.y = self.shelf = 0

    def add(self, img, pad=2):
        w, h = img.width + pad, img.height + pad
        if w > self.page or h > self.page:
            raise SystemExit(f"frame {img.size} larger than the page {self.page}")
        if self.x + w > self.page:
            self.x, self.y, self.shelf = 0, self.y + self.shelf, 0
        if self.y + h > self.page:
            self.pages.append([])
            self.x = self.y = self.shelf = 0
        pos = (len(self.pages) - 1, self.x, self.y)
        self.pages[-1].append((self.x, self.y, img))
        self.x += w
        self.shelf = max(self.shelf, h)
        return pos

    def used_height(self, k):
        return max((y + im.height for _, y, im in self.pages[k]), default=1)


def _scaled(img, f):
    if f == 1:
        return img
    return img.resize((max(1, round(img.width * f)), max(1, round(img.height * f))), Image.LANCZOS)


def _anchor(ax, ay, bb, f, div=1):
    return dict(ax=round((ax / div - bb[0]) * f, 2), ay=round((ay / div - bb[1]) * f, 2))


TEAM_GAIN = 1.6        # ceo 2026-10-01, after the four-colour check


def run(target, scale=3.0, page=2048, team_gain=TEAM_GAIN, astc=None, facings=None, preview=False):
    u = spec.UNITS[target]
    raw = config.BUILD / "prod" / target / "raw"
    out = config.BUILD / "prod" / target / f"atlas_x{scale:g}"
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    f = scale / 3.0
    mage = u["kind"].startswith("mage")
    todo = {"color": [], "team": [], "shadow": [], "fx": [], "shield": []}
    for name, n, _, _ in u["anims"]:
        for fc in (facings or spec.ALL_FACINGS):
            for i in ([0] if preview else range(n)):
                base = spec.frame_name(target, name, fc, i)
                meta_p = raw / f"{base}_x3.json"
                if not meta_p.exists():
                    continue            # an animation added to the spec after these renders
                ax, ay = json.loads(meta_p.read_text())["anchor"]
                s = _shadow(raw, base)
                sbb = _bbox(s.getchannel("A"))
                if sbb:
                    todo["shadow"].append((base, _scaled(s.crop(sbb), f), dict(_anchor(ax, ay, sbb, f, 2), half_res=True)))
                if fc in spec.MIRRORED:
                    continue
                c = _colour(raw, base)
                bb = _bbox(c.getchannel("A"))
                todo["color"].append((base, _scaled(c.crop(bb), f), _anchor(ax, ay, bb, f)))
                t = _team(raw, base, c, team_gain)
                tbb = _bbox(t.getchannel("A"))
                if tbb:                   # frames with no visible player colour are not listed
                    todo["team"].append((base, _scaled(t.crop(tbb), f), _anchor(ax, ay, tbb, f)))
                if mage and (raw / f"{base}_x3_fx.png").exists():
                    e = Image.open(raw / f"{base}_x3_fx.png").convert("RGBA")
                    ebb = _bbox(e.getchannel("A"))
                    if ebb:
                        todo["fx"].append((base, _scaled(e.crop(ebb), f), _anchor(ax, ay, ebb, f)))
    shield_anims = {}
    if mage:
        for a, n in spec.SHIELD_ANIMS:
            shield_anims[a] = dict(frames=n, fps=spec.SHIELD_FPS[a], loop=a == "on")
            for i in range(n):
                base = f"{target}_shield_{a}_{i:02d}"
                meta_p = raw / f"{base}_x3.json"
                if not meta_p.exists():
                    continue
                ax, ay = json.loads(meta_p.read_text())["anchor"]
                e = Image.open(raw / f"{base}_x3_shield.png").convert("RGBA")
                ebb = _bbox(e.getchannel("A"))
                if ebb:
                    todo["shield"].append((base, _scaled(e.crop(ebb), f), _anchor(ax, ay, ebb, f)))

    tables, pages, px = {}, {}, {}
    for layer, items in todo.items():
        packer, table = Packer(page), {}
        for base, im, anc in sorted(items, key=lambda t: (-t[1].height, -t[1].width, t[0])):
            k, x, y = packer.add(im)
            table[base] = dict(page=k, x=x, y=y, w=im.width, h=im.height, **anc)
        files, area = [], 0
        for k, content in enumerate(packer.pages):
            if not content:
                continue
            # height rounded up to a multiple of 4 (ASTC blocks); WebGL2 and iPhone GPUs take
            # non-power-of-two textures, and rounding to a power of two left a third of the page empty
            h = min(page, (packer.used_height(k) + 3) // 4 * 4)
            mode = "LA" if layer == "shadow" else "RGBA"
            pg = Image.new(mode, (page, h), (0, 0) if mode == "LA" else (0, 0, 0, 0))
            for x, y, im in content:
                pg.paste(im, (x, y))
            p = out / f"{target}_{layer}_{k}.png"
            pg.save(p, optimize=True)
            files.append(p.name)
            area += pg.width * pg.height
        tables[layer], pages[layer], px[layer] = table, files, area

    # every uncompressed page sits on the GPU as RGBA8 (4 bytes a pixel, greyscale too); ASTC 4x4 is 1 byte
    mem = {f"{k}_bytes": v * 4 for k, v in px.items()}
    mem["total_rgba8_bytes"] = sum(px.values()) * 4
    mem["total_astc_4x4_bytes"] = sum(px.values())
    mem["frames_px"] = {k: sum(v["w"] * v["h"] for v in t.values()) for k, t in tables.items()}
    if astc and shutil.which("astcenc"):
        for layer in pages:
            for p in pages[layer]:
                subprocess.run(["astcenc", "-cl", str(out / p), str(out / p.replace(".png", ".astc.ktx")), astc,
                                "-medium"], check=True)
    anims = {}
    for a, n, _, ph in u["anims"]:
        d = dict(frames=n, fps=spec.FPS.get(a, 12), loop=a in ("idle", "walk") or a.startswith("work_"),
                 placeholder=ph)
        if a == "attack":
            d["hit"] = spec.HIT[target]
        if a in spec.WORK_HIT:
            d["hit"] = spec.WORK_HIT[a]
        if target in spec.IMPACT and spec.IMPACT[target][0] == a:
            d["impact"] = spec.IMPACT[target][1]
            if spec.IMPACT[target][2] != 1.0:
                d["impact_scale"] = spec.IMPACT[target][2]
        if a == "walk" and target in spec.STRIDE_M:
            d["stride_m"] = spec.STRIDE_M[target]
        anims[a] = d
    manifest = {"format": "war-game atlas 2", "unit": target, "scale": scale, "px_per_m": spec.PX_PER_M * f,
                "team_gain": team_gain,
                "facings": dict(rendered=spec.RENDERED_FACINGS, mirrored={str(k): v for k, v in spec.MIRRORED.items()}),
                "anims": anims, "pages": pages,
                "frames": tables["color"], "team": tables["team"], "shadows": tables["shadow"], "fx": tables["fx"]}
    if mage:
        manifest["shield"] = dict(anims=shield_anims, frames=tables["shield"])
    (out / f"{target}.json").write_text(json.dumps(manifest, separators=(",", ":")))
    (out / "memory.json").write_text(json.dumps(mem, indent=1))
    print(f"[{target}] x{scale:g}: " + ", ".join(f"{k} {len(tables[k])} frames/{len(pages[k])} pages" for k in tables)
          + f"; {mem['total_rgba8_bytes'] / 2 ** 20:.1f} MB RGBA8, {mem['total_astc_4x4_bytes'] / 2 ** 20:.1f} MB ASTC")
    return mem


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", required=True, choices=list(spec.UNITS))
    ap.add_argument("--scale", type=float, default=3.0, help="output scale (3 = source; 2 = two-thirds size)")
    ap.add_argument("--page", type=int, default=2048)
    ap.add_argument("--team-gain", type=float, default=TEAM_GAIN,
                    help="brighten the player-colour layer (1.0 = the colour layer as it is)")
    ap.add_argument("--astc", help="block size for astcenc, e.g. 4x4 (optional; needs astcenc on PATH)")
    ap.add_argument("--facings")
    ap.add_argument("--preview", action="store_true")
    a = ap.parse_args()
    run(a.target, a.scale, a.page, a.team_gain, a.astc, [int(x) for x in a.facings.split(",")] if a.facings else None,
        a.preview)
