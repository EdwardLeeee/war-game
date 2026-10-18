// R6 B.3 mock: the formal interface, every state of design/r6/inventory.md, in theme A (銅木, the default)
// or B (墨漆金線) (D-087). ui.html?theme=a|b&state=<id> draws one state; the states are in states.js.
// Layout follows the prototype (inventory.md) except where D-087 changes it: the left column is gone (閒置
// only when someone idles, 全體回城 only when home is hit, 重設 handed to × and 取消) and the minimap is a
// diamond behind a 「地圖」 button.
"use strict";

const Q = new URLSearchParams(location.search);
const THEME = Q.get("theme") || "a";
const T = Q.has("t") ? parseFloat(Q.get("t")) : 1;           // R6-25: where an animation is (0 .. 1)
const ease = (x) => 1 - (1 - x) * (1 - x);
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
    const cells = g.map((x) => `<button class="b grp ${x.sub ? "" : "empty"} ${x.st ? "is-" + x.st : ""} ${x.cls || ""}"><span class="n">${x.n}</span>${x.sub ? `<span class="sub">${x.sub}</span>` : ""}</button>`);
    add(`<div class="groups">${cells.join("")}${btn("全軍", { ic: "army", cls: "army", cnt: s.army ?? 16 })}</div>`);
    for (const r of s.backs || []) add(`<div class="back back-${r}">${btn("退" + r, { cls: "blue" })}</div>`);
  },
  left(s) {
    // D-087 C: 閒置 only while someone idles; 全體回城 only when home is hit (and 回去工作 while hidden); the 地圖 button
    const l = Object.assign({ idle: 3, map: "closed", recall: null }, s.left || {});
    if (l.recall) {
      const k = s.anim === "recall" ? ease(T) : 1;
      add(`<div class="recall ${l.recall}" style="transform:translateX(${-(1 - k) * 112}px);opacity:${k}">${l.recall === "hit"
        ? btn("全體回城", { ic: "home", cls: "alarm", sub: "家裡被攻擊" })
        : btn("回去工作", { ic: "work", cls: "pri", sub: "村民躲著" })}</div>`);
    }
    if (l.idle) add(`<div class="idlebox">${btn("閒置", { ic: "idle", cls: "idle", cnt: l.idle })}</div>`);
    const alarm = l.alarm ? `<span class="badge">${l.alarm}</span>` : "";
    add(`<div class="maptab ${l.map === "open" ? "is-open" : ""} ${l.alarm && !l.dim ? "is-alarm" : ""}">${btn("地圖", { ic: "map", cls: "sec", state: l.map === "open" ? "active" : "" })}${alarm}</div>`);
    if (l.map === "open") {
      const k = s.anim === "map" ? ease(T) : 1;
      const sq = l.mmShape === "square";       // R6-04: a square map has a square minimap
      add(`<div class="minimap ${sq ? "sqmap panel" : ""}" style="transform-origin:0 100%;transform:scale(${0.6 + 0.4 * k});opacity:${k}"><img src="../build/${l.minimap || "minimap-diamond"}.png" alt=""></div>`);
    }
  },
  sel(s) {
    if (!s.sel) return;
    const k = s.sel;
    const head = (t, extra = "") => `<div class="sel-head"><span class="t">${t}</span>${extra}
      ${btn(s.folded ? "展開" : "收起", { ic: s.folded ? "unfold" : "fold", cls: "mini sec" })}${btn("", { ic: "close", cls: "x sec", attr: 'aria-label="取消選取"' })}</div>`;
    let body = "";
    if (k.kind === "units") {
      body = head(k.title || "已選 10 個單位") + `<div class="chips">${(k.chips || [["槍兵", 6], ["遠程兵", 4]]).map(([n, c]) => `<button class="b chip">${n} <b>×${c}</b></button>`).join("")}
        <span class="now">${k.now || "目前：待命 10"}</span></div>` + (s.folded || (k.help && !k.help.length) ? "" : `<ul class="help">${(k.help || HELP.dense).map(([c, kk, t]) => `<li class="${c.includes("on") ? "on" : ""}"><em class="k ${c}">${kk}</em>${t}</li>`).join("")}</ul>`);
    } else if (k.kind === "html") {
      body = head(`${k.title}${k.extra || ""}`) + (s.folded ? "" : k.html);
    }
    add(`<div class="panel sel ${s.folded ? "folded" : ""}">${body}</div>`);
  },
  cmds(s) {
    const c = s.cmds === undefined ? "soldiers" : s.cmds;
    if (!c) return;
    const sets = {
      soldiers: [s.atk ? btn("取消進攻", { ic: "attack", cls: "red", sub: "停下堅守", state: "active" }) : btn("進攻", { ic: "attack", cls: "red", sub: "點地面", state: s.pressAtk ? "pressed" : "" }),
        s.ret ? btn("取消撤退", { ic: "retreat", cls: "blue", sub: "停下堅守", state: "active" }) : btn("撤退", { ic: "retreat", cls: "blue", sub: "點地面" }),
        btn("堅守", { ic: "hold", cls: "gold", sub: "原地不動", state: s.holdOn ? "active" : "" }), btn("停止", { ic: "stop", cls: "sec" }),
        btn(`隊形：${s.form || "密集"}`, { ic: "formation", cls: "sec wide", sub: { 密集: "按一下改成散開", 散開: "按一下改成密集", 混合: "按一下全部改成散開" }[s.form || "密集"] })]
        .concat(s.extraCmds || []),
      none: [btn("建造", { ic: "build", cls: "pri" })],
      villagers: [btn("撤退", { ic: "retreat", cls: "blue", sub: "點地面" }), btn("停止", { ic: "stop", cls: "sec" }), btn("建造", { ic: "build", cls: "pri" })],
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
    if (s.toast) add(`<div class="toast" style="opacity:${s.anim === "toast" ? T : 1}">${s.toast}</div>`);
  },
  arrows(s) {
    for (const a of s.arrows || []) add(`<button class="b arrow ${s.arrowDim ? "dim" : ""}" style="left:${a.x}px;top:${a.y}px;transform:rotate(${a.r}deg)" aria-label="有東西被攻擊：點一下跳過去">${icon("pointer")}</button>`);
  },
  note(s) {
    for (const n of s.notes || []) add(`<div class="callout" style="left:${n.x}px;top:${n.y}px">${n.t}</div>`);
  },
};
// ---------------------------------------------------------------- floating pieces, dialogs, start, result

