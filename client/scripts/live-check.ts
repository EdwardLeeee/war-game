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
  await page.waitForFunction(() => window.__proto?.ready === true, undefined, { timeout: 30_000 });
  check(true, "proto/ battlefield drawn");
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
