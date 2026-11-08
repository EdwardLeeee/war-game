// 局後統計 (R13-02 A 分頁, D-125; R6's look R14-09, D-129): what each page shows, worked out from the game's
// timeline (game_over's stats.timeline, D-124; PROTOCOL.md 6.1). Pure: the page (ui/stats/page.ts) only draws it.
// b2 2026-11-07 settled what the board left open:
// - kills are counted from deaths[].by (core: the other side's `lost` counts those militia killed too);
// - a town the screen never explored (a random map, 雙河關) is 「城鎮（沒去過）」, and near[]'s main-city rows are
//   read only when the number of towns is known (the fixed map): otherwise a moment at a main city says no numbers;
//   core's `places` (#425) lays every town and both main cities open, and then all is known;
// - a town's name is its size and where it lies from the map's centre as the screen shows it (D-132), 中 near the
//   centre, a number after names that repeat, 我方附近／敵方附近 under one clearly nearer one main city;
// - 關鍵時刻: at most 4, those within 30 s one, only 到, numbers and deaths (no 擋下來／被打退: the timeline
//   cannot tell), 「這局沒有關鍵時刻」 when there is none;
// - the opponent with the computer's style (GDD §13: 每局隨機，局後統計會顯示).

import type { Projection } from "../../camera/projection.ts";
import { DIFFICULTY_LABEL } from "../../difficulty.ts";
import { screenDirection } from "../../game/town-hint.ts";
import { type GameTimeline, GameOverReason, NEUTRAL, TICKS_PER_SECOND, TownSize, TownState, UnitType } from "../../sim.ts";
import { clock, GAME_OVER_REASON, UNIT_NAME } from "../hud/names.ts";

/** A point of a line: [tick, value]. */
export type Pt = readonly [tick: number, value: number];
export interface Pair<T> {
  me: T;
  foe: T;
}

export const RESOURCES = ["food", "wood", "gold", "crystal"] as const;
export type ResourceKey = (typeof RESOURCES)[number];
export const RESOURCE_NAME: Record<ResourceKey, string> = { food: "糧", wood: "木", gold: "金", crystal: "魔晶" };

/** The kinds 戰鬥 lists, in the board's order (民兵 are no player's). */
export const FIGHT_KINDS = [UnitType.Farmer, UnitType.Spearman, UnitType.Ranged, UnitType.Mage, UnitType.Cavalry, UnitType.Siege] as const;

const S = TICKS_PER_SECOND;
/** Moments closer than this are one (b2: 30 秒內的合成一個). */
const MERGE = 30 * S;
/** 第一次進攻: at least this many soldiers by a place the other side holds. */
const ATTACK_MIN = 5;
/** 大仗: the most soldiers killed by players within this long, at least BATTLE_MIN. */
const BATTLE_WINDOW = 60 * S;
const BATTLE_MIN = 10;
/** Deaths counted for a moment at a place: within this long after it, and this many cells of the place's centre. */
const AFTER = 60 * S;
const TOWN_REACH = 16;
const CITY_REACH = 14;
/** Towns this close to the map's centre (a share of its side) are 中. */
const CENTRE = 0.12;
/** 我方附近: the nearer main city at most this share of the other's distance. */
const CLEARLY_NEARER = 0.6;

export interface Cell {
  cellX: number;
  cellY: number;
}

/** What the screen knows of the map, for names and places (the timeline has only ids and cells). */
export interface StatsWorld {
  me: number;
  /** Towns the screen knows: the fixed map's all (MapInfo.towns), a random map's explored ones (Snapshot.towns). */
  towns: ReadonlyMap<number, Cell & { size: number }>;
  /** How many towns the map has, when known (the fixed map); null: near[]'s main-city rows cannot be told from towns. */
  townCount: number | null;
  /** Main city centres by player, null when not known. */
  cities: readonly (Cell | null)[];
  /** The map's side in cells. */
  mapSize: number;
  projection: Projection;
  /** 固定地圖, 隨機地圖, 雙河關 (map-mode.ts MAP_LABEL). */
  mapLabel: string;
  /** Whether the game had crystal (D-135, rules.features.noCrystal; absent: it had, an older simulation). */
  crystal?: boolean;
}

