// Downloads the game records not yet on this computer (D-056), for war-game-ai.
//
//   node services/game-logs/fetch.ts [--out DIR] [--code ab12cd34]
//
// Reads GAME_LOGS_URL (the Worker, e.g. https://war-game-logs.<subdomain>.workers.dev) and
// GAME_LOGS_READ_KEY from the environment, or else from ~/.config/war-game/game-logs.env
// (KEY=value lines, written in the deployment steps of README.md). Writes DIR/<id>.json, the
// record as posted; DIR/<id>.jsonl, its command log, for `node sim/src/headless.ts --replay`;
// and DIR/index.json, the summaries of the records kept, each with the 介面 its record says it
// was played in (`ui`: "r6", "proto", or null for a record without one, src/record.ts). DIR
// defaults to ~/war-game-logs, outside the repository. `--code` keeps one phone's records only.
// The key is never printed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type GameRecord, ID_PATTERN, type RecordSummary } from "./src/record.ts";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

/** KEY=value lines; blank lines and # comments skipped. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m !== null) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

function settings(): { url: string; key: string } {
  const file = join(homedir(), ".config", "war-game", "game-logs.env");
  const saved = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  const url = (process.env.GAME_LOGS_URL ?? saved.GAME_LOGS_URL ?? "").replace(/\/+$/, "");
  const key = process.env.GAME_LOGS_READ_KEY ?? saved.GAME_LOGS_READ_KEY ?? "";
  if (url === "" || key === "") throw new Error(`GAME_LOGS_URL and GAME_LOGS_READ_KEY are needed (environment or ${file})`);
  return { url, key };
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

async function get(fetchFn: Fetch, url: string, key: string): Promise<Response> {
  const res = await fetchFn(url, { headers: { authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`${res.status} from ${url.replace(/\?.*$/, "")}`);
  return res;
}

/** An entry of index.json: the Worker's summary, and the record's 介面 (null: it has none). */
export type IndexEntry = RecordSummary & { ui: string | null };

const UI_PATTERN = /^[a-z0-9_]{1,24}$/;

/** The 介面 a downloaded record says it was played in; null for none (or a file that is not one). */
function uiOf(file: string): string | null {
  try {
    const ui = (JSON.parse(readFileSync(file, "utf8")) as { ui?: unknown }).ui;
    return typeof ui === "string" && UI_PATTERN.test(ui) ? ui : null;
  } catch {
    return null;
  }
}

/** Lists every record and downloads those not in `out` yet (of one phone, with `code`). */
export async function download(
  o: { url: string; key: string; out: string; code: string },
  fetchFn: Fetch = fetch,
): Promise<{ listed: number; kept: number; fetched: number }> {
  mkdirSync(o.out, { recursive: true });
  const all: RecordSummary[] = [];
  let cursor: string | null = null;
  do {
    const page = (await (await get(fetchFn, `${o.url}/logs${cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`}`, o.key)).json()) as { logs: RecordSummary[]; cursor: string | null };
    all.push(...page.logs);
    cursor = page.cursor;
  } while (cursor !== null);
  const wanted = all.filter((s) => ID_PATTERN.test(s.id) && (o.code === "" || s.code === o.code));
  let fetched = 0;
  for (const s of wanted) {
    const file = join(o.out, `${s.id}.json`);
    if (existsSync(file)) continue;
    const body = await (await get(fetchFn, `${o.url}/logs/${s.id}`, o.key)).text();
    writeFileSync(join(o.out, `${s.id}.jsonl`), (JSON.parse(body) as GameRecord).log);
    writeFileSync(file, body);
    fetched++;
  }
  const index: IndexEntry[] = wanted.map((s) => ({ ...s, ui: uiOf(join(o.out, `${s.id}.json`)) }));
  writeFileSync(join(o.out, "index.json"), `${JSON.stringify(index, null, 1)}\n`);
  return { listed: all.length, kept: wanted.length, fetched };
}

async function main(): Promise<void> {
  const { url, key } = settings();
  const out = arg("out", join(homedir(), "war-game-logs"));
  const code = arg("code", "");
  const r = await download({ url, key, out, code });
  console.log(`${r.listed} records listed, ${r.kept} kept${code === "" ? "" : ` (code ${code})`}, ${r.fetched} downloaded to ${out}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
