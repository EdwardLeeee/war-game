// D-086 B: a small neural network for the hard AI's big-picture choices (docs/research/2026-10-ai-nn.md).
// Off unless HardPlan.net holds weights. Integers only, so every device plays the same game (AGENTS.md):
// 8-bit weights, sums in 32-bit integers, ReLU, a right shift to scale, and the highest score in each
// head (the lowest index on a tie); no floating point, no Math functions.
//
// The inputs are what the hard AI already knows: its own PlayerView and its memory of enemy soldiers it
// has seen (NetState, filled by ai.ts from those alone). The network only chooses, at each think, and the
// first choice of every head is AS_HARD, hard's own rule (ceo 2026-10-19): a network that always makes it
// plays exactly as hard, and what it learns is when to do otherwise.
//   - army: as hard / wait at home / march on the enemy's main city (HEAD_ARMY);
//   - mix: as hard / spearmen first / ranged first (HEAD_MIX);
//   - build: as hard / farmers first / barracks and ranges first (HEAD_BUILD);
//   - town: as hard / plunder / govern a town it takes for the first time (HEAD_TOWN);
//   - defense (NN v2, ceo 2026-10-29): as hard / an arrow tower next, saved up for, by its main city or a town
//     it governs / no arrow tower now (HEAD_DEFENSE).
// How soldiers walk and fight stays the hard AI's.

/** Each head's choices, in the order of the network's outputs; choice AS_HARD (0) is hard's own rule. */
export const NET_HEADS: readonly number[] = [3, 3, 3, 3, 3];
export const HEAD_ARMY = 0;
export const HEAD_MIX = 1;
export const HEAD_BUILD = 2;
export const HEAD_TOWN = 3;
export const HEAD_DEFENSE = 4;
export const AS_HARD = 0;
export const ARMY_HOME = 1;
export const ARMY_BASE = 2;
export const MIX_SPEAR = 1;
export const MIX_RANGED = 2;
export const BUILD_FARMERS = 1;
export const BUILD_PRODUCTION = 2;
export const TOWN_PLUNDER = 1;
export const TOWN_GOVERN = 2;
export const DEFENSE_TOWER = 1;
export const DEFENSE_NONE = 2;

/** One layer: outputs x inputs weights (-128..127, row by row), a 32-bit bias per output, the right shift after ReLU. */
export interface NetLayer {
  inputs: number;
  outputs: number;
  w: readonly number[];
  b: readonly number[];
  shift: number;
}
/** Hidden layers then the output layer (no ReLU there); the output layer has NET_HEADS' sum outputs. */
export interface NetWeights {
  layers: readonly NetLayer[];
}

/** What the hard AI knows at a think, from its own view and memory (ai.ts fills it). */
export interface NetState {
  tick: number;
  food: number;
  wood: number;
  gold: number;
  crystal: number;
  pop: number;
  cap: number;
  ceiling: number;
  farmers: number;
  spear: number;
  ranged: number;
  mages: number;
  cavalry: number;
  /** Finished barracks, ranges, mage halls, stables, houses, farms, lumber camps, mines, arrow towers. */
  buildings: readonly number[];
  /** Its soldiers' worth (WORTH), at home (near its main city) and away. */
  worth: number;
  home: number;
  away: number;
  cityHp: number;
  /** Enemy soldiers it remembers (spearmen, ranged, mages, cavalry), their worth, and those near its main city now. */
  enemy: readonly number[];
  enemyWorth: number;
  enemyNear: number;
  /** The enemy's main city: known (0/1), its hp when last seen; enemy forts it knows. */
  enemyCityKnown: number;
  enemyCityHp: number;
  enemyForts: number;
  /** Towns as it sees them: its own (governed or repairing), being plundered or awaiting its choice, the enemy's, neutral, ruins. */
  towns: readonly number[];
  /** Cells to the nearest neutral town it knows (-1: none). */
  townDist: number;
  /** 0 home, 1 town, 2 base, 3 defend, 4 raze. */
  mode: number;
  /** Its soldiers lost, and enemy soldiers it saw fall, in the last two minutes. */
  lost: number;
  killed: number;
}

/** Input count (features' length). */
export const NET_INPUTS = 48;

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

