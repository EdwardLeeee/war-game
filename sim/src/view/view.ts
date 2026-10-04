// PlayerView: what one player can see, in the protocol's table layouts. The screen gets it
// as snapshots (SnapshotEncoder adds node deltas and fog updates) and the AI reads the same
// object, so both see exactly the same things:
// - own units and buildings: all;
// - other units: only on cells the player sees now;
// - other buildings: live when seen now, else the player's memory (flag Remembered);
// - resource nodes: the ones ever seen, with the amount last seen;
// - towns: the ones explored, as last seen;
// - placement: where the player may try to build, from what it knows (PROTOCOL.md section 7).
// Farmers hidden in buildings (recall) are listed only for their owner.
// A null player is a spectator (AI against AI on screen): everything, live.

import {
  Action,
  BuildingType,
  BUILDING_STRIDE,
  BuildingField,
  BuildingFlag,
  CELL_SHIFT,
  Fog as FogState,
  GameState,
  HEADER_LENGTH,
  HeaderField,
  NODE_STRIDE,
  NodeField,
  Order,
  PLAYER_COUNT,
  PlaceBit,
  Scenario,
  type Snapshot,
  TOWN_STRIDE,
  TownField,
  TownFlag,
  UNIT_STRIDE,
  UnitField,
  UnitFlag,
  UnitType,
  WARNING_STRIDE,
  WarningField,
} from "../protocol.ts";
import { writeTownRow } from "../core/fog.ts";
import type { Game } from "../core/game.ts";
import { BUILDINGS, CANNON, FARMLAND_REACH, MAGE_CAP, MAIN_CITY_REPAIR_LOCK, UNITS } from "../core/rules.ts";

export interface PlayerView {
  /** The viewing player, or null for a spectator. */
  player: number | null;
  tick: number;
  header: Int32Array;
  units: Int32Array;
  buildings: Int32Array;
  towns: Int32Array;
  warnings: Int32Array;
  /** Every node the player has seen (NODE_STRIDE rows). */
  nodes: Int32Array;
  /** size * size Fog values as of fogTick. */
  fog: Uint8Array;
  fogTick: number;
  /** size * size PlaceBit values (PROTOCOL.md section 7). */
  placement: Uint8Array;
  /** Own idle farmers, in id order. */
  idleFarmers: Int32Array;
  mapSize: number;
}

export interface RunnerInfo {
  paused: boolean;
  tps: number;
  stepMicros: number;
  stepBatchMicros: number;
}

const SCENARIO_ID: Record<string, number> = { standard: Scenario.Standard, e2e: Scenario.E2e, perf: Scenario.Perf };

