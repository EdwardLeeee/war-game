"""R7 (D-092): pack the style test for the client's phone page, as GitHub Release style-test-N (the art-vN way:
deterministic archives, every file's sha256, SHA256SUMS; design/release/pack.py does the work).

  style-test-N-x3.tar.gz, style-test-N-x2.tar.gz:
    v<k>/units/<unit>/   the unit's atlas (war-game atlas 2) in realism version k's look; v0 is art-v4's own
    scenes/v<k>.png      the version's battlefield at 3x (design/r7/out), for the page's background
    style-release.json   the tag, the commit, the sources, every file's sha256
  SHA256SUMS
Version 3 (the AI test) is never in it (THIRD_PARTY_NOTICES.md).

python3 design/r7/common/pack_style.py --tag style-test-1 --work DIR [--commit SHA]
  reads design/release/<tag>.json: {"tag", "note", "versions": {"<k>": {"<unit>": {"run", "artifact"}}}}
"""
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
R7 = HERE.parent
sys.path.insert(0, str(R7.parent / "release"))
import pack  # noqa: E402

SCALES = ("x3", "x2")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", required=True)
    ap.add_argument("--work", required=True, type=Path)
    ap.add_argument("--commit", default="")
    a = ap.parse_args()
    spec = json.loads((R7.parent / "release" / f"{a.tag}.json").read_text())
    if spec["tag"] != a.tag or not a.tag.startswith("style-test-"):
        pack.die(f"{a.tag}.json names tag {spec['tag']!r}")
    if "3" in spec["versions"]:
        pack.die("version 3 (the AI test) is not for release (THIRD_PARTY_NOTICES.md)")
    dl, out = a.work / "dl", a.work / "out"
    out.mkdir(parents=True, exist_ok=True)
    for p in out.iterdir():
        p.unlink()
    src = {k: {u: pack.fetch(s["run"], s["artifact"], dl) for u, s in sorted(units.items())}
           for k, units in sorted(spec["versions"].items())}
    base = {"format": "war-game style test 1", "tag": a.tag, "commit": a.commit, "sources": spec["versions"]}
    notes = [f"{a.tag}：{spec.get('note', '')}", "", f"commit {a.commit or '(local)'}", ""]
    for scale in SCALES:
        files = {}
        for k, units in src.items():
            for u, d in units.items():
                fs, _ = pack.unit_files(d, u, scale)
                files.update({f"v{k}/units/{u}/{n}": b for n, b in fs.items()})
            sp = R7 / "out" / f"scene-v{k}_x3.png"
            files[f"scenes/v{k}.png"] = pack.read_png(sp)
        info = dict(base, scale=scale, files={n: {"sha256": pack.sha256(b), "bytes": len(b)} for n, b in sorted(files.items())})
        files["style-release.json"] = (json.dumps(info, ensure_ascii=False, indent=1) + "\n").encode()
        name = f"{a.tag}-{scale}.tar.gz"
        pack.write_targz(out / name, files)
        notes.append(f"- {name}：版本 {', '.join(sorted(src))} 的兵種圖集與場景圖，{(out / name).stat().st_size / 2 ** 20:.1f} MB")
    sums = "".join(f"{pack.sha256((out / n).read_bytes())}  {n}\n" for n in sorted(p.name for p in out.iterdir()))
    (out / "SHA256SUMS").write_text(sums)
    (a.work / "notes.md").write_text("\n".join(notes) + "\n")
    print(sums)


if __name__ == "__main__":
    main()
