"""R11-06 (the user 2026-11-02: 「1方案好，我覺得邊邊可以加個瀑布動畫，感覺像是再一個浮空大陸上的感覺」): the floating
continent's edge as render_b1 pieces on the diamond camera. The map's west edge (seen at the lower left of the diamond
screen) is a wall hanging below the ground's edge; its origin is a point of the edge line on the ground (z 0), the wall
runs along y (L metres) and drops H metres; the composer (design/r11/common/edge_r11.py) puts the clouds behind it, the
waterfall over it and the ground above it.

- A 岩壁: a rock face in strata from R8's photo-scanned rock (terrain_r8.field, Poly Haven CC0), harder beds standing
  out as ledges, a thin soil cap with grass tufts at the lip, the face going down near-vertical, then drawn in under.
- B 捲邊: a thick soil lip rounded out over the void, grass hanging over it, roots hanging below, clods falling; under it
  the rock recedes steeply (the underside of a floating island).
- isle (for C): a small floating island far off: a grass top, a rocky cone under it, two or three trees.
"""
import math
import random

import bmesh
import bpy
import numpy as np

import lib
import nature_r8
import terrain_r8 as T


def _tri(x):
    """A triangle wave 0..1..0 of period 2 (mirrors the scan strip back and forth: no seam)."""
    return 1.0 - np.abs(np.mod(x, 2.0) - 1.0)


def _n1(x, seed, cells=1.0):
    """Smooth 1-D value noise 0..1 (cubic between random lattice values)."""
    rng = np.random.default_rng(seed)
    lat = rng.random(4096)
    xi = np.floor(x / cells).astype(int)
    t = x / cells - xi
    t = t * t * (3 - 2 * t)
    return lat[xi % 4096] * (1 - t) + lat[(xi + 1) % 4096] * t


def _lin(rgb):
    return np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)


def _srgb(lin):
    lin = np.clip(lin, 0, 1)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)


SOIL = np.array([0.055, 0.04, 0.025])      # linear: the dark topsoil at the lip
SOIL_B = np.array([0.075, 0.052, 0.03])    # B's thick soil, a little lighter, with root threads


def headland(s):
    """How far (metres) the land runs out past the map's edge at s along it: headlands and bays every 15-30 m, never
    into the map (R11 r1: a coastline that is one straight 45-degree line read as a cake slice); none by the waterfall.
    The same formula in r11/blender/edge_r11.py and r11/common/edge_scene_r11.py."""
    # (R11 r2: two right-angle steps; the references push the coast in and out 80-250 px every 200-400 px at 3x)
    w = 1.0 + 2.0 * np.sin(0.4 * s + 0.7) + 0.9 * np.sin(0.93 * s + 2.1) + 0.25 * np.sin(2.1 * s + 0.4)   # r3: 2.6/0.62 too jagged
    a = np.clip((np.abs(s) - 3.0) / 3.0, 0, 1)
    return np.clip(w, 0, None) * a * a * (3 - 2 * a)


def _wall_fields(style, s, d, H, gap):
    """Relief (metres out of the face, toward -x) and colour (linear) of the wall at (s along it, d down)."""
    F = T.field(T.SID)
    band = np.floor(d / 4.6)
    fx = T.FX_LO + _tri((s + band * 1.7) / 4.0) * (T.FX_HI - T.FX_LO - 0.05)
    fz = 0.15 + _tri(d / 4.6) * 4.6
    out, rgb = T._sample(F, fx, fz)
    lin = _lin(rgb)
    # strata: beds 0.5-1.6 m, dipping gently along the wall; the harder ones stand out a little and are paler
    dd = d + 0.35 * np.sin(s * 0.11 + 1.3) + 0.15 * np.sin(s * 0.37)
    hard = T._smooth(0.5, 0.68, _n1(dd, 21, 0.9))
    lin = lin * (0.82 + 0.26 * hard)[..., None] * np.array([1.0, 0.97, 0.92])
    out = out + 0.22 * hard * (style in ("A", "C"))
    # the soil cap and, for B, the thick soil lip
    cap = 1.4 if style == "B" else 0.35
    soil_k = T._smooth(cap + 0.15, cap - 0.1, d)[..., None]
    thread = _n1(s * 3.1 + d * 7.0, 33, 0.3)[..., None]
    soil = (SOIL_B * (0.8 + 0.4 * thread) if style == "B" else SOIL)
    lin = lin * (1 - soil_k) + soil * soil_k
    # where the river goes over: wet, dark, a little smoother
    if gap is not None:
        wet = (T._smooth(gap[0] - 0.6, gap[0] + 0.3, s) * T._smooth(gap[1] + 0.6, gap[1] - 0.3, s))[..., None]
        lin = lin * (1 - 0.55 * wet)
    # deeper down the face is in the mist: a little bluer and paler (the clouds' own haze is drawn over it later)
    haze = T._smooth(H * 0.45, H, d)[..., None]
    lin = lin * (1 - 0.35 * haze) + np.array([0.32, 0.36, 0.42]) * 0.35 * haze
    return out, lin


