#!/usr/bin/env python3
"""D-147: the training chain's dispatcher (war-game-ai; ceo 2026-11-21: D-158, and its amendment for the chain).

Run by the dispatch job of .github/workflows/ai-train.yml in two roles:
  dispatcher  the schedule (every 30 minutes; GitHub may start it late or not at all) or a hand dispatch, mode=dispatch;
  tail        the end of a segment that the dispatcher started (the job's `if` allows only that: the run started by
              github-actions[bot], first attempt, on main, AI_TRAIN on, the training jobs all succeeded, not cancelled).
Either starts at most one segment (`gh workflow run` through the API) or writes why not in the step summary. Nothing here
reads a training job's output or artifact: only the switch, the API's facts about runs and jobs (status, conclusion,
times, step names), the ledger the dispatch job itself keeps, and the run's own inputs (only lower caps).

It starts nothing unless all of these hold:
  - AI_TRAIN is "on";
  - the time is past CHAIN_START (a trial's --chain-start can only move it earlier, so more segments are judged);
  - the runner hours stay within DAY_CAP (Taipei's date) and TOTAL_CAP, counting every AI train run since LEDGER_START;
  - at most MAX_SEGMENTS_PER_DAY segments started today (Taipei), counted from the API;
  - the chain is not paused (below);
  - no other AI train run is running or waiting in any of ACTIVE (only this run itself is left out), no job of another
    workflow waits (D-123), and at least RESERVE of the RUNNERS stay free;
  - the last dispatch was seen as a run, or is more than UNSEEN_HOLD old;
  - on the tail: this segment itself trained properly ("ok" below).
Anything it cannot work out (the API failing, a list coming back short) starts nothing.

Segments are AI train runs started by github-actions[bot] (only the dispatcher starts them), judged by their first attempt
(a re-run cannot clear a cancel), in order:
  stop    the run or any of its jobs cancelled or timed_out              -> pause at once
  bad     a conclusion other than success or skipped, a job failed, no training job finished,
  short   or every training job done but the shortest under MIN_SEGMENT_MINUTES with no yield
                                                                         -> BAD_IN_A_ROW in a row: pause
  yield   shorter than MIN_SEGMENT_MINUTES and a training job ran the step YIELD_STEP (it gave way, D-123): not chained,
          not counted as bad                                             -> YIELDS_IN_A_ROW in a row: pause (a broken
                                                                            give-way rule that always yields at once)
  ok      every training job at least MIN_SEGMENT_MINUTES                -> both counts back to 0
  none    the whole run skipped                                          -> nothing
A pause is named after the segment that caused it: P-<run id>. It holds until the repository variable AI_TRAIN_RESUME is
set to exactly that name (the user decides; the ceo tells war-game-ai), which resumes that pause only: the dispatcher
then keeps it in the ledger's `resumed`, so a later AI_TRAIN_RESUME for another pause does not bring it back. If the
ledger is lost, a pause resumed before comes back once (it asks again rather than forget).
"""

import datetime as dt
import json
import os
import re
import subprocess
import time
import urllib.request

WORKFLOW, SCRATCH = ".github/workflows/ai-train.yml", ".github/workflows/ai-scratch.yml"
BOT = "github-actions[bot]"
SEGMENT_MODE = "chaintest"  # the mode a segment runs (PR B: the exams)
# The caps (D-147, ceo 2026-11-21): written here; AI_TRAIN and a trial's options can only lower them.
DAY_CAP, TOTAL_CAP = 200.0, 5000.0
# The ledger counts AI train runs created from this time on (trial segments too; not the examiner search before it).
LEDGER_START = "2026-11-21T00:00:00Z"
# Segments are judged from this time on, and nothing is dispatched before it (without a trial's --chain-start): after
# PR A's trial (its cancelled segment, run 44841753532, 00:08Z) and after A2's trial (its segments made to fail, yield
# and run short), so neither pauses the training.
CHAIN_START = "2026-11-22T00:00:00Z"
SEGMENT_HOURS, SEGMENT_JOBS = 1.0, 1
MAX_SEGMENTS_PER_DAY = 48  # what the 30-minute schedule allowed
MIN_SEGMENT_MINUTES = 10
BAD_IN_A_ROW, YIELDS_IN_A_ROW = 3, 6
SEE_WAIT, UNSEEN_HOLD = 180, 15 * 60  # seconds: waiting to see the new run; holding off after one not seen
DISPATCH_HOURS = 0.01  # a dispatcher run books itself this (about half a minute); the tail is booked with its segment
RUNNERS, RESERVE = 20, 4  # D-123
YIELD_STEP = "讓位"
STOP = ("cancelled", "timed_out")
ACTIVE = ("in_progress", "queued", "pending", "waiting", "requested")
LEDGER_VERSION = 2
TPE = dt.timezone(dt.timedelta(hours=8))


