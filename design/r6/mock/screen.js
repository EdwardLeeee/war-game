// R6 B.2 mock: builds the representative screen (or the button-state sheet) for one theme.
// Positions follow the prototype (design/r6/inventory.md, client/src/style.css); only the look is themed.
"use strict";

const q = new URLSearchParams(location.search);
const THEME = q.get("theme") || "a";
const LEFT = q.get("left") || "keep";
const MINIMAP = q.get("minimap") || "square";
document.documentElement.dataset.theme = THEME;
document.documentElement.dataset.left = LEFT;
document.documentElement.dataset.minimap = MINIMAP;

// Original line icons, 24 x 24, drawn with currentColor.
const ICON = {
  food: '<path d="M12 21V9"/><path d="M12 9c-3 0-4.5-2-4.5-5 3 0 4.5 2 4.5 5zM12 9c3 0 4.5-2 4.5-5-3 0-4.5 2-4.5 5z"/><path d="M12 14c-3 0-4.5-2-4.5-5 3 0 4.5 2 4.5 5zM12 14c3 0 4.5-2 4.5-5-3 0-4.5 2-4.5 5z"/>',
  wood: '<ellipse cx="9" cy="12" rx="5" ry="6"/><ellipse cx="9" cy="12" rx="2.2" ry="2.8"/><path d="M9 6h8a5 6 0 0 1 0 12H9"/>',
  gold: '<path d="M4 17h16l-3-7H7z"/><path d="M8.5 10l1.5-4h4l1.5 4"/>',
  crystal: '<path d="M12 2l5 6-5 14-5-14z"/><path d="M7 8h10M12 2v20"/>',
  pop: '<circle cx="12" cy="7.5" r="3.5"/><path d="M5 21c0-4 3-7 7-7s7 3 7 7"/>',
  time: '<path d="M7 3h10M7 21h10M8 3c0 5 8 6 8 9s-8 4-8 9M16 3c0 5-8 6-8 9s8 4 8 9"/>',
  speed: '<path d="M5 6l6 6-6 6M12 6l6 6-6 6"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  attack: '<path d="M5 19L17 7M14 5l5 0 0 5M5 15l4 4"/>',
  retreat: '<path d="M10 6L4 12l6 6"/><path d="M4 12h11a5 5 0 0 1 5 5v2"/>',
  hold: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  formation: '<circle cx="7" cy="8" r="1.6"/><circle cx="12" cy="8" r="1.6"/><circle cx="17" cy="8" r="1.6"/><circle cx="7" cy="15" r="1.6"/><circle cx="12" cy="15" r="1.6"/><circle cx="17" cy="15" r="1.6"/>',
  reset: '<path d="M5 12a7 7 0 1 0 2-5"/><path d="M5 4v4h4"/>',
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-5h4v5"/>',
  idle: '<circle cx="12" cy="7" r="3"/><path d="M7 21v-6a5 5 0 0 1 10 0v6"/><path d="M16 4.5l3-1.5M18 8h3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  fold: '<path d="M6 14l6-6 6 6"/>',
  army: '<path d="M4 18l4-10 4 6 4-6 4 10z"/>',
  more: '<circle cx="6" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18" cy="12" r="1.8"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  build: '<path d="M4 20h16"/><path d="M6 20V10l6-5 6 5v10"/><path d="M10 20v-6h4v6"/>',
};
const icon = (k, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };
const screen = document.getElementById("screen");

function btn(label, { cls = "", sub = "", ic = "", state = "" } = {}) {
  return `<button class="b ${cls} ${state ? "is-" + state : ""}" ${state === "disabled" ? "disabled" : ""}>` +
    (ic ? icon(ic) : "") + `<span class="lb">${label}</span>` + (sub ? `<span class="sub">${sub}</span>` : "") + "</button>";
}

