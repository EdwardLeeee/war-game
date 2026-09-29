extends Node2D
## Test scene for the Godot candidate, the counterpart of spikes/web/src/app/.
## The measurement battle runs live at 20 ticks per second in the main thread (the
## single-threaded web export has no other); the screen interpolates between ticks.
## Every step is printed as a "SPIKE ..." line; on the web the page overlay
## (web/overlay.js) shows the same panel, buttons and result box as the PixiJS page.
## Builds with the "autorun" feature (the CI simulator apps and the CI browser test) run
## the determinism games, then the measurement, then print "SPIKE done".

const Sim := preload("res://sim/sim.gd")
const Scenarios := preload("res://sim/scenarios.gd")
const UNITS_TEX := preload("res://art/units.png")
const TILES_TEX := preload("res://art/tiles.png")

const TILE_PX := 16
const FRAME := 32
const UNIT_PX := TILE_PX * 1.25
const TICK_USEC := 50000
const WARMUP_MS := 5000.0
const WINDOW_MS := 30000.0
const DETERMINISM_BUDGET_USEC := 25000
const PASS_FPS_MEDIAN := 55.0
const PASS_FPS_LOW := 30.0
const PASS_TICK_MEDIAN_MS := 5.0
const TEAM_COLOR := [Color8(217, 67, 59), Color8(59, 115, 217), Color8(222, 178, 48), Color8(58, 170, 90)]
const LONG_PRESS_MS := 350
const SLOP_PX := 12.0

var game: Scenarios.Game
var sim: Sim
var camera := Camera2D.new()
var units_layer := Node2D.new()
var overlay := CanvasLayer.new()
var marquee := Node2D.new()
var label := Label.new()

var _acc_usec := 0
var _last_usec := 0
var _prev_id := PackedInt32Array()
var _prev_x := PackedInt32Array()
var _prev_y := PackedInt32Array()
var _prev_count := 0
var _tick_at_usec := 0
var _frame_no := 0
var _ready_logged := false
var _min_step_ms := INF

var _frame_ms: Array[float] = []
var _frame_at: Array[int] = []
var _tick_ms: Array[float] = []
var _tick_at: Array[int] = []

var _measure_phase := ""  # "", "warmup", "run"
var _measure_start := 0
var _measure_frames: Array[float] = []
var _measure_ticks: Array[float] = []
var _measure_done: Callable

var _det_queue: Array[String] = []
var _det_game: Scenarios.Game
var _det_tick_ms: Array[float] = []
var _det_start := 0
var _det_done: Callable
var _paused := false

var selected := {}
var _touches := {}
var _gesture := ""  # tap, pan, box, pinch
var _press_at := 0
var _pinch_dist := 1.0
var _pinch_zoom := 1.0
var _box_from := Vector2.ZERO
var _box_to := Vector2.ZERO

var _web_ui: JavaScriptObject
var _web_callbacks: Array[JavaScriptObject] = []


func _ready() -> void:
	var map := Scenarios.shared_map()
	_build_map(map)
	units_layer.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
	units_layer.draw.connect(_draw_units)
	add_child(units_layer)
	add_child(camera)
	camera.make_current()
	add_child(overlay)
	marquee.draw.connect(_draw_marquee)
	overlay.add_child(marquee)
	if not OS.has_feature("web"):
		label.position = Vector2(24, 48)
		label.add_theme_font_size_override("font_size", 26)
		label.add_theme_color_override("font_outline_color", Color.BLACK)
		label.add_theme_constant_override("outline_size", 6)
		overlay.add_child(label)
	_connect_web()
	game = Scenarios.create_game("measure")
	sim = game.sim
	_snapshot_prev()
	_fit_battle()
	get_viewport().size_changed.connect(_fit_battle)
	_last_usec = Time.get_ticks_usec()
	_tick_at_usec = _last_usec


func _build_map(map: PackedByteArray) -> void:
	var tiles := TileSet.new()
	tiles.tile_size = Vector2i(TILE_PX, TILE_PX)
	var src := TileSetAtlasSource.new()
	src.texture = TILES_TEX
	src.texture_region_size = Vector2i(TILE_PX, TILE_PX)
	for i in 8:
		src.create_tile(Vector2i(i, 0))
	var sid := tiles.add_source(src)
	var layer := TileMapLayer.new()
	layer.tile_set = tiles
	var n := Sim.MAP_SIZE
	for yy in n:
		for xx in n:
			var v := 4 + (xx * 3 + yy * 5) % 4 if map[yy * n + xx] == 1 else (xx * 7 + yy * 13) % 4
			layer.set_cell(Vector2i(xx, yy), sid, Vector2i(v, 0))
	add_child(layer)


