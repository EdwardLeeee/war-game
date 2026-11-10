// 戰事標記 (R17-03, D-138; ui's R17-03 board, the user 2026-11-10: 「可以，照這樣做」): every 進攻, 防守 and 團戰 of a game,
// worked out from its timeline for the marks under the charts' time axis and the card a tap opens. Pure, like model.ts.
// The rules are client's R17 counts (review/r17, from the player's own games) with ui's two:
// - 防守: the computer's soldiers, ATTACK_MIN or more, by our main city or a town we govern or repair; 進攻: ours by a
//   place not ours (their main city, their town, a neutral town; not ruins). From the first sample there to the last,
//   back within 30 s the same one; one sample with nobody dead is not one (both kinds).
// - 進攻 on a neutral town only with one of ours or of its militia dead, or taken (passing by is not one).
// - Ours by a town lost within the last minute is not 進攻: its dead go to that 防守 (militia not), and taken back it
//   is 「失守後搶回」.
// - 團戰: soldiers killed by the other side, BATTLE_MIN within a minute; overlapping or within 30 s one.
// The card writes 最多 N 名 (ceo 2026-11-10): the most there at once; the dead are the whole thing's, so may be more.

import { type GameTimeline, NEUTRAL, TICKS_PER_SECOND, TownState, UnitType } from "../../sim.ts";
import { clock } from "../hud/names.ts";
import { battleDeaths, type Cell, isPlayer, type Place, places, rowsByTown, type StatsWorld, townAt, townNames } from "./model.ts";

const S = TICKS_PER_SECOND;
const MERGE = 30 * S;
const ATTACK_MIN = 5;
const BATTLE_WINDOW = 60 * S;
const BATTLE_MIN = 10;
/** A town ours this long before 進攻 by it began was just lost: that 防守 goes on. */
const JUST_LOST = 60 * S;

export type WarKind = "進攻" | "防守" | "團戰";

export interface WarEvent {
  kind: WarKind;
  /** Its first sample (進攻, 防守) or first death (團戰): where its mark stands. */
  from: number;
  to: number;
  /** A town's name, 主城, 敵方主城, 野外 (團戰 nowhere near a place). */
  place: string;
  /** 進攻: ours, 防守: theirs, the most there at once (a sample); 團戰: null. */
  most: number | null;
  /** Soldiers dead (not farmers): ours, theirs (進攻: their militia too). */
  dead: { me: number; foe: number };
  /**
   * 進攻: 攻下後搶, 攻下後治理, 攻下, 攻下敵方主城, 沒攻下; 防守: 擋下, 城鎮失守, 城鎮被搶, 主城被毀, 失守後搶回;
   * 團戰: 我方贏, 敵方贏, 平手.
   */
  result: string;
}

interface Spell {
  id: number;
  from: number;
  to: number;
  samples: number;
  most: number;
}

/** Samples marked by a place (near[] id), into spells: back within MERGE the same one. */
function spells(marks: Map<number, { tick: number; n: number }[]>): Spell[] {
  const out: Spell[] = [];
  for (const [id, ms] of marks) {
    let cur: Spell | null = null;
    for (const m of ms) {
      if (cur !== null && m.tick - cur.to <= MERGE) {
        cur.to = m.tick;
        cur.samples++;
        cur.most = Math.max(cur.most, m.n);
        continue;
      }
      if (cur !== null) out.push(cur);
      cur = { id, from: m.tick, to: m.tick, samples: 1, most: m.n };
    }
    if (cur !== null) out.push(cur);
  }
  return out.sort((a, b) => a.from - b.from);
}

/** Soldiers (not farmers) dead within `reach` of `c` in [from, to]: by owner, militia (NEUTRAL) too. */
function deadNear(t: GameTimeline, c: Cell | null, reach: number, from: number, to: number): { militia: number; by: number[] } {
  const by = [0, 0, 0];
  if (c !== null) {
    for (const d of t.deaths) {
      if (d[0] < from || d[0] > to || d[2] === UnitType.Farmer) continue;
      if (d[1] !== 0 && d[1] !== 1 && d[1] !== NEUTRAL) continue;
      if (Math.hypot(d[3] - c.cellX, d[4] - c.cellY) <= reach) by[d[1] === NEUTRAL ? 2 : d[1]]++;
    }
  }
  return { militia: by[2], by };
}

