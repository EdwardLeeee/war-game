// R13-01-B2's scenes: where our buildings are on the screen (pt). `at` is the footprint's middle, which may be off the screen; w, d
// the footprint in metres (d defaults to w); ay how far the roof is above `at` at zoom 1 (pt, the atlas frame's anchor / 3).
// field_b2.py draws the battlefield from it (it reads this file as JSON after the "="), r13-b2.js the marks.
window.R13_B2 = {
 "crowd": {"zoom": 0.5, "squad": {"at": [612, 238], "n": 12}, "buildings": [
  {"id": "gate", "name": "大城", "frame": "castle_sw_gate_x_E_intact", "at": [192, 214], "w": 8, "d": 2, "ay": 194},
  {"id": "main", "name": "主城", "frame": "main_city_E_done", "at": [288, 208], "w": 8, "ay": 170},
  {"id": "towerA", "name": "箭樓", "frame": "arrow_tower_E_done", "at": [388, 178], "w": 4, "ay": 132},
  {"id": "towerB", "name": "箭樓", "frame": "arrow_tower_E_done", "at": [412, 232], "w": 4, "ay": 132},
  {"id": "post", "name": "哨所", "frame": "outpost_E_done", "at": [500, 212], "w": 6, "ay": 94},
  {"id": "barracks", "name": "兵營", "frame": "barracks_E_done", "at": [592, 170], "w": 6, "ay": 122}]},
 "dense": {"zoom": 0.42, "squad": {"at": [640, 246], "n": 12}, "buildings": [
  {"id": "main", "name": "主城", "frame": "main_city_E_done", "at": [168, 212], "w": 8, "ay": 170},
  {"id": "t1", "name": "箭樓", "frame": "arrow_tower_E_done", "at": [288, 226], "w": 4, "ay": 132},
  {"id": "t2", "name": "箭樓", "frame": "arrow_tower_E_done", "at": [330, 205], "w": 4, "ay": 132},
  {"id": "t3", "name": "箭樓", "frame": "arrow_tower_E_done", "at": [372, 226], "w": 4, "ay": 132},
  {"id": "t4", "name": "箭樓", "frame": "arrow_tower_E_done", "at": [414, 205], "w": 4, "ay": 132},
  {"id": "t5", "name": "箭樓", "frame": "arrow_tower_E_done", "at": [456, 226], "w": 4, "ay": 132},
  {"id": "t6", "name": "箭樓", "frame": "arrow_tower_E_done", "at": [498, 205], "w": 4, "ay": 132},
  {"id": "post", "name": "哨所", "frame": "outpost_E_done", "at": [566, 226], "w": 6, "ay": 94}]},
 "clamp": {"zoom": 0.6, "squad": {"at": [560, 190], "n": 12}, "buildings": [
  {"id": "main", "name": "主城", "frame": "main_city_E_done", "at": [150, 188], "w": 8, "ay": 170},
  {"id": "gate", "name": "大城", "frame": "castle_sw_gate_x_E_intact", "at": [420, 205], "w": 8, "d": 2, "ay": 194},
  {"id": "post", "name": "哨所", "frame": "outpost_E_done", "at": [300, 330], "w": 6, "ay": 94},
  {"id": "tower", "name": "箭樓", "frame": "arrow_tower_E_done", "at": [668, 334], "w": 4, "ay": 132}]},
 "far": {"zoom": 1, "squad": {"at": [430, 214], "n": 12}, "buildings": [
  {"id": "towerN", "name": "箭樓", "frame": "arrow_tower_E_done", "at": [244, 240], "w": 4, "ay": 132},
  {"id": "main", "name": "主城", "frame": "main_city_E_done", "at": [-400, 250], "w": 8, "ay": 170},
  {"id": "tower1", "name": "箭樓", "frame": "arrow_tower_E_done", "at": [1000, 40], "w": 4, "ay": 132},
  {"id": "tower2", "name": "箭樓", "frame": "arrow_tower_E_done", "at": [1090, 10], "w": 4, "ay": 132},
  {"id": "post", "name": "哨所", "frame": "outpost_E_done", "at": [1150, 420], "w": 6, "ay": 94},
  {"id": "gate", "name": "大城", "frame": "castle_sw_gate_x_E_intact", "at": [240, -300], "w": 8, "d": 2, "ay": 194}]},
 "moved": {"zoom": 1, "squad": {"at": [1225, 219], "n": 12}, "buildings": [
  {"id": "main", "name": "主城", "frame": "main_city_E_done", "at": [395, 255], "w": 8, "ay": 170},
  {"id": "towerN", "name": "箭樓", "frame": "arrow_tower_E_done", "at": [1039, 245], "w": 4, "ay": 132},
  {"id": "tower1", "name": "箭樓", "frame": "arrow_tower_E_done", "at": [1795, 45], "w": 4, "ay": 132},
  {"id": "tower2", "name": "箭樓", "frame": "arrow_tower_E_done", "at": [1885, 15], "w": 4, "ay": 132},
  {"id": "post", "name": "哨所", "frame": "outpost_E_done", "at": [1945, 425], "w": 6, "ay": 94},
  {"id": "gate", "name": "大城", "frame": "castle_sw_gate_x_E_intact", "at": [1035, -295], "w": 8, "d": 2, "ay": 194}]},
 "none": {"zoom": 0.5, "squad": {"at": [612, 232], "n": 6}, "buildings": [
  {"id": "main", "name": "主城", "frame": "main_city_E_done", "at": [236, 208], "w": 8, "ay": 170},
  {"id": "tower", "name": "箭樓", "frame": "arrow_tower_E_done", "at": [376, 188], "w": 4, "ay": 132},
  {"id": "barracks", "name": "兵營", "frame": "barracks_E_done", "at": [492, 182], "w": 6, "ay": 122}]}
};
