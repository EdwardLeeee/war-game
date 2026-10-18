"""R6-25: storyboards and GIFs of every interface animation (pref: animations come with a storyboard or a GIF).

python3 common/anim.py   -> out/R6-25-<nn>-<名>-<A-銅木|B-墨漆金線>-mobile.png (storyboard), …-動作.gif
The frames are shot from the mock (anim.mjs); timings are the spec (spec.md section 動畫).
"""
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "round1" / "common"))
import artboard  # noqa: E402

BUILD = HERE.parent / "build" / "anim"
OUT = HERE.parent / "out"
CMD, GRP, FULL = [556, 186, 258, 194], [596, 44, 218, 160], [0, 0, 814, 380]
# id, name, themes, crop, frames [(state, t, label, gif ms)], note, reduced motion
ANIMS = [
    ("01", "按下", "ab", CMD, [("A-press0", 1, "一般", 600), ("A-press1", 1, "按下：手指碰到就換（60 ms 內）", 300), ("A-press0", 1, "放開：120 ms 回到一般", 600)],
     "所有按鈕都一樣。手指在按鈕上按住就保持按下；滑出按鈕外再放開，不算按。", "照舊（只換樣子，不動）。"),
    ("02", "對話框出現", "a", FULL, [("A-dialog", 0, "0 ms", 50), ("A-dialog", 0.33, "50 ms", 50), ("A-dialog", 0.66, "100 ms", 50), ("A-dialog", 1, "160 ms：到位", 1400)],
     "暗底和卡片一起淡入，卡片從 96% 放大到 100%（ease-out）。關掉時反過來，120 ms。", "直接出現，不放大。"),
    ("03", "編隊快撐不住", "a", GRP, [("INV-32", 1, "亮", 700), ("INV-32b", 1, "暗（0.7 秒後）", 700)],
     "剩不到開始進攻時的一半就開始，0.7 秒來回；回到一半以上、或退回主城就停。", "只變紅，不閃。"),
    ("04", "被攻擊箭頭", "a", [540, 0, 160, 120], [("A-arrow0", 1, "亮", 400), ("A-arrow1", 1, "暗（0.4 秒後）", 400)],
     "光暈 0.8 秒一次；最後一次被打後 6 秒消失。", "不閃，一直亮。"),
    ("05", "地圖鈕警報", "a", [0, 290, 130, 90], [("NEW-04", 1, "亮", 400), ("NEW-04b", 1, "暗（0.4 秒後）", 400)],
     "小地圖收著、有地方被打時；0.4 秒換一次。", "不閃，一直是紅的。"),
    ("06", "全體回城跳出", "a", [0, 120, 260, 260], [("A-recall-in", 0, "0 ms", 100), ("A-recall-in", 0.5, "100 ms", 100), ("A-recall-in", 1, "200 ms：到位", 1500),
     ("A-recall-in", 0.5, "收回：100 ms", 100), ("A-recall-in", 0, "收回：200 ms", 600)],
     "從左邊滑進來、淡入（200 ms）；收回時反過來。", "直接出現、直接消失。"),
    ("07", "地圖打開", "a", [0, 180, 260, 200], [("A-map", 0, "0 ms", 75), ("A-map", 0.5, "75 ms", 75), ("A-map", 1, "150 ms：打開", 1200),
     ("A-map", 0.5, "收起：75 ms", 75), ("A-map", 0, "收起：150 ms", 600)],
     "從地圖鈕的位置放大、淡入（150 ms）；收起反過來。自動打開（選位置時）也一樣。", "直接出現、直接消失。"),
    ("08", "訊息條", "a", [100, 186, 614, 60], [("A-toast", 0, "0 ms", 60), ("A-toast", 0.5, "60 ms", 60), ("A-toast", 1, "120 ms：出現，停 2.2 秒", 2200),
     ("A-toast", 0.5, "消失：150 ms", 150), ("A-toast", 0, "消失：300 ms", 500)],
     "新的一則直接蓋掉舊的（不等舊的消失）。", "只淡入淡出，照舊。"),
    ("09", "長按圓圈", "a", [250, 170, 160, 160], [("A-cue", 0, "80 ms：出現", 90), ("A-cue", 0.33, "170 ms", 90), ("A-cue", 0.66, "260 ms", 90), ("A-cue", 1, "350 ms：變成長按", 700)],
     "手指按住 80 ms 後出現，縮到 0.35 倍時（350 ms）就是長按。", "照舊。"),
    ("10", "指令回饋圈", "a", [200, 100, 380, 200], [("A-rings", 0, "0 ms", 150), ("A-rings", 0.33, "200 ms", 150), ("A-rings", 0.66, "400 ms", 150), ("A-rings", 1, "600 ms：消失", 500)],
     "下指令的那一點，往外長、淡出；顏色照指令。", "照舊。"),
]
THEMES = {"a": "A-銅木", "b": "B-墨漆金線"}


def shoot():
    BUILD.mkdir(parents=True, exist_ok=True)
    frames = []
    for aid, name, themes, crop, fr, _, _ in ANIMS:
        for th in themes:
            for i, (st, t, _, _) in enumerate(fr):
                frames.append(dict(state=st, t=t, theme=th, crop=crop, out=str(BUILD / f"{aid}-{th}-{i}.png")))
    subprocess.run(["node", str(HERE / "anim.mjs")], input=json.dumps(frames), text=True, check=True)


def boards():
    for aid, name, themes, crop, fr, note, reduced in ANIMS:
        for th in themes:
            ims = [Image.open(BUILD / f"{aid}-{th}-{i}.png").convert("RGB") for i in range(len(fr))]
            label = f"R6-25-{aid}-{name}-{THEMES[th]}-mobile"
            w, h = ims[0].size
            scale = min(1.0, 1500 / (w * min(len(ims), 4)))
            ims_s = [im.resize((int(w * scale), int(h * scale)), Image.LANCZOS) for im in ims]
            cols = min(len(ims), 4)
            rows = (len(ims) + cols - 1) // cols
            cw, ch = ims_s[0].size
            W = max(1500, cols * (cw + 24) + 80)
            H = 210 + rows * (ch + 60) + 40
            art = Image.new("RGB", (W, H), (244, 241, 234))
            d = ImageDraw.Draw(art)
            d.text((40, 30), label, font=artboard.font(44), fill=(40, 40, 40))
            d.text((40, 96), note, font=artboard.font(22, weight="regular"), fill=(90, 90, 90))
            d.text((40, 132), f"減少動態效果（iPhone 的設定）打開時：{reduced}", font=artboard.font(22, weight="regular"), fill=(90, 90, 90))
            d.text((40, 166), "下面依時間順序；另附動作 GIF（同名 -動作.gif）。", font=artboard.font(20, weight="regular"), fill=(120, 120, 120))
            for i, (im, (_, _, lab, _)) in enumerate(zip(ims_s, fr)):
                x, y = 40 + (i % cols) * (cw + 24), 210 + (i // cols) * (ch + 60)
                d.text((x, y), f"{i + 1}. {lab}", font=artboard.font(20), fill=(40, 40, 40))
                art.paste(im, (x, y + 32))
            art.save(OUT / f"{label}.png", optimize=True)
            g = [im.convert("P", palette=Image.ADAPTIVE, colors=255) for im in ims]
            g[0].save(OUT / f"R6-25-{aid}-{name}-{THEMES[th]}-動作.gif", save_all=True, append_images=g[1:], duration=[x[3] for x in fr], loop=0)
            print("wrote", label)


if __name__ == "__main__":
    shoot()
    boards()
