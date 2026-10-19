// The castles round the towns (D-089, the user 2026-10-19: 「希望像一個城堡」), from war-game-ui's
// design/b1/castle-layout.json (design/castle 227d1a3). Offsets in cells from the town's centre
// cell; the big city's are for its tower on dx, dy in {-1, 0} (large) or |dx|, |dy| <= 1 (large3,
// random maps with adjacent starts), and castleOf shifts them to where the tower stands.
// Generated from the JSON; not edited by hand.

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
  inside: { x0: -4, y0: -4, x1: 4, y1: 4 },
  wall: [[-5, -5], [-4, -5], [-3, -5], [-2, -5], [2, -5], [3, -5], [4, -5], [5, -5], [-5, -4], [5, -4], [-5, -3], [5, -3], [-5, -2], [5, -2], [-5, 2], [5, 2], [-5, 3], [5, 3], [-5, 4], [5, 4], [-5, 5], [-4, 5], [-3, 5], [-2, 5], [2, 5], [3, 5], [4, 5], [5, 5]],
  corner: [[-5, -5], [5, -5], [-5, 5], [5, 5]],
  gate: [[-1, -5], [0, -5], [1, -5], [-5, -1], [5, -1], [-5, 0], [5, 0], [-5, 1], [5, 1], [-1, 5], [0, 5], [1, 5]],
  garrison: [[0, 0]],
};

export const CASTLE_LARGE: CastleLayout = {
  inside: { x0: -6, y0: -6, x1: 5, y1: 5 },
  wall: [[-7, -7], [-6, -7], [-5, -7], [-4, -7], [-3, -7], [-2, -7], [1, -7], [2, -7], [3, -7], [4, -7], [5, -7], [6, -7], [-7, -6], [-6, -6], [5, -6], [6, -6], [-7, -5], [6, -5], [-7, -4], [6, -4], [-7, -3], [6, -3], [-7, -2], [6, -2], [-7, 1], [6, 1], [-7, 2], [6, 2], [-7, 3], [6, 3], [-7, 4], [6, 4], [-7, 5], [-6, 5], [5, 5], [6, 5], [-7, 6], [-6, 6], [-5, 6], [-4, 6], [-3, 6], [-2, 6], [1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [6, 6]],
  corner: [[-7, -7], [-6, -7], [5, -7], [6, -7], [-7, -6], [-6, -6], [5, -6], [6, -6], [-7, 5], [-6, 5], [5, 5], [6, 5], [-7, 6], [-6, 6], [5, 6], [6, 6]],
  gate: [[-1, -7], [0, -7], [-7, -1], [6, -1], [-7, 0], [6, 0], [-1, 6], [0, 6]],
  garrison: [[-2, -3], [-3, -2], [-2, -2]],
};

export const CASTLE_LARGE3: CastleLayout = {
  inside: { x0: -6, y0: -6, x1: 6, y1: 6 },
  wall: [[-7, -7], [-6, -7], [-5, -7], [-4, -7], [-3, -7], [-2, -7], [2, -7], [3, -7], [4, -7], [5, -7], [6, -7], [7, -7], [-7, -6], [-6, -6], [6, -6], [7, -6], [-7, -5], [7, -5], [-7, -4], [7, -4], [-7, -3], [7, -3], [-7, -2], [7, -2], [-7, 2], [7, 2], [-7, 3], [7, 3], [-7, 4], [7, 4], [-7, 5], [7, 5], [-7, 6], [-6, 6], [6, 6], [7, 6], [-7, 7], [-6, 7], [-5, 7], [-4, 7], [-3, 7], [-2, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [7, 7]],
  corner: [[-7, -7], [-6, -7], [6, -7], [7, -7], [-7, -6], [-6, -6], [6, -6], [7, -6], [-7, 6], [-6, 6], [6, 6], [7, 6], [-7, 7], [-6, 7], [6, 7], [7, 7]],
  gate: [[-1, -7], [0, -7], [1, -7], [-7, -1], [7, -1], [-7, 0], [7, 0], [-7, 1], [7, 1], [-1, 7], [0, 7], [1, 7]],
  garrison: [[-3, -4], [-4, -3], [-4, -4]],
};
