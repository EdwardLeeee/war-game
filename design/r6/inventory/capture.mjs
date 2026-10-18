// R6 inventory: screenshots of the prototype interface states that client/docs/screens has no
// picture of (design/r6/inventory.md). Fake world unless noted, Chromium with the iPhone 14 Pro Max
// landscape descriptor (814 x 380 with touch, as client/docs/screens), at device scale 2 so the
// small type stays readable.
//
//   (cd client && npm ci && npm run build && npm run preview)    # serves http://127.0.0.1:4173/
//   node design/r6/inventory/capture.mjs [INV-xx ...]           # -> design/r6/inventory/screens/INV-xx-<名>.png
//
// Playwright comes from client/node_modules. Every state is set up the way the client's e2e tests
// reach it (window.__proto, the test hook); taps and long presses send the PointerEvents a finger
// would (client/e2e/touch.ts).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, "../../../client/package.json"));
const { chromium, devices } = require("@playwright/test");
const OUT = join(HERE, "screens");
const BASE = "http://127.0.0.1:4173/";
const phone = { ...devices["iPhone 14 Pro Max landscape"], deviceScaleFactor: 2 };

const game = (page, fn, arg) => page.evaluate(([f, a]) => new Function("g", "a", `return (${f})(g, a)`)(window.__proto.game, a), [fn.toString(), arg]);
const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** PointerEvents on the battlefield canvas, timed in the page (client/e2e/touch.ts). */
async function pointer(page, steps, shotAfter = null) {
  return page.evaluate(async (steps) => {
    const canvas = document.querySelector("#stage canvas");
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const s of steps) {
      if (s.after) await sleep(s.after);
      canvas.dispatchEvent(new PointerEvent(s.type, { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: s.x, clientY: s.y,
        button: 0, buttons: s.type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true }));
    }
  }, steps);
}
const tap = (page, p) => pointer(page, [{ type: "pointerdown", ...p }, { type: "pointerup", ...p }]);
const longPress = (page, p, hold = 450) => pointer(page, [{ type: "pointerdown", ...p }, { type: "pointerup", ...p, after: hold }]);
const at = (page, x, y) => game(page, (g, a) => g.cellToScreen(a[0], a[1]), [x, y]);
const centre = (page, x, y, s = 1) => game(page, (g, a) => g.centerOn(a[0], a[1], a[2]), [x, y, s]);
const units = (page) => game(page, (g) => g.units());
const buildings = (page) => game(page, (g) => g.buildings());
const me = (page) => game(page, (g) => g.me());
const select = async (page, ids) => {
  const sorted = [...ids].sort((a, b) => a - b);
  await game(page, (g, a) => g.select(a), sorted);
  await page.waitForFunction((s) => document.querySelector(".cmds")?.getAttribute("data-selection") === s, sorted.join(","), { timeout: 5000 });
};
const button = (page, name) => page.getByRole("button", { name });

async function start(browser, query = "test=1&mock=1", opts = {}) {
  const ctx = await browser.newContext({ ...phone, ...opts });
  const page = await ctx.newPage();
  if (opts.route) await opts.route(page);
  await page.goto(`${BASE}?${query}`);
  if (!opts.noStart) {
    await button(page, "開始").tap();
    await page.waitForFunction(() => window.__proto?.ready === true);
    await centre(page, 22, 71);
    await wait(400);
  }
  return page;
}

async function shot(page, name) {
  await frames(page);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log("wrote", name);
}

async function mine(page, types) {
  const m = await me(page);
  return (await units(page)).filter((u) => u.owner === m && types.includes(u.type));
}
async function soldiers(page) {
  return (await mine(page, [1, 2])).map((u) => u.id);
}
async function tapBuilding(page, type) {
  const m = await me(page);
  const b = (await buildings(page)).find((x) => x.owner === m && x.type === type);
  if (!b) throw new Error(`no own building of type ${type}`);
  await centre(page, b.cx + b.size / 2, b.cy + b.size / 2);
  await wait(200);
  await tap(page, await at(page, b.cx + b.size / 2 - 0.5, b.cy + b.size / 2 - 0.5));
  await wait(300);
  return b;
}
async function tapTown(page, id) {
  const t = (await game(page, (g) => g.towns())).find((x) => x.id === id);
  await centre(page, t.cx, t.cy);
  await wait(250);
  for (const [dx, dy] of [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [0, 2], [-2, 0], [0, -2], [2, 2], [-2, -2]]) {
    const p = await at(page, t.cx + 0.5 + dx, t.cy + 0.5 + dy);
    if ((await game(page, (g, a) => g.pickAt(a[0], a[1]), [p.x, p.y])) === "town") {
      await tap(page, p);
      await wait(300);
      return;
    }
  }
  throw new Error(`no open ground in town ${id}`);
}

