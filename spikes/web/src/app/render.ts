// PixiJS scene: the map baked into chunk textures, one sprite plus a two-sprite health
// bar per unit, positions interpolated between the last two simulation snapshots.
// Unit sprites change frame every rendered frame while moving or attacking.

import { Application, Assets, Container, Rectangle, RenderTexture, Sprite, Texture } from "pixi.js";
import { ANIM_ATTACK, ANIM_MOVE, CELL, MAP_SIZE, TICKS_PER_SECOND, TYPE_HP } from "../sim/constants.ts";
import type { GameMap } from "../sim/map.ts";
import { STRIDE } from "./protocol.ts";

export const TILE_PX = 16;
const FRAME = 32;
const CHUNK = 32; // cells per chunk side
const UNIT_SCALE = (TILE_PX * 1.25) / FRAME;
const TICK_MS = 1000 / TICKS_PER_SECOND;
const TEAM_TINT = [0xd9433b, 0x3b73d9, 0xdeb230, 0x3aaa5a];

export interface Snapshot {
  tick: number;
  count: number;
  units: Int32Array;
  at: number;
}

export class Scene {
  readonly app: Application;
  readonly world = new Container();
  private unitLayer = new Container();
  private barLayer = new Container();
  private frames: Texture[][] = []; // [team * 3 + type][frame]
  private white!: Texture;
  private ring!: Texture;
  private sprites: Sprite[] = [];
  private barsBack: Sprite[] = [];
  private barsFront: Sprite[] = [];
  private rings: Sprite[] = [];
  private frameNo = 0;
  prev: Snapshot | null = null;
  curr: Snapshot | null = null;
  selected = new Set<number>();

  constructor(app: Application) {
    this.app = app;
    app.stage.addChild(this.world);
  }

  async load(map: GameMap): Promise<void> {
    const units = await Assets.load<Texture>("art/units.png");
    const tiles = await Assets.load<Texture>("art/tiles.png");
    units.source.scaleMode = "linear";
    tiles.source.scaleMode = "nearest";
    for (let row = 0; row < 12; row++) {
      const list: Texture[] = [];
      for (let f = 0; f < 12; f++) {
        list.push(new Texture({ source: units.source, frame: new Rectangle(f * FRAME, row * FRAME, FRAME, FRAME) }));
      }
      this.frames.push(list);
    }
    this.ring = new Texture({ source: units.source, frame: new Rectangle(0, 12 * FRAME, FRAME, FRAME) });
    this.white = new Texture({ source: units.source, frame: new Rectangle(FRAME + 4, 12 * FRAME + 4, 8, 8) });
    const tileTex: Texture[] = [];
    for (let i = 0; i < 8; i++) {
      tileTex.push(new Texture({ source: tiles.source, frame: new Rectangle(i * TILE_PX, 0, TILE_PX, TILE_PX) }));
    }
    this.bakeMap(map, tileTex);
    this.world.addChild(this.unitLayer, this.barLayer);
  }

  private bakeMap(map: GameMap, tileTex: Texture[]): void {
    const layer = new Container();
    const chunks = Math.ceil(MAP_SIZE / CHUNK);
    for (let cy = 0; cy < chunks; cy++) {
      for (let cx = 0; cx < chunks; cx++) {
        const holder = new Container();
        for (let y = cy * CHUNK; y < Math.min((cy + 1) * CHUNK, MAP_SIZE); y++) {
          for (let x = cx * CHUNK; x < Math.min((cx + 1) * CHUNK, MAP_SIZE); x++) {
            const blocked = map.blocked[y * MAP_SIZE + x] === 1;
            const v = blocked ? 4 + ((x * 3 + y * 5) % 4) : (x * 7 + y * 13) % 4;
            const s = new Sprite(tileTex[v]);
            s.position.set((x - cx * CHUNK) * TILE_PX, (y - cy * CHUNK) * TILE_PX);
            holder.addChild(s);
          }
        }
        const rt = RenderTexture.create({ width: CHUNK * TILE_PX, height: CHUNK * TILE_PX });
        this.app.renderer.render({ container: holder, target: rt });
        holder.destroy({ children: true });
        const chunk = new Sprite(rt);
        chunk.position.set(cx * CHUNK * TILE_PX, cy * CHUNK * TILE_PX);
        layer.addChild(chunk);
      }
    }
    this.world.addChild(layer);
  }

  push(s: Snapshot): void {
    this.prev = this.curr;
    this.curr = s;
  }

