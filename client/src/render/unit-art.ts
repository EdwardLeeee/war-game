// 兵種精靈圖集 (D-085): war-game-ui's atlases for the units the prototype draws, and (art-v2 on)
// the buildings' and nodes', loaded from public/art/ (scripts/fetch-art.ts), each frame handed
// out as a texture cut from its page with its anchor (docs/sprite-atlas.md sections 4–6, 12).
// Which frame to show is art/spec.ts's and art/structures.ts's.

import { ImageSource, Rectangle, Texture } from "pixi.js";
import { ATLAS_NAMES, type AtlasJson, type EffectsJson, type FrameRect, parseAtlas, parseEffects } from "../art/spec.ts";
import { type CastleJson, parseCastle } from "../art/castle.ts";
import { parseTerrain, type TerrainJson } from "../art/terrain.ts";
import { type BuildingsJson, type NodesJson, parseBuildings, parseNodes, type Side } from "../art/structures.ts";
import type { LoadRecorder } from "../lab/load-times.ts";

export type ArtLayer = "color" | "team" | "shadow" | "fx" | "shield";

/** A frame, ready to draw: anchor = (ax / w, ay / h); shadows at twice their size. */
export interface ArtFrame {
  texture: Texture;
  ax: number;
  ay: number;
  half: boolean;
}

export interface UnitArt {
  /** Where the atlases came from (for the lab's result): 3 倍, 2 倍, test. */
  label: string;
  atlases: ReadonlyMap<string, AtlasJson>;
  effects: EffectsJson | null;
  /** Pages loaded, all layers (for the lab's result). */
  pages: number;
  /** The atlases' image points a metre (their px_per_m): drawn at the plane's points a metre over it. */
  pxPerM: number;
  frame(atlas: string, layer: ArtLayer, name: string): ArtFrame | null;
  effectFrame(name: string): ArtFrame | null;
  /** The buildings' atlases by culture (none before art-v2), and the nodes'. */
  buildings: Partial<Record<Side, BuildingsJson>>;
  nodes: NodesJson | null;
  buildingFrame(side: Side, layer: "color" | "team" | "shadow", name: string): ArtFrame | null;
  nodeFrame(layer: "color" | "shadow", name: string): ArtFrame | null;
  /** The castles' walls (art-v4 on, D-089): 東陸's only, as the prototype's towns all look (GDD section 12); null: drawn as blocks. */
  castle: CastleJson | null;
  castleFrame(layer: "color" | "team" | "shadow", name: string): ArtFrame | null;
  /** The ground's pictures (art-v5 on, R6-51: rock, cliffs, water, fords, bridges); null: flat colours. */
  terrain: TerrainJson | null;
  terrainFrame(layer: "color" | "shadow", name: string): ArtFrame | null;
  /** Pages already on the GPU with their decoded pictures let go (loaded with `upload`), and their bytes there. */
  resident: { pages: number; bytes: number };
  destroy(): void;
}

const TABLE: Record<ArtLayer, (a: AtlasJson) => Record<string, FrameRect> | undefined> = {
  color: (a) => a.frames,
  team: (a) => a.team,
  shadow: (a) => a.shadows,
  fx: (a) => a.fx,
  shield: (a) => a.shield?.frames,
};
const PAGES: Record<ArtLayer, (a: AtlasJson) => string[]> = {
  color: (a) => a.pages.color,
  team: (a) => a.pages.team,
  shadow: (a) => a.pages.shadow,
  fx: (a) => a.pages.fx,
  shield: (a) => a.pages.shield,
};
const LAYERS: ArtLayer[] = ["color", "team", "shadow", "fx", "shield"];

export async function json(url: string, times: LoadRecorder | null): Promise<unknown> {
  const start = performance.now();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const text = await res.text();
  times?.file(url, start, performance.now(), text.length, null, res.headers.get("x-war-game-sw"));
  return JSON.parse(text);
}

/**
 * A page: downloaded on the page's own thread, so that the browser's record of it (D-091's load
 * times) and the service worker (public/sw.js) see it; decoded by the browser off that thread
 * (createImageBitmap), into a texture as PixiJS's own loader makes one. As fast as PixiJS's
 * loader in CI's WebKit (median 4.6 s against 4.7 s for the 63 files at 3 倍); handing PixiJS the
 * download instead (a blob's URL) cost a copy, 5.3 s.
 */