## The four battle spawn squares plus a margin: what the measurement keeps on screen.
func _fit_battle() -> void:
	var x0 := 1000
	var y0 := 1000
	var x1 := 0
	var y1 := 0
	for s in Sim.SPAWN_BATTLE:
		x0 = mini(x0, s[0] - 9)
		y0 = mini(y0, s[1] - 9)
		x1 = maxi(x1, s[0] + 9)
		y1 = maxi(y1, s[1] + 9)
	var view := get_viewport_rect().size
	var z := minf(view.x / ((x1 - x0) * TILE_PX), view.y / ((y1 - y0) * TILE_PX))
	camera.zoom = Vector2(z, z)
	camera.position = Vector2((x0 + x1) * 0.5 * TILE_PX, (y0 + y1) * 0.5 * TILE_PX)


# --- frame loop ------------------------------------------------------------------------

func _process(_delta: float) -> void:
	var now := Time.get_ticks_usec()
	var dt_ms := (now - _last_usec) / 1000.0
	_last_usec = now
	_frame_no += 1

	if not _det_queue.is_empty() or _det_game != null:
		_run_determinism_slice()
	elif not _paused:
		_acc_usec += int(dt_ms * 1000.0)
		var steps := 0
		while _acc_usec >= TICK_USEC and steps < 4:
			_snapshot_prev()
			var a := Time.get_ticks_usec()
			game.control()
			sim.step()
			var ms := (Time.get_ticks_usec() - a) / 1000.0
			_tick_at_usec = Time.get_ticks_usec()
			_acc_usec -= TICK_USEC
			steps += 1
			_tick_ms.append(ms)
			_tick_at.append(_tick_at_usec)
			if ms > 0.0 and ms < _min_step_ms:
				_min_step_ms = ms
			if _measure_phase == "run":
				_measure_ticks.append(ms)
		# More than a few ticks behind (long stall): drop them instead of racing.
		if _acc_usec > TICK_USEC * 4:
			_acc_usec = 0

	_frame_ms.append(dt_ms)
	_frame_at.append(now)
	while not _frame_at.is_empty() and now - _frame_at[0] > WINDOW_MS * 1000:
		_frame_at.pop_front()
		_frame_ms.pop_front()
	while not _tick_at.is_empty() and now - _tick_at[0] > WINDOW_MS * 1000:
		_tick_at.pop_front()
		_tick_ms.pop_front()

	if _measure_phase == "warmup" and (now - _measure_start) / 1000.0 >= WARMUP_MS:
		_measure_phase = "run"
		_measure_start = now
		_log("量測開始（30 秒）")
	elif _measure_phase == "run":
		_measure_frames.append(dt_ms)
		if (now - _measure_start) / 1000.0 >= WINDOW_MS:
			_measure_phase = ""
			_measure_done.call(_result(_measure_frames, _measure_ticks))

	units_layer.queue_redraw()
	if _frame_no % 30 == 0:
		_update_panel()
	if not _ready_logged and _frame_no >= 2:
		_ready_logged = true
		_log("ready godot " + JSON.stringify(_env()))
		if OS.has_feature("autorun") or OS.get_cmdline_user_args().has("--autorun"):
			_autorun()


func _snapshot_prev() -> void:
	var n := sim.count
	_prev_id = sim.id.slice(0, n)
	_prev_x = sim.x.slice(0, n)
	_prev_y = sim.y.slice(0, n)
	_prev_count = n


