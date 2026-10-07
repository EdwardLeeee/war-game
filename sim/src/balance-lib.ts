// Small battles for unit balance (round 3 of the prototype, D-026): two armies of equal cost
// form up facing each other on open ground, one of them is told to move onto the other, and
// nobody is micromanaged. Everything goes through the game's own commands, so formations,
// targeting, the crystal cannon's autocast and the rules tables are the real ones. The
// results are deterministic. src/balance.ts prints them; nothing here runs on import.

import { Game } from "./core/game.ts";
import { BUILDINGS, CANNON, UNITS } from "./core/rules.ts";
import { damage } from "./core/units.ts";
import { Action, BuildingType, CELL_SHIFT, type CommandBody, NEUTRAL, Order, Resource, Stance, type TownSize, TownState, UnitFlag, UnitType } from "./protocol.ts";

/** Spearmen, ranged, mages and (round 7) cavalry of one side. */
export interface Army {
  spear: number;
  ranged: number;
  mage: number;
  cav?: number;
}

const TYPES: [keyof Army, UnitType][] = [
  ["spear", UnitType.Spearman],
  ["ranged", UnitType.Ranged],
  ["mage", UnitType.Mage],
  ["cav", UnitType.Cavalry],
];

/** What an army costs: every resource counts the same (crystal too). */
export function armyCost(a: Army): number {
  let sum = 0;
  for (const [key, type] of TYPES) {
    const c = UNITS[type].cost;
    sum += (a[key] ?? 0) * (c.food + c.wood + c.gold + c.crystal);
  }
  return sum;
}

export function armyText(a: Army): string {
  const parts: string[] = [];
  if (a.spear > 0) parts.push(`${a.spear} 槍兵`);
  if (a.ranged > 0) parts.push(`${a.ranged} 遠程`);
  if (a.mage > 0) parts.push(`${a.mage} 法師`);
  if ((a.cav ?? 0) > 0) parts.push(`${a.cav} 騎兵`);
  return parts.join("＋");
}

/** How the attacker stands and marches. */
export type Formation = "close" | "loose" | "loose-on-the-way";

export interface Fight {
  /** 0 or 1: the side that won (the other has nobody left), or -1 when the time ran out. */
  winner: number;
  /** Units left per side. */
  left: [Army, Army];
  /** Cannon shots fired and units hit by them, per side. */
  shots: [number, number];
  hits: [number, number];
  /** Ticks from the order to attack until it was over. */
  ticks: number;
}

/** Walkable field W x H, away from the map edge, every building and every town. */
const FIELD_W = 34;
const FIELD_H = 15;
/** Ticks an army gets to form up before the fight; and the longest fight (2 minutes). */
const FORM_UP_TICKS = 400;
const FIGHT_TICKS = 2400;
/** Crystal for the cannon: enough that the stock never decides a fight. */
const CRYSTAL = 1000;

function field(g: Game): { x: number; y: number } {
  const w = g.w;
  const n = w.size;
  const b = w.buildings.col;
  const militia = new Set<number>();
  for (let s = 0; s < w.units.count; s++) if (w.units.col.type[s] === UnitType.Militia) militia.add(w.units.col.home[s]);
  for (let y = 2; y + FIELD_H <= n - 2; y++) {
    for (let x = 2; x + FIELD_W <= n - 2; x++) {
      let ok = true;
      for (let s = 0; s < w.buildings.count && ok; s++) {
        const size = BUILDINGS[b.type[s]].size;
        if (b.cellX[s] + size + 10 > x && b.cellX[s] - 10 < x + FIELD_W && b.cellY[s] + size + 10 > y && b.cellY[s] - 10 < y + FIELD_H) ok = false;
      }
      // Towns whose militia still stand. fight() clears them all, so since the corner towns
      // (round 6) the field lies where it always did, in the top-left open ground.
      for (const t of w.map.towns) {
        if (!militia.has(t.id)) continue;
        const r = t.radius + 3;
        if (t.cellX + r >= x && t.cellX - r < x + FIELD_W && t.cellY + r >= y && t.cellY - r < y + FIELD_H) ok = false;
      }
      for (let yy = y; yy < y + FIELD_H && ok; yy++) for (let xx = x; xx < x + FIELD_W && ok; xx++) if (!w.walkable(xx, yy)) ok = false;
      if (ok) return { x, y };
    }
  }
  throw new Error("no open field on the map");
}

