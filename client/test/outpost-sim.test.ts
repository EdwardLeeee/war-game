// 哨所 (D-080) on the real simulation with its rules on (core's PR B, #185). The simulation runs
// as in the Worker: buildView + SnapshotEncoder into the screen's GameView, so what is checked is
// what the screen reads. The commands are the ones the screen builds (＋槍兵's pick, 駐守's tap,
// 攻擊／堅守, 全部離開).

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Game } from "../../sim/src/core/game.ts";
import { buildView, SnapshotEncoder } from "../../sim/src/view/view.ts";
import { cmd, emptyGame, openArea, put, run, slotOf } from "../../sim/test/helpers.ts";
import { buildable, features, outpostSlots } from "../src/game/features.ts";
import { type Callable, pickToHide } from "../src/game/garrison.ts";
import { isPosted, POST_TYPE, postTap } from "../src/game/outpost.ts";
import { BUILDING_STRIDE, BuildingField as B, BuildingFlag, BuildingType, CELL, checkPlacement, Order, Reject, rules, UnitField as U, UNIT_STRIDE, UnitType } from "../src/sim.ts";
import { towerLandOk } from "../src/ui/placement.ts";
import { GameView } from "../src/view/view.ts";

/** Off until core's PR B (#185) turns the outpost's rules on: then these run by themselves. */
const OFF = features(rules()).outpost === true ? false : "哨所的規則還關著（core #185 合併後才會跑）";

/** The screen of player p after the ticks run so far, as the Worker would send it. */
function screen(g: Game, p = 0): GameView {
  const m = g.w.map;
  const v = new GameView(p, { seed: m.seed, size: m.size, terrain: m.terrain.slice(), spawns: m.spawns, towns: m.towns }, rules());
  const events = g.events.filter((e) => e.to === -1 || e.to === p).map((e) => e.ev);
  v.push(new SnapshotEncoder(g.w.nodeAmount.length).encode(buildView(g, p), events), 0);
  return v;
}

const rejections = (g: Game, p: number) => g.events.filter((e) => e.to === p && e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason);

function row(v: GameView, id: number): Int32Array {
  const b = v.curr?.snap.buildings;
  const o = v.buildingRow(id);
  if (b === undefined || o < 0) throw new Error(`building ${id} not on screen`);
  return b.subarray(o, o + BUILDING_STRIDE);
}

/** Our soldiers as ＋槍兵 sees them (cells), as Game.callToHide builds them. */
function callables(v: GameView): Callable[] {
  const u = v.curr?.snap.units ?? new Int32Array(0);
  const out: Callable[] = [];
  for (let o = 0; o < u.length; o += UNIT_STRIDE) {
    if (u[o + U.owner] !== v.me) continue;
    const order = u[o + U.order];
    out.push({ id: u[o + U.id], type: u[o + U.type], x: u[o + U.x] / CELL, y: u[o + U.y] / CELL, idle: order === Order.None, hiding: order === Order.Garrison || isPosted(order), stationed: false });
  }
  return out;
}

/** An outpost of ours, finished, on open ground, and spearmen around. */
function setup(): { g: Game; post: number; spot: { x: number; y: number }; spears: number[] } {
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  g.w.ecoOn[1] = 0;
  const spot = openArea(g, 12);
  const info = rules().buildings[BuildingType.Outpost];
  const post = g.w.buildings.col.id[g.w.building(g.w.addBuilding(0, BuildingType.Outpost, spot.x + 5, spot.y + 5, info.hp, 1000))];
  const spears = [0, 1, 2].map((k) => put(g, 0, UnitType.Spearman, spot.x + 1 + k, spot.y + 1));
  g.fog.update(g.w);
  return { g, post, spot, spears };
}

test("開關：哨所的規則開著，畫面的建造選單有哨所、每座 6 名", { skip: OFF }, () => {
  const r = rules();
  assert.equal(features(r).outpost, true);
  assert.equal(buildable(r, BuildingType.Outpost), true);
  assert.equal(outpostSlots(r), 6);
});

