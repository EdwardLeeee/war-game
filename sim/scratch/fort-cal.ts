// Scratch (P1 calibration, ceo 2026-11-11; needs fortcal-patch.py on src/ai/ai.ts): hard's front by fort groups with
// enemy soldiers by them, one episode per side and group, closed 30 s after its last record. At the start: what hard
// weighed (its front's WORTH and worth against forts, the group's worth for it, the enemy it believed by the group: seen
// now, within a minute, within 4 minutes) and what was really there (the enemy's soldiers within the group's reach + 6,
// as armyBy looks); over it: what each side lost (hard: of the front at the start, anywhere; the enemy: within the
// group's reach + 10), the group's forts that fell, and when hard broke off or turned back. One "CAL" JSON line each.
//   node scratch/fort-cal.ts scripted <scripted-games.ts arguments>     (player 1 is hard; with --json F, F printed as a SCRIPTED line)
//   node scratch/fort-cal.ts ai <late-metrics.ts arguments>             (its own lines are kept)
const simDir = new URL("../", import.meta.url).pathname;
const { Runner } = await import(`${simDir}src/runner.ts`);
const { UnitType } = await import(`${simDir}src/protocol.ts`);
const WORTH = [0, 10, 10, 25, 6, 16, 8];
type G = { ids: number[]; x: number; y: number; r: number; inReach: boolean; gw: number; by0: number; by1: number; by4: number; byAI: number; failed: number; lost: number; lift: boolean; beats: boolean };
type Rec = { p: number; tick: number; kind: string; fc: { x: number; y: number }; front: number[]; worthFront: number; vsFront: number; defenders: number; groups: G[] };
type Ep = { run: number; p: number; key: string; g: G; start: number; last: number; firstKind: string; fc: { x: number; y: number }; front: Set<number>; frontN: number; worthFront: number; vsFront: number; defenders: number; actual: number; actualNear: number; broke: number; brokeKind: string; atBreak: { g: G; worthFront: number; vsFront: number; frontN: number; actual: number } | null; inReachAt: number; ownLost: number; ownLostN: number; enemyLost: number; fortsLeft0: number; fortsLeft: number; records: number; beatsAll: boolean };
const cal: Rec[] = [];
(globalThis as unknown as { __fortCal: Rec[] }).__fortCal = cal;
type S = { run: number; eps: Map<string, Ep>; units: Map<number, { o: number; t: number; x: number; y: number }> };
const S = new WeakMap<object, S>();
let runs = 0;
let current: S | null = null;
const flush = (s: S, all: boolean, tick: number) => {
  for (const [k, e] of s.eps) {
    if (!all && tick - e.last < 600) continue;
    s.eps.delete(k);
    const { front: _f, ...out } = e;
    console.log("CAL " + JSON.stringify({ ...out, end: e.last }));
  }
};
const soldier = (t: number) => t !== UnitType.Farmer && t !== UnitType.Militia;
const orig = Runner.prototype.tick;
Runner.prototype.tick = function (this: { game: any }, ...a: unknown[]) {
  const out = orig.apply(this, a);
  let s = S.get(this);
  if (s === undefined) {
    if (current !== null) flush(current, true, 0);
    s = { run: runs++, eps: new Map(), units: new Map() };
    S.set(this, s);
    current = s;
    cal.length = 0;
  }
  const w = this.game.w;
  const u = w.units.col;
  const fortsAlive = (ids: number[]) => ids.filter((id) => w.building(id) >= 0).length;
  const enemyBy = (p: number, x: number, y: number, r: number) => {
    let v = 0;
    for (let k = 0; k < w.units.count; k++) if (u.owner[k] === 1 - p && soldier(u.type[k]) && ((u.x[k] >> 10) - x) ** 2 + ((u.y[k] >> 10) - y) ** 2 <= r * r) v += WORTH[u.type[k]] ?? 0;
    return v;
  };
  for (const rec of cal.splice(0)) {
    for (const g of rec.groups) {
      const key = `${rec.p}:${[...g.ids].sort((x, y) => x - y).join(",")}`;
      let e = s.eps.get(key);
      if (e === undefined) {
        e = {
          run: s.run, p: rec.p, key, g, start: rec.tick, last: rec.tick, firstKind: rec.kind, fc: rec.fc, front: new Set(rec.front), frontN: rec.front.length,
          worthFront: rec.worthFront, vsFront: rec.vsFront, defenders: rec.defenders,
          actual: enemyBy(rec.p, g.x, g.y, g.r + 6), actualNear: enemyBy(rec.p, rec.fc.x, rec.fc.y, 12),
          broke: -1, brokeKind: "", atBreak: null, inReachAt: g.inReach ? rec.tick : -1, ownLost: 0, ownLostN: 0, enemyLost: 0, fortsLeft0: fortsAlive(g.ids), fortsLeft: 0, records: 0, beatsAll: true,
        };
        s.eps.set(key, e);
      }
      e.last = rec.tick;
      e.records++;
      if (!g.beats) e.beatsAll = false;
      if (g.inReach && e.inReachAt < 0) e.inReachAt = rec.tick;
      if ((rec.kind.includes("break") || rec.kind === "ahead") && e.broke < 0) { e.broke = rec.tick; e.brokeKind = rec.kind; e.atBreak = { g, worthFront: rec.worthFront, vsFront: rec.vsFront, frontN: rec.front.length, actual: enemyBy(rec.p, g.x, g.y, g.r + 6) }; }
    }
  }
  if (w.tick % 20 === 0) {
    const seen = new Set<number>();
    for (let k = 0; k < w.units.count; k++) {
      if (!soldier(u.type[k])) continue;
      const id = u.id[k];
      seen.add(id);
      s.units.set(id, { o: u.owner[k], t: u.type[k], x: u.x[k] >> 10, y: u.y[k] >> 10 });
    }
    for (const [id, at] of s.units) {
      if (seen.has(id)) continue;
      s.units.delete(id);
      if (w.unit(id) >= 0) continue;
      for (const e of s.eps.values()) {
        if (at.o === e.p && e.front.has(id)) { e.ownLost += WORTH[at.t] ?? 0; e.ownLostN++; }
        else if (at.o === 1 - e.p && (at.x - e.g.x) ** 2 + (at.y - e.g.y) ** 2 <= (e.g.r + 10) ** 2) e.enemyLost += WORTH[at.t] ?? 0;
      }
    }
    for (const e of s.eps.values()) e.fortsLeft = fortsAlive(e.g.ids);
    flush(s, false, w.tick);
  }
  return out;
};
const [mode, ...rest] = process.argv.slice(2);
const script = mode === "scripted" ? `${simDir}src/scripted-games.ts` : `${simDir}scratch/late-metrics.ts`;
process.argv = [process.argv[0], script, ...rest];
const log = console.log;
if (mode === "scripted") console.log = (...x: unknown[]) => { if (typeof x[0] === "string" && x[0].startsWith("CAL ")) log(...x); };
await import(script);
console.log = log;
if (current !== null) flush(current, true, 0);
// scripted: its --json file as one line, for the base of other runs (fortDeaths, bashes, brokenOff, finalHash per seed).
const j = rest.indexOf("--json");
if (mode === "scripted" && j >= 0) {
  const { readFileSync } = await import("node:fs");
  console.log("SCRIPTED " + JSON.stringify(JSON.parse(readFileSync(rest[j + 1], "utf8"))));
}
