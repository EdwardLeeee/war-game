import assert from "node:assert/strict";
import test from "node:test";

import { fillOpening, type WallStand, wallStandAt } from "../src/render/wall-stand.ts";

const N = 10;
const T = 32;
const at = (x: number, y: number) => y * N + x;

test("城門上方（D-119）：門洞沒有站位的格子照兩邊門柱補上，高度用城門的走道，深度用城門的", () => {
  // A gate along y = 4, x 2..6: piers at x 2 and 6, its opening x 3..5.
  const stand = new Map<number, WallStand>([
    [at(2, 4), { z: 7, walkM: 4.8, dx: 0, dy: 10 }],
    [at(6, 4), { z: 7, walkM: 4.8, dx: 0, dy: 10 }],
  ]);
  fillOpening(stand, [at(3, 4), at(4, 4), at(5, 4)], N, 9, 4.8);
  for (const x of [3, 4, 5]) assert.deepEqual(stand.get(at(x, 4)), { z: 9, walkM: 4.8, dx: 0, dy: 10 }, `x ${x}`);
  // Without the gate's own walk: the piers' height.
  const low = new Map<number, WallStand>([[at(2, 4), { z: 1, walkM: 3, dx: 2, dy: 0 }]]);
  fillOpening(low, [at(3, 4), at(4, 4)], N, 1, undefined);
  assert.equal(low.get(at(4, 4))?.walkM, 3);
  // A point of its own is kept; cells with nothing next to them stay off.
  const own = new Map<number, WallStand>([[at(3, 4), { z: 1, walkM: 6, dx: 0, dy: 0 }]]);
  fillOpening(own, [at(3, 4), at(8, 8)], N, 1, 4);
  assert.equal(own.get(at(3, 4))?.walkM, 6);
  assert.equal(own.has(at(8, 8)), false);
});

test("沿著牆走（D-119）：在格子中間就是那格的站位；走到兩格交界是兩格的一半，不會跳", () => {
  const stand = new Map<number, WallStand>([
    [at(3, 4), { z: 1, walkM: 4, dx: 0, dy: 10 }],
    [at(4, 4), { z: 2, walkM: 6, dx: 0, dy: 20 }],
  ]);
  assert.deepEqual(wallStandAt(stand, N, T, 3.5 * T, 4.5 * T), { z: 1, walkM: 4, dx: 0, dy: 10 });
  const a = wallStandAt(stand, N, T, 4 * T - 0.001, 4.5 * T);
  const b = wallStandAt(stand, N, T, 4 * T, 4.5 * T);
  assert.ok(a !== null && b !== null);
  assert.ok(Math.abs(a.walkM - 5) < 0.01 && Math.abs(b.walkM - 5) < 0.01, `${a.walkM} ${b.walkM}`);
  assert.ok(Math.abs(a.dy - 15) < 0.01 && Math.abs(b.dy - 15) < 0.01);
  assert.equal(a.z, 1);
  assert.equal(b.z, 2);
  // A quarter of the way to the next cell; towards a cell off the walls: its own cell's.
  assert.equal(wallStandAt(stand, N, T, 3.75 * T, 4.5 * T)?.walkM, 4.5);
  assert.deepEqual(wallStandAt(stand, N, T, 3.1 * T, 4.5 * T), { z: 1, walkM: 4, dx: 0, dy: 10 });
  // Off the walls and off the map.
  assert.equal(wallStandAt(stand, N, T, 5.5 * T, 4.5 * T), null);
  assert.equal(wallStandAt(stand, N, T, -1, 4.5 * T), null);
});
