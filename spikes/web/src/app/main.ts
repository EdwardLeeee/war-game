// Test page for the web candidate. Every step is written to the page and to the console as
// "SPIKE ..." lines, so a CI run that stalls still shows how far it got.
//
// Page (GitHub Pages): the measurement battle runs live; "開始量測" fits all units and the
// spawn squares on screen, warms up 5 s and measures 30 s. "確定性檢查" replays the two
// test games in a worker and compares their hashes with the ones CI computed.
// App built with VITE_AUTORUN=1 (simulator runs in CI): determinism first, then the
// measurement, then "SPIKE done".

import { Application, VERSION } from "pixi.js";
import { MAX_TICKS, SPAWN_BATTLE } from "../sim/constants.ts";
import { sharedMap } from "../sim/scenarios.ts";
import { summarize } from "../stats.ts";
import { attachInput } from "./input.ts";
import type { FromWorker, ToWorker } from "./protocol.ts";
import { Scene } from "./render.ts";

declare const __COMMIT__: string;
declare const __AUTORUN__: boolean;

const WARMUP_MS = 5000;
const WINDOW_MS = 30000;
const PASS = { fpsMedian: 55, fpsLow: 30, tickMedianMs: 5 };

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const logBox = $("log");

function log(line: string): void {
  console.log(`SPIKE ${line}`);
  const div = document.createElement("div");
  div.textContent = line;
  logBox.appendChild(div);
  while (logBox.childElementCount > 60) logBox.firstElementChild?.remove();
}

function newWorker(): Worker {
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
}

const env = () => ({
  commit: __COMMIT__,
  engine: `PixiJS ${VERSION} WebGL`,
  userAgent: navigator.userAgent,
  dpr: window.devicePixelRatio,
  viewport: `${window.innerWidth}x${window.innerHeight}`,
});

