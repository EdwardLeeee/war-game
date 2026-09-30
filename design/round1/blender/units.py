"""Unit models and their animations (Blender side).

East (東陸) units carry a small back banner (背旗) in the player colour;
West (西陸) units wear a player-coloured surcoat and shields. Both share one
material language (lacquer/leather/cloth/steel) so they sit on one battlefield.
"""
import math
import os

import lib
from humanoid import (blend, ease, fall, fall_root_tilt, gallop, grip, horse, humanoid, idle,
                      walk)
from lib import box, cyl, fx_mat, ico, lathe, mat, rod, slab, sphere

EMBLEM_DIR = os.environ.get("EMBLEM_DIR", "")


def palette():
    P = dict(
        skin=mat("skin", (0.8, 0.6, 0.46), 0.6, sheen=0.2),
        lacquer=mat("lacquer", (0.3, 0.2, 0.11), 0.28, 0.35, noise=0.3, noise_scale=40),
        # shafts and siege posts: dark wood, never a player colour
        lacquer_red=mat("shaft_dark", (0.2, 0.12, 0.07), 0.5, noise=0.2, noise_scale=8),
        bronze=mat("bronze", (0.78, 0.55, 0.25), 0.35, 1.0),
        steel=mat("steel", (0.66, 0.68, 0.72), 0.3, 1.0, noise=0.08),
        mail=mat("mail", (0.46, 0.47, 0.5), 0.5, 1.0, noise=0.4, noise_scale=90),
        indigo=mat("indigo", (0.1, 0.14, 0.28), 0.8, noise=0.12, sheen=0.3),
        ochre=mat("ochre", (0.62, 0.44, 0.2), 0.8, noise=0.12, sheen=0.3),
        hemp=mat("hemp", (0.62, 0.56, 0.44), 0.85, noise=0.15, sheen=0.3),
        dark=mat("dark", (0.07, 0.065, 0.06), 0.7),
        leather=mat("leather", (0.34, 0.2, 0.1), 0.6, noise=0.2),
        cream=mat("cream", (0.74, 0.67, 0.52), 0.85, noise=0.15, sheen=0.3),
        moss=mat("moss", (0.22, 0.26, 0.14), 0.85, noise=0.15, sheen=0.3),
        wood=mat("wood", (0.42, 0.27, 0.14), 0.7, noise=0.3, noise_scale=6),
        wood_dark=mat("wood_dark", (0.24, 0.15, 0.08), 0.7, noise=0.3, noise_scale=6),
        straw=mat("straw", (0.8, 0.66, 0.36), 0.9, noise=0.25, noise_scale=30),
        rope=mat("rope", (0.55, 0.46, 0.3), 0.9),
        red_cloth=mat("tassel_white", (0.86, 0.83, 0.76), 0.8, sheen=0.4),
        horse_bay=mat("horse_bay", (0.3, 0.17, 0.09), 0.55, sheen=0.4),
        horse_grey=mat("horse_grey", (0.62, 0.6, 0.57), 0.55, sheen=0.4),
        mane=mat("mane", (0.06, 0.05, 0.04), 0.8),
        hoof=mat("hoof", (0.12, 0.1, 0.08), 0.6),
        team=mat("team", kind="team", rough=0.75, sheen=0.3),
        team_metal=mat("team_metal", kind="team", rough=0.35, metal=0.0),
        crystal=mat("crystal", (0.35, 0.95, 1.0), 0.1, emission=3.0, kind="emit"),
        stone=mat("stone", (0.5, 0.48, 0.45), 0.85, noise=0.3, noise_scale=10),
    )
    return P


def back_banner(rig, P, h=0.75, w=0.26, flag_h=0.36):
    """East identity: a small player-coloured banner on a pole from the back."""
    torso = rig.j["torso"]
    rod(rig.name + "_bpole", (0.06, -0.14, 0.2), (0.06, -0.16, 0.2 + h + 0.6), 0.012, P["wood_dark"],
        parent=torso)
    slab(rig.name + "_bflag", [(0, 0), (w, 0.02), (w * 0.94, -flag_h), (0, -flag_h)], 0.012, P["team"],
         parent=torso, loc=(0.075, -0.16, 0.2 + h + 0.56), rot=(0, 0, 90))


def east_helmet(rig, P, plume=True):
    head = rig.j["head"]
    n = rig.name
    lathe(n + "_helm", [(0.158, 0.1), (0.162, 0.17), (0.145, 0.25), (0.1, 0.31), (0.03, 0.34),
                        (0.0, 0.345)], P["lacquer"], head, segs=18)
    lathe(n + "_helmrim", [(0.165, 0.08), (0.168, 0.11)], P["bronze"], head, segs=18)
    lathe(n + "_neckguard", [(0.16, 0.12), (0.2, 0.0), (0.21, -0.04)], P["lacquer"], head,
          segs=18, at=(0, -0.03, 0), scale=(1, 0.9, 1), cap=False)
    cyl(n + "_spike", 0.012, 0.12, P["bronze"], head, at=(0, 0, 0.33))
    if plume:
        sphere(n + "_tassel", 0.05, P["red_cloth"], head, at=(0, -0.01, 0.43), scale=(1, 1, 1.4))


def lamellar(rig, P, skirt=True, shoulders=True):
    n = rig.name
    box(n + "_lam", (0.4, 0.26, 0.4), P["lacquer"], rig.j["torso"], at=(0, 0, 0.25), taper=(1.1, 1.05),
        bevel=0.04)
    box(n + "_belt", (0.39, 0.25, 0.06), P["bronze"], rig.j["torso"], at=(0, 0, 0.06), bevel=0.02)
    if shoulders:
        for side, s in (("R", 1), ("L", -1)):
            sphere(n + "_pauld" + side, 0.1, P["lacquer"], rig.j["shoulder" + side], at=(0.02 * s, 0, 0.0),
                   scale=(1.1, 1.0, 0.8))
    if skirt:
        lathe(n + "_skirt", [(0.2, 0.08), (0.25, -0.18), (0.29, -0.4)], P["lacquer"], rig.j["hips"],
              segs=16, scale=(1, 0.8, 1), cap=False)


# ---------------------------------------------------------------- units


class Unit:
    frames = {"idle": 8, "walk": 8, "attack": 8, "death": 8}

    def __init__(self, kind):
        self.kind = kind
        self.root = lib.empty(kind + "_unit")
        self.rigs = {}
        self.fx = {}

    def face(self, facing):
        self.root.rotation_euler = (0, 0, lib.heading_for(facing))

    def pose(self, anim, frame):
        raise NotImplementedError


