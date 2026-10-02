// Controlled fights for analysis (c), run from sim/ on #91 (ae2d204): the player's push army
// (11 spearmen, 10 ranged, 3 mages) close or loose against the AI with 0-6 mages, on open ground.
// Each side's loose units chosen apart: none, shooters (ranged and mages, as the AI does after
// seeing 2 enemy mages) or all. Usage: node controlled-fights.ts attack|defend|both shooters|none
import { Game } from "./src/core/game.ts";
import { BUILDINGS, LOOSE_KEEP, UNITS } from "./src/core/rules.ts";
import { CELL_SHIFT, type CommandBody, Order, Resource, UnitFlag, UnitType } from "./src/protocol.ts";
type Army = { spear: number; ranged: number; mage: number };
type Loose = "none" | "shooters" | "all";
const TYPES: [keyof Army, UnitType][] = [["spear", UnitType.Spearman], ["ranged", UnitType.Ranged], ["mage", UnitType.Mage]];
const COST: Record<keyof Army, number> = { spear: 60, ranged: 70, mage: 140 };
const FIELD_W = 34, FIELD_H = 15;
function field(g: Game) {
  const w = g.w, n = w.size, b = w.buildings.col;
  for (let y = 2; y + FIELD_H <= n - 2; y++) for (let x = 2; x + FIELD_W <= n - 2; x++) {
    let ok = true;
    for (let s = 0; s < w.buildings.count && ok; s++) { const size = BUILDINGS[b.type[s]].size; if (b.cellX[s] + size + 10 > x && b.cellX[s] - 10 < x + FIELD_W && b.cellY[s] + size + 10 > y && b.cellY[s] - 10 < y + FIELD_H) ok = false; }
    for (const t of w.map.towns) { const r = t.radius + 3; if (t.cellX + r >= x && t.cellX - r < x + FIELD_W && t.cellY + r >= y && t.cellY - r < y + FIELD_H) ok = false; }
    for (let yy = y; yy < y + FIELD_H && ok; yy++) for (let xx = x; xx < x + FIELD_W && ok; xx++) if (!w.walkable(xx, yy)) ok = false;
    if (ok) return { x, y };
  }
  throw new Error("no field");
}
function count(g: Game, p: number): Army { const u = g.w.units.col; const a = { spear: 0, ranged: 0, mage: 0 }; for (let s = 0; s < g.w.units.count; s++) { if (u.owner[s] !== p) continue; if (u.type[s] === UnitType.Spearman) a.spear++; else if (u.type[s] === UnitType.Ranged) a.ranged++; else if (u.type[s] === UnitType.Mage) a.mage++; } return a; }
const value = (a: Army) => a.spear * COST.spear + a.ranged * COST.ranged + a.mage * COST.mage;
const total = (a: Army) => a.spear + a.ranged + a.mage;
/** attacker: 0, 1 or 2 (both). */
function fight(armies: [Army, Army], loose: [Loose, Loose], attacker: number, distance: number) {
  const g = new Game({ seed: 1, scenario: "standard", maxTicks: 0 });
  const w = g.w, u = w.units.col;
  for (let s = 0; s < w.units.count; s++) w.unitSlot[u.id[s]] = -1;
  w.units.count = 0;
  const f = field(g); const midY = f.y + (FIELD_H >> 1);
  const frontX = [f.x + 13, f.x + 13 + distance];
  let seq = 0;
  const push = (p: number, body: CommandBody) => g.push({ ...body, t: g.tick, p, seq: seq++ } as never);
  const ids: number[][] = [[], []]; const shooters: number[][] = [[], []];
  for (let p = 0; p < 2; p++) {
    const back = p === 0 ? -1 : 1; let k = 0;
    for (const [key, type] of TYPES) for (let i = 0; i < armies[p][key]; i++, k++) {
      const x = frontX[p] + back * (4 + Math.trunc(k / 6)), y = midY - 3 + (k % 6);
      const id = w.addUnit(p, type, (x << CELL_SHIFT) + 512, (y << CELL_SHIFT) + 512, UNITS[type].hp);
      if (type === UnitType.Mage) u.flags[w.unit(id)] |= UnitFlag.Autocast;
      ids[p].push(id); if (type !== UnitType.Spearman) shooters[p].push(id);
    }
    w.res[p * 4 + Resource.Crystal] = 1000;
  }
  g.fog.update(w);
  for (let p = 0; p < 2; p++) { if (loose[p] === "all") push(p, { c: "formation", u: ids[p], loose: true }); else if (loose[p] === "shooters" && shooters[p].length > 0) push(p, { c: "formation", u: shooters[p], loose: true }); }
  for (let p = 0; p < 2; p++) push(p, { c: "move", u: ids[p], x: frontX[p], y: midY });
  for (let t = 0; t < 400; t++) { g.step(); let moving = false; for (let s = 0; s < w.units.count; s++) if (u.order[s] !== Order.None) moving = true; if (!moving) break; }
  for (let p = 0; p < 2; p++) if (attacker === p || attacker === 2) push(p, { c: "move", u: ids[p], x: frontX[1 - p], y: midY });
  const start = g.tick; let winner = -1;
  while (g.tick - start < 2400) { g.step(); const a = total(count(g, 0)), b = total(count(g, 1)); if (a === 0 || b === 0) { winner = a > 0 ? 0 : b > 0 ? 1 : -1; break; } }
  return { winner, left: [count(g, 0), count(g, 1)] as [Army, Army], shots: [w.cannonShots[0], w.cannonShots[1]], hits: [w.cannonHits[0], w.cannonHits[1]] };
}
const player: Army = { spear: 11, ranged: 10, mage: 3 };
const scen = process.argv[2] ?? "attack";
const attacker = scen === "attack" ? 0 : scen === "defend" ? 1 : 2;
const aiLoose: Loose = (process.argv[3] ?? "shooters") as Loose;
for (const e4 of [true, false]) {
  LOOSE_KEEP.everyone = e4;
  for (let k = 0; k <= 6; k++) {
    const out: string[] = [];
    for (const form of ["none", "all"] as Loose[]) {
      let win = 0, lose = 0, n = 0, net = 0, left = 0, foe = 0, shots = 0, hits = 0;
      for (const ai of [{ spear: 8, ranged: 6 }, { spear: 10, ranged: 8 }, { spear: 12, ranged: 10 }, { spear: 14, ranged: 12 }]) for (const d of [8, 10, 12]) {
        const r = fight([player, { ...ai, mage: k }], [form, k >= 0 ? aiLoose : "none"], attacker, d);
        n++; if (r.winner === 0) win++; else if (r.winner === 1) lose++;
        net += value(r.left[0]) - value(r.left[1]); left += total(r.left[0]); foe += total(r.left[1]); shots += r.shots[1]; hits += r.hits[1];
      }
      out.push(`${form === "none" ? "close" : "loose"} win ${win}/${n} lose ${lose} left ${(left / n).toFixed(1)} foeLeft ${(foe / n).toFixed(1)} net ${(net / n).toFixed(0)} hits/shot ${(hits / Math.max(1, shots)).toFixed(2)}`);
    }
    console.log(`${scen} AI-${aiLoose} E4 ${e4 ? "on " : "off"} k=${k}: ${out.join(" | ")}`);
  }
}
