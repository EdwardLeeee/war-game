// Rejected commands: the player is told why, and only rules the simulation has not built yet
// say 原型尚未開放 (ceo 2026-09-30).

import assert from "node:assert/strict";
import { test } from "node:test";
import { Reject } from "../src/sim.ts";
import { rejectText } from "../src/ui/overlays.ts";

test("NotAvailable on a command the simulation has not built yet says 原型尚未開放", () => {
  assert.equal(rejectText(Reject.NotAvailable, { c: "surrender" }), "原型尚未開放");
  assert.equal(rejectText(Reject.NotAvailable, { c: "cast", u: 1, fx: 0, fy: 0 }), "原型尚未開放");
  assert.equal(rejectText(Reject.NotAvailable, { c: "town_choice", town: 0, choice: 0 }), "原型尚未開放");
});

test("NotAvailable on a rule that exists explains the rule instead", () => {
  assert.match(rejectText(Reject.NotAvailable, { c: "repair", u: [1], building: 2 }), /不需要農民/);
  assert.match(rejectText(Reject.NotAvailable, { c: "train", building: 2, type: 1, n: 1 }), /還沒蓋好/);
  assert.equal(rejectText(Reject.NotAvailable, { c: "move", u: [1], x: 0, y: 0 }), "現在不能這樣做");
});

test("other reasons keep their own text", () => {
  assert.equal(rejectText(Reject.CannotAfford, { c: "train", building: 2, type: 1, n: 1 }), "資源不夠");
  assert.match(rejectText(Reject.PopulationCap, undefined), /訓練中的也算/);
});
