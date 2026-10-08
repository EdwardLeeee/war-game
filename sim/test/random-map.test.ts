// Random maps (D-074): the same seed gives the same map; both sides see the same map through
// their frames; every town and resource can be reached; a player starts knowing only its home.

import assert from "node:assert/strict";
import test from "node:test";
import { type Frame, IDENTITY, MIRROR_XY, footprintCentre, fromCanon, toCanon } from "../src/frame.ts";
import { Game } from "../src/core/game.ts";
import { generateMap } from "../src/core/map.ts";
import { generateRandomMap, RANDOM_MAP, type RandomMap } from "../src/core/random-map.ts";
import { BUILDINGS, rules, TOWNS } from "../src/core/rules.ts";
import { BuildingType, CELL, CELL_SHIFT, NEUTRAL, NODE_STRIDE, NodeField, NodeKind, Order, PlaceBit, Terrain, TOWN_STRIDE, TownField, TownSize, UnitType } from "../src/protocol.ts";
import { buildView, mapInfo } from "../src/view/view.ts";
import { cmd, put, slotOf } from "./helpers.ts";

const SEEDS = Array.from({ length: 40 }, (_, k) => k + 1);

/** One character per cell: rock, open, or the node's kind. */
function cells(m: RandomMap): string[] {
  const out: string[] = [];
  for (let i = 0; i < m.size * m.size; i++) out.push(m.terrain[i] === Terrain.Blocked ? "#" : ".");
  for (const s of m.nodes) out[s.cellY * m.size + s.cellX] = String(s.kind);
  return out;
}

function rectCanon(f: Frame, x: number, y: number, s: number): string {
  const p = toCanon(f, x, y);
  const q = toCanon(f, x + s - 1, y + s - 1);
  return `${Math.min(p.u, q.u)},${Math.min(p.v, q.v)}`;
}

test("the same seed gives the same map; the side is odd (129 for 128)", () => {
  const a = generateRandomMap(7);
  const b = generateRandomMap(7);
  assert.deepEqual(a, b);
  assert.notDeepEqual(generateRandomMap(8).terrain, a.terrain);
  assert.equal(a.size, RANDOM_MAP.size);
  assert.equal(generateRandomMap(7, 128).size, 129);
  assert.equal(generateRandomMap(7, 112).size, 113);
});

test("both sides see the same map through their frames", () => {
  const maps = [...SEEDS.map((s) => generateRandomMap(s)), ...[1, 2, 3, 4].flatMap((s) => [generateRandomMap(s, 97), generateRandomMap(s, 113)])];
  const layouts = new Set<string>();
  for (const m of maps) {
    const n = m.size;
    const c = cells(m);
    const [f0, f1] = m.frames;
    layouts.add(m.layout);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const r = toCanon(m.mirror, x, y);
        assert.equal(c[y * n + x], c[r.v * n + r.u], `seed ${m.seed}: (${x}, ${y}) and its mirror image`);
        const p = fromCanon(f0, x, y);
        const q = fromCanon(f1, x, y);
        assert.equal(c[p.y * n + p.x], c[q.y * n + q.x], `seed ${m.seed}: canonical (${x}, ${y})`);
      }
    }
    const [s0, s1] = m.spawns;
    assert.equal(rectCanon(f0, s0.cellX - 2, s0.cellY - 2, 4), rectCanon(f1, s1.cellX - 2, s1.cellY - 2, 4), `seed ${m.seed}: main cities`);
    // Each player starts bottom-left in its own canonical frame.
    const home = toCanon(f0, s0.cellX, s0.cellY);
    assert.ok(home.u < n / 4 && home.v > (3 * n) / 4, `seed ${m.seed}: canonical home bottom-left`);
    const towns = (f: Frame) => m.towns.map((t) => `${t.size}:${JSON.stringify(toCanon(f, t.cellX, t.cellY))}`).sort().join(" ");
    assert.equal(towns(f0), towns(f1), `seed ${m.seed}: towns`);
    // Militia posts: the first 3, 6 and 12 closed under the mirror.
    const [a, b, cc, d] = m.mirror.m;
    const posts = m.posts!;
    for (const k of [3, 6, 12]) {
      const set = new Set(posts.slice(0, k).map((p) => `${p[0]},${p[1]}`));
      for (const [dx, dy] of posts.slice(0, k)) assert.ok(set.has(`${a * dx + b * dy},${cc * dx + d * dy}`), `seed ${m.seed}: post ${dx},${dy} of the first ${k}`);
    }
    // The big city's tower is its own mirror image: 2 x 2 on the diagonal, 3 x 3 on a vertical midline.
    const ts = m.towerSize ?? 2;
    assert.equal(ts, m.layout === "diagonal" ? 2 : 3, `seed ${m.seed}: tower size`);
    assert.equal(rectCanon(f0, m.tower.cellX, m.tower.cellY, ts), rectCanon(f1, m.tower.cellX, m.tower.cellY, ts), `seed ${m.seed}: tower`);
  }
  assert.deepEqual([...layouts].sort(), ["adjacent", "diagonal"]);
});