func _draw_units() -> void:
	var s := sim
	var alpha := clampf((Time.get_ticks_usec() - _tick_at_usec) / float(TICK_USEC), 0.0, 1.0)
	var scale := float(TILE_PX) / Sim.CELL
	var ids := s.id
	var xs := s.x
	var ys := s.y
	var p := 0
	var pos := PackedVector2Array()
	pos.resize(s.count)
	# Sprites first, then every health bar: all from one texture, so they batch.
	for i in s.count:
		var uid := ids[i]
		var fx := float(xs[i])
		var fy := float(ys[i])
		while p < _prev_count and _prev_id[p] < uid:
			p += 1
		if p < _prev_count and _prev_id[p] == uid:
			fx = _prev_x[p] + (fx - _prev_x[p]) * alpha
			fy = _prev_y[p] + (fy - _prev_y[p]) * alpha
		var at := Vector2(fx * scale, fy * scale)
		pos[i] = at
		var frame := 0
		var an := s.anim[i]
		if an == Sim.ANIM_MOVE:
			frame = (_frame_no + uid) % 8
		elif an == Sim.ANIM_ATTACK:
			frame = 8 + (_frame_no + uid) % 4
		var row := s.team[i] * 3 + s.type[i]
		var f := s.facing[i]
		# Art faces right; a negative width mirrors it to face left (sectors 5..11).
		var w := -UNIT_PX if f > 4 and f < 12 else UNIT_PX
		if selected.has(uid):
			units_layer.draw_texture_rect_region(UNITS_TEX, Rect2(at.x - UNIT_PX * 0.4, at.y - UNIT_PX * 0.4, UNIT_PX * 0.8, UNIT_PX * 0.8),
					Rect2(0, 12 * FRAME, FRAME, FRAME))
		units_layer.draw_texture_rect_region(UNITS_TEX, Rect2(at.x - w * 0.5, at.y - UNIT_PX * 0.6, w, UNIT_PX),
				Rect2(frame * FRAME, row * FRAME, FRAME, FRAME))
	var white := Rect2(FRAME + 4, 12 * FRAME + 4, 8, 8)
	var bar_w := TILE_PX * 0.9
	var back := Color8(32, 26, 24)
	for i in s.count:
		var at := pos[i]
		var top := at.y - TILE_PX * 0.95
		var frac: float = float(s.hp[i]) / Sim.TYPE_HP[s.type[i]]
		units_layer.draw_texture_rect_region(UNITS_TEX, Rect2(at.x - bar_w * 0.5, top, bar_w, 2.2), white, back)
		units_layer.draw_texture_rect_region(UNITS_TEX, Rect2(at.x - bar_w * 0.5, top, bar_w * frac, 2.2), white, TEAM_COLOR[s.team[i]])


func _draw_marquee() -> void:
	if _gesture == "box":
		var r := Rect2(_box_from, _box_to - _box_from).abs()
		marquee.draw_rect(r, Color(1, 1, 1, 0.12), true)
		marquee.draw_rect(r, Color.WHITE, false, 2.0)


# --- touch -------------------------------------------------------------------------------

func _to_world(screen: Vector2) -> Vector2:
	return get_viewport().get_canvas_transform().affine_inverse() * screen


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		if event.pressed:
			_touches[event.index] = event.position
			if _touches.size() == 1:
				_gesture = "tap"
				_press_at = Time.get_ticks_msec()
				_box_from = event.position
				_box_to = event.position
			elif _touches.size() == 2:
				_gesture = "pinch"
				var pts: Array = _touches.values()
				_pinch_dist = maxf((pts[0] as Vector2).distance_to(pts[1]), 1.0)
				_pinch_zoom = camera.zoom.x
		else:
			_touches.erase(event.index)
			if _gesture == "tap" and Time.get_ticks_msec() - _press_at < LONG_PRESS_MS:
				_tap(event.position)
			elif _gesture == "box":
				_box_select()
			if _touches.is_empty() or _gesture == "pinch":
				_gesture = ""
			marquee.queue_redraw()
	elif event is InputEventScreenDrag:
		_touches[event.index] = event.position
		if _gesture == "pinch" and _touches.size() >= 2:
			var pts: Array = _touches.values()
			var d := maxf((pts[0] as Vector2).distance_to(pts[1]), 1.0)
			var mid: Vector2 = ((pts[0] as Vector2) + (pts[1] as Vector2)) * 0.5
			_zoom_at(mid, _pinch_zoom * d / _pinch_dist)
		elif _gesture == "tap" and event.position.distance_to(_box_from) > SLOP_PX:
			# Held still past the long-press time before moving: box select; else pan.
			_gesture = "box" if Time.get_ticks_msec() - _press_at >= LONG_PRESS_MS else "pan"
		if _gesture == "pan":
			camera.position -= event.relative / camera.zoom.x
		elif _gesture == "box":
			_box_to = event.position
			marquee.queue_redraw()
	elif event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			_zoom_at(event.position, camera.zoom.x * 1.1)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_zoom_at(event.position, camera.zoom.x / 1.1)


