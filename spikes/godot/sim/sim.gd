extends RefCounted
## The deterministic battle simulation: a line-by-line port of spikes/web/src/sim/
## (constants.ts, math.ts, map.ts, flowfield.ts, sim.ts). The TypeScript version is the
## reference; spikes/README.md has the rules. Integers only; GDScript ints are 64-bit, so
## 32-bit results are masked with 0xFFFFFFFF, and int division truncates toward zero like
## Math.trunc in the reference.

const TICKS_PER_SECOND := 20
const CELL := 1024
const CELL_SHIFT := 10
const MAP_SIZE := 176
const MAP_PX := MAP_SIZE * CELL
const MAP_SEED := 20260930
const OBSTACLE_PERCENT := 20
const TEAM_COUNT := 4
const HASH_EVERY := 100
const MAX_TICKS := 24000
const REINFORCE_EVERY := 200
const RETARGET_EVERY := 10
const AI_THINK_EVERY := 200
const AGGRO_RANGE := 6 * CELL
const AGGRO_CELLS := 6
const UNIT_RADIUS := 358
const SEPARATION := 2 * UNIT_RADIUS
const PUSH := 16
const MAX_PUSH := 48
const ARRIVE_BASE := CELL
const ARRIVE_PER_SQRT := 717

const TYPE_MELEE := 0
const TYPE_RANGED := 1
const TYPE_FAST := 2
const TYPE_COUNT := 3
const TYPE_HP := [60, 35, 100]
const TYPE_ATTACK := [6, 5, 9]
const TYPE_RANGE := [1024, 5120, 1024]
const TYPE_SPEED := [51, 51, 82]
const TYPE_COOLDOWN := [20, 20, 20]
const TEAM_MIX := [40, 35, 25]

const ORDER_NONE := 0
const ORDER_MOVE := 1
const ORDER_ATTACK := 2
const ORDER_STOP := 3
const ANIM_IDLE := 0
const ANIM_MOVE := 1
const ANIM_ATTACK := 2

const CENTER := 88
const SPAWN_BATTLE := [[72, 88], [88, 72], [104, 88], [88, 104]]
const SPAWN_CORNER := [[24, 24], [152, 24], [152, 152], [24, 152]]

const DIR8_DX := [1, 1, 0, -1, -1, -1, 0, 1]
const DIR8_DY := [0, 1, 1, 1, 0, -1, -1, -1]
const DIR8_COST := [10, 14, 10, 14, 10, 14, 10, 14]
const DIR16_X := [1024, 946, 724, 392, 0, -392, -724, -946, -1024, -946, -724, -392, 0, 392, 724, 946]
const DIR16_Y := [0, 392, 724, 946, 1024, 946, 724, 392, 0, -392, -724, -946, -1024, -946, -724, -392]
const DIR16_TAN := [204, 684, 1533, 5148]
const NO_DIR := 255
const INF := 0x3fffffff
const RING := 15
const CACHE_SIZE := 16
const CAPACITY := 1024
const FNV_OFFSET := 2166136261
const FNV_PRIME := 16777619


# --- integer helpers (math.ts) ------------------------------------------------------

static func isqrt(n: int) -> int:
	var r := 0
	while (r + 1) * (r + 1) <= n:
		r += 1
	return r


static func dir16(dx: int, dy: int) -> int:
	if dx == 0 and dy == 0:
		return 0
	var ax := -dx if dx < 0 else dx
	var ay := -dy if dy < 0 else dy
	var s := ay * 1024
	var q := 4
	if s < ax * 204:
		q = 0
	elif s < ax * 684:
		q = 1
	elif s < ax * 1533:
		q = 2
	elif s < ax * 5148:
		q = 3
	if dx >= 0:
		return q if dy >= 0 else (16 - q) % 16
	return 8 - q if dy >= 0 else 8 + q


class Rng:
	var state: int

	func _init(s: int) -> void:
		state = s & 0xFFFFFFFF
		if state == 0:
			state = 1

	func next() -> int:
		var x := state
		x ^= (x << 13) & 0xFFFFFFFF
		x ^= x >> 17
		x ^= (x << 5) & 0xFFFFFFFF
		state = x
		return x

	func below(n: int) -> int:
		return next() % n


