// Test helpers: a standard game with every unit removed, so a test can place its own.

import { Game } from "../src/core/game.ts";
import { BLOCK_WALL } from "../src/core/world.ts";
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

/**
 * Top-left of a size x size square of walkable cells at least 15 cells from every building, the
 * first from the top-left as before D-089. Castle walls (D-089) do not count against it: any in the
 * square or within 4 cells of it are taken down (grid only), and so are the gates' lanes, so a
 * test's fight is where it was, is not walled in, and may build there.
 */
export function openArea(g: Game, size: number): { x: number; y: number } {
  const w = g.w;
  const b = w.buildings.col;
  const n = w.size;
  const open = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && (w.grid[y * n + x] & ~BLOCK_WALL) === 0;
  for (let y = 0; y + size <= w.size; y++) {
    for (let x = 0; x + size <= w.size; x++) {
      let ok = true;
      for (let s = 0; s < w.buildings.count && ok; s++) {
        if (Math.abs(b.cellX[s] - (x + size / 2)) < 15 + size / 2 && Math.abs(b.cellY[s] - (y + size / 2)) < 15 + size / 2) ok = false;
      }
      for (let yy = y; yy < y + size && ok; yy++) for (let xx = x; xx < x + size && ok; xx++) if (!open(xx, yy)) ok = false;
      if (!ok) continue;
      let opened = false;
      for (let yy = Math.max(0, y - 4); yy < Math.min(n, y + size + 4); yy++) {
        for (let xx = Math.max(0, x - 4); xx < Math.min(n, x + size + 4); xx++) {
          w.gateLane[yy * n + xx] = 0;
          if ((w.grid[yy * n + xx] & BLOCK_WALL) === 0) continue;
          w.grid[yy * n + xx] &= ~BLOCK_WALL;
          opened = true;
        }
      }
      if (opened) w.openVersion++;
      return { x, y };
    }
  }
  throw new Error("no open area");
}

/**
 * A test body run with rules' switches off, then as they were: for tests of other rules that a
 * later round's rules would change (round 8, D-069: soldiers stepping out of cannon warnings,
 * going for the mage).
 */
export function switchedOff(sw: { on: boolean } | { on: boolean }[], body: () => void): () => void {
  const all = Array.isArray(sw) ? sw : [sw];
  return () => {
    const was = all.map((x) => x.on);
    for (const x of all) x.on = false;
    try {
      body();
    } finally {
      all.forEach((x, k) => {
        x.on = was[k];
      });
    }
  };
}
