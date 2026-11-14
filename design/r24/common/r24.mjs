// R24 介面健檢: every 現況 and 改法 state on the real page (正式介面 A, 932 × 336, the iPhone's safe
// area, the fake world with art-v7.11), shot at the phone's 3x. 現況 and 改法 are shot here in the
// same browser so that the type is the same on both sides (the client's raw/ is WebKit's; this
// machine has no WebKit). Prints the client's button checks (zz-r24.spec.ts) for every state.
//   node design/r24/common/r24.mjs OUT_DIR [02|04 ...]
import { fileURLToPath } from "node:url";
import { browserType, open, own, SAFE } from "./lib.mjs";

const OUT = process.argv[2];
const ONLY = process.argv.slice(3);
const PAGE_JS = fileURLToPath(new URL("./r24-page.js", import.meta.url));
const browser = await browserType.launch();
const checks = {};

async function shot(page, name) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  const c = await page.evaluate((s) => window.R24.check(s), SAFE);
  checks[name] = c;
  const bad = c.small.length + c.overlaps.length + c.outside.length;
  console.log(`${name}: ${c.count} buttons${bad ? ` | small ${JSON.stringify(c.small)} overlaps ${JSON.stringify(c.overlaps)} outside ${JSON.stringify(c.outside)}` : ", all ≥ 44, none over another, all in the safe area"}`);
}

async function page(extra = "") {
  const o = await open(browser, "r6", "a", extra);
  await o.page.addScriptTag({ path: PAGE_JS });
  return o;
}

/** Run the fake world until `cond` holds (what the screen shows comes with a snapshot), then pause again. */
async function runUntil(p, cond, arg) {
  // The hook only pauses; 繼續 (top right) resumes.
  await p.getByRole("button", { name: /繼續/ }).first().evaluate((b) => b.click());
  await p.waitForFunction(cond, arg, { timeout: 30000 });
  await p.evaluate(() => { if (!window.__proto.game.header().paused) window.__proto.game.pause(); });
  await p.waitForTimeout(300);
}

const tap = (p, sel) => p.evaluate((s) => document.querySelector(s).click(), sel);
const ST = (p, parts) => p.evaluate((ps) => ps.map(([w, k, n]) => window.R24.st(w, k, n)).join("・"), parts);

/** Group 1 holding our soldiers, picked with its button (folded, as it is now). */
async function group(p) {
  const ids = await own(p);
  await p.evaluate((i) => window.__proto.game.select(i), ids);
  await tap(p, ".groups > button");
  await p.waitForTimeout(400);
  const from = p.locator(".sel-info").getByRole("button", { name: /改成剛才選的/ });
  if (await from.isVisible().catch(() => false)) await from.evaluate((b) => b.click());
  await p.waitForTimeout(300);
  await tap(p, ".sel-info .sel-close");
  await tap(p, ".groups > button");
  await p.waitForTimeout(500);
}

const CHIPS = [["槍兵", 6], ["遠程兵", 4], ["法師", 2]];

