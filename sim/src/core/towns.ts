// Towns (GDD section 5, D4): capture, plunder or govern, revolt, ruins. Runs once per tick
// after training, town by town in id order.
//
// - Military inside the radius counts (farmers and hidden units do not). Both players there:
//   contested, the state is frozen (ruins still count down).
// - A neutral town falls when all its militia are dead (wherever they are: they chase out of
//   the radius), its tower (big city) is destroyed, and exactly one player has military
//   inside. The tower never comes back.
// - A held town (awaiting the choice, plundering, repairing, governed) falls to the other
//   player when the other has military inside and the holder has none.
// - Plundering counts down only while the holder has military inside; repairing only with the
//   minimum garrison. Below the minimum, a repairing or governed town counts toward revolt
//   (60 s) and a governed town produces nothing.
// - Production: per-minute amounts added to an integer accumulator every tick, paid out every
//   20 ticks.
// - Revolt and the end of ruins turn the town neutral with half its militia.

import {
  Action,
  BuildingType,
  CELL_SHIFT,
  NEUTRAL,
  NO_OWNER,
  PLAYER_COUNT,
  Resource,
  type SimEvent,
  TownState,
  UnitType,
} from "../protocol.ts";
import type { Emit } from "./economy.ts";
import type { Fog } from "./fog.ts";
import { TOWNS } from "./rules.ts";
import { spawnMilitia } from "./scenarios.ts";
import type { World } from "./world.ts";

/** Production is paid out every this many ticks. */
export const TOWN_PAY_EVERY = 20;
const PER_MINUTE = 60 * 20;

export class TownSystem {
  private readonly fog: Fog;
  private readonly emit: Emit;

  constructor(fog: Fog, emit: Emit) {
    this.fog = fog;
    this.emit = emit;
  }

  /** Sends a town event to the players involved and to every player who sees the town. */
  private tell(w: World, t: number, ev: SimEvent, involved: number[]): void {
    const n = w.size;
    for (let p = 0; p < PLAYER_COUNT; p++) {
      if (involved.includes(p) || this.fog.visible[p][w.townY[t] * n + w.townX[t]] === 1) this.emit(p, ev);
    }
  }

  step(w: World): void {
    const u = w.units.col;
    const b = w.buildings.col;
    for (let t = 0; t < w.townSize.length; t++) {
      const rule = TOWNS[w.townSize[t]];
      const r = rule.radius << CELL_SHIFT;
      const cx = (w.townX[t] << CELL_SHIFT) + 512;
      const cy = (w.townY[t] << CELL_SHIFT) + 512;
      const present = [0, 0];
      let militia = false;
      for (let s = 0; s < w.units.count; s++) {
        const o = u.owner[s];
        if (o === NEUTRAL) {
          if (u.home[s] === t) militia = true;
          continue;
        }
        if (o >= PLAYER_COUNT || u.type[s] === UnitType.Farmer || u.action[s] === Action.Garrisoned) continue;
        const dx = u.x[s] - cx;
        const dy = u.y[s] - cy;
        if (dx * dx + dy * dy <= r * r) present[o]++;
      }
      let tower = false;
      for (let s = 0; s < w.buildings.count; s++) if (b.type[s] === BuildingType.TownTower && b.town[s] === t) tower = true;
      const contested = present[0] > 0 && present[1] > 0;
      w.townContested[t] = contested ? 1 : 0;
      const state = w.townState[t];

      if (state === TownState.Ruins) {
        if (--w.townTimer[t] <= 0) {
          this.neutral(w, t);
          this.tell(w, t, { k: "town_restored", town: t }, []);
        }
        continue;
      }
      if (contested) continue;

      if (state === TownState.Neutral) {
        if (!militia && !tower && (present[0] > 0) !== (present[1] > 0)) this.capture(w, t, present[0] > 0 ? 0 : 1);
        continue;
      }

      const p = w.townOwner[t];
      if (p < 0 || p >= PLAYER_COUNT) continue;
      if (present[1 - p] > 0 && present[p] === 0) {
        this.capture(w, t, 1 - p);
        continue;
      }
      const manned = present[p] >= rule.garrisonNeeded;
      switch (state) {
        case TownState.Plundering:
          if (present[p] > 0 && --w.townTimer[t] <= 0) this.plundered(w, t, p);
          break;
        case TownState.Repairing:
          if (manned && --w.townTimer[t] <= 0) {
            w.townState[t] = TownState.Governed;
            w.townTimer[t] = 0;
            w.townTimerTotal[t] = 0;
            w.governed[p]++;
            this.tell(w, t, { k: "town_repaired", town: t, by: p }, [p]);
          }
          this.revoltCheck(w, t, p, manned);
          break;
        case TownState.Governed:
          if (manned) {
            const o = t * 3;
            w.townAcc[o] += rule.perMinute.food;
            w.townAcc[o + 1] += rule.perMinute.gold;
            w.townAcc[o + 2] += rule.perMinute.crystal;
            if (w.tick % TOWN_PAY_EVERY === 0) {
              const res = [Resource.Food, Resource.Gold, Resource.Crystal];
              for (let k = 0; k < 3; k++) {
                const pay = Math.trunc(w.townAcc[o + k] / PER_MINUTE);
                w.res[p * 4 + res[k]] += pay;
                w.townAcc[o + k] -= pay * PER_MINUTE;
              }
            }
          }
          this.revoltCheck(w, t, p, manned);
          break;
      }
    }
  }

