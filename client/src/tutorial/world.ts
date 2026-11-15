// 新手教學 (R25): what the tutorial reads of the game on screen, in cells and screen points. Only reads: the
// tutorial gives orders the way the player does (taps), or with its `tutorial` command (tutor.ts).

import { isSoldier } from "../game/army.ts";
import type { Game } from "../game/game.ts";
import { BUILDING_STRIDE, BuildingField as B, BuildingType, NodeKind, NodeField as N, TOWN_STRIDE, TownField as T, UNIT_STRIDE, UnitField as U, UnitType } from "../sim.ts";
import { TILE_PX } from "../tuning.ts";
import { FIXED_TO_PX } from "../view/view.ts";

export interface UnitAt {
  id: number;
  owner: number;
  type: number;
  /** In cells (fractional). */
  x: number;
  y: number;
  action: number;
}

export interface BuildingAt {
  id: number;
  owner: number;
  type: number;
  cellX: number;
  cellY: number;
  size: number;
  progress: number;
  queue: number;
}

export interface TownAt {
  id: number;
  state: number;
  owner: number;
  timer: number;
  timerTotal: number;
  garrison: number;
  cellX: number;
  cellY: number;
  radius: number;
}

/** A screen ellipse round a place on the battlefield (the frame's hole, R25 A). */
export interface Spot {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export class TutorWorld {
  private readonly game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  get me(): number {
    return this.game.view?.me ?? 0;
  }

  units(): UnitAt[] {
    const u = this.game.view?.curr?.snap.units;
    if (u === undefined) return [];
    const out: UnitAt[] = [];
    for (let o = 0; o < u.length; o += UNIT_STRIDE) {
      out.push({ id: u[o + U.id], owner: u[o + U.owner], type: u[o + U.type], x: (u[o + U.x] * FIXED_TO_PX) / TILE_PX, y: (u[o + U.y] * FIXED_TO_PX) / TILE_PX, action: u[o + U.action] });
    }
    return out;
  }

  ownUnits(types?: readonly number[]): UnitAt[] {
    return this.units().filter((u) => u.owner === this.me && (types === undefined || types.includes(u.type)));
  }

  ownSoldiers(): UnitAt[] {
    return this.units().filter((u) => u.owner === this.me && isSoldier(u.type));
  }

  /** The computer's units (player 1; neutral militia are not). */
  foes(): UnitAt[] {
    return this.units().filter((u) => u.owner !== this.me && (u.owner === 0 || u.owner === 1));
  }

  buildings(): BuildingAt[] {
    const b = this.game.view?.curr?.snap.buildings;
    const view = this.game.view;
    if (b === undefined || view === null) return [];
    const out: BuildingAt[] = [];
    for (let o = 0; o < b.length; o += BUILDING_STRIDE) {
      const type = b[o + B.type];
      out.push({ id: b[o + B.id], owner: b[o + B.owner], type, cellX: b[o + B.cellX], cellY: b[o + B.cellY], size: view.rules.buildings[type]?.size ?? 1, progress: b[o + B.progress], queue: b[o + B.queueLength] });
    }
    return out;
  }

  own(type: number): BuildingAt | null {
    return this.buildings().find((b) => b.owner === this.me && b.type === type) ?? null;
  }

  mainCity(): BuildingAt | null {
    return this.own(BuildingType.MainCity);
  }

  /** The computer's main city (always seen in the tutorial, PROTOCOL 3.12). */
  foeCity(): BuildingAt | null {
    return this.buildings().find((b) => b.owner !== this.me && (b.owner === 0 || b.owner === 1) && b.type === BuildingType.MainCity) ?? null;
  }

  towns(): TownAt[] {
    const view = this.game.view;
    const t = view?.curr?.snap.towns;
    if (view === null || t === undefined) return [];
    return view.townList().map((info) => {
      let o = -1;
      for (let i = 0; i < t.length; i += TOWN_STRIDE) if (t[i + T.id] === info.id) o = i;
      const at = (f: number) => (o < 0 ? -1 : t[o + f]);
      return { id: info.id, state: at(T.state), owner: at(T.owner), timer: at(T.timer), timerTotal: at(T.timerTotal), garrison: at(T.garrison), cellX: info.cellX, cellY: info.cellY, radius: info.radius };
    });
  }

  /**
   * The tree nearest this cell, of those `clear` keeps (on the screen, off the buttons), else of all.
   */
  treeNear(x: number, y: number, clear: (sx: number, sy: number) => boolean = () => true): { id: number; x: number; y: number } | null {
    return this.treeAmong(x, y, clear) ?? this.treeAmong(x, y, () => true);
  }

  private treeAmong(x: number, y: number, clear: (sx: number, sy: number) => boolean): { id: number; x: number; y: number } | null {
    let best: { id: number; x: number; y: number } | null = null;
    let d = Number.POSITIVE_INFINITY;
    const cam = this.game.camera;
    for (const r of this.game.view?.nodes.values() ?? []) {
      if (r[N.kind] !== NodeKind.Tree || r[N.amount] <= 0) continue;
      if (cam !== null) {
        const s = cam.worldToScreen((r[N.cellX] + 0.5) * TILE_PX, (r[N.cellY] + 0.5) * TILE_PX);
        if (!clear(s.x, s.y)) continue;
      }
      const e = Math.hypot(r[N.cellX] + 0.5 - x, r[N.cellY] + 0.5 - y);
      if (e < d) {
        d = e;
        best = { id: r[N.id], x: r[N.cellX] + 0.5, y: r[N.cellY] + 0.5 };
      }
    }
    return best;
  }

  isTree(node: number): boolean {
    const r = this.game.view?.nodes.get(node);
    return r !== undefined && r[N.kind] === NodeKind.Tree;
  }

  selection(): number[] {
    return this.game.view?.selection.units ?? [];
  }

  selectedSoldiers(): UnitAt[] {
    const sel = new Set(this.selection());
    return this.ownSoldiers().filter((u) => sel.has(u.id));
  }

  selectedFarmers(): UnitAt[] {
    const sel = new Set(this.selection());
    return this.ownUnits([UnitType.Farmer]).filter((u) => sel.has(u.id));
  }

  /** The tutorial's rally cell (MapInfo.tutorial.rally), step 5. */
  rally(): { x: number; y: number } | null {
    const r = this.game.view?.map.tutorial?.rally;
    return r === undefined ? null : { x: r.x + 0.5, y: r.y + 0.5 };
  }

  /** A place on the battlefield (cells), `r` cells round, as an ellipse on the screen; null without a camera. */
  spot(x: number, y: number, r: number): Spot | null {
    const cam = this.game.camera;
    if (cam === null) return null;
    const c = cam.worldToScreen(x * TILE_PX, y * TILE_PX);
    const rx = Math.max(22, r * TILE_PX * cam.scale);
    return { cx: c.x, cy: c.y, rx, ry: Math.max(18, rx * 0.62) };
  }

  /** A building's middle in cells. */
  middle(b: BuildingAt): { x: number; y: number } {
    return { x: b.cellX + b.size / 2, y: b.cellY + b.size / 2 };
  }
}
