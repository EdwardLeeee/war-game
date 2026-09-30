extends RefCounted
## The three ways a game is driven: a port of spikes/web/src/sim/scenarios.ts.
## Controllers only push commands, so replaying Sim.command_log needs no controller.

const Sim := preload("res://sim/sim.gd")

static var _map: PackedByteArray


static func shared_map() -> PackedByteArray:
	if _map.is_empty():
		_map = Sim.generate_map(Sim.MAP_SEED)
	return _map


class Game:
	var sim: Sim
	var mode: String
	var replay: bool

	func control() -> void:
		if replay:
			return
		if mode == "scripted":
			_scripted()
		elif mode == "ai":
			_ai()
		else:
			_measure()

	## Only the scripted game ends early: when at most one team is left.
	func done() -> bool:
		if mode != "scripted":
			return false
		var teams := 0
		for n in sim.alive_by_team():
			if n > 0:
				teams += 1
		return teams <= 1

	func _move_all(t: int, cx: int, cy: int, ty: int = -1) -> void:
		var u := sim.units_of(t, ty)
		if not u.is_empty():
			sim.push({"t": sim.tick, "p": t, "c": "move", "u": u, "x": cx, "y": cy})

	func _scripted() -> void:
		var t := sim.tick
		if t % 1000 == 0:
			for team in Sim.TEAM_COUNT:
				_move_all(team, Sim.CENTER, Sim.CENTER)
		if t == 300:
			_move_all(0, Sim.CENTER - 28, Sim.CENTER, Sim.TYPE_RANGED)
		if t == 400:
			_move_all(1, Sim.CENTER + 32, Sim.CENTER - 28, Sim.TYPE_FAST)
		if t == 600:
			var u := sim.units_of(2)
			if not u.is_empty():
				sim.push({"t": t, "p": 2, "c": "stop", "u": u})
		if t == 800:
			var u := sim.units_of(3)
			var victims := sim.units_of(0)
			if not u.is_empty() and not victims.is_empty():
				sim.push({"t": t, "p": 3, "c": "attack", "u": u, "target": victims[0]})

	func _ai() -> void:
		for team in Sim.TEAM_COUNT:
			if sim.tick % Sim.AI_THINK_EVERY != 10 + 50 * team:
				continue
			var ox: int = sim.spawns[team][0]
			var oy: int = sim.spawns[team][1]
			var enemies: Array[int] = []
			for e in Sim.TEAM_COUNT:
				if e != team:
					enemies.append(e)
			# Insertion sort by (spawn distance, team): the same order as the reference.
			for a in range(1, enemies.size()):
				var k := a
				while k > 0 and _before(enemies[k], enemies[k - 1], ox, oy):
					var tmp := enemies[k]
					enemies[k] = enemies[k - 1]
					enemies[k - 1] = tmp
					k -= 1
			var pick := enemies[(sim.tick / Sim.AI_THINK_EVERY + team) % enemies.size()]
			_move_all(team, sim.spawns[pick][0], sim.spawns[pick][1])

	func _before(a: int, b: int, ox: int, oy: int) -> bool:
		var da := _dist2(sim.spawns[a], ox, oy)
		var db := _dist2(sim.spawns[b], ox, oy)
		return da < db or (da == db and a < b)

	func _dist2(p: Array, px: int, py: int) -> int:
		var dx: int = p[0] - px
		var dy: int = p[1] - py
		return dx * dx + dy * dy

	## One tick after each reinforcement wave, send every team to the centre.
	func _measure() -> void:
		if sim.tick % Sim.REINFORCE_EVERY != 1:
			return
		for team in Sim.TEAM_COUNT:
			_move_all(team, Sim.CENTER, Sim.CENTER)


static func create_game(mode: String, replay: Array = []) -> Game:
	var g := Game.new()
	g.mode = mode
	g.replay = not replay.is_empty()
	var spawns: Array = Sim.SPAWN_CORNER if mode == "ai" else Sim.SPAWN_BATTLE
	g.sim = Sim.new(shared_map(), spawns, mode != "scripted")
	for cmd in replay:
		g.sim.push(cmd)
	return g
