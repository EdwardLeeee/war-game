"""Lay out the shared battle scene with any option's sprites.

An option supplies a `Source` with:
  sprite(obj) -> (compose.Sprite, flip) or None     main image (already recoloured)
  shadow(obj) -> (compose.Sprite, flip) or None     ground shadow (drawn first)
  fx(obj)     -> (compose.Sprite, flip) or None     emissive effect drawn right after obj
obj is a dict: kind, x, y, facing, anim, frame, variant, team, cat (unit/building/tree/decal).
"""
import compose
import scene


def objects():
    objs = []
    for kind, x, y, facing, (anim, frame), variant in scene.UNITS:
        objs.append(dict(kind=kind, x=x, y=y, facing=facing, anim=anim, frame=frame, variant=variant,
                         team=scene.TEAM_OF[kind[-1]], cat="unit"))
    for kind, x, y, variant in scene.BUILDINGS:
        team = {"citygate_e": "blue", "town_e": "blue", "tower_w": "red"}.get(kind)
        objs.append(dict(kind=kind, x=x, y=y, facing=0, anim="idle", frame=0, variant=variant, team=team,
                         cat="building"))
    for x, y, variant in scene.TREES:
        objs.append(dict(kind="tree", x=x, y=y, facing=0, anim="idle", frame=0, variant=variant, team=None,
                         cat="tree"))
    for kind, x, y in scene.DECALS:
        objs.append(dict(kind=kind, x=x, y=y, facing=0, anim="idle", frame=0, variant=0, team=None, cat="decal"))
    return objs


def draw(canvas, src, ground_fx=None, depth_bias=None):
    """Composite shadows, ground effects, then every object back to front."""
    objs = objects()
    depth_bias = depth_bias or {}
    for o in objs:
        sh = src.shadow(o)
        if sh:
            compose.place(canvas, sh[0], o["x"], o["y"], flip=sh[1])
    if ground_fx:
        ground_fx(canvas)
    decals = [o for o in objs if o["cat"] == "decal"]
    for o in decals:
        sp = src.sprite(o)
        if sp:
            compose.place(canvas, sp[0], o["x"], o["y"], flip=sp[1])
    rest = [o for o in objs if o["cat"] != "decal"]
    rest.sort(key=lambda o: o["y"] + depth_bias.get(o["kind"], 0))
    for o in rest:
        sp = src.sprite(o)
        if sp:
            compose.place(canvas, sp[0], o["x"], o["y"], flip=sp[1])
        fx = src.fx(o)
        if fx:
            compose.place(canvas, fx[0], o["x"], o["y"], flip=fx[1])
    return canvas
