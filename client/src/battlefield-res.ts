// 戰場像素比 (?test=1&res=2, and the 量測 panel's row; ceo 2026-11-06, after client's fps comparison:
// on art-v7.5's diamond the frame's time follows the pixels drawn). The battlefield's canvas at pixel
// ratio 2 on a phone of 3, the interface (the page's) as it was: to measure on the iPhone what drawing
// fewer pixels saves before anyone chooses it. Test pages only.

import type { Application } from "pixi.js";

/** What the battlefield is drawn at: the device's pixel ratio, or 2 when asked for and the device has more. */
export function battlefieldRes(two: boolean, device = window.devicePixelRatio): number {
  return two && device > 2 ? 2 : device;
}

/** Draw at 2 or at the device's from the next frame, and say so in the address (a reload, the art-v7 量測 pages it opens). */
export function setBattlefieldRes(app: Application, two: boolean): void {
  app.renderer.resolution = battlefieldRes(two);
  const url = new URL(location.href);
  if (two) url.searchParams.set("res", "2");
  else url.searchParams.delete("res");
  history.replaceState(history.state, "", url);
}
