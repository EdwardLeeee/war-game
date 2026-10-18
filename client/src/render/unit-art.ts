// 兵種精靈圖集 (D-085): war-game-ui's atlases for the units the prototype draws, loaded from
// public/art/ (scripts/fetch-art.ts), each frame handed out as a texture cut from its page with
// its anchor (docs/sprite-atlas.md sections 4–6). Which frame to show is art/spec.ts's.

import { Assets, Rectangle, Texture } from "pixi.js";
import { ATLAS_NAMES, type AtlasJson, type EffectsJson, type FrameRect, M_PER_CELL, parseAtlas, parseEffects } from "../art/spec.ts";
import { TILE_PX } from "../tuning.ts";

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
  /** World px per image point: the ground's px per metre over the atlases' px_per_m. */
  scale: number;
  frame(atlas: string, layer: ArtLayer, name: string): ArtFrame | null;
  effectFrame(name: string): ArtFrame | null;
  destroy(): void;
}

/** World px per metre on the ground seen from above: a cell is TILE_PX and 2 metres. */
export const WORLD_PX_PER_M = TILE_PX / M_PER_CELL;

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
  const pxPerM = atlases.values().next().value?.px_per_m ?? 60;
  const cache = new Map<string, ArtFrame | null>();
  const cut = (page: Texture | undefined, r: FrameRect): ArtFrame | null =>
    page === undefined ? null : { texture: new Texture({ source: page.source, frame: new Rectangle(r.x, r.y, r.w, r.h) }), ax: r.ax / r.w, ay: r.ay / r.h, half: r.half_res === true };
  return {
    label,
    atlases,
    effects,
    pages: urls.length,
    scale: WORLD_PX_PER_M / pxPerM,
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
    destroy() {
      for (const f of cache.values()) f?.texture.destroy(false);
      cache.clear();
      for (const u of urls) void Assets.unload(u);
    },
  };
}
