// 雙河關 (sim/src/core/twin-rivers.ts: fixed data since D-115; seed 2106939660 no longer draws it) as map-grid.ts's JSON
// for design/r9/common/scene_r9.py:  node design/r9/common/twin_grid.mts > GRID.json
import { twinRiversMap } from "../../../sim/src/core/twin-rivers.ts";
import { NodeKind, Terrain } from "../../../sim/src/protocol.ts";
const map = twinRiversMap(2);
const n = map.size;
const GROUND: Record<number, string> = { [Terrain.Open]: ".", [Terrain.Blocked]: "R", [Terrain.Wall]: "W", [Terrain.Water]: "~", [Terrain.Ford]: "f", [Terrain.BridgeNS]: "|", [Terrain.BridgeEW]: "=", [Terrain.Cliff]: "K" };
const NODE: Record<number, string> = { [NodeKind.Tree]: "T", [NodeKind.GoldMine]: "G", [NodeKind.Berries]: "B", [NodeKind.CrystalVein]: "C" };
const cells = [...map.terrain].map((t) => GROUND[t] ?? "?");
for (const s of map.nodes) cells[s.cellY * n + s.cellX] = NODE[s.kind] ?? "?";
for (const s of map.spawns) for (let y = s.cellY - 2; y < s.cellY + 2; y++) for (let x = s.cellX - 2; x < s.cellX + 2; x++) cells[y * n + x] = "M";
const rows: string[] = [];
for (let y = 0; y < n; y++) rows.push(cells.slice(y * n, (y + 1) * n).join(""));
process.stdout.write(JSON.stringify({ map: "twin-rivers", size: n, rows, terrain: [...map.terrain] }) + "\n");
