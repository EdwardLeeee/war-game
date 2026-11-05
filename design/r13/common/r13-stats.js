// R13-02 局後統計 (D-124, GDD §14): the result screen, won or lost, with what happened. Two layouts:
//   A 分頁: tabs down the left (總覽、資源、兵力、戰鬥、城鎮、法師), one chart a page.
//   B 一頁捲動: one page that scrolls, the header (result, 重來, 回開局畫面) stays at the top.
// Fake data, but within the game's rules (sim/src/core/rules.ts: costs, MAGE_CAP 6, POPULATION_200 on = base 200, towns 1 small 1 big
// plundered once a game; GDD §14). States R13-02-<A|B>-<n>.
// Charts (the dataviz skill): one axis each; ours #2e6ed6 solid with round markers, theirs #c8302c dashed with square markers, both
// directly labelled at the end and in a legend; validated on the card's surface #221810 (validate_palette.js: all pass); text in ink.
"use strict";
(() => {
  const S = window.R6_STATES;
  const B = (label, o) => btn(label, o);
  const C = { me: "#2e6ed6", foe: "#c8302c", neutral: "#9b958a", ruin: "#6d6258", surface: "#221810", ink: "#f4e7c9", ink2: "#d8c49c", muted: "#b8ab92", grid: "rgba(216,196,156,.17)" };
  const MIN = 60;
  const fmt = (n) => Math.round(n).toLocaleString("en-US");
  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

  // ---- a game: rates (a minute, at knots in minutes) summed every 15 s, plus what a 搶 brings at once
  const lerp = (knots, m) => {
    if (m <= knots[0][0]) return knots[0][1];
    for (let i = 1; i < knots.length; i++) if (m <= knots[i][0]) { const [a, va] = knots[i - 1], [b, vb] = knots[i]; return va + (vb - va) * (m - a) / (b - a); }
    return knots[knots.length - 1][1];
  };
  const cum = (knots, jumps, dur) => {
    const pts = [[0, 0]];
    let v = 0;
    for (let t = 15; t <= dur + 14; t += 15) {
      const tt = Math.min(t, dur);
      v += lerp(knots, (tt - 7.5) / MIN) * (tt - pts[pts.length - 1][0]) / MIN;
      for (const [m, j] of jumps) if (m * MIN > pts[pts.length - 1][0] && m * MIN <= tt) v += j;
      pts.push([tt, v]);
      if (tt === dur) break;
    }
    return pts;
  };
  const curve = (knots, dur) => { const pts = []; for (let t = 0; t <= dur; t += 10) pts.push([t, lerp(knots, t / MIN)]); if (pts[pts.length - 1][0] !== dur) pts.push([dur, lerp(knots, dur / MIN)]); return pts; };
  const KINDS = ["村民", "槍兵", "遠程兵", "法師", "騎兵", "攻城砲"];

  function game(d) {
    const dur = d.dur;
    const res = {};
    for (const k of ["food", "wood", "gold", "crys"]) res[k] = { me: cum(d.me[k], d.me.jumps?.[k] || [], dur), foe: cum(d.foe[k], d.foe.jumps?.[k] || [], dur) };
    return { ...d, res, army: { me: curve(d.me.army, dur), foe: curve(d.foe.army, dur) } };
  }
  const last = (pts) => pts[pts.length - 1][1];
  const peak = (pts) => pts.reduce((a, p) => (p[1] > a[1] ? p : a), [0, -1]);

  const WIN = game({
    won: true, dur: 26 * MIN + 40, reason: "敵方主城被摧毀", foeName: "電腦（困難・掠奪型）", map: "雙河關",
    me: {
      food: [[0, 120], [3, 220], [6, 330], [10, 460], [12, 470], [12.2, 300], [13, 470], [18, 560], [18.6, 420], [20, 540], [26.7, 560]],
      wood: [[0, 80], [3, 200], [6, 300], [10, 360], [12, 360], [12.2, 250], [13, 380], [18, 400], [26.7, 420]],
      gold: [[0, 0], [4, 40], [7, 150], [10, 220], [12, 220], [12.2, 150], [13, 240], [18, 260], [26.7, 290]],
      crys: [[0, 0], [6, 0], [7.6, 10], [12, 16], [14.8, 16], [15, 10], [15.6, 10], [15.8, 4], [20, 4], [20.2, 34], [22.9, 34], [23.1, 42], [26.7, 42]],
      jumps: { food: [[21, 300]], gold: [[21, 250]], crys: [[21, 60]] },
      army: [[0, 0], [4, 2], [6, 8], [8.2, 18], [8.5, 15], [12, 32], [15, 46], [18.4, 58], [18.8, 31], [21, 40], [23, 52], [24.2, 50], [26.67, 44]],
    },
    foe: {
      food: [[0, 130], [3, 240], [6, 360], [10, 500], [15, 560], [18.4, 600], [18.7, 380], [22, 300], [24.2, 220], [26.7, 120]],
      wood: [[0, 90], [3, 210], [6, 320], [10, 380], [15, 420], [18.4, 430], [18.7, 300], [22, 240], [26.7, 110]],
      gold: [[0, 0], [4, 60], [7, 180], [10, 250], [15, 290], [18.4, 300], [18.7, 200], [22, 160], [26.7, 80]],
      crys: [[0, 0], [5, 0], [6.2, 10], [10.6, 10], [10.8, 40], [19, 40], [19.1, 12], [21, 12], [21.1, 3], [26.7, 3]],
      jumps: { food: [[15.7, 300]], gold: [[15.7, 250]], crys: [[15.7, 60]] },
      army: [[0, 0], [4, 4], [6, 12], [8.2, 24], [8.5, 15], [12, 38], [12.3, 33], [15, 55], [18.4, 71], [18.8, 19], [21, 30], [23, 26], [24.5, 14], [26.67, 6]],
    },
    moments: [
      [8 * MIN + 20, "第一次進攻", "敵方 14 名到小鎮・東，擋下來（敵死 9、我死 3）"],
      [12 * MIN + 5, "主城第一次被打", "敵方騎兵 8 名繞到主城，村民躲進去（死 6）"],
      [18 * MIN + 30, "大仗", "大城・中外：58 名對 71 名，我死 27、敵死 52"],
      [24 * MIN + 10, "攻進敵方主城", "我方 50 名到敵方主城下"],
    ],
    losses: [[9, 22], [24, 31], [15, 27], [3, 5], [6, 14], [1, 3]],   // [我方死, 敵方死] by KINDS
    trained: [[52, 58], [38, 44], [26, 30], [6, 7], [10, 16], [2, 3]],
    towns: { me: [1, 4, 1], foe: [1, 2, 0] },                            // 搶, 治理, 叛離
    mages: { me: { trained: 6, lost: 3, shots: 41, kills: 37, best: "5 名（18:34）" }, foe: { trained: 7, lost: 5, shots: 29, kills: 21, best: "4 名（18:31）" } },
    townRows: [
      { name: "小鎮・東", note: "我方附近", segs: [[0, 410, "neutral"], [410, 455, "repair", "me"], [455, 940, "gov", "me", "我方治理"], [940, 955, "plunder", "foe"], [955, 1195, "ruin", null, "廢墟"],
        [1195, 1330, "neutral"], [1330, 1375, "repair", "me"], [1375, 1600, "gov", "me", "我方治理"]], events: [[410, "治", "me"], [940, "搶", "foe"], [1330, "治", "me"]] },
      { name: "小鎮・南", segs: [[0, 680, "neutral", null, "中立"], [680, 725, "repair", "me"], [725, 890, "gov", "me", "我方"], [890, 1600, "neutral", null, "中立"]], events: [[680, "治", "me"], [890, "叛", "me"]] },
      { name: "大城・中", segs: [[0, 580, "neutral", null, "中立"], [580, 640, "repair", "foe"], [640, 1145, "gov", "foe", "敵方治理"], [1145, 1205, "repair", "me"], [1205, 1600, "gov", "me", "我方治理"]],
        events: [[580, "治", "foe"], [1145, "治", "me"]] },
      { name: "小鎮・西", note: "敵方附近", segs: [[0, 330, "neutral", null, "中立"], [330, 375, "repair", "foe"], [375, 1260, "gov", "foe", "敵方治理"], [1260, 1275, "plunder", "me"], [1275, 1515, "ruin", null, "廢墟"], [1515, 1600, "neutral"]],
        events: [[330, "治", "foe"], [1260, "搶", "me"]] },
    ],
  });
  const LOSS = game({
    won: false, dur: 23 * MIN + 15, reason: "我方主城被摧毀", foeName: "電腦（困難・均衡型）", map: "固定地圖",
    me: {
      food: [[0, 120], [3, 210], [6, 320], [10, 420], [10.5, 260], [11.5, 400], [16, 430], [16.5, 260], [21.6, 240], [22, 80], [23.3, 40]],
      wood: [[0, 80], [3, 190], [6, 290], [10, 330], [10.5, 220], [11.5, 330], [16, 350], [16.5, 220], [21.6, 200], [23.3, 40]],
      gold: [[0, 0], [4, 40], [7, 140], [10, 190], [16, 220], [16.5, 120], [23.3, 60]],
      crys: [[0, 0], [8, 0], [9, 8], [16, 8], [16.4, 0], [23.3, 0]],
      army: [[0, 0], [4, 3], [6, 10], [7, 16], [7.3, 9], [10, 22], [10.6, 18], [14, 36], [16.2, 44], [16.6, 12], [19, 20], [21.6, 22], [22.4, 8], [23.25, 3]],
    },
    foe: {
      food: [[0, 130], [3, 240], [6, 350], [10, 480], [16, 560], [23.3, 590]],
      wood: [[0, 90], [3, 210], [6, 320], [10, 380], [16, 420], [23.3, 440]],
      gold: [[0, 0], [4, 60], [7, 170], [10, 240], [16, 300], [23.3, 320]],
      crys: [[0, 0], [5, 0], [6, 10], [9.8, 10], [10, 38], [23.3, 48]],
      jumps: { food: [[13.4, 300]], gold: [[13.4, 250]], crys: [[13.4, 60]] },
      army: [[0, 0], [4, 4], [6, 12], [7.2, 20], [7.4, 19], [10.4, 30], [10.8, 26], [14, 50], [16.2, 63], [16.6, 42], [19, 58], [21.6, 66], [23.25, 61]],
    },
    moments: [
      [7 * MIN + 10, "第一次進攻", "我方 16 名到小鎮・西，被打退（我死 7）"],
      [10 * MIN + 30, "主城第一次被打", "敵方騎兵 6 名繞到主城（村民死 9）"],
      [16 * MIN + 20, "大仗", "主城外：44 名對 63 名，我死 32、敵死 21"],
      [21 * MIN + 40, "敵方攻進主城", "敵方 66 名、攻城砲 3 門到主城下"],
    ],
    losses: [[31, 6], [29, 22], [21, 14], [4, 2], [5, 9], [0, 1]],
    trained: [[44, 50], [34, 48], [24, 30], [5, 6], [7, 14], [0, 3]],
    towns: { me: [0, 1, 1], foe: [1, 3, 0] },
    mages: { me: { trained: 5, lost: 4, shots: 22, kills: 14, best: "3 名（16:24）" }, foe: { trained: 6, lost: 2, shots: 35, kills: 33, best: "6 名（16:22）" } },
    townRows: [],
  });

  // ---- charts (SVG, 1 unit = 1 pt)
  const T12 = 'font-size="12"', T13 = 'font-size="13"';
  const marker = (who, x, y, r = 4.5) => who === "me"
    ? `<circle cx="${x}" cy="${y}" r="${r}" fill="${C.me}" stroke="${C.surface}" stroke-width="2"/>`
    : `<rect x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" fill="${C.foe}" stroke="${C.surface}" stroke-width="2"/>`;
  const keyLine = (who) => `<svg width="30" height="12" viewBox="0 0 30 12" class="key"><line x1="1" y1="6" x2="29" y2="6" stroke="${C[who]}" stroke-width="2" ${who === "foe" ? 'stroke-dasharray="6 4"' : ""} stroke-linecap="round"/>${marker(who, 15, 6, 4)}</svg>`;
  const legend = (a = "我方", b = "敵方") => `<span class="lg">${keyLine("me")}${a}</span><span class="lg">${keyLine("foe")}${b}</span>`;
  const niceStep = (max, n = 4) => { const raw = max / n, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; };

  function lineChart({ w, h, dur, series, moments, unit = "", peakLabel = false }) {
    const L = 46, R = 92, Tp = 24, Bt = 24, pw = w - L - R, ph = h - Tp - Bt;
    const ymax0 = Math.max(...series.flatMap((s) => s.pts.map((p) => p[1])));
    const step = niceStep(ymax0), ymax = Math.ceil(ymax0 / step) * step;
    const X = (t) => L + (t / dur) * pw, Y = (v) => Tp + ph - (v / ymax) * ph;
    const g = [];
    for (let v = 0; v <= ymax + 0.1; v += step) g.push(`<line x1="${L}" x2="${L + pw}" y1="${Y(v)}" y2="${Y(v)}" stroke="${C.grid}" stroke-width="1"/>` +
      `<text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" ${T12} fill="${C.muted}" class="num">${fmt(v)}</text>`);
    for (let m = 0; m * MIN <= dur; m += 5) g.push(`<text x="${X(m * MIN)}" y="${h - 6}" text-anchor="middle" ${T12} fill="${C.muted}" class="num">${m}:00</text>`);
    g.push(`<line x1="${L}" x2="${L + pw}" y1="${Y(0)}" y2="${Y(0)}" stroke="rgba(216,196,156,.4)" stroke-width="1"/>`);
    (moments || []).forEach(([t], i) => g.push(`<line x1="${X(t)}" x2="${X(t)}" y1="${Tp - 2}" y2="${Y(0)}" stroke="rgba(244,231,201,.32)" stroke-width="1"/>` +
      `<circle cx="${X(t)}" cy="${Tp - 11}" r="9" fill="#3a2a1a" stroke="${C.ink2}" stroke-width="1.2"/><text x="${X(t)}" y="${Tp - 7}" text-anchor="middle" ${T12} font-weight="700" fill="${C.ink}">${i + 1}</text>`));
    const ends = [];
    for (const s of series) {
      const d = s.pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join("");
      g.push(`<path d="${d}" fill="none" stroke="${C[s.who]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" ${s.who === "foe" ? 'stroke-dasharray="6 4"' : ""}/>`);
      const [lt, lv] = s.pts[s.pts.length - 1];
      g.push(marker(s.who, X(lt), Y(lv)));
      ends.push({ who: s.who, y: Y(lv), y0: Y(lv), text: `${s.name} ${fmt(lv)}${unit}` });
      if (peakLabel) {
        const [pt, pv] = peak(s.pts);
        if (pt < s.pts[s.pts.length - 1][0] - 30) g.push(marker(s.who, X(pt), Y(pv), 3.5) + `<text x="${X(pt) + (s.who === "me" ? -8 : 8)}" y="${Y(pv) - 8}" text-anchor="${s.who === "me" ? "end" : "start"}" ${T12} fill="${C.ink}" font-weight="700">最多 ${fmt(pv)}</text>`);
      }
    }
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 17) { const mid = (ends[i].y + ends[i - 1].y) / 2; ends[i - 1].y = mid - 8.5; ends[i].y = mid + 8.5; }
    for (const e of ends) {
      if (Math.abs(e.y - e.y0) > 2) g.push(`<path d="M${L + pw + 6} ${e.y0} L${L + pw + 10} ${e.y}" stroke="${C.ink2}" stroke-width="1" fill="none"/>`);
      g.push(`<text x="${L + pw + 12}" y="${e.y + 4.5}" ${T13} font-weight="700" fill="${C.ink}" class="num">${e.text}</text>`);
    }
    return `<svg class="chart" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${g.join("")}</svg>`;
  }
  const momentKey = (g, cls = "") => `<div class="mkey ${cls}">${g.moments.map(([t, k], i) => `<span><i>${i + 1}</i>${k} ${clock(t)}</span>`).join("")}</div>`;

  function butterfly({ w, h, rows }) {
    const mid = w / 2, lab = 34, gap = 8, rowH = Math.min(34, (h - 8) / rows.length), bar = 16;
    const max = Math.max(...rows.flat()), half = mid - lab - gap - 34;
    const g = [];
    rows.forEach(([a, b], i) => {
      const y = 4 + i * rowH + rowH / 2;
      g.push(`<text x="${mid}" y="${y + 4.5}" text-anchor="middle" ${T13} font-weight="700" fill="${C.ink}">${KINDS[i]}</text>`);
      const la = (a / max) * half, lb = (b / max) * half;
      const x0 = mid - lab - gap, x1 = mid + lab + gap;
      if (a > 0) g.push(`<path d="M${x0} ${y - bar / 2} H${x0 - la + 4} q-4 0 -4 4 V${y + bar / 2 - 4} q0 4 4 4 H${x0} Z" fill="${C.me}"/>`);
      if (b > 0) g.push(`<path d="M${x1} ${y - bar / 2} H${x1 + lb - 4} q4 0 4 4 V${y + bar / 2 - 4} q0 4 -4 4 H${x1} Z" fill="${C.foe}"/>`);
      g.push(`<text x="${x0 - la - 6}" y="${y + 4.5}" text-anchor="end" ${T13} fill="${C.ink}" class="num">${a}</text>`);
      g.push(`<text x="${x1 + lb + 6}" y="${y + 4.5}" ${T13} fill="${C.ink}" class="num">${b}</text>`);
    });
    g.push(`<line x1="${mid - lab - gap}" x2="${mid - lab - gap}" y1="2" y2="${h - 2}" stroke="rgba(216,196,156,.4)"/><line x1="${mid + lab + gap}" x2="${mid + lab + gap}" y1="2" y2="${h - 2}" stroke="rgba(216,196,156,.4)"/>`);
    return `<svg class="chart" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${g.join("")}</svg>`;
  }

  function towns({ w, h, rows, dur, moments }) {
    const L = 78, R = 10, Tp = 24, Bt = 22, pw = w - L - R, rowH = (h - Tp - Bt) / rows.length, bh = Math.min(22, rowH - 16);
    const X = (t) => L + (t / dur) * pw;
    const g = [`<defs><pattern id="ruin" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="${C.ruin}"/><line x1="0" y1="0" x2="0" y2="6" stroke="#4a4038" stroke-width="3"/></pattern></defs>`];
    for (let m = 0; m * MIN <= dur; m += 5) g.push(`<line x1="${X(m * MIN)}" x2="${X(m * MIN)}" y1="${Tp - 4}" y2="${h - Bt}" stroke="${C.grid}"/><text x="${X(m * MIN)}" y="${h - 6}" text-anchor="middle" ${T12} fill="${C.muted}" class="num">${m}:00</text>`);
    (moments || []).forEach(([t], i) => g.push(`<line x1="${X(t)}" x2="${X(t)}" y1="${Tp - 2}" y2="${h - Bt}" stroke="rgba(244,231,201,.3)"/>` +
      `<circle cx="${X(t)}" cy="${Tp - 11}" r="9" fill="#3a2a1a" stroke="${C.ink2}" stroke-width="1.2"/><text x="${X(t)}" y="${Tp - 7}" text-anchor="middle" ${T12} font-weight="700" fill="${C.ink}">${i + 1}</text>`));
    rows.forEach((r, i) => {
      const y = Tp + i * rowH + (rowH - bh) / 2 + 4;
      g.push(`<text x="0" y="${y + bh / 2 + 1}" ${T13} font-weight="700" fill="${C.ink}">${r.name}</text>` + (r.note ? `<text x="0" y="${y + bh / 2 + 15}" ${T12} fill="${C.muted}">${r.note}</text>` : ""));
      for (const [a, b0, kind, who, label] of r.segs) {
        const b = Math.min(b0, dur), x = X(a) + 1, ww = Math.max(0, X(b) - X(a) - 2);
        const fill = kind === "neutral" ? "rgba(155,149,138,.35)" : kind === "ruin" ? "url(#ruin)" : kind === "repair" ? (who === "me" ? "rgba(46,110,214,.5)" : "rgba(200,48,44,.5)") : C[who];
        g.push(`<rect x="${x}" y="${y}" width="${ww}" height="${bh}" rx="3" fill="${fill}"/>`);
        if (label && ww > label.length * 13 + 10) g.push(`<text x="${x + 6}" y="${y + bh / 2 + 4.5}" ${T12} font-weight="700" fill="${kind === "neutral" ? C.ink2 : "#fff"}">${label}</text>`);
      }
      for (const [t, k, who] of r.events) g.push(`<g transform="translate(${X(t)} ${y - 1})"><circle r="10" fill="#1a120b" stroke="${C[who]}" stroke-width="2.5"/><text y="4.5" text-anchor="middle" ${T12} font-weight="700" fill="${C.ink}">${k}</text></g>`);
    });
    return `<svg class="chart" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${g.join("")}</svg>`;
  }
  const townLegend = `<span class="lg"><i class="sw" style="background:${C.me}"></i>我方</span><span class="lg"><i class="sw" style="background:${C.foe}"></i>敵方</span>` +
    `<span class="lg"><i class="sw" style="background:rgba(155,149,138,.35)"></i>中立</span><span class="lg"><i class="sw ruin"></i>廢墟</span><span class="lg"><i class="sw" style="background:rgba(46,110,214,.5)"></i>修繕中（淡色）</span>` +
    `<span class="lg"><i class="ev">治</i>治理</span><span class="lg"><i class="ev">搶</i>搶</span><span class="lg"><i class="ev">叛</i>叛離</span><span class="lg muted">圓圈的框色＝誰做的</span>`;

  // ---- the pieces of a page
  const RES = { food: "糧", wood: "木", gold: "金", crys: "魔晶" };
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const head = (g) => `<div class="sthead"><div class="res-word ${g.won ? "won" : "lost"}">${g.won ? "勝利" : "失敗"}</div>
    <div class="why"><b>${g.reason}</b>　遊戲時間 ${clock(g.dur)}<small>對手：${g.foeName}　地圖：${g.map}</small></div>
    <div class="go">${B("回開局畫面", { cls: "sec" })}${B("重來", { cls: "pri" })}</div></div>`;
  const tiles = (g) => {
    const kill = sum(g.losses.map((r) => r[1])), lost = sum(g.losses.map((r) => r[0]));
    return `<div class="tiles"><div class="tile"><span class="tl">我方擊殺</span><span class="tv">${kill}</span></div><div class="tile"><span class="tl">我方損失</span><span class="tv">${lost}</span></div>
      <div class="tile"><span class="tl">我方城鎮</span><span class="tv sm">搶 ${g.towns.me[0]}・治理 ${g.towns.me[1]}</span></div><div class="tile"><span class="tl">晶砲擊殺</span><span class="tv">${g.mages.me.kills}</span></div></div>`;
  };
  const moments = (g) => `<ol class="moments">${g.moments.map(([t, k, d], i) => `<li><span class="mt"><i>${i + 1}</i>${clock(t)}</span><span class="ev"><b>${k}</b>${d}</span></li>`).join("")}
    <li><span class="mt end">${clock(g.dur)}</span><span class="ev"><b>${g.reason}</b>${g.won ? "我方勝利" : "我方落敗"}</span></li></ol>`;
  const numbers = (g) => {
    const r = (k, a, b) => `<tr><th>${k}</th><td>${a}</td><td>${b}</td></tr>`;
    const R = (k, w) => fmt(last(g.res[k][w]));
    return `<table class="nums"><tr><th></th><th>${keyLine("me")}我方</th><th>${keyLine("foe")}敵方</th></tr>` +
      r("採集 糧・木", `${R("food", "me")}・${R("wood", "me")}`, `${R("food", "foe")}・${R("wood", "foe")}`) +
      r("採集 金・魔晶", `${R("gold", "me")}・${R("crys", "me")}`, `${R("gold", "foe")}・${R("crys", "foe")}`) +
      r("訓練（不含村民）", sum(g.trained.slice(1).map((x) => x[0])), sum(g.trained.slice(1).map((x) => x[1]))) +
      r("損失（含村民）", sum(g.losses.map((x) => x[0])), sum(g.losses.map((x) => x[1]))) +
      r("法師（訓練／陣亡）", `${g.mages.me.trained}／${g.mages.me.lost}`, `${g.mages.foe.trained}／${g.mages.foe.lost}`) +
      r("城鎮（搶／治理／叛離）", g.towns.me.join("／"), g.towns.foe.join("／")) +
      r("攻城砲（訓練／損失）", `${g.trained[5][0]}／${g.losses[5][0]}`, `${g.trained[5][1]}／${g.losses[5][1]}`) + `</table>`;
  };
  const switcher = (on) => `<div class="seg" role="group" aria-label="資源">${Object.entries(RES).map(([k, n]) => B(n, { cls: `sec ${k === on ? "on" : ""}`, state: k === on ? "active" : "" })).join("")}</div>`;
  const resChart = (g, k, w, h) => lineChart({ w, h, dur: g.dur, moments: g.moments, series: [{ who: "me", name: "我方", pts: g.res[k].me }, { who: "foe", name: "敵方", pts: g.res[k].foe }] });
  const armyChart = (g, w, h) => lineChart({ w, h, dur: g.dur, moments: g.moments, peakLabel: true, unit: " 名", series: [{ who: "me", name: "我方", pts: g.army.me }, { who: "foe", name: "敵方", pts: g.army.foe }] });
  const killHead = (g) => `<div class="bfhead"><span>${keyLine("me")}我方損失 <b>${sum(g.losses.map((r) => r[0]))}</b></span><span class="c">兵種</span><span>我方擊殺 <b>${sum(g.losses.map((r) => r[1]))}</b>${keyLine("foe")}</span></div>`;
  const mageTiles = (g) => {
    const row = (k, a, b) => `<div class="mr"><span class="mk">${k}</span><span class="mv">${a}</span><span class="mv">${b}</span></div>`;
    const m = g.mages;
    return `<div class="mages"><div class="mr mh"><span></span><span>${keyLine("me")}我方</span><span>${keyLine("foe")}敵方</span></div>` +
      row("訓練", m.me.trained, m.foe.trained) + row("陣亡", m.me.lost, m.foe.lost) + row("晶砲發數", m.me.shots, m.foe.shots) +
      row("晶砲擊殺", m.me.kills, m.foe.kills) + row("一發最多", m.me.best.replace("（", '<small>（').replace("）", "）</small>"), m.foe.best.replace("（", '<small>（').replace("）", "）</small>")) + `</div>`;
  };

  // ---- A 分頁
  const TABS = ["總覽", "資源", "兵力", "戰鬥", "城鎮", "法師"];
  function pageA(g, tab, res = "food") {
    const W = 688, body = {
      總覽: `<div class="two"><div class="col"><h3>關鍵時刻</h3>${moments(g)}</div><div class="col"><h3>雙方數字</h3>${numbers(g)}</div></div>`,
      資源: `<div class="ctl"><h3>累計採集：${RES[res]}</h3>${switcher(res)}</div><div class="card">${legend()}${resChart(g, res, W - 16, 212)}</div>${momentKey(g)}`,
      兵力: `<div class="ctl"><h3>士兵數（不含村民）</h3></div><div class="card">${legend()}${armyChart(g, W - 16, 212)}</div>${momentKey(g)}`,
      戰鬥: `<div class="ctl"><h3>擊殺與損失（各兵種）</h3></div><div class="card">${killHead(g)}${butterfly({ w: W - 16, h: 214, rows: g.losses })}</div>`,
      城鎮: `<div class="ctl"><h3>城鎮易手</h3></div><div class="card">${towns({ w: W - 16, h: 180, rows: g.townRows, dur: g.dur, moments: g.moments })}<div class="tlg">${townLegend}</div></div>${momentKey(g)}`,
      法師: `<div class="ctl"><h3>法師戰績</h3></div><div class="card">${mageTiles(g)}</div><p class="foot">${g.won ? "晶砲擊殺最多的一發：18:34 大仗，炸死敵方 5 名（槍兵 4、遠程兵 1）" : ""}</p>`,
    }[tab];
    return `<div class="r13stats A">${head(g)}<div class="tabs" role="tablist">${TABS.map((t) => `<button class="b tab ${t === tab ? "is-active" : "sec"}" role="tab">${t}</button>`).join("")}</div>
      <div class="page">${body}</div></div>`;
  }
  // ---- B 一頁捲動
  function pageB(g) {
    const half = 380;
    return `<div class="r13stats Bs">${head(g)}<div class="scroll"><div class="inner">
      <section><h3>關鍵時刻</h3><div class="strip">${strip(g, 776, 104)}</div>${tiles(g)}</section>
      <section class="pair"><div class="card"><div class="ctl"><h4>累計採集</h4>${switcher("food")}</div>${legend()}${resChart(g, "food", half - 12, 196)}</div>
        <div class="card"><div class="ctl"><h4>士兵數（不含村民）</h4></div>${legend()}${armyChart(g, half - 12, 196)}</div></section>
      ${momentKey(g, "wide")}
      <section class="pair"><div class="card"><div class="ctl"><h4>擊殺與損失（各兵種）</h4></div>${killHead(g)}${butterfly({ w: half - 12, h: 204, rows: g.losses })}</div>
        <div class="card"><div class="ctl"><h4>法師戰績</h4></div>${mageTiles(g)}</div></section>
      ${g.townRows.length ? `<section><div class="card"><div class="ctl"><h4>城鎮易手</h4></div>${towns({ w: 764, h: 196, rows: g.townRows, dur: g.dur, moments: g.moments })}<div class="tlg">${townLegend}</div></div></section>` : ""}
      <section><div class="card"><div class="ctl"><h4>雙方數字</h4></div>${numbers(g)}</div></section>
      <div class="endgo">${B("回開局畫面", { cls: "sec" })}${B("重來", { cls: "pri" })}</div>
    </div></div><div class="thumb"></div></div>`;
  }
  function strip(g, w, h) {
    const L = 14, R = 14, pw = w - L - R, X = (t) => L + (t / g.dur) * pw, y = 22;
    const out = [`<line x1="${L}" x2="${L + pw}" y1="${y}" y2="${y}" stroke="${C.ink2}" stroke-width="2"/>`];
    for (let m = 0; m * MIN <= g.dur; m += 5) out.push(`<line x1="${X(m * MIN)}" x2="${X(m * MIN)}" y1="${y - 4}" y2="${y + 4}" stroke="${C.ink2}"/><text x="${X(m * MIN)}" y="${y - 9}" text-anchor="middle" ${T12} fill="${C.muted}" class="num">${m}:00</text>`);
    const all = [...g.moments, [g.dur, g.reason, ""]];
    // labels on two rows (every other one lower, on a thin stem), so that close moments do not run into each other
    all.forEach(([t, k], i) => {
      const x = X(t), end = i === all.length - 1, low = i % 2 === 1 ? 34 : 0;
      if (low) out.push(`<line x1="${x}" x2="${x}" y1="${y + 9}" y2="${y + 15 + low}" stroke="${C.ink2}" stroke-width="1"/>`);
      out.push(`<circle cx="${x}" cy="${y}" r="9" fill="${end ? (g.won ? "#c9963a" : "#7a221a") : "#3a2a1a"}" stroke="${C.ink}" stroke-width="1.4"/><text x="${x}" y="${y + 4}" text-anchor="middle" ${T12} font-weight="700" fill="${C.ink}">${end ? "★" : i + 1}</text>`);
      const anchor = end ? "end" : t / g.dur < 0.08 ? "start" : "middle", tx = end ? x + 9 : x;
      out.push(`<text x="${tx}" y="${y + 29 + low}" text-anchor="${anchor}" ${T13} font-weight="700" fill="${C.ink}" paint-order="stroke" stroke="${C.surface}" stroke-width="4">${k}</text>` +
        `<text x="${tx}" y="${y + 45 + low}" text-anchor="${anchor}" ${T12} fill="${C.ink2}" class="num" paint-order="stroke" stroke="${C.surface}" stroke-width="4">${clock(t)}</text>`);
    });
    return `<svg class="chart" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${out.join("")}</svg>`;
  }

  PIECES.stats = (s) => {
    if (!s.stats) return;
    const g = s.stats.game === "loss" ? LOSS : WIN;
    add(s.stats.layout === "A" ? pageA(g, s.stats.tab, s.stats.res) : pageB(g));
  };
  ORDER.push("stats");

  // after the render: B's scroll position and its thumb; the full page (tall) for the board
  window.R13_AFTER = () => {
    const s = window.R6_STATES[new URLSearchParams(location.search).get("state")];
    const sc = document.querySelector(".r13stats .scroll");
    if (!sc) return;
    if (s?.stats?.tall) {
      const scr = document.getElementById("screen"), h = Math.ceil(sc.scrollHeight + sc.offsetTop + 8);
      scr.style.height = `${h}px`; sc.style.overflow = "visible"; sc.style.height = "auto"; document.querySelector(".r13stats").style.bottom = "auto"; document.querySelector(".r13stats").style.height = `${h - 8}px`;
      document.querySelector(".r13stats .thumb").style.display = "none";
      window.R13_SIZE = { width: 814, height: h };
      return;
    }
    // scroll: a section's number (its top at the top), or "end"
    const to = s?.stats?.scroll ?? 0, secs = sc.querySelectorAll("section");
    sc.scrollTop = to === "end" ? sc.scrollHeight : to === 0 ? 0 : secs[to].offsetTop - 6;
    const th = document.querySelector(".r13stats .thumb"), k = sc.clientHeight / sc.scrollHeight;
    th.style.height = `${Math.max(24, sc.clientHeight * k)}px`;
    th.style.top = `${sc.offsetTop + sc.scrollTop * k}px`;
  };
  window.R13_MEASURE = () => {
    const sc = document.querySelector(".r13stats .scroll");
    return sc ? { scrollTop: Math.round(sc.scrollTop), scrollHeight: sc.scrollHeight, view: sc.clientHeight } : null;
  };

  const ST = (o) => ({ only: ["field", "stats"], field: "r13-fall", sel: null, cmds: null, stats: o });
  // 0 現況: today's result dialog (R6-21 INV-130, the rows of client/src/ui/hud/hud.ts showResult; main adds 攻城砲 while siege is on)
  // with the same game's numbers as A and B; 訓練 and 損失 are what showResult sums (farmers, spearmen, ranged, mages: no cavalry)
  const now = S["INV-130"], g0 = WIN, R0 = (k, w) => fmt(last(g0.res[k][w]));
  const four = (i, j) => sum(g0[i].slice(0, 4).map((x) => x[j]));
  const row0 = (k, a, b) => `<tr><th>${k}</th><td>${a}</td><td>${b}</td></tr>`;
  const html0 = `<p class="reason">${g0.reason}　遊戲時間 ${clock(g0.dur)}</p><table><tr><th></th><th>我方</th><th>敵方</th></tr>` +
    row0("採集", ...["me", "foe"].map((w) => `糧 ${R0("food", w)}、木 ${R0("wood", w)}、金 ${R0("gold", w)}、魔晶 ${R0("crys", w)}`)) +
    row0("訓練", four("trained", 0), four("trained", 1)) + row0("損失", four("losses", 0), four("losses", 1)) +
    row0("法師（訓練／陣亡）", `${g0.mages.me.trained}／${g0.mages.me.lost}`, `${g0.mages.foe.trained}／${g0.mages.foe.lost}`) +
    row0("攻城砲（訓練／損失）", `${g0.trained[5][0]}／${g0.losses[5][0]}`, `${g0.trained[5][1]}／${g0.losses[5][1]}`) +
    row0("城鎮（搶／治理）", `${g0.towns.me[0]}／${g0.towns.me[1]}`, `${g0.towns.foe[0]}／${g0.towns.foe[1]}`) + `</table>` +
    `<div class="btns">${B("回開局畫面", { cls: "sec" })}${B("重來", { cls: "pri" })}</div>`;
  S["R13-02-0-1"] = { ...now, field: "r13-fall", res: { food: 640, wood: 410, gold: 380, crys: 45, pop: "64", cap: "98", time: "26:40" }, left: { idle: 0, map: "closed" },
    groups: [{ n: 1, sub: "12/12" }, { n: 2, sub: "6/6" }, { n: 3 }, { n: 4 }], army: 44, dialog: { ...now.dialog, html: html0 } };
  Object.assign(S, {
    "R13-02-A-1": ST({ layout: "A", tab: "總覽" }),
    "R13-02-A-2": ST({ layout: "A", tab: "資源", res: "food" }),
    "R13-02-A-3": ST({ layout: "A", tab: "資源", res: "crys" }),
    "R13-02-A-4": ST({ layout: "A", tab: "兵力" }),
    "R13-02-A-5": ST({ layout: "A", tab: "戰鬥" }),
    "R13-02-A-6": ST({ layout: "A", tab: "城鎮" }),
    "R13-02-A-7": ST({ layout: "A", tab: "法師" }),
    "R13-02-A-8": ST({ layout: "A", tab: "總覽", game: "loss" }),
    "R13-02-A-9": ST({ layout: "A", tab: "戰鬥", game: "loss" }),
    "R13-02-B-1": ST({ layout: "B", scroll: 0 }),
    "R13-02-B-2": ST({ layout: "B", scroll: 1 }),
    "R13-02-B-3": ST({ layout: "B", scroll: 2 }),
    "R13-02-B-4": ST({ layout: "B", scroll: 3 }),
    "R13-02-B-5": ST({ layout: "B", scroll: "end" }),
    "R13-02-B-6": ST({ layout: "B", scroll: 0, game: "loss" }),
    "R13-02-B-7": ST({ layout: "B", tall: true }),
  });
  window.R13_GAMES = { WIN, LOSS };
})();
