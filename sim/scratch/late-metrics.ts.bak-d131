// Scratch (D-086 A, ceo 2026-10-18: does today's hard still have the late weaknesses of the user's
// long wins?): games played as the CI plays them, and every minute, for each AI side, what the
// research note's timelines had: soldiers and farmers, stock, gathered and wood spent that minute
// (by what the accepted commands paid for), population, cap and ceiling, towns governed, soldiers
// and farmers lost that minute. One JSON line per game. Reads only.
//   node scratch/late-metrics.ts --mode ai --games 100 --shard 0 --shards 4 --difficulty hard,hard [--map random]
//   node scratch/late-metrics.ts --mode late --seeds 1-20 [--map random]   (hard against scripted-games --late)
//   node scratch/late-metrics.ts --mode harass --seeds 1-20 [--map random]   (D-086 A3: --late --harass 10)
// D-086 A3: per AI side also its own counts (stats(), when it has them) and whether 10 or more of its
// soldiers stood within 12 cells of the enemy's main city at once (looked at every 20 ticks).
// D-086 A4: per minute its cavalry and finished arrow towers; per game the enemy ranged units and mages that
// fell while one of its cavalry had them as target (looked at every 20 ticks; the sim keeps no killer).
// D-096 (ceo 2026-10-22): per AI side the tick it first held a town (any state but neutral or ruins; looked at every 20
// ticks), and its retreats of 5 or more whose centre stood within 14 cells of a town with a gate up that is not its own
// (BuildingType.Gate, when the branch has it). --sides all: normal's sides too (default: hard's only). --gates off: the
// rules' GATE and WALLS off (when the branch has them), for the comparison.
import { AI_STYLES, type AiStyle } from "../src/ai/ai.ts";
import { createScriptedPlayer, planFor, SCRIPTED_THINK_EVERY } from "../src/ai/scripted-player.ts";
import { BUILDINGS, rules, TOWNS, UNITS } from "../src/core/rules.ts";
import { UNIT_KINDS } from "../src/core/world.ts";
import { BuildingType, MAX_TICKS, NodeKind, Order, TownChoice, TownState, UnitType, type AiDifficulty, type MapMode } from "../src/protocol.ts";
import { Runner } from "../src/runner.ts";
import { buildView, mapInfo } from "../src/view/view.ts";

const arg = (n: string, f: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : f;
};
const mode = arg("mode", "ai");
// D-089 (scratch): normal's siege numbers (--siege JSON over SIEGE) and the gathering point (--stage 0 turns it off), when the branch has them.
{
  const ai = (await import("../src/ai/ai.ts")) as Record<string, unknown>;
  const siege = ai.SIEGE as Record<string, number> | undefined;
  if (siege !== undefined) Object.assign(siege, JSON.parse(arg("siege", "{}")));
  const staging = ai.STAGING as { on: boolean } | undefined;
  if (staging !== undefined && arg("stage", "1") === "0") staging.on = false;
}
const map = arg("map", "fixed") as MapMode;
if (arg("gates", "on") === "off") {
  const rm = (await import("../src/core/rules.ts")) as Record<string, unknown>;
  for (const k of ["GATE", "WALLS"]) if (rm[k] !== undefined) (rm[k] as { on: boolean }).on = false;
}
const GATE_TYPE = (BuildingType as Record<string, number>).Gate;
// D-100 (ceo 2026-10-24): where each AI side's soldiers die, by war-game-core's death-watch.ts (#296), when the branch has it.
const DeathWatch = await import("../src/death-watch.ts").then((m) => (m as { DeathWatch: new (p: number) => { tick: (w: unknown) => void; result: () => Record<string, [number, number]> } }).DeathWatch).catch(() => null);
const STYLE_PAIRS: [AiStyle, AiStyle][] = [];
for (const a of AI_STYLES) for (const b of AI_STYLES) STYLE_PAIRS.push([a, b]);

const BUILD_KIND = (t: number) =>
  t === BuildingType.House ? "house" : t === BuildingType.Farm ? "farm" : t === BuildingType.Barracks || t === BuildingType.Range || t === BuildingType.MageHall || t === BuildingType.Stable ? "production" : "other";
