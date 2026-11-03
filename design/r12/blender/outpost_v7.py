"""art-v7's 哨所 (D-119, 3 x 3): R12's A 敵臺門洞 as the user chose it (2026-11-04, ceo: 「a比較好，東陸不要有那個亭子。
西陸不要有前面那個咖啡色的東西。我覺得駐守的話站在城上面吧」): the two battered halves round the passage, the walk over it,
the parapet; no 戰棚 on the East's walk, no timber hoarding over the West's front.

The men holding it stand on the walk (not drawn in): the client draws its own spearmen there, as on the castles' walls
(D-096), at the stand_at_<k> marks, between the piece and its front layer (`front=True`: only what stands in front of
a man on the walk, castle.front_only). look: "done", "damaged" (R12's: merlons gone, scorch, fire), "build" (R12's half
height under scaffolding); the other states (build1, build3, rubble) come from states.apply on the finished look.
"""
import outpost3_r12 as O
import states
import castle
from arch_r8 import palette

import math

SPOTS = 9                          # the client draws up to nine hidden spearmen on the walk (client 2026-11-04)


def v7_outpost(root, c="E", look="done", front=False):
    st = {"done": "done", "damaged": "damaged", "build": "build"}[look]
    O.opt_a(root, c, st)
    for ob in list(O.kit.parts_under(root)):
        if ob.name.startswith(("a_hut", "a_hoard")):          # the user: no 戰棚 (East), no hoarding (West)
            states._drop(ob)
    if look == "build":
        return
    H = 2.6 if c == "E" else 2.8
    tw, td = O.W - 2 * H / (5.0 if c == "E" else 12.0), O.D - 2 * H / (5.0 if c == "E" else 12.0)
    # where the men stand: a grid on the walk, nearest the camera first (the client fills the first n: the seen side
    # first), stand_at_0 .. stand_at_8
    z = H + 0.07
    az = math.radians(O.lib.CAM_AZ)
    fx, fy = -math.sin(az), math.cos(az)                  # away from the camera, on the ground
    grid = [(x, y, z) for x in [-tw / 2 + 0.55 + k * (tw - 1.1) / 3 for k in range(4)]
            for y in (-td / 2 + 0.55, 0.0, td / 2 - 0.55)]
    spots = sorted(grid, key=lambda p: (round(p[0] * fx + p[1] * fy, 3), p[0]))[:SPOTS]
    for k, at in enumerate(spots):
        O.lib.empty(f"stand_at_{k}", parent=root, loc=at)
    if front:
        castle.front_only(root, [list(s) for s in spots], z)


FOOTPRINT = {"v7_outpost": (3, 3)}
BUILDERS = {"v7_outpost": v7_outpost}