try {
  if (ONLY.length === 0 || ONLY.includes("02")) {
    // 選一名兵
    {
      const { ctx, page: p } = await page();
      const [one] = await own(p, [1]);
      await p.evaluate((i) => window.__proto.game.select([i]), one);
      await shot(p, "02-one-now");
      await p.evaluate(() => window.R24.bar({ title: "槍兵", hp: 100, state: window.R24.st("待命", "idle"), stateUnder: true }));
      await shot(p, "02-one-new");
      await ctx.close();
    }
    // 選了部隊 (the army: mixed orders), and ？ pressed
    {
      const { ctx, page: p } = await page();
      await p.evaluate((i) => window.__proto.game.select(i), await own(p));
      await shot(p, "02-army-now");
      const state = await ST(p, [["待命", "idle", 11], ["攻擊", "atk", 1]]);
      await p.evaluate(([c, s]) => window.R24.bar({ title: "已選", sub: "12", chips: c, state: s, stateUnder: true }), [CHIPS, state]);
      await shot(p, "02-army-new");
      await p.evaluate(([c, s]) => window.R24.bar({ title: "已選", sub: "12", chips: c, state: s, stateUnder: true, q: "on" }), [CHIPS, state]);
      const h = await p.evaluate(() => window.R24.explain("指令說明（點外面就收起）"));
      console.log(`explain: ${Math.round(h)} pt high (cap ${Math.round(336 * 0.4)})`);
      await shot(p, "02-army-q");
      // The worst case: five kinds, orders mixed.
      {
        const five = [...CHIPS, ["騎兵", 3], ["攻城砲", 1]];
        await p.evaluate(() => document.querySelector(".r24-pop")?.remove());
        await p.evaluate(([c, s]) => window.R24.bar({ title: "已選", sub: "16", chips: c, state: s, stateUnder: true }), [five, state]);
        await shot(p, "02-army5-new");
      }
      await ctx.close();
    }
    // 選一個軍團 (group button), and 軍團 tapped
    {
      const { ctx, page: p } = await page();
      await group(p);
      await shot(p, "02-group-now");
      const state = await ST(p, [["待命", "idle", 11], ["攻擊", "atk", 1]]);
      await tap(p, ".sel-info .sel-fold");
      await p.waitForTimeout(600);
      await shot(p, "02-groupscreen-now");
      // 改法: folded is the bar; 軍團 opens the same 軍團畫面, no higher than 40%.
      await tap(p, ".sel-info .sel-fold");
      await p.waitForTimeout(400);
      await p.evaluate(([c, s]) => window.R24.bar({ title: "編隊 1", sub: "12/12", chips: c, state: s, stateUnder: true, legion: true }), [CHIPS, state]);
      await shot(p, "02-group-new");
      await p.evaluate(() => {
        const f = document.querySelector("#hud .sel-info");
        f.querySelector(":scope > .r24-row")?.remove();
        f.classList.remove("r24-bar");
      });
      await tap(p, ".sel-info .sel-fold");
      await p.waitForTimeout(500);
      await p.evaluate(([c, s]) => {
        window.R24.capPanel();
        window.R24.fakeBar({ title: "編隊 1", sub: "12/12", chips: c, state: s, stateUnder: true, legion: "on" });
      }, [CHIPS, state]);
      await p.waitForTimeout(300);
      console.log("capped 軍團畫面", await p.evaluate(() => { const r = document.querySelector("#hud .sel-info").getBoundingClientRect(); const e = document.querySelector("#hud .sel-info .sel-body"); return [Math.round(r.y), Math.round(r.height), e ? `${e.scrollHeight}/${e.clientHeight}` : ""]; }));
      await shot(p, "02-groupscreen-new");
      await ctx.close();
    }
  }
  if (ONLY.length === 0 || ONLY.includes("04")) {
    // h1 資源堆很多、軍團都補滿: group 1 full, nothing selected, a lot in store.
    {
      const { ctx, page: p } = await page();
      await group(p);
      await tap(p, ".sel-info .sel-close");
      await p.evaluate(() => window.__proto.game.stock({ food: 2600, wood: 2400, gold: 1800, crystal: 0 }));
      await runUntil(p, () => window.__proto.game.resources().food >= 2500);
      await p.evaluate(() => window.__proto.game.centerOn(14, 76, 1.1));
      await p.evaluate(() => window.R24.hint("資源很多：軍團畫面可以打開「自動擴編」"));
      await shot(p, "04-h1-rich");
      await ctx.close();
    }
    // h2 第一次攻下城鎮: what the page does now (the town choice), so no hint is added.
    {
      const { ctx, page: p, me } = await page();
      await p.evaluate(() => window.__proto.game.centerOn(30, 66, 1.1));
      // As the client's zz-r24.spec.ts: the town ours and waiting for 搶 or 治理, then the event that opens the choice.
      await p.evaluate((m) => window.__proto.game.setTown(0, 1, m), me);
      await p.getByRole("button", { name: /繼續/ }).first().evaluate((b) => b.click());
      await p.waitForFunction(() => (window.__proto.game.towns() ?? []).find((t) => t.id === 0)?.state === 1, null, { timeout: 30000 });
      await p.evaluate((m) => window.__proto.game.inject({ k: "town_captured", town: 0, by: m }), me);
      await p.evaluate(() => window.__proto.game.pause());
      await p.getByRole("button", { name: /^搶/ }).first().waitFor({ timeout: 20000 });
      await p.evaluate(() => window.__proto.game.centerOn(30, 66, 1.1));
      await shot(p, "04-h2-taken");
      await ctx.close();
    }
    // h3 第一次治理成功: our governed town, soldiers selected (進駐 on with r7 and outposts).
    {
      const { ctx, page: p } = await page("&r7=1&outpost=1");
      await p.evaluate((i) => window.__proto.game.select(i), await own(p));
      await p.evaluate(() => window.__proto.game.centerOn(17, 66, 1.1));
      await tap(p, ".sel-info .sel-fold");
      await p.evaluate(() => window.R24.hint("城鎮修好了：選兵按「進駐」再點這座城，兵就會留下來守"));
      await shot(p, "04-h3-governed");
      await ctx.close();
    }
    // h4 打對手主城打很久 (the fake world has no enemy main city: its barracks stands in).
    {
      const { ctx, page: p } = await page();
      const ids = await own(p, [1, 2]);
      const cells = await p.evaluate((n) => { const out = []; for (let i = 0; i < n; i++) { const c = window.__proto.game.openCellNear(30 + (i % 4), 61 + Math.floor(i / 4)); if (c) out.push(c); } return out; }, ids.length);
      await p.evaluate(([i, c]) => { window.__proto.game.place(i, c); window.__proto.game.strike(i, 7); }, [ids, cells]);
      await p.evaluate(() => window.__proto.game.centerOn(32, 60, 1.1));
      await p.waitForTimeout(600);
      await p.evaluate(() => window.R24.hint("主城很耐打：帶攻城砲來打比較快"));
      await shot(p, "04-h4-keep");
      await ctx.close();
    }
    // h5 十名以上的兵，沒有編隊.
    {
      const { ctx, page: p } = await page();
      await p.evaluate(() => window.R24.hint("選好兵，再按右邊的 1–4，就能編成軍團"));
      await shot(p, "04-h5-groups");
      await ctx.close();
    }
  }
  if (ONLY.length === 0 || ONLY.includes("03")) {
    // 選了部隊 with 進駐 on (r7 and outposts: the real game's rules have it), as now and as proposed.
    const { ctx, page: p } = await page("&r7=1&outpost=1");
    await p.evaluate((i) => window.__proto.game.select(i), await own(p));
    await shot(p, "03-army-now");
    const moved = await p.evaluate(() => window.R24.moreCmds(["攻擊", "移動", "進駐"], false));
    console.log("更多 holds", moved.join(", "));
    await shot(p, "03-army-new");
    await p.evaluate(() => window.R24.moreCmds(["攻擊", "移動", "進駐"], true));
    await shot(p, "03-army-more");
    await ctx.close();
  }
  if (ONLY.length === 0 || ONLY.includes("all")) {
    // 總覽: 選了部隊, all of it as now, and with 02, 03 and a hint of 04 together.
    const { ctx, page: p } = await page("&r7=1&outpost=1");
    await p.evaluate((i) => window.__proto.game.select(i), await own(p));
    await shot(p, "all-now");
    const state = await ST(p, [["待命", "idle", 11], ["攻擊", "atk", 1]]);
    await p.evaluate(([c, s]) => {
      window.R24.bar({ title: "已選", sub: "12", chips: c, state: s, stateUnder: true });
      window.R24.moreCmds(["攻擊", "移動", "進駐"], false);
      window.R24.hint("選好兵，再按右邊的 1–4，就能編成軍團");
    }, [CHIPS, state]);
    await shot(p, "all-new");
    await ctx.close();
  }
} finally {
  await browser.close();
  const { writeFileSync, readFileSync, existsSync } = await import("node:fs");
  const f = `${OUT}/checks.json`;
  const old = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
  writeFileSync(f, JSON.stringify({ ...old, ...checks }, null, 1));
}
