"""R9-04 (the user 2026-11-01: 「為啥我們的地圖是長方形的？建築也是」, and napali's realism): the East main city as a
州府 compound whose outline is not the 4 x 4 square it stands on: a hall on a narrower platform, a drum tower on a
battered earth base at the front-left corner rising above the hall's eaves, a lower side hall turned across at the
back-right, a pine leaning in behind, the eaves running out past the platform; no paved square under it all (the ground
shows between). East references: 佛光寺東大殿 (deep eaves, red ochre columns, plaster), 莫高窟 61 窟五臺山圖 (corner
towers on earth bases), 南禪寺 (three bays, 歇山).

Footprint 4 x 4 (8 m) as the sim's; the parts stay inside it except the eaves and the pine's crown.
"""
import lib
from lib import box, cyl
import kit
import nature_r8
from arch_r8 import palette, platform_e, hall_e, tang_roof, war_drum, _team_hangings_e


def drum_tower(P, root, x, y, base_h=3.4, base_w=2.1):
    """鼓樓: a battered rammed-earth base with a brick skirt, a small open pavilion on it, the drum inside, a hip roof."""
    g = lib.empty("mt", parent=root, loc=(x, y, 0.0))
    box("mt_base", (base_w, base_w, base_h), P["earth"], g, loc=(0, 0, base_h / 2), bevel=0.04, taper=(0.86, 0.86))
    box("mt_skirt", (base_w + 0.12, base_w + 0.12, 0.35), P["brick"], g, loc=(0, 0, 0.17), bevel=0.02)
    top = lib.empty("mt_top", parent=g, loc=(0, 0, base_h))
    box("mt_floor", (base_w * 0.92, base_w * 0.92, 0.12), P["timber"], top, loc=(0, 0, 0.06))
    s, ch = 0.6, 1.5
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(f"mt_col{sx}{sy}", 0.09, ch, P["red"], top, loc=(sx * s, sy * s, 0.12), segs=10)
    for k, (sx, sy, w, d) in enumerate(((0, -1, 2 * s + 0.2, 0.14), (0, 1, 2 * s + 0.2, 0.14), (-1, 0, 0.14, 2 * s + 0.2), (1, 0, 0.14, 2 * s + 0.2))):
        box(f"mt_lin{k}", (w, d, 0.18), P["red"], top, loc=(sx * s, sy * s, 0.12 + ch - 0.09))
        box(f"mt_rail{k}", (w, d * 0.7, 0.08), P["timber"], top, loc=(sx * s, sy * s, 0.6))
    drum = lib.empty("mt_drum_at", parent=top, loc=(0, 0.05, 0.12))
    war_drum("mt_drum", P, drum, 0.0, 0.0, r=0.3, h=0.18)
    tang_roof("mt_roof", P, top, 0, 0, 0.12 + ch, 2 * s, 2 * s, 0.85, 0.62, kind="wudian", lift=0.12, chiwei=False,
              tile_pitch=0.22, tile_amp=0.03)
    return g


def r9_main_city(root, c="E"):
    P = palette(c)
    # fired grey tiles, matte (the R8 tile caught the sky like plastic at this camera)
    P["tile"] = lib.mat("tilegrey_r9", (0.075, 0.078, 0.082), 0.88, noise=0.18, noise_scale=9)
    P["ridge"] = lib.mat("ridgegrey_r9", (0.05, 0.05, 0.055), 0.85)
    # the forecourt is beaten earth (the ground), only a stone apron before the steps
    box("mc_apron", (2.6, 1.4, 0.06), P["pave"], root, loc=(0.3, -2.75, 0.03), bevel=0.01)
    platform_e("mc_plat", P, root, 6.4, 4.4, 1.0, cy=1.0, steps=2.0)
    hall = lib.empty("mc_hall_at", parent=root, loc=(0.3, 0.0, 0.0))
    w, d, top = hall_e("mc_hall", P, hall, 0, 1.05, 1.0, (1.7, 2.2, 1.7), (1.7, 1.7), 2.85, 0.23, 1.35, qizhu=True)
    tang_roof("mc_roof", P, hall, 0, 1.05, 1.0 + top, w + 0.5, d + 0.5, 1.6, 1.35, kind="xieshan", lift=0.09, chiwei=True,
              chiwei_s=1.1, tile_pitch=0.3, tile_amp=0.05)
    _team_hangings_e(P, hall, (-2.0, 2.0), 1.05 - d / 2 - 0.2, 1.0 + 2.75, w=0.6, h=1.5)
    # the side hall at the right, its ridge across (north-south), its gable to the camera: the outline steps down and turns
    side = lib.empty("mc_side_at", parent=root, loc=(3.1, -0.9, 0.0), rot=(0, 0, 90))
    platform_e("ms_plat", P, side, 3.0, 1.9, 0.45, steps=0)
    ws, ds, ts = hall_e("ms_hall", P, side, 0, 0, 0.45, (1.35, 1.35), (1.3,), 2.15, 0.17, 0.9, front_door=False)
    tang_roof("ms_roof", P, side, 0, 0, 0.45 + ts, ws + 0.3, ds + 0.3, 1.0, 0.75, kind="xuanshan", lift=0.0, chiwei=False,
              tile_pitch=0.25, tile_amp=0.03)
    drum_tower(P, root, -2.9, -2.3)
    # a pine leaning in behind the right of the hall, over the side hall's roof
    pine = lib.empty("mc_pine_at", parent=root, loc=(3.3, 2.9, 0.0))
    nature_r8.tree(pine, c, 1, "full")
    # stone lanterns before the steps, the owner's banner at the front-right corner
    for sx in (-1, 1):
        x = 0.3 + sx * 1.55
        cyl(f"mc_lamp{sx}", 0.17, 0.95, P["stone"], root, loc=(x, -2.95, 0.0), r2=0.12, segs=8)
        box(f"mc_lampbox{sx}", (0.34, 0.34, 0.34), P["stone"], root, loc=(x, -2.95, 1.12), bevel=0.03)
    kit.flag("mc_flag", P, root, (1.9, -3.4, 0.0), 5.8, c, w=1.2, fh=1.8)
    for k, (x, y, z) in enumerate(((-1.6, -0.9, 3.0), (2.2, -0.9, 3.0), (-2.9, -2.95, 4.3))):
        lib.empty(f"shoot_at_{k}", parent=root, loc=(x, y, z))


FOOTPRINT = {"r9_main_city": (4, 4)}
BUILDERS = {"r9_main_city": r9_main_city}
