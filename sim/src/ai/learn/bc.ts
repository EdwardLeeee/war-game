// D-086 B training, step 1: behaviour cloning. A network learns to make hard's own choices from the same
// inputs (recorded by worker.ts from hard's own view), in floating point (training only: learn/ is never in
// the game), then becomes the integer network the game runs (net.ts): 8-bit weights, 32-bit sums, a right
// shift per layer chosen from the recorded inputs. What counts is how often the integer network makes
// hard's choice on games it was not trained on (ceo 2026-10-19).

import { choose, NET_HEADS, NET_INPUTS, NET_SHAPE, type NetLayer, type NetWeights } from "../net.ts";

/** A sample: NET_INPUTS inputs, then one label per head (-1: none). */
export type Sample = number[];

export interface FloatNet {
  /** Per layer: weights (outputs x inputs) and biases, for inputs scaled to 0..1 (x / 255). */
  w: Float64Array[];
  b: Float64Array[];
}

/** A small seeded generator for training (not the game's: learn/ never runs in a game). */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

export function initFloat(seed: number): FloatNet {
  const r = rng(seed);
  const w: Float64Array[] = [];
  const b: Float64Array[] = [];
  for (let l = 0; l + 1 < NET_SHAPE.length; l++) {
    const n = NET_SHAPE[l];
    const m = NET_SHAPE[l + 1];
    const a = Math.sqrt(6 / (n + m));
    w.push(Float64Array.from({ length: n * m }, () => (r() * 2 - 1) * a));
    b.push(new Float64Array(m));
  }
  return { w, b };
}

/** Forward pass in floating point; every layer's outputs (the last without ReLU). */
function forwardF(net: FloatNet, x: Float64Array): Float64Array[] {
  const acts: Float64Array[] = [x];
  for (let l = 0; l < net.w.length; l++) {
    const n = NET_SHAPE[l];
    const m = NET_SHAPE[l + 1];
    const a = acts[l];
    const o = new Float64Array(m);
    for (let j = 0; j < m; j++) {
      let s = net.b[l][j];
      for (let i = 0; i < n; i++) s += net.w[l][j * n + i] * a[i];
      o[j] = l + 1 < net.w.length && s < 0 ? 0 : s;
    }
    acts.push(o);
  }
  return acts;
}

/**
 * Per head, a weight for each choice: hard's choices are lopsided (at home it waits at nearly every think and
 * marches at a few), so each choice counts as if all were equally common, at most `cap` times a sample.
 */
export function classWeights(data: Sample[], cap = 50): number[][] {
  return NET_HEADS.map((k, h) => {
    const n = new Array(k).fill(0);
    for (const s of data) if (s[NET_INPUTS + h] >= 0) n[s[NET_INPUTS + h]]++;
    const total = n.reduce((a, b) => a + b, 0);
    return n.map((c) => (c === 0 ? 0 : Math.min(cap, total / (k * c))));
  });
}

/** Adam on the summed cross-entropy of the heads that have a label, each choice weighted (classWeights). */
export function trainFloat(data: Sample[], opt: { epochs: number; lr: number; batch: number; seed: number; cap?: number }, log: (s: string) => void = () => {}): FloatNet {
  const net = initFloat(opt.seed);
  const weight = classWeights(data, opt.cap ?? 50);
  const r = rng(opt.seed + 1);
  const L = net.w.length;
  const mw = net.w.map((x) => new Float64Array(x.length));
  const vw = net.w.map((x) => new Float64Array(x.length));
  const mb = net.b.map((x) => new Float64Array(x.length));
  const vb = net.b.map((x) => new Float64Array(x.length));
  let step = 0;
  const order = data.map((_, i) => i);
  for (let e = 0; e < opt.epochs; e++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    let loss = 0;
    for (let at = 0; at < order.length; at += opt.batch) {
      const gw = net.w.map((x) => new Float64Array(x.length));
      const gb = net.b.map((x) => new Float64Array(x.length));
      const end = Math.min(order.length, at + opt.batch);
      for (let k = at; k < end; k++) {
        const s = data[order[k]];
        const x = Float64Array.from(s.slice(0, NET_INPUTS), (v) => v / 255);
        const acts = forwardF(net, x);
        const y = acts[L];
        // dLoss/dy: softmax minus one-hot, per head with a label.
        let delta = new Float64Array(y.length);
        let off = 0;
        NET_HEADS.forEach((kk, h) => {
          const label = s[NET_INPUTS + h];
          if (label >= 0) {
            const wt = weight[h][label];
            let mx = -Infinity;
            for (let i = 0; i < kk; i++) mx = Math.max(mx, y[off + i]);
            let z = 0;
            for (let i = 0; i < kk; i++) z += Math.exp(y[off + i] - mx);
            for (let i = 0; i < kk; i++) {
              const p = Math.exp(y[off + i] - mx) / z;
              delta[off + i] = wt * (p - (i === label ? 1 : 0));
              if (i === label) loss -= wt * Math.log(Math.max(p, 1e-12));
            }
          }
          off += kk;
        });
        for (let l = L - 1; l >= 0; l--) {
          const n = NET_SHAPE[l];
          const m = NET_SHAPE[l + 1];
          const a = acts[l];
          const back = new Float64Array(n);
          for (let j = 0; j < m; j++) {
            const d = delta[j];
            if (d === 0) continue;
            gb[l][j] += d;
            for (let i = 0; i < n; i++) {
              gw[l][j * n + i] += d * a[i];
              back[i] += d * net.w[l][j * n + i];
            }
          }
          if (l > 0) for (let i = 0; i < n; i++) if (acts[l][i] <= 0) back[i] = 0;
          delta = back;
        }
      }
      step++;
      const scale = 1 / (end - at);
      const upd = (p: Float64Array, g: Float64Array, m: Float64Array, v: Float64Array) => {
        for (let i = 0; i < p.length; i++) {
          const gi = g[i] * scale;
          m[i] = 0.9 * m[i] + 0.1 * gi;
          v[i] = 0.999 * v[i] + 0.001 * gi * gi;
          p[i] -= (opt.lr * (m[i] / (1 - 0.9 ** step))) / (Math.sqrt(v[i] / (1 - 0.999 ** step)) + 1e-8);
        }
      };
      for (let l = 0; l < L; l++) {
        upd(net.w[l], gw[l], mw[l], vw[l]);
        upd(net.b[l], gb[l], mb[l], vb[l]);
      }
    }
    log(`epoch ${e + 1}: loss per sample ${(loss / data.length).toFixed(4)}`);
  }
  return net;
}

