import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { simBuild } from "./scripts/sim-build.ts";

// Relative base: the build is served from GitHub Pages at /war-game/proto/ and from
// `vite preview` at / in CI.
function commit(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}

const COMMIT = process.env.GITHUB_SHA?.slice(0, 7) ?? commit();
/** Which simulation the page runs (D-083): a saved game goes on only on the same one (scripts/sim-build.ts). */
const SIM_BUILD = (await simBuild(fileURLToPath(new URL("..", import.meta.url)))).id;
/**
 * The units' atlases (D-085): the Release art.lock.json pins (scripts/fetch-art.ts unpacks it into
 * public/art/<tag>/), or ART_TAG=dev on this machine for the design-render artifacts; null: none.
 */
const ART_TAG: string | null = process.env.ART_TAG ?? (JSON.parse(readFileSync(new URL("art.lock.json", import.meta.url), "utf8")) as { tag: string | null }).tag;

export default defineConfig({
  base: "./",
  define: {
    __COMMIT__: JSON.stringify(COMMIT),
    __SIM_BUILD__: JSON.stringify(SIM_BUILD),
    __ART_TAG__: JSON.stringify(ART_TAG),
  },
  plugins: [
    {
      // 有新版本 (D-042): the deployed build's commit, which an open page reads without any
      // cache and compares with its own.
      name: "version-json",
      apply: "build",
      generateBundle() {
        this.emitFile({ type: "asset", fileName: "version.json", source: `${JSON.stringify({ commit: COMMIT })}\n` });
      },
    },
  ],
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
  worker: { format: "es" },
});
