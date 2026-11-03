"""art-v7's edge/ folder (design/r11/edge-format.md, agreed with war-game-client 2026-11-04): x3 and x2, edge.json.

- cliff_<sw|se>_<k>.png, corner_<left|bottom|right>.png: the render_b1 pieces of target r8v7e (design/r11/blender/
  edge_v7.py), the AO as atlas_b1 takes it, cut to what they cover; anchor (the slot's middle, or the map's corner, on
  the map's edge line at ground height) and lip (the slot's two ends on that line) in the picture's pixels.
- island_<k>.png: the pieces of target r8v7i; anchor = the island's foot (the lowest point it shows).
- clouds_far.png, clouds_near.png: design/r11/common/clouds_v7.py.
- fall_loop.png, fall_spray.png, fall_mouth.png, puff_<k>.png: drawn here (R11's waterfall and puffs, production).

python3 design/r11/common/edge_pack.py RENDERS OUT_ROOT [--scale 3|2|both]
  RENDERS: a folder holding the pieces (<name>_x3_beauty.png, _x3_ao.png, _x3.json; searched below it);
  writes OUT_ROOT/atlas_x<k>/edge/ (edge.json, the pictures, memory.json).
"""
import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import clouds_v7 as CL      # noqa: E402

PPM3 = 60                         # px a metre at 3x (as the units and the buildings)
S2 = math.sqrt(0.5)
COS30 = math.sqrt(3) / 2
SLOT = 16.0
CLIFFS = [(e, k) for e in ("sw", "se") for k in range(3)]
CORNERS = ("left", "bottom", "right")
ISLANDS = 4


def to_px(x, y, z=0.0, ppm=PPM3):
    """Map metres (x east, y north, z up) to the diamond screen's pixels (x right, y down) from the origin."""
    return ppm * (x - y) * S2, ppm * (-0.5 * (x + y) * S2 - COS30 * z)


def _lin(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def _srgb(lin):
    lin = np.clip(lin, 0, 1)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)


def _rgba(lin, a):
    """Straight-alpha RGBA uint8 from linear colour and alpha."""
    return np.dstack([(_srgb(lin) * 255 + 0.5).astype(np.uint8), (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)])


# ---------------------------------------------------------------- the rendered pieces

def _find(src, name):
    got = sorted(src.rglob(f"{name}_x3.json"))
    if len(got) != 1:
        raise SystemExit(f"{src}: {len(got)} renders of {name}")
    return got[0].parent


def piece(src, name):
    """(RGBA uint8 at 3x cut to its cover, anchor px in it): the beauty pass, the AO as atlas_b1 takes it."""
    d = _find(src, name)
    meta = json.loads((d / f"{name}_x3.json").read_text())
    if meta["px_per_m"] != PPM3 or abs(meta["camera"]["elev"] - 30) > 1e-6 or abs(meta["camera"]["az"] + 45) > 1e-6:
        raise SystemExit(f"{name}: px_per_m {meta['px_per_m']}, camera {meta['camera']} (want 60, diamond)")
    c = np.asarray(Image.open(d / f"{name}_x3_beauty.png").convert("RGBA"), np.float32).copy()
    ao = d / f"{name}_x3_ao.png"
    if ao.exists():
        c[..., :3] *= (0.7 + 0.3 * np.asarray(Image.open(ao).convert("L"), np.float32) / 255.0)[..., None]
    img = Image.fromarray(np.clip(c, 0, 255).astype(np.uint8), "RGBA")
    box = img.getchannel("A").point(lambda v: 255 if v > 2 else 0).getbbox()
    ax, ay = meta["anchor"]
    return img.crop(box), (ax - box[0], ay - box[1]), meta


# ---------------------------------------------------------------- the waterfall

def _fft(shape, beta, seed, stretch=(1.0, 1.0)):
    """Noise 0..1 periodic on both axes (rows, cols)."""
    rng = np.random.default_rng(seed)
    F = np.fft.fft2(rng.standard_normal(shape))
    ky = np.fft.fftfreq(shape[0])[:, None] * stretch[0]
    kx = np.fft.fftfreq(shape[1])[None, :] * stretch[1]
    k = np.hypot(kx, ky)
    k[0, 0] = 1.0
    a = np.real(np.fft.ifft2(F * k ** (-beta / 2)))
    return ((a - a.min()) / (a.max() - a.min())).astype(np.float32)


FALL_W_M, FALL_PERIOD = 6.0, 512