# ---- infantry helpers

def infantry(kind, P, cloth, pants, boots):
    u = Unit(kind)
    r = humanoid(kind, P["skin"], cloth, pants, boots, parent=u.root)
    u.rigs["body"] = r
    return u, r


def pose_body(r, angles, offsets, tilt=None):
    r.pose(angles, offsets)
    if tilt:
        r.root.rotation_euler = [a * lib.D2R for a in tilt]
    else:
        r.root.rotation_euler = (0, 0, 0)


def generic_pose(u, anim, frame, attack_fn):
    r = u.rigs["body"]
    n = u.frames.get(anim, 8)
    t = (frame % n) / n
    if anim == "idle":
        a, o = idle(t)
        a = dict(attack_fn(0.0)[0], **{k: v for k, v in a.items() if k.startswith(("torso", "neck", "hip"))})
        pose_body(r, a, o)
    elif anim == "walk":
        a, o = walk(t, arms=False)
        a.update({k: v for k, v in attack_fn(0.0)[0].items() if k.startswith(("shoulder", "elbow", "wrist", "grip"))})
        pose_body(r, a, o)
    elif anim in ("attack", "chop", "mine"):
        a, o = attack_fn(t)
        pose_body(r, a, o)
    elif anim == "death":
        tt = frame / max(1, n - 1)
        a, o = fall(tt)
        pose_body(r, a, o, fall_root_tilt(tt))


# ---- 槍兵 (East spearman) / 長矛兵 (West pikeman)

def spear_attack(t):
    # ready -> pull back -> thrust -> recover
    ready = {"torso": (-6, 0, -20), "shoulderR": (30, 0, -10), "elbowR": (70, 0, 0),
             "shoulderL": (55, 0, 30), "elbowL": (40, 0, 0),
             "hipR": (-14, 0, -6), "hipL": (22, 0, 6), "kneeL": (-18, 0, 0), "kneeR": (-6, 0, 0)}
    back = {"torso": (-2, 0, -30), "shoulderR": (5, 0, -10), "elbowR": (95, 0, 0),
            "shoulderL": (45, 0, 30), "elbowL": (55, 0, 0)}
    thrust = {"torso": (-16, 0, -5), "shoulderR": (70, 0, -8), "elbowR": (18, 0, 0),
              "shoulderL": (70, 0, 20), "elbowL": (20, 0, 0), "hipL": (34, 0, 6), "kneeL": (-28, 0, 0)}
    if t < 0.3:
        a = blend(ready, back, ease(t / 0.3))
    elif t < 0.5:
        a = blend(blend(ready, back, 1), thrust, ease((t - 0.3) / 0.2))
    else:
        a = blend(blend(ready, thrust, 1), ready, ease((t - 0.5) / 0.5))
    return a, {"hips": (0, 0.04 * (1 if 0.3 < t < 0.6 else 0), -0.04)}


def build_spear_e(P):
    u, r = infantry("spear_e", P, P["indigo"], P["dark"], P["dark"])
    lamellar(r, P)
    east_helmet(r, P)
    back_banner(r, P)
    g = grip(r, "R", "spear", rot=(0, 0, 0))
    rod("spear_e_shaft", (0, 0, 1.0), (0, 0, -1.7), 0.018, P["lacquer_red"], parent=g)
    rod("spear_e_tip", (0, 0, -1.7), (0, 0, -1.98), 0.034, P["steel"], parent=g, r2=0.002, scale=(1, 0.5, 1))
    sphere("spear_e_tassel", 0.045, P["red_cloth"], g, at=(0, 0, -1.64), scale=(1, 1, 1.3))
    u.pose = lambda anim, frame: generic_pose(u, anim, frame, spear_attack)
    return u


def west_kettle(rig, P):
    head = rig.j["head"]
    n = rig.name
    lathe(n + "_kettle", [(0.3, 0.12), (0.28, 0.14), (0.165, 0.16), (0.16, 0.25), (0.12, 0.31),
                          (0.0, 0.33)], P["steel"], head, segs=20)


def surcoat(rig, P, length=0.5, mat_key="team"):
    n = rig.name
    box(n + "_sur", (0.4, 0.26, 0.44), P[mat_key], rig.j["torso"], at=(0, 0, 0.24), taper=(1.08, 1.04),
        bevel=0.04)
    lathe(n + "_surskirt", [(0.21, 0.08), (0.25, -0.2), (0.28, -length)], P[mat_key], rig.j["hips"],
          segs=16, scale=(1, 0.8, 1), cap=False)
    box(n + "_belt", (0.4, 0.27, 0.05), P["leather"], rig.j["torso"], at=(0, 0, 0.05), bevel=0.02)


def build_pike_w(P):
    u, r = infantry("pike_w", P, P["cream"], P["leather"], P["leather"])
    surcoat(r, P)
    west_kettle(r, P)
    for side in ("R", "L"):
        sphere(f"pike_w_pauld{side}", 0.095, P["steel"], r.j["shoulder" + side], scale=(1.1, 1, 0.8))
    g = grip(r, "R", "pike")
    rod("pike_w_shaft", (0, 0, 1.2), (0, 0, -2.0), 0.02, P["wood"], parent=g)
    rod("pike_w_tip", (0, 0, -2.0), (0, 0, -2.32), 0.036, P["steel"], parent=g, r2=0.002, scale=(1, 0.45, 1))
    u.pose = lambda anim, frame: generic_pose(u, anim, frame, spear_attack)
    return u


# ---- 弩手 (East crossbowman)

def xbow_attack(t):
    aim = {"torso": (-4, 0, -8), "neck": (6, 0, 6), "shoulderR": (78, 0, -18), "elbowR": (12, 0, 0),
           "wristR": (0, 0, 0), "shoulderL": (82, 0, 22), "elbowL": (18, 0, 0),
           "hipR": (-10, 0, -6), "hipL": (16, 0, 6), "kneeL": (-14, 0, 0)}
    reload = {"torso": (-26, 0, 0), "neck": (-10, 0, 0), "shoulderR": (45, 0, -10), "elbowR": (45, 0, 0),
              "wristR": (-30, 0, 0), "shoulderL": (30, 0, 10), "elbowL": (70, 0, 0)}
    if t < 0.35:
        a = aim
    elif t < 0.45:
        a = blend(aim, {"torso": (4, 0, -10), "shoulderR": (82, 0, -25)}, 1)   # recoil
    elif t < 0.75:
        a = blend(aim, reload, ease((t - 0.45) / 0.3))
    else:
        a = blend(reload, aim, ease((t - 0.75) / 0.25))
    return a, {}