function count(g: Game, p: number): Army {
  const u = g.w.units.col;
  const a: Army = { spear: 0, ranged: 0, mage: 0, cav: 0 };
  for (let s = 0; s < g.w.units.count; s++) {
    if (u.owner[s] !== p) continue;
    if (u.type[s] === UnitType.Spearman) a.spear++;
    else if (u.type[s] === UnitType.Ranged) a.ranged++;
    else if (u.type[s] === UnitType.Mage) a.mage++;
    else if (u.type[s] === UnitType.Cavalry) a.cav = (a.cav ?? 0) + 1;
  }
  return a;
}

const total = (a: Army) => a.spear + a.ranged + a.mage + (a.cav ?? 0);

/** Who is told to move onto the other's position: side 0, side 1, or both at once. */
export const BOTH = 2;

/**
 * One fight. Side 0 stands on the left, side 1 on the right, their front rows `distance`
 * cells apart; `attacker` (0, 1 or BOTH) is then told to move onto the other's position; a
 * side not told to attack stands as it is (aggressive, so it answers enemies that come near).
 * `formation` is that of side `looseSide` (default: the attacker, side 0 when both attack):
 * close, loose before it sets off (it forms up two cells apart, then attacks), or told to go
 * loose only together with the order to attack.
 */
export function fight(armies: [Army, Army], attacker: number, distance: number, formation: Formation = "close", looseSide = attacker === BOTH ? 0 : attacker): Fight {
  const g = new Game({ seed: 1, scenario: "standard", maxTicks: 0 });
  const w = g.w;
  const u = w.units.col;
  // An empty map: no farmers, no town militia.
  for (let s = 0; s < w.units.count; s++) w.unitSlot[u.id[s]] = -1;
  w.units.count = 0;
  const f = field(g);
  const midY = f.y + (FIELD_H >> 1);
  // Fronts: the loose side's rows may be two cells apart, so it gets the deeper half.
  const frontX = [0, 0];
  const deep = 13;
  if (looseSide === 0) {
    frontX[0] = f.x + deep;
    frontX[1] = frontX[0] + distance;
  } else {
    frontX[1] = f.x + FIELD_W - 1 - deep;
    frontX[0] = frontX[1] - distance;
  }
  let seq = 0;
  const push = (p: number, body: CommandBody) => g.push({ ...body, t: g.tick, p, seq: seq++ } as never);
  const ids: number[][] = [[], []];
  for (let p = 0; p < 2; p++) {
    // A block four cells behind the front, facing the other side; the move forms it up.
    const back = p === 0 ? -1 : 1;
    let k = 0;
    for (const [key, type] of TYPES) {
      for (let i = 0; i < (armies[p][key] ?? 0); i++, k++) {
        const col = Math.trunc(k / 6);
        const row = k % 6;
        const x = frontX[p] + back * (4 + col);
        const y = midY - 3 + row;
        const id = w.addUnit(p, type, (x << CELL_SHIFT) + 512, (y << CELL_SHIFT) + 512, UNITS[type].hp);
        if (type === UnitType.Mage) u.flags[w.unit(id)] |= UnitFlag.Autocast;
        ids[p].push(id);
      }
    }
    w.res[p * 4 + Resource.Crystal] = CRYSTAL;
  }
  g.fog.update(w);
  if (formation === "loose") push(looseSide, { c: "formation", u: ids[looseSide], loose: true });
  for (let p = 0; p < 2; p++) push(p, { c: "move", u: ids[p], x: frontX[p], y: midY });
  for (let t = 0; t < FORM_UP_TICKS; t++) {
    g.step();
    let moving = false;
    for (let s = 0; s < w.units.count; s++) if (u.order[s] !== Order.None) moving = true;
    if (!moving) break;
  }
  if (formation === "loose-on-the-way") push(looseSide, { c: "formation", u: ids[looseSide], loose: true });
  for (let p = 0; p < 2; p++) if (attacker === p || attacker === BOTH) push(p, { c: "move", u: ids[p], x: frontX[1 - p], y: midY });
  const start = g.tick;
  let winner = -1;
  while (g.tick - start < FIGHT_TICKS) {
    g.step();
    const left0 = total(count(g, 0));
    const left1 = total(count(g, 1));
    if (left0 === 0 || left1 === 0) {
      winner = left0 > 0 ? 0 : left1 > 0 ? 1 : -1;
      break;
    }
  }
  return {
    winner,
    left: [count(g, 0), count(g, 1)],
    shots: [w.cannonShots[0], w.cannonShots[1]],
    hits: [w.cannonHits[0], w.cannonHits[1]],
    ticks: g.tick - start,
  };
}

