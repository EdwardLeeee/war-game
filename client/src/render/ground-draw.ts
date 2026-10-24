// 寫實地面 drawn (D-093, R8 item 6; art/ground.ts): one mesh over the whole map, its colour blended
// on the GPU from war-game-ui's tileable textures: grass (two kinds, mixed by a large noise), then
// the river bank, gravel and dirt where a cell's weight (one texel a cell, smoothed by the GPU's
// filtering) says, their edges frayed by a noise and moved by the textures' heights (where two
// grounds meet, the higher shows through, as ui blends them in R7). Sampled in world metres, so
// the oblique view's squash is the projection's (ui bakes the light from straight above). Under
// the fog and everything else, in the ground container (world px). Behind ?test=1&ground=real
// until the user approves ui's ground (art-v6).
//
// Quality (ceo: the iPhone first, 2796 × 1290 pixels at 3 倍): 高 samples each grass twice, at two
// scales turned apart, so a tile does not repeat at actual size; 低 once. The other grounds are
// sampled only where they show.
// The towns' ground (art-v6, R8-36 B; rules.town): a second weight map, R the lanes from the gates to
// the keep, G trampled earth (art/ground.ts TownWeights, from the castles' layouts and the buildings
// in them, world.ts), each laid over the ground after the bank and before the water, as ui's
// ground_r8.py compose does.

import { BufferImageSource, Geometry, GlProgram, Mesh, type Renderer, RenderTexture, Shader, Sprite, Texture, type TextureSource, UniformGroup } from "pixi.js";
import { type CellBox, type GroundJson, groundWater, GroundWeights, TownWeights, townGroundOn, valueNoise } from "../art/ground.ts";
import { TILE_PX } from "../tuning.ts";

export type GroundQuality = "high" | "low";

/** The textures, loaded (render/unit-art.ts): one a layer, in GROUND_LAYERS order, and the noises (made when the set has none). */
export interface GroundTextures {
  json: GroundJson;
  layers: TextureSource[];
  noise: TextureSource;
  macro: TextureSource;
  /** The water's ripples (art-v6, rules.water), or null: the terrain's water tiles. */
  water: TextureSource | null;
  /** The towns' ground's layers by id (art-v6, rules.town: `yard`), or null: no towns' ground. */
  town: Record<string, TextureSource> | null;
}

/** Metres a cell (the simulation's cells are 2 m). */
const CELL_M = 2;

const VERTEX = /* glsl */ `
in vec2 aPosition;
in vec2 aUV;
out vec2 vM;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main(void) {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vM = aUV;
}
`;