func _zoom_at(screen: Vector2, z: float) -> void:
	var before := _to_world(screen)
	z = clampf(z, 0.1, 6.0)
	camera.zoom = Vector2(z, z)
	camera.force_update_scroll()
	var after := _to_world(screen)
	camera.position += before - after


func _tap(screen: Vector2) -> void:
	var w := _to_world(screen)
	var scale := float(TILE_PX) / Sim.CELL
	var best := -1
	var best_team := -1
	var best_d := pow(TILE_PX * 0.9, 2)
	for i in sim.count:
		var d := w.distance_squared_to(Vector2(sim.x[i] * scale, sim.y[i] * scale))
		if d < best_d:
			best_d = d
			best = sim.id[i]
			best_team = sim.team[i]
	var mine: Array = selected.keys()
	if best >= 0 and best_team == 0:
		selected = {best: true}
	elif best >= 0 and not mine.is_empty():
		sim.push({"t": sim.tick, "p": 0, "c": "attack", "u": mine, "target": best})
	elif not mine.is_empty():
		sim.push({"t": sim.tick, "p": 0, "c": "move", "u": mine, "x": int(w.x / TILE_PX), "y": int(w.y / TILE_PX)})


func _box_select() -> void:
	var a := _to_world(Vector2(minf(_box_from.x, _box_to.x), minf(_box_from.y, _box_to.y)))
	var b := _to_world(Vector2(maxf(_box_from.x, _box_to.x), maxf(_box_from.y, _box_to.y)))
	var scale := float(TILE_PX) / Sim.CELL
	selected = {}
	for i in sim.count:
		var p := Vector2(sim.x[i] * scale, sim.y[i] * scale)
		if sim.team[i] == 0 and p.x >= a.x and p.x <= b.x and p.y >= a.y and p.y <= b.y:
			selected[sim.id[i]] = true


# --- measurement ---------------------------------------------------------------------------

func start_measure(done: Callable) -> void:
	_fit_battle()
	_log("暖機 5 秒")
	_measure_frames.clear()
	_measure_ticks.clear()
	_measure_start = Time.get_ticks_usec()
	_measure_phase = "warmup"
	_measure_done = done


func _result(frames: Array[float], ticks: Array[float]) -> Dictionary:
	var f := _summarize(frames)
	var t := _summarize(ticks)
	var r := _env()
	r.merge({
		"frames": f.samples,
		"fpsMedian": snappedf(1000.0 / f.median, 0.01),
		"fpsLow5": snappedf(1000.0 / f.p95, 0.01),
		"frameMsMedian": snappedf(f.median, 0.01),
		"frameMsP95": snappedf(f.p95, 0.01),
		"ticks": t.samples,
		"tickMsMedian": snappedf(t.median, 0.01),
		"tickMsMax": snappedf(t.max, 0.01),
		"tickMsMean": snappedf(t.mean, 0.01),
		"timerResolutionMs": snappedf(_min_step_ms, 0.001),
	})
	r.pass = r.fpsMedian >= PASS_FPS_MEDIAN and r.fpsLow5 >= PASS_FPS_LOW and r.tickMsMedian <= PASS_TICK_MEDIAN_MS
	return r


func _show_result(r: Dictionary) -> void:
	_log("measure " + JSON.stringify(r))
	if _web_ui != null:
		_web_ui.result(JSON.stringify(r))
	else:
		label.text = "%s\nfps median %.1f (>= 55)  slowest 5%% %.1f (>= 30)\ntick median %.2f ms (<= 5)  max %.2f ms" % [
			"PASS" if r.pass else "FAIL", r.fpsMedian, r.fpsLow5, r.tickMsMedian, r.tickMsMax]


static func _summarize(values: Array[float]) -> Dictionary:
	var sorted := values.duplicate()
	sorted.sort()
	var n := sorted.size()
	var sum := 0.0
	for v in sorted:
		sum += v
	var pick := func(p: float) -> float:
		return 0.0 if n == 0 else sorted[clampi(ceili(p / 100.0 * n), 1, n) - 1]
	return {"samples": n, "median": pick.call(50.0), "p95": pick.call(95.0),
			"max": 0.0 if n == 0 else sorted[n - 1], "mean": 0.0 if n == 0 else sum / n}


