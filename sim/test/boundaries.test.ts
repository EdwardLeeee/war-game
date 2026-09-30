// Module boundaries (sim/README.md): the AI sees only a PlayerView; the rules never touch
// the clock, randomness or implementation-approximated maths.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const src = new URL("../src/", import.meta.url).pathname;
const files = (dir: string) => readdirSync(join(src, dir)).filter((f) => f.endsWith(".ts")).map((f) => join(src, dir, f));
const imports = (file: string) => [...readFileSync(file, "utf8").matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);

test("ai/ imports only the protocol, view types and fixed-point helpers", () => {
  const allowed = new Set(["../protocol.ts", "../view/view.ts", "../core/fixed.ts"]);
  for (const f of files("ai")) {
    for (const i of imports(f)) assert.ok(allowed.has(i), `${f} imports ${i}`);
  }
});

test("core/ imports nothing from view/, ai/, the worker or the runner", () => {
  for (const f of files("core")) {
    for (const i of imports(f)) assert.ok(!/view|ai\/|worker|runner|headless/.test(i), `${f} imports ${i}`);
  }
});

test("core/ uses no clock, no Math.random and no implementation-approximated maths", () => {
  const banned = /Math\.(random|sin|cos|tan|atan2?|exp|log\w*|pow|hypot|cbrt)\b|\*\*|Date\.now|performance\.now|new Date/;
  for (const f of files("core")) {
    const text = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const hit = text.match(banned);
    assert.equal(hit, null, `${f}: ${hit?.[0]}`);
  }
});
