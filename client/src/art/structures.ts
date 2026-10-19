// 建築與資源點的圖集 (D-085, docs/sprite-atlas.md section 12, design/b1/atlas-buildings.md):
// their description files, and which frame a building or a node shows: its construction stage,
// damaged, its rubble; a tree's culture by blocks and its variant by cell, a gold mine half mined,
// a field's crops. Pure, for the unit tests; render/structure-art.ts draws.

import type { FrameRect } from "./spec.ts";

export const BUILDINGS_FORMAT = "war-game buildings 1";
export const NODES_FORMAT = "war-game nodes 1";

/** 東陸 or 西陸, as the buildings' and nodes' frames name them. */
export type Side = "E" | "W";

export type BuildingState = "build1" | "build2" | "build3" | "done" | "damaged" | "rubble";

export interface BuildingEntry {
  type: number;
  footprint: [number, number];
  /** Drawn on the ground (the field): under every unit and building. */
  ground?: boolean;
  states: Partial<Record<BuildingState, string>>;
  /** A field's crops, sown to ripe. */
  crops?: string[];
}

/** Which camera the pictures were drawn for (D-088): none, the diamond's (art-v2). */
export type AtlasView = "diamond" | "oblique";

export interface BuildingsJson {
  format: string;
  view?: AtlasView;
  culture: Side;
  px_per_m: number;
  pages: { color: string[]; team: string[]; shadow: string[] };
  buildings: Record<string, BuildingEntry>;
  frames: Record<string, FrameRect>;
  team: Record<string, FrameRect>;
  shadows: Record<string, FrameRect>;
}

export interface NodeEntry {
  kind: number;
  footprint: [number, number];
  /** Trees: by culture; the others: one list. */
  variants: string[] | Record<Side, string[]>;
  /** Trees: their stump, by culture. */
  depleted?: Record<Side, string>;
  /** The others: full, (mined,) depleted, as `<variant>_<stage>`. */
  stages?: string[];
}

export interface NodesJson {
  format: string;
  view?: AtlasView;
  px_per_m: number;
  pages: { color: string[]; shadow: string[] };
  nodes: Record<string, NodeEntry>;
  frames: Record<string, FrameRect>;
  shadows: Record<string, FrameRect>;
}

export function parseBuildings(v: unknown): BuildingsJson {
  const b = v as BuildingsJson;
  if (typeof b !== "object" || b === null || b.format !== BUILDINGS_FORMAT) throw new Error(`not a ${BUILDINGS_FORMAT} description`);
  if ((b.culture !== "E" && b.culture !== "W") || !(b.px_per_m > 0) || typeof b.buildings !== "object" || typeof b.frames !== "object") throw new Error("incomplete buildings description");
  return b;
}

export function parseNodes(v: unknown): NodesJson {
  const n = v as NodesJson;
  if (typeof n !== "object" || n === null || n.format !== NODES_FORMAT) throw new Error(`not a ${NODES_FORMAT} description`);
  if (!(n.px_per_m > 0) || typeof n.nodes !== "object" || typeof n.frames !== "object") throw new Error("incomplete nodes description");
  return n;
}

/** The pictures fit the ground as it is drawn: their camera's (no view: the diamond's) is the projection's. */
export const viewFits = (view: AtlasView | undefined, projection: "top" | "diamond" | "oblique"): boolean => (view ?? "diamond") === projection;

/** The entry for a sim building type, or undefined (the outpost has none yet: its shape). */
export function buildingEntry(b: BuildingsJson, type: number): BuildingEntry | undefined {
  return Object.values(b.buildings).find((e) => e.type === type);
}

/**
 * A building's state (atlas-buildings.md section 8): its construction in three stages by
 * `progress` (per mille), then done; at half its hit points or less, damaged.
 */
export function buildingState(progress: number, hp: number, maxHp: number): BuildingState {
  if (progress < 334) return "build1";
  if (progress < 667) return "build2";
  if (progress < 1000) return "build3";
  return maxHp > 0 && hp * 2 <= maxHp ? "damaged" : "done";
}

/** The frame a building shows in a state, falling back on done (a state it has none of). */
export function buildingFrame(e: BuildingEntry, state: BuildingState): string | null {
  return e.states[state] ?? e.states.done ?? null;
}

/** Seconds of sim time rubble lies, then fades (atlas-buildings.md section 8, ceo 2026-10-18). */
export const RUBBLE_HOLD_S = 28;
export const RUBBLE_FADE_S = 2;

/** A field's crops move on a stage every so many seconds a farmer works it (section 3). */
export const CROP_STAGE_S = 20;

/** The crop a field shows after `worked` seconds of farmers at work there: sown, growing, ripe, then sown again. */
export function cropStage(worked: number, stages: number): number {
  return stages <= 0 ? 0 : Math.floor(Math.max(0, worked) / CROP_STAGE_S) % stages;
}

/**
 * Which culture's trees grow on a cell (ceo 2026-10-18): both, in 6 × 6-cell blocks so that
 * woods come in clumps, not a chessboard.
 */
export function treeSide(cellX: number, cellY: number): Side {
  return (Math.floor(cellX / 6) * 7 + Math.floor(cellY / 6) * 13) % 2 === 0 ? "E" : "W";
}

/** A node's variant by its cell: the same every time, not the same all along a row. */
export function nodeVariant(cellX: number, cellY: number, count: number): number {
  return count <= 0 ? 0 : (cellX * 7 + cellY * 13) % count;
}

/** A node's frame: a tree its culture's variant or stump; the others `<variant>_<stage>` (a gold mine mined at half what was first seen). */
export function nodeFrame(e: NodeEntry, cellX: number, cellY: number, amount: number, firstSeen: number): string | null {
  if (Array.isArray(e.variants)) {
    const v = e.variants[nodeVariant(cellX, cellY, e.variants.length)];
    const stages = e.stages ?? ["full", "depleted"];
    const stage = amount <= 0 ? "depleted" : stages.includes("mined") && amount * 2 <= firstSeen ? "mined" : "full";
    return v === undefined ? null : `${v}_${stage}`;
  }
  const side = treeSide(cellX, cellY);
  if (amount <= 0) return e.depleted?.[side] ?? null;
  const list = e.variants[side];
  return list[nodeVariant(cellX, cellY, list.length)] ?? null;
}
