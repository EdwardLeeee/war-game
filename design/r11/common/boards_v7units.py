"""art-v7 PR1's review boards (D-118): the twelve units with R9's materials (version 8 look, R9_UNIT: the cloth's mesh
pleats, the iron rougher), every action in all eight facings, blue and red, and the spearman before and after.
The units are camera-free pictures (the sun stays at the screen's upper left), so these are the diamond game's too;
facing k is the screen direction the client picks (client/docs/sprite-atlas.md section 3).

python3 design/r11/common/boards_v7units.py NEW_DL OLD_UNITS GRASS OUT
  NEW_DL: the run's r7-v8u-<unit> artifacts (each .../prod/<unit>/atlas_x3/); OLD_UNITS: art-v6.3's x3 units/;
  GRASS: art-v6.3's x3 ground/grass.png (the cells' ground)
"""
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "r9" / "common"))
import boards_r9 as B9    # noqa: E402
import scene_r9 as S9     # noqa: E402

UNITS = ["spear_e", "farmer_e", "bow_e", "hcav_e", "siege_e", "mage_e",
         "pike_w", "farmer_w", "bow_w", "knight_w", "siege_w", "mage_w"]
NAMES = {"spear_e": "東陸槍兵", "farmer_e": "東陸農民", "bow_e": "東陸弓手", "hcav_e": "東陸重騎", "siege_e": "東陸攻城砲",
         "mage_e": "東陸法師", "pike_w": "西陸長槍兵", "farmer_w": "西陸農民", "bow_w": "西陸弓手", "knight_w": "西陸騎士",
         "siege_w": "西陸攻城砲", "mage_w": "西陸法師"}
ANIM_TW = {"idle": "待機", "walk": "走", "attack": "攻擊", "death": "倒下", "sling": "投石", "cast": "施法", "hit": "受擊",
           "work_chop": "砍樹", "work_mine": "挖礦", "work_farm": "種田", "work_build": "蓋房", "shatter": "碎裂", "fall": "倒塌"}


def atlas(root, unit):
    got = sorted(Path(root).rglob(f"atlas_x3/{unit}.json"))
    if len(got) != 1:
        raise SystemExit(f"{root}: {len(got)} {unit} atlases")
    return S9.Atlas(got[0])


def frame_k(a, anim):
    spec = a.j["anims"][anim]
    n = spec["frames"]
    return {"idle": 0, "walk": n // 3, "attack": spec.get("hit", n // 2), "death": n - 1}.get(anim, n // 2)


def cell(a, unit, anim, facing, team, grass, size):
    """One frame on a patch of the ground, its shadow under it, the feet at the middle."""
    w, h = size
    bg = Image.new("RGBA", size)
    for x in range(0, w, grass.width):
        for y in range(0, h, grass.height):
            bg.paste(grass, (x, y))
    k = frame_k(a, anim)
    name, flip = S9.unit_frame(a, unit, anim, facing, k)
    (im, ax, ay), _ = a.sprite(name, team)
    if flip:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
        ax = im.width - ax
    X, Y = w // 2, int(h * 0.72)
    # the shadow of the facing itself: the atlas has every facing's (the sun does not turn with a mirrored body;
    # flipping the rendered facing's shadow pointed it the wrong way)
    sh = a._crop("shadow", f"{unit}_{anim}_f{facing}_{k:02d}")
    if sh:
        si, sx, sy = sh
        s = si.copy()
        s.putalpha(s.getchannel("A").point(lambda v: int(v * 0.55)))
        dark = Image.new("RGBA", s.size, (22, 28, 46, 0))
        dark.putalpha(s.getchannel("A"))
        bg.alpha_composite(dark, (int(X - sx), int(Y - sy)))
    bg.alpha_composite(im, (int(round(X - ax)), int(round(Y - ay))))
    return bg.convert("RGB")


def sheet(a, unit, grass, cw=270, ch=290):
    """Rows: each action, blue then red; columns: facings 0-7."""
    anims = list(a.j["anims"])
    rows = [(an, t) for an in anims for t in ("blue", "red")]
    lw = 150
    o = Image.new("RGB", (lw + 8 * cw, 40 + len(rows) * ch), B9.BG)
    d = ImageDraw.Draw(o)
    for k in range(8):
        d.text((lw + k * cw + 8, 8), f"方向 {k}", font=B9.font(22, False), fill=B9.INK)
    for r, (an, t) in enumerate(rows):
        y = 40 + r * ch
        d.text((8, y + ch // 2 - 24), ANIM_TW.get(an, an), font=B9.font(24), fill=B9.INK)
        d.text((8, y + ch // 2 + 6), "藍" if t == "blue" else "紅", font=B9.font(22, False), fill=B9.GREY)
        for k in range(8):
            o.paste(cell(a, unit, an, k, t, grass, (cw - 6, ch - 6)), (lw + k * cw, y))
    return o


def main(new_dl, old_units, grass_p, out):
    out.mkdir(parents=True, exist_ok=True)
    grass = Image.open(grass_p).convert("RGBA")
    note = ("art-v7 量產 PR 1（D-118）：12 種兵換成 R9 的材質（第 8 版寫實外觀，布料改成網格摺子、鐵甲粗糙一點）。兵的圖和鏡頭無關"
            "（太陽固定在畫面左上），所以菱形斜看用同一套圖，方向照 client 的對照表換算。每個動作 8 個方向、藍紅兩隊，3 倍畫質的 2/3。")
    for i, u in enumerate(UNITS):
        a = atlas(new_dl, u)
        s = sheet(a, u, grass)
        B9.board(f"V7U-{i + 1:02d}-{NAMES[u]}-全動作-phone", note, [("每個動作、8 個方向（上藍下紅）", s.resize((s.width * 2 // 3, s.height * 2 // 3), Image.LANCZOS))], out)
    # before and after, the same frames: idle, walk, attack, facings 7 and 1
    rows = []
    for u in UNITS:
        old = S9.Atlas(Path(old_units) / u / f"{u}.json")
        new = atlas(new_dl, u)
        cells = []
        for an in ("idle", "walk", "attack"):
            for f in (7, 1):
                cells.append(cell(old, u, an, f, "blue", grass, (250, 270)))
                cells.append(cell(new, u, an, f, "blue", grass, (250, 270)))
        strip = Image.new("RGB", (len(cells) * 254, 270), B9.BG)
        for k, c in enumerate(cells):
            strip.paste(c, (k * 254, 0))
        rows.append((f"{NAMES[u]}：待機、走、攻擊，方向 7 和 1；每對左邊是現在（art-v6.3），右邊是 art-v7", strip.resize((strip.width * 2 // 3, strip.height * 2 // 3), Image.LANCZOS)))
    B9.board("V7U-99-全兵種-前後對照-phone", note, rows, out)
    print("boards in", out)


if __name__ == "__main__":
    a = sys.argv
    main(Path(a[1]), Path(a[2]), Path(a[3]), Path(a[4]))
