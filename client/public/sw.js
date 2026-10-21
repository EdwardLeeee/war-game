// 開一局要等多久 (D-091; amends D-042: no page is cached, only the pictures). The atlases of this
// build's art tag (the ?tag= it was registered with: art.lock.json's, e.g. art-v3) are kept on
// the phone the first time a game loads them, and taken from there after: a Release tag's files
// never change (scripts/fetch-art.ts checks each against the lock), so no copy can be stale.
// Everything else (the page, its code, version.json, the game records) is left to the network
// as before, so a deploy is the new version at once. A new tag's worker deletes the old tag's
// copies. Plain JavaScript: public/ is copied as it is, next to index.html.

const TAG = new URL(self.location.href).searchParams.get("tag") ?? "";
const PREFIX = "war-game-";
const CACHE = PREFIX + TAG;

self.addEventListener("install", () => {
  // Nothing to fetch ahead: the first game's own downloads fill the cache.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
      // This page's first game already: its downloads go through here.
      await self.clients.claim();
    })(),
  );
});

/** The response with a header saying where it came from (the load times show it: lab/load-times.ts). */
function marked(res, how) {
  const headers = new Headers(res.headers);
  headers.set("x-war-game-sw", how);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function fromCache(event) {
  const request = event.request;
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit !== undefined) return marked(hit, "hit");
  const res = await fetch(request);
  if (res.status !== 200) return res;
  // Kept while the page already decodes it; a phone out of room still gets the picture.
  event.waitUntil(cache.put(request, res.clone()).catch(() => {}));
  return marked(res, "stored");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (TAG === "" || request.method !== "GET") return;
  const art = new URL(`art/${TAG}/`, self.registration.scope).href;
  if (!request.url.startsWith(art)) return;
  event.respondWith(fromCache(event).catch(() => fetch(request)));
});
