// Touch and camera constants, in one place so they can be tuned after the iPhone play test.
// Screen distances are CSS px, which are pt on the iPhone.

/** Hold still this long to box-select (empty ground) or open the skill wheel (own unit). GDD §10. */
export const LONG_PRESS_MS = 350;
/** A finger that moves further than this before LONG_PRESS_MS pans instead. */
export const TAP_SLOP_PX = 10;
/** A second tap within this time and distance of the first is a double tap. */
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_SLOP_PX = 30;
/** The hold cue (a closing ring) appears once a press has lasted this long, so quick taps do not flash it. */
export const PRESS_CUE_DELAY_MS = 80;

/** Pan velocity for inertia is measured over the last this-many ms of the drag. */
export const INERTIA_SAMPLE_MS = 80;
/** Inertia decays as v * exp(-INERTIA_DECAY * dt) with dt in ms (screen only, never simulation). */
export const INERTIA_DECAY = 0.004;
/** Below this speed (px per ms) inertia stops. */
export const INERTIA_MIN_SPEED = 0.02;

/** World px per map cell at zoom 1. */
export const TILE_PX = 32;
export const MAX_ZOOM = 2.5;
/** Zoom when a game starts. */
export const START_ZOOM = 1;

/** Taps pick the nearest thing within this many pt of the finger. */
export const HIT_RADIUS_PT = 22;
/**
 * With farmers selected, a resource or own building near the finger beats a unit standing
 * next to it, unless the finger is this close to the unit (it is right on it).
 */
export const UNIT_CORE_HIT_PT = 12;