function buildScreen(data) {
  screen.className = "screen";
  screen.style.backgroundImage = `url(../build/field-${THEME}.png)`;

  // world overlay: health bars over the selected squad
  const world = el('<div class="world"></div>');
  for (const u of data.selected) {
    world.append(el(`<div class="hp" style="left:${u.x}px;top:${u.top - 6}px"><i style="width:${u.hp ?? 100}%"></i></div>`));
  }
  screen.append(world);

  // top left: resources
  screen.append(el(`<div class="panel res">
    <span class="r">${icon("food", "food")}<b>340</b></span>
    <span class="r">${icon("wood", "wood")}<b>215</b></span>
    <span class="r">${icon("gold", "gold")}<b>180</b></span>
    <span class="r">${icon("crystal", "crys")}<b>25</b></span>
    <span class="sep"></span>
    <span class="r">${icon("pop")}<b>28</b><small>/35</small></span>
    <span class="r">${icon("time")}<b>6:42</b></span>
    ${LEFT === "moved" ? `<span class="sep"></span><button class="b idle-chip">${icon("idle")}<span class="lb">閒置</span><span class="cnt">3</span></button>` : ""}
  </div>`));

  // top right: speed, pause, menu
  const tr = el('<div class="topright"></div>');
  if (LEFT === "moved") tr.append(el(btn("全體回城", { ic: "home", cls: "sec" })));
  tr.append(el(btn("正常", { ic: "speed", cls: "sec", sub: "速度" })), el(btn("暫停", { ic: "pause", cls: "pri" })),
    el(btn("選單", { ic: "menu", cls: "sec" })));
  screen.append(tr);

  // 全軍撤退
  screen.append(el(`<div class="retreat-all">${btn("全軍撤退", { ic: "retreat", cls: "blue" })}</div>`));

  // right: groups 1-4 and 全軍
  screen.append(el(`<div class="groups">
    <button class="b grp is-active"><span class="n">1</span><span class="sub">10/10</span></button>
    <button class="b grp"><span class="n">2</span><span class="sub">6/6</span></button>
    <button class="b grp empty"><span class="n">3</span></button>
    <button class="b grp empty"><span class="n">4</span></button>
    <button class="b army">${icon("army")}<span class="lb">全軍</span><span class="cnt">16</span></button>
  </div>`));

  // left: 重設, 全體回城, 閒置 and the minimap, in one of the R6-02 ways
  buildLeft();

  // bottom centre: selection info
  screen.append(el(`<div class="panel sel">
    <div class="sel-head"><span class="t">已選 10 個單位</span>
      <button class="b mini sec">${icon("fold")}<span class="lb">收起</span></button>
      <button class="b x sec" aria-label="取消選取">${icon("close")}</button></div>
    <div class="chips"><button class="b chip">槍兵 <b>×6</b></button><button class="b chip">遠程兵 <b>×4</b></button>
      <span class="now">目前：待命 10</span></div>
    <ul class="help">
      <li><em class="k atk">進攻</em>點地面或小地圖，整隊前進，遇到敵人一起打</li>
      <li><em class="k ret">撤退</em>點地面或小地圖撤到那裡，點主城回家</li>
      <li><em class="k hold">堅守</em>停在原地，敵人進到射程就打，不追出去</li>
      <li><em class="k">密集</em>站位間隔 1 格，火力集中</li>
    </ul>
  </div>`));

  // bottom right: commands
  screen.append(el(`<div class="cmds">
    ${btn("進攻", { ic: "attack", cls: "red", sub: "點地面" })}
    ${btn("撤退", { ic: "retreat", cls: "blue", sub: "點地面" })}
    ${btn("堅守", { ic: "hold", cls: "gold", sub: "原地不動" })}
    ${btn("停止", { ic: "stop", cls: "sec" })}
    ${btn("隊形：密集", { ic: "formation", cls: "sec wide", sub: "按一下改成散開" })}
  </div>`));
}

function minimap(cls = "") {
  return `<div class="minimap ${cls}" data-shape="${MINIMAP}"><div class="mm-in"><img src="../build/minimap-${MINIMAP}.png" alt=""></div></div>`;
}

function buildLeft() {
  const idle = `<button class="b idle">${icon("idle")}<span class="lb">閒置</span><span class="cnt">3</span></button>`;
  if (LEFT === "keep") {
    screen.append(el(`<div class="leftcol">
      ${btn("重設", { ic: "reset", cls: "tool" })}
      ${btn("全體回城", { ic: "home", cls: "sec" })}
      ${idle}
    </div>`));
    screen.append(el(minimap()));
  } else if (LEFT === "fan" || LEFT === "fan-open") {
    // one button holds the three (the badge counts the idle farmers); the minimap smaller
    const open = LEFT === "fan-open";
    screen.append(el(`<div class="leftcol fan">
      <button class="b tools ${open ? "is-active" : ""}">${icon("more")}<span class="lb">工具</span><span class="dot">3</span></button>
    </div>`));
    if (open) screen.append(el(`<div class="fan-open">${btn("重設", { ic: "reset", cls: "tool" })}${btn("全體回城", { ic: "home", cls: "sec" })}${idle}</div>`));
    screen.append(el(minimap("small")));
  } else if (LEFT === "ondemand" || LEFT === "ondemand-open") {
    // 閒置 only while someone idles; 重設 joins ✕ and 取消; 全體回城 in the menu and on the alarm; the minimap in a tab
    const open = LEFT === "ondemand-open";
    screen.append(el(`<div class="leftcol ondemand">${idle}</div>`));
    screen.append(el(`<button class="b maptab ${open ? "is-active" : ""}">${icon("map")}<span class="lb">地圖</span></button>`));
    if (open) screen.append(el(minimap("pop")));
  } else if (LEFT === "moved") {
    // 閒置 in the resource bar, 全體回城 at the top right, 重設 joins ✕ and 取消; the minimap at the top left, small
    screen.append(el(minimap("top")));
  }
}

function buildStates() {
  screen.className = "states";
  const row = (title, mk) => `<div class="st-row"><div class="st-title">${title}</div>` +
    ["", "pressed", "active", "disabled"].map((s) => `<div class="st-cell">${mk(s)}</div>`).join("") + "</div>";
  screen.innerHTML = `<div class="st-head"><div></div><div>一般</div><div>按下</div><div>亮著（選中、開著）</div><div>不能按</div></div>` +
    row("指令", (s) => btn("進攻", { ic: "attack", cls: "red", sub: "點地面", state: s })) +
    row("一般按鈕", (s) => btn("全體回城", { ic: "home", cls: "sec", state: s })) +
    row("主要按鈕", (s) => btn("訓練槍兵", { ic: "build", cls: "pri", sub: "糧40 木20", state: s })) +
    row("建造選單", (s) => btn("法術營", { ic: "build", cls: "pri", sub: s === "disabled" ? "要先蓋兵營" : "木200 金150", state: s })) +
    row("編隊", (s) => `<button class="b grp ${s ? "is-" + s : ""}" ${s === "disabled" ? "disabled" : ""}><span class="n">2</span><span class="sub">6/6</span></button>`);
}

if (q.get("states")) {
  buildStates();
} else {
  const s = document.createElement("script");
  s.src = "../build/overlay.js";
  s.onload = () => buildScreen(window.R6_OVERLAY);
  document.head.append(s);
}
