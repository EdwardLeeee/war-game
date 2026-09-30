// Page overlay for the Godot web export, loaded through the Web preset's head include.
// Godot's default font has no Chinese, so the panel, buttons, result box and log are
// HTML, matching the PixiJS page; main.gd calls window.spikeUI through JavaScriptBridge.
(() => {
  const PASS = { fpsMedian: 55, fpsLow: 30, tickMedianMs: 5 };
  const style = document.createElement("style");
  style.textContent = `
    #spike-hud { position: fixed; top: calc(env(safe-area-inset-top) + 6px); left: calc(env(safe-area-inset-left) + 6px);
      right: calc(env(safe-area-inset-right) + 6px); pointer-events: none; z-index: 10;
      font: 13px/1.35 -apple-system, "Noto Sans TC", sans-serif; color: #f2eee4; }
    #spike-panel { display: inline-block; background: rgba(10, 12, 11, 0.72); border-radius: 8px; padding: 6px 9px;
      pointer-events: auto; max-width: calc(100vw - 24px); }
    #spike-panel b { font-size: 14px; }
    #spike-panel a { color: #e7c35a; }
    #spike-panel button { font: inherit; font-size: 15px; min-height: 44px; min-width: 44px; margin: 6px 6px 0 0; padding: 0 14px;
      border: 0; border-radius: 8px; background: #e7c35a; color: #1b1a17; font-weight: 600; }
    #spike-panel button.secondary { background: #cfd6d2; }
    #spike-result { display: none; position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 11;
      width: min(92vw, 440px); background: rgba(12, 14, 13, 0.93); border: 2px solid #e7c35a; border-radius: 12px;
      padding: 12px 16px; font: 16px/1.4 -apple-system, "Noto Sans TC", sans-serif; color: #f2eee4; }
    #spike-result h2 { margin: 0 0 6px; }
    #spike-result p { margin: 4px 0; }
    #spike-result .small { font-size: 11px; opacity: 0.75; word-break: break-all; }
    #spike-log { position: fixed; left: calc(env(safe-area-inset-left) + 6px); bottom: calc(env(safe-area-inset-bottom) + 6px);
      max-width: calc(100vw - 24px); max-height: 22vh; overflow: hidden; z-index: 10; color: #f2eee4;
      font: 10px/1.3 ui-monospace, Menlo, monospace; background: rgba(10, 12, 11, 0.55); border-radius: 6px;
      padding: 3px 6px; pointer-events: none; word-break: break-all; }`;

  let expected = null;
  let mismatches = 0;
  let onMeasure = null;
  let onDeterminism = null;
  const $ = (id) => document.getElementById(id);

  function build() {
    document.head.appendChild(style);
    const hud = document.createElement("div");
    hud.id = "spike-hud";
    hud.innerHTML = `<div id="spike-panel"><b>Godot 候選</b> <a href="../">回首頁</a>
      <div id="spike-fps">fps：載入中…</div><div id="spike-sim">模擬：載入中…</div><div id="spike-tick">載入中…</div>
      <button id="spike-measure">開始量測</button><button id="spike-determinism" class="secondary">確定性檢查</button></div>`;
    const result = document.createElement("div");
    result.id = "spike-result";
    const log = document.createElement("div");
    log.id = "spike-log";
    document.body.append(hud, result, log);
    $("spike-measure").addEventListener("click", () => {
      $("spike-result").style.display = "none";
      if (onMeasure) onMeasure();
    });
    $("spike-determinism").addEventListener("click", async () => {
      mismatches = 0;
      try {
        const res = await fetch("expected-hashes.json", { cache: "no-store" });
        expected = res.ok ? await res.json() : null;
      } catch {
        expected = null;
      }
      if (onDeterminism) onDeterminism();
    });
  }

  function addLog(line) {
    const box = $("spike-log");
    if (!box) return;
    const div = document.createElement("div");
    div.textContent = line;
    box.appendChild(div);
    while (box.childElementCount > 60) box.firstElementChild.remove();
  }

  window.spikeUI = {
    attach(measure, determinism) {
      onMeasure = measure;
      onDeterminism = determinism;
    },
    panel(fps, sim, tick) {
      $("spike-fps").textContent = fps;
      $("spike-sim").textContent = sim;
      $("spike-tick").textContent = tick;
    },
    logLine(line) {
      addLog(line);
    },
    hashLine(game, tick, hash) {
      const want = expected?.[game]?.[String(tick)];
      if (want !== undefined && want !== hash) mismatches++;
    },
    gameDone(game, ticks, finalHash) {
      if (expected === null) return;
      const want = expected?.[game]?.[String(ticks)];
      addLog(want === finalHash && mismatches === 0 ? `${game} ✓ 與 CI 相同` : `${game} ✗ 與 CI 不同（${mismatches} 處）`);
      mismatches = 0;
    },
    result(json) {
      const r = JSON.parse(json);
      const box = $("spike-result");
      box.innerHTML = "";
      const rows = [
        ["fps 中位數", `${r.fpsMedian}（標準 ≥ ${PASS.fpsMedian}）`, r.fpsMedian >= PASS.fpsMedian],
        ["最慢 5% 的 fps", `${r.fpsLow5}（標準 ≥ ${PASS.fpsLow}）`, r.fpsLow5 >= PASS.fpsLow],
        ["每 tick 模擬中位數", `${r.tickMsMedian} ms（標準 ≤ ${PASS.tickMedianMs}）`, r.tickMsMedian <= PASS.tickMedianMs],
        ["每 tick 模擬最大值", `${r.tickMsMax} ms`, true],
      ];
      const h = document.createElement("h2");
      h.textContent = r.pass ? "通過" : "未通過";
      box.appendChild(h);
      for (const [k, v, ok] of rows) {
        const p = document.createElement("p");
        p.textContent = `${ok ? "✓" : "✗"} ${k}：${v}`;
        box.appendChild(p);
      }
      const small = document.createElement("p");
      small.className = "small";
      small.textContent = `樣本：${r.frames} 幀、${r.ticks} tick；commit ${r.commit}；${r.engine}；${r.userAgent}`;
      box.appendChild(small);
      box.style.display = "block";
    },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
