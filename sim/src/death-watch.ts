// D-100's measurement (ceo 2026-10-24): where one player's soldiers die, by a town (and who held it
// then), by the other's main city, by its own, or in the field; and how many of them to arrows.
// Watches the world every tick; changes nothing in the game.

import { CELL_SHIFT, NEUTRAL, TownState, UnitType } from "./protocol.ts";
import { HitCause, type World } from "./core/world.ts";

/** By place: [soldiers lost, of them to arrows (the last hit an arrow)]. */
export type DeathRecord = Record<string, [number, number]>;

/** Cells out from a town's walls that still count as by it; from a main city's centre that count as by it. */
const TOWN_MARGIN = 3;
const CITY_NEAR = 12;

export class DeathWatch {
  private readonly last = new Map<number, { x: number; y: number; arrow: boolean }>();
  private readonly record: DeathRecord = {};

  private readonly player: number;

  constructor(player: number) {
    this.player = player;
  }

  /** After every tick. */
  tick(w: World): void {
    const u = w.units.col;
    const alive = new Set<number>();
    for (let s = 0; s < w.units.count; s++) {
      if (u.owner[s] !== this.player || u.type[s] === UnitType.Farmer) continue;
      alive.add(u.id[s]);
      this.last.set(u.id[s], { x: u.x[s] >> CELL_SHIFT, y: u.y[s] >> CELL_SHIFT, arrow: u.hitCause[s] === HitCause.Arrow });
    }
    for (const [id, l] of this.last) {
      if (alive.has(id)) continue;
      this.last.delete(id);
      const r = (this.record[this.place(w, l.x, l.y)] ??= [0, 0]);
      r[0]++;
      if (l.arrow) r[1]++;
    }
  }

  private place(w: World, x: number, y: number): string {
    for (let t = 0; t < w.townSize.length; t++) {
      if (Math.max(Math.abs(x - w.townX[t]), Math.abs(y - w.townY[t])) > w.townRadius[t] + TOWN_MARGIN) continue;
      const st = w.townState[t];
      const owner = w.townOwner[t];
      const holder = st === TownState.Neutral || owner === NEUTRAL ? "neutral" : st === TownState.Ruins ? "ruins" : owner === this.player ? "mine" : "ai";
      return `town ${holder}`;
    }
    for (const s of w.map.spawns) {
      if ((x - s.cellX) * (x - s.cellX) + (y - s.cellY) * (y - s.cellY) > CITY_NEAR * CITY_NEAR) continue;
      return s.player === this.player ? "home" : "aiCity";
    }
    return "field";
  }

  result(): DeathRecord {
    const out: DeathRecord = {};
    for (const [k, v] of Object.entries(this.record)) out[k] = [v[0], v[1]];
    return out;
  }
}
