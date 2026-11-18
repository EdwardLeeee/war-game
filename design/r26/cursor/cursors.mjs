// R26-05 游標 (ceo 2026-11-18: 劍、城門、斧頭、鎚子，32 和 64 px，東陸唐末五代的器物樣子、不要日式).
// The cursors as SVG (drawn on a 32 × 32 grid), rendered to PNG at 32 and 64 px with a transparent ground.
//   node design/r26/cursor/cursors.mjs OUT [PUBLIC]   (OUT/<name>-32.png, -64.png, -256.png, <name>.svg, hotspots.json;
//   PUBLIC, e.g. client/public/cursors: the game's 8 PNGs and hotspots.json)
// The look follows the East's own art: the 橫刀 of east_r8.py (straight, single-edged, a ring pommel 環首, no guard to
// speak of), R20's tools (an old-iron axe on a wooden haft; a mallet all of wood), and a Tang city gate (a gateway under
// a flat timber lintel, its sides leaning in: 過梁式, before the arched gates of Song and later; a gate tower with a
// plain ridge). Nothing Japanese: no curved blade, no round tsuba, no torii.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../../client/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const OUT = process.argv[2];
const PUBLIC = process.argv[3] ?? null; // client/public/cursors: what the game loads (32 and 64 px, hotspots.json)
mkdirSync(OUT, { recursive: true });
if (PUBLIC) mkdirSync(PUBLIC, { recursive: true });

const INK = "#1b130b";
const HALO = 'stroke="rgba(255,248,232,0.8)" stroke-width="3" stroke-linejoin="round"';
const LINE = `stroke="${INK}" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round"`;

// 城門's ridge: plain (ceo 2026-11-18). The first ridge ends, two horns turned out, read as a helmet's 鍬形; low 鴟尾
// curling in (as Tang's) read as two round ears drawn large and two bumps at 32 px, so none: a plain ridge.
const GATE_ENDS = "";