export async function page(url: string, times: LoadRecorder | null, size?: number, straight = false): Promise<Texture> {
  const start = performance.now();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const blob = await res.blob();
  const downloaded = performance.now();
  // `size`: scaled to that square as it is decoded (the ground's development textures come at 2048).
  // `straight`: A is not alpha but data (the ground's height), never multiplied into the colour.
  // The atlases (neither): the one-argument call, as before the ground.
  const bitmap =
    size === undefined && !straight
      ? await createImageBitmap(blob)
      : await createImageBitmap(blob, {
          ...(size === undefined ? {} : { resizeWidth: size, resizeHeight: size, resizeQuality: "high" as const }),
          ...(straight ? { premultiplyAlpha: "none" as const } : {}),
        });
  const source = new ImageSource({ resource: bitmap, alphaMode: straight ? "no-premultiply-alpha" : "premultiply-alpha-on-upload", label: url });
  times?.file(url, start, downloaded, blob.size, performance.now(), res.headers.get("x-war-game-sw"));
  return new Texture({ source, label: url });
}

/**
 * The atlases under `base` (…/x3/ or …/x2/: units/<name>/, effects/), every page loaded up
 * front so that the game never waits for one in the middle of a fight. `times`: each file's
 * download and decoding, for the load times (D-091). `upload` (the renderer's): each page goes
 * to the GPU as soon as it is decoded, and its decoded picture is let go. Kept, the pictures
 * stayed in memory beside the GPU's copies all game (3 倍: 398 MB), and the copies grew as new
 * pages were first drawn (126 MB at minute 5, 302 at minute 68 of the user's f331df3c): the
 * iPhone dropped the page in games of an hour and more (the user 2026-10-22: 「剛剛兩場對局都打到
 * 一半跳掉」). Without the pictures a page cannot go up again: a lost WebGL context is not
 * restored (main.ts asks for a reload; the game is saved).
 */
