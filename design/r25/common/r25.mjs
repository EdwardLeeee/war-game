// R25 新手教學: every frame of the tutorial on the real page (正式介面 A, 932 × 336 with the iPhone's
// safe area), the fake world standing in for core's tutorial scene, the interface as R24 left it (D-150:
// the bar, the commands in one row). Each frame in highlight A (the rest dimmed) or B (gold frame and
// arrow). Prints the client's button checks and whether the card covers a button or the game's prompt.
//   node design/r25/common/r25.mjs OUT [A|B|AB] [frame names...]
import { fileURLToPath } from "node:url";
import { browserType, open, own, PAGE, SAFE } from "../../r24/common/lib.mjs";

const OUT = process.argv[2];
const STYLES = (process.argv[3] ?? "A").split("");
const ONLY = process.argv.slice(4);
const R24_JS = fileURLToPath(new URL("../../r24/common/r24-page.js", import.meta.url));
const R25_JS = fileURLToPath(new URL("./tutorial-page.js", import.meta.url));
const browser = await browserType.launch();
const report = {};

async function page(style, extra = "&r7=1&outpost=1&siege=1") {
  const o = await open(browser, "r6", "a", extra);
  await o.page.addScriptTag({ path: R24_JS });
  await o.page.addScriptTag({ path: R25_JS });
  await o.page.evaluate((s) => window.R25.setStyle(s), style);
  return o;
}

async function shot(p, name, style) {
  await p.waitForTimeout(400);
  const file = `${name}-${style}`;
  await p.screenshot({ path: `${OUT}/${file}.png` });
  const c = await p.evaluate((s) => {
    const k = window.R24.check(s);
    // The card over a button (other than its own), or over the game's prompt.
    const card = document.querySelector(".r25-card")?.getBoundingClientRect();
    const hit = [];
    if (card) {
      const over = (r) => r.width > 0 && r.x < card.right - 1 && card.x < r.right - 1 && r.y < card.bottom - 1 && card.y < r.bottom - 1;
      for (const e of document.querySelectorAll("#hud button, .prompt, .enter-tag, .enter-arrow")) {
        if (e.closest(".r25-card") || e.closest("[hidden]")) continue;
        const r = e.getBoundingClientRect();
        if (over(r) && getComputedStyle(e).visibility !== "hidden") hit.push((e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 12));
      }
    }
    return { ...k, cardOver: hit };
  }, SAFE);
  // The card's own buttons are checked too; the dim covers buttons on purpose (A).
  report[file] = c;
  const bad = c.small.length + c.outside.length + c.cardOver.length;
  console.log(`${file}: ${c.count} buttons${bad ? ` | small ${JSON.stringify(c.small)} outside ${JSON.stringify(c.outside)} card over ${JSON.stringify(c.cardOver)}` : ", all ≥ 44 and in the safe area, the card over nothing"}`);
}

const tap = (p, sel, text) => p.evaluate(([s, t]) => [...document.querySelectorAll(s)].find((e) => !t || (e.textContent || "").includes(t)).click(), [sel, text]);
const G = (p, fn, arg) => p.evaluate(fn, arg);
const near = (p, type, cx, cy, owner = null) => G(p, ([t, x, y, o]) => {
  const g = window.__proto.game;
  const me = g.me();
  const us = g.units().filter((u) => u.type === t && u.owner === (o ?? me));
  us.sort((a, b) => (a.cx - x) ** 2 + (a.cy - y) ** 2 - ((b.cx - x) ** 2 + (b.cy - y) ** 2));
  return us;
}, [type, cx, cy, owner]);
const centreOfBuilding = (p, id) => G(p, (i) => { const b = window.__proto.game.buildings().find((v) => v.id === i); return b ? [b.cx + b.size / 2, b.cy + b.size / 2] : null; }, id);
async function tapCell(p, cx, cy) {
  const s = await G(p, ([x, y]) => window.__proto.game.cellToScreen(x, y), [cx, cy]);
  await p.touchscreen.tap(s.x, s.y);
  await p.waitForTimeout(400);
}
const SOLDIERS = [1, 2, 3];
/** A villager by the forest's edge (the forest is at cells 2-8 × 61-65), the camera on both. */
async function villager(p) {
  const [v] = await near(p, 0, 16, 74);
  await G(p, (i) => { const g = window.__proto.game; g.place([i], [g.openCellNear(10, 67)]); }, v.id);
  await runFor(p, 200);
  await G(p, () => window.__proto.game.centerOn(8, 64, 1.1));
  await p.waitForTimeout(300);
  return (await G(p, (i) => window.__proto.game.units().find((u) => u.id === i), v.id));
}
const ST = (p, parts) => G(p, (ps) => ps.map(([w, k, n]) => window.R24.st(w, k, n)).join("・"), parts);

