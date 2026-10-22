// After a Pages deployment: open the published site in WebKit at iPhone size and check
// every page is there and the prototype is this commit's build. GitHub Pages can serve the
// previous version for a few minutes, so the prototype page is reloaded until it matches
// before anything else is checked.
//   node scripts/live-check.ts <site url> <commit, 7 characters> <out dir>

import { mkdirSync } from "node:fs";
import { devices, webkit } from "@playwright/test";

const [site, commit, out] = process.argv.slice(2);
if (site === undefined || commit === undefined || out === undefined) {
  console.error("usage: node scripts/live-check.ts <site url> <commit> <out dir>");
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const base = site.endsWith("/") ? site : `${site}/`;

const browser = await webkit.launch();
const page = await browser.newPage({ ...devices["iPhone 14 Pro Max landscape"] });
// What the page did, for a start that does not get ready in time: its last console lines, the
// requests that failed, and those still on their way (the atlases are tens of MB, fetched the
// first time after a deployment).
const consoleTail: string[] = [];
page.on("console", (m) => {
  consoleTail.push(`${m.type()}: ${m.text()}`);
  if (consoleTail.length > 30) consoleTail.shift();
});
const failedRequests: string[] = [];
page.on("requestfailed", (r) => failedRequests.push(`${r.url()} (${r.failure()?.errorText ?? "failed"})`));
const inFlight = new Map<string, number>();
page.on("request", (r) => inFlight.set(r.url(), Date.now()));
page.on("requestfinished", (r) => inFlight.delete(r.url()));
page.on("requestfailed", (r) => inFlight.delete(r.url()));

/** Where the start stands while it is not ready: the page's own load times (D-091), what is still loading, what failed. */
async function startReport(since: number): Promise<void> {
  console.log(`  ${((Date.now() - since) / 1000).toFixed(1)} s since 開始; ready: ${await page.evaluate(() => window.__proto?.ready ?? null)}`);
  const report = await page.evaluate(() => window.__proto?.loadTimes() ?? null);
  if (report === null) console.log("  load times: none (the game has not begun loading)");
  else {
    console.log(`  load marks (ms since the tap): ${JSON.stringify(report.marks)}; art: ${JSON.stringify(report.art)}`);
    const files = report.files;
    const bytes = files.reduce((n, f) => n + f.bytes, 0);
    console.log(`  files: ${files.length}, ${(bytes / 1048576).toFixed(1)} MB; slowest: ${[...files].sort((a, b) => b.downloaded - b.start - (a.downloaded - a.start)).slice(0, 3).map((f) => `${f.name} ${Math.round(f.downloaded - f.start)} ms (${f.source})`).join(", ") || "none"}`);
  }
  const now = Date.now();
  console.log(`  requests on their way: ${inFlight.size}${[...inFlight].slice(0, 5).map(([u, t]) => `\n    ${u} (${Math.round((now - t) / 1000)} s)`).join("")}`);
  console.log(`  requests failed: ${failedRequests.length}${failedRequests.slice(-5).map((f) => `\n    ${f}`).join("")}`);
  console.log(`  console (last ${consoleTail.length}):${consoleTail.map((l) => `\n    ${l}`).join("")}`);
}
const failures: string[] = [];
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

try {
  // proto/ first: once it serves this commit, the rest of the site is this deployment too.
  let seen = "";
  for (let i = 0; i < 40; i++) {
    await page.goto(`${base}proto/?test=1`);
    seen = (await page.evaluate(() => window.__proto?.commit ?? "")) || "";
    if (seen === commit) break;
    console.log(`proto/ still serves ${seen || "(no page)"}, want ${commit}; retry in 15 s`);
    await page.waitForTimeout(15_000);
  }
  check(seen === commit, `proto/ is commit ${commit} (saw ${seen || "nothing"})`);
  // 加到主畫面 and 有新版本 (D-042): the manifest is there, and version.json names this commit
  // (read the way the page reads it, past every cache).
  const version = await page.request.get(`${base}proto/version.json?t=${Date.now()}`);
  const deployed = version.ok() ? ((await version.json()) as { commit?: string }).commit : undefined;
  check(deployed === commit, `proto/version.json is commit ${commit} (saw ${deployed ?? "nothing"})`);
  const manifest = await page.request.get(`${base}proto/manifest.webmanifest`);
  check(manifest.ok(), `proto/manifest.webmanifest -> ${manifest.status()}`);
  await page.getByRole("button", { name: "開始" }).tap();
  // Ready within 30 s; past that, say where the start stands, and wait up to 60 s more before
  // failing (Pages run 39723212295: the first start after a deployment timed out once, its re-run
  // ready in 5 s).
  const tapped = Date.now();
  let ready = await page
    .waitForFunction(() => window.__proto?.ready === true, undefined, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  if (!ready) {
    console.log("proto/ not ready 30 s after 開始:");
    await startReport(tapped);
    await page.screenshot({ path: `${out}/proto-start-slow.png` });
    ready = await page
      .waitForFunction(() => window.__proto?.ready === true, undefined, { timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    if (ready) console.log(`::warning::proto/ was ready only ${((Date.now() - tapped) / 1000).toFixed(1)} s after 開始 (see the report above)`);
    else await startReport(tapped);
  }
  check(ready, `proto/ battlefield drawn (${((Date.now() - tapped) / 1000).toFixed(1)} s after 開始)`);
  if (!ready) throw new Error("proto/ never got ready");
  await page.screenshot({ path: `${out}/proto-battle.png` });

  let res = await page.goto(base);
  check(res?.ok() === true, `home ${base} -> ${res?.status()}`);
  check((await page.getByRole("link", { name: /原型/ }).count()) > 0, "home links to the prototype");
  await page.screenshot({ path: `${out}/home.png` });

  for (const path of ["web/", "godot/", "licenses.html"]) {
    res = await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    check(res?.ok() === true, `${path} -> ${res?.status()}`);
  }
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