async function main(): Promise<void> {
  const app = new Application();
  await app.init({
    resizeTo: window,
    antialias: false,
    backgroundColor: 0x1d2320,
    preference: "webgl",
    resolution: window.devicePixelRatio,
    autoDensity: true,
  });
  $("stage").appendChild(app.canvas);
  const map = sharedMap();
  const scene = new Scene(app);
  await scene.load(map);
  const [x0, y0, x1, y1] = battleBox();
  scene.fit(x0, y0, x1, y1);

  const live = newWorker();
  const frameMs: number[] = []; // rolling, last WINDOW_MS
  const frameAt: number[] = [];
  const tickMs: number[] = [];
  const tickAt: number[] = [];
  let lastFrame = performance.now();
  let minStep = Infinity;
  let measure: { phase: "warmup" | "run"; start: number; frames: number[]; ticks: number[]; done: (r: object) => void } | null = null;
  let readyLogged = false;

  live.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if (m.type !== "snapshot") return;
    scene.push({ tick: m.tick, count: m.count, units: m.units, at: performance.now() });
    if (m.tick > 0) {
      const now = performance.now();
      tickMs.push(m.stepMs);
      tickAt.push(now);
      if (m.stepMs > 0 && m.stepMs < minStep) minStep = m.stepMs;
      if (measure?.phase === "run") measure.ticks.push(m.stepMs);
    }
    $("tick").textContent = `tick ${m.tick}，單位 ${m.count}`;
  };
  live.postMessage({ type: "live", mode: "measure" } satisfies ToWorker);

  attachInput(app.canvas, scene, $("marquee"), (cmd) => live.postMessage({ type: "command", cmd } satisfies ToWorker));

  app.ticker.add(() => {
    const now = performance.now();
    const dt = now - lastFrame;
    lastFrame = now;
    scene.draw(now);
    frameMs.push(dt);
    frameAt.push(now);
    while (frameAt.length > 0 && now - frameAt[0] > WINDOW_MS) {
      frameAt.shift();
      frameMs.shift();
    }
    while (tickAt.length > 0 && now - tickAt[0] > WINDOW_MS) {
      tickAt.shift();
      tickMs.shift();
    }
    if (!readyLogged && scene.curr !== null) {
      readyLogged = true;
      log(`ready web ${JSON.stringify(env())}`);
    }
    if (measure !== null) {
      if (measure.phase === "warmup" && now - measure.start >= WARMUP_MS) {
        measure.phase = "run";
        measure.start = now;
        log("量測開始（30 秒）");
      } else if (measure.phase === "run") {
        measure.frames.push(dt);
        if (now - measure.start >= WINDOW_MS) {
          const m = measure;
          measure = null;
          m.done(result(m.frames, m.ticks));
        }
      }
    }
  });

  const result = (frames: number[], ticks: number[]) => {
    const f = summarize(frames);
    const t = summarize(ticks);
    const r = {
      ...env(),
      frames: f.samples,
      fpsMedian: round(1000 / f.median),
      fpsLow5: round(1000 / f.p95),
      frameMsMedian: round(f.median),
      frameMsP95: round(f.p95),
      ticks: t.samples,
      tickMsMedian: round(t.median),
      tickMsMax: round(t.max),
      tickMsMean: round(t.mean),
      timerResolutionMs: round(minStep),
    };
    const pass = r.fpsMedian >= PASS.fpsMedian && r.fpsLow5 >= PASS.fpsLow && r.tickMsMedian <= PASS.tickMedianMs;
    return { ...r, pass };
  };

  const startMeasure = (): Promise<Record<string, unknown>> =>
    new Promise((resolve) => {
      scene.fit(x0, y0, x1, y1);
      $("result").style.display = "none";
      log("暖機 5 秒");
      measure = { phase: "warmup", start: performance.now(), frames: [], ticks: [], done: resolve as (r: object) => void };
    });

  const showResult = (r: Record<string, unknown>) => {
    log(`measure ${JSON.stringify(r)}`);
    const box = $("result");
    box.style.display = "block";
    box.innerHTML = "";
    const rows: [string, string, boolean][] = [
      ["fps 中位數", `${r.fpsMedian}（標準 ≥ ${PASS.fpsMedian}）`, (r.fpsMedian as number) >= PASS.fpsMedian],
      ["最慢 5% 的 fps", `${r.fpsLow5}（標準 ≥ ${PASS.fpsLow}）`, (r.fpsLow5 as number) >= PASS.fpsLow],
      ["每 tick 模擬中位數", `${r.tickMsMedian} ms（標準 ≤ ${PASS.tickMedianMs}）`, (r.tickMsMedian as number) <= PASS.tickMedianMs],
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
  };

  $("measure").addEventListener("click", () => {
    void startMeasure().then(showResult);
  });
  $("determinism").addEventListener("click", () => {
    void runDeterminism();
  });

  setInterval(() => {
    if (frameMs.length < 2) return;
    const f = summarize(frameMs);
    const t = summarize(tickMs);
    $("fps").textContent = `fps 中位數 ${round(1000 / f.median)}，最慢 5% ${round(1000 / f.p95)}（最近 ${Math.round((frameAt[frameAt.length - 1] - frameAt[0]) / 1000)} 秒）`;
    $("sim").textContent = `模擬每 tick 中位數 ${round(t.median)} ms，最大 ${round(t.max)} ms`;
  }, 500);

  if (__AUTORUN__) {
    await runDeterminism();
    const r = await startMeasure();
    showResult(r);
    log("done");
  }
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** The four battle spawn squares plus a margin: what the measurement keeps on screen. */
function battleBox(): [number, number, number, number] {
  const xs = SPAWN_BATTLE.map((s) => s[0]);
  const ys = SPAWN_BATTLE.map((s) => s[1]);
  return [Math.min(...xs) - 9, Math.min(...ys) - 9, Math.max(...xs) + 9, Math.max(...ys) + 9];
}

async function runDeterminism(): Promise<void> {
  let expected: Record<string, Record<string, string>> | null = null;
  try {
    const res = await fetch("expected-hashes.json", { cache: "no-store" });
    if (res.ok) expected = await res.json();
  } catch {
    expected = null;
  }
  log(expected === null ? "確定性檢查開始（沒有 CI 對照檔，只列出雜湊）" : "確定性檢查開始");
  const w = newWorker();
  await new Promise<void>((resolve) => {
    let mismatches = 0;
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === "hash") {
        console.log(`SPIKE hash ${m.game} ${m.tick} ${m.hash} ${m.count}`);
        const want = expected?.[m.game]?.[String(m.tick)];
        if (want !== undefined && want !== m.hash) mismatches++;
      } else if (m.type === "game-done") {
        const want = expected?.[m.game]?.[String(m.ticks)];
        const verdict = want === undefined ? "" : mismatches === 0 && want === m.finalHash ? " ✓ 與 CI 相同" : ` ✗ 與 CI 不同（${mismatches} 處）`;
        log(`game ${m.game} ${m.ticks} ticks ${Math.round(m.totalMs)} ms final ${m.finalHash}${verdict}`);
        mismatches = 0;
      } else if (m.type === "determinism-done") {
        w.terminate();
        resolve();
      }
    };
    w.postMessage({ type: "determinism", games: ["scripted", "ai"], ticks: MAX_TICKS } satisfies ToWorker);
  });
}

main().catch((err: unknown) => {
  log(`error ${err instanceof Error ? `${err.message}\n${err.stack}` : String(err)}`);
});
