// One game: world state, fog, the tick order, the command log and the state hash.
//
// Tick order (sim/README.md): AI thinking happens outside, before step(), on the view of
// the previous tick. step() then: 1. applies this tick's commands in queue order;
// 2. hands idle farmers work (every ECO_EVERY ticks); 3. unit decisions (farmers at work
// by the economy); 4. movement; 5. attacks, then gathering, building, repairing, hiding;
// 6. deaths (a mage's killer picks up crystal); 7. training; 8. towns; 9. tick + 1, then fog every FOG_EVERY ticks;
// 10. the game's time limit (none when 0). The hash covers all state.

import {
  CELL_SHIFT,
  type Command,
  FOG_EVERY,
  GameOverReason,
  HASH_EVERY,
  MAX_TICKS,
  PLAYER_COUNT,
  type SimEvent,
  TOWN_STRIDE,
  TownField,
  UnitType,
} from "../protocol.ts";
import { type CommandContext, applyCommand } from "./commands.ts";
import { Economy } from "./economy.ts";
import { FNV_OFFSET, fnvBytes, fnvInt32, fnvWord } from "./fixed.ts";
import { Fog } from "./fog.ts";
import { generateMap } from "./map.ts";
import { FieldCache } from "./paths.ts";
import { CAVALRY, COUNTER_ATTACK, GARRISON, PLUNDER_RECOVERY, START_REVEAL, TOWN_ONCE } from "./rules.ts";
import { TownSystem } from "./towns.ts";
import { autoTrain, mainCityCrystal } from "./training.ts";
import { type ScenarioKey, setupScenario } from "./scenarios.ts";
import { UnitSystem } from "./units.ts";
import { UNIT_HASH_SKIP, UNIT_KINDS, World } from "./world.ts";

export interface GameConfig {
  seed: number;
  scenario: ScenarioKey;
  /** Time limit in ticks, 0 = none (a game a person plays). Absent: MAX_TICKS. */
  maxTicks?: number;
  /** Per player: its barracks, ranges and mage halls start with automatic training on (round 6, D-054). Absent: all off. */
  autoTrain?: boolean[];
}

/** An event and who gets it: a player, or -1 for everyone. */
export interface Outgoing {
  to: number;
  ev: SimEvent;
}

/** "attacked" events: at most one per 8 x 8-cell block per 60 ticks per player. */
const ATTACK_BLOCK = 3;
const ATTACK_EVERY = 60;

export class Game {
  readonly config: GameConfig;
  readonly w: World;
  readonly fog: Fog;
  readonly fields = new FieldCache();
  readonly econ: Economy;
  private readonly towns: TownSystem;
  private readonly units: UnitSystem;
  private readonly ctx: CommandContext;
  private queue: Command[] = [];
  /** Every command applied so far, including rejected ones, in application order. */
  readonly log: Command[] = [];
  /** Events of the last step. */
  events: Outgoing[] = [];
  private lastAttacked: Int32Array[] = [];

  constructor(config: GameConfig) {
    this.config = config;
    const map = generateMap();
    this.w = new World(map);
    for (let p = 0; p < PLAYER_COUNT; p++) this.w.autoTrain[p] = config.autoTrain?.[p] === true ? 1 : 0;
    setupScenario(this.w, config.scenario);
    this.fog = new Fog(this.w);
    this.fog.reveal(this.w, START_REVEAL);
    this.fog.update(this.w);
    this.units = new UnitSystem(this.w.size);
    this.econ = new Economy(this.w, this.fog, (to, ev) => this.events.push({ to, ev }));
    this.towns = new TownSystem(this.fog, (to, ev) => this.events.push({ to, ev }));
    this.ctx = { w: this.w, fog: this.fog, econ: this.econ, nextGroup: { value: 0 } };
    const perRow = Math.ceil(this.w.size / (1 << ATTACK_BLOCK));
    const blocks = perRow * perRow;
    for (let p = 0; p < PLAYER_COUNT; p++) this.lastAttacked.push(new Int32Array(blocks).fill(-ATTACK_EVERY));
  }

  get tick(): number {
    return this.w.tick;
  }

  /** Queue a command for its tick (which must not have run yet). */
  push(cmd: Command): void {
    if (cmd.t < this.w.tick) throw new Error(`command for tick ${cmd.t} arrived at tick ${this.w.tick}`);
    this.queue.push(cmd);
  }

