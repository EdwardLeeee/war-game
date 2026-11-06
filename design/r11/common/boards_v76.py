"""art-v7.6 (the user 2026-11-06: 「圖裡面的城門方向不太對」; design/b1/common/castle.DIAMOND_TURN): the V76 boards,
before (art-v7.5) and after (art-v7.6), East and West, each panel a phone held sideways as R14's (814 x 380 pt, 3 px a
pt, shown at half size), drawn as the client lays the pieces (design/r14/common/scene_r14.py: castle-draw.ts,
structure-art.ts, outpost-crew.ts; the client's projection, +x down-right, +y down-left):
  V76-01 the four gates of a town, each in another look (open, closed, damaged, broken)
  V76-02 the walls' crenels and stakes along the wall (the town's near corner)
  V76-03 units on the walls, the gates' piers, the corner towers and over the gates, under the front layers
  V76-04 where the arrows leave the arrow tower, the city, the keep and the outpost (shoot_at_m, red dots)
  V76-05 the outpost's hidden spearmen on its walk (stand_m)
  V76-06 the rectangular decorative pieces on their own ground (the piece's metres outlined)

python3 design/r11/common/boards_v76.py --before DIR --after DIR --units DIR [--out DIR] [V76-01 ...]
  --before, --after: an atlas_x3 (buildings/, castle/, ground/): art-v7.5's release x3; art-v7.6's buildings-atlas run
  --units: the unit atlases (<unit>.json and its pages in a folder named atlas_x3, as scene_r14 looks for them)
  --out: default design/release/build/v76-boards. All of it build output (not in git).
"""
import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(REPO / "design" / "r14" / "common"))
sys.path.insert(0, str(REPO / "design" / "b1" / "common"))
import scene_r14 as S        # noqa: E402
import castle as CASTLE      # noqa: E402  (DECOR_SIZE)

BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
TC = 3
SHRINK = 0.5
NAME = {"E": "東陸", "W": "西陸"}
SPEAR = {"E": "spear_e", "W": "pike_w"}
BOW = {"E": "bow_e", "W": "bow_w"}
T = (40, 40)                 # every town's centre cell


def font(size, bold=True):
    return ImageFont.truetype(BOLD if bold else REG, size, index=TC)


def town(layout, **kw):
    return dict(id="T", layout=layout, at=list(T), team="blue", **kw)


def on_wall(c, cells, kind="bow", face=6):
    u = BOW[c] if kind == "bow" else SPEAR[c]
    return [dict(u=u, team="blue", wall=["T", dx, dy], face=face, k=(3 * i) % 8) for i, (dx, dy) in enumerate(cells)]


# ---------------------------------------------------------------- the scenes of each board, for one culture

def b01(c):
    return [("大城（石牆）：北門開、東門關、南門受損、西門打破",
             dict(zoom=0.56, focus=[40.5, 40.5, 407, 205], culture=c,
                  towns=[town("large_d100", gates={"n": "intact", "e": "closed", "s": "damaged", "w": "broken"})])),
            ("小鎮（木柵）：北門關、東門開、南門打破、西門受損",
             dict(zoom=0.72, focus=[40.5, 40.5, 407, 200], culture=c,
                  towns=[town("small_d100", gates={"n": "closed", "e": "intact", "s": "broken", "w": "damaged"})]))]


def b02(c):
    return [("大城的近角：南牆、東牆和角樓", dict(zoom=1.5, focus=[48.6, 48.6, 407, 250], culture=c,
                                     towns=[town("large_d100")])),
            ("小鎮的近角：南牆、東牆和角哨", dict(zoom=1.7, focus=[46.8, 46.8, 407, 250], culture=c,
                                     towns=[town("small_d100")]))]