def when(t):
    return dt.datetime.fromisoformat(t.replace("Z", "+00:00"))


def iso(d):
    return d.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def day_of(t):
    return when(t).astimezone(TPE).date().isoformat()


def minutes(job):
    s, e = job.get("started_at"), job.get("completed_at")
    return 0.0 if not s or not e else max(0.0, (when(e) - when(s)).total_seconds() / 60)


def options(args):
    """A trial's options from `args`: caps only lower, the chain's start only earlier; and what to pass on to the
    segment it starts (written out again from the values, never the text as given)."""

    def num(name, cap):
        try:
            return min(cap, float(args[args.index(f"--{name}") + 1]))
        except (ValueError, IndexError):
            return cap

    o = {
        "day_cap": num("day-cap", DAY_CAP),
        "total_cap": num("total-cap", TOTAL_CAP),
        "segment_hours": num("segment-hours", SEGMENT_HOURS),
        "day_segments": int(num("day-segments", MAX_SEGMENTS_PER_DAY)),
        "chain_start": CHAIN_START,
        "api_fail": "--api-fail" in args,
        # Only for the segment (the trial's chaintest): fail, run short, or give way at once.
        "flags": [f for f in ("--fail", "--short", "--yield") if f in args],
    }
    try:
        v = when(args[args.index("--chain-start") + 1])
        if when(LEDGER_START) <= v < when(CHAIN_START):
            o["chain_start"] = iso(v)
    except (ValueError, IndexError):
        pass
    carry = [f"--{n} {o[k]:g}" for n, k, cap in (("day-cap", "day_cap", DAY_CAP), ("total-cap", "total_cap", TOTAL_CAP), ("segment-hours", "segment_hours", SEGMENT_HOURS)) if o[k] < cap]
    carry += [f"--day-segments {o['day_segments']}"] if o["day_segments"] < MAX_SEGMENTS_PER_DAY else []
    carry += [f"--chain-start {o['chain_start']}"] if o["chain_start"] != CHAIN_START else []
    o["carry"] = " ".join(carry + o["flags"])
    return o


def is_segment(r):
    return r.get("actor", {}).get("login") == BOT and r.get("event") == "workflow_dispatch" and not r.get("display_title", "").startswith("AI train: dispatch")


def classify(conclusion, jobs, own=False):
    """A segment's class and why, from its first attempt: the run's conclusion (None for the tail's own run, still going)
    and its jobs."""
    jobs = [j for j in jobs if j.get("run_attempt", 1) == 1]
    stopped = [c for c in [conclusion] + [j.get("conclusion") for j in jobs] if c in STOP]
    if stopped:
        return "stop", f"被取消或逾時（{stopped[0]}）"
    if not own:
        if conclusion == "skipped":
            return "none", "整個 run 跳過"
        if conclusion != "success":
            return "bad", f"結論是 {conclusion}"
    work = [j for j in jobs if j.get("name") not in ("dispatch", "hours")]
    for j in work:
        if j.get("conclusion") not in ("success", "skipped"):
            return "bad", f"{j.get('name')} 是 {j.get('conclusion')}"
    train = [j for j in work if j.get("name") != "plan" and j.get("conclusion") == "success"]
    if not train:
        return "bad", "沒有跑完的訓練 job"
    m = min(minutes(j) for j in train)
    if m >= MIN_SEGMENT_MINUTES:
        return "ok", f"訓練 {m:.0f} 分鐘"
    if any(s.get("name") == YIELD_STEP and s.get("conclusion") == "success" for j in train for s in j.get("steps") or []):
        return "yield", f"讓位，只訓練 {m:.0f} 分鐘"
    return "short", f"只訓練 {m:.0f} 分鐘"