  /** Grow the sprite pools to at least n units. */
  private ensure(n: number): void {
    while (this.sprites.length < n) {
      const ring = new Sprite(this.ring);
      ring.anchor.set(0.5);
      ring.scale.set(UNIT_SCALE * 0.8);
      ring.visible = false;
      const s = new Sprite(this.frames[0][0]);
      s.anchor.set(0.5, 0.6);
      const back = new Sprite(this.white);
      back.tint = 0x201a18;
      const front = new Sprite(this.white);
      this.unitLayer.addChild(ring, s);
      this.barLayer.addChild(back, front);
      this.rings.push(ring);
      this.sprites.push(s);
      this.barsBack.push(back);
      this.barsFront.push(front);
    }
  }

  draw(now: number): void {
    const curr = this.curr;
    if (curr === null) return;
    this.frameNo++;
    const prev = this.prev;
    const alpha = Math.min(Math.max((now - curr.at) / TICK_MS, 0), 1);
    const u = curr.units;
    const n = curr.count;
    this.ensure(n);
    const scale = TILE_PX / CELL;
    const barW = TILE_PX * 0.9;
    let p = 0;
    for (let i = 0, o = 0; i < n; i++, o += STRIDE) {
      const id = u[o];
      const team = u[o + 1];
      const type = u[o + 2];
      let x = u[o + 3];
      let y = u[o + 4];
      // Both snapshots are sorted by ID: walk the previous one alongside.
      if (prev !== null) {
        const pu = prev.units;
        while (p < prev.count && pu[p * STRIDE] < id) p++;
        if (p < prev.count && pu[p * STRIDE] === id) {
          x = pu[p * STRIDE + 3] + (x - pu[p * STRIDE + 3]) * alpha;
          y = pu[p * STRIDE + 4] + (y - pu[p * STRIDE + 4]) * alpha;
        }
      }
      const px = x * scale;
      const py = y * scale;
      const anim = u[o + 6];
      const facing = u[o + 7];
      let frame = 0;
      if (anim === ANIM_MOVE) frame = (this.frameNo + id) % 8;
      else if (anim === ANIM_ATTACK) frame = 8 + ((this.frameNo + id) % 4);
      const s = this.sprites[i];
      s.visible = true;
      s.texture = this.frames[team * 3 + type][frame];
      s.position.set(px, py);
      // Art faces right; mirror when facing left (sectors 5..11).
      s.scale.set(facing > 4 && facing < 12 ? -UNIT_SCALE : UNIT_SCALE, UNIT_SCALE);
      const ring = this.rings[i];
      ring.visible = this.selected.has(id);
      if (ring.visible) ring.position.set(px, py);
      const hpFrac = u[o + 5] / TYPE_HP[type];
      const back = this.barsBack[i];
      back.visible = true;
      back.position.set(px - barW / 2, py - TILE_PX * 0.95);
      back.width = barW;
      back.height = 2.2;
      const front = this.barsFront[i];
      front.visible = true;
      front.tint = TEAM_TINT[team];
      front.position.set(px - barW / 2, py - TILE_PX * 0.95);
      front.width = barW * hpFrac;
      front.height = 2.2;
    }
    for (let i = n; i < this.sprites.length; i++) {
      this.sprites[i].visible = false;
      this.rings[i].visible = false;
      this.barsBack[i].visible = false;
      this.barsFront[i].visible = false;
    }
  }

  /** Units of the current snapshot as [id, team, worldX px, worldY px]. */
  unitsAt(): { id: number; team: number; x: number; y: number }[] {
    const out: { id: number; team: number; x: number; y: number }[] = [];
    const c = this.curr;
    if (c === null) return out;
    for (let o = 0; o < c.count * STRIDE; o += STRIDE) {
      out.push({ id: c.units[o], team: c.units[o + 1], x: (c.units[o + 3] * TILE_PX) / CELL, y: (c.units[o + 4] * TILE_PX) / CELL });
    }
    return out;
  }

  /** Scale and position the world so the cell rectangle [x0, x1] x [y0, y1] fills the view. */
  fit(x0: number, y0: number, x1: number, y1: number): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const s = Math.min(w / ((x1 - x0) * TILE_PX), h / ((y1 - y0) * TILE_PX));
    this.world.scale.set(s);
    this.world.position.set(w / 2 - ((x0 + x1) / 2) * TILE_PX * s, h / 2 - ((y0 + y1) / 2) * TILE_PX * s);
  }
}
