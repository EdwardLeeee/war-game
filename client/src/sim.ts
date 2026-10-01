// The one place the client imports the simulation's contract from (sim/, war-game-core).
// Relative paths, not a Vite alias, so `node --test` resolves them too.

export * from "../../sim/src/protocol.ts";
export { checkPlacement, type PlacementGrid } from "../../sim/src/placement.ts";
/** The simulation's rule tables, as its Worker sends them (the fake world uses the unit table). */
export { rules } from "../../sim/src/core/rules.ts";
