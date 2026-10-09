// 第七輪 on the real simulation, every switch on (ceo 2026-10-07: 上線前用真 sim 驗). The
// simulation runs as in the Worker: buildView + SnapshotEncoder into the screen's GameView, so
// what is checked is what the screen reads. The commands are the ones the screen builds
// (garrisonTap, 全部出來's leave, build, train).

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Game } from "../../sim/src/core/game.ts";
import { TOWNS } from "../../sim/src/core/rules.ts";
import { buildView, SnapshotEncoder } from "../../sim/src/view/view.ts";
import { cmd, emptyGame, openArea, put, run, slotOf } from "../../sim/test/helpers.ts";
import { GROUP_TYPES, isSoldier } from "../src/game/army.ts";
import { counterLines } from "../src/game/counters.ts";
import { buildable, features, garrisonTypes, holdsOf, missingFor } from "../src/game/features.ts";
import { garrisonTap, isHiding } from "../src/game/garrison.ts";
import {
  Action,
  BUILDING_STRIDE,
  BuildingField as B,
  BuildingFlag,
  BuildingType,
  checkPlacement,
  NEUTRAL,
  Reject,
  Resource,
  rules,
  TownChoice,
  TownSize,
  TownState,
  UnitType,
} from "../src/sim.ts";
import { UNIT_NAME } from "../src/ui/hud/names.ts";
import { rejectText } from "../src/ui/overlays.ts";
import { towerLandOk } from "../src/ui/placement.ts";
import { GameView } from "../src/view/view.ts";

/** The screen of player p after the ticks run so far, as the Worker would send it. */
function screen(g: Game, p = 0): GameView {
  const m = g.w.map;
  const v = new GameView(p, { seed: m.seed, size: m.size, terrain: m.terrain.slice(), spawns: m.spawns, towns: m.towns }, rules());
  const events = g.events.filter((e) => e.to === -1 || e.to === p).map((e) => e.ev);
  v.push(new SnapshotEncoder(g.w.nodeAmount.length).encode(buildView(g, p), events), 0);
  return v;
}

const rejections = (g: Game, p: number) => g.events.filter((e) => e.to === p && e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason);

/** A building's row as the screen has it. */
function row(v: GameView, id: number): Int32Array {
  const b = v.curr?.snap.buildings;
  const o = v.buildingRow(id);
  if (b === undefined || o < 0) throw new Error(`building ${id} not on screen`);
  return b.subarray(o, o + BUILDING_STRIDE);
}

test("開關：第七輪的四個開關都開著，畫面照 rules 顯示箭樓、馬廄、躲進去", () => {
  const r = rules();
  // Each of round 7's four on its own: later rounds add switches of their own (哨所, D-080).
  const f = features(r);
  for (const key of ["plunderOnce", "towers", "garrison", "cavalry"] as const) assert.equal(f[key], true, key);
  assert.equal(buildable(r, BuildingType.ArrowTower), true);
  assert.equal(buildable(r, BuildingType.Stable), true);
  assert.deepEqual(garrisonTypes(r), [UnitType.Ranged, UnitType.Mage]);
  assert.equal(holdsOf(r, BuildingType.MainCity), 6);
  assert.equal(holdsOf(r, BuildingType.ArrowTower), 3);
});

