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

let limits: string | null = null;

/**
 * The phone's texture limits, for the sprite atlas decisions (client/docs/sprite-atlas.md,
 * section 8): largest texture, textures per draw call, ASTC compression. Read once.
 */
export function gpuLimits(app: Application): string {
  if (limits === null) {
    const gl = "gl" in app.renderer ? (app.renderer.gl as WebGL2RenderingContext) : null;
    if (gl === null) {
      limits = "GPU：不是 WebGL";
    } else {
      const astc = gl.getExtension("WEBGL_compressed_texture_astc") !== null;
      limits = `最大貼圖 ${gl.getParameter(gl.MAX_TEXTURE_SIZE)}、一次繪製 ${gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)} 張、ASTC ${astc ? "有" : "沒有"}`;
    }
  }
  return limits;
}