test("7 towns: the big city on the axis, each side's home town 26-34 cells away, centres 20 apart", () => {
  for (const s of SEEDS) {
    const m = generateRandomMap(s);
    assert.equal(m.towns.length, 7);
    const large = m.towns.filter((t) => t.size === TownSize.Large);
    assert.equal(large.length, 1);
    const l = toCanon(m.mirror, large[0].cellX, large[0].cellY);
    assert.deepEqual([l.u, l.v], [large[0].cellX, large[0].cellY], `seed ${s}: the big city is its own mirror image`);
    for (const t of m.towns) assert.equal(t.radius, TOWNS[t.size].radius);
    // Distances in half cells: a main city's centre is a cell corner, a town's a cell centre.
    const d2 = (sp: { cellX: number; cellY: number }, t: { cellX: number; cellY: number }) => (2 * sp.cellX - 2 * t.cellX - 1) ** 2 + (2 * sp.cellY - 2 * t.cellY - 1) ** 2;
    for (const sp of m.spawns) {
      const near = Math.min(...m.towns.filter((t) => t.size === TownSize.Small).map((t) => d2(sp, t)));
      assert.ok(near >= 4 * 26 * 26 && near <= 4 * 34 * 34, `seed ${s}: home town ${Math.sqrt(near) / 2}`);
    }
    for (const t of m.towns) for (const u of m.towns) if (t !== u) assert.ok((t.cellX - u.cellX) ** 2 + (t.cellY - u.cellY) ** 2 >= 400, `seed ${s}: towns ${t.id}, ${u.id}`);
    const vein = m.nodes.filter((x) => x.kind === NodeKind.CrystalVein);
    assert.equal(vein.length, 4, `seed ${s}: one crystal vein`);
  }
});

test("every town, the other main city and every resource can be reached", () => {
  for (const s of SEEDS) {
    const m = generateRandomMap(s);
    const n = m.size;
    const node = new Int8Array(n * n).fill(-1);
    for (const x of m.nodes) node[x.cellY * n + x.cellX] = x.kind;
    const open = (i: number) => m.terrain[i] === Terrain.Open && node[i] === -1;
    const seen = new Uint8Array(n * n);
    const queue = [m.spawns[0].cellY * n + m.spawns[0].cellX];
    seen[queue[0]] = 1;
    while (queue.length > 0) {
      const c = queue.pop()!;
      const x = c % n;
      const y = (c - x) / n;
      for (const nb of [x + 1 < n ? c + 1 : -1, x > 0 ? c - 1 : -1, y + 1 < n ? c + n : -1, y > 0 ? c - n : -1]) {
        if (nb >= 0 && seen[nb] === 0 && open(nb)) {
          seen[nb] = 1;
          queue.push(nb);
        }
      }
    }
    assert.equal(seen[m.spawns[1].cellY * n + m.spawns[1].cellX], 1, `seed ${s}: the other main city`);
    for (const t of m.towns) assert.equal(seen[t.cellY * n + t.cellX], 1, `seed ${s}: town ${t.id}`);
    // Every mine, bush and vein cell beside a reachable cell, or inside a block of its kind.
    for (const x of m.nodes) {
      if (x.kind === NodeKind.Tree) continue;
      const nbs = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [x.cellX + dx, x.cellY + dy]).filter(([a, b]) => a >= 0 && b >= 0 && a < n && b < n);
      const reach = nbs.some(([a, b]) => seen[b * n + a] === 1);
      const inside = nbs.length === 4 && nbs.every(([a, b]) => node[b * n + a] === x.kind);
      assert.ok(reach || inside, `seed ${s}: ${x.kind} at ${x.cellX},${x.cellY}`);
    }
  }
});

