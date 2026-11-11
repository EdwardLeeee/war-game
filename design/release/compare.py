"""Two art releases side by side, before one is published or after: what differs, file by file and for a client.

python3 -I design/release/compare.py OLD_DIR NEW_DIR [--extent UNIT ...]
  OLD_DIR, NEW_DIR: folders holding <tag>-x3.tar.gz, -x2, -astc-x3, -astc-x2 (a release's assets; a dry run's
  artifact). Prints, a package: the members only in one, the members whose bytes differ, by folder. For the x3
  package: every unit whose description differs, field by field (the animations' frames, fps, loop, hit, impact,
  stride_m are what the client reads), and its memory (memory.json).
  --extent UNIT: that unit's pictures' reach from the anchor in points at the default zoom (x3 px / 3), old -> new:
  a facing a line (the eight the client draws: 3, 4, 5 are 1, 0, 7 mirrored), every frame of every animation but
  the fall, and the fall by itself.

Downloaded archives are untrusted: run with -I, from a folder of your own.
"""
import hashlib
import json
import sys
import tarfile
from pathlib import Path

KINDS = ("x3", "x2", "astc-x3", "astc-x2")
FALLS = ("death", "fall", "dead")


def find(d, kind):
    hits = sorted(Path(d).glob(f"*-{kind}.tar.gz"))
    hits = [h for h in hits if kind.startswith("astc") or "-astc-" not in h.name]
    if len(hits) != 1:
        raise SystemExit(f"{d}: {len(hits)} archives for {kind}")
    return hits[0]


def members(p):
    out = {}
    with tarfile.open(p) as t:
        for m in t:
            if m.isfile():
                out[m.name] = hashlib.sha256(t.extractfile(m).read()).hexdigest()
    return out


def folder(name):
    parts = name.split("/")
    return "/".join(parts[:2]) if parts[0] == "units" and len(parts) > 2 else parts[0]


def read_json(p, name):
    with tarfile.open(p) as t:
        try:
            return json.load(t.extractfile(name))
        except KeyError:
            return None


def extent(j):
    """{facing: {'moving' | 'fall': [left, top, right, bottom] pt}}: the frames' reach from the anchor."""
    mir = {int(k): v for k, v in j["facings"]["mirrored"].items()}
    out = {}
    for name, f in j["frames"].items():
        anim, face = name[len(j["unit"]) + 1:].rsplit("_f", 1)
        face = int(face.split("_")[0])
        key = "fall" if anim in FALLS else "moving"
        box = [f["ax"], f["ay"], f["w"] - f["ax"], f["h"] - f["ay"]]
        for fc, flip in [(face, False)] + [(m, True) for m, src in mir.items() if src == face]:
            b = [box[2], box[1], box[0], box[3]] if flip else box
            cur = out.setdefault(fc, {}).setdefault(key, [0, 0, 0, 0])
            out[fc][key] = [max(a, c) for a, c in zip(cur, b)]
    return {fc: {k: [round(v / 3) for v in b] for k, b in d.items()} for fc, d in out.items()}


def main():
    args = sys.argv[1:]
    units = []
    if "--extent" in args:
        i = args.index("--extent")
        units, args = args[i + 1:], args[:i]
    old, new = args
    for kind in KINDS:
        a, b = members(find(old, kind)), members(find(new, kind))
        only_a, only_b = sorted(set(a) - set(b)), sorted(set(b) - set(a))
        diff = sorted(k for k in a if k in b and a[k] != b[k])
        print(f"{kind}: {len(a)} -> {len(b)} files; only old {only_a or 'none'}; only new {only_b or 'none'}; "
              f"{len(diff)} differ, in {sorted({folder(k) for k in diff}) or 'nothing'}")
    pa, pb = find(old, "x3"), find(new, "x3")
    with tarfile.open(pb) as t:
        names = sorted(n.split("/")[1] for n in t.getnames() if n.startswith("units/") and n.count("/") == 1)
    for u in names:
        ja, jb = read_json(pa, f"units/{u}/{u}.json"), read_json(pb, f"units/{u}/{u}.json")
        if ja is None or jb is None or ja == jb:
            continue
        print(f"\n{u}:")
        for k in sorted(set(ja) | set(jb)):
            if k in ("frames", "team", "shadows", "fx", "shield"):
                na, nb = len(ja.get(k) or {}), len(jb.get(k) or {})
                if na != nb:
                    print(f"  {k}: {na} -> {nb} entries")
            elif k == "anims":
                for an in sorted(set(ja[k]) | set(jb[k])):
                    if ja[k].get(an) != jb[k].get(an):
                        print(f"  anims.{an}: {ja[k].get(an)} -> {jb[k].get(an)}")
            elif ja.get(k) != jb.get(k):
                print(f"  {k}: {ja.get(k)} -> {jb.get(k)}")
        same = [an for an in jb["anims"] if ja["anims"].get(an) == jb["anims"][an]]
        print(f"  animations unchanged in the description: {', '.join(same) or 'none'}")
        ma, mb = read_json(pa, f"units/{u}/memory.json"), read_json(pb, f"units/{u}/memory.json")
        if ma and mb:
            print(f"  memory: rgba8 {ma['total_rgba8_bytes'] / 1e6:.1f} -> {mb['total_rgba8_bytes'] / 1e6:.1f} MB "
                  f"({(mb['total_rgba8_bytes'] - ma['total_rgba8_bytes']) / 1e6:+.1f}); astc 4x4 "
                  f"{ma['total_astc_4x4_bytes'] / 1e6:.1f} -> {mb['total_astc_4x4_bytes'] / 1e6:.1f} MB "
                  f"({(mb['total_astc_4x4_bytes'] - ma['total_astc_4x4_bytes']) / 1e6:+.1f}); pages "
                  f"{ {k: len(v) for k, v in ja['pages'].items() if v} } -> { {k: len(v) for k, v in jb['pages'].items() if v} }")
    for u in units:
        ea, eb = extent(read_json(pa, f"units/{u}/{u}.json")), extent(read_json(pb, f"units/{u}/{u}.json"))
        print(f"\n{u}: reach from the anchor in pt at the default zoom [left, up, right, down], old -> new")
        for key, word in (("moving", "standing, moving, attacking"), ("fall", "the fall")):
            print(f"  {word}:")
            for fc in range(8):
                print(f"    facing {fc}: {ea[fc].get(key)} -> {eb[fc].get(key)}")


if __name__ == "__main__":
    main()
