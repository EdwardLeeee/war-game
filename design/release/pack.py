"""Pack the production atlases of finished CI runs into the files of a GitHub Release art-vN.

The format was agreed with war-game-client (client/docs/sprite-atlas.md section 2):
- art-vN-x3.tar.gz, art-vN-x2.tar.gz: one per scale; at the top level units/<unit>/ (<unit>.json,
  <unit>_<layer>_<k>.png, memory.json; no raw/), effects/ (effects.json, effects_<k>.png), from art-v2
  buildings/ (buildings_<E|W>.json and their pages, memory.json) and nodes/ (nodes.json, its pages,
  memory.json) (design/b1/atlas-buildings.md), from art-v4 castle/ (castle_<E|W>.json, the wall pieces and floor
  tiles of the walled towns, D-089; from art-v6 decorative pieces instead of the tiles, D-100), from art-v5
  terrain/ (terrain.json: rock, cliff, water, ford and bridge tiles and the rules for placing them, R6-51), from
  art-v6 ground/ (ground.json and its layers: the realistic ground, its water and the towns' tracks, D-093), and
  art-release.json (tag, commit, the source runs, every file's sha256);
- astc-sample.tar.gz: one unit's 2x colour and player-colour pages as ASTC 4 x 4 in KTX 1
  (<unit>_<layer>_<k>.astc.ktx, astcenc -cl), for the client's ASTC test page on the iPhone (up to art-v7);
- from art-v7.1 (spec "astc": true, the format agreed with the client 2026-11-05): art-vN-astc-x3.tar.gz,
  art-vN-astc-x2.tar.gz, every page drawn as a sprite (all but ground/) as ASTC 4 x 4 in KTX 1, premultiplied, at the
  PNG's own path with .png turned into .astc.ktx, so it unpacks over the same x3/ or x2/ folder; its own list is
  art-release-astc.json (not art-release.json, which it would overwrite); each memory.json of the PNG archive gets
  astc_bytes, the .astc.ktx files' real size;
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
# art-v7.1 (client 2026-11-05): ground/ stays PNG: its layers' A is height, not coverage, and relief and ripple are data
ASTC_SKIP = ("ground/",)
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


ATLAS_FORMATS = {"buildings": ("war-game buildings 1",), "nodes": ("war-game nodes 1",),
                 "castle": ("war-game castle 1", "war-game castle 2"),    # 2 from art-v6: decor, no floor tiles
                 "terrain": ("war-game terrain 1",)}


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
        if man.get("format") not in ATLAS_FORMATS[folder] or man.get("scale") != float(scale[1:]):
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
    names = ["ground.json", "memory.json"] + [L["file"] for L in gj["layers"]] + [gj[k]["file"] for k in ("relief", "ripple") if k in gj]   # art-v7
    extra = sorted({p.name for p in d.iterdir()} - set(names))
    if extra:
        die(f"{d} has files ground.json does not list: {extra}")
    return {n: (read_png(d / n) if n.endswith(".png") else (d / n).read_bytes()) for n in names}


def edge_files(src, scale):
    """{name: bytes} of edge/ at one scale (design/r11/common/edge_pack.py, the format design/r11/edge-format.md):
    edge.json, every picture it names, memory.json."""
    found = sorted(p.parent for p in src.rglob(f"atlas_{scale}/edge/edge.json"))
    if len(found) != 1:
        die(f"{src}: {len(found)} atlas_{scale}/edge/")
    d = found[0]
    ej = json.loads((d / "edge.json").read_text())
    if ej.get("format") != "war-game edge 1" or ej.get("scale") != float(scale[1:]) or ej.get("view") != "diamond":
        die(f"{d / 'edge.json'}: format {ej.get('format')!r}, scale {ej.get('scale')!r}, view {ej.get('view')!r}")
    named = set()

    def walk(v):
        if isinstance(v, dict):
            for k, x in v.items():
                if k == "file":
                    named.add(x)
                else:
                    walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)
    walk(ej)
    names = ["edge.json", "memory.json"] + sorted(named)
    missing = [n for n in names if not (d / n).exists()]
    extra = sorted({p.name for p in d.iterdir()} - set(names))
    if missing or extra:
        die(f"{d}: edge.json names missing files {missing}, or there are files it does not name {extra}")
    return {n: (read_png(d / n) if n.endswith(".png") else (d / n).read_bytes()) for n in names}


def stamp_view(files, view):
    """D-118 (art-v7 on): every manifest says which camera its pictures are for (the client switches to the diamond
    camera on art-release.json's "view" and picks the units' facing table by it, client/docs/sprite-atlas.md 3).
    The units are camera-free pictures (the sun stays at the screen's upper left), so their manifests get it here;
    the buildings', castle's, nodes' and terrain's come from atlas_b1 and must already agree."""
    for n, b in list(files.items()):
        if not n.endswith(".json") or n.endswith("memory.json"):
            continue
        m = json.loads(b)
        if not str(m.get("format", "")).startswith("war-game "):
            continue
        if m.get("view", view) != view:
            die(f"{n}: view {m.get('view')!r}, the release is {view!r}")
        if m.get("view") != view:
            m["view"] = view
            files[n] = json.dumps(m, separators=(",", ":")).encode()
    return files


def with_manifest(files, info, name="art-release.json"):
    """Add art-release.json (the release info and every other file's sha256) to files."""
    info = dict(info, files={n: {"sha256": sha256(b), "bytes": len(b)} for n, b in sorted(files.items())})
    return dict(files, **{name: (json.dumps(info, ensure_ascii=False, indent=1) + "\n").encode()})


def astc(astcenc, png, out, premultiply=False):
    """astcenc -cl (linear LDR) at 4 x 4, -thorough; straight alpha, or premultiplied (-pp-premultiply: the client draws
    the pages premultiplied, as the browser makes the PNGs); check the KTX 1 header it wrote: the format, the PNG's
    size, one level."""
    subprocess.run([astcenc, "-cl", str(png), str(out), "4x4", "-thorough", "-silent"]
                   + (["-pp-premultiply"] if premultiply else []), check=True)
    data = out.read_bytes()
    if not data.startswith(KTX1_SIG):
        die(f"{out} is not KTX 1")
    endian = "little" if data[12:16] == b"\x01\x02\x03\x04" else "big"
    word = lambda i: int.from_bytes(data[i:i + 4], endian)     # noqa: E731
    fmt = word(28)                                         # glInternalFormat
    if fmt != ASTC_4X4_RGBA:
        die(f"{out}: glInternalFormat {fmt:#x}, expected {ASTC_4X4_RGBA:#x}")
    head = png.read_bytes()[16:24]                         # the PNG's IHDR width and height
    size = (int.from_bytes(head[:4], "big"), int.from_bytes(head[4:], "big"))
    if (word(36), word(40)) != size or word(56) != 1:
        die(f"{out}: {word(36)} x {word(40)}, {word(56)} levels; the PNG is {size[0]} x {size[1]}")
    return data


def astc_set(astcenc, files, tmp):
    """{name.astc.ktx: bytes} for every PNG of files but ground/'s (art-v7.1), premultiplied; and files with each
    memory.json given astc_bytes, the real size of the .astc.ktx files in its folder."""
    tmp.mkdir(parents=True, exist_ok=True)
    ktx = {}
    for n in sorted(files):
        if not n.endswith(".png") or n.startswith(ASTC_SKIP):
            continue
        src = tmp / "page.png"
        src.write_bytes(files[n])
        ktx[n[:-len(".png")] + ".astc.ktx"] = astc(astcenc, src, tmp / "page.astc.ktx", premultiply=True)
    files = dict(files)
    for n in sorted(files):
        if not n.endswith("/memory.json") or n.startswith(ASTC_SKIP):
            continue
        folder = n[:-len("memory.json")]
        m = json.loads(files[n])
        m["astc_bytes"] = sum(len(b) for k, b in ktx.items() if k.startswith(folder) and "/" not in k[len(folder):])
        files[n] = (json.dumps(m, indent=1) + "\n").encode()
    return ktx, files


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
    if "terrain_src" in spec:             # art-v7.3: terrain/ alone from another run, the rest as the buildings' run
        sources["terrain"] = spec["terrain_src"]
    base = {"format": "war-game art release 1", "tag": a.tag, "commit": a.commit, "sources": sources,
            **({"view": spec["view"]} if spec.get("view") else {})}     # D-118: "diamond" from art-v7 on
    notes = [f"{a.tag}：{spec.get('note', '')}", "", f"commit {a.commit or '(local)'}", ""]
    if spec.get("astc") and not a.astcenc:
        die(f"{a.tag}.json asks for the ASTC archives: give --astcenc")
    eff_src = fetch(spec["effects"]["run"], spec["effects"]["artifact"], dl)
    unit_src = {u: fetch(s["run"], s["artifact"], dl) for u, s in sources["units"].items()}
    bld_src = fetch(spec["buildings"]["run"], spec["buildings"]["artifact"], dl) if "buildings" in spec else None
    ter_src = fetch(spec["terrain_src"]["run"], spec["terrain_src"]["artifact"], dl) if "terrain_src" in spec else bld_src
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
                fs = atlas_files(ter_src if folder == "terrain" else bld_src, folder, scale)
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
            if spec.get("edge"):                         # art-v7: the floating continent's edge (D-118)
                fs = edge_files(bld_src, scale)
                files.update({f"edge/{n}": b for n, b in fs.items()})
                m = json.loads(fs["memory.json"])
                rgba += m["total_rgba8_bytes"]
                astc_b += m["total_astc_4x4_bytes"]
            extra = ("＋建築＋資源點" + ("＋城牆" if spec.get("castle") else "") + ("＋地形" if spec.get("terrain") else "")
                     + ("＋地面" if spec.get("ground") else "") + ("＋邊緣" if spec.get("edge") else ""))
        if spec.get("view"):
            files = stamp_view(files, spec["view"])
        ktx = None
        if spec.get("astc"):                             # art-v7.1: ASTC 4x4 of every sprite page (client 2026-11-05)
            ktx, files = astc_set(a.astcenc, files, a.work / "astc" / scale)
        files = with_manifest(files, dict(base, scale=scale))
        name = f"{a.tag}-{scale}.tar.gz"
        write_targz(out / name, files)
        notes.append(f"- {name}：{len(unit_src)} 種兵種＋效果{extra}，{(out / name).stat().st_size / 2 ** 20:.1f} MB；"
                     f"全部載入 {rgba / 2 ** 20:.1f} MB（未壓縮）／{astc_b / 2 ** 20:.1f} MB（ASTC 4×4）"
                     "，照各 memory.json 加總，效果另計")
        if ktx is not None:
            ver = subprocess.run([a.astcenc, "-version"], capture_output=True, text=True).stdout.strip().splitlines()
            aname = f"{a.tag}-astc-{scale}.tar.gz"
            write_targz(out / aname, with_manifest(ktx, dict(base, scale=scale, astc={
                "encoder": ver[0] if ver else "", "args": "-cl 4x4 -thorough -pp-premultiply", "container": "KTX 1",
                "glInternalFormat": f"{ASTC_4X4_RGBA:#x}", "alpha": "premultiplied", "mipmaps": False,
                "png": f"{name}: each .astc.ktx is the page at the same path with .png turned into .astc.ktx",
                "not_compressed": list(ASTC_SKIP)}), "art-release-astc.json"))
            notes.append(f"- {aname}：{name} 裡除了地面以外的每一頁，ASTC 4×4（KTX 1，預乘 alpha），"
                         f"{(out / aname).stat().st_size / 2 ** 20:.1f} MB；全部載入 {sum(map(len, ktx.values())) / 2 ** 20:.1f} MB"
                         "（實際檔案加總，含效果；地面另計，照舊用 PNG）。解在同一個資料夾上")
    if a.astcenc and spec.get("astc_sample"):
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
