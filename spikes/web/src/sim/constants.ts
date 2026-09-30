// Simulation constants. Every value is an integer; positions are fixed point with
// CELL units per map cell. spikes/godot/sim/constants.gd mirrors this file exactly.

export const TICKS_PER_SECOND = 20;
export const CELL = 1024;
export const CELL_SHIFT = 10;
export const MAP_SIZE = 176;
export const MAP_PX = MAP_SIZE * CELL;
export const MAP_SEED = 20260930;
export const OBSTACLE_PERCENT = 20;

export const TEAM_COUNT = 4;
export const UNITS_PER_TEAM = 100;
export const HASH_EVERY = 100;
export const MAX_TICKS = 24000;
export const REINFORCE_EVERY = 200;
export const RETARGET_EVERY = 10;
export const AI_THINK_EVERY = 200;

export const AGGRO_RANGE = 6 * CELL;
export const AGGRO_CELLS = 6;
export const UNIT_RADIUS = 358;
export const SEPARATION = 2 * UNIT_RADIUS;
export const PUSH = 16;
export const MAX_PUSH = 48;
export const ARRIVE_BASE = CELL;
export const ARRIVE_PER_SQRT = 717;

export const TYPE_MELEE = 0;
export const TYPE_RANGED = 1;
export const TYPE_FAST = 2;
export const TYPE_COUNT = 3;
// hp, attack, range (fixed point), speed (fixed point per tick), cooldown (ticks)
export const TYPE_HP = [60, 35, 100];
export const TYPE_ATTACK = [6, 5, 9];
export const TYPE_RANGE = [1024, 5120, 1024];
export const TYPE_SPEED = [51, 51, 82];
export const TYPE_COOLDOWN = [20, 20, 20];
// Per team: 40 melee, 35 ranged, 25 fast.
export const TEAM_MIX = [40, 35, 25];

export const ORDER_NONE = 0;
export const ORDER_MOVE = 1;
export const ORDER_ATTACK = 2;
export const ORDER_STOP = 3;

export const ANIM_IDLE = 0;
export const ANIM_MOVE = 1;
export const ANIM_ATTACK = 2;

export const CENTER = 88;
// Spawn centres (cell coordinates). "battle": four sides of the centre, used by the
// scripted game and the measurement mode. "corner": used by the AI game.
export const SPAWN_BATTLE = [
  [72, 88],
  [88, 72],
  [104, 88],
  [88, 104],
];
export const SPAWN_CORNER = [
  [24, 24],
  [152, 24],
  [152, 152],
  [24, 152],
];

// 8 grid directions, clockwise from +x with y pointing down. Vectors are CELL long.
export const DIR8_DX = [1, 1, 0, -1, -1, -1, 0, 1];
export const DIR8_DY = [0, 1, 1, 1, 0, -1, -1, -1];
export const DIR8_COST = [10, 14, 10, 14, 10, 14, 10, 14];
// 16 directions, k * 22.5 degrees, rounded cos/sin * 1024. DIR8 index d is DIR16 index 2d.
export const DIR16_X = [1024, 946, 724, 392, 0, -392, -724, -946, -1024, -946, -724, -392, 0, 392, 724, 946];
export const DIR16_Y = [0, 392, 724, 946, 1024, 946, 724, 392, 0, -392, -724, -946, -1024, -946, -724, -392];
// tan(11.25), tan(33.75), tan(56.25), tan(78.75) degrees * 1024
export const DIR16_TAN = [204, 684, 1533, 5148];
export const NO_DIR = 255;