def fall_loop(ppm=PPM3):
    """The falling water, seamless top to bottom (FALL_PERIOD px at 3x): the river's 6 m across the lip as the screen
    sees it (cos 45 of it), white streaks long down the fall over a thinner grey-blue body, the sides breaking into
    streamers (a margin of a quarter the width each side). Lit from the left. (rgba, body columns x0..x1)"""
    body = int(round(FALL_W_M * S2 * ppm))
    m = body // 4
    W, Hh = body + 2 * m, FALL_PERIOD * ppm // PPM3
    yy, xx = np.mgrid[0:Hh, 0:W].astype(np.float32)
    u = (xx - m) / body                                         # 0..1 across the river
    st = _fft((Hh, W), 2.2, 43, stretch=(9.0, 1.0))             # long down the fall
    st2 = _fft((Hh, W), 2.8, 47, stretch=(5.0, 1.0))
    s = np.clip((0.6 * st + 0.4 * st2 - 0.5) * 1.6 + 0.5, 0, 1)
    ragn = _fft((Hh, W), 2.4, 53, stretch=(4.0, 1.0))
    cu = np.abs(u - 0.5) * 2                                     # 0 middle, 1 at the river's sides
    edge = np.clip((1.0 + 0.3 * (ragn - 0.5) - cu) / 0.1, 0, 1)
    threads = np.clip((s - 0.45) * 3.5, 0, 1) * np.clip((1.5 - cu) / 0.5, 0, 1)    # past the sides: threads only
    a = np.maximum(edge * (0.82 + 0.18 * s), threads * 0.9)
    side = 1 - 0.25 * np.clip(u, 0, 1)                          # lit from the left
    white = np.array([0.95, 0.96, 0.97])
    thin = np.array([0.42, 0.5, 0.56])
    k = np.clip((s - 0.25) * 1.8, 0, 1)[..., None]
    col = (thin * (1 - k) + white * k) * side[..., None]
    return _rgba(col, a), (m, m + body)


