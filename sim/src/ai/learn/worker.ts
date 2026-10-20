// D-086 B training: one job in a worker thread (pool.ts): a game to score, or a game to record hard's choices in.

import { parentPort } from "node:worker_threads";
import type { HardPlan } from "../ai.ts";
import type { NetWeights } from "../net.ts";
import { type GameOutcome, type GameSpec, type Opponent, playGame } from "./play.ts";

/** A game with the trained side's net (null: hard's own rules), or a game whose hard sides log their choices. */
export type Job =
  | { kind: "play"; spec: Omit<GameSpec, "me">; net: NetWeights | null; plan?: Partial<HardPlan> }
  | { kind: "record"; spec: Omit<GameSpec, "me" | "opp">; opp: Opponent; every: number };
export type JobResult = { kind: "play"; outcome: GameOutcome } | { kind: "record"; outcome: GameOutcome; samples: number[][] };

parentPort?.on("message", (job: Job) => {
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
