// The build's check (scripts/check-public-urls.ts, ceo 2026-11-21): a URL from the site's root to a file of public/ is
// not found under /war-game/proto/; relative ones and other sites' are fine.

import assert from "node:assert/strict";
import { test } from "node:test";
import { rootPublicUrls } from "../scripts/check-public-urls.ts";

const PUBLIC = ["art", "cursors", "icons", "manifest.webmanifest", "sw.js"];

test("從網站根目錄指到 public 的網址會被找到；相對的、別的網站的、名字只是開頭一樣的不算", () => {
  assert.deepEqual(rootPublicUrls(`.a{cursor:url(/cursors/sword-32.png) 2 3,auto}`, PUBLIC), ["/cursors/sword-32.png"]);
  assert.deepEqual(rootPublicUrls(`.a{cursor:image-set(url("/cursors/a-32.png") 1x)}`, PUBLIC), ["/cursors/a-32.png"]);
  assert.deepEqual(rootPublicUrls(`const a="/art/units.png",b='/sw.js',c=\`/icons/x.svg\`;`, PUBLIC), ["/art/units.png", "/sw.js", "/icons/x.svg"]);
  assert.deepEqual(rootPublicUrls(`url(../cursors/sword-32.png) "./art/x.png" "art/x.png" "https://x.io/art/x.png"`, PUBLIC), []);
  assert.deepEqual(rootPublicUrls(`"/artwork/x.png" "/cursorsy" "/sw.jsx"`, PUBLIC), [], "only public's own names");
  assert.deepEqual(rootPublicUrls(`url(/cursors/a.png)`, []), []);
});