def fall_spray(ppm=PPM3):
    """The mist at the fall's foot: a soft plume wider than the fall, billowing up and thinning; anchor its top middle
    (where the falling water meets it)."""
    W, Hh = int(16 * ppm), int(9 * ppm)
    yy, xx = np.mgrid[0:Hh, 0:W].astype(np.float32)
    u = (xx - W / 2) / (W / 2)
    v = yy / Hh
    n = 0.75 * _fft((Hh, W), 4.2, 61) + 0.25 * _fft((Hh, W), 3.4, 63)      # soft billows, no speckle
    shape = np.exp(-(u / (0.22 + 0.5 * v)) ** 2 * 1.4) * np.exp(-((v - 0.4) / 0.32) ** 2)
    dens = np.clip(shape * (0.15 + 1.0 * n), 0, 1) ** 1.3
    lit = 0.9 + 0.12 * np.clip(1 - v * 1.4, 0, 1)                  # its top a little brighter
    col = np.array([0.9, 0.93, 0.96])[None, None] * lit[..., None]
    return _rgba(col, dens * 0.8), (W // 2, int(0.08 * Hh))


def fall_mouth(edge="sw", ppm=PPM3, foam_m=3.5):
    """The river's last metres on the cliff top and its brink: the water from 1.5 m inside the map (under the client's
    ground, which fades over the last 0.75 m) to the lip, white water growing toward it, the wet dark rock each side,
    the glassy tongue curving over. Each screen pixel taken back to the surface (the tongue never hides itself).
    Anchor: the river's middle on the map's edge line. edge: which edge the river leaves by (sw: west, se: south)."""
    ss = 2
    p = ppm * ss
    half = FALL_W_M / 2
    bt = np.linspace(-3.6, 1.4, 4000)                             # b: along the flow, metres past the map's edge
    zt = -(np.clip(bt / 1.3, 0, 1) ** 1.7) * 1.3                  # the tongue curving down
    ft = S2 * bt - COS30 * zt
    corners = [to_px(*((-b, a) if edge == "sw" else (a, -b)), z, p)
               for a in (-5.0, 5.0) for b, z in ((-3.6, 0.0), (1.4, -1.3))]
    x0 = math.floor(min(c[0] for c in corners)) - 2
    y0 = math.floor(min(c[1] for c in corners)) - 2
    x1 = math.ceil(max(c[0] for c in corners)) + 2
    y1 = math.ceil(max(c[1] for c in corners)) + 2
    x1, y1 = x0 + (x1 - x0) // ss * ss, y0 + (y1 - y0) // ss * ss
    SY, SX = np.mgrid[y0:y1, x0:x1].astype(np.float64) + 0.5
    c = (-SX if edge == "sw" else SX) / (p * S2)                  # a + b
    rhs = SY / p + 0.5 * S2 * c
    B = np.interp(-rhs, -ft[::-1], bt[::-1]) if ft[0] > ft[-1] else np.interp(rhs, ft, bt)
    A = c - B
    inside = (B >= bt[0]) & (B <= bt[-1]) & (np.abs(A) <= 5.0) & (rhs >= ft.min()) & (rhs <= ft.max())
    over = np.clip(B / 1.3, 0, 1)
    n = _fft((512, 512), 2.6, 71)
    def tex(t, a, b, sa, sb):                                     # bilinear, wrapping (nearest drew a mosaic)
        x, y = a * sa, b * sb
        x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
        fx, fy = x - x0, y - y0
        g = lambda j, i: t[j % 512, i % 512]                     # noqa: E731
        return (g(y0, x0) * (1 - fx) + g(y0, x0 + 1) * fx) * (1 - fy) + (g(y0 + 1, x0) * (1 - fx) + g(y0 + 1, x0 + 1) * fx) * fy
    side = (np.abs(A) - half) / 0.6
    river = np.clip(0.5 - side - 0.6 * (tex(n, A, B, 40, 40) - 0.5), 0, 1)
    streak = tex(_fft((512, 512), 2.0, 73, stretch=(1.0, 6.0)), A, B, 60, 25)
    # white water only where the river speeds up for the drop: threads from foam_m out, thick over the last metre
    ramp = np.clip((B + foam_m) / foam_m, 0, 1) ** 3
    foam = np.clip((streak - 0.62 + 0.55 * ramp) * 2.5, 0, 1) * ramp
    white_over = np.clip((B - 0.35) / 0.6, 0, 1)                 # the tongue: glassy where it bends, white below
    foam = np.clip(foam * (1 - 0.6 * np.clip(B / 0.35, 0, 1) * (1 - white_over)) + 0.75 * white_over * (0.55 + 0.7 * (streak - 0.5)), 0, 1)
    water = np.array([0.045, 0.07, 0.08]) + np.array([0.18, 0.24, 0.3]) * 0.25
    glass = np.exp(-((B - 0.15) / 0.18) ** 2)[..., None]          # a band of sky on the smooth brink
    wc = water * (1 - glass) + np.array([0.3, 0.38, 0.45]) * glass
    col = wc * (1 - foam[..., None]) + np.array([0.9, 0.92, 0.94]) * foam[..., None]
    wet = np.clip(1 - np.abs(side - 0.7) / 1.2, 0, 1) * np.clip((B + 1.5) / 1.0, 0, 1) * (B <= 0.05)
    rockc = np.array([0.05, 0.045, 0.04])
    al_r = river * np.clip((B + 3.6) / 0.8, 0, 1)
    al_w = 0.75 * wet * (1 - al_r)
    al = (al_r + al_w) * inside
    col = (col * al_r[..., None] + rockc * al_w[..., None]) / np.maximum(al_r + al_w, 1e-6)[..., None]
    h, w = al.shape
    al = al.reshape(h // ss, ss, w // ss, ss).mean((1, 3))
    col = col.reshape(h // ss, ss, w // ss, ss, 3).mean((1, 3))
    return _rgba(col, al), (-x0 / ss, -y0 / ss)


def puff(seed, w, h):
    """A loose cloud passing over everything: soft all round, its billows lit from the upper left."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    r = np.hypot((xx - w / 2) / (w / 2), (yy - h / 2) / (h / 2))
    n = 0.55 * _fft((h, w), 3.0, seed) + 0.45 * _fft((h, w), 2.2, seed + 1)
    blobs = np.zeros((h, w), np.float32)
    for _ in range(14):
        cx, cy = rng.uniform(0.2, 0.8) * w, rng.uniform(0.3, 0.7) * h
        rr = rng.uniform(0.12, 0.28) * w
        blobs = np.maximum(blobs, np.clip(1 - ((xx - cx) ** 2 + ((yy - cy) * 1.6) ** 2) / rr ** 2, 0, 1) ** 0.7)
    dens = np.clip(blobs * np.exp(-r ** 4 * 1.5) * (0.5 + 0.9 * (n - 0.3)), 0, 1)
    gx = np.gradient(dens, axis=1)
    gy = np.gradient(dens, axis=0)
    lit = np.clip(1.0 - 25.0 * (gx * 0.6 + gy * 0.8), 0.78, 1.1)
    col = np.array([0.96, 0.96, 0.97])[None, None] * lit[..., None]
    return _rgba(col, dens)


ISLE_K = 0.28                     # far off: the island drawn at this of the map's scale (R11: 0.22, trees a soldier high)


def haze(img, k=0.45, blue=(0.56, 0.64, 0.78)):
    """An island far off in the haze: its colour toward the sky's, its foot lost in the mist below it."""
    a = np.asarray(img, np.float32) / 255.0
    lin = _lin(a[..., :3]) * (1 - k) + np.array(blue) * k
    y = np.arange(a.shape[0], dtype=np.float32)[:, None] / a.shape[0]
    al = a[..., 3] * (1 - 0.8 * np.clip((y - 0.6) / 0.4, 0, 1))
    return Image.fromarray(_rgba(lin, al), "RGBA")


PUFFS = [(81, 620, 260, (8, -2), 0.6), (83, 480, 210, (10, -3), 0.55), (85, 760, 300, (6, -1), 0.5),
         (87, 420, 180, (12, -2), 0.6)]


# ---------------------------------------------------------------- the folder

def _save(img, path):
    Image.fromarray(img) if isinstance(img, np.ndarray) else img
    (Image.fromarray(img) if isinstance(img, np.ndarray) else img).save(path, optimize=True)


def _scale(img, f):
    """An RGBA picture at f of its size, premultiplied while resized (no dark fringe at the edges)."""
    if f == 1:
        return img
    a = np.asarray(img, np.float32)
    pm = a.copy()
    pm[..., :3] *= a[..., 3:] / 255.0
    size = (max(1, round(img.width * f)), max(1, round(img.height * f)))
    ch = [np.asarray(Image.fromarray(pm[..., k]).resize(size, Image.LANCZOS)) for k in range(4)]
    al = np.clip(ch[3], 0, 255)
    rgb = np.stack(ch[:3], -1) / np.maximum(al[..., None] / 255.0, 1e-3)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), al]).astype(np.uint8), "RGBA")


