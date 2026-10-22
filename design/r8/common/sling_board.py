"""D-096 民兵投石 draft: the militia's sling throw (production/blender/anims.py extend_sling) on the R8 spearman and
pikeman, every frame of three facings at the phone's 3x pixels and at actual size, and a GIF per culture.

python3 design/r8/common/sling_board.py RAW_E RAW_W
  RAW_*  folders of <unit>_sling_f<facing>_<ii>_x3_beauty.png (render_prod-style frames, e.g. the local preview)
writes design/r8/out/R8-19-民兵投石-mobile.png and R8-19-民兵投石-<東陸|西陸>.gif
"""
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import boards_r8 as B   # noqa: E402

boards = B.boards
LABEL = "R8-19-民兵投石-mobile"
FACINGS = [(6, "朝鏡頭"), (2, "背對鏡頭"), (0, "朝右")]
RELEASE = 6
FROM_M = (0.41, 0.96, 1.78)          # anims.sling_from: the pouch on the frame before the release, unit space
BG = (104, 120, 84)


def frames(raw, unit, facing):
    out = []
    for i in range(10):
        im = Image.open(Path(raw) / f"{unit}_sling_f{facing}_{i:02d}_x3_beauty.png").convert("RGBA")
        bg = Image.new("RGBA", im.size, (*BG, 255))
        bg.alpha_composite(im)
        out.append(bg.convert("RGB"))
    return out


def strip(ims, scale=1.0, numbers=True):
    """The frames side by side, each with its number over it (the release frame marked)."""
    if scale != 1.0:
        ims = [i.resize((int(i.width * scale), int(i.height * scale)), Image.LANCZOS) for i in ims]
    if numbers:
        ims = [boards.captioned(i, f"{k}" + ("　放開" if k == RELEASE else ""), 18) for k, i in enumerate(ims)]
    w = sum(i.width for i in ims) + 6 * (len(ims) - 1)
    h = max(i.height for i in ims)
    out = Image.new("RGB", (w, h), boards.BG)
    x = 0
    for i in ims:
        out.paste(i, (x, 0))
        x += i.width + 6
    return out


def tight(ims, pad=10):
    """Crop every frame to the union of the figure's pixels (it is drawn on BG)."""
    import numpy as np
    m = None
    for i in ims:
        a = np.asarray(i, np.int16)
        d = (np.abs(a - np.array(BG, np.int16)).sum(axis=2) > 12)
        m = d if m is None else (m | d)
    ys, xs = np.nonzero(m)
    box = (max(0, xs.min() - pad), max(0, ys.min() - pad), xs.max() + pad, ys.max() + pad)
    return [i.crop(box) for i in ims]


def main(raw_e, raw_w):
    W = 2600
    text = ("民兵投石（D-096）：中立城鎮的民兵一半上牆，改用投石（射程 4 格，每 30 tick 一次）。民兵穿同文化的槍兵（東陸槍兵、西陸長矛兵），"
            "所以這兩種兵多一個動作 `sling`（10 格，每秒 20 格）。\n"
            "動作：槍立在左手、槍尾著地；右手把投石索在頭上甩一圈，第 6 格往前甩出去放開石頭，之後投石索垂在手上。"
            "石頭由 client 畫（模擬沒有投射物事件，照朝向飛）。\n"
            f"給 client：放開在第 {RELEASE} 格；石頭從兵腳下往右 {FROM_M[0]} 公尺、往前 {FROM_M[1]} 公尺、往上 {FROM_M[2]} 公尺出發"
            "（鏡像的朝向 3、4、5 往左）；站在牆上時再加牆的走道高度 `walk_m`。\n"
            "圖是 R8 寫實版（已核准、量產中）；現在線上的兵用同一套骨架，同一個動作也能套上。上：手機 3 倍；下：實際大小。另附 GIF。")
    parts = [boards.header(W, LABEL, text)]
    for raw, unit, name in ((raw_e, "spear_e", "東陸槍兵"), (raw_w, "pike_w", "西陸長矛兵")):
        rows = []
        for f, fname in FACINGS:
            ims = tight(frames(raw, unit, f))
            rows.append(boards.captioned(strip(ims, 0.7), f"{name}　{fname}（3 倍縮成 70%）", 22))
        parts += [boards.row([r], W) for r in rows]
        small = tight(frames(raw, unit, 6))
        small = [i.resize((i.width // 3, i.height // 3), Image.LANCZOS) for i in small]
        parts.append(boards.row([boards.captioned(strip(small), f"{name}　實際大小（1 倍）", 22)], W))
        side = "東陸" if unit == "spear_e" else "西陸"
        g = [i.resize((i.width // 2, i.height // 2), Image.LANCZOS) for i in tight(frames(raw, unit, 6))]
        g[0].save(B.OUT / f"R8-19-民兵投石-{side}.gif", save_all=True, append_images=g[1:] + [g[-1]] * 6, duration=50, loop=0)
    return boards.save(boards.stack(parts, W), LABEL)


if __name__ == "__main__":
    print(main(sys.argv[1], sys.argv[2]))