def wall(root, style="A", s0=-24.0, s1=24.0, H=13.0, gap=(-3.0, 3.0), seed=3):
    """The edge wall facing -x, the stretch y s0..s1 of one long wall (s along it, 0 its middle), z 0 down to -H; the
    piece's origin is the stretch's own middle (render_b1 frames every piece round its origin: a far stretch on the
    wall's middle went over the memory cap), so stretches placed at their middles meet with no seam.
    gap: the waterfall's stretch (s metres)."""
    L = s1 - s0
    mid = (s0 + s1) / 2
    ds, dz = 0.16, 0.13                       # (0.12 went over the 1.5 GB cap on some stretches)
    s = np.arange(s0, s1 + ds * 0.5, ds)
    d = np.arange(0.0, H + dz * 0.5, dz)
    S, D = np.meshgrid(s, d)
    out, _ = _wall_fields(style, S, D, H, gap)
    if style in ("A", "C"):
        # near-vertical, a few metres of slope at the top, then drawn in under the island
        inward = 0.05 * D + 0.8 * T._smooth(H * 0.55, H, D) * (D - H * 0.55)
        lip = np.zeros_like(D)
    else:
        # the soil lip rounded out over the void, then the underside receding steeply
        lip = 0.6 * np.sin(np.pi * np.clip(D / 1.4, 0, 1)) ** 0.7 * (D < 1.4)
        inward = 0.9 * np.clip((D - 1.2) / (H - 1.2), 0, 1) ** 1.5 * H * 0.45
    wob = 0.6 * (_n1(S, seed, 9.0) - 0.5) + 0.25 * (_n1(S, seed + 1, 3.0) - 0.5)
    X = -(out * 1.1 + lip) + inward + wob * (D > 0.05) - headland(S)      # 1.4 folded the mesh into shards (R11 r2)
    pos = np.stack([X, S - mid, -D], -1)
    uv = np.stack([(S - s0) / L, 1.0 - D / H], -1)
    # the colour on a finer grid (3 cm), as an image, rows from the bottom
    fs = np.arange(s0, s1, 0.04)
    fd = np.arange(H, 0.0, -0.04)
    FS, FD = np.meshgrid(fs, fd)
    _, lin = _wall_fields(style, FS, FD, H, gap)
    img = T._image(f"edge_{style}_skin{s0:.0f}", _srgb(lin)[::-1].copy())
    m = T._skin_mat(f"edge_{style}_mat", img)
    ob = T._grid_obj(f"edge_{style}_wall", pos, uv, m, root, outward=(-1, 0, 0))
    ob["no_bevel"] = True
    P = T.mats()
    rnd = random.Random(seed + int(s0 * 10))
    # grass at the lip: A a sparse fringe, B a heavy one hanging down over the curl
    n_tufts = int((140 if style == "A" else 320) * L / 48)     # C: A's rock with B's grass over the lip (R11 r1)
    for k in range(n_tufts):
        y = rnd.uniform(s0, s1)
        if gap is not None and gap[0] - 0.5 < y < gap[1] + 0.5:
            continue
        x0 = float(np.interp(y, s, X[min(2, len(d) - 1)])) - 0.02
        t = T._tuft(f"edge_tuft{k}", P, root, (x0, y - mid, -0.02), rnd, dry=rnd.random() < 0.35)
        if style in ("B", "C"):
            t.rotation_euler = (rnd.uniform(-0.3, 0.3), -rnd.uniform(1.9, 2.6), rnd.uniform(0, 6.28))
            t.location = (x0 - (0.45 if style == "B" else 0.06), y - mid, -0.25 if style == "B" else -0.05)
            t.scale = (1.6, 1.6, 1.8)
        else:
            t.rotation_euler = (0.0, -rnd.uniform(0.3, 0.9), rnd.uniform(0, 6.28))
    if style == "B":
        _roots(root, rnd, s0, s1, s, X, d, gap, mid)
        for k in range(5):                            # clods falling away below the lip
            y = rnd.uniform(s0 + 1, s1 - 1)
            T._rock(f"edge_clod{k}", rnd.uniform(0.08, 0.22), P["dark"], root,
                    (rnd.uniform(-1.6, -0.7), y - mid, -rnd.uniform(2.5, 7.0)), rnd)
    return ob


