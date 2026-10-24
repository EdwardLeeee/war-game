// D-101's measurement (ceo 2026-10-24): when each side's own gold runs out, how much each side
// mines the contested gold, and the market's use. Reads the world once a minute; changes nothing.
//
// A gold cell is contested if its image under the map's mirror lies within 3 cells of it (on the
// axis: as far from both main cities); every other gold cell is the side's whose main city is
// nearer. A side's gold is out the first minute its own cells hold none.

import { MIRROR_XY, type Frame, toCanon } from "./frame.ts";
import { NodeKind, Order, PLAYER_COUNT, UnitType } from "./protocol.ts";
import type { World } from "./core/world.ts";

export interface GoldRecord {
  /** Gold on the map at the start: each side's own, and the contested cells'. */
  own: number[];
  contested: number;
  /** The minute each side's own gold ran out (-1: not by the end). */
  out: number[];
  /** Farmer-minutes each side spent mining contested gold (farmers gathering it, counted each minute). */
  contestedFarmerMinutes: number[];
  /** Contested gold left at the end. */
  contestedLeft: number;
  /** The minute each side first sent a farmer to gold farther than 15 cells from its main city (-1: never). */
  secondGold: number[];
  /** Wood within 20 cells of each side's main city at the start, and the minute it was all cut (-1: not by the end). */
  woodNear: number[];
  woodNearOut: number[];
  /** Cells from each side's main city to its nearest standing tree at minutes 30, 45 and 60 (absent: over by then). */
  nearestTree: Record<string, number[]>;
  /** Lots each side traded at the market (D-101, MARKET), and its prices' highest and lowest. */
  marketLots: number[];
  priceHigh: number;
  priceLow: number;
}

export class GoldWatch {
  private readonly side: Int8Array;
  /** Per gold cell, a bit per side whose main city is within 15 cells of it (its home gold). */
  private readonly home: Uint8Array;
  private readonly record: GoldRecord;

  constructor(w: World) {
    const map = w.map as { mirror?: Frame };
    const mirror = map.mirror ?? MIRROR_XY;
    const k = w.nodeKind.length;
    this.side = new Int8Array(k).fill(-2);
    this.home = new Uint8Array(k);
    const woodNear = new Array<number>(PLAYER_COUNT).fill(0);
    for (let i = 0; i < k; i++) {
      if (w.nodeKind[i] !== NodeKind.Tree) continue;
      for (const s of w.map.spawns) if (this.near(w, i, s, 400)) woodNear[s.player] += w.nodeAmount[i];
    }
    const spawn = [0, 1].map((p) => w.map.spawns.find((s) => s.player === p)!);
    const own = new Array<number>(PLAYER_COUNT).fill(0);
    let contested = 0;
    for (let i = 0; i < k; i++) {
      if (w.nodeKind[i] !== NodeKind.GoldMine) continue;
      for (const s of w.map.spawns) if ((w.nodeX[i] - s.cellX) * (w.nodeX[i] - s.cellX) + (w.nodeY[i] - s.cellY) * (w.nodeY[i] - s.cellY) <= 225) this.home[i] |= 1 << s.player;
      const m = toCanon(mirror, w.nodeX[i], w.nodeY[i]);
      if (Math.max(Math.abs(m.u - w.nodeX[i]), Math.abs(m.v - w.nodeY[i])) <= 3) {
        this.side[i] = -1;
        contested += w.nodeAmount[i];
        continue;
      }
      const d = spawn.map((s) => (w.nodeX[i] - s.cellX) * (w.nodeX[i] - s.cellX) + (w.nodeY[i] - s.cellY) * (w.nodeY[i] - s.cellY));
      this.side[i] = d[0] <= d[1] ? 0 : 1;
      own[this.side[i]] += w.nodeAmount[i];
    }
    this.record = {
      own,
      contested,
      out: new Array<number>(PLAYER_COUNT).fill(-1),
      contestedFarmerMinutes: new Array<number>(PLAYER_COUNT).fill(0),
      contestedLeft: contested,
      secondGold: new Array<number>(PLAYER_COUNT).fill(-1),
      woodNear,
      woodNearOut: new Array<number>(PLAYER_COUNT).fill(-1),
      nearestTree: {},
      marketLots: new Array<number>(PLAYER_COUNT).fill(0),
      priceHigh: w.marketPrice[0],
      priceLow: w.marketPrice[0],
    };
  }

