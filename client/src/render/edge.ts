// 浮空大陸的邊緣 (the user 2026-11-04 chose R11 C, D-118; ui's design/r11/edge-format.md), drawn
// round the map as a diamond, outside it only: nothing here is tapped (taps fall on the map as
// before), the minimap is its own canvas. Back to front:
//   - the sea of clouds, far and near, tiled on the screen and moved at 0.2 and 0.35 of the
//     camera (and drifting), each cross-faded with itself half a period on so its loop has no seam,
//     the far islands bobbing in the far layer: under the battlefield, on the stage;
//   - the cliff under the two lower edges (pieces every 16 m, the three corners) and the waterfalls
//     where water meets them (the loop scrolled down, its mouth on the lip, the spray below): in the
//     battlefield, under the ground, darkened as the fog over that stretch of edge;
//   - clouds along the two upper edges, over the ground's straight cut, and a few below the cliffs.
// What moves is a picture moved over time (PixiJS's TilingSprite scrolls its texture in the shader),
// on the page's clock: the simulation knows nothing of it.

import { Container, Sprite, type Texture, TilingSprite } from "pixi.js";
import type { Camera } from "../camera/camera.ts";
import { type Projection, PT_PER_M } from "../camera/projection.ts";
import type { LoadRecorder } from "../lab/load-times.ts";
import { TILE_PX } from "../tuning.ts";
import { CELL_M, cliffPieces, type EdgeJson, type EdgeSide, edgeFalls, edgeFiles, edgeLight, edgePoint, parseEdge } from "./edge-layout.ts";
import { json, page } from "./unit-art.ts";

/** The edge's pictures, as loaded. */
export interface EdgeArt {
  json: EdgeJson;
  textures: Map<string, Texture>;
}

/** The edge under `base` (…/edge/), or null: no edge there (a 404, or not ui's format). */
export async function loadEdge(base: string, times: LoadRecorder | null): Promise<EdgeArt | null> {
  let e: EdgeJson | null;
  try {
    e = parseEdge(await json(`${base}edge.json`, times));
  } catch {
    return null;
  }
  if (e === null) return null;
  const textures = new Map<string, Texture>();
  await Promise.all(
    edgeFiles(e).map(async (f) => {
      textures.set(f, await page(`${base}${f}`, times));
    }),
  );
  return { json: e, textures };
}

/** How dark the cliff is at light 0 (never explored): near the fog's black. */
const DARK = 0.12;
/** Clouds along the upper edges: one every this many metres. */
const RIM_STEP_M = 7;

const grey = (light: number): number => {
  const v = Math.round(255 * (DARK + (1 - DARK) * Math.max(0, Math.min(1, light))));
  return (v << 16) | (v << 8) | v;
};

interface Cloud {
  a: TilingSprite;
  b: TilingSprite;
  spec: EdgeJson["clouds"]["far"];
}

interface Lit {
  sprite: Sprite | TilingSprite;
  side: EdgeSide;
  from: number;
  to: number;
}

export class EdgeRenderer {
  /** The sea of clouds and the islands: under the battlefield, the whole screen. */
  readonly back = new Container();
  /** The cliff and the waterfalls: in the battlefield, under the ground. */
  readonly under = new Container();
  /** Clouds over the upper edges and below the cliffs: in the battlefield, over the ground. */
  readonly over = new Container();
  private readonly far: Cloud;
  private readonly near: Cloud;
  private readonly islands: { sprite: Sprite; plane: { x: number; y: number }; bob: number; s: number; phase: number }[] = [];
  private readonly lit: Lit[] = [];
  private readonly falls = new Container();
  private readonly fallLoops: TilingSprite[] = [];
  private readonly puffs: { sprite: Sprite; x: number; y: number; dx: number; dy: number; phase: number }[] = [];
  private fogVersion = -1;
  private groundVersion = -1;
  /** Plane points a picture pixel (the pictures are pxPerM, the plane PT_PER_M a metre). */
  private readonly k: number;

  private readonly art: EdgeArt;
  private readonly projection: Projection;
  private readonly size: number;

  constructor(art: EdgeArt, projection: Projection, size: number) {
    this.art = art;
    this.projection = projection;
    this.size = size;
    const e = art.json;
    this.k = PT_PER_M / e.pxPerM;
    this.far = this.cloud(e.clouds.far);
    this.islandsUp();
    this.near = this.cloud(e.clouds.near);
    this.cliffUp();
    this.under.addChild(this.falls);
    this.rimUp();
  }

  private tex(file: string): Texture {
    const t = this.art.textures.get(file);
    if (t === undefined) throw new Error(`edge: ${file} not loaded`);
    return t;
  }

  private cloud(spec: EdgeJson["clouds"]["far"]): Cloud {
    const t = this.tex(spec.file);
    const a = new TilingSprite({ texture: t, width: 1, height: 1 });
    const b = new TilingSprite({ texture: t, width: 1, height: 1 });
    this.back.addChild(a, b);
    return { a, b, spec };
  }

