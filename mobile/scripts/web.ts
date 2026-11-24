// The web side of the app (D-163): the client's build (client/dist, made as pages.yml makes it,
// atlases included) copied into mobile/www, Capacitor's webDir, with the licence texts beside it;
// then every outside address in it checked. The game is carried in the app: nothing it needs may
// come from the network.
//
//   node scripts/web.ts [--client <dist>] [--no-art]    the app as it ships (TestFlight)
//   node scripts/web.ts --smoke                          the simulator smoke test's copy:
//     - the game records' Worker address turned into https://offline.invalid/logs, so no CI game ever
//       reaches the real Worker (ceo 2026-11-24) and the app has nothing on the network at all
//       (offline in effect: the simulator has no airplane mode);
//     - smoke/mobile-diag.js first in <head>: page errors, the WebGL facts and a few others written
//       into the page, where the XCUITest reads them.
// --no-art: a build without the atlases (this machine, trying the script); CI never passes it.

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const MOBILE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(MOBILE, "..");
const CLIENT = join(ROOT, "client");
const WWW = join(MOBILE, "www");
const OFFLINE_LOGS = "https://offline.invalid/logs";

/**
 * Outside addresses the build may name without ever fetching them: XML namespaces (the SVG icon,
 * PixiJS) and PixiJS's greeting in the console. Anything else fails: it would be a download the app
 * cannot make offline.
 */
const NEVER_FETCHED: Record<string, string> = {
  "www.w3.org": "XML namespaces",
  "www.pixijs.com": "PixiJS's console greeting",
};
const TEXT = new Set([".js", ".mjs", ".html", ".css", ".json", ".webmanifest", ".svg", ".txt", ".md"]);

const { values } = parseArgs({
  options: {
    client: { type: "string", default: join(CLIENT, "dist") },
    smoke: { type: "boolean", default: false },
    "no-art": { type: "boolean", default: false },
  },
});
const dist = resolve(values.client);
const smoke = values.smoke;

function fail(message: string): never {
  console.error(`::error::${message}`);
  process.exit(1);
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? files(p) : [p];
  });
}

/** The game records' Worker, as the client names it (client/src/logs/collect.ts). */
function logsUrl(): string {
  const src = readFileSync(join(CLIENT, "src", "logs", "collect.ts"), "utf8");
  const url = /export const GAME_LOGS_URL = "([^"]+)"/.exec(src)?.[1];
  if (url === undefined) fail("client/src/logs/collect.ts: GAME_LOGS_URL not found");
  return url;
}

// 1. The client's build, as it is.
for (const f of ["index.html", "version.json"]) if (!existsSync(join(dist, f))) fail(`${dist}: no ${f} (build the client first: npm run build in client/)`);
const tag = (JSON.parse(readFileSync(join(CLIENT, "art.lock.json"), "utf8")) as { tag: string | null }).tag;
if (tag !== null && !values["no-art"] && !existsSync(join(dist, "art", tag, "x3"))) {
  fail(`${dist}: no art/${tag}/x3 (node scripts/fetch-art.ts in client/ before its build)`);
}
rmSync(WWW, { recursive: true, force: true });
// Dot files (the atlases' .lock stamp) stay behind.
cpSync(dist, WWW, { recursive: true, filter: (src) => !src.slice(dist.length).split("/").some((part) => part.startsWith(".")) });

// 2. The licence texts of what the app carries (MIT: the notice goes with every copy).
const licenses = join(WWW, "licenses");
mkdirSync(licenses, { recursive: true });
for (const [from, to] of [
  [join(MOBILE, "node_modules", "@capacitor", "ios", "LICENSE"), "capacitor-LICENSE.txt"],
  [join(CLIENT, "node_modules", "pixi.js", "LICENSE"), "pixi.js-LICENSE.txt"],
  [join(CLIENT, "THIRD_PARTY_NOTICES.md"), "client-THIRD_PARTY_NOTICES.md"],
  [join(MOBILE, "THIRD_PARTY_NOTICES.md"), "mobile-THIRD_PARTY_NOTICES.md"],
] as const) {
  if (!existsSync(from)) fail(`${relative(ROOT, from)} missing (npm ci in client/ and mobile/ first)`);
  copyFileSync(from, join(licenses, to));
}

// 3. The smoke test's copy.
const worker = logsUrl();
if (smoke) {
  let replaced = 0;
  for (const f of files(WWW).filter((p) => extname(p) === ".js")) {
    const text = readFileSync(f, "utf8");
    const parts = text.split(worker);
    if (parts.length > 1) {
      replaced += parts.length - 1;
      writeFileSync(f, parts.join(OFFLINE_LOGS));
    }
  }
  if (replaced === 0) fail(`${worker} not found in the build's JavaScript: the smoke copy could reach the real Worker`);
  console.log(`smoke: ${worker} → ${OFFLINE_LOGS} (${replaced}×)`);

  const index = join(WWW, "index.html");
  const html = readFileSync(index, "utf8");
  if (!html.includes("<head>")) fail("index.html: no <head>");
  writeFileSync(index, html.replace("<head>", '<head>\n    <script src="mobile-diag.js"></script>'));
  copyFileSync(join(MOBILE, "smoke", "mobile-diag.js"), join(WWW, "mobile-diag.js"));
}

// 4. Every outside address named anywhere in the text files.
const allowed = new Map(Object.entries(NEVER_FETCHED));
allowed.set(smoke ? new URL(OFFLINE_LOGS).host : new URL(worker).host, smoke ? "the smoke copy's dead address" : "the game records' Worker (D-056)");
const found = new Map<string, Set<string>>();
// licenses/ is read by people, never by the game: its notices may link to their sources.
for (const f of files(WWW)) {
  if (!TEXT.has(extname(f)) || statSync(f).size > 32 * 1024 * 1024 || relative(WWW, f).startsWith("licenses/")) continue;
  for (const m of readFileSync(f, "utf8").matchAll(/\bhttps?:\/\/([A-Za-z0-9.-]+(?::\d+)?)/g)) {
    const host = m[1];
    if (!found.has(host)) found.set(host, new Set());
    found.get(host)?.add(relative(WWW, f));
  }
}
const unknown = [...found].filter(([host]) => !allowed.has(host));
for (const [host, where] of found) console.log(`address ${host}: ${allowed.get(host) ?? "NOT ALLOWED"} (${[...where].slice(0, 3).join(", ")})`);
if (smoke && found.has(new URL(worker).host)) fail(`the smoke copy still names ${new URL(worker).host}`);
if (unknown.length > 0) fail(`outside addresses the app cannot reach offline: ${unknown.map(([h]) => h).join(", ")}`);

// 5. What is in it.
const all = files(WWW);
const bytes = (list: string[]) => list.reduce((n, f) => n + statSync(f).size, 0);
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
console.log(`www${smoke ? " (smoke)" : ""}: ${all.length} files, ${mb(bytes(all))}`);
for (const top of readdirSync(WWW)) {
  const p = join(WWW, top);
  if (statSync(p).isDirectory()) console.log(`  ${top}/: ${mb(bytes(files(p)))}`);
}
