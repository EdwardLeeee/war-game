extends SceneTree
## Headless runner, same outputs as spikes/web/src/headless.ts:
##   godot --headless --path spikes/godot -s res://headless.gd -- --mode scripted|ai|measure
##       [--ticks N] [--out DIR] [--replay FILE] [--name NAME]
## Writes <out>/<name>.hashes.txt, .commands.jsonl, .state.txt and .timing.json.

const Sim := preload("res://sim/sim.gd")
const Scenarios := preload("res://sim/scenarios.gd")


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var opt := {"mode": "scripted", "ticks": str(Sim.MAX_TICKS), "out": "out", "replay": "", "name": ""}
	for i in range(0, args.size() - 1):
		if args[i].begins_with("--") and opt.has(args[i].substr(2)):
			opt[args[i].substr(2)] = args[i + 1]
	var mode: String = opt.mode
	var ticks := int(opt.ticks)
	var out: String = opt.out
	var name: String = opt.name
	if name.is_empty():
		name = mode if opt.replay == "" else mode + "-replay"

	var replay: Array = []
	if opt.replay != "":
		for line in FileAccess.get_file_as_string(opt.replay).split("\n", false):
			replay.append(JSON.parse_string(line))

	var t0 := Time.get_ticks_usec()
	var game := Scenarios.create_game(mode, replay)
	var setup_ms := (Time.get_ticks_usec() - t0) / 1000.0
	var sim := game.sim
	var lines := PackedStringArray(["%d %s %d" % [sim.tick, Sim.hex8(sim.state_hash()), sim.count]])
	var tick_us := PackedInt64Array()
	var start := Time.get_ticks_usec()
	while sim.tick < ticks and not game.done():
		var a := Time.get_ticks_usec()
		game.control()
		sim.step()
		tick_us.append(Time.get_ticks_usec() - a)
		if sim.should_hash():
			lines.append("%d %s %d" % [sim.tick, Sim.hex8(sim.state_hash()), sim.count])
	if not sim.should_hash():
		lines.append("%d %s %d" % [sim.tick, Sim.hex8(sim.state_hash()), sim.count])
	var total_ms := (Time.get_ticks_usec() - start) / 1000.0

	DirAccess.make_dir_recursive_absolute(out)
	_write(out.path_join(name + ".hashes.txt"), "\n".join(lines) + "\n")
	var cmds := PackedStringArray()
	for c in sim.command_log:
		cmds.append(JSON.stringify(c))
	_write(out.path_join(name + ".commands.jsonl"), "\n".join(cmds) + "\n")
	_write(out.path_join(name + ".state.txt"), sim.dump())
	var s := summarize(tick_us)
	var info := Engine.get_version_info()
	var timing := {
		"engine": "godot %s" % info.string,
		"platform": "%s %s" % [OS.get_name(), Engine.get_architecture_name()],
		"mode": mode,
		"replay": opt.replay != "",
		"ticks": sim.tick,
		"setupMs": snappedf(setup_ms, 0.1),
		"totalMs": roundi(total_ms),
		"tickMs": s,
		"flowFieldBuilds": sim.field_builds,
		"alive": sim.alive_by_team(),
	}
	_write(out.path_join(name + ".timing.json"), JSON.stringify(timing, "  ") + "\n")
	print("SPIKE %s: %d ticks in %.2f s; tick median %.3f ms, p95 %.3f ms, max %.2f ms; final hash %s, alive %s, flow fields built %d" % [
		name, sim.tick, total_ms / 1000.0, s.median, s.p95, s.max, Sim.hex8(sim.state_hash()),
		"/".join(sim.alive_by_team().map(func(n): return str(n))), sim.field_builds])
	quit()


static func summarize(us: PackedInt64Array) -> Dictionary:
	var sorted := us.duplicate()
	sorted.sort()
	var n := sorted.size()
	var sum := 0
	for v in sorted:
		sum += v
	var pick := func(p: float) -> float:
		if n == 0:
			return 0.0
		var rank := clampi(ceili(p / 100.0 * n), 1, n)
		return sorted[rank - 1] / 1000.0
	return {
		"samples": n,
		"median": pick.call(50.0),
		"p95": pick.call(95.0),
		"max": sorted[n - 1] / 1000.0 if n > 0 else 0.0,
		"mean": sum / 1000.0 / n if n > 0 else 0.0,
	}


func _write(path: String, text: String) -> void:
	var f := FileAccess.open(path, FileAccess.WRITE)
	f.store_string(text)
	f.close()
