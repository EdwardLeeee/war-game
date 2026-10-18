// R6 B.3: every inventory item (design/r6/inventory.md, INV-01..146) is on some board of the full set, except the
// ones left out on purpose; every board cell names a state that exists. Exit 1 otherwise.
//   node design/r6/common/coverage.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const ctx = { window: {}, location: { search: "?theme=a" }, document: { documentElement: { dataset: {} } }, URLSearchParams,
  btn: (l) => `<button>${l}</button>`, HELP: { dense: [["", "", ""], ["", "", ""], ["", "", ""], ["", "", ""]] } };
vm.createContext(ctx);
vm.runInContext(readFileSync(join(HERE, "../mock/states.js"), "utf8"), ctx);
vm.runInContext(readFileSync(join(HERE, "../mock/boards.js"), "utf8"), ctx);
const states = ctx.window.R6_STATES, boards = ctx.window.R6_BOARDS;
const EXCLUDED = { "INV-16": "原型標示：正式版拿掉（ceo 2026-10-18 同意）", "INV-128": "量測面板：開發者用，照舊不改樣式（ceo 2026-10-18 同意）" };
const covered = new Map();
let bad = 0;
for (const b of Object.values(boards)) {
  for (const row of b.rows) for (const c of row) {
    if (!states[c.state]) { console.log(`${b.id}: unknown state ${c.state}`); bad++; }
    for (const id of c.inv) { if (!covered.has(id)) covered.set(id, []); covered.get(id).push(b.id); }
  }
}
const missing = [];
for (let i = 1; i <= 146; i++) {
  const id = `INV-${String(i).padStart(2, "0")}`;
  if (!covered.has(id) && !EXCLUDED[id]) missing.push(id);
}
const news = [...covered.keys()].filter((k) => k.startsWith("NEW-")).sort();
console.log(`boards ${Object.keys(boards).length}, states ${Object.keys(states).length}; INV covered ${[...covered.keys()].filter((k) => k.startsWith("INV-")).length}/146, excluded ${Object.keys(EXCLUDED).length}, new items ${news.length} (${news.join(" ")})`);
if (missing.length) { console.log("MISSING:", missing.join(" ")); bad++; }
// the boards as data, for spec.py
writeFileSync(join(HERE, "../build/boards.json"), JSON.stringify(Object.fromEntries(Object.entries(boards).map(([k, b]) =>
  [k, { name: b.name, sub: b.sub, rules: b.rules || "", inv: [...new Set(b.rows.flat().flatMap((c) => c.inv))] }])), null, 1));
process.exitCode = bad ? 1 : 0;
