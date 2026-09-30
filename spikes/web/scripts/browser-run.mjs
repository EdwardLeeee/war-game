// Loads the autorun build in a desktop browser (Playwright) and keeps every "SPIKE ..."
// console line until "SPIKE done". Headless browsers render with a software GPU, so the
// fps here are only a smoke test; the hashes are a real extra environment.
//   node scripts/browser-run.mjs <url> <chromium|webkit> <timeout s> <out dir>

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, webkit } from "playwright";

const [url, name, limitS, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await { chromium, webkit }[name].launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const lines = [];
let finished = false;
page.on("console", (msg) => {
  const text = msg.text();
  if (!text.startsWith("SPIKE")) return;
  lines.push(text);
  if (!text.startsWith("SPIKE hash")) console.log(text.slice(0, 300));
  if (text === "SPIKE done") finished = true;
});
page.on("pageerror", (err) => {
  lines.push(`SPIKE pageerror ${err.message}`);
  console.log(`::error::${name}: ${err.message}`);
});

await page.goto(url);
const deadline = Date.now() + Number(limitS) * 1000;
while (!finished && Date.now() < deadline) await page.waitForTimeout(1000);
await page.screenshot({ path: join(out, "screen.png") });
writeFileSync(join(out, "spike.txt"), lines.join("\n") + "\n");
writeFileSync(join(out, "device.txt"), `${name} ${browser.version()}\n`);
await browser.close();
console.log(`${lines.length} SPIKE lines; finished=${finished}`);
process.exit(finished ? 0 : 1);