export function buildView(game: Game, player: number | null, info?: RunnerInfo): PlayerView {
  const w = game.w;
  const fog = game.fog;
  const n = w.size;
  const vis = player === null ? null : fog.visible[player];
  const exp = player === null ? null : fog.explored[player];
  const seesCell = (cx: number, cy: number) => vis === null || vis[cy * n + cx] === 1;

  // Units.
  const u = w.units.col;
  const unitRows: number[] = [];
  const idle: number[] = [];
  for (let s = 0; s < w.units.count; s++) {
    const own = u.owner[s] === player;
    if (!own && player !== null && (u.action[s] === Action.Garrisoned || !seesCell(u.x[s] >> CELL_SHIFT, u.y[s] >> CELL_SHIFT))) continue;
    unitRows.push(s);
    if (own && u.type[s] === UnitType.Farmer && u.order[s] === Order.None && u.action[s] !== Action.Garrisoned) idle.push(u.id[s]);
  }
  const units = new Int32Array(unitRows.length * UNIT_STRIDE);
  unitRows.forEach((s, r) => {
    const o = r * UNIT_STRIDE;
    units[o + UnitField.id] = u.id[s];
    units[o + UnitField.owner] = u.owner[s];
    units[o + UnitField.type] = u.type[s];
    units[o + UnitField.x] = u.x[s];
    units[o + UnitField.y] = u.y[s];
    units[o + UnitField.hp] = u.hp[s];
    units[o + UnitField.shield] = u.shield[s];
    units[o + UnitField.action] = u.action[s];
    units[o + UnitField.facing] = u.facing[s];
    units[o + UnitField.carryKind] = u.carryKind[s];
    units[o + UnitField.carryAmount] = u.carryAmount[s];
    units[o + UnitField.order] = u.order[s];
    units[o + UnitField.orderTarget] = u.orderTarget[s];
    units[o + UnitField.stance] = u.stance[s];
    units[o + UnitField.castProgress] = u.castProgress[s];
    const idleFarmer = u.owner[s] === player && u.type[s] === UnitType.Farmer && u.order[s] === Order.None && u.action[s] !== Action.Garrisoned;
    units[o + UnitField.flags] = u.flags[s] | (idleFarmer ? UnitFlag.IdleFarmer : 0);
    units[o + UnitField.castCooldown] = u.castCooldown[s];
  });

  // Buildings: own and currently seen ones live; others from memory.
  const b = w.buildings.col;
  const rows: number[][] = [];
  const seenNow = new Set<number>();
  for (let s = 0; s < w.buildings.count; s++) {
    const own = b.owner[s] === player;
    const size = BUILDINGS[b.type[s]].size;
    let visible = own || player === null;
    if (!visible) {
      for (let y = b.cellY[s]; y < b.cellY[s] + size && !visible; y++) {
        for (let x = b.cellX[s]; x < b.cellX[s] + size; x++) {
          if (seesCell(x, y)) {
            visible = true;
            break;
          }
        }
      }
    }
    if (!visible) continue;
    seenNow.add(b.id[s]);
    const row = new Array(BUILDING_STRIDE).fill(0);
    row[BuildingField.id] = b.id[s];
    row[BuildingField.owner] = b.owner[s];
    row[BuildingField.type] = b.type[s];
    row[BuildingField.cellX] = b.cellX[s];
    row[BuildingField.cellY] = b.cellY[s];
    row[BuildingField.hp] = b.hp[s];
    row[BuildingField.progress] = b.progress[s];
    if (own || player === null) {
      let packed = 0;
      const q = [b.q0[s], b.q1[s], b.q2[s], b.q3[s], b.q4[s], b.q5[s], b.q6[s]];
      for (let k = 0; k < b.queueLength[s]; k++) packed |= (q[k] & 15) << (4 * k);
      row[BuildingField.queueLength] = b.queueLength[s];
      row[BuildingField.queuePacked] = packed;
      const head = b.queueLength[s] > 0 ? UNITS[b.q0[s]].trainTicks : 0;
      row[BuildingField.queueProgress] = head > 0 ? Math.trunc((b.queueTicks[s] * 1000) / head) : 0;
      row[BuildingField.rallyX] = b.rallyX[s];
      row[BuildingField.rallyY] = b.rallyY[s];
      row[BuildingField.garrisoned] = b.garrisoned[s];
    } else {
      row[BuildingField.rallyX] = -1;
      row[BuildingField.rallyY] = -1;
    }
    row[BuildingField.flags] = w.tick - b.lastHurt[s] < 60 ? BuildingFlag.UnderAttack : 0;
    if (
      (own || player === null) &&
      b.type[s] === BuildingType.MainCity &&
      b.hp[s] < BUILDINGS[BuildingType.MainCity].hp &&
      w.tick - b.lastHurt[s] < MAIN_CITY_REPAIR_LOCK
    ) {
      row[BuildingField.flags] |= BuildingFlag.RepairLocked;
    }
    if (own || player === null) row[BuildingField.flags] |= b.flags[s] & (BuildingFlag.AutoTrain | BuildingFlag.AutoPopulationFull);
    rows.push(row);
  }
  if (player !== null) {
    for (const m of fog.memory[player]) {
      if (seenNow.has(m[0])) continue;
      const row = new Array(BUILDING_STRIDE).fill(0);
      row[BuildingField.id] = m[0];
      row[BuildingField.owner] = m[1];
      row[BuildingField.type] = m[2];
      row[BuildingField.cellX] = m[3];
      row[BuildingField.cellY] = m[4];
      row[BuildingField.hp] = m[5];
      row[BuildingField.progress] = 1000;
      row[BuildingField.rallyX] = -1;
      row[BuildingField.rallyY] = -1;
      row[BuildingField.flags] = BuildingFlag.Remembered;
      rows.push(row);
    }
  }
  rows.sort((a, c) => a[0] - c[0]);
  const buildings = new Int32Array(rows.length * BUILDING_STRIDE);
  rows.forEach((row, r) => buildings.set(row, r * BUILDING_STRIDE));

  // Towns: explored ones, live when seen, else as last seen.
  const townRows: Int32Array[] = [];
  for (let t = 0; t < w.townSize.length; t++) {
    const row = new Int32Array(TOWN_STRIDE);
    const cell = w.townY[t] * n + w.townX[t];
    if (player === null || vis![cell] === 1) {
      writeTownRow(w, t, row, 0);
      row[TownField.flags] |= TownFlag.Visible;
    } else if (exp![cell] === 1) {
      row.set(fog.townSeen[player].subarray(t * TOWN_STRIDE, (t + 1) * TOWN_STRIDE));
      row[TownField.flags] &= ~TownFlag.Visible;
    } else {
      continue;
    }
    townRows.push(row);
  }
  const towns = new Int32Array(townRows.length * TOWN_STRIDE);
  townRows.forEach((row, r) => towns.set(row, r * TOWN_STRIDE));

  // Nodes: ever seen, amount as last seen.
  const nodeCount = w.nodeAmount.length;
  const nodeRows: number[] = [];
  for (let i = 0; i < nodeCount; i++) {
    if (player === null || fog.nodeSeen[player][i] >= 0) nodeRows.push(i);
  }
  const nodes = new Int32Array(nodeRows.length * NODE_STRIDE);
  nodeRows.forEach((i, r) => {
    const o = r * NODE_STRIDE;
    nodes[o + NodeField.id] = i;
    nodes[o + NodeField.kind] = w.nodeKind[i];
    nodes[o + NodeField.cellX] = w.nodeX[i];
    nodes[o + NodeField.cellY] = w.nodeY[i];
    const visible = seesCell(w.nodeX[i], w.nodeY[i]);
    nodes[o + NodeField.amount] = player === null || visible ? w.nodeAmount[i] : fog.nodeSeen[player][i];
    nodes[o + NodeField.visible] = visible ? 1 : 0;
  });

  // Fog grid.
  const fogGrid = new Uint8Array(n * n);
  if (player === null) fogGrid.fill(FogState.Visible);
  else for (let i = 0; i < n * n; i++) fogGrid[i] = vis![i] === 1 ? FogState.Visible : exp![i] === 1 ? FogState.Explored : FogState.Unexplored;

  // Header.
  const header = new Int32Array(HEADER_LENGTH);
  header[HeaderField.tick] = w.tick;
  header[HeaderField.paused] = info?.paused ? 1 : 0;
  header[HeaderField.speed] = Math.round((info?.tps ?? 20) * 100);
  let state: number = GameState.Running;
  if (w.over) state = w.winner === -1 ? GameState.Draw : player === null || w.winner === player ? GameState.Won : GameState.Lost;
  header[HeaderField.gameState] = state;
  if (player !== null && player < PLAYER_COUNT) {
    for (let r = 0; r < 4; r++) header[HeaderField.food + r] = w.res[player * 4 + r];
    let mages = 0;
    for (let s = 0; s < w.units.count; s++) if (u.owner[s] === player && u.type[s] === UnitType.Mage) mages++;
    header[HeaderField.population] = w.population(player);
    header[HeaderField.populationCap] = w.populationCap(player);
    header[HeaderField.mages] = mages;
    header[HeaderField.mageCap] = MAGE_CAP;
    header[HeaderField.ratioFood] = w.ecoRatio[player * 3];
    header[HeaderField.ratioWood] = w.ecoRatio[player * 3 + 1];
    header[HeaderField.ratioGold] = w.ecoRatio[player * 3 + 2];
    header[HeaderField.ratioOn] = w.ecoOn[player];
    header[HeaderField.recall] = w.recall[player];
    for (let r = 0; r < 4; r++) header[HeaderField.reserveFood + r] = w.reserve[player * 4 + r];
  }
  header[HeaderField.stepMicros] = info?.stepMicros ?? 0;
  header[HeaderField.stepBatchMicros] = info?.stepBatchMicros ?? 0;
  header[HeaderField.fogTick] = fog.fogTick;
  header[HeaderField.scenario] = SCENARIO_ID[game.config.scenario] ?? Scenario.Standard;

  // Cannon warnings: each calibrating mage's blast area, when its centre cell is seen.
  const casting: number[] = [];
  for (let s = 0; s < w.units.count; s++) {
    if (u.order[s] !== Order.Cast) continue;
    if (u.owner[s] !== player && !seesCell(u.castX[s] >> CELL_SHIFT, u.castY[s] >> CELL_SHIFT)) continue;
    casting.push(s);
  }
  const warnings = new Int32Array(casting.length * WARNING_STRIDE);
  casting.forEach((s, r) => {
    const o = r * WARNING_STRIDE;
    warnings[o + WarningField.id] = u.id[s];
    warnings[o + WarningField.owner] = u.owner[s];
    warnings[o + WarningField.x] = u.castX[s];
    warnings[o + WarningField.y] = u.castY[s];
    warnings[o + WarningField.radius] = CANNON.radius;
    warnings[o + WarningField.ticksLeft] = CANNON.calibrateTicks - u.castProgress[s];
  });

  // Placement: rock, nodes as last seen, and every building the player knows block;
  // unexplored cells are marked; farm land comes from own finished main cities and granaries.
  const placement = new Uint8Array(n * n);
  const terrain = w.map.terrain;
  for (let i = 0; i < n * n; i++) {
    let bits = terrain[i] === 1 ? PlaceBit.Blocked : 0;
    if (exp !== null && exp[i] === 0) bits |= PlaceBit.Unexplored;
    placement[i] = bits;
  }
  for (let k = 0; k < nodeCount; k++) {
    const amount = player === null ? w.nodeAmount[k] : fog.nodeSeen[player][k];
    if (amount > 0) placement[w.nodeY[k] * n + w.nodeX[k]] |= PlaceBit.Blocked;
  }
  for (const row of rows) {
    const size = BUILDINGS[row[BuildingField.type]].size;
    const x0 = row[BuildingField.cellX];
    const y0 = row[BuildingField.cellY];
    for (let y = y0; y < y0 + size; y++) for (let x = x0; x < x0 + size; x++) placement[y * n + x] |= PlaceBit.Blocked;
    const t = row[BuildingField.type];
    const land = row[BuildingField.owner] === player && row[BuildingField.progress] >= 1000 && (t === BuildingType.MainCity || t === BuildingType.Granary);
    if (!land) continue;
    for (let y = Math.max(0, y0 - FARMLAND_REACH); y < Math.min(n, y0 + size + FARMLAND_REACH); y++) {
      for (let x = Math.max(0, x0 - FARMLAND_REACH); x < Math.min(n, x0 + size + FARMLAND_REACH); x++) placement[y * n + x] |= PlaceBit.FarmLand;
    }
  }

  return {
    player,
    tick: w.tick,
    header,
    units,
    buildings,
    towns,
    warnings,
    nodes,
    fog: fogGrid,
    fogTick: fog.fogTick,
    placement,
    idleFarmers: Int32Array.from(idle),
    mapSize: n,
  };
}

