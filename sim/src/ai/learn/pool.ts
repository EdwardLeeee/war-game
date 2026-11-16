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

/** runAll for play and record jobs (D-086 B): their outcomes are GameOutcome; a scripted job here is a mistake. */
export async function runPlays(jobs: Job[], n = threads()): Promise<Exclude<JobResult, { kind: "scripted" }>[]> {
  const res = await runAll(jobs, n);
  return res.map((r) => {
    if (r.kind === "scripted") throw new Error("runPlays: a scripted job (exam.ts plays those with runAll)");
    return r;
  });
}

/**
 * D-147 (exam.ts): workers kept for many runs. A worker started and stopped for every few games (#514's chunks, run
 * 43762744582's job 4) crashed V8 after some thousand of them ("jit_page_->allocations_.erase"), so these live as long as
 * the pool; `stop`, asked before each job is handed out, ends a run early (those under way finish, results kept).
 */
export class Pool {
  private readonly workers: Worker[] = [];
  private failed: Error | null = null;
  constructor(n = threads()) {
    for (let i = 0; i < n; i++) {
      const wk = new Worker(new URL("./worker.ts", import.meta.url));
      wk.on("error", (e: unknown) => (this.failed = e instanceof Error ? e : new Error(String(e))));
      this.workers.push(wk);
    }
  }
  run(jobs: Job[], stop: () => boolean = () => false): Promise<{ results: (JobResult | undefined)[]; stopped: boolean }> {
    return new Promise((resolve, reject) => {
      const results: (JobResult | undefined)[] = new Array(jobs.length);
      let next = 0;
      let busy = 0;
      let stopped = false;
      const finish = () => {
        if (busy === 0 && (stopped || next >= jobs.length)) resolve({ results, stopped });
      };
      const feed = (wk: Worker) => {
        if (this.failed !== null) return reject(this.failed);
        if (next >= jobs.length) return finish();
        if (!stopped && stop()) stopped = true;
        if (stopped) return finish();
        const k = next++;
        busy++;
        wk.once("message", (r: JobResult) => {
          results[k] = r;
          busy--;
          feed(wk);
        });
        wk.postMessage(jobs[k]);
      };
      if (jobs.length === 0) return resolve({ results, stopped: false });
      for (const wk of this.workers) feed(wk);
    });
  }
  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}
