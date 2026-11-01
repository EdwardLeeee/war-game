// D-086 A10 (ceo 2026-11-01): hard's first battle against normal, every 10 s from minute `from` to `to`, in one game as
// late-metrics --mode ai plays it: each side's soldiers (spear/ranged/mage/cavalry), how far the armies' centres are,
// how far hard's ranged and its spearmen stand from the nearest enemy soldier (who is in front), hard's army orders
// (5 or more), and hard's soldiers lost then by their type and by what last hit them (and whether it was in a retreat).
// Several games ("seed:swap,..."); chase 0 turns #338's CHASE_ROUND off (rules.ts), 1 leaves it as it is.
//   node wavetrace.ts <sim src dir> <seed:swap,...> <difficulty "hard,normal"> <map> [from 9] [to 18] [chase 1]
const [src, gamesArg, diffArg, mapArg, fromArg, toArg, chaseArg] = process.argv.slice(2);
const from = Number(fromArg ?? "9") * 1200;
const to = Number(toArg ?? "18") * 1200;
const { Runner } = await import(`${src}/runner.ts`);
const RULES = (await import(`${src}/core/rules.ts`)) as Record<string, { on: boolean } | undefined>;
if (chaseArg === "0" && RULES.CHASE_ROUND !== undefined) RULES.CHASE_ROUND.on = false;
for (const spec of gamesArg.split(",")) {
const [seedArg, swapArg] = spec.split(":");
const seed = Number(seedArg);
const swap = swapArg === "1";
const { AI_STYLES } = await import(`${src}/ai/ai.ts`);
const winnerText = (w: { over: boolean; winner: number }, hard: number) => (!w.over ? "未分勝負" : w.winner === hard ? "困難贏" : "困難輸");
const STYLE_PAIRS: string[][] = [];
for (const a of AI_STYLES) for (const b of AI_STYLES) STYLE_PAIRS.push([a, b]);
const { CELL_SHIFT, UnitType } = await import(`${src}/protocol.ts`);
const slot = diffArg.split(",");
const difficulty = [0, 1].map((p) => slot[swap ? 1 - p : p]);
const r = new Runner({ seed, scenario: "standard", ai: [true, true], swap, styles: STYLE_PAIRS[(seed - 1) % STYLE_PAIRS.length], maxTicks: to + 1, difficulty, map: mapArg });
const g = r.game;
const w = g.w;
const hard = difficulty.indexOf("hard");
const foe = 1 - hard;
const KIND: Record<number, string> = { [UnitType.Spearman]: "槍", [UnitType.Ranged]: "遠", [UnitType.Mage]: "法", [UnitType.Cavalry]: "騎", [UnitType.Militia]: "民兵", [UnitType.Farmer]: "村民" };
const soldier = (t: number) => t === UnitType.Spearman || t === UnitType.Ranged || t === UnitType.Mage || t === UnitType.Cavalry;
const typeOf = new Map<number, number>();
const last = new Map<number, { type: number; by: number; x: number; y: number }>();
let retreatUntil = -1;
let seen = 0;
let orders: string[] = [];
let lost: Record<string, number> = {};
let lostInRetreat = 0;
const rows = ["| 分 | 困難兵（槍遠法騎） | 普通兵 | 兩軍中心距離 | 困難遠程／槍兵 離最近敵兵 | 困難軍隊指令（≥5） | 這 10 秒困難陣亡（被什麼打死） |", "|---|---|---|---|---|---|---|"];
const centre = (p: number) => {
  const u = w.units.col;
  let x = 0, y = 0, n = 0;
  for (let s = 0; s < w.units.count; s++) if (u.owner[s] === p && soldier(u.type[s])) { x += u.x[s] >> CELL_SHIFT; y += u.y[s] >> CELL_SHIFT; n++; }
  return n === 0 ? null : { x: x / n, y: y / n };
};
const counts = (p: number) => {
  const u = w.units.col;
  const n = [0, 0, 0, 0];
  for (let s = 0; s < w.units.count; s++) if (u.owner[s] === p) { const k = [UnitType.Spearman, UnitType.Ranged, UnitType.Mage, UnitType.Cavalry].indexOf(u.type[s]); if (k >= 0) n[k]++; }
  return n;
};
/** Median distance (cells) from hard's units of `type` to the nearest enemy soldier. */
const front = (type: number) => {
  const u = w.units.col;
  const d: number[] = [];
  for (let s = 0; s < w.units.count; s++) {
    if (u.owner[s] !== hard || u.type[s] !== type) continue;
    let best = 1e9;
    for (let e = 0; e < w.units.count; e++) if (u.owner[e] === foe && soldier(u.type[e])) best = Math.min(best, ((u.x[s] - u.x[e]) >> CELL_SHIFT) ** 2 + ((u.y[s] - u.y[e]) >> CELL_SHIFT) ** 2);
    if (best < 1e9) d.push(Math.round(Math.sqrt(best)));
  }
  d.sort((a, b) => a - b);
  return d.length === 0 ? "-" : String(d[d.length >> 1]);
};
while (!r.over && g.tick < to) {
  r.tick();
  const u = w.units.col;
  const alive = new Set<number>();
  for (let s = 0; s < w.units.count; s++) {
    typeOf.set(u.id[s], u.type[s]);
    if (u.owner[s] !== hard || !soldier(u.type[s])) continue;
    alive.add(u.id[s]);
    last.set(u.id[s], { type: u.type[s], by: u.hitById[s], x: u.x[s] >> CELL_SHIFT, y: u.y[s] >> CELL_SHIFT });
  }
  for (; seen < g.log.length; seen++) {
    const c = g.log[seen];
    if (c.p !== hard || !("u" in c) || c.u.length < 5 || (c.c !== "move" && c.c !== "attack" && c.c !== "retreat")) continue;
    if (c.c === "retreat") retreatUntil = g.tick + 600;
    if (g.tick >= from) orders.push(`${c.c}${"x" in c ? `(${c.x},${c.y})` : ""} ${c.u.length}`);
  }
  for (const [id, l] of last) {
    if (alive.has(id)) continue;
    last.delete(id);
    if (g.tick < from) continue;
    const k = `${KIND[l.type]}←${l.by > 0 ? (KIND[typeOf.get(l.by) ?? -1] ?? "塔／建築") : "?"}`;
    lost[k] = (lost[k] ?? 0) + 1;
    if (g.tick <= retreatUntil) lostInRetreat++;
  }
  if (g.tick < from || g.tick % 200 !== 0) continue;
  const a = centre(hard);
  const b = centre(foe);
  const dist = a && b ? Math.round(Math.hypot(a.x - b.x, a.y - b.y)) : "-";
  const seenO = new Map<string, number>();
  for (const o of orders) seenO.set(o.replace(/ \d+$/, ""), (seenO.get(o.replace(/ \d+$/, "")) ?? 0) + 1);
  rows.push(`| ${(g.tick / 1200).toFixed(2)} | ${counts(hard).join(" ")} | ${counts(foe).join(" ")} | ${dist} | ${front(UnitType.Ranged)}／${front(UnitType.Spearman)} | ${[...seenO].map(([o, n]) => (n > 1 ? `${o}×${n}` : o)).join("；")} | ${Object.entries(lost).map(([k, v]) => `${k} ${v}`).join("，")} |`);
  orders = [];
  lost = {};
}
console.log(`## 種子 ${seed}${swap ? "（對調）" : ""} ${difficulty.join("/")} ${mapArg}，CHASE_ROUND ${chaseArg === "0" ? "關" : "開"}；困難是 ${hard} 號；${winnerText(w, hard)}（第 ${(g.tick / 1200).toFixed(1)} 分）；撤退後 30 秒內的陣亡 ${lostInRetreat}`);
console.log(`- 到第 ${(g.tick / 1200).toFixed(1)} 分：困難兵 ${counts(hard).join(" ")}，普通兵 ${counts(foe).join(" ")}`);
// Only the rows with an order or a loss.
console.log(rows.filter((x, i) => i < 2 || /[a-z]|[0-9]+ \|$/.test(x.split("|").slice(6).join("|"))).join("\n"));
}
