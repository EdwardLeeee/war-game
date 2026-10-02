// 加到主畫面 (D-042): the manifest, the icons and the iOS tags that let the prototype open
// without the browser's address bar, and the 有新版本 notice that takes the place of an
// offline cache. Whether it really opens without the address bar can only be seen on the
// user's iPhone (and in an installed Chrome window): no browser here runs a page as an
// installed web app.

import { expect, type Page, test } from "@playwright/test";
import { shot, watchErrors } from "./helpers.ts";

let checkErrors: () => void;

test.beforeEach(async ({ page }) => {
  checkErrors = watchErrors(page);
});

test.afterEach(() => {
  checkErrors();
});

/** Width and height of a PNG, from its header. */
function pngSize(b: Buffer): { w: number; h: number } {
  expect(b.subarray(1, 4).toString("latin1"), "a PNG").toBe("PNG");
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

interface Manifest {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  orientation: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
}

/** A deployment newer than this page: version.json names another commit. */
const newerDeployed = (page: Page) =>
  page.route("**/version.json*", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ commit: "0000000" }) }));

test("加到主畫面：頁面連到 manifest；名稱、起始網址、範圍、全螢幕、橫向、192 和 512 的圖示都對；iOS 的標籤和 180 的圖示也在；沒有 service worker（D-042）", async ({ page, request }) => {
  await page.goto("./?test=1");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href, "a manifest link").not.toBeNull();
  const url = new URL(href ?? "", page.url());
  const res = await request.get(url.href);
  expect(res.ok()).toBe(true);
  const m = (await res.json()) as Manifest;
  expect(m).toMatchObject({ name: "war-game", short_name: "war-game", start_url: "./", scope: "./", display: "fullscreen", orientation: "landscape" });
  // Both resolve to the page's own folder (/war-game/proto/ on GitHub Pages, / here).
  const folder = new URL("./", page.url()).pathname;
  expect(new URL(m.start_url, url).pathname).toBe(folder);
  expect(new URL(m.scope, url).pathname).toBe(folder);
  // Chrome installs a web app only with a 192 and a 512 icon.
  for (const size of [192, 512]) {
    const icon = m.icons.find((i) => i.sizes === `${size}x${size}` && (i.purpose ?? "any").split(" ").includes("any"));
    expect(icon, `a ${size} icon`).toBeDefined();
    const r = await request.get(new URL(icon?.src ?? "", url).href);
    expect(r.ok(), `${size} icon loads`).toBe(true);
    expect(pngSize(await r.body())).toEqual({ w: size, h: size });
  }
  // iOS: the tags Safari reads before iOS 26, and the 180 icon it puts on the Home Screen.
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "war-game");
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);
  const touch = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  const t = await request.get(new URL(touch ?? "", page.url()).href);
  expect(t.ok(), "180 icon loads").toBe(true);
  expect(pngSize(await t.body())).toEqual({ w: 180, h: 180 });
  // Nothing is cached: no service worker (D-042).
  expect(await page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations())?.length ?? 0)).toBe(0);
});

test("有新版本：版本檔和頁面的 commit 一樣時不提示；線上換了版本，從背景回來或打開頁面時，開局畫面出現「更新」，按了重新載入（D-042）", async ({ page, request }, info) => {
  await page.goto("./?test=1");
  const own = await page.evaluate(() => window.__proto?.commit);
  const deployed = (await (await request.get(new URL("version.json", page.url()).href)).json()) as { commit: string };
  expect(deployed.commit, "version.json is this build").toBe(own);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator("#update")).toBeHidden();

  await newerDeployed(page);
  // Back from the background.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByText("有新版本")).toBeVisible();
  await shot(page, info, "update-notice");
  // 更新 loads the page anew at an address with the new commit (past any cached index.html),
  // keeping the page's own parameters: a mark left on the old page is gone afterwards.
  await page.evaluate(() => Object.assign(window, { oldPage: true }));
  await Promise.all([page.waitForURL(/[?&]v=0000000/), page.getByRole("button", { name: "更新" }).tap()]);
  await page.waitForLoadState("load");
  expect(new URL(page.url()).searchParams.get("test")).toBe("1");
  expect(await page.evaluate(() => "oldPage" in window)).toBe(false);
  // Opening the page while a newer one is out: the notice is there at once.
  await expect(page.getByText("有新版本")).toBeVisible();
});

test("有新版本：對局進行中只提示一次，不重新載入；回到開局畫面才有「更新」（D-042）", async ({ page }) => {
  await page.goto("./?test=1&mock=1&tps=20");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await newerDeployed(page);
  await page.evaluate(() => Object.assign(window, { samePage: true }));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  const told = page.getByRole("status").filter({ hasText: "有新版本：回到開局畫面" });
  await expect(told).toBeVisible();
  await expect(told).toBeHidden({ timeout: 5000 });
  // Told once: coming back again says nothing more, and the game goes on in the same page.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(500);
  await expect(told).toBeHidden();
  expect(await page.evaluate(() => "samePage" in window)).toBe(true);
  expect(await page.evaluate(() => window.__proto?.screen)).toBe("battle");
  // On the start screen, 更新 is there.
  await page.getByRole("button", { name: "選單" }).tap();
  await page.getByRole("button", { name: "回開局畫面" }).tap();
  await expect(page.getByRole("button", { name: "更新" })).toBeVisible();
  await expect(page.getByRole("button", { name: "繼續這局" })).toBeVisible();
});
