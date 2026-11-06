// 地面快取 (ceo b2 2026-11-07, after client's measurements: the ground was most of a frame, art-v7's R9
// ground the costliest; review/fps/gcache): of the realistic ground (ground-draw.ts) only the water moves
// with time, so while the camera stands still the land is drawn once into a picture of the screen and
// the water alone over it every frame. On, the frame cost 102 ms instead of 179 (WebKit in a container,
// 814 × 380 at 3; relative only: the iPhone's GPU to be measured), the same picture to the eye
// (b2: pixels off by more than 2 at most 0.05%, by at most 32; ground-cache.spec.ts).
// - While the camera moves the ground is drawn as before, whole, every frame (a cache drawn again every
//   frame cost more: 211 ms against 182); it is taken once the camera has stood still a frame.
// - Taken again when what the land shows changes (GroundDraw.dirty), the screen's size or pixel ratio
//   changes, or the GPU lost its memory (gpu.contextLost).
// - Its picture: the screen's pixels, RGBA (10.6 MB at 814 × 380 × 3; 13.8 MB a full iPhone 14 Pro Max).
// - On by default; off with ?test=1&gcache=0 or the 量測 panel's 地面快取 row (the iPhone's numbers).

import { type Application, Container, Matrix, RenderTexture, Sprite } from "pixi.js";
import type { Camera } from "../camera/camera.ts";
import { gpu } from "../stage.ts";
import type { GroundDraw } from "./ground-draw.ts";

export class GroundCache {
  /** Over the battlefield's ground: the cache's picture, a screen pixel a texel. In the camera's container (world.ts root). */
  readonly sprite = new Sprite();
  private readonly app: Application;
  private readonly holder = new Container();
  private target: RenderTexture | null = null;
  /** The camera the cache was taken at, and last frame's. */
  private takenAt = "";
  private lastCamera = "";
  private lost = gpu.contextLost;
  on: boolean;
  /** Times the land was drawn into the cache (the test page). */
  taken = 0;

  /** Its picture over the ground this frame (the test page). */
  get shown(): boolean {
    return this.sprite.visible;
  }

  constructor(app: Application, on: boolean) {
    this.app = app;
    this.on = on;
    this.sprite.visible = false;
  }

  /**
   * Every frame, after the ground's uniforms: the cache shown and the mesh drawing the water only, or the
   * mesh drawing the whole ground as before. `inner`: the container the mesh is in (its transform the
   * mesh's, the camera's included).
   */
  frame(camera: Camera, ground: GroundDraw | null, inner: Container): void {
    const cam = `${camera.x}|${camera.y}|${camera.scale}`;
    const still = cam === this.lastCamera;
    this.lastCamera = cam;
    const use = this.on && ground !== null && ground.mesh.visible && still;
    this.sprite.visible = use;
    ground?.waterOnly(use);
    if (ground !== null) ground.mesh.renderable = !use || ground.moves;
    if (!use || ground === null) return;
    const r = this.app.renderer;
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const res = r.resolution;
    const t = this.target;
    if (t === null || t.width !== w || t.height !== h || t.source.resolution !== res || gpu.contextLost !== this.lost) {
      t?.destroy(true);
      this.target = RenderTexture.create({ width: w, height: h, resolution: res, scaleMode: "nearest" });
      this.sprite.texture = this.target;
      this.lost = gpu.contextLost;
      this.takenAt = "";
    }
    // Over the screen exactly: in the camera's container, at its corner, a screen point a 1 / scale.
    this.sprite.position.set(camera.x, camera.y);
    this.sprite.scale.set(1 / camera.scale);
    const key = `${cam}|${w}|${h}|${res}`;
    if (key === this.takenAt && !ground.dirty) return;
    this.takenAt = key;
    ground.dirty = false;
    if (this.holder.children[0] !== ground.cacheMesh) {
      this.holder.removeChildren();
      this.holder.addChild(ground.cacheMesh);
    }
    const m = inner.getGlobalTransform(new Matrix(), false);
    r.render({ container: this.holder, target: this.target as RenderTexture, clear: true, clearColor: [0, 0, 0, 0], transform: m });
    this.taken++;
  }

  /** Its picture's size on the GPU (MB; 0 before the first). */
  get memoryMB(): number {
    const s = this.target?.source;
    return s === undefined ? 0 : (s.pixelWidth * s.pixelHeight * 4) / 1048576;
  }

  destroy(): void {
    this.holder.removeChildren();
    this.target?.destroy(true);
    this.sprite.destroy();
  }
}