/**
 * The integer network: each layer's weights to -127..127 with one scale per layer; each hidden layer's
 * right shift so that its outputs (the 99th percentile on `calib`) come out near 255 of 0..255.
 */
export function quantize(net: FloatNet, calib: Sample[]): NetWeights {
  const layers: NetLayer[] = [];
  // The integer inputs of layer l are the float inputs times inScale (layer 0: x / 255 in float, x in integers).
  let inScale = 255;
  const samples = calib.slice(0, 4000).map((s) => s.slice(0, NET_INPUTS));
  let ints = samples;
  for (let l = 0; l < net.w.length; l++) {
    const n = NET_SHAPE[l];
    const m = NET_SHAPE[l + 1];
    const last = l + 1 === net.w.length;
    // Float weight w acts on the float input a = int / inScale: w * a = (w / inScale) * int.
    let mx = 0;
    for (const v of net.w[l]) mx = Math.max(mx, Math.abs(v / inScale));
    const ws = mx > 0 ? mx / 127 : 1;
    const w = Array.from(net.w[l], (v) => Math.max(-127, Math.min(127, Math.round(v / inScale / ws))));
    const b = Array.from(net.b[l], (v) => Math.round(v / ws));
    // Integer sums are float pre-activations / ws; pick the shift from the sums on the calibration inputs.
    const sums: number[] = [];
    const next: number[][] = [];
    for (const x of ints) {
      const o: number[] = [];
      for (let j = 0; j < m; j++) {
        let acc = b[j];
        for (let i = 0; i < n; i++) acc += w[j * n + i] * x[i];
        o.push(acc);
        if (!last && acc > 0) sums.push(acc);
      }
      next.push(o);
    }
    let shift = 0;
    if (!last) {
      sums.sort((a, c) => a - c);
      const p99 = sums.length === 0 ? 255 : sums[Math.min(sums.length - 1, Math.floor(sums.length * 0.99))];
      while (shift < 24 && p99 >> shift > 255) shift++;
      ints = next.map((o) => o.map((v) => (v <= 0 ? 0 : Math.min(255, v >> shift))));
      // The next layer's float inputs are these integers times ws * 2^shift.
      inScale = 1 / (ws * 2 ** shift);
    }
    layers.push({ inputs: n, outputs: m, w, b, shift });
  }
  return { layers };
}

/**
 * Per head and per choice of hard's: of the samples with that label, how many the integer network chooses the
 * same (same[h][c] of of[h][c]).
 */
export function agreement(net: NetWeights, data: Sample[]): { same: number[][]; of: number[][] } {
  const same = NET_HEADS.map((k) => new Array(k).fill(0));
  const of = NET_HEADS.map((k) => new Array(k).fill(0));
  for (const s of data) {
    const c = choose(net, s.slice(0, NET_INPUTS));
    NET_HEADS.forEach((_, h) => {
      const label = s[NET_INPUTS + h];
      if (label < 0) return;
      of[h][label]++;
      if (c[h] === label) same[h][label]++;
    });
  }
  return { same, of };
}
