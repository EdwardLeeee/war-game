// Unit balance (round 3 of the prototype, D-026; round 4, D-035, D-037): small battles of equal
// cost (balance-lib.ts), each fought with the front rows 8, 9 and 10 cells apart and three ways
// of attacking, for the values and rules before this round ("第三輪") and those in the code
// ("這個版本"). The goals are judged with both sides advancing (ceo); the other two ways are
// listed as they come out.
//   node src/balance.ts [--check 1,2,3,4,5]
// Prints Markdown; with --check, exits 1 if one of the listed goals fails for the code's values.

import { type Army, armyCost, armyText, BOTH, type Fight, fewestToTake, fight, type Formation, siege, twoShots } from "./balance-lib.ts";
import { CANNON, LOOSE_KEEP, MULT_DEN, MULT_NUM, SHIELD, UNITS } from "./core/rules.ts";
import { TownSize, UnitType } from "./protocol.ts";

/** A number this round's balance work changes: how it reads and sets the rules tables. */
interface Knob {
  label: string;
  get(): number[];
  set(v: number[]): void;
  show(v: number[]): string;
}

const KNOBS: Record<string, Knob> = {
  rangedVsShield: {
    label: "遠程打法師防護罩的倍率",
    get: () => [MULT_NUM[UnitType.Ranged][SHIELD], MULT_DEN[UnitType.Ranged][SHIELD]],
    set: ([num, den]) => {
      MULT_NUM[UnitType.Ranged][SHIELD] = num;
      MULT_DEN[UnitType.Ranged][SHIELD] = den;
    },
    show: ([num, den]) => `×${num}/${den}（每下 ${Math.trunc((UNITS[UnitType.Ranged].attack * num) / den)}）`,
  },
  looseSpacing: {
    label: "散開的遠程和法師保持間隔（同一隊互相推開）",
    get: () => [LOOSE_KEEP.spacing],
    set: ([v]) => {
      LOOSE_KEEP.spacing = v;
    },
    show: ([v]) => (v === 0 ? "沒有" : `${v / 1024} 格`),
  },
};

/** The values and rules before this round's changes (round 3 of the prototype). */
const BEFORE: Record<string, number[]> = { rangedVsShield: [3, 2], looseSpacing: [0] };

function values(): Record<string, number[]> {
  const v: Record<string, number[]> = {};
  for (const [k, knob] of Object.entries(KNOBS)) v[k] = knob.get();
  return v;
}

function withValues<T>(v: Record<string, number[]>, run: () => T): T {
  const saved = values();
  for (const [k, knob] of Object.entries(KNOBS)) knob.set(v[k]);
  try {
    return run();
  } finally {
    for (const [k, knob] of Object.entries(KNOBS)) knob.set(saved[k]);
  }
}

const A = (spear: number, ranged = 0, mage = 0): Army => ({ spear, ranged, mage });
const DISTANCES = [8, 9, 10];
const WAYS: [string, number][] = [
  ["A 進攻", 0],
  ["B 進攻", 1],
  ["雙方對進", BOTH],
];

interface Match {
  title: string;
  a: Army;
  b: Army;
  /** B's formation (only B may be loose here). */
  form: Formation;
  /** Per way of attacking, per distance. */
  fights: Fight[][];
}

function play(title: string, a: Army, b: Army, form: Formation = "close"): Match {
  const fights = WAYS.map(([, att]) => DISTANCES.map((d) => fight([a, b], att, d, form, 1)));
  return { title, a, b, form, fights };
}

/** Share of B's ranged lost in a fight, percent. */
const rangedLost = (m: Match, f: Fight) => (m.b.ranged === 0 ? 0 : Math.round(((m.b.ranged - f.left[1].ranged) * 100) / m.b.ranged));

function cell(m: Match, f: Fight): string {
  const side = f.winner === 0 ? "A" : "B";
  let s = f.winner === -1 ? "平手" : `${side} 贏，剩 ${armyText(f.left[f.winner]) || "0"}`;
  if (m.b.ranged > 0 && f.winner === 1) s += `（遠程損 ${rangedLost(m, f)}%）`;
  const shots = f.shots[0] + f.shots[1];
  if (shots > 0) s += `；晶砲 ${shots} 發中 ${f.hits[0] + f.hits[1]}`;
  return s;
}

/** One match's table. */
function table(m: Match): string[] {
  const head = `#### ${m.title}：A ${armyText(m.a)}（${armyCost(m.a)}）對 B ${armyText(m.b)}（${armyCost(m.b)}）${m.form === "loose" ? "，B 先散開" : ""}`;
  const rows = [head, "", `| 打法 | ${DISTANCES.map((d) => `${d} 格`).join(" | ")} |`, `|---|${DISTANCES.map(() => "---|").join("")}`];
  WAYS.forEach(([name], k) => {
    rows.push(`| ${name} | ${m.fights[k].map((f) => cell(m, f)).join(" | ")} |`);
  });
  return [...rows, ""];
}

