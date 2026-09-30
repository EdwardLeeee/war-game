import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPlacement, type PlacementGrid } from "../src/placement.ts";
import { BuildingType, PlaceBit, Reject } from "../src/protocol.ts";

function grid(size: number, fill = 0): PlacementGrid {
  return { size, cells: new Uint8Array(size * size).fill(fill) };
}
const house = { type: BuildingType.House, size: 2 };
const farm = { type: BuildingType.Farm, size: 3 };

test("fits on open, explored ground inside the map", () => {
  assert.equal(checkPlacement(grid(8), house, 0, 0), 0);
  assert.equal(checkPlacement(grid(8), house, 6, 6), 0);
});

test("rejects footprints that leave the map or use fractional cells", () => {
  assert.equal(checkPlacement(grid(8), house, 7, 0), Reject.BadPlacement);
  assert.equal(checkPlacement(grid(8), house, -1, 0), Reject.BadPlacement);
  assert.equal(checkPlacement(grid(8), house, 1.5, 0), Reject.BadPlacement);
});

test("rejects any blocked or unexplored cell under the footprint", () => {
  for (const bit of [PlaceBit.Blocked, PlaceBit.Unexplored]) {
    const g = grid(8);
    g.cells[3 * 8 + 3] = bit;
    assert.equal(checkPlacement(g, house, 2, 2), Reject.BadPlacement);
    assert.equal(checkPlacement(g, house, 4, 4), 0);
  }
});

test("farms need farm land under every cell; other buildings do not", () => {
  const g = grid(8, PlaceBit.FarmLand);
  assert.equal(checkPlacement(g, farm, 0, 0), 0);
  g.cells[2 * 8 + 2] = 0;
  assert.equal(checkPlacement(g, farm, 0, 0), Reject.BadPlacement);
  assert.equal(checkPlacement(grid(8), farm, 0, 0), Reject.BadPlacement);
  assert.equal(checkPlacement(grid(8), house, 0, 0), 0);
});
