# Engine spike (throwaway)

Brief: `docs/briefs/2026-10-core-engine-spike.md`. Results go into section 7 of
`docs/research/2026-09-engine-candidates.md`, with the raw data in
`docs/research/2026-09-engine-candidates/`.

Two candidates run the same simulation rules, written once in TypeScript
(`web/src/sim/`, the reference) and ported line by line to GDScript (`godot/sim/`).
This code is not reused by the game; only the approach is.

| Path | What |
|---|---|
| `web/` | TypeScript + PixiJS 8.21 + Capacitor 8.5.2 |
| `godot/` | Godot 4.7.2, Compatibility renderer |
| `tools/` | Placeholder art, simulator run scripts, hash report |
| `site/` | GitHub Pages home and licence pages |

## Simulation rules (both candidates)

Everything that affects the battle is an integer. No `sin`/`cos`/`atan2`/`exp`/`log`/`pow`,
no engine physics, no engine random numbers, no floating-point state.

- **Time**: 20 ticks per second. A 20-minute game is 24,000 ticks.
- **Space**: 176 x 176 cells; 1 cell = 1024 fixed-point units (`x >> 10` is the cell).
- **Random numbers**: xorshift32 (`x ^= x << 13; x ^= x >>> 17; x ^= x << 5`, 32-bit),
  seed 20260930. GDScript masks with `0xFFFFFFFF` after each left shift.
- **Division**: always truncated toward zero (`Math.trunc` in JS, int `/` in GDScript).
- **Map**: blobs of radius 1-4 placed from the random stream until 20 % of the cells are
  blocked, skipping reserved cells (the eight spawn squares with a margin and a radius-6
  circle at the centre). Open cells the centre cannot reach (4-connected) are then
  blocked too, so every open cell is reachable.
- **Units**: 4 teams x 100 (40 melee, 35 ranged, 25 fast). Kept in arrays sorted by ID;
  new IDs are appended and removal keeps the order, so array order is ID order.

  | Type | HP | Attack | Range | Speed per tick | Cooldown |
  |---|---|---|---|---|---|
  | melee | 60 | 6 | 1024 (1 cell) | 51 (1.0 cell/s) | 20 ticks |
  | ranged | 35 | 5 | 5120 (5 cells) | 51 | 20 |
  | fast | 100 | 9 | 1024 | 82 (1.6 cells/s) | 20 |

- **One tick**, in this order:
  1. Apply the commands queued for this tick, in queue order.
  2. Reinforcements (AI game and measurement only): on ticks divisible by 200 (not 0),
     each team, in team order, gets back to 40/35/25; the new units, in type order, take
     the first slots (row by row) of the team's 10 x 10 spawn square.
  3. Bucket units by cell (per-cell linked list, built in ID order).
  4. Decide, per unit in ID order, from start-of-tick state: drop a dead target; an attack
     order forces its target; otherwise re-pick the nearest enemy within 6 cells every
     10 ticks (`(tick + id) % 10 == 0`), ties to the lower ID. With a target: attack when
     within range, else step toward it (16-direction lookup table) unless holding. With a
     move order: stop when within the arrival radius (1 cell + isqrt(group size) x 0.7
     cell), else follow the flow field.
  5. Move: velocity plus separation (every neighbour closer than 0.7 cell in the 3 x 3
     cells pushes 16 units along the 16-direction of the offset, total clamped to +-48 per
     axis), computed from start-of-tick positions; then slide along walls (x first, then y).
  6. Attack, in ID order: cooldown down by one; if attacking and ready, add damage to the
     target and restart the cooldown. Damage is summed, then applied.
  7. Remove units with HP <= 0, keeping ID order.
- **Pathfinding**: a flow field per destination cell. Dijkstra over open cells with
  integer costs (10 straight, 14 diagonal, no diagonal past a blocked orthogonal), using a
  15-bucket ring (Dial). Each cell then points to the neighbour with the lowest
  `dist + step cost`, ties to the lowest direction index; the distances are unique, so
  the field does not depend on queue order. The 16 most recently used fields are cached.
- **Commands**: `{"t": tick, "p": player, "c": "move", "u": [ids], "x": cell, "y": cell}`,
  `"attack"` with `"target": id`, `"stop"`. Controllers (the script, the AI, touch input)
  only push commands; every applied command is logged, and replaying the log without any
  controller reproduces the game.
- **Hash**: every 100 ticks (and at tick 0 and at the end), 32-bit FNV-1a over the bytes of
  int32 little-endian words: tick, unit count, then id, x, y, hp for each unit in ID
  order. Printed as 8 hex digits. The end state is also written out in full and compared
  with sha256.

## The three games

| Game | Spawns | Reinforcements | Driven by | Ends |
|---|---|---|---|---|
| `scripted` | battle (4 sides of the centre) | no | fixed commands | one team left, or 24,000 ticks |
| `ai` | corners | every 10 s | the same rule for all 4 teams | 24,000 ticks |
| `measure` | battle | every 10 s | everyone to the centre after each wave | never (the page measures 30 s) |

The AI only uses map knowledge (spawn positions): every 10 s, staggered by team, it sends
its whole army to one enemy spawn, cycling through the enemies from nearest to farthest.

## Measurement

- fps: the interval between rendered frames. "Slowest 5 %" is the 95th percentile frame
  time converted to fps (>= 30 fps means <= 33.3 ms).
- Simulation: the time of each tick. Median and maximum; the page also shows the mean
  and the smallest non-zero interval seen (timer resolution).
- Window: 5 s warm-up, then 30 s, with the four spawn squares and the centre on screen.

## Running locally

Heavy commands on this machine run under a memory cap, one at a time:

```bash
cd spikes/web
systemd-run --user --scope -q -p MemoryMax=1500M -p MemorySwapMax=0 npm ci
systemd-run --user --scope -q -p MemoryMax=1500M -p MemorySwapMax=0 npm test
systemd-run --user --scope -q -p MemoryMax=1500M -p MemorySwapMax=0 node src/headless.ts --mode scripted --ticks 2000
```

Full 24,000-tick games, builds, exports and the simulators run in CI
(`.github/workflows/spike-web.yml`, `spike-godot.yml`, `spike-pages.yml`).
