// D-139 tables (idle-watch.ts): for each group of games, how many hit each signal, by design ("照打法": every spell of it
// had a reason the AI means, idle-watch.ts's tags) or to check ("要查"), and the seeds to check. Markdown for the CI step
// summaries; reports only, no threshold.
//   node src/idle-summary.ts --scripted DIR     the scripted groups' JSON (scripted-[hard-]<group>-<seeds>.json); the AI's side
// tournament-summary.ts prints the same table for both sides of its games (idleTable).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { idleFindings, type IdleRecord } from "./idle-watch.ts";

export const SIGNALS: [string, string][] = [
  ["1", "目的地走不到"],
  ["2a", "在外面站著"],
  ["2b", "在家堆著"],
  ["3", "沒到過對手主城"],
  ["4", "同一道指令重送"],
];

export interface IdleGame {
  /** How the seed is named in the list (a seed, or game and seed). */
  name: string;
  idle: IdleRecord | undefined;
  /** The sides to read (the AI's). */
  sides: number[];
}

/** One table: a row per group, a column pair per signal; then the games to check. */
export function idleTable(groups: [string, IdleGame[]][]): string {
  const out = [`| 組 | 局數 | ${SIGNALS.map(([k, name]) => `${k} ${name}（照打法／要查）`).join(" | ")} |`, `|---|---|${SIGNALS.map(() => "---").join("|")}|`];
  const check: string[] = [];
  for (const [group, games] of groups) {
    if (games.length === 0) continue;
    const plan = new Map(SIGNALS.map(([k]) => [k, 0]));
    const real = new Map(SIGNALS.map(([k]) => [k, 0]));
    const listed: string[] = [];
    for (const g of games) {
      if (g.idle === undefined) continue;
      const found = g.sides.flatMap((p) => idleFindings(g.idle!, p).map((f) => ({ ...f, p })));
      for (const [k] of SIGNALS) {
        const of = found.filter((f) => f.signal === k);
        if (of.length === 0) continue;
        if (of.some((f) => f.kind === "check")) real.set(k, real.get(k)! + 1);
        else plan.set(k, plan.get(k)! + 1);
      }
      const bad = found.filter((f) => f.kind === "check");
      if (bad.length > 0) listed.push(`${g.name}（${[...new Set(bad.map((f) => (g.sides.length > 1 ? `${f.signal}@${f.p}` : f.signal)))].join("、")}）`);
    }
    out.push(`| ${group} | ${games.length} | ${SIGNALS.map(([k]) => `${plan.get(k)}／${real.get(k)}`).join(" | ")} |`);
    if (listed.length > 0) check.push(`- ${group}：${listed.join("，")}`);
  }
  out.push("", "照打法：每一段都有電腦故意的理由（打主城前集結、拆據點前集合、撤退後在家等、家附近有敵人）。要查：至少一段沒有理由。訊號的定義在 sim/src/idle-watch.ts。");
  if (check.length > 0) out.push("", "要查的局（括號是訊號）：", ...check);
  return out.join("\n");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--scripted");
  if (at < 0) {
    console.error("usage: node src/idle-summary.ts --scripted DIR");
    process.exit(2);
  }
  const dir = args[at + 1];
  const levels: [string, string][] = [["", "普通"], ["hard-", "困難"]];
  const byGroup = new Map<string, IdleGame[]>();
  for (const f of readdirSync(dir).sort()) {
    const m = /^scripted-(hard-)?(.+)-\d+-\d+\.json$/.exec(f);
    if (m === null) continue;
    const key = `${m[2]}，${m[1] === undefined ? "普通" : "困難"}`;
    const games = (JSON.parse(readFileSync(join(dir, f), "utf8")) as { games: { seed: number; idle?: IdleRecord }[] }).games;
    const list = byGroup.get(key) ?? [];
    for (const g of games) list.push({ name: `種子 ${g.seed}`, idle: g.idle, sides: [1] });
    byGroup.set(key, list);
  }
  const order = [...byGroup.keys()].sort((a, b) => {
    const la = levels.findIndex(([, n]) => a.endsWith(n));
    const lb = levels.findIndex(([, n]) => b.endsWith(n));
    return la - lb || a.localeCompare(b);
  });
  for (const list of byGroup.values()) list.sort((a, b) => Number(a.name.slice(3)) - Number(b.name.slice(3)));
  console.log(["## 電腦發呆（D-139，腳本玩家各組；電腦那一方）", "", idleTable(order.map((k) => [k, byGroup.get(k)!]))].join("\n"));
}