static func fnv_word(h: int, v: int) -> int:
	h = ((h ^ (v & 255)) * FNV_PRIME) & 0xFFFFFFFF
	h = ((h ^ ((v >> 8) & 255)) * FNV_PRIME) & 0xFFFFFFFF
	h = ((h ^ ((v >> 16) & 255)) * FNV_PRIME) & 0xFFFFFFFF
	h = ((h ^ ((v >> 24) & 255)) * FNV_PRIME) & 0xFFFFFFFF
	return h


static func hex8(h: int) -> String:
	return "%08x" % h


# --- map (map.ts) -------------------------------------------------------------------

static func generate_map(map_seed: int) -> PackedByteArray:
	var n := MAP_SIZE
	var rng := Rng.new(map_seed)
	var blocked := PackedByteArray()
	blocked.resize(n * n)
	var reserved := PackedByteArray()
	reserved.resize(n * n)
	for spawn in SPAWN_BATTLE + SPAWN_CORNER:
		var cx: int = spawn[0]
		var cy: int = spawn[1]
		for y in range(cy - 7, cy + 7):
			for x in range(cx - 7, cx + 7):
				if x >= 0 and y >= 0 and x < n and y < n:
					reserved[y * n + x] = 1
	for dy in range(-6, 7):
		for dx in range(-6, 7):
			if dx * dx + dy * dy <= 36:
				reserved[(CENTER + dy) * n + CENTER + dx] = 1

	var target := n * n * OBSTACLE_PERCENT / 100
	var count := 0
	while count < target:
		var cx := rng.below(n)
		var cy := rng.below(n)
		var r := 1 + rng.below(4)
		for dy in range(-r, r + 1):
			for dx in range(-r, r + 1):
				if dx * dx + dy * dy > r * r:
					continue
				var x := cx + dx
				var y := cy + dy
				if x < 0 or y < 0 or x >= n or y >= n:
					continue
				var i := y * n + x
				if reserved[i] == 1 or blocked[i] == 1:
					continue
				blocked[i] = 1
				count += 1

	var seen := PackedByteArray()
	seen.resize(n * n)
	var queue := PackedInt32Array()
	queue.resize(n * n)
	var head := 0
	var tail := 0
	var start := CENTER * n + CENTER
	seen[start] = 1
	queue[tail] = start
	tail += 1
	while head < tail:
		var c := queue[head]
		head += 1
		var x := c % n
		var y := c / n
		for nb in [c + 1 if x + 1 < n else -1, c - 1 if x > 0 else -1, c + n if y + 1 < n else -1, c - n if y > 0 else -1]:
			if nb < 0 or blocked[nb] == 1 or seen[nb] == 1:
				continue
			seen[nb] = 1
			queue[tail] = nb
			tail += 1
	for i in n * n:
		if blocked[i] == 0 and seen[i] == 0:
			blocked[i] = 1
	return blocked


static func nearest_open(blocked: PackedByteArray, x: int, y: int) -> int:
	var n := MAP_SIZE
	x = clampi(x, 0, n - 1)
	y = clampi(y, 0, n - 1)
	if blocked[y * n + x] == 0:
		return y * n + x
	for r in range(1, n):
		for dy in range(-r, r + 1):
			for dx in range(-r, r + 1):
				if dx != -r and dx != r and dy != -r and dy != r:
					continue
				var cx := x + dx
				var cy := y + dy
				if cx < 0 or cy < 0 or cx >= n or cy >= n:
					continue
				if blocked[cy * n + cx] == 0:
					return cy * n + cx
	return -1


# --- flow fields (flowfield.ts) -----------------------------------------------------

class FlowField:
	var dest: int
	var dist: PackedInt32Array
	var dir: PackedByteArray
	var last_used := 0