/**
 * The timeline's `places` (core #425, PROTOCOL.md 6.1; not in main yet, so its shape is written here): every town by
 * id and both main cities, laid open at the end. With it the names and near[]'s main-city rows need nothing the screen
 * explored; without it (an older simulation) `StatsWorld` is what the screen knew.
 */
export interface TimelinePlaces {
  towns: { size: number; cellX: number; cellY: number }[];
  cities: [Cell, Cell];
}

/** The world for the page: the timeline's places when it has them, else what the screen knew. */
export function withPlaces(w: StatsWorld, t: GameTimeline): StatsWorld {
  const places = (t as GameTimeline & { places?: TimelinePlaces }).places;
  if (places === undefined) return w;
  return { ...w, towns: new Map(places.towns.map((c, id) => [id, c])), townCount: places.towns.length, cities: places.cities };
}

export interface StatsHead {
  result: "won" | "lost" | "draw";
  /** 勝利, 失敗, 平手. */
  title: string;
  /** 敵方主城被摧毀, 我方主城被摧毀, 我方投降… */
  reason: string;
  /** m:ss. */
  time: string;
  /** 電腦・困難・掠奪型, or 玩家. */
  foe: string;
  map: string;
}

export interface FightRow {
  type: number;
  name: string;
  /** Ours that fell (to anyone). */
  lost: number;
  /** Theirs we killed (deaths[].by). */
  killed: number;
}

export interface TownSegment {
  from: number;
  to: number;
  kind: "neutral" | "awaiting" | "plunder" | "repair" | "gov" | "ruin";
  /** Whose: "me", "foe", null for neutral and ruins. */
  who: "me" | "foe" | null;
  /** The words in the bar when they fit: 我方治理, 敵方治理, 廢墟, 中立. */
  label: string;
}

export interface TownEvent {
  tick: number;
  /** 治, 搶, 叛. */
  mark: string;
  who: "me" | "foe";
}

export interface TownBar {
  id: number;
  name: string;
  /** 我方附近, 敵方附近, or "". */
  note: string;
  segments: TownSegment[];
  events: TownEvent[];
}

export interface Moment {
  tick: number;
  /** 第一次進攻, 主城第一次被打, 大仗, 攻進敵方主城, 敵方攻進主城. */
  title: string;
  text: string;
}

export interface MageSide {
  trained: number;
  lost: number;
  shots: number;
  kills: number;
  /** The shot that killed most: how many and when; null with none killed. */
  best: { kills: number; tick: number } | null;
}

export interface NumberRow {
  name: string;
  me: string;
  foe: string;
}

export interface StatsModel {
  head: StatsHead;
  /** The last tick (the game's length). */
  ticks: number;
  /** The time axis' step in minutes (5, 10, 15, 20 or 30: at most 6 steps). */
  axisMinutes: number;
  resources: Record<ResourceKey, Pair<Pt[]>>;
  /** The resources 資源 offers, in order (D-135, R15-05: 糧、木、金 without crystal). */
  resourceKeys: ResourceKey[];
  /** Soldiers (all but farmers), and when each side had the most. */
  army: Pair<Pt[]> & { peak: Pair<Pt> };
  fight: { rows: FightRow[]; lost: number; killed: number };
  towns: TownBar[];
  /** Per side: plundered, governed (chose to), revolted. */
  townCounts: Pair<[number, number, number]>;
  mages: Pair<MageSide> & { bestNote: string };
  moments: Moment[];
  numbers: NumberRow[];
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);
const STYLE_NAME: Record<string, string> = { plunder: "掠奪型", govern: "治理型", balanced: "均衡型" };

/** The header: who won, why, how long, against whom, on what map. */
export function statsHead(winner: number, reason: number, ticks: number, t: GameTimeline, w: StatsWorld): StatsHead {
  const result = winner === -1 ? "draw" : winner === w.me ? "won" : "lost";
  let why = GAME_OVER_REASON[reason] ?? "";
  if (reason === GameOverReason.MainCityDestroyed && result !== "draw") why = result === "won" ? "敵方主城被摧毀" : "我方主城被摧毀";
  if (reason === GameOverReason.Surrender && result !== "draw") why = result === "won" ? "敵方投降" : "我方投降";
  // The limit is the game's own (none when a person plays), not always 30 minutes.
  if (reason === GameOverReason.TimeLimit) why = "時間到";
  const ai = t.sides[1 - w.me]?.ai ?? null;
  const foe = ai === null ? "玩家" : `電腦・${DIFFICULTY_LABEL[ai.difficulty] ?? ai.difficulty}・${STYLE_NAME[ai.style] ?? ai.style}`;
  return { result, title: result === "won" ? "勝利" : result === "lost" ? "失敗" : "平手", reason: why, time: clock(ticks), foe, map: w.mapLabel };
}

