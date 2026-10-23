// Digest of the fixed map and random maps 1-N (terrain, nodes, towns, tower, posts), to compare two checkouts.
import { generateMap } from "../src/core/map.ts";
import { generateRandomMap } from "../src/core/random-map.ts";
import { rules } from "../src/core/rules.ts";
import { createHash } from "node:crypto";
const h = createHash("sha256");
const add = (m: unknown) => h.update(JSON.stringify(m, (_k, v) => (v instanceof Uint8Array || v instanceof Int8Array || v instanceof Int32Array ? Array.from(v) : v)));
const f = generateMap();
add(f);
add(rules(f));
for (let s = 1; s <= Number(process.argv[2] ?? 20); s++) {
  const m = generateRandomMap(s);
  add(m);
  add(rules(m));
}
console.log(h.digest("hex"));