def build_xbow_e(P):
    u, r = infantry("xbow_e", P, P["ochre"], P["indigo"], P["dark"])
    box("xbow_e_vest", (0.4, 0.26, 0.36), P["lacquer"], r.j["torso"], at=(0, 0, 0.27), bevel=0.04)
    lathe("xbow_e_skirt", [(0.2, 0.08), (0.25, -0.18), (0.27, -0.34)], P["ochre"], r.j["hips"],
          segs=16, scale=(1, 0.8, 1), cap=False)
    head = r.j["head"]
    # 幞頭-like soft cap with two tails
    lathe("xbow_e_cap", [(0.15, 0.1), (0.16, 0.18), (0.13, 0.27), (0.06, 0.31), (0, 0.32)], P["dark"],
          head, segs=16)
    for s in (-1, 1):
        box(f"xbow_e_capt{s}", (0.03, 0.2, 0.05), P["dark"], head, at=(0.08 * s, -0.22, 0.2),
            rot=(20, 0, 0))
    back_banner(r, P, h=0.6, w=0.22, flag_h=0.3)
    g = grip(r, "R", "xbow", loc=(0, 0.0, -0.06), rot=(-90, 0, 0))
    box("xbow_e_stock", (0.07, 0.7, 0.08), P["wood"], g, at=(0, -0.08, 0), bevel=0.012)
    box("xbow_e_prod", (0.8, 0.06, 0.06), P["wood_dark"], g, at=(0, 0.24, 0.02), bevel=0.018)
    sphere("xbow_e_prodtip", 0.035, P["bronze"], g, at=(0, 0.25, 0.03))
    rod("xbow_e_str1", (0.4, 0.23, 0.02), (0, 0.02, 0.03), 0.005, P["rope"], parent=g)
    rod("xbow_e_str2", (-0.4, 0.23, 0.02), (0, 0.02, 0.03), 0.005, P["rope"], parent=g)
    u.pose = lambda anim, frame: generic_pose(u, anim, frame, xbow_attack)
    return u


# ---- 長弓兵 (West longbowman)

def bow_attack(t):
    draw = {"torso": (-2, 0, -35), "neck": (0, 0, 30), "shoulderL": (88, 0, 28), "elbowL": (5, 0, 0),
            "shoulderR": (85, 0, -60), "elbowR": (130, 0, 0),
            "hipR": (-10, 0, -8), "hipL": (14, 0, 8)}
    loose = dict(draw, shoulderR=(80, 0, -85), elbowR=(95, 0, 0))
    nock = {"torso": (-6, 0, -20), "shoulderL": (60, 0, 20), "elbowL": (20, 0, 0),
            "shoulderR": (40, 0, -20), "elbowR": (60, 0, 0)}
    if t < 0.4:
        a = blend(nock, draw, ease(t / 0.4))
    elif t < 0.55:
        a = draw
    elif t < 0.7:
        a = blend(draw, loose, ease((t - 0.55) / 0.15))
    else:
        a = blend(loose, nock, ease((t - 0.7) / 0.3))
    return a, {}


def build_bow_w(P):
    u, r = infantry("bow_w", P, P["moss"], P["leather"], P["leather"])
    surcoat(r, P, length=0.42)
    head = r.j["head"]
    lathe("bow_w_hood", [(0.2, -0.02), (0.17, 0.1), (0.165, 0.2), (0.12, 0.28), (0.04, 0.32), (0, 0.33)],
          P["moss"], head, segs=16, at=(0, -0.02, 0))
    rod("bow_w_hoodtip", (0, -0.14, 0.26), (0, -0.3, 0.1), 0.05, P["moss"], parent=head, r2=0.005)
    box("bow_w_quiver", (0.1, 0.1, 0.46), P["leather"], r.j["torso"], at=(0.12, -0.16, 0.3), rot=(0, -20, 0))
    g = grip(r, "L", "bow", rot=(0, 0, 0))
    pts = []
    for k in range(9):
        a = -0.9 + k * 0.225
        pts.append((0.0, 0.95 * math.sin(a), -0.18 * (math.cos(a) - 1.0) * 1.6))
    for k in range(8):
        rod(f"bow_w_limb{k}", pts[k], pts[k + 1], 0.017 - 0.004 * abs(k - 3.5) / 3.5, P["wood"], parent=g)
    rod("bow_w_string", pts[0], pts[-1], 0.004, P["rope"], parent=g)
    u.pose = lambda anim, frame: generic_pose(u, anim, frame, bow_attack)
    return u


# ---- 農夫 (East farmer)

def chop(t):
    up = {"torso": (4, 0, -10), "shoulderR": (170, 0, -10), "elbowR": (20, 0, 0),
          "shoulderL": (160, 0, 15), "elbowL": (25, 0, 0), "hipL": (18, 0, 6), "hipR": (-8, 0, -6)}
    down = {"torso": (-30, 0, 0), "shoulderR": (40, 0, -5), "elbowR": (10, 0, 0),
            "shoulderL": (38, 0, 10), "elbowL": (10, 0, 0), "hipL": (26, 0, 6), "kneeL": (-20, 0, 0)}
    if t < 0.5:
        a = blend(down, up, ease(t / 0.5))
    elif t < 0.7:
        a = blend(up, down, ease((t - 0.5) / 0.2))
    else:
        a = down
    return a, {"hips": (0, 0, -0.03)}


def build_farmer_e(P, tool="axe"):
    u, r = infantry("farmer_e", P, P["hemp"], P["hemp"], P["straw"])
    lathe("farmer_e_robe", [(0.2, 0.1), (0.24, -0.12), (0.27, -0.32)], P["hemp"], r.j["hips"], segs=16,
          scale=(1, 0.8, 1), cap=False)
    box("farmer_e_sash", (0.39, 0.25, 0.07), P["team"], r.j["torso"], at=(0, 0, 0.07), bevel=0.02)
    head = r.j["head"]
    # 斗笠 conical straw hat — the farmer's silhouette
    lathe("farmer_e_hat", [(0.34, 0.12), (0.3, 0.14), (0.16, 0.22), (0.02, 0.3), (0, 0.3)],
          P["straw"], head, segs=24)
    g = grip(r, "R", tool)
    if tool == "axe":
        rod("farmer_e_haft", (0, 0, 0.1), (0, 0, -0.62), 0.016, P["wood"], parent=g)
        slab("farmer_e_axe", [(0, 0), (0.16, 0.05), (0.18, -0.1), (0, -0.07)], 0.02, P["steel"], parent=g,
             loc=(0, 0, -0.52), rot=(0, 0, 90))
    else:
        rod("farmer_e_haft", (0, 0, 0.1), (0, 0, -0.66), 0.016, P["wood"], parent=g)
        rod("farmer_e_pick1", (0, 0, -0.6), (0, 0.24, -0.66), 0.02, P["steel"], parent=g, r2=0.004)
        rod("farmer_e_pick2", (0, 0, -0.6), (0, -0.22, -0.64), 0.02, P["steel"], parent=g, r2=0.004)
    if tool == "pick":
        # ore basket on the back
        lathe("farmer_e_basket", [(0.1, 0), (0.14, 0.26)], P["straw"], r.j["torso"], segs=12,
              at=(0, -0.2, 0.12))
    u.pose = lambda anim, frame: generic_pose(u, anim, frame, chop)
    return u