/** Turns views into snapshots: node rows only when they change, fog only when updated. */
export class SnapshotEncoder {
  private lastAmount: Int32Array;
  private lastVisible: Int8Array;
  private lastFogTick = -1;

  constructor(nodeCount: number) {
    this.lastAmount = new Int32Array(nodeCount).fill(-2);
    this.lastVisible = new Int8Array(nodeCount).fill(-1);
  }

  encode(view: PlayerView, events: Snapshot["events"]): Snapshot {
    const changed: number[] = [];
    for (let r = 0; r < view.nodes.length / NODE_STRIDE; r++) {
      const o = r * NODE_STRIDE;
      const id = view.nodes[o + NodeField.id];
      const amount = view.nodes[o + NodeField.amount];
      const visible = view.nodes[o + NodeField.visible];
      if (this.lastAmount[id] !== amount || this.lastVisible[id] !== visible) {
        this.lastAmount[id] = amount;
        this.lastVisible[id] = visible;
        changed.push(r);
      }
    }
    const nodes = new Int32Array(changed.length * NODE_STRIDE);
    changed.forEach((r, k) => nodes.set(view.nodes.subarray(r * NODE_STRIDE, (r + 1) * NODE_STRIDE), k * NODE_STRIDE));
    const fogNew = view.fogTick !== this.lastFogTick;
    this.lastFogTick = view.fogTick;
    return {
      type: "snapshot",
      header: view.header,
      units: view.units,
      buildings: view.buildings,
      towns: view.towns,
      warnings: view.warnings,
      nodes,
      fog: fogNew ? view.fog : null,
      placement: fogNew ? view.placement : null,
      idleFarmers: view.idleFarmers,
      events,
    };
  }
}

/** Buffers to transfer with a snapshot. */
export function transferables(s: Snapshot): ArrayBuffer[] {
  const out = [s.header, s.units, s.buildings, s.towns, s.warnings, s.nodes, s.idleFarmers].map((a) => a.buffer as ArrayBuffer);
  if (s.fog !== null) out.push(s.fog.buffer as ArrayBuffer);
  if (s.placement !== null) out.push(s.placement.buffer as ArrayBuffer);
  return out;
}