/** The time axis' step: the smallest of 5, 10, 15, 20, 30 minutes with at most 6 steps. */
export function axisMinutes(ticks: number): number {
  const minutes = ticks / (60 * S);
  for (const m of [5, 10, 15, 20, 30]) if (minutes / m <= 6) return m;
  return 60;
}

const SHORT: Record<string, string> = { 右邊: "右", 右上方: "右上", 上方: "上", 左上方: "左上", 左邊: "左", 左下方: "左下", 下方: "下", 右下方: "右下" };

/**
 * Every town's name and note (b2 2026-11-07): 小鎮・右上, 大城・中; a number after names that repeat;
 * 城鎮（沒去過） for those the screen does not know (numbered when more than one).
 */
export function townNames(w: StatsWorld, ids: readonly number[]): Map<number, { name: string; note: string }> {
  const c = w.mapSize / 2;
  const base = new Map<number, string>();
  // Names that repeat are numbered from the one nearest the map's centre (the fixed map's two 左上 small towns:
  // 1 by the big city, 2 in the corner); the unknown ones in id order.
  const far = (id: number) => {
    const t = w.towns.get(id);
    return t === undefined ? Number.POSITIVE_INFINITY : Math.hypot(t.cellX - c, t.cellY - c);
  };
  for (const id of [...ids].sort((a, b) => far(a) - far(b) || a - b)) {
    const t = w.towns.get(id);
    if (t === undefined) {
      base.set(id, "城鎮（沒去過）");
      continue;
    }
    const dx = t.cellX - c;
    const dy = t.cellY - c;
    const where = Math.hypot(dx, dy) <= CENTRE * w.mapSize ? "中" : SHORT[screenDirection(dx, dy, w.projection)];
    base.set(id, `${t.size === TownSize.Large ? "大城" : "小鎮"}・${where}`);
  }
  const count = new Map<string, number>();
  for (const n of base.values()) count.set(n, (count.get(n) ?? 0) + 1);
  const seen = new Map<string, number>();
  const out = new Map<number, { name: string; note: string }>();
  for (const [id, n] of base) {
    const k = (seen.get(n) ?? 0) + 1;
    seen.set(n, k);
    out.set(id, { name: (count.get(n) ?? 0) > 1 ? `${n} ${k}` : n, note: townNote(w, id) });
  }
  return out;
}

function townNote(w: StatsWorld, id: number): string {
  const t = w.towns.get(id);
  const mine = w.cities[w.me];
  const theirs = w.cities[1 - w.me];
  if (t === undefined || mine == null || theirs == null) return "";
  const dm = Math.hypot(t.cellX - mine.cellX, t.cellY - mine.cellY);
  const df = Math.hypot(t.cellX - theirs.cellX, t.cellY - theirs.cellY);
  if (dm <= CLEARLY_NEARER * df) return "我方附近";
  if (df <= CLEARLY_NEARER * dm) return "敵方附近";
  return "";
}

/** A town's state and holder at `tick`, from its rows (a town starts neutral, unlisted). */
function townAt(rows: readonly (readonly number[])[], tick: number): { state: number; owner: number } {
  let state: number = TownState.Neutral;
  let owner = NEUTRAL;
  for (const r of rows) {
    if (r[0] > tick) break;
    state = r[2];
    owner = r[3];
  }
  return { state, owner };
}

/** Per town, its rows in order. */
function rowsByTown(t: GameTimeline): Map<number, (readonly number[])[]> {
  const m = new Map<number, (readonly number[])[]>();
  for (const r of t.towns) {
    const a = m.get(r[1]) ?? [];
    a.push(r);
    m.set(r[1], a);
  }
  return m;
}

