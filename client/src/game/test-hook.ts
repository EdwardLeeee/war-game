// Read-only view of a game for the Playwright tests, on window.__proto.game with ?test=1 only.

import { type BuildingType, UNIT_STRIDE, UnitField as U } from "../sim.ts";
import { TILE_PX } from "../tuning.ts";
import { FIXED_TO_PX } from "../view/view.ts";
import type { Game } from "./game.ts";

export interface GameHook {
  me(): number;
  selection(): { units: number[]; building: number | null };
  inspected(): { kind: string; id: number } | null;
  /** Commands posted to the simulation, oldest first. */
  sent(): unknown[];
  camera(): { x: number; y: number; scale: number; flinging: boolean };
  mode(): string;
  wheel(): string[] | null;
  /** Put a cell in the middle of the screen at a zoom (test set-up). */
  centerOn(cx: number, cy: number, scale?: number): void;
  /** Screen position (CSS px) of a cell's centre. */
  cellToScreen(cx: number, cy: number): { x: number; y: number };
  /** Units in the latest snapshot, with screen positions. */
  units(): { id: number; owner: number; type: number; sx: number; sy: number }[];
  startPlacement(type: number): void;
  placement(): { cellX: number; cellY: number; valid: boolean; phase: string } | null;
  labPhase(): string;
  log(line: string): void;
}

export function gameHook(game: Game): GameHook {
  return {
    me: () => game.view?.me ?? 0,
    selection: () => ({ units: [...(game.view?.selection.units ?? [])], building: game.view?.selection.building ?? null }),
    inspected: () => (game.view?.inspected ? { kind: game.view.inspected.kind, id: game.view.inspected.id } : null),
    sent: () => game.sent.map((c) => ({ ...c })),
    camera: () => ({ x: game.camera?.x ?? 0, y: game.camera?.y ?? 0, scale: game.camera?.scale ?? 1, flinging: game.camera?.flinging ?? false }),
    mode: () => (game.placement !== null ? `place:${game.placement.phase}` : game.mode),
    wheel: () => game.wheelItems(),
    centerOn: (cx, cy, scale = 1) => {
      const cam = game.camera;
      if (cam === null) return;
      cam.stop();
      cam.zoomAt(0, 0, scale);
      cam.centerOn((cx + 0.5) * TILE_PX, (cy + 0.5) * TILE_PX);
    },
    cellToScreen: (cx, cy) => game.camera?.worldToScreen((cx + 0.5) * TILE_PX, (cy + 0.5) * TILE_PX) ?? { x: 0, y: 0 },
    units: () => {
      const u = game.view?.curr?.snap.units;
      const cam = game.camera;
      if (u === undefined || cam === null) return [];
      const out = [];
      for (let o = 0; o < u.length; o += UNIT_STRIDE) {
        const s = cam.worldToScreen(u[o + U.x] * FIXED_TO_PX, u[o + U.y] * FIXED_TO_PX);
        out.push({ id: u[o + U.id], owner: u[o + U.owner], type: u[o + U.type], sx: s.x, sy: s.y });
      }
      return out;
    },
    startPlacement: (type) => game.startPlacement(type as BuildingType),
    placement: () => (game.placement === null ? null : { cellX: game.placement.cellX, cellY: game.placement.cellY, valid: game.placement.valid, phase: game.placement.phase }),
    labPhase: () => game.lab.lab.phase,
    log: (line) => game.lab.log.add(line),
  };
}