const FRAMES = {
  // 1 看地圖: no single target; the gestures drawn.
  async "1a"(p) {
    await G(p, () => {
      window.R25.card({ n: 1, title: "看地圖", body: "用一根手指<b>拖動</b>畫面、兩根手指<b>縮放</b>，再按左下的「地圖」、點小地圖<b>跳過去</b>。", list: [["拖動畫面", true], ["兩指縮放", false], ["點小地圖", false]] });
      window.R25.gesture("drag", { x: 300, y: 250 }, { x: 430, y: 200 });
      window.R25.gesture("pinch", { x: 560, y: 235 });
    });
  },
  async "1b"(p) {
    await tap(p, ".side-left .map-btn");
    await p.waitForTimeout(700);
    await G(p, () => {
      window.R25.card({ n: 1, title: "看地圖", body: "點<b>小地圖</b>上任何地方，畫面就跳過去。", list: [["拖動畫面", true], ["兩指縮放", true], ["點小地圖", false]] });
      window.R25.spot({ sel: "#hud .minimap" }, { arrow: "right" });
    });
  },
  // 2 採集
  async "2a"(p) {
    const v = await villager(p);
    await G(p, ([x, y]) => {
      window.R25.card({ n: 2, title: "採集", body: "點一名<b>村民</b>。" });
      window.R25.spot({ cell: [x, y], r: 22 }, { arrow: "up" });
    }, [v.cx, v.cy]);
  },
  async "2b"(p) {
    const v = await villager(p);
    await G(p, (i) => window.__proto.game.select([i]), v.id);
    await G(p, () => window.R24.bar({ title: "村民", state: window.R24.st("閒置", "idle"), stateUnder: true }));
    // A tree in sight, nearest the middle of the play area.
    const tree = await G(p, () => {
      const g = window.__proto.game;
      const on = g.nodes().filter((n) => n.kind === 0).map((n) => ({ n, s: g.cellToScreen(n.cx + 0.5, n.cy + 0.5) })).filter(({ s }) => s.x > 150 && s.x < 600 && s.y > 175 && s.y < 260);
      on.sort((a, b) => (a.s.x - 330) ** 2 + (a.s.y - 200) ** 2 - ((b.s.x - 330) ** 2 + (b.s.y - 200) ** 2));
      return on[0]?.n ?? null;
    });
    if (tree === null) throw new Error("no tree in sight");
    await G(p, ([x, y]) => {
      window.R25.card({ n: 2, title: "採集", body: "再點一棵<b>樹</b>：村民就去砍，把木頭搬回主城。" });
      // The tree's picture stands above its cell: the frame over the crown and trunk.
      window.R25.spot({ cell: [x + 0.5, y + 0.5], r: 30, squash: 1.1, dy: -26 }, { arrow: "right" });
    }, [tree.cx, tree.cy]);
  },
  async "2c"(p) {
    const v = await villager(p);
    await G(p, ([x, y]) => {
      window.R25.card({ n: 2, title: "做得好！", state: "done", body: "村民會一直砍樹、搬回來。之後主城練出的新村民，會照主城的「<b>經濟分配</b>」自己去做事。" });
      window.R25.spot({ cell: [x, y], r: 22 }, { ok: true });
    }, [v.cx, v.cy]);
  },
  // 3 蓋兵營
  async "3a"(p) {
    const v = await villager(p);
    await G(p, (i) => window.__proto.game.select([i]), v.id);
    await G(p, () => {
      window.R24.bar({ title: "村民", state: window.R24.st("閒置", "idle"), stateUnder: true });
      window.R25.card({ n: 3, title: "蓋兵營", body: "選著村民，按右下的<b>建造</b>。" });
      window.R25.spot({ sel: "#hud .cmds button", text: "建造" }, { arrow: "up" });
    });
  },
  async "3b"(p) {
    const v = await villager(p);
    await G(p, (i) => window.__proto.game.select([i]), v.id);
    await G(p, () => window.R24.bar({ title: "村民", state: window.R24.st("閒置", "idle"), stateUnder: true }));
    await tap(p, "#hud .cmds button", "建造");
    await p.waitForTimeout(400);
    await G(p, () => {
      window.R25.card({ n: 3, title: "蓋兵營", body: "按<b>兵營</b>。<small>民居不用自己蓋：人口快滿時，主城會自動蓋（主城的「自動蓋民居」）。</small>" });
      window.R25.spot({ sel: "#hud .cmds button", text: "兵營" }, { arrow: "left" });
    });
  },
  async "3c"(p) {
    await G(p, () => window.__proto.game.startPlacement(6));
    await p.waitForTimeout(400);
    await tapCell(p, 20, 78);
    await G(p, () => {
      // The game's own prompt is up: the card hides until it ends; the frame stays.
      window.R25.keep({ sel: ".prompt" });
      window.R25.spot({ sel: ".place-confirm button", text: "✓" }, { arrow: "right" });
    });
  },
  async "3d"(p) {
    const id = await G(p, () => window.__proto.game.addBuilding(6, 19, 77));
    await G(p, (i) => window.__proto.game.progress(i, 0.35), id);
    await runFor(p, 300);
    const c = await centreOfBuilding(p, id);
    await G(p, ([x, y]) => {
      window.R25.card({ n: 3, title: "蓋兵營", state: "wait", body: "村民在蓋兵營，蓋好就往下。", wait: 0.35 });
      window.R25.spot({ cell: [x, y], r: 52 }, { arrow: null });
    }, c);
  },
  // 4 練兵
  async "4a"(p) {
    const c = await centreOfBuilding(p, 3);
    await G(p, ([x, y]) => window.__proto.game.centerOn(x + 6, y + 1, 1.1), c);
    await p.waitForTimeout(300);
    await tapCell(p, c[0], c[1]);
    await G(p, () => {
      window.R25.card({ n: 4, title: "練兵", body: "選著兵營，按 <b>5 下「訓練槍兵」</b>。", list: [["已排 0／5", false]] });
      window.R25.spot({ sel: "#hud .cmds button", text: "訓練槍兵" }, { arrow: "up" });
    });
  },
  async "4b"(p) {
    const c = await centreOfBuilding(p, 3);
    await G(p, ([x, y]) => window.__proto.game.centerOn(x + 6, y + 1, 1.1), c);
    await p.waitForTimeout(300);
    await tapCell(p, c[0], c[1]);
    for (let i = 0; i < 5; i++) await tap(p, "#hud .cmds button", "訓練槍兵");
    await p.waitForTimeout(300);
    await tap(p, "#hud .sel-info .sel-close");
    await p.waitForTimeout(300);
    await G(p, () => window.R25.card({ n: 4, title: "練兵", state: "wait", body: "練好 <b>2／5</b> 名。槍兵練好會站在兵營前面。", wait: 0.4 }));
  },
  // 5 選兵和移動
  async "5a"(p) {
    const box = await soldiersBox(p);
    await G(p, ([b]) => {
      window.R25.card({ n: 5, title: "選兵和移動", body: "在空地上<b>長按</b>一下，拖出框把兵框起來。" });
      window.R25.spot({ x: b.x0 - 14, y: b.y0 - 14, w: b.x1 - b.x0 + 28, h: b.y1 - b.y0 + 28 }, { arrow: null });
      window.R25.gesture("press", { x: b.x0 - 10, y: b.y0 - 8 }, { x: b.x1 + 10, y: b.y1 + 8 });
    }, [box]);
  },
  async "5b"(p) {
    await onSoldiers(p);
    const ids = await own(p, SOLDIERS);
    await G(p, (i) => window.__proto.game.select(i), ids);
    const state = await ST(p, [["待命", "idle"]]);
    await G(p, ([s]) => {
      window.R24.bar({ title: "已選", sub: "12", chips: [["槍兵", 6], ["遠程兵", 4], ["法師", 2]], state: s, stateUnder: true });
      window.R24.moreCmds(["攻擊", "移動", "進駐"], false);
      window.R25.card({ n: 5, title: "選兵和移動", body: "點<b>發亮的地方</b>：兵就走過去。" });
      const g = window.__proto.game;
      let best = null;
      for (let x = 0; x < 40; x++) for (let y = 55; y < 95; y++) { const q = g.cellToScreen(x + 0.5, y + 0.5); const d = (q.x - 300) ** 2 + (q.y - 215) ** 2; if (best === null || d < best.d) best = { x: x + 0.5, y: y + 0.5, d }; }
      const r = window.R25.spot({ cell: [best.x, best.y], r: 30 }, { arrow: "up" });
      window.R25.gesture("tap", { x: r.x + r.w / 2 + 8, y: r.y + r.h / 2 + 10 });
    }, [state]);
  },
  // 6 編軍團
  async "6a"(p) {
    const ids = await own(p, SOLDIERS);
    await G(p, (i) => window.__proto.game.select(i), ids);
    const state = await ST(p, [["待命", "idle"]]);
    await G(p, ([s]) => {
      window.R24.bar({ title: "已選", sub: "12", chips: [["槍兵", 6], ["遠程兵", 4], ["法師", 2]], state: s, stateUnder: true });
      window.R24.moreCmds(["攻擊", "移動", "進駐"], false);
      window.R25.card({ n: 6, title: "編軍團", body: "選著兵，按右邊的 <b>1</b>。" });
      window.R25.spot({ sel: ".groups > button" }, { arrow: "left" });
    }, [state]);
  },
  async "6b"(p) {
    const ids = await own(p, SOLDIERS);
    await G(p, (i) => window.__proto.game.select(i), ids);
    await tap(p, ".groups > button");
    await p.waitForTimeout(600);
    await G(p, () => {
      window.R24.capPanel();
      window.R24.fakeBar({ title: "編隊 1", sub: "還沒有兵", legion: "on" });
      window.R24.moreCmds(["攻擊", "移動", "進駐"], false);
      window.R25.card({ n: 6, title: "按「改成剛才選的」", place: "slim" });
      window.R25.spot({ sel: "#hud .sel-info button", text: "改成剛才選的" }, { arrow: "down" });
    });
  },
  async "6c"(p) {
    const ids = await own(p, SOLDIERS);
    await G(p, (i) => window.__proto.game.select(i), ids);
    await tap(p, ".groups > button");
    await p.waitForTimeout(400);
    const from = p.locator(".sel-info").getByRole("button", { name: /改成剛才選的/ });
    if (await from.isVisible().catch(() => false)) await from.evaluate((b) => b.click());
    await p.waitForTimeout(300);
    await tap(p, ".sel-info .sel-close");
    await tap(p, ".groups > button");
    await p.waitForTimeout(500);
    const state = await ST(p, [["待命", "idle"]]);
    await G(p, ([s]) => {
      window.R24.bar({ title: "編隊 1", sub: "12/12", chips: [["槍兵", 6], ["遠程兵", 4], ["法師", 2]], state: s, stateUnder: true, legion: true });
      window.R24.moreCmds(["攻擊", "移動", "進駐"], false);
      window.R25.card({ n: 6, title: "編好了！", state: "done", body: "之後按 <b>1</b> 就選到這個軍團。兵營也會<b>自動補兵</b>：軍團少了兵，就自己練、自己走過來。" });
      window.R25.spot({ sel: ".groups > button" }, { ok: true });
    }, [state]);
  },
  // 7 守家: the squad at the main city, the army out; then back home, attack.
  async "7a"(p) {
    await squadAtHome(p);
    // The game said it itself while running (homeNearCheck); its 2.2 s timer would hide the strip set here.
    await p.waitForTimeout(2600);
    await G(p, () => {
      window.R25.strip("敵軍 4 名接近主城");
      window.R25.card({ n: 7, title: "守家", body: "敵人來打主城了！按<b>全軍撤退</b>：軍團退回主城。" });
      window.R25.spot({ sel: "#hud .retreat-all-btn" }, { arrow: "down" });
    });
  },
  async "7b"(p) {
    const foes = await squadAtHome(p, true);
    const ids = await own(p, SOLDIERS);
    await G(p, (i) => window.__proto.game.select(i), ids);
    const state = await ST(p, [["移動", "move"]]);
    await G(p, ([s, f]) => {
      window.R24.bar({ title: "編隊 1", sub: "12/12", chips: [["槍兵", 6], ["遠程兵", 4], ["法師", 2]], state: s, stateUnder: true, legion: true });
      window.R24.moreCmds(["攻擊", "移動", "進駐"], false);
      window.R25.card({ n: 7, title: "守家", body: "軍團回來了。點<b>敵人</b>：軍團就去打，打光就過關。" });
      const r = window.R25.spot({ cell: [f[0], f[1]], r: 44 }, { arrow: "up" });
      window.R25.gesture("tap", { x: r.x + r.w / 2 + 10, y: r.y + r.h / 2 + 8 });
    }, [state, foes]);
  },
  // 8 打城鎮
  async "8a"(p) {
    await G(p, () => window.__proto.game.centerOn(8, 84, 1.1));
    await p.waitForTimeout(300);
    await G(p, () => {
      window.R25.card({ n: 8, title: "打城鎮", body: "中立的小鎮在右上：帶軍團去，打倒城裡的<b>民兵</b>。", go: "帶我去看" });
      window.R25.edge([30, 66], "小鎮");
    });
  },
  async "8b"(p, me) {
    await G(p, () => window.__proto.game.centerOn(30, 66, 1.1));
    await G(p, (m) => window.__proto.game.setTown(0, 1, m), me);
    await p.getByRole("button", { name: /繼續/ }).first().evaluate((b) => b.click());
    await p.waitForFunction(() => (window.__proto.game.towns() ?? []).find((t) => t.id === 0)?.state === 1, null, { timeout: 30000 });
    await G(p, (m) => window.__proto.game.inject({ k: "town_captured", town: 0, by: m }), me);
    await G(p, () => window.__proto.game.pause());
    await p.locator(".choice-govern").first().waitFor({ timeout: 20000 });
    await p.waitForTimeout(300);
    await G(p, () => {
      // The tutorial's town repairs in 10 s (core puts it in that game's rules, so the dialog says 10).
      for (const e of document.querySelectorAll(".choice-govern span")) e.textContent = e.textContent.replace(/修繕 \d+ 秒/, "修繕 10 秒");
      window.R25.card({ n: 8, title: "選治理", place: "side", body: "選<b>治理</b>：修 10 秒，之後每分鐘有糧和金。留守照預設就好。" });
      window.R25.spot({ sel: ".choice-govern" }, { arrow: "down" });
    });
  },
  async "8c"(p, me) {
    await G(p, () => window.__proto.game.centerOn(28, 68, 1.1));
    await G(p, (m) => window.__proto.game.setTown(0, 3, m), me);
    await runFor(p, 400);
    await G(p, () => {
      window.R25.card({ n: 8, title: "打城鎮", state: "wait", body: "城在修，再 <b>6 秒</b>。", wait: 0.4 });
      window.R25.spot({ cell: [30, 66], r: 70, squash: 0.6 }, { arrow: null });
    });
  },
  async "8d"(p, me) {
    await G(p, () => window.__proto.game.centerOn(29, 63.5, 1.1));
    await G(p, (m) => window.__proto.game.setTown(0, 4, m), me);
    await runFor(p, 400);
    const ids = await own(p, SOLDIERS);
    await G(p, (i) => window.__proto.game.select(i), ids);
    await tap(p, "#hud .cmds button", "進駐");
    await p.waitForTimeout(500);
    const state = await ST(p, [["待命", "idle"]]);
    await G(p, ([s]) => {
      window.R24.bar({ title: "編隊 1", sub: "12/12", chips: [["槍兵", 6], ["遠程兵", 4], ["法師", 2]], state: s, stateUnder: true, legion: true });
      // Picking: 進駐 reads 取消 (R24-03's one row keeps it where 進駐 was).
      window.R24.moreCmds(["攻擊", "移動", "取消"], false);
      // The game's own prompt and its tags: the card hides until picking ends.
      window.R25.keep({ sel: ".prompt" });
      for (const t of [...document.querySelectorAll(".enter-tag:not(.off)")].filter((e) => { const q = e.getBoundingClientRect(); return q.width > 0 && q.x > 2 && q.y > 2 && e.closest("[hidden]") === null; })) window.R25.keep({ sel: null, ...(() => { const r = t.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })() });
      window.R25.spot({ cell: [30, 66], r: 70, squash: 0.6 }, { arrow: "up" });
    }, [state]);
  },
  // 9 收尾: the siege engines at the enemy's (its barracks stands in for the main city in the fake world).
  async "9a"(p) {
    const siege = await own(p, [6]);
    const ids = [...siege, ...(await own(p, SOLDIERS))];
    const cells = await G(p, (n) => { const out = []; for (let i = 0; i < n; i++) { const c = window.__proto.game.openCellNear(28 + (i % 5), 63 + Math.floor(i / 5)); if (c) out.push(c); } return out; }, ids.length);
    await G(p, ([i, c]) => window.__proto.game.place(i, c), [ids, cells]);
    await runFor(p, 300);
    await G(p, () => window.__proto.game.centerOn(31, 61, 1.1));
    await G(p, (i) => window.__proto.game.select(i), ids);
    const c = await centreOfBuilding(p, 7);
    await G(p, ([b, n]) => {
      window.R24.bar({ title: "已選", sub: `${n}`, chips: [["攻城砲", 2], ["槍兵", 6], ["遠程兵", 4], ["法師", 2]], state: window.R24.st("待命", "idle"), stateUnder: true });
      window.R24.moreCmds(["攻擊", "移動", "進駐"], false);
      window.R25.card({ n: 9, title: "打下對手主城", body: "攻城砲打建築最快。選著攻城砲和軍團，點對手的<b>主城</b>。" });
      const r = window.R25.spot({ cell: b, r: 56, squash: 0.7 }, { arrow: "up" });
      window.R25.gesture("tap", { x: r.x + r.w / 2 + 12, y: r.y + r.h / 2 + 10 });
    }, [c, ids.length]);
  },
  async "9b"(p, me) {
    await G(p, (m) => window.__proto.game.endGame(m, 0), me);
    await p.waitForTimeout(1200);
    await G(p, () => {
      window.R25.card({
        n: 9, title: "教學完成！", place: "side", state: "done",
        body: "九步都會了：看地圖、採集、蓋房、練兵、選兵、編軍團、守家、打城鎮、打主城。",
        side: '<button type="button" class="b pri">開始第一局</button><button type="button" class="b secondary">回開局畫面</button>',
      });
      // The finish has no 跳過 or 離開.
      for (const b of [...document.querySelectorAll(".r25-card .r25-btns .b")].slice(2)) b.remove();
    });
  },
  // The parts: entry, leave, a card over a dialog.
  async "e-settings"(p) {
    await p.getByRole("button", { name: /選單/ }).first().evaluate((b) => b.click());
    await p.waitForTimeout(400);
    await p.getByRole("button", { name: /^設定/ }).first().evaluate((b) => b.click());
    await p.waitForTimeout(400);
    await G(p, () => {
      const pref = [...document.querySelectorAll(".dialog-card button")].find((b) => (b.textContent || "").includes("開局提示"));
      const t = document.createElement("button");
      t.type = "button";
      t.className = "b secondary";
      t.innerHTML = `${window.R25.svg("book")}<span>新手教學</span>`;
      pref.after(t);
      window.R25.spot({ sel: ".dialog-card button", text: "新手教學" }, { arrow: "up" });
    });
  },
  async "e-enter"(p) {
    await G(p, () => window.R25.confirmEnter());
  },
  async "e-leave"(p) {
    const v = await villager(p);
    await G(p, ([x, y]) => {
      window.R25.card({ n: 2, title: "採集", body: "點一名<b>村民</b>。" });
      window.R25.spot({ cell: [x, y], r: 22 }, { arrow: "up" });
      window.R25.confirmLeave();
    }, [v.cx, v.cy]);
  },
};