PIECES.cue = (s) => {
  if (s.cue) {
    const k = s.anim === "cue" ? T : 0.62;
    add(`<div class="cue" style="left:${s.cue.x - 32}px;top:${s.cue.y - 32}px;transform:scale(${1 - 0.65 * k});opacity:${0.4 + 0.6 * k}"></div>`);
  }
};
PIECES.boxsel = (s) => {
  if (s.boxsel) { const [x, y, w, h] = s.boxsel; add(`<div class="boxsel" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"></div>`); }
};
PIECES.wheel = (s) => {
  if (!s.wheel) return;
  const { x, y, items } = s.wheel;
  const n = items.length;
  items.forEach(([label, cls], i) => {
    const a = n === 1 ? -90 : -90 + (i - (n - 1) / 2) * 60;
    const px = x + 72 * Math.cos(a * Math.PI / 180) - 30, py = y + 72 * Math.sin(a * Math.PI / 180) - 30;
    add(`<button class="b wheelb ${cls}" style="left:${px}px;top:${py}px"><span class="lb">${label}</span></button>`);
  });
};
PIECES.place = (s) => {
  if (!s.place) return;
  const { x, y, w, h, ok, okx } = s.place;
  add(`<div class="preview ${ok ? "ok" : "bad"}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"></div>`);
  if (okx) add(`<div class="okx" style="left:${x + w + 10}px;top:${y + h / 2 - 26}px">${btn("✓", { cls: "okb", state: ok ? "" : "disabled", attr: 'aria-label="確定蓋在這裡"' })}${btn("✗", { cls: "nob", attr: 'aria-label="不蓋"' })}</div>`);
};
PIECES.dialog = (s) => {
  if (!s.dialog) return;
  const d = s.dialog;
  const k = s.anim === "dialog" ? ease(T) : 1;
  add(`<div class="scrim" style="opacity:${k}"></div>`);
  add(`<div class="panel dialog ${d.cls || ""}" role="dialog" aria-label="${d.title}" style="opacity:${k};transform:translate(-50%,-50%) scale(${0.96 + 0.04 * k})"><h2>${d.title}</h2>${d.html}</div>`);
};
PIECES.start = (s) => {
  if (!s.start) return;
  const st = s.start;
  if (st.dim) add('<div class="scrim dark"></div>');
  add(`<div class="panel start" role="dialog" aria-label="開局"><h1>war-game</h1><p class="lead">1 對 1 對電腦</p>${st.html}</div>`);
};
PIECES.portrait = (s) => {
  if (!s.portrait) return;
  screen.style.width = "380px";           // the phone held upright: the frame on the board is 380 x 814
  screen.style.height = "814px";
  add(`<div class="portrait"><div class="phone"></div><p>請轉成橫向</p></div>`);
};
PIECES.error = (s) => {
  if (s.error) add(`<div class="error">${s.error}</div>`);
};
// ---------------------------------------------------------------- R6-23: the world interface (drawn by the game in world.ts)
const TEAMC = { own: "#3f7fe0", enemy: "#d9433a", neutral: "#d8d2c0", ruin: "#6d6258" };   // R6-24 甲
PIECES.world = (s) => {
  if (!s.world || !window.R6_WORLD) return;
  const W = window.R6_WORLD.world, T = window.R6_WORLD.town;
  const g = [];
  const bar = (x, y, w, frac, col) => g.push(`<rect x="${x - w / 2}" y="${y}" width="${w}" height="4" rx="2" fill="#201a18" opacity=".85"/>` +
    `<rect x="${x - w / 2}" y="${y}" width="${w * frac}" height="4" rx="2" fill="${col}"/>`);
  for (const it of s.world) {
    if (it.k === "mage") {
      const m = W.mage;
      g.push(`<ellipse cx="${m.x}" cy="${m.y - 14}" rx="13" ry="20" fill="rgba(95,227,240,.16)" stroke="rgba(95,227,240,.7)" stroke-width="1.2"/>`);
      bar(m.x, m.top - 12, 26, 1, "#78d05f");
      bar(m.x, m.top - 17, 26, 0.66, "#5fe3f0");
      if (it.arc) {
        const r = 14, a = it.arc * 2 * Math.PI, x0 = m.x, y0 = m.y - r * 0.5;
        const x1 = m.x + r * Math.sin(a), y1 = m.y - r * 0.5 * Math.cos(a);
        g.push(`<path d="M${x0} ${y0} A ${r} ${r * 0.5} 0 ${it.arc > 0.5 ? 1 : 0} 1 ${x1} ${y1}" fill="none" stroke="#ff8a2a" stroke-width="3" stroke-linecap="round"/>`);
      }
    } else if (it.k === "selbox") {
      const b = W.buildings[it.b][it.i || 0];
      g.push(`<polygon points="${b.foot.map((p) => p.join(",")).join(" ")}" fill="rgba(255,243,176,.08)" stroke="#fff3b0" stroke-width="2.5" stroke-dasharray="${it.dash || "none"}"/>`);
      if (it.hp !== undefined) bar(b.mid[0], b.top - 8, b.w * 0.6, it.hp, it.col || TEAMC.own);
    } else if (it.k === "bar") {
      const b = W.buildings[it.b][it.i || 0];
      bar(b.mid[0], b.top - 8, b.w * 0.6, it.frac, it.col);
    } else if (it.k === "rally") {
      const b = W.buildings[it.b][0], [rx, ry] = W.rally;
      g.push(`<line x1="${b.mid[0]}" y1="${b.mid[1]}" x2="${rx}" y2="${ry}" stroke="#fff3b0" stroke-width="2" stroke-dasharray="5 4"/>` +
        `<circle cx="${rx}" cy="${ry}" r="5" fill="#fff3b0" stroke="#201a18" stroke-width="1.5"/><path d="M${rx} ${ry} v-18 h11 l-3 4 3 4 h-11" fill="#fff3b0" stroke="#201a18" stroke-width="1"/>`);
    } else if (it.k === "marker") {
      const b = W.buildings[it.b][0], x = b.foot[1][0] - 6, y = b.foot[1][1] - 34;
      g.push(`<g transform="translate(${x} ${y})"><rect x="-10" y="-10" width="20" height="20" rx="5" fill="#201a18" stroke="#f0cf8a" stroke-width="1.5"/>` +
        (it.text ? `<text x="0" y="5" text-anchor="middle" font-size="13" font-weight="700" fill="#fff3b0">${it.text}</text>`
          : `<path d="M0 -6 l6 2.3 v3.5 c0 3 -2.6 5 -6 6 c-3.4 -1 -6 -3 -6 -6 v-3.5z" fill="#5fe3f0"/>`) + `</g>`);
    } else if (it.k === "rings") {
      for (const [x, y, col, lab, r0] of it.list) {
        const r = s.anim === "rings" ? r0 * (0.35 + 0.65 * T) : r0, op = s.anim === "rings" ? 1 - T * 0.9 : 0.95;
        g.push(`<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r / 2}" fill="none" stroke="${col}" stroke-width="2.5" opacity="${op}"/>` +
          `<ellipse cx="${x}" cy="${y}" rx="${r * 0.55}" ry="${r * 0.275}" fill="none" stroke="${col}" stroke-width="2" opacity="${op * 0.6}"/>` +
          `<text x="${x}" y="${y + r / 2 + 14}" text-anchor="middle" font-size="12" font-weight="700" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke">${lab}</text>`);
      }
    } else if (it.k === "shot") {
      const b = W.buildings.ArrowTower[0], [ex, ey] = W.enemy;
      const x0 = b.mid[0] + 20, y0 = b.mid[1] + 6, x1 = ex - 30, y1 = ey - 30, t = 0.62;
      const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t - 24, ang = Math.atan2(y1 - y0 + 40, x1 - x0) * 180 / Math.PI;
      g.push(`<path d="M${x0} ${y0} Q ${(x0 + x1) / 2} ${Math.min(y0, y1) - 60} ${x1} ${y1}" fill="none" stroke="rgba(255,240,200,.35)" stroke-width="1.5" stroke-dasharray="3 5"/>` +
        `<g transform="translate(${px} ${py}) rotate(${ang})"><line x1="-7" y1="0" x2="5" y2="0" stroke="#2a1c10" stroke-width="3"/><line x1="-7" y1="0" x2="5" y2="0" stroke="#f4e2b0" stroke-width="1.6"/>` +
        `<path d="M5 -3 L10 0 L5 3 z" fill="#f4e2b0" stroke="#2a1c10" stroke-width=".8"/></g>`);
    } else if (it.k === "town") {
      const L = it.look;
      g.push(`<polygon points="${T.ring.map((p) => p.join(",")).join(" ")}" fill="${L.tint}" fill-opacity=".1" stroke="${L.tint}" stroke-width="3" stroke-opacity=".75"/>` +
        `<polygon points="${T.wall.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${L.tint}" stroke-width="6" stroke-linejoin="round" opacity=".95"/>` +
        `<polygon points="${T.wall.map((p) => p.join(",")).join(" ")}" fill="none" stroke="#201a18" stroke-width="1.5" stroke-dasharray="4 3"/>`);
      const [lx, ly] = T.label;
      const glyph = `<div class="townglyph" style="left:${lx - 13}px;top:${ly - 110}px;--tint:${L.tint}">${L.glyph || "鎮"}</div>`;
      const label = L.text ? `<div class="townlabel" style="left:${lx}px;top:${ly + 4}px">${L.text}${L.timer !== undefined ? `<span class="tbar"><i style="width:${L.timer * 100}%"></i></span>` : ""}</div>` : "";
      add(glyph); if (label) add(label);
    }
  }
  const svg = add(`<svg class="worldsvg" width="814" height="380" viewBox="0 0 814 380">${g.join("")}</svg>`);
  screen.insertBefore(svg, screen.querySelector(".res"));
};
// ---------------------------------------------------------------- R6-40: every button in every state
PIECES.sheet = (s) => {
  if (!s.sheet) return;
  screen.style.width = "814px"; screen.style.height = "560px"; screen.style.backgroundImage = "none";
  const states = ["", "pressed", "active", "disabled"];
  const rows = [
    ["進攻（紅）", (st) => btn("進攻", { ic: "attack", cls: "red", sub: "點地面", state: st })],
    ["撤退（藍）", (st) => btn("撤退", { ic: "retreat", cls: "blue", sub: "點地面", state: st })],
    ["堅守（金）", (st) => btn("堅守", { ic: "hold", cls: "gold", sub: "原地不動", state: st })],
    ["一般", (st) => btn("停止", { ic: "stop", cls: "sec", state: st })],
    ["主要", (st) => btn(st === "disabled" ? "法術營" : "訓練槍兵", { ic: "build", cls: "pri", sub: st === "disabled" ? "要先蓋 兵營" : "糧40 木20", state: st })],
    ["編隊", (st) => `<button class="b grp ${st ? "is-" + st : ""}" ${st === "disabled" ? "disabled" : ""}><span class="n">2</span><span class="sub">6/6</span></button>`],
    ["兵種鈕、−／+", (st) => `<span class="pair">${btn("槍兵 <b>×6</b>", { cls: "chip", state: st })}${btn("+", { cls: "sec pm", state: st })}</span>`],
    ["地圖鈕", (st) => `<span class="mtab">${btn("地圖", { ic: "map", cls: "sec", state: st })}</span>`],
  ];
  const head = `<div class="sh-row sh-head"><span></span>${["一般", "按下", "亮著（選中、開著）", "不能按"].map((t) => `<span>${t}</span>`).join("")}</div>`;
  const body = rows.map(([t, mk]) => `<div class="sh-row"><span class="sh-t">${t}</span>${states.map((st) => `<span class="sh-c">${mk(st)}</span>`).join("")}</div>`).join("");
  const extra = `<div class="sh-row sh-extra"><span class="sh-t">只有這種狀態的</span>
    <span class="sh-c">${btn("全體回城", { ic: "home", cls: "alarm", sub: "家裡被攻擊" })}</span>
    <span class="sh-c"><span class="mtab is-alarm">${btn("地圖", { ic: "map", cls: "sec" })}<span class="badge">2</span></span></span>
    <span class="sh-c"><button class="b grp alarm"><span class="n">1</span><span class="sub">剩 4/10</span></button></span>
    <span class="sh-c">${btn("✓", { cls: "okb" })}${btn("✗", { cls: "nob" })}</span></div>`;
  add(`<div class="sheet ${s.sheetBg || ""}">${head}${body}${extra}</div>`);
};
PIECES.mark = (s) => {
  // design notes only: ring the elements a board talks about
  for (const sel of s.mark || []) for (const n of screen.querySelectorAll(sel)) n.classList.add("is-marked");
};
const ORDER = ["field", "hp", "place", "world", "res", "topright", "retreatAll", "groups", "left", "sel", "cmds", "prompt", "cue", "boxsel", "wheel", "toast", "arrows",
  "dialog", "start", "portrait", "error", "sheet", "note", "mark"];

const HELP = {
  dense: [["atk", "進攻", "點地面或小地圖，整隊前進，遇到敵人一起打"], ["ret", "撤退", "點地面或小地圖撤到那裡，點主城回家"],
    ["hold", "堅守", "停在原地，敵人進到射程就打，不追出去"], ["", "密集", "站位間隔 1 格，火力集中"]],
};

function render(id) {
  const s = Object.assign({}, window.R6_STATES.base, window.R6_STATES[id] || {});
  if (!window.R6_STATES[id]) console.error("unknown state", id);
  screen.className = "screen";
  const only = s.only;                                    // e.g. the start screen: just the field and the card
  for (const k of ORDER) if (!only || only.includes(k)) PIECES[k](s);
}

const STATE = Q.get("state") || "base";
const ov = document.createElement("script");
ov.src = "../build/overlay.js";
ov.onload = ov.onerror = () => {
  const w = document.createElement("script");
  w.src = "../build/world.js";
  w.onload = w.onerror = () => render(STATE);
  document.head.append(w);
};
document.head.append(ov);
