// R6 B.3 mock: the formal interface, every state of design/r6/inventory.md, in theme A (銅木, the default)
// or B (墨漆金線) (D-087). ui.html?theme=a|b&state=<id> draws one state; the states are in states.js.
// Layout follows the prototype (inventory.md) except where D-087 changes it: the left column is gone (閒置
// only when someone idles, 全體回城 only when home is hit, 重設 handed to × and 取消) and the minimap is a
// diamond behind a 「地圖」 button.
"use strict";

const Q = new URLSearchParams(location.search);
const THEME = Q.get("theme") || "a";
document.documentElement.dataset.theme = THEME;

const ICON = {
  food: '<path d="M12 21V9"/><path d="M12 9c-3 0-4.5-2-4.5-5 3 0 4.5 2 4.5 5zM12 9c3 0 4.5-2 4.5-5-3 0-4.5 2-4.5 5z"/><path d="M12 14c-3 0-4.5-2-4.5-5 3 0 4.5 2 4.5 5zM12 14c3 0 4.5-2 4.5-5-3 0-4.5 2-4.5 5z"/>',
  wood: '<ellipse cx="9" cy="12" rx="5" ry="6"/><ellipse cx="9" cy="12" rx="2.2" ry="2.8"/><path d="M9 6h8a5 6 0 0 1 0 12H9"/>',
  gold: '<path d="M4 17h16l-3-7H7z"/><path d="M8.5 10l1.5-4h4l1.5 4"/>',
  crystal: '<path d="M12 2l5 6-5 14-5-14z"/><path d="M7 8h10M12 2v20"/>',
  pop: '<circle cx="12" cy="7.5" r="3.5"/><path d="M5 21c0-4 3-7 7-7s7 3 7 7"/>',
  time: '<path d="M7 3h10M7 21h10M8 3c0 5 8 6 8 9s-8 4-8 9M16 3c0 5-8 6-8 9s8 4 8 9"/>',
  speed: '<path d="M5 6l6 6-6 6M12 6l6 6-6 6"/>',
  slow: '<path d="M9 6l6 6-6 6"/>',
  fast: '<path d="M3 6l6 6-6 6M9.5 6l6 6-6 6M16 6l6 6-6 6"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 4l12 8-12 8z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  attack: '<path d="M5 19L17 7M14 5l5 0 0 5M5 15l4 4"/>',
  retreat: '<path d="M10 6L4 12l6 6"/><path d="M4 12h11a5 5 0 0 1 5 5v2"/>',
  hold: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  formation: '<circle cx="7" cy="8" r="1.6"/><circle cx="12" cy="8" r="1.6"/><circle cx="17" cy="8" r="1.6"/><circle cx="7" cy="15" r="1.6"/><circle cx="12" cy="15" r="1.6"/><circle cx="17" cy="15" r="1.6"/>',
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-5h4v5"/>',
  work: '<path d="M14 4l6 6-3 3-6-6z"/><path d="M11 7L3 15v6h6l8-8"/>',
  idle: '<circle cx="12" cy="7" r="3"/><path d="M7 21v-6a5 5 0 0 1 10 0v6"/><path d="M16 4.5l3-1.5M18 8h3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  fold: '<path d="M6 14l6-6 6 6"/>',
  unfold: '<path d="M6 10l6 6 6-6"/>',
  army: '<path d="M4 18l4-10 4 6 4-6 4 10z"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  build: '<path d="M4 20h16"/><path d="M6 20V10l6-5 6 5v10"/><path d="M10 20v-6h4v6"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  cannon: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  rally: '<path d="M6 21V4"/><path d="M6 4h11l-3 4 3 4H6"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  pointer: '<path d="M4 12h13"/><path d="M12 6l6 6-6 6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
};
const icon = (k, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[k] || ""}</svg>`;
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };
const screen = document.getElementById("screen");
const add = (html) => { const n = el(html); screen.append(n); return n; };

function btn(label, o = {}) {
  const st = o.state || "";
  return `<button class="b ${o.cls || ""} ${st ? "is-" + st : ""}" ${st === "disabled" ? "disabled" : ""} ${o.attr || ""}>` +
    (o.ic ? icon(o.ic) : "") + (label ? `<span class="lb">${label}</span>` : "") + (o.sub ? `<span class="sub">${o.sub}</span>` : "") +
    (o.cnt !== undefined ? `<span class="cnt">${o.cnt}</span>` : "") + "</button>";
}

// ---------------------------------------------------------------- the pieces of the battlefield screen

const PIECES = {
  field(s) {
    screen.style.backgroundImage = `url(../build/${s.field || `field-${THEME}`}.png)`;
  },
  hp(s) {
    if (!s.hp || !window.R6_OVERLAY) return;
    const w = add('<div class="world"></div>');
    for (const u of window.R6_OVERLAY.selected) w.append(el(`<div class="hp" style="left:${u.x}px;top:${u.top - 6}px"><i style="width:${u.hp}%"></i></div>`));
  },
  res(s) {
    const r = Object.assign({ food: 340, wood: 215, gold: 180, crys: 25, pop: "28", cap: "35", time: "6:42", label: "" }, s.res || {});
    add(`<div class="panel res ${r.cls || ""}">
      <span class="r">${icon("food", "food")}<b>${r.food}</b></span><span class="r">${icon("wood", "wood")}<b>${r.wood}</b></span>
      <span class="r">${icon("gold", "gold")}<b>${r.gold}</b></span><span class="r">${icon("crystal", "crys")}<b>${r.crys}</b></span>
      <span class="sep"></span><span class="r">${icon("pop")}<b>${r.pop}</b><small>/${r.cap}</small>${r.training ? `<small class="tr">訓練中 ${r.training}</small>` : ""}</span>
      ${r.time === null ? "" : `<span class="r">${icon("time")}<b>${r.time}</b></span>`}</div>`);
  },
  topright(s) {
    const t = Object.assign({ speed: "正常", paused: false }, s.top || {});
    const sp = { 正常: "speed", 快: "fast", 慢: "slow" }[t.speed];
    add(`<div class="topright">${btn(t.speed, { ic: sp, cls: "sec", sub: "速度" })}${btn(t.paused ? "繼續" : "暫停", { ic: t.paused ? "play" : "pause", cls: "pri" })}${btn("選單", { ic: "menu", cls: "sec" })}</div>`);
    if (t.paused) add('<div class="panel banner">暫停中：仍可下指令</div>');
  },
  retreatAll(s) {
    if (s.retreatAll === false) return;
    add(`<div class="retreat-all">${btn("全軍撤退", { ic: "retreat", cls: "blue", state: s.retreatAllState })}</div>`);
  },
  groups(s) {
    const sel1 = s.sel && s.sel.kind === "units";           // group 1 is the selected squad of the base state
    const g = s.groups || [{ n: 1, sub: "10/10", st: sel1 ? "active" : "" }, { n: 2, sub: "6/6" }, { n: 3 }, { n: 4 }];
    const cells = g.map((x) => `<button class="b grp ${x.sub ? "" : "empty"} ${x.st ? "is-" + x.st : ""}"><span class="n">${x.n}</span>${x.sub ? `<span class="sub">${x.sub}</span>` : ""}</button>`);
    add(`<div class="groups">${cells.join("")}${btn("全軍", { ic: "army", cls: "army", cnt: s.army ?? 16 })}</div>`);
    for (const r of s.backs || []) add(`<div class="back back-${r}">${btn("退" + r, { cls: "blue" })}</div>`);
  },
  left(s) {
    // D-087 C: 閒置 only while someone idles; 全體回城 only when home is hit (and 回去工作 while hidden); the 地圖 button
    const l = Object.assign({ idle: 3, map: "closed", recall: null }, s.left || {});
    if (l.recall) {
      add(`<div class="recall ${l.recall}">${l.recall === "hit"
        ? btn("全體回城", { ic: "home", cls: "alarm", sub: "家裡被攻擊" })
        : btn("回去工作", { ic: "work", cls: "pri", sub: "村民躲著" })}</div>`);
    }
    if (l.idle) add(`<div class="idlebox">${btn("閒置", { ic: "idle", cls: "idle", cnt: l.idle })}</div>`);
    const alarm = l.alarm ? `<span class="badge">${l.alarm}</span>` : "";
    add(`<div class="maptab ${l.map === "open" ? "is-open" : ""} ${l.alarm && !l.dim ? "is-alarm" : ""}">${btn("地圖", { ic: "map", cls: "sec", state: l.map === "open" ? "active" : "" })}${alarm}</div>`);
    if (l.map === "open") add(`<div class="minimap"><img src="../build/${l.minimap || "minimap-diamond"}.png" alt=""></div>`);
  },
  sel(s) {
    if (!s.sel) return;
    const k = s.sel;
    const head = (t, extra = "") => `<div class="sel-head"><span class="t">${t}</span>${extra}
      ${btn(s.folded ? "展開" : "收起", { ic: s.folded ? "unfold" : "fold", cls: "mini sec" })}${btn("", { ic: "close", cls: "x sec", attr: 'aria-label="取消選取"' })}</div>`;
    let body = "";
    if (k.kind === "units") {
      body = head(k.title || "已選 10 個單位") + `<div class="chips">${(k.chips || [["槍兵", 6], ["遠程兵", 4]]).map(([n, c]) => `<button class="b chip">${n} <b>×${c}</b></button>`).join("")}
        <span class="now">${k.now || "目前：待命 10"}</span></div>` + (s.folded ? "" : `<ul class="help">${(k.help || HELP.dense).map(([c, kk, t]) => `<li><em class="k ${c}">${kk}</em>${t}</li>`).join("")}</ul>`);
    } else if (k.html) {
      body = head(k.title, k.extra || "") + (s.folded ? "" : k.html);
    }
    add(`<div class="panel sel ${s.folded ? "folded" : ""}">${body}</div>`);
  },
  cmds(s) {
    const c = s.cmds === undefined ? "soldiers" : s.cmds;
    if (!c) return;
    const sets = {
      soldiers: [btn("進攻", { ic: "attack", cls: "red", sub: "點地面", state: s.atk }), btn("撤退", { ic: "retreat", cls: "blue", sub: "點地面", state: s.ret }),
        btn("堅守", { ic: "hold", cls: "gold", sub: "原地不動" }), btn("停止", { ic: "stop", cls: "sec" }),
        btn("隊形：密集", { ic: "formation", cls: "sec wide", sub: "按一下改成散開" })],
      none: [btn("建造", { ic: "build", cls: "pri" })],
      build: [["民居", "木30"], ["農田", "木60"], ["伐木場", "木50"], ["礦場", "木50"], ["糧倉", "木60"], ["兵營", "木150"],
        ["射場", "木150"], ["法術營", "木200 金150"], ["箭樓", "木100 金50"], ["馬廄", "木150 金50"], ["哨所", "木50"]]
        .map(([n, c]) => btn(n, { ic: "build", cls: "pri", sub: c })).concat([btn("返回", { cls: "sec" })]),
    };
    add(`<div class="cmds">${(Array.isArray(c) ? c : sets[c]).join("")}</div>`);
  },
  prompt(s) {
    if (!s.prompt) return;
    const p = s.prompt;
    add(`<div class="panel prompt"><div class="pt"><span>${p.text}</span>${p.warn ? `<span class="warn">${p.warn}</span>` : ""}</div>${(p.buttons || []).join("")}</div>`);
  },
  toast(s) {
    if (s.toast) add(`<div class="toast">${s.toast}</div>`);
  },
  arrows(s) {
    for (const a of s.arrows || []) add(`<button class="b arrow" style="left:${a.x}px;top:${a.y}px;transform:rotate(${a.r}deg)" aria-label="有東西被攻擊：點一下跳過去">${icon("pointer")}</button>`);
  },
  note(s) {
    for (const n of s.notes || []) add(`<div class="callout" style="left:${n.x}px;top:${n.y}px">${n.t}</div>`);
  },
};
PIECES.mark = (s) => {
  // design notes only: ring the elements a board talks about
  for (const sel of s.mark || []) for (const n of screen.querySelectorAll(sel)) n.classList.add("is-marked");
};
const ORDER = ["field", "hp", "res", "topright", "retreatAll", "groups", "left", "sel", "cmds", "prompt", "toast", "arrows", "note", "mark"];

const HELP = {
  dense: [["atk", "進攻", "點地面或小地圖，整隊前進，遇到敵人一起打"], ["ret", "撤退", "點地面或小地圖撤到那裡，點主城回家"],
    ["hold", "堅守", "停在原地，敵人進到射程就打，不追出去"], ["", "密集", "站位間隔 1 格，火力集中"]],
};

function render(id) {
  const s = Object.assign({}, window.R6_STATES.base, window.R6_STATES[id] || {});
  if (!window.R6_STATES[id]) console.error("unknown state", id);
  screen.className = "screen";
  for (const k of ORDER) PIECES[k](s);
}

const STATE = Q.get("state") || "base";
const ov = document.createElement("script");
ov.src = "../build/overlay.js";
ov.onload = ov.onerror = () => render(STATE);
document.head.append(ov);