static func build_flow_field(blocked: PackedByteArray, dest: int) -> FlowField:
	var n := MAP_SIZE
	var total := n * n
	var dist := PackedInt32Array()
	dist.resize(total)
	dist.fill(INF)
	var dir := PackedByteArray()
	dir.resize(total)
	dir.fill(NO_DIR)
	var buckets: Array = []
	for i in RING:
		buckets.append([])
	dist[dest] = 0
	buckets[0].append(dest)
	var pending := 1
	var d := 0
	while pending > 0:
		var bucket: Array = buckets[d % RING]
		while not bucket.is_empty():
			var c: int = bucket.pop_back()
			pending -= 1
			if dist[c] != d:
				continue
			var x := c % n
			var y := c / n
			for k in 8:
				var nx: int = x + DIR8_DX[k]
				var ny: int = y + DIR8_DY[k]
				if nx < 0 or ny < 0 or nx >= n or ny >= n:
					continue
				var nc := ny * n + nx
				if blocked[nc] == 1:
					continue
				if (k & 1) == 1 and (blocked[y * n + nx] == 1 or blocked[ny * n + x] == 1):
					continue
				var nd: int = d + DIR8_COST[k]
				if nd < dist[nc]:
					dist[nc] = nd
					buckets[nd % RING].append(nc)
					pending += 1
		d += 1

	for c in total:
		if c == dest or dist[c] == INF:
			continue
		var x := c % n
		var y := c / n
		var best := INF
		var best_k := NO_DIR
		for k in 8:
			var nx: int = x + DIR8_DX[k]
			var ny: int = y + DIR8_DY[k]
			if nx < 0 or ny < 0 or nx >= n or ny >= n:
				continue
			var nc := ny * n + nx
			if blocked[nc] == 1:
				continue
			if (k & 1) == 1 and (blocked[y * n + nx] == 1 or blocked[ny * n + x] == 1):
				continue
			var v: int = dist[nc] + DIR8_COST[k]
			if v < best:
				best = v
				best_k = k
		dir[c] = best_k
	var f := FlowField.new()
	f.dest = dest
	f.dist = dist
	f.dir = dir
	return f


# --- the simulation (sim.ts) --------------------------------------------------------

var blocked: PackedByteArray
var spawns: Array
var reinforce: bool
var tick := 0
var count := 0
var next_id := 0
var field_builds := 0
var fields := {}

var id := PackedInt32Array()
var team := PackedInt32Array()
var type := PackedInt32Array()
var x := PackedInt32Array()
var y := PackedInt32Array()
var hp := PackedInt32Array()
var cooldown := PackedInt32Array()
var target := PackedInt32Array()
var order := PackedInt32Array()
var dest := PackedInt32Array()
var arrive2 := PackedInt32Array()
var order_target := PackedInt32Array()
var anim := PackedInt32Array()
var facing := PackedInt32Array()

var _vx := PackedInt32Array()
var _vy := PackedInt32Array()
var _new_x := PackedInt32Array()
var _new_y := PackedInt32Array()
var _attacking := PackedByteArray()
var _damage := PackedInt32Array()
var _cell_head := PackedInt32Array()
var _cell_next := PackedInt32Array()
var _id_to_slot := PackedInt32Array()

## Commands waiting for their tick, and every command applied so far (the replay log).
var _queue: Array[Dictionary] = []
var command_log: Array[Dictionary] = []


func _init(map_blocked: PackedByteArray, spawn_list: Array, with_reinforcements: bool) -> void:
	blocked = map_blocked
	spawns = spawn_list
	reinforce = with_reinforcements
	for arr in [id, team, type, x, y, hp, cooldown, target, order, dest, arrive2, order_target, anim, facing,
			_vx, _vy, _new_x, _new_y, _damage, _cell_next]:
		arr.resize(CAPACITY)
	_attacking.resize(CAPACITY)
	_cell_head.resize(MAP_SIZE * MAP_SIZE)
	_id_to_slot.resize(4096)
	_id_to_slot.fill(-1)
	for t in TEAM_COUNT:
		_fill_team(t)


func slot_of(unit_id: int) -> int:
	return _id_to_slot[unit_id] if unit_id >= 0 and unit_id < _id_to_slot.size() else -1


func alive_by_team() -> Array[int]:
	var out: Array[int] = [0, 0, 0, 0]
	for i in count:
		out[team[i]] += 1
	return out


## IDs of a team's units, optionally of one type, in ID order.
func units_of(t: int, ty: int = -1) -> Array[int]:
	var out: Array[int] = []
	for i in count:
		if team[i] == t and (ty < 0 or type[i] == ty):
			out.append(id[i])
	return out


func push(cmd: Dictionary) -> void:
	assert(int(cmd.t) >= tick, "command for a past tick")
	_queue.append(cmd)