const FRAGMENT = /* glsl */ `
in vec2 vM;
out vec4 finalColor;
uniform sampler2D uWeights;
uniform sampler2D uNoise;
uniform sampler2D uMacro;
uniform sampler2D uGrass;
uniform sampler2D uGrassDry;
uniform sampler2D uDirt;
uniform sampler2D uGravel;
uniform sampler2D uBank;
uniform sampler2D uWater;
uniform sampler2D uTown;
uniform sampler2D uLane;
uniform sampler2D uTrampled;
uniform vec4 uTownA;      // on (1), edge_m, the lane's layer's tile, the trampled earth's (m)
uniform vec4 uTileA;      // grass, grass_dry, dirt, gravel (m)
uniform vec4 uTileB;      // bank, noise, macro, cells across the map
uniform vec4 uRules;      // edge_m, height_k, dirt noise threshold, quality (1 high)
uniform vec4 uDirtEdge;   // the dirt patches' edge in the noise: from, to (R8-28: noise_soft about the threshold)
uniform vec4 uGrade;      // brightness, saturation, -, -
uniform vec4 uWaterA;     // range_m (0: no water here), edge_m, wet_m, wet_dark
uniform vec4 uWaterB;     // depth_m, bed, bed_shallow, noise_m
uniform vec4 uWaterC;     // shallow (sRGB), the water layer's tile (m)
uniform vec4 uWaterFlow;  // the two ripples' drift (m/s)
uniform float uTime;      // seconds, the page's clock (the water flows while paused too)
uniform vec4 uDevA;       // contrast per layer for an unlit photo (0: lit, as ui ships them)
uniform float uDevB;
uniform vec3 uTint0;
uniform vec3 uTint1;
uniform vec3 uTint2;
uniform vec3 uTint3;
uniform vec3 uTint4;
uniform vec4 uMeanA;      // mean luminance (linear) per layer, for the unlit photos
uniform float uMeanB;

const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
// The unlit photos: their albedo times this, as R7's sun leaves it on flat ground.
const float EXPOSURE = 1.5;

// A layer's colour (sRGB) and height: lit as ui ships them (height in A), or an unlit photo recoloured to its tint.
vec4 look(vec4 t, float contrast, vec3 tint, float meanLum) {
  if (contrast <= 0.0) return t;
  vec3 lin = pow(t.rgb, vec3(2.2));
  float k = dot(lin, LUM) / meanLum;
  float c = 1.0 + contrast * (k - 1.0);
  return vec4(pow(max(tint * c * EXPOSURE, 0.0), vec3(1.0 / 2.2)), clamp(k * 0.5, 0.0, 1.0));
}

// One tile, or (high) two: the second turned and scaled, mixed by the noise, so no tile repeats.
vec4 tile(sampler2D s, vec2 m, float size, float n) {
  vec4 a = texture(s, m / size);
  if (uRules.w < 0.5) return a;
  vec2 r = mat2(0.8, -0.6, 0.6, 0.8) * m * 0.73 + vec2(17.3, 5.1);
  return mix(a, texture(s, r / size), smoothstep(0.3, 0.7, n));
}

// The layer over the base where its mask says, the edge frayed by the noise and moved by the heights.
vec4 over(vec4 base, vec4 layer, float mask, float n) {
  float e = mask * 2.0 - 1.0 + (n - 0.5) * 1.2 + (layer.a - base.a) * uRules.y;
  float f = clamp(e * (${CELL_M.toFixed(1)} / uRules.x) * 0.5 + 0.5, 0.0, 1.0);
  return mix(base, layer, f);
}

// The towns' ground over the base (ui's over_t): its edge a little less frayed than the others', edge_m soft.
vec4 overT(vec4 base, vec4 layer, float mask, float n) {
  float e = mask * 2.0 - 1.0 + (n - 0.5) * 0.8 + (layer.a - base.a) * uRules.y;
  float f = clamp(e * (${CELL_M.toFixed(1)} / uTownA.y) * 0.5 + 0.5, 0.0, 1.0);
  return mix(base, layer, f);
}

// A town's layer: one tile, or (high) a second turned and moved, mixed by the noise (ui's numbers, not tile()'s).
vec4 townTile(sampler2D s, vec2 m, float size, float n) {
  vec4 a = texture(s, m / size);
  if (uRules.w < 0.5) return a;
  vec2 r = mat2(0.8, -0.6, 0.6, 0.8) * m * 0.91 + vec2(7.3, 3.1);
  return mix(a, texture(s, r / size), smoothstep(0.35, 0.65, n));
}

void main(void) {
  vec4 w = texture(uWeights, vM / (${CELL_M.toFixed(1)} * uTileB.w));
  float n = texture(uNoise, vM / uTileB.y).r;
  float big = texture(uMacro, vM / uTileB.z).r;
  float dry = smoothstep(0.35, 0.65, big);
  vec4 g = look(tile(uGrass, vM, uTileA.x, n), uDevA.x, uTint0, uMeanA.x);
  vec4 gd = look(tile(uGrassDry, vM, uTileA.y, 1.0 - n), uDevA.y, uTint1, uMeanA.y);
  vec4 c = mix(g, gd, dry);
  // Dirt round the resource points, and in patches where a slower noise is over the threshold.
  float patchN = texture(uNoise, vM / (uTileB.y * 12.0) + 0.31).r;
  float dirt = max(w.b, smoothstep(uDirtEdge.x, uDirtEdge.y, patchN));
  if (dirt > 0.01) c = over(c, look(texture(uDirt, vM / uTileA.z), uDevA.z, uTint2, uMeanA.z), dirt, n);
  if (w.g > 0.01) c = over(c, look(texture(uGravel, vM / uTileA.w), uDevA.w, uTint3, uMeanA.w), w.g, n);
  if (w.r > 0.01) c = over(c, look(texture(uBank, vM / uTileB.x), uDevB, uTint4, uMeanB), w.r, n);
  // The towns' lanes and trampled earth (art-v6, rules.town).
  if (uTownA.x > 0.5) {
    vec4 t = texture(uTown, vM / (${CELL_M.toFixed(1)} * uTileB.w));
    if (t.r > 0.01) c = overT(c, townTile(uLane, vM, uTownA.z, n), t.r, n);
    if (t.g > 0.01) c = overT(c, townTile(uTrampled, vM, uTownA.w, n), t.g, n);
  }
  // The water (art-v6, ui's ground_r8.py compose): A the signed distance to its edge (metres, in the
  // water +); the bank wet a little way out; inside, the ripples drifting, the bed in the shallows.
  if (uWaterA.x > 0.0) {
    float sd = (w.a - 0.5) * 2.0 * uWaterA.x + (n - 0.5) * 2.0 * uWaterB.w;
    c.rgb *= 1.0 - (1.0 - uWaterA.w) * smoothstep(-uWaterA.z, 0.0, sd);
    float inside = smoothstep(-uWaterA.y, uWaterA.y, sd);
    if (inside > 0.001) {
      vec3 ripple = texture(uWater, (vM + uWaterFlow.xy * uTime) / uWaterC.w).rgb;
      if (uRules.w > 0.5) {
        vec2 r = vec2(0.8 * vM.x - 0.6 * vM.y, 0.6 * vM.x + 0.8 * vM.y) * 1.3 + uWaterFlow.zw * uTime;
        ripple = 0.5 * (ripple + texture(uWater, r / uWaterC.w).rgb);
      }
      float depth = smoothstep(0.0, uWaterB.x, sd);
      vec3 under = (c.rgb * uWaterB.y + uWaterC.rgb) * 0.5;
      float op = uRules.w > 0.5 ? uWaterB.z + (1.0 - uWaterB.z) * depth : 1.0;
      c.rgb = mix(c.rgb, mix(under, ripple, op), inside);
    }
  }
  vec3 col = c.rgb * (0.9 + 0.2 * big) * uGrade.x;
  col = mix(vec3(dot(col, LUM)), col, uGrade.y);
  finalColor = vec4(col, 1.0);
}
`;

