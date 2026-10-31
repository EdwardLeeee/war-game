// 攻城打到底 (the user 2026-10-25: 「打城市的時候 攻進去就停了不會繼續打至佔領，要再按第二次才會
// 繼續打」). A town is taken once its militia are all dead, its tower is down and our soldiers stand
// inside (sim towns.ts); a soldier with no order looks for enemies 6 cells round only (AGGRO_RANGE),
// and the last militia mostly stand on the far walls. So soldiers the player sends at a town not ours
// (攻擊 on its ground or gate, on its militia or tower) are remembered as attacking it; whenever some
// of them stand with no order, the screen sends them at the nearest defender: from outside, the
// nearest gate while none is broken (ceo 2026-10-25), else as from inside, the nearest of its
// militia (on the walls too), enemy soldiers or tower; none seen, into its centre. It ends once the
// town is taken, or the player gives them another order, or they are all dead. Those of a group
// that come later (the user 2026-10-31: 「選兵團打城市的時候 後面過去的兵只會看不會打」; 自動補兵's
// recruits walk to the group and stand there) join it once they stand by the town with no order,
// unless the player has ordered them otherwise since the attack began. Auto commands (in the
// game's log, as 自動訓練's). Pure: Game gathers what the snapshot shows.

/** How often (ticks, 1 s) a town's idle attackers are sent again at most. */
export const ASSAULT_EVERY = 20;
/** An order sent and neither shown nor refused after this long (ticks, 30 s) is taken for lost. */
export const ASSAULT_SENT_TICKS = 600;
/** How far past a town's radius (cells) a soldier of a group attacking it counts as by it, and joins. */
export const ASSAULT_JOIN_CELLS = 6;

export interface Spot {
  x: number;
  y: number;
}

/** One of the attackers as the snapshot shows it (cells). */
export interface Attacker extends Spot {
  id: number;
  /** No order (it stands: its target dead, or there). */
  idle: boolean;
  /** Within the town's walls. */
  inside: boolean;
}

export interface Target extends Spot {
  id: number;
}

/** What a town under attack shows now. */
export interface AssaultScene {
  attackers: readonly Attacker[];
  /** Its militia (on the walls too), enemy soldiers in it, its tower: whatever keeps it from being taken. */
  defenders: readonly Target[];
  /** Its gates still standing. */
  gates: readonly Target[];
  /** Some gate of it is broken (a way in). */
  open: boolean;
  centre: Spot;
}

export type AssaultOrder = { c: "attack"; u: number[]; target: number } | { c: "move"; u: number[]; x: number; y: number };