func get_field(d: int) -> FlowField:
	var f: FlowField = fields.get(d)
	if f == null:
		if fields.size() >= CACHE_SIZE:
			var victim: FlowField = null
			for k in fields:
				var g: FlowField = fields[k]
				if victim == null or g.last_used < victim.last_used or (g.last_used == victim.last_used and g.dest < victim.dest):
					victim = g
			fields.erase(victim.dest)
		f = build_flow_field(blocked, d)
		field_builds += 1
		fields[d] = f
	f.last_used = tick
	return f


func step() -> void:
	_apply_commands()
	if reinforce and tick > 0 and tick % REINFORCE_EVERY == 0:
		for t in TEAM_COUNT:
			_fill_team(t)
	_bucket()
	_decide_all()
	_move()
	_attack()
	_remove_dead()
	tick += 1


func state_hash() -> int:
	var h := FNV_OFFSET
	h = fnv_word(h, tick)
	h = fnv_word(h, count)
	for i in count:
		h = fnv_word(h, id[i])
		h = fnv_word(h, x[i])
		h = fnv_word(h, y[i])
		h = fnv_word(h, hp[i])
	return h


func should_hash() -> bool:
	return tick % HASH_EVERY == 0


func dump() -> String:
	var lines := PackedStringArray(["tick %d count %d next %d" % [tick, count, next_id]])
	for i in count:
		lines.append("%d %d %d %d %d %d %d %d %d %d %d" % [id[i], team[i], type[i], x[i], y[i], hp[i],
				cooldown[i], target[i], order[i], dest[i], order_target[i]])
	return "\n".join(lines) + "\n"


# --- commands -----------------------------------------------------------------------

func _apply_commands() -> void:
	if _queue.is_empty():
		return
	var later: Array[Dictionary] = []
	for cmd in _queue:
		if int(cmd.t) != tick:
			later.append(cmd)
			continue
		_apply(cmd)
		command_log.append(cmd)
	_queue = later


func _apply(cmd: Dictionary) -> void:
	var slots: Array[int] = []
	var p := int(cmd.p)
	for uid in cmd.u:
		var s := slot_of(int(uid))
		if s >= 0 and team[s] == p:
			slots.append(s)
	var c: String = cmd.c
	if c == "move":
		var d := nearest_open(blocked, int(cmd.x), int(cmd.y))
		var r := ARRIVE_BASE + isqrt(slots.size()) * ARRIVE_PER_SQRT
		for s in slots:
			order[s] = ORDER_MOVE
			dest[s] = d
			arrive2[s] = r * r
			target[s] = -1
	elif c == "attack":
		for s in slots:
			order[s] = ORDER_ATTACK
			order_target[s] = int(cmd.target)
			target[s] = -1
	else:
		for s in slots:
			order[s] = ORDER_STOP
			target[s] = -1


# --- spawning -----------------------------------------------------------------------

func _fill_team(t: int) -> void:
	var have := [0, 0, 0]
	for i in count:
		if team[i] == t:
			have[type[i]] += 1
	var cx: int = spawns[t][0]
	var cy: int = spawns[t][1]
	var slot := 0
	for ty in TYPE_COUNT:
		for k in range(have[ty], TEAM_MIX[ty]):
			var gx := cx - 5 + slot % 10
			var gy := cy - 5 + slot / 10
			_add_unit(t, ty, gx * CELL + CELL / 2, gy * CELL + CELL / 2)
			slot += 1


func _add_unit(t: int, ty: int, px: int, py: int) -> void:
	var i := count
	count += 1
	var uid := next_id
	next_id += 1
	if uid >= _id_to_slot.size():
		var old := _id_to_slot.size()
		_id_to_slot.resize(old * 2)
		for k in range(old, old * 2):
			_id_to_slot[k] = -1
	_id_to_slot[uid] = i
	id[i] = uid
	team[i] = t
	type[i] = ty
	x[i] = px
	y[i] = py
	hp[i] = TYPE_HP[ty]
	cooldown[i] = 0
	target[i] = -1
	order[i] = ORDER_NONE
	dest[i] = 0
	arrive2[i] = 0
	order_target[i] = -1
	anim[i] = ANIM_IDLE
	facing[i] = [0, 4, 8, 12][t]


