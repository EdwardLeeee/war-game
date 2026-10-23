// Tiles that butt edge to edge (the water, bridge decks, the castles' floor): drawn from a little
// inside their frame and stretched back to its size, so that the GPU's filtering at their edges
// never takes in the atlas page's transparent gutter (half a texel), nor a tile's own soft edge
// (the castles' floor tiles: their outer texels are 0–90 % opaque, art-v5.1). Drawn from the frame
// itself they left ~1 px lines between them at 3 倍 in WebKit (the ground showing through).

import { Rectangle, Texture } from "pixi.js";

export class InsetFrames {
  private readonly cache = new Map<Texture, Texture>();
  /** Texels in on every side. */
  private readonly by: number;

  constructor(by = 0.5) {
    this.by = by;
  }

  /** The frame `by` texels in on every side (one texture a frame, kept). */
  of(t: Texture): Texture {
    let inset = this.cache.get(t);
    if (inset === undefined) {
      const r = t.frame;
      inset = new Texture({ source: t.source, frame: new Rectangle(r.x + this.by, r.y + this.by, r.width - 2 * this.by, r.height - 2 * this.by) });
      this.cache.set(t, inset);
    }
    return inset;
  }

  /** The scale, x and y, that draws `t`'s inset at the size `t` has at `k`. */
  scale(t: Texture, k: number): [number, number] {
    const r = t.frame;
    return [(k * r.width) / (r.width - 2 * this.by), (k * r.height) / (r.height - 2 * this.by)];
  }

  destroy(): void {
    for (const t of this.cache.values()) t.destroy(false);
    this.cache.clear();
  }
}
