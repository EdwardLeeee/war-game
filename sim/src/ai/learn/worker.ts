// D-086 B training: one job in a worker thread (pool.ts): a game to score, or a game to record hard's choices in.

import { parentPort } from "node:worker_threads";
import type { HardPlan } from "../ai.ts";
import type { NetWeights } from "../net.ts";
import { type GameOutcome, type GameSpec, type Opponent, playGame } from "./play.ts";
import type { Plan } from "../scripted-player.ts";
import type { MapMode } from "../../protocol.ts";
import { playScripted } from "../../scripted-play.ts";
import { SCRIPTED_THINK_EVERY } from "../scripted-player.ts";

/** D-147 (exam.ts): what a scripted game against hard tells the search (player 0 the scripted player, 1 hard). */
export interface ScriptedOutcome {
  seed: number;
  /** The scripted player's result: "won" (it beat hard), "lost", "open" (still going at the cap). */
  result: "won" | "lost" | "open";
  endTick: number;
  finalHash: string;
  /** Hard's main city first hit by the player (-1: never), and its hp at the end. */
  hitAi: number;
  aiCityHp: number;
  /** The player's first march on hard's main city (-1: never); its outposts and arrow towers finished; cavalry raids. */
  firstMarch: number;
  outposts: number;
  towers: number;
  raids: number;
}

/** A game with the trained side's net (null: hard's own rules), or a game whose hard sides log their choices. */
export type Job =
  | { kind: "play"; spec: Omit<GameSpec, "me">; net: NetWeights | null; plan?: Partial<HardPlan> }
  | { kind: "scripted"; seed: number; plan: Plan; map: MapMode; cap: number; hard?: Partial<HardPlan> }
  | { kind: "record"; spec: Omit<GameSpec, "me" | "opp">; opp: Opponent; every: number };
export type JobResult = { kind: "play"; outcome: GameOutcome } | { kind: "record"; outcome: GameOutcome; samples: number[][] } | { kind: "scripted"; outcome: ScriptedOutcome };

parentPort?.on("message", (job: Job) => {
  if (job.kind === "scripted") {
    const g = playScripted({ seed: job.seed, plan: job.plan, difficulty: "hard", map: job.map, style: "", think: SCRIPTED_THINK_EVERY, cap: job.cap, trace: false, takeover: 0, bonus: 0, probe: "", probeFrom: 0, hard: job.hard });
    const outcome: ScriptedOutcome = {
      seed: job.seed,
      result: g.result,
      endTick: g.endTick,
      finalHash: g.finalHash,
      hitAi: g.cityFirstHit[1],
      aiCityHp: g.cityHp[1],
      firstMarch: g.firstMarch,
      outposts: g.forts.outposts,
      towers: g.forts.towers,
      raids: g.raids,
    };
    parentPort!.postMessage({ kind: "scripted", outcome } satisfies JobResult);
    return;
  }
  if (job.kind === "play") {
    const outcome = playGame({ ...job.spec, me: { ...job.plan, net: job.net } });
    parentPort!.postMessage({ kind: "play", outcome } satisfies JobResult);
    return;
  }
  // Each hard side's inputs and its own choices (-1: none at that think): every think where it goes for a town
  // or marches, puts barracks and ranges first, or chooses for a town it took (each happens at one think, and
  // rarely), and every `every`-th of the others.
  const samples: number[][] = [];
  const logger = () => {
    let k = 0;
    return (x: number[], labels: number[]) => {
      const rare = labels[0] > 0 || labels[2] === 2 || labels[3] >= 0;
      if (rare || k % job.every === 0) samples.push([...x, ...labels]);
      k++;
    };
  };
  const opp: Opponent = job.opp.kind === "hard" ? { kind: "hard", plan: { ...job.opp.plan, netLog: logger() } } : job.opp;
  const outcome = playGame({ ...job.spec, opp, me: { netLog: logger() } });
  parentPort!.postMessage({ kind: "record", outcome, samples } satisfies JobResult);
});
