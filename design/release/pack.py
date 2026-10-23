"""Pack the production atlases of finished CI runs into the files of a GitHub Release art-vN.

The format was agreed with war-game-client (client/docs/sprite-atlas.md section 2):
- art-vN-x3.tar.gz, art-vN-x2.tar.gz: one per scale; at the top level units/<unit>/ (<unit>.json,
  <unit>_<layer>_<k>.png, memory.json; no raw/), effects/ (effects.json, effects_<k>.png), from art-v2
  buildings/ (buildings_<E|W>.json and their pages, memory.json) and nodes/ (nodes.json, its pages,
  memory.json) (design/b1/atlas-buildings.md), from art-v4 castle/ (castle_<E|W>.json, the wall pieces and floor
  tiles of the walled towns, D-089), from art-v5 terrain/ (terrain.json: rock, cliff, water, ford and bridge tiles
  and the rules for placing them, R6-51), and art-release.json (tag, commit, the source runs,
  every file's sha256);
- astc-sample.tar.gz: one unit's 2x colour and player-colour pages as ASTC 4 x 4 in KTX 1
  (<unit>_<layer>_<k>.astc.ktx, astcenc -cl), for the client's ASTC test page on the iPhone;
- SHA256SUMS: sha256sum format, every file above.
The archives are deterministic: sorted entries, a fixed time and owner, gzip without a name or time,
so the same sources and commit pack to the same bytes.

python3 design/release/pack.py --tag art-v1 --work DIR [--astcenc BIN] [--commit SHA]
  reads design/release/<tag>.json, downloads the artifacts it names with gh (into DIR/dl, skipped when
  already there), writes DIR/out/* and DIR/notes.md. Standard library only.
"""
import argparse
import gzip
import hashlib
import io
import json
import subprocess
import sys
import tarfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = "EdwardLeeee/war-game"
MTIME = 1767225600                     # 2026-01-01T00:00:00Z, the time of every entry
PNG_SIG = b"\x89PNG\r\n\x1a\n"
KTX1_SIG = b"\xabKTX 11\xbb\r\n\x1a\n"
ASTC_4X4_RGBA = 0x93B0                 # GL_COMPRESSED_RGBA_ASTC_4x4_KHR (linear, from -cl)
SCALES = ("x3", "x2")


def die(msg):
    sys.exit(f"pack.py: {msg}")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def fetch(run, artifact, dl):
    """The artifact's files in dl/<run>/<artifact>/ (gh run download; kept when already there)."""
    d = dl / str(run) / artifact
    if d.is_dir() and any(d.iterdir()):
        return d
    d.mkdir(parents=True, exist_ok=True)
    subprocess.run(["gh", "run", "download", str(run), "--repo", REPO, "--name", artifact, "--dir", str(d)],
                   check=True)
    return d


def read_png(p):
    data = p.read_bytes()
    if not data.startswith(PNG_SIG):
        die(f"{p} is not a PNG")
    return data


def atlas_dir(src, unit, scale):
    """The artifact's atlas_<scale>/ of the unit: the root is prod/ or prod/<unit>/, depending on the run."""
    found = sorted(p.parent for p in src.rglob(f"atlas_{scale}/{unit}.json"))
    if len(found) != 1:
        die(f"{src}: {len(found)} atlas_{scale}/{unit}.json")
    return found[0]


def unit_files(src, unit, scale):
    """{name: bytes} of one unit's atlas at one scale: the manifest, its pages, memory.json; nothing else."""
    d = atlas_dir(src, unit, scale)
    man = json.loads((d / f"{unit}.json").read_text())
    if man.get("format") != "war-game atlas 2" or man.get("unit") != unit or man.get("scale") != float(scale[1:]):
        die(f"{d / f'{unit}.json'}: format {man.get('format')!r}, unit {man.get('unit')!r}, "
            f"scale {man.get('scale')!r}")
    pages = [p for layer in sorted(man["pages"]) for p in man["pages"][layer]]
    names = [f"{unit}.json", "memory.json", *pages]
    extra = sorted({p.name for p in d.iterdir()} - set(names))
    if extra:
        die(f"{d} has files the manifest does not list: {extra}")
    out = {n: (read_png(d / n) if n.endswith(".png") else (d / n).read_bytes()) for n in names}
    return out, json.loads(out["memory.json"])


def effects_files(src, scale):
    d = src / f"effects_{scale}"
    man = json.loads((d / "effects.json").read_text())
    if man.get("format") != "war-game effects 1" or man.get("scale") != float(scale[1:]):
        die(f"{d / 'effects.json'}: format {man.get('format')!r}, scale {man.get('scale')!r}")
    names = ["effects.json", *man["pages"]]
    extra = sorted({p.name for p in d.iterdir()} - set(names))
    if extra:
        die(f"{d} has files the manifest does not list: {extra}")
    return {n: (read_png(d / n) if n.endswith(".png") else (d / n).read_bytes()) for n in names}


