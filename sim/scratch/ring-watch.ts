// SCRATCH ONLY (war-game-ai, D-154; ceo 2026-11-18): the house ring against hard. Plays scripted-games.ts with its
// arguments (player 0 scripted, player 1 hard) and for each game prints one RING line:
//   the ring: player 0's main city's box R cells out (HARD_PLAN.houseRing[0], else 5: the same box without a ring);
//   firstIn: the first tick a hard soldier stood inside the ring (inside its 2-wide band), -1 never;
//   firstNear: the first tick a hard soldier came within 12 cells outside it;
//   deaths of each side's soldiers by where they were last seen: in (inside the band), band, near (outside, within 12
//   cells), far (elsewhere); houses on the band built and broken; band cells still open at minutes 15, 20, 30.
// Then the --json file as one SCRIPTED line.
//   node scratch/ring-watch.ts <scripted-games.ts arguments>
const simDir = new URL("../", import.meta.url).pathname;
const { Runner } = await import(`${simDir}src/runner.ts`);
const { BuildingType, UnitType } = await import(`${simDir}src/protocol.ts`);
const R = (JSON.parse(process.env.HARD_PLAN || "{}").houseRing ?? [5])[0] as number;
type Where = "in" | "band" | "near" | "far";
type S = {
  seed: number; box: { x0: number; y0: number; x1: number; y1: number } | null; firstIn: number; firstNear: number;
  units: Map<number, { o: number; where: Where }>; deaths: Record<string, number>; houses: Set<number>; bandHouses: number; broken: number;
  open: Record<string, number>; tick: number; inMax: number;
};
const S = new WeakMap<object, S>();
let current: S | null = null;
const print = (s: S) => console.log("RING " + JSON.stringify({ ...s, units: undefined, houses: undefined, R }));
const soldier = (t: number) => t !== UnitType.Farmer && t !== UnitType.Militia;
const orig = Runner.prototype.tick;
Runner.prototype.tick = function (this: { game: any }, ...a: unknown[]) {
  const out = orig.apply(this, a);
  let s = S.get(this);
  if (s === undefined) {
    if (current !== null) print(current);
    s = { seed: this.game.config.seed, box: null, firstIn: -1, firstNear: -1, units: new Map(), deaths: {}, houses: new Set(), bandHouses: 0, broken: 0, open: {}, tick: 0, inMax: 0 };
    S.set(this, s);
    current = s;
  }
  const w = this.game.w;
  const u = w.units.col;
  const b = w.buildings.col;
  const n = w.size;
  s.tick = w.tick;
  if (s.box === null) {
    for (let k = 0; k < w.buildings.count; k++) {
      if (b.owner[k] === 0 && b.type[k] === BuildingType.MainCity) {
        s.box = { x0: b.cellX[k] - R - 2, y0: b.cellY[k] - R - 2, x1: b.cellX[k] + 4 + R + 1, y1: b.cellY[k] + 4 + R + 1 };
      }
    }
    if (s.box === null) return out;
  }
  const bx = s.box;
  const where = (x: number, y: number): Where => {
    if (x > bx.x0 + 1 && x < bx.x1 - 1 && y > bx.y0 + 1 && y < bx.y1 - 1) return "in";
    if (x >= bx.x0 && x <= bx.x1 && y >= bx.y0 && y <= bx.y1) return "band";
    if (x >= bx.x0 - 12 && x <= bx.x1 + 12 && y >= bx.y0 - 12 && y <= bx.y1 + 12) return "near";
    return "far";
  };
  if (w.tick % 5 === 0) {
    let inNow = 0;
    const seen = new Set<number>();
    for (let k = 0; k < w.units.count; k++) {
      if (!soldier(u.type[k]) || u.owner[k] > 1) continue;
      const wh = where(u.x[k] >> 10, u.y[k] >> 10);
      if (u.owner[k] === 1) {
        if (wh === "in") {
          inNow++;
          if (s.firstIn < 0) s.firstIn = w.tick;
        }
        if (wh === "near" && s.firstNear < 0) s.firstNear = w.tick;
      }
      seen.add(u.id[k]);
      s.units.set(u.id[k], { o: u.owner[k], where: wh });
    }
    s.inMax = Math.max(s.inMax, inNow);
    for (const [id, at] of s.units) {
      if (seen.has(id)) continue;
      s.units.delete(id);
      if (w.unit(id) >= 0) continue;
      const key = `p${at.o}-${at.where}`;
      s.deaths[key] = (s.deaths[key] ?? 0) + 1;
    }
    // Houses on the band: built (ever seen) and broken (gone).
    const now = new Set<number>();
    for (let k = 0; k < w.buildings.count; k++) {
      if (b.owner[k] !== 0 || b.type[k] !== BuildingType.House) continue;
      if (where(b.cellX[k], b.cellY[k]) !== "band" && where(b.cellX[k] + 1, b.cellY[k] + 1) !== "band") continue;
      now.add(b.id[k]);
      if (!s.houses.has(b.id[k])) {
        s.houses.add(b.id[k]);
        s.bandHouses++;
      }
    }
    for (const id of s.houses) if (!now.has(id) && w.building(id) < 0) {
      s.houses.delete(id);
      s.broken++;
    }
  }
  if (w.tick === 15 * 1200 || w.tick === 20 * 1200 || w.tick === 30 * 1200) {
    let open = 0;
    for (let y = bx.y0; y <= bx.y1; y++) for (let x = bx.x0; x <= bx.x1; x++) {
      if (x > bx.x0 + 1 && x < bx.x1 - 1 && y > bx.y0 + 1 && y < bx.y1 - 1) continue;
      if (x >= 0 && y >= 0 && x < n && y < n && w.grid[y * n + x] === 0) open++;
    }
    s.open[`m${w.tick / 1200}`] = open;
  }
  return out;
};
const rest = process.argv.slice(2);
const script = `${simDir}src/scripted-games.ts`;
process.argv = [process.argv[0], script, ...rest];
const log = console.log;
console.log = (...x: unknown[]) => { if (typeof x[0] === "string" && x[0].startsWith("RING ")) log(...x); };
await import(script);
console.log = log;
if (current !== null) print(current);
const j = rest.indexOf("--json");
if (j >= 0) {
  const { readFileSync } = await import("node:fs");
  console.log("SCRIPTED " + JSON.stringify(JSON.parse(readFileSync(rest[j + 1], "utf8"))));
}
