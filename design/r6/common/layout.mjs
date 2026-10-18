// R6 B.3: the layout numbers of the spec, measured from the mock (so spec and drawings cannot drift): for each
// element, its box in pt on the 814 x 380 screen, in theme A. -> design/r6/build/layout.json
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, "../../../client/package.json"));
const { chromium } = require("@playwright/test");
const url = pathToFileURL(join(HERE, "../mock/ui.html")).href;
const ITEMS = [
  ["資源列", "INV-19", ".res"], ["速度鈕", "INV-19", ".topright .b:nth-child(1)"], ["暫停鈕", "INV-19", ".topright .b:nth-child(2)"],
  ["選單鈕", "INV-19", ".topright .b:nth-child(3)"], ["暫停橫幅", "INV-26", ".banner"], ["全軍撤退", "INV-19", ".retreat-all .b"],
  ["編隊鈕（每顆）", "INV-19", ".groups .grp"], ["全軍", "INV-19", ".groups .army"], ["退1", "INV-33", ".back-1 .b"],
  ["全體回城（跳出來）", "NEW-02", ".recall .b"], ["閒置", "INV-39", ".idlebox .b"], ["地圖鈕", "INV-39", ".maptab .b"], ["小地圖（方形）", "INV-40", ".screen > .minimap"],
  ["選取資訊", "INV-44", ".sel"], ["×", "INV-44", ".sel-head .x"], ["收起", "INV-44", ".sel-head .mini"], ["兵種鈕", "INV-44", ".chip"],
  ["指令區", "INV-84", ".cmds"], ["指令鈕（每顆）", "INV-84", ".cmds .b"], ["隊形鈕（兩格寬）", "INV-84", ".cmds .wide"],
  ["提示列", "INV-108", ".prompt"], ["訊息條", "INV-132", ".toast"], ["被攻擊箭頭", "NEW-04", ".screen > .arrow"],
  ["輪盤鈕", "INV-103", ".wheelb"], ["✓ ✗（每顆）", "INV-114", ".okx .b"], ["對話框", "INV-120", ".screen > .dialog"], ["開局卡片", "INV-01", ".screen > .start"],
];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 814, height: 380 } });
const out = [];
for (const [name, state, sel] of ITEMS) {
  await page.goto(`${url}?theme=a&state=${state}`);
  await page.waitForFunction(() => document.getElementById("screen")?.childElementCount > 0);
  await page.evaluate(() => document.fonts.ready);
  const r = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(814 - b.right), bottom: Math.round(380 - b.bottom) }; }, sel);
  if (!r) { console.log("missing", name, state, sel); process.exitCode = 1; continue; }
  out.push({ name, state, ...r });
}
writeFileSync(join(HERE, "../build/layout.json"), JSON.stringify(out, null, 1));
await browser.close();
console.log("measured", out.length);