/** Each town that changed hands, as a bar of segments and its 治／搶／叛 marks (R13-02 城鎮). */
export function townBars(t: GameTimeline, ticks: number, w: StatsWorld): TownBar[] {
  const byTown = rowsByTown(t);
  const names = townNames(w, [...new Set([...w.towns.keys(), ...byTown.keys()])]);
  const who = (owner: number): "me" | "foe" | null => (owner === w.me ? "me" : owner === 1 - w.me ? "foe" : null);
  const bars: TownBar[] = [];
  for (const id of [...byTown.keys()].sort((a, b) => a - b)) {
    const rows = byTown.get(id) ?? [];
    const segments: TownSegment[] = [];
    const events: TownEvent[] = [];
    let from = 0;
    let state: number = TownState.Neutral;
    let owner = NEUTRAL;
    const close = (to: number) => {
      if (to <= from) return;
      const w0 = who(owner);
      // AwaitingChoice is short: drawn as what came before it (core 2026-11-05).
      const prev = segments[segments.length - 1];
      if (state === TownState.AwaitingChoice && prev !== undefined) {
        prev.to = to;
        return;
      }
      const seg = segment(state, w0);
      if (prev !== undefined && prev.kind === seg.kind && prev.who === seg.who) prev.to = to;
      else segments.push({ from, to, ...seg });
    };
    for (const r of rows) {
      const [tick, , s, o] = r;
      close(tick);
      const actor = who(o);
      if (s === TownState.Repairing && actor !== null) events.push({ tick, mark: "治", who: actor });
      if (s === TownState.Plundering && actor !== null) events.push({ tick, mark: "搶", who: actor });
      if (s === TownState.Neutral && (state === TownState.Repairing || state === TownState.Governed)) {
        const was = who(owner);
        if (was !== null) events.push({ tick, mark: "叛", who: was });
      }
      from = Math.max(from, tick);
      state = s;
      owner = o;
    }
    close(ticks);
    const n = names.get(id) ?? { name: "城鎮（沒去過）", note: "" };
    bars.push({ id, name: n.name, note: n.note, segments, events });
  }
  return bars;
}

function segment(state: number, who: "me" | "foe" | null): Pick<TownSegment, "kind" | "who" | "label"> {
  const side = who === "me" ? "我方" : "敵方";
  switch (state) {
    case TownState.Plundering:
      return { kind: "plunder", who, label: "" };
    case TownState.Repairing:
      return { kind: "repair", who, label: "" };
    case TownState.Governed:
      return { kind: "gov", who, label: `${side}治理` };
    case TownState.Ruins:
      return { kind: "ruin", who: null, label: "廢墟" };
    case TownState.AwaitingChoice:
      return { kind: "awaiting", who, label: "" };
    default:
      return { kind: "neutral", who: null, label: "中立" };
  }
}

/** Plundered, chose to govern, revolted: per player, from the town rows. */
export function townCounts(t: GameTimeline): [number, number, number][] {
  const out: [number, number, number][] = [
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const rows of rowsByTown(t).values()) {
    let state: number = TownState.Neutral;
    let owner = NEUTRAL;
    for (const [, , s, o] of rows) {
      if (s === TownState.Plundering && o >= 0 && o < 2) out[o][0]++;
      if (s === TownState.Repairing && o >= 0 && o < 2) out[o][1]++;
      if (s === TownState.Neutral && (state === TownState.Repairing || state === TownState.Governed) && owner >= 0 && owner < 2) out[owner][2]++;
      state = s;
      owner = o;
    }
  }
  return out;
}

const isPlayer = (p: number) => p === 0 || p === 1;

/** Soldiers killed by players (not farmers, not militia: 大仗 is between the two sides). */
function battleDeaths(t: GameTimeline): (readonly number[])[] {
  return t.deaths.filter((d) => isPlayer(d[1]) && isPlayer(d[5]) && d[5] !== d[1] && d[2] !== UnitType.Farmer);
}

interface Place extends Cell {
  /** Town id, or -1 - player for a main city. */
  key: number;
  name: string;
  reach: number;
}

/** The places the screen can name: known towns and known main cities. */
function places(w: StatsWorld, names: Map<number, { name: string }>): Place[] {
  const out: Place[] = [];
  for (const [id, c] of w.towns) out.push({ key: id, cellX: c.cellX, cellY: c.cellY, name: names.get(id)?.name ?? "城鎮", reach: TOWN_REACH });
  w.cities.forEach((c, p) => {
    if (c != null) out.push({ key: -1 - p, cellX: c.cellX, cellY: c.cellY, name: p === w.me ? "主城" : "敵方主城", reach: CITY_REACH });
  });
  return out;
}