  /** A plane point (pt at zoom 1) of a world point in cells. */
  private plane(cx: number, cy: number): { x: number; y: number } {
    return this.projection.toPlane(cx * TILE_PX, cy * TILE_PX);
  }

  private islandsUp(): void {
    const e = this.art.json;
    if (e.islands.length === 0) return;
    // Beyond the two lower edges, two a side, out in the far layer (it moves at its parallax).
    const n = this.size;
    const spots = [
      { x: n * 0.3, y: n * 1.55 },
      { x: n * 0.8, y: n * 1.35 },
      { x: n * 1.35, y: n * 0.8 },
      { x: n * 1.55, y: n * 0.3 },
    ];
    spots.forEach((p, i) => {
      const spec = e.islands[i % e.islands.length];
      const t = this.tex(spec.file);
      const sprite = new Sprite(t);
      sprite.anchor.set(spec.anchor[0] / t.width, spec.anchor[1] / t.height);
      this.back.addChild(sprite);
      this.islands.push({ sprite, plane: this.plane(p.x, p.y), bob: spec.bob_px / e.scale, s: spec.bob_s, phase: i * 1.7 });
    });
  }

  private cliffUp(): void {
    const e = this.art.json;
    const n = this.size;
    for (const side of ["sw", "se"] as const) {
      const kinds = e.cliff[side];
      for (const p of cliffPieces(n, side, e.cliff.stretch_m, kinds.length)) {
        const spec = kinds[p.kind];
        const t = this.tex(spec.file);
        const sprite = new Sprite(t);
        sprite.anchor.set(spec.anchor[0] / t.width, spec.anchor[1] / t.height);
        // Each piece is drawn for stretch_m and overlaps its neighbours by overlap_m: put, not cut.
        const at = edgePoint(n, side, p.mid);
        const q = this.plane(at.x, at.y);
        sprite.position.set(q.x, q.y);
        sprite.scale.set(this.k * ((p.to - p.from) * CELL_M) / e.cliff.stretch_m, this.k);
        this.under.addChild(sprite);
        this.lit.push({ sprite, side, from: p.from, to: p.to });
      }
    }
    const corners: [keyof EdgeJson["cliff"]["corner"], number, number, EdgeSide, number, number][] = [
      ["left", 0, n, "sw", 0, 2],
      ["bottom", n, n, "sw", n - 2, n],
      ["right", n, 0, "se", n - 2, n],
    ];
    for (const [name, cx, cy, side, from, to] of corners) {
      const spec = e.cliff.corner[name];
      const t = this.tex(spec.file);
      const sprite = new Sprite(t);
      sprite.anchor.set(spec.anchor[0] / t.width, spec.anchor[1] / t.height);
      const q = this.plane(cx, cy);
      sprite.position.set(q.x, q.y);
      sprite.scale.set(this.k);
      this.under.addChild(sprite);
      this.lit.push({ sprite, side, from, to });
    }
  }

  /** The waterfalls where water meets the lower edges now (a random map learns its ground as it is explored). */
  private fallsUp(terrain: Uint8Array): void {
    for (const c of this.falls.removeChildren()) c.destroy();
    this.fallLoops.length = 0;
    this.lit.splice(0, this.lit.length, ...this.lit.filter((l) => l.sprite.parent !== null && l.sprite.parent !== this.falls));
    const e = this.art.json;
    const loopTex = this.tex(e.fall.loop.file);
    const n = this.size;
    const drop = (e.cliff.height_m + 3) * PT_PER_M;
    for (const f of edgeFalls(terrain, n)) {
      // From the run's left end to its right on the screen, the edge slanting down (sw) or up (se).
      const l = this.plane(edgePoint(n, f.side, f.from).x, edgePoint(n, f.side, f.from).y);
      const r = this.plane(edgePoint(n, f.side, f.to).x, edgePoint(n, f.side, f.to).y);
      const dx = r.x - l.x;
      const slope = Math.atan2(r.y - l.y, dx);
      const loop = new TilingSprite({ texture: loopTex, width: dx / Math.cos(slope), height: drop });
      loop.position.set(l.x, l.y);
      loop.skew.set(0, slope);
      // One width of the picture across the run, its height at the pictures' scale.
      loop.tileScale.set(loop.width / loopTex.width, this.k);
      this.falls.addChild(loop);
      this.fallLoops.push(loop);
      this.lit.push({ sprite: loop, side: f.side, from: f.from, to: f.to });
      const runM = (f.to - f.from) * CELL_M;
      const mid = this.plane(edgePoint(n, f.side, (f.from + f.to) / 2).x, edgePoint(n, f.side, (f.from + f.to) / 2).y);
      const wide = runM / e.fall.loop.width_m;
      // ui draws the mouth and the spray for the sw edge; the se edge's mirrored.
      const flip = f.side === "se" ? -1 : 1;
      for (const [spec, y] of [
        [e.fall.mouth, 0],
        [e.fall.spray, drop],
      ] as const) {
        const t = this.tex(spec.file);
        const s = new Sprite(t);
        s.anchor.set(spec.anchor[0] / t.width, spec.anchor[1] / t.height);
        s.position.set(mid.x, mid.y + y);
        s.scale.set(this.k * wide * flip, this.k * Math.max(1, wide * 0.6));
        this.falls.addChild(s);
        this.lit.push({ sprite: s, side: f.side, from: f.from, to: f.to });
      }
    }
  }

