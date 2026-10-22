// The one place the client imports the simulation's contract from (sim/, war-game-core).
// Relative paths, not a Vite alias, so `node --test` resolves them too.

export * from "../../sim/src/protocol.ts";
export { checkPlacement, type PlacementGrid } from "../../sim/src/placement.ts";
/** The simulation's rule tables, as its Worker sends them (the fake world uses the unit table); 自動訓練's defaults (D-054); how many farmers a build without farmers sends. */
export { AUTO_TRAIN, autoBuilders, CANNON, rules } from "../../sim/src/core/rules.ts";
/** Directions as the simulation counts them (0-15, 0 east, 4 south): `formation`'s `face` (D-095). */
export { dir16 } from "../../sim/src/core/fixed.ts";
