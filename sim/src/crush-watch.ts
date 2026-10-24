// The AI behind after a big battle lost (ceo 2026-10-25: the user's 4fd7b823, hard sat at home and built
// no defences after losing 91 soldiers at the user's main city): the first battle the AI lost big, and
// what it did in the CRUSH_WINDOW ticks from its end. Watches the world every tick; changes nothing.
//
// A battle: soldiers (not farmers, not militia) of either side dying, each death within BATTLE_GAP
// ticks of the one before. Lost big: the AI lost CRUSH_LOST or more in it, and at least twice the
// player's.

import { BuildingType, TownState, UnitType } from "./protocol.ts";
import { UNIT_KINDS, type World } from "./core/world.ts";

const PLAYER = 0;
const AI = 1;
const BATTLE_GAP = 600;
const CRUSH_LOST = 15;
const CRUSH_WINDOW = 15 * 1200;
/** Cells from a main city's centre that count as at home (the AI's soldiers there, and where a battle was). */
const HOME_CELLS = 20;
/** A governed town of the AI's is attacked once ATTACKERS or more of the player's soldiers are within its walls + ATTACK_MARGIN cells. */
const ATTACKERS = 3;
const ATTACK_MARGIN = 2;
/** The AI's soldiers that come within its walls + CAME_MARGIN cells of a town attacked came to hold it. */
const CAME_MARGIN = 6;

export interface CrushRecord {
  /** The battle: its first and last death, each side's soldiers lost in it, where most of the AI's died. */
  start: number;
  end: number;
  aiLost: number;
  myLost: number;
  place: string;
  /** Soldiers [the player, the AI] at its end. */
  soldiersAtEnd: [number, number];
  /** The AI's farmers and soldiers, and the player's soldiers, at the end and each minute after (while the game lasts). */
  aiFarmers: number[];
  aiSoldiers: number[];
  mySoldiers: number[];
  /** In the window: the AI's farmers trained and lost. */
  farmersTrained: number;
  farmersLost: number;
  /** The AI's arrow towers and outposts: standing at the end of the battle, put down in the window, finished in it. */
  towers: [number, number, number];
  outposts: [number, number, number];
  /** Read every 20 ticks in the window: the AI's soldier-minutes within HOME_CELLS of its main city, all its soldier-minutes, and the minutes 90% or more of them were there. */
  home: { soldierMinutes: number; allSoldierMinutes: number; minutes: number };
  /** Its governed towns the player attacked in the window: when, the AI's soldiers that came, and whether it still held it (open: still going at the window's end). */
  towns: { town: number; start: number; end: number; came: number; held: boolean; open: boolean }[];
  /** Towns the AI governed at the end of the battle and at the end of the window. */
  governed: [number, number];
  /** The window's last tick looked at (the game over before CRUSH_WINDOW, or not). */
  until: number;
}

interface Episode {
  town: number;
  start: number;
  quiet: number;
  before: Set<number>;
  came: Set<number>;
}

export class CrushWatch {
  private battle: { start: number; last: number; ai: number; me: number; places: Map<string, number> } | null = null;
  private lastLost: [number, number] = [0, 0];
  private readonly at = new Map<number, { x: number; y: number }>();
  private crush: CrushRecord | null = null;
  private windowEnd = -1;
  private seenTowers = new Set<number>();
  private seenOutposts = new Set<number>();
  private doneTowers = new Set<number>();
  private doneOutposts = new Set<number>();
  private farmersAt: [number, number] = [0, 0];
  private open = new Map<number, Episode>();

  /** After every tick. */
  tick(w: World): void {
    if (w.tick % 20 !== 0) return;
    if (this.crush === null) this.watchBattles(w);
    else if (w.tick <= this.windowEnd) this.watchWindow(w);
  }

  private soldiers(w: World, p: number): number {
    const u = w.units.col;
    let n = 0;
    for (let s = 0; s < w.units.count; s++) if (u.owner[s] === p && u.type[s] !== UnitType.Farmer && u.type[s] !== UnitType.Militia) n++;
    return n;
  }

  private lost(w: World, p: number): number {
    let n = 0;
    for (let t = 0; t < UNIT_KINDS; t++) if (t !== UnitType.Farmer && t !== UnitType.Militia) n += w.lost[p * UNIT_KINDS + t];
    return n;
  }