export interface Siege {
  /** The town was taken. */
  taken: boolean;
  /** Attackers left, and their hit points as a share of the start (percent). */
  left: number;
  hpPercent: number;
  ticks: number;
}

/** `spearmen` of player 0 against the town of this size as it stands at the start of a game (militia, tower). */
export function siege(size: TownSize, spearmen: number): Siege {
  const g = new Game({ seed: 1, scenario: "standard", maxTicks: 0 });
  const w = g.w;
  const u = w.units.col;
  const town = w.map.towns.findIndex((x) => x.size === size);
  const t = w.map.towns[town];
  // Walkable cells 10 to 13 cells from the town, nearest player 0's side first.
  const home = w.map.spawns[0];
  const cells: { x: number; y: number; d: number }[] = [];
  for (let y = t.cellY - 13; y <= t.cellY + 13; y++) {
    for (let x = t.cellX - 13; x <= t.cellX + 13; x++) {
      const d2 = (x - t.cellX) * (x - t.cellX) + (y - t.cellY) * (y - t.cellY);
      if (d2 < 100 || d2 > 169 || !w.walkable(x, y)) continue;
      cells.push({ x, y, d: (x - home.cellX) * (x - home.cellX) + (y - home.cellY) * (y - home.cellY) });
    }
  }
  cells.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  const ids: number[] = [];
  const hp = UNITS[UnitType.Spearman].hp;
  for (let k = 0; k < spearmen; k++) ids.push(w.addUnit(0, UnitType.Spearman, (cells[k].x << CELL_SHIFT) + 512, (cells[k].y << CELL_SHIFT) + 512, hp));
  g.fog.update(w);
  g.push({ c: "move", u: ids, x: t.cellX, y: t.cellY, t: g.tick, p: 0, seq: 0 } as never);
  const start = g.tick;
  const own = () => {
    let left = 0;
    let sum = 0;
    for (let s = 0; s < w.units.count; s++) {
      if (u.owner[s] !== 0 || u.type[s] !== UnitType.Spearman) continue;
      left++;
      sum += u.hp[s];
    }
    return { left, sum };
  };
  let taken = false;
  while (g.tick - start < 3600) {
    g.step();
    if (w.townOwner[town] === 0) {
      taken = true;
      break;
    }
    if (own().left === 0) break;
  }
  const { left, sum } = own();
  return { taken, left, hpPercent: Math.trunc((sum * 100) / (spearmen * hp)), ticks: g.tick - start };
}

/** The fewest spearmen (1 up to `most`) that take the town of this size; also the sieges tried, by number; -1 if none does. */
export function fewestToTake(size: TownSize, most = 30): { fewest: number; tried: Siege[] } {
  const tried: Siege[] = [];
  for (let n = 1; n <= most; n++) {
    const s = siege(size, n);
    tried.push(s);
    if (s.taken) return { fewest: n, tried };
  }
  return { fewest: -1, tried };
}

