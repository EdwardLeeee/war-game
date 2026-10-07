// D-072 (scripted player's `race`): the race sets out straight at the enemy's main city once it
// sees the enemy's army coming on its half of the map (sentry), or with enough soldiers by the
// user's way (edge); once out it does not come home, enemies at home or not.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createScriptedPlayer, type Plan, planFor } from "../src/ai/scripted-player.ts";
import { rules } from "../src/core/rules.ts";
import { type CommandBody, UnitType } from "../src/protocol.ts";
import { buildView } from "../src/view/view.ts";
import { emptyGame, put } from "./helpers.ts";

type G = ReturnType<typeof emptyGame>;

function scene(race: Plan["race"], soldiers: number) {
  const g = emptyGame();
  const w = g.w;
  const plan = planFor("push", "h1", "close");
  plan.corners = true;
  plan.race = race;
  plan.pushAt = 0;
  const ids: number[] = [];
  for (let k = 0; k < soldiers; k++) ids.push(put(g, 0, UnitType.Spearman, 19 + (k % 6), 72 + Math.trunc(k / 6)));
  g.fog.update(w);
  const player = createScriptedPlayer(0, { map: w.map, rules: rules(), frame: w.map.frames[0] }, plan);
  return { g, w, ids, player };
}

/** Moves of (most of) the army: their target cells. */
const marches = (out: CommandBody[], ids: number[]) =>
  out.filter((c) => c.c === "move" && (c as { u: number[] }).u.length >= ids.length - 1).map((c) => [(c as { x: number }).x, (c as { y: number }).y]);

/** Enemy soldiers at (x, y) and onward, on player 0's half of the map. */
function enemies(g: G, n: number, x: number, y: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(put(g, 1, UnitType.Spearman, x + (k % 5), y + Math.trunc(k / 5)));
  g.fog.update(g.w);
  return out;
}

function moveAll(g: G, ids: number[], dx: number, dy: number): void {
  const u = g.w.units.col;
  for (const id of ids) {
    const s = g.w.unit(id);
    u.x[s] += dx << 10;
    u.y[s] += dy << 10;
  }
  g.fog.update(g.w);
}

test("sentry: seeing the enemy's army coming on our half, the army sets out for the enemy's main city; without the race it defends", () => {
  for (const race of ["sentry", ""] as const) {
    const { g, w, ids, player } = scene(race, 16);
    const foes = enemies(g, 14, 19, 66);
    player.think(buildView(g, 0));
    moveAll(g, foes, -1, 1);
    const out = player.think(buildView(g, 0));
    const enemyHome = w.map.spawns[1];
    const toEnemy = marches(out, ids).some(([x, y]) => x === enemyHome.cellX && y === enemyHome.cellY);
    assert.equal(toEnemy, race === "sentry", race === "sentry" ? "set out" : "no race: it stays");
    if (race === "sentry") assert.equal(player.state().mode, "race");
  }
});

test("once out, enemies at home do not call it back", () => {
  const { g, w, ids, player } = scene("sentry", 16);
  const foes = enemies(g, 14, 19, 66);
  const all: CommandBody[] = [...player.think(buildView(g, 0))];
  moveAll(g, foes, -1, 1);
  all.push(...player.think(buildView(g, 0)));
  assert.equal(player.state().mode, "race");
  // The enemy now stands at our main city.
  moveAll(g, foes, -3, 7);
  const out = player.think(buildView(g, 0));
  all.push(...out);
  const home = w.map.spawns[0];
  const backHome = marches(out, ids).some(([x, y]) => (x - home.cellX) ** 2 + (y - home.cellY) ** 2 <= 10 * 10);
  assert.equal(backHome, false);
  assert.equal(player.state().mode, "race");
  assert.ok(all.some((c) => c.c === "recall" && (c as { on: boolean }).on), "the farmers go inside");
});

test("edge: with 30 soldiers it sets out beside the far corner town, not straight", () => {
  const { g, ids, player } = scene("edge", 30);
  const out = player.think(buildView(g, 0));
  assert.deepEqual(marches(out, ids), [[76, 76]]);
  assert.equal(player.state().raced, g.w.tick);
});
