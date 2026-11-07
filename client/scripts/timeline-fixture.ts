// 局後統計's e2e fixture (e2e/fixtures/timeline-seed3.json): one game of two computers on the fixed map played to its
// end (seed 3, hard against normal: 28:45, the main city destroyed), its game_over stats' timeline with the `places`
// core adds in #425 (every town and both main cities), so the fake world's page shows a real game. Run again when the
// timeline's shape changes:  node scripts/timeline-fixture.ts

import { writeFileSync } from "node:fs";
import { Runner } from "../../sim/src/runner.ts";

const r = new Runner({ seed: 3, scenario: "standard", ai: [true, true], maxTicks: 60 * 60 * 20, difficulty: ["hard", "normal"], autoTrain: [false, false], build: "fixture" });
while (!r.over) r.tick();
const w = r.game.w;
const places = {
  towns: w.map.towns.map((t) => ({ size: t.size, cellX: t.cellX, cellY: t.cellY })),
  cities: [0, 1].map((p) => {
    const s = w.map.spawns.find((x) => x.player === p);
    return { cellX: s?.cellX ?? 0, cellY: s?.cellY ?? 0 };
  }),
};
const out = { seed: 3, winner: w.winner, reason: w.endReason, ticks: w.tick, timeline: { ...r.timeline(), places } };
const file = new URL("../e2e/fixtures/timeline-seed3.json", import.meta.url);
writeFileSync(file, `${JSON.stringify(out)}\n`);
console.log(`${file.pathname}: winner ${out.winner}, reason ${out.reason}, ${out.ticks} ticks, ${out.timeline.samples.length} samples, ${out.timeline.deaths.length} deaths`);
