// An army that sits idle (D-139; the user's 64a27f8a, 2026-11-10: hard sent 45 to a cell it cannot stand on in a corner
// of a random map, sent the same move 141 times, they stood there 12 minutes while 102 more piled up at home, and it never
// came near the user's main city). Four signals per side, read from the world and the commands each tick; changes nothing.
// For the CI tables (tournament-summary.ts, idle-summary.ts) and the user's logs (log-watch.ts). Only reports.
//
// 1. bad target: IDLE.badSends or more moves or retreats in a row, of IDLE.orderUnits or more, to the same cell nobody can
//    stand on (rock, water, cliff, wall, a tree or mine; not a building: marching on one is going to fight it), each given
//    with those units' centre already within IDLE.arrived cells of it: an army that got as near as it can and is sent there
//    again and again. With whether the side had explored the cell, and how far the nearest open cell is. One such move is
//    nothing (the soldiers go to the nearest open cell; the AI often aims a cell into a tree), nor is one walking there.
// 2. idle: a soldier is idle while it fights nothing and stays within IDLE.still cells of where it settled (a resent move
//    that takes it nowhere does not count as doing something; an army re-forming at each resend moves its soldiers a few
//    cells: 64a27f8a's at the corner up to 12 over 10 minutes, mostly 1-4 a minute). Hidden, on the walls, posted or
//    guarding a town: not counted.
//    (a) away: IDLE.awayMin or more idle IDLE.awayTicks or longer, more than IDLE.awayCells from the side's main city and
//        towns; (b) home: IDLE.homeMin or more soldiers near home fighting nothing, IDLE.homeTicks or longer, while never
//        IDLE.armyNear of the side's soldiers went within IDLE.marchCells of the enemy main city (war-game-ai: soldiers
//        trained after a march wait at home, so "no march out" must mean none near the enemy; 64a27f8a's 102 at home were
//        mostly new, none idle 5 minutes, so it is the crowd that counts). Both while the enemy main city stands.
// 3. never there: never IDLE.armyNear or more of its soldiers at once within IDLE.cityNear of the enemy main city, in a game
//    of IDLE.neverTicks or more (64a27f8a: a lone scout passed within 12 cells at minute 8.5; the army never came).
// 4. stuck sends: IDLE.sends or more moves in a row to the same cell over IDLE.stuckTicks or longer, IDLE.orderUnits or more
//    each, fewer than half of them fighting, while those units' centre stays within IDLE.stuckCells of where it was at the
//    first; the most sends to one cell is kept as a column, not a signal (the AI resends its moves as it thinks, in a
//    fight as often as every 10 ticks, when an army moves less than a cell between sends).
// Tags for what the AI does on purpose (war-game-ai 2026-11-10): staging out of an enemy main city's reach before a siege
// (D-089), staging out of a fort's (D-081 fortStage), waiting at home after a broken-off march (D-081), keeping home
// against enemies near it; and (4) gathering at its own home or town before it sets out.

import { Action, BuildingType, CELL_SHIFT, type Command, Order, PLAYER_COUNT, UnitType } from "./protocol.ts";
import type { Game } from "./core/game.ts";
import { nearestWalkable } from "./core/paths.ts";
import { BUILDINGS } from "./core/rules.ts";
import type { World } from "./core/world.ts";

const MIN = 1200;

export const IDLE = {
  /** Ticks between looks at the soldiers. */
  sample: 20,
  still: 6,
  orderUnits: 10,
  badSends: 10,
  arrived: 8,
  /** Soldiers at once that make an army near the enemy main city (signals 2b, 3). */
  armyNear: 10,
  awayCells: 20,
  awayMin: 20,
  awayTicks: 3 * MIN,
  homeMin: 60,
  homeTicks: 5 * MIN,
  marchCells: 30,
  cityNear: 12,
  neverTicks: 25 * MIN,
  sends: 40,
  stuckCells: 4,
  stuckTicks: 2 * MIN,
  /** A send this long after the one before starts a new run. */
  sendGap: MIN,
  /** Staging before a siege: this far from the enemy main city, at most stagingTicks (D-089: about 16 cells, 3 minutes). */
  stagingCells: [14, 22] as const,
  stagingTicks: 4 * MIN,
  /** Staging before a fort: an enemy outpost or arrow tower this near. */
  fortCells: 10,
  /** Waiting after a broken-off march: a retreat of retreatUnits or more within retreatTicks before. */
  retreatUnits: 20,
  retreatTicks: 10 * MIN,
  /** Keeping home: enemy soldiers this near its main city. */
  defendCells: 24,
};

