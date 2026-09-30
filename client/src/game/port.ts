// The simulation behind a Worker-shaped port: core's worker (sim/src/worker.ts), or the fake
// world in mock/ for the gesture tests (?test=1&mock=1).

import type { FromWorker, ToWorker } from "../sim.ts";

export interface SimPort {
  postMessage(msg: ToWorker): void;
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null;
  terminate(): void;
}

/** A new simulation Worker. Each game and each determinism check gets its own. */
export function createSimPort(onFail: (message: string) => void): SimPort {
  const worker = new Worker(new URL("../../../sim/src/worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("error", (e) => onFail(`模擬沒有啟動：${e.message || "Worker 載入失敗"}`));
  return worker;
}