/** Every 進攻, 防守 and 團戰 of the game, by when it began. */
export function warEvents(t: GameTimeline, w: StatsWorld): WarEvent[] {
  const me = w.me;
  const foe = 1 - me;
  const byTown = rowsByTown(t);
  const names = townNames(w, [...new Set([...w.towns.keys(), ...byTown.keys()])]);
  const all = places(w, names);
  // A near[] id: a main city's player, or -1 for a town.
  const cityOf = (id: number) => (w.townCount !== null && id >= w.townCount ? id - w.townCount : -1);
  const placeOf = (id: number): { name: string; cell: Cell | null; reach: number } => {
    const p = cityOf(id);
    const key = p >= 0 ? -1 - p : id;
    const at: Place | undefined = all.find((x) => x.key === key);
    if (at !== undefined) return { name: at.name, cell: at, reach: at.reach };
    return { name: p >= 0 ? (p === me ? "主城" : "敵方主城") : "城鎮（沒去過）", cell: null, reach: 0 };
  };

  // Samples: theirs by a place of ours (防守), ours by a place not ours (進攻, with what it was then).
  const defend = new Map<number, { tick: number; n: number }[]>();
  const raid = new Map<number, { tick: number; n: number }[]>();
  const raidKind = new Map<string, "neutral" | "town" | "city">();
  for (const s of t.samples) {
    for (const [id, n0, n1] of s.near) {
      const mine = me === 0 ? n0 : n1;
      const theirs = me === 0 ? n1 : n0;
      const p = cityOf(id);
      const at = p >= 0 ? null : townAt(byTown.get(id) ?? [], s.tick);
      const ours = p >= 0 ? p === me : at !== null && at.owner === me && (at.state === TownState.Governed || at.state === TownState.Repairing);
      if (ours && theirs >= ATTACK_MIN) defend.set(id, [...(defend.get(id) ?? []), { tick: s.tick, n: theirs }]);
      const notOurs = p >= 0 ? p === foe : at !== null && at.owner !== me && at.state !== TownState.Ruins;
      if (notOurs && mine >= ATTACK_MIN) {
        const list = raid.get(id) ?? [];
        // What the place was at the spell's first sample (a spell starts after a gap of more than MERGE).
        if (list.length === 0 || s.tick - list[list.length - 1].tick > MERGE) raidKind.set(`${id}@${s.tick}`, p >= 0 ? "city" : at?.owner === foe ? "town" : "neutral");
        list.push({ tick: s.tick, n: mine });
        raid.set(id, list);
      }
    }
  }

  const out: (WarEvent & { id?: number })[] = [];
  const defences: (WarEvent & { id: number })[] = [];
  for (const sp of spells(defend)) {
    const pl = placeOf(sp.id);
    const end = sp.to + t.every;
    const d = deadNear(t, pl.cell, pl.reach, sp.from, end).by;
    if (sp.samples === 1 && d[me] + d[foe] === 0) continue;
    let result = "擋下";
    const p = cityOf(sp.id);
    if (p < 0) {
      const after = townAt(byTown.get(sp.id) ?? [], end + MERGE);
      if (after.owner !== me) result = "城鎮失守";
      else if (after.state === TownState.Ruins || after.state === TownState.Plundering) result = "城鎮被搶";
    } else if (t.sides[me].cityHits.some((h) => h[2] === 0 && h[1] >= sp.from && h[0] <= end + MERGE)) result = "主城被毀";
    const e = { kind: "防守" as const, from: sp.from, to: sp.to, place: pl.name, most: sp.most, dead: { me: d[me], foe: d[foe] }, result, id: sp.id };
    defences.push(e);
    out.push(e);
  }

  for (const sp of spells(raid)) {
    const pl = placeOf(sp.id);
    const end = sp.to + t.every;
    const d = deadNear(t, pl.cell, pl.reach, sp.from - t.every, end);
    const lostMe = d.by[me];
    const lostFoe = d.by[foe];
    if (sp.samples === 1 && lostMe + lostFoe + d.militia === 0) continue;
    const p = cityOf(sp.id);
    let result = "沒攻下";
    if (p < 0) {
      const rows = byTown.get(sp.id) ?? [];
      const taken = rows.find((r) => r[0] >= sp.from - t.every && r[0] <= end + MERGE && r[3] === me);
      if (taken !== undefined) {
        const next = rows.find((r) => r[0] >= taken[0] && r[3] === me && r[2] !== TownState.AwaitingChoice);
        result = next === undefined ? "攻下" : next[2] === TownState.Plundering ? "攻下後搶" : next[2] === TownState.Governed || next[2] === TownState.Repairing ? "攻下後治理" : "攻下";
      }
    } else if (t.sides[foe].cityHits.some((h) => h[2] === 0 && h[1] >= sp.from && h[0] <= end + MERGE)) result = "攻下敵方主城";
    // Passing by a neutral town: nobody of ours or of its militia dead, and not taken.
    if (raidKind.get(`${sp.id}@${sp.from}`) === "neutral" && lostMe + d.militia === 0 && result === "沒攻下") continue;
    // By a town lost within the last minute: that 防守 goes on (its last before this), militia not counted.
    if (p < 0 && townAt(byTown.get(sp.id) ?? [], sp.from - JUST_LOST).owner === me) {
      const prior = defences.filter((x) => x.id === sp.id && x.from <= sp.from).at(-1);
      if (prior !== undefined) {
        prior.dead.me += lostMe;
        prior.dead.foe += lostFoe;
        if (result.startsWith("攻下")) prior.result = "失守後搶回";
        continue;
      }
    }
    out.push({ kind: "進攻", from: sp.from, to: sp.to, place: pl.name, most: sp.most, dead: { me: lostMe, foe: lostFoe + d.militia }, result });
  }

  // 團戰: spells of BATTLE_MIN deaths within BATTLE_WINDOW, overlapping or within MERGE one.
  const b = battleDeaths(t).sort((x, y) => x[0] - y[0]);
  const found: { from: number; to: number }[] = [];
  for (let i = 0, j = 0; i < b.length; i++) {
    while (j < b.length && b[j][0] - b[i][0] <= BATTLE_WINDOW) j++;
    if (j - i < BATTLE_MIN) continue;
    const last = found.at(-1);
    if (last !== undefined && b[i][0] - last.to <= MERGE) last.to = Math.max(last.to, b[j - 1][0]);
    else found.push({ from: b[i][0], to: b[j - 1][0] });
  }
  for (const f of found) {
    const ds = b.filter((d) => d[0] >= f.from && d[0] <= f.to);
    const mid = (k: number) => {
      const v = ds.map((d) => d[k]).sort((x, y) => x - y);
      return v[v.length >> 1];
    };
    const cx = mid(3);
    const cy = mid(4);
    let at: Place | null = null;
    for (const p of all) {
      const dd = Math.hypot(p.cellX - cx, p.cellY - cy);
      if (dd <= p.reach && (at === null || dd < Math.hypot(at.cellX - cx, at.cellY - cy))) at = p;
    }
    const dead = { me: 0, foe: 0 };
    for (const d of ds) {
      if (!isPlayer(d[1])) continue;
      if (d[1] === me) dead.me++;
      else dead.foe++;
    }
    out.push({ kind: "團戰", from: f.from, to: f.to, place: at === null ? "野外" : at.name, most: null, dead, result: dead.me < dead.foe ? "我方贏" : dead.me > dead.foe ? "敵方贏" : "平手" });
  }

  const order: Record<WarKind, number> = { 進攻: 0, 防守: 1, 團戰: 2 };
  return out.sort((a, b) => a.from - b.from || order[a.kind] - order[b.kind]).map(({ kind, from, to, place, most, dead, result }) => ({ kind, from, to, place, most, dead, result }));
}

/** How long, in words: 2 分 28 秒, 45 秒, 3 分. */
export function lasted(ticks: number): string {
  const s = Math.max(0, Math.round(ticks / S));
  const m = Math.floor(s / 60);
  return m === 0 ? `${s} 秒` : s % 60 === 0 ? `${m} 分` : `${m} 分 ${s % 60} 秒`;
}

/** The card's two lines (R17-03): what, when, where, how many; then how it went and the dead. */
export function eventCard(e: WarEvent): { title: string; place: string; detail: string; result: string; dead: string } {
  const title = `${e.kind} ${clock(e.from)}`;
  if (e.kind === "團戰") return { title, place: e.place, detail: `打了 ${lasted(e.to - e.from)}`, result: e.result, dead: `我死 ${e.dead.me}、敵死 ${e.dead.foe}` };
  if (e.kind === "防守") return { title, place: e.place, detail: `敵方最多 ${e.most} 名`, result: e.result, dead: `敵死 ${e.dead.foe}、我死 ${e.dead.me}` };
  return { title, place: e.place, detail: `我方最多 ${e.most} 名`, result: e.result, dead: `我死 ${e.dead.me}、敵死 ${e.dead.foe}` };
}
