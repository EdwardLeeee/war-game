// What became of the towns a player took (`guard`'s measurement, the user 2026-10-31): taken, lost and to whom, held at the
// end, town-minutes held, and the soldiers each side lost by a town of the player's. Watches the world; changes nothing.

import { CELL_SHIFT, Order, TownState, UnitType } from "./protocol.ts";
import type { World } from "./core/world.ts";

export interface TownRecord {
  taken: number;
  /** Lost to the enemy (it took it), and any other way (revolt, ruins). */
  lostToEnemy: number;
  lostOther: number;
  heldAtEnd: number;
  /** Town-ticks held. */
  held: number;
  /** Soldiers dead within reach of a town the player held then: the player's, the enemy's. */
  deadMine: number;
  deadEnemy: number;
  /** Soldiers guarding a town (Order.TownGuard) seen outside its walls and gate cells, sampled every second: soldier-seconds, spells (and the furthest, cells from the wall). */
  outSeconds: number;
  outSpells: number;
  outFurthest: number;
}

const NEAR = 6;

export class TownWatch {
  private readonly player: number;
  private owned: boolean[] = [];
  private readonly soldiers = new Map<number, { p: number; x: number; y: number }>();
  private readonly record: TownRecord = { taken: 0, lostToEnemy: 0, lostOther: 0, heldAtEnd: 0, held: 0, deadMine: 0, deadEnemy: 0, outSeconds: 0, outSpells: 0, outFurthest: 0 };
  private readonly out = new Set<number>();
  private readonly inOnce = new Set<number>();

  constructor(player: number) {
    this.player = player;
  }

  tick(w: World): void {
    const r = this.record;
    const u = w.units.col;
    const towns = w.townSize.length;
    let now = 0;
    for (let t = 0; t < towns; t++) {
      const mine = w.townOwner[t] === this.player && w.townState[t] !== TownState.Neutral && w.townState[t] !== TownState.Ruins;
      if (mine) {
        now++;
        r.held++;
      }
      if (mine && this.owned[t] !== true) r.taken++;
      if (!mine && this.owned[t] === true) {
        if (w.townOwner[t] === 1 - this.player) r.lostToEnemy++;
        else r.lostOther++;
      }
      this.owned[t] = mine;
    }
    r.heldAtEnd = now;
    if (w.tick % 20 === 0) {
      const n = w.size;
      const was = new Set(this.out);
      this.out.clear();
      for (let s = 0; s < w.units.count; s++) {
        if (u.owner[s] !== this.player || u.order[s] !== Order.TownGuard) continue;
        const t = u.orderTarget[s];
        const x = u.x[s] >> CELL_SHIFT;
        const y = u.y[s] >> CELL_SHIFT;
        const c = w.castles[t];
        if (w.insideAt[y * n + x] === t || c.gate.some(([dx, dy]) => w.townX[t] + dx === x && w.townY[t] + dy === y)) continue;
        // On the way in (outside, never inside yet) does not count: only one who was within the walls before.
        if (!this.inOnce.has(u.id[s])) continue;
        this.out.add(u.id[s]);
        r.outSeconds++;
        if (!was.has(u.id[s])) r.outSpells++;
        const off = Math.max(c.inside.x0 - (x - w.townX[t]), (x - w.townX[t]) - c.inside.x1, c.inside.y0 - (y - w.townY[t]), (y - w.townY[t]) - c.inside.y1) - 1;
        r.outFurthest = Math.max(r.outFurthest, off);
      }
      for (let s = 0; s < w.units.count; s++) {
        if (u.owner[s] !== this.player || u.order[s] !== Order.TownGuard) continue;
        if (w.insideAt[(u.y[s] >> CELL_SHIFT) * n + (u.x[s] >> CELL_SHIFT)] === u.orderTarget[s]) this.inOnce.add(u.id[s]);
      }
    }
    const alive = new Set<number>();
    for (let s = 0; s < w.units.count; s++) {
      if (u.type[s] === UnitType.Farmer || u.type[s] === UnitType.Militia || u.owner[s] > 1) continue;
      alive.add(u.id[s]);
      this.soldiers.set(u.id[s], { p: u.owner[s], x: u.x[s] >> CELL_SHIFT, y: u.y[s] >> CELL_SHIFT });
    }
    for (const [id, l] of this.soldiers) {
      if (alive.has(id)) continue;
      this.soldiers.delete(id);
      for (let t = 0; t < towns; t++) {
        if (this.owned[t] !== true || Math.abs(l.x - w.townX[t]) > w.townRadius[t] + NEAR || Math.abs(l.y - w.townY[t]) > w.townRadius[t] + NEAR) continue;
        if (l.p === this.player) r.deadMine++;
        else r.deadEnemy++;
        break;
      }
    }
  }

  result(): TownRecord {
    return { ...this.record };
  }
}