// Each: its body (drawn twice: a light halo under, then itself), and the point that clicks (32 px grid).
const CURSORS = {
  // 劍 (attack): a 橫刀, the tip at the top left.
  sword: {
    hot: [2, 3],
    body: `<g transform="translate(2.2 2.2) rotate(45)">
      <path d="M0 1.5 L3.6 -1.8 L21.5 -1.8 L21.5 1.8 L0.6 1.8 Z" fill="#dfe4e8" ${LINE}/>
      <path d="M3.8 -1.1 L21.2 -1.1" stroke="#9aa3ab" stroke-width="0.8"/>
      <rect x="21.5" y="-2.3" width="1.5" height="4.6" rx="0.4" fill="#c9963e" ${LINE}/>
      <rect x="23" y="-1.25" width="7.6" height="2.5" rx="0.6" fill="#6b2a1c" ${LINE}/>
      <path d="M24.6 -1.2 L25.8 1.2 M26.6 -1.2 L27.8 1.2 M28.6 -1.2 L29.8 1.2" stroke="#3a140c" stroke-width="0.55"/>
      <circle cx="32.6" cy="0" r="2.05" fill="none" stroke="${INK}" stroke-width="2.3"/>
      <circle cx="32.6" cy="0" r="2.05" fill="none" stroke="#c9963e" stroke-width="1.1"/>
    </g>`,
  },
  // 城門 (進駐): a gate tower over a timber-lintel gateway, a gold arrow going in.
  gate: {
    hot: [16, 16],
    body: `<path d="M3 29.5 L5 14.5 L27 14.5 L29 29.5 Z" fill="#e6cf9c" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M5.6 19 H26.4 M4.9 24 H27.1" stroke="#a8875a" stroke-width="0.6"/>
      <path d="M11.2 29.5 L12.6 20 L19.4 20 L20.8 29.5 Z" fill="#24160c" ${LINE}/>
      <rect x="11.6" y="19.2" width="8.8" height="1.4" fill="#6b4a2a" ${LINE}/>
      <rect x="9" y="9.6" width="14" height="5" fill="#8a3324" ${LINE}/>
      <path d="M11.8 9.8 V14.4 M16 9.8 V14.4 M20.2 9.8 V14.4" stroke="#f0d9a8" stroke-width="0.7"/>
      <path d="M4.2 10.2 Q6 9.8 7.4 7.8 L24.6 7.8 Q26 9.8 27.8 10.2 L25 10.4 L7 10.4 Z" fill="#3d4249" ${LINE}/>
      <path d="M8.6 7.8 L10.6 4.6 L21.4 4.6 L23.4 7.8 Z" fill="#4a5059" ${LINE}/>
      ${GATE_ENDS}
      <path d="M16 15.6 V26.2" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/>
      <path d="M12.6 22.6 L16 26.6 L19.4 22.6" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M16 15.6 V26.2" stroke="#f2c862" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M12.6 22.6 L16 26.6 L19.4 22.6" fill="none" stroke="#f2c862" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  // 斧頭 (採集): an old-iron axe head on a wooden haft, the edge to the top right.
  axe: {
    hot: [9, 2],
    body: `<g transform="translate(4 9.5) rotate(45)">
      <rect x="-0.5" y="-1.3" width="27" height="2.6" rx="1" fill="#9a6a3a" ${LINE}/>
      <path d="M8 -0.6 L24 -0.6" stroke="#b8854e" stroke-width="0.6"/>
      <path d="M0.2 -1.9 L-1.6 -8.6 Q3.4 -10.4 8.6 -8.6 L6.6 -1.9 Z" fill="#767c83" ${LINE}/>
      <path d="M-1.2 -7.6 Q3.4 -9.4 8.2 -7.6" fill="none" stroke="#d9dde0" stroke-width="1"/>
      <rect x="-0.4" y="-2.2" width="7.2" height="4.4" rx="0.8" fill="#5c6168" ${LINE}/>
    </g>`,
  },
  // 鎚子 (蓋、修): R20's builders' mallet, all of wood, its head across the top left.
  hammer: {
    hot: [4, 9],
    body: `<g transform="translate(9 9) rotate(45)">
      <rect x="1.5" y="-1.2" width="21.5" height="2.4" rx="1" fill="#9a6a3a" ${LINE}/>
      <path d="M6 -0.5 L21.5 -0.5" stroke="#b8854e" stroke-width="0.55"/>
      <rect x="-3.6" y="-7.2" width="6.6" height="14.4" rx="2.2" fill="#b5803f" ${LINE}/>
      <path d="M-2.6 -4.4 H2 M-2.6 0 H2 M-2.6 4.4 H2" stroke="#8a5a2c" stroke-width="0.55"/>
      <path d="M-1.8 -6.6 Q-0.3 -7.6 1.2 -6.6" fill="none" stroke="#d6a464" stroke-width="0.7"/>
    </g>`,
  },
};

const svg = (c, px) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 32 32">` +
  `<g ${HALO} fill="none" stroke-opacity="1">${c.body.replace(/fill="[^"]*"/g, 'fill="rgba(255,248,232,0.8)"').replace(/stroke="(?!none)[^"]*"/g, 'stroke="rgba(255,248,232,0.8)"').replace(/stroke-width="[^"]*"/g, 'stroke-width="3.2"')}</g>` +
  `<g style="filter: drop-shadow(0 0.6px 0.6px rgba(0,0,0,0.55))">${c.body}</g></svg>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 400 }, deviceScaleFactor: 1 });
  const hot = {};
  for (const [name, c] of Object.entries(CURSORS)) {
    writeFileSync(`${OUT}/${name}.svg`, svg(c, 32));
    for (const px of [32, 64, 256]) {
      await page.setContent(`<html><body style="margin:0;background:transparent"><div id="c" style="width:${px}px;height:${px}px">${svg(c, px)}</div></body></html>`);
      await page.locator("#c").screenshot({ path: `${OUT}/${name}-${px}.png`, omitBackground: true });
      if (PUBLIC && px !== 256) await page.locator("#c").screenshot({ path: `${PUBLIC}/${name}-${px}.png`, omitBackground: true });
    }
    hot[name] = { "32": c.hot, "64": c.hot.map((v) => v * 2) };
  }
  writeFileSync(`${OUT}/hotspots.json`, JSON.stringify(hot, null, 1));
  if (PUBLIC) writeFileSync(`${PUBLIC}/hotspots.json`, `${JSON.stringify(hot, null, 1)}\n`);
  console.log(JSON.stringify(hot));
} finally {
  await browser.close();
}
