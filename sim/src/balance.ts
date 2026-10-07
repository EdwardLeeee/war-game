// Unit balance (round 3 of the prototype, D-026): small battles of equal cost (balance-lib.ts),
// each fought with the front rows 8, 9 and 10 cells apart and three ways of attacking, for the
// values before this round ("現在") and the values in the code ("這個版本"). The goals are
// judged with both sides advancing (ceo); the other two ways are listed as they come out.
//   node src/balance.ts [--check 1,2,3,4]
// Prints Markdown; with --check, exits 1 if one of the listed goals fails for the code's values.

import { type Army, armyCost, armyText, type Assault, assault, BOTH, type Fight, fewestToTake, fight, type Formation, type Held, type Hold, hold, siege, twoShots } from "./balance-lib.ts";
import { CANNON, DODGE, GARRISON, JOIN_FIGHT, MULT_DEN, MULT_NUM, UNITS } from "./core/rules.ts";
import { TownSize, UnitType } from "./protocol.ts";

/** A number this round's balance work changes: how it reads and sets the rules tables. */
interface Knob {
  label: string;
  get(): number[];
  set(v: number[]): void;
  show(v: number[]): string;
}

const KNOBS: Record<string, Knob> = {
  spearmanHp: {
    label: "槍兵生命",
    get: () => [UNITS[UnitType.Spearman].hp],
    set: ([v]) => {
      UNITS[UnitType.Spearman].hp = v;
    },
    show: ([v]) => `${v}`,
  },
  rangedVsSpearman: {
    label: "遠程打槍兵的倍率",
    get: () => [MULT_NUM[UnitType.Ranged][UnitType.Spearman], MULT_DEN[UnitType.Ranged][UnitType.Spearman]],
    set: ([num, den]) => {
      MULT_NUM[UnitType.Ranged][UnitType.Spearman] = num;
      MULT_DEN[UnitType.Ranged][UnitType.Spearman] = den;
    },
    show: ([num, den]) => `×${num}/${den}（每下 ${Math.trunc((UNITS[UnitType.Ranged].attack * num) / den)}）`,
  },
};

/** The values before this round's changes (round 2 of the prototype). */
const BEFORE: Record<string, number[]> = { spearmanHp: [60], rangedVsSpearman: [3, 2] };

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

/** Runs with joining a fight (JOIN_FIGHT, round 3) on or off. */
function withJoin<T>(on: boolean, run: () => T): T {
  const range = JOIN_FIGHT.range;
  if (!on) JOIN_FIGHT.range = 0;
  try {
    return run();
  } finally {
    JOIN_FIGHT.range = range;
  }
}

const A = (spear: number, ranged = 0, mage = 0, cav = 0): Army => ({ spear, ranged, mage, cav });
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

/** One match's table; with `off` (the same match with joining a fight off), a row for each. */
function table(m: Match, off?: Match): string[] {
  const head = `#### ${m.title}：A ${armyText(m.a)}（${armyCost(m.a)}）對 B ${armyText(m.b)}（${armyCost(m.b)}）${m.form === "loose" ? "，B 先散開" : ""}`;
  const rows = [head, "", `| 打法 | ${DISTANCES.map((d) => `${d} 格`).join(" | ")} |`, `|---|${DISTANCES.map(() => "---|").join("")}`];
  WAYS.forEach(([name], k) => {
    if (off !== undefined) rows.push(`| ${name}，一起迎戰關 | ${off.fights[k].map((f) => cell(off, f)).join(" | ")} |`);
    rows.push(`| ${name}${off !== undefined ? "，一起迎戰開" : ""} | ${m.fights[k].map((f) => cell(m, f)).join(" | ")} |`);
  });
  return [...rows, ""];
}

interface Report {
  matches: Match[];
  /** Attacker loose (D-027): 14 spearmen attack the mage side standing, close and loose. */
  loose: { b: Army; close: Fight[]; loose: Fight[] }[];
  goals: { ok: boolean; text: string }[];
}

const both = (m: Match) => m.fights[WAYS.length - 1];
/** A (the cavalry, round 7) attacks. */
const cavAttacks = (m: Match) => m.fights[0];