export interface IdleSpell {
  start: number;
  end: number;
  /** The most soldiers at once, and their centre then (cells). */
  most: number;
  x: number;
  y: number;
  /** "" none, or why it may be on purpose: "staging", "fort", "retreat", "defend", "home". */
  tag: string;
  /** While open (2b): looks, and looks with enemy soldiers near its main city. */
  looks?: number;
  foes?: number;
}

export interface IdleSide {
  /** Signal 1: the cells (the first time sent, the most units, the longest run of sends after arriving, all sends). */
  badTargets: { tick: number; x: number; y: number; units: number; run: number; sends: number; explored: boolean; toOpen: number }[];
  /** Moves of IDLE.orderUnits or more to cells nobody can stand on, once or more (a column only). */
  badTargetCount: number;
  /** Signal 2. */
  away: IdleSpell[];
  home: IdleSpell[];
  /** Signal 3: the first tick IDLE.armyNear of its soldiers were within IDLE.cityNear of the enemy main city; -1 never. */
  reachedCity: number;
  /** Signal 4: runs of stuck sends; and the cell sent to most, how often (a column only). */
  stuck: { x: number; y: number; start: number; end: number; sends: number; units: number; tag: string }[];
  mostSends: { x: number; y: number; sends: number };
}

export interface IdleRecord {
  ticks: number;
  sides: IdleSide[];
}

/** A finding: the signal (1, 2a, 2b, 3, 4), "plan" (the AI meant it) or "check", and where and when. */
export interface IdleFinding {
  signal: string;
  kind: "plan" | "check";
  detail: string;
}

interface Settled {
  x: number;
  y: number;
  since: number;
}

interface SendRun {
  last: number;
  /** Where the units' centre was at the run's first send. */
  cx: number;
  cy: number;
  run: number;
  start: number;
  units: number;
  total: number;
}

const BAD_KEPT = 5;
const mm = (t: number) => (t / MIN).toFixed(1);

/** Chebyshev distance (cells) from (x, y) to a square footprint. */
function toRect(x: number, y: number, rx: number, ry: number, size: number): number {
  return Math.max(rx - x, 0, x - (rx + size - 1), ry - y, 0, y - (ry + size - 1));
}

export class IdleWatch {
  private readonly settled = new Map<number, Settled>();
  private logAt = 0;
  private readonly sides: IdleSide[] = [];
  private readonly openAway: (IdleSpell | null)[] = [];
  private readonly openHome: (IdleSpell | null)[] = [];
  private readonly lastMarch: number[] = [];
  private readonly lastRetreat: number[] = [];
  private readonly sends: Map<number, SendRun>[] = [];
  private readonly bad: Map<number, IdleSide["badTargets"][number] & { last?: number; now?: number }>[] = [];

  private readonly game: Game;

  constructor(game: Game) {
    this.game = game;
    for (let p = 0; p < PLAYER_COUNT; p++) {
      this.sides.push({ badTargets: [], badTargetCount: 0, away: [], home: [], reachedCity: -1, stuck: [], mostSends: { x: -1, y: -1, sends: 0 } });
      this.openAway.push(null);
      this.openHome.push(null);
      this.lastMarch.push(0);
      this.lastRetreat.push(-1);
      this.sends.push(new Map());
      this.bad.push(new Map());
    }
  }

  /** After each step. */
  tick(): void {
    const g = this.game;
    const w = g.w;
    for (; this.logAt < g.log.length; this.logAt++) this.command(w, g.log[this.logAt]);
    if (w.tick % IDLE.sample === 0) this.look(w);
  }