  /** Below the minimum garrison a repairing or governed town counts down to revolt. */
  private revoltCheck(w: World, t: number, p: number, manned: boolean): void {
    if (w.townState[t] !== TownState.Repairing && w.townState[t] !== TownState.Governed) return;
    if (manned) {
      w.townRevolt[t] = 0;
      return;
    }
    if (w.townRevolt[t] === 0) w.townRevolt[t] = TOWNS[w.townSize[t]].revoltTicks;
    if (--w.townRevolt[t] > 0) return;
    this.neutral(w, t);
    this.tell(w, t, { k: "town_revolted", town: t, from: p }, [p]);
  }

  private capture(w: World, t: number, p: number): void {
    const before = w.townOwner[t];
    w.townState[t] = TownState.AwaitingChoice;
    w.townOwner[t] = p;
    w.townTimer[t] = 0;
    w.townTimerTotal[t] = 0;
    w.townRevolt[t] = 0;
    w.townAcc.fill(0, t * 3, t * 3 + 3);
    this.tell(w, t, { k: "town_captured", town: t, by: p }, before >= 0 && before < PLAYER_COUNT ? [p, before] : [p]);
  }

  private plundered(w: World, t: number, p: number): void {
    const rule = TOWNS[w.townSize[t]];
    w.res[p * 4 + Resource.Food] += rule.plunder.food;
    w.res[p * 4 + Resource.Gold] += rule.plunder.gold;
    w.res[p * 4 + Resource.Crystal] += rule.plunder.crystal;
    w.plundered[p]++;
    w.townState[t] = TownState.Ruins;
    w.townOwner[t] = NO_OWNER;
    w.townTimer[t] = rule.ruinsTicks;
    w.townTimerTotal[t] = rule.ruinsTicks;
    this.tell(
      w,
      t,
      { k: "town_plundered", town: t, by: p, food: rule.plunder.food, gold: rule.plunder.gold, crystal: rule.plunder.crystal },
      [p],
    );
  }

  /** Back to neutral with half the militia (after ruins or a revolt). */
  private neutral(w: World, t: number): void {
    w.townState[t] = TownState.Neutral;
    w.townOwner[t] = NEUTRAL;
    w.townTimer[t] = 0;
    w.townTimerTotal[t] = 0;
    w.townRevolt[t] = 0;
    w.townAcc.fill(0, t * 3, t * 3 + 3);
    spawnMilitia(w, t, TOWNS[w.townSize[t]].militia >> 1);
  }
}
