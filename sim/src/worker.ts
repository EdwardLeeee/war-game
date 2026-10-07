// The simulation's Web Worker (PROTOCOL.md section 6). The screen talks to it only through
// messages. It runs the game in real time at `tps` ticks per wall-clock second, sends a
// snapshot after every tick (typed arrays transferred), a hash every HASH_EVERY ticks, and
// stops at game over. Pause stops the ticking; commands keep arriving and are stamped with
// the next tick not yet run. A "determinism" request runs a whole AI-vs-AI game as fast as
// possible instead (use a separate Worker for it).

import { rules } from "./core/rules.ts";
import { UNIT_KINDS } from "./core/world.ts";
import { hex8 } from "./core/fixed.ts";
import {
  AI_DIFFICULTIES,
  COMMAND_KINDS,
  type FromWorker,
  type GameStats,
  MAP_MODES,
  MAX_TICKS,
  PLAYER_COUNT,
  PROTOCOL_VERSION,
  Resource,
  STEP_BATCH,
  type ScenarioName,
  type ToWorker,
  UnitType,
} from "./protocol.ts";
import { Runner } from "./runner.ts";
import { buildView, mapInfo, SnapshotEncoder, transferables } from "./view/view.ts";

const scope = self as unknown as {
  postMessage(msg: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};

let runner: Runner | null = null;
let human: number | null = null;
let aiFlags: boolean[] = [];
let seed = 0;
let scenario: ScenarioName = "standard";
let encoder: SnapshotEncoder | null = null;
let tps = 20;
let paused = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let nextAt = 0;
const recent: number[] = [];

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  scope.postMessage(msg, transfer);
}

function now(): number {
  return performance.now();
}

function sendSnapshot(stepMicros: number): void {
  if (runner === null || encoder === null) return;
  const g = runner.game;
  const batch = recent.reduce((a, b) => a + b, 0);
  const view = buildView(g, human, { paused, tps, stepMicros, stepBatchMicros: batch });
  const events = g.events.filter((e) => e.to === -1 || human === null || e.to === human).map((e) => e.ev);
  const snap = encoder.encode(view, events);
  post(snap, transferables(snap));
}

/** End-of-game statistics. unitsTrained / unitsLost are by UnitType: farmer, spearman, ranged, mage. */
function stats(): GameStats {
  const w = runner!.game.w;
  return {
    ticks: w.tick,
    winner: w.winner,
    reason: w.endReason as GameStats["reason"],
    perPlayer: Array.from({ length: PLAYER_COUNT }, (_, p) => ({
      gathered: {
        food: w.gathered[p * 4 + Resource.Food],
        wood: w.gathered[p * 4 + Resource.Wood],
        gold: w.gathered[p * 4 + Resource.Gold],
        crystal: w.gathered[p * 4 + Resource.Crystal],
      },
      unitsTrained: Array.from(w.trained.subarray(p * UNIT_KINDS, p * UNIT_KINDS + 4)),
      unitsLost: Array.from(w.lost.subarray(p * UNIT_KINDS, p * UNIT_KINDS + 4)),
      magesTrained: w.trained[p * UNIT_KINDS + UnitType.Mage],
      magesLost: w.lost[p * UNIT_KINDS + UnitType.Mage],
      cavalryTrained: w.trained[p * UNIT_KINDS + UnitType.Cavalry],
      cavalryLost: w.lost[p * UNIT_KINDS + UnitType.Cavalry],
      townsPlundered: w.plundered[p],
      townsGoverned: w.governed[p],
    })),
  };
}

function loop(): void {
  timer = null;
  if (runner === null || paused) return;
  const t = now();
  let steps = 0;
  while (t >= nextAt && steps < 4 && !runner.over) {
    const micros = runner.tick(now);
    recent.push(micros);
    if (recent.length > STEP_BATCH) recent.shift();
    sendSnapshot(micros);
    const g = runner.game;
    if (g.shouldHash()) post({ type: "hash", tick: g.tick, hash: hex8(g.hash()) });
    nextAt += 1000 / tps;
    steps++;
  }
  if (runner.over) {
    const w = runner.game.w;
    post({ type: "game_over", winner: w.winner, reason: w.endReason as GameStats["reason"], stats: stats() });
    return;
  }
  // Far behind (tab hidden, long stall): skip ahead instead of racing to catch up.
  if (now() - nextAt > 4000 / tps) nextAt = now() + 1000 / tps;
  schedule();
}