# ---- 具裝騎兵 (East armoured cavalry) / 騎士 (West knight)

def east_barding(h, body, neck, head):
    P = PAL
    n = h.name
    sphere(n + "_bard", 0.4, P["lacquer"], body, at=(0, 0, 0.04), scale=(1.0, 2.05, 0.98))
    lathe(n + "_bardskirt", [(0.34, 0.0), (0.42, -0.3), (0.47, -0.56)], P["team"], body, segs=20,
          scale=(1, 2.1, 1), cap=False)
    lathe(n + "_bardtrim", [(0.465, -0.5), (0.47, -0.54)], P["bronze"], body, segs=20, scale=(1, 2.1, 1),
          cap=False)
    cyl(n + "_neckarm", 0.2, 0.6, P["lacquer"], neck, r2=0.15, scale=(0.85, 1, 1))
    box(n + "_chamfron", (0.22, 0.2, 0.36), P["bronze"], head, at=(0, 0.0, 0.18), taper=(0.8, 0.85),
        bevel=0.03)
    sphere(n + "_plume", 0.1, P["team"], head, at=(0, -0.1, -0.1), scale=(1, 1, 1.7))
    cyl(n + "_neckcloth", 0.215, 0.32, P["team"], neck, at=(0, 0, 0.02), r2=0.2, scale=(0.85, 1, 1))


def west_caparison(h, body, neck, head):
    P = PAL
    n = h.name
    sphere(n + "_cap", 0.4, P["team"], body, at=(0, 0, 0.05), scale=(1.0, 2.1, 0.96))
    lathe(n + "_capskirt", [(0.35, 0.0), (0.43, -0.32), (0.5, -0.6)], P["team"], body, segs=20,
          scale=(1, 2.15, 1), cap=False)
    cyl(n + "_capneck", 0.2, 0.62, P["team"], neck, r2=0.14, scale=(0.85, 1, 1))
    box(n + "_caphead", (0.22, 0.21, 0.3), P["team"], head, at=(0, 0, 0.13), taper=(0.85, 0.85), bevel=0.04)
    try:
        fm = lib.flag_mat("knight_emblem", os.path.join(EMBLEM_DIR, "twintowers.png"))
        for s in (-1, 1):
            slab(n + f"_capemb{s}", [(-0.28, -0.28), (0.28, -0.28), (0.28, 0.28), (-0.28, 0.28)], 0.01, fm,
                 parent=body, loc=(0.47 * s, -0.25, -0.22), rot=(0, 0, 90), outline=False)
    except RuntimeError:
        pass


def rider_pose(t, lance=True):
    a = {"torso": (-10 + 3 * math.sin(2 * math.pi * t), 0, -6), "neck": (6, 0, 0),
         "shoulderR": (45, 0, -12), "elbowR": (60, 0, 0), "shoulderL": (35, 0, 20), "elbowL": (70, 0, 0)}
    return a


def build_cav(kind, P):
    u = Unit(kind)
    east = kind == "hcav_e"
    hr = horse(kind + "_h", P["horse_bay"] if east else P["horse_grey"], P["mane"], P["hoof"],
               parent=u.root, barding=east_barding if east else None,
               caparison=None if east else west_caparison)
    u.rigs["horse"] = hr
    rider = humanoid(kind + "_r", P["skin"], P["indigo"] if east else P["mail"], P["dark"] if east else P["mail"],
                     P["dark"] if east else P["steel"], parent=hr.j["saddle"], sit=True)
    rider.root.location = (0, 0, -0.93)
    u.rigs["body"] = rider
    if east:
        lamellar(rider, P, skirt=False)
        east_helmet(rider, P)
        back_banner(rider, P, h=0.8, w=0.3, flag_h=0.42)
        g = grip(rider, "R", "lance")
        rod(kind + "_lance", (0, 0, 1.0), (0, 0, -2.2), 0.02, P["lacquer_red"], parent=g)
        rod(kind + "_lancetip", (0, 0, -2.2), (0, 0, -2.54), 0.038, P["steel"], parent=g, r2=0.002,
            scale=(1, 0.5, 1))
        sphere(kind + "_lancetas", 0.05, P["red_cloth"], g, at=(0, 0, -2.14), scale=(1, 1, 1.3))
    else:
        surcoat(rider, P, length=0.3)
        head = rider.j["head"]
        cyl(kind + "_helm", 0.17, 0.34, P["steel"], head, at=(0, 0, -0.02), r2=0.16)
        box(kind + "_slit", (0.2, 0.05, 0.025), P["dark"], head, at=(0, 0.155, 0.15), outline=False)
        sphere(kind + "_crest", 0.06, P["team"], head, at=(0, 0, 0.36), scale=(0.6, 1.4, 0.8))
        g = grip(rider, "R", "lance")
        rod(kind + "_lance", (0, 0, 1.0), (0, 0, -2.4), 0.024, P["team"], parent=g, r2=0.012)
        rod(kind + "_lancetip", (0, 0, -2.4), (0, 0, -2.64), 0.03, P["steel"], parent=g, r2=0.002)
        cyl(kind + "_vamplate", 0.06, 0.12, P["steel"], g, at=(0, 0, 0.1), r2=0.02)
        sh = lib.empty(kind + "_shieldj", parent=rider.j["elbowL"], loc=(-0.08, 0.02, -0.14))
        fm = lib.flag_mat("shield_emblem", os.path.join(EMBLEM_DIR, "twintowers.png"))
        heater = [(-0.2, 0.22), (0.2, 0.22), (0.2, 0.0), (0.12, -0.2), (0, -0.3), (-0.12, -0.2), (-0.2, 0.0)]
        slab(kind + "_shield", heater, 0.04, fm, parent=sh, rot=(0, 0, 90))
    rider.rest.update({"shoulderR": (45, 0, -12), "elbowR": (60, 0, 0)})

    def pose(anim, frame):
        n = u.frames.get(anim, 8)
        t = (frame % n) / n
        if anim in ("walk", "attack"):
            ha, ho = gallop(t)
        else:
            ha, ho = gallop(0, amp=0.1)
        hr.pose(ha, ho)
        ra = dict(rider.rest)
        ra.update(rider_pose(t))
        rider.pose(ra, {})
    u.pose = pose
    return u


