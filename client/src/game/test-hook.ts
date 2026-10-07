// Read-only view of a game for the Playwright tests, on window.__proto.game with ?test=1 only.

import {
  BUILDING_STRIDE,
  BuildingField as B,
  checkPlacement,
  type BuildingType,
  type CommandBody,
  HeaderField as H,
  NodeField as N,
  type SimEvent,
  Terrain,
  TOWN_STRIDE,
  TownField as T,
  UNIT_STRIDE,
  UnitField as U,
  UnitFlag,
} from "../sim.ts";
import { HIT_RADIUS_PT, TILE_PX } from "../tuning.ts";
import { FIXED_TO_PX } from "../view/view.ts";
import { MockPort } from "../mock/mock-port.ts";
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
  /** Units in the latest snapshot, with screen positions, cells (and fractional cells), action, order and carried amount. */
  units(): { id: number; owner: number; type: number; sx: number; sy: number; cx: number; cy: number; fx: number; fy: number; action: number; order: number; target: number; carry: number; stance: number; loose: boolean; handPicked: boolean }[];
  /** Select these own units (test set-up; the gestures that select are tested elsewhere). */
  select(units: number[]): void;
  startPlacement(type: number): void;
  placement(): { cellX: number; cellY: number; valid: boolean; phase: string; militia: number | null } | null;
  labPhase(): string;
  log(line: string): void;
  /** Latest snapshot header values. */
  header(): { tick: number; paused: boolean; speed: number; scenario: number };
  /** Buildings in the latest snapshot: top-left cell and footprint size. */
  /** `soldiers`: hiding inside (round 7; ours only). */
  buildings(): { id: number; owner: number; type: number; cx: number; cy: number; size: number; progress: number; flags: number; soldiers: number }[];
  /** The init message the game started with (難度, time limit, who the computer plays). */
  init(): Record<string, unknown> | null;
  /** Resource nodes the player knows about, with cells. */
  nodes(): { id: number; kind: number; cx: number; cy: number; amount: number }[];
  /**
   * The nearest open cell (no building, resource or rock), in rings around (cx, cy). Only cells
   * the player has explored, unless `explored` is false: the terrain is the map's, known from
   * the start, so a spot inside a town still in the fog can be aimed at too.
   */
  openCellNear(cx: number, cy: number, explored?: boolean): { x: number; y: number } | null;
  /** The nearest top-left cell (Chebyshev rings) where a building of this type may go now, by the placement grid. */
  buildSpotNear(type: number, cx: number, cy: number): { x: number; y: number } | null;
  lastCheck(): unknown;
  /** Post a command as the player (tests of commands the interface has no button for yet). */
  send(cmd: CommandBody): void;
  /** Fake world only: deliver an event with the next snapshot. */
  inject(ev: SimEvent): void;
  /** Fake world only: put own units on these cells (one cell each, cycling). */
  place(ids: number[], cells: { x: number; y: number }[]): void;
  /** Control groups 1–4 as stored by the interface. */
  groups(): number[][];
  /** The soldiers stationed in a town (留守, D-026). */
  garrison(town: number): number[];
  /** 開局提示 (D-044): the town it points at, whether its dialog is open, whether the minimap flashes it. */
  townHint(): { town: number; open: boolean; flashing: boolean } | null;
  /** Our spawn (where the main city starts), in cells. */
  home(): { cx: number; cy: number } | null;
  /** Control groups with what 自動補兵 knows: 原本 by type, the switch, and the recruits still on their way. */
  groupInfo(): { ids: number[]; want: Record<number, number>; saved: number; refill: boolean; recruits: number[] }[];
  /** Fake world only: remove own units (as if they fell). */
  remove(ids: number[]): void;
  /** Arrows drawn from `shot` events so far (round 7). */
  shots(): number;
  /** What a tap at this screen point would hit (unit, building, node, town), or null for open ground. */
  pickAt(sx: number, sy: number): string | null;
  /** Every town on the map (size 0 small, 1 large): state, holder and militia as last seen (-1 before it is explored). */
  towns(): { id: number; size: number; state: number; owner: number; cx: number; cy: number; radius: number; militia: number; garrison: number; garrisonNeeded: number; revoltTimer: number }[];
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
        out.push({
          id: u[o + U.id],
          owner: u[o + U.owner],
          type: u[o + U.type],
          sx: s.x,
          sy: s.y,
          cx: u[o + U.x] >> 10,
          cy: u[o + U.y] >> 10,
          fx: u[o + U.x] / 1024,
          fy: u[o + U.y] / 1024,
          action: u[o + U.action],
          order: u[o + U.order],
          target: u[o + U.orderTarget],
          carry: u[o + U.carryAmount],
          stance: u[o + U.stance],
          loose: (u[o + U.flags] & UnitFlag.Loose) !== 0,
          handPicked: (u[o + U.flags] & UnitFlag.HandPicked) !== 0,
        });
      }
      return out;
    },
    select: (units) => game.apply([{ kind: "select", units: [...units].sort((a, b) => a - b) }]),
    startPlacement: (type) => game.startPlacement(type as BuildingType),
    placement: () =>
      game.placement === null ? null : { cellX: game.placement.cellX, cellY: game.placement.cellY, valid: game.placement.valid, phase: game.placement.phase, militia: game.placement.militia },
    labPhase: () => game.lab.lab.phase,
    log: (line) => game.lab.log.add(line),
    header: () => {
      const h = game.view?.header;
      return { tick: h?.[H.tick] ?? -1, paused: h?.[H.paused] === 1, speed: h?.[H.speed] ?? 0, scenario: h?.[H.scenario] ?? -1 };
    },
    buildings: () => {
      const b = game.view?.curr?.snap.buildings;
      if (b === undefined || game.view === null) return [];
      const out = [];
      for (let o = 0; o < b.length; o += BUILDING_STRIDE) {
        out.push({ id: b[o + B.id], owner: b[o + B.owner], type: b[o + B.type], cx: b[o + B.cellX], cy: b[o + B.cellY], size: game.view.rules.buildings[b[o + B.type]]?.size ?? 1, progress: b[o + B.progress], flags: b[o + B.flags], soldiers: b[o + B.soldiers] });
      }
      return out;
    },
    nodes: () => [...(game.view?.nodes.values() ?? [])].map((r) => ({ id: r[N.id], kind: r[N.kind], cx: r[N.cellX], cy: r[N.cellY], amount: r[N.amount] })),
    openCellNear: (cx, cy, explored = true) => {
      const view = game.view;
      if (view === null || view.fog === null) return null;
      const size = view.map.size;
      const taken = new Uint8Array(size * size);
      const b = view.curr?.snap.buildings ?? new Int32Array(0);
      for (let o = 0; o < b.length; o += BUILDING_STRIDE) {
        const s = view.rules.buildings[b[o + B.type]]?.size ?? 1;
        for (let y = b[o + B.cellY] - 1; y <= b[o + B.cellY] + s; y++) {
          for (let x = b[o + B.cellX] - 1; x <= b[o + B.cellX] + s; x++) if (x >= 0 && y >= 0 && x < size && y < size) taken[y * size + x] = 1;
        }
      }
      for (let r = 0; r < size; r++) {
        for (let y = cy - r; y <= cy + r; y++) {
          for (let x = cx - r; x <= cx + r; x++) {
            if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r || x < 1 || y < 1 || x >= size - 1 || y >= size - 1) continue;
            const i = y * size + x;
            if (view.map.terrain[i] !== Terrain.Open || view.nodeAt[i] >= 0 || taken[i] === 1 || (explored && view.fog[i] === 0)) continue;
            return { x, y };
          }
        }
      }
      return null;
    },
    buildSpotNear: (type, cx, cy) => {
      const view = game.view;
      const info = view?.rules.buildings[type];
      if (view === null || view.placement === null || info === undefined) return null;
      const size = view.map.size;
      for (let r = 0; r < size; r++) {
        for (let y = cy - r; y <= cy + r; y++) {
          for (let x = cx - r; x <= cx + r; x++) {
            if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
            if (checkPlacement(view.placement, info, x, y) === 0) return { x, y };
          }
        }
      }
      return null;
    },
    lastCheck: () => game.lastCheck,
    send: (cmd) => game.command(cmd),
    inject: (ev) => {
      if (game.portForTest instanceof MockPort) game.portForTest.inject(ev);
    },
    place: (ids, cells) => {
      if (game.portForTest instanceof MockPort) game.portForTest.place(ids, cells);
    },
    groups: () => game.army.groups.map((g) => [...g.ids]),
    garrison: (town) => game.army.garrisonOf(town),
    townHint: () => game.townHint(),
    home: () => {
      const view = game.view;
      const s = view?.map.spawns.find((v) => v.player === view.me);
      return s === undefined ? null : { cx: s.cellX, cy: s.cellY };
    },
    groupInfo: () => game.army.groups.map((g) => ({ ids: [...g.ids], want: { ...g.want }, saved: g.saved, refill: g.refill, recruits: g.recruits.map((r) => r.id) })),
    remove: (ids) => {
      if (game.portForTest instanceof MockPort) game.portForTest.remove(ids);
    },
    shots: () => game.shotsForTest,
    init: () => (game.initSent === null ? null : { ...game.initSent }),
    pickAt: (sx, sy) => {
      const cam = game.camera;
      const view = game.view;
      if (cam === null || view === null) return null;
      const w = cam.screenToWorld(sx, sy);
      return view.pick(w.x, w.y, HIT_RADIUS_PT / cam.scale)?.kind ?? null;
    },
    towns: () => {
      const view = game.view;
      const t = view?.curr?.snap.towns;
      if (view === null || t === undefined) return [];
      return view.map.towns.map((info) => {
        let o = -1;
        for (let i = 0; i < t.length; i += TOWN_STRIDE) if (t[i + T.id] === info.id) o = i;
        return {
          id: info.id,
          size: info.size,
          state: o < 0 ? -1 : t[o + T.state],
          owner: o < 0 ? -1 : t[o + T.owner],
          cx: info.cellX,
          cy: info.cellY,
          radius: info.radius,
          militia: o < 0 ? -1 : t[o + T.militia],
          garrison: o < 0 ? -1 : t[o + T.garrison],
          garrisonNeeded: o < 0 ? -1 : t[o + T.garrisonNeeded],
          revoltTimer: o < 0 ? -1 : t[o + T.revoltTimer],
        };
      });
    },
  };
}
