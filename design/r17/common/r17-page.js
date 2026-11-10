// R17 (the user 2026-11-10: 「我覺得結算畫面 也可以把電腦來進攻我們打團戰的飆進去」): the options drawn into the client's own
// 局後統計 page (?ui=r6, A 銅木) for the design boards, as war-game-ui's R15 did: the page as it is, the new parts added over
// it, each added part in a box (.r17-mark) the board outlines. Not the client's code: client draws the approved option.
//
// window.R17.draw(opt, ev, ticks, sel): opt "A" (every attack and battle on the chart), "C" (a strip under the chart),
// "B-list" (戰鬥 → 戰事, the list), "B-jump" (a row tapped: 兵力 with that span); ev the events (events_r17.py), ticks the
// game's length; sel the event tapped (its card open), or null.
//
// Marks (not the players' blue and red, ceo 2026-11-10; the words in the card and the key besides):
//   attack ▽ held (hollow), ▼ a town lost (filled), × the main city destroyed; a battle a span over its time, filled
//   pale when we won, hatched when they did, dotted when even; marks under 14 pt apart joined in a pill with their count.
(() => {
  const INK = "#f3e7c9";
  const DARK = "#1b120b";
  const GOLD = "#e7c35a";
  const NS = "http://www.w3.org/2000/svg";
  const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const RES = { "擋下": "held", "城鎮失守": "lost", "主城被毀": "city", "我方贏": "won", "敵方贏": "beaten", "平": "even" };
  const RESULT_TEXT = { "擋下": "擋下", "城鎮失守": "城鎮失守", "主城被毀": "主城被毀", "我方贏": "我方贏", "敵方贏": "敵方贏", "平": "平手" };

  function events(ev) {
    // one list in time order: an attack that turned into a battle at the same place rides on that battle
    const out = ev.battles.map((b, i) => ({ kind: "battle", ...b, i, attacks: [] }));
    for (const a of ev.attacks) {
      if (a.battle !== null) out[a.battle].attacks.push(a);
      else out.push({ kind: "attack", ...a, attacks: [a] });
    }
    out.sort((x, y) => x.t0 - y.t0);
    return out;
  }

  function geom() {
    const svg = document.querySelector(".st-chart svg");
    const axis = svg.querySelector(".st-axis");
    const x1 = +axis.getAttribute("x1"), x2 = +axis.getAttribute("x2"), y0 = +axis.getAttribute("y1");
    const grid = [...svg.querySelectorAll(".st-grid")].filter((l) => l.getAttribute("y1") === l.getAttribute("y2")).map((l) => +l.getAttribute("y1"));
    const top = Math.min(...grid);
    return { svg, x1, x2, y0, top, rect: svg.getBoundingClientRect() };
  }

  function s(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  }

  function defs(svg) {
    if (svg.querySelector("#r17hatch")) return;
    const d = s("defs", {}, svg);
    const p = s("pattern", { id: "r17hatch", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, d);
    s("rect", { width: 6, height: 6, fill: "rgba(243,231,201,0.06)" }, p);
    s("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: "rgba(243,231,201,0.55)", "stroke-width": 2 }, p);
  }

  /** An attack's mark: ▽ held, ▼ lost, ✖ city; centre x, top y, size. */
  function attackMark(g, a, x, y, k = 11, on = false) {
    const r = RES[a.result];
    if (r === "city") {
      s("path", { d: `M${x - k / 2} ${y} L${x + k / 2} ${y + k} M${x + k / 2} ${y} L${x - k / 2} ${y + k}`, stroke: on ? GOLD : INK, "stroke-width": 3, "stroke-linecap": "round" }, g);
      return;
    }
    s("path", { d: `M${x - k / 2} ${y} L${x + k / 2} ${y} L${x} ${y + k} Z`, fill: r === "lost" ? (on ? GOLD : INK) : DARK, stroke: on ? GOLD : INK, "stroke-width": 1.8, "stroke-linejoin": "round" }, g);
  }

  function span(g, b, xa, xb, y, h, on = false) {
    const r = RES[b.result];
    const w = Math.max(3, xb - xa);
    s("rect", { x: xa, y, width: w, height: h, rx: 2,
      fill: r === "won" ? "rgba(243,231,201,0.30)" : r === "beaten" ? "url(#r17hatch)" : "none",
      stroke: on ? GOLD : r === "even" ? INK : "rgba(243,231,201,0.65)", "stroke-width": on ? 2.5 : 1.2,
      "stroke-dasharray": r === "even" ? "2 2" : "none" }, g);
  }

  function pill(g, x, y, n, on = false) {
    s("rect", { x: x - 11, y, width: 22, height: 15, rx: 7.5, fill: on ? GOLD : INK, stroke: DARK, "stroke-width": 1 }, g);
    const t = s("text", { x, y: y + 11.5, "text-anchor": "middle", "font-size": 11, "font-weight": 700, fill: DARK }, g);
    t.textContent = `×${n}`;
  }

  /** Point marks along one row: the attacks (and in C the battles' starts are spans, not points), joined under 14 pt. */
  function points(list, X) {
    const out = [];
    for (const e of list) {
      const x = X(e.attacks[0].t0);
      const last = out[out.length - 1];
      if (last && x - last.x1 < 14) { last.items.push(e); last.x1 = x; }
      else out.push({ x0: x, x1: x, items: [e] });
    }
    return out;
  }

  function keyRow(where) {
    const lg = document.querySelector(".st-legend");
    if (!lg || lg.querySelector(".r17-key")) return;
    const k = document.createElement("span");
    k.className = "st-lg r17-key r17-mark";
    k.style.cssText = "display:inline-flex;gap:8px;align-items:center;margin-left:14px;font-size:13px;white-space:nowrap";
    const g = (draw) => { const sv = document.createElementNS(NS, "svg"); sv.setAttribute("width", 14); sv.setAttribute("height", 13); defs(sv); draw(sv); return sv.outerHTML; };
    k.innerHTML = "進攻" + g((sv) => attackMark(sv, { result: "擋下" }, 7, 1, 11)) + "擋下" + g((sv) => attackMark(sv, { result: "城鎮失守" }, 7, 1, 11)) + "失守" +
      g((sv) => attackMark(sv, { result: "主城被毀" }, 7, 1, 11)) + "主城被毀　團戰" + g((sv) => span(sv, { result: "我方贏" }, 1, 13, 1, 11)) + "我方贏" +
      g((sv) => span(sv, { result: "敵方贏" }, 1, 13, 1, 11)) + "敵方贏";
    lg.appendChild(k);
  }

  function card(e, n, of, anchor) {
    const box = document.querySelector(".stats-card");
    const c = document.createElement("div");
    c.className = "r17-card r17-mark";
    const br = box.getBoundingClientRect();
    c.style.cssText = `position:absolute;z-index:9;background:#2a1c11;border:1.5px solid ${GOLD};border-radius:9px;padding:7px 10px 6px;` +
      "color:#f6efe0;font-size:14px;line-height:1.35;box-shadow:0 4px 14px rgba(0,0,0,.6);width:300px";
    const lines = [];
    const res = (t) => `<span style="display:inline-block;border:1.5px solid ${INK};border-radius:6px;padding:0 6px;margin-left:6px;font-weight:700">${RESULT_TEXT[t]}</span>`;
    if (e.kind === "battle") {
      const who = e.me !== null ? `${e.me} 名對 ${e.foe} 名；` : "";
      lines.push(`<b>團戰 ${clock(e.t0)}–${clock(e.t1)}</b>　${e.place}`);
      lines.push(`${who}我死 ${e.me_dead}、敵死 ${e.foe_dead}${res(e.result)}`);
      for (const a of e.attacks) lines.push(`<span style="opacity:.85">敵 ${a.foe} 名來攻 ${clock(a.t0)}</span>${res(a.result)}`);
    } else {
      const a = e.attacks[0];
      lines.push(`<b>電腦進攻 ${clock(a.t0)}${a.t1 > a.t0 ? "–" + clock(a.t1) : ""}</b>　${a.place}`);
      lines.push(`敵 ${a.foe} 名；敵死 ${a.foe_dead}、我死 ${a.me_dead}${res(a.result)}`);
    }
    c.innerHTML = lines.map((l) => `<div>${l}</div>`).join("") +
      `<div style="display:flex;gap:8px;align-items:center;margin-top:5px"><button class="b secondary" style="min-height:44px;padding:0 12px">‹ 上一件</button>` +
      `<span style="flex:1;text-align:center;font-weight:700">${n} / ${of}</span><button class="b secondary" style="min-height:44px;padding:0 12px">下一件 ›</button>` +
      `<button class="b secondary" aria-label="關閉" style="min-width:44px;min-height:44px">✕</button></div>`;
    box.appendChild(c);
    const w = 300, h = c.getBoundingClientRect().height;
    let x = anchor.x + 16 - br.left;
    if (anchor.x + 16 + w > br.right - 12) x = anchor.x - 16 - w - br.left;
    c.style.left = `${Math.max(8, x)}px`;
    c.style.top = `${Math.max(8, Math.min(br.height - h - 8, anchor.y - br.top - h / 2))}px`;
  }

  function onChart(ev, ticks, sel, strip) {
    const g0 = geom();
    const { svg, x1, x2, y0, top } = g0;
    defs(svg);
    const X = (t) => x1 + (t * 20 / ticks) * (x2 - x1);
    const list = events(ev);
    const g = s("g", { class: "r17-layer" }, svg);
    const pick = sel === null ? null : list[sel];
    if (!strip) {
      // A: the battles' spans over the plot, the attacks' marks along its top with a dashed line down
      for (const e of list) if (e.kind === "battle") span(g, e, X(e.t0), X(e.t1), top, y0 - top, e === pick);
      for (const p of points(list.filter((e) => e.attacks.length > 0), X)) {
        const x = (p.x0 + p.x1) / 2;
        for (const e of p.items) s("line", { x1: X(e.attacks[0].t0), x2: X(e.attacks[0].t0), y1: top + 12, y2: y0, stroke: "rgba(243,231,201,0.55)", "stroke-width": 1, "stroke-dasharray": "3 3" }, g);
        const on = pick !== null && p.items.includes(pick);
        if (p.items.length === 1) attackMark(g, p.items[0].attacks[0], x, top + 1, 11, on);
        else pill(g, x, top - 1, p.items.length, on);
      }
    }
    // the box the board outlines: the plot
    const mark = document.createElement("div");
    mark.className = "r17-mark";
    mark.style.cssText = `position:fixed;pointer-events:none;left:${g0.rect.left + x1}px;top:${g0.rect.top + top - 14}px;width:${x2 - x1}px;height:${y0 - top + 14}px`;
    if (!strip) document.body.appendChild(mark);
    let anchor = null;
    if (pick !== null) {
      const xa = X(pick.t0), xb = X(pick.t1);
      anchor = { x: g0.rect.left + (pick.kind === "battle" ? (xa + xb) / 2 : xa), y: g0.rect.top + top + 40 };
    }
    return { X, list, anchor, g0 };
  }

  function stripUnder(ev, ticks, sel) {
    // C: a strip under the chart (in the room the moments' key row was given, r17.mjs): two lanes on the plot's time,
    // the attacks' marks above, the battles' spans below; the chart's lines untouched
    const { X, list, g0 } = onChart(ev, ticks, sel, true);
    const key = document.querySelector(".st-mkey");
    const kr = key.getBoundingClientRect();
    const host = document.createElement("div");
    host.className = "r17-strip r17-mark";
    const left = g0.rect.left;
    host.style.cssText = `position:fixed;left:${left}px;top:${kr.top + 2}px;width:${g0.rect.width}px;height:28px`;
    const sv = document.createElementNS(NS, "svg");
    sv.setAttribute("width", g0.rect.width); sv.setAttribute("height", 28);
    defs(sv);
    s("rect", { x: g0.x1 - 2, y: 0.5, width: g0.x2 - g0.x1 + 4, height: 27, rx: 4, fill: "rgba(0,0,0,0.28)", stroke: "rgba(243,231,201,0.25)" }, sv);
    const lab = s("text", { x: g0.x1 - 8, y: 18, "text-anchor": "end", "font-size": 12, "font-weight": 700, fill: INK }, sv);
    lab.textContent = "戰事";
    const pick = sel === null ? null : list[sel];
    for (const e of list) if (e.kind === "battle") span(sv, e, X(e.t0), X(e.t1), 15, 10, e === pick);
    for (const p of points(list.filter((e) => e.attacks.length > 0), X)) {
      const x = (p.x0 + p.x1) / 2;
      const on = pick !== null && p.items.includes(pick);
      if (p.items.length === 1) attackMark(sv, p.items[0].attacks[0], x, 2, 11, on);
      else pill(sv, x, 0, p.items.length, on);
    }
    if (pick !== null) {
      const gl = s("g", {}, g0.svg);
      const xa = X(pick.t0), xb = Math.max(X(pick.t1), xa + 2);
      s("rect", { x: xa, y: g0.top, width: xb - xa, height: g0.y0 - g0.top, fill: "rgba(231,195,90,0.18)", stroke: GOLD, "stroke-width": 1.5 }, gl);
    }
    host.appendChild(sv);
    document.body.appendChild(host);
    const anchor = pick === null ? null : { x: left + (X(pick.t0) + X(pick.t1)) / 2, y: g0.rect.top + g0.top + 40 };
    return { list, anchor };
  }

  function listView(ev, sel) {
    // B: 戰鬥 → 戰事: every attack and battle a row, the page scrolling (its ⌄ as 總覽's)
    const p = document.querySelector(".st-page");
    const list = events(ev);
    const ctl = p.querySelector(".st-ctl");
    ctl.querySelector("h3").textContent = `戰事（進攻 ${ev.attacks.length}、團戰 ${ev.battles.length}）`;
    const seg = document.createElement("div");
    seg.className = "st-seg r17-mark";
    seg.innerHTML = '<button class="b" type="button">兵種</button><button class="b pri" type="button">戰事</button>';
    ctl.appendChild(seg);
    for (const e of [...p.children]) if (e !== ctl && !e.classList.contains("st-more")) e.remove();
    const box = document.createElement("div");
    box.className = "r17-list r17-mark";
    box.style.cssText = "display:flex;flex-direction:column;gap:3px;font-size:14px";
    const res = (t) => `<span style="display:inline-block;min-width:66px;text-align:center;border:1.5px solid ${INK};border-radius:6px;padding:0 4px;font-weight:700">${RESULT_TEXT[t]}</span>`;
    list.forEach((e, i) => {
      const r = document.createElement("div");
      const on = i === sel;
      r.style.cssText = `display:grid;grid-template-columns:22px 92px 132px 1fr auto;align-items:center;gap:8px;min-height:44px;padding:0 8px;border-radius:7px;` +
        `background:${on ? "rgba(231,195,90,0.22)" : "rgba(0,0,0,0.22)"};border:1px solid ${on ? GOLD : "rgba(243,231,201,0.15)"}`;
      const icon = document.createElementNS(NS, "svg");
      icon.setAttribute("width", 18); icon.setAttribute("height", 14);
      defs(icon);
      if (e.kind === "battle") span(icon, e, 1, 17, 2, 10); else attackMark(icon, e.attacks[0], 9, 1, 12);
      let what, nums;
      if (e.kind === "battle") {
        what = `團戰　${e.place}`;
        nums = `${e.me !== null ? `${e.me} 名對 ${e.foe} 名　` : ""}我死 ${e.me_dead}、敵死 ${e.foe_dead}` +
          e.attacks.map((a) => `<div style="opacity:.8;font-size:12.5px">敵 ${a.foe} 名來攻，${RESULT_TEXT[a.result]}</div>`).join("");
      } else {
        const a = e.attacks[0];
        what = `進攻　${a.place}`;
        nums = `敵 ${a.foe} 名　敵死 ${a.foe_dead}、我死 ${a.me_dead}`;
      }
      r.innerHTML = `${icon.outerHTML}<span style="font-variant-numeric:tabular-nums;font-weight:700">${clock(e.t0)}–${clock(e.t1)}</span><span style="white-space:nowrap">${what}</span><span>${nums}</span>` +
        res(e.kind === "battle" ? e.result : e.attacks[0].result);
      box.appendChild(r);
    });
    p.insertBefore(box, p.querySelector(".st-more"));
    // the list scrolls under its title (the title and 兵種｜戰事 stay); the page's fade and ⌄ at its foot
    p.style.overflow = "hidden";
    box.style.overflowY = "auto";
    box.style.height = `${p.clientHeight - ctl.offsetHeight - 6}px`;
    p.classList.add("has-more");
    const more = p.querySelector(".st-more");
    if (more) more.hidden = false;
    if (sel !== null) box.scrollTop = Math.max(0, box.children[sel].offsetTop - box.offsetTop - box.clientHeight / 2 + 22);
  }

  window.R17 = {
    events,
    draw(opt, ev, ticks, sel) {
      if (opt === "A") {
        keyRow();
        const r = onChart(ev, ticks, sel, false);
        if (r.anchor) card(r.list[sel], sel + 1, r.list.length, r.anchor);
      } else if (opt === "C") {
        keyRow();
        const r = stripUnder(ev, ticks, sel);
        if (r.anchor) card(r.list[sel], sel + 1, r.list.length, r.anchor);
      } else if (opt === "B-list") {
        listView(ev, sel);
      } else if (opt === "B-jump") {
        const r = stripUnder.call(null, ev, ticks, sel);
        document.querySelectorAll(".r17-strip").forEach((e) => e.remove());
        if (r.anchor) card(r.list[sel], sel + 1, r.list.length, r.anchor);
      }
      return [...document.querySelectorAll(".r17-mark")].map((e) => { const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; });
    },
  };
})();