def _info(name, size=None):
    ti = tarfile.TarInfo(name)
    ti.mtime = MTIME
    ti.uid = ti.gid = 0
    ti.uname = ti.gname = ""
    if size is None:
        ti.type, ti.mode = tarfile.DIRTYPE, 0o755
    else:
        ti.size, ti.mode = size, 0o644
    return ti


def write_targz(path, files):
    """files: {posix path: bytes}. Directories are added before their files, all in sorted order."""
    dirs = sorted({"/".join(n.split("/")[:i]) + "/" for n in files for i in range(1, n.count("/") + 1)})
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        for name in sorted(dirs + list(files)):
            if name.endswith("/"):
                tar.addfile(_info(name))
            else:
                tar.addfile(_info(name, len(files[name])), io.BytesIO(files[name]))
    with open(path, "wb") as f, gzip.GzipFile(filename="", mode="wb", fileobj=f, mtime=0, compresslevel=9) as gz:
        gz.write(raw.getvalue())


ATLAS_FORMATS = {"buildings": "war-game buildings 1", "nodes": "war-game nodes 1", "castle": "war-game castle 1",
                 "terrain": "war-game terrain 1"}


def atlas_files(src, folder, scale):
    """{name: bytes} of buildings/, nodes/, castle/ or terrain/ at one scale (atlas_b1.py): every manifest, its pages, memory.json."""
    found = sorted(p.parent for p in src.rglob(f"atlas_{scale}/{folder}/memory.json"))
    if len(found) != 1:
        die(f"{src}: {len(found)} atlas_{scale}/{folder}/")
    d = found[0]
    names = ["memory.json"]
    for mp in sorted(d.glob("*.json")):
        if mp.name == "memory.json":
            continue
        man = json.loads(mp.read_text())
        if man.get("format") != ATLAS_FORMATS[folder] or man.get("scale") != float(scale[1:]):
            die(f"{mp}: format {man.get('format')!r}, scale {man.get('scale')!r}")
        names += [mp.name] + [pg for layer in sorted(man["pages"]) for pg in man["pages"][layer]]
    extra = sorted({p.name for p in d.iterdir()} - set(names))
    if extra:
        die(f"{d} has files no manifest lists: {extra}")
    return {n: (read_png(d / n) if n.endswith(".png") else (d / n).read_bytes()) for n in names}


def ground_files(src, scale):
    """{name: bytes} of ground/ at one scale (design/r8/common/ground_r8.py export): ground.json, its layers, memory.json."""
    found = sorted(p.parent for p in src.rglob(f"atlas_{scale}/ground/ground.json"))
    if len(found) != 1:
        die(f"{src}: {len(found)} atlas_{scale}/ground/")
    d = found[0]
    gj = json.loads((d / "ground.json").read_text())
    if gj.get("format") != "war-game ground 1" or gj.get("scale") != float(scale[1:]):
        die(f"{d / 'ground.json'}: format {gj.get('format')!r}, scale {gj.get('scale')!r}")
    names = ["ground.json", "memory.json"] + [L["file"] for L in gj["layers"]]
    extra = sorted({p.name for p in d.iterdir()} - set(names))
    if extra:
        die(f"{d} has files ground.json does not list: {extra}")
    return {n: (read_png(d / n) if n.endswith(".png") else (d / n).read_bytes()) for n in names}


def with_manifest(files, info):
    """Add art-release.json (the release info and every other file's sha256) to files."""
    info = dict(info, files={n: {"sha256": sha256(b), "bytes": len(b)} for n, b in sorted(files.items())})
    return dict(files, **{"art-release.json": (json.dumps(info, ensure_ascii=False, indent=1) + "\n").encode()})