def walk(segs, resumed, resume):
    """The chain's state after the segments (id, class, why) in order: the pause, if any, and the two counts in a row.
    A pause named in `resumed`, or exactly AI_TRAIN_RESUME, is lifted (counts back to 0) and the walk goes on."""
    bad = yields = 0
    lifted, recent = [], []
    for sid, cls, why in segs:
        recent = (recent + [f"run {sid}：{why}"])[-6:]
        reason = None
        if cls == "stop":
            reason = f"有一段被取消或逾時（run {sid}）"
        elif cls in ("bad", "short"):
            bad += 1
            if bad >= BAD_IN_A_ROW:
                reason = f"連續 {bad} 段失敗或幾乎沒做事"
        elif cls == "yield":
            yields += 1
            if yields >= YIELDS_IN_A_ROW:
                reason = f"連續 {yields} 段都讓位、而且訓練不到 {MIN_SEGMENT_MINUTES} 分鐘（讓位的判斷可能壞了）"
        elif cls == "ok":
            bad = yields = 0
        if reason:
            pid = f"P-{sid}"
            if pid in resumed or pid == resume:
                lifted.append(pid)
                bad = yields = 0
                continue
            return {"pause": {"id": pid, "reason": reason, "recent": recent}, "bad": bad, "yields": yields, "lifted": lifted}
    return {"pause": None, "bad": bad, "yields": yields, "lifted": lifted}


def sound(old, now):
    """A ledger of this book and this version: checkpoint not in the future, no negative hours, segments well formed."""
    try:
        if old.get("version") != LEDGER_VERSION or old.get("start") != LEDGER_START:
            return False
        if not when(LEDGER_START) <= when(old["checkpoint"]) <= now:
            return False
        hours = list(old["closed"].values()) + [h for r in old["runs"].values() for h in r["days"].values()]
        segs_ok = all(s["cls"] in ("stop", "bad", "short", "yield", "ok", "none") and isinstance(s["created"], str) for s in old["segs"].values())
        return all(isinstance(h, (int, float)) and h >= 0 for h in hours) and segs_ok and all(isinstance(p, str) for p in old["resumed"])
    except (KeyError, TypeError, AttributeError, ValueError):
        return False


def fresh():
    return {"version": LEDGER_VERSION, "start": LEDGER_START, "checkpoint": LEDGER_START, "closed": {}, "runs": {}, "segs": {}, "resumed": [], "unseen": None}


class Api:
    """GitHub's REST API with the run's token; `fail` (a trial's --api-fail) makes every call fail."""

    def __init__(self, token, fail=False):
        self.token, self.fail = token, fail

    def call(self, path, method="GET", body=None):
        if self.fail:
            raise RuntimeError("--api-fail (trial)")
        url = path if path.startswith("https://") else f"https://api.github.com/{path}"
        req = urllib.request.Request(url, method=method, data=None if body is None else json.dumps(body).encode())
        req.add_header("Authorization", f"Bearer {self.token}")
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("X-GitHub-Api-Version", "2022-11-28")
        with urllib.request.urlopen(req, timeout=30) as r:
            text = r.read().decode()
            nxt = re.search(r'<([^>]+)>; rel="next"', r.headers.get("Link", ""))
            return (json.loads(text) if text else None), (nxt.group(1) if nxt else None)

    def get(self, path):
        return self.call(path)[0]

    def every(self, path, key):
        """All items of a paged list; an error if fewer came back than total_count says, three times running (a list
        filtered by status can come back one short while a run changes status: 2026-11-21, a run just dispatched was in
        total_count but not in the list three times running, so it waits 10 seconds before looking again)."""
        for attempt in range(3):
            if attempt:
                time.sleep(10)
            items, url, total = [], path, None
            while url:
                page, url = self.call(url)
                total = page["total_count"]
                items += page[key]
            if len(items) >= total:
                return items
        raise RuntimeError(f"{path}: {len(items)} of {total}")

    def download_ledger(self, run_id, repo):
        subprocess.run(["gh", "run", "download", str(run_id), "--repo", repo, "-n", "ai-train-ledger", "-D", f"prev-{run_id}"], check=True, capture_output=True)
        with open(f"prev-{run_id}/ledger.json") as f:
            return json.load(f)


