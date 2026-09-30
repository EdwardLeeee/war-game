// The PixiJS application: full-window WebGL canvas at the device's pixel ratio.

import { Application } from "pixi.js";

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
  // PixiJS's accessibility layer adds an off-screen "select to enable accessibility" button
  // on phones, for accessible canvas objects. The battlefield has none (the interface is DOM
  // buttons), so it goes. The app is never destroyed, so this runs once.
  app.renderer.accessibility.destroy();
  host.appendChild(app.canvas);
  return app;
}
