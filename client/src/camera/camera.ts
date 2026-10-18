// Screen <-> world mapping with pan, zoom and fling (inertia). Screen coordinates are CSS px;
// world coordinates are px (TILE_PX per cell). The camera pans and zooms over the plane, the
// ground as its projection lays it out (seen from above, or as a diamond: projection.ts), so
// the screen's axes stay the screen's. Pure arithmetic, no PixiJS, so it is unit-tested in
// Node. Floats are fine here: the camera never feeds the simulation.

import { INERTIA_DECAY, INERTIA_MIN_SPEED, MAX_ZOOM } from "../tuning.ts";
import { type Projection, TOP } from "./projection.ts";

export interface Point {
  x: number;
  y: number;
}

export class Camera {
  /** The plane's point at the screen's top-left corner. */
  x = 0;
  y = 0;
  scale = 1;
  width = 1;
  height = 1;
  /** Fling velocity in screen px per ms. */
  private vx = 0;
  private vy = 0;
  readonly worldW: number;
  readonly worldH: number;
  readonly projection: Projection;

  constructor(worldW: number, worldH: number, projection: Projection = TOP) {
    this.worldW = worldW;
    this.worldH = worldH;
    this.projection = projection;
  }

  resize(width: number, height: number): void {
    const centre = this.screenToWorld(this.width / 2, this.height / 2);
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.scale = this.clampScale(this.scale);
    this.centerOn(centre.x, centre.y);
  }

  /** Zoomed out as far as the whole map fitting on screen. */
  minScale(): number {
    const b = this.mapBounds();
    return Math.min(this.width / (b.x1 - b.x0), this.height / (b.y1 - b.y0), MAX_ZOOM);
  }

  /** The map's corners on the plane, as a box. */
  private mapBounds(): { x0: number; y0: number; x1: number; y1: number } {
    const p = this.projection;
    const corners = [p.toPlane(0, 0), p.toPlane(this.worldW, 0), p.toPlane(0, this.worldH), p.toPlane(this.worldW, this.worldH)];
    return {
      x0: Math.min(...corners.map((c) => c.x)),
      y0: Math.min(...corners.map((c) => c.y)),
      x1: Math.max(...corners.map((c) => c.x)),
      y1: Math.max(...corners.map((c) => c.y)),
    };
  }

  /** The plane's point under (sx, sy). */
  screenToPlane(sx: number, sy: number): Point {
    return { x: this.x + sx / this.scale, y: this.y + sy / this.scale };
  }

  clampScale(s: number): number {
    return Math.min(Math.max(s, this.minScale()), MAX_ZOOM);
  }

  screenToWorld(sx: number, sy: number): Point {
    const p = this.screenToPlane(sx, sy);
    return this.projection.toWorld(p.x, p.y);
  }

  worldToScreen(wx: number, wy: number): Point {
    const p = this.projection.toPlane(wx, wy);
    return { x: (p.x - this.x) * this.scale, y: (p.y - this.y) * this.scale };
  }

  /** Move the view with the finger: the world follows (dx, dy) screen px. */
  panBy(dx: number, dy: number): void {
    this.x -= dx / this.scale;
    this.y -= dy / this.scale;
    this.clamp();
  }

  /** Set the zoom, keeping the world point under (sx, sy) where it is on screen. */
  zoomAt(sx: number, sy: number, scale: number): void {
    const anchor = this.screenToPlane(sx, sy);
    this.scale = this.clampScale(scale);
    this.x = anchor.x - sx / this.scale;
    this.y = anchor.y - sy / this.scale;
    this.clamp();
  }

  centerOn(wx: number, wy: number): void {
    const p = this.projection.toPlane(wx, wy);
    this.x = p.x - this.width / 2 / this.scale;
    this.y = p.y - this.height / 2 / this.scale;
    this.clamp();
  }

  /** Keep the screen centre on the map, so every map edge can still be brought to the middle. */
  clamp(): void {
    const c = this.screenToWorld(this.width / 2, this.height / 2);
    const x = Math.min(Math.max(c.x, 0), this.worldW);
    const y = Math.min(Math.max(c.y, 0), this.worldH);
    if (x === c.x && y === c.y) return;
    const p = this.projection.toPlane(x, y);
    this.x = p.x - this.width / 2 / this.scale;
    this.y = p.y - this.height / 2 / this.scale;
  }

  fling(vx: number, vy: number): void {
    const speed = Math.hypot(vx, vy);
    if (speed < INERTIA_MIN_SPEED) {
      this.stop();
      return;
    }
    this.vx = vx;
    this.vy = vy;
  }

  stop(): void {
    this.vx = 0;
    this.vy = 0;
  }

  get flinging(): boolean {
    return this.vx !== 0 || this.vy !== 0;
  }

  /** Advance the fling by dt ms. */
  update(dt: number): void {
    if (!this.flinging || dt <= 0) return;
    this.panBy(this.vx * dt, this.vy * dt);
    const k = Math.exp(-INERTIA_DECAY * dt);
    this.vx *= k;
    this.vy *= k;
    if (Math.hypot(this.vx, this.vy) < INERTIA_MIN_SPEED) this.stop();
  }

  /** World rectangle around what is on screen (as a diamond, a little more than the screen). */
  visible(): { x0: number; y0: number; x1: number; y1: number } {
    const corners = [this.screenToWorld(0, 0), this.screenToWorld(this.width, 0), this.screenToWorld(0, this.height), this.screenToWorld(this.width, this.height)];
    return {
      x0: Math.min(...corners.map((c) => c.x)),
      y0: Math.min(...corners.map((c) => c.y)),
      x1: Math.max(...corners.map((c) => c.x)),
      y1: Math.max(...corners.map((c) => c.y)),
    };
  }

  /** The screen's four corners on the world, clockwise from the top left (the minimap's view as a diamond). */
  corners(): Point[] {
    return [this.screenToWorld(0, 0), this.screenToWorld(this.width, 0), this.screenToWorld(this.width, this.height), this.screenToWorld(0, this.height)];
  }
}
