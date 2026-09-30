// The one place the client imports the simulation's contract from (sim/, war-game-core).
// Relative paths, not a Vite alias, so `node --test` resolves them too.

export * from "../../sim/src/protocol.ts";
export { checkPlacement, type PlacementGrid } from "../../sim/src/placement.ts";
