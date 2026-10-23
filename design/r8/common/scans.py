"""R8 batch 2 (D-093): the photo-scanned rock faces the cliff is skinned with (blender/terrain_r8.py), fetched by URL
and checked by sha256 (the files do not go into the repo; design/r8/build/scans/ is git-ignored). Poly Haven models,
licence CC0 (https://polyhaven.com/license and each asset page, read 2026-10-22; THIRD_PARTY_NOTICES.md). glTF at 1k:
the .gltf, its .bin and its colour, normal and ARM maps, laid out as the .gltf expects (<id>/<id>_1k.gltf, textures/).

python3 design/r8/common/scans.py fetch [DIR]     download what is missing, check every file's sha256
python3 design/r8/common/scans.py pin [DIR]       (maintainer) download everything and write scans_sha.json
"""
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
DIR = HERE.parent / "build" / "scans"
UA = "war-game-ui (https://github.com/EdwardLeeee/war-game)"
# (Poly Haven id, what it is for)
SCANS = [
    ("rock_face_01", "R8 cliff: the rock face (layered, fractured), the arms' and posts' skin"),
    ("rock_face_02", "R8 cliff: a second rock face, the variants"),
]
PIN = {}                      # <id>/<path> -> {url, sha256}, filled by `pin` from Poly Haven's file API
_PIN_FILE = HERE / "scans_sha.json"
if _PIN_FILE.exists():
    PIN = json.loads(_PIN_FILE.read_text())


def _api(sid):
    req = urllib.request.Request(f"https://api.polyhaven.com/files/{sid}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def files(pin=False):
    if not pin:
        yield from ((name, v["url"]) for name, v in sorted(PIN.items()))
        return
    for sid, _ in SCANS:
        g = _api(sid)["gltf"]["1k"]["gltf"]
        yield f"{sid}/{Path(g['url']).name}", g["url"]
        for rel, f in sorted(g["include"].items()):
            yield f"{sid}/{rel}", f["url"]


def gltf(sid, d=DIR):
    return d / sid / f"{sid}_1k.gltf"


def _get(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    dest.parent.mkdir(parents=True, exist_ok=True)
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