test("a player starts knowing only its home; towns and rock come with exploring", () => {
  const g = new Game({ seed: 5, scenario: "standard", map: "random" });
  const m = g.w.map;
  const n = m.size;
  const info = mapInfo(m, 0);
  assert.equal(info.mode, "random");
  assert.deepEqual(info.spawns, [m.spawns[0]]);
  assert.deepEqual(info.towns, []);
  assert.ok(info.terrain.every((t) => t === Terrain.Open));
  const all = mapInfo(m, null);
  assert.deepEqual(all.towns, m.towns);
  assert.equal(all.spawns.length, 2);
  assert.equal(mapInfo(generateMap(), 0).towns.length, 4, "the fixed map is known whole");

  const v = buildView(g, 0);
  assert.equal(v.towns.length, 0, "no town explored yet");
  const exp = g.fog.explored[0];
  let hiddenRock = 0;
  for (let i = 0; i < n * n; i++) {
    if (exp[i] === 1 || m.terrain[i] !== Terrain.Blocked) continue;
    hiddenRock++;
    assert.equal(v.placement[i] & PlaceBit.Blocked, 0, `unexplored rock at ${i % n},${Math.trunc(i / n)} is not shown`);
    assert.notEqual(v.placement[i] & PlaceBit.Unexplored, 0);
  }
  assert.ok(hiddenRock > 100, "there is rock out there");
  for (let i = 0; i < n * n; i++) if (exp[i] === 1 && m.terrain[i] === Terrain.Blocked) assert.notEqual(v.placement[i] & PlaceBit.Blocked, 0);
  for (let r = 0; r < v.nodes.length; r += NODE_STRIDE) assert.equal(exp[v.nodes[r + NodeField.cellY] * n + v.nodes[r + NodeField.cellX]], 1, "only nodes seen");
  // A spectator sees every town, with its place and size in the row.
  const all0 = buildView(g, null);
  assert.equal(all0.towns.length, m.towns.length * TOWN_STRIDE);
  for (let r = 0; r < all0.towns.length; r += TOWN_STRIDE) {
    const t = m.towns[all0.towns[r + TownField.id]];
    assert.deepEqual([all0.towns[r + TownField.cellX], all0.towns[r + TownField.cellY], all0.towns[r + TownField.size]], [t.cellX, t.cellY, t.size]);
  }
  // Player 0 explores its home town: its row comes with the place.
  const home = m.towns.filter((t) => t.size === TownSize.Small).sort((a, b) => (a.cellX - m.spawns[0].cellX) ** 2 + (a.cellY - m.spawns[0].cellY) ** 2 - (b.cellX - m.spawns[0].cellX) ** 2 - (b.cellY - m.spawns[0].cellY) ** 2)[0];
  put(g, 0, UnitType.Spearman, home.cellX, home.cellY + 1);
  g.fog.update(g.w);
  const v2 = buildView(g, 0);
  const row = v2.towns.findIndex((_, k) => k % TOWN_STRIDE === TownField.id && v2.towns[k] === home.id);
  assert.ok(row >= 0, "the home town is in the view once seen");
  assert.deepEqual([v2.towns[row - TownField.id + TownField.cellX], v2.towns[row - TownField.id + TownField.cellY]], [home.cellX, home.cellY]);
});

