// 姿態 the screen sent that the snapshot does not show yet (D-081). Orders read a soldier's stance to
// decide what else to send (前進 or 攻擊 turn those holding to 積極, D-050; 撤退 holds, D-061). Read
// from a snapshot older than the screen's own last 堅守, a 前進 given right after 取消 (which stops
// and holds, D-054) found them 積極 and left them marching in 堅守: they would not fight on the way,
// and the button never read 取消進攻 (e2e d080.spec.ts:41, WebKit, run 37926126040).

/** A stance the snapshot has not shown within this many ticks (2 s) is let go: the simulation refused it, or it was overtaken. */
export const STANCE_WAIT_TICKS = 40;

export class SentStances {
  private readonly sent = new Map<number, { stance: number; tick: number }>();

  /** The screen sent `stance` for these units at `tick`. */
  note(ids: readonly number[], stance: number, tick: number): void {
    for (const id of ids) this.sent.set(id, { stance, tick });
  }

  /** The stance to go by: the one sent and not shown yet, else the snapshot's. */
  of(id: number, shown: number): number {
    return this.sent.get(id)?.stance ?? shown;
  }

  /** Every snapshot: forget what it shows now, the units gone (`shown` null), and what waited too long. */
  settle(tick: number, shown: (id: number) => number | null): void {
    for (const [id, s] of [...this.sent]) {
      const now = shown(id);
      if (now === null || now === s.stance || tick - s.tick > STANCE_WAIT_TICKS) this.sent.delete(id);
    }
  }
}