# ---- 霹靂車 (East traction trebuchet) / 投石機 (West wheeled catapult)

def wheel(name, P, parent, loc, r=0.42, rot=(0, 90, 0)):
    ob = cyl(name, r, 0.08, P["wood_dark"], parent, loc=loc, rot=rot, at=(0, 0, -0.04), segs=16)
    cyl(name + "_hub", 0.1, 0.12, P["bronze"], parent, loc=loc, rot=rot, at=(0, 0, -0.06), segs=10)
    return ob


def build_siege_e(P):
    u = Unit("siege_e")
    root = u.root
    base = lib.empty("siege_e_base", parent=root)
    for s in (-1, 1):
        box(f"siege_e_rail{s}", (0.12, 2.4, 0.16), P["wood"], base, at=(0.5 * s, 0, 0.5), bevel=0.02)
        wheel(f"siege_e_w{s}a", P, base, (0.62 * s, 0.8, 0.42))
        wheel(f"siege_e_w{s}b", P, base, (0.62 * s, -0.8, 0.42))
        # A-frame posts
        rod(f"siege_e_post{s}a", (0.5 * s, 0.7, 0.55), (0.35 * s, 0.05, 2.6), 0.06, P["lacquer_red"], parent=base)
        rod(f"siege_e_post{s}b", (0.5 * s, -0.7, 0.55), (0.35 * s, -0.05, 2.6), 0.06, P["lacquer_red"], parent=base)
    for y in (-0.9, 0.0, 0.9):
        box(f"siege_e_cross{y}", (1.1, 0.12, 0.12), P["wood"], base, at=(0, y, 0.6), bevel=0.02)
    rod("siege_e_axle", (-0.45, 0, 2.6), (0.45, 0, 2.6), 0.07, P["bronze"], parent=base)
    arm = lib.empty("siege_e_arm", parent=base, loc=(0, 0, 2.6))
    u.rigs["arm"] = arm
    rod("siege_e_beam", (0, 1.0, 0), (0, -2.6, 0), 0.07, P["wood_dark"], parent=arm, r2=0.045)
    # many pull ropes hanging from the short (front) end; the crew hauls them down
    for k in range(4):
        x = -0.21 + k * 0.14
        rod(f"siege_e_pull{k}", (x * 0.3, 0.57, 3.42), (x * 2.2, 1.45 + 0.08 * k, 0.05), 0.018,
            P["wood_dark"], parent=base, outline=False)
    rod("siege_e_sling", (0, -2.6, 0), (0, -2.75, -0.6), 0.01, P["rope"], parent=arm)
    sphere("siege_e_stone", 0.13, P["stone"], arm, at=(0, -2.75, -0.68))
    # banner on top
    rod("siege_e_bpole", (0.4, 0, 2.6), (0.4, 0, 3.5), 0.02, P["wood_dark"], parent=base)
    slab("siege_e_flag", [(0, 0), (0.4, 0.02), (0.38, -0.55), (0, -0.55)], 0.015, P["team"], parent=base,
         loc=(0.42, 0, 3.45), rot=(0, 0, 90))

    def pose(anim, frame):
        n = 8
        t = (frame % n) / n
        if anim == "attack":
            ang = 55 - 150 * ease(min(1, t / 0.5)) if t < 0.5 else -95 + 150 * ease((t - 0.5) / 0.5)
        else:
            ang = 55
        arm.rotation_euler = (ang * lib.D2R, 0, 0)
    u.pose = pose
    return u


def build_siege_w(P):
    u = Unit("siege_w")
    base = lib.empty("siege_w_base", parent=u.root)
    for s in (-1, 1):
        box(f"siege_w_rail{s}", (0.14, 2.2, 0.2), P["wood"], base, at=(0.45 * s, 0, 0.45), bevel=0.02)
        wheel(f"siege_w_w{s}a", P, base, (0.58 * s, 0.75, 0.36), r=0.36)
        wheel(f"siege_w_w{s}b", P, base, (0.58 * s, -0.75, 0.36), r=0.36)
        rod(f"siege_w_up{s}", (0.45 * s, 0.35, 0.5), (0.45 * s, 0.35, 1.5), 0.07, P["wood"], parent=base)
        rod(f"siege_w_brace{s}", (0.45 * s, -0.3, 0.5), (0.45 * s, 0.33, 1.45), 0.05, P["wood"], parent=base)
    box("siege_w_bar", (1.05, 0.16, 0.16), P["wood_dark"], base, at=(0, 0.35, 1.5), bevel=0.03)
    box("siege_w_pad", (0.5, 0.12, 0.12), P["leather"], base, at=(0, 0.35, 1.6), bevel=0.03)
    for y in (-0.9, -0.2, 0.9):
        box(f"siege_w_cross{y}", (1.0, 0.14, 0.14), P["wood"], base, at=(0, y, 0.5), bevel=0.02)
    cyl("siege_w_winch", 0.1, 0.9, P["wood_dark"], base, loc=(-0.45, -0.75, 0.62), rot=(0, 90, 0))
    for y in (-0.62, 0.62):
        box(f"siege_w_iron{y}", (1.02, 0.05, 0.22), P["steel"], base, at=(0, y, 0.45))
    arm = lib.empty("siege_w_arm", parent=base, loc=(0, -0.7, 0.62))
    u.rigs["arm"] = arm
    rod("siege_w_beam", (0, 0, 0), (0, 0, 1.6), 0.07, P["wood_dark"], parent=arm)
    lathe("siege_w_cup", [(0.02, 0), (0.18, 0.04), (0.22, 0.14)], P["wood_dark"], arm, at=(0, 0, 1.6),
          segs=12)
    sphere("siege_w_stone", 0.13, P["stone"], arm, at=(0, 0, 1.72))
    rod("siege_w_bpole", (0.5, -0.9, 0.55), (0.5, -0.9, 2.3), 0.02, P["wood_dark"], parent=base)
    fm = lib.flag_mat("siege_w_emb", os.path.join(EMBLEM_DIR, "twintowers.png"))
    slab("siege_w_flag", [(0, 0), (0.46, 0.0), (0.46, -0.58), (0.23, -0.46), (0, -0.58)], 0.015, fm,
         parent=base, loc=(0.52, -0.9, 2.28), rot=(0, 0, 90))

    def pose(anim, frame):
        t = (frame % 8) / 8
        if anim == "attack":
            ang = 70 - 80 * ease(min(1, t / 0.35)) if t < 0.35 else -10 + 80 * ease((t - 0.35) / 0.65)
        else:
            ang = 70
        arm.rotation_euler = (ang * lib.D2R, 0, 0)
    u.pose = pose
    return u


