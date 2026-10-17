// Going on with a game from its log (D-083, 繼續上一局; PROTOCOL.md 9.1). The page was closed,
// so the game is run again from tick 0 as fast as possible: the AIs think as they did, the
// person's commands come from the log. Each tick's commands as applied must be the log's, AI
// commands included, and every HASH_EVERY ticks the hash must be the one the page kept; then the
// game is where it was and goes on, its log the same as the old one so far.

import { hex8 } from "./core/fixed.ts";
import { AI_DIFFICULTIES, type Command, CONTINUE_PROGRESS_EVERY, type ContinueFailure, HASH_EVERY, type LogHeader, MAP_MODES, MAX_TICKS, PLAYER_COUNT, PROTOCOL_VERSION } from "./protocol.ts";
import { Runner } from "./runner.ts";

export interface ContinueInput {
  /** export_log's jsonl: LogHeader, then one command per line. */
  log: string;
  /** export_log's hashes: every HASH_EVERY ticks from tick 0. */
  hashes: { tick: number; hash: string }[];
  /** export_log's tick: where the game had got to. */
  toTick: number;
  /** This simulation's build (`init`'s); must be the log's. */
  build?: string;
}

export type ContinueResult =
  | { ok: true; runner: Runner; header: LogHeader; human: number | null }
  | { ok: false; reason: ContinueFailure; tick: number; message: string };

const fail = (reason: ContinueFailure, tick: number, message: string): ContinueResult => ({ ok: false, reason, tick, message });

const isInt = (v: unknown, min = 0): v is number => typeof v === "number" && Number.isInteger(v) && v >= min;

/** The log's header and commands, or why they cannot be read. */
function readLog(log: string): { header: LogHeader; commands: Command[] } | string {
  const lines = log.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return "empty log";
  let header: LogHeader;
  const commands: Command[] = [];
  try {
    header = JSON.parse(lines[0]) as LogHeader;
    for (const line of lines.slice(1)) commands.push(JSON.parse(line) as Command);
  } catch (err) {
    return `not JSON: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (typeof header !== "object" || header === null || !isInt(header.protocol) || !isInt(header.seed, -2147483648) || typeof header.scenario !== "string") {
    return "bad header";
  }
  if (!Array.isArray(header.ai) || header.ai.length !== PLAYER_COUNT || !header.ai.every((a) => typeof a === "boolean")) return "bad header: ai";
  if (header.difficulty !== undefined && !header.difficulty.every((d) => (AI_DIFFICULTIES as readonly string[]).includes(d))) return "bad header: difficulty";
  if (header.map !== undefined && !(MAP_MODES as readonly string[]).includes(header.map)) return "bad header: map";
  let last = 0;
  for (const c of commands) {
    if (typeof c !== "object" || c === null || !isInt(c.t) || !isInt(c.p) || c.p >= PLAYER_COUNT || c.t < last) return "bad command line";
    last = c.t;
  }
  return { header, commands };
}

/**
 * Runs the game in `input.log` again up to `input.toTick` and checks it all the way; `onProgress`
 * every CONTINUE_PROGRESS_EVERY ticks. On success the runner stands at toTick, ready to go on.
 */
export function continueGame(input: ContinueInput, onProgress?: (tick: number) => void): ContinueResult {
  const read = readLog(input.log);
  if (typeof read === "string") return fail("log", 0, read);
  const { header, commands } = read;
  if (header.protocol !== PROTOCOL_VERSION) return fail("protocol", 0, `the log is protocol ${header.protocol}, this simulation ${PROTOCOL_VERSION}`);
  if ((header.build ?? "") !== (input.build ?? "")) return fail("build", 0, `the log is build ${header.build ?? "(none)"}, this simulation ${input.build ?? "(none)"}`);
  const toTick = input.toTick;
  if (!isInt(toTick)) return fail("log", 0, `bad toTick ${toTick}`);
  if (commands.length > 0 && commands[commands.length - 1].t >= toTick) return fail("log", toTick, "a command at or after toTick");
  const expected = new Map<number, string>();
  for (const h of input.hashes) {
    if (!isInt(h.tick) || typeof h.hash !== "string") return fail("log", 0, "bad hashes");
    expected.set(h.tick, h.hash);
  }
  for (let t = 0; t <= toTick; t += HASH_EVERY) if (!expected.has(t)) return fail("log", t, `no hash for tick ${t}`);
  const humans = header.ai.flatMap((ai, p) => (ai ? [] : [p]));
  const human = humans.length === 1 ? humans[0] : null;

  let runner: Runner;
  try {
    runner = new Runner({
      seed: header.seed,
      scenario: header.scenario,
      ai: header.ai,
      maxTicks: header.maxTicks ?? MAX_TICKS,
      difficulty: header.difficulty,
      autoTrain: header.autoTrain,
      map: header.map,
      build: header.build,
    });
  } catch (err) {
    return fail("log", 0, `cannot start the game: ${err instanceof Error ? err.message : String(err)}`);
  }
  const g = runner.game;
  const ownHash = () => hex8(g.hash());
  if (ownHash() !== expected.get(0)) return fail("hash", 0, `tick 0: ${ownHash()}, the log ${expected.get(0)}`);
  // The log's lines as applied, in order; the person's are queued for their tick before the AIs think.
  const lines = commands.map((c) => JSON.stringify(c));
  let next = 0;
  while (g.tick < toTick && !g.w.over) {
    const tick = g.tick;
    for (let k = next; k < commands.length && commands[k].t === tick; k++) if (!header.ai[commands[k].p]) g.push(commands[k]);
    const from = g.log.length;
    runner.tick();
    for (let k = from; k < g.log.length; k++, next++) {
      const got = JSON.stringify(g.log[k]);
      if (next >= lines.length || got !== lines[next]) {
        return fail("commands", tick, `tick ${tick}: applied ${got.slice(0, 200)}, the log ${next < lines.length ? lines[next].slice(0, 200) : "(none)"}`);
      }
    }
    if (next < commands.length && commands[next].t <= tick) return fail("commands", tick, `tick ${tick}: the log has ${lines[next].slice(0, 200)}, not applied`);
    if (g.tick % HASH_EVERY === 0 && expected.has(g.tick) && ownHash() !== expected.get(g.tick)) {
      return fail("hash", g.tick, `tick ${g.tick}: ${ownHash()}, the log ${expected.get(g.tick)}`);
    }
    if (onProgress !== undefined && g.tick % CONTINUE_PROGRESS_EVERY === 0) onProgress(g.tick);
  }
  if (g.tick < toTick) return fail("log", g.tick, `the game ended at tick ${g.tick}, before toTick ${toTick}`);
  if (next !== commands.length) return fail("commands", g.tick, `${commands.length - next} commands in the log not applied`);
  return { ok: true, runner, header, human };
}
