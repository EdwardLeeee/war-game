// 兵種精靈圖集 (D-085): war-game-ui's atlases for the units the prototype draws, and (art-v2 on)
// the buildings' and nodes', loaded from public/art/ (scripts/fetch-art.ts), each frame handed
// out as a texture cut from its page with its anchor (docs/sprite-atlas.md sections 4–6, 12).
// Which frame to show is art/spec.ts's and art/structures.ts's.

import { Assets, Rectangle, Texture } from "pixi.js";
import { ATLAS_NAMES, type AtlasJson, type EffectsJson, type FrameRect, parseAtlas, parseEffects } from "../art/spec.ts";
import { type BuildingsJson, type NodesJson, parseBuildings, parseNodes, type Side } from "../art/structures.ts";

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

async function json(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/**
 * The atlases under `base` (…/x3/ or …/x2/: units/<name>/, effects/), every page loaded up
 * front so that the game never waits for one in the middle of a fight.
 */
export async function loadUnitArt(base: string, label: string, names: readonly string[] = ATLAS_NAMES): Promise<UnitArt> {
  const atlases = new Map<string, AtlasJson>();
  const pages = new Map<string, Texture[]>();
  const urls: string[] = [];
  await Promise.all(
    names.map(async (name) => {
      const dir = `${base}units/${name}/`;
      const a = parseAtlas(await json(`${dir}${name}.json`));
      atlases.set(name, a);
      for (const layer of LAYERS) {
        const files = PAGES[layer](a);
        const list = files.map((f) => `${dir}${f}`);
        urls.push(...list);
        pages.set(`${name}|${layer}`, await Promise.all(list.map((u) => Assets.load<Texture>(u))));
      }
    }),
  );
  let effects: EffectsJson | null = null;
  let effectPages: Texture[] = [];
  try {
    effects = parseEffects(await json(`${base}effects/effects.json`));
    const list = effects.pages.map((f) => `${base}effects/${f}`);
    urls.push(...list);
    effectPages = await Promise.all(list.map((u) => Assets.load<Texture>(u)));
  } catch {
    effects = null;
  }
  // Buildings and nodes (art-v2 on): a set of pages a culture, one for the nodes; none, the shapes.
  const buildings: Partial<Record<Side, BuildingsJson>> = {};
  const buildingPages = new Map<string, Texture[]>();
  let nodes: NodesJson | null = null;
  const nodePages = new Map<string, Texture[]>();
  const pagesOf = async (dir: string, files: string[]): Promise<Texture[]> => {
    const list = files.map((f) => `${dir}${f}`);
    urls.push(...list);
    return Promise.all(list.map((u) => Assets.load<Texture>(u)));
  };
  await Promise.all([
    ...(["E", "W"] as const).map(async (side) => {
      let b: BuildingsJson;
      try {
        b = parseBuildings(await json(`${base}buildings/buildings_${side}.json`));
      } catch {
        return;
      }
      buildings[side] = b;
      for (const layer of ["color", "team", "shadow"] as const) buildingPages.set(`${side}|${layer}`, await pagesOf(`${base}buildings/`, b.pages[layer]));
    }),
    (async () => {
      let n: NodesJson;
      try {
        n = parseNodes(await json(`${base}nodes/nodes.json`));
      } catch {
        return;
      }
      nodes = n;
      for (const layer of ["color", "shadow"] as const) nodePages.set(layer, await pagesOf(`${base}nodes/`, n.pages[layer]));
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
    pages: urls.length,
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
    destroy() {
      for (const f of cache.values()) f?.texture.destroy(false);
      cache.clear();
      for (const u of urls) void Assets.unload(u);
    },
  };
}
