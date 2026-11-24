// The smoke test's eyes in the page (mobile/scripts/web.ts --smoke puts it first in <head>; never in
// the app that ships). It counts page errors from the very start, notes a few facts about the web
// view, and writes them as one line of text at the bottom-left corner, where the XCUITest
// (mobile/ci/SmokeUITests.swift) reads it through the accessibility tree:
//   mobile-diag {"errors":0,"first":"","sw":false,"astc":true,...}
(() => {
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
  const box = document.createElement("div");
  box.id = "mobile-diag";
  box.style.cssText =
    "position:fixed;left:2px;bottom:2px;z-index:2147483647;pointer-events:none;font:9px/1.2 monospace;color:#fff;background:rgba(0,0,0,.55);padding:1px 3px;max-width:70vw;white-space:normal";
  const show = () => {
    d.native = typeof window.Capacitor?.isNativePlatform === "function" ? window.Capacitor.isNativePlatform() : null;
    box.textContent = `mobile-diag ${JSON.stringify(d)}`;
  };
  const start = () => {
    document.body.append(box);
    show();
    setInterval(show, 1000);
    navigator.serviceWorker
      ?.getRegistrations()
      .then((r) => (d.swRegs = r.length))
      .catch((e) => (d.swRegs = `failed: ${e}`));
  };
  if (document.body !== null) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