const UNIT_KIND: Record<number, string> = { [UnitType.Farmer]: "farmer", [UnitType.Spearman]: "spear", [UnitType.Ranged]: "ranged", [UnitType.Mage]: "mage", [UnitType.Cavalry]: "cavalry" };

function play(r: Runner, aiSides: number[], cap: number, step: () => void): object {
  const g = r.game;
  const w = g.w;
  const u = w.units.col;
  let seen = 0;
  const wood = aiSides.map(() => new Map<string, number>());
  const gatheredBefore = [0, 0, 0, 0, 0, 0, 0, 0];
  const lostBefore = [0, 0];
  const farmersLostBefore = [0, 0];
  const minutes: object[] = [];
  const soldiersLost = (p: number) => {
    let n = 0;
    for (const t of [UnitType.Spearman, UnitType.Ranged, UnitType.Mage, UnitType.Cavalry]) n += w.lost[p * UNIT_KINDS + t] ?? 0;
    return n;
  };
  const reached = aiSides.map(() => false);
  const cavKills = aiSides.map(() => 0);
  const hunted = aiSides.map(() => new Set<number>());
  const spawns = w.map.spawns;
  const firstTown = aiSides.map(() => -1);
  const watches = DeathWatch === null ? [] : aiSides.map((p) => new DeathWatch(p));
  const gateRetreats = aiSides.map(() => 0);
  const lastBig: ({ c: string; t: number } | null)[] = aiSides.map(() => null);
  const flips = aiSides.map(() => 0);
  const flipMinutes = aiSides.map(() => new Set<number>());
  // ceo 2026-10-28: each town it took, [minute, 1 govern / 0 plunder, its soldiers minus the enemy's then].
  const choices: number[][][] = aiSides.map(() => []);
  while (!r.over && g.tick < cap) {
    step();
    for (const dw of watches) dw.tick(w);
    if (g.tick % 20 === 0) {
      aiSides.forEach((p, k) => {
        if (firstTown[k] >= 0) return;
        for (let t = 0; t < w.townSize.length; t++) if (w.townOwner[t] === p && w.townState[t] !== TownState.Neutral && w.townState[t] !== TownState.Ruins) firstTown[k] = g.tick;
      });
      aiSides.forEach((p, k) => {
        for (const id of hunted[k]) if (w.unit(id) < 0) cavKills[k]++;
        hunted[k].clear();
        for (let s = 0; s < w.units.count; s++) {
          if (u.owner[s] !== p || u.type[s] !== UnitType.Cavalry) continue;
          const t = w.unit(u.target[s]);
          if (t >= 0 && u.owner[t] === 1 - p && (u.type[t] === UnitType.Ranged || u.type[t] === UnitType.Mage)) hunted[k].add(u.id[t]);
        }
      });
      aiSides.forEach((p, k) => {
        if (reached[k]) return;
        const e = spawns.find((s0) => s0.player !== p)!;
        let n = 0;
        for (let s = 0; s < w.units.count; s++) {
          if (u.owner[s] !== p || u.type[s] === UnitType.Farmer || u.type[s] === UnitType.Militia) continue;
          const dx = (u.x[s] >> 10) - (e.cellX + 2);
          const dy = (u.y[s] >> 10) - (e.cellY + 2);
          if (dx * dx + dy * dy <= 144) n++;
        }
        if (n >= 10) reached[k] = true;
      });
    }
    const refused = new Set(g.events.filter((e) => e.ev.k === "rejected").map((e) => `${e.to}:${(e.ev as { seq: number }).seq}`));
    for (; seen < g.log.length; seen++) {
      const c = g.log[seen] as unknown as { p: number; t: number; c: string; seq: number; type?: number; n?: number; town?: number; choice?: number };
      const k = aiSides.indexOf(c.p);
      if (k < 0 || refused.has(`${c.p}:${c.seq}`)) continue;
      const ids = (c as unknown as { u?: number[] }).u;
      // D-086 A9 (ceo 2026-10-31): the army's turns back: an order of 30 or more soldiers, a retreat after a move or a
      // move after a retreat, within a minute; per side the count, and the minutes of the game they fell in.
      if ((c.c === "move" || c.c === "retreat") && Array.isArray(ids) && ids.length >= 30) {
        const prev = lastBig[k];
        if (prev !== null && prev.c !== c.c && g.tick - prev.t <= 1200) {
          flips[k]++;
          flipMinutes[k].add(Math.trunc(g.tick / 1200));
        }
        lastBig[k] = { c: c.c, t: g.tick };
      }
      if (c.c === "town_choice") {
        let mine = 0;
        let theirs = 0;
        for (let s0 = 0; s0 < w.units.count; s0++) {
          if (u.type[s0] === UnitType.Farmer || u.type[s0] === UnitType.Militia) continue;
          if (u.owner[s0] === c.p) mine++;
          else if (u.owner[s0] === 1 - c.p) theirs++;
        }
        choices[k].push([Math.round((g.tick * 10) / 1200) / 10, c.choice === TownChoice.Govern ? 1 : 0, mine - theirs]);
      }
      if (c.c === "retreat" && GATE_TYPE !== undefined && Array.isArray(ids) && ids.length >= 5) {
        let sx = 0;
        let sy = 0;
        let n = 0;
        for (const id of ids) {
          const s0 = w.unit(id);
          if (s0 < 0) continue;
          sx += u.x[s0] >> 10;
          sy += u.y[s0] >> 10;
          n++;
        }
        const b = w.buildings.col;
        let byGate = false;
        for (let s0 = 0; s0 < w.buildings.count && n > 0 && !byGate; s0++) {
          if (b.type[s0] !== GATE_TYPE || b.owner[s0] === c.p) continue;
          const dx = b.cellX[s0] - Math.trunc(sx / n);
          const dy = b.cellY[s0] - Math.trunc(sy / n);
          byGate = dx * dx + dy * dy <= 14 * 14;
        }
        if (byGate) gateRetreats[k]++;
      }
      let what = "";
      let cost = 0;
      if (c.c === "train" && c.type !== undefined) {
        what = UNIT_KIND[c.type] ?? `unit${c.type}`;
        cost = UNITS[c.type].cost.wood * (c.n ?? 1);
      } else if (c.c === "build" && c.type !== undefined) {
        what = BUILD_KIND(c.type);
        cost = BUILDINGS[c.type].cost.wood;
      } else if (c.c === "town_choice" && c.choice === TownChoice.Govern && c.town !== undefined) {
        what = "govern";
        cost = TOWNS[w.townSize[c.town]].governCost.wood;
      }
      if (cost > 0) wood[k].set(what, (wood[k].get(what) ?? 0) + cost);
    }
    if (g.tick % 1200 !== 0 && !r.over && g.tick < cap) continue;
    const sides = aiSides.map((p, k) => {
      let farmers = 0;
      let soldiers = 0;
      for (let s = 0; s < w.units.count; s++) {
        if (u.owner[s] !== p || u.type[s] === UnitType.Militia) continue;
        if (u.type[s] === UnitType.Farmer) farmers++;
        else soldiers++;
      }
      let governed = 0;
      for (let t = 0; t < w.townSize.length; t++) if (w.townOwner[t] === p && w.townState[t] === TownState.Governed) governed++;
      // D-086 A4 (ceo 2026-10-21): towns it holds in any state (repairing, governed, plundering, awaiting the choice).
      let held = 0;
      for (let t = 0; t < w.townSize.length; t++) if (w.townOwner[t] === p && w.townState[t] !== TownState.Neutral && w.townState[t] !== TownState.Ruins) held++;
      let producers = 0;
      const b = w.buildings.col;
      for (let s = 0; s < w.buildings.count; s++) if (b.owner[s] === p && b.progress[s] >= 1000 && BUILD_KIND(b.type[s]) === "production") producers++;
      const gathered = [0, 1, 2, 3].map((r0) => w.gathered[p * 4 + r0] - gatheredBefore[p * 4 + r0]);
      for (let r0 = 0; r0 < 4; r0++) gatheredBefore[p * 4 + r0] = w.gathered[p * 4 + r0];
      const lost = soldiersLost(p) - lostBefore[p];
      lostBefore[p] = soldiersLost(p);
      const fl = (w.lost[p * UNIT_KINDS + UnitType.Farmer] ?? 0) - farmersLostBefore[p];
      farmersLostBefore[p] = w.lost[p * UNIT_KINDS + UnitType.Farmer] ?? 0;
      const spent = Object.fromEntries(wood[k]);
      wood[k].clear();
      return {
        p,
        soldiers,
        farmers,
        res: Array.from(w.res.subarray(p * 4, p * 4 + 4)),
        gathered,
        wood: spent,
        pop: w.population(p),
        cap: w.populationCap(p),
        ceiling: w.populationCeiling(p),
        governed,
        held,
        producers,
        lost,
        farmersLost: fl,
        cityHp: w.mainCity(p) < 0 ? 0 : b.hp[w.mainCity(p)],
        cavalry: (() => {
          let c = 0;
          for (let s = 0; s < w.units.count; s++) if (u.owner[s] === p && u.type[s] === UnitType.Cavalry) c++;
          return c;
        })(),
        towers: (() => {
          let c = 0;
          for (let s = 0; s < w.buildings.count; s++) if (b.owner[s] === p && b.type[s] === BuildingType.ArrowTower && b.progress[s] >= 1000) c++;
          return c;
        })(),
        // ceo 2026-10-28: finished arrow towers by its main city (14 cells) and by a town it governs (radius + 6), apart.
        ...(() => {
          let home = 0;
          let town = 0;
          const sp = w.map.spawns[p];
          for (let s = 0; s < w.buildings.count; s++) {
            if (b.owner[s] !== p || b.type[s] !== BuildingType.ArrowTower || b.progress[s] < 1000) continue;
            const x = b.cellX[s];
            const y = b.cellY[s];
            if ((x - sp.cellX - 2) ** 2 + (y - sp.cellY - 2) ** 2 <= 14 * 14) home++;
            else if (w.map.towns.some((t) => w.townOwner[t.id] === p && w.townState[t.id] === TownState.Governed && (x - t.cellX) ** 2 + (y - t.cellY) ** 2 <= (t.radius + 6) ** 2)) town++;
          }
          return { towersHome: home, towersTown: town };
        })(),
        revolts: w.revolts[p],
        // D-086 A8 (ceo 2026-10-29): its finished lumber camps, its woodcutters, and the median of their trees' distance
        // (cells, rounded) to the nearest of its finished lumber camps and main city.
        ...(() => {
          const drops: { x: number; y: number }[] = [];
          let camps = 0;
          for (let s = 0; s < w.buildings.count; s++) {
            if (b.owner[s] !== p || b.progress[s] < 1000) continue;
            if (b.type[s] === BuildingType.LumberCamp) camps++;
            if (b.type[s] === BuildingType.LumberCamp || b.type[s] === BuildingType.MainCity) drops.push({ x: b.cellX[s] + 1, y: b.cellY[s] + 1 });
          }
          const dist: number[] = [];
          for (let s = 0; s < w.units.count; s++) {
            if (u.owner[s] !== p || u.type[s] !== UnitType.Farmer || u.order[s] !== Order.Gather || u.onFarm[s] !== 0) continue;
            const node = u.orderTarget[s];
            if (node < 0 || w.nodeKind[node] !== NodeKind.Tree || drops.length === 0) continue;
            let best = Infinity;
            for (const d of drops) best = Math.min(best, (d.x - w.nodeX[node]) ** 2 + (d.y - w.nodeY[node]) ** 2);
            dist.push(Math.round(Math.sqrt(best)));
          }
          dist.sort((a0, b0) => a0 - b0);
          return { camps, woodcutters: dist.length, woodDist: dist.length === 0 ? -1 : dist[dist.length >> 1] };
        })(),
      };
    });
    const foes = aiSides.map((p) => {
      let n = 0;
      for (let s = 0; s < w.units.count; s++) if (u.owner[s] === 1 - p && u.type[s] !== UnitType.Farmer && u.type[s] !== UnitType.Militia) n++;
      let governed = 0;
      for (let t = 0; t < w.townSize.length; t++) if (w.townOwner[t] === 1 - p && w.townState[t] === TownState.Governed) governed++;
      return { soldiers: n, governed };
    });
    minutes.push({ t: g.tick, sides, foes });
  }
  const ais = (r as unknown as { ais: ({ stats?: () => Record<string, number> } | null)[] }).ais;
  const stats = aiSides.map((p) => ais[p]?.stats?.() ?? null);
  const deathsAt = watches.map((dw) => dw.result());
  return { endTick: g.tick, over: r.over, winner: w.winner, minutes, reached, stats, cavKills, firstTown, gateRetreats, deathsAt, choices, flips, flipMinutes: flipMinutes.map((m) => m.size), finalHash: (g.hash() >>> 0).toString(16).padStart(8, "0") };
}

