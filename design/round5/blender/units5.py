"""R5 models: the West mage designs (R5-01) and the level-C roster (R5-02)."""
import mage5


def build(kind, variant=0, mage_style=None):
    if kind == "mage_w":
        return mage5.build(mage_style)
    if kind == "mage_e" and mage_style in ("TA", "TB", "TC"):
        import mage4
        return mage4.build(mage_style)
    import roster5
    if kind in roster5.BUILDERS or (kind == "spear_e" and variant == 1):
        return roster5.build(kind, variant)
    import units3
    return units3.build(kind, variant, mage_style)
