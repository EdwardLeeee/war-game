// Rejected commands: the player is told why, in words that fit the command
// (sim/PROTOCOL.md 3.1 and 3.2).

import assert from "node:assert/strict";
import { test } from "node:test";
import { Reject } from "../src/sim.ts";
import { rejectText } from "../src/ui/overlays.ts";

test("NotAvailable says what the rule is, for each command", () => {
  assert.match(rejectText(Reject.NotAvailable, { c: "repair", u: [1], building: 2 }), /不需要農民/);
  assert.match(rejectText(Reject.NotAvailable, { c: "train", building: 2, type: 1, n: 1 }), /還沒蓋好/);
  assert.equal(rejectText(Reject.NotAvailable, { c: "cast", u: 1, fx: 0, fy: 0 }), "只有法師能發晶砲");
  assert.equal(rejectText(Reject.NotAvailable, { c: "move", u: [1], x: 0, y: 0 }), "現在不能這樣做");
});

test("no rule says 原型尚未開放 any more (every prototype rule exists since core's PR-4)", () => {
  for (const reason of Object.values(Reject)) {
    for (const cmd of [{ c: "surrender" as const }, { c: "town_choice" as const, town: 0, choice: 0 as const }, { c: "autocast" as const, u: [1], on: true }]) {
      assert.doesNotMatch(rejectText(reason, cmd), /原型尚未開放/);
    }
  }
});

test("the same code reads differently where the command makes it mean something else", () => {
  assert.equal(rejectText(Reject.CannotAfford, { c: "train", building: 2, type: 1, n: 1 }), "資源不夠");
  assert.match(rejectText(Reject.CannotAfford, { c: "town_choice", town: 0, choice: 1 }), /治理要先投入金和木/);
  assert.equal(rejectText(Reject.OutOfRange, { c: "cast", u: 1, fx: 0, fy: 0 }), "超出晶砲射程（8 格）");
  assert.match(rejectText(Reject.PopulationCap, undefined), /訓練中的也算/);
});
