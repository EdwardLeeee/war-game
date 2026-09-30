import assert from "node:assert/strict";
import { test } from "node:test";
import { generateMap, MAP_SIZE } from "../src/core/map.ts";
import { NodeKind, Terrain } from "../src/protocol.ts";

const m = generateMap();
const n = MAP_SIZE;

test("the map is the same every time", () => {
  const again = generateMap();
  assert.deepEqual(again.terrain, m.terrain);
  assert.deepEqual(again.nodes, m.nodes);
});

test("mirror-symmetric across the main diagonal", () => {
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) assert.equal(m.terrain[y * n + x], m.terrain[x * n + y]);
  const key = (k: number, x: number, y: number, a: number) => `${k}:${x}:${y}:${a}`;
  const set = new Set(m.nodes.map((s) => key(s.kind, s.cellX, s.cellY, s.amount)));
  for (const s of m.nodes) assert.ok(set.has(key(s.kind, s.cellY, s.cellX, s.amount)), `mirror of ${s.cellX},${s.cellY}`);
  assert.deepEqual([m.spawns[1].cellX, m.spawns[1].cellY], [m.spawns[0].cellY, m.spawns[0].cellX]);
});

test("towns and the crystal vein sit on the axis, equally far from both starts", () => {
  for (const t of m.towns) assert.equal(t.cellX, t.cellY);
  const vein = m.nodes.filter((s) => s.kind === NodeKind.CrystalVein);
  assert.equal(vein.length, 4);
  assert.equal(vein.reduce((a, s) => a + s.amount, 0), 600);
  for (const v of vein) assert.ok(Math.abs(v.cellX - v.cellY) <= 1);
  const [a, b] = m.spawns;
  for (const t of m.towns) {
    const da = (t.cellX - a.cellX) ** 2 + (t.cellY - a.cellY) ** 2;
    const db = (t.cellX - b.cellX) ** 2 + (t.cellY - b.cellY) ** 2;
    assert.equal(da, db);
  }
  assert.equal(m.towns.length, 2);
});

test("every open, node-free cell is reachable from player 0's start", () => {
  const blocked = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) blocked[i] = m.terrain[i] === Terrain.Blocked ? 1 : 0;
  for (const s of m.nodes) blocked[s.cellY * n + s.cellX] = 1;
  const seen = new Uint8Array(n * n);
  const q = [m.spawns[0].cellY * n + m.spawns[0].cellX];
  seen[q[0]] = 1;
  while (q.length > 0) {
    const c = q.pop() as number;
    const x = c % n;
    for (const nb of [x + 1 < n ? c + 1 : -1, x > 0 ? c - 1 : -1, c + n < n * n ? c + n : -1, c - n]) {
      if (nb < 0 || blocked[nb] === 1 || seen[nb] === 1) continue;
      seen[nb] = 1;
      q.push(nb);
    }
  }
  for (let i = 0; i < n * n; i++) if (blocked[i] === 0) assert.equal(seen[i], 1, `cell ${i % n},${Math.trunc(i / n)}`);
  const rock = m.terrain.reduce((a, v) => a + v, 0) / (n * n);
  assert.ok(rock < 0.3, `rock ${rock}`);
});
