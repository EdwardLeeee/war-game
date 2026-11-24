#!/usr/bin/env python3
"""D-147 PR B: the run holding the latest trusted exam state (artifact NAME), for the auto mode's jobs. Prints its run id,
or nothing when there is none (then the jobs start the state from the config). An API error exits 1: the jobs fail, and
the training is never started again from nothing because GitHub did not answer.

Trusted: an artifact NAME of this repository's ai-train.yml on this ref, not expired, uploaded by that run's merge job
after the job started, the job having succeeded (latest attempt). The merge job needs the training jobs, so they had all
ended by then: a training job cannot leave a state.

  python3 .github/ai-train/state.py NAME      (GH_TOKEN, GITHUB_REPOSITORY, GITHUB_REPOSITORY_ID, GITHUB_REF_NAME)
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dispatch import WORKFLOW, Api, when  # noqa: E402


def latest(api, repo, repo_id, ref, name):
    arts = api.get(f"repos/{repo}/actions/artifacts?name={name}&per_page=100")
    for a in sorted(arts["artifacts"], key=lambda a: a["created_at"], reverse=True):
        wr = a.get("workflow_run") or {}
        if a.get("expired") or wr.get("repository_id") != repo_id or wr.get("head_repository_id") != repo_id or wr.get("head_branch") != ref:
            continue
        r = api.get(f"repos/{repo}/actions/runs/{wr['id']}")
        if r.get("path") != WORKFLOW:
            continue
        jobs = api.get(f"repos/{repo}/actions/runs/{wr['id']}/jobs?filter=latest&per_page=100")["jobs"]
        merge = [j for j in jobs if j.get("name") == "merge" and j.get("conclusion") == "success" and j.get("started_at")]
        if merge and when(a["created_at"]) >= when(merge[0]["started_at"]):
            return wr["id"]
    return None


def main():
    try:
        rid = latest(Api(os.environ["GH_TOKEN"]), os.environ["GITHUB_REPOSITORY"], int(os.environ["GITHUB_REPOSITORY_ID"]), os.environ["GITHUB_REF_NAME"], sys.argv[1])
    except Exception as e:
        print(f"讀不到考試狀態（{type(e).__name__}: {e}）", file=sys.stderr)
        sys.exit(1)
    print(rid or "")


if __name__ == "__main__":
    main()
