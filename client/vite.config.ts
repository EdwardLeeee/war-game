import { execSync } from "node:child_process";
import { defineConfig } from "vite";

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

export default defineConfig({
  base: "./",
  define: {
    __COMMIT__: JSON.stringify(COMMIT),
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
