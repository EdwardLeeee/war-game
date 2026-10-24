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
  /** Lots each side traded at the market (D-101, MARKET), and its prices' highest and lowest. */
  marketLots: number[];
  priceHigh: number;
  priceLow: number;
}

export class GoldWatch {
  private readonly side: Int8Array;
  private readonly record: GoldRecord;

  constructor(w: World) {
    const map = w.map as { mirror?: Frame };
    const mirror = map.mirror ?? MIRROR_XY;
    const k = w.nodeKind.length;
    this.side = new Int8Array(k).fill(-2);
    const spawn = [0, 1].map((p) => w.map.spawns.find((s) => s.player === p)!);
    const own = new Array<number>(PLAYER_COUNT).fill(0);
    let contested = 0;
    for (let i = 0; i < k; i++) {
      if (w.nodeKind[i] !== NodeKind.GoldMine) continue;
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
      marketLots: new Array<number>(PLAYER_COUNT).fill(0),
      priceHigh: w.marketPrice[0],
      priceLow: w.marketPrice[0],
    };
  }

  /** Once a minute (tick a multiple of 1200). */
  minute(w: World): void {
    const r = this.record;
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
      if (node >= 0 && node < this.side.length && this.side[node] === -1) r.contestedFarmerMinutes[p]++;
    }
  }

  result(): GoldRecord {
    const r = this.record;
    return { ...r, own: [...r.own], out: [...r.out], contestedFarmerMinutes: [...r.contestedFarmerMinutes], marketLots: [...r.marketLots] };
  }
}
