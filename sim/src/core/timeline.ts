// The post-game timeline (D-124, D-125; PROTOCOL.md 6.1): samples of both sides every TIMELINE.every ticks, town changes,
// main cities under attack, every death (World.deathLog). It only reads the world, and nothing of it is in the hash, so a
// game plays the same with it. `continue` runs the game again from tick 0, so it comes back by itself.

import { BuildingType, CELL_SHIFT, PLAYER_COUNT, Resource, type DeathRow, type GameTimeline, type TimelineSample, type TimelineSide, type TownLogRow, UnitType } from "../protocol.ts";
import { BUILDINGS, TIMELINE } from "./rules.ts";
import { HitCause, UNIT_KINDS, type World } from "./world.ts";

const RESOURCES = [Resource.Food, Resource.Wood, Resource.Gold, Resource.Crystal];
/** Numbers a death takes in World.deathLog. */
const DEATH_STRIDE = 8;

export class Timeline {
  private readonly samples: TimelineSample[] = [];
  private readonly towns: TownLogRow[] = [];
  private readonly townState: Int32Array;
  private readonly townOwner: Int32Array;
  /** Per player: its main city's id (-1 none), footprint and spells under attack. */
  private readonly cities: { id: number; x: number; y: number; size: number; hits: [number, number, number][]; fell: boolean }[] = [];

  constructor(w: World) {
    this.townState = Int32Array.from(w.townState);
    this.townOwner = Int32Array.from(w.townOwner);
    const b = w.buildings.col;
    for (let p = 0; p < PLAYER_COUNT; p++) {
      const s = w.mainCity(p);
      const size = BUILDINGS[BuildingType.MainCity].size;
      this.cities.push({ id: s < 0 ? -1 : b.id[s], x: s < 0 ? 0 : b.cellX[s], y: s < 0 ? 0 : b.cellY[s], size, hits: [], fell: false });
    }
    this.samples.push(this.sample(w));
  }

  /** At the end of a step, its tick (w.tick - 1) done. */
  step(w: World): void {
    const t = w.tick - 1;
    for (let k = 0; k < this.townState.length; k++) {
      if (w.townState[k] === this.townState[k] && w.townOwner[k] === this.townOwner[k]) continue;
      this.townState[k] = w.townState[k];
      this.townOwner[k] = w.townOwner[k];
      this.towns.push([t, k, w.townState[k], w.townOwner[k]]);
    }
    const b = w.buildings.col;
    for (const c of this.cities) {
      if (c.id < 0 || c.fell) continue;
      const s = w.building(c.id);
      if (s < 0) {
        // Fallen this tick: the blow that did it is on a building no longer there.
        c.fell = true;
        this.hit(c, t, 0);
      } else if (b.lastHurt[s] === t) {
        this.hit(c, t, b.hp[s]);
      }
    }
    if (w.tick % TIMELINE.every === 0) this.samples.push(this.sample(w));
  }

  private hit(c: { hits: [number, number, number][] }, t: number, hp: number): void {
    const last = c.hits[c.hits.length - 1];
    if (last === undefined || t - last[1] > TIMELINE.calmTicks) {
      c.hits.push([t, t, hp]);
      return;
    }
    last[1] = t;
    last[2] = Math.min(last[2], hp);
  }

  private sample(w: World): TimelineSample {
    const u = w.units.col;
    const units: [number[], number[]] = [new Array<number>(UNIT_KINDS).fill(0), new Array<number>(UNIT_KINDS).fill(0)];
    const places = this.townState.length;
    const counts = new Int32Array((places + PLAYER_COUNT) * PLAYER_COUNT);
    for (let s = 0; s < w.units.count; s++) {
      const p = u.owner[s];
      if (p >= PLAYER_COUNT) continue;
      units[p][u.type[s]]++;
      if (u.type[s] === UnitType.Farmer) continue;
      const x = u.x[s] >> CELL_SHIFT;
      const y = u.y[s] >> CELL_SHIFT;
      for (let t = 0; t < places; t++) if (w.nearTown(t, x, y, TIMELINE.nearTown)) counts[t * PLAYER_COUNT + p]++;
      for (let k = 0; k < PLAYER_COUNT; k++) {
        const c = this.cities[k];
        if (c.id < 0) continue;
        const dx = Math.max(c.x - x, 0, x - (c.x + c.size - 1));
        const dy = Math.max(c.y - y, 0, y - (c.y + c.size - 1));
        if (Math.max(dx, dy) <= TIMELINE.nearCity) counts[(places + k) * PLAYER_COUNT + p]++;
      }
    }
    const near: TimelineSample["near"] = [];
    for (let k = 0; k < places + PLAYER_COUNT; k++) {
      const n0 = counts[k * PLAYER_COUNT];
      const n1 = counts[k * PLAYER_COUNT + 1];
      if (n0 > 0 || n1 > 0) near.push([k, n0, n1]);
    }
    const per = (read: (p: number, r: number) => number): [number[], number[]] => [RESOURCES.map((r) => read(0, r)), RESOURCES.map((r) => read(1, r))];
    return {
      tick: w.tick,
      earned: per((p, r) => w.gathered[p * 4 + r] + w.earnedExtra[p * 4 + r]),
      stock: per((p, r) => w.res[p * 4 + r]),
      units,
      near,
    };
  }

  /** The timeline so far, with a sample of now if the last is older. The caller may keep it: nothing in it is shared. */
  result(w: World): GameTimeline {
    const samples = this.samples.slice();
    if (samples[samples.length - 1].tick !== w.tick) samples.push(this.sample(w));
    const deaths: DeathRow[] = [];
    const log = w.deathLog;
    for (let k = 0; k < log.length; k += DEATH_STRIDE) deaths.push([log[k], log[k + 1], log[k + 2], log[k + 3], log[k + 4], log[k + 5], log[k + 6]]);
    const side = (p: number): TimelineSide => ({
      trained: Array.from(w.trained.subarray(p * UNIT_KINDS, (p + 1) * UNIT_KINDS)),
      lost: Array.from(w.lost.subarray(p * UNIT_KINDS, (p + 1) * UNIT_KINDS)),
      cannon: { shots: w.cannonShots[p], hits: w.cannonHits[p], kills: w.cannonKills[p], best: bestShot(log, p) },
      cityHits: this.cities[p].hits.map((h) => [h[0], h[1], h[2]]),
      ai: null,
    });
    return { every: TIMELINE.every, samples, towns: this.towns.map((r) => [r[0], r[1], r[2], r[3]]), deaths, sides: [side(0), side(1)] };
  }
}

/** Player p's crystal cannon shot that killed most: a mage fires at most once a tick, and what it kills dies that tick. */
function bestShot(log: readonly number[], p: number): TimelineSide["cannon"]["best"] {
  let best: TimelineSide["cannon"]["best"] = null;
  const shots = new Map<number, NonNullable<TimelineSide["cannon"]["best"]>>();
  for (let k = 0; k < log.length; k += DEATH_STRIDE) {
    if (log[k + 5] !== p || log[k + 6] !== HitCause.Cannon) continue;
    // Tick and the mage's id; deaths come in tick order, so only this tick's shots can still grow.
    const key = log[k] * 4194304 + log[k + 7];
    let shot = shots.get(key);
    if (shot === undefined) {
      shot = { kills: 0, tick: log[k], x: log[k + 3], y: log[k + 4], types: new Array<number>(UNIT_KINDS).fill(0) };
      shots.set(key, shot);
    }
    shot.kills++;
    shot.types[log[k + 2]]++;
    if (best === null || shot.kills > best.kills) best = shot;
  }
  return best;
}
