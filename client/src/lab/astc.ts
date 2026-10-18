// ASTC 樣本 (D-085, docs/sprite-atlas.md section 8): war-game-ui compresses the atlases only once
// the iPhone has shown that ASTC 4×4 keeps their colours and edges. The spearman (東陸, 2×) from
// the PNG page and from the ASTC one side by side, whole, each enlarged to fill half the screen
// inside the safe area, with its name above it (ceo 2026-10-18: on the phone the 量測 panel hid
// one and the other was cut off). The interface (the 量測 panel, the buttons) steps aside while
// it shows; a tap closes it.
// On a GPU without ASTC it says so.

import "pixi.js/ktx";
import { type Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from "pixi.js";
import { parseAtlas } from "../art/spec.ts";
import { OWN_TINT } from "../render/atlas.ts";

/** Where the sample's two halves are: the 2× atlas (its description and PNG pages) and the ASTC pages. */
export interface AstcSample {
  unit: string;
  png: string;
  astc: string;
}

/** The frame shown: the spearman standing, facing the camera. */
const FRAME = (unit: string) => `${unit}_idle_f6_00`;
/** Kept clear at the sides and top and bottom (the phone held sideways: the notch and the home bar). */
const SAFE = { x: 64, y: 24 };

function label(text: string, x: number, y: number, size = 15): Text {
  const t = new Text({ text, style: { fontFamily: "-apple-system, 'Noto Sans TC', sans-serif", fontSize: size, fontWeight: "700", fill: 0xffffff } });
  t.anchor.set(0.5, 0);
  t.position.set(x, y);
  return t;
}

/**
 * Shows the sample over everything; resolves, once on screen, to what showed: shown, no-astc or
 * why it failed. `closed` runs when a tap takes it away.
 */
export async function showAstcSample(app: Application, s: AstcSample, closed: () => void = () => {}): Promise<string> {
  const layer = new Container();
  const w = app.screen.width;
  const h = app.screen.height;
  layer.addChild(new Graphics().rect(0, 0, w, h).fill({ color: 0x1d2320, alpha: 1 }));
  layer.eventMode = "static";
  layer.on("pointertap", () => {
    layer.destroy({ children: true });
    closed();
  });
  app.stage.addChild(layer);
  layer.addChild(label("ASTC 樣本：比較兩邊的顏色和邊緣。點一下關閉。", w / 2, SAFE.y, 14));
  const gl = "gl" in app.renderer ? (app.renderer.gl as WebGL2RenderingContext) : null;
  if (gl?.getExtension("WEBGL_compressed_texture_astc") == null) {
    layer.addChild(label("這台的顯示卡沒有 ASTC，看不了樣本。", w / 2, SAFE.y + 40));
    return "no-astc";
  }
  try {
    const a = parseAtlas(await (await fetch(`${s.png}${s.unit}.json`)).json());
    const name = FRAME(s.unit);
    const color = a.frames[name];
    const team = a.team[name];
    if (color === undefined) throw new Error(`${name} not in the atlas`);
    // Each half: a column of the safe area, the soldier as large as fits under its name.
    const colW = (w - 2 * SAFE.x) / 2;
    const top = SAFE.y + 30;
    const room = { w: colW - 24, h: h - top - SAFE.y - 26 };
    const scale = Math.min(room.w / color.w, room.h / color.h);
    const half = async (ext: string, base: string, col: number, title: string): Promise<void> => {
      const cx = SAFE.x + colW * (col + 0.5);
      layer.addChild(label(title, cx, top));
      const foot = top + 26 + room.h;
      for (const [layerName, r, tint] of [["color", color, 0xffffff], ["team", team, OWN_TINT]] as const) {
        if (r === undefined) continue;
        const page = await Assets.load<Texture>(`${base}${s.unit}_${layerName}_${r.page}.${ext}`);
        const sprite = new Sprite(new Texture({ source: page.source, frame: new Rectangle(r.x, r.y, r.w, r.h) }));
        sprite.tint = tint;
        // Both layers on the same foot point (their anchors), the colour layer's foot at the bottom of the column.
        sprite.anchor.set(r.ax / r.w, r.ay / r.h);
        sprite.position.set(cx, foot - (color.h - color.ay) * scale);
        sprite.scale.set(scale);
        layer.addChild(sprite);
      }
    };
    await half("png", s.png, 0, "一般圖");
    await half("astc.ktx", s.astc, 1, "壓縮圖（ASTC）");
    return "shown";
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    layer.addChild(label(`樣本載入失敗：${why}`, w / 2, SAFE.y + 40));
    return `failed: ${why}`;
  }
}
