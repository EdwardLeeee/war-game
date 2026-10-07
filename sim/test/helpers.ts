// Test helpers: a standard game with every unit removed, so a test can place its own.

import { Game } from "../src/core/game.ts";
import { CELL_SHIFT, type UnitType } from "../src/protocol.ts";
import { UNITS } from "../src/core/rules.ts";

export function emptyGame(): Game {
  const g = new Game({ seed: 1, scenario: "standard" });
  const w = g.w;
  for (let s = 0; s < w.units.count; s++) w.unitSlot[w.units.col.id[s]] = -1;
  w.units.count = 0;
  g.fog.update(w);
  return g;
}

/** Adds a unit at the centre of a cell and returns its id. */
export function put(g: Game, owner: number, type: UnitType, cellX: number, cellY: number): number {
  return g.w.addUnit(owner, type, (cellX << CELL_SHIFT) + 512, (cellY << CELL_SHIFT) + 512, UNITS[type].hp);
}

export function slotOf(g: Game, id: number): number {
  return g.w.unit(id);
}

export function run(g: Game, ticks: number): void {
  for (let i = 0; i < ticks && !g.w.over; i++) g.step();
}

let seq = 0;
export function cmd(g: Game, p: number, body: Record<string, unknown>): void {
  g.push({ t: g.tick, p, seq: seq++, ...body } as never);
}

/** Top-left of a size x size square of walkable cells at least 15 cells from every building. */
export function openArea(g: Game, size: number): { x: number; y: number } {
  const w = g.w;
  const b = w.buildings.col;
  for (let y = 0; y + size <= w.size; y++) {
    for (let x = 0; x + size <= w.size; x++) {
      let ok = true;
      for (let s = 0; s < w.buildings.count && ok; s++) {
        if (Math.abs(b.cellX[s] - (x + size / 2)) < 15 + size / 2 && Math.abs(b.cellY[s] - (y + size / 2)) < 15 + size / 2) ok = false;
      }
      for (let yy = y; yy < y + size && ok; yy++) for (let xx = x; xx < x + size && ok; xx++) if (!w.walkable(xx, yy)) ok = false;
      if (ok) return { x, y };
    }
  }
  throw new Error("no open area");
}

/**
 * A test body run with a rule's switch off, then as it was: for tests of other rules that a
 * later round's rule would change (round 8's soldiers stepping out of cannon warnings, D-069).
 */
export function switchedOff(sw: { on: boolean }, body: () => void): () => void {
  return () => {
    const was = sw.on;
    sw.on = false;
    try {
      body();
    } finally {
      sw.on = was;
    }
  };
}
