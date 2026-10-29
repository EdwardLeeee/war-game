// Test helpers: a standard game with every unit removed, so a test can place its own.

import { Game } from "../src/core/game.ts";
import { BLOCK_BUILDING, BLOCK_GATE, BLOCK_WALL } from "../src/core/world.ts";
import { BuildingType, CELL_SHIFT, UnitType } from "../src/protocol.ts";
import { MULT_DEN, MULT_NUM, SHIELD, UNITS } from "../src/core/rules.ts";

export function emptyGame(): Game {
  const g = new Game({ seed: 1, scenario: "standard" });
  const w = g.w;
  for (let s = 0; s < w.units.count; s++) w.unitSlot[w.units.col.id[s]] = -1;
  w.units.count = 0;
  // The militia on the walls are gone too (D-096).
  w.wallAt.fill(-1);
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
 * first from the top-left as before D-089. Castle walls (D-089), gates (D-096) and towns' keeps (D-100,
 * KEEP) do not count against it: walls and gates in the square or within 4 cells of it are taken down
 * (walls in the grid only, gates broken: gone at the next step), and so are the gates' lanes; keeps as
 * near as a building may stand are broken too (they would shoot into it). So a test's fight is where it
 * was, is not walled in or shot at, and may build there.
 */
export function openArea(g: Game, size: number): { x: number; y: number } {
  const w = g.w;
  const b = w.buildings.col;
  const n = w.size;
  const keepAt = (x: number, y: number) => {
    const s = w.building(w.buildingAt[y * n + x]);
    return s >= 0 && b.type[s] === BuildingType.Keep;
  };
  const open = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < n && y < n && ((w.grid[y * n + x] & ~(BLOCK_WALL | BLOCK_GATE)) === 0 || ((w.grid[y * n + x] & ~(BLOCK_WALL | BLOCK_GATE | BLOCK_BUILDING)) === 0 && keepAt(x, y)));
  for (let y = 0; y + size <= w.size; y++) {
    for (let x = 0; x + size <= w.size; x++) {
      let ok = true;
      const near = (s: number) => Math.abs(b.cellX[s] - (x + size / 2)) < 15 + size / 2 && Math.abs(b.cellY[s] - (y + size / 2)) < 15 + size / 2;
      for (let s = 0; s < w.buildings.count && ok; s++) {
        if (b.type[s] === BuildingType.Gate || b.type[s] === BuildingType.Keep) continue;
        if (near(s)) ok = false;
      }
      for (let yy = y; yy < y + size && ok; yy++) for (let xx = x; xx < x + size && ok; xx++) if (!open(xx, yy)) ok = false;
      if (!ok) continue;
      // Off the grid at once (a unit may be put on one of its cells), gone at the next step.
      for (let s = 0; s < w.buildings.count; s++) {
        if (b.type[s] !== BuildingType.Keep || !near(s)) continue;
        w.setFootprint(b.id[s], BuildingType.Keep, b.cellX[s], b.cellY[s], false);
        b.hp[s] = 0;
      }
      let opened = false;
      for (let yy = Math.max(0, y - 4); yy < Math.min(n, y + size + 4); yy++) {
        for (let xx = Math.max(0, x - 4); xx < Math.min(n, x + size + 4); xx++) {
          w.gateLane[yy * n + xx] = 0;
          const gate = w.building(w.buildingAt[yy * n + xx]);
          if (gate >= 0 && b.type[gate] === BuildingType.Gate) b.hp[gate] = 0;
          if ((w.grid[yy * n + xx] & (BLOCK_WALL | BLOCK_GATE)) === 0) continue;
          w.grid[yy * n + xx] &= ~(BLOCK_WALL | BLOCK_GATE);
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
  return switched(sw, false, body);
}

/**
 * The multipliers before the unit triangle (D-097) while `body` runs: for scenes of other rules
 * (joining a fight, squads) set for that balance. Ranged x5/2 on spearmen, x9/5 on cavalry, x3
 * on shields; spearmen x3 on cavalry; cavalry x2 on mages and shields.
 */
export function beforeTriangle(body: () => void): () => void {
  const old: [number, number, number, number][] = [
    [UnitType.Ranged, UnitType.Spearman, 5, 2],
    [UnitType.Ranged, UnitType.Cavalry, 9, 5],
    [UnitType.Ranged, SHIELD, 3, 1],
    [UnitType.Spearman, UnitType.Cavalry, 3, 1],
    [UnitType.Cavalry, UnitType.Mage, 2, 1],
    [UnitType.Cavalry, SHIELD, 2, 1],
  ];
  return () => {
    const was = old.map(([a, t]) => [MULT_NUM[a][t], MULT_DEN[a][t]]);
    for (const [a, t, num, den] of old) {
      MULT_NUM[a][t] = num;
      MULT_DEN[a][t] = den;
    }
    try {
      body();
    } finally {
      old.forEach(([a, t], k) => {
        MULT_NUM[a][t] = was[k][0];
        MULT_DEN[a][t] = was[k][1];
      });
    }
  };
}

/** The same with switches on: for tests of a rule that is off for now (D-095: MARCH_ORDER). */
export function switchedOn(sw: { on: boolean } | { on: boolean }[], body: () => void): () => void {
  return switched(sw, true, body);
}

function switched(sw: { on: boolean } | { on: boolean }[], on: boolean, body: () => void): () => void {
  const all = Array.isArray(sw) ? sw : [sw];
  return () => {
    const was = all.map((x) => x.on);
    for (const x of all) x.on = on;
    try {
      body();
    } finally {
      all.forEach((x, k) => {
        x.on = was[k];
      });
    }
  };
}
