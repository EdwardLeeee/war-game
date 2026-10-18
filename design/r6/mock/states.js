// R6 B.3: every state the boards show, by id. INV-xx are design/r6/inventory.md's items; NEW-xx the items D-087 adds.
// A state is the base battlefield (one squad of ours selected) with some pieces changed (app.js PIECES).
"use strict";
(() => {
  const B = (label, o) => btn(label, o);
  const S = {
    base: { hp: true, sel: { kind: "units" }, cmds: "soldiers", left: { idle: 3, map: "closed" } },
    plain: { hp: false, field: "field-THEME-plain", sel: null, cmds: "none" },
  };
  // ----- R6-13 左邊（需要時才出現，D-087 C）
  Object.assign(S, {
    "INV-38": { left: { idle: 0, map: "closed" } },                          // 沒有閒置的村民：閒置鈕不出現
    "INV-39": { left: { idle: 3, map: "closed" } },                          // 有閒置的村民
    "INV-40": { left: { idle: 3, map: "open" } },                            // 地圖打開
    "INV-41": { left: { idle: 0, map: "open", minimap: "minimap-diamond-start" }, sel: null, cmds: "none", hp: false, field: "field-THEME-plain" },
    "INV-42": { left: { idle: 3, map: "open", minimap: "minimap-diamond-hit" }, arrows: [{ x: 600, y: 40, r: -90 }] },
    "INV-43": { left: { idle: 0, map: "open", minimap: "minimap-diamond-hint" }, sel: null, cmds: "none", hp: false, field: "field-THEME-plain" },
    "NEW-01": { left: { idle: 3, map: "closed" }, sel: null, cmds: "none", hp: false, field: "field-THEME-plain" },   // 地圖收著
    "NEW-02": { left: { idle: 3, map: "closed", recall: "hit" }, sel: null, cmds: "none", hp: false, field: "field-THEME-raid",
                arrows: [], toast: "家裡被攻擊：主城附近有敵兵" },
    "INV-37": { left: { idle: 0, map: "closed", recall: "hidden" }, sel: null, cmds: "none", hp: false, field: "field-THEME-raid" },
    "NEW-03": { left: { idle: 3, map: "open" }, ret: "active",                // 撤退選位置：小地圖自動打開
                prompt: { text: "點地面或小地圖：撤到那裡；點主城回家", buttons: [B("退回主城", { ic: "home", cls: "blue" }), B("取消", { cls: "sec" })] } },
    "NEW-04": { left: { idle: 3, map: "closed", alarm: 2 }, arrows: [{ x: 600, y: 40, r: -90 }, { x: 40, y: 150, r: 180 }] },   // 收著時被攻擊
    "NEW-05": { left: { idle: 3, map: "open", minimap: "minimap-diamond-hit" }, arrows: [{ x: 600, y: 40, r: -90 }] },
  });
  // ----- R6-22 地圖鈕收著時的警報（兩格：亮、暗，0.4 秒換一次；減少動態效果時一直是亮的那格）
  S["NEW-04b"] = { left: { idle: 3, map: "closed", alarm: 2, dim: true }, arrows: [{ x: 600, y: 40, r: -90 }, { x: 40, y: 150, r: 180 }] };
  S["INV-132"] = { toast: "主城剛被攻擊，暫時不能修理：村民會在旁邊等，10 秒內沒再被打就開始修" };
  // ----- R6-30 重設由誰接手
  Object.assign(S, {
    "NEW-10": { left: { idle: 3, map: "open" }, ret: "active", mark: [".sel .x"],
                prompt: { text: "點地面或小地圖：撤到那裡；點主城回家", buttons: [B("退回主城", { ic: "home", cls: "blue" }), B("取消", { cls: "sec" })] } },
    "NEW-11": { sel: null, cmds: "none", hp: false, field: "field-THEME-plain", left: { idle: 3, map: "closed" } },
    "NEW-12": { sel: null, cmds: null, hp: false, field: "field-THEME-plain", left: { idle: 3, map: "closed" }, mark: [".prompt .b"],
                prompt: { text: "拖曳預覽到想蓋的位置，放開後按 ✓ 或 ✗；會派最近的村民去蓋", buttons: [B("取消", { cls: "sec" })] } },
    "NEW-13": { sel: null, cmds: "build", hp: false, field: "field-THEME-plain", left: { idle: 3, map: "closed" }, mark: [".cmds .b:last-child"] },
  });
  // ----- helpers for the selection bodies
  const bar = (cls, pct) => `<div class="bar ${cls}"><i style="width:${pct}%"></i></div>`;
  const line = (t) => `<div class="line">${t}</div>`;
  const rowb = (...bs) => `<div class="rowb">${bs.join("")}</div>`;
  const st = (t) => `<span class="st">${t}</span>`;
  const help = (rows) => `<ul class="help">${rows.map(([c, k, t]) => `<li class="${c.includes("on") ? "on" : ""}"><em class="k ${c}">${k}</em>${t}</li>`).join("")}</ul>`;
  const H = HELP.dense;
  const sel = (title, html, extra = "") => ({ kind: "html", title, html, extra });
  const pm = (n, o = {}) => `${B("−", { cls: "sec pm", state: o.minus })}<span class="num">${n}</span>${B("+", { cls: "sec pm", state: o.plus })}`;
  const PLAIN = { hp: false, field: "field-THEME-plain" };
  const ONE = { hp: false, field: "field-THEME-one" };
  const CMD = {
    city: [B("訓練村民", { ic: "build", cls: "pri", sub: "糧50" }), B("集結點", { ic: "rally", cls: "sec" }), B("經濟分配", { cls: "sec" }), B("預留", { cls: "sec", sub: "自動訓練" }), B("建造", { ic: "build", cls: "pri" })],
    barracks: (auto) => [B("訓練槍兵", { ic: "build", cls: "pri", sub: "糧40 木20" }), B("集結點", { ic: "rally", cls: "sec" }),
      B("自動訓練", { cls: "sec", sub: auto ? "目前：開" : "目前：暫停", state: auto ? "active" : "" })],
    mage: (on) => [B(on ? "取消晶砲" : "晶砲", { ic: "cannon", cls: "pri", sub: "魔晶 5", state: on ? "active" : "" }), B("自動施放", { cls: "sec", sub: on ? "目前：開" : "目前：關", state: on ? "active" : "" })],
  };
  // ----- R6-11 戰場上方
  Object.assign(S, {
    "INV-19": {}, "INV-20": { res: { training: 1 } }, "INV-21": { res: { training: 1 } }, "INV-22": { res: { training: null } },
    "INV-23": {}, "INV-24a": { top: { speed: "快" } }, "INV-24b": { top: { speed: "慢" } },
    "INV-25": {}, "INV-26": { top: { paused: true } }, "INV-28": {}, "INV-29": {},
  });
  // ----- R6-12 編隊
  Object.assign(S, {
    "INV-30": {}, "INV-31": {},
    "INV-32": { groups: [{ n: 1, sub: "剩 4/10", cls: "alarm" }, { n: 2, sub: "6/6" }, { n: 3 }, { n: 4 }], backs: [1], sel: null, cmds: "none", ...PLAIN,
                toast: "編隊 1 快撐不住了（剩 4/10）" },
    "INV-32b": { groups: [{ n: 1, sub: "剩 4/10", cls: "alarm dim" }, { n: 2, sub: "6/6" }, { n: 3 }, { n: 4 }], backs: [1], sel: null, cmds: "none", ...PLAIN },
    "INV-33": { groups: [{ n: 1, sub: "10/10" }, { n: 2, sub: "6/6" }, { n: 3 }, { n: 4 }], backs: [1, 2], sel: null, cmds: "none", ...PLAIN },
    "INV-34": { army: 0, groups: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }], sel: null, cmds: "none", ...PLAIN },
  });
  // ----- R6-14 選取資訊：單位
  Object.assign(S, {
    "INV-44": {}, "INV-46": {}, "INV-47": { folded: true },
    "INV-48": { ...ONE, sel: sel("槍兵", bar("", 100) + line("生命 <b>100</b>/100") + help(H), st("待命")) },
    "INV-49": { ...ONE, sel: sel("法師", bar("", 100) + bar("shield", 66) + line("生命 <b>30</b>/30　防護罩 <b>40</b>/60") + help(H), st("待命　自動施放開")), extraCmds: CMD.mage(false) },
    "INV-50": { ...ONE, sel: sel("村民", bar("", 100) + line("生命 <b>25</b>/25　搬運 <b>8</b> 木"), st("採集中")), cmds: "villagers" },
    "INV-51": { ...PLAIN, sel: sel("敵方槍兵", bar("", 80) + line("生命 <b>80</b>/100"), st("前進中")), cmds: "none" },
    "INV-53": { ...PLAIN, sel: { kind: "units", title: "已選 5 個單位", chips: [["村民", 5]], now: "目前：採集中 5", help: [] }, cmds: "villagers" },
    "INV-55": { sel: { kind: "units", now: "目前：撤退中 10", help: [H[0], ["ret on", "撤退中", "點地面或小地圖改撤退位置，到了原地堅守"], H[2], H[3]] }, ret: true },
    "INV-56a": { sel: { kind: "units", help: [H[0], H[1], H[2], ["", "散開", "站位間隔 2 格，站好時一發晶砲只炸得到 1 名"], ["", "", "行軍、追擊、交戰時也盡量保持 2 格；隊伍較寬，過窄路較慢"]] }, form: "散開" },
    "INV-56b": { sel: { kind: "units", help: [H[0], H[1], H[2], ["", "隊形", "有的密集、有的散開"]] }, form: "混合" },
  });
  // ----- R6-15 選取資訊：建築
  const garrison = (n, coming) => line(`躲了 <b>${n}</b> 名士兵（最多 6 名）${coming ? `，${coming} 名正過來` : ""}`) +
    rowb(B("＋遠程", { cls: "sec", state: n >= 6 ? "disabled" : "" }), B("＋法師", { cls: "sec", state: n >= 6 ? "disabled" : "" }), B("全部出來", { cls: "sec", state: n === 0 ? "disabled" : "" }));
  const outpost = (n, hold) => line(`駐守 <b>${n}</b> 名槍兵（最多 6 名）`) +
    rowb(B("＋槍兵", { cls: "sec", state: n >= 6 ? "disabled" : "" }), B("全部離開", { cls: "sec", state: n === 0 ? "disabled" : "" }),
      B("攻擊", { cls: "red", state: hold ? "" : "active" }), B("堅守", { cls: "gold", state: hold ? "active" : "" })) +
    line(hold ? "堅守：站在哨所旁不動，只打走到身邊的；哨所或駐守的兵被打，就一起去打，追到 12 格就回來" : "攻擊：敵兵進到哨所 8 格內就去打，追到 12 格就回來");
  const dispatch = (n, what) => line(`附近有 <b>${n}</b> 名村民在採${what}`) + rowb(B("−", { cls: "sec pm", state: n === 0 ? "disabled" : "" }), B("+", { cls: "sec pm" }));
  Object.assign(S, {
    "INV-57": { ...PLAIN, sel: sel("糧倉", bar("", 100) + line("生命 <b>300</b>/300") + dispatch(1, "糧")), cmds: "none" },
    "INV-58": { ...PLAIN, sel: sel("兵營", bar("prog", 45) + line("建造中 <b>45%</b>")), cmds: [B("自動訓練", { cls: "sec", sub: "目前：開", state: "active" })] },
    "INV-59a": { ...PLAIN, sel: sel("兵營", bar("", 100) + line("生命 <b>500</b>/500"), st("人口滿了，蓋民居")), cmds: CMD.barracks(true) },
    "INV-59b": { ...PLAIN, sel: sel("主城", bar("", 62) + line("生命 <b>740</b>/1200") + garrison(0), st("剛被攻擊，暫時不能修理　躲了 3 名村民")), cmds: CMD.city },
    "INV-60": { ...PLAIN, sel: sel("兵營", bar("", 100) + `<div class="queue">${B("槍兵", { cls: "sec first", sub: "訓練中" })}${B("槍兵", { cls: "sec", sub: "取消" })}${B("遠程兵", { cls: "sec", sub: "取消" })}</div>`, st("自動訓練中")), cmds: CMD.barracks(true) },
    "INV-61": { ...PLAIN, sel: sel("主城", bar("", 100) + line("生命 <b>1200</b>/1200") + garrison(0, 1)), cmds: CMD.city },
    "INV-62": { ...PLAIN, sel: sel("主城", bar("", 100) + line("生命 <b>1200</b>/1200") + garrison(2)), cmds: CMD.city },
    "INV-63": { ...PLAIN, sel: sel("主城", bar("", 100) + line("生命 <b>1200</b>/1200") + garrison(6)), cmds: CMD.city },
    "INV-64": { ...PLAIN, sel: sel("伐木場", bar("", 100) + line("生命 <b>300</b>/300") + dispatch(2, "木")), cmds: "none" },
    "INV-65": { ...PLAIN, sel: sel("礦場", bar("", 100) + line("生命 <b>300</b>/300") + dispatch(0, "金")), cmds: "none" },
    "INV-66": { ...PLAIN, sel: sel("哨所", bar("", 100) + outpost(1, false)), cmds: "none" },
    "INV-67": { ...PLAIN, sel: sel("哨所", bar("", 100) + outpost(3, true)), cmds: "none" },
    "INV-68a": { ...PLAIN, sel: sel("哨所", bar("", 100) + outpost(0, false)), cmds: "none" },
    "INV-68b": { ...PLAIN, sel: sel("哨所", bar("", 100) + outpost(6, false)), cmds: "none" },
    "INV-69a": { ...PLAIN, sel: sel("敵方兵營", bar("", 70) + line("生命 <b>350</b>/500"), st("（上次看到的樣子）")), cmds: "none" },
    "INV-69b": { ...PLAIN, sel: sel("敵方箭樓", bar("", 100) + line("生命 <b>500</b>/500"), st("裡面有人")), cmds: "none" },
    "INV-69c": { ...PLAIN, sel: sel("敵方哨所", bar("", 100) + line("生命 <b>400</b>/400"), st("堅守中")), cmds: "none" },
  });
  // ----- R6-16 選取資訊：資源與城鎮
  const stay = (n) => `<div class="rowb"><span class="line">留守</span>${pm(n, { minus: n === 0 ? "disabled" : "" })}<span class="line">名</span></div>` + line("留守的兵改成堅守，不跟「全軍」走");
  Object.assign(S, {
    "INV-70": { ...PLAIN, sel: sel("樹林", line("剩下 <b>100</b>") + line("派採木的村民過來（別處有 2 名）") + rowb(B("¼（1 名）", { cls: "sec" }), B("½（1 名）", { cls: "sec" }), B("全部（2 名）", { cls: "sec" }))), cmds: "none" },
    "INV-71": { ...PLAIN, sel: sel("金礦", line("剩下 <b>800</b>") + line("沒人在採別處的金：派閒置的村民過來（3 名）") + rowb(B("¼（1 名）", { cls: "sec" }), B("½（2 名）", { cls: "sec" }), B("全部（3 名）", { cls: "sec" }))), cmds: "none" },
    "INV-72": { ...PLAIN, sel: sel("樹林", line("剩下 <b>80</b>（上次看到的量）") + line("沒有可以派的村民（沒人在採別處的木，也沒有閒置的）") + rowb(B("¼", { cls: "sec", state: "disabled" }), B("½", { cls: "sec", state: "disabled" }), B("全部", { cls: "sec", state: "disabled" }))), cmds: "none" },
    "INV-73": { ...PLAIN, sel: sel("小鎮", line("民兵 0　城裡有 <b>0</b> 名兵（至少要 1 名）") + `<div class="goodline">收入 25%，慢慢回升</div>` + stay(0), st("我方治理中")), cmds: "none" },
    "INV-74a": { ...PLAIN, sel: sel("小鎮", line("民兵 <b>3</b>　駐軍 0/1"), st("中立")), cmds: "none" },
    "INV-74b": { ...PLAIN, sel: sel("大城", line("民兵 <b>0</b>　駐軍 3/3"), st("敵方治理中")), cmds: "none" },
    "INV-75a": { ...PLAIN, sel: sel("大城", line("剩 <b>0:15</b>") + line("部隊留下搶，拿一大筆糧、金、魔晶"), st("我方搶奪中")), cmds: "none" },
    "INV-75b": { ...PLAIN, sel: sel("小鎮", line("城裡有 <b>0</b> 名兵（至少要 1 名）") + `<div class="warnline">駐軍不足，0:30 後叛離</div>` + stay(0), st("我方治理中")), cmds: "none" },
    "INV-75c": { ...PLAIN, sel: sel("小鎮", line("民兵 0　城裡有 <b>2</b> 名兵") + `<div class="goodline">收入 100%</div>` + stay(2), st("我方治理中")), cmds: "none" },
    "INV-76a": { ...PLAIN, sel: sel("小鎮", rowb(B("搶", { cls: "plunder" }), B("治理", { cls: "govern" })), st("攻下，等待選擇")), cmds: "none" },
    "INV-76b": { ...PLAIN, sel: sel("小鎮", rowb(B("治理", { cls: "govern" })) + line("這座城這局已經被搶過，只能治理"), st("攻下，等待選擇")), cmds: "none" },
    "INV-77": { ...PLAIN, sel: sel("大城", line(""), st("還沒探索")), cmds: "none" },
  });
  // ----- R6-17 軍團畫面
  const gp = (rows) => `<div class="gp">${rows.map(([n, have, want]) => `<span class="nm">${n}</span><span class="have">現有 ${have}</span>${pm(want)}`).join("")}</div>`;
  Object.assign(S, {
    "INV-78": { sel: sel("編隊 1", gp([["槍兵", 6, 6], ["遠程兵", 4, 4], ["法師", 0, 0]]) + rowb(B("清空", { cls: "sec" }), B("自動補兵：開", { cls: "sec", state: "active" })), st("10/10")) },
    "INV-79": { sel: sel("編隊 1", `<div class="gp2">${[["槍兵", 6, 6], ["遠程兵", 4, 4], ["法師", 1, 1], ["騎兵", 2, 2]].map(([n, h, w]) => `<div class="cell"><span class="t">${n} <small>現有 ${h}</small></span>${pm(w)}</div>`).join("")}</div>` + rowb(B("清空", { cls: "sec" }), B("自動補兵：開", { cls: "sec", state: "active" })), st("13/13")) },
    "INV-80": { groups: [{ n: 1, sub: "10/10" }, { n: 2, sub: "6/6" }, { n: 3, st: "active" }, { n: 4 }],
                sel: sel("編隊 3", gp([["槍兵", 0, 0], ["遠程兵", 0, 0], ["法師", 0, 0]]) + rowb(B("改成剛才選的 10 名", { cls: "pri" }), B("清空", { cls: "sec", state: "disabled" }), B("自動補兵：開", { cls: "sec", state: "active" })), st("還沒有兵")) },
    "INV-81": { groups: [{ n: 1, sub: "10/10" }, { n: 2, sub: "6/6" }, { n: 3, st: "active" }, { n: 4 }], ...PLAIN,
                sel: sel("編隊 3", gp([["槍兵", 0, 4], ["遠程兵", 0, 2], ["法師", 0, 0]]) + rowb(B("清空", { cls: "sec" }), B("自動補兵：關", { cls: "sec" })), st("還沒有兵")) },
  });
  // ----- R6-18 指令區
  Object.assign(S, {
    "INV-83": { ...PLAIN, sel: null, cmds: "none" }, "INV-84": {},
    "INV-85": { atk: true, prompt: { text: "點地面或小地圖：整隊前進，遇到敵人一起打", buttons: [B("取消", { cls: "sec" })] }, left: { idle: 3, map: "open" } },
    "INV-86": { ret: true, prompt: { text: "點地面或小地圖：撤到那裡；點主城回家", buttons: [B("退回主城", { ic: "home", cls: "blue" }), B("取消", { cls: "sec" })] }, left: { idle: 3, map: "open" } },
    "INV-87": { holdOn: true, sel: { kind: "units", now: "目前：堅守 10" } },
    "INV-88a": { form: "散開" }, "INV-88b": { form: "混合" },
    "INV-89": { sel: { kind: "units", title: "已選 12 個單位", chips: [["槍兵", 6], ["遠程兵", 4], ["法師", 2]], now: "目前：待命 12" }, extraCmds: CMD.mage(false) },
    "INV-90": { sel: { kind: "units", title: "已選 12 個單位", chips: [["槍兵", 6], ["遠程兵", 4], ["法師", 2]], now: "目前：待命 12" }, extraCmds: CMD.mage(true),
                prompt: { text: "點地面選晶砲落點", buttons: [B("取消", { cls: "sec" })] } },
    "INV-91": { ...PLAIN, sel: { kind: "units", title: "已選 5 個單位", chips: [["村民", 5]], now: "目前：採集中 5", help: [] }, cmds: "villagers" },
    "INV-92a": { sel: { kind: "units", title: "已選 6 個單位", chips: [["槍兵", 6]], now: "目前：待命 6" }, extraCmds: [B("駐守", { cls: "sec", sub: "點哨所" })] },
    "INV-92b": { sel: { kind: "units", title: "已選 6 個單位", chips: [["槍兵", 6]], now: "目前：待命 6" }, extraCmds: [B("取消", { cls: "sec", sub: "駐守", state: "active" })],
                 prompt: { text: "點自己的哨所：槍兵去駐守", buttons: [B("取消", { cls: "sec" })] } },
    "INV-93a": { sel: { kind: "units", title: "已選 4 個單位", chips: [["遠程兵", 4]], now: "目前：待命 4" }, extraCmds: [B("躲進去", { cls: "sec", sub: "主城或箭樓" })] },
    "INV-93b": { sel: { kind: "units", title: "已選 4 個單位", chips: [["遠程兵", 4]], now: "目前：待命 4" }, extraCmds: [B("取消", { cls: "sec", sub: "躲進去", state: "active" })],
                 prompt: { text: "點自己的主城或箭樓：遠程兵和法師躲進去", buttons: [B("取消", { cls: "sec" })] } },
    "INV-94": { ...PLAIN, sel: sel("主城", bar("", 100) + line("生命 <b>1200</b>/1200") + garrison(0)), cmds: CMD.city },
    "INV-95": { ...PLAIN, sel: sel("兵營", bar("", 100) + line("生命 <b>500</b>/500"), st("自動訓練中")), cmds: CMD.barracks(true) },
    "INV-96": { ...PLAIN, sel: sel("兵營", bar("", 100) + line("生命 <b>500</b>/500"), st("自動訓練暫停")), cmds: CMD.barracks(false) },
    "INV-97": { ...PLAIN, sel: sel("兵營", bar("", 100) + line("生命 <b>500</b>/500"), st("自動訓練中")),
                cmds: [B("訓練槍兵", { ic: "build", cls: "pri", sub: "糧40 木20" }), B("取消", { ic: "rally", cls: "sec", sub: "集結點", state: "active" }), B("自動訓練", { cls: "sec", sub: "目前：開", state: "active" })],
                prompt: { text: "點地面設集結點", buttons: [B("取消", { cls: "sec" })] } },
    "INV-98": { ...PLAIN, sel: sel("兵營", bar("prog", 45) + line("建造中 <b>45%</b>")), cmds: [B("自動訓練", { cls: "sec", sub: "目前：開", state: "active" })] },
    "INV-99": { ...PLAIN, sel: null, cmds: "build" },
    "INV-100": { ...PLAIN, sel: null, cmds: [["民居", "木30"], ["農田", "木60"], ["伐木場", "木50"], ["礦場", "木50"], ["糧倉", "木60"], ["兵營", "木150"],
      ["射場", "要先蓋 兵營", 1], ["法術營", "要先蓋 兵營", 1], ["箭樓", "木100 金50"], ["馬廄", "要先蓋 兵營", 1], ["哨所", "木50"]]
      .map(([n, c, d]) => B(n, { ic: "build", cls: "pri", sub: c, state: d ? "disabled" : "" })).concat([B("返回", { cls: "sec" })]) },
  });
  // ----- R6-19 浮動元件
  const NOSEL = { ...PLAIN, sel: null, cmds: "none" };
  const P = (text, buttons, warn) => ({ text, buttons, warn });
  const CANCEL = B("取消", { cls: "sec" });
  Object.assign(S, {
    "INV-101": { ...NOSEL, cue: { x: 330, y: 250 } },
    "INV-102": { ...NOSEL, boxsel: [440, 150, 190, 90] },
    "INV-103": { ...NOSEL, wheel: { x: 520, y: 182, items: [["進攻", "red"], ["撤退", "blue"], ["堅守", "gold"]] } },
    "INV-104": { ...NOSEL, wheel: { x: 520, y: 182, items: [["晶砲", "pri"], ["自動施放：關", "sec"], ["撤退", "blue"], ["堅守", "gold"]] } },
    "INV-105": { ...NOSEL, wheel: { x: 232, y: 236, items: [["撤退", "blue"]] } },
    "INV-106": { ...NOSEL, wheel: { x: 520, y: 182, items: [["取消進攻", "red"], ["撤退", "blue"], ["堅守", "gold"]] } },
    "INV-107": { atk: true, prompt: P("點地面或小地圖：整隊前進，遇到敵人一起打", [CANCEL]), left: { idle: 3, map: "open" } },
    "INV-108": { ret: true, prompt: P("點地面或小地圖：撤到那裡；點主城回家", [B("退回主城", { ic: "home", cls: "blue" }), CANCEL]), left: { idle: 3, map: "open" } },
    "INV-109a": { prompt: P("點地面選晶砲落點", [CANCEL]), extraCmds: CMD.mage(true), sel: { kind: "units", title: "已選 12 個單位", chips: [["槍兵", 6], ["遠程兵", 4], ["法師", 2]], now: "目前：待命 12" } },
    "INV-109b": { ...PLAIN, prompt: P("點地面設集結點", [CANCEL]), sel: sel("兵營", bar("", 100) + line("生命 <b>500</b>/500"), st("自動訓練中")),
                  cmds: [B("訓練槍兵", { ic: "build", cls: "pri", sub: "糧40 木20" }), B("取消", { ic: "rally", cls: "sec", sub: "集結點", state: "active" }), B("自動訓練", { cls: "sec", sub: "目前：開", state: "active" })] },
    "INV-110": { prompt: P("點自己的主城或箭樓：只有遠程兵和法師會躲進去", [CANCEL]), extraCmds: [B("取消", { cls: "sec", sub: "躲進去", state: "active" })] },
    "INV-111": { prompt: P("點自己的哨所：只有槍兵會去駐守", [CANCEL]), extraCmds: [B("取消", { cls: "sec", sub: "駐守", state: "active" })] },
    "INV-112": { ...NOSEL, cmds: null, prompt: P("拖曳預覽到想蓋的位置，放開後按 ✓ 或 ✗；會派最近的村民去蓋", [CANCEL]), place: { x: 380, y: 236, w: 113, h: 57, ok: true } },
    "INV-113": { ...NOSEL, cmds: null, prompt: P("拖曳預覽到想蓋的位置，放開後按 ✓ 或 ✗；會派最近的村民去蓋", [CANCEL], "這裡離城鎮的民兵太近，去蓋的村民會被攻擊"), place: { x: 380, y: 236, w: 113, h: 57, ok: true } },
    "INV-114": { ...NOSEL, cmds: null, prompt: P("拖曳預覽到想蓋的位置，放開後按 ✓ 或 ✗；會派最近的村民去蓋", [CANCEL]), place: { x: 380, y: 236, w: 113, h: 57, ok: true, okx: true } },
    "INV-115": { ...NOSEL, cmds: null, prompt: P("拖曳預覽到想蓋的位置，放開後按 ✓ 或 ✗；會派最近的村民去蓋", [CANCEL]), place: { x: 380, y: 236, w: 113, h: 57, ok: false, okx: true } },
  });
  // ----- R6-20 對話框（含 D-087 新加的：選單裡的全體回城、設定 → 介面風格）
  const D = (title, html, cls) => ({ title, html, cls });
  const btns = (...b) => `<div class="btns">${b.join("")}</div>`;
  const menu = (hidden) => D("選單", `<div class="grid2">${[B("魔晶怎麼拿", { cls: "sec" }), B("兵種相剋", { cls: "sec" }),
    hidden ? B("回去工作", { ic: "work", cls: "pri" }) : B("全體回城", { ic: "home", cls: "sec" }), B("設定", { ic: "gear", cls: "sec" }),
    B("重來（開新的一局）", { cls: "sec" }), B("投降", { cls: "sec" }), B("量測與確定性檢查", { cls: "sec" }), B("回開局畫面", { cls: "sec" })].join("")}</div>` +
    btns(B("關閉", { cls: "pri" })));
  const counters = (cav) => D("兵種相剋", `<p class="small">×2 是傷害變成兩倍。數字是這一局的規則。</p><table>` +
    [["槍兵", cav ? "騎兵 ×3" : "—", "遠程兵 ×2.5、晶砲（擠在一起時）"], ["遠程兵", "槍兵 ×2.5", cav ? "騎兵 ×2" : "法師 ×1.5"], ["法師", "擠在一起的部隊（晶砲）", "遠程兵 ×1.5"]]
      .concat(cav ? [["騎兵", "遠程兵 ×2", "槍兵 ×3"]] : []).map(([n, a, b]) => `<tr><th>${n}</th><td>剋：${a}</td><td>怕：${b}</td></tr>`).join("") +
    `</table>` + btns(B("回選單", { cls: "sec" }), B("關閉", { cls: "pri" })));
  const er = (n, v) => `<div class="er"><b>${n}</b>${B("−", { cls: "sec" })}<span class="num">${v}%</span>${B("+", { cls: "sec" })}<span></span></div>`;
  const rv = (n, v) => `<div class="er"><b>${n}</b>${B("−", { cls: "sec" })}<span class="num">${v}</span>${B("+", { cls: "sec" })}<span></span></div>`;
  const capture = (city, only) => D(only ? `攻下${city ? "大城" : "小鎮"}！只能治理` : `攻下${city ? "大城" : "小鎮"}！搶還是治理？`,
    `<div class="big2">${only ? "" : B("搶", { cls: "plunder", sub: `部隊留下搶 ${city ? 25 : 15} 秒，拿一大筆糧、金、魔晶；城鎮變成廢墟 4 分鐘` })}` +
    `${B("治理", { cls: "govern", sub: `投入金和木修繕 ${city ? 60 : 45} 秒，之後每分鐘產出、加人口；要留兵駐守` })}</div>` +
    (only ? `<p class="small">這座城這局已經被搶過，只能治理</p>` : `<div class="stayrow">搶：留守 ${B("−", { cls: "sec" })}<span class="num">${city ? 3 : 1}</span>${B("+", { cls: "sec" })} 名</div>`) +
    `<div class="stayrow">治理：留守 ${B("−", { cls: "sec" })}<span class="num">${city ? 3 : 1}</span>${B("+", { cls: "sec" })} 名</div>` +
    `<p class="small">留守的兵改成堅守，不跟「全軍」走，也會離開原本的編隊。</p>` + btns(B("稍後再決定（點城鎮也能選）", { cls: "sec" })));
  const hint = (random, off) => D("魔晶從城鎮來", `<p>法師要用魔晶。魔晶主要從城鎮來：帶兵打倒城裡的民兵，就能選「搶」或「治理」。</p>
    <p>搶：馬上拿到一筆糧、金和魔晶，每座城一局只能搶一次。治理：修好之後，每分鐘都有魔晶。</p>
    <p class="hl">${random ? "這是隨機地圖：城鎮要派兵去探，探到才會出現在地圖上。" : "離你的主城最近的小鎮在主城的東北方，約 20 格。小地圖上閃的圓圈就是它。"}</p>` +
    btns(B(off ? "開局時要提示" : "不再提示", { cls: "sec" }), ...(random ? [] : [B("看那座城鎮", { cls: "sec" })]), B("知道了", { cls: "pri" })));
  const settings = (pick) => D("設定", `<div class="settings-row"><b>介面風格</b><span class="small">換了馬上生效，下次打開也照這個</span></div>
    <div class="opt2">${B("A 銅木（預設）", { cls: "sec", sub: "深色木頭、銅邊", state: pick === "a" ? "active" : "", attr: "" }).replace('<span class="lb">', '<img src="../build/shot-a.png" alt=""><span class="lb">')}
    ${B("B 墨漆金線", { cls: "sec", sub: "深墨漆面、金色細線", state: pick === "b" ? "active" : "" }).replace('<span class="lb">', '<img src="../build/shot-b.png" alt=""><span class="lb">')}</div>` +
    btns(B("回選單", { cls: "sec" }), B("關閉", { cls: "pri" })));
  Object.assign(S, {
    "INV-116": { dialog: menu(false) }, "INV-117": { dialog: menu(false) }, "NEW-06": { dialog: menu(true), left: { idle: 0, map: "closed", recall: "hidden" } },
    "NEW-07": { dialog: settings("a") }, "NEW-08": { dialog: settings("b") },
    "INV-118a": { dialog: counters(false) }, "INV-118b": { dialog: counters(true) },
    "INV-119": { dialog: D("確定投降？", `<p>投降就輸了這一局。</p>` + btns(B("取消", { cls: "sec" }), B("投降", { cls: "danger" }))) },
    "INV-120": { dialog: D("經濟分配", `<p class="small">自動分配開著時，改比例後，正在採糧、木、金的村民會照新比例重新分配；你親手派去採的不會動。晶脈要自己派。</p>` +
      er("糧", 40) + er("木", 35) + er("金", 25) + `<div class="btns" style="justify-content:space-between">${B("自動分配：開", { cls: "sec", state: "active" })}<span>${B("取消", { cls: "sec" })} ${B("套用", { cls: "pri" })}</span></div>`) },
    "INV-121": { dialog: D("預留", `<p class="small">自動訓練只用超過這些的資源；預設留的夠蓋法術營、放 3 發晶砲。</p>` + rv("糧", 150) + rv("木", 200) + rv("金", 150) + rv("魔晶", 15) +
      btns(B("預設", { cls: "sec" }), B("取消", { cls: "sec" }), B("套用", { cls: "pri" }))) },
    "INV-122": { dialog: capture(false, false) }, "INV-123": { dialog: capture(true, false) }, "INV-124": { dialog: capture(false, true) },
    "INV-125": { dialog: hint(false, false), top: { paused: true }, left: { idle: 0, map: "open", minimap: "minimap-diamond-hint" }, ...NOSEL },
    "INV-126": { dialog: hint(true, false), top: { paused: true }, left: { idle: 0, map: "open", minimap: "minimap-diamond-start" }, ...NOSEL },
    "INV-127": { dialog: hint(false, true) },
  });
  // ----- R6-21 勝負
  const result = (t, won) => D(t, `<p class="reason">${won ? "敵方主城被摧毀" : t === "平手" ? "時間到（30 分鐘）" : "投降"}　遊戲時間 12:48</p><table>
    <tr><th></th><th>我方</th><th>敵方</th></tr><tr><th>採集</th><td>糧 2140、木 1880、金 960、魔晶 85</td><td>糧 1990、木 1720、金 1010、魔晶 60</td></tr>
    <tr><th>訓練</th><td>58</td><td>52</td></tr><tr><th>損失</th><td>21</td><td>47</td></tr><tr><th>法師（訓練／陣亡）</th><td>4／1</td><td>3／3</td></tr>
    <tr><th>城鎮（搶／治理）</th><td>1／1</td><td>0／1</td></tr></table>` + btns(B("回開局畫面", { cls: "sec" }), B("重來", { cls: "pri" })), `result ${won ? "won" : ""}`);
  Object.assign(S, { "INV-129": { ...NOSEL, dialog: result("失敗", false) }, "INV-130": { ...NOSEL, dialog: result("勝利", true) }, "INV-131": { ...NOSEL, dialog: result("平手", false) } });
  // ----- R6-10 開局
  const opts = (diff, map) => `<div class="opts"><span class="k">難度</span><div class="row">${["簡單", "普通", "困難"].map((d) => B(d, { cls: d === diff ? "pri" : "sec" })).join("")}</div>
    <span class="k">地圖</span><div class="row">${["固定地圖", "隨機地圖"].map((d) => B(d, { cls: d === map ? "pri" : "sec" })).join("")}</div></div>
    <p class="desc">${map === "固定地圖" ? "每局同一張，適合比較電腦強弱" : "每局不同，只看得到自己家附近"}</p>`;
  const foot = `<p class="note">對局沒有時間上限，打到一方的主城被摧毀或投降為止。</p><p class="foot">commit 1a2b3c4 · 紀錄代號 7f3k9q2m · <a>回測試頁首頁</a></p>`;
  const START = { only: ["field", "start", "portrait", "error"], field: "field-THEME-plain" };
  Object.assign(S, {
    "INV-01": { ...START, start: { dim: true, html: opts("簡單", "固定地圖") + `<div class="go">${B("開始", { cls: "pri big" })}</div>` + foot } },
    "INV-05": { ...START, start: { dim: true, html: opts("普通", "隨機地圖") + `<div class="go">${B("開始", { cls: "pri big" })}</div>` + foot } },
    "INV-07": { ...START, start: { dim: true, html: opts("簡單", "固定地圖") + `<div class="go">${B("開始", { cls: "sec big" })}${B("繼續上一局（第 12 分）", { cls: "pri cont" })}</div>` + foot } },
    "INV-09": { ...START, start: { dim: true, html: opts("簡單", "固定地圖") + `<div class="go">${B("開始", { cls: "pri big" })}${B("繼續上一局（第 12 分）", { cls: "sec cont", state: "disabled" })}</div><p class="why">網站已經更新，這一局不能繼續</p>` + foot } },
    "INV-10": { ...START, start: { dim: true, html: opts("簡單", "固定地圖") + `<div class="go">${B("開始", { cls: "pri big" })}</div><p class="why">紀錄對不上（第 4 分），這一局不能繼續</p>` + foot } },
    "INV-11": { ...START, start: { dim: true, html: `<div class="ff"><b>快轉中：第 4／80 分</b><span class="track"><i></i></span>${B("取消", { cls: "sec" })}</div>` } },
    "INV-12": { only: null, top: { paused: true }, start: { dim: false, html: opts("簡單", "固定地圖") + `<div class="go">${B("繼續這局", { cls: "pri big" })}${B("重來", { cls: "sec cont" })}</div><p class="note">改了難度或地圖，要按「重來」才會用在新的一局。</p>` } },
    "INV-13": { ...START, start: { dim: true, html: opts("簡單", "固定地圖") + `<div class="go">${B("開始", { cls: "pri big" })}</div><div class="update">有新版本${B("更新", { cls: "pri" })}</div>` + foot } },
    "INV-17": { only: ["portrait"], portrait: true },
    "INV-18": { ...START, start: { dim: true, html: opts("簡單", "固定地圖") + `<div class="go">${B("開始", { cls: "pri big" })}</div>` + foot }, error: "出錯了：模擬沒有回應（示意的錯誤訊息）" },
  });
  // ----- R6-23 戰場世界介面（遊戲畫在戰場上的，A、B 一樣）
  const WF = { hp: false, sel: null, cmds: "none", field: "field-THEME-world", left: { idle: 0, map: "closed" } };
  const TOWN = (look) => ({ ...WF, field: "field-THEME-town", world: [{ k: "town", look }] });
  const own = "#3f7fe0", enemy = "#d9433a", neutral = "#d8d2c0", ruin = "#6d6258";   // R6-24 甲
  Object.assign(S, {
    "INV-134": { ...WF, world: [{ k: "mage" }] },
    "INV-136": { ...WF, world: [{ k: "mage", arc: 0.65 }] },
    "INV-138": { ...WF, world: [{ k: "selbox", b: "Barracks", hp: 0.7 }, { k: "rally", b: "Barracks" }] },
    "INV-139": { ...WF, world: [{ k: "bar", b: "House-build2", frac: 0.45, col: "#e7c35a" }, { k: "selbox", b: "Barracks", hp: 0.7 }] },
    "INV-140": { ...WF, world: [{ k: "marker", b: "MainCity" }, { k: "marker", b: "ArrowTower" }] },
    "INV-141": { ...WF, field: "field-THEME-grass", world: [{ k: "rings", list: [[250, 150, "#ffffff", "前進", 26], [340, 150, "#9cc4ff", "撤退", 26], [430, 150, "#fff3b0", "集結點", 26],
      [520, 150, "#f2c230", "採集", 26], [295, 240, "#ff5a4f", "攻擊", 26], [385, 240, "#4fd06a", "修理", 26], [475, 240, "#ff8a2a", "晶砲", 26]] }] },
    "INV-145": { ...WF, world: [{ k: "shot" }] },
    "INV-146": { hp: false, sel: null, cmds: "none", field: "field-THEME-fog", left: { idle: 0, map: "closed" } },
    "INV-143a": TOWN({ tint: neutral, text: "中立", glyph: "鎮" }),
    "INV-143b": TOWN({ tint: own, text: "我方搶奪中", glyph: "鎮", timer: 0.6 }),
    "INV-143c": TOWN({ tint: enemy, text: "敵方治理", glyph: "鎮" }),
    "INV-143d": TOWN({ tint: ruin, text: "廢墟", glyph: "鎮", timer: 0.3 }),
    "INV-144a": TOWN({ tint: own, text: "攻下：選搶或治理", glyph: "鎮" }),
    "INV-144b": TOWN({ tint: own, text: "我方修繕中", glyph: "鎮", timer: 0.4 }),
    "INV-144c": TOWN({ tint: own, text: "我方治理", glyph: "鎮" }),
    "INV-144d": TOWN({ tint: enemy, text: "敵方搶奪中", glyph: "鎮", timer: 0.7 }),
    "INV-144e": TOWN({ tint: enemy, text: "被攻下", glyph: "鎮" }),
    "INV-144f": TOWN({ tint: enemy, text: "敵方修繕中", glyph: "鎮", timer: 0.5 }),
  });
  S["NEW-20"] = { only: ["sheet"], sheet: true };
  // ----- R6-25 動畫（每個動畫的狀態；時間點用網址的 t=0..1）
  Object.assign(S, {
    "A-press0": {}, "A-press1": { pressAtk: true },
    "A-dialog": { anim: "dialog", dialog: S["INV-122"].dialog },
    "A-recall-in": { ...S["NEW-02"], anim: "recall", toast: null },
    "A-map": { left: { idle: 3, map: "open" }, anim: "map" },
    "A-toast": { anim: "toast", toast: "編隊 1 快撐不住了（剩 4/10）" },
    "A-cue": { ...S["INV-101"], anim: "cue" },
    "A-rings": { ...S["INV-141"], anim: "rings" },
    "A-arrow0": { ...S["NEW-04"] }, "A-arrow1": { ...S["NEW-04"], arrowDim: true },
  });
  for (const v of Object.values(S)) if (v.field) v.field = v.field.replace("THEME", new URLSearchParams(location.search).get("theme") || "a");
  window.R6_STATES = S;
})();
