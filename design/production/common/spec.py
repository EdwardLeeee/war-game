"""Production spec for the 12 approved units (D-021): what to render, how many frames, which
facings are rendered and which are mirrored at run time.

Frame counts per facing follow the R1 production estimate (design/round1/common/prodnotes.py):
idle 8, walk 8, attack 10, death 10; farmers add four work loops of 8; mages use R1's full
sequence (idle 12, walk 12, cast 30, hit 6, shatter 8, fall 12, dead 4).

An animation the model does not have yet is rendered from a stand-in animation and marked
`placeholder`, so the pipeline, the checks and the atlas are complete now and only the poses
change later (new animations need the user's approval first: ceo 2026-09-30).
"""

# facings: 0 = screen right, 2 = away from the camera, 4 = left, 6 = toward the camera.
# 3, 4 and 5 are the mirror images of 1, 0 and 7 (reflection about the screen's vertical axis).
RENDERED_FACINGS = [0, 1, 2, 6, 7]
MIRRORED = {3: 1, 4: 0, 5: 7}
ALL_FACINGS = sorted(RENDERED_FACINGS + list(MIRRORED))

PASSES = ["beauty", "mask", "shadow", "ao"]
MAGE_PASSES = PASSES + ["fx"]
# the sun comes from one side, so a mirrored sprite would throw its shadow the wrong way:
# shadows are rendered for every facing, colour and mask only for RENDERED_FACINGS
MIRROR_PASSES = ["shadow"]


def _std(attack_src="attack", death_real=True, walk_real=True, attack_real=True):
    """(name, frames, source animation, placeholder) for a unit with the standard four actions."""
    return [("idle", 8, "idle", False),
            ("walk", 8, "walk" if walk_real else "idle", not walk_real),
            ("attack", 10, attack_src if attack_real else "idle", not attack_real),
            ("death", 10, "death" if death_real else "idle", not death_real)]


def _farmer():
    # the tool swing is real; mining, farming and building reuse it until they are made
    return _std() + [("work_chop", 8, "attack", False), ("work_mine", 8, "attack", True),
                     ("work_farm", 8, "attack", True), ("work_build", 8, "attack", True)]


def _mage():
    return [("idle", 12, "idle", False), ("walk", 12, "walk", False), ("cast", 30, "cast", False),
            ("hit", 6, "idle", True), ("shatter", 8, "idle", True), ("fall", 12, "idle", True),
            ("dead", 4, "idle", True)]


# key: kind, variant, mage style, frame (w, h metres, anchor x, y fractions), animations
UNITS = {
    "farmer_e": dict(kind="farmer_e", frame=[3.0, 3.2, 0.5, 0.8], anims=_farmer()),
    "spear_e": dict(kind="spear_e", variant=1, frame=[6.4, 3.6, 0.5, 0.72], anims=_std()),
    "xbow_e": dict(kind="xbow_e", frame=[3.4, 3.2, 0.5, 0.72], anims=_std()),
    "hcav_e": dict(kind="hcav_e", frame=[7.2, 4.4, 0.5, 0.75], anims=_std(death_real=False)),
    "siege_e": dict(kind="siege_e", frame=[5.6, 6.4, 0.5, 0.8], anims=_std(death_real=False, walk_real=False)),
    "mage_e": dict(kind="mage_e", style="TB", frame=[4.6, 3.6, 0.5, 0.74], anims=_mage()),
    "farmer_w": dict(kind="farmer_w", frame=[3.8, 3.4, 0.5, 0.8], anims=_farmer()),
    "pike_w": dict(kind="pike_w", frame=[8.0, 4.4, 0.5, 0.62], anims=_std()),
    "bow_w": dict(kind="bow_w", frame=[3.2, 3.2, 0.5, 0.74], anims=_std()),
    "knight_w": dict(kind="knight_w", frame=[7.6, 4.4, 0.5, 0.75], anims=_std(death_real=False)),
    "siege_w": dict(kind="siege_w", frame=[5.6, 4.4, 0.5, 0.72], anims=_std(death_real=False, walk_real=False)),
    "mage_w": dict(kind="mage_w", style="WB", frame=[4.6, 3.6, 0.5, 0.74], anims=_mage()),
}
# (siege: the wheels do not turn yet, so walking is the idle pose; cavalry and siege have no death yet;
#  the mages have no hit, shield-shatter, fall or dead poses yet)

# the shadow layer is rendered at half size into a larger frame: room to the right and below
# (fractions of the frame height). The sun is low enough that 0.25 below clipped the farmer's shadow.
SHADOW_EXTRA = (0.45, 0.6)

PX_PER_M = 60       # 3x source art (20 pt per metre x 3); scaling and compression are a later step
SUPERSAMPLE = 2


def frame_name(key, anim, facing, i):
    return f"{key}_{anim}_f{facing}_{i:02d}"


def frame_counts(key):
    """{anim: frames per facing}."""
    return {a: n for a, n, _, _ in UNITS[key]["anims"]}


def placeholders(key):
    return [a for a, _, _, ph in UNITS[key]["anims"] if ph]


def total_frames(unique=True):
    per = sum(sum(n for _, n, _, _ in u["anims"]) for u in UNITS.values())
    return per * (len(RENDERED_FACINGS) if unique else len(ALL_FACINGS))