/** near[]'s place id for a place, or null when it cannot be told (a main city with the number of towns unknown). */
function nearId(key: number, w: StatsWorld): number | null {
  if (key >= 0) return key;
  return w.townCount === null ? null : w.townCount + (-1 - key);
}

/** Soldiers of `p` near a place (near[] id) at the sample nearest `tick`; null when unknown. */
function nearAt(t: GameTimeline, id: number | null, tick: number, p: number): number | null {
  if (id === null || t.samples.length === 0) return null;
  let best = t.samples[0];
  for (const s of t.samples) if (Math.abs(s.tick - tick) < Math.abs(best.tick - tick)) best = s;
  const row = best.near.find((r) => r[0] === id);
  return row === undefined ? 0 : p === 0 ? row[1] : row[2];
}

/** Deaths within `reach` cells of `c` in [from, to], per owner. */
function deathsNear(t: GameTimeline, c: Cell, reach: number, from: number, to: number, keep: (d: readonly number[]) => boolean = () => true): [number, number] {
  const n: [number, number] = [0, 0];
  for (const d of t.deaths) {
    if (d[0] < from || d[0] > to || !isPlayer(d[1]) || !keep(d)) continue;
    if (Math.hypot(d[3] - c.cellX, d[4] - c.cellY) <= reach) n[d[1]]++;
  }
  return n;
}

const side = (p: number, me: number) => (p === me ? "我方" : "敵方");

/**
 * 關鍵時刻 (b2 2026-11-07, client's rules): 第一次進攻, 主城第一次被打, 大仗, 攻進敵方主城 and, for a loss, the spell
 * the main city fell in (敵方攻進主城) when it is not the first; ordered by time, those within 30 s one (the higher
 * kind kept), at most 4 (the lowest kind dropped).
 */
