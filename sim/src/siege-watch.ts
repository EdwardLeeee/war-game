// What a player's siege engines did (D-115, for war-game-ai's D-099 and NN v3; the group push-late-siege): when the
// siege works stood and the first engine was out, what marched, each engine's end (when, and what hit it last), what
// they killed and which towers they pulled down. Watches the world every tick; changes nothing in the game.

import { BuildingType, CELL, CELL_SHIFT, UnitType } from "./protocol.ts";
import { UNITS } from "./core/rules.ts";
import { HitCause, type World } from "./core/world.ts";
import type { Outgoing } from "./core/game.ts";

export interface EngineRecord {
  id: number;
  /** First seen, and when it fell (-1: standing at the end). */
  born: number;
  died: number;
  /** What hit it last: "cavalry", "ranged", "tower" (arrows), "other"; "" while it stands. */
  by: string;
}
export interface SiegeRecord {
  worksDone: number;
  firstEngine: number;
  /** The first march with an engine in it: when, soldiers (engines too) and engines then (-1: never). */
  out: { tick: number; soldiers: number; engines: number };
  engines: EngineRecord[];
  /** Enemy soldiers and farmers their stones killed last; enemy arrow towers a stone brought down. */
  kills: { soldiers: number; farmers: number };
  towers: number;
}

const killerOf = (type: number | undefined, cause: number): string => {
  if (cause === HitCause.Arrow) return "tower";
  if (type === UnitType.Cavalry) return "cavalry";
  if (type === UnitType.Ranged) return "ranged";
  return "other";
};

export class SiegeWatch {
  private readonly player: number;
  private readonly seen = new Map<number, { x: number; hitCause: number; hitById: number }>();
  private readonly types = new Map<number, number>();
  /** Each enemy unit where it last stood (fixed point): one that falls just where a stone lands is that stone's. */
  private readonly enemyAt = new Map<number, { x: number; y: number; type: number }>();
  private readonly towersAt = new Map<number, { x0: number; y0: number; x1: number; y1: number }>();
  /** Stones of the player's in the air or just landed: [the tick it shows, fixed-point x, y]. */
  private stones: [number, number, number][] = [];
  private readonly record: SiegeRecord = { worksDone: -1, firstEngine: -1, out: { tick: -1, soldiers: 0, engines: 0 }, engines: [], kills: { soldiers: 0, farmers: 0 }, towers: 0 };
  private readonly byId = new Map<number, EngineRecord>();

  constructor(player: number) {
    this.player = player;
  }

  /** After every tick, with that tick's events. `marching`: the player's army is on its way to the enemy's main city. */
  tick(w: World, events: readonly Outgoing[], marching: boolean): void {
    const r = this.record;
    const u = w.units.col;
    const b = w.buildings.col;
    if (r.worksDone < 0) {
      for (let s = 0; s < w.buildings.count; s++) if (b.owner[s] === this.player && b.type[s] === BuildingType.SiegeWorks && b.progress[s] >= 1000) r.worksDone = w.tick;
    }
    const alive = new Set<number>();
    const enemies = new Set<number>();
    let engines = 0;
    let soldiers = 0;
    for (let s = 0; s < w.units.count; s++) {
      const id = u.id[s];
      this.types.set(id, u.type[s]);
      if (u.owner[s] === this.player) {
        if (u.type[s] !== UnitType.Farmer) soldiers++;
        if (u.type[s] !== UnitType.Siege) continue;
        engines++;
        alive.add(id);
        if (!this.byId.has(id)) {
          const e = { id, born: w.tick, died: -1, by: "" };
          this.byId.set(id, e);
          r.engines.push(e);
          if (r.firstEngine < 0) r.firstEngine = w.tick;
        }
        this.seen.set(id, { x: u.x[s], hitCause: u.hitCause[s], hitById: u.hitById[s] });
      } else {
        enemies.add(id);
        if (!this.enemyAt.has(id)) this.enemyAt.set(id, { x: u.x[s], y: u.y[s], type: u.type[s] });
      }
    }
    if (marching && engines > 0 && r.out.tick < 0) r.out = { tick: w.tick, soldiers, engines };
    for (const [id, l] of this.seen) {
      if (alive.has(id)) continue;
      this.seen.delete(id);
      const e = this.byId.get(id)!;
      e.died = w.tick;
      e.by = killerOf(this.types.get(l.hitById), l.hitCause);
    }
    for (const e of events) {
      if (e.ev.k === "siege_shot" && e.to === this.player) this.stones.push([e.ev.lands, e.ev.x, e.ev.y]);
    }
    // A stone shows at `lands`, the snapshot of the tick after it fell: gone by then or the tick before.
    const landed = this.stones.filter((s) => s[0] >= w.tick - 1 && s[0] <= w.tick + 1);
    const reach = (UNITS[UnitType.Siege].splash ?? 0) + (CELL >> 1);
    for (const [id, l] of this.enemyAt) {
      if (enemies.has(id)) continue;
      this.enemyAt.delete(id);
      if (w.unit(id) >= 0 || !landed.some(([, x, y]) => (x - l.x) * (x - l.x) + (y - l.y) * (y - l.y) <= reach * reach)) continue;
      if (l.type === UnitType.Farmer) r.kills.farmers++;
      else r.kills.soldiers++;
    }
    for (let s = 0; s < w.units.count; s++) {
      if (u.owner[s] === this.player) continue;
      const at = this.enemyAt.get(u.id[s]);
      if (at !== undefined) {
        at.x = u.x[s];
        at.y = u.y[s];
      }
    }
    this.stones = this.stones.filter((s) => s[0] >= w.tick - 1);
    // Towers: one gone as a stone landed on it.
    const standing = new Set<number>();
    for (let s = 0; s < w.buildings.count; s++) {
      if (b.owner[s] === this.player || b.type[s] !== BuildingType.ArrowTower) continue;
      standing.add(b.id[s]);
      if (!this.towersAt.has(b.id[s])) this.towersAt.set(b.id[s], { x0: b.cellX[s], y0: b.cellY[s], x1: b.cellX[s] + w.wide(s) - 1, y1: b.cellY[s] + w.tall(s) - 1 });
    }
    for (const [id, t] of this.towersAt) {
      if (standing.has(id)) continue;
      this.towersAt.delete(id);
      if (landed.some(([, x, y]) => x >> CELL_SHIFT >= t.x0 && x >> CELL_SHIFT <= t.x1 && y >> CELL_SHIFT >= t.y0 && y >> CELL_SHIFT <= t.y1)) r.towers++;
    }
  }

  result(): SiegeRecord {
    const r = this.record;
    return { ...r, out: { ...r.out }, kills: { ...r.kills }, engines: r.engines.map((e) => ({ ...e })) };
  }
}
