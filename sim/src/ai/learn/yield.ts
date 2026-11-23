// D-123 (ceo 2026-11-16, 2026-11-18): the training gives way. Every YIELD_EVERY it looks at the repository's other
// workflow runs; the site's deployment waiting (Pages on a push to main), or any other job waiting YIELD_WAIT or longer,
// and it stops (the caller saves what it has); the GitHub API failing twice running, too. Shared by exam.ts and
// exam-auto.ts. Never imported by the simulation Worker.
//
// Runs are told apart by their workflow file, not by name: in the API a run's `name` is its run-name (2026-11-21: the
// dispatcher's runs are named "AI train: dispatch").

import { execFileSync } from "node:child_process";

export const YIELD_EVERY = 6 * 60_000;
export const YIELD_WAIT = 10 * 60_000;
/** The training's own workflows: never given way to. */
const OWN = [".github/workflows/ai-train.yml", ".github/workflows/ai-scratch.yml", ".github/workflows/ai-train-wait.yml"];

const ghJson = (path: string, jq: string): unknown => JSON.parse(execFileSync("gh", ["api", path, "--jq", jq], { encoding: "utf8", timeout: 60_000 }) || "null");

export class GiveWay {
  /** Why it gave way ("": not yet). */
  why = "";
  private lastLook = 0;
  private apiErrors = 0;

  /** owner/name, "" outside CI (never gives way). */
  private readonly repo: string;

  constructor(repo = process.env.YIELD_REPO ?? "") {
    this.repo = repo;
  }

  /** Whether to stop now: at most one look every YIELD_EVERY; once it says yes it keeps saying yes. */
  now(): boolean {
    if (this.repo === "" || this.why !== "") return this.why !== "";
    const now = Date.now();
    if (now - this.lastLook < YIELD_EVERY) return false;
    this.lastLook = now;
    try {
      const old = (t: string) => now - Date.parse(t) >= YIELD_WAIT;
      type Run = { id: number; name: string; path: string; created: string; event: string; branch: string };
      const own = JSON.stringify(OWN);
      const runs = (status: string) =>
        ghJson(`repos/${this.repo}/actions/runs?status=${status}&per_page=50`, `[.workflow_runs[] | select((.path as $p | ${own} | index($p)) | not) | {id, name, path, created: .created_at, event, branch: .head_branch}]`) as Run[];
      // The site's deployment (Pages on a push to main), not a pull request's build of it.
      const deploys = (r: Run) => r.path === ".github/workflows/pages.yml" && r.event === "push" && r.branch === "main";
      // Judged by the jobs, not the run's status (2026-11-21: a Client run stayed "queued" 12 minutes while all its jobs
      // ran, and a segment gave way for nothing); a run queued with no jobs yet counts from its creation. The same rule
      // as .github/ai-train/giveway.py.
      for (const status of ["queued", "in_progress"]) {
        for (const r of runs(status)) {
          const jobs = ghJson(`repos/${this.repo}/actions/runs/${r.id}/jobs?filter=latest&per_page=100`, `[.jobs[] | {status, created: .created_at}]`) as { status: string; created: string }[];
          const since = jobs.filter((j) => ["queued", "waiting", "pending"].includes(j.status)).map((j) => j.created);
          if (jobs.length === 0 && status === "queued") since.push(r.created);
          if (since.some((t) => deploys(r) || old(t))) {
            this.why = `${r.name} 有 job 在等（run ${r.id}）`;
            return true;
          }
        }
      }
      this.apiErrors = 0;
    } catch {
      // Twice in a row: give way rather than hold runners blind.
      if (++this.apiErrors >= 2) {
        this.why = "GitHub API 連續兩次出錯";
        return true;
      }
    }
    return false;
  }
}
