// Fights at a main city (D-141; the user 2026-11-10: a main city should hold about a minute, a steal should still work
// when the defender cannot come back in time, and be a battle when it can). Every CITY.sample ticks: each side's
// soldiers near the other's main city; a fight is CITY.armyNear or more of them within CITY.near cells of it, and ends
// when fewer than CITY.gone stay CITY.endTicks or the city falls. For the CI tables and the steal group; changes nothing.

import { BuildingType, CELL_SHIFT, PLAYER_COUNT, UnitType } from "./protocol.ts";
import { BUILDINGS } from "./core/rules.ts";
import type { World } from "./core/world.ts";

export const CITY = {
  sample: 20,
  near: 12,
  armyNear: 10,
  gone: 5,
  endTicks: 30 * 20,
  /** The defender's soldiers this near its main city count as holding it. */
  holdNear: 20,
};

export interface CityFight {
  /** Ticks: the attackers came; the city's first hit after; the fight's end. */
  start: number;
  firstHit: number;
  end: number;
  fell: boolean;
  /** From the first hit to the fall, seconds (-1: it held). */
  heldSecs: number;
  /** The city's lowest hp, per mille. */
  hpMin: number;
  /** The most attackers near it at once; the defender's soldiers near it at the start and the most at once. */
  attackers: number;
  defendersAtStart: number;
  defendersMost: number;
}

/** fights[a]: side a's fights at side 1 - a's main city. */
export interface CityRecord {
  fights: CityFight[][];
}

interface Open {
  fight: CityFight;
  lastSeen: number;
  hp: number;
}

export class CityWatch {
  private readonly fights: CityFight[][] = [[], []];
  private readonly open: (Open | null)[] = [null, null];

  tick(w: World): void {
    if (w.tick % CITY.sample !== 0) return;
    const b = w.buildings.col;
    const u = w.units.col;
    for (let a = 0; a < PLAYER_COUNT; a++) {
      const d = 1 - a;
      let cs = -1;
      for (let s = 0; s < w.buildings.count; s++) if (b.type[s] === BuildingType.MainCity && b.owner[s] === d && b.hp[s] > 0) cs = s;
      const o = this.open[a];
      if (cs < 0) {
        // The city is down: an open fight took it.
        if (o !== null) {
          o.fight.end = w.tick;
          o.fight.fell = true;
          o.fight.hpMin = 0;
          o.fight.heldSecs = o.fight.firstHit >= 0 ? Math.round(((w.tick - o.fight.firstHit) / 20) * 10) / 10 : 0;
          this.open[a] = null;
        }
        continue;
      }
      const x0 = b.cellX[cs];
      const y0 = b.cellY[cs];
      const size = BUILDINGS[BuildingType.MainCity].size;
      let attackers = 0;
      let defenders = 0;
      for (let s = 0; s < w.units.count; s++) {
        if (u.type[s] === UnitType.Farmer || u.owner[s] >= PLAYER_COUNT) continue;
        const x = u.x[s] >> CELL_SHIFT;
        const y = u.y[s] >> CELL_SHIFT;
        const dist = Math.max(x0 - x, 0, x - (x0 + size - 1), y0 - y, 0, y - (y0 + size - 1));
        if (u.owner[s] === a && dist <= CITY.near) attackers++;
        else if (u.owner[s] === d && dist <= CITY.holdNear) defenders++;
      }
      const hp = Math.round((b.hp[cs] * 1000) / w.maxHp(cs));
      if (o === null) {
        if (attackers < CITY.armyNear) continue;
        const fight: CityFight = { start: w.tick, firstHit: -1, end: w.tick, fell: false, heldSecs: -1, hpMin: hp, attackers, defendersAtStart: defenders, defendersMost: defenders };
        this.fights[a].push(fight);
        this.open[a] = { fight, lastSeen: w.tick, hp };
        continue;
      }
      const f = o.fight;
      if (f.firstHit < 0 && hp < o.hp) f.firstHit = w.tick;
      o.hp = hp;
      f.hpMin = Math.min(f.hpMin, hp);
      f.attackers = Math.max(f.attackers, attackers);
      f.defendersMost = Math.max(f.defendersMost, defenders);
      if (attackers >= CITY.gone) o.lastSeen = w.tick;
      f.end = w.tick;
      if (w.tick - o.lastSeen >= CITY.endTicks) this.open[a] = null;
    }
  }

  /** At the game's end: a fight still open at a city the game ended on (its fall) is closed as taken. */
  result(w: World): CityRecord {
    for (let a = 0; a < PLAYER_COUNT; a++) {
      const o = this.open[a];
      if (o === null || !w.over || w.winner !== a) continue;
      o.fight.end = w.tick;
      o.fight.fell = true;
      o.fight.hpMin = 0;
      o.fight.heldSecs = o.fight.firstHit >= 0 ? Math.round(((w.tick - o.fight.firstHit) / 20) * 10) / 10 : 0;
      this.open[a] = null;
    }
    return { fights: this.fights.map((l) => l.map((f) => ({ ...f }))) };
  }
}
