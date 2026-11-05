"""art-v7.1's comparison board (ceo 2026-11-05): the same battlefield (the main city, a stone wall, soldiers, the outpost)
as the iPhone (3 device pixels a point) would show it from the x3 PNG pages, from the x3 ASTC 4x4 pages and from the x2
PNG pages (the GPU stretches them 1.5 times), at the phone's real size, then three details enlarged.

The ASTC pages are decoded with astcenc (-dl: the premultiplied texels as stored), unpremultiplied and drawn like the
PNG ones; the ground is PNG in all three (art-v7.1 keeps ground/ uncompressed). Shadows darken the ground as the game does.

python3 design/r11/common/boards_v7astc.py X3 X2 ASTC_X3 ASTCENC OUT
  X3, X2: art-v7.1-x3.tar.gz, art-v7.1-x2.tar.gz unpacked; ASTC_X3: art-v7.1-astc-x3.tar.gz unpacked; ASTCENC: the binary
"""
import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "r9" / "common"))
import boards_r9 as B9    # noqa: E402
import scene_r9 as S9     # noqa: E402

W, H = 814, 380                 # the phone sideways, points
S2 = math.sqrt(0.5)
LIT = np.array([0.45, 0.46, 0.50])
# the scene in points at zoom 1 (x east, y south; the screen: right is +x +y, down is +y -x)
CASTLE = (700, -30)             # the large town's middle: its south-west wall and corner tower top right
BUILD = [("main_city_E_done", (205, 262)), ("outpost_E_done", (452, 306))]
SQUAD = (612, 250)
TROOP = [("spear_e", 0, 0), ("spear_e", 26, 8), ("spear_e", -24, 10), ("spear_e", 4, 26), ("spear_e", 30, 30), ("spear_e", -20, 32),
         ("bow_e", 10, -22), ("bow_e", 40, -14), ("bow_e", -14, -16), ("bow_e", 58, 8), ("mage_e", 64, 34), ("mage_e", -44, 18),
         ("hcav_e", 112, 52)]
CROPS = [("主城的屋頂和旗", (150, 92, 120, 80)), ("兵：槍兵、弓手、法師、重騎", (560, 210, 120, 80)), ("城牆的角樓：垛口、石塊和旗", (636, 30, 120, 80))]


def screen(x, y, at=(0, 0)):
    return at[0] + 20 * (x + y) * S2, at[1] + 10 * (y - x) * S2


def ground(d, s):
    """The grass layers tiled on the ground, seen by the diamond camera, at s device pixels a point."""
    g = json.loads((d / "ground/ground.json").read_text())
    lay = {L["id"]: L for L in g["layers"]}
    w, h = W * s, H * s
    X, Y = np.meshgrid((np.arange(w) + 0.5) / s, (np.arange(h) + 0.5) / s)
    a, b = X / (20 * S2), Y / (10 * S2)          # x + y, y - x (metres)
    mx, my = (a - b) / 2, (a + b) / 2

    def tile(name):
        L = lay[name]
        im = np.asarray(Image.open(d / "ground" / L["file"]).convert("RGB"), np.float32)
        n = im.shape[0]
        u = ((mx / L["tile_m"]) % 1.0) * n
        v = ((my / L["tile_m"]) % 1.0) * n
        u0, v0 = np.floor(u).astype(int), np.floor(v).astype(int)
        fu, fv = (u - u0)[..., None], (v - v0)[..., None]
        p = lambda i, j: im[j % n, i % n]       # noqa: E731
        return (p(u0, v0) * (1 - fu) * (1 - fv) + p(u0 + 1, v0) * fu * (1 - fv) + p(u0, v0 + 1) * (1 - fu) * fv + p(u0 + 1, v0 + 1) * fu * fv)
    k = 0.5 + 0.5 * np.sin(mx / 5.3 + 0.4 * np.sin(my / 3.1)) * np.sin(my / 4.7)
    col = tile("grass") * (1 - 0.55 * k[..., None]) + tile("grass_dry") * (0.55 * k[..., None])
    return Image.fromarray(np.clip(col, 0, 255).astype(np.uint8), "RGB")


def put(base, spr, x, y, s, flip=False):
    (im, ax, ay), sh = spr
    if flip:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
        ax = im.width - ax
    px, py = x * s, y * s
    if sh:
        si, sx, sy = sh
        if flip:
            si = si.transpose(Image.FLIP_LEFT_RIGHT)
            sx = si.width - sx
        a = np.zeros((base.height, base.width), np.float32)
        al = np.asarray(si.getchannel("A"), np.float32) / 255.0
        x0, y0 = round(px - sx), round(py - sy)
        xa, ya, xb, yb = max(0, x0), max(0, y0), min(base.width, x0 + si.width), min(base.height, y0 + si.height)
        if xa < xb and ya < yb:
            a[ya:yb, xa:xb] = al[ya - y0:yb - y0, xa - x0:xb - x0]
            g = np.asarray(base, np.float32) * (1 - a[..., None] * (1 - LIT))
            base.paste(Image.fromarray(g.astype(np.uint8), "RGB"))
    x0, y0 = round(px - ax), round(py - ay)
    cx, cy = max(0, -x0), max(0, -y0)
    if cx >= im.width or cy >= im.height:
        return
    rgba = base.convert("RGBA")
    rgba.alpha_composite(im.crop((cx, cy, im.width, im.height)), (max(0, x0), max(0, y0)))
    base.paste(rgba.convert("RGB"))