test("城鎮只能搶一次：搶過的城鎮再攻下，畫面只給治理；硬送搶，模擬回 AlreadyPlundered，畫面說明原因", () => {
  const T = 0;
  const small = TOWNS[TownSize.Small];
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  const u = g.w.units.col;
  // Take the small town 0 (its militia gone) with one tough spearman.
  const take = (): number => {
    for (let s = 0; s < g.w.units.count; s++) if (u.owner[s] === NEUTRAL && u.home[s] === T) u.hp[s] = 0;
    const spear = put(g, 0, UnitType.Spearman, g.w.townX[T] + 1, g.w.townY[T]);
    u.hp[slotOf(g, spear)] = 100000;
    run(g, 3);
    assert.equal(g.w.townState[T], TownState.AwaitingChoice);
    return spear;
  };
  const first = take();
  assert.equal(screen(g).townPlunderedOnce(T), false, "never plundered: 搶 is offered");
  cmd(g, 0, { c: "town_choice", town: T, choice: TownChoice.Plunder });
  run(g, small.plunderTicks + 2);
  u.hp[slotOf(g, first)] = 0;
  run(g, small.ruinsTicks + 1);
  assert.equal(g.w.townState[T], TownState.Neutral);
  take();
  assert.equal(screen(g).townPlunderedOnce(T), true, "plundered this game: only 治理");
  const plunder = { c: "town_choice", town: T, choice: TownChoice.Plunder } as const;
  cmd(g, 0, plunder);
  g.step();
  assert.deepEqual(rejections(g, 0), [Reject.AlreadyPlundered]);
  assert.equal(rejectText(Reject.AlreadyPlundered, plunder), "這座城這局已經被搶過，只能治理");
  assert.equal(g.w.townState[T], TownState.AwaitingChoice, "still waiting for 治理");
});

test("箭樓只能蓋在 TowerLand：畫面的 towerLandOk 和模擬一致，主城旁蓋得成，遠處被拒", () => {
  const g = emptyGame();
  g.w.res[Resource.Wood] = 1000;
  g.w.res[Resource.Gold] = 1000;
  const city = g.w.mainCity(0);
  const b = g.w.buildings.col;
  const cx = b.cellX[city];
  const cy = b.cellY[city];
  // A villager to build, and a scout far out so the ground there is explored.
  put(g, 0, UnitType.Farmer, cx - 1, cy + 5);
  put(g, 0, UnitType.Spearman, cx + 16, cy + 2);
  g.fog.update(g.w);
  const v = screen(g);
  const grid = v.placement;
  if (grid === null) throw new Error("no placement grid");
  const tower = rules().buildings[BuildingType.ArrowTower];
  const house = rules().buildings[BuildingType.House];
  // Open ground near the city that is TowerLand, and open ground far out that is not.
  let near: { x: number; y: number } | null = null;
  let far: { x: number; y: number } | null = null;
  for (let r = 1; r < 20 && (near === null || far === null); r++) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (checkPlacement(grid, house, x, y) !== 0) continue;
        if (near === null && towerLandOk(grid, tower, x, y)) near = { x, y };
        if (far === null && !towerLandOk(grid, tower, x, y)) far = { x, y };
      }
    }
  }
  if (near === null || far === null) throw new Error(`spots: near ${JSON.stringify(near)}, far ${JSON.stringify(far)}`);
  // The screen's check agrees with the simulation's.
  assert.equal(checkPlacement(grid, tower, near.x, near.y), 0);
  assert.notEqual(checkPlacement(grid, tower, far.x, far.y), 0);
  const towers = () => [...Array(g.w.buildings.count).keys()].filter((s) => b.owner[s] === 0 && b.type[s] === BuildingType.ArrowTower).length;
  cmd(g, 0, { c: "build", u: [], type: BuildingType.ArrowTower, x: far.x, y: far.y });
  g.step();
  assert.deepEqual(rejections(g, 0), [Reject.BadPlacement], "off TowerLand");
  assert.equal(towers(), 0);
  cmd(g, 0, { c: "build", u: [], type: BuildingType.ArrowTower, x: near.x, y: near.y });
  g.step();
  assert.deepEqual(rejections(g, 0), [], "on TowerLand");
  assert.equal(towers(), 1);
});

