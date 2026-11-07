// Scratch (D-081 / A4, ceo 2026-10-21: #260's half-way fortress, the AI's deaths by the fort 26.5 -> 75.0): the scripted
// games as src/scripted-games.ts plays them (same arguments), and for the AI soldiers within a finished fort's reach
// (looked at every 20 ticks, as scripted-games) and those that died within 12 cells of one: what the AI had last told
// them. Kinds: raze (an attack on a fort, or a move to a fort's centre: razeOrders' defenders first), city (a move to
// the player's main city or within 22 cells of it: the D-089 gathering point or the march), retreat, town, other; and
// for all but raze whether a straight line from those named (their centre when told) to the point passed within a
// finished fort's reach + 2 (what groupsOnWay looks at). One JSON line per game.
//   node scratch/fort-why.ts --seeds 1-20 --strategy push --speed h1 --formation close --fortress --difficulty normal
const simDir = new URL("../", import.meta.url).pathname;
const { Runner } = await import(`${simDir}src/runner.ts`);
const { BuildingType, UnitType } = await import(`${simDir}src/protocol.ts`);
const { rules } = await import(`${simDir}src/core/rules.ts`);
type Cmd = { c: string; u?: number[]; x?: number; y?: number; target?: number; t: number; p: number };
type Tag = { kind: string; straight: boolean };
type G = { logAt: number; last: Map<number, Tag>; aiAt: Map<number, { x: number; y: number }>; inReach: Record<string, number>; deaths: Record<string, number>; orders: Record<string, number> };
const games: G[] = [];
const S = new WeakMap<object, G>();
const arrowReach = (rules().arrows.arrowTower.range + 1023) >> 10;
const guardReach = rules().outpost.reach;
const key = (t: Tag | undefined) => (t === undefined ? "none" : t.kind === "raze" ? "raze" : `${t.kind}:${t.straight ? "seen" : "missed"}`);
const orig = Runner.prototype.tick;
Runner.prototype.tick = function (this: { game: any }, ...a: unknown[]) {
  const out = orig.apply(this, a);
  let s = S.get(this);
  if (s === undefined) {
    s = { logAt: 0, last: new Map(), aiAt: new Map(), inReach: {}, deaths: {}, orders: {} };
    S.set(this, s);
    games.push(s);
  }
  const g = this.game;
  const w = g.w;
  const b = w.buildings.col;
  const u = w.units.col;
  const forts: { x: number; y: number; size: number; reach: number }[] = [];
  for (let k = 0; k < w.buildings.count; k++) {
    if (b.owner[k] !== 0 || b.progress[k] < 1000 || (b.type[k] !== BuildingType.Outpost && b.type[k] !== BuildingType.ArrowTower)) continue;
    forts.push({ x: b.cellX[k], y: b.cellY[k], size: w.buildingSize(b.type[k]), reach: b.type[k] === BuildingType.ArrowTower ? arrowReach : guardReach });
  }
  const within = (x: number, y: number, f: { x: number; y: number; size: number }, r: number) => {
    const dx = Math.max(f.x - x, 0, x - (f.x + f.size - 1));
    const dy = Math.max(f.y - y, 0, y - (f.y + f.size - 1));
    return dx * dx + dy * dy <= r * r;
  };
  const home0 = w.map.spawns.find((p: { player: number }) => p.player === 0);
  for (; s.logAt < g.log.length; s.logAt++) {
    const c = g.log[s.logAt] as Cmd;
    if (c.p !== 1 || !Array.isArray(c.u) || c.u.length === 0) continue;
    if (c.c !== "move" && c.c !== "attack" && c.c !== "retreat") continue;
    let x = c.x;
    let y = c.y;
    let kind = "";
    if (c.target !== undefined) {
      const bs = w.building(c.target);
      if (bs >= 0) {
        x = b.cellX[bs];
        y = b.cellY[bs];
        if (b.type[bs] === BuildingType.Outpost || b.type[bs] === BuildingType.ArrowTower) kind = "raze";
      } else {
        const us = w.unit(c.target);
        if (us >= 0) {
          x = u.x[us] >> 10;
          y = u.y[us] >> 10;
        }
      }
    }
    if (x === undefined || y === undefined) continue;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const id of c.u) {
      const k = w.unit(id);
      if (k < 0) continue;
      sx += u.x[k] >> 10;
      sy += u.y[k] >> 10;
      n++;
    }
    if (n === 0) continue;
    const ax = Math.trunc(sx / n);
    const ay = Math.trunc(sy / n);
    if (kind === "") {
      const d0 = (x - home0.cellX - 2) ** 2 + (y - home0.cellY - 2) ** 2;
      if (c.c === "retreat") kind = "retreat";
      else if (forts.some((f) => within(x!, y!, f, 3))) kind = "raze";
      else if (d0 <= 22 * 22) kind = "city";
      else if (w.map.towns.some((t: { cellX: number; cellY: number }) => (t.cellX - x!) ** 2 + (t.cellY - y!) ** 2 <= 64)) kind = "town";
      else kind = "other";
    }
    // The straight line from their centre to the point, every half cell, against each fort's reach + 2.
    const len = Math.max(Math.abs(x - ax), Math.abs(y - ay));
    let straight = false;
    for (let k = 0; k <= 2 * len && !straight; k++) {
      const px = ax + Math.trunc(((x - ax) * k) / Math.max(1, 2 * len));
      const py = ay + Math.trunc(((y - ay) * k) / Math.max(1, 2 * len));
      straight = forts.some((f) => within(px, py, f, f.reach + 2));
    }
    const tag = { kind, straight };
    if (c.u.length >= 5) s.orders[key(tag)] = (s.orders[key(tag)] ?? 0) + 1;
    for (const id of c.u) s.last.set(id, tag);
  }
  if (w.tick % 20 !== 0) return out;
  if (forts.length === 0) {
    s.aiAt.clear();
    return out;
  }
  const seen = new Set<number>();
  for (let k = 0; k < w.units.count; k++) {
    if (u.owner[k] !== 1 || u.type[k] === UnitType.Farmer) continue;
    const x = u.x[k] >> 10;
    const y = u.y[k] >> 10;
    seen.add(u.id[k]);
    s.aiAt.set(u.id[k], { x, y });
    if (forts.some((f) => within(x, y, f, f.reach))) {
      const kk = key(s.last.get(u.id[k]));
      s.inReach[kk] = (s.inReach[kk] ?? 0) + 1;
    }
  }
  for (const [id, at] of s.aiAt) {
    if (seen.has(id)) continue;
    s.aiAt.delete(id);
    if (w.unit(id) < 0 && forts.some((f) => within(at.x, at.y, f, 12))) {
      const kk = key(s.last.get(id));
      s.deaths[kk] = (s.deaths[kk] ?? 0) + 1;
    }
  }
  return out;
};
const rest = process.argv.slice(2);
process.argv = [process.argv[0], `${simDir}src/scripted-games.ts`, ...rest];
const log = console.log;
console.log = () => {};
await import(`${simDir}src/scripted-games.ts`);
console.log = log;
const spec = rest[rest.indexOf("--seeds") + 1];
const seeds = spec.includes("-") ? (() => { const [p, q] = spec.split("-").map(Number); return Array.from({ length: q - p + 1 }, (_, i) => p + i); })() : spec.split(",").map(Number);
games.forEach((s, i) => console.log(JSON.stringify({ seed: seeds[i], deaths: s.deaths, inReach: s.inReach, orders: s.orders })));
