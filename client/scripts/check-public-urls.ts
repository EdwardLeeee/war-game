// After the build (npm's postbuild, so `npm run build` fails; ceo 2026-11-21): no URL in dist's CSS or JS that starts at
// the site's root and points at a file of public/ (cursors/, art/, icons/, sw.js…). The game is served under
// /war-game/ (vite's base "./"), where "/cursors/sword-32.png" is the root's and not found: the cursor would stay
// the arrow while every test, served at the root, still passed (#559). Vite makes a CSS url("/cursors/…") relative
// ("../cursors/…"); a string in the code it leaves as it is.
//
//   node scripts/check-public-urls.ts [dist]

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const quote = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The URLs in `text` that start at the root and go to one of `publicNames` (public/'s entries): url(/x…), "/x…". */
export function rootPublicUrls(text: string, publicNames: readonly string[]): string[] {
  if (publicNames.length === 0) return [];
  const re = new RegExp(`(?:url\\(\\s*["']?|["'\`])(/(?:${publicNames.map(quote).join("|")})(?=[/"'\`)?#\\s]|$)[^"'\`)\\s]*)`, "g");
  return [...text.matchAll(re)].map((m) => m[1]);
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(css|js|mjs|html)$/.test(n) ? [p] : [];
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = fileURLToPath(new URL("..", import.meta.url));
  const dist = process.argv[2] ?? join(here, "dist");
  const names = readdirSync(join(here, "public"));
  const found = files(dist).flatMap((f) => rootPublicUrls(readFileSync(f, "utf8"), names).map((u) => `${f.slice(dist.length + 1)}: ${u}`));
  if (found.length > 0) {
    console.error(`dist points at public/ from the site's root (under /war-game/ these are not found; write them relative, or from import.meta.env.BASE_URL):\n  ${found.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`check-public-urls: no URL from the root to public/ (${names.join(", ")}) in ${dist}`);
}