def astc(astcenc, png, out):
    """astcenc -cl (linear LDR, straight alpha) at 4 x 4, -thorough; check the KTX 1 header it wrote."""
    subprocess.run([astcenc, "-cl", str(png), str(out), "4x4", "-thorough", "-silent"], check=True)
    data = out.read_bytes()
    if not data.startswith(KTX1_SIG):
        die(f"{out} is not KTX 1")
    endian = "little" if data[12:16] == b"\x01\x02\x03\x04" else "big"
    fmt = int.from_bytes(data[28:32], endian)              # glInternalFormat
    if fmt != ASTC_4X4_RGBA:
        die(f"{out}: glInternalFormat {fmt:#x}, expected {ASTC_4X4_RGBA:#x}")
    return data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", required=True)
    ap.add_argument("--work", required=True, type=Path)
    ap.add_argument("--astcenc", help="the astcenc binary; without it there is no astc-sample.tar.gz")
    ap.add_argument("--commit", default="")
    a = ap.parse_args()
    spec = json.loads((HERE / f"{a.tag}.json").read_text())
    if spec["tag"] != a.tag:
        die(f"{a.tag}.json names tag {spec['tag']!r}")
    dl, out = a.work / "dl", a.work / "out"
    out.mkdir(parents=True, exist_ok=True)
    for p in out.iterdir():
        p.unlink()
    sources = {"units": {u: s for u, s in sorted(spec["units"].items())}, "effects": spec["effects"]}
    if "buildings" in spec:
        sources["buildings"] = spec["buildings"]
    base = {"format": "war-game art release 1", "tag": a.tag, "commit": a.commit, "sources": sources}
    notes = [f"{a.tag}：{spec.get('note', '')}", "", f"commit {a.commit or '(local)'}", ""]
    eff_src = fetch(spec["effects"]["run"], spec["effects"]["artifact"], dl)
    unit_src = {u: fetch(s["run"], s["artifact"], dl) for u, s in sources["units"].items()}
    bld_src = fetch(spec["buildings"]["run"], spec["buildings"]["artifact"], dl) if "buildings" in spec else None
    for scale in SCALES:
        files, rgba, astc_b = {}, 0, 0
        for u, src in unit_src.items():
            fs, mem = unit_files(src, u, scale)
            rgba += mem["total_rgba8_bytes"]
            astc_b += mem["total_astc_4x4_bytes"]
            files.update({f"units/{u}/{n}": b for n, b in fs.items()})
        files.update({f"effects/{n}": b for n, b in effects_files(eff_src, scale).items()})
        extra = ""
        if bld_src:
            for folder in ("buildings", "nodes") + tuple(k for k in ("castle", "terrain") if spec.get(k)):
                fs = atlas_files(bld_src, folder, scale)
                files.update({f"{folder}/{n}": b for n, b in fs.items()})
                m = json.loads(fs["memory.json"])
                rgba += m["total_rgba8_bytes"]
                astc_b += m["total_astc_4x4_bytes"]
            if spec.get("ground"):                       # art-v6: the realistic ground (D-093) and its water
                fs = ground_files(bld_src, scale)
                files.update({f"ground/{n}": b for n, b in fs.items()})
                m = json.loads(fs["memory.json"])
                rgba += m["total_rgba8_bytes"]
                astc_b += m["total_astc_4x4_bytes"]
            extra = ("＋建築＋資源點" + ("＋城牆" if spec.get("castle") else "") + ("＋地形" if spec.get("terrain") else "")
                     + ("＋地面" if spec.get("ground") else ""))
        files = with_manifest(files, dict(base, scale=scale))
        name = f"{a.tag}-{scale}.tar.gz"
        write_targz(out / name, files)
        notes.append(f"- {name}：{len(unit_src)} 種兵種＋效果{extra}，{(out / name).stat().st_size / 2 ** 20:.1f} MB；"
                     f"全部載入 {rgba / 2 ** 20:.1f} MB（未壓縮）／{astc_b / 2 ** 20:.1f} MB（ASTC 4×4）"
                     "，照各 memory.json 加總，效果另計")
    if a.astcenc:
        s = spec["astc_sample"]
        u, scale = s["unit"], f"x{s['scale']}"
        d = atlas_dir(unit_src[u], u, scale)
        man = json.loads((d / f"{u}.json").read_text())
        tmp = a.work / "astc"
        tmp.mkdir(exist_ok=True)
        files = {}
        for layer in s["layers"]:
            for page in man["pages"][layer]:
                ktx = page[:-len(".png")] + ".astc.ktx"
                files[f"units/{u}/{ktx}"] = astc(a.astcenc, d / page, tmp / ktx)
        ver = subprocess.run([a.astcenc, "-version"], capture_output=True, text=True).stdout.strip().splitlines()
        files = with_manifest(files, dict(base, scale=scale, sources={"units": {u: sources["units"][u]}},
                                          astc={"encoder": ver[0] if ver else "", "args": "-cl 4x4 -thorough",
                                                "container": "KTX 1", "alpha": "straight (not premultiplied)",
                                                "frames": f"{a.tag}-{scale}.tar.gz units/{u}/{u}.json"}))
        write_targz(out / "astc-sample.tar.gz", files)
        notes.append(f"- astc-sample.tar.gz：{u} 的 2 倍顏色層和玩家色層，ASTC 4×4（KTX 1），"
                     f"{(out / 'astc-sample.tar.gz').stat().st_size / 2 ** 20:.1f} MB")
    sums = "".join(f"{sha256(p.read_bytes())}  {p.name}\n" for p in sorted(out.iterdir()))
    (out / "SHA256SUMS").write_text(sums)
    notes += ["", "SHA256SUMS：", "```", sums.rstrip(), "```", "",
              "格式：client/docs/sprite-atlas.md 第 2 節。已發布的 tag 不再換檔案，內容有改就出新的 tag。"]
    (a.work / "notes.md").write_text("\n".join(notes) + "\n")
    print(sums, end="")


if __name__ == "__main__":
    main()
