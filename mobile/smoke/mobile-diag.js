// The smoke test's eyes in the page (mobile/scripts/web.ts --smoke puts it first in <head>; never in
// the app that ships). It counts page errors from the very start, notes a few facts about the web
// view, and writes them as one line of text at the bottom-left corner, where the XCUITest
// (mobile/ci/SmokeUITests.swift) reads it through the accessibility tree:
//   mobile-diag {"errors":0,"first":"","sw":false,"astc":true,...,"saved":2400,"prev":[...]}
//
// The background save (D-083: the page keeps the game on visibilitychange / pagehide): what happened
// after the page went away is kept in localStorage and shown by the next page as "prev":
//   "hidden 0" / "pagehide 3"      the event, ms after the first one
//   "saved 2615 850"               the kept game's tick (IndexedDB) changed, at that ms
//   "alive 4000"                   the page still ran then (written every 500 ms for 20 s)
// and "saved" is the kept game's tick as this page finds it.
(() => {
  const LOG = "mobile-diag-log";
  const d = {
    errors: 0,
    first: "",
    /** navigator.serviceWorker exists (the client registers sw.js only then). */
    sw: "serviceWorker" in navigator,
    swRegs: null,
    webgl2: null,
    /** WEBGL_compressed_texture_astc on a WebGL 2 context: the iPhone's art path (D-128) or x2 PNG. */
    astc: null,
    proto: location.protocol,
    native: null,
    /** The kept game's tick (繼續上一局's IndexedDB), null: none. */
    saved: null,
    /** What the page before did after it went away. */
    prev: [],
    /** What this page did since it last went away (read again each second). */
    now: [],
  };
  const note = (what) => {
    d.errors += 1;
    if (d.first === "") d.first = String(what).slice(0, 160);
  };
  // Capture: elements that fail to load (a missing file) as well as script errors.
  addEventListener("error", (e) => note(e.message || `load failed: ${e.target?.src ?? e.target?.href ?? "?"}`), true);
  addEventListener("unhandledrejection", (e) => note(`unhandled rejection: ${e.reason?.message ?? e.reason}`));
  const error = console.error.bind(console);
  console.error = (...args) => {
    note(args.map(String).join(" "));
    error(...args);
  };
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    d.webgl2 = gl !== null;
    d.astc = gl === null ? null : gl.getExtension("WEBGL_compressed_texture_astc") !== null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch (e) {
    note(`diag webgl: ${e}`);
  }

  // The page before's log, then a fresh one for this page.
  try {
    d.prev = JSON.parse(localStorage.getItem(LOG) ?? "[]");
  } catch {
    d.prev = ["unreadable"];
  }
  localStorage.setItem(LOG, "[]");

  /**
   * The kept game's tick, read without ever creating the database: a fresh install has none yet,
   * and making it here (with no store) would break the client's own first open.
   */
  const savedTick = () =>
    new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open("war-game-continue");
      } catch {
        resolve("no indexedDB");
        return;
      }
      req.onupgradeneeded = () => req.transaction.abort();
      req.onerror = (e) => {
        e.preventDefault();
        resolve(null);
      };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const get = db.transaction("game", "readonly").objectStore("game").get("last");
          get.onsuccess = () => {
            resolve(typeof get.result?.tick === "number" ? get.result.tick : null);
            db.close();
          };
          get.onerror = () => {
            resolve(null);
            db.close();
          };
        } catch {
          resolve(null);
          db.close();
        }
      };
    });

  let away = null;
  const record = (line) => {
    try {
      const log = JSON.parse(localStorage.getItem(LOG) ?? "[]");
      log.push(line);
      localStorage.setItem(LOG, JSON.stringify(log.slice(-40)));
    } catch {
      // nothing to do: the log is only the test's
    }
  };
  const since = () => (away === null ? 0 : Math.round(performance.now() - away));
  const leaving = async (what) => {
    const first = away === null;
    if (first) away = performance.now();
    record(`${what} ${since()}`);
    if (!first) return;
    // Watch the save land, and how long the page keeps running, for 20 s.
    let last = await savedTick();
    record(`start ${last} ${since()}`);
    let lastAlive = 0;
    const end = away + 20000;
    while (performance.now() < end) {
      await new Promise((r) => setTimeout(r, 250));
      const now = await savedTick();
      if (now !== last) {
        last = now;
        record(`saved ${now} ${since()}`);
      }
      if (since() - lastAlive >= 500) {
        lastAlive = since();
        // One "alive" line, overwritten: the last time the page ran.
        try {
          const log = JSON.parse(localStorage.getItem(LOG) ?? "[]").filter((l) => !String(l).startsWith("alive "));
          log.push(`alive ${lastAlive}`);
          localStorage.setItem(LOG, JSON.stringify(log.slice(-40)));
        } catch {
          // as above
        }
      }
    }
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void leaving("hidden");
    else record(`visible ${since()}`);
  });
  addEventListener("pagehide", () => void leaving("pagehide"));
  document.addEventListener("freeze", () => record(`freeze ${since()}`));
  document.addEventListener("resume", () => record(`resume ${since()}`));

  const box = document.createElement("div");
  box.id = "mobile-diag";
  box.style.cssText =
    "position:fixed;left:2px;bottom:2px;z-index:2147483647;pointer-events:none;font:9px/1.2 monospace;color:#fff;background:rgba(0,0,0,.55);padding:1px 3px;max-width:70vw;white-space:normal";
  /**
   * Writes a line only when it changed: a text node replaced every second can be missing from the
   * accessibility tree just when XCUITest reads it (PR #580's first run: "No matches found" for
   * mobile-diag, read a second time right after the first).
   */
  const put = (el, text) => {
    if (el.textContent !== text) el.textContent = text;
  };
  const show = () => {
    try {
      d.now = JSON.parse(localStorage.getItem(LOG) ?? "[]").slice(-12);
    } catch {
      d.now = ["unreadable"];
    }
    d.native = typeof window.Capacitor?.isNativePlatform === "function" ? window.Capacitor.isNativePlatform() : null;
    put(box, `mobile-diag ${JSON.stringify(d)}`);
  };
  // The web view's screen, measured (client 2026-11-27: the app's numbers for its own tests, not
  // looked up): a second line at the top-left corner, read by SmokeUITests.testViewFacts in each
  // landscape, at the system's default and largest text size, and in Safari for comparison:
  //   mobile-view {"iw":932,"ih":430,"vv":[932,430,1,0,0],"dpr":3,"safe":[0,59,21,59],...}
  // safe: env(safe-area-inset-top, right, bottom, left) in CSS px; sysBody: -apple-system-body's
  // size (Dynamic Type reaches the page only through it); w15: four 國 at 15px -apple-system (the
  // client's font), wider than 60 when text is inflated.
  const view = document.createElement("div");
  view.id = "mobile-view";
  view.style.cssText =
    "position:fixed;left:2px;top:2px;z-index:2147483647;pointer-events:none;font:9px/1.2 monospace;color:#fff;background:rgba(0,0,0,.55);padding:1px 3px;max-width:70vw;white-space:normal";
  const probes = document.createElement("div");
  probes.style.cssText = "position:fixed;left:0;top:0;visibility:hidden;pointer-events:none";
  const safe = document.createElement("div");
  safe.style.cssText =
    "position:fixed;inset:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
  const sysBody = document.createElement("span");
  sysBody.style.font = "-apple-system-body";
  sysBody.textContent = "國";
  const w15 = document.createElement("span");
  w15.style.cssText = "font:15px -apple-system;white-space:nowrap";
  w15.textContent = "國國國國";
  probes.append(safe, sysBody, w15);
  const r2 = (v) => Math.round(v * 100) / 100;
  const facts = () => {
    try {
      const cs = getComputedStyle(safe);
      const html = getComputedStyle(document.documentElement);
      const body = getComputedStyle(document.body);
      const vv = window.visualViewport;
      const button = [...document.querySelectorAll("button")].find((b) => b.getClientRects().length > 0);
      return {
        iw: innerWidth,
        ih: innerHeight,
        cw: document.documentElement.clientWidth,
        ch: document.documentElement.clientHeight,
        vv: vv ? [r2(vv.width), r2(vv.height), r2(vv.scale), r2(vv.offsetLeft), r2(vv.offsetTop)] : null,
        scr: [screen.width, screen.height, screen.availWidth, screen.availHeight],
        dpr: devicePixelRatio,
        safe: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map((v) => r2(parseFloat(v))),
        orient: screen.orientation?.type ?? null,
        wo: typeof window.orientation === "number" ? window.orientation : null,
        tsa: [html.webkitTextSizeAdjust ?? null, body.webkitTextSizeAdjust ?? null],
        fs: [html.fontSize, body.fontSize],
        sysBody: getComputedStyle(sysBody).fontSize,
        w15: r2(w15.getBoundingClientRect().width),
        button: button ? [button.textContent.trim().slice(0, 8), getComputedStyle(button).fontSize, r2(button.getBoundingClientRect().height)] : null,
        ua: navigator.userAgent,
      };
    } catch (e) {
      return { failed: String(e) };
    }
  };
  const start = () => {
    document.body.append(box, view, probes);
    show();
    put(view, `mobile-view ${JSON.stringify(facts())}`);
    setInterval(() => {
      void savedTick().then((t) => (d.saved = t));
      show();
      put(view, `mobile-view ${JSON.stringify(facts())}`);
    }, 1000);
    navigator.serviceWorker
      ?.getRegistrations()
      .then((r) => (d.swRegs = r.length))
      .catch((e) => (d.swRegs = `failed: ${e}`));
  };
  if (document.body !== null) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
