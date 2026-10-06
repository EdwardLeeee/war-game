// 派村民 (D-061: 「點地圖上的資源就會可以指派採集一樣資源的村民過去，可以選擇配置多少比例的
// 村民過去」): a tap on a tree, gold mine, berry bush or crystal vein offers to send a share of
// the villagers who gather the same resource elsewhere, nearest first. With nobody on it (the
// crystal vein is by hand only, GDD §4), idle villagers go instead. The `gather` they get is
// the player's own: the economy ratio leaves them there (D-050). Farms are not in it: one
// villager works a farm, and the economy sends one already (ceo 2026-10-07).

import { NodeKind, Resource } from "../sim.ts";

/** The shares offered, smallest first. */
export const DISPATCH_SHARES = [
  { label: "¼", share: 0.25 },
  { label: "½", share: 0.5 },
  { label: "全部", share: 1 },
] as const;

/** The resource each kind of node gives. */
export const NODE_RESOURCE: Record<number, Resource> = {
  [NodeKind.Tree]: Resource.Wood,
  [NodeKind.GoldMine]: Resource.Gold,
  [NodeKind.Berries]: Resource.Food,
  [NodeKind.CrystalVein]: Resource.Crystal,
};

/** Names in the panel. */
export const RESOURCE_WORD: Record<number, string> = {
  [Resource.Food]: "糧",
  [Resource.Wood]: "木",
  [Resource.Gold]: "金",
  [Resource.Crystal]: "魔晶",
};

/** One own villager as the panel needs it: where it is (cells), and what it gathers now. */
export interface Villager {
  id: number;
  x: number;
  y: number;
  /** The resource it gathers, or null when it does something else or nothing. */
  gathers: Resource | null;
  /** The node it gathers at, or null. */
  node: number | null;
  idle: boolean;
}

export interface DispatchPool {
  /** "same": villagers gathering this resource elsewhere; "idle": idle villagers, as nobody gathers it elsewhere. */
  from: "same" | "idle";
  /** Nearest to the node first (ties: lower id). */
  ids: number[];
}

/** Who a tap on this node can send. */
export function dispatchPool(villagers: Villager[], node: { id: number; kind: number; cx: number; cy: number }): DispatchPool {
  const resource = NODE_RESOURCE[node.kind];
  const near = (a: Villager, b: Villager) =>
    Math.hypot(a.x - (node.cx + 0.5), a.y - (node.cy + 0.5)) - Math.hypot(b.x - (node.cx + 0.5), b.y - (node.cy + 0.5)) || a.id - b.id;
  const same = villagers.filter((v) => v.gathers === resource && v.node !== node.id).sort(near);
  if (same.length > 0) return { from: "same", ids: same.map((v) => v.id) };
  return { from: "idle", ids: villagers.filter((v) => v.idle).sort(near).map((v) => v.id) };
}

/** How many a share of `n` sends: rounded, halves up, and at least one while there is anyone. */
export function dispatchCount(n: number, share: number): number {
  if (n <= 0) return 0;
  return Math.min(n, Math.max(1, Math.floor(n * share + 0.5)));
}
