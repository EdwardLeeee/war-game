// Fog of war, per player: a visible grid (rebuilt every FOG_EVERY ticks by stamping integer
// circle masks for every own unit and building), an explored grid (everything ever
// visible), and memory — the last sighting of each enemy or neutral building, each
// resource node and each town. Memory is simulation state: the AI decides from it.

import { CELL_SHIFT, NEUTRAL, PLAYER_COUNT, TOWN_STRIDE, TownField, TownFlag, TownState, UnitType } from "../protocol.ts";
import { BUILDINGS, TOWNS, UNITS } from "./rules.ts";
import type { World } from "./world.ts";

const MAX_SIGHT = 10;
/** MASKS[r] = [dx, dy, dx, dy, ...] of the disc of radius r (cells). */
const MASKS: number[][] = [];
for (let r = 0; r <= MAX_SIGHT; r++) {
  const m: number[] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r + r) m.push(dx, dy);
    }
  }
  MASKS.push(m);
}

/** One remembered building: [id, owner, type, cellX, cellY, hp]. */
export const MEM_STRIDE = 6;

export class Fog {
  visible: Uint8Array[] = [];
  explored: Uint8Array[] = [];
  /** Remembered enemy/neutral buildings per player, rows of MEM_STRIDE, in id order. */
  memory: number[][][] = [];
  /** Last seen amount of each node per player, -1 = never seen. */
  nodeSeen: Int32Array[] = [];
  /** Last seen town rows (TownField layout) per player; flags 0 = never explored. */
  townSeen: Int32Array[] = [];
  fogTick = -1;

  constructor(w: World) {
    const cells = w.size * w.size;
    for (let p = 0; p < PLAYER_COUNT; p++) {
      this.visible.push(new Uint8Array(cells));
      this.explored.push(new Uint8Array(cells));
      this.memory.push([]);
      this.nodeSeen.push(new Int32Array(w.nodeAmount.length).fill(-1));
      this.townSeen.push(new Int32Array(w.townSize.length * TOWN_STRIDE));
    }
  }

  /** Start of game: each player has explored the area around its spawn and knows its nodes. */
  reveal(w: World, radius: number): void {
    const n = w.size;
    for (let p = 0; p < PLAYER_COUNT; p++) {
      const s = w.map.spawns[p];
      const exp = this.explored[p];
      for (let y = Math.max(0, s.cellY - radius); y <= Math.min(n - 1, s.cellY + radius); y++) {
        for (let x = Math.max(0, s.cellX - radius); x <= Math.min(n - 1, s.cellX + radius); x++) {
          if ((x - s.cellX) * (x - s.cellX) + (y - s.cellY) * (y - s.cellY) <= radius * radius) exp[y * n + x] = 1;
        }
      }
      const seen = this.nodeSeen[p];
      for (let k = 0; k < seen.length; k++) if (exp[w.nodeY[k] * n + w.nodeX[k]] === 1) seen[k] = w.nodeAmount[k];
    }
  }