export async function loadUnitArt(
  base: string,
  label: string,
  names: readonly string[] = ATLAS_NAMES,
  times: LoadRecorder | null = null,
  upload: ((t: Texture) => void) | null = null,
): Promise<UnitArt> {
  const atlases = new Map<string, AtlasJson>();
  const pages = new Map<string, Texture[]>();
  /** Every page, to let go of them all. */
  const all: Texture[] = [];
  const resident = { pages: 0, bytes: 0 };
  const settle = (t: Texture): Texture => {
    if (upload === null) return t;
    // Kept on the GPU: PixiJS lets an image's texture go when it has not been drawn for a while
    // and sends it up again from its picture when it is, which is no more.
    t.source.autoGarbageCollect = false;
    upload(t);
    (t.source.resource as ImageBitmap | null)?.close?.();
    resident.pages++;
    resident.bytes += t.source.pixelWidth * t.source.pixelHeight * 4;
    return t;
  };
  const load = async (list: string[]): Promise<Texture[]> => {
    const got = await Promise.all(list.map(async (u) => settle(await page(u, times))));
    all.push(...got);
    return got;
  };
  await Promise.all(
    names.map(async (name) => {
      const dir = `${base}units/${name}/`;
      const a = parseAtlas(await json(`${dir}${name}.json`, times));
      atlases.set(name, a);
      for (const layer of LAYERS) {
        const files = PAGES[layer](a);
        pages.set(`${name}|${layer}`, await load(files.map((f) => `${dir}${f}`)));
      }
    }),
  );
  let effects: EffectsJson | null = null;
  let effectPages: Texture[] = [];
  try {
    effects = parseEffects(await json(`${base}effects/effects.json`, times));
    effectPages = await load(effects.pages.map((f) => `${base}effects/${f}`));
  } catch {
    effects = null;
  }
  // Buildings and nodes (art-v2 on): a set of pages a culture, one for the nodes; none, the shapes.
  const buildings: Partial<Record<Side, BuildingsJson>> = {};
  const buildingPages = new Map<string, Texture[]>();
  let nodes: NodesJson | null = null;
  const nodePages = new Map<string, Texture[]>();
  let castle: CastleJson | null = null;
  const castlePages = new Map<string, Texture[]>();
  let terrain: TerrainJson | null = null;
  const terrainPages = new Map<string, Texture[]>();
  const pagesOf = (dir: string, files: string[]): Promise<Texture[]> => load(files.map((f) => `${dir}${f}`));
  await Promise.all([
    ...(["E", "W"] as const).map(async (side) => {
      let b: BuildingsJson;
      try {
        b = parseBuildings(await json(`${base}buildings/buildings_${side}.json`, times));
      } catch {
        return;
      }
      buildings[side] = b;
      for (const layer of ["color", "team", "shadow"] as const) buildingPages.set(`${side}|${layer}`, await pagesOf(`${base}buildings/`, b.pages[layer]));
    }),
    (async () => {
      let n: NodesJson;
      try {
        n = parseNodes(await json(`${base}nodes/nodes.json`, times));
      } catch {
        return;
      }
      nodes = n;
      for (const layer of ["color", "shadow"] as const) nodePages.set(layer, await pagesOf(`${base}nodes/`, n.pages[layer]));
    })(),
    (async () => {
      let c: CastleJson;
      try {
        c = parseCastle(await json(`${base}castle/castle_E.json`, times));
      } catch {
        return;
      }
      castle = c;
      for (const layer of ["color", "team", "shadow"] as const) castlePages.set(layer, await pagesOf(`${base}castle/`, c.pages[layer]));
    })(),
    (async () => {
      let t: TerrainJson;
      try {
        t = parseTerrain(await json(`${base}terrain/terrain.json`, times));
      } catch {
        return;
      }
      terrain = t;
      for (const layer of ["color", "shadow"] as const) terrainPages.set(layer, await pagesOf(`${base}terrain/`, t.pages[layer]));
    })(),
  ]);
  const pxPerM = atlases.values().next().value?.px_per_m ?? 60;
  const cache = new Map<string, ArtFrame | null>();
  const cut = (page: Texture | undefined, r: FrameRect): ArtFrame | null =>
    page === undefined ? null : { texture: new Texture({ source: page.source, frame: new Rectangle(r.x, r.y, r.w, r.h) }), ax: r.ax / r.w, ay: r.ay / r.h, half: r.half_res === true };
  return {
    label,
    atlases,
    effects,
    pages: all.length,
    pxPerM,
    frame(atlas, layer, name) {
      const key = `${atlas}|${layer}|${name}`;
      let f = cache.get(key);
      if (f !== undefined) return f;
      const a = atlases.get(atlas);
      const r = a === undefined ? undefined : TABLE[layer](a)?.[name];
      f = r === undefined ? null : cut(pages.get(`${atlas}|${layer}`)?.[r.page], r);
      cache.set(key, f);
      return f;
    },
    effectFrame(name) {
      const key = `effects|${name}`;
      let f = cache.get(key);
      if (f !== undefined) return f;
      const r = effects?.frames[name];
      f = r === undefined ? null : cut(effectPages[r.page], r);
      cache.set(key, f);
      return f;
    },
    buildings,
    get nodes() {
      return nodes;
    },
    buildingFrame(side, layer, name) {
      const key = `buildings_${side}|${layer}|${name}`;
      let f = cache.get(key);
      if (f !== undefined) return f;
      const b = buildings[side];
      const table = b === undefined ? undefined : layer === "color" ? b.frames : layer === "team" ? b.team : b.shadows;
      const r = table?.[name];
      f = r === undefined ? null : cut(buildingPages.get(`${side}|${layer}`)?.[r.page], r);
      cache.set(key, f);
      return f;
    },
    get castle() {
      return castle;
    },
    get terrain() {
      return terrain;
    },
    terrainFrame(layer, name) {
      const key = `terrain|${layer}|${name}`;
      let f = cache.get(key);
      if (f !== undefined) return f;
      const t = terrain as TerrainJson | null;
      const r = t === null ? undefined : (layer === "color" ? t.frames : t.shadows)[name];
      f = r === undefined ? null : cut(terrainPages.get(layer)?.[r.page], r);
      cache.set(key, f);
      return f;
    },
    castleFrame(layer, name) {
      const key = `castle|${layer}|${name}`;
      let f = cache.get(key);
      if (f !== undefined) return f;
      const c = castle as CastleJson | null;
      const r = c === null ? undefined : (layer === "color" ? c.frames : layer === "team" ? c.team : c.shadows)[name];
      f = r === undefined ? null : cut(castlePages.get(layer)?.[r.page], r);
      cache.set(key, f);
      return f;
    },
    nodeFrame(layer, name) {
      const key = `nodes|${layer}|${name}`;
      let f = cache.get(key);
      if (f !== undefined) return f;
      const n = nodes as NodesJson | null;
      const r = n === null ? undefined : (layer === "color" ? n.frames : n.shadows)[name];
      f = r === undefined ? null : cut(nodePages.get(layer)?.[r.page], r);
      cache.set(key, f);
      return f;
    },
    resident,
    destroy() {
      for (const f of cache.values()) f?.texture.destroy(false);
      cache.clear();
      // The pages, and their decoded pictures at once (Safari keeps them besides the GPU's copy).
      for (const t of all) {
        const bitmap = t.source.resource as ImageBitmap | null;
        t.destroy(true);
        bitmap?.close();
      }
    },
  };
}
