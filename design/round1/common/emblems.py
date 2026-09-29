"""Faction emblems (white on transparent) used on flags and shields.

南溟 = 白鶴 (a crane in flight), 布倫莫爾王國 = 雙塔 (two towers).
Both are original shapes drawn here; they must read at ~12 px.
"""
import math
import sys
from pathlib import Path

import cairo


def crane(ctx, s):
    """Crane seen from the side, wings raised, long neck forward (s = size)."""
    ctx.save()
    ctx.scale(s / 100, s / 100)
    # body
    ctx.move_to(30, 58)
    ctx.curve_to(40, 50, 58, 50, 66, 56)
    ctx.curve_to(60, 64, 44, 68, 30, 62)
    ctx.close_path()
    ctx.fill()
    # neck and head, reaching forward-up
    ctx.set_line_width(5)
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    ctx.move_to(62, 56)
    ctx.curve_to(74, 50, 78, 36, 84, 30)
    ctx.stroke()
    ctx.arc(85, 29, 4.2, 0, 2 * math.pi)
    ctx.fill()
    ctx.move_to(87, 27)   # beak
    ctx.line_to(99, 31)
    ctx.line_to(87, 32)
    ctx.close_path()
    ctx.fill()
    # raised wings (two swept blades)
    ctx.move_to(38, 54)
    ctx.curve_to(30, 36, 22, 20, 6, 10)
    ctx.curve_to(26, 16, 44, 28, 54, 50)
    ctx.close_path()
    ctx.fill()
    ctx.move_to(46, 52)
    ctx.curve_to(46, 34, 44, 18, 36, 4)
    ctx.curve_to(52, 16, 60, 32, 60, 52)
    ctx.close_path()
    ctx.fill()
    # trailing legs
    ctx.set_line_width(3)
    ctx.move_to(32, 62)
    ctx.line_to(12, 76)
    ctx.move_to(36, 63)
    ctx.line_to(18, 80)
    ctx.stroke()
    ctx.restore()


def twin_towers(ctx, s):
    """Two separate tapering towers on a mound, each with battlements, a pennant
    and an arched door; nothing joins them in the middle, so it never reads as 'H'
    (s = size)."""
    ctx.save()
    ctx.scale(s / 100, s / 100)
    # the mound both towers stand on (a curve, not a bar)
    ctx.move_to(4, 96)
    ctx.curve_to(20, 84, 80, 84, 96, 96)
    ctx.close_path()
    ctx.fill()
    for cx, top in ((29, 30), (71, 24)):          # the right tower is a little taller
        # tapering body
        ctx.move_to(cx - 15, 90)
        ctx.line_to(cx - 11, top + 10)
        ctx.line_to(cx + 11, top + 10)
        ctx.line_to(cx + 15, 90)
        ctx.close_path()
        ctx.fill()
        # overhanging battlement band with three merlons
        ctx.rectangle(cx - 14, top + 4, 28, 8)
        for k in (-1, 0, 1):
            ctx.rectangle(cx + k * 10 - 3.5, top - 4, 7, 9)
        ctx.fill()
        # pennant on a pole
        ctx.set_line_width(2.2)
        ctx.move_to(cx, top - 4)
        ctx.line_to(cx, top - 20)
        ctx.stroke()
        ctx.move_to(cx, top - 20)
        ctx.line_to(cx + 12, top - 16)
        ctx.line_to(cx, top - 12)
        ctx.close_path()
        ctx.fill()
    ctx.set_operator(cairo.OPERATOR_CLEAR)
    for cx, top in ((29, 30), (71, 24)):
        ctx.arc(cx, 79, 5, math.pi, 0)            # arched door
        ctx.rectangle(cx - 5, 79, 10, 12)
        ctx.rectangle(cx - 2, top + 20, 4, 10)    # arrow slit
        ctx.fill()
    ctx.restore()


EMBLEMS = {"crane": crane, "twintowers": twin_towers}


def render(name, size=256, color=(1, 1, 1), path=None, pad=0.1):
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, size, size)
    ctx = cairo.Context(surf)
    ctx.set_source_rgb(*color)
    ctx.translate(size * pad, size * pad)
    EMBLEMS[name](ctx, size * (1 - 2 * pad))
    if path:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        surf.write_to_png(str(path))
    return surf


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "build/emblems")
    for n in EMBLEMS:
        render(n, path=out / f"{n}.png")
        print("wrote", out / f"{n}.png")
