import { execSync } from "node:child_process";
import { defineConfig } from "vite";

// Relative base: the same build serves GitHub Pages (/war-game/web/) and the Capacitor apps.
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
    __AUTORUN__: JSON.stringify(process.env.VITE_AUTORUN === "1"),
  },
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
  worker: { format: "es" },
});
