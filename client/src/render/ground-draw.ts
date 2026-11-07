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
// R9 (art-v7 on, ground.json `relief` and `water.version` "r9"; ui's design/r9/common/ground_r9.py
// compose()): art-v6's layers as before, without its grade, then in linear colour the relief (the sun
// on worn ground, sampled twice turned apart), the rills baring the soil, the crowns drying the grass,
// greener near the water, wind swaths, and the film curve (ACES) over it all; with its ripples, its
// banks (the far bank's earth face, the wet line, sand and gravel bars) and its water (coloured by its
// depth over the bed, the current's ripples, the sky by Fresnel, the far bank mirrored, glints, a
// ford's riffles) instead of art-v6's, all from the shoreline's signed distance (sdAt: the weights'
// water distance made to wander by ui's noises; ground.ts WaterAux: fords, bridges, the current).
// 地面快取 (ground-cache.ts; ceo b2 2026-11-07): only the water moves with time, so the land can be drawn
// once into a picture of the screen and the water over it every frame: the same program with uPass 1
// (`waterShader`) keeps only the pixels the clock reaches and draws them as the whole ground would.

import { BufferImageSource, Geometry, GlProgram, Mesh, type Renderer, RenderTexture, Shader, Sprite, Texture, type TextureSource, UniformGroup } from "pixi.js";
import { type CellBox, type GroundJson, groundR9, groundWater, GroundWeights, TownWeights, townGroundOn, valueNoise, WaterAux } from "../art/ground.ts";
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
  /** R9's relief (art-v7 on, ground.json `relief`), or null: art-v6's ground. */
  relief?: TextureSource | null;
  /** R9's ripples (ground.json `ripple`), or null: art-v6's water. */
  ripple?: TextureSource | null;
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
uniform vec4 uEdge;       // 浮空大陸 (edge.ts): metres over which the two lower edges fade out (0: none), the map's side (m)
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
uniform sampler2D uRelief; // R9: light / 2, rills, crowns
uniform sampler2D uNoise4; // R9: ui's noises (ground_r9.py): R _NZ, G _SHORE, B _FOAM, A tsample's mix
uniform vec4 uR9A;        // on (1), rill_soil, crown_dry, lush_m
uniform vec4 uR9B;        // swath, exposure, the relief's tile (m), its mixing noise's (m)
uniform vec4 uR9Turn;     // the relief's second sample: turned (row-major 2 × 2)
uniform vec4 uR9Move;     // and moved (m); the mix's smoothstep from, to
uniform sampler2D uWaterAux; // R9's water: R the fords, G the bridges (blurred), BA the current (0.5 + v / 2)
uniform vec4 uR9W;        // R9's water on (1), bank_m, bank_h, wet_m
uniform vec4 uR9S;        // shore_m (long bays, bites), edge_depth, depth_k
uniform vec4 uR9D;        // depth_max, ford_depth, sky_k, foam
uniform vec4 uR9G;        // glint, the ripples' tile (m), height_scale, slope_scale
uniform vec3 uR9Absorb;   // per metre (linear)
uniform vec3 uR9Scatter;
uniform vec3 uR9Bed;
uniform vec3 uR9SkyLo;
uniform vec3 uR9SkyHi;
uniform vec3 uR9Sun;      // towards the sun, the ground's axes (x east, y south, z up)
uniform vec3 uR9View;     // from the camera
uniform vec3 uR9SunRgb;
uniform float uPass;      // 地面快取: 1 draws only what moves with time (the water), the land being the cache's

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

