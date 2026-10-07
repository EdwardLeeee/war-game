// 點存放建築派村民 (D-066, user 2026-10-07: 「點擊糧倉、伐木場、礦場點擊後可以分配村民」): a tap
// on our granary, lumber camp or mine shows how many villagers gather there, with − and +. The
// main city shows none of it (D-070: 「主城的那個附近在彩的村民沒有用，拿掉」), though it still
// counts as a depot. A villager counts at the one depot it brings its load back to: the nearest
// of ours that takes that resource, measured from where it gathers (a node, or the farm it
// works). So every villager counts once, and a lumber camp's count leaves out those who bring
// their wood to the main city.
//
// +: one at a time; idle villagers first, then those gathering another resource, nearest to
// the depot first. Never those on the crystal vein (by hand only, GDD §4) or building or
// repairing. Wood and gold go to the nearest tree or gold mine within DEPOT_REACH of the
// depot; food to the nearest farm nobody works, else berries.
// −: the one gathering here farthest from the depot (ceo 2026-10-07).

import { BuildingType, NodeKind, Resource } from "../sim.ts";

/** Cells from a depot's footprint within which + looks for trees, gold, farms and berries. */
export const DEPOT_REACH = 10;

/** The resources a depot row is shown for (the crystal vein is by hand only). */
export const DEPOT_RESOURCES: readonly Resource[] = [Resource.Food, Resource.Wood, Resource.Gold];

/** The resource rows the panel of this building of ours shows: none for the main city (D-070). */
export function panelResources(type: number, accepts: readonly number[]): Resource[] {
  if (type === BuildingType.MainCity) return [];
  return DEPOT_RESOURCES.filter((r) => accepts.includes(r));
}

/** One own villager as the depot panel needs it (cells). */
export interface Worker {
  id: number;
  x: number;
  y: number;
  /** The resource it gathers, or null. */
  gathers: Resource | null;
  /** Where it gathers: the node's cell centre or the farm's centre; null when it gathers nothing. */
  at: { x: number; y: number } | null;
  idle: boolean;
  /** Building, repairing or on the crystal vein: a tap on a depot never sends it elsewhere. */
  busy: boolean;
}

/** One own finished depot (cells). */
export interface Depot {
  id: number;
  cx: number;
  cy: number;
  size: number;
  accepts: readonly number[];
}

/** Distance from a point to a building's footprint (0 inside it). */
export function toFootprint(p: { x: number; y: number }, d: Pick<Depot, "cx" | "cy" | "size">): number {
  const dx = Math.max(d.cx - p.x, 0, p.x - (d.cx + d.size));
  const dy = Math.max(d.cy - p.y, 0, p.y - (d.cy + d.size));
  return Math.hypot(dx, dy);
}

/** The depot a load of `resource` gathered at `at` goes back to: the nearest that takes it (ties: lower id). */
export function depotFor(at: { x: number; y: number }, resource: Resource, depots: readonly Depot[]): number | null {
  let best: Depot | null = null;
  let bestD = Infinity;
  for (const d of depots) {
    if (!d.accepts.includes(resource)) continue;
    const dist = toFootprint(at, d);
    if (dist < bestD || (dist === bestD && best !== null && d.id < best.id)) {
      best = d;
      bestD = dist;
    }
  }
  return best?.id ?? null;
}

/** The villagers who bring `resource` back to this depot. */
export function workersAt(workers: readonly Worker[], depots: readonly Depot[], depot: number, resource: Resource): Worker[] {
  return workers.filter((w) => w.gathers === resource && w.at !== null && depotFor(w.at, resource, depots) === depot);
}

const nearestFirst = (d: Depot) => (a: Worker, b: Worker) => toFootprint(a, d) - toFootprint(b, d) || a.id - b.id;

/** Whom + sends to gather `resource` for this depot, or null when nobody may go. */
export function pickToSend(workers: readonly Worker[], depot: Depot, resource: Resource): number | null {
  const free = workers.filter((w) => !w.busy);
  const idle = free.filter((w) => w.idle).sort(nearestFirst(depot));
  if (idle.length > 0) return idle[0].id;
  const others = free.filter((w) => !w.idle && w.gathers !== null && w.gathers !== resource && w.gathers !== Resource.Crystal).sort(nearestFirst(depot));
  return others[0]?.id ?? null;
}

/** Whom − takes from this depot: of those gathering here, the farthest from it (ties: higher id). */
export function pickToTake(workers: readonly Worker[], depots: readonly Depot[], depot: Depot, resource: Resource): number | null {
  const here = workersAt(workers, depots, depot.id, resource).sort((a, b) => toFootprint(b, depot) - toFootprint(a, depot) || b.id - a.id);
  return here[0]?.id ?? null;
}

/** A node the depot may send to (cells; known, not used up). */
export interface DepotNode {
  id: number;
  kind: number;
  cx: number;
  cy: number;
  amount: number;
}

/** One own finished farm (cells), and whether someone works it or walks to it. */
export interface DepotFarm {
  id: number;
  cx: number;
  cy: number;
  size: number;
  taken: boolean;
}

export type SendTarget = { node: number } | { farm: number } | { error: string };

const NODE_FOR: Partial<Record<Resource, number>> = { [Resource.Wood]: NodeKind.Tree, [Resource.Gold]: NodeKind.GoldMine };
const NOTHING_NEAR: Partial<Record<Resource, string>> = { [Resource.Wood]: "附近沒有樹", [Resource.Gold]: "附近沒有金礦" };
export const NO_FARM_TEXT = "附近沒有空田，先蓋農田";

/** Where + sends a villager to gather `resource` for this depot: the nearest within DEPOT_REACH (ties: lower id). */
export function sendTarget(depot: Depot, resource: Resource, nodes: readonly DepotNode[], farms: readonly DepotFarm[]): SendTarget {
  const nearest = <T extends { id: number }>(list: T[], at: (t: T) => { x: number; y: number }): T | null =>
    list
      .map((t) => ({ t, d: toFootprint(at(t), depot) }))
      .filter((e) => e.d <= DEPOT_REACH)
      .sort((a, b) => a.d - b.d || a.t.id - b.t.id)[0]?.t ?? null;
  const nodeAt = (n: DepotNode) => ({ x: n.cx + 0.5, y: n.cy + 0.5 });
  if (resource === Resource.Food) {
    const farm = nearest(
      farms.filter((f) => !f.taken),
      (f) => ({ x: f.cx + f.size / 2, y: f.cy + f.size / 2 }),
    );
    if (farm !== null) return { farm: farm.id };
    const berries = nearest(
      nodes.filter((n) => n.kind === NodeKind.Berries && n.amount > 0),
      nodeAt,
    );
    return berries !== null ? { node: berries.id } : { error: NO_FARM_TEXT };
  }
  const kind = NODE_FOR[resource];
  const node = kind === undefined ? null : nearest(
    nodes.filter((n) => n.kind === kind && n.amount > 0),
    nodeAt,
  );
  return node !== null ? { node: node.id } : { error: NOTHING_NEAR[resource] ?? "附近沒有可以採的資源" };
}
