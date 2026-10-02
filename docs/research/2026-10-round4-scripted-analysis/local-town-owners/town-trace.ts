// Analysis (b), run from sim/ on #91 (measured on 4f0ebca with the scripted player; the head
// ae2d204 plays the same games, its five groups being identical game by game): one defend game,
// each minute who holds each town (#2 the player's own small town, #3 the AI's), plunders and
// governed towns per player, crystal in stock. Usage: node town-trace.ts <seed> <cap minutes>
import { createScriptedPlayer, planFor } from "./src/ai/scripted-player.ts";
import { rules } from "./src/core/rules.ts";
import { TownState } from "./src/protocol.ts";
import { Runner } from "./src/runner.ts";
import { buildView } from "./src/view/view.ts";
const seed = Number(process.argv[2] ?? "2");
const cap = Number(process.argv[3] ?? "22") * 1200;
const r = new Runner({ seed, scenario: "standard", ai: [false, true], maxTicks: 0 });
const g = r.game, w = g.w, map = w.map;
const player = createScriptedPlayer(0, { map, rules: rules(), frame: map.frames[0] }, planFor("defend", "h1", "close"));
const STATE = Object.fromEntries(Object.entries(TownState).map(([k, v]) => [v, k]));
let seq = 0;
const lines: string[] = [];
while (!r.over && w.tick < cap) {
  if (w.tick % 40 === 0) for (const body of player.think(buildView(g, 0))) r.command(0, { ...body, seq: seq++ });
  r.tick();
  if (w.tick % 1200 === 0) {
    const towns = map.towns.map((t) => `#${t.id}${STATE[w.townState[t.id]]?.slice(0, 4)}:${w.townOwner[t.id]}`).join(" ");
    lines.push(`${w.tick / 1200}分 ${towns} 搶 ${w.plundered[0]}/${w.plundered[1]} 治理 ${w.governed[0]}/${w.governed[1]} 魔晶 ${w.res[3]}/${w.res[7]}`);
  }
}
console.log(`seed ${seed} over ${r.over} winner ${w.winner} at ${(w.tick / 1200).toFixed(1)}`);
for (const l of lines) console.log(l);
