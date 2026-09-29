// Unit tests for the deterministic core (node --test, types stripped by Node).
// Short games only; the full 24,000-tick games run in CI.

import assert from "node:assert/strict";
import { test } from "node:test";
import { CENTER, DIR8_DX, DIR8_DY, MAP_SEED, MAP_SIZE, NO_DIR, SPAWN_BATTLE, SPAWN_CORNER } from "../src/sim/constants.ts";
import { buildFlowField } from "../src/sim/flowfield.ts";
import { countBlocked, generateMap, nearestOpen } from "../src/sim/map.ts";
import { dir16, fnvWord, FNV_OFFSET, hex8, idiv, isqrt, Rng } from "../src/sim/math.ts";
import { createGame, runGame } from "../src/sim/scenarios.ts";

test("xorshift32 matches the reference sequence for seed 1", () => {
  const r = new Rng(1);
  assert.deepEqual([r.next(), r.next(), r.next()], [270369, 67634689, 2647435461]);
});

test("idiv truncates toward zero like GDScript", () => {
  assert.equal(idiv(7, 2), 3);
  assert.equal(idiv(-7, 2), -3);
  assert.equal(idiv(-724 * 51, 1024), -36);
});

test("isqrt", () => {
  assert.deepEqual([0, 1, 3, 4, 99, 100, 400].map(isqrt), [0, 1, 1, 2, 9, 10, 20]);
});

test("dir16 sectors", () => {
  assert.equal(dir16(1, 0), 0);
  assert.equal(dir16(1, 1), 2);
  assert.equal(dir16(0, 1), 4);
  assert.equal(dir16(-1, 1), 6);
  assert.equal(dir16(-1, 0), 8);
  assert.equal(dir16(-1, -1), 10);
  assert.equal(dir16(0, -1), 12);
  assert.equal(dir16(1, -1), 14);
  assert.equal(dir16(100, 19), 0);
  assert.equal(dir16(100, 20), 1);
  assert.equal(dir16(-100, -20), 9);
  assert.equal(dir16(0, 0), 0);
});

test("fnvWord equals byte-wise FNV-1a computed with BigInt", () => {
  const words = [0, 1, 255, 256, 180223, 0x7fffffff];
  let h = FNV_OFFSET;
  let ref = 2166136261n;
  for (const w of words) {
    h = fnvWord(h, w);
    for (let s = 0; s < 32; s += 8) {
      ref ^= BigInt((w >>> s) & 255);
      ref = (ref * 16777619n) & 0xffffffffn;
    }
  }
  assert.equal(h, Number(ref));
  assert.equal(hex8(0xabc), "00000abc");
});

test("map: about 20 % obstacles, spawns and centre open, everything reachable", () => {
  const map = generateMap(MAP_SEED);
  const pct = (countBlocked(map) * 100) / (MAP_SIZE * MAP_SIZE);
  assert.ok(pct >= 20 && pct < 24, `obstacles ${pct.toFixed(1)} %`);
  for (const [x, y] of [...SPAWN_BATTLE, ...SPAWN_CORNER, [CENTER, CENTER]]) {
    assert.equal(map.blocked[y * MAP_SIZE + x], 0);
  }
  const field = buildFlowField(map, CENTER * MAP_SIZE + CENTER);
  for (let c = 0; c < MAP_SIZE * MAP_SIZE; c++) {
    if (map.blocked[c] === 0) assert.ok(field.dist[c] < 0x3fffffff, `cell ${c} unreachable`);
  }
  assert.deepEqual(generateMap(MAP_SEED).blocked, map.blocked);
});

test("flow field: following directions from every open cell reaches the destination", () => {
  const map = generateMap(MAP_SEED);
  const dest = nearestOpen(map, 150, 30);
  const field = buildFlowField(map, dest);
  assert.equal(field.dist[dest], 0);
  assert.equal(field.dir[dest], NO_DIR);
  for (let c = 0; c < MAP_SIZE * MAP_SIZE; c += 37) {
    if (map.blocked[c] === 1) continue;
    let cur = c;
    for (let steps = 0; cur !== dest; steps++) {
      assert.ok(steps < MAP_SIZE * 4, `loop from ${c}`);
      const k = field.dir[cur];
      assert.notEqual(k, NO_DIR);
      const next = cur + DIR8_DY[k] * MAP_SIZE + DIR8_DX[k];
      assert.ok(field.dist[next] < field.dist[cur]);
      cur = next;
    }
  }
});

test("same game twice gives the same hashes; the command log replays exactly", () => {
  for (const mode of ["scripted", "ai", "measure"] as const) {
    const a = createGame(mode);
    const ha = runGame(a, 600);
    const hb = runGame(createGame(mode), 600);
    assert.deepEqual(ha, hb, mode);
    const replay = runGame(createGame(mode, a.sim.log.map((c) => ({ ...c }))), 600);
    assert.deepEqual(replay, ha, `${mode} replay`);
    assert.equal(ha[0].count, 400);
  }
});

test("reinforcements top every team back up to 100 on the wave tick", () => {
  const g = createGame("measure");
  runGame(g, 400);
  const before = g.sim.aliveByTeam();
  assert.ok(before.some((n) => n < 100), "some units should have died by tick 400");
  g.control?.(g.sim);
  g.sim.step(); // tick 400 is a wave
  const after = g.sim.aliveByTeam();
  assert.ok(after.every((n) => n >= 90), `after wave ${after}`);
});