def _roots(root, rnd, s0, s1, s, X, d, gap, mid=0.0):
    """Roots hanging from under the soil lip: thin tubes swaying down, a few branching."""
    m = lib.mat("edge_root", (0.06, 0.042, 0.028), 0.85)
    bm = bmesh.new()
    seg, ring = 14, 5
    for k in range(int(110 * (s1 - s0) / 48)):
        y = rnd.uniform(s0, s1)
        if gap is not None and gap[0] - 0.5 < y < gap[1] + 0.5:
            continue
        j = int(np.searchsorted(d, 1.25))
        x0 = float(np.interp(y, s, X[j])) + 0.05
        length = rnd.uniform(0.5, 3.4) * (1.6 if rnd.random() < 0.15 else 1.0)
        r0 = rnd.uniform(0.008, 0.028)
        ph, amp = rnd.uniform(0, 6.3), rnd.uniform(0.05, 0.25)
        prev = None
        for i in range(seg + 1):
            t = i / seg
            c = (x0 - 0.12 * t + amp * math.sin(ph + t * 5.0) * 0.4, y - mid + amp * math.sin(ph * 1.7 + t * 4.0),
                 -1.25 - length * t)
            r = r0 * (1 - 0.8 * t)
            vs = [bm.verts.new((c[0] + r * math.cos(a), c[1] + r * math.sin(a), c[2]))
                  for a in (2 * math.pi * q / ring for q in range(ring))]
            if prev:
                for q in range(ring):
                    bm.faces.new((prev[q], prev[(q + 1) % ring], vs[(q + 1) % ring], vs[q]))
            prev = vs
    ob = lib._mesh_obj("edge_roots", bm, m, root, (0, 0, 0), smooth=True, outline=False)
    ob["no_bevel"] = True
    return ob


def isle(root, size=5.0, seed=7, trees=3):
    """A small floating island: an irregular grass top (radius ~size), a rocky cone under it, a few trees."""
    rnd = random.Random(seed)
    nseg, nring = 48, 16
    depth = size * 1.7
    F = T.field(T.SID)
    rad = [size * (0.75 + 0.35 * rnd.random()) for _ in range(12)]
    def r_at(a):
        f = a / (2 * math.pi) * 12
        i = int(f) % 12
        t = f - int(f)
        t = t * t * (3 - 2 * t)
        return rad[i] * (1 - t) + rad[(i + 1) % 12] * t
    pos = np.zeros((nring + 1, nseg + 1, 3))
    uv = np.zeros((nring + 1, nseg + 1, 2))
    for j in range(nring + 1):
        t = j / nring
        for i in range(nseg + 1):
            a = 2 * math.pi * i / nseg
            r = r_at(a) * (1 - t) ** 0.85 * (1 + 0.08 * math.sin(a * 5 + j))
            pos[j, i] = (r * math.cos(a), r * math.sin(a), -depth * t ** 0.9)
            uv[j, i] = (i / nseg, 1 - t)
    fs = np.linspace(T.FX_LO, T.FX_HI, 512)
    fz = np.linspace(4.6, 0.2, 256)
    FS, FZ = np.meshgrid(fs, fz)
    _, rgb = T._sample(F, FS, FZ)
    lin = _lin(rgb)
    lin[:24] = lin[:24] * 0.4 + SOIL * 0.6                 # the soil band at the top
    img = T._image(f"isle_skin{seed}", _srgb(lin)[::-1].copy())
    m = T._skin_mat(f"isle_mat{seed}", img)
    T._grid_obj(f"isle_cone{seed}", pos, uv, m, root, outward=(1, 0, 0))
    # the top: a fan of the rim at z 0, grass
    g = lib.mat("isle_grass", (0.13, 0.17, 0.055), 0.9, noise=0.25, noise_scale=3)
    bm = bmesh.new()
    c = bm.verts.new((0, 0, 0.05))
    rim = [bm.verts.new((r_at(2 * math.pi * i / nseg) * math.cos(2 * math.pi * i / nseg),
                         r_at(2 * math.pi * i / nseg) * math.sin(2 * math.pi * i / nseg), 0.0)) for i in range(nseg)]
    for i in range(nseg):
        bm.faces.new((c, rim[i], rim[(i + 1) % nseg]))
    lib._mesh_obj(f"isle_top{seed}", bm, g, root, (0, 0, 0), smooth=True, outline=False)
    for k in range(trees):
        a = rnd.uniform(0, 6.28)
        rr = rnd.uniform(0, size * 0.45)
        e = lib.empty(f"isle_tree{seed}_{k}", parent=root, loc=(rr * math.cos(a), rr * math.sin(a), 0.0))
        nature_r8.tree(e, "E", k % 3, "full")
        e.scale = (0.7, 0.7, 0.7)


def r11_edge(root, c="E", style="A", part=0):
    """One of the three 16 m stretches of the 48 m wall (part 0: s -24..-8, 1: -8..8, 2: 8..24), its origin its own
    middle: s -16, 0, 16 (the composer puts each there)."""
    wall(root, style, -25.0 + 16.0 * part, -7.0 + 16.0 * part)         # 1 m over each neighbour (0.25 cracked where the coast turns)


def r11_isle(root, c="E", size=5.0, seed=7):
    isle(root, size, seed)


FOOTPRINT = {"r11_edge": (1, 1), "r11_isle": (1, 1)}
BUILDERS = {"r11_edge": r11_edge, "r11_isle": r11_isle}