// smoothstep for edges either way round (R9's often fall: GLSL's own is undefined when edge0 >= edge1).
float ss(float e0, float e1, float x) {
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// sRGB to linear and back (ui's to_lin, to_srgb), and Narkowicz's fit of the ACES film curve.
vec3 toLin(vec3 c) {
  return mix(c / 12.92, pow((max(c, 0.0) + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
vec3 aces(vec3 x) {
  return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

// R9's relief at m metres (ui's tsample): light, rills, crowns; (high) twice, the second turned and
// moved, mixed by a slow noise, so that it never repeats on screen.
vec3 relief(vec2 m) {
  vec3 a = texture(uRelief, m / uR9B.z).rgb;
  if (uRules.w > 0.5) {
    vec2 r = vec2(uR9Turn.x * m.x + uR9Turn.y * m.y, uR9Turn.z * m.x + uR9Turn.w * m.y) + uR9Move.xy;
    float k = smoothstep(uR9Move.z, uR9Move.w, texture(uNoise4, m / uR9B.w).a);
    a = mix(a, texture(uRelief, r / uR9B.z).rgb, k);
  }
  return vec3(a.r * 2.0, a.g, a.b);
}

// R9's shoreline at m: metres into the water (+) or out of it (−): the weights' water distance and
// the edges' noise, a ford water too (shallow), then made to wander (long bays, broken up, bites),
// held still by the bridges (ui's sd_at).
float sdAt(vec2 m) {
  vec2 uv = m / (${CELL_M.toFixed(1)} * uTileB.w);
  float sd = (texture(uWeights, uv).a - 0.5) * 2.0 * uWaterA.x + (texture(uNoise4, m / 6.0).r - 0.5) * 2.0 * uWaterB.w;
  vec2 aux = texture(uWaterAux, uv).rg;
  sd = max(sd, (aux.r - 0.5) * 4.0);
  float big = texture(uNoise4, m / 40.0).g;
  float mid = texture(uNoise4, m / 17.0 + vec2(0.41, 0.13)).g;
  float small = texture(uNoise4, m / 8.0 + vec2(0.3, 0.7)).g;
  float brv = clamp(aux.g * 2.0, 0.0, 1.0);
  return sd - 0.9 * brv + (1.0 - 0.9 * brv) * ((big - 0.5) * 2.0 * uR9S.x + (mid - 0.5) * uR9S.x + (small - 0.5) * 2.0 * uR9S.y);
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
  // 地面快取's water pass: the pixels uTime reaches (R9's water past its line, art-v6's inside it) are drawn
  // below exactly as the whole ground's; the rest are the cache's.
  if (uPass > 0.5) {
    if (uR9A.x > 0.5 && uR9W.x > 0.5) {
      if (sdAt(vM) <= -0.05) discard;
    } else if (uWaterA.x > 0.0) {
      float sd0 = (w.a - 0.5) * 2.0 * uWaterA.x + (n - 0.5) * 2.0 * uWaterB.w;
      if (smoothstep(-uWaterA.y, uWaterA.y, sd0) <= 0.001) discard;
    } else {
      discard;
    }
  }
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
  if (uWaterA.x > 0.0 && uR9W.x < 0.5) {
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
  vec3 col = c.rgb * (0.9 + 0.2 * big);
  if (uR9A.x > 0.5) {
    // R9 (ui's ground_r9.py compose, in linear colour); ground.json's grade is art-v6's.
    vec3 lin = toLin(col);
    vec3 rl = relief(vM);
    float light = rl.x;
    bool wtr = uR9W.x > 0.5;
    // The shoreline: R9's (its banks and water drawn near it only: 2 m out covers them all); else
    // art-v6's water distance (its water drawn already).
    float sd = -1000.0;
    vec2 grad = vec2(0.0);
    vec4 aux = vec4(0.0, 0.0, 1.0, 0.5);
    float far = 0.0;
    float ford = 0.0;
    if (wtr) {
      sd = sdAt(vM);
      if (sd > -2.0) {
        grad = vec2(sdAt(vM + vec2(0.05, 0.0)) - sd, sdAt(vM + vec2(0.0, 0.05)) - sd) / 0.05;
        aux = texture(uWaterAux, vM / (${CELL_M.toFixed(1)} * uTileB.w));
        ford = ss(0.35, 0.65, aux.r + (texture(uNoise4, vM / 8.0 + vec2(0.6, 0.2)).g - 0.5) * 0.5);
        // The far bank (the water lies towards the camera from it).
        far = clamp(-(grad.x * uR9View.x + grad.y * uR9View.y) / ((length(grad) + 1e-6) * length(uR9View.xy)), 0.0, 1.0);
      }
    } else if (uWaterA.x > 0.0) {
      sd = (w.a - 0.5) * 2.0 * uWaterA.x + (n - 0.5) * 2.0 * uWaterB.w;
    }
    float land = ss(0.3, -0.6, sd);
    vec3 soil = toLin(look(texture(uDirt, vM / uTileA.z), uDevA.z, uTint2, uMeanA.z).rgb) * 0.7;
    lin = mix(lin, soil, uR9A.y * rl.y * land);
    float lum = (lin.r + lin.g + lin.b) / 3.0;
    lin += (lum * vec3(1.25, 1.1, 0.7) - lin) * (uR9A.z * rl.z * land);
    lin *= 1.0 + vec3(-0.08, 0.05, -0.1) * (ss(-uR9A.w, -1.5, sd) * land);
    // Wind swaths: long soft patches drawn out one way.
    float sw = texture(uNoise4, vec2((0.94 * vM.x + 0.34 * vM.y) / 30.0, (-0.34 * vM.x + 0.94 * vM.y) / 9.0)).g;
    lin *= 1.0 + uR9B.x * (sw - 0.5) * 2.0 * land;
    float tuft = texture(uNoise4, vM / 3.0 + vec2(0.5, 0.0)).b;
    if (wtr && sd > -2.0) {
      // The banks: the land falls into the channel; the far bank turns its earth face to the camera,
      // in shade, streaked down, its grass edge lit on top.
      float tb = clamp((sd + uR9W.y) / uR9W.y, 0.0, 1.0);
      float kb = sd < 0.3 ? uR9W.z * 6.0 * tb * (1.0 - tb) / uR9W.y : 0.0;
      vec3 nb = normalize(vec3(kb * grad, 1.0));
      light *= (3.0 * max(dot(nb, uR9Sun), 0.0) + 0.9 * (0.5 + 0.5 * nb.z)) / (3.0 * uR9Sun.z + 0.9);
      vec3 earth = toLin(look(texture(uBank, vM / uTileB.x), uDevB, uTint4, uMeanB).rgb);
      float fw = 1.1 * ss(0.3, 0.75, texture(uNoise4, vM / 22.0 + vec2(0.7, 0.4)).g);
      float face = ss(-fw - 0.03, -fw + 0.03, sd) * ss(0.1, -0.05, sd) * far;
      face *= 1.0 - ss(0.58, 0.68, tuft) * ss(-fw + 0.4, -fw, sd);
      float streak = 0.75 + 0.5 * texture(uNoise4, vec2(vM.x / 0.6 + 0.2, vM.y / 6.0 + 0.1)).b;
      lin = lin * (1.0 - face * 0.9) + earth * (0.72 * streak) * face * 0.9;
      float edge = ss(-fw - 0.1, -fw - 0.02, sd) * (1.0 - ss(-fw - 0.02, -fw + 0.02, sd)) * far;
      lin *= 1.0 + 0.18 * edge;
    }
    // The light (with art-v6's water, on the land only: that water is drawn already).
    lin *= wtr ? light : mix(1.0, light, land);
    if (wtr && sd > -2.0) {
      // Wet ground above the waterline, the thin wet line, sand and gravel bars on the shore.
      lin *= 1.0 - 0.35 * ss(-uR9W.w, -0.05, sd);
      float mw = 0.03 + 0.06 * texture(uNoise4, vM / 6.0 + vec2(0.35, 0.65)).g + 0.12 * far;
      lin *= 1.0 - (0.3 - 0.1 * far) * ss(-mw - 0.03, -mw, sd);
      vec3 grav = toLin(look(texture(uGravel, vM / uTileA.w), uDevA.w, uTint3, uMeanA.w).rgb);
      float sand = ss(0.6, 0.7, texture(uNoise4, vM / 9.0 + vec2(0.8, 0.25)).g) * ss(-0.7, -0.35, sd) * ss(0.0, -0.1, sd) * (1.0 - far);
      lin = lin * (1.0 - 0.6 * sand) + grav * 0.95 * (0.6 * sand) * light;
      float bar = ss(0.62, 0.72, texture(uNoise4, vM / 14.0 + vec2(0.2, 0.6)).g) * ss(-0.7, -0.2, sd) * ss(0.35, 0.0, sd) * (0.15 + 0.85 * far);
      lin = lin * (1.0 - bar) + grav * 0.85 * light * bar;
      if (sd > -0.05) {
        // The water: grass tufts hang over the line in places, the bars stand out of it.
        float tuft2 = texture(uNoise4, vM / 6.0 + vec2(0.2, 0.9)).g * 0.6 + tuft * 0.4;
        float overhang = ss(0.62, 0.7, tuft2) * ss(0.3, 0.02, sd) * (1.0 - far);
        float inside = ss(-0.02, 0.04, sd) * (1.0 - overhang) * (1.0 - bar * ss(0.3, 0.0, sd));
        float depth = clamp(uR9S.z + sd * uR9S.w, 0.0, uR9D.x) * (1.0 - ford) + clamp(sd * uR9S.w, 0.0, uR9D.y) * ford;
        // The far bank's shadow on the water below it (the sun behind it): fading over about a metre.
        vec2 su = normalize(uR9Sun.xy);
        float occ = uRules.w > 0.5
          ? 0.3 * ss(0.1, -0.2, sdAt(vM + su * 0.2)) + 0.25 * ss(0.1, -0.2, sdAt(vM + su * 0.4)) + 0.2 * ss(0.1, -0.2, sdAt(vM + su * 0.6))
            + 0.15 * ss(0.1, -0.2, sdAt(vM + su * 0.85)) + 0.1 * ss(0.1, -0.2, sdAt(vM + su * 1.1))
          : 0.55 * ss(0.1, -0.2, sdAt(vM + su * 0.3)) + 0.45 * ss(0.1, -0.2, sdAt(vM + su * 0.8));
        float shade = 1.0 - 0.55 * occ * inside;
        vec3 bed = uR9Bed * (0.8 + 0.4 * texture(uNoise4, vM / 5.0 + vec2(0.4, 0.1)).g) * shade;
        bed = mix(bed, grav * 0.55, ford);
        float pb = ss(0.6, 0.08, sd) * (1.0 - far);
        bed = bed * (1.0 - 0.6 * pb) + grav * 0.5 * (0.6 * pb);
        vec3 tr = exp(-uR9Absorb * depth * 2.0);
        vec3 under = bed * tr + uR9Scatter * shade * (1.0 - tr);
        // The current along the channel; the ripples round, drifting with it.
        vec2 f = aux.ba * 2.0 - 1.0;
        float fl = length(f);
        f = fl > 1e-4 ? f / fl : vec2(1.0, 0.0);
        float u = dot(vM, f);
        float v = -vM.x * f.y + vM.y * f.x;
        vec3 rt = (texture(uWater, (vM - 0.6 * uTime * f) / uR9G.y).rgb - 0.5) * 2.0 * vec3(uR9G.z, uR9G.w, uR9G.w);
        float wob = (texture(uNoise4, vM / 40.0).g - 0.5) * 2.0 * uR9S.x;
        float lx = texture(uNoise4, vec2(vM.x / 14.0 + 0.11, (vM.y + wob) / 1.8 + 0.37)).g;
        float ly = texture(uNoise4, vec2((vM.x + wob) / 1.8 + 0.53, vM.y / 14.0 + 0.71)).g;
        float lane = ss(0.3, 0.7, lx * f.x * f.x + ly * f.y * f.y);
        float rough = (0.0042 + 0.0066 * ford) * (0.35 + lane * (1.0 - ford) + ford);
        vec3 nw = normalize(vec3(-rt.y * rough, -rt.z * rough, 1.0));
        float dn = dot(nw, uR9View);
        vec3 refl = uR9View - 2.0 * dn * nw;
        float fres = (0.02 + 0.98 * pow(1.0 - clamp(-dn, 0.0, 1.0), 5.0)) * uR9D.z;
        vec3 sky = mix(uR9SkyLo, uR9SkyHi, clamp(refl.z, 0.0, 1.0));
        float bx = texture(uNoise4, vec2(vM.x / 16.0 + 0.3, vM.y / 2.5 + 0.8)).g;
        float by = texture(uNoise4, vec2(vM.x / 2.5 + 0.6, vM.y / 16.0 + 0.2)).g;
        sky *= (0.7 + 0.6 * (bx * f.x * f.x + by * f.y * f.y)) * (1.0 + 0.25 * (1.0 - lane));
        // The far bank mirrored just below it, broken by the ripples, fading over 1.5 m.
        vec2 vv = normalize(uR9View.xy);
        vec2 jit = rt.yz * 0.012;
        float seen = uRules.w > 0.5
          ? 0.3 * ss(0.1, -0.3, sdAt(vM + vv * 0.3 + jit)) + 0.25 * ss(0.1, -0.3, sdAt(vM + vv * 0.6 + jit)) + 0.2 * ss(0.1, -0.3, sdAt(vM + vv * 0.9 + jit))
            + 0.15 * ss(0.1, -0.3, sdAt(vM + vv * 1.2 + jit)) + 0.1 * ss(0.1, -0.3, sdAt(vM + vv * 1.5 + jit))
          : 0.55 * ss(0.1, -0.3, sdAt(vM + vv * 0.45 + jit)) + 0.45 * ss(0.1, -0.3, sdAt(vM + vv * 1.1 + jit));
        sky = sky * (1.0 - 0.85 * seen) + vec3(0.035, 0.045, 0.025) * seen;
        // The sun's glints, and fine sparkles on the ripples' crests where they are strongest.
        float glr = pow(clamp(dot(refl, uR9Sun), 0.0, 1.0), 60.0);
        float spark = ss(0.78, 0.86, texture(uNoise4, vec2(vM.x / 2.5 + 0.1, vM.y / 1.5 + 0.3)).b);
        float fine = texture(uNoise4, vec2(vM.x / 0.28 + 0.45, vM.y / 0.2 + 0.15)).b;
        float crest = ss(0.9, 0.98, fine) * ss(0.8, 2.0, rt.x) * lane * ss(0.3, 0.9, sd)
          * (0.3 + 0.7 * texture(uNoise4, vec2(vM.x / 0.9 + 0.2, vM.y / 0.7 + 0.6)).b) * (0.5 + 0.5 * far);
        vec3 surf = under * (1.0 - fres) + sky * fres + uR9SunRgb * ((glr * spark + crest) * (1.0 - ford) * uR9G.x);
        surf *= 1.0 - 0.22 * ss(0.5, 1.6, sd) * vec3(1.0, 0.94, 1.02);
        // A ford's riffles across the current.
        float fn = texture(uNoise4, vec2((u - 0.4 * uTime) / 1.1, v / 5.0)).b * 0.7 + texture(uNoise4, vec2(u / 0.5 + 0.3, v / 2.0)).b * 0.3;
        float froth = clamp(ford * ss(0.56, 0.74, fn) * inside, 0.0, 1.0) * uR9D.w * 1.3;
        surf = surf * (1.0 - froth) + vec3(0.7, 0.72, 0.7) * froth;
        // Under the near bank's lip darker; warm see-through shallows in patches along the banks.
        surf *= 1.0 - 0.3 * (1.0 - far) * ss(0.35, 0.0, sd);
        float spots = ss(0.35, 0.65, texture(uNoise4, vM / 5.0 + vec2(0.27, 0.61)).g);
        float shk = ss(0.3, 0.03, sd) * (1.0 - ford) * (0.25 + 0.75 * spots) * (0.5 + 0.5 * (1.0 - far));
        surf = surf * (1.0 - 0.6 * shk) + vec3(0.075, 0.062, 0.032) * (0.6 * shk);
        lin = mix(lin, surf, inside);
      }
    }
    col = toSrgb(aces(lin * uR9B.y));
  } else {
    col *= uGrade.x;
    col = mix(vec3(dot(col, LUM)), col, uGrade.y);
  }
  // The two lower edges fade onto the cliff's lip under them (edge.ts): ui paints its grass a metre in.
  float a = uEdge.x > 0.0 ? smoothstep(0.0, uEdge.x, uEdge.y - vM.y) * smoothstep(0.0, uEdge.x, uEdge.y - vM.x) : 1.0;
  finalColor = vec4(col * a, a);
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

/** R9's uniforms (ground.json `relief`, `water`); null: off. */
function r9Uniforms(g: GroundJson | null): Record<string, { value: Float32Array; type: string }> {
  const w = g?.water;
  const rl = g?.relief;
  const on = w !== undefined && rl !== undefined;
  const t = rl?.second.turn ?? [[1, 0], [0, 1]];
  return {
    uR9A: { value: new Float32Array(on ? [1, w.rill_soil, w.crown_dry, w.lush_m] : [0, 0, 0, 1]), type: "vec4<f32>" },
    uR9B: { value: new Float32Array(on ? [w.swath, w.exposure, rl.tile_m, rl.second.mix_noise_m] : [0, 1, 16, 40]), type: "vec4<f32>" },
    uR9Turn: { value: new Float32Array([t[0][0], t[0][1], t[1][0], t[1][1]]), type: "vec4<f32>" },
    uR9Move: { value: new Float32Array([...(rl?.second.move_m ?? [0, 0]), ...(rl?.second.mix ?? [0.25, 0.75])]), type: "vec4<f32>" },
  };
}

/** R9's water's uniforms (ground.json `water`, `ripple`); null: off. */
function r9WaterUniforms(g: GroundJson | null): Record<string, { value: Float32Array; type: string }> {
  const w = g?.water;
  const rp = g?.ripple;
  const on = w !== undefined && rp !== undefined;
  const v3 = (v: readonly number[] | undefined, d: number[]) => ({ value: new Float32Array(v ?? d), type: "vec3<f32>" });
  return {
    uR9W: { value: new Float32Array(on ? [1, w.bank_m, w.bank_h, w.wet_m] : [0, 1, 0, 1]), type: "vec4<f32>" },
    uR9S: { value: new Float32Array(on ? [w.shore_m[0], w.shore_m[1], w.edge_depth, w.depth_k] : [0, 0, 0, 0]), type: "vec4<f32>" },
    uR9D: { value: new Float32Array(on ? [w.depth_max, w.ford_depth, w.sky_k, w.foam] : [0, 0, 0, 0]), type: "vec4<f32>" },
    uR9G: { value: new Float32Array(on ? [w.glint, rp.tile_m, rp.height_scale, rp.slope_scale] : [0, 4, 1, 1]), type: "vec4<f32>" },
    uR9Absorb: v3(w?.absorb, [1, 1, 1]),
    uR9Scatter: v3(w?.scatter, [0, 0, 0]),
    uR9Bed: v3(w?.bed, [0, 0, 0]),
    uR9SkyLo: v3(w?.sky_lo, [0, 0, 0]),
    uR9SkyHi: v3(w?.sky_hi, [0, 0, 0]),
    uR9Sun: v3(w?.sun, [0, -0.53, 0.848]),
    uR9View: v3(w?.view, [0.61237, -0.61237, -0.5]),
    uR9SunRgb: v3(w?.sun_rgb, [1, 1, 1]),
  };
}

/**
 * ui's noises for R9 (ground_r9.py; the same value noise as here, ui mirrors valueNoise) in one
 * texture, 256 square, repeated: R _NZ (16 cells, seed 1: the edges' noise), G _SHORE (8, 21), B
 * _FOAM (24, 13), A tsample's mix (8, 5). ui's _SHORE and the mix are 128 square: the same lattice.
 */
export function noise4Texture(): TextureSource {
  const size = 256;
  const ch = [valueNoise(size, 16, 1), valueNoise(size, 8, 21), valueNoise(size, 24, 13), valueNoise(size, 8, 5)];
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) for (let c = 0; c < 4; c++) rgba[i * 4 + c] = ch[c][i];
  return new BufferImageSource({ resource: rgba, width: size, height: size, format: "rgba8unorm", scaleMode: "linear", addressMode: "repeat", autoGenerateMipmaps: true, mipmapFilter: "linear", alphaMode: "no-premultiply-alpha" });
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
  /** R9's ground (art-v7 on, groundR9): the relief, the film curve. */
  readonly r9: boolean;
  /** ui's four noises in one texture (R9), or null. */
  private readonly noise4: TextureSource | null;
  /** R9's water (its ripples loaded): its banks and water instead of art-v6's. */
  readonly r9Water: boolean;
  private readonly auxMap: WaterAux | null;
  private readonly aux: BufferImageSource | null;
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
    // R9 (art-v7 on): with its relief loaded; ui's noises, made here; its water with its ripples
    // and art-v6's water distance (the weights' A), and its helpers' map (fords, bridges, current).
    this.r9 = groundR9(textures.json) && textures.relief != null;
    this.noise4 = this.r9 ? noise4Texture() : null;
    this.r9Water = this.r9 && this.water && textures.ripple != null && textures.json.ripple !== undefined;
    this.auxMap = this.r9Water ? new WaterAux(n, textures.json.rules) : null;
    this.aux = this.auxMap === null ? null : new BufferImageSource({ resource: this.auxMap.data, width: this.auxMap.side, height: this.auxMap.side, format: "rgba8unorm", scaleMode: "linear", addressMode: "clamp-to-edge", alphaMode: "no-premultiply-alpha" });
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
      uEdge: { value: new Float32Array([0, n * CELL_M, 0, 0]), type: "vec4<f32>" },
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
      ...r9Uniforms(this.r9 ? textures.json : null),
      ...r9WaterUniforms(this.r9Water ? textures.json : null),
    });
    const [grass, grassDry, dirt, gravel, bank] = textures.layers;
    // The shader's resources, a plain object: the water pass's shader takes them too (PixiJS's
    // shader.resources does not spread).
    const resources = {
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
        // R9's water: its ripples in this one's place (art-v6's water layer is not read then).
        uWater: (this.r9Water ? textures.ripple : textures.water) ?? textures.noise,
        uTown: this.townWeights ?? this.weights,
        uLane: (town ? lane : undefined) ?? textures.noise,
        uTrampled: (town ? trampled : undefined) ?? textures.noise,
        uRelief: textures.relief ?? textures.noise,
        uNoise4: this.noise4 ?? textures.noise,
        uWaterAux: this.aux ?? this.weights,
    };
    // highp: the ground's coordinates are metres across the whole map (up to 256): at PixiJS's
    // default mediump (16-bit) they step every 3–6 cm there, and the textures came out in blocks
    // at 3 倍 (ceo 2026-10-23, R8-29-02's grass). Apple's GPUs run fragment shaders at 32 bits anyway.
    const program = GlProgram.from({ vertex: VERTEX, fragment: FRAGMENT, name: "ground", preferredFragmentPrecision: "highp" });
    const pass = (p: number) => new UniformGroup({ uPass: { value: p, type: "f32" } });
    this.wholeShader = new Shader({ glProgram: program, resources: { ...resources, passUniforms: pass(0) } });
    this.waterShader = new Shader({ glProgram: program, resources: { ...resources, passUniforms: pass(1) } });
    this.mesh = new Mesh({ geometry, shader: this.wholeShader });
    this.cacheMesh = new Mesh({ geometry, shader: this.wholeShader });
  }

  // ---- 地面快取 (ground-cache.ts) -------------------------------------------------------
  /** The whole ground (uPass 0), and only its water (uPass 1). */
  private readonly wholeShader: Shader;
  private readonly waterShader: Shader;
  /** The whole ground again, for drawing into the cache (its own mesh: rendering one to a texture makes it a render group). */
  readonly cacheMesh: Mesh<Geometry, Shader>;
  /** What the land shows changed (its weights, the towns' ground, the quality, the edges' fade) since the cache took it. */
  dirty = true;

  /** The mesh in the battlefield draws only the water (the cache under it has the land), or the whole ground. */
  waterOnly(on: boolean): void {
    this.mesh.shader = on ? this.waterShader : this.wholeShader;
  }

  /** Anything here moves with time (art-v6's or R9's water): without, the cache is all and the mesh is not drawn. */
  get moves(): boolean {
    return this.water;
  }

  /** The cells' grounds again (a random map's grows as it is explored; resource points come and go). */
  setGround(ground: Uint8Array, nodes: readonly number[]): void {
    if (this.weightMap.set(ground, nodes)) {
      this.weights.update();
      this.dirty = true;
    }
    // R9's water's helpers from the cells and the weights' water distance (made again when the water changes).
    if (this.auxMap?.set(ground, this.weightMap.data) === true) {
      this.aux?.update();
      this.dirty = true;
    }
  }

  /** The towns' ground drawn (art-v6, rules.town). */
  get town(): boolean {
    return this.townMap !== null;
  }

  /** The towns' lanes and trampled earth now, a strength a cell, in these towns' boxes (world.ts): uploaded when they changed. */
  setTown(lane: Float32Array, trampled: Float32Array, boxes: readonly CellBox[]): void {
    if (this.townMap?.set(lane, trampled, boxes) === true) {
      this.townWeights?.update();
      this.dirty = true;
    }
  }

  /** The water's flow, every frame: the page's clock in seconds (wrapped an hour round, for the GPU's precision). */
  tick(seconds: number): void {
    if (!this.water) return;
    this.uniforms.uniforms.uTime = seconds % 3600;
    this.uniforms.update();
  }

  /** 浮空大陸 (edge.ts): the two lower edges fade out over this many metres (0: cut straight, as before). */
  setEdgeFade(m: number): void {
    (this.uniforms.uniforms.uEdge as Float32Array)[0] = m;
    this.uniforms.update();
    this.dirty = true;
  }

  setQuality(q: GroundQuality): void {
    this.quality = q;
    (this.uniforms.uniforms.uRules as Float32Array)[3] = q === "high" ? 1 : 0;
    this.uniforms.update();
    this.dirty = true;
  }

  get currentQuality(): GroundQuality {
    return this.quality;
  }

  /** The ground's textures on the GPU (MB): the five grounds, the noises and the cells' weights. */
  get memoryMB(): number {
    const t = this.textures;
    const r9 = [...(this.r9 && t.relief != null && this.noise4 !== null ? [t.relief, this.noise4] : []), ...(this.r9Water && t.ripple != null && this.aux !== null ? [t.ripple, this.aux] : [])];
    const bytes = [...t.layers, t.noise, t.macro, this.weights, ...r9, ...(this.townWeights === null ? [] : [this.townWeights, ...Object.values(t.town ?? {})])].reduce((n, s) => n + gpuBytes(s), 0);
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
    // The whole ground, whatever the battlefield's mesh draws now (the water only, under 地面快取).
    const quad = new Mesh({ geometry: this.mesh.geometry, shader: this.wholeShader });
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
    this.cacheMesh.destroy();
    this.weights.destroy();
    this.noise4?.destroy();
    this.aux?.destroy();
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
