"""D-147 (A2): the dispatcher (dispatch.py) on made-up runs, through a fake GitHub API: nothing is sent anywhere.

  cd .github/ai-train && python3 -m unittest -v test_dispatch

The fixtures are PR A's trial segments as the API gave them (only the fields used): run 44841471682 finished (14
minutes of training), run 44841753532 cancelled while it waited (no jobs at all).
"""

import copy
import datetime as dt
import json
import os
import sys
import unittest
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dispatch as D  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO, REPO_ID = "o/war-game", 7
REAL_CHAIN_START = D.CHAIN_START
# The tests run as if the chain had started (CHAIN_START is far off until PR B sets the real date).
D.CHAIN_START = "2026-11-22T00:00:00Z"
NOW = dt.datetime(2026, 11, 23, 4, 0, tzinfo=dt.timezone.utc)  # past that


def fixture(name):
    with open(os.path.join(HERE, "fixtures", name)) as f:
        return json.load(f)


def t(minutes_ago):
    return D.iso(NOW - dt.timedelta(minutes=minutes_ago))


def job(name, start, minutes, conclusion="success", steps=(), attempt=1, status="completed"):
    s = NOW - dt.timedelta(minutes=start)
    return {"name": name, "status": status, "conclusion": conclusion if status == "completed" else None, "run_attempt": attempt,
            "started_at": D.iso(s), "completed_at": D.iso(s + dt.timedelta(minutes=minutes)) if status == "completed" else None,
            "steps": [{"name": n, "status": "completed", "conclusion": c} for n, c in steps]}


def seg_jobs(start, minutes, conclusion="success", yielded=False, attempt=1):
    """plan, one training job, hours, dispatch: a segment's jobs."""
    return [job("plan", start + 1, 0.1, attempt=attempt),
            job("chaintest (0)", start, minutes, conclusion, steps=[("Train", conclusion), (D.YIELD_STEP, "success" if yielded else "skipped")], attempt=attempt),
            job("hours", start - minutes, 0.1, attempt=attempt), job("dispatch", start - minutes, 0.2, attempt=attempt)]


