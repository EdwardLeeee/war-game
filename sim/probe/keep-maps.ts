// D-100: the maps with KEEP on: does each make (fixed; random seeds), and how round-about are the walks.
import { generateMap } from "../src/core/map.ts";
import { generateRandomMap, THROWN_AWAY } from "../src/core/random-map.ts";
import { KEEP } from "../src/core/rules.ts";
KEEP.on = process.argv[2] !== "off";
const m = generateMap();
console.log("fixed ok", m.towns.map((t) => [t.cellX, t.cellY, t.size, t.radius]), "towerSize", m.towerSize);
let ok = 0;
let fail = 0;
const to = Number(process.argv[3] ?? 50);
for (let s = 1; s <= to; s++) {
  try {
    generateRandomMap(s);
    ok++;
  } catch (e) {
    fail++;
    if (fail <= 3) console.log("seed", s, String(e).slice(0, 120));
  }
}
console.log("random", ok, "ok", fail, "failed", JSON.stringify(THROWN_AWAY));
