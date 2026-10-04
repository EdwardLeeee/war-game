// Training shared by the `train` command and automatic training (round 6, D-054): what a
// player has queued, its mages, and the step that queues the next unit of a barracks, range or
// mage hall whose automatic training is on.

import { BuildingFlag, BuildingType, PLAYER_COUNT, Resource, UnitType } from "../protocol.ts";
import { BUILDINGS, MAGE_CAP, MAIN_CRYSTAL, UNITS } from "./rules.ts";
import type { World } from "./world.ts";

/** Every MAIN_CRYSTAL.every ticks, each standing main city gives its owner crystal (D-057). */
export function mainCityCrystal(w: World): void {
  if (MAIN_CRYSTAL.every <= 0 || w.tick === 0 || w.tick % MAIN_CRYSTAL.every !== 0) return;
  const b = w.buildings.col;
  for (let s = 0; s < w.buildings.count; s++) {
    if (b.type[s] !== BuildingType.MainCity || b.hp[s] <= 0 || b.owner[s] >= PLAYER_COUNT) continue;
    w.res[b.owner[s] * 4 + Resource.Crystal] += MAIN_CRYSTAL.amount;
  }
}

/** Units in every own training queue: all of them, and the mages. */
export function queuedUnits(w: World, p: number): { all: number; mages: number } {
  const b = w.buildings.col;
  const q = [b.q0, b.q1, b.q2, b.q3, b.q4, b.q5, b.q6];
  let all = 0;
  let m = 0;
  for (let s = 0; s < w.buildings.count; s++) {
    if (b.owner[s] !== p) continue;
    all += b.queueLength[s];
    for (let k = 0; k < b.queueLength[s]; k++) if (q[k][s] === UnitType.Mage) m++;
  }
  return { all, mages: m };
}

export function mages(w: World, p: number): number {
  const u = w.units.col;
  let m = 0;
  for (let s = 0; s < w.units.count; s++) if (u.owner[s] === p && u.type[s] === UnitType.Mage) m++;
  return m;
}

/**
 * Every finished building with AutoTrain and an empty queue queues one of its unit, as a
 * `train` command would, when the population has room, the mage cap allows it, and what the
 * player has above its reserve pays for it. Buildings in slot order, so the older building
 * of a player is paid first. AutoPopulationFull marks the ones stopped by the population.
 */
export function autoTrain(w: World): void {
  const b = w.buildings.col;
  for (let s = 0; s < w.buildings.count; s++) {
    if ((b.flags[s] & BuildingFlag.AutoTrain) === 0) continue;
    b.flags[s] &= ~BuildingFlag.AutoPopulationFull;
    if (b.queueLength[s] !== 0 || b.progress[s] < 1000 || b.hp[s] <= 0) continue;
    const p = b.owner[s];
    if (p >= PLAYER_COUNT) continue;
    const type = BUILDINGS[b.type[s]].trains[0];
    const queued = queuedUnits(w, p);
    if (w.population(p) + queued.all + 1 > w.populationCap(p)) {
      b.flags[s] |= BuildingFlag.AutoPopulationFull;
      continue;
    }
    if (type === UnitType.Mage && mages(w, p) + queued.mages + 1 > MAGE_CAP) continue;
    const cost = UNITS[type].cost;
    const o = p * 4;
    // Only the resources the unit costs: a reserve of gold does not stop a spearman.
    const short = (r: Resource, need: number) => need > 0 && w.res[o + r] - w.reserve[o + r] < need;
    if (short(Resource.Food, cost.food) || short(Resource.Wood, cost.wood) || short(Resource.Gold, cost.gold) || short(Resource.Crystal, cost.crystal)) continue;
    w.res[o + Resource.Food] -= cost.food;
    w.res[o + Resource.Wood] -= cost.wood;
    w.res[o + Resource.Gold] -= cost.gold;
    w.res[o + Resource.Crystal] -= cost.crystal;
    b.q0[s] = type;
    b.queueLength[s] = 1;
    b.queueTicks[s] = 0;
  }
}
