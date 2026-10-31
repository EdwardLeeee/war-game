// 雙河關 ("twin-rivers"; the user 2026-10-31): one map fixed as data, the map of the user's game 8d02b76f. Its cells and
// resources stay what they are whatever happens to the random generator or to RICH's values.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { Game } from "../src/core/game.ts";
import { KEEP } from "../src/core/keep.ts";
import { twinRiversMap } from "../src/core/twin-rivers.ts";
import { toCanon } from "../src/frame.ts";
import { NEUTRAL, NodeKind, Terrain, TownSize } from "../src/protocol.ts";
import { Runner } from "../src/runner.ts";
import { mapInfo } from "../src/view/view.ts";
import { switchedOff, switchedOn } from "./helpers.ts";

/** What the map is made of: terrain, resources, towns, starts, the big city's keep. */
function digest(m: ReturnType<typeof twinRiversMap>): string {
  const h = createHash("sha256");
  h.update(m.terrain);
  h.update(JSON.stringify([m.nodes, m.towns, m.spawns, m.tower, m.towerSize, m.posts]));
  return h.digest("hex").slice(0, 16);
}

test("twin-rivers is locked: cells and resources by hash; two rivers' worth of water, 4 crossings, an adjacent layout", switchedOn(KEEP, () => {
  const m = twinRiversMap(2);
  assert.equal(digest(m), "ccd9a10bfe59388e");
  const count = (t: number) => m.terrain.reduce((a, v) => a + (v === t ? 1 : 0), 0);
  assert.deepEqual([m.size, m.layout, m.towns.length, m.towerSize], [129, "adjacent", 7, 3]);
  assert.deepEqual([count(Terrain.Water), count(Terrain.Cliff)], [366, 26]);
  assert.equal(count(Terrain.Ford) + count(Terrain.BridgeNS) + count(Terrain.BridgeEW), 36, "4 crossings of 9 cells");
  assert.deepEqual(m.towns.filter((t) => t.size === TownSize.Large).map((t) => [t.cellX, t.cellY]), [[68, 64]]);
  assert.ok(m.nodes.filter((x) => x.kind === NodeKind.GoldMine).every((x) => x.amount === 600));
}));

test("an odd seed swaps the two starts and their frames, nothing else; each start is the other's mirror image", switchedOn(KEEP, () => {
  const even = twinRiversMap(10);
  const odd = twinRiversMap(11);
  assert.deepEqual(odd.spawns.map((s) => [s.player, s.cellX, s.cellY]), [[0, even.spawns[1].cellX, even.spawns[1].cellY], [1, even.spawns[0].cellX, even.spawns[0].cellY]]);
  assert.deepEqual(odd.frames, [even.frames[1], even.frames[0]]);
  assert.deepEqual([odd.terrain, odd.nodes, odd.towns, odd.tower, odd.mirror], [even.terrain, even.nodes, even.towns, even.tower, even.mirror]);
  const mir = (x: number, y: number) => toCanon(even.mirror, x, y);
  const q = mir(even.spawns[0].cellX, even.spawns[0].cellY - 1);
  assert.deepEqual([q.u, q.v], [even.spawns[1].cellX, even.spawns[1].cellY]);
  // Every node and town has its mirror image.
  const at = new Set(even.nodes.map((s) => `${s.kind}:${s.cellX},${s.cellY}`));
  for (const s of even.nodes) {
    const p = mir(s.cellX, s.cellY);
    assert.ok(at.has(`${s.kind}:${p.u},${p.v}`), `node ${s.cellX},${s.cellY}`);
  }
}));

test("a game on it: both seeds' starts, buildings and units mirror images; each player starts knowing its own main city only", switchedOn(KEEP, () => {
  for (const seed of [4, 5]) {
    const g = new Game({ seed, scenario: "standard", map: "twin-rivers" });
    const w = g.w;
    const m = w.map;
    const home = m.spawns.map((s) => w.buildings.col.cellX[w.mainCity(s.player)]);
    assert.deepEqual(home, [16, 16], "both on the left");
    const b = w.buildings.col;
    const other = (o: number) => (o === NEUTRAL ? NEUTRAL : 1 - o);
    const cells = new Set<string>();
    for (let s = 0; s < w.buildings.count; s++) cells.add(`${b.type[s]}:${b.owner[s]}:${b.cellX[s]}`);
    for (let s = 0; s < w.buildings.count; s++) assert.ok(cells.has(`${b.type[s]}:${other(b.owner[s])}:${b.cellX[s]}`), `building ${s}`);
    const info = mapInfo(m, 0);
    assert.deepEqual([info.mode, info.towns.length, info.spawns.length], ["random", 0, 1]);
  }
}));

test("a log says twin-rivers, and replays to the same hashes", switchedOn(KEEP, () => {
  const r = new Runner({ seed: 7, scenario: "standard", ai: [true, true], maxTicks: 1200, difficulty: ["hard", "hard"], map: "twin-rivers" });
  while (!r.over && r.game.tick < 1200) r.tick();
  assert.equal(r.header([true, true]).map, "twin-rivers");
  const rp = new Runner({ seed: 7, scenario: "standard", ai: [false, false], replay: r.game.log, maxTicks: 1200, map: "twin-rivers" });
  while (!rp.over && rp.game.tick < r.game.tick) rp.tick();
  assert.deepEqual(rp.hashes, r.hashes);
}));

test("KEEP off: no twin-rivers (its walls are D-100's)", switchedOff(KEEP, () => {
  assert.throws(() => twinRiversMap(1), /KEEP/);
}));
