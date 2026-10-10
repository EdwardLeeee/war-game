// 閃紅提醒 (D-081, the user's choice 3a-B: 「只閃紅提醒」, not a retreat line): a group that started an
// attack with b soldiers and is down to fewer than half of them flashes red on its button, and the
// strip says 「編隊 N 快撐不住了（剩 a/b）」 once per attack. It never retreats by itself. The count
// is 現有 (army.ts presence: with the group now, not those on their way, D-081).

export interface Alarm {
  /** Some soldier of the group advances, attacks or casts (orders.ts: 進攻中). */
  advancing: boolean;
  /** 現有 when this attack started (the base), null while not advancing. */
  base: number | null;
  /** Fewer than half the base are left. */
  alarm: boolean;
  /** The alarm has just gone up: say it on the strip (once per attack). */
  tell: boolean;
}

export class GroupAlarms {
  private readonly base: (number | null)[];
  private readonly told: boolean[];

  constructor(groups = 4) {
    this.base = Array.from({ length: groups }, () => null);
    this.told = Array.from({ length: groups }, () => false);
  }

  /** Every snapshot, for group i: whether it advances and how many it has now. */
  update(i: number, advancing: boolean, present: number): Alarm {
    if (!advancing) {
      // 撤退中、堅守、站著: no alarm; the next attack counts from its own start.
      this.base[i] = null;
      this.told[i] = false;
      return { advancing, base: null, alarm: false, tell: false };
    }
    if (this.base[i] === null) this.base[i] = present;
    const base = this.base[i] as number;
    const alarm = base > 0 && present * 2 < base;
    const tell = alarm && !this.told[i];
    if (tell) this.told[i] = true;
    return { advancing, base, alarm, tell };
  }
}

/** The strip's line when the alarm goes up. */
export const alarmText = (group: number, present: number, base: number): string => `編隊 ${group + 1} 快撐不住了（剩 ${present}/${base}）`;
