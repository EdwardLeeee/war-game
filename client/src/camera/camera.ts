// Screen <-> world mapping with pan, zoom and fling (inertia). Screen coordinates are CSS px;
// world coordinates are px at zoom 1 (TILE_PX per cell). Pure arithmetic, no PixiJS, so it is
// unit-tested in Node. Floats are fine here: the camera never feeds the simulation.

import { INERTIA_DECAY, INERTIA_MIN_SPEED, MAX_ZOOM } from "../tuning.ts";

export interface Point {
  x: number;
  y: number;
}

export class Camera {
  /** World position of the screen's top-left corner. */
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

  constructor(worldW: number, worldH: number) {
    this.worldW = worldW;
    this.worldH = worldH;
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
    return Math.min(this.width / this.worldW, this.height / this.worldH, MAX_ZOOM);
  }

  clampScale(s: number): number {
    return Math.min(Math.max(s, this.minScale()), MAX_ZOOM);
  }

  screenToWorld(sx: number, sy: number): Point {
    return { x: this.x + sx / this.scale, y: this.y + sy / this.scale };
  }

  worldToScreen(wx: number, wy: number): Point {
    return { x: (wx - this.x) * this.scale, y: (wy - this.y) * this.scale };
  }

  /** Move the view with the finger: the world follows (dx, dy) screen px. */
  panBy(dx: number, dy: number): void {
    this.x -= dx / this.scale;
    this.y -= dy / this.scale;
    this.clamp();
  }

  /** Set the zoom, keeping the world point under (sx, sy) where it is on screen. */
  zoomAt(sx: number, sy: number, scale: number): void {
    const anchor = this.screenToWorld(sx, sy);
    this.scale = this.clampScale(scale);
    this.x = anchor.x - sx / this.scale;
    this.y = anchor.y - sy / this.scale;
    this.clamp();
  }

  centerOn(wx: number, wy: number): void {
    this.x = wx - this.width / 2 / this.scale;
    this.y = wy - this.height / 2 / this.scale;
    this.clamp();
  }

  /** Keep the screen centre on the map, so every map edge can still be brought to the middle. */
  clamp(): void {
    const halfW = this.width / 2 / this.scale;
    const halfH = this.height / 2 / this.scale;
    this.x = Math.min(Math.max(this.x, -halfW), this.worldW - halfW);
    this.y = Math.min(Math.max(this.y, -halfH), this.worldH - halfH);
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

  /** World rectangle currently on screen. */
  visible(): { x0: number; y0: number; x1: number; y1: number } {
    return { x0: this.x, y0: this.y, x1: this.x + this.width / this.scale, y1: this.y + this.height / this.scale };
  }
}
