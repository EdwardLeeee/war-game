// Soldiers of a player standing by a town not its own with a target they do not get to (client's measure, 2026-10-31): sampled
// every second; a spell of 5 seconds or more counts. Watches the world; changes nothing.

import { Action, CELL, CELL_SHIFT, UnitType } from "./protocol.ts";
import type { World } from "./core/world.ts";

export interface StuckRecord {
  spells: number;
  seconds: number;
  longest: number;
}

export class StuckWatch {
  private readonly player: number;
  private readonly last = new Map<number, [number, number]>();
  private readonly run = new Map<number, [number, number]>();
  private readonly record: StuckRecord = { spells: 0, seconds: 0, longest: 0 };

  constructor(player: number) {
    this.player = player;
  }

  private close(id: number): void {
    const r = this.run.get(id);
    this.run.delete(id);
    if (r === undefined || r[1] - r[0] < 100) return;
    const s = Math.trunc((r[1] - r[0]) / 20);
    this.record.spells++;
    this.record.seconds += s;
    this.record.longest = Math.max(this.record.longest, s);
  }

  tick(w: World): void {
    if (w.tick % 20 !== 0) return;
    const u = w.units.col;
    const near = new Map<number, number[]>();
    const stuck = new Set<number>();
    for (let s = 0; s < w.units.count; s++) {
      if (u.owner[s] !== this.player || u.type[s] === UnitType.Farmer) continue;
      const x = u.x[s] >> CELL_SHIFT;
      const y = u.y[s] >> CELL_SHIFT;
      for (let t = 0; t < w.townSize.length; t++) {
        if (w.heldBy(t, this.player) || Math.max(Math.abs(x - w.townX[t]), Math.abs(y - w.townY[t])) > 12) continue;
        if (!near.has(t)) near.set(t, []);
        near.get(t)?.push(s);
        break;
      }
      const was = this.last.get(u.id[s]);
      this.last.set(u.id[s], [u.x[s], u.y[s]]);
      if (was === undefined || Math.abs(u.x[s] - was[0]) + Math.abs(u.y[s] - was[1]) > CELL >> 2 || u.cooldown[s] > 0) continue;
      const tid = u.target[s];
      if (u.action[s] === Action.Move && tid >= 0 && (w.unit(tid) >= 0 || w.building(tid) >= 0)) stuck.add(s);
    }
    const now = new Set<number>();
    for (const list of near.values()) {
      if (list.length < 3) continue;
      for (const s of list) if (stuck.has(s)) now.add(u.id[s]);
    }
    for (const id of [...this.run.keys()]) if (!now.has(id)) this.close(id);
    for (const id of now) {
      const r = this.run.get(id);
      if (r === undefined) this.run.set(id, [w.tick, w.tick]);
      else r[1] = w.tick;
    }
  }

  result(): StuckRecord {
    for (const id of [...this.run.keys()]) this.close(id);
    return { ...this.record };
  }
}