/** What two crystal cannon shots do to a spearman at full health (goal 1). */
export function twoShots(): { damage: number; hp: number; survives: boolean } {
  const d = 2 * damage(CANNON.damage, UnitType.Mage, UnitType.Spearman);
  const hp = UNITS[UnitType.Spearman].hp;
  return { damage: d, hp, survives: d < hp };
}

/** Neutral units on the map (the militia), for callers that want to check a scenario. */
export function militia(g: Game): number {
  let n = 0;
  for (let s = 0; s < g.w.units.count; s++) if (g.w.units.col.owner[s] === NEUTRAL) n++;
  return n;
}

/** How player 1 defends its main city in `assault` (round 7, D-061). */
export type Defense = "standing" | "city" | "towers";

export interface Assault {
  /** The main city fell within the time. */
  fell: boolean;
  /** Ticks from the order until the city fell (or the time ran out, or the attackers were all down). */
  ticks: number;
  attackersLeft: number;
  defendersLeft: number;
  /** The main city's hp at the end, and the arrow towers still standing. */
  cityHp: number;
  towersLeft: number;
}

/** The longest assault (3 minutes). */
const ASSAULT_TICKS = 3600;
/** The defender's crystal: 20 shots, about what a side has mid-game (the attacker gets CRYSTAL). */
const ASSAULT_CRYSTAL = 100;

/**
 * Player 0's `attackers` march on player 1's main city from 20 cells off and take on what they
 * meet (an attack-move to the city, then aggressive), with no micromanagement. Player 1 has
 * `defenders` (default 4 ranged and 2 mages, autocast on, 100 crystal) and defends as
 * `defense` says: standing beside the city; hidden in the city; or hidden 3 in each of 2 arrow
 * towers 6 cells in front of it (round 7: towers and hiding). `loose`: the attackers spread out
 * (`formation`) before they set off.
 */
export function assault(defense: Defense, attackers: Army, loose = false, defenders: Army = { spear: 0, ranged: 4, mage: 2 }, defenderCrystal = ASSAULT_CRYSTAL): Assault {
  const g = new Game({ seed: 1, scenario: "standard", maxTicks: 0 });
  const w = g.w;
  const u = w.units.col;
  const b = w.buildings.col;
  for (let s = 0; s < w.units.count; s++) w.unitSlot[u.id[s]] = -1;
  w.units.count = 0;
  const city = w.mainCity(1);
  const cityId = b.id[city];
  const cx = b.cellX[city];
  const cy = b.cellY[city];
  // Player 1's city is the mirror image of player 0's: the open ground lies below it (+y).
  let seq = 0;
  const push = (p: number, body: CommandBody) => g.push({ ...body, t: g.tick, p, seq: seq++ } as never);
  const towers: number[] = [];
  if (defense === "towers") {
    const info = BUILDINGS[BuildingType.ArrowTower];
    for (const x of [cx - 1, cx + 3]) {
      for (let y = cy + 6; y < cy + 8; y++) for (let xx = x; xx < x + 2; xx++) if (!w.walkable(xx, y)) throw new Error("no room for a tower");
      towers.push(w.addBuilding(1, BuildingType.ArrowTower, x, cy + 6, info.hp, 1000));
    }
  }
  const place = (p: number, army: Army, x0: number, y0: number): number[] => {
    const ids: number[] = [];
    let k = 0;
    for (const [key, type] of TYPES) {
      for (let i = 0; i < (army[key] ?? 0); i++, k++) {
        const id = w.addUnit(p, type, ((x0 + (k % 8)) << CELL_SHIFT) + 512, ((y0 + Math.trunc(k / 8)) << CELL_SHIFT) + 512, UNITS[type].hp);
        if (type === UnitType.Mage) u.flags[w.unit(id)] |= UnitFlag.Autocast;
        ids.push(id);
      }
    }
    w.res[p * 4 + Resource.Crystal] = CRYSTAL;
    return ids;
  };
  const guard = place(1, defenders, cx - 2, cy + 5);
  w.res[4 + Resource.Crystal] = defenderCrystal;
  const army = place(0, attackers, cx - 2, cy + 20);
  g.fog.update(w);
  if (defense === "city") push(1, { c: "garrison", u: guard, building: cityId });
  if (defense === "towers") {
    push(1, { c: "garrison", u: guard.slice(0, 3), building: towers[0] });
    push(1, { c: "garrison", u: guard.slice(3), building: towers[1] });
  }
  for (let t = 0; t < 100; t++) g.step();
  if (defense !== "standing" && !guard.every((id) => u.action[w.unit(id)] === Action.Garrisoned)) throw new Error("the defenders did not all hide");
  if (loose) {
    push(0, { c: "formation", u: army, loose: true });
    for (let t = 0; t < 100; t++) g.step();
  }
  push(0, { c: "move", u: army, x: cx + 1, y: cy + 5 });
  const start = g.tick;
  const alive = (ids: number[]) => ids.filter((id) => w.unit(id) >= 0).length;
  while (g.tick - start < ASSAULT_TICKS && !w.over && alive(army) > 0) g.step();
  return {
    fell: w.over && w.winner === 0,
    ticks: g.tick - start,
    attackersLeft: alive(army),
    defendersLeft: alive(guard),
    cityHp: w.building(cityId) >= 0 ? b.hp[w.building(cityId)] : 0,
    towersLeft: towers.filter((id) => w.building(id) >= 0).length,
  };
}