/** The network's inputs: each a whole number 0..255. */
export function features(s: NetState): number[] {
  const x: number[] = [
    clamp(s.tick / 1200),
    clamp(s.food >> 4),
    clamp(s.wood >> 4),
    clamp(s.gold >> 4),
    clamp(s.crystal >> 2),
    clamp(s.pop),
    clamp(s.cap),
    clamp(s.ceiling >> 1),
    clamp(s.farmers),
    clamp(s.spear),
    clamp(s.ranged),
    clamp(s.mages * 8),
    clamp(s.cavalry),
  ];
  for (const b of s.buildings) x.push(clamp(b * 8));
  x.push(clamp(s.worth >> 3), clamp(s.home), clamp(s.away), clamp(s.cityHp >> 3));
  for (const e of s.enemy) x.push(clamp(e));
  x.push(clamp(s.enemyWorth >> 3), clamp(s.enemyNear), clamp(s.enemyCityKnown * 255), clamp(s.enemyCityHp >> 3), clamp(s.enemyForts * 16));
  for (const t of s.towns) x.push(clamp(t * 32));
  x.push(s.townDist < 0 ? 255 : clamp(s.townDist));
  for (let m = 0; m < 5; m++) x.push(s.mode === m ? 255 : 0);
  x.push(clamp(s.lost), clamp(s.killed));
  return x;
}

/** The output layer's scores for inputs x (each 0..255). Integers only. */
export function forward(net: NetWeights, x: readonly number[]): number[] {
  let a: readonly number[] = x;
  for (let l = 0; l < net.layers.length; l++) {
    const L = net.layers[l];
    const last = l === net.layers.length - 1;
    const out: number[] = new Array(L.outputs);
    for (let o = 0; o < L.outputs; o++) {
      let acc = L.b[o] | 0;
      const row = o * L.inputs;
      for (let i = 0; i < L.inputs; i++) acc = (acc + L.w[row + i] * a[i]) | 0;
      out[o] = last ? acc : clamp(acc < 0 ? 0 : acc >> L.shift);
    }
    a = out;
  }
  return a as number[];
}

/**
 * Each head's choice: the highest score among the choices `allowed` lets it make (all of them when it is
 * absent; one flag per output, in the outputs' order), the lowest index on a tie. A head with none allowed
 * makes its first choice.
 */
export function choose(net: NetWeights, x: readonly number[], allowed?: readonly boolean[]): number[] {
  const y = forward(net, x);
  const out: number[] = [];
  let at = 0;
  for (const k of NET_HEADS) {
    let best = -1;
    for (let i = 0; i < k; i++) {
      if (allowed !== undefined && !allowed[at + i]) continue;
      if (best < 0 || y[at + i] > y[at + best]) best = i;
    }
    out.push(best < 0 ? 0 : best);
    at += k;
  }
  return out;
}

/** Layer sizes of the network trained in learn/ (NET_INPUTS in, the heads out). */
export const NET_SHAPE: readonly number[] = [NET_INPUTS, 32, 16, NET_HEADS.reduce((a, b) => a + b, 0)];
/**
 * NN v2 (ceo 2026-10-30): the hidden layers' right shift. With 8 and the small weights the training reaches
 * (+-4 steps, means of +-1), the second layer was always 0 and every choice came from the output biases alone
 * (40 random candidates on 400 thinks of real games: 5 of 40 chose by the game, means 0 of 40); with 4, 40 and
 * 40, the first layer at 255 on 1% of thinks. Each network keeps its own shifts in its weights.
 */
export const NET_SHIFT = 4;

/** The network that plays exactly as hard: every weight 0, each head's AS_HARD output biased to 1 (training starts here). */
export function asHardNet(): NetWeights {
  const layers: NetLayer[] = [];
  for (let l = 0; l + 1 < NET_SHAPE.length; l++) {
    const inputs = NET_SHAPE[l];
    const outputs = NET_SHAPE[l + 1];
    const b: number[] = new Array(outputs).fill(0);
    if (l + 2 === NET_SHAPE.length) {
      let at = 0;
      for (const k of NET_HEADS) {
        b[at + AS_HARD] = 1;
        at += k;
      }
    }
    layers.push({ inputs, outputs, w: new Array(inputs * outputs).fill(0), b, shift: NET_SHIFT });
  }
  return { layers };
}
