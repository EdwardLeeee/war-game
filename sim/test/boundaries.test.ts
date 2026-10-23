// Module boundaries (sim/README.md): the AI sees only a PlayerView; the rules never touch
// the clock, randomness or implementation-approximated maths.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Action, CELL_SHIFT, NEUTRAL, UNIT_STRIDE, UnitField, UnitType } from "../src/protocol.ts";
import { buildView } from "../src/view/view.ts";
import { cmd, emptyGame, openArea, put } from "./helpers.ts";

const src = new URL("../src/", import.meta.url).pathname;
const files = (dir: string) => readdirSync(join(src, dir)).filter((f) => f.endsWith(".ts")).map((f) => join(src, dir, f));
const imports = (file: string) => [...readFileSync(file, "utf8").matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);

test("ai/ imports only the protocol, the placement check, symmetry frames, view types and fixed-point helpers", () => {
  // D-086 B: and the hard AI's network (net.ts), which imports nothing at all.
  const allowed = new Set(["../protocol.ts", "../placement.ts", "../frame.ts", "../view/view.ts", "../core/fixed.ts", "./net.ts"]);
  for (const f of files("ai")) {
    for (const i of imports(f)) assert.ok(allowed.has(i), `${f} imports ${i}`);
  }
  assert.deepEqual(imports(join(src, "ai", "net.ts")), [], "net.ts imports nothing");
});

test("core/ imports nothing from view/, ai/, the worker or the runner", () => {
  for (const f of files("core")) {
    for (const i of imports(f)) assert.ok(!/view|ai\/|worker|runner|headless/.test(i), `${f} imports ${i}`);
  }
});

test("core/ and ai/ use no clock, no Math.random and no implementation-approximated maths", () => {
  const banned = /Math\.(random|sin|cos|tan|atan2?|exp|log\w*|pow|hypot|cbrt)\b|\*\*|Date\.now|performance\.now|new Date/;
  for (const f of [...files("core"), ...files("ai")]) {
    const text = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const hit = text.match(banned);
    assert.equal(hit, null, `${f}: ${hit?.[0]}`);
  }
});

test("UnitField.attackTarget (ceo 2026-10-23, arrows that fly to their target): a viewer gets the target only when it sees it, else -1", () => {
  const g = emptyGame();
  const w = g.w;
  g.w.ecoOn[0] = 0;
  g.w.ecoOn[1] = 0;
  const { x, y } = openArea(g, 30);
  // Player 0's farmer sees player 1's archer 4 cells off (sight 5), not the militia 9 cells off.
  const farmer = put(g, 0, UnitType.Farmer, x + 2, y + 10);
  const archer = put(g, 1, UnitType.Ranged, x + 6, y + 10);
  const militia = put(g, NEUTRAL, UnitType.Militia, x + 11, y + 10);
  for (const id of [farmer, archer, militia]) w.units.col.hp[w.unit(id)] = 100000;
  // Once player 1 sees the militia, it orders the archer at it (else it would pick the farmer).
  for (let k = 0; k < 20; k++) g.step();
  cmd(g, 1, { c: "attack", u: [archer], target: militia });
  let fighting = false;
  for (let k = 0; k < 60 && !fighting; k++) {
    g.step();
    fighting = w.units.col.action[w.unit(archer)] === Action.Attack;
  }
  assert.ok(fighting, "the archer shoots");
  const row = (v: ReturnType<typeof buildView>, id: number) => {
    for (let r = 0; r < v.units.length; r += UNIT_STRIDE) if (v.units[r + UnitField.id] === id) return v.units.subarray(r, r + UNIT_STRIDE);
    throw new Error(`unit ${id} not in view`);
  };
  const near = (id: number) => Math.abs((w.units.col.x[w.unit(id)] >> CELL_SHIFT) - (w.units.col.x[w.unit(farmer)] >> CELL_SHIFT));
  assert.ok(near(archer) <= 5 && near(militia) > 5, "the farmer sees the archer, not the militia");
  assert.equal(row(buildView(g, 0), archer)[UnitField.attackTarget], -1, "player 0 does not see the militia");
  assert.equal(row(buildView(g, 1), archer)[UnitField.attackTarget], militia, "its owner does");
  assert.equal(row(buildView(g, null), archer)[UnitField.attackTarget], militia, "the full view does");
  // Not fighting: -1.
  assert.equal(row(buildView(g, 0), farmer)[UnitField.attackTarget], -1);
});
