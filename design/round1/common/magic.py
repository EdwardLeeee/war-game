"""Battle effects drawn in 2D (all options share the geometry, not the look).

style keys:
  line      outline colour (None = no outline)          e.g. A uses a dark outline
  crystal   magic colour (the 魔晶 cyan)
  ring_w    warning-circle line width (pt)
  dust      dust colour
  ink       True = brushy ink strokes (C)
"""
import math
import random

import cairo

import compose
import scene

CRYSTAL = (90 / 255, 242 / 255, 255 / 255)


def warning_circle(ctx, st, pulse=1.0):
    c = scene.WARN_CIRCLE
    cx, cy, rx, ry = c["x"], c["y"], c["rx"], c["ry"]
    col = st.get("crystal", CRYSTAL)
    warn = st.get("warn", (1.0, 0.42, 0.25))
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(1, ry / rx)
    # translucent fill with a darker centre so the enemy sees the target
    g = cairo.RadialGradient(0, 0, 0, 0, 0, rx)
    g.add_color_stop_rgba(0, *warn, 0.10 * pulse)
    g.add_color_stop_rgba(0.75, *warn, 0.18 * pulse)
    g.add_color_stop_rgba(1, *warn, 0.34 * pulse)
    ctx.arc(0, 0, rx, 0, 2 * math.pi)
    ctx.set_source(g)
    ctx.fill()
    lw = st.get("ring_w", 2.2)
    if st.get("line"):
        ctx.set_source_rgba(*st["line"], 0.9)
        ctx.set_line_width(lw + 2.2)
        ctx.arc(0, 0, rx, 0, 2 * math.pi)
        ctx.stroke()
    ctx.set_source_rgba(*warn, 0.95)
    ctx.set_line_width(lw)
    if st.get("ink"):
        ctx.set_dash([10, 3, 4, 3])
    ctx.arc(0, 0, rx, 0, 2 * math.pi)
    ctx.stroke()
    ctx.set_dash([])
    # inner rune ring (crystal colour): the caster's calibration marks
    ctx.set_source_rgba(*col, 0.95)
    ctx.set_line_width(lw * 0.6)
    ctx.arc(0, 0, rx * 0.72, 0, 2 * math.pi)
    ctx.stroke()
    for k in range(16):
        a = 2 * math.pi * k / 16 + 0.1
        r0, r1 = rx * 0.72, rx * (0.84 if k % 4 == 0 else 0.78)
        ctx.move_to(r0 * math.cos(a), r0 * math.sin(a))
        ctx.line_to(r1 * math.cos(a), r1 * math.sin(a))
    ctx.set_line_width(lw * 0.7)
    ctx.stroke()
    # crosshair
    ctx.set_source_rgba(*warn, 0.8)
    ctx.set_line_width(lw * 0.6)
    for a in (0, math.pi / 2, math.pi, 3 * math.pi / 2):
        ctx.move_to(rx * 0.18 * math.cos(a), rx * 0.18 * math.sin(a))
        ctx.line_to(rx * 0.42 * math.cos(a), rx * 0.42 * math.sin(a))
    ctx.stroke()
    ctx.restore()


def cannon(ctx, st, start, glow_ctx=None):
    """晶砲 in flight from the sigil (start, pt) to the warning circle."""
    c = scene.WARN_CIRCLE
    end = (c["x"], c["y"] - 4)
    ctrl = compose.arc_ctrl(start[0], start[1], end[0], end[1], 70)
    t_head = scene.BOLT_T
    col = st.get("crystal", CRYSTAL)
    pts = [compose.bezier_point(start, ctrl, end, t_head * k / 40) for k in range(41)]
    for target, scale in ((ctx, 1.0),) + (((glow_ctx, 1.6),) if glow_ctx else ()):
        # trail: widening toward the head
        for k in range(1, len(pts)):
            f = k / len(pts)
            target.set_source_rgba(*col, 0.15 + 0.6 * f)
            target.set_line_width((0.8 + 4.2 * f) * scale)
            target.set_line_cap(cairo.LINE_CAP_ROUND)
            target.move_to(*pts[k - 1])
            target.line_to(*pts[k])
            target.stroke()
        hx, hy = pts[-1]
        g = cairo.RadialGradient(hx, hy, 0, hx, hy, 9 * scale)
        g.add_color_stop_rgba(0, 1, 1, 1, 1)
        g.add_color_stop_rgba(0.35, *col, 0.95)
        g.add_color_stop_rgba(1, *col, 0)
        target.set_source(g)
        target.arc(hx, hy, 9 * scale, 0, 2 * math.pi)
        target.fill()
    if st.get("line"):
        hx, hy = pts[-1]
        ctx.set_source_rgba(*st["line"], 0.9)
        ctx.set_line_width(1.2)
        ctx.arc(hx, hy, 4.2, 0, 2 * math.pi)
        ctx.stroke()


