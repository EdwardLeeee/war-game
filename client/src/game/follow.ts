// 進攻到底 (D-080, user 2026-10-09: 「點攻擊或是撤退時所有的部隊都要聚集過去，就算有一部分已經
// 到了，後面那些還沒到的也要聚集過來」). The simulation ends an attack the moment its target falls,
// so when the first to arrive killed it, those still on the way stopped where they were (a move or
// a retreat to a spot already takes every unit there: each arrives by itself). The screen keeps,
// for each unit the player sent to attack, where its target is; when the attack ends with the unit
// still far from there, the unit goes on (前進) to that spot, once.
//
// Never over the player (GDD §10: the last order he gave wins): another order of his for the unit,
// the unit there, hiding in a building or staying in a town (留守) end it, as does its death.
// Bookkeeping on ids and cells only, unit tested; the game reads the snapshot for it.

/** Within this many cells of where its target was, a unit has come (it is not sent on). */
export const FOLLOW_ARRIVED_CELLS = 6;
/** An attack order not seen in a snapshot by now was refused or ended at once: the unit is sent on all the same (1 s). */
export const FOLLOW_WAIT_TICKS = 20;

/** One unit sent to attack. */
interface Charge {
  target: number;
  /** Where the target is, or was last seen (cells); null before it was ever seen. */
  at: { x: number; y: number } | null;
  /** The tick of the order. */
  since: number;
  /** A snapshot showed the unit attacking. */
  seen: boolean;
}

/** What a unit sent to attack is doing (cells); null when it is dead, hiding in a building or staying in a town. */
export interface ChargeUnit {
  x: number;
  y: number;
  attacking: boolean;
}

/** A 前進 to give: these units to this cell. */
export interface FollowOrder {
  ids: number[];
  x: number;
  y: number;
}

export class Charges {
  private readonly list = new Map<number, Charge>();

  /** The player sent these units to attack `target`, which is at `at` (cells) if seen. */
  start(ids: readonly number[], target: number, at: { x: number; y: number } | null, tick: number): void {
    for (const id of ids) this.list.set(id, { target, at: at === null ? null : { ...at }, since: tick, seen: false });
  }

  /** Another order of the player's for these units: they follow it, not the attack. */
  drop(ids: readonly number[]): void {
    for (const id of ids) this.list.delete(id);
  }

  /** The units being followed (for the test page). */
  ids(): number[] {
    return [...this.list.keys()].sort((a, b) => a - b);
  }

  /**
   * Every snapshot: where each target is now, and the units whose attack has ended far from it,
   * sent on to it (one order per spot, units in id order). `target`: where a target is now
   * (cells), null when it is gone or out of sight.
   */
  update(tick: number, unit: (id: number) => ChargeUnit | null, target: (id: number) => { x: number; y: number } | null): FollowOrder[] {
    const out: FollowOrder[] = [];
    for (const id of this.ids()) {
      const c = this.list.get(id) as Charge;
      const u = unit(id);
      if (u === null) {
        this.list.delete(id);
        continue;
      }
      const t = target(c.target);
      if (t !== null) c.at = { ...t };
      if (u.attacking) {
        c.seen = true;
        continue;
      }
      if (!c.seen && tick - c.since < FOLLOW_WAIT_TICKS) continue;
      this.list.delete(id);
      if (c.at === null || Math.hypot(u.x - c.at.x, u.y - c.at.y) <= FOLLOW_ARRIVED_CELLS) continue;
      const x = Math.floor(c.at.x);
      const y = Math.floor(c.at.y);
      const same = out.find((o) => o.x === x && o.y === y);
      if (same === undefined) out.push({ ids: [id], x, y });
      else same.ids.push(id);
    }
    return out;
  }
}