  private place(w: World, x: number, y: number): string {
    for (const s of w.map.spawns) {
      if ((x - s.cellX) * (x - s.cellX) + (y - s.cellY) * (y - s.cellY) > HOME_CELLS * HOME_CELLS) continue;
      return s.player === PLAYER ? "home" : "aiCity";
    }
    for (let t = 0; t < w.townSize.length; t++) {
      if (Math.max(Math.abs(x - w.townX[t]), Math.abs(y - w.townY[t])) <= w.townRadius[t] + 3) return "town";
    }
    return "field";
  }

  private watchBattles(w: World): void {
    const u = w.units.col;
    const alive = new Set<number>();
    for (let s = 0; s < w.units.count; s++) {
      if (u.owner[s] !== AI || u.type[s] === UnitType.Farmer || u.type[s] === UnitType.Militia) continue;
      alive.add(u.id[s]);
      this.at.set(u.id[s], { x: u.x[s] >> 10, y: u.y[s] >> 10 });
    }
    const died: string[] = [];
    for (const [id, p] of this.at) {
      if (alive.has(id)) continue;
      this.at.delete(id);
      if (w.unit(id) < 0) died.push(this.place(w, p.x, p.y));
    }
    const lost: [number, number] = [this.lost(w, PLAYER), this.lost(w, AI)];
    const me = lost[0] - this.lastLost[0];
    const ai = lost[1] - this.lastLost[1];
    this.lastLost = lost;
    const b = this.battle;
    if (b !== null && w.tick - b.last > BATTLE_GAP) {
      this.battle = null;
      if (b.ai >= CRUSH_LOST && b.ai >= 2 * b.me) {
        this.begin(w, b);
        return;
      }
    }
    if (me + ai === 0) return;
    const now = (this.battle ??= { start: w.tick, last: w.tick, ai: 0, me: 0, places: new Map() });
    now.last = w.tick;
    now.ai += ai;
    now.me += me;
    for (const p of died) now.places.set(p, (now.places.get(p) ?? 0) + 1);
  }

  private governedBy(w: World, p: number): number {
    let n = 0;
    for (let t = 0; t < w.townOwner.length; t++) if (w.townOwner[t] === p && w.townState[t] === TownState.Governed) n++;
    return n;
  }

