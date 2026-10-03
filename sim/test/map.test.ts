import assert from "node:assert/strict";
import { test } from "node:test";
import { Game } from "../src/core/game.ts";
import { generateMap, MAP_SIZE } from "../src/core/map.ts";
import { TOWNS } from "../src/core/rules.ts";
import { CELL_SHIFT, NEUTRAL, NodeKind, Terrain, TownSize, UnitType } from "../src/protocol.ts";

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

test("the two shared towns and the crystal vein sit on the axis, equally far from both starts", () => {
  const shared = m.towns.filter((t) => t.id < 2);
  assert.deepEqual(shared.map((t) => t.size), [TownSize.Small, TownSize.Large]);
  for (const t of shared) assert.equal(t.cellX, t.cellY);
  const vein = m.nodes.filter((s) => s.kind === NodeKind.CrystalVein);
  assert.equal(vein.length, 4);
  assert.equal(vein.reduce((a, s) => a + s.amount, 0), 600);
  for (const v of vein) assert.ok(Math.abs(v.cellX - v.cellY) <= 1);
  const [a, b] = m.spawns;
  for (const t of shared) {
    const da = (t.cellX - a.cellX) ** 2 + (t.cellY - a.cellY) ** 2;
    const db = (t.cellX - b.cellX) ** 2 + (t.cellY - b.cellY) ** 2;
    assert.equal(da, db);
  }
});

test("each player has a small town of its own near its main city, the mirror image of the other's (round 4)", () => {
  assert.equal(m.towns.length, 4);
  assert.deepEqual(m.towns.map((t) => t.id), [0, 1, 2, 3]);
  const [own0, own1] = [m.towns[2], m.towns[3]];
  assert.deepEqual([own1.cellX, own1.cellY, own1.size, own1.radius], [own0.cellY, own0.cellX, own0.size, own0.radius]);
  assert.equal(own0.size, TownSize.Small);
  // Player p's town is nearer p's start than the other's, and off the axis.
  for (const [p, t] of [[0, own0], [1, own1]] as const) {
    const d = (s: { cellX: number; cellY: number }) => (t.cellX - s.cellX) ** 2 + (t.cellY - s.cellY) ** 2;
    assert.ok(d(m.spawns[p]) * 4 < d(m.spawns[1 - p]), `town ${t.id}`);
    assert.notEqual(t.cellX, t.cellY);
  }
});

test("at the start the militia of every town stand as mirror images, and every town is reachable from both main cities", () => {
  const g = new Game({ seed: 1, scenario: "standard" });
  const w = g.w;
  const u = w.units.col;
  const posts = m.towns.map(() => [] as string[]);
  const mirrored = m.towns.map(() => [] as string[]);
  for (let s = 0; s < w.units.count; s++) {
    if (u.owner[s] !== NEUTRAL || u.type[s] !== UnitType.Militia) continue;
    const [x, y] = [u.x[s] >> CELL_SHIFT, u.y[s] >> CELL_SHIFT];
    posts[u.home[s]].push(`${x},${y}`);
    mirrored[u.home[s]].push(`${y},${x}`);
  }
  assert.deepEqual(posts.map((c) => c.length), m.towns.map((t) => TOWNS[t.size].militia));
  for (const t of [0, 1]) assert.deepEqual(mirrored[t].sort(), posts[t].sort(), `town ${t} mirrors onto itself`);
  assert.deepEqual(mirrored[3].sort(), posts[2].sort(), "town 3's militia mirror town 2's");
  // Every militia post and every open cell of every town is reachable on foot (buildings block
  // too) from the cells around each main city.
  for (const spawn of m.spawns) {
    const seen = new Uint8Array(n * n);
    const q: number[] = [];
    for (let y = spawn.cellY - 1; y <= spawn.cellY + 4; y++) {
      for (let x = spawn.cellX - 1; x <= spawn.cellX + 4; x++) {
        if (!w.walkable(x, y) || seen[y * n + x] === 1) continue;
        seen[y * n + x] = 1;
        q.push(y * n + x);
      }
    }
    assert.ok(q.length > 0);
    while (q.length > 0) {
      const c = q.pop() as number;
      const x = c % n;
      const y = Math.trunc(c / n);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (!w.walkable(nx, ny) || seen[ny * n + nx] === 1) continue;
        seen[ny * n + nx] = 1;
        q.push(ny * n + nx);
      }
    }
    for (const t of m.towns) {
      let inside = 0;
      for (let y = t.cellY - t.radius; y <= t.cellY + t.radius; y++) {
        for (let x = t.cellX - t.radius; x <= t.cellX + t.radius; x++) {
          if ((x - t.cellX) ** 2 + (y - t.cellY) ** 2 > t.radius * t.radius || !w.walkable(x, y)) continue;
          assert.equal(seen[y * n + x], 1, `cell ${x},${y} of town ${t.id} from ${spawn.cellX},${spawn.cellY}`);
          inside++;
        }
      }
      assert.ok(inside >= 60, `town ${t.id}: ${inside} open cells`);
      for (const c of posts[t.id]) {
        const [x, y] = c.split(",").map(Number);
        assert.equal(seen[y * n + x], 1, `militia post ${c} of town ${t.id} from ${spawn.cellX},${spawn.cellY}`);
      }
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