export function moments(t: GameTimeline, w: StatsWorld, result: StatsHead["result"]): Moment[] {
  const me = w.me;
  const foe = 1 - me;
  const names = townNames(w, [...new Set([...w.towns.keys(), ...t.towns.map((r) => r[1])])]);
  const all = places(w, names);
  const found: (Moment & { rank: number })[] = [];

  // 第一次進攻: the first sample with ATTACK_MIN soldiers of one side by a town the other holds (repairing or
  // governed) or by the other's main city (when near[] tells main cities).
  const byTown = rowsByTown(t);
  first: for (const s of t.samples) {
    for (const [id, n0, n1] of s.near) {
      let holder = -1;
      let place: Place | undefined;
      if (w.townCount === null || id < w.townCount) {
        const at = townAt(byTown.get(id) ?? [], s.tick);
        if (at.state === TownState.Repairing || at.state === TownState.Governed) holder = at.owner;
        place = all.find((p) => p.key === id);
      } else {
        holder = id - w.townCount;
        place = all.find((p) => p.key === -1 - holder);
      }
      if (!isPlayer(holder)) continue;
      const by = 1 - holder;
      const n = by === 0 ? n0 : n1;
      if (n < ATTACK_MIN) continue;
      const where = place?.name ?? (id >= (w.townCount ?? Infinity) ? (holder === me ? "主城" : "敵方主城") : "城鎮（沒去過）");
      let text = `${side(by, me)} ${n} 名到${where}`;
      if (place !== undefined) {
        const d = deathsNear(t, place, place.reach, s.tick, s.tick + AFTER);
        text += `（敵死 ${d[foe]}、我死 ${d[me]}）`;
      }
      found.push({ tick: s.tick, title: "第一次進攻", text, rank: 0 });
      break first;
    }
  }

  // 主城第一次被打: ours, its first spell; and the enemy's (攻進敵方主城).
  const city = (p: number, spell: readonly number[], title: string, rank: number) => {
    const [from, to] = spell;
    const by = 1 - p;
    const n = nearAt(t, nearId(-1 - p, w), from, by);
    const at = p === me ? "主城" : "敵方主城下";
    let text = n === null || n === 0 ? `${side(by, me)}到${at}` : `${side(by, me)} ${n} 名到${at}`;
    const c = w.cities[p];
    if (p === me && c != null) {
      const farmers = deathsNear(t, c, CITY_REACH, from, to, (d) => d[2] === UnitType.Farmer)[me];
      if (farmers > 0) text += `（村民死 ${farmers}）`;
    }
    found.push({ tick: from, title, text, rank });
  };
  const mine = t.sides[me].cityHits;
  const theirs = t.sides[foe].cityHits;
  if (mine.length > 0) city(me, mine[0], "主城第一次被打", 1);
  if (theirs.length > 0) city(foe, theirs[0], "攻進敵方主城", 2);
  // A loss: the spell the main city fell in, when not the first.
  if (result === "lost" && mine.length > 1) {
    const last = mine[mine.length - 1];
    if (last[2] === 0) city(me, last, "敵方攻進主城", 2);
  }

  // 大仗: the BATTLE_WINDOW with the most soldiers killed by players (the earliest of equals), at least BATTLE_MIN.
  const b = battleDeaths(t);
  let best = { from: 0, n: 0, i: 0, j: 0 };
  for (let i = 0, j = 0; i < b.length; i++) {
    while (j < b.length && b[j][0] - b[i][0] <= BATTLE_WINDOW) j++;
    if (j - i > best.n) best = { from: b[i][0], n: j - i, i, j };
  }
  if (best.n >= BATTLE_MIN) {
    const ds = b.slice(best.i, best.j);
    const mid = (k: number) => {
      const v = ds.map((d) => d[k]).sort((x, y) => x - y);
      return v[v.length >> 1];
    };
    const cx = mid(3);
    const cy = mid(4);
    let at: Place | null = null;
    for (const p of all) {
      const d = Math.hypot(p.cellX - cx, p.cellY - cy);
      if (d <= p.reach && (at === null || d < Math.hypot(at.cellX - cx, at.cellY - cy))) at = p;
    }
    const lost = [0, 0];
    for (const d of ds) lost[d[1]]++;
    const id = at === null ? null : nearId(at.key, w);
    const to = ds[ds.length - 1][0];
    let a: number | null = null;
    let c: number | null = null;
    for (const s of t.samples) {
      if (s.tick < best.from - t.every || s.tick > to || id === null) continue;
      const row = s.near.find((r) => r[0] === id);
      if (row === undefined) continue;
      a = Math.max(a ?? 0, me === 0 ? row[1] : row[2]);
      c = Math.max(c ?? 0, me === 0 ? row[2] : row[1]);
    }
    const where = at === null ? "野外" : at.name;
    const count = a !== null && c !== null && a + c > 0 ? `${a} 名對 ${c} 名，` : "";
    found.push({ tick: best.from, title: "大仗", text: `${where}：${count}我死 ${lost[me]}、敵死 ${lost[foe]}`, rank: 3 });
  }

  found.sort((x, y) => x.tick - y.tick || y.rank - x.rank);
  const merged: (Moment & { rank: number })[] = [];
  for (const m of found) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && m.tick - prev.tick < MERGE) {
      if (m.rank > prev.rank) merged[merged.length - 1] = m;
      continue;
    }
    merged.push(m);
  }
  while (merged.length > 4) {
    let low = 0;
    for (let i = 1; i < merged.length; i++) if (merged[i].rank < merged[low].rank) low = i;
    merged.splice(low, 1);
  }
  return merged.map(({ tick, title, text }) => ({ tick, title, text }));
}

