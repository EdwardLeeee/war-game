"""R7 (D-092) on the production unit renders (design/production/blender/render_units.py, R7_VERSION set): the units
of style-test-1 in a realism version's look, through the production passes (colour, player-colour mask, shadow, AO)
so the client gets the art-vN atlas format. Version 1: textured materials, the head at 0.88; version 2: the MPFB body
(human_r7). Both: the R7 light (look.lights), kept through lib.set_pass, which resets the world and the view.
"""
import gc
import os

import bpy
import numpy as np

import body2
import lib
import look

TEAM_TUNIC = ()                    # R8: the units whose tunic is in the player's colour (decided by the measurement)
GROUND_RES = ("leafy_grass", "aerial_grass_rock", "stony_dirt_path", "gravel_ground_01", "brown_mud_rocks_01")


def tex_path(tid, k):
    res = "2k" if tid in GROUND_RES else "1k"
    return os.path.join(os.environ["R7_TEX"], f"{tid}_{k}_{res}.jpg")


def apply(u, kind, version):
    sks = [o for o in gc.get_objects() if isinstance(o, body2.Skinner)]
    if version == 1:
        u.rigs["body"].j["head"].scale = (0.88, 0.88, 0.88)
    if version in (2, 8):
        import human_r7
        if version == 8:                           # R8 (D-093): design/r8/blender/r8.py
            import sys
            sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "r8", "blender"))
            human_r7.GRIP = True
        more, _ = human_r7.dress(u, kind, team_tunic=version == 8 and kind in TEAM_TUNIC)
        sks += more
    if version == 8:
        import r8
        if kind in r8.BOWS:
            r8.bow_string(u, kind)
    look.rest_coords(sks)
    for ob in bpy.data.objects:
        if ob.type == "MESH" and "rest" not in ob.data.attributes:
            me = ob.data
            co = np.empty(len(me.vertices) * 3, np.float32)
            me.vertices.foreach_get("co", co)
            me.attributes.new("rest", "FLOAT_VECTOR", "POINT").data.foreach_set("vector", co)
    look.realistic(tex_path, dirt=0.35, skinned_attr="rest")
    look.lights()
    if version == 8:
        import r8
        r8.rim()
    world = bpy.context.scene.world
    orig = lib.set_pass

    def set_pass(name, samples=None):
        orig(name, samples)
        if name == "beauty":
            bpy.context.scene.view_settings.look = "AgX - Medium High Contrast"
        if name in ("beauty", "shadow"):
            lib.world_color((0.62, 0.72, 0.88), 0.38)
            lib.LIGHTS["neutral"].hide_render = True
    lib.set_pass = set_pass
    return world