interface Report {
  matches: Match[];
  /** Reported, no goal (round 4): an attacker with 3 mages walks up to a standing defender without mages. */
  mages: MageRaid[];
  /** Attacker loose (D-027): 14 spearmen attack the mage side standing, close and loose. */
  loose: { b: Army; close: Fight[]; loose: Fight[] }[];
  goals: { ok: boolean; text: string }[];
}

const both = (m: Match) => m.fights[WAYS.length - 1];

/** An attacker with 3 mages (A) walks up to a standing defender of equal cost without mages (B: spearmen in front, loose ranged behind). */
interface MageRaid {
  a: Army;
  b: Army;
  fights: Fight[];
}

/** The user's case (D-044): the normal AI's army with 3 mages against a player standing at home. */
function mageRaids(): MageRaid[] {
  const b = A(7, 6);
  return [A(7, 0, 3), A(0, 6, 3)].map((a) => ({ a, b, fights: DISTANCES.map((d) => fight([a, b], 0, d, "loose-shooters", 1)) }));
}

function raidTable(r: Report): string[] {
  const rows = [`| 進攻方 A | 防守方 B | ${DISTANCES.map((d) => `${d} 格`).join(" | ")} |`, `|---|---|${DISTANCES.map(() => "---|").join("")}`];
  for (const x of r.mages) {
    const m: Match = { title: "", a: x.a, b: x.b, form: "close", fights: [] };
    rows.push(`| ${armyText(x.a)} | ${armyText(x.b)}（遠程散開） | ${x.fights.map((f) => cell(m, f)).join(" | ")} |`);
  }
  return [...rows, ""];
}

function measure(): Report {
  const g3 = play("目標 3：B 不該贏", A(14), A(0, 12));
  const g2 = play("目標 2：B 不該輸", A(14), A(7, 6));
  const g4a = play("目標 4：B 要贏，遠程至少損一半", A(14), A(0, 8, 2));
  const g4b = play("目標 4：B 要贏，遠程至少損一半", A(14), A(0, 4, 4));
  const g5 = play("目標 5：B 要贏", A(0, 0, 6), A(0, 12), "loose");
  const loose = [A(0, 8, 2), A(0, 4, 4), A(0, 0, 6)].map((b) => ({
    b,
    close: DISTANCES.map((d) => fight([A(14), b], 0, d, "close", 0)),
    loose: DISTANCES.map((d) => fight([A(14), b], 0, d, "loose", 0)),
  }));
  const shots = twoShots();
  const wins = (fs: Fight[], side: number) => fs.filter((f) => f.winner === side).length;
  const g4 = [g4a, g4b].map((m) => ({ won: wins(both(m), 1), lost: both(m).map((f) => rangedLost(m, f)) }));
  const goals = [
    { ok: shots.survives, text: `兩發 ${shots.damage}，生命 ${shots.hp}` },
    { ok: both(g2).every((f) => f.winner !== 0), text: `混編不輸 ${3 - wins(both(g2), 0)}/3` },
    { ok: wins(both(g3), 1) === 0, text: `遠程贏 ${wins(both(g3), 1)}/3` },
    {
      ok: g4.every((x) => x.won === 3 && x.lost.every((l) => l >= 50)),
      text: g4.map((x, k) => `${k === 0 ? "2 法師" : "4 法師"}贏 ${x.won}/3、遠程損 ${x.lost.join("/")}%`).join("；"),
    },
    { ok: wins(both(g5), 1) === 3, text: `散開的遠程贏 ${wins(both(g5), 1)}/3` },
  ];
  return { matches: [g3, g2, g4a, g4b, g5], loose, goals, mages: mageRaids() };
}

function looseTable(r: Report): string[] {
  const rows = [
    "#### 攻方散開：14 槍兵進攻，法師那一方站著",
    "",
    `| 對手 | 隊形 | ${DISTANCES.map((d) => `${d} 格`).join(" | ")} |`,
    `|---|---|${DISTANCES.map(() => "---|").join("")}`,
  ];
  for (const x of r.loose) {
    const m: Match = { title: "", a: A(14), b: x.b, form: "close", fights: [] };
    rows.push(`| ${armyText(x.b)} | 密集 | ${x.close.map((f) => cell(m, f)).join(" | ")} |`);
    rows.push(`| ${armyText(x.b)} | 先散開 | ${x.loose.map((f) => cell(m, f)).join(" | ")} |`);
  }
  return [...rows, ""];
}

