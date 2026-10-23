// The castles round the towns (D-089, the user 2026-10-19: 「希望像一個城堡」; D-100, the user 2026-10-23:
// the towns about 1.5 x bigger, a keep in each), from war-game-ui's design/b1/castle-layout.json. Offsets in
// cells from the town's centre cell, which is the middle of its 3 x 3 keep: every castle is its own image
// under every turn and flip. Generated from the JSON; not edited by hand.

export interface CastleLayout {
  /** Cells inside the walls (inclusive). */
  inside: { x0: number; y0: number; x1: number; y1: number };
  /** Walls and corner towers: cells nobody walks. */
  wall: readonly (readonly [number, number])[];
  /** The corner towers' cells (in wall too). */
  corner: readonly (readonly [number, number])[];
  /** Gates: open cells in the ring of walls. */
  gate: readonly (readonly [number, number])[];
  /** war-game-ui's drawing of where a garrison stands (the simulation does not place garrisons). */
  garrison: readonly (readonly [number, number])[];
}

export const CASTLE_SMALL: CastleLayout = {
  inside: { x0: -6, y0: -6, x1: 6, y1: 6 },
  wall: [[-7, -7], [-6, -7], [-5, -7], [-4, -7], [-3, -7], [-2, -7], [2, -7], [3, -7], [4, -7], [5, -7], [6, -7], [7, -7], [-7, -6], [7, -6], [-7, -5], [7, -5], [-7, -4], [7, -4], [-7, -3], [7, -3], [-7, -2], [7, -2], [-7, 2], [7, 2], [-7, 3], [7, 3], [-7, 4], [7, 4], [-7, 5], [7, 5], [-7, 6], [7, 6], [-7, 7], [-6, 7], [-5, 7], [-4, 7], [-3, 7], [-2, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [7, 7]],
  corner: [[-7, -7], [7, -7], [-7, 7], [7, 7]],
  gate: [[-1, -7], [0, -7], [1, -7], [-7, -1], [7, -1], [-7, 0], [7, 0], [-7, 1], [7, 1], [-1, 7], [0, 7], [1, 7]],
  garrison: [],
};

export const CASTLE_LARGE: CastleLayout = {
  inside: { x0: -8, y0: -8, x1: 8, y1: 8 },
  wall: [[-9, -9], [-8, -9], [-7, -9], [-6, -9], [-5, -9], [-4, -9], [-3, -9], [-2, -9], [2, -9], [3, -9], [4, -9], [5, -9], [6, -9], [7, -9], [8, -9], [9, -9], [-9, -8], [-8, -8], [8, -8], [9, -8], [-9, -7], [9, -7], [-9, -6], [9, -6], [-9, -5], [9, -5], [-9, -4], [9, -4], [-9, -3], [9, -3], [-9, -2], [9, -2], [-9, 2], [9, 2], [-9, 3], [9, 3], [-9, 4], [9, 4], [-9, 5], [9, 5], [-9, 6], [9, 6], [-9, 7], [9, 7], [-9, 8], [-8, 8], [8, 8], [9, 8], [-9, 9], [-8, 9], [-7, 9], [-6, 9], [-5, 9], [-4, 9], [-3, 9], [-2, 9], [2, 9], [3, 9], [4, 9], [5, 9], [6, 9], [7, 9], [8, 9], [9, 9]],
  corner: [[-9, -9], [-8, -9], [8, -9], [9, -9], [-9, -8], [-8, -8], [8, -8], [9, -8], [-9, 8], [-8, 8], [8, 8], [9, 8], [-9, 9], [-8, 9], [8, 9], [9, 9]],
  gate: [[-1, -9], [0, -9], [1, -9], [-9, -1], [9, -1], [-9, 0], [9, 0], [-9, 1], [9, 1], [-1, 9], [0, 9], [1, 9]],
  garrison: [],
};
