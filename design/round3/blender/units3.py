"""R3 models: R2 level-C units, with the riders' legs fixed and the new mage designs.

The R2 riders were built without the seated leg pose, so their legs hung straight down
inside the horse. Here the thighs go forward and out around the barrel and the lower legs
hang outside the caparison, with stirrups.
"""
import lib
import mage3
import units2
from lib import lathe, rod

SEAT = {"hipR": (65, -25, -40), "hipL": (65, 25, 40), "kneeR": (-80, 0, 0), "kneeL": (-80, 0, 0),
        "ankleR": (12, 0, 0), "ankleL": (12, 0, 0)}


def build_cav_fixed(kind):
    P = units2.palette("C")
    u = units2.build_cav(kind, P, "C")
    rider = u.rigs["body"]
    rider.rest.update(SEAT)
    iron = lib.mat("stirrup3", (0.35, 0.35, 0.37), 0.4, 1.0)
    strap = lib.mat("stirrupstrap3", (0.18, 0.11, 0.06), 0.6)
    for side, s in (("R", 1), ("L", -1)):
        an = rider.j["ankle" + side]
        lathe(f"{kind}_stirrup{side}", [(0.05, -0.1), (0.055, -0.08)], iron, an, segs=12, at=(0, 0.04, 0))
        rod(f"{kind}_leather{side}", (0, 0.02, -0.06), (0, -0.02, 0.35), 0.01, strap, parent=an)
    return u


def build(kind, variant=0, mage_style=None, legs_fixed=True):
    if kind == "mage_e" and mage_style in ("0", "A", "B", "C"):
        return mage3.build(mage_style)
    if kind in ("hcav_e", "knight_w") and legs_fixed:
        return build_cav_fixed(kind)
    return units2.build(kind, variant, detail="C")