function measure(): Report {
  const g3 = play("目標 3：B 不該贏", A(14), A(0, 12));
  const g2 = play("目標 2：B 不該輸", A(14), A(7, 6));
  const g4a = play("目標 4：B 要贏，遠程至少損一半", A(14), A(0, 8, 2));
  const g4b = play("目標 4：B 要贏，遠程至少損一半", A(14), A(0, 4, 4));
  const g5 = play("目標 5：B 要贏", A(0, 0, 6), A(0, 12));
  const g5loose = play("目標 5（參考）：B 要贏", A(0, 0, 6), A(0, 12), "loose");
  // Round 7 (D-061): cavalry, 6 of them (840).
  const g6 = play("目標 6：A 進攻要贏", A(0, 0, 0, 6), A(0, 0, 6));
  const g7 = play("目標 7：A 不該贏", A(0, 0, 0, 6), A(14));
  const g8 = play("目標 8：A 進攻要贏，騎兵至少損三分之一", A(0, 0, 0, 6), A(0, 12));
  const g9 = play("目標 9：B 要贏", A(0, 0, 0, 6), A(7, 6));
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
    { ok: wins(both(g5), 1) === 3, text: `遠程贏 ${wins(both(g5), 1)}/3（散開時 ${wins(both(g5loose), 1)}/3）` },
    // Goals 6 and 8 as the brief puts them: the cavalry attacks (A 進攻); 7 and 9 both advancing.
    { ok: wins(cavAttacks(g6), 0) === 3, text: `騎兵進攻贏 ${wins(cavAttacks(g6), 0)}/3（雙方對進 ${wins(both(g6), 0)}/3）` },
    { ok: wins(both(g7), 0) === 0, text: `騎兵贏 ${wins(both(g7), 0)}/3` },
    {
      ok: wins(cavAttacks(g8), 0) === 3 && cavAttacks(g8).every((f) => 6 - (f.left[0].cav ?? 0) >= 2),
      text: `騎兵進攻贏 ${wins(cavAttacks(g8), 0)}/3、損 ${cavAttacks(g8).map((f) => 6 - (f.left[0].cav ?? 0)).join("/")} 名（共 6；雙方對進贏 ${wins(both(g8), 0)}/3、損 ${both(g8).map((f) => (f.winner === 0 ? 6 - (f.left[0].cav ?? 0) : 6)).join("/")}）`,
    },
    { ok: wins(both(g9), 1) === 3, text: `混編贏 ${wins(both(g9), 1)}/3` },
  ];
  return { matches: [g3, g2, g4a, g4b, g5, g5loose, g6, g7, g8, g9], loose, goals };
}

function looseTable(r: Report, off?: Report): string[] {
  const rows = [
    "#### 攻方散開：14 槍兵進攻，法師那一方站著",
    "",
    `| 對手 | 隊形 | ${DISTANCES.map((d) => `${d} 格`).join(" | ")} |`,
    `|---|---|${DISTANCES.map(() => "---|").join("")}`,
  ];
  r.loose.forEach((x, k) => {
    const m: Match = { title: "", a: A(14), b: x.b, form: "close", fights: [] };
    const sets: [string, typeof x][] = off === undefined ? [["", x]] : [["，一起迎戰關", off.loose[k]], ["，一起迎戰開", x]];
    for (const [label, y] of sets) {
      rows.push(`| ${armyText(x.b)} | 密集${label} | ${y.close.map((f) => cell(m, f)).join(" | ")} |`);
      rows.push(`| ${armyText(x.b)} | 先散開${label} | ${y.loose.map((f) => cell(m, f)).join(" | ")} |`);
    }
  });
  return [...rows, ""];
}

const GOALS = [
  "1 滿血槍兵挨兩發晶砲不倒",
  "2 花費相同，混編（槍兵在前、遠程在後）不輸純槍兵",
  "3 花費相同，沒人保護的遠程打不贏槍兵",
  "4 花費相同，法師＋遠程打贏純槍兵，但遠程至少損一半",
  "5 花費相同，遠程打贏沒人保護的法師",
  "6 花費相同，騎兵進攻沒人保護的法師要贏（第七輪；以騎兵進攻判定）",
  "7 花費相同，騎兵打不贏槍兵（第七輪）",
  "8 花費相同，騎兵打得贏沒人保護的遠程，但至少損三分之一（第七輪；以騎兵進攻判定）",
  "9 花費相同，槍兵加遠程的混編打得贏純騎兵（第七輪）",
];

/** Why a goal is allowed to fail this round (ceo 2026-10-01), shown while it does. */
const KNOWN: Record<number, string> = {
  5: "這一輪不動晶砲（ceo 選 a）。不成立的原因是晶砲的齊射：法師在遠程進到射程（5 格）前就放（8 格），密集時一發打中好幾名",
};

/**
 * Round 8 (D-069): the rules that help a defender, each with its switch. The report measures
 * them all off (as main), each on alone and all on; a rule joins this list in its own commit.
 */
interface Switch {
  label: string;
  get(): boolean;
  set(on: boolean): void;
}
const ROUND8: Switch[] = [
  {
    label: "1 躲預警圈",
    get: () => DODGE.on,
    set: (on) => {
      DODGE.on = on;
    },
  },
];

