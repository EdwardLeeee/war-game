// The gesture recogniser on its own: how one finger becomes a tap, a pan or a long press,
// and how a second finger takes over. Times are ms on a fake clock.

import assert from "node:assert/strict";
import { test } from "node:test";
import { GestureRecognizer } from "../src/input/gestures.ts";
import { DOUBLE_TAP_MS, LONG_PRESS_MS, PRESS_CUE_DELAY_MS, TAP_SLOP_PX } from "../src/tuning.ts";
import { RecordingHost } from "./fakes.ts";

function setup() {
  const host = new RecordingHost();
  return { host, g: new GestureRecognizer(host) };
}

test("a quick lift without moving is a tap", () => {
  const { host, g } = setup();
  g.down(1, 100, 100, 0);
  g.update(50);
  g.up(1, 102, 101, 120);
  assert.deepEqual(host.calls, [["tap", 100, 100, 1]]);
  assert.equal(g.state, "idle");
});

test("moving past the slop before the long press pans, and a long hold afterwards stays a pan", () => {
  const { host, g } = setup();
  g.down(1, 100, 100, 0);
  g.move(1, 100 + TAP_SLOP_PX + 1, 100, 100);
  assert.equal(g.state, "pan");
  g.update(LONG_PRESS_MS + 500);
  g.move(1, 150, 100, LONG_PRESS_MS + 520);
  g.up(1, 150, 100, LONG_PRESS_MS + 540);
  assert.deepEqual(host.names(), ["panStart", "pan", "pan", "panEnd"]);
  assert.equal(host.of("longPress").length, 0);
});

test("jitter inside the slop still becomes a long press at 350 ms", () => {
  const { host, g } = setup();
  g.down(1, 100, 100, 0);
  g.move(1, 100 + TAP_SLOP_PX - 1, 100, 100);
  g.update(LONG_PRESS_MS - 1);
  assert.equal(host.of("longPress").length, 0);
  g.update(LONG_PRESS_MS);
  assert.deepEqual(host.of("longPress"), [["longPress", 100, 100]]);
  assert.equal(g.state, "box");
});

test("the hold cue shows after a short delay and hides when the press resolves", () => {
  const { host, g } = setup();
  g.down(1, 100, 100, 0);
  g.update(PRESS_CUE_DELAY_MS - 1);
  assert.equal(host.of("pressCue").length, 0);
  g.update(PRESS_CUE_DELAY_MS);
  g.update(LONG_PRESS_MS);
  assert.deepEqual(host.of("pressCue"), [
    ["pressCue", 100, 100, true],
    ["pressCue", 100, 100, false],
  ]);
});

test("a long press the host turns into a box follows the finger and ends on lift", () => {
  const { host, g } = setup();
  host.longPressAnswer = "box";
  g.down(1, 100, 100, 0);
  g.update(LONG_PRESS_MS);
  g.move(1, 200, 160, 400);
  g.up(1, 220, 170, 450);
  assert.deepEqual(host.of("box"), [
    ["box", 100, 100, 100, 100, "start"],
    ["box", 100, 100, 200, 160, "move"],
    ["box", 100, 100, 220, 170, "end"],
  ]);
  assert.equal(host.of("tap").length, 0);
});

test("a long press the host turns into the wheel ignores movement and is not a tap", () => {
  const { host, g } = setup();
  host.longPressAnswer = "wheel";
  g.down(1, 100, 100, 0);
  g.update(LONG_PRESS_MS);
  g.move(1, 180, 100, 400);
  g.up(1, 180, 100, 450);
  assert.deepEqual(host.names().filter((n) => n !== "pressCue"), ["longPress"]);
});

test("a second tap nearby within 300 ms is a double tap; the first is reported at once", () => {
  const { host, g } = setup();
  g.down(1, 100, 100, 0);
  g.up(1, 100, 100, 60);
  assert.deepEqual(host.calls, [["tap", 100, 100, 1]]);
  g.down(2, 110, 104, 60 + DOUBLE_TAP_MS - 100);
  g.up(2, 110, 104, 60 + DOUBLE_TAP_MS - 40);
  assert.deepEqual(host.of("tap")[1], ["tap", 110, 104, 2]);
});

test("taps too far apart in time are two single taps", () => {
  const { host, g } = setup();
  g.down(1, 100, 100, 0);
  g.up(1, 100, 100, 60);
  g.down(2, 100, 100, 60 + DOUBLE_TAP_MS + 1);
  g.up(2, 100, 100, 60 + DOUBLE_TAP_MS + 50);
  assert.deepEqual(
    host.of("tap").map((c) => c[3]),
    [1, 1],
  );
});

test("a second finger during a box cancels it and pinches; the last finger then does nothing", () => {
  const { host, g } = setup();
  g.down(1, 100, 100, 0);
  g.update(LONG_PRESS_MS);
  g.down(2, 300, 100, 400);
  assert.equal(g.state, "pinch");
  assert.deepEqual(host.of("box").at(-1)?.[5], "cancel");
  g.move(2, 400, 100, 420);
  const [, cx, , factor] = host.of("pinch")[0];
  assert.equal(cx, 250);
  assert.equal(factor, 1.5);
  g.up(2, 400, 100, 440);
  assert.equal(g.state, "drain");
  g.move(1, 250, 250, 460);
  g.update(2000);
  g.up(1, 250, 250, 2100);
  assert.deepEqual(host.names().slice(-2), ["pinch", "pinchEnd"]);
  assert.equal(g.state, "idle");
});

test("a press that stopped a fling can pan or box but is not a tap", () => {
  const { host, g } = setup();
  g.down(1, 100, 100, 0, true);
  g.up(1, 100, 100, 80);
  assert.deepEqual(host.calls, []);
});

test("releasing a pan while moving flings; stopping first flings nothing", () => {
  const moving = setup();
  moving.g.down(1, 0, 0, 0);
  for (let t = 10; t <= 100; t += 10) moving.g.move(1, t * 2, 0, t);
  moving.g.up(1, 200, 0, 100);
  const [, vx] = moving.host.of("panEnd")[0];
  assert.equal(vx, 2);

  const stopped = setup();
  stopped.g.down(1, 0, 0, 0);
  for (let t = 10; t <= 100; t += 10) stopped.g.move(1, t * 2, 0, t);
  stopped.g.up(1, 200, 0, 400);
  assert.deepEqual(stopped.host.of("panEnd")[0], ["panEnd", 0, 0]);
});

test("pointercancel ends a box without selecting", () => {
  const { host, g } = setup();
  g.down(1, 100, 100, 0);
  g.update(LONG_PRESS_MS);
  g.cancel(1, 500);
  assert.deepEqual(host.of("box").at(-1)?.[5], "cancel");
  assert.equal(g.state, "idle");
});
