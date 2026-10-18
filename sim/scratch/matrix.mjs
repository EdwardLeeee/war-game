// The matrices of the AI scratch workflow, from sim/scratch/candidates.json.
import { readFileSync } from "node:fs";
const c = JSON.parse(readFileSync("sim/scratch/candidates.json", "utf8"));
const GROUPS = {
  push: "--strategy push --speed h1 --formation close",
  defend: "--strategy defend --speed h1 --formation close",
  "defend-loose": "--strategy defend --speed h1 --formation all",
  "defend-eco": "--strategy defend --speed eco --formation all",
  notown: "--strategy notown --speed h1 --formation close",
  "push-eco": "--strategy push --speed eco --formation close",
  "push-loose": "--strategy push --speed h1 --formation all",
  "push-corners": "--strategy push --speed h1 --formation close --corners",
  "push-auto": "--strategy push --speed h1 --formation close --auto-train",
  "push-auto-corners": "--strategy push --speed h1 --formation close --auto-train --corners",
  "push-corners-govern": "--strategy push --speed h1 --formation close --corners --govern",
  "push-raid": "--strategy push --speed h1 --formation close --raid 4",
  "push-random": "--strategy push --speed h1 --formation close --map random",
  "push-corners-random": "--strategy push --speed h1 --formation close --corners --map random",
  "push-auto-random": "--strategy push --speed h1 --formation close --auto-train --map random",
  "push-race": "--strategy push --speed h1 --formation close --user-eco --race edge --race-stage --race-at 99 --race-by 11.5",
  // D-080: core's tower rush and war-game-ai's variants (rush-patch.py, RUSH=1).
  "push-towerrush": "--strategy push --speed h1 --formation close --tower-rush 6",
  "push-towerrush-farmers": "--strategy push --speed h1 --formation close --tower-rush-farmers",
  "push-fortress": "--strategy push --speed h1 --formation close --fortress",
  "push-fortress-random": "--strategy push --speed h1 --formation close --fortress --map random",
  "push-fortress-hold": "--strategy push --speed h1 --formation close --fortress-hold 60",
  "push-fortress-hold-random": "--strategy push --speed h1 --formation close --fortress-hold 60 --map random",
  "rush-farmers-early": "--strategy push --speed h1 --formation close --tower-rush-farmers --rush-early",
  "rush-dist20": "--strategy push --speed h1 --formation close --tower-rush 6 --rush-dist 20",
  "rush-hold": "--strategy push --speed h1 --formation close --tower-rush 6 --rush-hold",
  "rush-town": "--strategy push --speed h1 --formation close --tower-rush 6 --rush-town",
};
const games = [];
for (const g of c.games ?? []) {
  for (let s = 0; s < g.shards; s++) {
    games.push({ name: g.name, difficulty: g.difficulty, a: JSON.stringify(g.a ?? {}), b: g.b ? JSON.stringify(g.b) : "", games: g.games, shards: g.shards, shard: s, extra: g.map === "random" ? "--map random" : "" });
  }
}
const scripted = [];
for (const s of c.scripted ?? []) {
  for (const group of s.groups ?? Object.keys(GROUPS)) {
    for (const seeds of s.chunks ?? ["1-20", "21-40"]) {
      scripted.push({ name: s.name, group, args: GROUPS[group] + (s.extra ? ` ${s.extra}` : ""), seeds, a: JSON.stringify(s.a ?? {}), difficulty: s.difficulty ?? "hard" });
    }
  }
}
const think = (c.think ?? []).map((t) => ({ name: t.name, seeds: t.seeds ?? "1-3", a: JSON.stringify(t.a ?? {}), map: t.map ?? "fixed" }));
const traces = (c.traces ?? []).map((t) => ({ name: t.name, script: t.script, args: t.args ?? "", a: JSON.stringify(t.a ?? {}), b: t.b ? JSON.stringify(t.b) : "" }));
const none = [{ name: "none" }];
console.log(`games=${JSON.stringify(games.length ? games : none)}`);
console.log(`scripted=${JSON.stringify(scripted.length ? scripted : none)}`);
console.log(`think=${JSON.stringify(think.length ? think : none)}`);
console.log(`traces=${JSON.stringify(traces.length ? traces : none)}`);
