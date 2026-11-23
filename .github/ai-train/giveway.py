#!/usr/bin/env python3
"""D-123 (A2): whether a training segment should give way now. Prints why (one line) and exits 0, or prints nothing.

Gives way when another workflow's job waits for a runner: the site's deployment (Pages on a push to main) at all, any
other job YIELD_WAIT or longer; a run still queued with no jobs yet counts from the run's creation. Judged by the jobs, not
the run's status: 2026-11-21, a Client run stayed "queued" for 12 minutes while all its jobs ran (none waiting), and
judged by the run the segment gave way for nothing. The API failing gives way too (better than holding runners blind).

  python3 .github/ai-train/giveway.py      (GH_TOKEN, GITHUB_REPOSITORY)
"""

import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dispatch import OWN, Api, when  # noqa: E402

YIELD_WAIT = 600  # seconds


def why(api, repo, now):
    for status in ("queued", "in_progress"):
        for r in api.every(f"repos/{repo}/actions/runs?status={status}&per_page=100", "workflow_runs"):
            if r.get("path") in OWN:
                continue
            deploy = r.get("path") == ".github/workflows/pages.yml" and r.get("event") == "push" and r.get("head_branch") == "main"
            jobs = api.every(f"repos/{repo}/actions/runs/{r['id']}/jobs?per_page=100", "jobs")
            since = [j["created_at"] for j in jobs if j.get("status") in ("queued", "waiting", "pending")]
            if not jobs and r.get("status") == "queued":
                since = [r["created_at"]]
            for t in since:
                waited = (now - when(t)).total_seconds()
                if deploy or waited >= YIELD_WAIT:
                    return f"{r.get('name')} 有 job 在等 {waited / 60:.0f} 分鐘（run {r['id']}）"
    return ""


def main():
    try:
        print(why(Api(os.environ["GH_TOKEN"]), os.environ["GITHUB_REPOSITORY"], dt.datetime.now(dt.timezone.utc)))
    except Exception as e:
        print(f"GitHub API 出錯（{type(e).__name__}）")


if __name__ == "__main__":
    main()
