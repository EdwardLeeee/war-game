// Ours walking through our own buildings (D-154) are drawn behind a standing building while inside its footprint,
// and come out in front only once out of it (ceo 2026-11-20: by their place on the screen they came out in front of
// the main city's hall while still in it, and walked on its porch's roof). Outside a footprint, as before: in front
// of one wholly behind them, behind one wholly in front.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildingDepth, type DrawnFootprint, inAFootprint } from "../src/render/building-depth.ts";

const N = 100;
/** The cells each drawn building covers (1-based), as structure-art.ts keeps them. */
function owners(drawn: DrawnFootprint[]): Int32Array {
  const o = new Int32Array(N * N);
  drawn.forEach((d, i) => {
    for (let y = d.cellY; y < d.cellY + d.size; y++) for (let x = d.cellX; x < d.cellX + d.size; x++) o[y * N + x] = i + 1;
  });
  return o;
}

// A main city 4 × 4 at (10, 10), drawn at depth 500 (as a diamond, by its middle).
const CITY: DrawnFootprint = { cellX: 10, cellY: 10, size: 4, z: 500 };
const drawn = [CITY];
const own = owners(drawn);

test("占地裡：不管畫面上在大殿前面還是後面，一律畫在建築後面", () => {
  for (const [ux, uy] of [
    [10.5, 10.5],
    [12, 12],
    [13.5, 11],
    [13.5, 13.5],
    [11, 13.9],
  ]) {
    for (const py of [300, 499, 501, 700]) {
      assert.ok(buildingDepth(drawn, own, N, ux, uy, py, false) < CITY.z, `${ux},${uy} at ${py}`);
    }
    assert.equal(inAFootprint(drawn, own, N, ux, uy), true, `${ux},${uy} inside`);
  }
});

test("走出占地的前緣（x 或 y 超過）：畫在建築前面；後面、左右在外面：畫在後面", () => {
  assert.ok(buildingDepth(drawn, own, N, 14.2, 12, 450, false) > CITY.z, "past its x edge");
  assert.ok(buildingDepth(drawn, own, N, 12, 14.2, 450, false) > CITY.z, "past its y edge");
  assert.ok(buildingDepth(drawn, own, N, 9.8, 12, 550, false) < CITY.z, "behind, on its x side");
  assert.ok(buildingDepth(drawn, own, N, 12, 9.8, 550, false) < CITY.z, "behind, on its y side");
  for (const [ux, uy] of [
    [14.2, 12],
    [9.8, 12],
    [10, 12],
    [14, 12],
  ]) {
    assert.equal(inAFootprint(drawn, own, N, ux, uy), false, `${ux},${uy} not inside (an edge is not inside)`);
  }
});

test("離建築遠的、沒有建築的：照畫面上的位置", () => {
  assert.equal(buildingDepth(drawn, own, N, 25, 25, 812, false), 812);
  assert.equal(buildingDepth([], new Int32Array(N * N), N, 12, 12, 812, false), 812);
  assert.equal(inAFootprint([], new Int32Array(N * N), N, 12, 12), false);
});

test("方形斜看（D-088）：本來就照畫面上的位置；只有占地裡的改畫在建築後面", () => {
  assert.equal(buildingDepth(drawn, own, N, 14.2, 12, 450, true), 450, "outside: as before");
  assert.equal(buildingDepth(drawn, own, N, 9.8, 12, 550, true), 550, "outside: as before");
  assert.ok(buildingDepth(drawn, own, N, 12, 12, 700, true) < CITY.z, "inside: behind it");
});

test("剛開工、還是平的地基（第一階段）：跟農田一樣，占地裡照畫面上的位置，不算被蓋住", () => {
  const site: DrawnFootprint = { cellX: 20, cellY: 20, size: 3, z: 900, flat: true };
  const o = owners([site]);
  assert.equal(buildingDepth([site], o, N, 21.5, 21.5, 950, false), 950, "inside, in front of its middle");
  assert.equal(buildingDepth([site], o, N, 21.5, 21.5, 850, false), 850, "inside, behind its middle");
  assert.equal(inAFootprint([site], o, N, 21.5, 21.5), false);
  assert.ok(buildingDepth([site], o, N, 23.2, 21.5, 850, false) > site.z, "out past its edge: in front, as before");
});

test("占地裡、又在旁邊民居的前緣外（e2e 的配置）：民居在畫面上比主城中間低，照樣畫在主城後面", () => {
  // The e2e scenario's: the main city 4 × 4 at (14, 76), a house 2 × 2 at (19, 75); as a diamond the house's middle
  // (20, 76) is lower on the screen than the city's (16, 78). The spearman at (17.06, 77.05): inside the city, past the
  // house's lower edge.
  const city: DrawnFootprint = { cellX: 14, cellY: 76, size: 4, z: 940 };
  const house: DrawnFootprint = { cellX: 19, cellY: 75, size: 2, z: 960 };
  for (const order of [
    [city, house],
    [house, city],
  ]) {
    const o = owners(order);
    assert.ok(buildingDepth(order, o, N, 17.06, 77.05, 950, false) < city.z, "behind the city");
  }
});
