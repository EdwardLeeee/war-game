// Time per tick of 40 soldiers walled in by their own houses and told to move out (nothing to
// break: they wait at the nearest cell, round 2), against the same 40 soldiers moving in the
// open.
//   node src/walled-perf.ts
// Prints Markdown.

import { BUILDINGS } from "./core/rules.ts";
import { Game } from "./core/game.ts";
import { BuildingType, CELL_SHIFT, UnitType } from "./protocol.ts";

function setup(walled: boolean) {
  const g = new Game({ seed: 1, scenario: "standard" });
  const w = g.w;
  for (let s = 0; s < w.units.count; s++) w.unitSlot[w.units.col.id[s]] = -1;
  w.units.count = 0;
  // A 24 x 24 walkable square at least 15 cells from every building (as test/helpers.ts
  // openArea): searching only the middle of the map found none.
  const n = w.size;
  const b = w.buildings.col;
  let a = { x: -1, y: -1 };
  for (let y = 0; y + 24 <= n && a.x < 0; y++) {
    for (let x = 0; x + 24 <= n && a.x < 0; x++) {
      let ok = true;
      for (let s = 0; s < w.buildings.count && ok; s++) {
        if (Math.abs(b.cellX[s] - (x + 12)) < 27 && Math.abs(b.cellY[s] - (y + 12)) < 27) ok = false;
      }
      for (let yy = y; yy < y + 24 && ok; yy++) for (let xx = x; xx < x + 24 && ok; xx++) if (!w.walkable(xx, yy)) ok = false;
      if (ok) a = { x, y };
    }
  }
  if (a.x < 0) throw new Error("no open square");
  const x0 = a.x + 6;
  const y0 = a.y + 6;
  if (walled) {
    for (let k = -2; k <= 10; k += 2) {
      for (const [x, y] of [[x0 + k, y0 - 2], [x0 + k, y0 + 10], [x0 - 2, y0 + k], [x0 + 10, y0 + k]]) {
        if (w.buildingAt[y * n + x] < 0) w.addBuilding(0, BuildingType.House, x, y, BUILDINGS[BuildingType.House].hp, 1000);
      }
    }
  }
  const ids: number[] = [];
  for (let k = 0; k < 40; k++) {
    ids.push(w.addUnit(0, UnitType.Spearman, ((x0 + 1 + (k % 8)) << CELL_SHIFT) + 512, ((y0 + 1 + Math.trunc(k / 8)) << CELL_SHIFT) + 512, 60));
  }
  g.fog.update(w);
  return { g, ids, to: { x: a.x + 22, y: a.y + 22 } };
}

function time(walled: boolean): number {
  const { g, ids, to } = setup(walled);
  let seq = 0;
  const t0 = performance.now();
  for (let t = 0; t < 1000; t++) {
    // Told again and again (as a player keeps tapping), so the walled-in case keeps asking.
    if (t % 100 === 0) g.push({ t: g.tick, p: 0, seq: seq++, c: "move", u: ids, x: to.x, y: to.y });
    g.step();
  }
  return ((performance.now() - t0) * 1000) / 1000;
}

time(false); // warm up
const open = time(false);
const walled = time(true);
console.log(
  [
    "### 40 名士兵：被自己的民居圍住、一直收到往外走的指令",
    "",
    "| 情況 | 每 tick（µs，1,000 tick 平均） |",
    "|---|---|",
    `| 空地上移動 | ${open.toFixed(0)} |`,
    `| 被圍住（找最近的格子，有快取） | ${walled.toFixed(0)} |`,
  ].join("\n"),
);