/** Everything the page shows. */
export function statsModel(winner: number, reason: number, ticks: number, t: GameTimeline, known: StatsWorld): StatsModel {
  const w = withPlaces(known, t);
  const me = w.me;
  const foe = 1 - me;
  const head = statsHead(winner, reason, ticks, t, w);
  const line = (f: (s: GameTimeline["samples"][number]) => number): Pt[] => t.samples.map((s) => [s.tick, f(s)] as const);
  const resources = {} as Record<ResourceKey, Pair<Pt[]>>;
  RESOURCES.forEach((k, i) => {
    resources[k] = { me: line((s) => s.earned[me][i]), foe: line((s) => s.earned[foe][i]) };
  });
  const soldiers = (u: readonly number[]) => sum(u) - (u[UnitType.Farmer] ?? 0);
  const army = { me: line((s) => soldiers(s.units[me])), foe: line((s) => soldiers(s.units[foe])) };
  const peak = (pts: Pt[]): Pt => pts.reduce<Pt>((a, p) => (p[1] > a[1] ? p : a), [0, 0]);

  const killed = new Array<number>(8).fill(0);
  for (const d of t.deaths) if (d[1] === foe && d[5] === me) killed[d[2]]++;
  const S0 = t.sides[me];
  const S1 = t.sides[foe];
  const any = (type: number) => (S0.trained[type] ?? 0) + (S1.trained[type] ?? 0) + (S0.lost[type] ?? 0) + (S1.lost[type] ?? 0) + killed[type] > 0;
  const rows: FightRow[] = FIGHT_KINDS.filter((k) => k <= UnitType.Mage || any(k)).map((type) => ({ type, name: UNIT_NAME[type], lost: S0.lost[type] ?? 0, killed: killed[type] }));

  const counts = townCounts(t);
  const mage = (s: GameTimeline["sides"][number]): MageSide => ({
    trained: s.trained[UnitType.Mage] ?? 0,
    lost: s.lost[UnitType.Mage] ?? 0,
    shots: s.cannon.shots,
    kills: s.cannon.kills,
    best: s.cannon.best === null ? null : { kills: s.cannon.best.kills, tick: s.cannon.best.tick },
  });
  const ms = moments(t, w, head.result);
  const best = S0.cannon.best;
  let bestNote = "";
  if (best !== null && best.kills > 0) {
    const kinds = best.types.map((n, type) => (n > 0 ? `${UNIT_NAME[type]} ${n}` : "")).filter((x) => x !== "");
    const fight = ms.find((m) => m.title === "大仗" && best.tick >= m.tick && best.tick <= m.tick + BATTLE_WINDOW);
    bestNote = `晶砲擊殺最多的一發：${clock(best.tick)}${fight === undefined ? "" : " 大仗"}，炸死 ${best.kills} 名（${kinds.join("、")}）`;
  }

  const end = (k: ResourceKey, p: "me" | "foe") => fmt(resources[k][p][resources[k][p].length - 1]?.[1] ?? 0);
  const trainedSoldiers = (s: GameTimeline["sides"][number]) => sum(s.trained) - (s.trained[UnitType.Farmer] ?? 0);
  const numbers: NumberRow[] = [
    { name: "採集 糧・木", me: `${end("food", "me")}・${end("wood", "me")}`, foe: `${end("food", "foe")}・${end("wood", "foe")}` },
    // D-135 (R15-05): 金 alone without crystal.
    w.crystal === false
      ? { name: "採集 金", me: end("gold", "me"), foe: end("gold", "foe") }
      : { name: "採集 金・魔晶", me: `${end("gold", "me")}・${end("crystal", "me")}`, foe: `${end("gold", "foe")}・${end("crystal", "foe")}` },
    { name: "訓練（不含村民）", me: `${trainedSoldiers(S0)}`, foe: `${trainedSoldiers(S1)}` },
    { name: "損失（含村民）", me: `${sum(S0.lost)}`, foe: `${sum(S1.lost)}` },
    { name: "法師（訓練／陣亡）", me: `${mage(S0).trained}／${mage(S0).lost}`, foe: `${mage(S1).trained}／${mage(S1).lost}` },
    { name: "城鎮（搶／治理／叛離）", me: counts[me].join("／"), foe: counts[foe].join("／") },
  ];
  if (any(UnitType.Siege)) numbers.push({ name: "攻城砲（訓練／損失）", me: `${S0.trained[UnitType.Siege] ?? 0}／${S0.lost[UnitType.Siege] ?? 0}`, foe: `${S1.trained[UnitType.Siege] ?? 0}／${S1.lost[UnitType.Siege] ?? 0}` });

  return {
    head,
    ticks,
    axisMinutes: axisMinutes(ticks),
    resources,
    resourceKeys: RESOURCES.filter((k) => k !== "crystal" || w.crystal !== false),
    army: { ...army, peak: { me: peak(army.me), foe: peak(army.foe) } },
    fight: { rows, lost: sum(rows.map((r) => r.lost)), killed: sum(rows.map((r) => r.killed)) },
    towns: townBars(t, ticks, w),
    townCounts: { me: counts[me], foe: counts[foe] },
    mages: { me: mage(S0), foe: mage(S1), bestNote },
    moments: ms,
    numbers,
  };
}
