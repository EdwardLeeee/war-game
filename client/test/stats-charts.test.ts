// 局後統計's charts (ui/stats/charts.ts): the value axis' top just over the data, every other line on a short chart
// (ui 2026-11-07: 6,465 → 0／4,000／8,000 at 932 × 336, 0／2,000／…／8,000 at full height; 82 → 0／50／100); a line
// chart's labels at the lines' ends, pushed apart when close.

import assert from "node:assert/strict";
import { test } from "node:test";
import { lineChart, niceStep, valueAxis } from "../src/ui/stats/charts.ts";

test("the value axis: 1, 2, 2.5, 5 × 10ⁿ, its top just over the data; on a short chart every other line", () => {
  assert.equal(niceStep(6465), 2000);
  assert.equal(niceStep(82), 25);
  assert.equal(niceStep(0), 1);
  assert.deepEqual(valueAxis(6465, 160), { step: 2000, ymax: 8000 });
  assert.deepEqual(valueAxis(6465, 53), { step: 4000, ymax: 8000 }, "932 × 336: 0, 4,000, 8,000");
  assert.deepEqual(valueAxis(82, 160), { step: 25, ymax: 100 });
  assert.deepEqual(valueAxis(82, 53), { step: 50, ymax: 100 });
  assert.deepEqual(valueAxis(520, 53), { step: 200, ymax: 600 }, "three lines stay three (not a step off the list)");
  assert.deepEqual(valueAxis(0, 160), { step: 1, ymax: 1 });
});

test("a line chart: the value labels, the end labels pushed 17 apart, its name for screen readers", () => {
  const svg = lineChart({
    w: 600,
    h: 101,
    ticks: 20 * 60 * 20,
    axisMinutes: 5,
    moments: [],
    series: [
      { who: "me", name: "我方", pts: [[0, 0], [24000, 6465]] },
      { who: "foe", name: "敵方", pts: [[0, 0], [24000, 6300]] },
    ],
    label: "累計採集糧",
  });
  const values = [...svg.matchAll(/text-anchor="end" font-size="12">([\d,]+)</g)].map((m) => m[1]);
  assert.deepEqual(values, ["0", "4,000", "8,000"]);
  const ends = [...svg.matchAll(/<text class="st-t st-bold st-num" x="[\d.]+" y="([\d.]+)" font-size="13">(我方|敵方) [\d,]+</g)].map((m) => [m[2], Number(m[1])] as const);
  assert.equal(ends.length, 2);
  assert.ok(Math.abs(ends[0][1] - ends[1][1]) >= 17 - 1e-6, "close ends pushed apart");
  assert.match(svg, /role="img" aria-label="累計採集糧"/);
});
