"""R5 models: the West mage designs (R5-01) and the level-C roster (R5-02)."""
import mage5


def build(kind, variant=0, mage_style=None):
    if kind == "mage_w":
        return mage5.build(mage_style)
    import units3
    return units3.build(kind, variant, mage_style)