/** How player 1 holds its governed town in `hold` (round 8, D-069). */
export type Hold = "idle" | "hold" | "tower";

export interface Held {
  /** 0: the attackers took the town (no defender left); 1: the defenders held (no attacker left); -1: time ran out. */
  winner: number;
  /** Defenders when the mages had fired and the attackers charged (of `defenders`). */
  defenders: number;
  beforeCharge: number;
  /** The defenders' hit points then, as a share of the start (percent). */
  hpBeforeCharge: number;
  defendersLeft: number;
  attackers: number;
  attackersLeft: number;
  /** Units the attackers' cannon killed, and the shots it fired, in all. */
  cannonKills: number;
  shots: number;
  /** Mages that found a defender within cannon range for the opening volley. */
  volley: number;
}

/** The longest town fight after the charge (2 minutes). */
const HOLD_TICKS = 2400;

/**
 * Player 1 holds its governed town (the middle small town, on the diagonal between the two
 * starts) against player 0's army with `mages` mages (round 8, D-069; the user: "對方進攻的法師
 * 往往會先開砲"). The defenders stand in the town as one move put them there (a squad), in
 * spearmen and ranged pairs costing about what the attackers do (6 spearmen, 6 ranged and the
 * mages); `defense` "hold" puts them on hold stance, "tower" spends an arrow tower's cost of
 * them on one in front of the town. The attackers come up from the south: the mages walk to
 * where the nearest defender is just within cannon range, the rest wait 3 cells behind them;
 * each mage fires at the spot that hits the most defenders (one spot per mage, if there are
 * enough), and once the shots have landed everyone moves into the town (mages on autocast).
 */
