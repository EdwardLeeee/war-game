import type { CapacitorConfig } from "@capacitor/cli";

// Simulator-only spike app: the web bundle ships inside the app (no server.url).
const config: CapacitorConfig = {
  appId: "com.oraclelee.wargame.spikeweb",
  appName: "WG Spike Web",
  webDir: "dist",
  loggingBehavior: "debug",
};

export default config;
