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

export default defineConfig({
  base: "./",
  define: {
    __COMMIT__: JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) ?? commit()),
  },
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
  worker: { format: "es" },
});
