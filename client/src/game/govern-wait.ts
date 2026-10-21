// 等錢治理 (ceo 2026-10-21; the user chose 「錢夠了自動開始修繕」): 治理 pressed for a town we took
// while its cost is not there yet. The 留守 soldiers stay (the town still waits for a choice in the
// simulation, which has no time limit for it), and once the cost is there the game sends 治理 by
// itself. Meanwhile 自動訓練 must not spend it: the reserve it leaves untouched (預留, D-054) is
// raised to the largest waiting cost, the player's own reserve kept beside it and sent back when
// the last wait ends. Pure, for the unit tests; game.ts sends the commands.

import type { Cost } from "../sim.ts";

const KEYS = ["food", "wood", "gold", "crystal"] as const;
const NAME: Record<(typeof KEYS)[number], string> = { food: "糧", wood: "木", gold: "金", crystal: "晶" };

/** How much of `cost` is missing from `have` (0 where there is enough). */
export function shortfall(cost: Cost, have: Cost): Cost {
  return { food: Math.max(0, cost.food - have.food), wood: Math.max(0, cost.wood - have.wood), gold: Math.max(0, cost.gold - have.gold), crystal: Math.max(0, cost.crystal - have.crystal) };
}

export const affords = (cost: Cost, have: Cost): boolean => KEYS.every((k) => have[k] >= cost[k]);

/** 「木 80、金 80」: the resources a cost has, in the resource bar's order. */
export function costText(cost: Cost): string {
  return KEYS.filter((k) => cost[k] > 0)
    .map((k) => `${NAME[k]} ${cost[k]}`)
    .join("、");
}

/** The reserve while towns wait: each resource the larger of the player's own and the largest waiting cost. */
function raise(own: Cost, costs: Iterable<Cost>): Cost {
  const r = { ...own };
  for (const c of costs) for (const k of KEYS) r[k] = Math.max(r[k], c[k]);
  return r;
}

const same = (a: Cost, b: Cost) => KEYS.every((k) => a[k] === b[k]);

/** What a save keeps (ScreenState.govern). */
export interface GovernWaitState {
  towns: { town: number; cost: Cost }[];
  /** The player's own reserve while it is raised; null while no town waits. */
  own: Cost | null;
}

/** A 治理 the game sent by itself, not answered yet, and when it may try again after a refusal. */
interface Wait {
  cost: Cost;
  seq: number;
  retryAt: number;
}

/** A refused 治理 for lack of resources is tried again this many ticks later (1 s). */
export const RETRY_TICKS = 20;

export class GovernWaits {
  private readonly towns = new Map<number, Wait>();
  private own: Cost | null = null;

  get size(): number {
    return this.towns.size;
  }

  has(town: number): boolean {
    return this.towns.has(town);
  }

  list(): number[] {
    return [...this.towns.keys()];
  }

  costOf(town: number): Cost | null {
    return this.towns.get(town)?.cost ?? null;
  }

  /** The reserve in effect while towns wait, or null while none does. */
  raised(): Cost | null {
    return this.own === null || this.towns.size === 0 ? null : raise(this.own, [...this.towns.values()].map((w) => w.cost));
  }

  /** 「木 150、金 150」: the raised reserve, for the resources the waiting 治理 costs; "" while none waits. */
  raisedText(): string {
    const r = this.raised();
    if (r === null) return "";
    const costs = [...this.towns.values()].map((w) => w.cost);
    return KEYS.filter((k) => costs.some((c) => c[k] > 0))
      .map((k) => `${NAME[k]} ${r[k]}`)
      .join("、");
  }

  /** The player's own reserve: kept here while raised, else the one in effect (`inEffect`). */
  ownReserve(inEffect: Cost): Cost {
    return this.own ?? inEffect;
  }

  /**
   * Start waiting for `town`. `inEffect`: the reserve the simulation has now (the player's own,
   * when nothing waits yet). Returns the reserve to send, or null when it stays as it is.
   */
  start(town: number, cost: Cost, inEffect: Cost): Cost | null {
    if (this.towns.has(town)) return null;
    if (this.towns.size === 0) this.own = { ...inEffect };
    const before = this.raised() ?? inEffect;
    this.towns.set(town, { cost: { ...cost }, seq: -1, retryAt: 0 });
    const after = this.raised() as Cost;
    return same(before, after) ? null : after;
  }

  /**
   * Stop waiting for `town` (治理 started, 搶 chosen, 取消, or the town lost). Returns the reserve to
   * send: the player's own once the last wait ends, the lower raise if others still wait; null when
   * it stays as it is.
   */
  end(town: number): Cost | null {
    if (!this.towns.has(town)) return null;
    const before = this.raised() as Cost;
    this.towns.delete(town);
    if (this.towns.size === 0) {
      const own = this.own as Cost;
      this.own = null;
      return same(before, own) ? null : own;
    }
    const after = this.raised() as Cost;
    return same(before, after) ? null : after;
  }

  /** The player set the reserve (預留 → 套用): their own from now on. Returns the reserve to send. */
  setOwn(r: Cost): Cost {
    if (this.towns.size === 0) return { ...r };
    this.own = { ...r };
    return this.raised() as Cost;
  }

  /** Whether the game should send 治理 for `town` now: the cost is there, and none is out or it may try again. */
  due(town: number, have: Cost, tick: number): boolean {
    const w = this.towns.get(town);
    return w !== undefined && w.seq < 0 && tick >= w.retryAt && affords(w.cost, have);
  }

  /** The game sent 治理 for `town` as command `seq`. */
  sent(town: number, seq: number): void {
    const w = this.towns.get(town);
    if (w !== undefined) w.seq = seq;
  }

  /** Whether the game has sent 治理 for `town` and it is not answered yet. */
  isSent(town: number): boolean {
    return (this.towns.get(town)?.seq ?? -1) >= 0;
  }

  /** The town the 治理 sent as `seq` was for, or -1. */
  townOf(seq: number): number {
    for (const [town, w] of this.towns) if (w.seq === seq) return town;
    return -1;
  }

  /** That 治理 was refused for lack of resources (spent the same step): wait on, and try again in RETRY_TICKS. */
  retry(town: number, tick: number): void {
    const w = this.towns.get(town);
    if (w === undefined) return;
    w.seq = -1;
    w.retryAt = tick + RETRY_TICKS;
  }

  save(): GovernWaitState {
    return { towns: [...this.towns].map(([town, w]) => ({ town, cost: { ...w.cost } })), own: this.own === null ? null : { ...this.own } };
  }

  /** A save's waits. A 治理 sent and not answered when it was saved is in the log: the next snapshot shows it. */
  restore(s: GovernWaitState | undefined): void {
    this.towns.clear();
    this.own = null;
    if (s === undefined || s.towns.length === 0 || s.own === null) return;
    for (const t of s.towns) this.towns.set(t.town, { cost: { ...t.cost }, seq: -1, retryAt: 0 });
    this.own = { ...s.own };
  }
}
