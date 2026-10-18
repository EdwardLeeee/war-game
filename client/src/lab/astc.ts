// ASTC 樣本 (D-085, docs/sprite-atlas.md section 8): war-game-ui compresses the atlases only once
// the iPhone has shown that ASTC 4×4 keeps their colours and edges. One page of the spearman
// (東陸, 2×) as the PNG and as ASTC side by side, colour and player colour, enlarged so that the
// edges show; a tap closes it. On a GPU without ASTC it says so.

import "pixi.js/ktx";
import { type Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from "pixi.js";
import { OWN_TINT } from "../render/atlas.ts";

/** Where the sample's two halves are: the PNG pages and the ASTC ones, both `<unit>_<layer>_0.<ext>`. */
export interface AstcSample {
  unit: string;
  png: string;
  astc: string;
}

/** The part of the page shown (image points): its top left, where the tallest frames are packed. */
const CROP = new Rectangle(0, 0, 360, 200);

function label(text: string, x: number, y: number): Text {
  const t = new Text({ text, style: { fontFamily: "-apple-system, 'Noto Sans TC', sans-serif", fontSize: 15, fontWeight: "700", fill: 0xffffff } });
  t.position.set(x, y);
  return t;
}

/** Shows the sample over the battlefield; resolves, once on screen, to what showed: shown, no-astc or why it failed. */
export async function showAstcSample(app: Application, s: AstcSample): Promise<string> {
  const layer = new Container();
  const w = app.screen.width;
  const h = app.screen.height;
  const back = new Graphics().rect(0, 0, w, h).fill({ color: 0x1d2320, alpha: 0.97 });
  layer.addChild(back);
  layer.eventMode = "static";
  layer.on("pointertap", () => layer.destroy({ children: true }));
  app.stage.addChild(layer);
  const gl = "gl" in app.renderer ? (app.renderer.gl as WebGL2RenderingContext) : null;
  const astc = gl?.getExtension("WEBGL_compressed_texture_astc") ?? null;
  layer.addChild(label(`ASTC 樣本（${s.unit}，2 倍）：左邊 PNG（未壓縮），右邊 ASTC 4×4。比較顏色和邊緣。點一下關閉。`, 12, 8));
  if (astc === null) {
    layer.addChild(label("這台的顯示卡沒有 ASTC，看不了樣本。", 12, 40));
    return "no-astc";
  }
  const scale = Math.min((w - 36) / 2 / CROP.width, (h - 60) / CROP.height);
  const half = async (ext: string, base: string, x: number, title: string): Promise<void> => {
    layer.addChild(label(title, x, 34));
    for (const [layerName, tint] of [["color", 0xffffff], ["team", OWN_TINT]] as const) {
      const page = await Assets.load<Texture>(`${base}${s.unit}_${layerName}_0.${ext}`);
      const sprite = new Sprite(new Texture({ source: page.source, frame: new Rectangle(CROP.x, CROP.y, Math.min(CROP.width, page.width), Math.min(CROP.height, page.height)) }));
      sprite.tint = tint;
      sprite.position.set(x, 56);
      sprite.scale.set(scale);
      layer.addChild(sprite);
    }
  };
  try {
    await half("png", s.png, 12, "PNG");
    await half("astc.ktx", s.astc, 24 + CROP.width * scale, "ASTC 4×4");
    return "shown";
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    layer.addChild(label(`樣本載入失敗：${why}`, 12, 40));
    return `failed: ${why}`;
  }
}