const GOALS = [
  "1 滿血槍兵挨兩發晶砲不倒",
  "2 花費相同，混編（槍兵在前、遠程在後）不輸純槍兵",
  "3 花費相同，沒人保護的遠程打不贏槍兵",
  "4 花費相同，法師＋遠程打贏純槍兵，但遠程至少損一半",
  "5 花費相同，散開的遠程打贏沒人保護的法師",
];

/** Why a goal is allowed to fail this round, shown while it does (none in round 4: all five hold). */
const KNOWN: Record<number, string> = {};

function main(): void {
  const i = process.argv.indexOf("--check");
  const check = i >= 0 ? process.argv[i + 1].split(",").map(Number) : [];
  const code = values();
  const before = withValues(BEFORE, measure);
  const now = measure();
  const out: string[] = [
    "## 兵種平衡量測（原型第三輪 D-026；第四輪 D-035、D-037）",
    "",
    "- 每方花費 840（四種資源都算）：槍兵 60、遠程 70、法師 140。兩方的前排相距 8、9、10 格各打一場，最多 2 分鐘。",
    "- A 進攻：A 走向站著的 B。B 進攻：反過來。雙方對進：同時往對方走。站著的一方是積極姿態，6 格內有敵人才會動。目標以雙方對進判定。",
    "- 法師開著自動施放，魔晶足夠。",
    `- 晶砲不動：傷害 ${CANNON.damage}、半徑 ${CANNON.radius / 1024} 格、射程 ${CANNON.range / 1024} 格、冷卻 ${CANNON.cooldownTicks / 20} 秒。`,
    "",
    "### 數值與規則",
    "",
    "| 項目 | 第三輪 | 這個版本 |",
    "|---|---|---|",
  ];
  for (const [k, knob] of Object.entries(KNOBS)) {
    out.push(`| ${knob.label} | ${knob.show(BEFORE[k])} | ${knob.show(code[k])} |`);
  }
  out.push("", "### 目標（雙方對進）", "", "| 目標 | 第三輪 | 這個版本 | 備註 |", "|---|---|---|---|");
  GOALS.forEach((g, k) => {
    const mark = (r: Report) => `${r.goals[k].ok ? "✓" : "✗"} ${r.goals[k].text}`;
    out.push(`| ${g} | ${mark(before)} | ${mark(now)} | ${now.goals[k].ok ? "" : (KNOWN[k + 1] ?? "")} |`);
  });
  out.push("", "### 只回報：有 3 名法師的進攻方走向站著、沒有法師的防守方（A 進攻）", "", "第三輪：", "", ...raidTable(before), "這個版本：", "", ...raidTable(now));
  out.push("### 對戰：這個版本", "");
  for (const m of now.matches) out.push(...table(m));
  out.push(...looseTable(now));
  out.push("<details><summary>對戰：第三輪</summary>", "");
  for (const m of before.matches) out.push(...table(m));
  out.push(...looseTable(before));
  out.push("</details>", "");
  {
    // Towns as they stand at the start of a game (militia, the big town's tower): the fewest
    // spearmen that take each, before and now (brief: taking towns should not get much easier
    // or harder), then a larger force for the losses.
    const name = (size: number) => (size === TownSize.Small ? "小鎮" : "大城");
    out.push("### 打野城（開局的民兵與箭樓，槍兵從離城 10–13 格處出發）", "", "| 城鎮 | 第三輪最少幾名槍兵 | 這個版本最少幾名 |", "|---|---|---|");
    for (const size of [TownSize.Small, TownSize.Large]) {
      out.push(`| ${name(size)} | ${withValues(BEFORE, () => fewestToTake(size).fewest)} | ${fewestToTake(size).fewest} |`);
    }
    out.push("", "| 這個版本 | 結果 |", "|---|---|");
    for (const [size, n] of [
      [TownSize.Small, 10],
      [TownSize.Large, 15],
    ] as const) {
      const s = siege(size, n);
      out.push(`| ${n} 槍兵打${name(size)} | ${s.taken ? "攻下" : "沒攻下"}，剩 ${s.left} 名，生命剩 ${s.hpPercent}%，${(s.ticks / 20).toFixed(1)} 秒 |`);
    }
    out.push("");
  }
  const failed = check.filter((g) => !now.goals[g - 1]?.ok);
  if (check.length > 0) out.push(failed.length === 0 ? `檢查的目標（${check.join("、")}）都成立。` : `未成立：目標 ${failed.join("、")}。`, "");
  console.log(out.join("\n"));
  if (failed.length > 0) process.exitCode = 1;
}

main();
