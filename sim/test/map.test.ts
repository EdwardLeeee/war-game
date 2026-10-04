import assert from "node:assert/strict";
import { test } from "node:test";
import { Game } from "../src/core/game.ts";
import { generateMap, MAP_SIZE } from "../src/core/map.ts";
import { TOWNS } from "../src/core/rules.ts";
import { NodeKind, Terrain, TownSize, UnitType } from "../src/protocol.ts";

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
  assert.equal(m.towns.length, 4);
});

test("round 6 (D-054): small towns in the top-left and bottom-right corners, after the two old ones", () => {
  assert.deepEqual(
    m.towns.map((t) => [t.id, t.size, t.cellX, t.cellY]),
    [
      [0, TownSize.Small, 29, 29],
      [1, TownSize.Large, 48, 48],
      [2, TownSize.Small, 14, 14],
      [3, TownSize.Small, 81, 81],
    ],
  );
  // Nothing within the town's radius but open ground.
  for (const t of m.towns.slice(2)) {
    for (let y = t.cellY - t.radius; y <= t.cellY + t.radius; y++) {
      for (let x = t.cellX - t.radius; x <= t.cellX + t.radius; x++) {
        if ((x - t.cellX) ** 2 + (y - t.cellY) ** 2 > t.radius * t.radius) continue;
        assert.equal(m.terrain[y * n + x], Terrain.Open, `${x},${y}`);
        assert.ok(!m.nodes.some((s) => s.cellX === x && s.cellY === y), `node at ${x},${y}`);
      }
    }
  }
});

test("every town is reachable from both starts, and its militia stand mirror-symmetric", () => {
  const blocked = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) blocked[i] = m.terrain[i] === Terrain.Blocked ? 1 : 0;
  for (const s of m.nodes) blocked[s.cellY * n + s.cellX] = 1;
  for (const start of m.spawns) {
    const seen = new Uint8Array(n * n);
    const q = [start.cellY * n + start.cellX];
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
    for (const t of m.towns) assert.equal(seen[t.cellY * n + t.cellX], 1, `town ${t.id} from player ${start.player}`);
  }
  const g = new Game({ seed: 1, scenario: "standard" });
  const u = g.w.units.col;
  for (const t of m.towns) {
    const at: string[] = [];
    for (let s = 0; s < g.w.units.count; s++) if (u.type[s] === UnitType.Militia && u.home[s] === t.id) at.push(`${u.x[s]},${u.y[s]}`);
    assert.equal(at.length, TOWNS[t.size].militia, `town ${t.id}`);
    const set = new Set(at);
    for (const p of at) {
      const [x, y] = p.split(",");
      assert.ok(set.has(`${y},${x}`), `town ${t.id}: mirror of ${p}`);
    }
  }
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
