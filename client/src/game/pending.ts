// 指令送出、快照還沒反映 (the user 2026-10-19: 「然後按暫停造兵跟放建築應該要顯示，不然還以為沒按到」;
// ceo: every order from a button shows at once, paused or not): the simulation applies an order
// on its next step, and while the game is paused it takes none, so a building placed, a soldier
// trained or 自動訓練 turned off showed nothing until 繼續. What the screen sent is kept here and
// shown (a site to come, the queue one longer, the button as it will be) until a snapshot from
// after the simulation's next steps shows it done or refused (as SentStances does for stances,
// D-081). Only the picture: the commands are the same.

/**
 * Steps after the one an order was sent at by which the simulation has taken it (the snapshot then
 * shows it, or it was refused). Paused, the first step after 繼續 takes it.
 */
export const PENDING_STEPS = 1;

export type Pending =
  | { k: "build"; seq: number; tick: number; type: number; x: number; y: number }
  | { k: "train"; seq: number; tick: number; building: number; unit: number }
  | { k: "auto"; seq: number; tick: number; building: number; on: boolean }
  | { k: "town"; seq: number; tick: number; town: number; choice: number };

export class PendingOrders {
  private list: Pending[] = [];

  add(p: Pending): void {
    this.list.push(p);
  }

  /** Refused (its `rejected` event): forget it. */
  refused(seq: number): void {
    this.list = this.list.filter((p) => p.seq !== seq);
  }

  /** A snapshot of `tick`: what the simulation has taken by now shows in it (or was refused); forget it. */
  settle(tick: number): void {
    this.list = this.list.filter((p) => tick <= p.tick + PENDING_STEPS);
  }

  /** Buildings placed and not on the map yet. */
  sites(): { type: number; x: number; y: number }[] {
    return this.list.filter((p) => p.k === "build");
  }

  /** Soldiers or farmers sent to this building's queue and not in it yet. */
  trains(building: number): number[] {
    return this.list.flatMap((p) => (p.k === "train" && p.building === building ? [p.unit] : []));
  }

  /** 自動訓練 as last sent for this building and not shown yet, or null. */
  autoTrain(building: number): boolean | null {
    let on: boolean | null = null;
    for (const p of this.list) if (p.k === "auto" && p.building === building) on = p.on;
    return on;
  }

  /** 搶 or 治理 as sent for this town and not shown yet, or null. */
  townChoice(town: number): number | null {
    let c: number | null = null;
    for (const p of this.list) if (p.k === "town" && p.town === town) c = p.choice;
    return c;
  }

  /** How many are waiting (a panel rebuilds when this changes). */
  get size(): number {
    return this.list.length;
  }
}