test("random maps take the standard scenario only, and a person cannot play one yet", () => {
  assert.throws(() => new Game({ seed: 1, scenario: "e2e", map: "random" }), /fixed map only/);
});

test("footprint centres: the old cell on the fixed map, the mirror cell on a random one", () => {
  for (const size of [2, 3, 4]) {
    for (const [x, y] of [[10, 70], [40, 3], [0, 0]]) {
      for (const f of [IDENTITY, MIRROR_XY]) {
        const c = footprintCentre(f, x, y, size);
        assert.deepEqual(c, { x: x + (size >> 1), y: y + (size >> 1) }, `size ${size} at ${x},${y}`);
      }
    }
  }
  // On an adjacent map, a footprint and its mirror image give mirror-image centres.
  const m = [1, 2, 3, 4, 5, 6].map((s) => generateRandomMap(s)).find((x) => x.layout === "adjacent")!;
  for (const size of [2, 4]) {
    const [x, y] = [m.spawns[0].cellX + 6, m.spawns[0].cellY - 5];
    const p = toCanon(m.mirror, x, y);
    const q = toCanon(m.mirror, x + size - 1, y + size - 1);
    const a = footprintCentre(m.frames[0], x, y, size);
    const b = footprintCentre(m.frames[1], Math.min(p.u, q.u), Math.min(p.v, q.v), size);
    const am = toCanon(m.mirror, a.x, a.y);
    assert.deepEqual({ x: am.u, y: am.v }, b, `size ${size}`);
  }
});

/** Fixed-point mirror image of a position, through a cell frame. */
function mirrorPos(f: Frame, x: number, y: number): { x: number; y: number } {
  const [a, b, c, d] = f.m;
  const h = CELL >> 1;
  return {
    x: a * x + b * y + f.t[0] * CELL + h - (a + b) * h,
    y: c * x + d * y + f.t[1] * CELL + h - (c + d) * h,
  };
}

test("on an adjacent random map, a unit and its mirror image walk mirror-image paths, tick by tick", () => {
  const seed = [1, 2, 3, 4, 5, 6, 7, 8].find((s) => generateRandomMap(s).layout === "adjacent")!;
  const g = new Game({ seed, scenario: "standard", map: "random" });
  const w = g.w;
  for (let s = 0; s < w.units.count; s++) w.unitSlot[w.units.col.id[s]] = -1;
  w.units.count = 0;
  const m = w.map as RandomMap;
  const n = m.size;
  const mir = (x: number, y: number) => {
    const r = toCanon(m.mirror, x, y);
    return { x: r.u, y: r.v };
  };
  // From near player 0's home to its home town, and the mirror image.
  const s0 = m.spawns[0];
  const home = m.towns.filter((t) => t.size === TownSize.Small).sort((a, b) => (a.cellX - s0.cellX) ** 2 + (a.cellY - s0.cellY) ** 2 - (b.cellX - s0.cellX) ** 2 - (b.cellY - s0.cellY) ** 2)[0];
  let from = { x: -1, y: -1 };
  for (let r = 6; r < 12 && from.x < 0; r++) {
    for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r]]) {
      const x = s0.cellX + dx;
      const y = s0.cellY + dy;
      const mm = mir(x, y);
      if (from.x < 0 && x >= 0 && y >= 0 && x < n && y < n && w.walkable(x, y) && w.walkable(mm.x, mm.y)) from = { x, y };
    }
  }
  const to = { x: home.cellX, y: home.cellY };
  const a = put(g, 0, UnitType.Spearman, from.x, from.y);
  const fm = mir(from.x, from.y);
  const b = put(g, 1, UnitType.Spearman, fm.x, fm.y);
  const tm = mir(to.x, to.y);
  cmd(g, 0, { c: "retreat", u: [a], x: to.x, y: to.y });
  cmd(g, 1, { c: "retreat", u: [b], x: tm.x, y: tm.y });
  const u = w.units.col;
  let moved = 0;
  for (let t = 0; t < 900; t++) {
    g.step();
    const sa = slotOf(g, a);
    const sb = slotOf(g, b);
    const want = mirrorPos(m.mirror, u.x[sa], u.y[sa]);
    assert.deepEqual({ x: u.x[sb], y: u.y[sb] }, want, `tick ${g.tick}`);
    if (u.order[sa] === Order.Retreat) moved++;
  }
  assert.ok(moved > 100, "it really travelled");
  assert.ok(Math.abs((u.x[slotOf(g, a)] >> CELL_SHIFT) - to.x) <= 6, "and got there");
});

