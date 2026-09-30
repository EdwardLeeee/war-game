// Determinism across engines: plays AI-vs-AI games in Node, then replays their command logs
// in a real browser engine (Playwright: Chromium or WebKit) and compares every hash.
//   node src/browser-check.ts --browser chromium|webkit [--games 3] [--ticks 36000]
// The browser loads the simulation's own sources: requests to http://sim.test/src/... are
// answered from sim/src with the TypeScript types stripped (no build step, as in Node).
// Exits 1 on any difference.

import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import { chromium, webkit } from "playwright";
import { hex8 } from "./core/fixed.ts";
import { type LogHeader, MAX_TICKS } from "./protocol.ts";
import { Runner } from "./runner.ts";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const browserName = arg("browser", "chromium");
const games = Number(arg("games", "3"));
const maxTicks = Number(arg("ticks", String(MAX_TICKS)));
const src = new URL(".", import.meta.url).pathname;

// 1. Games in Node.
const logs: { seed: number; jsonl: string; hashes: { tick: number; hash: string }[]; ticks: number }[] = [];
for (let k = 0; k < games; k++) {
  const seed = 101 + k;
  const r = new Runner({ seed, scenario: "standard", ai: [true, true], maxTicks });
  while (!r.over && r.game.tick < maxTicks) r.tick();
  if (r.hashes.at(-1)!.tick !== r.game.tick) r.hashes.push({ tick: r.game.tick, hash: r.game.hash() });
  const head: LogHeader = r.header([true, true]);
  const jsonl = [JSON.stringify(head), ...r.game.log.map((c) => JSON.stringify(c))].join("\n") + "\n";
  logs.push({ seed, jsonl, ticks: r.game.tick, hashes: r.hashes.map((h) => ({ tick: h.tick, hash: hex8(h.hash) })) });
}

// 2. The same logs replayed in the browser.
const launcher = browserName === "webkit" ? webkit : chromium;
const browser = await launcher.launch();
const page = await browser.newPage();
await page.route("http://sim.test/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === "/index.html") {
    await route.fulfill({ contentType: "text/html", body: "<!doctype html><meta charset=utf-8><title>sim</title>" });
    return;
  }
  if (!path.startsWith("/src/") || path.includes("..")) {
    await route.fulfill({ status: 404, body: "" });
    return;
  }
  const code = readFileSync(join(src, path.slice("/src/".length)), "utf8");
  await route.fulfill({ contentType: "text/javascript", body: path.endsWith(".ts") ? stripTypeScriptTypes(code) : code });
});
await page.goto("http://sim.test/index.html");
const version = browser.version();
let failed = 0;
for (const log of logs) {
  const start = Date.now();
  type Replay = (jsonl: string, ticks: number) => { tick: number; hash: string }[];
  const got: { tick: number; hash: string }[] = await page.evaluate(
    async ({ jsonl, ticks, url }) => {
      const m = (await import(url)) as { replay: Replay };
      return m.replay(jsonl, ticks);
    },
    { jsonl: log.jsonl, ticks: log.ticks, url: "/src/browser-replay.ts" },
  );
  const ms = Date.now() - start;
  const same = got.length === log.hashes.length && got.every((h, i) => h.tick === log.hashes[i].tick && h.hash === log.hashes[i].hash);
  if (!same) failed++;
  const first = got.findIndex((h, i) => h.hash !== log.hashes[i]?.hash);
  console.log(
    `${browserName} ${version}: seed ${log.seed}, ${log.ticks} ticks, ${log.hashes.length} checkpoints: ` +
      (same ? `every hash matches Node (${ms} ms)` : `DIFFERS from tick ${got[first]?.tick} (${got[first]?.hash} vs ${log.hashes[first]?.hash})`),
  );
}
await browser.close();
if (failed > 0) process.exit(1);
