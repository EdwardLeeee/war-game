// One game: world state, fog, the tick order, the command log and the state hash.
//
// Tick order (sim/README.md): AI thinking happens outside, before step(), on the view of
// the previous tick. step() then: 1. applies this tick's commands in queue order;
// 2-3. farmer work and combat decisions (PR-3 adds the economy); 4. movement;
// 5. attacks; 6. deaths; 7-8. production and towns (PR-3, PR-4); 9. tick + 1, then fog
// every FOG_EVERY ticks; 10. time limit. The hash covers all state.

import {
  CELL_SHIFT,
  type Command,
  FOG_EVERY,
  GameOverReason,
  HASH_EVERY,
  MAX_TICKS,
  PLAYER_COUNT,
  type SimEvent,
} from "../protocol.ts";
import { type CommandContext, applyCommand } from "./commands.ts";
import { FNV_OFFSET, fnvBytes, fnvInt32, fnvWord } from "./fixed.ts";
import { Fog } from "./fog.ts";
import { generateMap } from "./map.ts";
import { FieldCache } from "./paths.ts";
import { type ScenarioKey, setupScenario } from "./scenarios.ts";
import { UnitSystem } from "./units.ts";
import { World } from "./world.ts";

export interface GameConfig {
  seed: number;
  scenario: ScenarioKey;
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
    setupScenario(this.w, config.scenario);
    this.fog = new Fog(this.w);
    this.fog.update(this.w);
    this.units = new UnitSystem(this.w.size);
    this.ctx = { w: this.w, fog: this.fog, nextGroup: { value: 0 } };
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

    // 2-6. Decide, move, attack, deaths.
    const hurt = this.units.run(w, this.fog, this.fields);
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
    if (!w.over && w.tick >= MAX_TICKS) {
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
    h = fnvWord(h, w.gridVersion);
    h = fnvInt32(h, w.res);
    h = fnvBytes(h, w.grid);
    h = fnvInt32(h, w.nodeAmount);
    for (const a of [w.townState, w.townOwner, w.townTimer, w.townTimerTotal, w.townRevolt]) h = fnvInt32(h, a);
    h = fnvWord(h, w.units.count);
    for (const name of w.units.names) h = fnvInt32(h, w.units.col[name], w.units.count);
    h = fnvWord(h, w.buildings.count);
    for (const name of w.buildings.names) h = fnvInt32(h, w.buildings.col[name], w.buildings.count);
    const f = this.fog;
    h = fnvWord(h, f.fogTick);
    for (let p = 0; p < PLAYER_COUNT; p++) {
      h = fnvBytes(h, f.visible[p]);
      h = fnvBytes(h, f.explored[p]);
      h = fnvInt32(h, f.nodeSeen[p]);
      h = fnvInt32(h, f.townSeen[p]);
      h = fnvWord(h, f.memory[p].length);
      for (const m of f.memory[p]) for (const v of m) h = fnvWord(h, v);
    }
    // Commands still waiting for a later tick are not state: a replay queues them all at once.
    return h;
  }
}