  update(w: World): void {
    this.fogTick = w.tick;
    const n = w.size;
    const u = w.units.col;
    const b = w.buildings.col;
    for (let p = 0; p < PLAYER_COUNT; p++) {
      const vis = this.visible[p];
      const exp = this.explored[p];
      vis.fill(0);
      const stamp = (cx: number, cy: number, r: number) => {
        const m = MASKS[Math.min(r, MAX_SIGHT)];
        for (let i = 0; i < m.length; i += 2) {
          const x = cx + m[i];
          const y = cy + m[i + 1];
          if (x >= 0 && y >= 0 && x < n && y < n) vis[y * n + x] = 1;
        }
      };
      for (let s = 0; s < w.units.count; s++) {
        if (u.owner[s] !== p) continue;
        stamp(u.x[s] >> CELL_SHIFT, u.y[s] >> CELL_SHIFT, UNITS[u.type[s]].sight);
      }
      for (let s = 0; s < w.buildings.count; s++) {
        if (b.owner[s] !== p) continue;
        const info = BUILDINGS[b.type[s]];
        const half = info.size >> 1;
        stamp(b.cellX[s] + half, b.cellY[s] + half, info.sight + half);
      }
      for (let i = 0; i < vis.length; i++) if (vis[i] === 1) exp[i] = 1;

      // Buildings: currently visible ones replace their memory; memories whose footprint is
      // visible but whose building is gone are dropped; the rest are kept.
      const next: number[][] = [];
      const old = this.memory[p];
      const footprintVisible = (cellX: number, cellY: number, size: number) => {
        for (let y = cellY; y < cellY + size; y++) {
          for (let x = cellX; x < cellX + size; x++) if (vis[y * n + x] === 1) return true;
        }
        return false;
      };
      let oi = 0;
      for (let s = 0; s < w.buildings.count; s++) {
        const id = b.id[s];
        while (oi < old.length && old[oi][0] < id) {
          const m = old[oi++];
          if (!footprintVisible(m[3], m[4], BUILDINGS[m[2]].size)) next.push(m);
        }
        const keepOld = oi < old.length && old[oi][0] === id ? old[oi++] : null;
        if (b.owner[s] === p) continue;
        if (footprintVisible(b.cellX[s], b.cellY[s], BUILDINGS[b.type[s]].size)) {
          next.push([id, b.owner[s], b.type[s], b.cellX[s], b.cellY[s], b.hp[s]]);
        } else if (keepOld !== null) {
          next.push(keepOld);
        }
      }
      while (oi < old.length) {
        const m = old[oi++];
        if (!footprintVisible(m[3], m[4], BUILDINGS[m[2]].size)) next.push(m);
      }
      this.memory[p] = next;

      const seen = this.nodeSeen[p];
      for (let i = 0; i < seen.length; i++) {
        if (vis[w.nodeY[i] * n + w.nodeX[i]] === 1) seen[i] = w.nodeAmount[i];
      }

      const towns = this.townSeen[p];
      for (let t = 0; t < w.townSize.length; t++) {
        const o = t * TOWN_STRIDE;
        const visibleNow = vis[w.townY[t] * n + w.townX[t]] === 1;
        if (visibleNow) {
          writeTownRow(w, t, towns, o);
          towns[o + TownField.flags] |= TownFlag.Visible;
        } else {
          towns[o + TownField.flags] &= ~TownFlag.Visible;
        }
      }
    }
  }
}

/** The live row of a town (TownField layout), as everyone who sees it gets it. */
export function writeTownRow(w: World, t: number, out: Int32Array, o: number): void {
  const rule = TOWNS[w.townSize[t]];
  out[o + TownField.id] = t;
  out[o + TownField.state] = w.townState[t];
  out[o + TownField.owner] = w.townOwner[t];
  out[o + TownField.timer] = w.townTimer[t];
  out[o + TownField.timerTotal] = w.townTimerTotal[t];
  let militia = 0;
  let garrison = 0;
  const u = w.units.col;
  const r = rule.radius << CELL_SHIFT;
  const cx = (w.townX[t] << CELL_SHIFT) + 512;
  const cy = (w.townY[t] << CELL_SHIFT) + 512;
  for (let s = 0; s < w.units.count; s++) {
    if (u.home[s] === t && u.owner[s] === NEUTRAL) militia++;
    if (u.owner[s] === w.townOwner[t] && u.owner[s] !== NEUTRAL && u.type[s] !== UnitType.Farmer) {
      const dx = u.x[s] - cx;
      const dy = u.y[s] - cy;
      if (dx * dx + dy * dy <= r * r) garrison++;
    }
  }
  out[o + TownField.garrison] = garrison;
  out[o + TownField.garrisonNeeded] = rule.garrisonNeeded;
  out[o + TownField.militia] = militia;
  out[o + TownField.revoltTimer] = w.townRevolt[t];
  const held = w.townState[t] === TownState.Repairing || w.townState[t] === TownState.Governed;
  out[o + TownField.flags] =
    (out[o + TownField.flags] & TownFlag.Visible) | (held && garrison < rule.garrisonNeeded ? TownFlag.BelowGarrison : 0);
}
