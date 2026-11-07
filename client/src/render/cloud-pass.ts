// 浮空大陸's sea of clouds (edge.ts), a layer in one pass (ceo b2 2026-11-07, after client's measurement:
// review/fps/gcache): each layer is one picture tiled over the whole screen twice, the second half a tile on
// and cross-faded over the first so that its loop has no seam. Drawn as two TilingSprites that is two passes
// over the whole screen a layer, four in all; here each pixel reads both tiles and blends them itself, two
// passes in all. The same picture: the second over the first as before (premultiplied: b + a (1 − b.a)),
// off by a rounding (the blend once, not twice: at most 4 of 255, edge-clouds.spec.ts). At the map's corner,
// 101.5 ms a frame → 91 (WebKit in a container, 814 × 380 at 3); its meshes are not batched with the
// sprites: the frame's draws 7 → 10.

import { Geometry, GlProgram, Mesh, Shader, type Texture, UniformGroup } from "pixi.js";

const VERTEX = /* glsl */ `
in vec2 aPosition;
out vec2 vP;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec4 uTile;
void main(void) {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  vec2 p = aPosition * uTile.zw;
  gl_Position = vec4((mvp * vec3(p, 1.0)).xy, 0.0, 1.0);
  vP = p;
}
`;

// GLSL ES 1.0 too (PixiJS turns texture() into texture2D): no textureLod; a bias of −32 reads the top
// level, as PixiJS's TilingSprite does.
const FRAGMENT = /* glsl */ `
in vec2 vP;
out vec4 finalColor;
uniform sampler2D uTex;
uniform vec4 uA;     // the first tile's position on the screen (px), its alpha
uniform vec4 uB;     // the second's
uniform vec4 uTile;  // a tile on the screen (px), the screen (px)
uniform vec4 uFrame; // the picture in its texture (0–1)
uniform vec4 uClamp; // and half a texel in from its edges, as TilingSprite clamps (no texel from beyond it blended in)
void main(void) {
  vec2 ta = fract((vP - uA.xy) / uTile.xy);
  vec2 tb = fract((vP - uB.xy) / uTile.xy);
  vec4 a = texture(uTex, clamp(uFrame.xy + ta * uFrame.zw, uClamp.xy, uClamp.zw), -32.0) * uA.z;
  vec4 b = texture(uTex, clamp(uFrame.xy + tb * uFrame.zw, uClamp.xy, uClamp.zw), -32.0) * uB.z;
  finalColor = b + a * (1.0 - b.a);
}
`;

/** One layer's two tiles, cross-faded, in one mesh over the screen (on the stage, screen px). */
export class CloudPass {
  readonly mesh: Mesh<Geometry, Shader>;
  private readonly u: UniformGroup;
  private readonly tex: Texture;

  constructor(tex: Texture) {
    this.tex = tex;
    const src = tex.source;
    const f = tex.frame;
    this.u = new UniformGroup({
      uA: { value: new Float32Array(4), type: "vec4<f32>" },
      uB: { value: new Float32Array(4), type: "vec4<f32>" },
      uTile: { value: new Float32Array(4), type: "vec4<f32>" },
      uFrame: { value: new Float32Array([f.x / src.width, f.y / src.height, f.width / src.width, f.height / src.height]), type: "vec4<f32>" },
      uClamp: {
        value: new Float32Array([f.x / src.width + 0.5 / src.pixelWidth, f.y / src.height + 0.5 / src.pixelHeight, (f.x + f.width) / src.width - 0.5 / src.pixelWidth, (f.y + f.height) / src.height - 0.5 / src.pixelHeight]),
        type: "vec4<f32>",
      },
    });
    // highp: uTile is in both stages (their precisions must match).
    const program = GlProgram.from({ vertex: VERTEX, fragment: FRAGMENT, name: "cloud-pass", preferredFragmentPrecision: "highp" });
    const geometry = new Geometry({ attributes: { aPosition: [0, 0, 1, 0, 1, 1, 0, 1] }, indexBuffer: [0, 1, 2, 0, 2, 3] });
    this.mesh = new Mesh({ geometry, shader: new Shader({ glProgram: program, resources: { cloudUniforms: this.u, uTex: src } }) });
  }

  /**
   * This frame: the screen's size, the two tiles' positions (as the TilingSprites' tilePosition) and alphas
   * (0: not drawn), the tiles' scale (tileScale). Not drawn when neither shows.
   */
  set(w: number, h: number, a: { x: number; y: number }, alphaA: number, b: { x: number; y: number }, alphaB: number, scale: number): void {
    const u = this.u.uniforms as Record<string, Float32Array>;
    u.uA.set([a.x, a.y, alphaA, 0]);
    u.uB.set([b.x, b.y, alphaB, 0]);
    u.uTile.set([this.tex.frame.width * scale, this.tex.frame.height * scale, w, h]);
    this.u.update();
    this.mesh.visible = alphaA > 0 || alphaB > 0;
  }

  destroy(): void {
    this.mesh.destroy();
  }
}