def run(env, api, now, sleep=time.sleep):
    """Decide, dispatch if so, and return (summary lines, the ledger to save or None)."""
    repo, ref, run_id, repo_id = env["REPO"], env["REF"], int(env["RUN_ID"]), int(env["REPO_ID"])
    event, mode = env.get("EVENT", ""), env.get("MODE", "")
    actor, trig, attempt = env.get("ACTOR", ""), env.get("TRIGGERING_ACTOR", ""), env.get("RUN_ATTEMPT", "")
    switch, resume = env.get("AI_TRAIN", ""), env.get("AI_TRAIN_RESUME", "").strip()
    o = options(env.get("ARGS", "").split())
    planned = o["segment_hours"] * SEGMENT_JOBS
    today = now.astimezone(TPE).date().isoformat()
    reasons, notes = [], []

    if event == "schedule" or (event == "workflow_dispatch" and mode == "dispatch"):
        role = "dispatcher"
    elif event == "workflow_dispatch" and mode == SEGMENT_MODE:
        role = "tail"
        # The job's `if` says the same; checked again here.
        tail_ok = actor == BOT and trig == BOT and attempt == "1" and ref == "main"
        if not tail_ok:
            reasons.append(f"這個 run 不是派工派出去、第一次跑、在 main 的段（actor {actor}、triggering {trig}、attempt {attempt}、ref {ref}）")
    else:
        role = "?"
        reasons.append(f"不認得的啟動方式（{event}、mode {mode}）")

    # The last ledger: only from this repository's AI train, on this ref, uploaded by a dispatch job (a dispatcher run,
    # or the tail of a segment after its dispatch job started: the training jobs had all ended by then).
    ledger = fresh()
    keep = True  # False: the last ledger could not be read; saving a fresh one would hide it
    try:
        arts = api.get(f"repos/{repo}/actions/artifacts?name=ai-train-ledger&per_page=50")
        found = False
        for a in sorted(arts["artifacts"], key=lambda a: a["created_at"], reverse=True):
            wr = a.get("workflow_run") or {}
            if a.get("expired") or wr.get("repository_id") != repo_id or wr.get("head_repository_id") != repo_id or wr.get("head_branch") != ref:
                continue
            r = api.get(f"repos/{repo}/actions/runs/{wr['id']}")
            if r.get("path") != WORKFLOW:
                continue
            by_dispatcher = r.get("event") in ("schedule", "workflow_dispatch") and r.get("display_title", "").startswith("AI train: dispatch")
            by_tail = False
            if not by_dispatcher and is_segment(r) and r.get("triggering_actor", {}).get("login") == BOT and r.get("run_attempt") == 1:
                jobs = api.get(f"repos/{repo}/actions/runs/{r['id']}/attempts/1/jobs?per_page=100")["jobs"]
                d = [j for j in jobs if j.get("name") == "dispatch" and j.get("started_at")]
                by_tail = bool(d) and when(a["created_at"]) >= when(d[0]["started_at"])
            if not (by_dispatcher or by_tail):
                continue
            old = api.download_ledger(wr["id"], repo)
            if sound(old, now):
                ledger = old
                notes.append(f"沿用 run {wr['id']} 的帳")
            else:
                notes.append(f"run {wr['id']} 的帳不對（不是這一本或這一版、結算點在未來、有負數或段的紀錄不對），從頭算")
            found = True
            break
        if not found:
            notes.append("沒有可以用的上一份帳，從頭算")
    except Exception as e:
        notes.append(f"讀不到上一份帳（{type(e).__name__}: {e}），從頭算；這次不存帳")
        ledger, keep = fresh(), False

    day_hours = total_hours = state = None
    seg_today = 0
    own_cls = None
    try:
        # Training runs are started by hand dispatch (the dispatcher's segments too) or by a push; the schedule's ticks
        # are not listed (each dispatcher books its own time). Listed a day at a time: GitHub lists at most 1,000 runs.
        listed, seen_ids = [], set()
        start = when(ledger["checkpoint"])
        while start <= now:
            end = start + dt.timedelta(days=1)
            for ev in ("workflow_dispatch", "push"):
                for r in api.every(f"repos/{repo}/actions/workflows/ai-train.yml/runs?created={iso(start)}..{iso(end)}&event={ev}&per_page=100", "workflow_runs"):
                    if r["id"] not in seen_ids:
                        seen_ids.add(r["id"])
                        listed.append(r)
            start = end
        if role == "tail" and run_id not in seen_ids:
            listed.append(api.get(f"repos/{repo}/actions/runs/{run_id}"))
        jobs_cache = {}

        def jobs_of(rid):
            if rid not in jobs_cache:
                jobs_cache[rid] = api.every(f"repos/{repo}/actions/runs/{rid}/jobs?filter=all&per_page=100", "jobs")
            return jobs_cache[rid]

        sums = dict(ledger["closed"])
        earliest_open = None
        for r in listed:
            key = str(r["id"])
            if r.get("display_title", "").startswith("AI train: dispatch"):
                continue  # a dispatcher: it books its own time
            known = ledger["runs"].get(key)
            # A run done and since re-run (a new attempt) is added up again: its jobs of every attempt.
            if known is None or not known["done"] or known.get("attempt") != r.get("run_attempt", 1):
                days = {}
                for j in jobs_of(r["id"]):
                    if j["status"] == "queued" or not j.get("started_at"):
                        continue
                    h = max(0.0, ((when(j["completed_at"]) if j.get("completed_at") else now) - when(j["started_at"])).total_seconds() / 3600)
                    d = day_of(j["started_at"])
                    days[d] = days.get(d, 0.0) + h
                known = {"done": r["status"] == "completed", "attempt": r.get("run_attempt", 1), "created": r["created_at"], "days": days}
                if known["done"]:
                    ledger["runs"][key] = known
                elif earliest_open is None or r["created_at"] < earliest_open:
                    earliest_open = r["created_at"]
            for d, h in known["days"].items():
                sums[d] = sums.get(d, 0.0) + h
            if is_segment(r):
                if day_of(r["created_at"]) == today:
                    seg_today += 1
                # Segments are judged by their first attempt: kept once done.
                if r["status"] == "completed" and key not in ledger["segs"]:
                    concl = r.get("conclusion") if r.get("run_attempt", 1) == 1 else api.get(f"repos/{repo}/actions/runs/{r['id']}/attempts/1").get("conclusion")
                    cls, why = classify(concl, jobs_of(r["id"]))
                    ledger["segs"][key] = {"cls": cls, "why": why, "created": r["created_at"], "branch": r.get("head_branch")}
                if r["id"] == run_id and role == "tail":
                    own_cls = classify(None, jobs_of(r["id"]), own=True)
        total_hours = sum(sums.values())
        day_hours = sums.get(today, 0.0)
        # Move the checkpoint up: not past a run still going, nor nearer than two days.
        cut = iso(now - dt.timedelta(days=2))
        if earliest_open is not None and earliest_open < cut:
            cut = earliest_open
        if cut > ledger["checkpoint"]:
            for key, known in list(ledger["runs"].items()):
                if known["created"] < cut:
                    for d, h in known["days"].items():
                        ledger["closed"][d] = ledger["closed"].get(d, 0.0) + h
                    del ledger["runs"][key]
            ledger["checkpoint"] = cut

        # The chain: this ref's segments from the chain's start, done (kept) and the tail's own, in order.
        segs = [(int(k), s["cls"], s["why"]) for k, s in ledger["segs"].items() if s.get("branch") == ref and s["created"] >= o["chain_start"]]
        if own_cls is not None:
            segs.append((run_id, own_cls[0], f"（這一段）{own_cls[1]}"))
        state = walk(sorted(segs), set(ledger["resumed"]), resume)
        for pid in state["lifted"]:
            if pid not in ledger["resumed"]:
                ledger["resumed"].append(pid)
                notes.append(f"照 AI_TRAIN_RESUME 恢復了暫停 {pid}")
        if resume and resume not in ledger["resumed"] and not (state["pause"] and state["pause"]["id"] == resume):
            notes.append(f"AI_TRAIN_RESUME 是「{resume}」，不是哪一次暫停的編號，沒有作用")
    except Exception as e:
        reasons.append(f"算不出時數或段的紀錄（{type(e).__name__}: {e}）")
        day_hours = total_hours = state = None

    if switch != "on":
        reasons.append(f"開關 AI_TRAIN 是「{switch or '沒設'}」，不是 on")
    if now < when(o["chain_start"]):
        reasons.append(f"還沒到鏈的起點 {o['chain_start']}")
    if day_hours is not None:
        if day_hours + planned > o["day_cap"]:
            reasons.append(f"今天已用 {day_hours:.2f} 小時，加這一段 {planned:.2f} 會超過每天上限 {o['day_cap']:g}")
        if total_hours + planned > o["total_cap"]:
            reasons.append(f"總共已用 {total_hours:.2f} 小時，加這一段 {planned:.2f} 會超過總上限 {o['total_cap']:g}")
        if seg_today + 1 > o["day_segments"]:
            reasons.append(f"今天已經派了 {seg_today} 段，每天最多 {o['day_segments']} 段")
    if state is not None and state["pause"]:
        reasons.append(f"暫停中（{state['pause']['id']}）：{state['pause']['reason']}")
    if role == "tail" and own_cls is not None and own_cls[0] != "ok":
        reasons.append(f"這一段沒有正常做完（{own_cls[1]}），不接；等定時或手動派工接回")
    if role == "tail" and tail_ok and own_cls is None and state is not None:
        reasons.append("在 run 的清單裡找不到這一段自己")
    if ledger.get("unseen") and (now - when(ledger["unseen"])).total_seconds() < UNSEEN_HOLD:
        reasons.append(f"上次在 {ledger['unseen']} 派了，到現在還沒看到新的 run；{UNSEEN_HOLD // 60} 分鐘內不再派")

    busy = 0
    try:
        for status in ACTIVE:
            for r in api.every(f"repos/{repo}/actions/runs?status={status}&per_page=100", "workflow_runs"):
                if r["id"] == run_id:
                    continue  # only this run itself is left out
                if r.get("path") == WORKFLOW:
                    reasons.append(f"AI train 已經有別的 run 是 {status}（run {r['id']}，{r.get('display_title', '')}）")
                jobs = api.every(f"repos/{repo}/actions/runs/{r['id']}/jobs?per_page=100", "jobs")
                busy += sum(1 for j in jobs if j["status"] == "in_progress")
                w = sum(1 for j in jobs if j["status"] in ("queued", "waiting", "pending", "requested"))
                if w and r.get("path") not in (WORKFLOW, SCRATCH):
                    reasons.append(f"{r.get('name')} 有 {w} 個 job 在等（run {r['id']}）")
        if RUNNERS - busy - SEGMENT_JOBS < RESERVE:
            reasons.append(f"在跑的 job 有 {busy} 個，再派 {SEGMENT_JOBS} 個會剩不到 {RESERVE} 個空位")
    except Exception as e:
        reasons.append(f"看不到別的工作（{type(e).__name__}: {e}）")

    go = not reasons
    started = ""
    if go:
        inputs = {"mode": SEGMENT_MODE, "hours": f"{o['segment_hours']:g}", "islands": str(SEGMENT_JOBS), "args": o["carry"]}
        try:
            listing = f"repos/{repo}/actions/workflows/ai-train.yml/runs?event=workflow_dispatch&branch={ref}&per_page=30"
            before = {r["id"] for r in api.get(listing)["workflow_runs"]}
            resp, _ = api.call(f"repos/{repo}/actions/workflows/ai-train.yml/dispatches", "POST", {"ref": ref, "inputs": inputs})
            new = resp.get("workflow_run_id") if isinstance(resp, dict) else None
            seen = None
            for look in range(SEE_WAIT // 10 + 1):  # every 10 seconds, SEE_WAIT in all
                try:
                    if new:
                        r = api.get(f"repos/{repo}/actions/runs/{new}")
                        if r and r.get("id") == new:
                            seen = r
                    else:
                        cands = [r for r in api.get(listing)["workflow_runs"] if r["id"] not in before and r.get("actor", {}).get("login") == BOT]
                        if cands:
                            seen = min(cands, key=lambda r: r["id"])
                except Exception as e:
                    notes.append(f"找新的 run 時出錯一次（{type(e).__name__}），再找")
                if seen or look == SEE_WAIT // 10:
                    break
                sleep(10)
            if seen:
                ledger["unseen"] = None
                started = f"派了一段 {SEGMENT_MODE}：{o['segment_hours']:g} 小時 × {SEGMENT_JOBS} 個 job（ref {ref}），新的 run {seen['id']}（{seen.get('status')}）"
            else:
                ledger["unseen"] = iso(now)
                started = f"派了一段 {SEGMENT_MODE}，但 {SEE_WAIT // 60} 分鐘內沒看到新的 run；{UNSEEN_HOLD // 60} 分鐘內不再派"
        except Exception as e:
            go, started = False, f"派的時候出錯（{type(e).__name__}: {e}）"
            ledger["unseen"] = iso(now)

    fmt = lambda h: "?" if h is None else f"{h:.2f}"
    lines = [
        "## 派工（D-147）", "",
        f"- 時間：{now.astimezone(TPE):%Y-%m-%d %H:%M}（台北）；角色：{'段的結尾' if role == 'tail' else '派工' if role == 'dispatcher' else role}",
        f"- 這個 run：event {event}、mode {mode or '-'}、actor {actor}、triggering_actor {trig}、run_attempt {attempt}、ref {ref}",
        f"- 今天（台北 {today}）已用：{fmt(day_hours)} 小時，上限 {o['day_cap']:g}；已派 {seg_today} 段，上限 {o['day_segments']}",
        f"- 總共（從 {LEDGER_START} 起）已用：{fmt(total_hours)} 小時，上限 {o['total_cap']:g}",
        f"- 這一段要用：{planned:.2f} 小時；在跑的別的 job：{busy} 個",
        f"- 開關 AI_TRAIN：{switch or '沒設'}；AI_TRAIN_RESUME：{resume or '沒設'}；段從 {o['chain_start']} 起算",
    ]
    if own_cls is not None:
        lines.append(f"- 這一段：{own_cls[0]}（{own_cls[1]}）")
    if state is not None:
        lines.append(f"- 連續失敗或太短：{state['bad']} 段（{BAD_IN_A_ROW} 段暫停）；連續讓位又太短：{state['yields']} 段（{YIELDS_IN_A_ROW} 段暫停）")
    lines.append(f"- 決定：{'派' if go else '不派'}")
    lines += [f"- {started}"] if started else []
    lines += [f"- 不派的原因：{x}" for x in reasons]
    if state is not None and state["pause"]:
        p = state["pause"]
        lines += ["", f"### 暫停中：{p['id']}", "", f"- 原因：{p['reason']}", "- 停之前的段：" + "；".join(p["recent"]),
                  f"- 要再跑：使用者同意、ceo 告訴 war-game-ai 之後，把 repository variable AI_TRAIN_RESUME 設成 {p['id']}（只對這一次暫停有效），"
                  "然後等定時派工，或在 Actions 頁對 AI train 按 Run workflow、mode 選 dispatch。"]
    lines += [f"- 備註：{x}" for x in notes]
    if role == "dispatcher":
        # This dispatcher's own time, on today's line of the ledger.
        ledger["closed"][today] = ledger["closed"].get(today, 0.0) + DISPATCH_HOURS
    # Saved even when the hours could not be added up: what it did work out (runs done, segments) holds.
    return lines, (ledger if keep and sound(ledger, now) else None)


def main():
    env = dict(os.environ)
    o = options(env.get("ARGS", "").split())
    lines, ledger = run(env, Api(env["GH_TOKEN"], fail=o["api_fail"]), dt.datetime.now(dt.timezone.utc))
    with open(env["GITHUB_STEP_SUMMARY"], "a") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    if ledger is not None:
        os.makedirs("ledger", exist_ok=True)
        with open("ledger/ledger.json", "w") as f:
            json.dump(ledger, f)


if __name__ == "__main__":
    main()