func _update_panel() -> void:
	if _frame_ms.size() < 2:
		return
	var f := _summarize(_frame_ms)
	var t := _summarize(_tick_ms)
	var secs := roundi((_frame_at[-1] - _frame_at[0]) / 1000000.0)
	var fps_line := "fps 中位數 %.2f，最慢 5%% %.2f（最近 %d 秒）" % [1000.0 / f.median, 1000.0 / f.p95, secs]
	var sim_line := "模擬每 tick 中位數 %.2f ms，最大 %.2f ms" % [t.median, t.max]
	var tick_line := "tick %d，單位 %d" % [sim.tick, sim.count]
	if _web_ui != null:
		_web_ui.panel(fps_line, sim_line, tick_line)
	elif _measure_phase != "run":
		label.text = "fps median %.1f  slowest 5%% %.1f\ntick median %.2f ms  max %.2f ms\ntick %d  units %d" % [
			1000.0 / f.median, 1000.0 / f.p95, t.median, t.max, sim.tick, sim.count]


func _env() -> Dictionary:
	var info := Engine.get_version_info()
	var ua := ""
	if OS.has_feature("web"):
		ua = str(JavaScriptBridge.eval("navigator.userAgent", true))
	var commit := ""
	if FileAccess.file_exists("res://commit.txt"):
		commit = FileAccess.get_file_as_string("res://commit.txt").strip_edges()
	return {
		"commit": commit,
		"engine": "Godot %s, %s" % [info.string, RenderingServer.get_video_adapter_name()],
		"os": "%s %s" % [OS.get_name(), OS.get_version()],
		"device": OS.get_model_name(),
		"userAgent": ua,
		"viewport": "%dx%d" % [get_viewport_rect().size.x, get_viewport_rect().size.y],
	}


# --- determinism (in slices, so the frame loop keeps drawing) -------------------------------

func start_determinism(done: Callable) -> void:
	_det_queue = ["scripted", "ai"]
	_det_done = done
	_paused = true
	_log("確定性檢查開始")


func _run_determinism_slice() -> void:
	var budget_end := Time.get_ticks_usec() + DETERMINISM_BUDGET_USEC
	while Time.get_ticks_usec() < budget_end:
		if _det_game == null:
			if _det_queue.is_empty():
				_paused = false
				_acc_usec = 0
				_det_done.call()
				return
			_det_game = Scenarios.create_game(_det_queue.pop_front())
			_det_tick_ms.clear()
			_det_start = Time.get_ticks_usec()
			_hash_line(_det_game)
		var g := _det_game
		var s := g.sim
		if s.tick >= Sim.MAX_TICKS or g.done():
			if not s.should_hash():
				_hash_line(g)
			var st := _summarize(_det_tick_ms)
			_log("game %s %d ticks %d ms final %s tick_median_ms %.3f tick_max_ms %.2f" % [g.mode, s.tick,
					(Time.get_ticks_usec() - _det_start) / 1000, Sim.hex8(s.state_hash()), st.median, st.max])
			if _web_ui != null:
				_web_ui.gameDone(g.mode, s.tick, Sim.hex8(s.state_hash()))
			_det_game = null
			continue
		var a := Time.get_ticks_usec()
		g.control()
		s.step()
		_det_tick_ms.append((Time.get_ticks_usec() - a) / 1000.0)
		if s.should_hash():
			_hash_line(g)


func _hash_line(g: Scenarios.Game) -> void:
	var h := Sim.hex8(g.sim.state_hash())
	print("SPIKE hash %s %d %s %d" % [g.mode, g.sim.tick, h, g.sim.count])
	if _web_ui != null:
		_web_ui.hashLine(g.mode, g.sim.tick, h, g.sim.count)


func _autorun() -> void:
	start_determinism(func() -> void:
		start_measure(func(r: Dictionary) -> void:
			_show_result(r)
			_log("done")))


# --- page overlay (web only) ---------------------------------------------------------------

func _connect_web() -> void:
	if not OS.has_feature("web"):
		return
	_web_ui = JavaScriptBridge.get_interface("spikeUI")
	if _web_ui == null:
		return
	var on_measure := JavaScriptBridge.create_callback(func(_args: Array) -> void:
		start_measure(_show_result))
	var on_determinism := JavaScriptBridge.create_callback(func(_args: Array) -> void:
		start_determinism(func() -> void: _log("確定性檢查結束")))
	_web_callbacks = [on_measure, on_determinism]
	_web_ui.attach(on_measure, on_determinism)


func _log(line: String) -> void:
	print("SPIKE " + line)
	if _web_ui != null:
		_web_ui.logLine(line)