const SCENES = {
  "INV-13-有新版本": async (b) => {
    const page = await start(b, "test=1&mock=1", { noStart: true, route: (p) => p.route("**/version.json*", (r) => r.fulfill({ contentType: "application/json", body: '{"commit":"0000000"}' })) });
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.getByText("有新版本").waitFor({ timeout: 5000 });
    return page;
  },
  "INV-17-直向遮罩": async (b) => start(b, "test=1&mock=1", { noStart: true, viewport: { width: 380, height: 814 }, isMobile: true }),
  "INV-18-錯誤框（示意：改字）": async (b) => {
    const page = await start(b, "test=1&mock=1", { noStart: true });
    await page.evaluate(() => { const e = document.getElementById("error"); e.hidden = false; e.textContent = "出錯了：（示意的錯誤訊息）"; });
    return page;
  },
  "INV-24-速度快": async (b) => { const p = await start(b); await button(p, /^速度/).tap(); await wait(200); return p; },
  "INV-24-速度慢": async (b) => { const p = await start(b); await button(p, /^速度/).tap(); await button(p, /^速度/).tap(); await wait(200); return p; },
  "INV-37-全體回城開": async (b) => { const p = await start(b); await button(p, "全體回城").tap(); await wait(400); return p; },
  "INV-42-133-被攻擊紅點與箭頭": async (b) => {
    const p = await start(b);
    await game(p, (g) => g.inject({ k: "attacked", x: 80 * 1024 + 512, y: 20 * 1024 + 512, target: 1 }));
    await wait(700);
    return p;
  },
  "INV-125-43-開局提示": async (b) => { const p = await start(b, "test=1&mock=1&hint=1"); await wait(500); return p; },
  "INV-127-開局時要提示": async (b) => {
    const p = await start(b, "test=1&mock=1&hint=1");
    await button(p, "不再提示").tap();
    await button(p, "選單").tap();
    await button(p, "魔晶怎麼拿").tap();
    await wait(300);
    return p;
  },
  "INV-49-一名法師": async (b) => { const p = await start(b); const m = await mine(p, [3]); await select(p, [m[0].id]); return p; },
  "INV-90-109-取消晶砲與晶砲提示列": async (b) => {
    const p = await start(b); const m = await mine(p, [3]); await select(p, [m[0].id]);
    await button(p, /^晶砲/).tap(); await wait(300); return p;
  },
  "INV-136-晶砲校準弧": async (b) => {
    const p = await start(b); const m = await mine(p, [3]); await select(p, [m[0].id]);
    await centre(p, m[0].cx, m[0].cy, 1.4); await wait(200);
    await button(p, /^晶砲/).tap(); await wait(200);
    await tap(p, await at(p, m[0].cx + 4, m[0].cy - 3)); await wait(250); return p;
  },
  "INV-50-91-一名村民": async (b) => { const p = await start(b); const f = await mine(p, [0]); await select(p, [f[0].id]); return p; },
  "INV-53-多選只有村民": async (b) => { const p = await start(b); const f = await mine(p, [0]); await select(p, f.slice(0, 5).map((u) => u.id)); return p; },
  "INV-51-別人的單位": async (b) => {
    const p = await start(b); const m = await me(p);
    const e = (await units(p)).find((u) => u.owner !== m && u.type !== 4) ?? (await units(p)).find((u) => u.owner !== m);
    await centre(p, e.fx, e.fy, 1.4); await wait(300);
    const u = (await units(p)).find((x) => x.id === e.id);
    await tap(p, { x: u.sx, y: u.sy - 8 }); await wait(300); return p;
  },
  "INV-56-88-隊形散開": async (b) => {
    const p = await start(b); await select(p, await soldiers(p));
    await button(p, /^隊形/).tap(); await wait(400); return p;
  },
  "INV-56-88-隊形混合": async (b) => {
    const p = await start(b); const s = await soldiers(p);
    await select(p, s.slice(0, Math.ceil(s.length / 2))); await button(p, /^隊形/).tap(); await wait(400);
    await select(p, s); await wait(400); return p;
  },
  "INV-85-107-進攻選位置": async (b) => { const p = await start(b); await select(p, await soldiers(p)); await button(p, /^進攻/).tap(); await wait(300); return p; },
  "INV-87-堅守加框": async (b) => { const p = await start(b); await select(p, await soldiers(p)); await button(p, /^堅守/).tap(); await wait(600); return p; },
  "INV-80-81-軍團畫面空的": async (b) => {
    const p = await start(b); await select(p, await soldiers(p));
    await p.locator(".groups > button:nth-child(3)").tap(); await wait(400); return p;
  },
  "INV-81-自動補兵關": async (b) => {
    const p = await start(b); await select(p, await soldiers(p));
    await p.locator(".groups > button:nth-child(3)").tap(); await wait(300);
    await p.locator(".sel-info").getByRole("button", { name: /^改成剛才選的/ }).tap(); await wait(300);
    await p.locator(".sel-info").getByRole("button", { name: /^自動補兵/ }).tap(); await wait(400); return p;
  },
  "INV-97-109-集結點選位置": async (b) => { const p = await start(b); await tapBuilding(p, 6); await button(p, /集結點/).tap(); await wait(300); return p; },
  "INV-138-集結點線": async (b) => {
    const p = await start(b); const bb = await tapBuilding(p, 6); await button(p, /集結點/).tap(); await wait(200);
    await tap(p, await at(p, bb.cx + bb.size + 3, bb.cy - 1)); await wait(300);
    await tapBuilding(p, 6); await wait(300); return p;
  },
  "INV-74-城鎮中立": async (b) => { const p = await start(b); await tapTown(p, 0); return p; },
  "INV-74-城鎮敵方": async (b) => { const p = await start(b); await tapTown(p, 4); return p; },
  // the fake world's big city (town 3) is in the fog from the start: what shows is 還沒探索
  "INV-77-城鎮還沒探索": async (b) => { const p = await start(b); await tapTown(p, 3); return p; },
  "INV-75-城鎮廢墟": async (b) => { const p = await start(b); await tapTown(p, 2); return p; },
  "INV-144-城鎮攻下等選擇": async (b) => {
    const p = await start(b);
    await game(p, (g) => g.inject({ k: "town_captured", town: 0, by: 0 }));
    await p.getByRole("dialog", { name: /搶還是治理/ }).getByRole("button", { name: /^稍後再決定/ }).tap();
    await wait(600);
    await centre(p, 30, 66); await wait(400);
    return p;
  },
  "INV-123-攻下大城": async (b) => { const p = await start(b); await game(p, (g) => g.inject({ k: "town_captured", town: 3, by: 0 })); await wait(500); return p; },
  "INV-124-攻下只能治理": async (b) => { const p = await start(b, "test=1&mock=1&r7=1"); await game(p, (g) => g.inject({ k: "town_captured", town: 0, by: 0 })); await wait(500); return p; },
  "INV-117-選單": async (b) => { const p = await start(b); await button(p, "選單").tap(); await wait(300); return p; },
  "INV-118-兵種相剋三列": async (b) => { const p = await start(b); await button(p, "選單").tap(); await button(p, "兵種相剋").tap(); await wait(300); return p; },
  "INV-119-確定投降": async (b) => { const p = await start(b); await button(p, "選單").tap(); await button(p, "投降").tap(); await wait(300); return p; },
  "INV-129-失敗": async (b) => {
    const p = await start(b); await button(p, "選單").tap(); await button(p, "投降").tap();
    await p.getByRole("dialog").getByRole("button", { name: "投降" }).tap(); await wait(1200); return p;
  },
  "INV-130-勝利（示意：失敗畫面改字）": async (b) => {
    const p = await SCENES["INV-129-失敗"](b);
    await p.evaluate(() => { const d = document.querySelector(".dialog.result"); d.classList.add("won"); d.querySelector("h2").textContent = "勝利"; });
    return p;
  },
  "INV-120-經濟分配": async (b) => { const p = await start(b); await tapBuilding(p, 0); await button(p, /^經濟分配/).tap(); await wait(300); return p; },
  "INV-113-民兵警告": async (b) => {
    const p = await start(b); await centre(p, 24, 72); await select(p, []);
    await button(p, "建造").tap(); await button(p, /^民居/).tap(); await wait(200);
    await tap(p, await at(p, 22, 74)); await wait(400); return p;
  },
  "INV-101-長按圓圈": async (b) => {
    const p = await start(b); const pt = await at(p, 26, 68);
    await pointer(p, [{ type: "pointerdown", ...pt }]); await wait(170);
    await shot(p, "INV-101-長按圓圈"); await pointer(p, [{ type: "pointerup", ...pt }]); return null;
  },
  "INV-102-框選框": async (b) => {
    const p = await start(b); const a = await at(p, 20, 68); const c = { x: a.x + 160, y: a.y + 70 };
    await pointer(p, [{ type: "pointerdown", ...a }, { type: "pointermove", x: a.x + 40, y: a.y + 20, after: 450 },
      { type: "pointermove", x: c.x, y: c.y, after: 30 }]);
    await wait(150); await shot(p, "INV-102-框選框"); await pointer(p, [{ type: "pointerup", ...c }]); return null;
  },
  "INV-104-法師輪盤": async (b) => {
    const p = await start(b); const m = (await mine(p, [3]))[0]; await centre(p, m.fx, m.fy, 1.4); await wait(300);
    const u = (await units(p)).find((x) => x.id === m.id); await longPress(p, { x: u.sx, y: u.sy - 8 }); await wait(300); return p;
  },
  "INV-105-村民輪盤": async (b) => {
    const p = await start(b); const f = (await mine(p, [0]))[0]; await centre(p, f.fx, f.fy, 1.4); await wait(300);
    const u = (await units(p)).find((x) => x.id === f.id); await longPress(p, { x: u.sx, y: u.sy - 8 }); await wait(300); return p;
  },
};

const want = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const failed = [];
for (const [name, fn] of Object.entries(SCENES)) {
  if (want.length && !want.some((w) => name.startsWith(w))) continue;
  try {
    const page = await fn(browser);
    if (page) {
      await shot(page, name);
      await page.context().close();
    }
  } catch (e) {
    failed.push(name);
    console.log("FAILED", name, String(e).split("\n")[0]);
  }
}
await browser.close();
console.log(failed.length ? `failed: ${failed.join(", ")}` : "all done");