test("＋槍兵、駐守：畫面挑的人和送的 post，模擬照做；畫面讀到 posted、兵的 order 是 Post；別人看不到 posted", { skip: OFF }, () => {
  const { g, post, spot, spears } = setup();
  let v = screen(g);
  assert.equal(row(v, post)[B.posted], 0);
  // ＋槍兵: the nearest standing one.
  const first = pickToHide(callables(v), POST_TYPE, { cx: spot.x + 5, cy: spot.y + 5, size: rules().buildings[BuildingType.Outpost].size });
  assert.equal(first, spears[2], "nearest to the outpost");
  cmd(g, 0, { c: "post", u: [first], building: post });
  run(g, 2);
  v = screen(g);
  assert.equal(row(v, post)[B.posted], 1, "on his way counts");
  assert.equal(v.unitOrder(spears[2]), Order.Post);
  // 駐守 from the command area: the screen's tap with spearmen and a ranged unit selected sends the spearmen only.
  const ranged = put(g, 0, UnitType.Ranged, spot.x + 1, spot.y + 2);
  g.fog.update(g.w);
  v = screen(g);
  const r = postTap([spears[0], spears[1], ranged], { id: post, owner: 0, type: BuildingType.Outpost, done: true }, 0, (id) => v.unitType(id) === POST_TYPE);
  assert.ok("cmd" in r);
  assert.deepEqual(r.cmd, { c: "post", u: [spears[0], spears[1]], building: post });
  cmd(g, 0, r.cmd);
  run(g, 200);
  v = screen(g);
  assert.equal(row(v, post)[B.posted], 3);
  for (const id of spears) assert.ok(isPosted(v.unitOrder(id)), `spearman ${id} posted`);
  assert.equal(v.unitOrder(ranged), Order.None, "the ranged unit stays");
  // ＋槍兵 again: everyone is busy now.
  assert.equal(pickToHide(callables(v), POST_TYPE, { cx: spot.x + 5, cy: spot.y + 5, size: 2 }), null);
  // The enemy does not read how many.
  put(g, 1, UnitType.Spearman, spot.x + 9, spot.y + 5);
  g.fog.update(g.w);
  assert.equal(row(screen(g, 1), post)[B.posted], 0);
  assert.deepEqual(rejections(g, 0), []);
});

test("攻擊／堅守：outpost_mode 讓哨所帶 Hold（自己和看得到的敵人都讀得到）；全部離開：unpost 後 posted 0、兵待命", { skip: OFF }, () => {
  const { g, post, spot, spears } = setup();
  cmd(g, 0, { c: "post", u: spears, building: post });
  run(g, 100);
  put(g, 1, UnitType.Spearman, spot.x + 10, spot.y + 5);
  g.fog.update(g.w);
  assert.equal(row(screen(g), post)[B.flags] & BuildingFlag.Hold, 0, "attacking by default");
  cmd(g, 0, { c: "outpost_mode", building: post, hold: true });
  run(g, 2);
  assert.equal(row(screen(g), post)[B.flags] & BuildingFlag.Hold, BuildingFlag.Hold);
  assert.equal(row(screen(g, 1), post)[B.flags] & BuildingFlag.Hold, BuildingFlag.Hold, "the enemy sees it hold");
  cmd(g, 0, { c: "outpost_mode", building: post, hold: false });
  run(g, 2);
  assert.equal(row(screen(g), post)[B.flags] & BuildingFlag.Hold, 0);
  cmd(g, 0, { c: "unpost", building: post });
  run(g, 2);
  const v = screen(g);
  assert.equal(row(v, post)[B.posted], 0);
  for (const id of spears) assert.equal(v.unitOrder(id), Order.None, `spearman ${id} off guard`);
  // Nobody left: 全部離開 again is refused (the button is greyed for it).
  cmd(g, 0, { c: "unpost", building: post });
  g.step();
  assert.deepEqual(rejections(g, 0), [Reject.NotAvailable]);
  assert.equal(slotOf(g, spears[0]) >= 0, true);
});

test("箭樓可以蓋在自己蓋好的哨所旁：畫面的 towerLandOk 和模擬一致", { skip: OFF }, () => {
  const { g, post, spot } = setup();
  const v = screen(g);
  const grid = v.placement;
  if (grid === null) throw new Error("no placement grid");
  const tower = rules().buildings[BuildingType.ArrowTower];
  const o = row(v, post);
  // Right beside the outpost, and far beyond its reach.
  const near = { x: o[B.cellX] + 3, y: o[B.cellY] };
  assert.equal(checkPlacement(grid, tower, near.x, near.y), 0, "open ground");
  assert.equal(towerLandOk(grid, tower, near.x, near.y), true, "TowerLand by the outpost");
  g.w.res[1] = 1000;
  g.w.res[2] = 1000;
  put(g, 0, UnitType.Farmer, spot.x + 2, spot.y + 8);
  cmd(g, 0, { c: "build", u: [], type: BuildingType.ArrowTower, x: near.x, y: near.y });
  g.step();
  assert.deepEqual(rejections(g, 0), []);
});