/** Run the fake world a moment (a snapshot for the screen), then pause again. */
async function runFor(p, ms) {
  await p.getByRole("button", { name: /繼續/ }).first().evaluate((b) => b.click());
  await p.waitForTimeout(ms);
  await G(p, () => window.__proto.game.pause());
  await p.waitForTimeout(200);
}

/** The camera on our soldiers (in this fake world they stand off the default view's right edge), low on the screen. */
async function onSoldiers(p) {
  await G(p, () => window.__proto.game.centerOn(20.5, 67.5, 1.1));
  await p.waitForTimeout(300);
}

/** Our soldiers' box on the screen. */
async function soldiersBox(p) {
  await onSoldiers(p);
  return G(p, () => {
    const g = window.__proto.game;
    const us = g.units().filter((u) => u.owner === g.me() && [1, 2, 3].includes(u.type)).map((u) => g.cellToScreen(u.fx ?? u.cx, u.fy ?? u.cy)).filter((q) => q.x > 140 && q.x < 640 && q.y > 140 && q.y < 300);
    const xs = us.map((u) => u.x);
    const ys = us.map((u) => u.y);
    return { x0: Math.min(...xs) - 10, y0: Math.min(...ys) - 30, x1: Math.max(...xs) + 10, y1: Math.max(...ys) + 8 };
  });
}

