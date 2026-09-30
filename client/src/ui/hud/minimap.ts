// Minimap (GDD §10: 左下). One texel per cell for terrain, fog, nodes, buildings and units,
// scaled up without smoothing; towns, the camera's view and attack alerts drawn on top.
// Gestures (GDD §10 table): tap jumps there; with units selected, a long press sends them
// there (前進). In a map-tap mode (撤退, 晶砲, 集結點) a tap picks the spot instead.

import { pressable } from "../../input/pressable.ts";
import {
  BUILDING_STRIDE,
  BuildingField as B,
  Fog,
  NodeField as N,
  NodeKind,
  Terrain,
  TOWN_STRIDE,
  TownField as T,
  UNIT_STRIDE,
  UnitField as U,
} from "../../sim.ts";
import { TILE_PX } from "../../tuning.ts";
import type { GameView } from "../../view/view.ts";
import { townLook } from "../../render/world.ts";
import { ENEMY_TINT, NEUTRAL_TINT, OWN_TINT, ownerTint } from "../../render/atlas.ts";

export const MINIMAP_CSS_PX = 112;
/** How often the minimap redraws (ms). */
const REDRAW_MS = 200;

const rgb = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const css = (c: number, a = 1) => `rgba(${rgb(c).join(",")},${a})`;

export interface MinimapHost {
  view(): GameView | null;
  /** The camera's world rectangle. */
  visible(): { x0: number; y0: number; x1: number; y1: number } | null;
  tap(cellX: number, cellY: number): void;
  longPress(cellX: number, cellY: number): void;
  /** Attack alerts to flash, in cells. */
  alerts(): { cx: number; cy: number }[];
}

export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly host: MinimapHost;
  private cells: HTMLCanvasElement | null = null;
  private cellsCtx: CanvasRenderingContext2D | null = null;
  private img: ImageData | null = null;
  private lastDraw = 0;

  constructor(parent: HTMLElement, host: MinimapHost) {
    this.host = host;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "minimap";
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "小地圖：點一下跳過去；選了部隊時長按，部隊前進到那裡");
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(MINIMAP_CSS_PX * dpr);
    this.canvas.height = Math.round(MINIMAP_CSS_PX * dpr);
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d") as CanvasRenderingContext2D;
    pressable(this.canvas, {
      tap: (_count, x, y) => {
        const c = this.cellAt(x, y);
        if (c !== null) host.tap(c.x, c.y);
      },
      longPress: (x, y) => {
        const c = this.cellAt(x, y);
        if (c !== null) host.longPress(c.x, c.y);
      },
    });
  }

  cellAt(x: number, y: number): { x: number; y: number } | null {
    const view = this.host.view();
    if (view === null) return null;
    const size = view.map.size;
    const w = this.canvas.clientWidth || MINIMAP_CSS_PX;
    const h = this.canvas.clientHeight || MINIMAP_CSS_PX;
    return { x: Math.min(size - 1, Math.max(0, Math.floor((x / w) * size))), y: Math.min(size - 1, Math.max(0, Math.floor((y / h) * size))) };
  }

  update(now: number): void {
    if (now - this.lastDraw < REDRAW_MS) return;
    this.lastDraw = now;
    const view = this.host.view();
    const snap = view?.curr?.snap;
    if (view === null || snap === undefined) return;
    const size = view.map.size;
    if (this.cells === null) {
      this.cells = document.createElement("canvas");
      this.cells.width = size;
      this.cells.height = size;
      this.cellsCtx = this.cells.getContext("2d") as CanvasRenderingContext2D;
      this.img = this.cellsCtx.createImageData(size, size);
    }
    const d = (this.img as ImageData).data;
    const fog = view.fog;
    for (let i = 0; i < size * size; i++) {
      const rock = view.map.terrain[i] === Terrain.Blocked;
      const f = fog === null ? Fog.Unexplored : fog[i];
      const k = f === Fog.Visible ? 1 : f === Fog.Explored ? 0.55 : 0;
      const base = rock ? [110, 102, 92] : [86, 118, 66];
      d[i * 4] = base[0] * k;
      d[i * 4 + 1] = base[1] * k;
      d[i * 4 + 2] = base[2] * k;
      d[i * 4 + 3] = 255;
    }
    const put = (cx: number, cy: number, c: [number, number, number]) => {
      if (cx < 0 || cy < 0 || cx >= size || cy >= size) return;
      const i = (cy * size + cx) * 4;
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
    };
    for (const row of view.nodes.values()) {
      if (row[N.amount] <= 0) continue;
      const kind = row[N.kind];
      put(row[N.cellX], row[N.cellY], kind === NodeKind.Tree ? [38, 72, 36] : kind === NodeKind.GoldMine ? [242, 194, 48] : kind === NodeKind.CrystalVein ? [122, 240, 255] : [196, 60, 80]);
    }
    const b = snap.buildings;
    for (let o = 0; o < b.length; o += BUILDING_STRIDE) {
      const s = view.rules.buildings[b[o + B.type]]?.size ?? 1;
      const c = rgb(ownerTint(b[o + B.owner], view.me));
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) put(b[o + B.cellX] + x, b[o + B.cellY] + y, c);
    }
    // Units a shade lighter than their owner's buildings, so both show.
    const dot = (owner: number) => {
      const tint = ownerTint(owner, view.me);
      return rgb(tint === OWN_TINT ? 0x9cc4ff : tint === ENEMY_TINT ? 0xff7a70 : NEUTRAL_TINT);
    };
    const u = snap.units;
    for (let o = 0; o < u.length; o += UNIT_STRIDE) put(u[o + U.x] >> 10, u[o + U.y] >> 10, dot(u[o + U.owner]));
    (this.cellsCtx as CanvasRenderingContext2D).putImageData(this.img as ImageData, 0, 0);

    const ctx = this.ctx;
    const W = this.canvas.width;
    const k = W / size;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.cells, 0, 0, W, this.canvas.height);

    const t = snap.towns;
    ctx.lineWidth = Math.max(1, k * 0.8);
    for (let o = 0; o < t.length; o += TOWN_STRIDE) {
      const info = view.map.towns.find((v) => v.id === t[o + T.id]);
      if (info === undefined) continue;
      ctx.strokeStyle = css(townLook(t[o + T.state], t[o + T.owner], view.me).tint);
      ctx.beginPath();
      ctx.arc((info.cellX + 0.5) * k, (info.cellY + 0.5) * k, info.radius * k, 0, Math.PI * 2);
      ctx.stroke();
    }

    const pulse = 0.5 + 0.5 * Math.sin(now / 150);
    ctx.fillStyle = css(0xff3b30, 0.35 + 0.5 * pulse);
    for (const a of this.host.alerts()) {
      ctx.beginPath();
      ctx.arc((a.cx + 0.5) * k, (a.cy + 0.5) * k, (3 + 3 * pulse) * k, 0, Math.PI * 2);
      ctx.fill();
    }

    const v = this.host.visible();
    if (v !== null) {
      const px = k / TILE_PX;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = Math.max(1, W / 110);
      ctx.strokeRect(v.x0 * px, v.y0 * px, (v.x1 - v.x0) * px, (v.y1 - v.y0) * px);
    }
  }
}
