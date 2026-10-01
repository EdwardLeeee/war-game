import assert from "node:assert/strict";
import { test } from "node:test";
import { Runner } from "../src/runner.ts";
import { SnapshotEncoder } from "../src/view/view.ts";
import { buildView } from "../src/view/view.ts";
import { NODE_STRIDE, Reject, UnitType } from "../src/protocol.ts";
import { emptyGame, openArea, put } from "./helpers.ts";

test("commands are validated; rejects are reported with their seq and logged", () => {
  const g = emptyGame();
  const a = openArea(g, 10);
  const mine = put(g, 0, UnitType.Spearman, a.x + 1, a.y + 1);
  const theirs = put(g, 1, UnitType.Spearman, a.x + 9, a.y + 9);
  g.fog.update(g.w);
  g.push({ t: g.tick, p: 0, seq: 101, c: "move", u: [theirs], x: 1, y: 1 });
  g.push({ t: g.tick, p: 0, seq: 102, c: "move", u: [mine], x: 500, y: 1 });
  g.push({ t: g.tick, p: 0, seq: 103, c: "attack", u: [mine], target: mine });
  g.push({ t: g.tick, p: 0, seq: 104, c: "gather", u: [mine], node: 0 });
  g.push({ t: g.tick, p: 0, seq: 105, c: "move", u: [mine], x: a.x + 5, y: a.y + 5 });
  g.step();
  const rejected = g.events.filter((e) => e.ev.k === "rejected").map((e) => e.ev as { seq: number; reason: number });
  assert.deepEqual(rejected, [
    { k: "rejected", seq: 101, reason: Reject.NotOwner },
    { k: "rejected", seq: 102, reason: Reject.InvalidTarget },
    { k: "rejected", seq: 103, reason: Reject.InvalidTarget },
    { k: "rejected", seq: 104, reason: Reject.NotAvailable },
  ] as never);
  assert.equal(g.log.length, 5, "rejected commands are logged too");
});

test("a replay of the command log reproduces every hash", () => {
  const a = new Runner({ seed: 3, scenario: "skirmish", ai: [false, false] });
  let seq = 0;
  for (let t = 0; t < 1600; t++) {
    if (t % 400 === 0) {
      const u = a.game.w.units.col;
      for (let p = 0; p < 2; p++) {
        const army: number[] = [];
        for (let s = 0; s < a.game.w.units.count; s++) if (u.owner[s] === p && u.type[s] !== UnitType.Farmer && u.type[s] !== UnitType.Militia) army.push(u.id[s]);
        a.game.push({ t, p, seq: seq++, c: "move", u: army, x: 48, y: 48 });
      }
      a.game.push({ t, p: 1, seq: seq++, c: "train", building: 0, type: UnitType.Farmer, n: 1 });
    }
    if (t % 400 === 200) {
      // Loose, then close again: re-forming in place (round 3).
      const u = a.game.w.units.col;
      const army: number[] = [];
      for (let s = 0; s < a.game.w.units.count; s++) if (u.owner[s] === 0 && u.type[s] !== UnitType.Farmer) army.push(u.id[s]);
      a.game.push({ t, p: 0, seq: seq++, c: "formation", u: army, loose: t % 800 === 200 });
    }
    a.tick();
  }
  const b = new Runner({ seed: 3, scenario: "skirmish", ai: [false, false], replay: a.game.log.map((c) => ({ ...c })) });
  for (let t = 0; t < 1600; t++) b.tick();
  assert.deepEqual(b.hashes, a.hashes);
  assert.equal(a.hashes.length, 17);
});

test("snapshots send node rows only when they change and fog only when it is recomputed", () => {
  const g = emptyGame();
  const enc = new SnapshotEncoder(g.w.nodeAmount.length);
  const first = enc.encode(buildView(g, 0), []);
  assert.ok(first.nodes.length / NODE_STRIDE > 0, "known nodes on the first snapshot");
  assert.notEqual(first.fog, null);
  g.step();
  const second = enc.encode(buildView(g, 0), []);
  assert.equal(second.nodes.length, 0);
  assert.equal(second.fog, null, "fog only every FOG_EVERY ticks");
  for (let i = 0; i < 4; i++) g.step();
  assert.notEqual(enc.encode(buildView(g, 0), []).fog, null);
});

test("the standard start: a main city and five farmers each, mirror images of each other", () => {
  const g = new Runner({ seed: 1, scenario: "standard", ai: [false, false] }).game;
  const u = g.w.units.col;
  const farmers = [0, 1].map((p) => {
    const cells: string[] = [];
    for (let s = 0; s < g.w.units.count; s++) if (u.owner[s] === p && u.type[s] === UnitType.Farmer) cells.push(p === 0 ? `${u.x[s]},${u.y[s]}` : `${u.y[s]},${u.x[s]}`);
    return cells.sort();
  });
  assert.equal(farmers[0].length, 5);
  assert.deepEqual(farmers[1], farmers[0]);
  assert.equal(g.w.res[0], 200);
});

test("each game has its own time limit: a draw when it is reached, never with 0", async () => {
  const { GameOverReason, MAX_TICKS } = await import("../src/protocol.ts");
  const limited = new Runner({ seed: 3, scenario: "standard", ai: [false, false], maxTicks: 120 });
  while (!limited.over && limited.game.tick < 1000) limited.tick();
  assert.deepEqual([limited.game.tick, limited.game.w.winner, limited.game.w.endReason], [120, -1, GameOverReason.TimeLimit]);
  const open = new Runner({ seed: 3, scenario: "standard", ai: [false, false], maxTicks: 0 });
  while (!open.over && open.game.tick < 300) open.tick();
  assert.equal(open.over, false, "no limit");
  assert.equal(new Runner({ seed: 3, scenario: "standard", ai: [false, false] }).maxTicks, MAX_TICKS, "default");
  // The log header records the limit and each player's difficulty, and a replay keeps the limit.
  const head = new Runner({ seed: 3, scenario: "standard", ai: [false, true], maxTicks: 0, difficulty: ["normal", "easy"] }).header([false, true]);
  assert.deepEqual([head.maxTicks, head.difficulty], [0, ["normal", "easy"]]);
  const replay = new Runner({ seed: 3, scenario: "standard", ai: [false, false], maxTicks: 120, replay: limited.game.log });
  while (!replay.over && replay.game.tick < 1000) replay.tick();
  assert.equal(replay.game.tick, 120);
});
