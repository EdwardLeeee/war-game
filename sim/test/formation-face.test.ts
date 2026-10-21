// The way a re-formed formation faces (D-095; the `formation` command's `face`, PROTOCOL.md 3):
// standing units re-form where they stand facing `face` (spearmen on that side, then ranged, then
// mages), the middle where it was; a group on its way re-forms at its goal facing it; without
// `face` as before; mirror-image commands give mirror-image formations.

import assert from "node:assert/strict";
import { test } from "node:test";
import { DIR16_X, DIR16_Y } from "../src/core/fixed.ts";
import { Order, Reject, UnitFlag, UnitType } from "../src/protocol.ts";
import { cmd, emptyGame, openArea, put, run, slotOf } from "./helpers.ts";

type G = ReturnType<typeof emptyGame>;
const KIND: Record<number, string> = { [UnitType.Spearman]: "spear", [UnitType.Ranged]: "ranged", [UnitType.Mage]: "mage" };

/** Player p's 15 in a block from (x, y): 3 mages in the north row, 4 ranged, 8 spearmen (two rows); `swap` puts the block's image across the diagonal. */
function block(g: G, p: number, x: number, y: number, swap = false): number[] {
  const at = (cx: number, cy: number) => (swap ? [cy, cx] : [cx, cy]) as [number, number];
  const ids: number[] = [];
  for (let k = 0; k < 3; k++) ids.push(put(g, p, UnitType.Mage, ...at(x + k, y)));
  for (let k = 0; k < 4; k++) ids.push(put(g, p, UnitType.Ranged, ...at(x + k, y + 1)));
  for (let k = 0; k < 8; k++) ids.push(put(g, p, UnitType.Spearman, ...at(x + (k % 4), y + 2 + Math.trunc(k / 4))));
  return ids;
}

/** Each kind's mean position along dir16 k, in cells (larger = further that way). */
function ranks(g: G, ids: number[], k: number): Record<string, number> {
  const u = g.w.units.col;
  const sum: Record<string, number[]> = {};
  for (const id of ids) {
    const s = slotOf(g, id);
    (sum[KIND[u.type[s]]] ??= []).push((u.x[s] * DIR16_X[k] + u.y[s] * DIR16_Y[k]) / 1024 / 1024);
  }
  return Object.fromEntries(Object.entries(sum).map(([kind, v]) => [kind, v.reduce((a, b) => a + b, 0) / v.length]));
}

const middle = (g: G, ids: number[]) => {
  const u = g.w.units.col;
  const xs = ids.map((id) => u.x[slotOf(g, id)]);
  const ys = ids.map((id) => u.y[slotOf(g, id)]);
  return [xs.reduce((a, b) => a + b, 0) / ids.length / 1024, ys.reduce((a, b) => a + b, 0) / ids.length / 1024];
};

const settled = (g: G, ids: number[]) => ids.every((id) => g.w.units.col.order[slotOf(g, id)] === Order.None);

test("standing, `face` turns the formation where it stands: spearmen that way, then ranged, then mages; the middle stays", () => {
  for (const face of [0, 4, 8, 12, 2, 10]) {
    const g = emptyGame();
    const a = openArea(g, 30);
    const ids = block(g, 0, a.x + 13, a.y + 13);
    g.fog.update(g.w);
    const before = middle(g, ids);
    cmd(g, 0, { c: "formation", u: ids, loose: false, face });
    run(g, 1);
    assert.ok(!g.events.some((e) => e.ev.k === "rejected"));
    for (let t = 0; t < 20 * 20 && !settled(g, ids); t++) run(g, 1);
    assert.ok(settled(g, ids), `face ${face}: formed up`);
    const r = ranks(g, ids, face);
    assert.ok(r.spear > r.ranged && r.ranged > r.mage, `face ${face}: ${JSON.stringify(r)}`);
    const after = middle(g, ids);
    assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) <= 1, `face ${face}: the middle moved ${JSON.stringify([before, after])}`);
  }
});