test("躲進去、全部出來：畫面送的 garrison 只帶遠程兵和法師；躲好後畫面讀到躲著、人數、記號，敵人只看到有人；leave 後全部出來", () => {
  const g = emptyGame();
  const city = g.w.mainCity(0);
  const b = g.w.buildings.col;
  const cityId = b.id[city];
  const cx = b.cellX[city];
  const cy = b.cellY[city];
  const ranged = [put(g, 0, UnitType.Ranged, cx + 6, cy), put(g, 0, UnitType.Ranged, cx + 6, cy + 1)];
  const mage = put(g, 0, UnitType.Mage, cx + 6, cy + 2);
  const spear = put(g, 0, UnitType.Spearman, cx + 6, cy + 3);
  // An enemy scout who sees the city (and stands still).
  put(g, 1, UnitType.Spearman, cx - 4, cy + 1);
  g.fog.update(g.w);
  const v = screen(g);
  const r = garrisonTap(
    [...ranged, mage, spear].sort((a, c) => a - c),
    { id: cityId, owner: 0, type: BuildingType.MainCity, done: true },
    0,
    (id) => garrisonTypes(v.rules).includes(v.unitType(id)),
    (type) => holdsOf(v.rules, type),
  );
  assert.ok("cmd" in r);
  assert.deepEqual(r.cmd, { c: "garrison", u: [...ranged, mage].sort((a, c) => a - c), building: cityId });
  cmd(g, 0, r.cmd);
  const u = g.w.units.col;
  for (let t = 0; t < 400 && ![...ranged, mage].every((id) => u.action[slotOf(g, id)] === Action.Garrisoned); t++) g.step();
  const inside = screen(g);
  for (const id of [...ranged, mage]) assert.equal(isHiding(inside.unitOrder(id)), true, `unit ${id} hides`);
  assert.equal(isHiding(inside.unitOrder(spear)), false, "the spearman stays out");
  assert.equal(row(inside, cityId)[B.soldiers], 3, "躲了 3 名士兵");
  assert.equal(row(inside, cityId)[B.flags] & BuildingFlag.Occupied, BuildingFlag.Occupied);
  const enemy = screen(g, 1);
  assert.equal(row(enemy, cityId)[B.flags] & BuildingFlag.Occupied, BuildingFlag.Occupied, "裡面有人");
  assert.equal(row(enemy, cityId)[B.soldiers], 0, "not how many");
  // 全部出來.
  cmd(g, 0, { c: "leave", building: cityId });
  run(g, 3);
  const out = screen(g);
  for (const id of [...ranged, mage]) assert.equal(isHiding(out.unitOrder(id)), false, `unit ${id} came out`);
  assert.equal(row(out, cityId)[B.soldiers], 0);
  assert.deepEqual(rejections(g, 0), []);
});

test("馬廄訓練出騎兵：畫面算騎兵是士兵、軍團畫面有這一列；兵種相剋讀到遠程打騎兵的倍數", () => {
  const g = emptyGame();
  g.w.res[Resource.Food] = 1000;
  g.w.res[Resource.Gold] = 1000;
  const spot = openArea(g, 3);
  const stable = g.w.buildings.col.id[g.w.building(g.w.addBuilding(0, BuildingType.Stable, spot.x, spot.y, rules().buildings[BuildingType.Stable].hp, 1000))];
  put(g, 0, UnitType.Farmer, spot.x - 1, spot.y);
  g.fog.update(g.w);
  assert.deepEqual(missingFor(rules(), BuildingType.Stable, screen(g).ownFinishedTypes()), [], "nothing to build first");
  cmd(g, 0, { c: "train", building: stable, type: UnitType.Cavalry, n: 1 });
  let cavalry = -1;
  for (let t = 0; t < 3000 && cavalry < 0; t++) {
    g.step();
    const trained = g.events.find((e) => e.to === 0 && e.ev.k === "unit_trained" && e.ev.type === UnitType.Cavalry);
    if (trained !== undefined) cavalry = (trained.ev as { id: number }).id;
  }
  assert.ok(cavalry >= 0, "a cavalry unit trained");
  const v = screen(g);
  assert.equal(v.unitType(cavalry), UnitType.Cavalry);
  assert.equal(isSoldier(v.unitType(cavalry)), true);
  assert.ok(GROUP_TYPES.includes(UnitType.Cavalry));
  assert.equal(UNIT_NAME[UnitType.Cavalry], "騎兵");
  const lines = counterLines(v.rules, UNIT_NAME);
  assert.ok(lines.find((l) => l.type === UnitType.Ranged)?.beats.includes("騎兵 ×1.8"));
  assert.ok(lines.find((l) => l.type === UnitType.Cavalry)?.fears.includes("遠程兵 ×1.8"));
});