/** linear → sRGB, as ui's compose converts `shallow` (the shader blends in sRGB, as the textures come). */
const toSrgb = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

/** The water's uniforms (rules.water; absent, range 0: the shader draws no water). */
function waterUniforms(w: GroundJson["rules"]["water"], tileM: number): Record<string, { value: Float32Array | number; type: string }> {
  return {
    uWaterA: { value: new Float32Array(w === undefined ? [0, 0, 0, 1] : [w.range_m, w.edge_m, w.wet_m, w.wet_dark]), type: "vec4<f32>" },
    uWaterB: { value: new Float32Array(w === undefined ? [1, 0, 0, 0] : [w.depth_m, w.bed, w.bed_shallow, w.noise_m]), type: "vec4<f32>" },
    uWaterC: { value: new Float32Array(w === undefined ? [0, 0, 0, tileM] : [...w.shallow.map(toSrgb), tileM]), type: "vec4<f32>" },
    uWaterFlow: { value: new Float32Array(w === undefined ? [0, 0, 0, 0] : [w.flow[0][0], w.flow[0][1], w.flow[1][0], w.flow[1][1]]), type: "vec4<f32>" },
    uTime: { value: 0, type: "f32" },
  };
}

/** Bytes a texture takes on the GPU: ASTC 4×4 a byte a pixel, else four; a third more with its mipmaps. */
function gpuBytes(s: TextureSource): number {
  const px = s.pixelWidth * s.pixelHeight * (String(s.format).startsWith("astc") ? 1 : 4);
  return Math.round(s.autoGenerateMipmaps || s.mipLevelCount > 1 ? (px * 4) / 3 : px);
}

