// The deterministic battle simulation. Units live in parallel typed arrays kept sorted by
// ID (new IDs are appended, removal keeps order), so "for slot 0..count-1" is ID order.
//
// One tick, in this order (spikes/README.md has the full rules):
//   1. apply the commands scheduled for this tick, in queue order
//   2. reinforcements, when enabled, every REINFORCE_EVERY ticks
//   3. bucket units by cell
//   4. decide: pick targets, desired velocity, whether to attack (reads start-of-tick state)
//   5. move: velocity plus separation from start-of-tick neighbours, then wall sliding
//   6. attack: cooldowns, damage summed per target
//   7. apply damage and remove the dead
// The state hash is taken every HASH_EVERY ticks after the tick completes.

import {
  AGGRO_CELLS,
  AGGRO_RANGE,
  ANIM_ATTACK,
  ANIM_IDLE,
  ANIM_MOVE,
  ARRIVE_BASE,
  ARRIVE_PER_SQRT,
  CELL,
  CELL_SHIFT,
  DIR16_X,
  DIR16_Y,
  HASH_EVERY,
  MAP_PX,
  MAP_SIZE,
  MAX_PUSH,
  NO_DIR,
  ORDER_ATTACK,
  ORDER_MOVE,
  ORDER_NONE,
  ORDER_STOP,
  PUSH,
  REINFORCE_EVERY,
  RETARGET_EVERY,
  SEPARATION,
  TEAM_COUNT,
  TEAM_MIX,
  TYPE_ATTACK,
  TYPE_COOLDOWN,
  TYPE_COUNT,
  TYPE_HP,
  TYPE_RANGE,
  TYPE_SPEED,
} from "./constants.ts";
import { FlowFieldCache } from "./flowfield.ts";
import { type GameMap, nearestOpen } from "./map.ts";
import { dir16, fnvWord, FNV_OFFSET, idiv, isqrt } from "./math.ts";

export type Command =
  | { t: number; p: number; c: "move"; u: number[]; x: number; y: number }
  | { t: number; p: number; c: "attack"; u: number[]; target: number }
  | { t: number; p: number; c: "stop"; u: number[] };

export interface SimOptions {
  spawns: number[][];
  reinforce: boolean;
}

const CAPACITY = 1024;

export class Sim {
  readonly map: GameMap;
  readonly fields: FlowFieldCache;
  readonly spawns: number[][];
  readonly reinforce: boolean;
  tick = 0;
  count = 0;
  nextId = 0;

  id = new Int32Array(CAPACITY);
  team = new Int32Array(CAPACITY);
  type = new Int32Array(CAPACITY);
  x = new Int32Array(CAPACITY);
  y = new Int32Array(CAPACITY);
  hp = new Int32Array(CAPACITY);
  cooldown = new Int32Array(CAPACITY);
  target = new Int32Array(CAPACITY);
  order = new Int32Array(CAPACITY);
  dest = new Int32Array(CAPACITY);
  arrive2 = new Int32Array(CAPACITY);
  orderTarget = new Int32Array(CAPACITY);
  anim = new Int32Array(CAPACITY);
  facing = new Int32Array(CAPACITY);

  private vx = new Int32Array(CAPACITY);
  private vy = new Int32Array(CAPACITY);
  private newX = new Int32Array(CAPACITY);
  private newY = new Int32Array(CAPACITY);
  private attacking = new Uint8Array(CAPACITY);
  private damage = new Int32Array(CAPACITY);
  private cellHead = new Int32Array(MAP_SIZE * MAP_SIZE);
  private cellNext = new Int32Array(CAPACITY);
  private idToSlot = new Int32Array(4096).fill(-1);

  /** Commands waiting for their tick, and every command applied so far (the replay log). */
  private queue: Command[] = [];
  readonly log: Command[] = [];

  constructor(map: GameMap, options: SimOptions) {
    this.map = map;
    this.fields = new FlowFieldCache(map);
    this.spawns = options.spawns;
    this.reinforce = options.reinforce;
    for (let t = 0; t < TEAM_COUNT; t++) this.fillTeam(t);
  }

  slotOf(unitId: number): number {
    return unitId >= 0 && unitId < this.idToSlot.length ? this.idToSlot[unitId] : -1;
  }

  aliveByTeam(): number[] {
    const out = [0, 0, 0, 0];
    for (let i = 0; i < this.count; i++) out[this.team[i]]++;
    return out;
  }

