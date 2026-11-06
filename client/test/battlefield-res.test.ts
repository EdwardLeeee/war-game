import assert from "node:assert/strict";
import { test } from "node:test";
import { battlefieldRes } from "../src/battlefield-res.ts";

test("戰場像素比: 2 on a phone of 3, the device's when not asked for or when the device has 2 or less", () => {
  assert.equal(battlefieldRes(true, 3), 2);
  assert.equal(battlefieldRes(false, 3), 3);
  assert.equal(battlefieldRes(true, 2), 2);
  assert.equal(battlefieldRes(true, 1), 1);
  assert.equal(battlefieldRes(false, 1), 1);
});
