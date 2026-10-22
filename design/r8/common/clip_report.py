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


RIDERS = ("hcav_e", "knight_w")


def closeup(a, unit, anim, facing, k, bg, zoom=3):
    """The frame at the phone's 3x pixels (the atlas), cropped to the soldier's body and the weapon in his hands (a
    square on the body, from the feet up: 1.9 m, a rider 2.6 m), enlarged `zoom` times without smoothing."""
    got = B.frame(a, unit, anim, facing, k, "blue")
    if got is None:
        return Image.new("RGB", (240, 240), boards.BG)
    body, (ax, ay), _ = got
    ppm = B.PPM
    side = int((2.6 if unit in RIDERS else 1.9) * ppm)
    cy = ay - side * 0.55 if anim not in ("death", "fall", "dead") else ay - side * 0.3
    box = (int(ax - side / 2), int(cy - side / 2), int(ax + side / 2), int(cy + side / 2))
    base = Image.new("RGBA", (side, side), bg)
    base.alpha_composite(body, (-box[0], -box[1]))
    return base.resize((side * zoom, side * zoom), Image.NEAREST).convert("RGB")


def depth_text(gap):
    if gap >= 0:
        return f"離皮膚只有 {gap * 100:.0f} cm"
    if gap <= -0.3:
        return "穿過身體"
    return f"穿進 {-gap * 100:.0f} cm"


def tile(img, text, width=None):
    """An image with its caption wrapped under it."""
    from PIL import ImageDraw
    w = width or img.width
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    th = boards.wrap(probe, 0, 0, text, w, size=22) + 8
    out = Image.new("RGB", (max(w, img.width), img.height + th), boards.BG)
    out.paste(img, (0, 0))
    boards.wrap(ImageDraw.Draw(out), 0, img.height + 6, text, w, size=22, fill=boards.INK)
    return out


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
            cap = f"{anim} 朝向 {facing} 第 {k} 格：{depth_text(gap)}（{where}）。左修正前、右修正後"
            pair = B.strip([closeup(old, u, anim, facing, k, bg), closeup(new, u, anim, facing, k, bg)])
            tiles.append(tile(pair, cap))
        head = f"{NAMES[u]}　修正前 {b['failing']} / {b['frames']} 格 → 修正後 {a['failing']} / {a['frames']} 格"
        if tiles:
            parts.append(boards.row([boards.captioned(boards.row(tiles, W - 2 * boards.M, gap=30), head, 28)], W))
        else:
            parts.append(boards.row([boards.captioned(Image.new("RGB", (W - 2 * boards.M, 4), boards.BG),
                                                      head + "（修正前就沒有穿模）", 28)], W))
    text = ("武器穿模檢查（使用者 2026-10-21：「你的槍穿過身體了」）。每種兵的每個動作、每一格、8 個方向都檢查："
            "武器每條邊上每 2 cm 取一點，量到寫實人體（和馬）表面的距離；穿進身體，或離皮膚不到 3 cm（衣服和甲的厚度；手臂 1.2 cm，"
            "馬 3 cm）都算穿模。握著武器的拳頭本身不算。\n" + "；".join(rows_txt) + "。\n"
            "怎麼修：槍桿從身體外側過、紮槍時後手滑到槍尾；武器改從寫實人體的拳頭正中穿過（原本在手的外緣）；"
            "騎兵的槍尾只留 0.12 m；村民扛工具改握柄尾；其餘每一格自動把武器連同手推離身體，手肘轉開。\n"
            "特寫：手機 3 倍的像素，再放大 3 倍（不柔化），裁到身體和手上的武器；每種兵挑修正前穿得最深的幾格（每個動作一格）。")
    out = [boards.header(W, "R8-98-穿模檢查-mobile", text)] + parts
    p = boards.save(boards.stack(out, W), "R8-98-穿模檢查-mobile")
    (B.OUT / "clipping.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1))
    return p


if __name__ == "__main__":
    a = sys.argv[1:]
    main(a[0], a[1], a[2], a[3], a[4:])
