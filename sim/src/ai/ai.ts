// The prototype's simple AI (PR-5). It sees only a PlayerView — never the simulation — and
// answers with ordinary commands, which go into the log like a player's.
// Imports allowed here: ../protocol.ts, ../view/view.ts (types), ../core/fixed.ts (Rng).
// test/boundaries.test.ts enforces that.

import type { CommandBody } from "../protocol.ts";
import { Rng } from "../core/fixed.ts";
import type { PlayerView } from "../view/view.ts";

export interface Ai {
  think(view: PlayerView): CommandBody[];
}

/** Until PR-5 the AI does nothing. */
export function createAi(player: number, seed: number): Ai {
  const rng = new Rng((seed ^ Math.imul(player + 1, 0x9e3779b1)) >>> 0);
  return {
    think(_view: PlayerView): CommandBody[] {
      void rng;
      return [];
    },
  };
}
