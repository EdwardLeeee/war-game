// 進駐 (D-124, D-125; design/r13 R13-01 B and B2) on the fake world with outposts that hide
// (?test=1&mock=1&r7=1&outpost=1&hide=1): one button, then each place it can go into carries a tag
// saying who goes in and who stays (grey where nobody can), off each other and off the interface;
// a full one says so; one off the screen has an arrow that brings the camera to it. Under the
// prototype's look and under 正式介面 (?ui=r6) alike.

import { expect, type Page, test } from "@playwright/test";
import { expectSaid, selectForCommands, shot, watchErrors, watchToasts } from "./helpers.ts";
import { tap } from "./touch.ts";

const TICKS = { timeout: 30_000 };

const enterState = (page: Page) => page.evaluate(() => window.__proto?.game?.enter() ?? { tags: [], arrows: [], blockers: [], prompt: "" });
const units = (page: Page) => page.evaluate(() => window.__proto?.game?.units() ?? []);
const buildings = (page: Page) => page.evaluate(() => window.__proto?.game?.buildings() ?? []);
const sent = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []) as Record<string, unknown>[]);
const mode = (page: Page) => page.evaluate(() => window.__proto?.game?.mode());
const centre = (page: Page, x: number, y: number, scale = 1) => page.evaluate(([a, b, s]) => window.__proto?.game?.centerOn(a, b, s), [x, y, scale] as const);
const at = (page: Page, x: number, y: number) => page.evaluate(([a, b]) => window.__proto?.game?.cellToScreen(a, b) ?? { x: 0, y: 0 }, [x, y] as const);
const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

async function start(page: Page, ui: string): Promise<void> {
  await watchToasts(page);
  await page.goto(`./?test=1&mock=1&r7=1&outpost=1&hide=1&tps=20${ui}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  // Running (正式介面's first seconds in CI's WebKit can hold the page's thread, where the fake world runs).
  await page.waitForFunction(() => (window.__proto?.game?.header().tick ?? 0) > 5, null, { timeout: 60_000 });
}

async function own(page: Page, types: number[]): Promise<number[]> {
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  return (await units(page)).filter((u) => u.owner === me && types.includes(u.type)).map((u) => u.id).sort((a, b) => a - b);
}

/** 進駐 pressed; waits for the tags. */
async function pick(page: Page): Promise<void> {
  await page.locator(".cmds").getByRole("button", { name: /^進駐/ }).tap();
  await expect.poll(() => mode(page)).toBe("enter");
  await expect.poll(async () => (await enterState(page)).tags.length).toBeGreaterThan(0);
}

/** Every tag drawn in full keeps off the interface and off each other (R13-01-B2 rule 3). */
async function tagsClear(page: Page): Promise<void> {
  const s = await enterState(page);
  const full = s.tags.filter((t) => t.mode === "full");
  for (const t of full) {
    for (const b of s.blockers) expect(overlap(t, b), `${t.name}'s tag over the interface`).toBe(false);
    for (const o of full) if (o !== t) expect(overlap(t, o), `${t.name}'s tag over ${o.name}'s`).toBe(false);
  }
}

