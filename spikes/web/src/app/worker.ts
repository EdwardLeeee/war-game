// Simulation worker. "live" runs a game in real time (20 ticks per second) and posts a
// snapshot after every tick; "determinism" runs whole games as fast as possible and posts
// the hash every HASH_EVERY ticks. The page never touches simulation state.

import { HASH_EVERY, TICKS_PER_SECOND } from "../sim/constants.ts";
import { hex8 } from "../sim/math.ts";
import { createGame, type Game } from "../sim/scenarios.ts";
import { summarize } from "../stats.ts";
import { type FromWorker, STRIDE, type ToWorker } from "./protocol.ts";

const TICK_MS = 1000 / TICKS_PER_SECOND;
let live: Game | null = null;

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(msg, transfer);
}

function snapshot(game: Game, stepMs: number): void {
  const { sim } = game;
  const units = new Int32Array(sim.count * STRIDE);
  for (let i = 0, o = 0; i < sim.count; i++, o += STRIDE) {
    units[o] = sim.id[i];
    units[o + 1] = sim.team[i];
    units[o + 2] = sim.type[i];
    units[o + 3] = sim.x[i];
    units[o + 4] = sim.y[i];
    units[o + 5] = sim.hp[i];
    units[o + 6] = sim.anim[i];
    units[o + 7] = sim.facing[i];
  }
  post({ type: "snapshot", tick: sim.tick, count: sim.count, units, stepMs }, [units.buffer]);
}

function startLive(game: Game): void {
  live = game;
  snapshot(game, 0);
  let next = performance.now() + TICK_MS;
  const loop = (): void => {
    const now = performance.now();
    let steps = 0;
    while (now >= next && steps < 4) {
      const t0 = performance.now();
      game.control?.(game.sim);
      game.sim.step();
      const ms = performance.now() - t0;
      snapshot(game, ms);
      next += TICK_MS;
      steps++;
    }
    // More than a few ticks behind (tab hidden, long stall): drop them instead of racing.
    if (now - next > TICK_MS * 4) next = now + TICK_MS;
    setTimeout(loop, Math.max(0, next - performance.now()));
  };
  setTimeout(loop, TICK_MS);
}

function runDeterminism(games: ToWorker & { type: "determinism" }): void {
  for (const mode of games.games) {
    const game = createGame(mode);
    const { sim } = game;
    const tickMs: number[] = [];
    post({ type: "hash", game: mode, tick: 0, hash: hex8(sim.hash()), count: sim.count });
    const start = performance.now();
    while (sim.tick < games.ticks && !game.done(sim)) {
      const t0 = performance.now();
      game.control?.(sim);
      sim.step();
      tickMs.push(performance.now() - t0);
      if (sim.tick % HASH_EVERY === 0) post({ type: "hash", game: mode, tick: sim.tick, hash: hex8(sim.hash()), count: sim.count });
    }
    if (sim.tick % HASH_EVERY !== 0) post({ type: "hash", game: mode, tick: sim.tick, hash: hex8(sim.hash()), count: sim.count });
    const s = summarize(tickMs);
    post({
      type: "game-done",
      game: mode,
      ticks: sim.tick,
      totalMs: performance.now() - start,
      finalHash: hex8(sim.hash()),
      tickMedianMs: s.median,
      tickMaxMs: s.max,
    });
  }
  post({ type: "determinism-done" });
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  if (msg.type === "live") {
    startLive(createGame(msg.mode));
  } else if (msg.type === "command") {
    if (live === null) return;
    const t = live.sim.tick;
    const cmd = msg.cmd;
    if (cmd.c === "move") live.sim.push({ t, p: 0, c: "move", u: cmd.u, x: cmd.x, y: cmd.y });
    else if (cmd.c === "attack") live.sim.push({ t, p: 0, c: "attack", u: cmd.u, target: cmd.target });
    else live.sim.push({ t, p: 0, c: "stop", u: cmd.u });
  } else if (msg.type === "determinism") {
    runDeterminism(msg);
  }
};