def build(src, out_root, scales=(3, 2), clouds_cache=None):
    pieces = {}
    for e, k in CLIFFS:
        pieces[f"cliff_{e}_{k}"] = piece(src, f"cliff_{e}_{k}")
    for w in CORNERS:
        pieces[f"corner_{w}"] = piece(src, f"corner_{w}")
    isles = []
    for k in range(ISLANDS):
        img, anc, meta = piece(src, f"island_{k}")
        img = haze(_scale(img, ISLE_K))
        a = np.asarray(img)[..., 3]
        rows = np.nonzero((a > 40).any(1))[0]
        yb = int(rows[-1])
        xs = np.nonzero(a[yb] > 40)[0]
        isles.append((img, (float(xs.mean()), float(yb)), meta))
    cache = Path(clouds_cache) if clouds_cache else None
    if cache and (cache / "clouds_far.png").exists():
        far = np.asarray(Image.open(cache / "clouds_far.png").convert("RGB"))
        near = np.asarray(Image.open(cache / "clouds_near.png").convert("RGBA"))
    else:
        far, near = CL.far(1024), CL.near(1024)
        if cache:
            cache.mkdir(parents=True, exist_ok=True)
            Image.fromarray(far).save(cache / "clouds_far.png")
            Image.fromarray(near, "RGBA").save(cache / "clouds_near.png")
    loop, (bx0, bx1) = fall_loop()
    spray, spray_a = fall_spray()
    mouths = {e: fall_mouth(e) for e in ("sw", "se")}
    puffs = [puff(sd, w, h) for sd, w, h, _, _ in PUFFS]
    for sc in scales:
        f = sc / 3.0
        d = Path(out_root) / f"atlas_x{sc}" / "edge"
        d.mkdir(parents=True, exist_ok=True)
        for p in d.iterdir():
            p.unlink()
        files = {}

        def put(name, img):
            img = img if isinstance(img, Image.Image) else Image.fromarray(img)
            img = img if f == 1 else (_scale(img, f) if img.mode == "RGBA" else img.resize(
                (round(img.width * f), round(img.height * f)), Image.LANCZOS))
            img.save(d / name, optimize=True)
            files[name] = img.size
            return img.size

        def px(p):
            return [round(p[0] * f, 1), round(p[1] * f, 1)]
        # where the pieces go (edge_v7.py): from the bottom corner along each seen edge, stretch k's middle at 16 k m
        # (k = 1 .. (edge - 18) / 16: 1..15 on a 129-cell map), the bottom corner's legs 8 m, the far corners' 10 m
        cliff = {"height_m": 13, "stretch_m": SLOT, "overlap_m": 1, "from": "bottom", "corner_leg_m":
                 {"bottom": 8, "left": 10, "right": 10}, "edge_m": 258, "sw": [], "se": [], "corner": {}}
        for e, k in CLIFFS:
            img, (ax, ay), _ = pieces[f"cliff_{e}_{k}"]
            name = f"cliff_{e}_{k}.png"
            put(name, img)
            ends = [(0.0, -8.0), (0.0, 8.0)] if e == "sw" else [(-8.0, 0.0), (8.0, 0.0)]
            lip = [px((ax + to_px(x, y)[0], ay + to_px(x, y)[1])) for x, y in ends]
            cliff[e].append({"file": name, "anchor": px((ax, ay)), "lip": lip})
        for w in CORNERS:
            img, (ax, ay), _ = pieces[f"corner_{w}"]
            name = f"corner_{w}.png"
            put(name, img)
            cliff["corner"][w] = {"file": name, "anchor": px((ax, ay))}
        islands = []
        for k, (img, (ax, ay), meta) in enumerate(isles):
            name = f"island_{k}.png"
            put(name, img)
            islands.append({"file": name, "anchor": px((ax, ay)), "size_m": round(img.width / PPM3, 2),
                            "bob_px": round(3 * f, 1), "bob_s": 5 + k})
        if sc == 3:
            fa, na = far, near
        else:
            n2 = round(1024 * f)
            fa, na = CL.scaled_tile(far, n2), CL.scaled_tile(near, n2)
        Image.fromarray(fa).save(d / "clouds_far.png", optimize=True)
        Image.fromarray(na, "RGBA").save(d / "clouds_near.png", optimize=True)
        files["clouds_far.png"], files["clouds_near.png"] = fa.shape[1::-1], na.shape[1::-1]
        lw, lh = put("fall_loop.png", loop)
        put("fall_spray.png", spray)
        mouth = {}
        for e, (img, anc) in mouths.items():
            name = "fall_mouth.png" if e == "sw" else "fall_mouth_se.png"
            put(name, img)
            mouth[e] = (name, px(anc))
        pf = []
        for k, (img, (_, _, _, drift, amax)) in enumerate(zip(puffs, PUFFS)):
            name = f"puff_{k}.png"
            put(name, img)
            pf.append({"file": name, "drift_px_s": [round(v * f, 2) for v in drift], "alpha_max": amax})
        ej = {
            "format": "war-game edge 1", "view": "diamond", "scale": float(sc), "pxPerM": round(PPM3 * f, 3),
            "clouds": {
                "far": {"file": "clouds_far.png", "alpha": False, "tile_px": files["clouds_far.png"][0], "parallax": 0.2,
                        "drift_px_s": [round(6 * f, 2), round(2 * f, 2)], "fade_s": 12},
                "near": {"file": "clouds_near.png", "alpha": True, "tile_px": files["clouds_near.png"][0], "parallax": 0.35,
                         "drift_px_s": [round(10 * f, 2), round(3 * f, 2)], "fade_s": 9}},
            "islands": islands,
            "cliff": cliff,
            "fall": {
                "loop": {"file": "fall_loop.png", "width_m": FALL_W_M, "body_px": [round(bx0 * f, 1), round(bx1 * f, 1)],
                         "period_px": lh, "scroll_m_s": 4.0, "widen_per_m": 0.07},
                "spray": {"file": "fall_spray.png", "anchor": px(spray_a)},
                "mouth": {"file": mouth["sw"][0], "anchor": mouth["sw"][1], "foam_m": 3.5,
                          "se": {"file": mouth["se"][0], "anchor": mouth["se"][1]}}},
            "puffs": pf,
            "rim": {"fade_m": 3},
        }
        (d / "edge.json").write_text(json.dumps(ej, ensure_ascii=False, indent=1) + "\n")
        rgba = sum(w * h * 4 for w, h in files.values())
        (d / "memory.json").write_text(json.dumps({"total_rgba8_bytes": rgba, "total_astc_4x4_bytes": rgba // 4,
                                                   "files": {k: list(v) for k, v in sorted(files.items())}}, indent=1) + "\n")
        print(f"edge x{sc}: {len(files)} pictures, {rgba / 2 ** 20:.1f} MB RGBA8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("renders", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--scale", default="both")
    ap.add_argument("--clouds-cache")
    a = ap.parse_args()
    build(a.renders, a.out, (3, 2) if a.scale == "both" else (int(a.scale),), a.clouds_cache)


if __name__ == "__main__":
    main()