for (const [ui, name] of [["", "原型"], ["&ui=r6", "正式介面"]] as const) {
  test(`進駐（${name}）：只選槍兵時主城是灰的「槍兵進不去」，城和哨所亮著；點灰的說明原因、還在選；混選時每棟寫進誰留誰，標籤不蓋介面、不互蓋；選取資訊收起，取消後回來`, async ({ page }, info) => {
    const check = watchErrors(page);
    await start(page, ui);
    const spears = await own(page, [1]);
    const city = (await buildings(page)).find((b) => b.type === 0 && b.owner === 0);
    const post = (await buildings(page)).find((b) => b.type === 12 && b.owner === 0);
    if (city === undefined || post === undefined) throw new Error("no main city or outpost");
    await centre(page, 14, 72, 0.8);
    // R13-01 state 3: spearmen only.
    await selectForCommands(page, spears);
    await pick(page);
    await expect(page.locator(".sel-info").getByRole("button", { name: "展開選取資訊" })).toBeVisible();
    let s = await enterState(page);
    expect(s.prompt).toBe("點亮起來的建築：標籤寫誰進去、誰留下");
    expect(s.tags.find((t) => t.id === `b${city.id}`)).toMatchObject({ head: "槍兵進不去", off: true });
    expect(s.tags.find((t) => t.id === `b${post.id}`)).toMatchObject({ head: `進 槍兵 ${spears.length}`, off: false });
    expect(s.tags.some((t) => t.id.startsWith("t") && !t.off), "a town of ours lit").toBe(true);
    await shot(page, info, `enter-3-spears${ui === "" ? "" : "-r6"}`);
    // A grey one tapped: why; still picking, nothing sent.
    const before = (await sent(page)).length;
    await tap(page, await at(page, city.cx + city.size / 2, city.cy + city.size / 2));
    await expectSaid(page, "槍兵進不去主城");
    expect(await mode(page)).toBe("enter");
    expect((await sent(page)).slice(before).filter((c) => c.auto !== true)).toEqual([]);
    await page.locator(".cmds").getByRole("button", { name: /^取消\s*進駐/ }).tap();
    await expect.poll(() => mode(page)).toBe("normal");
    await expect(page.locator(".sel-info").getByRole("button", { name: "收起選取資訊" })).toBeVisible();
    // R13-01 state 4: everyone.
    const all = await own(page, [1, 2, 3]);
    await selectForCommands(page, all);
    await pick(page);
    s = await enterState(page);
    const hiders = (await own(page, [2, 3])).length;
    expect(s.tags.find((t) => t.id === `b${city.id}`)).toMatchObject({ off: false, sub: `留 槍兵 ${spears.length}` });
    expect(s.tags.find((t) => t.id === `b${post.id}`)?.sub).toMatch(/^留 遠程 \d+・法師 \d+$/);
    expect(s.tags.find((t) => t.id.startsWith("t") && !t.off)?.head).toBe(`進 ${all.length} 名全進城`);
    expect(hiders).toBeGreaterThan(0);
    await tagsClear(page);
    await shot(page, info, `enter-4-mixed${ui === "" ? "" : "-r6"}`);
    check();
  });
}

test("進駐：畫面外能進的建築在邊上有箭頭，點箭頭鏡頭移過去、還在選、不下指令（R13-01-B2 規則 7、10）", async ({ page }, info) => {
  const check = watchErrors(page);
  await start(page, "");
  // Spearmen far north-east of everything ours: our buildings off the screen.
  const spears = await own(page, [1]);
  await page.evaluate((u) => window.__proto?.game?.place(u, [{ x: 50, y: 40 }, { x: 51, y: 40 }, { x: 52, y: 40 }]), spears);
  await centre(page, 51, 40, 1);
  await selectForCommands(page, spears);
  await pick(page);
  // Laid out once a frame has drawn with the camera still (rule 6).
  await expect.poll(async () => (await enterState(page)).arrows.find((a) => a.name === "哨所"), TICKS).toMatchObject({ short: `進 ${spears.length} 名` });
  const s = await enterState(page);
  expect(s.tags.find((t) => t.name === "哨所")?.mode).toBe("off-screen");
  // Grey ones get no arrow (rule 7): the main city takes no spearmen.
  expect(s.arrows.some((a) => a.name === "主城")).toBe(false);
  await shot(page, info, "enter-7-arrows");
  // The arrow: the camera there, the outpost's tag on the screen, still picking, nothing sent.
  const before = (await sent(page)).length;
  await page.getByRole("button", { name: "鏡頭移到哨所" }).tap();
  await expect.poll(async () => (await enterState(page)).tags.find((t) => t.name === "哨所")?.mode, TICKS).toBe("full");
  expect(await mode(page)).toBe("enter");
  expect((await sent(page)).slice(before).filter((c) => c.auto !== true)).toEqual([]);
  await shot(page, info, "enter-7-after-arrow");
  // Then a tap on it: in they go, out of what is selected.
  const post = (await buildings(page)).find((b) => b.type === 12 && b.owner === 0);
  if (post === undefined) throw new Error("no outpost");
  await tap(page, await at(page, post.cx + post.size / 2, post.cy + post.size / 2));
  await expect.poll(async () => (await sent(page)).filter((c) => c.auto !== true).at(-1)).toMatchObject({ c: "post", u: spears, building: post.id });
  expect(await mode(page)).toBe("normal");
  expect((await page.evaluate(() => window.__proto?.game?.selection()))?.units).toEqual([]);
  check();
});
