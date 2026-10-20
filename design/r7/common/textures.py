"""R7 (D-092): the CC0 materials of the realism comparison, fetched by URL and checked by sha256 (the source files do
not go into the repo; design/r7/build/tex/ is git-ignored). All from Poly Haven, licence CC0 (https://polyhaven.com/license,
read 2026-10-20; THIRD_PARTY_NOTICES.md).

python3 design/r7/common/textures.py fetch [DIR]     download what is missing, check every file's sha256
python3 design/r7/common/textures.py pin [DIR]       (maintainer) download everything and print the SHA table
"""
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
DIR = HERE.parent / "build" / "tex"
# (Poly Haven id, resolution, what it is for)
TEXTURES = [
    ("rough_linen", "1k", "cloth: tunics, sleeves, banners"),
    ("hessian_230", "1k", "coarse cloth: trousers, wraps"),
    ("brown_leather", "1k", "leather: belts, boots, straps"),
    ("fabric_leather_02", "1k", "leather armour"),
    ("metal_plate", "1k", "iron: helmets, plates, blades"),
    ("rusty_metal_02", "1k", "worn iron: rivets, rims"),
    ("fine_grained_wood", "1k", "spear shafts, crossbow stocks"),
    ("medieval_wood", "1k", "beams, posts"),
    ("old_planks_02", "1k", "plank walls, doors"),
    ("castle_brick_01", "1k", "stone walls, foundations"),
    ("clay_plaster", "1k", "plaster walls"),
    ("thatch_roof_angled", "1k", "thatch roofs"),
    ("clay_roof_tiles_02", "1k", "tiled roofs"),
    ("leafy_grass", "2k", "ground: grass"),
    ("aerial_grass_rock", "2k", "ground: large-scale grass and earth"),
    ("stony_dirt_path", "2k", "ground: the dirt road"),
    ("gravel_ground_01", "2k", "ground: gravel"),
    ("brown_mud_rocks_01", "2k", "ground: the river bank"),
]
MAPS = {"diff": "Diffuse", "nor_gl": "nor_gl", "rough": "Rough"}
PIN = {}                      # file name -> {url, sha256}, filled by `pin` from Poly Haven's file API
_PIN_FILE = HERE / "textures_sha.json"
if _PIN_FILE.exists():
    PIN = json.loads(_PIN_FILE.read_text())


def _api(tid):
    req = urllib.request.Request(f"https://api.polyhaven.com/files/{tid}", headers={"User-Agent": "war-game-ui-r7"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def files(pin=False):
    for tid, res, _ in TEXTURES:
        api = _api(tid) if pin else None
        for short, key in MAPS.items():
            name = f"{tid}_{short}_{res}.jpg"
            url = api[key][res]["jpg"]["url"] if pin else PIN[name]["url"]
            yield name, url


def path(tid, short):
    res = next(r for t, r, _ in TEXTURES if t == tid)
    return DIR / f"{tid}_{short}_{res}.jpg"


def _get(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": "war-game-ui-r7"})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    dest.write_bytes(data)
    return data


def fetch(d=DIR, pin=False):
    d.mkdir(parents=True, exist_ok=True)
    out = {}
    for name, url in files(pin):
        p = d / name
        data = p.read_bytes() if p.exists() else _get(url, p)
        h = hashlib.sha256(data).hexdigest()
        if not pin and PIN[name]["sha256"] != h:
            p.unlink()
            raise SystemExit(f"{name}: sha256 {h} is not the pinned {PIN[name]['sha256']}")
        out[name] = dict(url=url, sha256=h)
    if pin:
        _PIN_FILE.write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")
    print(f"{len(out)} files in {d}")


if __name__ == "__main__":
    cmd = sys.argv[1]
    d = Path(sys.argv[2]) if len(sys.argv) > 2 else DIR
    fetch(d, pin=cmd == "pin")