  private command(w: World, c: Command): void {
    if (c.c !== "move" && c.c !== "retreat") return;
    const p = c.p;
    if (p >= PLAYER_COUNT) return;
    const u = w.units.col;
    const slots = c.u.map((id) => w.unit(id)).filter((s) => s >= 0);
    if (c.c === "retreat" && slots.length >= IDLE.retreatUnits) this.lastRetreat[p] = w.tick;
    if (slots.length < IDLE.orderUnits) return;
    const n = w.size;
    const side = this.sides[p];
    if (c.x < 0 || c.y < 0 || c.x >= n || c.y >= n) return;
    const cell = c.y * n + c.x;
    let cx = 0;
    let cy = 0;
    for (const s of slots) {
      cx += u.x[s] >> CELL_SHIFT;
      cy += u.y[s] >> CELL_SHIFT;
    }
    cx = Math.round(cx / slots.length);
    cy = Math.round(cy / slots.length);
    // 1: a cell nobody can stand on (not a building), sent again and again to an army already by it.
    if (w.grid[cell] !== 0 && w.buildingAt[cell] < 0) {
      side.badTargetCount++;
      let b = this.bad[p].get(cell);
      if (b === undefined) {
        const open = nearestWalkable(w, c.x, c.y);
        b = {
          tick: w.tick,
          x: c.x,
          y: c.y,
          units: slots.length,
          run: 0,
          sends: 0,
          explored: this.game.fog.explored[p][cell] === 1,
          toOpen: Math.max(Math.abs((open % n) - c.x), Math.abs(Math.trunc(open / n) - c.y)),
          last: -1,
          now: 0,
        };
        this.bad[p].set(cell, b);
      }
      b.sends++;
      b.units = Math.max(b.units, slots.length);
      const by = Math.max(Math.abs(cx - c.x), Math.abs(cy - c.y)) <= IDLE.arrived;
      const last = b.last ?? -1;
      b.now = by && last >= 0 && w.tick - last <= IDLE.sendGap ? b.now! + 1 : by ? 1 : 0;
      b.last = w.tick;
      b.run = Math.max(b.run, b.now!);
    }
    // 4: sends to the same cell that take those units nowhere.
    const runs = this.sends[p];
    let r = runs.get(cell);
    if (r === undefined) {
      r = { last: -1, cx, cy, run: 0, start: w.tick, units: slots.length, total: 0 };
      runs.set(cell, r);
    }
    r.total++;
    if (r.total > side.mostSends.sends) side.mostSends = { x: c.x, y: c.y, sends: r.total };
    let fighting = 0;
    for (const s of slots) if (u.action[s] === Action.Attack || u.action[s] === Action.Calibrate) fighting++;
    const still = r.last >= 0 && w.tick - r.last <= IDLE.sendGap && Math.max(Math.abs(cx - r.cx), Math.abs(cy - r.cy)) <= IDLE.stuckCells && fighting * 2 < slots.length;
    if (still) {
      r.run++;
      r.units = Math.max(r.units, slots.length);
    } else {
      this.closeRun(p, c.x, c.y, r);
      r.run = fighting * 2 < slots.length ? 1 : 0;
      r.start = w.tick;
      r.units = slots.length;
      r.cx = cx;
      r.cy = cy;
    }
    r.last = w.tick;
  }

  private closeRun(p: number, x: number, y: number, r: SendRun): void {
    if (r.run < IDLE.sends || r.last - r.start < IDLE.stuckTicks) return;
    const w = this.game.w;
    const own = this.ownCity(w, p);
    // Gathering at home (or by its own town) before it sets out: on purpose (CI #468: hard's fortress groups at (74,20)).
    const atHome = (own !== null && toRect(r.cx, r.cy, own[0], own[1], own[2]) <= IDLE.awayCells) || this.nearOwnTown(w, p, r.cx, r.cy);
    const tag = atHome ? "home" : this.stagingAt(w, p, r.cx, r.cy) && r.last - r.start <= IDLE.stagingTicks ? "staging" : "";
    this.sides[p].stuck.push({ x, y, start: r.start, end: r.last, sends: r.run, units: r.units, tag });
  }

  /** The enemy main city of side p (x, y, size), or null once it is down. */
  private enemyCity(w: World, p: number): [number, number, number] | null {
    const b = w.buildings.col;
    for (let s = 0; s < w.buildings.count; s++) {
      if (b.type[s] === BuildingType.MainCity && b.owner[s] !== p && b.owner[s] < PLAYER_COUNT && b.hp[s] > 0) return [b.cellX[s], b.cellY[s], BUILDINGS[BuildingType.MainCity].size];
    }
    return null;
  }

  private ownCity(w: World, p: number): [number, number, number] | null {
    const b = w.buildings.col;
    for (let s = 0; s < w.buildings.count; s++) {
      if (b.type[s] === BuildingType.MainCity && b.owner[s] === p && b.hp[s] > 0) return [b.cellX[s], b.cellY[s], BUILDINGS[BuildingType.MainCity].size];
    }
    return null;
  }

  private stagingAt(w: World, p: number, x: number, y: number): boolean {
    const e = this.enemyCity(w, p);
    if (e === null) return false;
    const d = toRect(x, y, e[0], e[1], e[2]);
    return d >= IDLE.stagingCells[0] && d <= IDLE.stagingCells[1];
  }

