// A fixed economy script for headless runs until the AI arrives (PR-5). Both players follow
// the same rules from their own PlayerView, so a full-length game exercises gathering,
// building, training, cancelling, the economy ratio and recall, and its command log can be
// replayed. It is a test driver, not the AI: it never looks at the enemy.

import { checkPlacement } from "../placement.ts";
import {
  BUILDING_STRIDE,
  BuildingField,
  BuildingType,
  type CommandBody,
  HeaderField,
  NODE_STRIDE,
  NodeField,
  NodeKind,
  Order,
  PlaceBit,
  TOWN_STRIDE,
  TownChoice,
  TownField,
  TownState,
  UNIT_STRIDE,
  UnitField,
  UnitFlag,
  UnitType,
} from "../protocol.ts";
import { BUILDINGS } from "../core/rules.ts";
import type { PlayerView } from "../view/view.ts";

export const ECO_SCRIPT_EVERY = 100;

interface Own {
  id: number;
  type: number;
  x: number;
  y: number;
  progress: number;
  queue: number;
}

/** The nearest spot to (ax, ay) where `type` fits, with a free ring around it (farms may touch). */
function spotNear(view: PlayerView, type: BuildingType, ax: number, ay: number): { x: number; y: number } | null {
  const n = view.mapSize;
  const info = BUILDINGS[type];
  const size = info.size;
  const grid = { size: n, cells: view.placement };
  let best: { x: number; y: number } | null = null;
  let bestD = 0;
  for (let y = Math.max(1, ay - 15); y <= Math.min(n - size - 1, ay + 15); y++) {
    for (let x = Math.max(1, ax - 15); x <= Math.min(n - size - 1, ax + 15); x++) {
      if (checkPlacement(grid, info, x, y) !== 0) continue;
      let ok = true;
      if (type !== BuildingType.Farm) {
        for (let yy = y - 1; yy <= y + size && ok; yy++) {
          for (let xx = x - 1; xx <= x + size && ok; xx++) {
            if ((view.placement[yy * n + xx] & PlaceBit.Blocked) !== 0) ok = false;
          }
        }
      }
      if (!ok) continue;
      const dx = 2 * x + size - 2 * ax;
      const dy = 2 * y + size - 2 * ay;
      const d = dx * dx + dy * dy;
      if (best === null || d < bestD) {
        best = { x, y };
        bestD = d;
      }
    }
  }
  return best;
}