export class GroundDraw {
  readonly mesh: Mesh<Geometry, Shader>;
  private readonly textures: GroundTextures;
  private readonly uniforms: UniformGroup;
  private readonly weights: BufferImageSource;
  /** The weight map (art/ground.ts), made again only near the seeds that change. */
  private readonly weightMap: GroundWeights;
  private quality: GroundQuality;
  /** The shader draws the water (art-v6): the terrain's water tiles are not drawn. */
  readonly water: boolean;
  /** The towns' ground (art-v6, rules.town): its weight map, or null. */
  private readonly townMap: TownWeights | null;
  private readonly townWeights: BufferImageSource | null;

  /** `culture`: whose layers the towns' ground takes (rules.town.layers; both `yard` in art-v6), the player's. */
  constructor(textures: GroundTextures, n: number, quality: GroundQuality, culture: "E" | "W" = "E") {
    this.textures = textures;
    this.quality = quality;
    const size = n * TILE_PX;
    const metres = n * CELL_M;
    const geometry = new Geometry({
      attributes: {
        aPosition: [0, 0, size, 0, size, size, 0, size],
        aUV: [0, 0, metres, 0, metres, metres, 0, metres],
      },
      indexBuffer: [0, 1, 2, 0, 2, 3],
    });
    // Data, not a picture: A (unused, 0) must not be multiplied into the weights as they go up.
    // rules.weights (R8-28): several texels a cell; the shader's coordinates are the map's, whatever the size.
    // The water's signed distance in A when the shader draws the water (art-v6).
    this.water = textures.water !== null && groundWater(textures.json);
    this.weightMap = new GroundWeights(n, textures.json.rules, this.water);
    const side = this.weightMap.side;
    this.weights = new BufferImageSource({ resource: this.weightMap.data, width: side, height: side, format: "rgba8unorm", scaleMode: "linear", addressMode: "clamp-to-edge", alphaMode: "no-premultiply-alpha" });
    const by = (id: string) => textures.json.layers.find((l) => l.id === id);
    const tileOf = (id: string) => by(id)?.tile_m ?? 8;
    const dev = (id: string) => by(id)?.contrast ?? (by(id)?.tint === undefined ? 0 : 0.55);
    const tint = (id: string) => new Float32Array(by(id)?.tint ?? [1, 1, 1]);
    const meanLum = (id: string) => {
      const m = by(id)?.mean ?? [0.2, 0.2, 0.2];
      return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
    };
    const r = textures.json.rules;
    // The towns' ground: its weight map and its two layers (by the player's culture), when the set has them.
    const townLayers = r.town?.layers[culture];
    const lane = townLayers === undefined ? undefined : textures.town?.[townLayers.lane];
    const trampled = townLayers === undefined ? undefined : textures.town?.[townLayers.trampled];
    const town = townGroundOn(textures.json) && lane !== undefined && trampled !== undefined;
    this.townMap = town ? new TownWeights(n, r) : null;
    this.townWeights = this.townMap === null ? null : new BufferImageSource({ resource: this.townMap.data, width: this.townMap.side, height: this.townMap.side, format: "rgba8unorm", scaleMode: "linear", addressMode: "clamp-to-edge", alphaMode: "no-premultiply-alpha" });
    this.uniforms = new UniformGroup({
      uTownA: { value: new Float32Array([town ? 1 : 0, r.town?.edge_m ?? 0.45, tileOf(townLayers?.lane ?? ""), tileOf(townLayers?.trampled ?? "")]), type: "vec4<f32>" },
      uTileA: { value: new Float32Array([tileOf("grass"), tileOf("grass_dry"), tileOf("dirt"), tileOf("gravel")]), type: "vec4<f32>" },
      uTileB: { value: new Float32Array([tileOf("bank"), textures.json.noise?.tile_m ?? 6, textures.json.macro?.tile_m ?? 64, n]), type: "vec4<f32>" },
      uRules: { value: new Float32Array([r.edge_m, r.height_k, r.dirt.noise_threshold, quality === "high" ? 1 : 0]), type: "vec4<f32>" },
      // The dirt patches' edge: noise_soft wide about the threshold (R8-28), else 0.06 from it up.
      uDirtEdge: {
        value: new Float32Array(r.dirt.noise_soft === undefined ? [r.dirt.noise_threshold, r.dirt.noise_threshold + 0.06, 0, 0] : [r.dirt.noise_threshold - r.dirt.noise_soft / 2, r.dirt.noise_threshold + r.dirt.noise_soft / 2, 0, 0]),
        type: "vec4<f32>",
      },
      uGrade: { value: new Float32Array([textures.json.grade.brightness, textures.json.grade.saturation, 0, 0]), type: "vec4<f32>" },
      uDevA: { value: new Float32Array([dev("grass"), dev("grass_dry"), dev("dirt"), dev("gravel")]), type: "vec4<f32>" },
      uDevB: { value: dev("bank"), type: "f32" },
      uTint0: { value: tint("grass"), type: "vec3<f32>" },
      uTint1: { value: tint("grass_dry"), type: "vec3<f32>" },
      uTint2: { value: tint("dirt"), type: "vec3<f32>" },
      uTint3: { value: tint("gravel"), type: "vec3<f32>" },
      uTint4: { value: tint("bank"), type: "vec3<f32>" },
      uMeanA: { value: new Float32Array([meanLum("grass"), meanLum("grass_dry"), meanLum("dirt"), meanLum("gravel")]), type: "vec4<f32>" },
      uMeanB: { value: meanLum("bank"), type: "f32" },
      ...waterUniforms(this.water ? r.water : undefined, by("water")?.tile_m ?? 4),
    });
    const [grass, grassDry, dirt, gravel, bank] = textures.layers;
    const shader = new Shader({
      // highp: the ground's coordinates are metres across the whole map (up to 256): at PixiJS's
      // default mediump (16-bit) they step every 3–6 cm there, and the textures came out in blocks
      // at 3 倍 (ceo 2026-10-23, R8-29-02's grass). Apple's GPUs run fragment shaders at 32 bits anyway.
      glProgram: GlProgram.from({ vertex: VERTEX, fragment: FRAGMENT, name: "ground", preferredFragmentPrecision: "highp" }),
      resources: {
        groundUniforms: this.uniforms,
        uWeights: this.weights,
        uNoise: textures.noise,
        uMacro: textures.macro,
        uGrass: grass,
        uGrassDry: grassDry,
        uDirt: dirt,
        uGravel: gravel,
        uBank: bank,
        // Without water any texture will do: the shader does not read it then; the towns' ground the same.
        uWater: textures.water ?? textures.noise,
        uTown: this.townWeights ?? this.weights,
        uLane: (town ? lane : undefined) ?? textures.noise,
        uTrampled: (town ? trampled : undefined) ?? textures.noise,
      },
    });
    this.mesh = new Mesh({ geometry, shader });
  }

