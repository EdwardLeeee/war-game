// D-139 (idle-watch.ts): an idle army's four signals, read from the world and the commands; the watch changes nothing.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Game } from "../src/core/game.ts";
import { IDLE, idleFindings, IdleWatch, type IdleRecord } from "../src/idle-watch.ts";
import { UnitType } from "../src/protocol.ts";
import { cmd, emptyGame, put } from "./helpers.ts";

const MIN = 1200;

/** Steps the game `ticks` times, the watch after each. */
function play(g: Game, watch: IdleWatch | null, ticks: number, each?: (tick: number) => void): void {
  for (let k = 0; k < ticks; k++) {
    each?.(g.w.tick);
    g.step();
    watch?.tick();
  }
}

/** An open 8 x 8 square 25 cells or more from every town and main city (standing by a town takes it). */
function farArea(g: Game): { x: number; y: number } {
  const w = g.w;
  const n = w.size;
  const places = [...w.map.towns.map((t) => [t.cellX, t.cellY]), ...w.map.spawns.map((s) => [s.cellX, s.cellY])];
  for (let y = 0; y + 8 <= n; y++) {
    for (let x = 0; x + 8 <= n; x++) {
      if (places.some(([px, py]) => Math.max(Math.abs(px - x - 4), Math.abs(py - y - 4)) < 25)) continue;
      let open = true;
      for (let k = 0; k < 64 && open; k++) open = w.grid[(y + (k >> 3)) * n + x + (k & 7)] === 0;
      if (open) return { x, y };
    }
  }
  throw new Error("no far open square");
}

/** `n` of player 1's spearmen on an open square far from every town and main city; their ids and the square. */
function army(g: Game, n: number): { ids: number[]; at: { x: number; y: number } } {
  const at = farArea(g);
  const ids: number[] = [];
  for (let k = 0; k < n; k++) ids.push(put(g, 1, UnitType.Spearman, at.x + (k % 7), at.y + Math.trunc(k / 7)));
  g.fog.update(g.w);
  return { ids, at };
}

/** A cell nobody can stand on, the nearest to (x, y). */
function blockedNear(g: Game, x: number, y: number): { x: number; y: number } {
  const w = g.w;
  const n = w.size;
  for (let r = 1; r < n; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const cx = x + dx;
        const cy = y + dy;
        if (cx >= 0 && cy >= 0 && cx < n && cy < n && w.grid[cy * n + cx] !== 0) return { x: cx, y: cy };
      }
    }
  }
  throw new Error("no blocked cell");
}

test("an army sent again and again where it cannot stand: 1, 2a and 4, to check; the watch changes nothing", () => {
  const scene = (watched: boolean) => {
    const g = emptyGame();
    const { ids, at } = army(g, 25);
    const to = blockedNear(g, at.x + 3, at.y + 3);
    const watch = watched ? new IdleWatch(g) : null;
    play(g, watch, 5 * MIN, (t) => {
      if (t % 100 === 0) cmd(g, 1, { c: "move", u: ids, x: to.x, y: to.y });
    });
    return { g, watch, to };
  };
  const { g, watch, to } = scene(true);
  const rec = watch!.result();
  const s = rec.sides[1];
  assert.equal(s.badTargets.length, 1);
  assert.deepEqual([s.badTargets[0].x, s.badTargets[0].y, s.badTargets[0].units], [to.x, to.y, 25]);
  assert.ok(s.badTargets[0].sends >= IDLE.badSends);
  assert.equal(s.away.length, 1, "one spell away from home");
  assert.equal(s.away[0].most, 25);
  assert.ok(s.away[0].start >= IDLE.awayTicks && s.away[0].start < IDLE.awayTicks + 2 * MIN, `from ${s.away[0].start}`);
  assert.equal(s.stuck.length, 1);
  assert.ok(s.stuck[0].sends >= IDLE.sends, `${s.stuck[0].sends} sends`);
  const found = idleFindings(rec, 1);
  assert.deepEqual(found.map((f) => [f.signal, f.kind]), [["1", "check"], ["2a", "check"], ["4", "check"]]);
  assert.deepEqual(idleFindings(rec, 0), [], "player 0 did nothing of it");
  assert.equal(g.hash(), scene(false).g.hash(), "the same game without the watch");
});

test("an army on the march: none of it, though it is sent the same way again and again", () => {
  const g = emptyGame();
  const { ids } = army(g, 25);
  const watch = new IdleWatch(g);
  // Back and forth across the map, a new goal every minute and the same one resent every 5 s.
  const goals = [g.w.map.spawns[0], g.w.map.spawns[1]].map((s) => ({ x: s.cellX + (s.cellX < 48 ? 14 : -14), y: s.cellY + (s.cellY < 48 ? 14 : -14) }));
  play(g, watch, 6 * MIN, (t) => {
    if (t % 100 === 0) {
      const to = goals[Math.trunc(t / MIN) % 2];
      cmd(g, 1, { c: "move", u: ids, x: to.x, y: to.y });
    }
  });
  const s = watch.result().sides[1];
  assert.deepEqual([s.away.length, s.stuck.length, s.badTargets.length], [0, 0, 0]);
  assert.ok(s.mostSends.sends >= 10, "sent the same way often: a column only");
});

test("a crowd at home that never marches: 2b after 5 minutes; enemies near it most of the time make it keeping home", () => {
  const crowd = (foes: boolean) => {
    const g = emptyGame();
    const home = g.w.map.spawns[1];
    for (let k = 0; k < IDLE.homeMin + 5; k++) put(g, 1, UnitType.Spearman, home.cellX - 8 + (k % 12), home.cellY + 6 + Math.trunc(k / 12));
    if (foes) {
      // Player 0's spearmen within reach of its main city's watch, holding where they stand.
      const ids: number[] = [];
      for (let k = 0; k < 3; k++) ids.push(put(g, 0, UnitType.Spearman, home.cellX - 20 + k, home.cellY - 2));
      cmd(g, 0, { c: "stance", u: ids, stance: 1 });
    }
    g.fog.update(g.w);
    const watch = new IdleWatch(g);
    play(g, watch, 6 * MIN);
    return watch.result();
  };
  const plain = crowd(false);
  assert.equal(plain.sides[1].home.length, 1);
  assert.ok(plain.sides[1].home[0].most >= IDLE.homeMin);
  assert.deepEqual(idleFindings(plain, 1).map((f) => [f.signal, f.kind]), [["2b", "check"]]);
  const kept = crowd(true);
  assert.equal(kept.sides[1].home[0].tag, "defend");
  assert.deepEqual(idleFindings(kept, 1).map((f) => [f.signal, f.kind]), [["2b", "plan"]]);
});

test("never at the enemy's main city: 3 once a game lasts IDLE.neverTicks, not before; reaching it with an army clears it", () => {
  const side = (reached: number): IdleRecord["sides"][number] => ({ badTargets: [], badTargetCount: 0, away: [], home: [], reachedCity: reached, stuck: [], mostSends: { x: -1, y: -1, sends: 0 } });
  const rec = (ticks: number, reached: number): IdleRecord => ({ ticks, sides: [side(5000), side(reached)] });
  assert.deepEqual(idleFindings(rec(IDLE.neverTicks, -1), 1).map((f) => f.signal), ["3"]);
  assert.deepEqual(idleFindings(rec(IDLE.neverTicks - 1, -1), 1), []);
  assert.deepEqual(idleFindings(rec(40 * MIN, 30000), 1), []);
});