export function ecoScript(view: PlayerView, spawn: { cellX: number; cellY: number }): CommandBody[] {
  const p = view.player!;
  const h = view.header;
  const tick = view.tick;
  const food = h[HeaderField.food];
  let wood = h[HeaderField.wood];
  const gold = h[HeaderField.gold];
  const crystal = h[HeaderField.crystal];
  const pop = h[HeaderField.population];
  const cap = h[HeaderField.populationCap];
  const out: CommandBody[] = [];

  const own: Own[] = [];
  let queued = 0;
  for (let r = 0; r < view.buildings.length; r += BUILDING_STRIDE) {
    if (view.buildings[r + BuildingField.owner] !== p) continue;
    const b = {
      id: view.buildings[r + BuildingField.id],
      type: view.buildings[r + BuildingField.type],
      x: view.buildings[r + BuildingField.cellX],
      y: view.buildings[r + BuildingField.cellY],
      progress: view.buildings[r + BuildingField.progress],
      queue: view.buildings[r + BuildingField.queueLength],
    };
    queued += b.queue;
    own.push(b);
  }
  const has = (t: number) => own.some((b) => b.type === t);
  const done = (t: number) => own.filter((b) => b.type === t && b.progress >= 1000);
  const gatherers: number[] = [];
  const army: number[] = [];
  const quietMages: number[] = [];
  let farmers = 0;
  for (let r = 0; r < view.units.length; r += UNIT_STRIDE) {
    if (view.units[r + UnitField.owner] !== p) continue;
    const type = view.units[r + UnitField.type];
    if (type === UnitType.Farmer) {
      farmers++;
      if (view.units[r + UnitField.order] === Order.Gather) gatherers.push(view.units[r + UnitField.id]);
    } else {
      army.push(view.units[r + UnitField.id]);
      if (type === UnitType.Mage && (view.units[r + UnitField.flags] & UnitFlag.Autocast) === 0) quietMages.push(view.units[r + UnitField.id]);
    }
  }
  const nearestNode = (kind: number): { x: number; y: number } | null => {
    let best: { x: number; y: number } | null = null;
    let bestD = 0;
    for (let r = 0; r < view.nodes.length; r += NODE_STRIDE) {
      if (view.nodes[r + NodeField.kind] !== kind || view.nodes[r + NodeField.amount] <= 0) continue;
      const x = view.nodes[r + NodeField.cellX];
      const y = view.nodes[r + NodeField.cellY];
      const d = (x - spawn.cellX) ** 2 + (y - spawn.cellY) ** 2;
      if (best === null || d < bestD) {
        best = { x, y };
        bestD = d;
      }
    }
    return best;
  };

  // One building at a time.
  if (!own.some((b) => b.progress < 1000) && gatherers.length >= 2) {
    let plan: { type: BuildingType; at: { x: number; y: number } | null } | null = null;
    const tree = nearestNode(NodeKind.Tree);
    const mine = nearestNode(NodeKind.GoldMine);
    const granary = done(BuildingType.Granary)[0];
    if (cap - pop <= 3 && cap < 120 && wood >= 30) plan = { type: BuildingType.House, at: { x: spawn.cellX, y: spawn.cellY } };
    else if (!has(BuildingType.LumberCamp) && wood >= 60 && tree) plan = { type: BuildingType.LumberCamp, at: tree };
    else if (!has(BuildingType.Mine) && wood >= 60 && mine) plan = { type: BuildingType.Mine, at: mine };
    else if (!has(BuildingType.Granary) && wood >= 60) plan = { type: BuildingType.Granary, at: { x: spawn.cellX, y: spawn.cellY } };
    else if (granary && own.filter((b) => b.type === BuildingType.Farm).length < 6 && wood >= 50) {
      plan = { type: BuildingType.Farm, at: { x: granary.x + 1, y: granary.y + 1 } };
    } else if (!has(BuildingType.Barracks) && wood >= 120) plan = { type: BuildingType.Barracks, at: { x: spawn.cellX, y: spawn.cellY } };
    else if (!has(BuildingType.Range) && wood >= 120) plan = { type: BuildingType.Range, at: { x: spawn.cellX, y: spawn.cellY } };
    else if (!has(BuildingType.MageHall) && wood >= 150 && gold >= 100) plan = { type: BuildingType.MageHall, at: { x: spawn.cellX, y: spawn.cellY } };
    if (plan !== null && plan.at !== null) {
      const at = spotNear(view, plan.type, plan.at.x, plan.at.y);
      if (at !== null) {
        const crew = plan.type === BuildingType.House || plan.type === BuildingType.Farm ? 1 : 2;
        out.push({ c: "build", u: gatherers.slice(0, crew), type: plan.type, x: at.x, y: at.y });
        wood -= BUILDINGS[plan.type].cost.wood;
      }
    }
  }

  // Training, within the population cap.
  let room = cap - pop - queued;
  const main = done(BuildingType.MainCity)[0];
  if (main && main.queue < 2 && food >= 50 && room > 0 && farmers < 30) {
    out.push({ c: "train", building: main.id, type: UnitType.Farmer, n: 1 });
    room--;
  }
  const barracks = done(BuildingType.Barracks)[0];
  if (barracks && barracks.queue < 2 && food >= 90 && wood >= 20 && room > 0) {
    out.push({ c: "train", building: barracks.id, type: UnitType.Spearman, n: 1 });
    room--;
  }
  const range = done(BuildingType.Range)[0];
  if (range && range.queue < 2 && wood >= 40 && gold >= 30 && room > 0) {
    out.push({ c: "train", building: range.id, type: UnitType.Ranged, n: 1 });
    room--;
  }
  const hall = done(BuildingType.MageHall)[0];
  if (hall && hall.queue < 1 && gold >= 90 && crystal >= 50 && room > 0 && h[HeaderField.mages] < h[HeaderField.mageCap]) {
    out.push({ c: "train", building: hall.id, type: UnitType.Mage, n: 1 });
  }
  if (quietMages.length > 0) out.push({ c: "autocast", u: quietMages, on: true });

  // Fixed moments: cancel, change the ratio, recall and back, send the army out.
  if (tick >= 3000 && tick < 3000 + ECO_SCRIPT_EVERY && main && main.queue > 0) {
    out.push({ c: "cancel_train", building: main.id, index: main.queue - 1 });
  }
  if (tick >= 8000 && tick < 8000 + ECO_SCRIPT_EVERY) out.push({ c: "eco_ratio", food: 30, wood: 40, gold: 30, on: true });
  if (tick >= 6000 && tick < 6000 + ECO_SCRIPT_EVERY) out.push({ c: "recall", on: true });
  if (tick >= 6400 && tick < 6400 + ECO_SCRIPT_EVERY) out.push({ c: "recall", on: false });
  // Towns: take the small town and govern it, then the big city and plunder it. Taking the
  // whole army to the big city leaves the small town without its garrison (a revolt).
  for (let r = 0; r < view.towns.length; r += TOWN_STRIDE) {
    if (view.towns[r + TownField.owner] !== p || view.towns[r + TownField.state] !== TownState.AwaitingChoice) continue;
    const town = view.towns[r + TownField.id];
    out.push({ c: "town_choice", town, choice: town === 0 ? TownChoice.Govern : TownChoice.Plunder });
  }
  if (tick >= 12000 && tick % 2000 < ECO_SCRIPT_EVERY && army.length >= 10) {
    const small = townState(view, 0);
    const target = small !== null && small.owner === p && small.state !== TownState.Neutral ? 1 : 0;
    const at = target === 0 ? { x: 29, y: 29 } : { x: 48, y: 48 };
    out.push({ c: "move", u: army, x: at.x, y: at.y });
  }
  return out;
}

function townState(view: PlayerView, id: number): { owner: number; state: number } | null {
  for (let r = 0; r < view.towns.length; r += TOWN_STRIDE) {
    if (view.towns[r + TownField.id] === id) return { owner: view.towns[r + TownField.owner], state: view.towns[r + TownField.state] };
  }
  return null;
}
