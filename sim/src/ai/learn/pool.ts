// D-086 B training: run jobs on every core with worker threads (worker.ts), results in the jobs' order.

import { cpus } from "node:os";
import { Worker } from "node:worker_threads";
import type { Job, JobResult } from "./worker.ts";

export function threads(): number {
  return Math.max(1, cpus().length);
}

export function runAll(jobs: Job[], n = threads()): Promise<JobResult[]> {
  return new Promise((resolve, reject) => {
    const results: JobResult[] = new Array(jobs.length);
    let next = 0;
    let done = 0;
    if (jobs.length === 0) {
      resolve(results);
      return;
    }
    const workers: Worker[] = [];
    const feed = (wk: Worker) => {
      if (next >= jobs.length) {
        void wk.terminate();
        return;
      }
      const k = next++;
      wk.once("message", (r: JobResult) => {
        results[k] = r;
        done++;
        if (done === jobs.length) {
          for (const x of workers) void x.terminate();
          resolve(results);
        } else feed(wk);
      });
      wk.postMessage(jobs[k]);
    };
    for (let i = 0; i < Math.min(n, jobs.length); i++) {
      const wk = new Worker(new URL("./worker.ts", import.meta.url));
      wk.on("error", reject);
      workers.push(wk);
      feed(wk);
    }
  });
}