function schedule(): void {
  if (timer !== null || runner === null || paused || runner.over) return;
  timer = setTimeout(loop, Math.max(0, nextAt - now()));
}

function stop(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function determinism(msg: Extract<ToWorker, { type: "determinism" }>): void {
  const r = new Runner({ seed: msg.seed, scenario: msg.scenario, ai: [true, true], maxTicks: msg.maxTicks, map: msg.map });
  const times: number[] = [];
  const start = now();
  post({ type: "determinism_progress", tick: 0, hash: hex8(r.game.hash()) });
  while (!r.over && r.game.tick < msg.maxTicks) {
    times.push(r.tick(now) / 1000);
    if (r.game.shouldHash()) post({ type: "determinism_progress", tick: r.game.tick, hash: hex8(r.game.hash()) });
  }
  times.sort((a, b) => a - b);
  post({
    type: "determinism_done",
    ticks: r.game.tick,
    finalHash: hex8(r.game.hash()),
    totalMs: now() - start,
    tickMedianMs: times.length === 0 ? 0 : times[Math.ceil(times.length / 2) - 1],
    tickMaxMs: times.length === 0 ? 0 : times[times.length - 1],
  });
}

scope.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "init": {
        if (msg.protocol !== PROTOCOL_VERSION) throw new Error(`protocol ${msg.protocol}, worker speaks ${PROTOCOL_VERSION}`);
        stop();
        human = msg.human;
        aiFlags = msg.ai;
        seed = msg.seed;
        scenario = msg.scenario;
        tps = msg.tps;
        paused = false;
        recent.length = 0;
        // No time limit by default when a person plays (D-024); AI against AI keeps MAX_TICKS.
        const maxTicks = msg.maxTicks ?? (human === null ? MAX_TICKS : 0);
        if (!Number.isInteger(maxTicks) || maxTicks < 0) throw new Error(`bad maxTicks ${msg.maxTicks}`);
        const difficulty = msg.difficulty ?? [];
        if (!difficulty.every((d) => (AI_DIFFICULTIES as readonly string[]).includes(d))) throw new Error(`bad difficulty ${msg.difficulty}`);
        const map = msg.map ?? "fixed";
        if (!(MAP_MODES as readonly string[]).includes(map)) throw new Error(`bad map ${msg.map}`);
        // The AI knows the whole random map until it can scout (runner.ts), so no person plays one yet (D-074).
        if (map === "random" && human !== null) throw new Error("random maps are AI against AI only until the AI scouts (D-074)");
        // A person's barracks, ranges and mage halls train on their own; an AI's do not (round 6, D-054).
        runner = new Runner({ seed, scenario, ai: aiFlags, maxTicks, difficulty, autoTrain: aiFlags.map((a) => !a), map });
        encoder = new SnapshotEncoder(runner.game.w.nodeAmount.length);
        post({ type: "ready", protocol: PROTOCOL_VERSION, player: human, map: mapInfo(runner.game.w.map, human), rules: rules() });
        sendSnapshot(0);
        nextAt = now() + 1000 / tps;
        schedule();
        break;
      }
      case "command": {
        if (runner === null || human === null) return;
        if (!(COMMAND_KINDS as readonly string[]).includes(msg.cmd.c)) throw new Error(`unknown command ${msg.cmd.c}`);
        runner.command(human, msg.cmd);
        break;
      }
      case "pause":
        paused = true;
        stop();
        sendSnapshot(0);
        break;
      case "resume":
        if (!paused) break;
        paused = false;
        nextAt = now() + 1000 / tps;
        schedule();
        break;
      case "speed":
        if (!(msg.tps > 0 && msg.tps <= 1000)) throw new Error(`bad tps ${msg.tps}`);
        tps = msg.tps;
        break;
      case "determinism":
        if (msg.protocol !== PROTOCOL_VERSION) throw new Error(`protocol ${msg.protocol}, worker speaks ${PROTOCOL_VERSION}`);
        determinism(msg);
        break;
      case "export_log": {
        if (runner === null) return;
        const lines = [JSON.stringify(runner.header(aiFlags)), ...runner.game.log.map((c) => JSON.stringify(c))];
        post({ type: "log", jsonl: lines.join("\n") + "\n" });
        break;
      }
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};

