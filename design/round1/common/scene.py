"""The one battle scene every option draws (same camera, same placements).

Coordinates are screen points (932x430) of each object's ground contact point.
Facing uses 8 screen-relative directions measured on the ground plane:
0 = screen right, 2 = away from the viewer, 4 = left, 6 = toward the viewer.

我方：南溟（東陸、白鶴、藍）。敵方：布倫莫爾王國（西陸、雙塔、紅）。
"""

# (kind, x, y, facing, pose, variant)
#   pose = (animation, frame) ; variant picks between drawn/rendered variations
UNITS = [
    # --- 我方 East (blue) ---------------------------------------------------
    # farmers at the forest and the gold mine
    ("farmer_e", 318, 120, 1, ("chop", 3), 0),
    ("farmer_e", 372, 128, 3, ("chop", 7), 0),
    ("farmer_e", 231, 283, 1, ("mine", 2), 1),
    ("farmer_e", 283, 290, 3, ("mine", 6), 1),
    # 霹靂車 behind the line
    ("siege_e", 338, 214, 0, ("attack", 5), 0),
    # 弩手
    ("xbow_e", 432, 176, 0, ("attack", 2), 0),
    ("xbow_e", 422, 206, 0, ("attack", 6), 0),
    ("xbow_e", 440, 236, 0, ("attack", 0), 0),
    ("xbow_e", 452, 266, 0, ("attack", 4), 0),
    # 槍兵 front line
    ("spear_e", 504, 183, 0, ("attack", 1), 0),
    ("spear_e", 516, 206, 0, ("attack", 5), 0),
    ("spear_e", 508, 229, 0, ("attack", 3), 0),
    ("spear_e", 522, 252, 0, ("attack", 7), 0),
    ("spear_e", 512, 275, 0, ("attack", 2), 0),
    ("spear_e", 528, 298, 0, ("attack", 6), 0),
    # 具裝騎兵 charging on the upper flank
    ("hcav_e", 452, 150, 0, ("walk", 2), 0),
    ("hcav_e", 492, 140, 0, ("walk", 6), 0),
    ("hcav_e", 530, 156, 0, ("walk", 4), 0),
    # 術士 casting 晶砲 (shield on)
    ("mage_e", 392, 292, 0, ("cast", 22), 0),
    # --- 敵方 West (red) ----------------------------------------------------
    ("pike_w", 566, 188, 4, ("attack", 4), 0),
    ("pike_w", 580, 211, 4, ("attack", 0), 0),
    ("pike_w", 570, 234, 4, ("attack", 6), 0),
    ("pike_w", 586, 257, 4, ("attack", 2), 0),
    ("pike_w", 574, 280, 4, ("attack", 5), 0),
    ("pike_w", 590, 303, 4, ("attack", 1), 0),
    ("knight_w", 590, 142, 4, ("walk", 1), 0),
    ("knight_w", 628, 152, 4, ("walk", 5), 0),
    ("knight_w", 608, 166, 4, ("walk", 3), 0),
    ("bow_w", 666, 196, 4, ("attack", 3), 0),
    ("bow_w", 684, 222, 4, ("attack", 7), 0),
    ("bow_w", 662, 248, 4, ("attack", 1), 0),
    ("bow_w", 690, 272, 4, ("attack", 5), 0),
    ("siege_w", 752, 264, 4, ("attack", 2), 0),
]

TEAM_OF = {"e": "blue", "w": "red"}

BUILDINGS = [
    # (kind, x, y, variant)
    ("citygate_e", 118, 176, 0),     # 我方主城一角（左上，部分在畫面外）
    ("town_e", 706, 118, 0),         # 東陸小鎮，我方治理（藍旗）
    ("goldmine", 258, 268, 0),
    ("tower_w", 792, 186, 0),        # 布倫莫爾的石造箭樓（西陸建築，檢查東西協調用）
]

TREES = [
    (262, 64, 0), (300, 50, 1), (338, 62, 2), (380, 48, 0), (418, 66, 1),
    (246, 98, 2), (284, 92, 1), (398, 96, 2), (440, 88, 0), (352, 94, 1),
    (222, 58, 1), (460, 60, 2),
]

# ground decals: (kind, x, y)
DECALS = [
    ("rock", 212, 318), ("rock", 640, 330), ("rock", 470, 330),
    ("tuft", 300, 330), ("tuft", 660, 118), ("tuft", 560, 116), ("tuft", 430, 316),
    ("tuft", 205, 196), ("tuft", 760, 320), ("tuft", 350, 160),
]

# magic: 晶砲 fired by the mage at the West archers
MAGE_POS = (392, 292)
WARN_CIRCLE = dict(x=668, y=236, rx=54, ry=27)   # 2:1 ellipse on the ground
BOLT_T = 0.62                                    # bolt progress along its arc (0..1)

# ordinary missiles in flight: (kind, x0, y0, x1, y1, t)
MISSILES = [
    ("bolt", 440, 226, 560, 200, 0.45), ("bolt", 452, 258, 575, 240, 0.7),
    ("arrow", 670, 186, 520, 196, 0.35), ("arrow", 684, 212, 512, 226, 0.55),
    ("arrow", 662, 238, 505, 262, 0.25), ("arrow", 690, 262, 520, 282, 0.65),
    ("stone", 338, 196, 640, 228, 0.55), ("stone", 770, 232, 470, 214, 0.4),
]

# battlefield dirt patch (trampled ground) as an ellipse in screen pt
BATTLEFIELD = dict(x=560, y=230, rx=250, ry=105)
PATHS = [  # dirt road from the gate toward the town, polyline in pt
    [(150, 196), (260, 196), (380, 176), (520, 128), (640, 118), (720, 124)],
]

# the camera frame shown on the minimap, as a fraction of the map
MINIMAP_VIEW = dict(x=0.22, y=0.34, w=0.30, h=0.16)


def units_by_kind():
    out = {}
    for u in UNITS:
        out.setdefault(u[0], []).append(u)
    return out


def needed_sprites():
    """(kind, facing, animation, frame, variant) tuples the mockup needs."""
    need = set()
    for kind, x, y, facing, (anim, frame), variant in UNITS:
        need.add((kind, facing, anim, frame, variant))
    return sorted(need)
