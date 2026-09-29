extends Node2D
# Pipeline probe: proves the exports run on each target before the real spike is ported.
# Prints SPIKE lines and writes them to user://probe.txt, then quits when headless.


func _ready() -> void:
	var lines: Array[String] = []
	lines.append("SPIKE ready godot %s %s" % [Engine.get_version_info().string, OS.get_name()])
	# xorshift32 + FNV-1a over 1000 draws: the same integer math the simulation uses.
	var x := 1
	var h := 2166136261
	for i in 1000:
		x ^= (x << 13) & 0xFFFFFFFF
		x ^= x >> 17
		x ^= (x << 5) & 0xFFFFFFFF
		for s in [0, 8, 16, 24]:
			h = ((h ^ ((x >> s) & 255)) * 16777619) & 0xFFFFFFFF
	lines.append("SPIKE probe hash %08x" % h)
	var f := FileAccess.open("user://probe.txt", FileAccess.WRITE)
	for line in lines:
		print(line)
		f.store_line(line)
	f.close()
	if DisplayServer.get_name() == "headless":
		get_tree().quit()