export function hold(defense: Hold, mages: number): Held {
  const g = new Game({ seed: 1, scenario: "standard", maxTicks: 0 });
  const w = g.w;
  const u = w.units.col;
  for (let s = 0; s < w.units.count; s++) w.unitSlot[u.id[s]] = -1;
  w.units.count = 0;
  // The small town nearest both starts (the middle one, not a corner).
  const [s0, s1] = w.map.spawns;
  const far = (x: { cellX: number; cellY: number }) =>
    Math.hypot(x.cellX - s0.cellX, x.cellY - s0.cellY) + Math.hypot(x.cellX - s1.cellX, x.cellY - s1.cellY);
  const small = w.map.towns.filter((x) => x.size === 0).sort((a, b) => far(a) - far(b));
  const t = w.map.towns.indexOf(small[0]);
  const town = w.map.towns[t];
  w.townOwner[t] = 1;
  w.townState[t] = TownState.Governed;
  const tx = town.cellX;
  const ty = town.cellY;
  let seq = 0;
  const push = (p: number, body: CommandBody) => g.push({ ...body, t: g.tick, p, seq: seq++ } as never);
  const attackers: Army = { spear: 6, ranged: 6, mage: mages };
  const pair = armyCost({ spear: 1, ranged: 1, mage: 0 });
  const towerCost = (() => {
    const c = BUILDINGS[BuildingType.ArrowTower].cost;
    return c.food + c.wood + c.gold + c.crystal;
  })();
  const pairs = Math.trunc((armyCost(attackers) - (defense === "tower" ? towerCost : 0)) / pair);
  const defenders: Army = { spear: pairs, ranged: pairs, mage: 0 };
  if (defense === "tower") {
    const x = tx + 2;
    const y = ty + 2;
    for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 2; xx++) if (!w.walkable(xx, yy)) throw new Error("no room for a tower");
    w.addBuilding(1, BuildingType.ArrowTower, x, y, BUILDINGS[BuildingType.ArrowTower].hp, 1000);
  }
  const place = (p: number, army: Army, x0: number, y0: number): number[] => {
    const ids: number[] = [];
    let k = 0;
    for (const [key, type] of TYPES) {
      for (let i = 0; i < (army[key] ?? 0); i++, k++) {
        const id = w.addUnit(p, type, ((x0 + (k % 6)) << CELL_SHIFT) + 512, ((y0 + Math.trunc(k / 6)) << CELL_SHIFT) + 512, UNITS[type].hp);
        if (type === UnitType.Mage) u.flags[w.unit(id)] |= UnitFlag.Autocast;
        ids.push(id);
      }
    }
    w.res[p * 4 + Resource.Crystal] = CRYSTAL;
    return ids;
  };
  const guard = place(1, defenders, tx - 3, ty - 3);
  const army = place(0, attackers, tx - 3, ty + 16);
  const mageIds = army.filter((id) => u.type[w.unit(id)] === UnitType.Mage);
  const rest = army.filter((id) => u.type[w.unit(id)] !== UnitType.Mage);
  g.fog.update(w);
  push(1, { c: "move", u: guard, x: tx, y: ty });
  push(0, { c: "move", u: army, x: tx, y: ty + 16 });
  // Commands take effect on the next step.
  const settled = (ids: number[]) => ids.every((id) => w.unit(id) < 0 || u.order[w.unit(id)] === Order.None);
  g.step();
  for (let k = 0; k < FORM_UP_TICKS && !(settled(guard) && settled(army)); k++) g.step();
  if (defense === "hold") push(1, { c: "stance", u: guard, stance: Stance.Hold });
  // Where the nearest defender is a cell inside cannon range, south of the town.
  const range = CANNON.range - 1024;
  const nearest = (x: number, y: number) => {
    let best = Number.MAX_SAFE_INTEGER;
    for (const id of guard) {
      const s = w.unit(id);
      if (s < 0) continue;
      const dx = u.x[s] - x;
      const dy = u.y[s] - y;
      best = Math.min(best, dx * dx + dy * dy);
    }
    return best;
  };
  // Each mage on its own, two cells apart in a row across the way in.
  let back = 0;
  mageIds.forEach((m, k) => {
    const mx = ((tx + 2 * k - (mageIds.length - 1)) << CELL_SHIFT) + 512;
    let my = (ty << CELL_SHIFT) + 512;
    while (nearest(mx, my) < range * range) my += 256;
    back = Math.max(back, my >> CELL_SHIFT);
    push(0, { c: "move", u: [m], x: mx >> CELL_SHIFT, y: my >> CELL_SHIFT });
  });
  push(0, { c: "move", u: rest, x: tx, y: back + 3 });
  g.step();
  for (let k = 0; k < FORM_UP_TICKS && !settled(army); k++) g.step();
  // The defenders may have shifted: a mage with nobody within half a cell of its range walks at
  // the nearest defender and stops once someone is.
  const near = (m: number) => {
    const s = w.unit(m);
    return s >= 0 && nearest(u.x[s], u.y[s]) <= (CANNON.range - 512) * (CANNON.range - 512);
  };
  for (let k = 0; k < FORM_UP_TICKS; k++) {
    let done = true;
    for (const m of mageIds) {
      const s = w.unit(m);
      if (s < 0) continue;
      if (near(m)) {
        if (u.order[s] !== Order.None) push(0, { c: "stop", u: [m] });
        if (u.order[s] !== Order.None) done = false;
        continue;
      }
      done = false;
      if (u.order[s] !== Order.None) continue;
      let to = -1;
      let best = Number.MAX_SAFE_INTEGER;
      for (const id of guard) {
        const d = w.unit(id);
        if (d < 0) continue;
        const dx = u.x[d] - u.x[s];
        const dy = u.y[d] - u.y[s];
        if (dx * dx + dy * dy < best) {
          best = dx * dx + dy * dy;
          to = d;
        }
      }
      if (to >= 0) push(0, { c: "move", u: [m], x: u.x[to] >> CELL_SHIFT, y: u.y[to] >> CELL_SHIFT });
    }
    if (done) break;
    g.step();
  }
  // The opening volley: each mage at the spot within its range that hits the most defenders.
  const r2 = CANNON.radius * CANNON.radius;
  const taken = new Set<number>();
  let volley = 0;
  for (const m of mageIds) {
    const ms = w.unit(m);
    if (ms < 0) continue;
    let best = -1;
    let bestHits = 0;
    let bestTaken = true;
    for (const id of guard) {
      const s = w.unit(id);
      if (s < 0) continue;
      const dx = u.x[s] - u.x[ms];
      const dy = u.y[s] - u.y[ms];
      if (dx * dx + dy * dy > CANNON.range * CANNON.range) continue;
      let hits = 0;
      for (const other of guard) {
        const o = w.unit(other);
        if (o < 0) continue;
        const ox = u.x[o] - u.x[s];
        const oy = u.y[o] - u.y[s];
        if (ox * ox + oy * oy <= r2) hits++;
      }
      // A spot no other mage took first; one taken only when there is nothing else in range.
      const again = taken.has(id);
      if (best < 0 || (bestTaken && !again) || (bestTaken === again && hits > bestHits)) {
        bestHits = hits;
        best = id;
        bestTaken = again;
      }
    }
    if (best < 0) continue;
    taken.add(best);
    volley++;
    const s = w.unit(best);
    push(0, { c: "cast", u: m, fx: u.x[s], fy: u.y[s] });
  }
  for (let k = 0; k < CANNON.calibrateTicks + 5; k++) g.step();
  const alive = (ids: number[]) => ids.filter((id) => w.unit(id) >= 0).length;
  const beforeCharge = alive(guard);
  const hpOf = (ids: number[]) => ids.reduce((a, id) => a + (w.unit(id) >= 0 ? u.hp[w.unit(id)] : 0), 0);
  const hpStart = defenders.spear * UNITS[UnitType.Spearman].hp + defenders.ranged * UNITS[UnitType.Ranged].hp;
  const hpBeforeCharge = Math.trunc((hpOf(guard) * 100) / hpStart);
  push(0, { c: "move", u: army.filter((id) => w.unit(id) >= 0), x: tx, y: ty });
  const start = g.tick;
  while (g.tick - start < HOLD_TICKS && alive(guard) > 0 && alive(army) > 0) g.step();
  const dl = alive(guard);
  const al = alive(army);
  return {
    winner: dl === 0 ? 0 : al === 0 ? 1 : -1,
    defenders: guard.length,
    beforeCharge,
    hpBeforeCharge,
    defendersLeft: dl,
    attackers: army.length,
    attackersLeft: al,
    cannonKills: w.cannonKills[0],
    shots: w.cannonShots[0],
    volley,
  };
}

