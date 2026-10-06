// One game's record (D-056), as the phone stores and uploads it: built by the client
// (client/src/logs/), checked by the Worker (src/worker.ts), read by war-game-ai (fetch.ts).
// Nothing in it says who played. 紀錄代號 is a random code the phone made up the first time
// the game was opened, so that the games of one phone can be told from another's.

/**
 * Largest upload the Worker takes, in bytes. A 40-minute limit game between two computers
 * ended after about 20 minutes with a 33–46 KB log (seeds 1–3); a person giving several
 * orders a second for 40 minutes stays well under this.
 */
export const MAX_BYTES = 2 * 1024 * 1024;

export const RECORD_VERSION = 1;

/** How the game ended for the person: 勝, 負, 平手, or left by 重來 before the end. */
export const RESULTS = ["win", "loss", "draw", "abandoned"] as const;
export type Result = (typeof RESULTS)[number];

export interface GameRecord {
  v: typeof RECORD_VERSION;
  /** 局編號: a random UUID, so that the same game uploaded twice is stored once. */
  id: string;
  /** 紀錄代號: 8 random characters kept on the phone. Not an account; it names nobody. */
  code: string;
  /** The game version's commit (the page's build). */
  commit: string;
  /** The simulation's protocol version: a replay needs the same one. */
  protocol: number;
  scenario: string;
  /** The computer's 難度. */
  difficulty: string;
  result: Result;
  /** Why it ended: "main_city", "surrender", "time_limit"; "" when abandoned. */
  reason: string;
  /** Game time in ticks (20 a second). */
  ticks: number;
  /** The last state hash the simulation published, for checking a replay. */
  lastHash: { tick: number; hash: string } | null;
  /** The command log: LogHeader, then one command per line (sim/src/protocol.ts). */
  log: string;
}

export const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const CODE_PATTERN = /^[a-z0-9]{8}$/;
const COMMIT_PATTERN = /^(?:[0-9a-f]{7,40}|unknown|dev)$/;
const WORD_PATTERN = /^[a-z0-9_]{0,24}$/;
const HASH_PATTERN = /^[0-9a-f]{8}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** The record, or why it is not one. Only the log's first line (the header) is parsed. */
export function checkRecord(value: unknown): GameRecord | string {
  if (!isObject(value)) return "not an object";
  const r = value;
  if (r.v !== RECORD_VERSION) return "v";
  if (typeof r.id !== "string" || !ID_PATTERN.test(r.id)) return "id";
  if (typeof r.code !== "string" || !CODE_PATTERN.test(r.code)) return "code";
  if (typeof r.commit !== "string" || !COMMIT_PATTERN.test(r.commit)) return "commit";
  if (!isCount(r.protocol)) return "protocol";
  if (typeof r.scenario !== "string" || !WORD_PATTERN.test(r.scenario) || r.scenario === "") return "scenario";
  if (typeof r.difficulty !== "string" || !WORD_PATTERN.test(r.difficulty)) return "difficulty";
  if (typeof r.result !== "string" || !(RESULTS as readonly string[]).includes(r.result)) return "result";
  if (typeof r.reason !== "string" || !WORD_PATTERN.test(r.reason)) return "reason";
  if (!isCount(r.ticks)) return "ticks";
  if (r.lastHash !== null) {
    if (!isObject(r.lastHash) || !isCount(r.lastHash.tick) || typeof r.lastHash.hash !== "string" || !HASH_PATTERN.test(r.lastHash.hash)) return "lastHash";
  }
  if (typeof r.log !== "string" || r.log === "") return "log";
  const end = r.log.indexOf("\n");
  let header: unknown;
  try {
    header = JSON.parse(end < 0 ? r.log : r.log.slice(0, end));
  } catch {
    return "log header";
  }
  if (!isObject(header) || !isCount(header.protocol) || !isCount(header.seed) || typeof header.scenario !== "string") return "log header";
  if (header.protocol !== r.protocol || header.scenario !== r.scenario) return "log header";
  return r as unknown as GameRecord;
}

/** What the Worker keeps beside each record (KV metadata, under 1 KB), so a listing needs no downloads. */
export interface RecordSummary {
  id: string;
  code: string;
  commit: string;
  protocol: number;
  scenario: string;
  difficulty: string;
  result: Result;
  reason: string;
  ticks: number;
  /** When the Worker received it (ISO 8601, the Worker's clock). */
  received: string;
}

export function summary(r: GameRecord, received: string): RecordSummary {
  return {
    id: r.id,
    code: r.code,
    commit: r.commit,
    protocol: r.protocol,
    scenario: r.scenario,
    difficulty: r.difficulty,
    result: r.result,
    reason: r.reason,
    ticks: r.ticks,
    received,
  };
}