  private fortAt(w: World, p: number, x: number, y: number): boolean {
    const b = w.buildings.col;
    for (let s = 0; s < w.buildings.count; s++) {
      if (b.owner[s] === p || b.owner[s] >= PLAYER_COUNT || b.hp[s] <= 0) continue;
      if (b.type[s] !== BuildingType.Outpost && b.type[s] !== BuildingType.ArrowTower) continue;
      if (toRect(x, y, b.cellX[s], b.cellY[s], BUILDINGS[b.type[s]].size) <= IDLE.fortCells) return true;
    }
    return false;
  }

  private look(w: World): void {
    const u = w.units.col;
    const seen = new Set<number>();
    const away: number[][] = [[], []];
    const home: number[] = [0, 0];
    const enemy = [this.enemyCity(w, 0), this.enemyCity(w, 1)];
    const own = [this.ownCity(w, 0), this.ownCity(w, 1)];
    const foesHome = [false, false];
    const nearCity = [0, 0];
    const nearMarch = [0, 0];
    for (let s = 0; s < w.units.count; s++) {
      const p = u.owner[s];
      if (p >= PLAYER_COUNT || u.type[s] === UnitType.Farmer) continue;
      const id = u.id[s];
      seen.add(id);
      const x = u.x[s] >> CELL_SHIFT;
      const y = u.y[s] >> CELL_SHIFT;
      const e = enemy[p];
      if (e !== null) {
        const d = toRect(x, y, e[0], e[1], e[2]);
        if (d <= IDLE.marchCells) nearMarch[p]++;
        if (d <= IDLE.cityNear) nearCity[p]++;
      }
      const o = own[1 - p];
      if (o !== null && toRect(x, y, o[0], o[1], o[2]) <= IDLE.defendCells) foesHome[1 - p] = true;
      // Hidden, on the walls, posted, guarding a town: standing there is their job.
      const order = u.order[s];
      if (u.action[s] === Action.Garrisoned || u.action[s] === Action.OnWall || order === Order.Post || order === Order.Wall || order === Order.TownGuard || order === Order.Garrison) {
        this.settled.delete(id);
        continue;
      }
      let st = this.settled.get(id);
      const fighting = u.action[s] === Action.Attack || u.action[s] === Action.Calibrate;
      if (st === undefined || fighting || Math.max(Math.abs(x - st.x), Math.abs(y - st.y)) > IDLE.still) {
        st = { x, y, since: w.tick };
        this.settled.set(id, st);
      }
      const idle = w.tick - st.since;
      const awayFrom = (own[p] === null || toRect(x, y, own[p]![0], own[p]![1], own[p]![2]) > IDLE.awayCells) && !this.nearOwnTown(w, p, x, y);
      if (awayFrom) {
        if (idle >= IDLE.awayTicks) away[p].push(x, y);
      } else if (!fighting) home[p]++;
    }
    for (const id of this.settled.keys()) if (!seen.has(id)) this.settled.delete(id);
    for (let p = 0; p < PLAYER_COUNT; p++) {
      if (nearMarch[p] >= IDLE.armyNear) this.lastMarch[p] = w.tick;
      if (nearCity[p] >= IDLE.armyNear && this.sides[p].reachedCity < 0) this.sides[p].reachedCity = w.tick;
      const up = enemy[p] !== null;
      // 2a.
      const na = away[p].length / 2;
      if (up && na >= IDLE.awayMin) {
        let cx = 0;
        let cy = 0;
        for (let k = 0; k < away[p].length; k += 2) {
          cx += away[p][k];
          cy += away[p][k + 1];
        }
        cx = Math.round(cx / na);
        cy = Math.round(cy / na);
        let spell = this.openAway[p];
        if (spell === null) {
          spell = { start: w.tick, end: w.tick, most: 0, x: cx, y: cy, tag: "" };
          this.openAway[p] = spell;
          this.sides[p].away.push(spell);
        }
        spell.end = w.tick;
        if (na > spell.most) {
          spell.most = na;
          spell.x = cx;
          spell.y = cy;
        }
        const tag = this.fortAt(w, p, cx, cy) ? "fort" : this.stagingAt(w, p, cx, cy) && spell.end - spell.start <= IDLE.stagingTicks ? "staging" : "";
        // The spell's reason is the one it had all along; mixed, none.
        if (spell.start === w.tick) spell.tag = tag;
        else if (spell.tag !== tag) spell.tag = "";
      } else this.openAway[p] = null;
      // 2b: kept while it holds and no army has gone near the enemy since it began; a spell counts once it lasts.
      const open = this.openHome[p];
      if (up && home[p] >= IDLE.homeMin && (open === null || this.lastMarch[p] < open.start)) {
        let spell = open;
        if (spell === null) {
          const tag = this.lastRetreat[p] >= 0 && w.tick - this.lastRetreat[p] <= IDLE.retreatTicks ? "retreat" : "";
          spell = { start: w.tick, end: w.tick, most: 0, x: own[p]?.[0] ?? -1, y: own[p]?.[1] ?? -1, tag, looks: 0, foes: 0 };
          this.openHome[p] = spell;
        }
        spell.end = w.tick;
        spell.most = Math.max(spell.most, home[p]);
        spell.looks!++;
        if (foesHome[p]) spell.foes!++;
      } else this.closeHome(p);
    }
  }

