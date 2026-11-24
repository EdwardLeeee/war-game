// The old address's service worker (proto/sw.js?tag=…), now the game is at the site's home (the user 2026-11-24): a
// phone that still has it fetches this when it looks for an update, and this one takes its place and takes itself
// away (not inside activate's waitUntil: the registration stays until activation ends). It never answered for pages,
// only for the atlases (art/).
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", () => {
  self.registration
    .unregister()
    .then(() => self.clients.matchAll({ type: "window" }))
    .then((clients) => {
      for (const c of clients) c.navigate(c.url);
    });
});
