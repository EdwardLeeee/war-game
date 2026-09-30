// Turns headless <game>.hashes.txt files into the JSON the test pages compare against:
//   node spikes/tools/expected-hashes.mjs <dir> scripted ai > expected-hashes.json
// {"scripted": {"0": "c077b54a", "100": ...}, "ai": {...}}
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [dir, ...games] = process.argv.slice(2);
const out = {};
for (const g of games) {
  out[g] = {};
  for (const line of readFileSync(join(dir, `${g}.hashes.txt`), "utf8").trim().split("\n")) {
    const [tick, hash] = line.split(" ");
    out[g][tick] = hash;
  }
}
process.stdout.write(JSON.stringify(out) + "\n");
