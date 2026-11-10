// An idle army in the user's games (D-139; idle-watch.ts): plays each log again from its commands (both sides', as
// logged; no AI thinks) and prints the computer's signals.
//   node src/log-watch.ts ~/war-game-logs/<id>.jsonl [...]   (or a directory: every .jsonl in it)
//   --json FILE   also writes every game's IdleRecord
// The log's .json beside it (same id) gives lastHash: the replay must reach the same hash there, else this simulation is
// not the one the game was played on and nothing is reported for it ("another sim": play it from a worktree at the log's
// commit, with idle-watch.ts and log-watch.ts copied in; they read only the world and the commands).

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { hex8 } from "./core/fixed.ts";
import { MAX_TICKS, type Command, type LogHeader } from "./protocol.ts";
import { Runner } from "./runner.ts";
import { idleFindings, IdleWatch, type IdleRecord } from "./idle-watch.ts";

interface LogMeta {
  id?: string;
  commit?: string;
  result?: string;
  difficulty?: string;
  ticks?: number;
  lastHash?: { tick: number; hash: string };
}

export interface LogWatchResult {
  file: string;
  commit: string;
  result: string;
  difficulty: string;
  map: string;
  minutes: number;
  /** "ok": the replay reached the log's last hash; "another sim"; "no hash" (no .json beside it). */
  replay: string;
  ai: number[];
  idle: IdleRecord | null;
}

export function watchLog(file: string): LogWatchResult {
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "");
  const header = JSON.parse(lines[0]) as LogHeader;
  const commands = lines.slice(1).map((l) => JSON.parse(l) as Command);
  const metaFile = file.replace(/\.jsonl$/, ".json");
  const meta: LogMeta = existsSync(metaFile) ? (JSON.parse(readFileSync(metaFile, "utf8")) as LogMeta) : {};
  const ai = header.ai.flatMap((a, p) => (a ? [p] : []));
  const r = new Runner({
    seed: header.seed,
    scenario: header.scenario,
    ai: header.ai.map(() => false),
    replay: commands,
    maxTicks: header.maxTicks ?? MAX_TICKS,
    difficulty: header.difficulty,
    autoTrain: header.autoTrain,
    map: header.map,
  });
  const g = r.game;
  const watch = new IdleWatch(g);
  const end = meta.ticks ?? (commands.at(-1)?.t ?? 0) + 1;
  let replay = meta.lastHash === undefined ? "no hash" : "another sim";
  while (!r.over && g.tick < end) {
    r.tick();
    watch.tick();
    if (meta.lastHash !== undefined && g.tick === meta.lastHash.tick) {
      if (hex8(g.hash()) !== meta.lastHash.hash) break;
      replay = "ok";
    }
  }
  return {
    file: basename(file),
    commit: meta.commit ?? "",
    result: meta.result ?? "",
    difficulty: meta.difficulty ?? (header.difficulty ?? []).join(","),
    map: header.map ?? "fixed",
    minutes: Math.round((g.tick / 1200) * 10) / 10,
    replay,
    ai,
    idle: replay === "another sim" ? null : watch.result(),
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const jsonAt = args.indexOf("--json");
  const jsonFile = jsonAt >= 0 ? args[jsonAt + 1] : "";
  const paths = args.filter((a, k) => !a.startsWith("--") && (jsonAt < 0 || k !== jsonAt + 1));
  const files = paths.flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith(".jsonl")).map((f) => join(p, f)) : [p]));
  const all: LogWatchResult[] = [];
  const out = ["| 紀錄 | commit | 難度 | 地圖 | 結果 | 分 | 重播 | 要查 | 照打法 |", "|---|---|---|---|---|---|---|---|---|"];
  for (const f of files.sort()) {
    const res = watchLog(f);
    all.push(res);
    const found = res.idle === null ? [] : res.ai.flatMap((p) => idleFindings(res.idle!, p));
    const list = (kind: string) => found.filter((x) => x.kind === kind).map((x) => `${x.signal}：${x.detail}`).join("<br>") || "—";
    out.push(`| ${res.file.slice(0, 8)} | ${res.commit} | ${res.difficulty} | ${res.map} | ${res.result} | ${res.minutes} | ${res.replay} | ${list("check")} | ${list("plan")} |`);
  }
  console.log(out.join("\n"));
  if (jsonFile !== "") writeFileSync(jsonFile, JSON.stringify(all));
}
