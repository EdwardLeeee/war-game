"""The camera projection on the host side (the same as lib.Camera): ground and world points to
pixels of a rendered frame, and the cell grid drawn under a building."""
import math

import numpy as np

D2R = math.pi / 180


def _rot():
    ax, az = 60 * D2R, -45 * D2R
    rx = np.array([[1, 0, 0], [0, math.cos(ax), -math.sin(ax)], [0, math.sin(ax), math.cos(ax)]])
    rz = np.array([[math.cos(az), -math.sin(az), 0], [math.sin(az), math.cos(az), 0], [0, 0, 1]])
    return rz @ rx


RM = _rot()
RIGHT = RM @ np.array([1.0, 0, 0])
UP = RM @ np.array([0, 1.0, 0])


def to_px(p, anchor, ppm):
    """World point (x, y, z) metres -> pixel (x, y) in a frame whose anchor is the world origin."""
    p = np.asarray(p, float)
    if p.shape[-1] == 2:
        p = np.append(p, 0.0)
    return anchor[0] + ppm * float(p @ RIGHT), anchor[1] - ppm * float(p @ UP)


def grid_lines(fx, fy, cell, extra=0):
    """Line segments (world, on the ground) of the cell grid covering the footprint, plus `extra` cells around."""
    hx, hy = fx * cell / 2, fy * cell / 2
    segs = []
    for i in range(-extra, fx + extra + 1):
        x = -hx + i * cell
        segs.append(((x, -hy - extra * cell), (x, hy + extra * cell)))
    for j in range(-extra, fy + extra + 1):
        y = -hy + j * cell
        segs.append(((-hx - extra * cell, y), (hx + extra * cell, y)))
    return segs