  /** IDs of a team's units, optionally of one type, in ID order. */
  unitsOf(team: number, type = -1): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.count; i++) {
      if (this.team[i] === team && (type < 0 || this.type[i] === type)) out.push(this.id[i]);
    }
    return out;
  }

  /** Queue a command. Its tick must not be in the past. */
  push(cmd: Command): void {
    if (cmd.t < this.tick) throw new Error(`command for tick ${cmd.t} arrived at tick ${this.tick}`);
    this.queue.push(cmd);
  }

  step(): void {
    this.applyCommands();
    if (this.reinforce && this.tick > 0 && this.tick % REINFORCE_EVERY === 0) {
      for (let t = 0; t < TEAM_COUNT; t++) this.fillTeam(t);
    }
    this.bucket();
    for (let i = 0; i < this.count; i++) this.decide(i);
    this.move();
    this.attack();
    this.removeDead();
    this.tick++;
  }

  hash(): number {
    let h = FNV_OFFSET;
    h = fnvWord(h, this.tick);
    h = fnvWord(h, this.count);
    for (let i = 0; i < this.count; i++) {
      h = fnvWord(h, this.id[i]);
      h = fnvWord(h, this.x[i]);
      h = fnvWord(h, this.y[i]);
      h = fnvWord(h, this.hp[i]);
    }
    return h;
  }

  shouldHash(): boolean {
    return this.tick % HASH_EVERY === 0;
  }

  /** Full state as text, one unit per line, for an end-of-game sha256 comparison. */
  dump(): string {
    const lines = [`tick ${this.tick} count ${this.count} next ${this.nextId}`];
    for (let i = 0; i < this.count; i++) {
      lines.push(
        [
          this.id[i],
          this.team[i],
          this.type[i],
          this.x[i],
          this.y[i],
          this.hp[i],
          this.cooldown[i],
          this.target[i],
          this.order[i],
          this.dest[i],
          this.orderTarget[i],
        ].join(" "),
      );
    }
    return lines.join("\n") + "\n";
  }

  // --- commands ---------------------------------------------------------------------

  private applyCommands(): void {
    if (this.queue.length === 0) return;
    const later: Command[] = [];
    for (const cmd of this.queue) {
      if (cmd.t !== this.tick) {
        later.push(cmd);
        continue;
      }
      this.apply(cmd);
      this.log.push(cmd);
    }
    this.queue = later;
  }

  private apply(cmd: Command): void {
    const slots: number[] = [];
    for (const uid of cmd.u) {
      const s = this.slotOf(uid);
      if (s >= 0 && this.team[s] === cmd.p) slots.push(s);
    }
    if (cmd.c === "move") {
      const dest = nearestOpen(this.map, cmd.x, cmd.y);
      const r = ARRIVE_BASE + isqrt(slots.length) * ARRIVE_PER_SQRT;
      for (const s of slots) {
        this.order[s] = ORDER_MOVE;
        this.dest[s] = dest;
        this.arrive2[s] = r * r;
        this.target[s] = -1;
      }
    } else if (cmd.c === "attack") {
      for (const s of slots) {
        this.order[s] = ORDER_ATTACK;
        this.orderTarget[s] = cmd.target;
        this.target[s] = -1;
      }
    } else {
      for (const s of slots) {
        this.order[s] = ORDER_STOP;
        this.target[s] = -1;
      }
    }
  }

  // --- spawning ---------------------------------------------------------------------

  /** Top a team up to UNITS_PER_TEAM, keeping the type mix, on its spawn square. */
  private fillTeam(t: number): void {
    const have = [0, 0, 0];
    for (let i = 0; i < this.count; i++) if (this.team[i] === t) have[this.type[i]]++;
    const [cx, cy] = this.spawns[t];
    let slot = 0;
    for (let ty = 0; ty < TYPE_COUNT; ty++) {
      for (let k = have[ty]; k < TEAM_MIX[ty]; k++) {
        const gx = cx - 5 + (slot % 10);
        const gy = cy - 5 + Math.trunc(slot / 10);
        this.addUnit(t, ty, gx * CELL + CELL / 2, gy * CELL + CELL / 2);
        slot++;
      }
    }
  }

  private addUnit(t: number, ty: number, px: number, py: number): void {
    const i = this.count++;
    const uid = this.nextId++;
    if (uid >= this.idToSlot.length) {
      const grown = new Int32Array(this.idToSlot.length * 2).fill(-1);
      grown.set(this.idToSlot);
      this.idToSlot = grown;
    }
    this.idToSlot[uid] = i;
    this.id[i] = uid;
    this.team[i] = t;
    this.type[i] = ty;
    this.x[i] = px;
    this.y[i] = py;
    this.hp[i] = TYPE_HP[ty];
    this.cooldown[i] = 0;
    this.target[i] = -1;
    this.order[i] = ORDER_NONE;
    this.dest[i] = 0;
    this.arrive2[i] = 0;
    this.orderTarget[i] = -1;
    this.anim[i] = ANIM_IDLE;
    this.facing[i] = t === 0 ? 0 : t === 1 ? 4 : t === 2 ? 8 : 12;
  }

  // --- per tick ---------------------------------------------------------------------

  private bucket(): void {
    this.cellHead.fill(-1);
    for (let i = 0; i < this.count; i++) {
      const c = (this.y[i] >> CELL_SHIFT) * MAP_SIZE + (this.x[i] >> CELL_SHIFT);
      this.cellNext[i] = this.cellHead[c];
      this.cellHead[c] = i;
    }
  }

  /** Nearest enemy within AGGRO_RANGE; ties go to the lower ID. Returns a unit ID or -1. */
  private findTarget(i: number): number {
    const cx = this.x[i] >> CELL_SHIFT;
    const cy = this.y[i] >> CELL_SHIFT;
    const x0 = Math.max(cx - AGGRO_CELLS, 0);
    const x1 = Math.min(cx + AGGRO_CELLS, MAP_SIZE - 1);
    const y0 = Math.max(cy - AGGRO_CELLS, 0);
    const y1 = Math.min(cy + AGGRO_CELLS, MAP_SIZE - 1);
    const myTeam = this.team[i];
    const mx = this.x[i];
    const my = this.y[i];
    let best = AGGRO_RANGE * AGGRO_RANGE + 1;
    let bestId = -1;
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        for (let j = this.cellHead[yy * MAP_SIZE + xx]; j >= 0; j = this.cellNext[j]) {
          if (this.team[j] === myTeam) continue;
          const dx = this.x[j] - mx;
          const dy = this.y[j] - my;
          const d2 = dx * dx + dy * dy;
          if (d2 < best || (d2 === best && this.id[j] < bestId)) {
            best = d2;
            bestId = this.id[j];
          }
        }
      }
    }
    return bestId;
  }

  private decide(i: number): void {
    const ty = this.type[i];
    this.vx[i] = 0;
    this.vy[i] = 0;
    this.attacking[i] = 0;

    if (this.target[i] >= 0 && this.slotOf(this.target[i]) < 0) this.target[i] = -1;
    if (this.order[i] === ORDER_ATTACK) {
      if (this.slotOf(this.orderTarget[i]) < 0) {
        this.order[i] = ORDER_NONE;
        this.orderTarget[i] = -1;
      } else {
        this.target[i] = this.orderTarget[i];
      }
    }
    if (this.order[i] !== ORDER_ATTACK && (this.tick + this.id[i]) % RETARGET_EVERY === 0) {
      this.target[i] = this.findTarget(i);
    }

    const tid = this.target[i];
    if (tid >= 0) {
      const ts = this.slotOf(tid);
      const dx = this.x[ts] - this.x[i];
      const dy = this.y[ts] - this.y[i];
      const d2 = dx * dx + dy * dy;
      const k = dir16(dx, dy);
      this.facing[i] = k;
      const range = TYPE_RANGE[ty];
      if (d2 <= range * range) {
        this.attacking[i] = 1;
        this.anim[i] = ANIM_ATTACK;
        return;
      }
      if (this.order[i] !== ORDER_STOP) {
        this.vx[i] = idiv(DIR16_X[k] * TYPE_SPEED[ty], CELL);
        this.vy[i] = idiv(DIR16_Y[k] * TYPE_SPEED[ty], CELL);
        this.anim[i] = ANIM_MOVE;
        return;
      }
      this.anim[i] = ANIM_IDLE;
      return;
    }

    if (this.order[i] === ORDER_MOVE) {
      const dest = this.dest[i];
      const destX = (dest % MAP_SIZE) * CELL + CELL / 2;
      const destY = Math.trunc(dest / MAP_SIZE) * CELL + CELL / 2;
      const dx = destX - this.x[i];
      const dy = destY - this.y[i];
      if (dx * dx + dy * dy <= this.arrive2[i]) {
        this.order[i] = ORDER_NONE;
        this.anim[i] = ANIM_IDLE;
        return;
      }
      const field = this.fields.get(dest, this.tick);
      const c = (this.y[i] >> CELL_SHIFT) * MAP_SIZE + (this.x[i] >> CELL_SHIFT);
      const d = field.dir[c];
      const k = d === NO_DIR ? dir16(dx, dy) : d * 2;
      this.facing[i] = k;
      this.vx[i] = idiv(DIR16_X[k] * TYPE_SPEED[ty], CELL);
      this.vy[i] = idiv(DIR16_Y[k] * TYPE_SPEED[ty], CELL);
      this.anim[i] = ANIM_MOVE;
      return;
    }
    this.anim[i] = ANIM_IDLE;
  }

  private move(): void {
    const n = this.count;
    const blocked = this.map.blocked;
    const sep2 = SEPARATION * SEPARATION;
    const newX = this.newX;
    const newY = this.newY;
    for (let i = 0; i < n; i++) {
      const xi = this.x[i];
      const yi = this.y[i];
      const cx = xi >> CELL_SHIFT;
      const cy = yi >> CELL_SHIFT;
      let px = 0;
      let py = 0;
      for (let yy = cy - 1; yy <= cy + 1; yy++) {
        if (yy < 0 || yy >= MAP_SIZE) continue;
        for (let xx = cx - 1; xx <= cx + 1; xx++) {
          if (xx < 0 || xx >= MAP_SIZE) continue;
          for (let j = this.cellHead[yy * MAP_SIZE + xx]; j >= 0; j = this.cellNext[j]) {
            if (j === i) continue;
            const dx = xi - this.x[j];
            const dy = yi - this.y[j];
            if (dx >= SEPARATION || dx <= -SEPARATION || dy >= SEPARATION || dy <= -SEPARATION) continue;
            if (dx * dx + dy * dy >= sep2) continue;
            const k = dx === 0 && dy === 0 ? (this.id[i] < this.id[j] ? 0 : 8) : dir16(dx, dy);
            px += idiv(DIR16_X[k] * PUSH, CELL);
            py += idiv(DIR16_Y[k] * PUSH, CELL);
          }
        }
      }
      if (px > MAX_PUSH) px = MAX_PUSH;
      if (px < -MAX_PUSH) px = -MAX_PUSH;
      if (py > MAX_PUSH) py = MAX_PUSH;
      if (py < -MAX_PUSH) py = -MAX_PUSH;

      let tx = xi + this.vx[i] + px;
      let ty = yi + this.vy[i] + py;
      if (tx < 0) tx = 0;
      if (tx > MAP_PX - 1) tx = MAP_PX - 1;
      if (ty < 0) ty = 0;
      if (ty > MAP_PX - 1) ty = MAP_PX - 1;
      if (blocked[(yi >> CELL_SHIFT) * MAP_SIZE + (tx >> CELL_SHIFT)] === 1) tx = xi;
      if (blocked[(ty >> CELL_SHIFT) * MAP_SIZE + (tx >> CELL_SHIFT)] === 1) ty = yi;
      newX[i] = tx;
      newY[i] = ty;
    }
    for (let i = 0; i < n; i++) {
      this.x[i] = newX[i];
      this.y[i] = newY[i];
    }
  }

  private attack(): void {
    for (let i = 0; i < this.count; i++) this.damage[i] = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.cooldown[i] > 0) this.cooldown[i]--;
      if (this.attacking[i] === 0 || this.cooldown[i] > 0) continue;
      const ts = this.slotOf(this.target[i]);
      this.damage[ts] += TYPE_ATTACK[this.type[i]];
      this.cooldown[i] = TYPE_COOLDOWN[this.type[i]];
    }
  }

  private removeDead(): void {
    let w = 0;
    for (let r = 0; r < this.count; r++) {
      const hp = this.hp[r] - this.damage[r];
      if (hp <= 0) {
        this.idToSlot[this.id[r]] = -1;
        continue;
      }
      if (w !== r) this.copySlot(r, w);
      this.hp[w] = hp;
      this.idToSlot[this.id[w]] = w;
      w++;
    }
    this.count = w;
  }

  private copySlot(from: number, to: number): void {
    this.id[to] = this.id[from];
    this.team[to] = this.team[from];
    this.type[to] = this.type[from];
    this.x[to] = this.x[from];
    this.y[to] = this.y[from];
    this.hp[to] = this.hp[from];
    this.cooldown[to] = this.cooldown[from];
    this.target[to] = this.target[from];
    this.order[to] = this.order[from];
    this.dest[to] = this.dest[from];
    this.arrive2[to] = this.arrive2[from];
    this.orderTarget[to] = this.orderTarget[from];
    this.anim[to] = this.anim[from];
    this.facing[to] = this.facing[from];
  }
}