# --- per tick -----------------------------------------------------------------------

func _bucket() -> void:
	_cell_head.fill(-1)
	for i in count:
		var c := (y[i] >> CELL_SHIFT) * MAP_SIZE + (x[i] >> CELL_SHIFT)
		_cell_next[i] = _cell_head[c]
		_cell_head[c] = i


func _find_target(i: int) -> int:
	var cx := x[i] >> CELL_SHIFT
	var cy := y[i] >> CELL_SHIFT
	var x0 := maxi(cx - AGGRO_CELLS, 0)
	var x1 := mini(cx + AGGRO_CELLS, MAP_SIZE - 1)
	var y0 := maxi(cy - AGGRO_CELLS, 0)
	var y1 := mini(cy + AGGRO_CELLS, MAP_SIZE - 1)
	var my_team := team[i]
	var mx := x[i]
	var my := y[i]
	var best := AGGRO_RANGE * AGGRO_RANGE + 1
	var best_id := -1
	var head := _cell_head
	var nxt := _cell_next
	var teams := team
	var xs := x
	var ys := y
	var ids := id
	for yy in range(y0, y1 + 1):
		var row := yy * MAP_SIZE
		for xx in range(x0, x1 + 1):
			var j := head[row + xx]
			while j >= 0:
				if teams[j] != my_team:
					var dx := xs[j] - mx
					var dy := ys[j] - my
					var d2 := dx * dx + dy * dy
					if d2 < best or (d2 == best and ids[j] < best_id):
						best = d2
						best_id = ids[j]
				j = nxt[j]
	return best_id


## Step 4 for every unit in ID order. One loop with the arrays in locals: GDScript pays
## for every member lookup and function call, and this runs 400 times a tick.
func _decide_all() -> void:
	var ids := id
	var types := type
	var xs := x
	var ys := y
	var tgt := target
	var ords := order
	var ots := order_target
	var an := anim
	var fc := facing
	var vx := _vx
	var vy := _vy
	var att := _attacking
	var its := _id_to_slot
	var its_n := its.size()
	var dests := dest
	var arr := arrive2
	var t := tick
	for i in count:
		var ty := types[i]
		vx[i] = 0
		vy[i] = 0
		att[i] = 0
		var tid := tgt[i]
		if tid >= 0 and (tid >= its_n or its[tid] < 0):
			tid = -1
			tgt[i] = -1
		var o := ords[i]
		if o == ORDER_ATTACK:
			var ot := ots[i]
			if ot < 0 or ot >= its_n or its[ot] < 0:
				o = ORDER_NONE
				ords[i] = o
				ots[i] = -1
			else:
				tid = ot
				tgt[i] = tid
		if o != ORDER_ATTACK and (t + ids[i]) % RETARGET_EVERY == 0:
			tid = _find_target(i)
			tgt[i] = tid

		if tid >= 0:
			var ts := its[tid]
			var dx := xs[ts] - xs[i]
			var dy := ys[ts] - ys[i]
			var k := dir16(dx, dy)
			fc[i] = k
			var reach: int = TYPE_RANGE[ty]
			if dx * dx + dy * dy <= reach * reach:
				att[i] = 1
				an[i] = ANIM_ATTACK
			elif o != ORDER_STOP:
				var sp: int = TYPE_SPEED[ty]
				vx[i] = DIR16_X[k] * sp / CELL
				vy[i] = DIR16_Y[k] * sp / CELL
				an[i] = ANIM_MOVE
			else:
				an[i] = ANIM_IDLE
			continue

		if o == ORDER_MOVE:
			var d := dests[i]
			var dx := (d % MAP_SIZE) * CELL + CELL / 2 - xs[i]
			var dy := (d / MAP_SIZE) * CELL + CELL / 2 - ys[i]
			if dx * dx + dy * dy <= arr[i]:
				ords[i] = ORDER_NONE
				an[i] = ANIM_IDLE
				continue
			var field := get_field(d)
			var fd := field.dir[(ys[i] >> CELL_SHIFT) * MAP_SIZE + (xs[i] >> CELL_SHIFT)]
			var k := dir16(dx, dy) if fd == NO_DIR else fd * 2
			fc[i] = k
			var sp: int = TYPE_SPEED[ty]
			vx[i] = DIR16_X[k] * sp / CELL
			vy[i] = DIR16_Y[k] * sp / CELL
			an[i] = ANIM_MOVE
			continue
		an[i] = ANIM_IDLE


