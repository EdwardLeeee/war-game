// The ground's development set (寫實地面, D-093), until war-game-ui ships ground/ground.json with
// art-v6: R7's five CC0 ground photos from Poly Haven (design/r7, D-092), each checked against the
// sha256 ui pinned (design/r7/common/textures_sha.json), recoloured on the GPU as R7 does
// (render/ground-draw.ts look()). Downloads are kept in .art-cache/ground-r7/ (never committed);
// the set goes to public/art/ground-dev/ (git ignores it). CI's tests draw the test page's
// stand-ins (scripts/make-test-atlas.ts); the Pages build fetches this set too, so ui and the user
// can see the ground on the iPhone (?test=1&ground=real, ceo 2026-10-21), until art-v6 ships ui's.
// A download that fails or does not match its pin never fails the build: a warning, and that
// build has no development set (ground=real then draws the two greens).
//   node scripts/fetch-ground-dev.ts

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GROUND_FORMAT, type GroundJson, type GroundTexture } from "../src/art/ground.ts";

const CLIENT = join(resolve(dirname(fileURLToPath(import.meta.url))), "..");
const CACHE = join(CLIENT, ".art-cache", "ground-r7");
const OUT = join(CLIENT, "public", "art", "ground-dev");
const POLY = "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k";

/**
 * R7's ground (design/r7/blender/ground_r7.py build(), look.py SIZE and MEAN): the texture, its
 * sha256, its size (m) times R7's scale, its mean linear colour, the colour R7 tints it to (linear
 * albedo) and how much of its own light and dark it keeps.
 */
const R7: { id: GroundTexture["id"]; name: string; sha256: string; tile_m: number; mean: [number, number, number]; tint: [number, number, number]; contrast: number }[] = [
  { id: "grass", name: "leafy_grass", sha256: "8e1c6d21365d4b89bc5a35ab664da98a78dbc3ab9ba6100474881c8619a5b113", tile_m: 2.0, mean: [0.313, 0.23, 0.102], tint: [0.068, 0.118, 0.034], contrast: 0.55 },
  { id: "grass_dry", name: "aerial_grass_rock", sha256: "1a2ddfa4652adbe00447b940c40019d46f4b88245bc1b341cdf622c2110b7bc5", tile_m: 15.0 * 0.7, mean: [0.169, 0.121, 0.025], tint: [0.085, 0.122, 0.04], contrast: 0.55 },
  { id: "dirt", name: "stony_dirt_path", sha256: "9c35b98628c17382b3a494ae15f17f95410edcaaac2e5922e50e5878f98d4a20", tile_m: 2.17, mean: [0.068, 0.039, 0.02], tint: [0.13, 0.095, 0.06], contrast: 0.35 },
  { id: "gravel", name: "gravel_ground_01", sha256: "b626c16301208b67eba976ad71860d98fd6fe82ae1c87d9d27692e70c1089cd2", tile_m: 3.0 * 0.6, mean: [0.29, 0.228, 0.141], tint: [0.17, 0.15, 0.12], contrast: 0.55 },
  { id: "bank", name: "brown_mud_rocks_01", sha256: "aa4b314c8e488c2d3d0db399e1023420ffb2198293f7ed07441bde7e70c8c57e", tile_m: 1.3, mean: [0.088, 0.066, 0.04], tint: [0.13, 0.1, 0.07], contrast: 0.4 },
];

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function fetchChecked(name: string, want: string): Promise<string> {
  const file = join(CACHE, `${name}_diff_2k.jpg`);
  if (existsSync(file) && sha(readFileSync(file)) === want) return file;
  const res = await fetch(`${POLY}/${name}/${name}_diff_2k.jpg`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const body = new Uint8Array(await res.arrayBuffer());
  const got = sha(body);
  if (got !== want) throw new Error(`${name}: sha256 ${got}, the pin says ${want}`);
  writeFileSync(file, body);
  return file;
}

mkdirSync(CACHE, { recursive: true });
const layers: GroundTexture[] = [];
try {
  for (const t of R7) {
    const file = await fetchChecked(t.name, t.sha256);
    mkdirSync(OUT, { recursive: true });
    copyFileSync(file, join(OUT, `${t.id}.jpg`));
    layers.push({ id: t.id, file: `${t.id}.jpg`, tile_m: t.tile_m, mean: t.mean, tint: t.tint, contrast: t.contrast });
    console.log(`ground dev: ${t.id} ← ${t.name} ✓`);
  }
} catch (err) {
  // No half set: without it the page draws the two greens.
  rmSync(OUT, { recursive: true, force: true });
  console.log(`::warning::ground dev: ${err instanceof Error ? err.message : String(err)}; this build has no development ground (?ground=real draws the two greens)`);
  process.exit(0);
}
// ui's numbers (2026-10-21); the noise and macro are made by the page.
const ground: GroundJson = {
  format: GROUND_FORMAT,
  layers,
  rules: { bank_cells: 1, gravel_cells: 1, edge_m: 0.6, height_k: 0.8, dirt: { node_cells: 1, noise_threshold: 0.72 } },
  grade: { brightness: 1, saturation: 1 },
};
writeFileSync(join(OUT, "ground.json"), JSON.stringify(ground, null, 1));
console.log(`ground dev: public/art/ground-dev/ground.json (${layers.length} textures, CC0, Poly Haven)`);