# ---- 術士 (East mage) — full animation set

MAGE_FRAMES = [("idle", 12), ("walk", 12), ("cast", 30), ("hit", 6), ("shatter", 8), ("fall", 12),
               ("dead", 4)]
CRYSTAL = (0.35, 0.95, 1.0)


def build_mage_e(P):
    u = Unit("mage_e")
    cloth = mat("mage_robe", (0.84, 0.81, 0.72), 0.75, noise=0.1, sheen=0.5)
    inner = mat("mage_inner", (0.12, 0.13, 0.16), 0.7)
    r = humanoid("mage_e", P["skin"], cloth, P["dark"], P["dark"], parent=u.root, bulk=0.92)
    u.rigs["body"] = r
    j = r.j
    # long robe from the chest down, flaring to the ground; wide sleeves
    lathe("mage_e_robe", [(0.2, 0.12), (0.22, -0.1), (0.3, -0.5), (0.4, -0.9)], cloth, j["hips"], segs=22,
          scale=(1, 0.82, 1), cap=False)
    lathe("mage_e_robehem", [(0.405, -0.86), (0.41, -0.92)], P["team"], j["hips"], segs=22,
          scale=(1, 0.82, 1), cap=False)
    lathe("mage_e_robeglow", [(0.378, -0.76), (0.384, -0.8)], P["crystal"], j["hips"], segs=22,
          scale=(1, 0.82, 1), cap=False, outline=False)
    lathe("mage_e_chestglow", [(0.2, 0.3), (0.205, 0.33)], P["crystal"], j["torso"], segs=16,
          scale=(1, 0.7, 1), cap=False, outline=False)
    box("mage_e_collar", (0.2, 0.06, 0.34), inner, j["torso"], at=(0, 0.11, 0.3), rot=(0, 0, 0))
    box("mage_e_sash", (0.38, 0.24, 0.1), P["team"], j["torso"], at=(0, 0, 0.08), bevel=0.02)
    slab("mage_e_sashtail", [(0, 0), (0.07, 0), (0.08, -0.5), (0.0, -0.46)], 0.01, P["team"], parent=j["torso"],
         loc=(0.1, 0.13, 0.06), rot=(0, 0, 0))
    for side in ("R", "L"):
        lathe(f"mage_e_sleeve{side}", [(0.07, 0.0), (0.11, -0.12), (0.16, -0.27)], cloth, j["elbow" + side],
              segs=14, cap=False)
        lathe(f"mage_e_cuff{side}", [(0.158, -0.25), (0.163, -0.285)], P["crystal"], j["elbow" + side],
              segs=14, cap=False, outline=False)
    # hair knot, lotus crown with a crystal, two long ribbons
    head = j["head"]
    sphere("mage_e_hair", 0.145, P["dark"], head, at=(0, -0.02, 0.15), scale=(1, 1, 0.95))
    cyl("mage_e_knot", 0.06, 0.1, P["dark"], head, at=(0, -0.02, 0.28))
    lathe("mage_e_crown", [(0.07, 0.3), (0.1, 0.38), (0.06, 0.46)], P["bronze"], head, segs=10)
    ico("mage_e_gem", 0.05, P["crystal"], head, at=(0, 0.06, 0.4), subdiv=1, smooth=False)
    # three crystals hovering above the head: the mage's silhouette even without the shield
    halo = r.joint("halo", head, (0, 0, 0.62))
    for k in range(3):
        a = 2 * math.pi * k / 3
        ico(f"mage_e_float{k}", 0.055, P["crystal"], halo, at=(0.2 * math.cos(a), 0.2 * math.sin(a), 0),
            subdiv=1, smooth=False, scale=(0.7, 0.7, 1.5), outline=False)
    for s in (-1, 1):
        slab(f"mage_e_ribbon{s}", [(0, 0), (0.03, 0), (0.04, -0.55), (0.0, -0.5)], 0.008, P["team"],
             parent=head, loc=(0.07 * s, -0.08, 0.34), rot=(-12, 0, 8 * s))
    # crystal pouch on the belt
    ico("mage_e_pouchgem", 0.04, P["crystal"], j["torso"], at=(-0.18, 0.08, 0.02), subdiv=1, smooth=False)
    box("mage_e_pouch", (0.1, 0.08, 0.1), P["leather"], j["torso"], at=(-0.19, 0.04, -0.02), bevel=0.02)
    # 法印: a square bronze seal with a glowing face, hung on a cord in the right hand
    g = grip(r, "R", "seal", loc=(0, 0.02, -0.1))
    box("mage_e_seal", (0.17, 0.17, 0.14), P["bronze"], g, at=(0, 0, -0.03), bevel=0.014)
    box("mage_e_sealface", (0.15, 0.02, 0.12), P["crystal"], g, at=(0, 0.09, -0.03), outline=False)
    sphere("mage_e_sealknob", 0.035, P["bronze"], g, at=(0, 0, 0.05))

    # ---- effects (fx pass only)
    fx_mat("fx_shield", CRYSTAL, strength=1.5, alpha=0.7, fresnel=True, hex_pattern=True)
    fx_mat("fx_sigil", (0.35, 0.95, 1.0), strength=1.8, alpha=1.0)
    fx_mat("fx_bolt", (0.3, 0.9, 1.0), strength=2.0, alpha=1.0)
    fx_mat("fx_boltcore", (0.85, 1.0, 1.0), strength=3.0, alpha=1.0)
    fx_mat("fx_ground", CRYSTAL, strength=1.5, alpha=0.85)
    fx_mat("fx_spark", CRYSTAL, strength=2.5, alpha=1.0)
    fx_mat("fx_shard", CRYSTAL, strength=3.0, alpha=0.9, fresnel=True)
    fx_mat("fx_drop", CRYSTAL, strength=2.0, alpha=1.0)
    shield = ico("fx_shield_ob", 0.78, lib.MATS["fx_shield"]["mat"], u.root, at=(0, 0, 0.95),
                 subdiv=3, scale=(1, 1, 1.18), fx=True)
    u.fx["shield"] = shield
    # sigil: rings + rune ticks on a disc facing forward (+Y), placed before the seal
    sig = lib.empty("fx_sigil_root", parent=u.root, loc=(0.18, 0.95, 1.3))
    # ground circle under the caster: readable from every direction
    gsig = lib.empty("fx_gsig_root", parent=u.root, loc=(0, 0, 0.03))
    u.fx["gsig"] = gsig
    gm = lib.MATS["fx_ground"]["mat"]
    for k, (rad, w) in enumerate([(0.95, 0.03), (0.78, 0.015)]):
        ob = lib.ring(f"fx_gring{k}", rad - w, rad + w, gm, gsig, fx=True)
        ob.rotation_euler = (math.pi / 2, 0, 0)
    for k in range(8):
        a = 2 * math.pi * k / 8
        box(f"fx_grune{k}", (0.12, 0.05, 0.004), gm, gsig, loc=(0.87 * math.cos(a), 0.87 * math.sin(a), 0),
            rot=(0, 0, a / lib.D2R), fx=True)
    u.fx["sigil"] = sig
    spin = lib.empty("fx_sigil_spin", parent=sig)
    u.fx["sigil_spin"] = spin
    sm = lib.MATS["fx_sigil"]["mat"]
    for k, (rad, w) in enumerate([(0.42, 0.022), (0.34, 0.012), (0.2, 0.014)]):
        lib.ring(f"fx_ring{k}", rad - w, rad + w, sm, spin, fx=True)
    for k in range(12):
        a = 2 * math.pi * k / 12
        box(f"fx_rune{k}", (0.06, 0.012, 0.02 if k % 3 else 0.05), sm, spin,
            loc=(0.38 * math.cos(a), 0, 0.38 * math.sin(a)), rot=(0, -a / lib.D2R, 0), fx=True)
    for k in range(6):   # hexagram lines
        a0 = 2 * math.pi * k / 6
        a1 = a0 + 2 * math.pi / 3
        rod(f"fx_hex{k}", (0.32 * math.cos(a0), 0, 0.32 * math.sin(a0)),
            (0.32 * math.cos(a1), 0, 0.32 * math.sin(a1)), 0.008, sm, parent=spin, fx=True, segs=6)
    bolt = lib.empty("fx_bolt_root", parent=u.root, loc=(0.18, 1.0, 1.3))
    u.fx["bolt"] = bolt
    lathe("fx_bolt_core", [(0.0, -0.9), (0.09, -0.45), (0.14, 0.0), (0.06, 0.3), (0.0, 0.42)],
          lib.MATS["fx_bolt"]["mat"], bolt, rot=(-90, 0, 0), segs=10, fx=True)
    lathe("fx_bolt_hot", [(0.0, -0.5), (0.05, -0.2), (0.07, 0.05), (0.0, 0.3)],
          lib.MATS["fx_boltcore"]["mat"], bolt, rot=(-90, 0, 0), segs=8, fx=True)
    sparks = []
    for k in range(10):
        sparks.append(ico(f"fx_spark{k}", 0.028, lib.MATS["fx_spark"]["mat"], u.root, subdiv=1,
                          smooth=False, fx=True))
    u.fx["sparks"] = sparks
    # shield shards: 24 triangles from a coarse icosphere
    shards = []
    ref = [(math.cos(2 * math.pi * k / 24) * 0.78 * math.sin(math.pi * (0.25 + 0.5 * (k % 3) / 2)),
            math.sin(2 * math.pi * k / 24) * 0.78 * math.sin(math.pi * (0.25 + 0.5 * (k % 3) / 2)),
            0.95 + 0.9 * math.cos(math.pi * (0.25 + 0.5 * (k % 3) / 2))) for k in range(24)]
    for k, p in enumerate(ref):
        ob = slab(f"fx_shard{k}", [(-0.1, -0.07), (0.1, -0.07), (0.0, 0.11)], 0.01,
                  lib.MATS["fx_shard"]["mat"], parent=u.root, loc=p, rot=(k * 37, k * 53, k * 71), fx=True)
        shards.append((ob, p))
    u.fx["shards"] = shards
    drops = []
    for k in range(5):
        drops.append(ico(f"fx_drop{k}", 0.05, lib.MATS["fx_drop"]["mat"], u.root, subdiv=1, smooth=False,
                         scale=(0.7, 0.7, 1.3), fx=True))
    u.fx["drops"] = drops

    u.frames = dict(MAGE_FRAMES)
    u.frames.update({"attack": 30})

    def fx_off():
        shield["fx_on"] = True
        lib.set_fx("fx_shield", alpha=0.7, strength=1.5)
        sig.scale = (0.001, 0.001, 0.001)
        gsig.scale = (0.001, 0.001, 0.001)
        # the front sigil always faces the camera (world heading 135 deg, tilted up 30 deg)
        sig.rotation_euler = (30 * lib.D2R, 0, 135 * lib.D2R - u.root.rotation_euler[2])
        bolt.scale = (0.001, 0.001, 0.001)
        for s in sparks:
            s.scale = (0.001,) * 3
        for ob, p in shards:
            ob.scale = (0.001,) * 3
        for d in drops:
            d.scale = (0.001,) * 3

    def cast_arm(e):
        # right arm raises the seal forward; left hand makes a sword-finger at the chest
        return {"shoulderR": (8 + 78 * e, 0, -10 + 4 * e), "elbowR": (20 - 12 * e, 0, 0),
                "wristR": (-10 * e, 0, 0),
                "shoulderL": (20 + 30 * e, 0, 30 * e), "elbowL": (40 + 70 * e, 0, 0),
                "torso": (-2 - 4 * e, 0, -8 * e), "hipR": (-6 * e, 0, -6), "hipL": (12 * e, 0, 6),
                "kneeL": (-10 * e, 0, 0)}

    def pose(anim, frame):
        fx_off()
        r.root.rotation_euler = (0, 0, 0)
        spin = (frame / 12.0) * 2 * math.pi / 3
        if anim in ("idle", "hit"):
            t = frame / 12 if anim == "idle" else frame / 6
            a, o = idle(t)
            r.pose(a, o)
            if anim == "hit":
                # two impacts: shield flares, body flinches
                k = [1.0, 0.4, 0.1, 1.0, 0.45, 0.15][frame % 6]
                lib.set_fx("fx_shield", alpha=0.7 + 0.3 * k, strength=1.5 + 9 * k)
                a2 = dict(a, torso=(6 * k, 0, 4 * k), neck=(8 * k, 0, 0))
                r.pose(a2, o)
        elif anim == "walk":
            a, o = walk(frame / 12, arms=True, stride=22)
            r.pose(a, o)
        elif anim in ("cast", "attack"):
            f = frame
            if f < 6:            # raise the seal
                e = ease(f / 6)
                a = cast_arm(e)
                r.pose(a, {})
                sig.scale = (0.3 * e + 0.001,) * 3
                gsig.scale = (0.5 * e + 0.001,) * 3
            elif f < 24:         # calibrate 1.5 s (18 frames @ 12 fps): sigil grows and spins
                e = (f - 6) / 18
                a = cast_arm(1.0)
                r.pose(a, {"hips": (0, 0, -0.01 * math.sin(e * 12))})
                sig.scale = (0.35 + 0.65 * ease(min(1, e * 1.4)),) * 3
                gsig.scale = (0.5 + 0.5 * ease(min(1, e * 1.6)),) * 3
                gsig.rotation_euler = (0, 0, e * 1.5)
                u.fx["sigil_spin"].rotation_euler = (0, e * 2.6, 0)
                lib.set_fx("fx_sigil", strength=1.4 + 1.4 * e)
                for k, s in enumerate(sparks):
                    ph = (e * 3 + k / len(sparks)) % 1.0
                    rad = 0.9 * (1 - ph)
                    ang = k * 2.4 + ph * 5
                    s.location = (0.18 + rad * math.cos(ang), 0.95 - 0.2 * (1 - ph), 1.3 + rad * math.sin(ang))
                    s.scale = (1.0 - 0.5 * ph,) * 3
            else:                # fire: bolt leaves, recoil, recover
                e = (f - 24) / 6
                recoil = math.sin(min(1, e * 2) * math.pi) * (1 - e)
                a = cast_arm(1.0 - 0.6 * max(0, e - 0.4))
                a["torso"] = (8 * recoil, 0, -8)
                r.pose(a, {"hips": (0, -0.08 * recoil, 0)})
                sig.scale = (max(0.001, 1.0 - e) * (1 + 0.3 * recoil),) * 3
                gsig.scale = (max(0.001, 1.0 - e),) * 3
                lib.set_fx("fx_sigil", strength=3.0 * (1 - e) + 0.8)
                bolt.scale = (1.0 + 0.5 * (1 - e),) * 3
                bolt.location = (0.18, 1.0 + 3.2 * e + 0.4, 1.3 + 0.1 * e)
        elif anim == "shatter":
            e = frame / 7
            a, o = idle(0.2)
            a = dict(a, torso=(10 * (1 - e), 0, 6), neck=(12, 0, 0), shoulderR=(30, 0, -30), shoulderL=(30, 0, 30),
                     elbowR=(90, 0, 0), elbowL=(90, 0, 0))
            r.pose(a, o)
            shield["fx_on"] = frame == 0
            if frame == 0:
                lib.set_fx("fx_shield", alpha=1.0, strength=14)
            for k, (ob, p) in enumerate(shards):
                d = (p[0], p[1], p[2] - 0.95)
                out = 0.25 + 1.3 * e
                ob.location = (p[0] + d[0] * out, p[1] + d[1] * out, max(0.03, p[2] + d[2] * out - 1.6 * e * e))
                ob.rotation_euler = (k + e * 6, k * 1.3 + e * 4, k * 0.7)
                sc = max(0.001, 1.0 - e * 0.85)
                ob.scale = (sc,) * 3
            lib.set_fx("fx_shard", alpha=max(0.05, 1 - e * 0.9))
        elif anim in ("fall", "dead"):
            shield["fx_on"] = False
            tt = 1.0 if anim == "dead" else frame / 11
            a, o = fall(tt)
            r.pose(a, o)
            r.root.rotation_euler = [x * lib.D2R for x in fall_root_tilt(tt)]
            for k, d in enumerate(drops):
                e = min(1, tt * 1.3)
                ang = k * 1.26 + 0.5
                d.location = (0.5 * e * math.cos(ang), 0.5 * e * math.sin(ang) - 0.3,
                              max(0.05, 1.0 - 1.8 * e + 1.2 * math.sin(e * math.pi) * 0.5))
                d.scale = (1,) * 3
                d.rotation_euler = (k, k * 2, e * 5)
        halo = j["halo"]
        halo.rotation_euler = (0, 0, spin)
        # the hovering crystals fall with the mage and scatter (the fx drops take over)
        dying = anim in ("fall", "dead") or (anim == "shatter" and frame > 5)
        halo.scale = (0.001,) * 3 if anim in ("fall", "dead") else (1, 1, 1)
        halo.location = (0, 0, 0.62 - (0.25 if dying else 0.04 * math.sin(spin * 3)))

    u.pose = pose
    return u