/** Round 8's switches as given (in ROUND8's order) while `run` runs; then as they were. */
function withRound8<T>(on: boolean[], run: () => T): T {
  const was = ROUND8.map((s) => s.get());
  ROUND8.forEach((s, k) => s.set(on[k]));
  try {
    return run();
  } finally {
    ROUND8.forEach((s, k) => s.set(was[k]));
  }
}

/** All off, each alone, all on (just the code's values while no rule has joined). */
function round8Configs(): { label: string; on: boolean[] }[] {
  if (ROUND8.length === 0) return [{ label: "這個版本", on: [] }];
  const off = ROUND8.map(() => false);
  return [
    { label: "全關（＝main）", on: off },
    ...ROUND8.map((s, k) => ({ label: `只開 ${s.label}`, on: off.map((_, j) => j === k) })),
    { label: "**全開**", on: ROUND8.map(() => true) },
  ];
}

function main(): void {
  const i = process.argv.indexOf("--check");
  const check = i >= 0 ? process.argv[i + 1].split(",").map(Number) : [];
  const code = values();
  const before = withValues(BEFORE, () => withJoin(false, measure));
  const off = withJoin(false, measure);
  const now = measure();
  const out: string[] = [
    "## 兵種平衡量測（原型第三輪，D-026）",
    "",
    "- 每方花費 840（四種資源都算）：槍兵 60、遠程 70、法師 140、騎兵 140（第七輪）。兩方的前排相距 8、9、10 格各打一場，最多 2 分鐘。",
    "- A 進攻：A 走向站著的 B。B 進攻：反過來。雙方對進：同時往對方走。站著的一方是積極姿態，6 格內有敵人才會動。目標以雙方對進判定。",
    "- 法師開著自動施放，魔晶足夠。",
    `- 一起迎戰（第三輪）：待命、積極姿態的兵，6 格內沒有敵人時，去打 ${JOIN_FIGHT.range / 1024} 格內隊友正在追或打的敵人（離自己原位 8 格內）。「現在」沒有這條規則；「這個版本」兩種都列。`,
    `- 晶砲不動：傷害 ${CANNON.damage}、半徑 ${CANNON.radius / 1024} 格、射程 ${CANNON.range / 1024} 格、冷卻 ${CANNON.cooldownTicks / 20} 秒。`,
    "",
    "### 數值",
    "",
    "| 項目 | 現在（第二輪） | 這個版本 |",
    "|---|---|---|",
  ];
  for (const [k, knob] of Object.entries(KNOBS)) {
    out.push(`| ${knob.label} | ${knob.show(BEFORE[k])} | ${knob.show(code[k])} |`);
  }
  out.push("", "### 目標（雙方對進）", "", "| 目標 | 現在 | 這個版本，一起迎戰關 | 這個版本 | 備註 |", "|---|---|---|---|---|");
  GOALS.forEach((g, k) => {
    const mark = (r: Report) => `${r.goals[k].ok ? "✓" : "✗"} ${r.goals[k].text}`;
    out.push(`| ${g} | ${mark(before)} | ${mark(off)} | ${mark(now)} | ${now.goals[k].ok ? "" : (KNOWN[k + 1] ?? "")} |`);
  });
  out.push("", "### 對戰：這個版本（一起迎戰關、開各一列）", "");
  now.matches.forEach((m, k) => out.push(...table(m, off.matches[k])));
  out.push(...looseTable(now, off));
  out.push("<details><summary>對戰：現在（第二輪的數值）</summary>", "");
  for (const m of before.matches) out.push(...table(m));
  out.push(...looseTable(before));
  out.push("</details>", "");
  {
    // Towns as they stand at the start of a game (militia, the big town's tower): the fewest
    // spearmen that take each, before and now (brief: taking towns should not get much easier
    // or harder), then a larger force for the losses.
    const name = (size: number) => (size === TownSize.Small ? "小鎮" : "大城");
    out.push("### 打野城（開局的民兵與箭樓，槍兵從離城 10–13 格處出發）", "", "| 城鎮 | 現在最少幾名槍兵 | 這個版本最少幾名 |", "|---|---|---|");
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
  {
    // Round 7 (D-061): attacking a main city that defends itself. The attackers are the push
    // group's first march (24) and a quarter more (30); goal: towers and hiding make it clearly
    // harder, but not impossible.
    out.push(
      "### 攻打主城（第七輪，D-061）",
      "",
      "- 攻方（玩家 0）從 20 格外前進到主城旁，遇到什麼打什麼，沒有操作。守方（玩家 1）4 遠程＋2 法師（自動施放、魔晶 100），三種站法：站在主城旁、全部躲進主城、2 座箭樓（主城前 6 格）各躲 3 名。最多 3 分鐘。",
      `- 躲在建築裡的法師放晶砲：傷害 ${GARRISON.cannonPermille / 10}%、冷卻 ×${GARRISON.cannonCooldown}（ceo 2026-10-07 選 B）。`,
      "",
      "| 攻方 | 隊形 | 站在主城旁 | 躲進主城 | 2 座箭樓各躲 3 名 |",
      "|---|---|---|---|---|",
    );
    const show = (r: Assault) =>
      `${r.fell ? `打下，${(r.ticks / 20).toFixed(0)} 秒，剩 ${r.attackersLeft} 名` : `沒打下，${r.attackersLeft > 0 ? `剩 ${r.attackersLeft} 名` : "全滅"}，主城剩 ${r.cityHp}`}；守方剩 ${r.defendersLeft}${r.towersLeft > 0 ? `、箭樓剩 ${r.towersLeft}` : ""}`;
    for (const army of [A(14, 8, 2), A(17, 10, 3)]) {
      for (const loose of [false, true]) {
        out.push(`| ${armyText(army)} | ${loose ? "散開" : "密集"} | ${(["standing", "city", "towers"] as const).map((d) => show(assault(d, army, loose))).join(" | ")} |`);
      }
    }
    out.push("");
  }
  {
    // Round 8 (D-069): a governed town held against mages that fire first. The user: "如果是在
    // 中立城市固守，對方進攻的法師往往會先開砲，先開砲就會導致我後續會戰兵力非常劣勢".
    const configs = round8Configs();
    const ways: [Hold, string][] = [
      ["idle", "待命"],
      ["hold", "堅守"],
      ["tower", "有箭樓"],
    ];
    out.push(
      "### 守城（第八輪，D-069）",
      "",
      "- 守方（玩家 1）站在自己治理中的小鎮（兩方出生點中間那座），一個移動指令帶進去的（有隊號）。槍兵、遠程各半，花費和攻方差不到一對；有箭樓時少一座箭樓的錢（150），箭樓在鎮中心前 2 格。",
      "- 攻方（玩家 0）6 槍兵、6 遠程加 2–4 名法師，從南邊 16 格外過來。法師一字排開，走到最近的守兵在射程內 1 格；其他人在法師後 3 格等。每名法師朝打中最多人的守兵開一砲（各打不同點），砲落地後全部衝進城鎮，法師開著自動施放。衝鋒後最多 2 分鐘。",
      "- 格子：開打前守方剩幾名（生命剩幾 %）；誰贏、剩幾名；攻方晶砲一共打死幾名。",
      "",
      `| 守方 | 法師 | ${configs.map((c) => c.label).join(" | ")} |`,
      `|---|---|${configs.map(() => "---|").join("")}`,
    );
    const show = (r: Held) => {
      const end = r.winner === 0 ? `攻方贏，剩 ${r.attackersLeft}/${r.attackers}` : r.winner === 1 ? `**守方贏**，剩 ${r.defendersLeft}/${r.defenders}` : `沒分出，${r.attackersLeft} 對 ${r.defendersLeft}`;
      return `開打前 ${r.beforeCharge}/${r.defenders}（${r.hpBeforeCharge}%）；${end}；晶砲打死 ${r.cannonKills}`;
    };
    const kills = configs.map(() => 0);
    const held = configs.map(() => 0);
    for (const [way, name] of ways) {
      for (const mages of [2, 3, 4]) {
        const rs = configs.map((c) => withRound8(c.on, () => hold(way, mages)));
        rs.forEach((r, k) => {
          kills[k] += r.cannonKills;
          if (r.winner === 1) held[k]++;
        });
        out.push(`| ${name} | ${mages} | ${rs.map(show).join(" | ")} |`);
      }
    }
    out.push(`| 合計 | | ${configs.map((_, k) => `守住 ${held[k]}/9，晶砲打死 ${kills[k]}`).join(" | ")} |`, "");
    if (ROUND8.length > 0) {
      // Goals 1-9 under each switch (both sides advancing, as the goals table above).
      const reports = configs.map((c) => withRound8(c.on, measure));
      out.push("### 目標在第八輪各規則下（雙方對進）", "", `| 目標 | ${configs.map((c) => c.label).join(" | ")} |`, `|---|${configs.map(() => "---|").join("")}`);
      GOALS.forEach((g, k) => out.push(`| ${g} | ${reports.map((r) => `${r.goals[k].ok ? "✓" : "✗"} ${r.goals[k].text}`).join(" | ")} |`));
      out.push("");
    }
  }
  const failed = check.filter((g) => !now.goals[g - 1]?.ok);
  if (check.length > 0) out.push(failed.length === 0 ? `檢查的目標（${check.join("、")}）都成立。` : `未成立：目標 ${failed.join("、")}。`, "");
  console.log(out.join("\n"));
  if (failed.length > 0) process.exitCode = 1;
}

main();