class Fake:
    """The few endpoints dispatch.py calls, over `runs` (id -> run), `jobs` (id -> list), ledger artifacts."""

    def __init__(self):
        self.runs, self.jobs, self.attempt1 = {}, {}, {}
        self.artifacts, self.ledgers = [], {}
        self.posts, self.next_id = [], 9_000_000
        self.return_id = True
        self.fail_paths = ()

    def add(self, rid, created, *, status="completed", conclusion="success", actor=D.BOT, trig=None, event="workflow_dispatch",
            title="AI train", branch="main", attempt=1, path=D.WORKFLOW, jobs=None):
        self.runs[rid] = {"id": rid, "status": status, "conclusion": conclusion if status == "completed" else None, "actor": {"login": actor},
                          "triggering_actor": {"login": trig or actor}, "event": event, "display_title": title, "name": "AI train" if path == D.WORKFLOW else "Other",
                          "head_branch": branch, "run_attempt": attempt, "path": path, "created_at": created}
        self.jobs[rid] = jobs or []
        return self.runs[rid]

    def ledger_from(self, rid, ledger, created):
        self.artifacts.append({"created_at": created, "expired": False, "workflow_run": {"id": rid, "repository_id": REPO_ID, "head_repository_id": REPO_ID, "head_branch": self.runs[rid]["head_branch"]}})
        self.ledgers[rid] = ledger

    def call(self, path, method="GET", body=None):
        if any(p in path for p in self.fail_paths):
            raise RuntimeError(f"fake failure {path}")
        u = urlparse(path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        parts = u.path.split("/")[3:]  # after repos/o/war-game
        if method == "POST":
            self.posts.append(body)
            self.next_id += 1
            self.add(self.next_id, D.iso(NOW), status="pending", branch=body["ref"])
            return ({"workflow_run_id": self.next_id, "run_url": "", "html_url": ""} if self.return_id else None), None
        if parts[:2] == ["actions", "artifacts"]:
            return {"total_count": len(self.artifacts), "artifacts": self.artifacts}, None
        if parts[:3] == ["actions", "workflows", "ai-train.yml"]:
            rs = [r for r in self.runs.values() if r["path"] == D.WORKFLOW]
            if "created" in q:
                a, b = q["created"].split("..")
                rs = [r for r in rs if a <= r["created_at"] <= b]
            if "event" in q:
                rs = [r for r in rs if r["event"] == q["event"]]
            if "branch" in q:
                rs = [r for r in rs if r["head_branch"] == q["branch"]]
            return {"total_count": len(rs), "workflow_runs": sorted(rs, key=lambda r: -r["id"])}, None
        if parts == ["actions", "runs"]:
            rs = [r for r in self.runs.values() if r["status"] == q["status"]]
            return {"total_count": len(rs), "workflow_runs": rs}, None
        rid = int(parts[2])
        if parts[3:] == ["attempts", "1", "jobs"]:
            return {"total_count": 0, "jobs": [j for j in self.jobs[rid] if j["run_attempt"] == 1]}, None
        if parts[3:] == ["attempts", "1"]:
            return self.attempt1.get(rid, self.runs[rid]), None
        if parts[3:] == ["jobs"]:
            js = self.jobs[rid] if q.get("filter") == "all" else [j for j in self.jobs[rid] if j["run_attempt"] == self.runs[rid]["run_attempt"]]
            return {"total_count": len(js), "jobs": js}, None
        return copy.deepcopy(self.runs[rid]), None

    def get(self, path):
        return self.call(path)[0]

    every = D.Api.every

    def download_ledger(self, run_id, repo):
        return copy.deepcopy(self.ledgers[run_id])


def env(**kw):
    e = {"REPO": REPO, "REPO_ID": str(REPO_ID), "REF": "main", "RUN_ID": "8000000", "EVENT": "schedule", "MODE": "",
         "ACTOR": "someone", "TRIGGERING_ACTOR": "someone", "RUN_ATTEMPT": "1", "AI_TRAIN": "on", "AI_TRAIN_RESUME": "", "ARGS": ""}
    e.update(kw)
    return e


def tail_env(own, **kw):
    return env(EVENT="workflow_dispatch", MODE=D.SEGMENT_MODE, RUN_ID=str(own), ACTOR=D.BOT, TRIGGERING_ACTOR=D.BOT, **kw)


def go(fake, e, now=NOW):
    lines, ledger = D.run(e, fake, now, sleep=lambda s: None)
    text = "\n".join(lines)
    return ("- 決定：派" in text), text, ledger


class Classify(unittest.TestCase):
    def test_real_runs(self):
        done = fixture("jobs-44841471682.json")["jobs"]
        self.assertEqual(D.classify("success", done)[0], "ok")
        # Cancelled while it waited: no jobs, only the run's conclusion says so.
        self.assertEqual(fixture("jobs-44841753532.json")["jobs"], [])
        self.assertEqual(D.classify(fixture("run-44841753532.json")["conclusion"], [])[0], "stop")
        # The real skipped step: a step whose `if` was false is listed, conclusion skipped (so not "gave way").
        self.assertTrue(any(s["conclusion"] == "skipped" for j in done for s in j["steps"]))

    def test_conclusions(self):
        self.assertEqual(D.classify("timed_out", seg_jobs(70, 70))[0], "stop")
        self.assertEqual(D.classify("success", seg_jobs(70, 60, "cancelled"))[0], "stop")  # a job cancelled
        for c in ("failure", "startup_failure", "action_required", "stale", "neutral", None):
            self.assertEqual(D.classify(c, seg_jobs(70, 60))[0], "bad", c)
        self.assertEqual(D.classify("skipped", [])[0], "none")
        self.assertEqual(D.classify("success", [job("plan", 5, 0.1)])[0], "bad")  # no training job
        self.assertEqual(D.classify("success", seg_jobs(70, 9))[0], "short")
        self.assertEqual(D.classify("success", seg_jobs(70, 9, yielded=True))[0], "yield")
        self.assertEqual(D.classify("success", seg_jobs(70, 40, yielded=True))[0], "ok")  # gave way after training enough

    def test_exam_paused_and_merge_minutes(self):
        jobs = seg_jobs(70, 60)
        merge = job("merge", 9, 2, steps=[("Merge", "success"), (D.EXAM_STOP_STEP, "success")])
        self.assertEqual(D.classify("success", jobs + [merge])[0], "stop")
        merge["steps"][1]["conclusion"] = "skipped"
        self.assertEqual(D.classify("success", jobs + [merge])[0], "ok")  # the merge job's 2 minutes are not training
        self.assertEqual(D.classify("success", jobs + [job("merge", 9, 2, "failure")])[0], "bad")

    def test_own_run_still_going(self):
        jobs = seg_jobs(70, 60)
        jobs[-1].update(status="in_progress", conclusion=None, completed_at=None)  # this dispatch job
        jobs[-2].update(status="in_progress", conclusion=None, completed_at=None)  # hours
        self.assertEqual(D.classify(None, jobs, own=True)[0], "ok")

    def test_first_attempt_only(self):
        # Attempt 1 cancelled, attempt 2 (a Re-run) fine: still a stop.
        jobs = seg_jobs(200, 60, "cancelled") + seg_jobs(70, 60, attempt=2)
        self.assertEqual(D.classify("cancelled", jobs)[0], "stop")


class Walk(unittest.TestCase):
    def w(self, classes, resumed=(), resume=""):
        return D.walk([(i + 1, c, c) for i, c in enumerate(classes)], set(resumed), resume)

    def test_counts(self):
        self.assertIsNone(self.w(["bad", "short"])["pause"])
        self.assertEqual(self.w(["bad", "short", "bad"])["pause"]["id"], "P-3")
        self.assertIsNone(self.w(["bad", "bad", "ok", "bad", "bad"])["pause"])
        self.assertIsNone(self.w(["bad", "bad", "yield", "none"])["pause"])  # a yield neither counts nor resets
        self.assertEqual(self.w(["bad", "yield", "bad", "bad"])["pause"]["id"], "P-4")
        self.assertIsNone(self.w(["yield"] * 5 + ["ok"] + ["yield"] * 5)["pause"])
        self.assertEqual(self.w(["yield"] * 6)["pause"]["id"], "P-6")
        self.assertEqual(self.w(["ok", "stop", "ok"])["pause"]["id"], "P-2")

    def test_resume_that_pause_only(self):
        self.assertIsNone(self.w(["ok", "stop", "ok"], resume="P-2")["pause"])
        self.assertEqual(self.w(["ok", "stop", "ok"], resume="P-3")["pause"]["id"], "P-2")  # not that pause
        self.assertEqual(self.w(["ok", "stop", "ok"], resume="P-999")["pause"]["id"], "P-2")  # nor a later id
        # Resumed once (kept in the ledger), a later resume for another pause leaves it resumed.
        s = self.w(["stop", "ok", "bad", "bad", "bad"], resumed=["P-1"], resume="P-5")
        self.assertIsNone(s["pause"])
        self.assertEqual(s["lifted"], ["P-1", "P-5"])
        # Lifted, the counts start again.
        self.assertIsNone(self.w(["bad", "bad", "bad", "bad", "bad"], resume="P-3")["pause"])
        self.assertEqual(self.w(["bad", "bad", "bad", "bad", "bad", "bad"], resume="P-3")["pause"]["id"], "P-6")


class Options(unittest.TestCase):
    def test_only_lower_and_earlier(self):
        o = D.options("--day-cap 500 --total-cap 3 --segment-hours x --day-segments 2 --chain-start 2026-11-21T05:00:00Z --short --api-fail".split())
        # No cap a day (D-160): a trial's --day-cap sets one, whatever its value.
        self.assertEqual((o["day_cap"], o["total_cap"], o["segment_hours"], o["day_segments"]), (500.0, 3.0, 1.0, 2))
        self.assertEqual(o["chain_start"], "2026-11-21T05:00:00Z")
        self.assertEqual(o["carry"], "--day-cap 500 --total-cap 3 --day-segments 2 --chain-start 2026-11-21T05:00:00Z --short")
        self.assertTrue(o["api_fail"])
        self.assertEqual(D.options(["--chain-start", "2030-01-01T00:00:00Z"])["chain_start"], D.CHAIN_START)  # not later
        self.assertEqual(D.options(["--chain-start", "2026-01-01T00:00:00Z"])["chain_start"], D.CHAIN_START)  # not before the ledger
        self.assertEqual(D.options([])["carry"], "")


class Run(unittest.TestCase):
    def test_dispatcher_starts_a_segment_and_sees_it(self):
        for return_id in (True, False):
            f = Fake()
            f.return_id = return_id
            ok, text, ledger = go(f, env())
            self.assertTrue(ok, text)
            self.assertEqual(f.posts, [{"ref": "main", "inputs": {"mode": D.SEGMENT_MODE, "hours": "1", "islands": str(D.SEGMENT_JOBS_MAX), "args": ""}}])
            self.assertIn(f"新的 run {f.next_id}", text)
            self.assertIsNone(ledger["unseen"])
            self.assertAlmostEqual(ledger["closed"]["2026-11-23"], D.DISPATCH_HOURS)

    def test_the_real_start_is_far_off(self):
        # Until PR B sets the real date nothing is dispatched without a trial's --chain-start, the switch on or not.
        self.assertGreaterEqual(REAL_CHAIN_START, "2099-01-01T00:00:00Z")
        saved = D.CHAIN_START
        try:
            D.CHAIN_START = REAL_CHAIN_START
            ok, text, _ = go(Fake(), env())
            self.assertFalse(ok)
            self.assertIn("還沒到鏈的起點", text)
            self.assertTrue(go(Fake(), env(ARGS="--chain-start 2026-11-23T00:00:00Z"))[0])
        finally:
            D.CHAIN_START = saved

    def test_off_before_start_or_rerun(self):
        f = Fake()
        self.assertFalse(go(f, env(AI_TRAIN="off"))[0])
        ok, text, _ = go(f, env(), now=D.when(D.CHAIN_START) - dt.timedelta(hours=1))
        self.assertFalse(ok)
        self.assertIn("還沒到鏈的起點", text)
        self.assertEqual(f.posts, [])

    def test_tail_chains_only_a_proper_segment(self):
        for minutes, yielded, want in ((40, False, True), (5, False, False), (5, True, False)):
            f = Fake()
            own = f.add(8100000, t(minutes + 3), status="in_progress", jobs=seg_jobs(minutes + 1, minutes, yielded=yielded))
            f.jobs[own["id"]][-1].update(status="in_progress", conclusion=None, completed_at=None)
            ok, text, ledger = go(f, tail_env(own["id"]))
            self.assertEqual(ok, want, text)
            # The segment's own hours are counted (it is still going), and no dispatcher time is booked for the tail.
            self.assertGreaterEqual(float(text.split("已用：")[1].split(" ")[0]), minutes / 60)
            self.assertNotIn("2026-11-23", ledger["closed"])

    def test_tail_needs_the_bot_first_attempt_on_main(self):
        for kw in ({"ACTOR": "someone"}, {"TRIGGERING_ACTOR": "someone"}, {"RUN_ATTEMPT": "2"}, {"REF": "other"}):
            f = Fake()
            own = f.add(8100000, t(43), status="in_progress", jobs=seg_jobs(41, 40))
            e = tail_env(own["id"])
            e.update(kw)
            ok, text, _ = go(f, e)
            self.assertFalse(ok, kw)
            self.assertIn("不是派工派出去", text)

    def test_cancelled_segment_pauses_until_resumed(self):
        f = Fake()
        f.add(8050000, t(300), jobs=seg_jobs(299, 60))
        f.add(8060000, t(200), conclusion="cancelled")  # cancelled while waiting: no jobs
        f.add(8070000, t(100), jobs=seg_jobs(99, 60))  # started in the moment before the cancel: does not clear it
        ok, text, ledger = go(f, env())
        self.assertFalse(ok)
        self.assertIn("暫停中：P-8060000", text)
        self.assertIn("AI_TRAIN_RESUME 設成 P-8060000", text)
        # The schedule half an hour later: still paused (the ledger keeps the segments).
        f.add(8000000, t(1), event="schedule", title="AI train: dispatch", actor="someone")
        f.ledger_from(8000000, ledger, t(0))
        ok, text, _ = go(f, env(RUN_ID="8000001"), now=NOW + dt.timedelta(minutes=30))
        self.assertFalse(ok)
        self.assertIn("沿用 run 8000000", text)
        self.assertIn("暫停中：P-8060000", text)
        # Another value does nothing; that pause's name lifts it, and it stays lifted when the variable changes.
        ok, text, _ = go(f, env(AI_TRAIN_RESUME="P-8070000"))
        self.assertFalse(ok)
        self.assertIn("沒有作用", text)
        ok, text, ledger = go(f, env(AI_TRAIN_RESUME="P-8060000"))
        self.assertTrue(ok, text)
        self.assertEqual(ledger["resumed"], ["P-8060000"])
        f.runs[f.next_id].update(status="completed", conclusion="success")
        f.jobs[f.next_id] = seg_jobs(50, 40)
        f.artifacts.clear()
        f.add(8000002, t(0), event="schedule", title="AI train: dispatch", actor="someone")
        f.ledger_from(8000002, ledger, t(0))
        self.assertTrue(go(f, env(RUN_ID="8000003", AI_TRAIN_RESUME=""))[0])

    def test_three_bad_in_a_row_pause(self):
        f = Fake()
        f.add(8050000, t(300), conclusion="failure", jobs=seg_jobs(299, 1, "failure"))
        f.add(8060000, t(200), jobs=seg_jobs(199, 3))
        self.assertTrue(go(f, env())[0])  # two bad: the schedule starts it again
        f = Fake()
        f.add(8050000, t(300), conclusion="failure", jobs=seg_jobs(299, 1, "failure"))
        f.add(8060000, t(200), jobs=seg_jobs(199, 3))
        f.add(8070000, t(100), conclusion="startup_failure")
        ok, text, _ = go(f, env())
        self.assertFalse(ok)
        self.assertIn("P-8070000", text)

    def test_segments_before_the_start_and_other_branches_do_not_count(self):
        f = Fake()
        f.add(8050000, D.iso(D.when(D.CHAIN_START) - dt.timedelta(hours=1)), conclusion="cancelled")
        f.add(8060000, t(100), conclusion="cancelled", branch="ai/x")
        self.assertTrue(go(f, env())[0])
        # A trial's --chain-start (only earlier) brings the first back in.
        ok, text, _ = go(f, env(ARGS="--chain-start 2026-11-21T06:00:00Z"))
        self.assertFalse(ok)
        self.assertIn("P-8050000", text)

    def test_busy_and_waiting(self):
        for status in D.ACTIVE:
            f = Fake()
            f.add(8100000, t(5), status=status, actor="someone")
            ok, text, _ = go(f, env())
            self.assertFalse(ok, status)
            self.assertIn(f"是 {status}", text)
        # A dispatcher of the schedule running at the same time is counted too (both hold off: a known gap).
        f = Fake()
        f.add(8100000, t(1), status="in_progress", event="schedule", title="AI train: dispatch", actor="someone")
        own = f.add(8100001, t(43), status="in_progress", jobs=seg_jobs(41, 40))
        self.assertFalse(go(f, tail_env(own["id"]))[0])
        # Its own run is left out.
        f = Fake()
        own = f.add(8100001, t(43), status="in_progress", jobs=seg_jobs(41, 40))
        self.assertTrue(go(f, tail_env(own["id"]))[0])
        # Another workflow's job waiting.
        f = Fake()
        f.add(8100002, t(3), status="in_progress", path=".github/workflows/client.yml", actor="someone",
              jobs=[job("e2e", 2, 1, status="queued")])
        self.assertFalse(go(f, env())[0])

    def test_segments_a_day(self):
        f = Fake()
        for i in range(D.MAX_SEGMENTS_PER_DAY):
            f.add(8000100 + i, t(200 - i), jobs=seg_jobs(199 - i, 12))
        ok, text, _ = go(f, env())
        self.assertFalse(ok)
        self.assertIn(f"已經派了 {D.MAX_SEGMENTS_PER_DAY} 段", text)
        self.assertTrue(go(Fake(), env(ARGS="--day-segments 1"))[0])
        f = Fake()
        f.add(8000100, t(100), jobs=seg_jobs(99, 12))
        self.assertFalse(go(f, env(ARGS="--day-segments 1"))[0])

    def test_hours_caps(self):
        f = Fake()
        f.add(8000100, t(600), actor="someone", event="workflow_dispatch", jobs=[job("exam (0)", 599, 60 * 8)])
        # 8 hours used, a segment of SEGMENT_JOBS_MAX jobs of an hour each (nothing else running).
        room = 8 + D.SEGMENT_HOURS * D.SEGMENT_JOBS_MAX
        self.assertTrue(go(f, env(ARGS=f"--day-cap {room + 0.5}"))[0])
        self.assertFalse(go(f, env(ARGS=f"--day-cap {room - 0.5}"))[0])
        self.assertFalse(go(f, env(ARGS=f"--total-cap {room - 0.5}"))[0])

    def test_no_cap_a_day_and_the_brake(self):
        # The user (D-160): no cap a day, only the 5,000 in all; a trial's --day-cap still lowers it.
        f = Fake()
        f.add(8000100, t(1300), actor="someone", jobs=[job("exam (0)", 1299, 60 * 21)])  # 21 hours today
        ok, text, _ = go(f, env())
        self.assertTrue(ok, text)
        self.assertIn("不設每天上限", text)
        self.assertFalse(go(f, env(ARGS="--day-cap 30"))[0])
        self.assertFalse(go(f, env(ARGS="--total-cap 30"))[0])
        # The brake on the rate: a day of minimal chained segments plus what the schedule can start.
        self.assertEqual(D.MAX_SEGMENTS_PER_DAY, 24 * 60 // D.MIN_SEGMENT_MINUTES + 48)
        self.assertEqual(D.MAX_SEGMENTS_PER_DAY, 192)

    def test_segment_takes_what_is_free(self):
        def busy(n):
            f = Fake()
            f.add(8100000, t(5), status="in_progress", path=".github/workflows/sim.yml", actor="someone", jobs=[job(f"sim {i}", 4, 1, status="in_progress") for i in range(n)])
            return f
        # 6 running: 20 - 6 - 4 = 10 jobs.
        f = busy(6)
        ok, text, _ = go(f, env())
        self.assertTrue(ok, text)
        self.assertEqual(f.posts[0]["inputs"]["islands"], "10")
        self.assertIn("10 個 job", text)
        # None free with 4 kept: no segment (never one squeezed in).
        for n in (16, 17, 20):
            f = busy(n)
            ok, text, _ = go(f, env())
            self.assertFalse(ok, n)
            self.assertIn("沒有可以用的", text)
            self.assertEqual(f.posts, [])
        # Nothing else running: the most, 16; a trial's --segment-jobs lowers it and is passed on.
        f = busy(0)
        go(f, env(ARGS="--segment-jobs 2"))
        self.assertEqual(f.posts[0]["inputs"]["islands"], "2")
        self.assertIn("--segment-jobs 2", f.posts[0]["inputs"]["args"])

    def test_not_seen_holds_off(self):
        f = Fake()
        f.return_id = False
        real = f.call

        def hide(path, method="GET", body=None):  # the new run never shows in the list
            page, nxt = real(path, method, body)
            if method == "GET" and "branch=" in path:
                page = dict(page, workflow_runs=[r for r in page["workflow_runs"] if r["id"] <= 9_000_000])
            return page, nxt

        f.call = hide
        ok, text, ledger = go(f, env())
        self.assertIn("沒看到新的 run", text)
        self.assertEqual(ledger["unseen"], D.iso(NOW))
        f.call = real
        del f.runs[f.next_id]
        f.add(8000002, t(1), event="schedule", title="AI train: dispatch", actor="someone")
        f.ledger_from(8000002, ledger, t(0))
        self.assertFalse(go(f, env(RUN_ID="8000003"), now=NOW + dt.timedelta(minutes=10))[0])
        self.assertTrue(go(f, env(RUN_ID="8000003"), now=NOW + dt.timedelta(minutes=16))[0])

    def test_api_failures_start_nothing_and_keep_the_last_ledger(self):
        f = Fake()
        f.fail_paths = ("artifacts",)
        ok, text, ledger = go(f, env())
        # The last ledger unreadable: everything counted again from the start (complete, only slower), but this run's
        # ledger is not saved, so it cannot hide the last good one (and its resumed pauses).
        self.assertIn("這次不存帳", text)
        self.assertIsNone(ledger)
        for p in ("workflows/ai-train.yml/runs?created", "actions/runs?status", "/jobs"):
            f = Fake()
            f.add(8000100, t(100), jobs=seg_jobs(99, 12))
            f.add(8000101, t(5), status="in_progress", actor="someone", path=".github/workflows/client.yml")
            f.fail_paths = (p,)
            self.assertFalse(go(f, env())[0], p)

    def test_ledger_sources(self):
        good = D.fresh()
        good["closed"] = {"2026-11-23": 150.0}
        # From a dispatcher run: used (150 h today -> the day cap of 150.5 is passed).
        f = Fake()
        f.add(8000050, t(30), event="schedule", title="AI train: dispatch", actor="someone")
        f.ledger_from(8000050, good, t(29))
        self.assertIn("沿用 run 8000050", go(f, env(ARGS="--day-cap 150.5"))[1])
        # From a segment's tail, uploaded after its dispatch job started: used.
        f = Fake()
        f.add(8000060, t(80), jobs=seg_jobs(79, 60))
        f.ledger_from(8000060, good, t(18))
        self.assertIn("沿用 run 8000060", go(f, env())[1])
        # The same, but uploaded before the dispatch job started (by a training job): not used.
        f = Fake()
        f.add(8000060, t(80), jobs=seg_jobs(79, 60))
        f.ledger_from(8000060, good, t(30))
        self.assertIn("沒有可以用的上一份帳", go(f, env())[1])
        # The same, but its dispatch job was skipped (a skipped job has a start time too): not used.
        f = Fake()
        jobs = seg_jobs(79, 60)
        jobs[-1].update(conclusion="skipped")
        f.add(8000060, t(80), jobs=jobs)
        f.ledger_from(8000060, good, t(18))
        self.assertIn("沒有可以用的上一份帳", go(f, env())[1])
        # A segment started by hand, or a re-run one: not used.
        for kw in ({"actor": "someone"}, {"trig": "someone"}, {"attempt": 2}):
            f = Fake()
            f.add(8000060, t(80), jobs=seg_jobs(79, 60), **kw)
            f.ledger_from(8000060, good, t(18))
            self.assertIn("沒有可以用的上一份帳", go(f, env())[1], kw)
        # PR A's ledger (version 1): counted again from the start.
        f = Fake()
        f.add(8000050, t(30), event="schedule", title="AI train: dispatch", actor="someone")
        old = {k: v for k, v in good.items() if k not in ("version", "segs", "resumed", "unseen")}
        f.ledger_from(8000050, old, t(29))
        self.assertIn("帳不對", go(f, env())[1])

    def test_trial_options_pass_on(self):
        f = Fake()
        ok, _, _ = go(f, env(EVENT="workflow_dispatch", MODE="dispatch", ARGS="--total-cap 3 --segment-hours 0.25 --segment-jobs 4 --short --api-fail-not"))
        self.assertTrue(ok)
        self.assertEqual(f.posts[0]["inputs"], {"mode": D.SEGMENT_MODE, "hours": "0.25", "islands": "4", "args": "--total-cap 3 --segment-hours 0.25 --segment-jobs 4 --short"})


class GiveWay(unittest.TestCase):
    def setUp(self):
        import giveway
        self.why = lambda f: giveway.why(f, REPO, NOW)

    @staticmethod
    def waiting(minutes, status="queued"):
        return {"name": "e2e", "status": status, "created_at": t(minutes), "run_attempt": 1}

    def test_by_jobs_not_the_run(self):
        f = Fake()
        # 2026-11-21: a run "queued" for 12 minutes, every job running: no reason to give way.
        f.add(1, t(12), status="queued", path=".github/workflows/client.yml", actor="someone", jobs=[self.waiting(12, "in_progress")])
        self.assertEqual(self.why(f), "")
        # A job waiting 10 minutes: give way; 5 minutes: not yet.
        f.jobs[1].append(self.waiting(5))
        self.assertEqual(self.why(f), "")
        f.jobs[1].append(self.waiting(11))
        self.assertIn("在等 11 分鐘", self.why(f))

    def test_deploy_at_once_and_a_run_with_no_jobs_yet(self):
        f = Fake()
        f.add(2, t(1), status="in_progress", path=".github/workflows/pages.yml", event="push", actor="someone", jobs=[self.waiting(1)])
        self.assertIn("run 2", self.why(f))
        f = Fake()
        f.add(3, t(1), status="in_progress", path=".github/workflows/pages.yml", event="pull_request", actor="someone", jobs=[self.waiting(1)])
        self.assertEqual(self.why(f), "")  # a pull request's build of the site is not the deployment
        f = Fake()
        f.add(4, t(11), status="queued", path=".github/workflows/sim.yml", actor="someone", jobs=[])
        self.assertIn("run 4", self.why(f))
        f = Fake()
        f.add(5, t(30), status="queued", actor="someone", jobs=[])  # the training's own: never
        self.assertEqual(self.why(f), "")


if __name__ == "__main__":
    unittest.main()
