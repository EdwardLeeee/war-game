// The tournament shard (src/tournament.ts) plays only when run: a script that imports its STYLE_PAIRS,
// GameResult or Sample plays no game and writes nothing (ceo 2026-10-28: war-game-ai's tracking script
// played some twenty games locally by importing it). Run as CI runs it, it plays and writes as before.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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
