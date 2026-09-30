// The simulation behind a Worker-shaped port: a real `new Worker(sim/src/worker.ts)` once
// core's worker lands, the fake world in mock/ until then (and for gesture tests after).

import type { FromWorker, ToWorker } from "../sim.ts";

export interface SimPort {
  postMessage(msg: ToWorker): void;
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null;
  terminate(): void;
}