  /** The cells' grounds again (a random map's grows as it is explored; resource points come and go). */
  setGround(ground: Uint8Array, nodes: readonly number[]): void {
    if (this.weightMap.set(ground, nodes)) this.weights.update();
  }

  /** The towns' ground drawn (art-v6, rules.town). */
  get town(): boolean {
    return this.townMap !== null;
  }

  /** The towns' lanes and trampled earth now, a strength a cell, in these towns' boxes (world.ts): uploaded when they changed. */
  setTown(lane: Float32Array, trampled: Float32Array, boxes: readonly CellBox[]): void {
    if (this.townMap?.set(lane, trampled, boxes) === true) this.townWeights?.update();
  }

  /** The water's flow, every frame: the page's clock in seconds (wrapped an hour round, for the GPU's precision). */
  tick(seconds: number): void {
    if (!this.water) return;
    this.uniforms.uniforms.uTime = seconds % 3600;
    this.uniforms.update();
  }

  setQuality(q: GroundQuality): void {
    this.quality = q;
    (this.uniforms.uniforms.uRules as Float32Array)[3] = q === "high" ? 1 : 0;
    this.uniforms.update();
  }

  get currentQuality(): GroundQuality {
    return this.quality;
  }

  /** The ground's textures on the GPU (MB): the five grounds, the noises and the cells' weights. */
  get memoryMB(): number {
    const t = this.textures;
    const bytes = [...t.layers, t.noise, t.macro, this.weights, ...(this.townWeights === null ? [] : [this.townWeights, ...Object.values(t.town ?? {})])].reduce((n, s) => n + gpuBytes(s), 0);
    return bytes / 1048576;
  }

