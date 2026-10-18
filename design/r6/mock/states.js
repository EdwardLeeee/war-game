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
  // ----- R6-30 重設由誰接手
  Object.assign(S, {
    "NEW-10": { left: { idle: 3, map: "open" }, ret: "active", mark: [".sel .x"],
                prompt: { text: "點地面或小地圖：撤到那裡；點主城回家", buttons: [B("退回主城", { ic: "home", cls: "blue" }), B("取消", { cls: "sec" })] } },
    "NEW-11": { sel: null, cmds: "none", hp: false, field: "field-THEME-plain", left: { idle: 3, map: "closed" } },
    "NEW-12": { sel: null, cmds: null, hp: false, field: "field-THEME-plain", left: { idle: 3, map: "closed" }, mark: [".prompt .b"],
                prompt: { text: "拖曳預覽到想蓋的位置，放開後按 ✓ 或 ✗；會派最近的村民去蓋", buttons: [B("取消", { cls: "sec" })] } },
    "NEW-13": { sel: null, cmds: "build", hp: false, field: "field-THEME-plain", left: { idle: 3, map: "closed" }, mark: [".cmds .b:last-child"] },
  });
  for (const v of Object.values(S)) if (v.field) v.field = v.field.replace("THEME", new URLSearchParams(location.search).get("theme") || "a");
  window.R6_STATES = S;
})();
