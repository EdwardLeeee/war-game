// The PixiJS stage. Until the simulation is connected it shows a placeholder field of the
// prototype map's size, enough to check WebGL, the canvas and the safe-area frame on the
// phone. The render layers replace it.

import { Application, Container, Graphics } from "pixi.js";

export const TILE_PX = 16;
const PLACEHOLDER_CELLS = 96; // prototype map, GDD §17; the simulation's map replaces this

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

  const world = new Container();
  const field = new Graphics();
  for (let y = 0; y < PLACEHOLDER_CELLS; y++) {
    for (let x = 0; x < PLACEHOLDER_CELLS; x++) {
      field.rect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX).fill((x + y) % 2 === 0 ? 0x4d6b3c : 0x557443);
    }
  }
  world.addChild(field);
  app.stage.addChild(world);

  const fit = (): void => {
    const size = PLACEHOLDER_CELLS * TILE_PX;
    const s = Math.min(app.screen.width / size, app.screen.height / size);
    world.scale.set(s);
    world.position.set((app.screen.width - size * s) / 2, (app.screen.height - size * s) / 2);
  };
  fit();
  app.renderer.on("resize", fit);
  return app;
}