  /**
   * The GPU's time for the ground over a `w` × `h` pixel screen (ms a frame): `frames` draws of a
   * stretch of the map 22 cells across into a texture that size, waited for (readPixels) before
   * and after; at each quality, and a plain textured quad of the same size (the least any ground
   * costs). The 量測 panel (ceo 2026-10-21: the iPhone's numbers, to compare).
   */
  measure(renderer: Renderer, w: number, h: number, frames = 20): { high: number; low: number; plain: number } {
    const target = RenderTexture.create({ width: w, height: h });
    const gl = "gl" in renderer ? (renderer.gl as WebGL2RenderingContext) : null;
    const px = new Uint8Array(4);
    const wait = () => {
      gl?.finish();
      gl?.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    };
    const across = (22 * TILE_PX) / w;
    const quad = new Mesh({ geometry: this.mesh.geometry, shader: this.mesh.shader });
    quad.scale.set(1 / across, 0.5 / across);
    const plain = new Sprite(new Texture({ source: this.textures.layers[0] }));
    plain.width = w;
    plain.height = h;
    const time = (draw: () => void): number => {
      draw();
      wait();
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) draw();
      wait();
      return (performance.now() - t0) / frames;
    };
    const was = this.quality;
    this.setQuality("high");
    const high = time(() => renderer.render({ container: quad, target }));
    this.setQuality("low");
    const low = time(() => renderer.render({ container: quad, target }));
    this.setQuality(was);
    const flat = time(() => renderer.render({ container: plain, target }));
    quad.destroy();
    plain.destroy();
    target.destroy(true);
    return { high, low, plain: flat };
  }

  destroy(): void {
    this.mesh.destroy();
    this.weights.destroy();
    this.townWeights?.destroy();
  }
}

/** A tileable grey noise as a texture (the sets without one; the test set): `size` square, `cells` a side. */
export function noiseTexture(size: number, cells: number, seed: number): TextureSource {
  const v = valueNoise(size, cells, seed);
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < v.length; i++) rgba.set([v[i], v[i], v[i], 255], i * 4);
  return new BufferImageSource({ resource: rgba, width: size, height: size, format: "rgba8unorm", scaleMode: "linear", addressMode: "repeat", autoGenerateMipmaps: true, mipmapFilter: "linear", alphaMode: "no-premultiply-alpha" });
}

/** A loaded picture as a tileable texture: repeated, mipmapped (it is seen small when the camera pulls back). */
export function tileTexture(t: Texture): TextureSource {
  const s = t.source;
  s.style.addressMode = "repeat";
  s.style.scaleMode = "linear";
  s.style.mipmapFilter = "linear";
  s.autoGenerateMipmaps = true;
  s.updateMipmaps();
  return s;
}