  step(): void {
    const w = this.w;
    this.events = [];
    if (w.over) return;

    // 1. Commands for this tick, in queue order.
    const later: Command[] = [];
    for (const cmd of this.queue) {
      if (cmd.t !== w.tick) {
        later.push(cmd);
        continue;
      }
      const reason = applyCommand(this.ctx, cmd);
      this.log.push(cmd);
      if (reason !== 0) this.events.push({ to: cmd.p, ev: { k: "rejected", seq: cmd.seq, reason: reason as never } });
    }
    this.queue = later;

    // 2. Idle farmers get work.
    this.econ.periodic(w);
    // 3-6. Decide, move, attack, work, deaths.
    const hurt = this.units.run(w, this.fog, this.fields, this.econ);
    this.econ.workTick(w);
    this.units.removeDead(w, (s) => this.econ.release(w, s), (to, ev) => this.events.push({ to, ev }));
    // 7. Training, then automatic training queues the next unit where a queue emptied; the
    // main cities' crystal.
    this.econ.produce(w);
    autoTrain(w);
    mainCityCrystal(w);
    // 8. Towns.
    this.towns.step(w);
    const n = w.size;
    const perRow = Math.ceil(n / (1 << ATTACK_BLOCK));
    for (const h of hurt) {
      if (h.owner < 0 || h.owner >= PLAYER_COUNT) continue;
      const block = ((h.y >> CELL_SHIFT) >> ATTACK_BLOCK) * perRow + ((h.x >> CELL_SHIFT) >> ATTACK_BLOCK);
      const last = this.lastAttacked[h.owner];
      if (w.tick - last[block] < ATTACK_EVERY) continue;
      last[block] = w.tick;
      this.events.push({ to: h.owner, ev: { k: "attacked", x: h.x, y: h.y, target: h.id } });
    }

    w.tick++;
    // 9. Fog.
    if (w.tick % FOG_EVERY === 0) this.fog.update(w);
    // 10. Time limit, then the game-over event.
    const limit = this.config.maxTicks ?? MAX_TICKS;
    if (!w.over && limit > 0 && w.tick >= limit) {
      w.winner = -1;
      w.endReason = GameOverReason.TimeLimit;
    }
    if (w.over) {
      this.events.push({ to: -1, ev: { k: "game_over", winner: w.winner, reason: w.endReason as never } });
    }
  }

  shouldHash(): boolean {
    return this.w.tick % HASH_EVERY === 0;
  }

  /** FNV-1a over all simulation state, in a fixed order. */
  hash(): number {
    const w = this.w;
    let h = FNV_OFFSET;
    h = fnvWord(h, w.tick);
    h = fnvWord(h, w.nextId);
    h = fnvWord(h, this.ctx.nextGroup.value);
    h = fnvWord(h, w.winner);
    h = fnvWord(h, w.endReason);
    h = fnvWord(h, w.blockVersion);
    h = fnvWord(h, w.openVersion);
    h = fnvWord(h, w.dropVersion);
    h = fnvInt32(h, w.res);
    h = fnvInt32(h, w.ecoRatio);
    h = fnvBytes(h, w.ecoOn);
    h = fnvBytes(h, w.recall);
    h = fnvInt32(h, w.gathered);
    // Cavalry's counts (round 7) only while CAVALRY is on: off, the words are the old ones.
    for (const a of [w.trained, w.lost]) {
      if (CAVALRY.on) h = fnvInt32(h, a);
      else for (let p = 0; p < PLAYER_COUNT; p++) for (let t = 0; t < UnitType.Cavalry; t++) h = fnvWord(h, a[p * UNIT_KINDS + t]);
    }
    h = fnvBytes(h, w.grid);
    h = fnvInt32(h, w.nodeAmount);
    for (const a of [w.townState, w.townOwner, w.townTimer, w.townTimerTotal, w.townRevolt, w.townContested, w.townAcc]) h = fnvInt32(h, a);
    h = fnvInt32(h, w.plundered);
    h = fnvInt32(h, w.governed);
    h = fnvInt32(h, w.cannonShots);
    h = fnvInt32(h, w.cannonHits);
    for (const a of [w.plunderIncome, w.governChosen, w.governCost, w.townIncome, w.governedTicks, w.governEnded, w.governPaidBack, w.townSpellCost, w.townSpellIncome]) {
      h = fnvInt32(h, a);
    }
    h = fnvWord(h, w.firstCapture);
    // Round 7 town state (D-061), only while its rules are on.
    if (TOWN_ONCE.on || PLUNDER_RECOVERY.on) h = fnvInt32(h, w.townPlundered);
    if (PLUNDER_RECOVERY.on) h = fnvInt32(h, w.townRecover);
    h = fnvWord(h, w.units.count);
    for (const name of w.units.names) {
      if (UNIT_HASH_SKIP.has(name) || (name === "hitById" && !COUNTER_ATTACK.on)) continue;
      h = fnvInt32(h, w.units.col[name], w.units.count);
    }
    h = fnvWord(h, w.buildings.count);
    for (const name of w.buildings.names) {
      if (name === "soldiers" && !GARRISON.on) continue;
      h = fnvInt32(h, w.buildings.col[name], w.buildings.count);
    }
    const f = this.fog;
    h = fnvWord(h, f.fogTick);
    for (let p = 0; p < PLAYER_COUNT; p++) {
      h = fnvBytes(h, f.visible[p]);
      h = fnvBytes(h, f.explored[p]);
      h = fnvInt32(h, f.nodeSeen[p]);
      // Town rows as last seen; their income column (round 7) only while PLUNDER_RECOVERY is on.
      const seen = f.townSeen[p];
      for (let t = 0; t * TOWN_STRIDE < seen.length; t++) {
        h = fnvInt32(h, seen.subarray(t * TOWN_STRIDE, (t + 1) * TOWN_STRIDE), PLUNDER_RECOVERY.on ? TOWN_STRIDE : TownField.incomePermille);
      }
      h = fnvWord(h, f.memory[p].length);
      for (const m of f.memory[p]) for (const v of m) h = fnvWord(h, v);
    }
    // Commands still waiting for a later tick are not state: a replay queues them all at once.
    return h;
  }
}
