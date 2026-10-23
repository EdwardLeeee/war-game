// 寫實地面 (D-093) loaded: war-game-ui's ground set (ground/ground.json, art-v6 on), else, while it
// is not out, the development set made from R7's CC0 textures (scripts/fetch-ground-dev.ts), else
// the test page's stand-ins (scripts/make-test-atlas.ts). Each texture downloaded and decoded as
// the atlases' pages are (unit-art.ts), then made tileable.

import { GROUND_LAYERS, parseGround } from "../art/ground.ts";
import type { LoadRecorder } from "../lab/load-times.ts";
import { type GroundTextures, noiseTexture, tileTexture } from "./ground-draw.ts";
import { json, page } from "./unit-art.ts";

/** The ground's textures at most this square (the development set's photos are 2048). */
const MAX_SIZE = 1024;

/** The first of `bases` (…/ground/) with a ground set, loaded; null when none has one. */
export async function loadGround(bases: readonly string[], times: LoadRecorder | null = null): Promise<GroundTextures | null> {
  for (const base of bases) {
    let g: ReturnType<typeof parseGround>;
    try {
      g = parseGround(await json(`${base}ground.json`, times));
    } catch {
      continue;
    }
    const layers = await Promise.all(
      GROUND_LAYERS.map(async (id) => {
        const l = g.layers.find((v) => v.id === id);
        if (l === undefined) throw new Error(`ground: no ${id}`);
        // A is the height, not alpha.
        return tileTexture(await page(`${base}${l.file}`, times, l.tint === undefined ? undefined : MAX_SIZE, true));
      }),
    );
    const noise = g.noise === undefined ? noiseTexture(256, 16, 1) : tileTexture(await page(`${base}${g.noise.file}`, times, undefined, true));
    const macro = g.macro === undefined ? noiseTexture(128, 4, 2) : tileTexture(await page(`${base}${g.macro.file}`, times, undefined, true));
    // The water's ripples (art-v6): only with rules.water; it will not load, the terrain's water tiles.
    const w = g.rules.water === undefined ? undefined : g.layers.find((l) => l.id === "water");
    let water: GroundTextures["water"] = null;
    if (w !== undefined) {
      try {
        water = tileTexture(await page(`${base}${w.file}`, times, undefined, true));
      } catch (err) {
        console.warn(`ground: water: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { json: g, layers, noise, macro, water };
  }
  return null;
}