export interface Guarded {
  /** Towers and ranged units on guard, and of those the ones still standing at the end. */
  towers: number;
  ranged: number;
  towersLeft: number;
  rangedLeft: number;
  /** Attackers, and those the guard killed. */
  attackers: number;
  kills: number;
  ticks: number;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * Round 8 rule 6 (D-071): arrow towers against ranged units of the same cost, standing in the same
 * place. Player 1 governs the middle small town and guards its south edge with arrow towers (no one
 * hiding in them) or ranged units on hold, as many as cost the same (towers : ranged = 70 : tower
 * cost, over their greatest common divisor), in a row across the way in; player 0's `attackers`
 * come from 16 cells south and move into the town. Until one side has nothing left, or 2 minutes.
 */
export function guardPoint(towers: boolean, attackers: Army): Guarded {
  const g = new Game({ seed: 1, scenario: "standard", maxTicks: 0 });
  const w = g.w;
  const u = w.units.col;
  const b = w.buildings.col;
  for (let s = 0; s < w.units.count; s++) w.unitSlot[u.id[s]] = -1;
  w.units.count = 0;
  const [s0, s1] = w.map.spawns;
  const far = (x: { cellX: number; cellY: number }) =>
    Math.hypot(x.cellX - s0.cellX, x.cellY - s0.cellY) + Math.hypot(x.cellX - s1.cellX, x.cellY - s1.cellY);
  const t = w.map.towns.indexOf(w.map.towns.filter((x) => x.size === 0).sort((a, c) => far(a) - far(c))[0]);
  w.townOwner[t] = 1;
  w.townState[t] = TownState.Governed;
  const tx = w.map.towns[t].cellX;
  const ty = w.map.towns[t].cellY;
  const info = BUILDINGS[BuildingType.ArrowTower];
  const tc = info.cost.food + info.cost.wood + info.cost.gold + info.cost.crystal;
  const rc = armyCost({ spear: 0, ranged: 1, mage: 0 });
  const d = gcd(tc, rc);
  const nTowers = rc / d;
  const nRanged = tc / d;
  // The row: cells tx - nTowers .. tx + nTowers - 1, ty + 2 .. ty + 3.
  const x0 = tx - nTowers;
  const y0 = ty + 2;
  const ids: number[] = [];
  const blds: number[] = [];
  if (towers) {
    for (let k = 0; k < nTowers; k++) blds.push(w.addBuilding(1, BuildingType.ArrowTower, x0 + 2 * k, y0, info.hp, 1000));
  } else {
    for (let k = 0; k < nRanged; k++) {
      const col = Math.trunc((k * 2 * nTowers) / nRanged);
      const id = w.addUnit(1, UnitType.Ranged, ((x0 + col) << CELL_SHIFT) + 512, ((y0 + (k % 2)) << CELL_SHIFT) + 512, UNITS[UnitType.Ranged].hp);
      u.stance[w.unit(id)] = Stance.Hold;
      ids.push(id);
    }
  }
  const army: number[] = [];
  let k = 0;
  for (const [key, type] of TYPES) {
    for (let i = 0; i < (attackers[key] ?? 0); i++, k++) {
      const id = w.addUnit(0, type, ((tx - 4 + (k % 8)) << CELL_SHIFT) + 512, ((ty + 18 + Math.trunc(k / 8)) << CELL_SHIFT) + 512, UNITS[type].hp);
      if (type === UnitType.Mage) u.flags[w.unit(id)] |= UnitFlag.Autocast;
      army.push(id);
    }
  }
  w.res[Resource.Crystal] = CRYSTAL;
  g.fog.update(w);
  g.push({ c: "move", u: army, x: tx, y: ty, t: g.tick, p: 0, seq: 0 } as never);
  const alive = (list: number[]) => list.filter((id) => w.unit(id) >= 0).length;
  const standing = () => blds.filter((id) => w.building(id) >= 0 && b.progress[w.building(id)] === 1000).length;
  const start = g.tick;
  while (g.tick - start < HOLD_TICKS && alive(army) > 0 && (towers ? standing() : alive(ids)) > 0) g.step();
  return {
    towers: towers ? nTowers : 0,
    ranged: towers ? 0 : nRanged,
    towersLeft: towers ? standing() : 0,
    rangedLeft: towers ? 0 : alive(ids),
    attackers: army.length,
    kills: army.length - alive(army),
    ticks: g.tick - start,
  };
}
