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
  /** How high a unit's body stands above its feet on the plane (×scale on screen); a tap there takes it too. */
  bodyLift(): number;
  /** The world under the screen's centre, in cells (fractional; the camera's x, y are the plane's). */
  centreCell(): { x: number; y: number };
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
  /** Pause the game now, as 暫停 does (a test that must stop the clock at once: a tap's round trip is ticks at 400 a second). */
  pause(): void;
  /** Buildings in the latest snapshot: top-left cell and footprint size. */
  /** `soldiers`: hiding inside (round 7; ours only). */
  buildings(): { id: number; owner: number; type: number; cx: number; cy: number; size: number; progress: number; flags: number; soldiers: number; posted: number }[];
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
  /** Fake world only: put units (ours or the enemy's) on these cells (one cell each, cycling). */
  place(ids: number[], cells: { x: number; y: number }[]): void;
  /** Fake world only (等錢治理): what we have, and a little economy (income a second, 自動訓練 spending above the reserve) or none. */
  stock(c: { food: number; wood: number; gold: number; crystal: number }): void;
  economy(e: { income: { food: number; wood: number; gold: number; crystal: number }; train: { food: number; wood: number; gold: number; crystal: number } } | null): void;
  /** What we have now (the resource bar's numbers). */
  resources(): { food: number; wood: number; gold: number; crystal: number };
  /** 等錢治理: the towns waiting for 治理's cost. */
  governWaits(): number[];
  /** 自動訓練 by the screen (D-098): on or off (the fake world has it off unless a test turns it on). */
  autoArmy(on: boolean): void;
  /** The main city's villagers (D-098) paused or not, as its 自動村民 button, without its message. */
  villagersPaused(on: boolean): void;
  /** 自動蓋民居 (2026-10-25): its switch, and why the last decision sent no house (null: it sent one). */
  autoHouse(): { on: boolean; block: string | null };
  /** Fake world only (自動蓋民居): the population room left now and its ceiling; null: as always (cap 20). */
  population(p: { room: number; ceiling: number } | null): void;
  /** Fake world only: a building's progress now (1000: finished). */
  progress(id: number, progress: number): void;
  /** Fake world only: these farmers of ours gathering at the node as the economy sends them (not by hand). */
  employ(ids: number[], node: number): void;
  /** Pause marks drawn on buildings (自動訓練 paused, D-098: the player's own pause). */
  pauseMarks(): number;
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
  /** Fake world only: a building's hit points (a gate damaged, D-096). */
  damage(id: number, hp: number): void;
  /** Fake world only (真的箭): own units stand and attack `target`; −1, they stop. */
  strike(ids: number[], target: number): void;
  /** 真的箭: whether arrows fly as art-v6 draws them; bowmen's and buildings' arrows so far. */
  arrows(): { real: boolean; bow: number; building: number };
  /** Arrows drawn from `shot` events so far (round 7; D-096: each of a volley's `n`). */
  shots(): number;
  /** 攻城砲 (D-099): stones drawn so far, and siege engines with their range rings this frame. */
  siege(): { shots: number; rings: number };
  /** Of them, shots that left a gate's tower (D-096, shoot_at_m). */
  towerShots(): number;
  /** Stones thrown by the militia's slings on walls (D-096). */
  stones(): number;
  /** D-096: openings drawn as broken gates, and our units drawn up on a castle's wall in the last frame. */
  brokenGates(): number;
  wallLifted(): number;
  /** The units' atlases (D-085): which, how many pages, units drawn from them; null: the shapes. */
  art(): { label: string; pages: number; units: number; corpses: number; buildings: number; rubble: number; nodes: number; sling: boolean } | null;
  /** 你的陸 this game was started with (the computer wears the other). */
  culture(): string;
  /** The castles as drawn (D-089): wall pieces and floor tiles shown, towns drawn as blocks, towns no layout fits, units drawn behind a wall. */
  /** `walkable`: the pictures say where those on a wall stand (art-v5.2); `gates`: the gates drawn from pictures, by look (D-096). */
  castle(): { pieces: number; tiles: number; blockTowns: number; misfit: number; ghosts: number; walkable: boolean; gates: Record<string, number>; decor: number; decorLeftOut: number } | null;
  /** 城內 B (castle 2): the towns' decor pieces: town, map cells, where its anchor is on screen (CSS px), shown or left out. */
  decor(): { town: number; piece: string; cells: [number, number][]; sx: number; sy: number; shown: boolean; leftOut: boolean }[];
  /** 寫實地面 (D-093): drawn or not and its quality; set its quality. */
  groundLook(): { real: boolean; quality: string | null; water: boolean; town: boolean } | null;
  setGroundQuality(q: "high" | "low"): void;
  /** The ground's pictures (art-v5, R6-51): drawn from them or not, and how many pieces lie flat or stand. */
  terrain(): { pictures: boolean; pieces: number; flat: number; standing: number } | null;
  /** How far up someone in the middle of a cell is drawn (on a bridge's deck: rules.bridge.deck_top_m), in points on the plane. */
  lift(cx: number, cy: number): number;
  /** A known town's castle on the map (map cells): its walls, gates and the cells inside; null without one. */
  castleCells(town: number): { wall: [number, number][]; gate: [number, number][]; inside: { x0: number; y0: number; x1: number; y1: number } } | null;
  /** 正式介面's left (R6-13): the minimap open (and on its own), what 全體回城 shows (home, work or ""), how many places 地圖 counts. */
  left(): { minimap: boolean; auto: boolean; recall: string; places: number };
  /** Orders sent and not in the snapshot yet (game/pending.ts): sites to come, soldiers to come in this building's queue, and how many were given while paused. */
  pending(building?: number): { sites: number; trains: number; waiting: number };
  /** What the last ASTC 樣本 showed: shown, no-astc, or why it failed (D-085). */
  astc(): string | null;
  /** Each town's wall as drawn, world px (D-084). */
  townWalls(): { id: number; x: number; y: number; side: number; visible: boolean }[];
  /** The map's mode (D-074) and what the screen knows: town ids, and how many cells of rock. */
  mapMode(): string;
  knownTowns(): number[];
  knownRocks(): number;
  /** The ground the player knows at a cell (R6-51: a Terrain value), and how many cells of each value. */
  ground(x: number, y: number): number;
  groundCounts(): Record<number, number>;
  /** The last frames' intervals and drawing times (ms); `clear` starts a new window. */
  frameTimes(clear?: boolean): { frames: number; gapMedian: number; gapP95: number; fps: number; drawMedian: number; drawP95: number; drawMax: number };
  /** Terrain repaints on exploring rock since the last clear (random map), their total and slowest CPU time (ms). */
  terrainRepaints(clear?: boolean): { count: number; totalMs: number; maxMs: number };
  /** Cells along a side of the map. */
  mapSize(): number;
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
    bodyLift: () => game.view?.bodyLift() ?? 0,
    centreCell: () => {
      const cam = game.camera;
      if (cam === null) return { x: 0, y: 0 };
      const c = cam.screenToWorld(cam.width / 2, cam.height / 2);
      return { x: c.x / TILE_PX, y: c.y / TILE_PX };
    },
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
        out.push({ id: b[o + B.id], owner: b[o + B.owner], type: b[o + B.type], cx: b[o + B.cellX], cy: b[o + B.cellY], size: game.view.rules.buildings[b[o + B.type]]?.size ?? 1, progress: b[o + B.progress], flags: b[o + B.flags], soldiers: b[o + B.soldiers], posted: b[o + B.posted] });
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
            if (view.ground[i] !== Terrain.Open || view.map.terrain[i] !== Terrain.Open || view.nodeAt[i] >= 0 || taken[i] === 1 || (explored && view.fog[i] === 0)) continue;
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
    stock: (c) => {
      if (game.portForTest instanceof MockPort) game.portForTest.setStock(c);
    },
    economy: (e) => {
      if (game.portForTest instanceof MockPort) game.portForTest.setEconomy(e);
    },
    resources: () => game.stock(),
    governWaits: () => game.governWaits.list(),
    autoArmy: (on) => {
      game.autoArmyOn = on;
    },
    villagersPaused: (on) => {
      game.autoArmy.villagersPaused = on;
    },
    autoHouse: () => ({ on: game.autoArmy.autoHouse, block: game.autoHouseBlock }),
    population: (p) => {
      if (game.portForTest instanceof MockPort) game.portForTest.setPopulation(p);
    },
    progress: (id, progress) => {
      if (game.portForTest instanceof MockPort) game.portForTest.setProgress(id, progress);
    },
    employ: (ids, node) => {
      if (game.portForTest instanceof MockPort) game.portForTest.employ(ids, node);
    },
    pauseMarks: () => game.pauseMarksForTest,
    pause: () => game.pause(),
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
    strike: (ids, target) => {
      if (game.portForTest instanceof MockPort) game.portForTest.strike(ids, target);
    },
    arrows: () => game.arrowsForTest,
    damage: (id, hp) => {
      if (game.portForTest instanceof MockPort) game.portForTest.damage(id, hp);
    },
    shots: () => game.shotsForTest,
    siege: () => game.siegeForTest,
    towerShots: () => game.towerShotsForTest,
    stones: () => game.stonesForTest,
    brokenGates: () => game.brokenGatesForTest,
    wallLifted: () => game.wallLiftedForTest,
    townWalls: () => game.townWallsForTest,
    art: () => game.artForTest,
    culture: () => game.culture,
    castle: () => game.castleForTest,
    decor: () =>
      (game.decorForTest ?? []).map(({ x, y, ...d }) => {
        const at = game.camera?.worldToScreen(x, y) ?? { x: 0, y: 0 };
        return { ...d, sx: at.x, sy: at.y };
      }),
    groundLook: () => game.groundForTest,
    setGroundQuality: (q) => game.setGroundQuality(q),
    terrain: () => game.terrainForTest,
    lift: (cx, cy) => game.liftForTest(cx, cy),
    castleCells: (town) => {
      const view = game.view;
      const t = view?.knownTowns.get(town);
      const c = t === undefined ? null : (view?.castleOf(t) ?? null);
      if (t === undefined || c === null) return null;
      const at = ([x, y]: readonly [number, number]): [number, number] => [t.cellX + x, t.cellY + y];
      return { wall: c.wall.map(at), gate: c.gate.map(at), inside: { x0: t.cellX + c.inside.x0, y0: t.cellY + c.inside.y0, x1: t.cellX + c.inside.x1, y1: t.cellY + c.inside.y1 } };
    },
    left: () => game.hud.leftForTest,
    pending: (building) => ({ sites: game.pending.sites().length, trains: building === undefined ? 0 : game.pending.trains(building).length, waiting: game.pending.waiting }),
    astc: () => game.lastAstc,
    mapMode: () => game.view?.map.mode ?? "fixed",
    knownTowns: () => game.view?.townList().map((t) => t.id) ?? [],
    knownRocks: () => game.view?.ground.reduce((n, t) => n + (t === Terrain.Blocked ? 1 : 0), 0) ?? 0,
    ground: (x, y) => {
      const v = game.view;
      return v === null ? -1 : (v.ground[y * v.map.size + x] ?? -1);
    },
    groundCounts: () => {
      const out: Record<number, number> = {};
      for (const t of game.view?.ground ?? []) out[t] = (out[t] ?? 0) + 1;
      return out;
    },
    frameTimes: (clear = false) => {
      const s = game.frameTimes.summary();
      if (clear) game.frameTimes.clear();
      return s;
    },
    terrainRepaints: (clear = false) => {
      const r = game.terrainRepaintsForTest;
      const out = r === null ? { count: 0, totalMs: 0, maxMs: 0 } : { ...r };
      if (clear && r !== null) {
        r.count = 0;
        r.totalMs = 0;
        r.maxMs = 0;
      }
      return out;
    },
    mapSize: () => game.view?.map.size ?? 0,
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
      return view.townList().map((info) => {
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