test("at the start every building and every unit has its mirror image across the axis (both layouts)", () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  const adjacent = seeds.find((s) => generateRandomMap(s).layout === "adjacent")!;
  const diagonal = seeds.find((s) => generateRandomMap(s).layout === "diagonal")!;
  for (const seed of [adjacent, diagonal]) {
    const g = new Game({ seed, scenario: "standard", map: "random" });
    const w = g.w;
    const m = w.map as RandomMap;
    const other = (o: number) => (o === NEUTRAL ? NEUTRAL : 1 - o);
    // Buildings: type, owner (players swapped) and footprint.
    const b = w.buildings.col;
    const rect = (x: number, y: number, size: number) => {
      const p = toCanon(m.mirror, x, y);
      const q = toCanon(m.mirror, x + size - 1, y + size - 1);
      return `${Math.min(p.u, q.u)},${Math.min(p.v, q.v)}`;
    };
    const buildings = new Set<string>();
    for (let s = 0; s < w.buildings.count; s++) buildings.add(`${b.type[s]}:${b.owner[s]}:${b.cellX[s]},${b.cellY[s]}`);
    assert.ok(buildings.size >= 3, "two main cities and the tower");
    for (let s = 0; s < w.buildings.count; s++) {
      const want = `${b.type[s]}:${other(b.owner[s])}:${rect(b.cellX[s], b.cellY[s], w.buildingSize(b.type[s]))}`;
      assert.ok(buildings.has(want), `seed ${seed} (${m.layout}): mirror image of building ${b.id[s]} (${want})`);
    }
    // The tower blocks exactly its footprint, and the rules say how big it is.
    const size = m.layout === "adjacent" ? 3 : 2;
    assert.equal(w.buildingSize(BuildingType.TownTower), size);
    assert.equal(rules(m).buildings[BuildingType.TownTower].size, size);
    assert.equal(rules(m).buildings[BuildingType.TownTower].hp, BUILDINGS[BuildingType.TownTower].hp, "same hp");
    let towerCells = 0;
    for (let s = 0; s < w.buildings.count; s++) if (b.type[s] === BuildingType.TownTower) for (let i = 0; i < w.buildingAt.length; i++) if (w.buildingAt[i] === b.id[s]) towerCells++;
    assert.equal(towerCells, size * size);
    // Units: farmers and every town's militia at mirror-image positions.
    const u = w.units.col;
    const units = new Set<string>();
    for (let s = 0; s < w.units.count; s++) units.add(`${u.type[s]}:${u.owner[s]}:${u.x[s]},${u.y[s]}`);
    let militia = 0;
    for (let s = 0; s < w.units.count; s++) {
      const p = mirrorPos(m.mirror, u.x[s], u.y[s]);
      assert.ok(units.has(`${u.type[s]}:${other(u.owner[s])}:${p.x},${p.y}`), `seed ${seed} (${m.layout}): mirror image of unit ${u.id[s]}`);
      if (u.type[s] === UnitType.Militia) militia++;
    }
    assert.equal(militia, 6 * 6 + 12, "6 small towns of 6 and the big city's 12");
  }
});
