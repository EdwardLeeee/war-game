// 每兵種上限 (D-083) on the real simulation: the screen reads the population ceiling from the
// snapshot's header (core's #195), as the Worker sends it, and a group may want that many of
// one type. Off, the ceiling is 120 as before; 量測's perf200 and perf360 hold it at 200 / 360.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Game } from "../../sim/src/core/game.ts";
import { POPULATION_200 } from "../../sim/src/core/rules.ts";
import { buildView, SnapshotEncoder } from "../../sim/src/view/view.ts";
import { emptyGame } from "../../sim/test/helpers.ts";
import { groupWantMax } from "../src/game/army.ts";
import { HeaderField as H, rules, TownState } from "../src/sim.ts";
import { GameView } from "../src/view/view.ts";

/** The screen of player 0 now, as the Worker would send it. */
function screen(g: Game): GameView {
  const m = g.w.map;
  const v = new GameView(0, { seed: m.seed, size: m.size, terrain: m.terrain.slice(), spawns: m.spawns, towns: m.towns }, rules());
  v.push(new SnapshotEncoder(g.w.nodeAmount.length).encode(buildView(g, 0), []), 0);
  return v;
}

/** What the 軍團畫面's ＋ goes up to, as Game.groupWantMax reads it. */
function wantMax(v: GameView): number {
  const ceiling = v.header?.[H.populationCeiling] ?? 0;
  return groupWantMax(v.rules, ceiling > 0 ? ceiling : null);
}

test("人口規則關著：天花板 120，每兵種上限 120（和以前的 rules 一樣）", () => {
  const v = screen(emptyGame());
  assert.equal(v.header?.[H.populationCeiling], 120);
  assert.equal(wantMax(v), 120);
});

test("量測的 perf200、perf360：天花板和每兵種上限 200／360", () => {
  for (const [scenario, n] of [["perf200", 200], ["perf360", 360]] as const) {
    const v = screen(new Game({ seed: 1, scenario }));
    assert.equal(v.header?.[H.populationCeiling], n, scenario);
    assert.equal(wantMax(v), n, scenario);
  }
});

test("人口規則開著：200，治理一座城鎮後跟著加（每兵種上限讀快照，不是 rules 的 200）", () => {
  const was = POPULATION_200.on;
  POPULATION_200.on = true;
  try {
    const g = emptyGame();
    assert.equal(wantMax(screen(g)), 200);
    const t = 0;
    g.w.townOwner[t] = 0;
    g.w.townState[t] = TownState.Governed;
    const v = screen(g);
    const ceiling = 200 + POPULATION_200.town[g.w.townSize[t]];
    assert.equal(v.header?.[H.populationCeiling], ceiling);
    assert.equal(wantMax(v), ceiling);
    assert.ok(ceiling > v.rules.maxPopulation, "more than the rules' 200");
  } finally {
    POPULATION_200.on = was;
  }
});
