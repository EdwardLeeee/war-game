"""D-096 城門 drafts (the user 2026-10-21: the gates shut, only the holder's units pass, every unit can break one given
time): every gate of a culture in its four looks (open = art-v4's intact, closed, damaged, broken; blender/gates.py),
at the phone's 3x pixels and at actual size, and the gate tower's glint when it shoots (effects.py tower_shot) at the
pieces' `shoot_at_<k>` points, with the arrow the client already draws.

python3 design/b1/common/gate_board.py [SUFFIX]      (prev: run.py d096_<c> --preview --ppm 60; x3: the full render)
writes design/r8/out/R8-17-城門-東陸-mobile.png and R8-18-城門-西陸-mobile.png
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(1, str(HERE.parents[1] / "production" / "common"))
import config   # noqa: E402
import proj     # noqa: E402
import scene    # noqa: E402
import b1art    # noqa: E402
sys.path.insert(0, str(HERE.parents[1] / "r6" / "common"))
import boards   # noqa: E402
import effects  # noqa: E402  (production/common: the tower's glint)

boards.OUT = HERE.parents[1] / "r8" / "out"
proj.use_camera(proj.OBLIQUE)
DIR = config.BUILD / "b1" / "d096"
LABEL = {"E": ("R8-17-城門-東陸-mobile", "東陸"), "W": ("R8-18-城門-西陸-mobile", "西陸")}
STATES = [("intact", "開著（art-v4 原樣）"), ("closed", "關著"), ("damaged", "受損"), ("broken", "破了")]
GATES = [("pal_gate_x", "小鎮木柵 北南門", (3, 1)), ("pal_gate_y", "小鎮木柵 東西門", (1, 3)),
         ("sw_gate_x", "大城石牆 北南門", (4, 1)), ("sw_gate_y", "大城石牆 東西門", (1, 4))]
ARROW_DARK, ARROW_LIGHT = (42, 28, 16), (244, 226, 176)        # render/world.ts drawShots


def tile(c, kind, state, suffix, pp, foot):
    sp = scene.piece(DIR, f"castle_{kind}_{c}_{state}", suffix, team="blue", ppm=20 * pp)
    return b1art.tile(scene.with_fx(sp), pp, footprint=foot, min_size=(150 * pp, 150 * pp))


def glint(c, kind, suffix, frame, pp=2):
    """The closed gate with the glint's frame `frame` at shoot_at_1 and the arrow on its way to a target out front
    (`pp` pixels per point: the row of five fits the board at 2x)."""
    ppm = 20 * pp
    sp = scene.piece(DIR, f"castle_{kind}_{c}_closed", suffix, team="blue", ppm=ppm)
    img = Image.new("RGBA", (sp.img.width + 60 * pp, sp.img.height + 40 * pp), (104, 120, 84, 255))
    ox, oy = 10 * pp, 10 * pp
    img.alpha_composite(sp.img, (ox, oy))
    at = sp.meta["marks"]["shoot_at_1"]
    gx, gy = proj.to_px(at, (ox + sp.ax, oy + sp.ay), ppm)
    tx, ty = proj.to_px((at[0] + 4.0, at[1] - 6.0, 0.0), (ox + sp.ax, oy + sp.ay), ppm)
    if frame > 0:                                     # the arrow, a fifth of the way per frame
        k = min(1.0, frame / 5.0)
        x, y = gx + (tx - gx) * k, gy + (ty - gy) * k
        d = ImageDraw.Draw(img)
        ux, uy = (tx - gx), (ty - gy)
        n = (ux * ux + uy * uy) ** 0.5 or 1
        ux, uy = ux / n, uy / n
        d.line([(x - ux * 12 * pp, y - uy * 12 * pp), (x, y)], fill=ARROW_DARK, width=round(2.5 * pp))
        d.line([(x - ux * 12 * pp, y - uy * 12 * pp), (x, y)], fill=ARROW_LIGHT, width=round(1.2 * pp))
    if frame < effects.SHOT_FRAMES:
        g, (ax, ay) = effects.shot_frames(float(pp))[frame]
        img.alpha_composite(g, (int(gx - ax), int(gy - ay)))
    return img.convert("RGB")


def board(c, suffix):
    label, side = LABEL[c]
    W = 2800
    text = (f"城門（D-096），{side}，暫用版（現在建築的畫風）。城門關起來，只讓擁有者的兵過；所有兵都能打，要花一段時間。\n"
            "四種樣子（client 照城門的血量和有沒有自己人在門洞挑）：\n"
            "・開著：art-v4 原樣。建議自己的兵走到門口一兩格內時顯示開著，其他時候顯示關著（和 client 商量中）。廢墟的門照舊開著。\n"
            "・關著：門扇關上。" + ("東陸是朱漆門扇加金色門釘和鋪首（門環）；木柵門是木板加紅色橫檔、斜撐。" if c == "E" else
                            "西陸是橡木門扇加鐵條、鐵釘，石城門前面放下鐵閘門；木柵門是削尖的圓木加橫檔、斜撐。") + "\n"
            "・受損（建議血量一半以下）：一扇被打破、木板斷掉、門往下垂，另一扇插著箭；門腳起火冒黑煙（和其他建築的受損一樣用火和煙）。\n"
            "・破了（模擬裡門已經不在）：一扇倒在地上，另一扇只剩一個鉸鏈掛著，碎木一地、淡淡的煙；門框和城樓照舊站著。\n"
            "東西門（左右兩面牆）從這個鏡頭看是側面，門扇是一條線、石城門的門洞被前面的墩子擋住，所以關著和開著看起來一樣。"
            "受損和破了的時候，火、碎木、倒下的門扇和落石掉在牆外，看得到。\n"
            "最下面：城樓射箭（只有治理的城鎮會射）。箭從城樓上的射點出去，射點亮一下（5 格，每秒 20 格），箭照 client 現在的畫法飛。")
    rows = [(name, [boards.captioned(tile(c, kind, s, suffix, 3, foot), sname, 22) for s, sname in STATES])
            for kind, name, foot in GATES]
    W = max(W, max(sum(t.width + 16 for t in tiles) for _, tiles in rows) + 4 * boards.M + 20)   # the widest row fits (a row in a row: two margins each side)
    parts = [boards.header(W, label, text)]
    for name, tiles in rows:
        parts.append(boards.row([boards.captioned(boards.row(tiles, W - 2 * boards.M, gap=16), f"{name}（3 倍）", 26)], W))
    small = [boards.captioned(tile(c, kind, s, suffix, 1, foot), f"{name[:4]} {sname[:2]}", 18)
             for kind, name, foot in GATES for s, sname in STATES]
    parts.append(boards.row([boards.captioned(boards.row(small[:8], W - 2 * boards.M, gap=10), "實際大小（1 倍，手機的點）", 24)], W))
    parts.append(boards.row([boards.row(small[8:], W - 2 * boards.M, gap=10)], W))
    for kind, name in (("sw_gate_x", "大城石牆 北南門"), ("pal_gate_x", "小鎮木柵 北南門")):
        frames = [boards.captioned(glint(c, kind, suffix, f), f"第 {f} 格", 20) for f in (0, 1, 2, 3, 4)]
        parts.append(boards.row([boards.captioned(boards.row(frames, W - 2 * boards.M, gap=12),
                                                  f"城樓射箭：{name}（2 倍）", 26)], W))
    return boards.save(boards.stack(parts, W), label)


if __name__ == "__main__":
    sfx = sys.argv[1] if len(sys.argv) > 1 else "prev"
    for c in ("E", "W"):
        print(board(c, sfx))
