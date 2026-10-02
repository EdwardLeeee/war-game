// Analysis (b), run from sim/ on #91 (measured on 4f0ebca with the scripted player; the head
// ae2d204 plays the same games): defend games stopped at game minute 16; when each side first
// holds each town, and plunders and governed towns by then.
// Usage: node town-first.ts <seed> [<seed>...]
import { createScriptedPlayer, planFor } from "./src/ai/scripted-player.ts";
import { rules } from "./src/core/rules.ts";
import { Runner } from "./src/runner.ts";
import { buildView } from "./src/view/view.ts";
const cap = 16 * 1200;
for (const seed of process.argv.slice(2).map(Number)) {
  const r = new Runner({ seed, scenario: "standard", ai: [false, true], maxTicks: 0 });
  const g = r.game, w = g.w, map = w.map;
  const player = createScriptedPlayer(0, { map, rules: rules(), frame: map.frames[0] }, planFor("defend", "h1", "close"));
  const first = map.towns.map(() => [-1, -1]);
  let seq = 0;
  while (!r.over && w.tick < cap) {
    if (w.tick % 40 === 0) for (const body of player.think(buildView(g, 0))) r.command(0, { ...body, seq: seq++ });
    r.tick();
    if (w.tick % 20 === 0) for (const t of map.towns) { const o = w.townOwner[t.id]; if (o === 0 || o === 1) if (first[t.id][o] < 0) first[t.id][o] = w.tick; }
  }
  const f = (t: number) => (t < 0 ? "-" : (t / 1200).toFixed(1));
  console.log(`seed ${seed}: ` + map.towns.map((t) => `#${t.id} 我${f(first[t.id][0])} 電${f(first[t.id][1])}`).join(" | ") + ` | 16 分時 搶 ${w.plundered[0]}/${w.plundered[1]} 治理 ${w.governed[0]}/${w.governed[1]}`);
}
