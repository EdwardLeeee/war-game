// 戰場像素比 (the user 2026-11-07, from the iPhone's numbers, 3 倍 ASTC, the camera still, a new game of 360: at 3,
// 43.48 fps, the slowest 5% 37.04; at 2, 58.82 and 52.63, which passes): the battlefield's canvas at no more than pixel
// ratio 2, on a phone of 3 scaled up to the screen by the browser; a device of 2 or less at its own. The interface (the
// page's) stays at the device's. The art stays 3 倍 (art/pref.ts). A test page can draw at the device's, to compare:
// ?test=1&res=device, or the 量測 panel's row.

import type { Application } from "pixi.js";

/** What the battlefield is drawn at: 2 when the device has more (`two`), else the device's pixel ratio. */
export function battlefieldRes(two: boolean, device = window.devicePixelRatio): number {
  return two && device > 2 ? 2 : device;
}

/** Draw at 2 or at the device's from the next frame, and say so in the address (a reload, the art-v7 量測 pages it opens). */
export function setBattlefieldRes(app: Application, two: boolean): void {
  app.renderer.resolution = battlefieldRes(two);
  const url = new URL(location.href);
  if (two) url.searchParams.delete("res");
  else url.searchParams.set("res", "device");
  history.replaceState(history.state, "", url);
}
