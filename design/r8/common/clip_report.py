"""R8: the weapon-clipping report (design/r8/blender/clip_r8.py) as one board: per unit, the frames that failed before
the fix and after it (every frame of every animation, all 8 facings), and close-ups at the phone's 3x pixels of the
frames that failed most, before and after, side by side.

python3 design/r8/common/clip_report.py BEFORE_DIR AFTER_DIR OLD_ATLASES NEW_ATLASES UNIT [UNIT ...]
  BEFORE_DIR / AFTER_DIR   folders with <unit>/clip.json (render_prod's clip check, before and after)
  OLD_ATLASES / NEW_ATLASES  folders with <unit>/atlas_x3/<unit>.json
writes design/r8/out/R8-98-穿模檢查-mobile.png and design/r8/out/clipping.json
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import boards_r8 as B   # noqa: E402

boards = B.boards
NAMES = {u: f"{v[2]}{v[1]}" for u, v in B.UNITS.items()}


def worst_frames(rep, n=3):
    """The n failing frames with the deepest clip, one per animation where it can."""
    rows = []
    for f in rep["fails"]:
        g = min(p["gap"] for p in f["parts"])
        rows.append((g, f["anim"], f["facing"], f["frame"], f["parts"]))
    rows.sort()
    out, seen = [], set()
    for r in rows:
        if r[1] in seen:
            continue
        seen.add(r[1])
        out.append(r)
        if len(out) == n:
            break
    return out


def closeup(a, unit, anim, facing, k, bg):
    """The frame at the phone's 3x pixels (the atlas), cropped to the unit and doubled for the board."""
    got = B.frame(a, unit, anim, facing, k, "blue")
    if got is None:
        return Image.new("RGB", (240, 240), boards.BG)
    body, _, _ = got
    box = body.getbbox() or (0, 0, body.width, body.height)
    c = body.crop(box)
    base = Image.new("RGBA", c.size, bg)
    base.alpha_composite(c)
    return base.resize((c.width * 2, c.height * 2), Image.NEAREST).convert("RGB")


def main(before_dir, after_dir, old_dir, new_dir, units):
    W = 2500
    rows_txt, parts, summary = [], [], {}
    bg = (96, 116, 82, 255)
    for u in units:
        b = json.loads((Path(before_dir) / u / "clip.json").read_text())
        a = json.loads((Path(after_dir) / u / "clip.json").read_text())
        summary[u] = dict(before=b["failing"], after=a["failing"], frames=a["frames"],
                          before_by_anim={k: v[1] for k, v in b["by_anim"].items()},
                          after_by_anim={k: v[1] for k, v in a["by_anim"].items()})
        rows_txt.append(f"{NAMES[u]}：修正前 {b['failing']} / {b['frames']} 格，修正後 {a['failing']} / {a['frames']} 格")
        old = B.field.Atlas(Path(old_dir) / u / "atlas_x3" / f"{u}.json")
        new = B.field.Atlas(Path(new_dir) / u / "atlas_x3" / f"{u}.json")
        tiles = []
        for gap, anim, facing, k, ps in worst_frames(b):
            where = "、".join(sorted({p.get("where") or "馬" for p in ps}))
            cap = f"{anim} 朝向 {facing} 第 {k} 格（穿進 {max(0.0, -gap) * 100:.0f} cm，{where}）"
            pair = B.strip([closeup(old, u, anim, facing, k, bg), closeup(new, u, anim, facing, k, bg)])
            tiles.append(boards.captioned(pair, f"左修正前、右修正後：{cap}", 22))
        if tiles:
            parts.append(boards.row([boards.captioned(Image.new("RGB", (10, 10), boards.BG), NAMES[u], 28)] + tiles, W,
                                    gap=30))
    text = ("武器穿模檢查（使用者 2026-10-21：「你的槍穿過身體了」）。每種兵的每個動作、每一格、8 個方向都檢查："
            "武器每條邊上每 2 cm 取一點，量到寫實人體（和馬）表面的距離；穿進身體，或離皮膚不到 3 cm（衣服和甲的厚度；手臂 1.2 cm，"
            "馬 3 cm）都算穿模。握著武器的拳頭本身不算。\n" + "；".join(rows_txt) + "。\n"
            "怎麼修：槍桿從身體外側過、紮槍時後手滑到槍尾；武器改從寫實人體的拳頭正中穿過（原本在手的外緣）；"
            "騎兵的槍尾只留 0.12 m；村民扛工具改握柄尾；其餘每一格自動把武器連同手推離身體，手肘轉開。\n"
            "特寫：手機 3 倍的像素，放大 2 倍；每種兵挑修正前穿得最深的幾格。")
    out = [boards.header(W, "R8-98-穿模檢查-mobile", text)] + parts
    p = boards.save(boards.stack(out, W), "R8-98-穿模檢查-mobile")
    (B.OUT / "clipping.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1))
    return p


if __name__ == "__main__":
    a = sys.argv[1:]
    main(a[0], a[1], a[2], a[3], a[4:])