  private rimUp(): void {
    const e = this.art.json;
    if (e.puffs.length === 0) return;
    const n = this.size;
    // Along the two upper edges (x = 0 and y = 0), astride the line, so the ground's straight cut fades into clouds.
    const step = RIM_STEP_M / CELL_M;
    let k = 0;
    for (let i = step / 2; i < n; i += step) {
      for (const [cx, cy] of [
        [0, n - i],
        [i, 0],
      ] as const) {
        this.puff(k++, this.plane(cx, cy), e.rim.fade_m * 2.4);
      }
    }
    // And a few drifting under the cliffs.
    for (let i = n / 6; i < n; i += n / 3) {
      for (const side of ["sw", "se"] as const) {
        const at = edgePoint(n, side, i);
        const q = this.plane(at.x, at.y);
        this.puff(k++, { x: q.x, y: q.y + (e.cliff.height_m + 6) * PT_PER_M }, 14);
      }
    }
  }

  private puff(k: number, at: { x: number; y: number }, wideM: number): void {
    const e = this.art.json;
    const spec = e.puffs[k % e.puffs.length];
    const t = this.tex(spec.file);
    const sprite = new Sprite(t);
    sprite.anchor.set(0.5);
    sprite.alpha = spec.alpha_max;
    sprite.scale.set((wideM * PT_PER_M) / t.width);
    sprite.position.set(at.x, at.y);
    this.over.addChild(sprite);
    this.puffs.push({ sprite, x: at.x, y: at.y, dx: spec.drift_px_s[0] / e.scale, dy: spec.drift_px_s[1] / e.scale, phase: k * 0.9 });
  }

  /** Every frame: the clouds and the falls move; the cliff follows the fog, the falls the ground learnt. */
  update(now: number, camera: Camera, terrain: Uint8Array, groundVersion: number, fog: Uint8Array | null, fogVersion: number): void {
    const t = now / 1000;
    if (groundVersion !== this.groundVersion) {
      this.groundVersion = groundVersion;
      this.fallsUp(terrain);
      this.fogVersion = -1;
    }
    if (fogVersion !== this.fogVersion) {
      this.fogVersion = fogVersion;
      for (const l of this.lit) l.sprite.tint = grey(edgeLight(fog, this.size, l.side, l.from, l.to));
    }
    const w = camera.width;
    const h = camera.height;
    const s = camera.scale;
    // The plane point at the screen's centre.
    const cx = camera.x + w / 2 / s;
    const cy = camera.y + h / 2 / s;
    for (const layer of [this.far, this.near]) {
      const spec = layer.spec;
      const p = spec.parallax;
      // The clouds far off shrink less as the camera zooms out.
      const zoom = (1 / this.art.json.scale) * Math.pow(s, p);
      const tile = spec.tile_px * zoom;
      const phase = (t / spec.fade_s) * Math.PI * 2;
      for (const [sprite, off] of [
        [layer.a, 0],
        [layer.b, 0.5],
      ] as const) {
        sprite.width = w;
        sprite.height = h;
        sprite.tileScale.set(zoom);
        sprite.tilePosition.set(-cx * s * p + spec.drift_px_s[0] * zoom * t + off * tile, -cy * s * p + spec.drift_px_s[1] * zoom * t + off * tile);
      }
      // b over a: from not at all to all and back; the near layer's a fades the other way (it is see-through).
      const b = 0.5 - 0.5 * Math.cos(phase);
      layer.b.alpha = b;
      layer.a.alpha = spec.alpha ? 1 - b : 1;
    }
    for (const isl of this.islands) {
      const p = this.far.spec.parallax;
      const zoom = Math.pow(s, p) * (PT_PER_M / this.art.json.pxPerM);
      isl.sprite.scale.set(zoom);
      isl.sprite.position.set(w / 2 + (isl.plane.x - cx) * s * p, h / 2 + (isl.plane.y - cy) * s * p + isl.bob * Math.sin((t / isl.s) * Math.PI * 2 + isl.phase));
    }
    const loop = this.art.json.fall.loop;
    for (const f of this.fallLoops) f.tilePosition.y = t * loop.scroll_m_s * PT_PER_M;
    for (const p of this.puffs) {
      const sway = Math.sin(t * 0.2 + p.phase);
      p.sprite.position.set(p.x + p.dx * 3 * sway, p.y + p.dy * 3 * sway);
    }
  }

  /** Cliff pieces and corners (the test page). */
  get pieceCount(): number {
    return this.under.children.filter((c) => c !== this.falls).length;
  }

  /** Waterfalls now (the test page). */
  get fallCount(): number {
    return this.fallLoops.length;
  }

  destroy(): void {
    for (const c of [this.back, this.under, this.over]) c.destroy({ children: true });
  }
}