if (mode === "ai") {
  const games = Number(arg("games", "100"));
  const shard = Number(arg("shard", "0"));
  const shards = Number(arg("shards", "1"));
  const slot = arg("difficulty", "hard,hard").split(",") as AiDifficulty[];
  const maxTicks = Number(arg("ticks", String(MAX_TICKS)));
  const per = Math.ceil(games / shards);
  for (let i = shard * per; i < Math.min(games, (shard + 1) * per); i++) {
    // --seed-from: another batch of seeds (experience.wargame.draw_gate_seed_noise_rerun_new_seeds: 101).
    const seed = Number(arg("seed-from", "1")) + (i >> 1);
    const swap = (i & 1) === 1;
    const difficulty = [0, 1].map((p) => slot[swap ? 1 - p : p]);
    const r = new Runner({ seed, scenario: "standard", ai: [true, true], swap, styles: STYLE_PAIRS[(seed - 1) % STYLE_PAIRS.length], maxTicks, difficulty, map });
    const hard = [0, 1].filter((p) => arg("sides", "hard") === "all" || difficulty[p] === "hard");
    console.log(JSON.stringify({ mode, game: i, seed, swap, map, difficulty, ...play(r, hard, maxTicks, () => r.tick()) }));
  }
} else {
  const [a, b] = arg("seeds", "1-20").split("-").map(Number);
  for (let seed = a; seed <= b; seed++) {
    // As scripted-games --strategy push --speed h1 --formation close --late --difficulty hard.
    const plan = planFor("push", "h1", "close");
    // --mode push / push-auto: the active groups as scripted-games plays them (--strategy push, --auto-train).
    if (mode === "late" || mode === "harass") Object.assign(plan, { farmers: 24, production: 4, spearShare: 35, choice: "govern", corners: true, townAt: 10, homeTowers: 2, cavalryShare: 15, pushAt: 50, counterAt: 50, pushAhead: true });
    if (mode === "harass") Object.assign(plan, { harass: 10 });
    if (mode === "push-auto") plan.autoTrain = true;
    const r = new Runner({ seed, scenario: "standard", ai: [false, true], maxTicks: 0, difficulty: ["normal", "hard"], autoTrain: [plan.autoTrain, false], map });
    const m = r.game.w.map;
    const player = createScriptedPlayer(0, { map: mapInfo(m, 0), rules: rules(m), frame: m.frames[0] }, plan);
    let seq = 0;
    const step = () => {
      if (r.game.tick % SCRIPTED_THINK_EVERY === 0) for (const body of player.think(buildView(r.game, 0))) r.command(0, { ...body, seq: seq++ } as never);
      r.tick();
    };
    console.log(JSON.stringify({ mode, seed, map, difficulty: ["normal", "hard"], ...play(r, [1], Number(arg("ticks", String(50 * 1200))), step) }));
  }
}
