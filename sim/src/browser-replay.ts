// Runs in a browser (src/browser-check.ts serves the sources, types stripped): replays a
// command log with the AIs off and returns every HASH_EVERY-tick hash, for comparison with
// the hashes Node computed for the same log.

import { hex8 } from "./core/fixed.ts";
import { type Command, type LogHeader, MAX_TICKS } from "./protocol.ts";
import { Runner } from "./runner.ts";

export function replay(jsonl: string, ticks: number): { tick: number; hash: string }[] {
  const lines = jsonl.split("\n").filter((l) => l.trim() !== "");
  const head = JSON.parse(lines[0]) as LogHeader;
  const commands = lines.slice(1).map((l) => JSON.parse(l) as Command);
  const r = new Runner({ seed: head.seed, scenario: head.scenario, ai: [false, false], replay: commands, maxTicks: head.maxTicks ?? MAX_TICKS, autoTrain: head.autoTrain, map: head.map });
  while (!r.over && r.game.tick < ticks) r.tick();
  if (r.hashes.at(-1)!.tick !== r.game.tick) r.hashes.push({ tick: r.game.tick, hash: r.game.hash() });
  return r.hashes.map((h) => ({ tick: h.tick, hash: hex8(h.hash) }));
}