def b03(c):
    big = ([(x, 9) for x in (3, 5, 7)] + [(9, y) for y in (3, 5, 7)] + [(-2, 9), (2, 9), (9, -2), (9, 2)]
           + [(8, 8), (9, 8), (8, 9), (9, 9)] + [(0, 9), (9, 0)])
    small = [(x, 7) for x in (2, 4, 6)] + [(7, y) for y in (2, 4, 6)] + [(7, 7)]
    return [("大城：弓兵站在南牆、東牆、兩座城門的墩台、角樓，和關著的城門頂上",
             dict(zoom=1.05, focus=[45.5, 45.5, 407, 225], culture=c, towns=[town("large_d100")],
                  units=on_wall(c, big))),
            ("小鎮：槍兵站在南牆、東牆的木柵後和角哨上",
             dict(zoom=1.25, focus=[44.5, 44.5, 407, 225], culture=c, towns=[town("small_d100")],
                  units=on_wall(c, small, "spear")))]


B04 = [("ArrowTower", (35, 45.5)), ("MainCity", (38.5, 42)), ("Keep", (42, 38.5)), ("Outpost", (45.5, 35))]


def b04(c):
    return [("箭樓、主城、主堡、哨所；紅點是箭射出的位置",
             dict(zoom=0.95, focus=[40.5, 40.5, 407, 265], culture=c,
                  buildings=[dict(id=b, b=b, at=list(at), team="blue") for b, at in B04]))]


def b05(_):
    posts = [dict(id=f"post{c}", b="Outpost", at=at, culture=c, team="blue") for c, at in (("E", [38.5, 42.5]), ("W", [42.5, 38.5]))]
    return [("哨所躲著的兵（D-121）站在牆頂：左東陸槍兵、右西陸槍兵，各 9 名",
             dict(zoom=1.9, focus=[40.5, 40.5, 407, 250], culture="E", buildings=posts, units=[]))]


def b06(c):
    return [("小鎮北角的擺設（小屋兩種、棚子、柴堆、推車）；白框是每件擺設佔的地",
             dict(zoom=1.55, focus=[36.2, 36.2, 407, 205], culture=c, towns=[town("small_d100")])),
            ("大城北角的擺設", dict(zoom=1.35, focus=[34.6, 34.6, 407, 205], culture=c, towns=[town("large_d100")]))]


BOARDS = {
    "V76-01": ("V76-01-四座城門-前後對照-phone", "四座城門：門洞要垂直穿過它那段牆", b01, "EW"),
    "V76-02": ("V76-02-牆的垛口-前後對照-phone", "牆的垛口、木柵沿著牆走", b02, "EW"),
    "V76-03": ("V76-03-牆上和門頂的兵-前後對照-phone", "兵站在牆上和門頂，前景層蓋在他們前面", b03, "EW"),
    "V76-04": ("V76-04-箭射出的位置-前後對照-phone", "箭從箭樓、主城、主堡、哨所的箭窗射出", b04, "EW"),
    "V76-05": ("V76-05-哨所躲著的兵-前後對照-phone", "哨所躲著的兵站在牆頂", b05, "E"),
    "V76-06": ("V76-06-長方形的擺設-前後對照-phone", "長方形的擺設沿著它佔的地擺", b06, "EW"),
}


# ---------------------------------------------------------------- drawing

def outpost_crew(art, sc):
    """D-121: every outpost's spearmen on its walk at stand_m, facing out from its middle (outpost-crew.ts facingTo)."""
    out = []
    for b in sc.get("buildings", []):
        if b["b"] != "Outpost" or not b["id"].startswith("post"):
            continue
        c = b.get("culture", sc.get("culture", "E"))
        for i, (mx, my, _) in enumerate(art.buildings(c).j["buildings"]["Outpost"].get("stand_m", [])):
            out.append(dict(u=SPEAR[c], team="blue", post=[b["id"], i], face=S.screen_face(mx, my), k=(3 * i) % 8))
    return out


