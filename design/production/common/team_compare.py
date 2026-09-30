"""Player colour: R5's approved recolouring next to the client's multiply compositing.

python3 common/team_compare.py
-> build/prod/team_compare_1x.png, team_compare_3x.png

Columns per unit and team colour:
  R5       compose.recolor (the look the user approved: the grey is mapped to the player colour,
           lit parts drift toward white)
  client   colour layer, then the team layer tinted with the player colour (a multiply)
  x1.6     the same, with the team layer brightened by 1 / 0.62 (the postprocess default), clipped at white
Uses whatever renders are in build/prod/<unit>/raw (facing 7, first idle frame).
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(1, str(HERE.parents[1] / "round1" / "common"))
import compose     # noqa: E402
import config      # noqa: E402
import postprocess  # noqa: E402

UNITS = ["spear_e", "farmer_e", "hcav_e", "mage_w"]
# the four player colours are not decided yet; blue and red are the R1-R5 ones, yellow and near-white
# are the hard cases for a brightened layer (they clip first)
TEAMS = {"blue": config.TEAM["blue"], "red": config.TEAM["red"], "yellow": (232, 190, 40),
         "white": (236, 234, 226)}
GROUND = (118, 128, 104)


def r5(raw, base, team):
    c = postprocess._colour(raw, base)
    return compose.recolor(c, Image.open(raw / f"{base}_x3_mask.png"), team)


def client(raw, base, team, gain):
    c = postprocess._colour(raw, base)
    t = postprocess._team(raw, base, c, gain)
    ca = np.asarray(c, np.float32)
    ta = np.asarray(t, np.float32)
    tint = ta[..., :3] * (np.asarray(team, np.float32) / 255.0)
    m = (ta[..., 3] / 255.0) / np.maximum(ca[..., 3] / 255.0, 1e-6)      # over an opaque-ish colour pixel
    m = np.clip(m, 0, 1)[..., None]
    out = ca.copy()
    out[..., :3] = ca[..., :3] * (1 - m) + tint * m
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")


def board(scale_px_per_pt, path):
    cols = [("R5", lambda raw, b, t: r5(raw, b, t)), ("client", lambda raw, b, t: client(raw, b, t, 1.0)),
            ("x1.6", lambda raw, b, t: client(raw, b, t, 1 / 0.62))]
    tiles = []
    for u in UNITS:
        raw = config.BUILD / "prod" / u / "raw"
        base = f"{u}_idle_f7_00"
        if not (raw / f"{base}_x3_beauty.png").exists():
            continue
        row = []
        for tname, team in TEAMS.items():
            for cname, fn in cols:
                im = fn(raw, base, team)
                bb = im.getchannel("A").getbbox()
                im = im.crop(bb)
                f = scale_px_per_pt / 3
                if f != 1:
                    im = im.resize((max(1, round(im.width * f)), max(1, round(im.height * f))), Image.LANCZOS)
                row.append((f"{tname} {cname}", im))
        tiles.append((u, row))
    cw = max(im.width for _, row in tiles for _, im in row) + (16 if scale_px_per_pt > 1 else 6)
    ch = max(im.height for _, row in tiles for _, im in row) + (16 if scale_px_per_pt > 1 else 6)
    lab = 30 if scale_px_per_pt > 1 else 0
    W, H = cw * len(tiles[0][1]), (ch + lab) * len(tiles) + (30 if scale_px_per_pt > 1 else 0)
    sheet = Image.new("RGB", (W, H), GROUND)
    dr = ImageDraw.Draw(sheet)
    if scale_px_per_pt > 1:
        for k, (name, _) in enumerate(tiles[0][1]):
            dr.text((k * cw + 4, 6), name, fill=(250, 248, 240))
    for r, (u, row) in enumerate(tiles):
        y = (30 if scale_px_per_pt > 1 else 0) + r * (ch + lab)
        for k, (_, im) in enumerate(row):
            sheet.paste(im.convert("RGB"), (k * cw + (cw - im.width) // 2, y + lab + (ch - im.height) // 2), im)
        if scale_px_per_pt > 1:
            dr.text((4, y + 4), u, fill=(250, 248, 240))
    sheet.save(path)
    print("wrote", path, sheet.size)


if __name__ == "__main__":
    out = config.BUILD / "prod"
    board(1, out / "team_compare_1x.png")
    board(3, out / "team_compare_3x.png")
