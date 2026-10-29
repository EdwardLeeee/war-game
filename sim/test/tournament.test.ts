// The tournament shard (src/tournament.ts) plays only when run: a script that imports its STYLE_PAIRS,
// GameResult or Sample plays no game and writes nothing (ceo 2026-10-28: war-game-ai's tracking script
// played some twenty games locally by importing it). Run as CI runs it, it plays and writes as before.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const TOURNAMENT = fileURLToPath(new URL("../src/tournament.ts", import.meta.url));

test("tournament: importing it plays nothing and writes nothing; STYLE_PAIRS is every pair of styles", () => {
  const dir = mkdtempSync(join(tmpdir(), "tournament-import-"));
  try {
    const code = `const m = await import(${JSON.stringify(TOURNAMENT)}); console.log(JSON.stringify(m.STYLE_PAIRS));`;
    // In a child, so a regression fails here (the timeout) instead of playing 100 games in the test run.
    const outText = execFileSync(process.execPath, ["--input-type=module", "-e", code, "--", "--games", "1", "--ticks", "100"], { cwd: dir, timeout: 30_000, encoding: "utf8" });
    const pairs = JSON.parse(outText.trim()) as string[][];
    assert.equal(pairs.length, 9);
    assert.equal(new Set(pairs.map((x) => x.join("/"))).size, 9);
    assert.deepEqual(readdirSync(dir), [], "no tournament directory, no game files");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tournament: run as CI runs it, it plays its shard, replays it and writes game-<i>.json and .jsonl", () => {
  const dir = mkdtempSync(join(tmpdir(), "tournament-run-"));
  try {
    const out = join(dir, "shard-0");
    const text = execFileSync(process.execPath, [TOURNAMENT, "--games", "1", "--shard", "0", "--shards", "1", "--ticks", "600", "--out", out], { timeout: 120_000, encoding: "utf8" });
    assert.match(text, /^game 0 seed 1 .*replay matches/m);
    assert.deepEqual(readdirSync(out).sort(), ["game-0.json", "game-0.jsonl"]);
    const result = JSON.parse(readFileSync(join(out, "game-0.json"), "utf8")) as { game: number; ticks: number; replayMatches: boolean };
    assert.deepEqual([result.game, result.ticks, result.replayMatches], [0, 600, true]);
    assert.ok(!existsSync(join(dir, "tournament")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the summary's time limit is each game's own, though none reached it; with a limit over 30 minutes, the 30-minute reference", () => {
  const dir = mkdtempSync(join(tmpdir(), "tournament-limit-"));
  try {
    const shard = join(dir, "shard-0");
    execFileSync(process.execPath, [TOURNAMENT, "--games", "1", "--shard", "0", "--shards", "1", "--ticks", "600", "--out", shard], { timeout: 120_000, encoding: "utf8" });
    const one = JSON.parse(readFileSync(join(shard, "game-0.json"), "utf8")) as Record<string, unknown>;
    assert.equal(one.maxTicks, 600, "each game records its limit");
    // Four games under a 60-minute limit, all over before it (each spawn wins two, so the gates pass): at 25, 28, 40
    // and 50 minutes.
    const games = join(dir, "games");
    mkdirSync(games);
    [
      [0, 25, 0],
      [1, 28, 1],
      [2, 40, 0],
      [3, 50, 1],
    ].forEach(([game, minutes, winner]) => writeFileSync(join(games, `game-${game}.json`), JSON.stringify({ ...one, game, ticks: minutes * 1200, maxTicks: 72000, winner })));
    const SUMMARY = fileURLToPath(new URL("../src/tournament-summary.ts", import.meta.url));
    const json = join(dir, "summary.json");
    const text = execFileSync(process.execPath, [SUMMARY, games, "--json", json], { timeout: 60_000, encoding: "utf8" });
    assert.match(text, /\| 平手（60 分鐘到） \| 0（0\.0%） \|/);
    assert.match(text, /\| 第 30 分還沒分出勝負（參考，D-112 以前的上限） \| 2（50\.0%） \|/);
    const summary = JSON.parse(readFileSync(json, "utf8")) as { limitMinutes: number; reference30: { undecided: number } };
    assert.deepEqual([summary.limitMinutes, summary.reference30.undecided], [60, 2]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
