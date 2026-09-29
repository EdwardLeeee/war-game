// Walks the user's test steps on the published pages in WebKit with an iPhone-sized touch
// viewport: open the page, wait for the battle, press 開始量測, wait for the result box.
// Software GPU, so the numbers mean nothing; this only proves the steps work.
//   node scripts/live-check.mjs <out dir> <url>...

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { webkit } from "playwright";

const [out, ...urls] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await webkit.launch();
let failed = false;
for (const url of urls) {
  const name = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "home";
  const context = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const lines = [];
  page.on("console", (m) => m.text().startsWith("SPIKE") && lines.push(m.text()));
  page.on("pageerror", (e) => lines.push(`SPIKE pageerror ${e.message}`));
  await page.goto(url);
  const ready = await waitFor(() => lines.some((l) => l.startsWith("SPIKE ready")), 180);
  await page.screenshot({ path: join(out, `${name}-1-battle.png`) });
  const button = page.locator("#measure, #spike-measure");
  await button.first().tap();
  const result = page.locator("#result, #spike-result");
  let shown = false;
  try {
    await result.first().waitFor({ state: "visible", timeout: 90_000 });
    shown = true;
  } catch {
    shown = false;
  }
  await page.screenshot({ path: join(out, `${name}-2-result.png`) });
  const text = shown ? await result.first().innerText() : "(no result box)";
  writeFileSync(join(out, `${name}.txt`), [`ready=${ready} result=${shown}`, text, ...lines].join("\n") + "\n");
  console.log(`${url}: ready=${ready} result box=${shown}\n${text}\n`);
  if (!ready || !shown) failed = true;
  await context.close();

  async function waitFor(fn, seconds) {
    for (let i = 0; i < seconds; i++) {
      if (fn()) return true;
      await page.waitForTimeout(1000);
    }
    return false;
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