def missiles(ctx, st):
    line = st.get("line")
    for kind, x0, y0, x1, y1, t in scene.MISSILES:
        lift = {"arrow": 28, "bolt": 14, "stone": 60}[kind]
        ctrl = compose.arc_ctrl(x0, y0 - 18, x1, y1 - 6, lift)
        p = compose.bezier_point((x0, y0 - 18), ctrl, (x1, y1 - 6), t)
        q = compose.bezier_point((x0, y0 - 18), ctrl, (x1, y1 - 6), max(0, t - 0.04))
        dx, dy = p[0] - q[0], p[1] - q[1]
        n = math.hypot(dx, dy) or 1
        dx, dy = dx / n, dy / n
        if kind == "stone":
            # motion streak then the stone
            for k in range(8):
                f = k / 8
                ctx.set_source_rgba(0.35, 0.3, 0.25, 0.08 + 0.1 * f)
                ctx.arc(p[0] - dx * (20 - 20 * f), p[1] - dy * (20 - 20 * f), 1.6 + 1.2 * f, 0, 2 * math.pi)
                ctx.fill()
            if line:
                ctx.set_source_rgba(*line, 1)
                ctx.arc(p[0], p[1], 3.6, 0, 2 * math.pi)
                ctx.fill()
            ctx.set_source_rgba(*st.get("stone", (0.42, 0.38, 0.34)), 1)
            ctx.arc(p[0], p[1], 2.8, 0, 2 * math.pi)
            ctx.fill()
            continue
        L = 8 if kind == "arrow" else 5.5
        wdt = 0.9 if kind == "arrow" else 1.3
        if line:
            ctx.set_source_rgba(*line, 0.85)
            ctx.set_line_width(wdt + 1.2)
            ctx.move_to(p[0] - dx * L, p[1] - dy * L)
            ctx.line_to(p[0], p[1])
            ctx.stroke()
        ctx.set_source_rgba(*st.get("shaft", (0.35, 0.25, 0.15)), 1)
        ctx.set_line_width(wdt)
        ctx.move_to(p[0] - dx * L, p[1] - dy * L)
        ctx.line_to(p[0], p[1])
        ctx.stroke()
        # fletching (light) at the tail
        ctx.set_source_rgba(*st.get("fletch", (0.92, 0.9, 0.85)), 1)
        ctx.set_line_width(wdt + 0.6)
        ctx.move_to(p[0] - dx * L, p[1] - dy * L)
        ctx.line_to(p[0] - dx * (L - 2), p[1] - dy * (L - 2))
        ctx.stroke()


def dust(ctx, st, seed=3):
    """Dust and grit along the melee line and where stones land."""
    rnd = random.Random(seed)
    col = st.get("dust", (0.72, 0.62, 0.46))
    spots = [(548, 190), (552, 214), (546, 238), (556, 262), (550, 286), (560, 305), (560, 150), (545, 168),
             (470, 222), (640, 232)]
    for sx, sy in spots:
        big = (sx, sy) in ((470, 222), (640, 232))
        for k in range(14 if big else 7):
            r = rnd.uniform(4, 11) * (1.6 if big else 1)
            x = sx + rnd.uniform(-10, 10) * (1.6 if big else 1)
            y = sy + rnd.uniform(-10, 3)
            g = cairo.RadialGradient(x, y, 0, x, y, r)
            a = st.get("dust_alpha", 0.22)
            g.add_color_stop_rgba(0, *col, a)
            g.add_color_stop_rgba(1, *col, 0)
            ctx.set_source(g)
            ctx.save()
            ctx.translate(x, y)
            ctx.scale(1, 0.7)
            ctx.translate(-x, -y)
            ctx.arc(x, y, r, 0, 2 * math.pi)
            ctx.fill()
            ctx.restore()


def sparks(ctx, st, seed=5):
    """Tiny bright glints where weapons meet (kept small: they are noise, not a focus)."""
    rnd = random.Random(seed)
    col = st.get("spark", (1, 0.93, 0.7))
    for sx, sy in [(548, 176), (546, 226), (548, 274), (560, 136)]:
        for k in range(3):
            x, y = sx + rnd.uniform(-3, 3), sy - 16 + rnd.uniform(-3, 3)
            g = cairo.RadialGradient(x, y, 0, x, y, 2.2)
            g.add_color_stop_rgba(0, *col, 0.95)
            g.add_color_stop_rgba(1, *col, 0)
            ctx.set_source(g)
            ctx.arc(x, y, 2.2, 0, 2 * math.pi)
            ctx.fill()
