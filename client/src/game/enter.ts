// 進駐 (the user 2026-11-05, D-124, D-125; design/r13 R13-01 B): 駐軍, 躲進去 and 駐守 as one button:
// the soldiers selected, a tap on one of ours, and that place says who goes in. No new command:
//   our town (or its keep, which holds nobody: the town): `guard`, the selected and the rest of their
//     groups, the ranged and the mages up on its walls;
//   our main city or an arrow tower: `garrison`, the ranged and the mages, as many as there is room for;
//   our outpost: `post`, the spearmen, as many as there is room for.
// Room for fewer than can go: the nearest, chosen here (the simulation takes them in id order, and the
// tag says who goes). What a tag says and whom it sends. Pure, for the unit tests.

import { type Rules, UnitType } from "../sim.ts";
import { garrisonTypes, outpostSlots } from "./features.ts";

export const ENTER_PROMPT = "點亮起來的建築：標籤寫誰進去、誰留下";
export const ENTER_WRONG_TARGET = "要點亮起來的建築：自己蓋好的城、主城、箭樓或哨所";

/** The names on the tags, in the order they are listed. */
const TAG_NAME: readonly [number, string][] = [
  [UnitType.Spearman, "槍兵"],
  [UnitType.Ranged, "遠程"],
  [UnitType.Mage, "法師"],
  [UnitType.Cavalry, "騎兵"],
  [UnitType.Siege, "攻城砲"],
];

export interface EnterSoldier {
  id: number;
  type: number;
  /** Where it is, cells. */
  x: number;
  y: number;
}

/** Who goes in and what the tag says. */
export interface EnterPlan {
  /** The soldiers the order goes to, none when it cannot be entered. */
  go: number[];
  /** Grey: nobody can go in; a tap says `why`. */
  off: boolean;
  /** The tag's lines: 「進 …」 and under it 「留 …」 (or what happens to them); grey, the reason alone. */
  head: string;
  sub: string | null;
  /** The small tag (B2 rule 4): 「進 3」; empty when grey. */
  chip: string;
  /** Who goes in, on an arrow to a building off the screen: 「進 12 名」. */
  short: string;
  /** Said when a grey one is tapped. */
  why: string | null;
}

/** 「遠程 4・法師 2」: how many of each, in the tags' order. */
export function whoText(types: readonly number[]): string {
  return TAG_NAME.flatMap(([type, name]) => {
    const n = types.filter((t) => t === type).length;
    return n === 0 ? [] : [`${name} ${n}`];
  }).join("・");
}

/** 「槍兵、騎兵」: which kinds, in the tags' order. */
function kindsText(types: readonly number[]): string {
  return TAG_NAME.filter(([type]) => types.includes(type))
    .map(([, name]) => name)
    .join("、");
}

const greyPlan = (head: string, why: string): EnterPlan => ({ go: [], off: true, head, sub: null, chip: "", short: "", why });

const openPlan = (go: number[], head: string, sub: string | null): EnterPlan => ({ go, off: false, head, sub, chip: `進 ${go.length}`, short: `進 ${go.length} 名`, why: null });

/**
 * A place that takes some kinds and has room for some of them (a main city, an arrow tower, an
 * outpost). `room`: its places left, those on their way there taken out already.
 */
export function buildingPlan(selected: readonly EnterSoldier[], place: { name: string; x: number; y: number; cap: number; room: number }, takes: readonly number[]): EnterPlan {
  const fit = selected.filter((s) => takes.includes(s.type));
  if (fit.length === 0) {
    const kinds = kindsText(selected.map((s) => s.type));
    return greyPlan(`${kinds}進不去`, `${kinds}進不去${place.name}`);
  }
  if (place.room <= 0) return greyPlan(`滿了 ${place.cap}/${place.cap}`, `${place.name}滿了（最多 ${place.cap} 名），沒有人進去`);
  if (fit.length <= place.room) {
    const stay = selected.filter((s) => !takes.includes(s.type)).map((s) => s.type);
    return openPlan(fit.map((s) => s.id).sort((a, b) => a - b), `進 ${whoText(fit.map((s) => s.type))}`, stay.length > 0 ? `留 ${whoText(stay)}` : null);
  }
  const far = (s: EnterSoldier) => (s.x - place.x) ** 2 + (s.y - place.y) ** 2;
  const go = [...fit]
    .sort((a, b) => far(a) - far(b) || a.id - b.id)
    .slice(0, place.room)
    .map((s) => s.id)
    .sort((a, b) => a - b);
  return openPlan(go, `進 最近的 ${go.length} 名`, `留 ${selected.length - go.length} 名`);
}

/**
 * Our town: everyone who goes (the selected and the rest of their groups, those another town keeps
 * as its least left out, `kept`), the ranged and the mages up on its walls.
 */
export function townPlan(going: readonly EnterSoldier[], kept: number, walls: boolean): EnterPlan {
  if (going.length === 0) return greyPlan(kept > 0 ? "都要留下守城" : "已經在這座城", kept > 0 ? `城裡的 ${kept} 名都要留下守城` : "他們已經駐守在這座城");
  const up = walls ? kindsText(going.map((s) => s.type).filter((t) => t === UnitType.Ranged || t === UnitType.Mage)) : "";
  const sub = kept > 0 ? `原本的城留 ${kept} 名` : up !== "" ? `${up}上牆` : null;
  return openPlan(going.map((s) => s.id).sort((a, b) => a - b), kept > 0 ? `進 ${going.length} 名` : `進 ${going.length} 名全進城`, sub);
}

/** Rule 12 of R13-01-B2: nowhere to go: why, by what is selected. */
export function enterNowhereText(types: readonly number[], anyFull: boolean, rules: Pick<Rules, "features" | "garrisonTypes" | "outpost"> | null): string {
  if (anyFull) return "選的兵沒有地方可以進駐：能進的都滿了";
  const hides = garrisonTypes(rules);
  const posts = outpostSlots(rules) > 0;
  const seen = new Map<string, number[]>();
  for (const [type] of TAG_NAME) {
    if (!types.includes(type)) continue;
    const place = hides.includes(type) ? "自己的城、主城和箭樓" : posts && type === UnitType.Spearman ? "自己的城和哨所" : "自己的城";
    seen.set(place, [...(seen.get(place) ?? []), type]);
  }
  return `選的兵沒有地方可以進駐：${[...seen].map(([place, kinds]) => `${kindsText(kinds)}只能進${place}`).join("，")}`;
}

/** Whether 進駐 is offered at all: something it could go into is on (features.ts). */
export function enterOn(rules: Pick<Rules, "features" | "garrisonTypes" | "outpost"> | null): boolean {
  return garrisonTypes(rules).length > 0 || outpostSlots(rules) > 0 || rules?.features?.walls === true;
}