  private near(w: World, i: number, s: { cellX: number; cellY: number }, d2: number): boolean {
    return (w.nodeX[i] - s.cellX) * (w.nodeX[i] - s.cellX) + (w.nodeY[i] - s.cellY) * (w.nodeY[i] - s.cellY) <= d2;
  }

  /** Once a minute (tick a multiple of 1200). */
  minute(w: World): void {
    const r = this.record;
    // Wood: what is left within 20 cells of each main city, and (minutes 30, 45, 60) the nearest tree.
    const minute = Math.trunc(w.tick / 1200);
    const wood = new Array<number>(PLAYER_COUNT).fill(0);
    const nearest = new Array<number>(PLAYER_COUNT).fill(Number.MAX_SAFE_INTEGER);
    for (let i = 0; i < w.nodeKind.length; i++) {
      if (w.nodeKind[i] !== NodeKind.Tree || w.nodeAmount[i] <= 0) continue;
      for (const s of w.map.spawns) {
        const d2 = (w.nodeX[i] - s.cellX) * (w.nodeX[i] - s.cellX) + (w.nodeY[i] - s.cellY) * (w.nodeY[i] - s.cellY);
        if (d2 <= 400) wood[s.player] += w.nodeAmount[i];
        nearest[s.player] = Math.min(nearest[s.player], d2);
      }
    }
    for (let p = 0; p < PLAYER_COUNT; p++) if (r.woodNearOut[p] < 0 && wood[p] === 0 && r.woodNear[p] > 0) r.woodNearOut[p] = minute;
    if (minute === 30 || minute === 45 || minute === 60) r.nearestTree[`m${minute}`] = nearest.map((d) => Math.round(Math.sqrt(d)));
    const left = new Array<number>(PLAYER_COUNT).fill(0);
    let contested = 0;
    for (let i = 0; i < this.side.length; i++) {
      if (this.side[i] === -2) continue;
      if (this.side[i] === -1) contested += w.nodeAmount[i];
      else left[this.side[i]] += w.nodeAmount[i];
    }
    r.contestedLeft = contested;
    for (let p = 0; p < PLAYER_COUNT; p++) r.marketLots[p] = w.marketLots[p];
    for (const v of w.marketPrice) {
      r.priceHigh = Math.max(r.priceHigh, v);
      r.priceLow = Math.min(r.priceLow, v);
    }
    for (let p = 0; p < PLAYER_COUNT; p++) if (r.out[p] < 0 && left[p] === 0 && r.own[p] > 0) r.out[p] = Math.trunc(w.tick / 1200);
    const u = w.units.col;
    for (let s = 0; s < w.units.count; s++) {
      const p = u.owner[s];
      if (p >= PLAYER_COUNT || u.type[s] !== UnitType.Farmer || u.order[s] !== Order.Gather) continue;
      const node = u.orderTarget[s];
      if (node < 0 || node >= this.side.length || this.side[node] === -2) continue;
      if (this.side[node] === -1) r.contestedFarmerMinutes[p]++;
      if (r.secondGold[p] < 0 && (this.home[node] & (1 << p)) === 0) r.secondGold[p] = Math.trunc(w.tick / 1200);
    }
  }

  result(): GoldRecord {
    const r = this.record;
    return {
      ...r,
      own: [...r.own],
      out: [...r.out],
      contestedFarmerMinutes: [...r.contestedFarmerMinutes],
      secondGold: [...r.secondGold],
      woodNear: [...r.woodNear],
      woodNearOut: [...r.woodNearOut],
      nearestTree: Object.fromEntries(Object.entries(r.nearestTree).map(([k, v]) => [k, [...v]])),
      marketLots: [...r.marketLots],
    };
  }
}
