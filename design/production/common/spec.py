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
    # attack = the basic 晶彈 shot (sim: every 20 ticks); until its pose is approved it is the
    # first 10 frames of the cast, the same stand-in the client uses (client/docs/sprite-atlas.md)
    return [("idle", 12, "idle", False), ("walk", 12, "walk", False), ("attack", 10, "cast", True),
            ("cast", 30, "cast", False), ("hit", 6, "idle", True), ("shatter", 8, "idle", True),
            ("fall", 12, "idle", True), ("dead", 4, "idle", True)]


# playback speed (frames per second of sim time) per animation, client/docs/sprite-atlas.md section 7
FPS = {"idle": 8, "walk": 12, "attack": 20, "death": 12, "cast": 20, "hit": 20, "shatter": 16, "fall": 12,
       "dead": 12, "work_chop": 10, "work_mine": 10, "work_farm": 10, "work_build": 10}

# the attack frame (from 0) where the blow lands or the shot leaves, read off the attack curves:
# spear/pike thrust peaks at t 0.5; crossbow recoil at t 0.4; longbow loose at t 0.6; tool strikes at t 0.7;
# trebuchet releases near the top of its swing (t 0.4), catapult arm stops at t 0.35; riders have no strike
# motion yet (lance held couched), mages: stand-in
HIT = {"farmer_e": 7, "spear_e": 5, "xbow_e": 4, "hcav_e": 5, "siege_e": 4, "mage_e": 4,
       "farmer_w": 7, "pike_w": 5, "bow_w": 6, "knight_w": 5, "siege_w": 3, "mage_w": 4}


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

# The new animations (blender/anims.py). The user's rulings, 2026-10-01:
#   approved (P1): the mages' attack (晶彈), hit and shatter; the siege engines' walk.
#   redone as P2 ("p1-03 p1-04看起來不夠精緻"): the falls and deaths, the farmers' four works;
#   the farmers' enlarged tools (their idle and walk change with them) are shown as P2-06.
# render_prod.py --review renders REVIEW_ANIMS at facing 7 only, for the approval GIFs; after
# approval the animations replace the stand-ins in UNITS. (name, frames)
REVIEW_FACINGS = [7]
APPROVED_ANIMS = {
    "mage_e": [("attack", 10), ("hit", 6), ("shatter", 8)],
    "mage_w": [("attack", 10), ("hit", 6), ("shatter", 8)],
    "siege_e": [("walk", 8)],
    "siege_w": [("walk", 8)],
}
REVIEW_ANIMS = {
    "mage_e": [("fall", 12), ("dead", 4)],
    "mage_w": [("fall", 12), ("dead", 4)],
    "hcav_e": [("death", 10)],
    "knight_w": [("death", 10)],
    "siege_e": [("death", 10)],
    "siege_w": [("death", 10)],
    "farmer_e": [("work_chop", 8), ("work_mine", 8), ("work_farm", 8), ("work_build", 8), ("idle", 8), ("walk", 8)],
    "farmer_w": [("work_chop", 8), ("work_mine", 8), ("work_farm", 8), ("work_build", 8), ("idle", 8), ("walk", 8)],
}
# client/docs/sprite-atlas.md, sections 7 and 11: the frame of a fall where the body lands (the game
# plays the shared dust there), how much larger the dust is for big units, and the frame of a work
# loop where the tool lands
IMPACT = {"mage_e": ("fall", 8, 1.0), "mage_w": ("fall", 8, 1.0), "hcav_e": ("death", 7, 1.6),
          "knight_w": ("death", 7, 1.6), "siege_e": ("death", 6, 2.0), "siege_w": ("death", 6, 2.0)}
WORK_HIT = {"work_chop": 4, "work_mine": 4, "work_farm": 3, "work_build": 2}
# a siege engine's walk cycle turns the wheels 90 degrees: it moves 2 pi r / 4 per cycle (client: stride_m)
STRIDE_M = {"siege_e": round(2 * 3.14159265 * 0.42 / 4, 3), "siege_w": round(2 * 3.14159265 * 0.36 / 4, 3)}

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