test("without `face` as before: the spearmen's side (south here) stays the front", () => {
  const g = emptyGame();
  const a = openArea(g, 30);
  const ids = block(g, 0, a.x + 13, a.y + 13);
  g.fog.update(g.w);
  cmd(g, 0, { c: "formation", u: ids, loose: false });
  for (let t = 0; t < 20 * 20 && (t < 2 || !settled(g, ids)); t++) run(g, 1);
  const r = ranks(g, ids, 4);
  assert.ok(r.spear > r.ranged && r.ranged > r.mage, JSON.stringify(r));
});

test("`face` with loose: two cells apart, facing that way", () => {
  const g = emptyGame();
  const a = openArea(g, 30);
  const ids = block(g, 0, a.x + 13, a.y + 13);
  g.fog.update(g.w);
  cmd(g, 0, { c: "formation", u: ids, loose: true, face: 12 });
  for (let t = 0; t < 20 * 20 && (t < 2 || !settled(g, ids)); t++) run(g, 1);
  // Those that stand push apart to two cells within a second or two.
  run(g, 2 * 20);
  const u = g.w.units.col;
  assert.ok(ids.every((id) => (u.flags[slotOf(g, id)] & UnitFlag.Loose) !== 0));
  const r = ranks(g, ids, 12);
  assert.ok(r.spear > r.ranged && r.ranged > r.mage, JSON.stringify(r));
  let least = Infinity;
  for (const p of ids) for (const q of ids) if (p < q) least = Math.min(least, Math.hypot(u.x[slotOf(g, p)] - u.x[slotOf(g, q)], u.y[slotOf(g, p)] - u.y[slotOf(g, q)]) / 1024);
  assert.ok(least > 1.5, `loose: nearest two ${least.toFixed(2)} cells apart`);
});

test("a group on its way re-forms at its goal, facing `face`", () => {
  const g = emptyGame();
  const a = openArea(g, 30);
  const ids = block(g, 0, a.x + 13, a.y + 4);
  g.fog.update(g.w);
  // A move south: it would face south; told to face east on the way, it faces east there.
  cmd(g, 0, { c: "move", u: ids, x: a.x + 14, y: a.y + 22 });
  run(g, 20);
  cmd(g, 0, { c: "formation", u: ids, loose: false, face: 0 });
  for (let t = 0; t < 40 * 20 && !settled(g, ids); t++) run(g, 1);
  assert.ok(settled(g, ids));
  const [, my] = middle(g, ids);
  assert.ok(my > a.y + 18, "it went on to its goal");
  const r = ranks(g, ids, 0);
  assert.ok(r.spear > r.ranged && r.ranged > r.mage, JSON.stringify(r));
});