const middle = (list: readonly Spot[]): Spot => ({ x: list.reduce((s, p) => s + p.x, 0) / list.length, y: list.reduce((s, p) => s + p.y, 0) / list.length });
const nearest = <T extends Spot>(list: readonly T[], from: Spot): T | null => {
  let best: T | null = null;
  let bestD = Infinity;
  for (const t of list) {
    const d = (t.x - from.x) ** 2 + (t.y - from.y) ** 2;
    if (d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
};

/**
 * The orders for the idle attackers: those outside while every gate stands go at the nearest gate;
 * the others at the nearest defender, or into the centre when none is seen (not when there already).
 */
export function assaultOrders(s: AssaultScene): AssaultOrder[] {
  const idle = s.attackers.filter((a) => a.idle);
  if (idle.length === 0) return [];
  const out: AssaultOrder[] = [];
  const shut = !s.open && s.gates.length > 0;
  const atGate = shut ? idle.filter((a) => !a.inside) : [];
  const rest = idle.filter((a) => !atGate.includes(a));
  if (atGate.length > 0) {
    const gate = nearest(s.gates, middle(atGate));
    if (gate !== null) out.push({ c: "attack", u: atGate.map((a) => a.id), target: gate.id });
  }
  if (rest.length > 0) {
    const from = middle(rest);
    const d = nearest(s.defenders, from);
    if (d !== null) out.push({ c: "attack", u: rest.map((a) => a.id), target: d.id });
    else {
      // None seen: into the centre, to see them; not again when they stand there already.
      const away = rest.filter((a) => Math.max(Math.abs(a.x - s.centre.x), Math.abs(a.y - s.centre.y)) > 2);
      if (away.length > 0) out.push({ c: "move", u: away.map((a) => a.id), x: Math.floor(s.centre.x), y: Math.floor(s.centre.y) });
    }
  }
  return out;
}

/**
 * Who attacks which town, and the order last sent to each town's attackers that the snapshot does
 * not show yet: until one of them shows an order, it is refused, or ASSAULT_SENT_TICKS pass (a page
 * behind its snapshots sees an order taken tens of steps late; sending again would only repeat it).
 */
export class Assaults {
  private readonly towns = new Map<number, Set<number>>();
  private readonly sent = new Map<number, { seqs: number[]; tick: number; ids: number[] }>();
  private readonly last = new Map<number, number>();
  /** Those the player ordered otherwise while some town was under attack: they do not join one (join). */
  private readonly excused = new Set<number>();

  /** The player sent these soldiers at this town: theirs from now on (and no other town's). */
  begin(town: number, ids: readonly number[]): void {
    this.drop(ids);
    if (ids.length === 0) return;
    for (const id of ids) this.excused.delete(id);
    this.towns.set(town, new Set([...(this.towns.get(town) ?? []), ...ids]));
  }

  /** The player gave these another order: no longer attacking any town. */
  drop(ids: readonly number[]): void {
    for (const [town, set] of this.towns) {
      for (const id of ids) set.delete(id);
      if (set.size === 0) this.end(town);
    }
    if (this.towns.size > 0) for (const id of ids) this.excused.add(id);
  }

  /** Those of `ids`, of a group attacking this town and standing by it, who join the attack (not the player's otherwise). Returns them. */
  join(town: number, ids: readonly number[]): number[] {
    const set = this.towns.get(town);
    if (set === undefined) return [];
    const taken = [...this.towns.values()];
    const fresh = ids.filter((id) => !this.excused.has(id) && !taken.some((s) => s.has(id)));
    for (const id of fresh) set.add(id);
    return fresh;
  }

  end(town: number): void {
    this.towns.delete(town);
    this.sent.delete(town);
    this.last.delete(town);
    if (this.towns.size === 0) this.excused.clear();
  }

  list(): { town: number; ids: number[] }[] {
    return [...this.towns].map(([town, ids]) => ({ town, ids: [...ids].sort((a, b) => a - b) }));
  }

  /** Whether the town's attackers may be sent again now (the last order shown, refused or lost, and ASSAULT_EVERY since). */
  due(town: number, tick: number, shows: (id: number) => boolean): boolean {
    const s = this.sent.get(town);
    if (s !== undefined && (s.ids.some(shows) || tick > s.tick + ASSAULT_SENT_TICKS)) this.sent.delete(town);
    if (this.sent.has(town)) return false;
    return tick >= (this.last.get(town) ?? Number.NEGATIVE_INFINITY) + ASSAULT_EVERY;
  }

  /** An order sent to the town's attackers now (two in a step, the gate's and the rest's, count as one). */
  sentNow(town: number, seq: number, tick: number, ids: readonly number[]): void {
    const s = this.sent.get(town);
    if (s !== undefined && s.tick === tick) this.sent.set(town, { seqs: [...s.seqs, seq], tick, ids: [...s.ids, ...ids] });
    else this.sent.set(town, { seqs: [seq], tick, ids: [...ids] });
    this.last.set(town, tick);
  }

  /** An order of ours refused: its town decides again. */
  refused(seq: number): void {
    for (const [town, s] of this.sent) if (s.seqs.includes(seq)) this.sent.delete(town);
  }

  /** Forget soldiers that are gone. */
  prune(alive: (id: number) => boolean): void {
    for (const [town, set] of this.towns) {
      for (const id of [...set]) if (!alive(id)) set.delete(id);
      if (set.size === 0) this.end(town);
    }
  }
}