  private closeHome(p: number): void {
    const spell = this.openHome[p];
    this.openHome[p] = null;
    if (spell === null || spell.end - spell.start < IDLE.homeTicks) return;
    // Keeping home: enemies near it most of the time.
    if (spell.tag === "" && spell.foes! * 2 >= spell.looks!) spell.tag = "defend";
    delete spell.looks;
    delete spell.foes;
    this.sides[p].home.push(spell);
  }

  private nearOwnTown(w: World, p: number, x: number, y: number): boolean {
    for (let t = 0; t < w.townOwner.length; t++) if (w.townOwner[t] === p && w.nearTown(t, x, y, IDLE.awayCells)) return true;
    return false;
  }

  result(): IdleRecord {
    const w = this.game.w;
    for (let p = 0; p < PLAYER_COUNT; p++) {
      for (const [cell, r] of this.sends[p]) this.closeRun(p, cell % w.size, Math.trunc(cell / w.size), r);
      this.closeHome(p);
      this.sides[p].badTargets = [...this.bad[p].values()]
        .filter((b) => b.run >= IDLE.badSends)
        .sort((a, b) => b.run - a.run)
        .slice(0, BAD_KEPT)
        .map(({ last: _l, now: _n, ...b }) => b);
    }
    return { ticks: w.tick, sides: this.sides.map((s) => ({ ...s, badTargets: [...s.badTargets], away: [...s.away], home: [...s.home], stuck: [...s.stuck] })) };
  }
}

/** What a game's record says about side p: one finding per signal that fired, "plan" when all of it has a reason. */
export function idleFindings(rec: IdleRecord, p: number): IdleFinding[] {
  const s = rec.sides[p];
  const out: IdleFinding[] = [];
  if (s.badTargets.length > 0) {
    const b = s.badTargets[0];
    out.push({ signal: "1", kind: "check", detail: `(${b.x},${b.y}) 到了以後連續送 ${b.run} 次（共 ${b.sends} 次）、${b.units} 名，第一次 ${mm(b.tick)} 分${b.explored ? "" : "（沒探索過）"}，離能走的格子 ${b.toOpen} 格` });
  }
  const spells = (key: string, list: IdleSpell[]) => {
    if (list.length === 0) return;
    const real = list.filter((x) => x.tag === "");
    const pick = (real.length > 0 ? real : list).reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
    out.push({
      signal: key,
      kind: real.length > 0 ? "check" : "plan",
      detail: `${list.length} 段；最長 ${mm(pick.start)}–${mm(pick.end)} 分，最多 ${pick.most} 名${key === "2a" ? `，在 (${pick.x},${pick.y})` : ""}${pick.tag !== "" ? `（${pick.tag}）` : ""}`,
    });
  };
  spells("2a", s.away);
  spells("2b", s.home);
  if (rec.ticks >= IDLE.neverTicks && s.reachedCity < 0) out.push({ signal: "3", kind: "check", detail: `${mm(rec.ticks)} 分的局，沒到過對手主城` });
  if (s.stuck.length > 0) {
    const real = s.stuck.filter((x) => x.tag === "");
    const k = (real.length > 0 ? real : s.stuck).reduce((a, b) => (b.sends > a.sends ? b : a));
    out.push({ signal: "4", kind: real.length > 0 ? "check" : "plan", detail: `去 (${k.x},${k.y}) 連續 ${k.sends} 次、${k.units} 名，${mm(k.start)}–${mm(k.end)} 分${k.tag !== "" ? `（${k.tag}）` : ""}` });
  }
  return out;
}
