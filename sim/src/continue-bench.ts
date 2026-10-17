// How long 繼續上一局 (D-083) takes: plays a person's game against the AI as the worker does
// (the scripted player defending and never marching out, so the game lasts), saves it as
// export_log would at --ticks, and times continueGame running it again to there. Also a
// shorter game against the normal AI, for its cost a tick.
//
//   node src/continue-bench.ts [--ticks 96000] [--seed 1]

import { createScriptedPlayer, planFor, SCRIPTED_THINK_EVERY } from "./ai/scripted-player.ts";
import { continueGame } from "./continue.ts";
import { hex8 } from "./core/fixed.ts";
import { rules } from "./core/rules.ts";
import type { AiDifficulty } from "./protocol.ts";
import { Runner } from "./runner.ts";
import { buildView, mapInfo } from "./view/view.ts";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const ticks = Number(arg("ticks", "96000"));
const seed = Number(arg("seed", "1"));

function measure(difficulty: AiDifficulty, upTo: number): void {
  const r = new Runner({ seed, scenario: "standard", ai: [false, true], maxTicks: 0, difficulty: ["normal", difficulty], autoTrain: [true, false], build: "bench" });
  const w = r.game.w;
  // Defending, never marching out: against easy the game is still going at 80 minutes.
  const plan = { ...planFor("defend", "eco", "all"), counterAt: 9999, pushAt: 0 };
  const player = createScriptedPlayer(0, { map: mapInfo(w.map, 0), rules: rules(w.map), frame: w.map.frames[0] }, plan);
  let seq = 0;
  const t0 = performance.now();
  while (!r.over && r.game.tick < upTo) {
    if (r.game.tick % SCRIPTED_THINK_EVERY === 0) for (const body of player.think(buildView(r.game, 0))) r.command(0, { ...body, seq: seq++ } as never);
    r.tick();
  }
  const playMs = performance.now() - t0;
  const at = r.game.tick;
  const log = [JSON.stringify(r.header([false, true])), ...r.game.log.map((c) => JSON.stringify(c))].join("\n") + "\n";
  const hashes = r.hashes.map((h) => ({ tick: h.tick, hash: hex8(h.hash) }));
  const t1 = performance.now();
  let progress = 0;
  const got = continueGame({ log, hashes, toTick: at, build: "bench" }, () => progress++);
  const continueMs = performance.now() - t1;
  if (!got.ok) throw new Error(`continue failed: ${got.reason} at ${got.tick}: ${got.message}`);
  if (hex8(got.runner.game.hash()) !== hex8(r.game.hash())) throw new Error("continue: not the same game");
  const units = w.units.count;
  console.log(
    `CONTINUE ${difficulty} seed ${seed}: ${at} ticks (${(at / 1200).toFixed(1)} min${r.over ? ", game over" : ""}), ${units} units at the end; ` +
      `log ${r.game.log.length} commands, ${(log.length / 1024).toFixed(0)} KB, ${hashes.length} hashes; ` +
      `played in ${(playMs / 1000).toFixed(1)} s; continued in ${(continueMs / 1000).toFixed(1)} s ` +
      `(${((continueMs * 1000) / at).toFixed(0)} us a tick, ${progress} progress messages), same final hash`,
  );
}

console.log(process.platform, process.arch, process.version);
measure("easy", ticks);
measure("normal", ticks);