  private begin(w: World, b: { start: number; last: number; ai: number; me: number; places: Map<string, number> }): void {
    const place = [...b.places].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0]?.[0] ?? "field";
    const bd = w.buildings.col;
    let towers = 0;
    let outposts = 0;
    for (let s = 0; s < w.buildings.count; s++) {
      if (bd.owner[s] !== AI) continue;
      if (bd.type[s] === BuildingType.ArrowTower) {
        towers++;
        this.seenTowers.add(bd.id[s]);
        if (bd.progress[s] >= 1000) this.doneTowers.add(bd.id[s]);
      } else if (bd.type[s] === BuildingType.Outpost) {
        outposts++;
        this.seenOutposts.add(bd.id[s]);
        if (bd.progress[s] >= 1000) this.doneOutposts.add(bd.id[s]);
      }
    }
    this.farmersAt = [w.trained[AI * UNIT_KINDS + UnitType.Farmer], w.lost[AI * UNIT_KINDS + UnitType.Farmer]];
    this.crush = {
      start: b.start,
      end: b.last,
      aiLost: b.ai,
      myLost: b.me,
      place,
      soldiersAtEnd: [this.soldiers(w, PLAYER), this.soldiers(w, AI)],
      aiFarmers: [this.farmers(w)],
      aiSoldiers: [this.soldiers(w, AI)],
      mySoldiers: [this.soldiers(w, PLAYER)],
      farmersTrained: 0,
      farmersLost: 0,
      towers: [towers, 0, 0],
      outposts: [outposts, 0, 0],
      home: { soldierMinutes: 0, allSoldierMinutes: 0, minutes: 0 },
      towns: [],
      governed: [this.governedBy(w, AI), this.governedBy(w, AI)],
      until: w.tick,
    };
    this.windowEnd = b.last + CRUSH_WINDOW;
    this.at.clear();
  }

  private farmers(w: World): number {
    const u = w.units.col;
    let n = 0;
    for (let s = 0; s < w.units.count; s++) if (u.owner[s] === AI && u.type[s] === UnitType.Farmer) n++;
    return n;
  }

  private watchWindow(w: World): void {
    const c = this.crush!;
    c.until = w.tick;
    const u = w.units.col;
    const bd = w.buildings.col;
    for (let s = 0; s < w.buildings.count; s++) {
      if (bd.owner[s] !== AI) continue;
      const id = bd.id[s];
      const finished = bd.progress[s] >= 1000;
      if (bd.type[s] === BuildingType.ArrowTower) {
        if (!this.seenTowers.has(id)) {
          this.seenTowers.add(id);
          c.towers[1]++;
        }
        if (finished && !this.doneTowers.has(id)) {
          this.doneTowers.add(id);
          c.towers[2]++;
        }
      } else if (bd.type[s] === BuildingType.Outpost) {
        if (!this.seenOutposts.has(id)) {
          this.seenOutposts.add(id);
          c.outposts[1]++;
        }
        if (finished && !this.doneOutposts.has(id)) {
          this.doneOutposts.add(id);
          c.outposts[2]++;
        }
      }
    }
    // Home time: 20 ticks a reading, 60 readings a minute.
    const aiHome = w.map.spawns.find((s) => s.player === AI)!;
    let all = 0;
    let home = 0;
    for (let s = 0; s < w.units.count; s++) {
      if (u.owner[s] !== AI || u.type[s] === UnitType.Farmer || u.type[s] === UnitType.Militia) continue;
      all++;
      const dx = (u.x[s] >> 10) - aiHome.cellX;
      const dy = (u.y[s] >> 10) - aiHome.cellY;
      if (dx * dx + dy * dy <= HOME_CELLS * HOME_CELLS) home++;
    }
    c.home.soldierMinutes += home / 60;
    c.home.allSoldierMinutes += all / 60;
    if (all > 0 && home * 10 >= all * 9) c.home.minutes += 1 / 60;
    // The AI's governed (or repairing) towns the player attacks.
    for (let t = 0; t < w.townOwner.length; t++) {
      const held = w.townOwner[t] === AI && (w.townState[t] === TownState.Governed || w.townState[t] === TownState.Repairing);
      const within = (s: number, margin: number) => Math.max(Math.abs((u.x[s] >> 10) - w.townX[t]), Math.abs((u.y[s] >> 10) - w.townY[t])) <= w.townRadius[t] + margin;
      let attackers = 0;
      const near = new Set<number>();
      for (let s = 0; s < w.units.count; s++) {
        if (u.type[s] === UnitType.Farmer || u.type[s] === UnitType.Militia) continue;
        if (u.owner[s] === PLAYER && within(s, ATTACK_MARGIN)) attackers++;
        else if (u.owner[s] === AI && within(s, CAME_MARGIN)) near.add(u.id[s]);
      }
      const e = this.open.get(t);
      if (e === undefined) {
        if (held && attackers >= ATTACKERS) this.open.set(t, { town: t, start: w.tick, quiet: w.tick, before: near, came: new Set() });
        continue;
      }
      for (const id of near) if (!e.before.has(id)) e.came.add(id);
      if (attackers > 0) e.quiet = w.tick;
      const lostIt = w.townOwner[t] !== AI || w.townState[t] === TownState.Neutral;
      if (lostIt || w.tick - e.quiet >= BATTLE_GAP) {
        c.towns.push({ town: t, start: e.start, end: w.tick, came: e.came.size, held: !lostIt, open: false });
        this.open.delete(t);
      }
    }
    if ((w.tick - c.end) % 1200 === 0) {
      c.aiFarmers.push(this.farmers(w));
      c.aiSoldiers.push(this.soldiers(w, AI));
      c.mySoldiers.push(this.soldiers(w, PLAYER));
    }
    c.farmersTrained = w.trained[AI * UNIT_KINDS + UnitType.Farmer] - this.farmersAt[0];
    c.farmersLost = w.lost[AI * UNIT_KINDS + UnitType.Farmer] - this.farmersAt[1];
    c.governed[1] = this.governedBy(w, AI);
  }

  /** At the end of the game (or the cap): null if the AI never lost big. */
  result(): CrushRecord | null {
    const c = this.crush;
    if (c === null) return null;
    const towns = [...c.towns, ...[...this.open.values()].map((e) => ({ town: e.town, start: e.start, end: c.until, came: e.came.size, held: true, open: true }))];
    const r = (x: number) => Math.round(x * 10) / 10;
    return {
      ...c,
      soldiersAtEnd: [...c.soldiersAtEnd],
      aiFarmers: [...c.aiFarmers],
      aiSoldiers: [...c.aiSoldiers],
      mySoldiers: [...c.mySoldiers],
      towers: [...c.towers],
      outposts: [...c.outposts],
      home: { soldierMinutes: r(c.home.soldierMinutes), allSoldierMinutes: r(c.home.allSoldierMinutes), minutes: r(c.home.minutes) },
      towns,
      governed: [...c.governed],
    };
  }
}
