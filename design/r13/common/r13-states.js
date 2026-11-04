// R13-01 進駐 (D-124; ceo 2026-11-04): one 「進駐」 in place of 駐軍（進城）、躲進去（主城、箭樓）and 駐守（哨所）. Pick soldiers,
// press 進駐, tap our town, main city, arrow tower or outpost; the building decides who goes in. Two layouts:
//   A 下方清單: who goes in and who stays is a table in the selection info; the buildings that can be tapped get a gold ring and their name.
//   B 建築上標籤: the selection info folds; each building that can be tapped carries a tag saying who goes in and who stays.
// States: R13-01-<0|A|B>-<n>. Words are main's (D-094 攻擊／移動, 整理隊形, client/src/game/*.ts) except where R13 proposes new ones.
"use strict";
(() => {
  const S = window.R6_STATES;
  const B = (label, o) => btn(label, o);
  ICON.enter = '<path d="M5 21V8l7-5 7 5v13"/><path d="M9.5 21v-6h5v6"/><path d="M1.5 13.5h7"/><path d="M6 11l2.5 2.5L6 16"/>';
  ICON.ranks = '<path d="M5 6h14M5 12h14M5 18h14"/><path d="M8 3v18"/>';

  // ---- our buildings on r13-bases (pt; field.py's PLACE): the picture's box and the footprint the ring goes round
  const BLD = {
    gate: { name: "大城", box: [118, 94, 104, 108], foot: [166, 180, 46, 21], tag: [170, 136] },
    main: { name: "主城", box: [238, 92, 131, 114], foot: [305, 183, 58, 24], tag: [303, 134] },
    tower: { name: "箭樓", box: [392, 118, 71, 83], foot: [425, 184, 30, 14], tag: [427, 146] },
    barracks: { name: "兵營", box: [478, 124, 105, 78], foot: [528, 181, 48, 20], tag: [530, 150] },
    post: { name: "哨所", box: [604, 196, 59, 59], foot: [634, 241, 31, 15], tag: [634, 196] },
  };
  const SQUAD = [[536, 206], [556, 214], [548, 228], [572, 222], [566, 238], [590, 232], [530, 236], [582, 248], [548, 250], [600, 246], [566, 256], [520, 222]];
  const diamond = ([cx, cy, hw, hh], pad = 0) => `${cx},${cy - hh - pad} ${cx + hw + pad * 2},${cy} ${cx},${cy + hh + pad} ${cx - hw - pad * 2},${cy}`;

  // The battlefield marks of R13 (drawn by the game in world.ts, the same in A and B): the squad's selection rings, the town's
  // badge, the rings of the buildings 進駐 can go into, a selected building's frame, a tap that went wrong, and B's tags.
  PIECES.r13 = (s) => {
    const w = s.r13;
    if (!w) return;
    const g = [];
    for (const [x, y] of w.squad ? SQUAD.slice(0, w.squad) : []) g.push(`<ellipse cx="${x}" cy="${y}" rx="7" ry="3.5" fill="none" stroke="#fff3b0" stroke-width="1.6"/>`);
    for (const [k, how] of Object.entries(w.ring || {})) {
      const f = BLD[k].foot;
      if (how === "on") g.push(`<polygon points="${diamond(f, 4)}" fill="rgba(255,214,102,.18)" stroke="#ffd666" stroke-width="5" stroke-linejoin="round" opacity=".45" filter="url(#glow)"/>` +
        `<polygon points="${diamond(f, 2)}" fill="rgba(255,214,102,.14)" stroke="#ffe08a" stroke-width="2.5" stroke-linejoin="round"/>`);
      else if (how === "off") g.push(`<polygon points="${diamond(f, 2)}" fill="rgba(20,16,12,.25)" stroke="rgba(230,225,215,.75)" stroke-width="1.6" stroke-dasharray="5 4" stroke-linejoin="round"/>`);
      else if (how === "sel") g.push(`<polygon points="${diamond(f, 2)}" fill="rgba(255,243,176,.08)" stroke="#fff3b0" stroke-width="2.5" stroke-linejoin="round"/>`);
    }
    if (w.tap) {
      // on the roof, above the message strip
      const [bx, by, bw] = BLD[w.tap].box, x = bx + bw / 2, y = by + 22;
      g.push(`<circle cx="${x}" cy="${y}" r="15" fill="rgba(200,48,44,.35)" stroke="#ff6a5e" stroke-width="2.5"/>` +
        `<path d="M${x - 6} ${y - 6} l12 12 M${x + 6} ${y - 6} l-12 12" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>`);
    }
    add(`<svg class="worldsvg r13w" width="814" height="380" viewBox="0 0 814 380"><defs><filter id="glow" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="3"/></filter></defs>${g.join("")}</svg>`);
    if (w.town) add(`<div class="townglyph r13glyph" style="left:${BLD.gate.box[0] + 40}px;top:${BLD.gate.box[1] - 2}px;--tint:#2e6ed6">城</div>`);
    for (const [k, t] of Object.entries(w.names || {})) {
      const f = BLD[k].foot;
      add(`<div class="r13name ${t.off ? "off" : ""}" style="left:${f[0]}px;top:${f[1] - 9}px">${t.text || BLD[k].name}</div>`);
    }
    for (const [k, t] of Object.entries(w.tags || {})) {
      const [x, y] = BLD[k].tag;
      add(`<div class="r13tag ${t.cls || ""}" style="left:${x}px;top:${y}px">${t.html}</div>`);
    }
  };
  ORDER.splice(ORDER.indexOf("res"), 0, "r13");

  // groups with 駐N／躲N on their top edge (the client's group-away; the user 2026-10-26: 「分開顯示」)
  const groupsR6 = PIECES.groups;
  PIECES.groups = (s) => {
    groupsR6(s);
    (s.groups || []).forEach((x, i) => {
      if (!x.tags) return;
      const b = screen.querySelectorAll(".groups .grp")[i];
      x.tags.forEach((t, j) => b.insertAdjacentHTML("beforeend", `<span class="gtag ${t.startsWith("躲") ? "hide" : ""}" style="right:${-4 + j * 0}px;top:${-7 - j * 0}px;${j ? "left:-4px;right:auto" : ""}">${t}</span>`));
    });
  };
  // the prompt strip: R13 moves it up to the row of 全軍撤退 so that the buildings under it can be seen (`at: "high"`)
  const promptR6 = PIECES.prompt;
  PIECES.prompt = (s) => {
    promptR6(s);
    if (s.prompt && s.prompt.at) screen.querySelector(".prompt").classList.add("at-" + s.prompt.at);
  };

  // ---- the pieces of the selection info (R6's helpers live inside states.js)
  const bar = (pct) => `<div class="bar"><i style="width:${pct}%"></i></div>`;
  const line = (t, cls = "") => `<div class="line ${cls}">${t}</div>`;
  const rowb = (...bs) => `<div class="rowb">${bs.join("")}</div>`;
  const st = (t) => `<span class="st">${t}</span>`;
  const sel = (title, html, extra = "") => ({ kind: "html", title, html, extra });
  const pm = (n, o = {}) => `${B("−", { cls: "sec pm", state: o.minus })}<span class="num">${n}</span>${B("+", { cls: "sec pm", state: o.plus })}`;
  const pips = (have, cap, cls = "") => `<span class="pips ${cls}">${Array.from({ length: cap }, (_, i) => have[i] ? `<i class="pip on">${have[i]}</i>` : `<i class="pip"></i>`).join("")}</span>`;

  // ---- commands (main's words; 進駐 is R13's)
  const C = {
    atk: B("攻擊", { ic: "attack", cls: "red", sub: "地面或敵人" }), mov: B("移動", { ic: "retreat", cls: "blue", sub: "點地面" }),
    hold: B("堅守", { ic: "hold", cls: "gold", sub: "原地不動" }), stop: B("停止", { ic: "stop", cls: "sec" }),
    form: B("隊形：密集", { ic: "formation", cls: "sec wide", sub: "按一下改成散開" }), reform: B("整理隊形", { ic: "ranks", cls: "sec", sub: "槍兵在前" }),
    enter: B("進駐", { ic: "enter", cls: "sec enter", sub: "點建築" }), entering: B("取消", { ic: "enter", cls: "sec enter", sub: "進駐", state: "active" }),
    post: B("駐守", { cls: "sec", sub: "點哨所" }), hide: B("躲進去", { cls: "sec", sub: "主城或箭樓" }), station: B("駐軍", { cls: "sec", sub: "點自己的城" }),
    build: B("建造", { ic: "build", cls: "pri" }),
  };
  const SOLDIER_CMDS = (enter) => [C.atk, C.mov, C.hold, C.stop, C.form, C.reform, enter ? C.entering : C.enter];
  const NOW_CMDS = (on) => [C.atk, C.mov, C.hold, C.stop, C.form, C.reform,
    on === "post" ? B("取消", { cls: "sec", sub: "駐守", state: "active" }) : C.post,
    on === "hide" ? B("取消", { cls: "sec", sub: "躲進去", state: "active" }) : C.hide,
    on === "station" ? B("取消", { cls: "sec", sub: "駐軍", state: "active" }) : C.station];

  const RES = { food: 640, wood: 410, gold: 380, crys: 45, pop: "64", cap: "98", time: "14:32" };
  const G = (active, tags = {}) => [1, 2, 3, 4].map((n) => ({ n, sub: { 1: "12/12", 2: "6/6" }[n], st: n === active ? "active" : "", tags: tags[n] }));
  const MIX = { title: "已選 12 個單位", chips: [["槍兵", 6], ["遠程兵", 4], ["法師", 2]], now: "目前：待命 12" };
  const SPEAR = { title: "已選 6 個單位", chips: [["槍兵", 6]], now: "目前：待命 6" };
  const HELP13 = [["atk", "攻擊", "點地面或敵人：邊走邊打，或集中打它"], ["ret", "移動", "點地面：只管走，到了再打靠近的敵人"],
    ["hold", "堅守", "停在原地，敵人進到射程就打，不追出去"], ["", "進駐", "再點自己的城、主城、箭樓或哨所：那棟決定誰進去"]];
  const base = (o) => ({ hp: false, field: "r13-river", res: RES, groups: G(1), army: 18, left: { idle: 3, map: "closed" }, ...o });
  const onBases = (o) => base({ field: "r13-bases", ...o });

  // ---- 0 現況（main 586ec04）: three buttons, three prompts
  Object.assign(S, {
    "R13-01-0-1": base({ sel: { kind: "units", ...MIX, help: HELP13.slice(0, 3) }, cmds: NOW_CMDS() }),
    "R13-01-0-2": onBases({ sel: { kind: "units", ...MIX, help: [] }, cmds: NOW_CMDS("hide"), r13: { squad: 12 },
      prompt: { text: "點自己的主城或箭樓：只有遠程兵和法師會躲進去", buttons: [B("取消", { cls: "sec" })], at: "high" } }),
    "R13-01-0-3": onBases({ sel: { kind: "units", ...MIX, help: [] }, cmds: NOW_CMDS("station"), r13: { squad: 12 },
      prompt: { text: "點自己持有的城鎮：選的兵連同整個編隊走進去留守", buttons: [B("取消", { cls: "sec" })], at: "high" } }),
    "R13-01-0-4": onBases({ sel: { kind: "units", ...MIX, help: [] }, cmds: NOW_CMDS("post"), r13: { squad: 12 },
      prompt: { text: "點自己的哨所：只有槍兵會去駐守", buttons: [B("取消", { cls: "sec" })], at: "high" } }),
  });

  // ---- what each building does with who is selected (the same facts drawn two ways)
  // rows: [building key, who goes in, who stays, off (cannot go in) , note]
  const ROWS = {
    spear: [["gate", "6 名全進城", "—"], ["post", "槍兵 6 躲進去", "—"], ["main,tower", "槍兵進不去（只收遠程兵、法師）", "6 名", true]],
    mix: [["gate", "12 名全進城：遠程、法師上牆", "—"], ["main", "遠程 4・法師 2", "槍兵 6"], ["tower", "最近的 3 名（遠程、法師）", "9 名"], ["post", "槍兵 6", "遠程 4・法師 2"]],
    full: [["gate", "12 名全進城：遠程、法師上牆", "—"], ["main", "最近的 2 名（還有 2 個位子）", "10 名"], ["tower", "滿了 3/3：點了沒人進去", "12 名", true], ["post", "槍兵 6", "遠程 4・法師 2"]],
  };
  const NAME = (k) => k.split(",").map((x) => BLD[x].name).join("、");
  const table = (rows) => `<div class="r13tab"><span class="h"></span><span class="h">進去</span><span class="h">留下</span>` +
    rows.map(([k, inn, out, off]) => `<span class="k ${off ? "off" : ""}">${NAME(k)}</span><span class="in ${off ? "off" : ""}">${off ? "" : '<i class="ok"></i>'}${inn}</span><span class="out ${off ? "off" : ""}">${out}</span>`).join("") + `</div>`;
  const ringsOf = (rows) => Object.fromEntries(rows.flatMap(([k, , , off]) => k.split(",").map((x) => [x, off ? "off" : "on"])));
  const namesOf = (rows) => Object.fromEntries(rows.flatMap(([k, , , off]) => k.split(",").map((x) => [x, { off }])));
  // B's tags: 進 who ｜ 留 who
  const TAGS = {
    spear: { gate: { html: "<b>進</b> 6 名全進城" }, post: { html: "<b>進</b> 槍兵 6" }, main: { cls: "off", html: "槍兵進不去" }, tower: { cls: "off", html: "槍兵進不去" } },
    mix: { gate: { html: "<b>進</b> 12 名全進城<small>遠程、法師上牆</small>" }, main: { html: "<b>進</b> 遠程 4・法師 2<small>留 槍兵 6</small>" },
      tower: { html: "<b>進</b> 最近的 3 名<small>留 9 名</small>" }, post: { html: "<b>進</b> 槍兵 6<small>留 遠程 4・法師 2</small>" } },
    full: { gate: { html: "<b>進</b> 12 名全進城<small>遠程、法師上牆</small>" }, main: { html: "<b>進</b> 最近的 2 名<small>留 10 名</small>" },
      tower: { cls: "off", html: "滿了 3/3" }, post: { html: "<b>進</b> 槍兵 6<small>留 遠程 4・法師 2</small>" } },
  };
  const tagRings = (tags) => Object.fromEntries(Object.entries(tags).map(([k, t]) => [k, t.cls === "off" ? "off" : "on"]));
  const PROMPT_A = { text: "點亮起來的建築：選的兵進去守（誰進去寫在下面）", buttons: [B("取消", { cls: "sec" })], at: "high" };
  const PROMPT_B = { text: "點亮起來的建築：標籤寫誰進去、誰留下", buttons: [B("取消", { cls: "sec" })], at: "high" };
  const WRONG = "要點亮起來的建築：自己蓋好的城、主城、箭樓或哨所";
  const FULL = "箭樓滿了（最多 3 名），沒有人進去";

  const pickA = (who, rows, o = {}) => onBases({
    sel: sel(`進駐：${who === "spear" ? "已選 6 名槍兵" : "已選 12 名"}`, table(rows), st("點亮起來的建築")), cmds: SOLDIER_CMDS(true), prompt: PROMPT_A,
    groups: G(who === "spear" ? 2 : 1), r13: { squad: who === "spear" ? 6 : 12, town: true, ring: ringsOf(rows), names: namesOf(rows), ...(o.r13 || {}) }, ...o.extra });
  const pickB = (who, tags, o = {}) => onBases({
    sel: { kind: "units", ...(who === "spear" ? SPEAR : MIX), help: [] }, folded: true, cmds: SOLDIER_CMDS(true), prompt: PROMPT_B,
    groups: G(who === "spear" ? 2 : 1), r13: { squad: who === "spear" ? 6 : 12, town: true, ring: tagRings(tags), tags, ...(o.r13 || {}) }, ...o.extra });

  // ---- the panels once they are in (A in words, B with a box a place)
  const towerA = sel("箭樓", bar(100) + line("生命 <b>500</b>/500") + line("進駐 <b>2</b> 名（最多 3 名）：遠程兵 1、法師 1") +
    rowb(B("＋遠程", { cls: "sec" }), B("＋法師", { cls: "sec" }), B("全部離開", { cls: "sec" })) +
    `<div class="rowb whose"><span class="line">編隊 1：2 名</span>${B("召回", { cls: "sec" })}</div>`, st("裡面有人"));
  const towerB = sel("箭樓", bar(100) + line("生命 <b>500</b>/500") + `<div class="pipline">${pips(["遠", "法"], 3)}<b>2/3</b><span class="line">編隊 1 的 2 名</span>${B("召回", { cls: "sec" })}</div>` +
    rowb(B("＋遠程", { cls: "sec" }), B("＋法師", { cls: "sec" }), B("全部離開", { cls: "sec" })), st("裡面有人"));
  const postNote = "攻擊：敵兵進到 8 格內或哨所被打，就出去打；打完或追到 12 格就回來躲";
  const postA = sel("哨所", bar(100) + line("生命 <b>1500</b>/1500　進駐 <b>5</b> 名槍兵（最多 9 名）") +
    rowb(B("＋槍兵", { cls: "sec" }), B("全部離開", { cls: "sec" }), B("攻擊", { cls: "red", state: "active" }), B("堅守", { cls: "gold" })) + line(postNote, "note") +
    `<div class="rowb whose"><span class="line">編隊 1：3 名</span>${B("召回", { cls: "sec" })}<span class="line">沒編隊：2 名</span></div>`, st("攻擊中"));
  const postB = sel("哨所", bar(100) + line("生命 <b>1500</b>/1500") +
    `<div class="pipline">${pips(["槍", "槍", "槍", "槍", "槍"], 9, "nine")}<b>5/9</b><span class="line">編隊 1：3</span>${B("召回", { cls: "sec" })}</div>` +
    rowb(B("＋槍兵", { cls: "sec" }), B("全部離開", { cls: "sec" }), B("攻擊", { cls: "red", state: "active" }), B("堅守", { cls: "gold" })) + line(postNote, "note"), st("攻擊中"));
  const townA = sel("大城", line("民兵 0　城裡有 <b>5</b> 名兵（至少要 3 名）　牆上 3／12") + `<div class="goodline">收入 100%</div>` +
    `<div class="rowb"><span class="line">留守</span>${pm(5)}<span class="line">名</span></div>` + line("留守的兵守在城裡，敵人來了會反擊、不追出城，不跟全軍走", "note") +
    `<div class="rowb whose"><span class="line">編隊 1：5 名</span>${B("歸隊", { cls: "sec" })}${B("全部帶走", { cls: "sec" })}</div>`, st("我方治理中"));
  const townB = sel("大城", line("民兵 0　城裡有 <b>5</b> 名兵（至少要 3 名）") + `<div class="goodline">收入 100%</div>` +
    `<div class="pipline"><span class="line">牆上</span>${pips(["遠", "遠", "法"], 3)}<span class="line">城內</span>${pips(["槍", "槍"], 2)}</div>` +
    `<div class="rowb"><span class="line">留守</span>${pm(5)}<span class="line">名</span>${B("歸隊", { cls: "sec" })}${B("全部帶走", { cls: "sec" })}</div>`, st("我方治理中"));
  // 軍團畫面: what is in, on top (the kinds' − N + scroll under it: five kinds with 騎兵 and 攻城砲 do not fit the 171 pt)
  const kinds = `<div class="gp2 r13gp">${[["槍兵", 6, 6], ["遠程兵", 4, 4], ["法師", 2, 2], ["騎兵", 0, 0], ["攻城砲", 0, 0]].map(([n, h, w]) => `<div class="cell"><span class="t">${n} <small>現有 ${h}</small></span>${pm(w)}</div>`).join("")}</div>`;
  const groupA = sel("編隊 1", `<div class="inbox">` + line("進駐中：大城 <b>5</b> 名（留守）、箭樓 <b>2</b> 名、哨所 <b>3</b> 名") +
    rowb(B("召回", { cls: "sec", sub: "主城、箭樓、哨所的" }), B("出城歸隊", { cls: "sec", sub: "城裡留最少人數" }), B("全部帶走", { cls: "sec", sub: "全部回來" })) + `</div>` + kinds,
    st("12/12　進駐 10"));
  const groupB = sel("編隊 1", `<div class="inbox">` +
    `<div class="pipline"><span class="line k">大城</span>${pips(["槍", "槍", "遠", "遠", "法"], 5)}<span class="line">留守</span></div>` +
    `<div class="pipline"><span class="line k">箭樓</span>${pips(["遠", "法"], 2)}<span class="line k">哨所</span>${pips(["槍", "槍", "槍"], 3)}</div>` +
    rowb(B("召回", { cls: "sec" }), B("出城歸隊", { cls: "sec" }), B("全部帶走", { cls: "sec" })) + `</div>` + kinds,
    st("12/12　進駐 10"));

  for (const [o, P] of [["A", pickA], ["B", pickB]]) {
    const isA = o === "A";
    const panel = (v) => (isA ? v[0] : v[1]);
    Object.assign(S, {
      // 1 選兵前：沒選東西，指令區只有建造
      [`R13-01-${o}-1`]: base({ sel: null, cmds: [C.build], groups: G(0) }),
      // 2 選兵後：2 排，進駐在第 2 排最後
      [`R13-01-${o}-2`]: base({ sel: { kind: "units", ...MIX, help: HELP13 }, cmds: SOLDIER_CMDS(false) }),
      // 3 按下進駐（只選槍兵）：城、哨所亮；主城、箭樓不亮
      [`R13-01-${o}-3`]: isA ? P("spear", ROWS.spear) : P("spear", TAGS.spear),
      // 4 混編：四種都亮，寫誰進去、誰留下
      [`R13-01-${o}-4`]: isA ? P("mix", ROWS.mix) : P("mix", TAGS.mix),
      // 5 目標滿了：點了滿的箭樓
      [`R13-01-${o}-5`]: isA ? P("mix", ROWS.full, { r13: { tap: "tower" }, extra: { toast: FULL } }) : P("mix", TAGS.full, { r13: { tap: "tower" }, extra: { toast: FULL } }),
      // 6 點錯目標：點了兵營（還在選建築）
      [`R13-01-${o}-6`]: isA ? P("mix", ROWS.mix, { r13: { tap: "barracks" }, extra: { toast: WRONG } }) : P("mix", TAGS.mix, { r13: { tap: "barracks" }, extra: { toast: WRONG } }),
      // 7 已進駐：箭樓、哨所、大城的面板
      [`R13-01-${o}-7a`]: onBases({ sel: panel([towerA, towerB]), cmds: null, groups: G(0, { 1: ["駐5", "躲5"] }), r13: { town: true, ring: { tower: "sel" } } }),
      [`R13-01-${o}-7b`]: onBases({ field: "r13-bases-held", sel: panel([postA, postB]), cmds: null, groups: G(0, { 1: ["駐5", "躲5"] }), r13: { town: true, ring: { post: "sel" } } }),
      [`R13-01-${o}-7c`]: onBases({ sel: panel([townA, townB]), cmds: null, groups: G(0, { 1: ["駐5", "躲5"] }), r13: { town: true, ring: { gate: "sel" } } }),
      // 8 軍團畫面：進駐中的編隊
      [`R13-01-${o}-8`]: base({ sel: panel([groupA, groupB]), cmds: SOLDIER_CMDS(false), groups: G(1, { 1: ["駐5", "躲5"] }) }),
    });
  }
})();
