// 野城的城牆 (D-084): where it stands. A small town's in the middle; a big city's right under its
// tower (which stands in the middle), so the two never overlap. The tower always covers the town's
// centre cell, on the fixed map and on random maps of both layouts, so it is seen with the town.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Game } from "../../sim/src/core/game.ts";
import { ruleTower, wallSpot } from "../src/render/town-wall.ts";
import { TownSize } from "../src/sim.ts";
import { TILE_PX } from "../src/tuning.ts";

test("小鎮：3×3 格，在城鎮正中間", () => {
  const s = wallSpot({ cellX: 30, cellY: 66, size: TownSize.Small }, null);
  assert.deepEqual(s, { x: 29 * TILE_PX, y: 65 * TILE_PX, side: 3 * TILE_PX });
});

test("大城：4×4 格，上緣貼著塔的下緣、左右和塔對齊，不重疊；3×3 的塔也一樣", () => {
  const town = { cellX: 48, cellY: 48, size: TownSize.Large };
  for (const size of [2, 3]) {
    const tower = ruleTower(town, size);
    const s = wallSpot(town, tower);
    assert.equal(s.side, 4 * TILE_PX);
    assert.equal(s.y, (tower.cellY + size) * TILE_PX, "top along the tower's foot");
    assert.equal(s.x + s.side / 2, (tower.cellX + size / 2) * TILE_PX, "centred under the tower");
    // Still inside the big city's circle (radius 7), the words under it too (about one cell).
    const far = Math.hypot(s.x + s.side - (town.cellX + 0.5) * TILE_PX, s.y + s.side + TILE_PX - (town.cellY + 0.5) * TILE_PX);
    assert.ok(far < 7 * TILE_PX, `${far / TILE_PX} cells`);
  }
  // Seen elsewhere: under where it really is.
  assert.deepEqual(wallSpot(town, { cellX: 47, cellY: 45, size: 2 }), { x: 46 * TILE_PX, y: 47 * TILE_PX, side: 4 * TILE_PX });
});

test("塔一定蓋住城鎮中心那一格（看到城鎮時就看到塔，城牆不會移動）；固定地圖上規則推算的位置就是塔的位置：隨機地圖對角、相鄰兩種都量", () => {
  const sizes = new Set<number>();
  for (const [map, seeds] of [["fixed", [1]], ["random", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]]] as const) {
    for (const seed of seeds) {
      const g = new Game({ seed, scenario: "standard", map });
      const m = g.w.map;
      const big = m.towns.find((t) => t.size === TownSize.Large);
      if (big === undefined) throw new Error(`no big city (${map} ${seed})`);
      const size = m.towerSize ?? 2;
      sizes.add(size);
      const { cellX: x, cellY: y } = m.tower;
      assert.ok(big.cellX >= x && big.cellX < x + size && big.cellY >= y && big.cellY < y + size, `${map} seed ${seed}: the tower covers the centre`);
      if (map === "fixed") assert.deepEqual(ruleTower(big, size), { cellX: x, cellY: y, size });
      // The wall under the real tower never overlaps it.
      const s = wallSpot({ ...big, size: TownSize.Large }, { cellX: x, cellY: y, size });
      assert.ok(s.y >= (y + size) * TILE_PX, `${map} seed ${seed}`);
    }
  }
  assert.deepEqual([...sizes].sort(), [2, 3], "both towers' sizes seen");
});
