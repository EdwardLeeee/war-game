// The contract stays consistent: every table's fields fit its stride without overlap,
// enumeration values are distinct, and PROTOCOL.md documents every field, command and event.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Game } from "../src/core/game.ts";
import { rules } from "../src/core/rules.ts";
import * as P from "../src/protocol.ts";

const doc = readFileSync(new URL("../PROTOCOL.md", import.meta.url), "utf8");

const tables: [string, Record<string, number>, number][] = [
  ["units", P.UnitField, P.UNIT_STRIDE],
  ["buildings", P.BuildingField, P.BUILDING_STRIDE],
  ["nodes", P.NodeField, P.NODE_STRIDE],
  ["towns", P.TownField, P.TOWN_STRIDE],
  ["warnings", P.WarningField, P.WARNING_STRIDE],
  ["header", P.HeaderField, P.HEADER_LENGTH],
];

test("every table's fields are 0..stride-1 exactly once", () => {
  for (const [name, fields, stride] of tables) {
    const idx = Object.values(fields).sort((a, b) => a - b);
    assert.deepEqual(idx, [...Array(stride).keys()], name);
  }
});

test("enumeration values are distinct", () => {
  const enums: Record<string, Record<string, number>> = {
    UnitType: P.UnitType,
    BuildingType: P.BuildingType,
    Resource: P.Resource,
    NodeKind: P.NodeKind,
    Terrain: P.Terrain,
    TownSize: P.TownSize,
    TownState: P.TownState,
    TownChoice: P.TownChoice,
    Stance: P.Stance,
    Action: P.Action,
    Order: P.Order,
    GameState: P.GameState,
    GameOverReason: P.GameOverReason,
    Fog: P.Fog,
    Reject: P.Reject,
    Scenario: P.Scenario,
  };
  for (const [name, e] of Object.entries(enums)) {
    const values = Object.values(e);
    assert.equal(new Set(values).size, values.length, name);
  }
  assert.ok(!Object.values(P.Reject).includes(0 as never), "0 means accepted, so no reason code is 0");
});

test("flag bits are distinct powers of two", () => {
  for (const flags of [P.UnitFlag, P.BuildingFlag, P.TownFlag, P.PlaceBit]) {
    let seen = 0;
    for (const bit of Object.values(flags)) {
      assert.ok(bit > 0 && (bit & (bit - 1)) === 0, `${bit} is not a single bit`);
      assert.equal(seen & bit, 0);
      seen |= bit;
    }
  }
});

test("PROTOCOL.md documents every field, command and event", () => {
  for (const [name, fields] of tables) {
    for (const f of Object.keys(fields)) {
      if (f.startsWith("reserved")) continue;
      assert.ok(doc.includes(`\`${f}\``), `${name}.${f} missing from PROTOCOL.md`);
    }
  }
  for (const c of P.COMMAND_KINDS) assert.ok(doc.includes(`| \`${c}\` |`), `command ${c} missing`);
  for (const k of P.EVENT_KINDS) assert.ok(doc.includes(`| \`${k}\` |`), `event ${k} missing`);
  for (const [name, code] of Object.entries(P.Reject)) {
    assert.ok(doc.includes(`| ${code} | \`${name}\` |`), `reject ${name} missing`);
  }
  assert.ok(doc.includes(`PROTOCOL_VERSION ${P.PROTOCOL_VERSION}`), "version in the title");
});

test("constants match the engine spike's rules", () => {
  assert.equal(P.TICKS_PER_SECOND, 20);
  assert.equal(P.CELL, 1 << P.CELL_SHIFT);
  assert.equal(P.MAX_TICKS, 30 * 60 * P.TICKS_PER_SECOND);
  assert.equal(P.COMMAND_KINDS_COMPLETE, true);
  assert.equal(P.EVENT_KINDS_COMPLETE, true);
});

test("D-080 outposts: in the protocol and the rules table, rejected until their rules land", () => {
  const info = rules().buildings[P.BuildingType.Outpost];
  assert.deepEqual([info.size, info.hp, info.cost.wood, info.buildTicks, info.sight], [2, 400, 50, 20 * 20, 10]);
  assert.deepEqual(rules().outpost, { slots: 6, reach: 8, chase: 12 });
  assert.equal(rules().towerReach.outpost, 6);
  assert.equal(rules().features.outpost, undefined);
  const g = new Game({ seed: 1, scenario: "standard" });
  const s0 = g.w.map.spawns[0];
  const before = g.hash();
  const sent: P.CommandBody[] = [
    { c: "build", u: [], type: P.BuildingType.Outpost, x: s0.cellX + 4, y: s0.cellY - 8 },
    { c: "post", u: [], building: 0 },
    { c: "unpost", building: 0 },
    { c: "outpost_mode", building: 0, hold: true },
  ];
  let seq = 0;
  for (const body of sent) g.push({ ...body, t: g.tick, p: 0, seq: seq++ } as P.Command);
  g.step();
  const rejected = g.events.filter((e) => e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason);
  assert.deepEqual(rejected, [P.Reject.NotAvailable, P.Reject.NotAvailable, P.Reject.NotAvailable, P.Reject.NotAvailable]);
  const again = new Game({ seed: 1, scenario: "standard" });
  again.step();
  assert.notEqual(before, 0);
  assert.equal(g.hash(), again.hash(), "rejected commands change nothing");
});