def scene(d, s):
    """The battlefield from the atlases in d (x3 or x2), s device pixels a point (3 or 2)."""
    base = ground(d, s)
    bld = S9.Atlas(d / "buildings/buildings_E.json")
    cas = S9.Atlas(d / "castle/castle_E.json")
    draws = []
    cell = cas.j["cell_m"]
    for p in cas.j["layouts"]["large"]["walls"]:
        x, y = screen(p["anchor"][0] * cell, p["anchor"][1] * cell, CASTLE)
        if -200 < x < W + 200 and -60 < y < H + 200:
            draws.append((y, cas.sprite(cas.j["pieces"][p["piece"]]["frames"]["intact"], "blue"), x, y, False))
    for name, (x, y) in BUILD:
        draws.append((y, bld.sprite(name, "blue"), x, y, False))
    units = {u: S9.Atlas(d / f"units/{u}/{u}.json") for u in {t[0] for t in TROOP}}
    for u, dx, dy in TROOP:
        a = units[u]
        nm, flip = S9.unit_frame(a, u, "idle", 6, 0)
        (im, ax, ay), _ = a.sprite(nm, "blue")
        draws.append((SQUAD[1] + dy, ((im, ax, ay), a._crop("shadow", nm)), SQUAD[0] + dx, SQUAD[1] + dy, flip))
    for _, spr, x, y, flip in sorted(draws, key=lambda t: t[0]):
        put(base, spr, x, y, s, flip)
    return base


def decoded(x3, astc_dir, astcenc, tmp):
    """A copy of the x3 atlases with every page the ASTC archive has replaced by its decoded, unpremultiplied texels."""
    out = tmp / "x3_astc"
    shutil.copytree(x3, out)
    for k in sorted(astc_dir.rglob("*.astc.ktx")):
        rel = k.relative_to(astc_dir)
        png = out / str(rel).replace(".astc.ktx", ".png")
        dec = tmp / "dec.png"
        subprocess.run([str(astcenc), "-dl", str(k), str(dec)], check=True, capture_output=True)
        a = np.asarray(Image.open(dec).convert("RGBA"), np.float32)
        al = a[..., 3:4]
        rgb = np.where(al > 0, np.clip(a[..., :3] * 255.0 / np.maximum(al, 1), 0, 255), 0)
        mode = Image.open(png).mode
        im = Image.fromarray(np.concatenate([rgb, al], -1).round().astype(np.uint8), "RGBA")
        (im.convert("LA") if mode == "LA" else im).save(png)
    return out


def main(x3, x2, astc_dir, astcenc, out):
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as t:
        x3a = decoded(x3, astc_dir, astcenc, Path(t))
        shots = {"x3 PNG": scene(x3, 3), "x3 ASTC 4×4": scene(x3a, 3)}
    shots["x2 PNG（放大 1.5 倍）"] = scene(x2, 2).resize((W * 3, H * 3), Image.BILINEAR)
    names = list(shots)
    mem = {"x3 PNG": "全部載入 773.4 MB", "x3 ASTC 4×4": "全部載入 193.3 MB＋地面 7.9 MB", "x2 PNG（放大 1.5 倍）": "全部載入 350.7 MB"}
    gap = 24
    # the phone's real size: one pixel a point
    row = Image.new("RGB", (3 * W + 2 * gap, H + 40), B9.BG)
    d = ImageDraw.Draw(row)
    for i, n in enumerate(names):
        row.paste(shots[n].resize((W, H), Image.LANCZOS), (i * (W + gap), 40))
        d.text((i * (W + gap), 4), f"{n}：{mem[n]}", font=B9.font(24), fill=B9.INK)
    rows = [("手機實際大小（一點一個像素）", row)]
    for cap, (cx, cy, cw, ch) in CROPS:
        z = 2
        tile = Image.new("RGB", (3 * cw * 3 * z + 2 * gap, ch * 3 * z + 40), B9.BG)
        dd = ImageDraw.Draw(tile)
        for i, n in enumerate(names):
            c = shots[n].crop((cx * 3, cy * 3, (cx + cw) * 3, (cy + ch) * 3)).resize((cw * 3 * z, ch * 3 * z), Image.NEAREST)
            tile.paste(c, (i * (cw * 3 * z + gap), 40))
            dd.text((i * (cw * 3 * z + gap), 4), n, font=B9.font(24), fill=B9.INK)
        rows.append((f"放大：{cap}（手機的像素放大 2 倍）", tile))
    note = ("art-v7.1 的畫質比較（ceo 2026-11-05：iPhone 把 PNG 解成 RGBA，現在約 450 MB 就意外結束兩次，art-v7 x3 要 773 MB）。"
            "同一個戰場（主城、城牆、兵、哨所），照手機的畫法組：x3 是一個圖點對一個手機像素；ASTC 是同一批 x3 頁壓成 ASTC 4×4"
            "（預乘 alpha）再解回來；x2 是 2 倍的頁被手機放大 1.5 倍。地面三格都是 PNG（art-v7.1 地面不壓）。"
            "第一列是手機實際大小，下面三列是同一塊放大（手機的像素放大 2 倍）。")
    B9.board("V7A-01-畫質比較-x3PNG-x3ASTC-x2PNG-phone", note, rows, out)
    full = [(f"{n}：{mem[n]}（手機的像素，一個點 3 個像素）", shots[n]) for n in names]
    B9.board("V7A-02-畫質比較-手機像素-phone", note, full, out)
    print("boards in", out)


if __name__ == "__main__":
    a = sys.argv
    main(Path(a[1]), Path(a[2]), Path(a[3]), Path(a[4]), Path(a[5]))
