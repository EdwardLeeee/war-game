// R14 (D-127): the panels added to the game after R6 was drawn, in R6's A 銅木, each with its states. R14-<nn>-<n>:
//   01 城門, 02 主堡, 03 市場, 04 攻城砲與砲坊, 05 哨所 (3 x 3), 06 守城中的城鎮, 07 牆上換邊, 08 進駐 (R13 B), 09 局後統計 (r14-stats.js).
// Words and numbers are the game's (client/src/ui/hud/panels.ts, names.ts, game/*.ts; sim/src/core/rules.ts) unless the board
// says 「提議」: those are drawn in a dashed yellow box (.prop). D-125: 全部離開 on 主城, 箭樓, 哨所; 召回 for each outpost squad;
// the town keeps 歸隊 and 全部帶走. 進駐 (R13 B, approved) replaces 駐守／躲進去／駐軍 in the command area.
"use strict";
(() => {
  const S = window.R6_STATES;
  const B = (label, o) => btn(label, o);
  const bar = (pct, cls = "") => `<div class="bar ${cls}"><i style="width:${pct}%"></i></div>`;
  const line = (t, cls = "") => `<div class="line ${cls}">${t}</div>`;
  const rowb = (...bs) => `<div class="rowb">${bs.join("")}</div>`;
  const st = (t) => `<span class="st">${t}</span>`;
  const sel = (title, html, extra = "") => ({ kind: "html", title, html, extra });
  const pm = (n, o = {}) => `${B("−", { cls: "sec pm", state: o.minus })}<span class="num">${n}</span>${B("+", { cls: "sec pm", state: o.plus })}`;
  // a box a place (R13 B): filled with who is in, dashed blue for one on the way (來), hatched when empty
  const pips = (have, cap, cls = "") => `<span class="pips ${cls}">${Array.from({ length: cap }, (_, i) => have[i] === "來" ? `<i class="pip come">槍</i>` : have[i] ? `<i class="pip on">${have[i]}</i>` : `<i class="pip"></i>`).join("")}</span>`;
  const prop = (html) => `<div class="prop">${html}</div>`;
  const help = (rows) => `<ul class="help">${rows.map(([c, k, t]) => `<li><em class="k ${c}">${k}</em>${t}</li>`).join("")}</ul>`;
  const n = (k, s) => Array(k).fill(s);

  // ---- the common pieces (R13's words where R13 B, approved, set them)
  const RES = { food: 640, wood: 410, gold: 380, crys: 45, pop: "64", cap: "98", time: "14:32" };
  const LATE = { food: 1840, wood: 920, gold: 1260, crys: 160, pop: "118", cap: "176", time: "31:05" };
  const G = (active, tags = {}) => [1, 2, 3, 4].map((k) => ({ n: k, sub: { 1: "12/12", 2: "6/6" }[k], st: k === active ? "active" : "", tags: tags[k] }));
  const MIX = { title: "已選 12 個單位", chips: [["槍兵", 6], ["遠程兵", 4], ["法師", 2]] };
  const HELP = [["atk", "攻擊", "點地面或敵人：邊走邊打，或集中打它"], ["ret", "移動", "點地面：只管走，到了再打靠近的敵人"],
    ["hold", "堅守", "停在原地，敵人進到射程就打，不追出去"], ["", "進駐", "再點自己的城、主城、箭樓或哨所：那棟決定誰進去"]];
  const C = {
    atk: B("攻擊", { ic: "attack", cls: "red", sub: "地面或敵人" }), atkOn: B("取消攻擊", { ic: "attack", cls: "red", sub: "停下堅守", state: "active" }),
    mov: B("移動", { ic: "retreat", cls: "blue", sub: "點地面" }), hold: B("堅守", { ic: "hold", cls: "gold", sub: "原地不動" }), stop: B("停止", { ic: "stop", cls: "sec" }),
    form: B("隊形：密集", { ic: "formation", cls: "sec wide", sub: "按一下改成散開" }), reform: B("整理隊形", { ic: "ranks", cls: "sec", sub: "槍兵在前" }),
    enter: B("進駐", { ic: "enter", cls: "sec enter", sub: "點建築" }), entering: B("取消", { ic: "enter", cls: "sec enter", sub: "進駐", state: "active" }),
    build: B("建造", { ic: "build", cls: "pri" }),
  };
  const SOLDIERS = (o = {}) => [o.attacking ? C.atkOn : C.atk, C.mov, C.hold, C.stop, C.form, ...(o.one ? [] : [C.reform]), o.entering ? C.entering : C.enter];
  const base = (field, o) => ({ hp: false, field, res: RES, groups: G(0), army: 18, left: { idle: 0, map: "closed" }, cmds: [C.build], ...o });
  const UNITS = (now, o = {}) => ({ kind: "units", ...MIX, now, help: o.help ?? HELP, ...o });
  const SEL12 = ["sp.*", "bw.*", "mg.*"];
  // the town's 城 (R6-23b) over its keep; its words under its bottom corner only where they show (world.ts)
  const TOWN = (text, tint = "own") => [{ t: "T", glyph: "城", tint, text }];
  const GLYPH = (tint = "own") => [{ t: "T", glyph: "城", tint }];

  // ================================================================ 01 城門 (D-096; sim GATE: 850 the small town's, 2100 the big city's)
  // A gate is a building of its town (BuildingType.Gate): its panel is the building's (panels.ts building()): its name, a status,
  // its life. Not the town's, and nobody hides in it. Broken, it is gone (an opening): nothing to tap.
  const GATE_FOCUS = "近戰打這座城門；弓手和法師到門前，先射牆上的守軍";      // client/src/game/assault.ts GATE_FOCUS_TEXT
  Object.assign(S, {
    "R14-01-1": base("gate-a", { sel: sel("城門", bar(100) + line("生命 <b>850</b>/850"), st("中立小鎮")),
      w: { building: "T.e", bar: { "T.e": [1, "neutral"] } } }),
    "R14-01-2": base("gate-b", { sel: UNITS("目前：攻擊中 12"), cmds: SOLDIERS({ attacking: true }), groups: G(1), toast: GATE_FOCUS, toastKind: "ok",
      w: { sel: SEL12, target: "T.e" } }),
    "R14-01-3": base("gate-c", { sel: sel("城門", bar(45) + line("生命 <b>380</b>/850"), st("中立小鎮")),
      w: { building: "T.e", bar: { "T.e": [0.45, "neutral"] } } }),
    "R14-01-4": base("gate-d", { sel: UNITS("目前：攻擊中 12", { help: [] }), cmds: SOLDIERS({ attacking: true }), groups: G(1),
      w: { sel: ["sp.*", "sp2.*", "bw.*", "mg.*"] } }),
    "R14-01-5": base("gate-e", { res: LATE, sel: sel("城門", bar(63) + line("生命 <b>1320</b>/2100"), st("剛被攻擊，暫時不能修理")), cmds: null,
      toast: "城門剛被攻擊，暫時不能修理：村民會在旁邊等，10 秒內沒再被打就開始修",
      w: { building: "T.e", bar: { "T.e": [0.63, "own"] }, shots: [["T.e", "foe.1"]] } }),
  });

  // ================================================================ 02 主堡 (D-100; KEEP: 600 small, 1000 big; shoots for its holder)
  Object.assign(S, {
    "R14-02-1": base("keep-a", { sel: sel("主堡", bar(100) + line("生命 <b>600</b>/600"), st("會射箭")), w: { building: "T.keep", bar: { "T.keep": [1, "neutral"] } } }),
    "R14-02-2": base("keep-b", { sel: UNITS("目前：攻擊中 12", { help: [] }), cmds: SOLDIERS({ attacking: true }), groups: G(1), toast: "點城鎮＝攻擊這座城",
      w: { sel: SEL12, target: "T.keep" } }),
    "R14-02-3": base("keep-c", { res: LATE, sel: sel("敵方主堡", bar(38) + line("生命 <b>380</b>/1000"), st("會射箭")),
      w: { building: "T.keep", bar: { "T.keep": [0.38, "enemy"] }, shots: [["T.keep", "sp.1"]] } }),
    "R14-02-4": base("keep-d", { res: LATE, sel: sel("大城", line("主堡倒了　民兵 0　城裡有 <b>9</b> 名兵（至少要 3 名）　牆上 0／64") +
        rowb(B("搶", { cls: "plunder" }), B("治理", { cls: "govern", sub: "木150 金150" })) +
        `<div class="rowb"><span class="line">留守</span>${pm(3)}<span class="line">名</span></div>` + line("留守的兵守在城裡，敵人來了會反擊、不追出城，不跟全軍走", "note"),
      st("我方攻下，等待選擇")), w: { town: GLYPH() } }),
    "R14-02-5": base("keep-e", { res: LATE, sel: sel("主堡", bar(64) + line("生命 <b>640</b>/1000"), st("剛被攻擊，暫時不能修理　會射箭")), cmds: null,
      toast: "主堡剛被攻擊，暫時不能修理：村民會在旁邊等，10 秒內沒再被打就開始修", w: { building: "T.keep", bar: { "T.keep": [0.64, "own"] } } }),
  });

  // ================================================================ 03 市場 (D-101; MARKET: a lot 100, from 100 gold, +5 a buy, −5 a sale, sale 70%)
  const trade = (word, buy, sell) => `<span class="mpair">${B(`買 100 ${word}`, { cls: "sec trade", ...buy })}${B(`賣 100 ${word}`, { cls: "sec trade", ...sell })}</span>`;
  const market = (rows, note) => `<div class="mkt">${rows.join("")}</div>` + (note ? line("每按一下買或賣 100。買了會變貴、賣了會變便宜，之後慢慢回到 100 金。", "note") : "");
  const MK = (html, o = {}) => base(o.field || "market-a", { sel: sel("市場", html), cmds: null, w: { building: "mk", bar: { mk: [o.build ?? 1, o.build ? "#e7c35a" : "own"] } }, ...o });
  Object.assign(S, {
    "R14-03-1": MK(bar(100) + line("生命 <b>600</b>/600") + market([trade("糧", { sub: "付 100 金" }, { sub: "得 70 金" }), trade("木", { sub: "付 100 金" }, { sub: "得 70 金" })], true)),
    "R14-03-2": MK(bar(100) + line("生命 <b>600</b>/600") + market([trade("糧", { sub: "付 110 金" }, { sub: "得 77 金" }), trade("木", { sub: "付 100 金" }, { sub: "得 70 金" })]),
      { res: { ...RES, food: 840, gold: 175 }, toast: "買進 100 糧，付 105 金", toastKind: "ok" }),
    "R14-03-3": MK(bar(100) + line("生命 <b>600</b>/600") + market([trade("糧", { sub: "金不夠", state: "disabled" }, { sub: "得 70 金" }), trade("木", { sub: "金不夠", state: "disabled" }, { sub: "木不到 100", state: "disabled" })]),
      { res: { ...RES, food: 600, wood: 40, gold: 60 } }),
    "R14-03-4": MK(bar(60, "prog") + line("建造中 <b>60%</b>"), { field: "market-b", build: 0.6 }),
  });

  // ================================================================ 04 攻城砲與砲坊 (D-099, D-115; Siege 140 hp, reach 10 at buildings, 6 at units, nothing within 3)
  const REACH = "打建築 10 格、打兵 6 格，3 格內打不到";
  const COUNTER = "剋：建築／怕：近身的兵、騎兵";
  const queue = (...items) => `<div class="queue">${items.join("")}</div>`;
  const WORKS_CMDS = (auto = true) => [B("訓練攻城砲", { ic: "build", cls: "pri wide wide3", sub: `木150 金100</span><span class="sub counter-sub">${COUNTER}` }), B("集結點", { ic: "rally", cls: "sec" }),
    B("自動訓練", { cls: "sec", sub: auto ? "目前：開" : "目前：暫停", state: auto ? "active" : "" })];
  const BUILD = [["民居", "木30"], ["農田", "木50"], ["伐木場", "木60"], ["礦場", "木60"], ["糧倉", "木60"], ["兵營", "木120"], ["射場", "木120"], ["法術營", "木150 金100"],
    ["箭樓", "木60 金20"], ["馬廄", "木150 金50"], ["哨所", "木90"], ["砲坊", "木200"], ["市場", "木150"]].map(([k, c]) => B(k, { ic: "build", cls: "pri", sub: c })).concat([B("返回", { cls: "sec" })]);
  Object.assign(S, {
    "R14-04-1": base("siege-a", { sel: sel("攻城砲", bar(100) + line("生命 <b>140</b>/140") +
        help([HELP[0], HELP[1], HELP[2], ["", "射程", REACH], ["", "剋怕", COUNTER]]), st("待命")),
      cmds: SOLDIERS({ one: true }), groups: G(2), w: { sel: ["s1"], siege: ["s1"] } }),
    "R14-04-2": base("siege-b", { sel: UNITS("目前：攻擊中 9", { title: "已選 9 個單位", chips: [["槍兵", 6], ["攻城砲", 3]], help: [HELP[0], HELP[1], HELP[2], ["", "射程", `攻城砲${REACH}`]] }),
      cmds: SOLDIERS({ attacking: true }), groups: G(2), w: { sel: ["s1", "s2", "s3", "sp.*"], siege: ["s1", "s2", "s3"], target: "tw1", stones: [["s1", "tw1", 0.55], ["s2", "tw1", 0.85]] } }),
    "R14-04-3": base("siege-c", { sel: sel("敵方攻城砲", bar(64) + line("生命 <b>90</b>/140") + line(`攻城砲　${COUNTER}`), st("移動中")), w: { sel: ["es"], hp: { es: 64 } } }),
    "R14-04-4": base("works-a", { sel: sel("砲坊", bar(100) + line("生命 <b>500</b>/500") + line("補軍團缺的：砲 2", "pend") +
        queue(B("攻城砲", { cls: "sec first", sub: "訓練中" }), B("攻城砲", { cls: "sec", sub: "取消" }))), cmds: WORKS_CMDS(), w: { building: "sw", bar: { sw: [1, "own"] } } }),
    "R14-04-5": base("works-b", { sel: sel("砲坊", bar(80, "prog") + line("建造中 <b>80%</b>")), cmds: [B("自動訓練", { cls: "sec", sub: "目前：開", state: "active" })], w: { building: "sw", bar: { sw: [0.8, "#e7c35a"] } } }),
    "R14-04-6": base("build-a", { sel: { kind: "units", title: "已選 5 個單位", chips: [["村民", 5]], now: "目前：採集中 5", help: [] }, cmds: BUILD, w: { sel: ["fm.*"] } }),
  });

  // ================================================================ 05 哨所 (D-119, D-121; OUTPOST_HIDE: 3 x 3, 1500 hp, wood 90, 9 spearmen inside; new ones hold)
  // R13 B (approved): a box a place. 攻擊／堅守 and the line under them are outpostModeText(hide = true).
  const HOLD = "堅守：躲在哨所裡，戳貼過來的敵人，被打也不出來";
  const ATTACK = "攻擊：敵兵進到 8 格內或哨所被打，就出去打；打完或追到 12 格就回來躲";
  const whose = (gs) => gs.length ? `<div class="rowb whose">${gs.map(([g, k]) => `<span class="line">編隊 ${g}：${k} 名</span>${B("召回", { cls: "sec" })}`).join("")}</div>` : "";
  const post = ({ have, coming = 0, out = "", hold = true, hp = 100, life = "1500", groups = [], status = "" }) =>
    sel("哨所", bar(hp) + line(`生命 <b>${life}</b>/1500`) +
      `<div class="pipline">${pips([...n(have, "槍"), ...n(coming, "來")], 9, "nine")}<b>${have}/9</b>${coming ? `<span class="line">${coming} 名正過來</span>` : ""}${out}</div>` +
      rowb(B("＋槍兵", { cls: "sec", state: have + coming >= 9 ? "disabled" : "" }), B("全部離開", { cls: "sec", state: have === 0 && !coming ? "disabled" : "" }),
        B("攻擊", { cls: "red", state: hold ? "" : "active" }), B("堅守", { cls: "gold", state: hold ? "active" : "" })) + line(hold ? HOLD : ATTACK, "note") + whose(groups), st(status));
  const P = (field, panel, o = {}) => base(field, { sel: panel, cmds: null, w: { building: "op", bar: { op: [(o.hp ?? 100) / 100, "own"] } }, groups: G(0, o.tags), ...o });
  Object.assign(S, {
    "R14-05-1": P("post-a", post({ have: 0 })),
    "R14-05-2": P("post-b", post({ have: 5, coming: 2, groups: [[1, 7]] }), { tags: { 1: ["駐7"] } }),
    "R14-05-3": P("post-c", post({ have: 9, groups: [[1, 6], [2, 3]] }), { tags: { 1: ["駐6"], 2: ["駐3"] } }),
    "R14-05-4": P("post-d", post({ have: 4, hold: false, out: prop(`<span class="line">5 名出去打</span>`), groups: [[1, 9]], status: "攻擊中" }), { tags: { 1: ["駐9"] } }),
    "R14-05-5": P("post-e", post({ have: 9, hp: 65, life: "980", groups: [[1, 9]], status: "剛被攻擊，暫時不能修理" }), { tags: { 1: ["駐9"] }, hp: 65 }),
    "R14-05-6": base("post-f", { sel: sel("敵方哨所", bar(100) + line("生命 <b>1500</b>/1500"), st("裡面有人")), w: { building: "op", bar: { op: [1, "enemy"] } } }),
  });

  // ================================================================ 06 守城中的城鎮 (D-110, D-116 guard; R13 B's town panel: the wall and the town in boxes)
  const townB = ({ first, wall, inside, warn = "", income = "收入 100%", stay, extra = "", status = "我方治理中" }) =>
    sel("大城", line(first) + (warn ? `<div class="warnline">${warn}</div>` : "") + (income ? `<div class="goodline">${income}</div>` : "") +
      `<div class="pipline"><span class="line">牆上</span>${pips(wall, wall.length || 1)}<span class="line">城內</span>${pips(inside, inside.length || 1)}</div>` + extra +
      `<div class="rowb"><span class="line">留守</span>${pm(stay, { minus: stay === 0 ? "disabled" : "" })}<span class="line">名</span>${B("歸隊", { cls: "sec" })}${B("全部帶走", { cls: "sec" })}</div>`, st(status));
  const D = (field, o) => base(field, { res: LATE, groups: G(0, { 1: ["駐12"] }), left: { idle: 0, map: "closed", alarm: 1 }, ...o });
  const W6 = [...n(4, "遠"), ...n(2, "法")], I6 = n(6, "槍");
  Object.assign(S, {
    "R14-06-1": D("defend-a", { sel: townB({ first: "主堡 <b>1000</b>/1000　民兵 0　城裡有 <b>12</b> 名兵（至少要 3 名）", wall: W6, inside: I6, stay: 12 }),
      w: { town: GLYPH(), shots: [["T.e", "foe.2"]] } }),
    "R14-06-2": D("defend-a", { sel: UNITS("目前：守城 12", { help: [] }), cmds: SOLDIERS(), groups: G(1, { 1: ["駐12"] }),
      w: { sel: ["gsp.*", "wb.*", "wm.*"], town: GLYPH() } }),
    "R14-06-3": D("defend-c", { sel: townB({ first: "主堡 <b>640</b>/1000　民兵 0　城裡有 <b>7</b> 名兵（至少要 3 名）", wall: ["遠", "遠", "法"], inside: n(4, "槍"), stay: 7 }),
      groups: G(0, { 1: ["駐7"] }), w: { town: GLYPH() } }),
    "R14-06-4": D("defend-d", { sel: townB({ first: "主堡倒了　民兵 0　城裡有 <b>1</b> 名兵（至少要 3 名）", warn: "駐軍不足，0:45 後叛離", income: "", wall: [], inside: ["槍"], stay: 1 }),
      groups: G(0, { 1: ["駐1"] }), w: { town: GLYPH() } }),
    "R14-06-5": D("defend-e", { sel: sel("大城", line("民兵 0　駐軍 10/3"), st("敵方攻下，等待選擇")), groups: G(0), toast: "敵方攻下了一座城鎮",
      w: { town: GLYPH("enemy") } }),
  });

  // ================================================================ 07 牆上換邊 (D-119 A, D-124 (b); WALL_SHIFT: odds 2, back 10 s)
  // The game's town panel does not change while they walk (牆上 N stays N); the yellow dashed line is R14's 提議.
  const shift = (t, cls = "") => prop(`<div class="line shift ${cls}">${t}</div>`);
  const S7 = (field, extra, o = {}) => D(field, { sel: townB({ first: "主堡 <b>1000</b>/1000　民兵 0　城裡有 <b>6</b> 名兵（至少要 3 名）", wall: W6, inside: [], stay: 6, extra }),
    groups: G(0, { 1: ["駐6"] }), left: { idle: 0, map: "closed", alarm: o.calm ? 0 : 1 }, ...o, w: { town: GLYPH(), ...(o.w || {}) } });
  const UP = 4.32 * 20 * Math.sqrt(3) / 2;                     // the stone wall's walk, pt up (castle_E sw_e walk_m)
  const walkE = (from, to) => [[59.5 - 0.125, 50 + from, UP], [59.5 - 0.125, 50 + to, UP]];
  Object.assign(S, {
    "R14-07-1": S7("shift-a", shift("換邊：4 名走過東門頂，去打東牆南段（敵人 7 名，沒超過牆上的 2 倍）"), { w: { path: [walkE(-3.4, 4.6)] } }),
    "R14-07-2": S7("shift-b", shift("東牆南段：6 名一起打")),
    "R14-07-3": S7("shift-c", shift("敵人 15 名，超過牆上 6 名的 2 倍：不換邊", "warn")),
    "R14-07-4": S7("shift-d", shift("敵人走了 10 秒：走回原位"), { calm: true, w: { path: [walkE(5.6, -2.4)] } }),
    "R14-07-5": S7("shift-e", shift("東門破了：門頂過不去，北段的 4 名留在北段", "warn")),
  });

  // ================================================================ 08 進駐 (R13 B, approved D-125; on the art-v7 diamond as R13 B2)
  // The marks are r13-b2.js's (placeTags from the scene's boxes); R14 adds the selected building's frame and a tap that went wrong.
  const SCN = window.R13_B2;
  const S2 = Math.SQRT1_2;
  const ring = (b, z) => {
    const w = b.w, d = b.d ?? b.w, k = 20 * z;
    const pt = (x, y) => [b.at[0] + k * (x + y) * S2, b.at[1] + k * 0.5 * (y - x) * S2];
    return [pt(-w / 2, -d / 2), pt(-w / 2, d / 2), pt(w / 2, d / 2), pt(w / 2, -d / 2)];
  };
  PIECES.r14x = (s) => {
    const x = s.r14x;
    if (!x) return;
    const sc = SCN[x.scene], g = [];
    for (const b of sc.buildings) {
      if (b.id === x.sel) g.push(`<polygon points="${ring(b, sc.zoom).map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ")}" fill="rgba(255,243,176,.08)" stroke="#fff3b0" stroke-width="2.5" stroke-linejoin="round"/>`);
      if (b.id === x.tap) {
        const cx = b.at[0], cy = b.at[1] - b.ay * sc.zoom + 18;
        g.push(`<circle cx="${cx}" cy="${cy}" r="15" fill="rgba(200,48,44,.35)" stroke="#ff6a5e" stroke-width="2.5"/><path d="M${cx - 6} ${cy - 6} l12 12 M${cx + 6} ${cy - 6} l-12 12" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>`);
      }
    }
    const svg = add(`<svg class="worldsvg r14x" width="814" height="380" viewBox="0 0 814 380">${g.join("")}</svg>`);
    screen.insertBefore(svg, screen.querySelector(".res"));
    if (x.town) for (const b of sc.buildings) if (b.id === "gate") screen.insertBefore(el(`<div class="townglyph r13glyph r13b2" style="left:${b.at[0] - 12}px;top:${b.at[1] - b.ay * sc.zoom - 22}px;--tint:#3f7fe0">城</div>`), screen.querySelector(".res"));
  };
  ORDER.splice(ORDER.indexOf("res"), 0, "r14x");
  const SPEAR = { title: "已選 6 個單位", chips: [["槍兵", 6]], now: "目前：待命 6" };
  const PROMPT = { text: "點亮起來的建築：標籤寫誰進去、誰留下", buttons: [B("取消", { cls: "sec" })], at: "high" };
  const TAGS = {
    spear: { gate: { html: "<b>進</b> 6 名全進城", chip: "<b>進</b> 6" }, post: { html: "<b>進</b> 槍兵 6", chip: "<b>進</b> 6" }, main: { off: 1, html: "槍兵進不去" }, tower: { off: 1, html: "槍兵進不去" } },
    mix: { gate: { html: "<b>進</b> 12 名全進城<small>遠程、法師上牆</small>", chip: "<b>進</b> 12" }, main: { html: "<b>進</b> 遠程 4・法師 2<small>留 槍兵 6</small>", chip: "<b>進</b> 6" },
      tower: { html: "<b>進</b> 最近的 3 名<small>留 9 名</small>", chip: "<b>進</b> 3" }, post: { html: "<b>進</b> 槍兵 6<small>留 遠程 4・法師 2</small>", chip: "<b>進</b> 6" } },
    full: { gate: { html: "<b>進</b> 12 名全進城<small>遠程、法師上牆</small>", chip: "<b>進</b> 12" }, main: { html: "<b>進</b> 最近的 2 名<small>留 10 名</small>", chip: "<b>進</b> 2" },
      tower: { off: 1, html: "滿了 3/3" }, post: { html: "<b>進</b> 槍兵 6<small>留 遠程 4・法師 2</small>", chip: "<b>進</b> 6" } },
  };
  const FULL = "箭樓滿了（最多 3 名），沒有人進去";
  const WRONG = "要點亮起來的建築：自己蓋好的城、主城、箭樓或哨所";
  const pick = (who, tags, { r14x = {}, ...o } = {}) => base(who === "spear" ? "r13-b2-bases6" : "r13-b2-bases", {
    sel: { kind: "units", ...(who === "spear" ? SPEAR : { ...MIX, now: "目前：待命 12" }), help: [] }, folded: true, cmds: SOLDIERS({ entering: true }), prompt: PROMPT,
    groups: G(who === "spear" ? 2 : 1), r13b2: { scene: who === "spear" ? "bases6" : "bases", tags }, r14x: { scene: "bases", town: true, ...r14x }, ...o });
  // the panels once in (R13 B: a box a place, empty ones hatched); 召回 for each squad (D-125), 全部離開 (D-125)
  const towerB = sel("箭樓", bar(100) + line("生命 <b>600</b>/600") + `<div class="pipline">${pips(["遠", "法"], 3)}<b>2/3</b><span class="line">編隊 1 的 2 名</span>${B("召回", { cls: "sec" })}</div>` +
    rowb(B("＋遠程", { cls: "sec" }), B("＋法師", { cls: "sec" }), B("全部離開", { cls: "sec" })), st("裡面有人"));
  const postB = post({ have: 5, groups: [[1, 3], [2, 2]] });
  const townB8 = sel("大城", line("民兵 0　城裡有 <b>5</b> 名兵（至少要 3 名）") + `<div class="goodline">收入 100%</div>` +
    `<div class="pipline"><span class="line">牆上</span>${pips(["遠", "遠", "法"], 3)}<span class="line">城內</span>${pips(["槍", "槍"], 2)}</div>` +
    `<div class="rowb"><span class="line">留守</span>${pm(5)}<span class="line">名</span>${B("歸隊", { cls: "sec" })}${B("全部帶走", { cls: "sec" })}</div>`, st("我方治理中"));
  const mainB = sel("主城", bar(100) + line("生命 <b>1200</b>/1200　村民 32／40，訓練中") +
    `<div class="pipline">${pips(["遠", "法"], 6)}<b>2/6</b><span class="line">編隊 1 的 2 名</span>${B("召回", { cls: "sec" })}</div>` +
    rowb(B("＋遠程", { cls: "sec" }), B("＋法師", { cls: "sec" }), B("全部離開", { cls: "sec" })) +
    `<div class="rowb"><span class="line">村民目標</span>${pm(40)}<span class="line">名</span></div>`, st("裡面有人"));
  const CITY = [B("訓練村民", { ic: "build", cls: "pri", sub: "糧50" }), B("集結點", { ic: "rally", cls: "sec" }), B("經濟分配", { cls: "sec" }), B("預留", { cls: "sec", sub: "自動訓練" }),
    B("建造", { ic: "build", cls: "pri" }), B("自動村民", { cls: "sec", sub: "目前：開", state: "active" }), B("自動蓋民居", { ic: "home", cls: "sec wide", sub: "目前：開", state: "active" })];
  const kinds = `<div class="gp2 r13gp">${[["槍兵", 6, 6], ["遠程兵", 4, 4], ["法師", 2, 2], ["騎兵", 0, 0], ["攻城砲", 0, 0]].map(([k, h, w]) => `<div class="cell"><span class="t">${k} <small>現有 ${h}</small></span>${pm(w)}</div>`).join("")}</div>`;
  const groupB = sel("編隊 1", `<div class="inbox">` +
    `<div class="pipline"><span class="line k">大城</span>${pips(["槍", "槍", "遠", "遠", "法"], 5)}<span class="line">留守</span></div>` +
    `<div class="pipline"><span class="line k">箭樓</span>${pips(["遠", "法"], 2)}<span class="line k">哨所</span>${pips(["槍", "槍", "槍"], 3)}</div>` +
    rowb(B("召回", { cls: "sec" }), B("出城歸隊", { cls: "sec" }), B("全部帶走", { cls: "sec" })) + `</div>` + kinds, st("12/12　進駐 10"));
  const held = (panel, selId, o = {}) => base("r13-b2-bases-held", { sel: panel, cmds: null, groups: G(0, { 1: ["駐5", "躲5"] }), r14x: { scene: "bases-held", sel: selId, town: true }, ...o });
  Object.assign(S, {
    "R14-08-1": base("r13-b2-bases", { sel: null, groups: G(0), r14x: { scene: "bases", town: true } }),
    "R14-08-2": base("r13-b2-bases", { sel: UNITS("目前：待命 12"), cmds: SOLDIERS(), groups: G(1), r13b2: { scene: "bases", tags: {} }, r14x: { scene: "bases", town: true } }),
    "R14-08-3": pick("spear", TAGS.spear),
    "R14-08-4": pick("mix", TAGS.mix),
    "R14-08-5": pick("mix", TAGS.full, { toast: FULL, r14x: { scene: "bases", tap: "tower" } }),
    "R14-08-6": pick("mix", TAGS.mix, { toast: WRONG, r14x: { scene: "bases", tap: "barracks" } }),
    "R14-08-7a": held(towerB, "tower"),
    "R14-08-7b": held(postB, "post", { groups: G(0, { 1: ["駐3", "躲2"], 2: ["駐2"] }) }),
    "R14-08-7c": held(townB8, "gate"),
    "R14-08-7d": held(mainB, "main", { cmds: CITY }),
    "R14-08-8": base("r13-b2-bases-held", { sel: groupB, cmds: SOLDIERS(), groups: G(1, { 1: ["駐5", "躲5"] }), r14x: { scene: "bases-held", town: true } }),
  });
  // 閒置 3 in every 進駐 state, as R13 B and B2 drew them (B2's tags keep clear of it)
  for (const k of Object.keys(S)) if (k.startsWith("R14-08-")) S[k].left = { idle: 3, map: "closed" };
  for (let k = 1; k <= 6; k++) S[`R14-08-B2-${k}`] = { ...S[`R13-01-B2-${k}`], groups: (S[`R13-01-B2-${k}`].groups || []).map((g) => ({ ...g })) };
})();
