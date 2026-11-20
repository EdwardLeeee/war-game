// 進駐 (D-124, D-125; R13-01 B): what a building's tag says and whom it sends, and where the tags and
// arrows go (R13-01-B2's rules).

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildingPlan, enterNowhereText, enterOn, enterPlaceAt, type EnterSpot, townPlan, walkingTo, whoText, withoutUnits } from "../src/game/enter.ts";
import type { Intent } from "../src/input/intent.ts";
import { around, edgeArrows, hit, placeTags, tappedItem, type TagItem } from "../src/ui/enter-tags.ts";
import { type Rules, UnitType } from "../src/sim.ts";

const S = UnitType.Spearman;
const R = UnitType.Ranged;
const M = UnitType.Mage;
const soldier = (id: number, type: number, x = 0, y = 0) => ({ id, type, x, y });
/** R13-01's mixed squad: 6 spearmen, 4 ranged, 2 mages. */
const squad = [...[1, 2, 3, 4, 5, 6].map((id) => soldier(id, S, id, 0)), ...[7, 8, 9, 10].map((id) => soldier(id, R, id, 0)), soldier(11, M, 11, 0), soldier(12, M, 12, 0)];
const HIDES = [R, M];

test("誰：照槍兵、遠程、法師、騎兵、攻城砲的順序寫幾名", () => {
  assert.equal(whoText([R, S, S, M, R]), "槍兵 2・遠程 2・法師 1");
  assert.equal(whoText([]), "");
});

test("主城、箭樓（R13-01 狀態 4、5）：進遠程和法師、留槍兵；空位不夠時進最近的 N 名；滿了是灰的；只選槍兵是灰的「槍兵進不去」", () => {
  const city = { name: "主城", x: 0, y: 0, cap: 6, room: 6 };
  const p = buildingPlan(squad, city, HIDES);
  assert.deepEqual(p.go, [7, 8, 9, 10, 11, 12]);
  assert.equal(p.head, "進 遠程 4・法師 2");
  assert.equal(p.sub, "留 槍兵 6");
  assert.equal(p.chip, "進 6");
  assert.equal(p.off, false);
  // A tower with room for 2: the 2 nearest it (at x 9.5: 9 and 10), whatever the id.
  const tower = buildingPlan(squad, { name: "箭樓", x: 9.5, y: 0, cap: 3, room: 2 }, HIDES);
  assert.deepEqual(tower.go, [9, 10]);
  assert.equal(tower.head, "進 最近的 2 名");
  assert.equal(tower.sub, "留 10 名");
  // Full.
  const full = buildingPlan(squad, { name: "箭樓", x: 0, y: 0, cap: 3, room: 0 }, HIDES);
  assert.equal(full.off, true);
  assert.equal(full.head, "滿了 3/3");
  assert.equal(full.why, "箭樓滿了（最多 3 名），沒有人進去");
  assert.deepEqual(full.go, []);
  // Spearmen only (R13-01 狀態 3).
  const spears = buildingPlan(squad.slice(0, 6), city, HIDES);
  assert.equal(spears.off, true);
  assert.equal(spears.head, "槍兵進不去");
  assert.equal(spears.why, "槍兵進不去主城");
});

test("哨所：只進槍兵（9 名），其他留下", () => {
  const p = buildingPlan(squad, { name: "哨所", x: 0, y: 0, cap: 9, room: 9 }, [S]);
  assert.deepEqual(p.go, [1, 2, 3, 4, 5, 6]);
  assert.equal(p.head, "進 槍兵 6");
  assert.equal(p.sub, "留 遠程 4・法師 2");
  assert.equal(buildingPlan(squad.slice(6), { name: "哨所", x: 0, y: 0, cap: 9, room: 9 }, [S]).head, "遠程、法師進不去");
});

test("自己的城：整個編隊進去，遠程、法師上牆；別的城要留守的不來；都已經在這座城就是灰的", () => {
  const p = townPlan(squad, 0, true);
  assert.equal(p.head, "進 12 名全進城");
  assert.equal(p.sub, "遠程、法師上牆");
  assert.equal(p.go.length, 12);
  assert.equal(townPlan(squad.slice(0, 6), 0, true).sub, null, "只有槍兵：沒人上牆");
  const kept = townPlan(squad.slice(0, 9), 3, true);
  assert.equal(kept.head, "進 9 名");
  assert.equal(kept.sub, "原本的城留 3 名");
  const here = townPlan([], 0, true);
  assert.equal(here.off, true);
  assert.equal(here.why, "他們已經駐守在這座城");
  assert.equal(townPlan([], 2, true).why, "城裡的 2 名都要留下守城");
});

