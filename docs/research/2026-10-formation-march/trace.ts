// 整理隊形 and 跑一跑法師跑到前排 (D-095), measured on the simulation itself (no screen): a mixed
// group of player 0 — 8 spearmen, 4 ranged, 3 mages — on open ground, and what happens to its
// ranks while it walks, turns back, fights, and re-forms. Prints JSON lines; the report is
// ../2026-10-formation-march.md.
//   node docs/research/2026-10-formation-march/trace.ts > docs/research/2026-10-formation-march/out.jsonl

import { Game } from "../../../sim/src/core/game.ts";
import { Order, Stance, UnitType } from "../../../sim/src/protocol.ts";
import { cmd, emptyGame, openArea, put, slotOf } from "../../../sim/test/helpers.ts";

const KIND: Record<number, string> = { [UnitType.Spearman]: "spear", [UnitType.Ranged]: "ranged", [UnitType.Mage]: "mage" };

interface Army {
  g: Game;
  ours: number[];
  foes: number[];
  a: { x: number; y: number };
}

/** Our 15 in a block, mages in its north row; `foe`: enemies' cells. */
function setUp(foes: [number, number, UnitType][] = []): Army {
  const g = emptyGame();
  const a = openArea(g, 30);
  const ours: number[] = [];
  // Rows from north: 3 mages, 4 ranged, 8 spearmen (two rows of 4).
  for (let k = 0; k < 3; k++) ours.push(put(g, 0, UnitType.Mage, a.x + 13 + k, a.y + 13));
  for (let k = 0; k < 4; k++) ours.push(put(g, 0, UnitType.Ranged, a.x + 13 + k, a.y + 14));
  for (let k = 0; k < 8; k++) ours.push(put(g, 0, UnitType.Spearman, a.x + 13 + (k % 4), a.y + 15 + Math.trunc(k / 4)));
  const foeIds = foes.map(([dx, dy, t]) => put(g, 1, t, a.x + dx, a.y + dy));
  g.fog.update(g.w);
  return { g, ours, foes: foeIds, a };
}

/** Each kind's mean position along `dir` (cells; larger = further ahead), and the alive. */
function ranks(army: Army, dir: { x: number; y: number }): Record<string, number> {
  const u = army.g.w.units.col;
  const sum: Record<string, number[]> = {};
  for (const id of army.ours) {
    const s = slotOf(army.g, id);
    if (s < 0) continue;
    const k = KIND[u.type[s]];
    (sum[k] ??= []).push((u.x[s] * dir.x + u.y[s] * dir.y) / 1024);
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(sum)) out[k] = Math.round((v.reduce((p, q) => p + q, 0) / v.length) * 100) / 100;
  return out;
}

const hpOf = (army: Army, ids: number[]) => ids.reduce((n, id) => n + (slotOf(army.g, id) >= 0 ? army.g.w.units.col.hp[slotOf(army.g, id)] : 0), 0);
const settled = (army: Army) => army.ours.every((id) => slotOf(army.g, id) < 0 || army.g.w.units.col.order[slotOf(army.g, id)] === Order.None);

function emit(o: Record<string, unknown>): void {
  console.log(JSON.stringify(o));
}

/** A: the march. Walk 12 cells south (the way they face: spearmen are south), then back north, every 0.5 s the kinds' ranks along the way they walk. */
function march(order: "retreat" | "move"): void {
  const army = setUp();
  const { g, a } = army;
  const legs: { to: [number, number]; dir: { x: number; y: number } }[] = [
    { to: [a.x + 14, a.y + 27], dir: { x: 0, y: 1 } },
    { to: [a.x + 14, a.y + 3], dir: { x: 0, y: -1 } },
  ];
  for (const [leg, l] of legs.entries()) {
    cmd(g, 0, { c: order, u: army.ours, x: l.to[0], y: l.to[1] });
    for (let t = 0; t <= 20 * 20; t++) {
      g.step();
      if (t % 10 === 0) emit({ scene: `march-${order}`, leg, t, ranks: ranks(army, l.dir), settled: settled(army) });
      if (t > 20 && settled(army)) break;
    }
  }
}

/** B: a fight. Six enemy spearmen and three ranged 11 cells south walk in (attack-move); ours stand 積極, then (after) every 0.5 s ranks toward the enemy. */
function fight(): void {
  const foes: [number, number, UnitType][] = [];
  for (let k = 0; k < 6; k++) foes.push([11 + k, 26, UnitType.Spearman]);
  for (let k = 0; k < 3; k++) foes.push([12 + k, 27, UnitType.Ranged]);
  const army = setUp(foes);
  const { g, a } = army;
  cmd(g, 1, { c: "move", u: army.foes, x: a.x + 14, y: a.y + 15 });
  for (let t = 0; t <= 30 * 20; t++) {
    g.step();
    if (t % 10 === 0) emit({ scene: "fight", t, ranks: ranks(army, { x: 0, y: 1 }), ourHp: hpOf(army, army.ours), foeHp: hpOf(army, army.foes), foesLeft: army.foes.filter((id) => slotOf(g, id) >= 0).length });
    if (army.foes.every((id) => slotOf(g, id) < 0)) break;
  }
  // After the fight, what the group looks like toward the south (where the enemy came from).
  emit({ scene: "fight-after", ranks: ranks(army, { x: 0, y: 1 }) });
}

/**
 * C: 整理隊形 with enemies near. Mages are in front (north) and the enemy — four ranged — stands
 * `gap` cells north of them, holding (堅守: they shoot what is in reach, do not come). Ours re-form
 * facing the enemy: (1) the client's way, a retreat one cell north, then 積極; (2) an attack-move
 * one cell north; (3) nothing (standing 積極). How long, ranks after, and the hp each side lost in 6 s.
 */
function reform(how: "retreat" | "move" | "none", gap: number): void {
  const foes: [number, number, UnitType][] = [];
  for (let k = 0; k < 4; k++) foes.push([13 + k, 13 - gap, UnitType.Ranged]);
  const army = setUp(foes);
  const { g, a } = army;
  cmd(g, 1, { c: "stance", u: army.foes, stance: Stance.Hold });
  // Ours faced south (spearmen south): the enemy is behind the mages.
  const ours0 = hpOf(army, army.ours);
  const foes0 = hpOf(army, army.foes);
  if (how !== "none") cmd(g, 0, { c: how, u: army.ours, x: a.x + 14, y: a.y + 13 });
  let done = -1;
  for (let t = 1; t <= 6 * 20; t++) {
    g.step();
    if (done < 0 && how !== "none" && t > 2 && settled(army)) done = t;
  }
  emit({ scene: "reform", how, gap, ticksToForm: done, ranks: ranks(army, { x: 0, y: -1 }), ourHpLost: ours0 - hpOf(army, army.ours), foeHpLost: foes0 - hpOf(army, army.foes) });
}

march("move");
march("retreat");
fight();
for (const gap of [4, 5, 6, 7, 8, 9, 10]) for (const how of ["retreat", "move", "none"] as const) reform(how, gap);