def marks(art, sc, im):
    """Over the panel: the arrows' starting points (V76-04) and the decorative pieces' ground (V76-06)."""
    cam = S.Cam(sc["zoom"], sc.get("look"), sc.get("focus"))
    d = ImageDraw.Draw(im)
    K = S.K
    for b in sc.get("buildings", []):
        if b["id"].startswith("post"):
            continue
        info = art.buildings(b.get("culture", sc.get("culture", "E"))).j["buildings"][b["b"]]
        for mx, my, mz in info.get("shoot_at_m", []):
            x, y = cam.pt(b["at"][0] + mx / 2, b["at"][1] + my / 2, mz * S.PT_PER_M * S.UP_PER_M)
            r = 11
            d.ellipse((x * K - r, y * K - r, x * K + r, y * K + r), fill=(235, 40, 40), outline=(255, 255, 255), width=3)
    if sc.get("decor_outline"):
        ca = art.castle(sc.get("culture", "E"))
        for t in sc.get("towns", []):
            for dd in ca.j["layouts"][t["layout"]].get("decor", []):
                w, h = CASTLE.DECOR_SIZE[dd["piece"]]
                ax, ay = T[0] + dd["at"][0], T[1] + dd["at"][1]
                pts = [cam.pt(ax + sx * w / 4, ay + sy * h / 4) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
                d.line([(x * K, y * K) for x, y in pts + pts[:1]], fill=(255, 236, 120), width=4)


def panel(art, name, sc, out):
    sc = dict(sc)
    if any(b["id"].startswith("post") for b in sc.get("buildings", [])):
        sc["units"] = outpost_crew(art, sc)
    S.OUT = out
    S.draw_scene(art, name, sc)
    im = Image.open(out / f"{name}.png").convert("RGB")
    marks(art, sc, im)
    (out / f"{name}.png").unlink()
    return im.resize((round(im.width * SHRINK), round(im.height * SHRINK)), Image.LANCZOS)


def board(key, before, after, out):
    fname, title, scenes, cultures = BOARDS[key]
    rows = []
    for c in cultures:
        for label, sc in scenes(c):
            if key == "V76-06":
                sc = dict(sc, decor_outline=True)
            head = label if key == "V76-05" else f"{NAME[c]}　{label}"
            rows.append((head, panel(before, f"{key}-{c}-b", sc, out), panel(after, f"{key}-{c}-a", sc, out)))
    pw, ph = rows[0][1].size
    gap, top, lab = 16, 150, 58
    W = 2 * pw + 3 * gap
    H = top + len(rows) * (lab + ph + gap)
    img = Image.new("RGB", (W, H), (24, 26, 30))
    d = ImageDraw.Draw(img)
    d.text((gap, 14), f"{key}　{title}", font=font(54), fill=(240, 240, 240))
    d.text((gap, 84), "左：前（art-v7.5，算圖鏡頭看向東北，和 client 差 90 度）　右：後（art-v7.6，照 client 的菱形投影）",
           font=font(30, False), fill=(200, 200, 200))
    y = top
    for head, b, a in rows:
        d.text((gap, y + 8), head, font=font(34), fill=(250, 220, 140))
        y += lab
        img.paste(b, (gap, y))
        img.paste(a, (2 * gap + pw, y))
        for x0, tag in ((gap, "前 art-v7.5"), (2 * gap + pw, "後 art-v7.6")):
            d.rectangle((x0, y, x0 + 230, y + 48), fill=(0, 0, 0))
            d.text((x0 + 10, y + 4), tag, font=font(32), fill=(255, 255, 255))
        y += ph + gap
    # 圖內左上角印同一標籤 (pref.ui.label_artboards_by_item_and_option): the title already leads with it
    path = out / f"{fname}.png"
    img.save(path, optimize=True)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--before", required=True)
    ap.add_argument("--after", required=True)
    ap.add_argument("--units", required=True)
    ap.add_argument("--out", default=str(REPO / "design" / "release" / "build" / "v76-boards"))
    ap.add_argument("only", nargs="*")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    before = S.Art(Path(a.before), Path(a.units))
    after = S.Art(Path(a.after), Path(a.units))
    for key in BOARDS:
        if a.only and key not in a.only:
            continue
        print(board(key, before, after, out))


if __name__ == "__main__":
    main()