/** Four of the enemy's soldiers at our main city; ours away (`home`: ours back by it). Their centre in cells. */
async function squadAtHome(p, home = false) {
  const g = await G(p, ([h]) => {
    const w = window.__proto.game;
    const foes = w.units().filter((u) => u.owner === 1 && [1, 2, 3].includes(u.type)).slice(0, 4);
    const at = [];
    for (let i = 0; i < foes.length; i++) at.push(w.openCellNear(14 + (i % 2), 79 + Math.floor(i / 2)));
    w.place(foes.map((u) => u.id), at);
    const ours = w.units().filter((u) => u.owner === w.me() && [1, 2, 3].includes(u.type));
    const there = [];
    for (let i = 0; i < ours.length; i++) there.push(h ? w.openCellNear(9 + (i % 4), 75 + Math.floor(i / 4)) : w.openCellNear(36 + (i % 4), 70 + Math.floor(i / 4)));
    w.place(ours.map((u) => u.id), there);
    return [14.5, 79.5];
  }, [home]);
  await runFor(p, 250);
  await G(p, () => window.__proto.game.centerOn(12, 79, 1.1));
  await p.waitForTimeout(300);
  return g;
}

try {
  const names = ONLY.length ? ONLY : Object.keys(FRAMES);
  for (const style of STYLES) {
    for (const name of names) {
      const { ctx, page: p, me } = await page(style, name === "8b" ? "" : undefined);
      try {
        await FRAMES[name](p, me);
        await shot(p, name, style);
      } catch (e) {
        console.log(`${name}-${style}: FAILED ${e.message.split("\n")[0]}`);
      }
      await ctx.close();
    }
  }
  // The start screen with 新手教學 (before 開始).
  if (ONLY.length === 0 || ONLY.includes("e-start")) {
    const ctx = await browser.newContext({ viewport: { width: 932, height: 336 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await p.addInitScript(() => { localStorage.setItem("war-game.proto.theme", "a"); localStorage.setItem("war-game.proto.grade", "off"); });
    await p.goto(`${PAGE}?test=1&mock=1&tps=20&ui=r6&art=x3&ground=real`);
    await p.waitForTimeout(1500);
    await p.evaluate((s) => { const r = document.documentElement.style; for (const k of ["top", "right", "bottom", "left"]) r.setProperty(`--safe-${k[0]}`, `${s[k]}px`); }, SAFE);
    await p.addScriptTag({ path: R25_JS });
    await p.evaluate(() => {
      const go = [...document.querySelectorAll("#start button")].find((b) => (b.textContent || "").trim() === "開始");
      const t = document.createElement("button");
      t.type = "button";
      t.className = "b secondary r25-start";
      t.innerHTML = `${window.R25.svg("book")}<span>新手教學</span>`;
      const r = go.getBoundingClientRect();
      // Below whatever line of words sits under 開始 in its column.
      let below = r.bottom;
      for (const e of document.querySelectorAll("#start .card *")) {
        const q = e.getBoundingClientRect();
        if (e.children.length === 0 && (e.textContent || "").trim() !== "" && q.top >= r.bottom - 2 && q.top < r.bottom + 40 && q.left >= r.x - 10 && q.left < r.right) below = Math.max(below, q.bottom);
      }
      Object.assign(t.style, { position: "absolute", left: `${r.x}px`, top: `${below + 8}px`, width: `${r.width}px`, minHeight: "44px", zIndex: 5 });
      document.body.appendChild(t);
    });
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/e-start-A.png` });
    console.log("e-start", await p.evaluate(() => { const r = document.querySelector(".r25-start").getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }));
    await ctx.close();
  }
} finally {
  await browser.close();
  const { writeFileSync, readFileSync, existsSync } = await import("node:fs");
  const f = `${OUT}/checks.json`;
  const old = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
  writeFileSync(f, JSON.stringify({ ...old, ...report }, null, 1));
}
