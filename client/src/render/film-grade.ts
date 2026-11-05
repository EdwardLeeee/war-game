// 電影色調 (the user 2026-11-02 chose R9-05 B, after napali's 寫實感): a film grade over the
// battlefield, ACES's filmic curve in linear light with sunlight's warmer white, a light vignette and
// haze far off at the top of the slanted view. One more pass over the whole screen, so the player
// turns it on in 選單 (grade-pref.ts), off by default until it is measured on the iPhone (ceo).

import { type Application, Filter, GlProgram, UniformGroup } from "pixi.js";

/** R9-05 B: how much of the curve (0 none, 1 all), the vignette's darkening at the corners, the haze at the top. */
export const FILM_GRADE = { tone: 0.75, vignette: 0.24, haze: 0.09 };

// PixiJS's default filter vertex (8.21), which also passes where on the screen a pixel is (0–1, y down).
const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vScreen;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
  vScreen = aPosition;
}
`;

const fragment = `
in vec2 vTextureCoord;
in vec2 vScreen;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uTone;
uniform float uVignette;
uniform float uHaze;
uniform vec2 uAspect;

// ACES filmic fit (Narkowicz 2015).
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec4 src = texture(uTexture, vTextureCoord);
  vec3 c = src.a > 0.0 ? src.rgb / src.a : vec3(0.0);
  // In linear light: sunlight's warmer white, the filmic curve (deeper shadows, highlights rolled
  // off), back to the screen's sRGB; a little more colour, as the curve takes some.
  vec3 lin = pow(c, vec3(2.2)) * vec3(1.08, 1.0, 0.86) * 0.82;
  vec3 graded = pow(aces(lin), vec3(1.0 / 2.2));
  float l = dot(graded, vec3(0.299, 0.587, 0.114));
  graded = mix(vec3(l), graded, 1.12);
  c = mix(c, clamp(graded, 0.0, 1.0), uTone);
  // Haze far off (the top of the slanted view), not over the black of the unexplored.
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  float far = smoothstep(0.5, 0.0, vScreen.y) * smoothstep(0.03, 0.2, lum);
  c = mix(c, vec3(0.86, 0.80, 0.68), far * uHaze);
  // Vignette.
  float r = length((vScreen - 0.5) * uAspect);
  c *= 1.0 - smoothstep(0.35, 0.95, r) * uVignette;
  finalColor = vec4(c * src.a, src.a);
}
`;

/** The filter of each canvas (one a page; made the first time it is turned on). */
const filters = new WeakMap<Application, Filter>();

/** The grade on or off over the whole battlefield (the stage: the interface is the page's, not the canvas's). */
export function setFilmGrade(app: Application, on: boolean): void {
  let filter = filters.get(app);
  if (on && filter === undefined) {
    const uniforms = new UniformGroup({
      uTone: { value: FILM_GRADE.tone, type: "f32" },
      uVignette: { value: FILM_GRADE.vignette, type: "f32" },
      uHaze: { value: FILM_GRADE.haze, type: "f32" },
      uAspect: { value: new Float32Array([16 / 9, 1]), type: "vec2<f32>" },
    });
    const aspect = (width: number, height: number): void => {
      (uniforms.uniforms.uAspect as Float32Array)[0] = width / Math.max(1, height);
      uniforms.update();
    };
    // At the screen's resolution (PixiJS filters render at 1 by default: a third of the phone's pixels, blurred).
    filter = new Filter({ glProgram: GlProgram.from({ vertex, fragment, name: "film-grade" }), resources: { gradeUniforms: uniforms }, resolution: "inherit" });
    aspect(app.screen.width, app.screen.height);
    app.renderer.on("resize", aspect);
    filters.set(app, filter);
  }
  app.stage.filters = on && filter !== undefined ? [filter] : [];
  app.stage.filterArea = on ? app.screen : undefined;
}

/** Whether the grade is over the battlefield now (the test page). */
export function filmGradeOn(app: Application): boolean {
  const f = filters.get(app);
  return f !== undefined && (app.stage.filters as readonly Filter[] | null | undefined)?.includes(f) === true;
}
