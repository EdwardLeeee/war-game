// The three ways a game is driven. Every controller only issues commands through
// Sim.push, the same interface a player uses, so a replay of Sim.log needs no controller.
//
// - scripted: battle spawns, no reinforcements; fixed commands; ends when one team is left
//   or at MAX_TICKS. Used to compare hashes across environments.
// - ai: corner spawns, reinforcements; each team runs the same simple rule. Used for the
//   headless speed test.
// - measure: battle spawns, reinforcements; every team keeps marching on the centre. Used
//   for the on-screen fps / tick-time measurement.

import {
  AI_THINK_EVERY,
  CENTER,
  MAP_SEED,
  REINFORCE_EVERY,
  SPAWN_BATTLE,
  SPAWN_CORNER,
  TEAM_COUNT,
  TYPE_FAST,
  TYPE_RANGED,
} from "./constants.ts";
import { type GameMap, generateMap } from "./map.ts";
import { type Command, Sim } from "./sim.ts";

export type Mode = "scripted" | "ai" | "measure";
export const MODES: Mode[] = ["scripted", "ai", "measure"];

export interface Game {
  sim: Sim;
  /** Issues this tick's commands; call before sim.step(). Null in a replay. */
  control: ((sim: Sim) => void) | null;
  /** True when the game is over (only the scripted game ends early). */
  done: (sim: Sim) => boolean;
}

let cachedMap: GameMap | null = null;
export function sharedMap(): GameMap {
  if (cachedMap === null) cachedMap = generateMap(MAP_SEED);
  return cachedMap;
}

export function createGame(mode: Mode, replay: Command[] | null = null): Game {
  const map = sharedMap();
  const battle = mode !== "ai";
  const sim = new Sim(map, { spawns: battle ? SPAWN_BATTLE : SPAWN_CORNER, reinforce: mode !== "scripted" });
  let control: ((s: Sim) => void) | null = null;
  if (replay !== null) {
    for (const cmd of replay) sim.push(cmd);
  } else if (mode === "scripted") {
    control = scriptedControl;
  } else if (mode === "ai") {
    control = aiControl;
  } else {
    control = measureControl;
  }
  const done = mode === "scripted" ? oneTeamLeft : () => false;
  return { sim, control, done };
}

function oneTeamLeft(sim: Sim): boolean {
  return sim.aliveByTeam().filter((n) => n > 0).length <= 1;
}

function moveAll(sim: Sim, team: number, x: number, y: number, type = -1): void {
  const u = sim.unitsOf(team, type);
  if (u.length > 0) sim.push({ t: sim.tick, p: team, c: "move", u, x, y });
}

function scriptedControl(sim: Sim): void {
  const t = sim.tick;
  if (t % 1000 === 0) {
    for (let team = 0; team < TEAM_COUNT; team++) moveAll(sim, team, CENTER, CENTER);
  }
  if (t === 300) moveAll(sim, 0, CENTER - 28, CENTER, TYPE_RANGED);
  if (t === 400) moveAll(sim, 1, CENTER + 32, CENTER - 28, TYPE_FAST);
  if (t === 600) {
    const u = sim.unitsOf(2);
    if (u.length > 0) sim.push({ t, p: 2, c: "stop", u });
  }
  if (t === 800) {
    const u = sim.unitsOf(3);
    const victims = sim.unitsOf(0);
    if (u.length > 0 && victims.length > 0) sim.push({ t, p: 3, c: "attack", u, target: victims[0] });
  }
}

/**
 * Same rule for every team, using only map knowledge (spawn positions), not enemy
 * positions: every AI_THINK_EVERY ticks (staggered by team) send the whole army to one
 * enemy spawn, cycling through the enemies from nearest to farthest.
 */
function aiControl(sim: Sim): void {
  for (let team = 0; team < TEAM_COUNT; team++) {
    if (sim.tick % AI_THINK_EVERY !== 10 + 50 * team) continue;
    const [ox, oy] = sim.spawns[team];
    const enemies: number[] = [];
    for (let e = 0; e < TEAM_COUNT; e++) if (e !== team) enemies.push(e);
    enemies.sort((a, b) => {
      const da = dist2(sim.spawns[a], ox, oy);
      const db = dist2(sim.spawns[b], ox, oy);
      return da !== db ? da - db : a - b;
    });
    const pick = enemies[(Math.trunc(sim.tick / AI_THINK_EVERY) + team) % enemies.length];
    const [tx, ty] = sim.spawns[pick];
    moveAll(sim, team, tx, ty);
  }
}

function dist2(p: number[], x: number, y: number): number {
  return (p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y);
}

/**
 * Send every team to the centre one tick after each reinforcement wave, so the new units
 * (added during the wave's tick, after that tick's commands) march too.
 */
function measureControl(sim: Sim): void {
  if (sim.tick % REINFORCE_EVERY !== 1) return;
  for (let team = 0; team < TEAM_COUNT; team++) moveAll(sim, team, CENTER, CENTER);
}

export interface HashPoint {
  tick: number;
  hash: number;
  count: number;
}

/**
 * Run a game to `maxTicks` (or until it ends), recording the hash every HASH_EVERY ticks
 * including tick 0. `onTick` receives the step time in ms when a clock is given.
 */
export function runGame(
  game: Game,
  maxTicks: number,
  clock: (() => number) | null = null,
  onTick: ((ms: number) => void) | null = null,
): HashPoint[] {
  const { sim } = game;
  const points: HashPoint[] = [{ tick: sim.tick, hash: sim.hash(), count: sim.count }];
  while (sim.tick < maxTicks && !game.done(sim)) {
    const t0 = clock === null ? 0 : clock();
    if (game.control !== null) game.control(sim);
    sim.step();
    if (clock !== null && onTick !== null) onTick(clock() - t0);
    if (sim.shouldHash()) points.push({ tick: sim.tick, hash: sim.hash(), count: sim.count });
  }
  if (!sim.shouldHash()) points.push({ tick: sim.tick, hash: sim.hash(), count: sim.count });
  return points;
}