## Step 5: velocity plus separation from start-of-tick neighbours, then wall sliding.
## dir16 is inlined in the neighbour loop, the hottest code in the simulation.
func _move() -> void:
	var n := count
	var sep := SEPARATION
	var sep2 := SEPARATION * SEPARATION
	var head := _cell_head
	var nxt := _cell_next
	var xs := x
	var ys := y
	var ids := id
	var vx := _vx
	var vy := _vy
	var nx := _new_x
	var ny := _new_y
	var blk := blocked
	for i in n:
		var xi := xs[i]
		var yi := ys[i]
		var cx := xi >> CELL_SHIFT
		var cy := yi >> CELL_SHIFT
		var px := 0
		var py := 0
		var y_lo := maxi(cy - 1, 0)
		var y_hi := mini(cy + 1, MAP_SIZE - 1)
		var x_lo := maxi(cx - 1, 0)
		var x_hi := mini(cx + 1, MAP_SIZE - 1)
		for yy in range(y_lo, y_hi + 1):
			var row := yy * MAP_SIZE
			for xx in range(x_lo, x_hi + 1):
				var j := head[row + xx]
				while j >= 0:
					if j != i:
						var dx := xi - xs[j]
						var dy := yi - ys[j]
						if dx < sep and dx > -sep and dy < sep and dy > -sep and dx * dx + dy * dy < sep2:
							var k := 0
							if dx == 0 and dy == 0:
								k = 0 if ids[i] < ids[j] else 8
							else:
								var ax := -dx if dx < 0 else dx
								var ay := -dy if dy < 0 else dy
								var s := ay * 1024
								var q := 4
								if s < ax * 204:
									q = 0
								elif s < ax * 684:
									q = 1
								elif s < ax * 1533:
									q = 2
								elif s < ax * 5148:
									q = 3
								if dx >= 0:
									k = q if dy >= 0 else (16 - q) % 16
								else:
									k = 8 - q if dy >= 0 else 8 + q
							px += DIR16_X[k] * PUSH / CELL
							py += DIR16_Y[k] * PUSH / CELL
					j = nxt[j]
		px = clampi(px, -MAX_PUSH, MAX_PUSH)
		py = clampi(py, -MAX_PUSH, MAX_PUSH)
		var tx := clampi(xi + vx[i] + px, 0, MAP_PX - 1)
		var ty := clampi(yi + vy[i] + py, 0, MAP_PX - 1)
		if blk[(yi >> CELL_SHIFT) * MAP_SIZE + (tx >> CELL_SHIFT)] == 1:
			tx = xi
		if blk[(ty >> CELL_SHIFT) * MAP_SIZE + (tx >> CELL_SHIFT)] == 1:
			ty = yi
		nx[i] = tx
		ny[i] = ty
	for i in n:
		xs[i] = nx[i]
		ys[i] = ny[i]


func _attack() -> void:
	for i in count:
		_damage[i] = 0
	for i in count:
		if cooldown[i] > 0:
			cooldown[i] -= 1
		if _attacking[i] == 0 or cooldown[i] > 0:
			continue
		var ts := slot_of(target[i])
		_damage[ts] += TYPE_ATTACK[type[i]]
		cooldown[i] = TYPE_COOLDOWN[type[i]]


func _remove_dead() -> void:
	var w := 0
	for r in count:
		var h := hp[r] - _damage[r]
		if h <= 0:
			_id_to_slot[id[r]] = -1
			continue
		if w != r:
			id[w] = id[r]
			team[w] = team[r]
			type[w] = type[r]
			x[w] = x[r]
			y[w] = y[r]
			cooldown[w] = cooldown[r]
			target[w] = target[r]
			order[w] = order[r]
			dest[w] = dest[r]
			arrive2[w] = arrive2[r]
			order_target[w] = order_target[r]
			anim[w] = anim[r]
			facing[w] = facing[r]
		hp[w] = h
		_id_to_slot[id[w]] = w
		w += 1
	count = w
