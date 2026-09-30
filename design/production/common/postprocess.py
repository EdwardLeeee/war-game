"""Post-processing: 3x source renders -> trimmed frames packed into atlas pages (draft format).

python3 common/postprocess.py --target farmer_e [--scale 3] [--page 2048] [--astc 4x4]
-> build/prod/<unit>/atlas_x<scale>/<unit>_color_<k>.png   RGBA8, AO baked in, player-colour parts grey
                                    <unit>_mask_<k>.png    L8, same layout as colour (player-colour weight)
                                    <unit>_shadow_<k>.png  L8 alpha, own layout, half the colour resolution
                                    <unit>_fx_<k>.png      RGBA8 (mages: shield and magic circle)
                                    <unit>.json            frames, anchors, mirrored facings
                                    memory.json            runtime bytes per layer

The scale and the compression are parameters: the renders stay at 3x, and when the client has
measured on the iPhone (D-017 is provisional) only this step is run again. --astc runs astcenc
if it is installed (not in this repo); without it the PNG pages are written and the ASTC size
is computed (8 bits per pixel for 4x4 blocks).

Draft atlas format, to be aligned with war-game-client's spec:
  frames[name] = {page, x, y, w, h, ax, ay}   ax, ay: ground anchor inside the trimmed rect
  facings.mirrored = {"3": 1, "4": 0, "5": 7}: draw the source facing flipped horizontally,
  anchor x becomes w - ax; colour and mask only, shadows exist for every facing.
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


def _trim(img, thr=4):
    bb = img.getchannel("A").point(lambda v: 255 if v > thr else 0).getbbox() if img.mode == "RGBA" else img.getbbox()
    return bb


def _colour(raw, base):
    b = Image.open(raw / f"{base}_x3_beauty.png").convert("RGBA")
    ao_p = raw / f"{base}_x3_ao.png"
    if ao_p.exists():
        ao = np.asarray(Image.open(ao_p).convert("L"), np.float32) / 255.0
        a = np.asarray(b, np.float32)
        a[..., :3] *= (0.7 + 0.3 * ao)[..., None]
        b = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")
    return b


def _mask(raw, base, alpha):
    m = np.asarray(Image.open(raw / f"{base}_x3_mask.png").convert("RGBA"), np.float32)
    w = (m[..., 0] / 255.0) * (m[..., 3] / 255.0) * (np.asarray(alpha, np.float32) / 255.0)
    return Image.fromarray(np.clip(w * 255, 0, 255).astype(np.uint8), "L")


SHADOW_FLOOR = 20      # shadow alpha below this (under ~7% darkening) is render noise: cleared, so frames trim


def _shadow(raw, base):
    s = Image.open(raw / f"{base}_x3_shadow.png").convert("RGBA").getchannel("A")
    return s.point(lambda v: v if v >= SHADOW_FLOOR else 0)


class Packer:
    """Shelf packing into square pages."""

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


def run(target, scale=3.0, page=2048, astc=None, facings=None, preview=False):
    u = spec.UNITS[target]
    raw = config.BUILD / "prod" / target / "raw"
    out = config.BUILD / "prod" / target / f"atlas_x{scale:g}"
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    f = scale / 3.0
    mage = u["kind"].startswith("mage")
    col, sha, fx = Packer(page), Packer(page), Packer(page)
    frames, shadows, fxs = {}, {}, {}
    mask_items = []
    todo_c, todo_s, todo_f = [], [], []        # packed after sorting by height: far less empty page area
    for name, n, _, _ in u["anims"]:
        for fc in (facings or spec.ALL_FACINGS):
            for i in ([0] if preview else range(n)):
                base = spec.frame_name(target, name, fc, i)
                meta = json.loads((raw / f"{base}_x3.json").read_text())
                ax, ay = meta["anchor"]
                # shadow: every facing; stays at half the colour resolution
                s = _shadow(raw, base)
                sbb = _trim(s.convert("L"))
                if sbb:
                    s_c = _scaled(s.crop(sbb), f)
                    todo_s.append((base, s_c, dict(ax=round((ax / 2 - sbb[0]) * f, 2),
                                                   ay=round((ay / 2 - sbb[1]) * f, 2), half_res=True)))
                if fc in spec.MIRRORED:
                    continue
                c = _colour(raw, base)
                bb = _trim(c)
                c_c = _scaled(c.crop(bb), f)
                m_c = _scaled(_mask(raw, base, c.getchannel("A")).crop(bb), f)
                todo_c.append((base, c_c, dict(ax=round((ax - bb[0]) * f, 2), ay=round((ay - bb[1]) * f, 2)), m_c))
                if mage and (raw / f"{base}_x3_fx.png").exists():
                    e = Image.open(raw / f"{base}_x3_fx.png").convert("RGBA")
                    ebb = _trim(e)
                    if ebb:
                        e_c = _scaled(e.crop(ebb), f)
                        todo_f.append((base, e_c, dict(ax=round((ax - ebb[0]) * f, 2), ay=round((ay - ebb[1]) * f, 2))))

    def pack(todo, packer, table, masks=None):
        for item in sorted(todo, key=lambda t: (-t[1].height, -t[1].width, t[0])):
            base, im, anc = item[0], item[1], item[2]
            k, x, y = packer.add(im)
            table[base] = dict(page=k, x=x, y=y, w=im.width, h=im.height, **anc)
            if masks is not None:
                masks.append((k, x, y, item[3]))

    pack(todo_c, col, frames, mask_items)
    pack(todo_s, sha, shadows)
    pack(todo_f, fx, fxs)
    mem = {}

    def write(packer, kind, mode):
        total = 0
        files = []
        for k in range(len(packer.pages)):
            if not packer.pages[k]:
                continue
            # height rounded up to a multiple of 4 (ASTC blocks); WebGL2 and iPhone GPUs take
            # non-power-of-two textures, and rounding to a power of two left a third of the page empty
            h = (packer.used_height(k) + 3) // 4 * 4
            pg = Image.new(mode, (packer.page, min(h, packer.page)), 0 if mode == "L" else (0, 0, 0, 0))
            for x, y, im in packer.pages[k]:
                pg.paste(im, (x, y))
            p = out / f"{target}_{kind}_{k}.png"
            pg.save(p, optimize=True)
            files.append(p.name)
            total += pg.width * pg.height
        return files, total

    col_files, col_px = write(col, "color", "RGBA")
    mask_packer = Packer(page)
    mask_packer.pages = [[] for _ in col.pages]
    for k, x, y, m in mask_items:
        mask_packer.pages[k].append((x, y, m))
    mask_files, mask_px = write(mask_packer, "mask", "L")
    sha_files, sha_px = write(sha, "shadow", "L")
    fx_files, fx_px = write(fx, "fx", "RGBA") if fxs else ([], 0)
    mem = dict(color_rgba8=col_px * 4, mask_l8=mask_px, shadow_l8=sha_px, fx_rgba8=fx_px * 4)
    mem["total_rgba8_bytes"] = sum(mem.values())
    # ASTC 4x4 is 8 bits per pixel whatever the channel count; the mask could also ride in one channel
    mem["total_astc_4x4_bytes"] = col_px + fx_px + mask_px + sha_px
    mem["colour_frames_px"] = sum(v["w"] * v["h"] for v in frames.values())     # without page padding
    if astc and shutil.which("astcenc"):
        for p in col_files + fx_files:
            subprocess.run(["astcenc", "-cl", str(out / p), str(out / p.replace(".png", ".astc")), astc, "-medium"],
                           check=True)
    manifest = dict(format="war-game atlas draft 0", unit=target, scale=scale, px_per_m=spec.PX_PER_M * f,
                    facings=dict(rendered=spec.RENDERED_FACINGS, mirrored={str(k): v for k, v in spec.MIRRORED.items()}),
                    anims={a: dict(frames=n, placeholder=ph, loop=a in ("idle", "walk") or a.startswith("work_"))
                           for a, n, _, ph in u["anims"]},
                    pages=dict(color=col_files, mask=mask_files, shadow=sha_files, fx=fx_files),
                    frames=frames, shadows=shadows, fx=fxs)
    (out / f"{target}.json").write_text(json.dumps(manifest, separators=(",", ":")))
    (out / "memory.json").write_text(json.dumps(mem, indent=1))
    mb = {k: round(v / 2 ** 20, 1) for k, v in mem.items()}
    print(f"[{target}] x{scale:g}: {len(frames)} colour frames, {len(shadows)} shadows, {len(fxs)} fx; "
          f"pages colour {len(col_files)}, shadow {len(sha_files)}, fx {len(fx_files)}; MB {mb}")
    return mem


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", required=True, choices=list(spec.UNITS))
    ap.add_argument("--scale", type=float, default=3.0, help="output scale (3 = source; 2 = two-thirds size)")
    ap.add_argument("--page", type=int, default=2048)
    ap.add_argument("--astc", help="block size for astcenc, e.g. 4x4 (optional; needs astcenc on PATH)")
    ap.add_argument("--facings")
    ap.add_argument("--preview", action="store_true")
    a = ap.parse_args()
    run(a.target, a.scale, a.page, a.astc, [int(x) for x in a.facings.split(",")] if a.facings else None, a.preview)
