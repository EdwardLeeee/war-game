// The PixiJS application: full-window WebGL canvas at the device's pixel ratio.

import { AccessibilitySystem, Application, extensions } from "pixi.js";

// PixiJS's accessibility layer puts an off-screen "select to enable accessibility" button on
// phones for its canvas objects. The battlefield has none; the interface is DOM buttons.
extensions.remove(AccessibilitySystem);

export async function createStage(host: HTMLElement): Promise<Application> {
  const app = new Application();
  await app.init({
    resizeTo: window,
    antialias: false,
    backgroundColor: 0x1d2320,
    preference: "webgl",
    resolution: window.devicePixelRatio,
    autoDensity: true,
  });
  host.appendChild(app.canvas);
  return app;
}