PAL = None


def build(kind, variant=0):
    global PAL
    PAL = palette()
    P = PAL
    if kind == "farmer_e":
        return build_farmer_e(P, "axe" if variant == 0 else "pick")
    if kind == "spear_e":
        return build_spear_e(P)
    if kind == "pike_w":
        return build_pike_w(P)
    if kind == "xbow_e":
        return build_xbow_e(P)
    if kind == "bow_w":
        return build_bow_w(P)
    if kind in ("hcav_e", "knight_w"):
        return build_cav(kind, P)
    if kind == "siege_e":
        return build_siege_e(P)
    if kind == "siege_w":
        return build_siege_w(P)
    if kind == "mage_e":
        return build_mage_e(P)
    import buildings
    return buildings.build(kind, variant)


# sprite frame size in metres (w, h) and where the ground origin sits (fraction of w, h)
FRAME_M = {
    "farmer_e": (2.2, 2.4, 0.5, 0.78), "spear_e": (4.6, 3.4, 0.5, 0.72), "pike_w": (5.2, 3.4, 0.5, 0.72),
    "xbow_e": (2.6, 3.2, 0.5, 0.72), "bow_w": (2.6, 3.0, 0.5, 0.74), "hcav_e": (5.6, 4.2, 0.5, 0.75),
    "knight_w": (6.0, 4.2, 0.5, 0.75), "siege_e": (5.6, 6.4, 0.5, 0.8), "siege_w": (4.0, 4.0, 0.5, 0.72),
    "mage_e": (3.2, 3.2, 0.42, 0.74),
}


def frame_m(kind):
    if kind in FRAME_M:
        return FRAME_M[kind]
    import buildings
    return buildings.FRAME_M[kind]