test("沒有地方可以進駐（B2 規則 12）：照選的兵種說；有滿的就說滿了", () => {
  const rules = { features: { plunderOnce: true, towers: true, garrison: true, cavalry: true, outpost: true, walls: true }, garrisonTypes: [R, M], outpost: { slots: 9, reach: 8, chase: 12 } } as unknown as Pick<Rules, "features" | "garrisonTypes" | "outpost">;
  assert.equal(enterNowhereText([S], false, rules), "選的兵沒有地方可以進駐：槍兵只能進自己的城和哨所");
  assert.equal(enterNowhereText([S, R], false, rules), "選的兵沒有地方可以進駐：槍兵只能進自己的城和哨所，遠程只能進自己的城、主城和箭樓");
  assert.equal(enterNowhereText([R], true, rules), "選的兵沒有地方可以進駐：能進的都滿了");
  assert.equal(enterOn(rules), true);
  assert.equal(enterOn(null), false, "開關都關著：沒有進駐鈕");
});

const item = (id: string, cx: number, cy: number, o: Partial<TagItem> = {}): TagItem => ({ id, cx, cy, hw: 30, hh: 15, top: cy - 60, w: 100, h: 40, cw: 40, ch: 20, off: false, say: id, ...o });
const FRAME = { x: 0, y: 0, w: 814, h: 380 };

test("標籤（B2 規則 1–5）：放在屋頂上；彼此不疊、不蓋介面；擠時同內容的只留最近的完整標籤，其他變小籤；移開超過 14 pt 拉引線", () => {
  const out = placeTags([item("a", 300, 200), item("b", 330, 205)], [], FRAME, [270, 300]);
  const a = out.get("a");
  const b = out.get("b");
  assert.ok(a !== undefined && b !== undefined && a.box !== null && b.box !== null);
  assert.equal(a.mode, "full");
  assert.equal(a.leader, false, "最近的放在原位");
  assert.ok(!hit(a.box, b.box), "不疊");
  // The same kind saying the same: the nearer full, the other a small tag.
  const same = placeTags([item("near", 300, 200, { say: "箭樓進3" }), item("far", 500, 200, { say: "箭樓進3" })], [], FRAME, [300, 300]);
  assert.equal(same.get("near")?.mode, "full");
  assert.equal(same.get("far")?.mode, "chip");
  // Pushed by the interface: moved, with a line.
  const pushed = placeTags([item("c", 300, 200)], [{ x: 200, y: 100, w: 220, h: 80 }], FRAME, [300, 300]).get("c");
  assert.ok(pushed?.box !== null && pushed?.box !== undefined && !hit(pushed.box, { x: 200, y: 100, w: 220, h: 80 }, 2));
  assert.equal(pushed?.leader, true);
  // The grey ones give way first: with 3 placed already they keep only the ring.
  const many = placeTags([item("1", 100, 200), item("2", 300, 200), item("3", 500, 200), item("x", 700, 200, { off: true })], [], FRAME, [400, 300]);
  assert.equal(many.get("x")?.mode, "ring");
});

test("畫面外（B2 規則 7–9）：沿可見範圍的邊放箭頭、指向建築；同一種建築在邊上 70 pt 內合成一個（×2），人數寫最近那棟", () => {
  const free = { x: 80, y: 100, w: 620, h: 160 };
  const arrows = edgeArrows(
    [
      { id: "t1", name: "大城", x: 400, y: -300, d: 600, short: "進 12 名" },
      { id: "a1", name: "箭樓", x: 1100, y: 150, d: 700, short: "進 3 名" },
      { id: "a2", name: "箭樓", x: 1150, y: 170, d: 750, short: "進 2 名" },
    ],
    free,
    [],
    FRAME,
    [104, 44],
  );
  assert.equal(arrows.length, 2);
  const towers = arrows.find((a) => a.name === "箭樓");
  assert.equal(towers?.n, 2);
  assert.equal(towers?.short, "進 3 名", "最近那棟");
  for (const a of arrows) {
    assert.ok(a.box !== null);
    if (a.box === null) continue;
    assert.ok(a.box.x >= 0 && a.box.x + a.box.w <= 814 && a.box.y >= 0 && a.box.y + a.box.h <= 380);
  }
  const city = arrows.find((a) => a.name === "大城");
  assert.ok(city?.box !== null && city?.box !== undefined && city.box.y <= free.y + 1, "上面的建築：箭頭在上邊");
});

