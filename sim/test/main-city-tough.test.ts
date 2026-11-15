// D-141 (MAIN_CITY_TOUGH): a main city takes num / den of units' own attacks, summed each tick and the rest carried;
// siege stones in full; off, as before and out of the hash. city-watch.ts sees the fight and the fall. On at 2/5 (D-141).

import assert from "node:assert/strict";
import { test } from "node:test";
import { CityWatch } from "../src/city-watch.ts";
import { Game } from "../src/core/game.ts";
import { MAIN_CITY_TOUGH, SIEGE, UNITS, rules } from "../src/core/rules.ts";
import { CELL_SHIFT, UnitType } from "../src/protocol.ts";
const S = 20;

/** `body` with MAIN_CITY_TOUGH on at num / den. */
function tough<T>(num: number, den: number, body: () => T): T {
  const was = { ...MAIN_CITY_TOUGH };
  Object.assign(MAIN_CITY_TOUGH, { on: true, num, den });
  try {
    return body();
  } finally {
    Object.assign(MAIN_CITY_TOUGH, was);
  }
}

/** `body` with MAIN_CITY_TOUGH off (as before D-141). */
function off<T>(body: () => T): T {
  const was = MAIN_CITY_TOUGH.on;
  MAIN_CITY_TOUGH.on = false;
  try {
    return body();
  } finally {
    MAIN_CITY_TOUGH.on = was;
  }
}

/** `army` of player 0's at player 1's main city (its other units gone), sent at it; the city's hp each tick until it falls or `ticks` pass. */
function siege(army: [UnitType, number][], ticks: number): { g: Game; hp: number[]; watch: CityWatch } {
  const g = new Game({ seed: 1, scenario: "standard", maxTicks: 0 });
  const w = g.w;
  const u = w.units.col;
  const b = w.buildings.col;
  for (let s = 0; s < w.units.count; s++) w.unitSlot[u.id[s]] = -1;
  w.units.count = 0;
  const city = w.mainCity(1);
  const cityId = b.id[city];
  const cx = b.cellX[city];
  const cy = b.cellY[city];
  const ids: number[] = [];
  let k = 0;
  for (const [type, n] of army) for (let i = 0; i < n; i++, k++) ids.push(w.addUnit(0, type, ((cx - 2 + (k % 8)) << CELL_SHIFT) + 512, ((cy + 8 + Math.trunc(k / 8)) << CELL_SHIFT) + 512, UNITS[type].hp));
  g.fog.update(w);
  g.push({ c: "move", u: ids, x: cx + 1, y: cy + 5, t: g.tick, p: 0, seq: 0 } as never);
  const watch = new CityWatch();
  const hp: number[] = [];
  for (let t = 0; t < ticks && !w.over; t++) {
    g.step();
    watch.tick(w);
    const s = w.building(cityId);
    hp.push(s >= 0 ? b.hp[s] : 0);
  }
  return { g, hp, watch };
}

test("on: units' attacks on a main city at num / den, the rest carried, so 30 cavalry take it about den times as long", () => {
  const fall = (army: [UnitType, number][]) => {
    const { hp } = siege(army, 400 * S);
    const first = hp.findIndex((h) => h < 1200);
    const down = hp.indexOf(0);
    return down < 0 ? -1 : down - first;
  };
  const before = off(() => fall([[UnitType.Cavalry, 30]]));
  const on = tough(1, 10, () => fall([[UnitType.Cavalry, 30]]));
  assert.ok(before > 0 && before < 15 * S, `off: ${before} ticks`);
  assert.ok(on > 8 * before && on < 12 * before, `1/10: ${on} ticks against ${before}`);
});

test("on: the carried rest makes every point count (one spearman's 6 a hit at 1/4: 1.5 a hit, not 1)", () => {
  // The same spearman in the same scene (the city's arrows end it at the same time): a quarter of what it did off, not
  // a sixth (6 a hit rounded down to 1).
  const lost = () => {
    const { hp } = siege([[UnitType.Spearman, 1]], 60 * S);
    return 1200 - hp[hp.length - 1];
  };
  const before = off(lost);
  const on = tough(1, 4, lost);
  assert.ok(before >= 60, `off: ${before}`);
  assert.ok(Math.abs(on - before / 4) <= 1, `1/4: ${on} against ${before}`);
});

test("on: siege stones in full (SIEGE.vsBuildings), as fast as off", () => {
  const fall = () => {
    const { hp } = siege([[UnitType.Siege, 4]], 120 * S);
    return hp.indexOf(0);
  };
  assert.equal(SIEGE.on, true);
  const before = off(fall);
  assert.ok(before > 0);
  assert.equal(tough(1, 10, fall), before);
});

test("default: on at 2/5 (D-141); 30 cavalry take an unguarded main city in about 16 s, toughRem in the hash", () => {
  assert.deepEqual({ ...MAIN_CITY_TOUGH }, { on: true, num: 2, den: 5 });
  assert.equal(rules().features.mainCityTough, true);
  assert.deepEqual(rules().mainCityTough, [2, 5]);
  assert.equal(off(() => rules().features.mainCityTough), undefined);
  const { g, watch } = siege([[UnitType.Cavalry, 30]], 120 * S);
  assert.ok(g.w.over && g.w.winner === 0, "fell");
  const held = watch.result(g.w).fights[0][0].heldSecs;
  assert.ok(held > 12 && held < 20, `held ${held} s`);
  const h = g.hash();
  const b = g.w.buildings.col;
  for (let s = 0; s < g.w.buildings.count; s++) b.toughRem[s] += 3;
  assert.notEqual(g.hash(), h);
});

test("off: as before, toughRem out of the hash; the city watch sees the fight and its fall", () =>
  off(() => {
    const { g, watch } = siege([[UnitType.Cavalry, 30]], 120 * S);
    assert.ok(g.w.over && g.w.winner === 0, "fell");
    const fights = watch.result(g.w).fights;
    assert.equal(fights[0].length, 1);
    assert.equal(fights[0][0].fell, true);
    assert.ok(fights[0][0].heldSecs > 0 && fights[0][0].heldSecs < 15, `held ${fights[0][0].heldSecs} s`);
    assert.equal(fights[1].length, 0);
    const h = g.hash();
    const b = g.w.buildings.col;
    for (let s = 0; s < g.w.buildings.count; s++) b.toughRem[s] += 3;
    assert.equal(g.hash(), h);
  }));