test("with `face`, those within 8 cells of one another re-form as one (spread out after a chase); further off, apart; without `face`, 3 cells as before", () => {
  // 7 ranged and mages standing together, 8 spearmen 6 cells south of them (chased and stopped
  // there), and 4 more spearmen 11 cells east of those: too far.
  const scene = () => {
    const g = emptyGame();
    const a = openArea(g, 30);
    const near: number[] = [];
    for (let k = 0; k < 3; k++) near.push(put(g, 0, UnitType.Mage, a.x + 10 + k, a.y + 8));
    for (let k = 0; k < 4; k++) near.push(put(g, 0, UnitType.Ranged, a.x + 10 + k, a.y + 9));
    for (let k = 0; k < 8; k++) near.push(put(g, 0, UnitType.Spearman, a.x + 10 + (k % 4), a.y + 15 + Math.trunc(k / 4)));
    const far: number[] = [];
    for (let k = 0; k < 4; k++) far.push(put(g, 0, UnitType.Spearman, a.x + 24 + (k % 2), a.y + 15 + Math.trunc(k / 2)));
    g.fog.update(g.w);
    return { g, near, far };
  };
  const spread = (g: G, ids: number[]) => {
    const u = g.w.units.col;
    const ys = ids.map((id) => u.y[slotOf(g, id)] / 1024);
    return Math.max(...ys) - Math.min(...ys);
  };
  const withFace = scene();
  const farAt = middle(withFace.g, withFace.far);
  cmd(withFace.g, 0, { c: "formation", u: [...withFace.near, ...withFace.far], loose: false, face: 12 });
  for (let t = 0; t < 30 * 20 && (t < 2 || !settled(withFace.g, [...withFace.near, ...withFace.far])); t++) run(withFace.g, 1);
  assert.ok(spread(withFace.g, withFace.near) < 5, `one formation: ${spread(withFace.g, withFace.near).toFixed(1)} cells deep`);
  const r = ranks(withFace.g, withFace.near, 12);
  assert.ok(r.spear > r.ranged && r.ranged > r.mage, JSON.stringify(r));
  const farNow = middle(withFace.g, withFace.far);
  assert.ok(Math.hypot(farNow[0] - farAt[0], farNow[1] - farAt[1]) <= 1, "the four 11 cells off re-formed where they stood");
  const without = scene();
  cmd(without.g, 0, { c: "formation", u: [...without.near, ...without.far], loose: false });
  for (let t = 0; t < 30 * 20 && (t < 2 || !settled(without.g, [...without.near, ...without.far])); t++) run(without.g, 1);
  assert.ok(spread(without.g, without.near) > 5, "without `face`, the two lots re-form apart");
});

test("a `face` that is not 0-15 is rejected and changes nothing", () => {
  const g = emptyGame();
  const a = openArea(g, 30);
  const ids = block(g, 0, a.x + 13, a.y + 13);
  g.fog.update(g.w);
  const u = g.w.units.col;
  for (const face of [16, -1, 1.5, "4", null]) {
    cmd(g, 0, { c: "formation", u: ids, loose: true, face });
    run(g, 1);
    const rejected = g.events.filter((e) => e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason);
    assert.deepEqual(rejected, [Reject.InvalidTarget], `face ${JSON.stringify(face)}`);
  }
  assert.ok(ids.every((id) => (u.flags[slotOf(g, id)] & UnitFlag.Loose) === 0 && u.order[slotOf(g, id)] === Order.None), "no flag, no move");
});

test("mirror images: mirror-image blocks told to face mirror-image ways form mirror images, tick by tick", () => {
  const g = emptyGame();
  const w = g.w;
  // A block open on player 0's side of the diagonal whose image is open too.
  let at: [number, number] | undefined;
  for (let y = 20; y < 120 && !at; y++) {
    for (let x = 3; x < 100 && !at; x++) {
      if (x + 12 > y) continue;
      let ok = true;
      for (let yy = y - 3; yy < y + 10 && ok; yy++) for (let xx = x - 3; xx < x + 10 && ok; xx++) if (!w.walkable(xx, yy) || !w.walkable(yy, xx)) ok = false;
      if (ok) at = [x, y];
    }
  }
  assert.ok(at, "an open block and its image");
  const mine = block(g, 0, at[0], at[1]);
  const image = block(g, 1, at[0], at[1], true);
  g.fog.update(g.w);
  // Facing north-east (14) for player 0 is facing south-west (4 - 14, so 6) for its image across the diagonal.
  cmd(g, 0, { c: "formation", u: mine, loose: false, face: 14 });
  cmd(g, 1, { c: "formation", u: image, loose: false, face: (4 - 14 + 16) % 16 });
  const u = w.units.col;
  for (let t = 0; t < 15 * 20; t++) {
    run(g, 1);
    for (let k = 0; k < mine.length; k++) {
      const a = slotOf(g, mine[k]);
      const b = slotOf(g, image[k]);
      assert.equal(u.x[b], u.y[a], `tick ${g.tick}: x of the image is y of the original`);
      assert.equal(u.y[b], u.x[a], `tick ${g.tick}`);
    }
  }
  const r = ranks(g, mine, 14);
  assert.ok(r.spear > r.ranged && r.ranged > r.mage, JSON.stringify(r));
});