test("點（B2 規則 1）：標籤、小籤、金框都算點到那棟，至少 44 pt；重疊時算離手指最近的；城裡的建築比整座城先", () => {
  const tower = { id: "a", box: { x: 100, y: 100, w: 40, h: 20 }, cx: 120, cy: 160, hw: 20, hh: 10, big: false };
  const town = { id: "t", box: null, cx: 200, cy: 200, hw: 150, hh: 80, big: true };
  // The small tag is 40 × 20, but a finger 12 pt below it still counts (44 pt across).
  assert.equal(tappedItem([tower, town], 120, 128), "a");
  assert.equal(tappedItem([tower, town], 120, 160), "a", "箭樓的框在城裡：箭樓");
  assert.equal(tappedItem([tower, town], 260, 220), "t");
  assert.equal(tappedItem([tower, town], 700, 50), null);
  assert.deepEqual(around(10, 10, 4, 2), { x: 8, y: 9, w: 4, h: 2 });
});

// The mouse's right click (R26 06 a, ceo 2026-11-20): 「右鍵點自己能進駐的地方：進得去的進駐，進不去的走到旁邊」.

test("右鍵點的地方：看到的那棟是能進的建築就是它；否則是框住那一點的城（城裡的箭樓先算箭樓）；都不是就沒有", () => {
  const box = (x0: number, y0: number, x1: number, y1: number) => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  const places: EnterSpot[] = [
    { id: "t7", kind: "town", corners: box(0, 0, 100, 100) },
    { id: "b20", kind: "hide", building: 20, corners: box(40, 40, 60, 60) },
    { id: "b30", kind: "post", building: 30, corners: box(200, 0, 230, 30) },
  ];
  assert.equal(enterPlaceAt(places, 20, 50, 50), "b20", "a tower in the town: the tower");
  assert.equal(enterPlaceAt(places, 30, 210, 10), "b30");
  assert.equal(enterPlaceAt(places, null, 10, 90), "t7", "the town's ground");
  assert.equal(enterPlaceAt(places, 99, 10, 90), "t7", "a building of the town no one goes into (its keep, a wall): the town");
  assert.equal(enterPlaceAt(places, null, 100, 50), null, "just outside the box");
  assert.equal(enterPlaceAt(places, null, 150, 150), null);
  assert.equal(enterPlaceAt(places, 20, 150, 150), "b20", "its picture seen above its footprint: still it");
});

test("右鍵：走到點的那一格的（移動、村民的 move）才換成進駐；去掉進去的人，沒人的指令拿掉", () => {
  const out: Intent[] = [
    { kind: "command", cmd: { c: "retreat", u: [1, 2, 3], x: 5, y: 6 } },
    { kind: "command", cmd: { c: "move", u: [9], x: 5, y: 6 } },
    { kind: "command", cmd: { c: "gather", u: [10], node: 4 } },
  ];
  assert.deepEqual(walkingTo(out, 5, 6), [1, 2, 3, 9]);
  assert.deepEqual(walkingTo(out, 5, 7), []);
  assert.deepEqual(walkingTo([{ kind: "command", cmd: { c: "attack", u: [1], target: 3 } }], 5, 6), []);
  assert.deepEqual(withoutUnits(out, [2, 3, 9]), [
    { kind: "command", cmd: { c: "retreat", u: [1], x: 5, y: 6 } },
    { kind: "command", cmd: { c: "gather", u: [10], node: 4 } },
  ]);
});

test("滿了才標 full（右鍵點滿了的要說）；這種兵進不去、已經在城裡、都要留下守城不標", () => {
  const tower = { name: "箭樓", x: 0, y: 0, cap: 3, room: 0 };
  assert.equal(buildingPlan(squad, tower, HIDES).full, true);
  assert.equal(buildingPlan(squad.filter((s) => s.type === S), { ...tower, room: 3 }, HIDES).full, false);
  assert.equal(buildingPlan(squad, { ...tower, room: 3 }, HIDES).full, false);
  assert.equal(townPlan([], 0, true).full, false);
  assert.equal(townPlan([], 4, true).full, false);
});
