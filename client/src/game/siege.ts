// 攻城砲的石頭 (D-099, PROTOCOL.md 3.9, the event `siege_shot`): where a stone is between its
// throw and its landing, for the screen only (the simulation decided where it lands when it was
// thrown, and its damage counts at `lands`). From the engine when it is seen; when only where it
// lands is seen, from `from` (16 directions from the landing towards the engine, ceo 2026-10-22:
// no cells, no distance), FROM_AFAR_CELLS out and high up. With art-v6's effects (siege_stone): from
// the engine's arm (from_m), its arc arc_m + arc_k × the metres between, from_far_m out when unseen
// (StoneLook); without, the numbers below. Pure, for the unit tests.

/** How far out (cells) a stone whose engine is unseen starts, along `from`. */
export const FROM_AFAR_CELLS = 6;
/** Metres up the stone leaves the engine's arm; and starts when it comes from afar. */
export const RELEASE_M = 2.5;
export const AFAR_M = 7;
/** The arc's top over the straight line: this share of the way (metres), at least ARC_MIN_M. */
export const ARC_SHARE = 0.3;
export const ARC_MIN_M = 3;

/** One stone in the air, in cells and metres: thrown at `thrown`, landing at `lands` (ticks); its arc's top over the line, arcM + arcK × metres. */
export interface Stone {
  fromX: number;
  fromY: number;
  fromUpM: number;
  toX: number;
  toY: number;
  thrown: number;
  lands: number;
  arcM?: number;
  arcK?: number;
}

/**
 * The stone as war-game-ui drew it (art-v6 effects `siege_stone`): where it leaves the engine
 * (`fromM`: right, forward, up as the engine faces, metres; both engines' are on its middle line, so
 * a mirrored picture leaves it where it is), its arc, and how far out (metres) one from an unseen
 * engine starts.
 */
export interface StoneLook {
  fromM: [number, number, number];
  arcM: number;
  arcK: number;
  farM: number;
}

/** 16 directions (0 east, 4 south, as the simulation's facing) as a step on the ground, one cell long. */
export function dirStep(d: number): [number, number] {
  const a = ((((d % 16) + 16) % 16) * Math.PI) / 8;
  return [Math.cos(a), Math.sin(a)];
}

/**
 * The stone of a `siege_shot` seen at tick `thrown`: from the engine at (ex, ey) cells when it is
 * seen, else from `from`'s side; null when neither is known (nothing to draw).
 */
export function stoneOf(
  ev: { x: number; y: number; lands: number; from?: number },
  engine: { x: number; y: number; facing?: number } | null,
  thrown: number,
  cellOf: (fixed: number) => number,
  look: StoneLook | null = null,
  metresPerCell = 2,
): Stone | null {
  const toX = cellOf(ev.x);
  const toY = cellOf(ev.y);
  const arc = look === null ? {} : { arcM: look.arcM, arcK: look.arcK };
  if (engine !== null) {
    if (look === null) return { fromX: engine.x, fromY: engine.y, fromUpM: RELEASE_M, toX, toY, thrown, lands: ev.lands };
    // Its arm: forward (and right) of the engine as it faces.
    const [fx, fy] = dirStep(engine.facing ?? 0);
    const [right, forward, up] = look.fromM;
    return { fromX: engine.x + (fx * forward - fy * right) / metresPerCell, fromY: engine.y + (fy * forward + fx * right) / metresPerCell, fromUpM: up, toX, toY, thrown, lands: ev.lands, ...arc };
  }
  if (ev.from === undefined) return null;
  const [sx, sy] = dirStep(ev.from);
  const out = look === null ? FROM_AFAR_CELLS : look.farM / metresPerCell;
  return { fromX: toX + sx * out, fromY: toY + sy * out, fromUpM: AFAR_M, toX, toY, thrown, lands: ev.lands, ...arc };
}

/**
 * Where the stone is at `tick` (fractional): on the ground (cells) and how high (metres), on a
 * parabola over the straight line; null before it is thrown or once it has landed.
 */
export function stoneAt(s: Stone, tick: number, metresPerCell: number): { x: number; y: number; upM: number } | null {
  const span = Math.max(1, s.lands - s.thrown);
  const k = (tick - s.thrown) / span;
  if (k < 0 || k >= 1) return null;
  const x = s.fromX + (s.toX - s.fromX) * k;
  const y = s.fromY + (s.toY - s.fromY) * k;
  const lengthM = Math.hypot(s.toX - s.fromX, s.toY - s.fromY) * metresPerCell;
  const top = s.arcM !== undefined && s.arcK !== undefined ? s.arcM + s.arcK * lengthM : Math.max(ARC_MIN_M, lengthM * ARC_SHARE);
  // From its release height down to the ground, with the arc's bump over the line.
  const upM = s.fromUpM * (1 - k) + 4 * top * k * (1 - k);
  return { x, y, upM };
}
