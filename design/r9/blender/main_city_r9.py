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


def rammed_earth():
    """夯土: ochre loess in tamped courses about 10 cm deep, each course a little lighter or darker, darker and damp
    toward the foot (a node material of its own: look.realistic does not texture it)."""
    if "rammed_r9" in lib.MATS:
        return lib.MATS["rammed_r9"]["mat"]
    m = lib.mat("rammed_r9", (0.46, 0.34, 0.2), 0.95)
    nt = m.node_tree
    p = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    for n in list(nt.nodes):
        if n.bl_idname not in ("ShaderNodeBsdfPrincipled", "ShaderNodeOutputMaterial"):
            nt.nodes.remove(n)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    wave = nt.nodes.new("ShaderNodeTexWave")             # the courses: bands along z, a little wavy
    wave.wave_type = "BANDS"
    wave.bands_direction = "Z"
    wave.inputs["Scale"].default_value = 5.0
    wave.inputs["Distortion"].default_value = 1.5
    wave.inputs["Detail"].default_value = 3.0
    nt.links.new(tc.outputs["Object"], wave.inputs["Vector"])
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 14.0
    nz.inputs["Detail"].default_value = 8.0
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.30, 0.21, 0.12, 1)
    ramp.color_ramp.elements[1].color = (0.52, 0.40, 0.25, 1)
    mixf = nt.nodes.new("ShaderNodeMath")
    mixf.operation = "MULTIPLY_ADD"
    nt.links.new(wave.outputs["Fac"], mixf.inputs[0])
    mixf.inputs[1].default_value = 0.35
    nt.links.new(nz.outputs["Fac"], mixf.inputs[2])
    nt.links.new(mixf.outputs[0], ramp.inputs["Fac"])
    foot = nt.nodes.new("ShaderNodeMapRange")            # damp at the foot: the lowest 0.5 m darker
    nt.links.new(sep.outputs["Z"], foot.inputs["Value"])
    foot.inputs["From Min"].default_value = -1.6
    foot.inputs["From Max"].default_value = -1.0
    foot.inputs["To Min"].default_value = 0.6
    foot.inputs["To Max"].default_value = 1.0
    sc = nt.nodes.new("ShaderNodeVectorMath")
    sc.operation = "SCALE"
    nt.links.new(ramp.outputs["Color"], sc.inputs[0])
    nt.links.new(foot.outputs["Result"], [i for i in sc.inputs if i.name == "Scale"][0])
    nt.links.new(sc.outputs["Vector"], p.inputs["Base Color"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.5
    bump.inputs["Distance"].default_value = 0.01
    nt.links.new(mixf.outputs[0], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], p.inputs["Normal"])
    return m


def drum_tower(P, root, x, y, base_h=3.2, base_w=1.8):
    """鼓樓: a battered rammed-earth base (墩台), a stair up its side, a small open pavilion on it, the drum inside."""
    g = lib.empty("mt", parent=root, loc=(x, y, 0.0))
    box("mt_base", (base_w, base_w, base_h), rammed_earth(), g, loc=(0, 0, base_h / 2), bevel=0.04, taper=(0.8, 0.8))
    for k in range(int(base_h / 0.25)):                   # a timber stair up the east side
        box(f"mt_st{k}", (0.45, 0.28, 0.06), P["timber"], g,
            loc=(base_w / 2 + 0.02 - k * 0.025, -base_w / 2 + 0.2 + k * 0.11, 0.2 + k * 0.25))
    top = lib.empty("mt_top", parent=g, loc=(0, 0, base_h))
    box("mt_floor", (base_w * 0.82, base_w * 0.82, 0.12), P["timber"], top, loc=(0, 0, 0.06))
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
              tile_pitch=0.18, tile_amp=0.025, fine=True)
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
              chiwei_s=1.1, tile_pitch=0.2, tile_amp=0.04, fine=True)
    _team_hangings_e(P, hall, (-2.0, 2.0), 1.05 - d / 2 - 0.2, 1.0 + 2.75, w=0.6, h=1.5)
    # the side hall at the right, its ridge across (north-south), its gable to the camera: the outline steps down and turns
    side = lib.empty("mc_side_at", parent=root, loc=(3.1, -0.9, 0.0), rot=(0, 0, 90))
    platform_e("ms_plat", P, side, 3.0, 1.9, 0.45, steps=0)
    ws, ds, ts = hall_e("ms_hall", P, side, 0, 0, 0.45, (1.35, 1.35), (1.3,), 2.15, 0.17, 0.9, front_door=False, walls=False)
    tang_roof("ms_roof", P, side, 0, 0, 0.45 + ts, ws + 0.3, ds + 0.3, 1.0, 0.75, kind="xuanshan", lift=0.0, chiwei=False,
              tile_pitch=0.18, tile_amp=0.03, fine=True)
    # its end toward the camera: a 直櫺窗 (upright bars) in the plaster between the posts, not a blank panel
    xe = -ws / 2 - 0.03
    box("ms_win", (0.04, 1.0, 0.75), P["dark"], side, loc=(xe, 0, 0.45 + 1.25), bevel=0.0)
    for k in range(9):
        box(f"ms_bar{k}", (0.05, 0.035, 0.75), P["lattice"], side, loc=(xe - 0.02, -0.44 + k * 0.11, 0.45 + 1.25))
    box("ms_winf", (0.06, 1.1, 0.08), P["red"], side, loc=(xe - 0.02, 0, 0.45 + 1.66))
    box("ms_winf2", (0.06, 1.1, 0.08), P["red"], side, loc=(xe - 0.02, 0, 0.45 + 0.84))
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
