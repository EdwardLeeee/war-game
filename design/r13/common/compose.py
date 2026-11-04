"""R13's boards from build/raw (shoot.mjs): one PNG an option (its label top left, a frame a state, each state named, what was measured
under it: green passes, red fails, grey notes), the same option at the phone's real size (-1x: 1 px a pt), and the overview.

python3 design/r13/common/compose.py [RAW_DIR]      -> design/r13/out/
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "out"
BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
TC = 3                                  # the Traditional Chinese face in the collection
BG, INK, GREY, GREEN, RED = (244, 241, 234), (40, 40, 40), (105, 105, 105), (30, 118, 58), (196, 40, 32)
M = 36

R1 = "R13-01-進駐"
R2 = "R13-02-局後統計"
BOARDS = {
    f"{R1}-0-現況": ("現況（main 586ec04，對照用）：選了兵，指令區有駐守、躲進去、駐軍三顆，各點一種建築；混編時要按好幾顆。", [
        ("R13-01-0-1", "選了混編 12 名", "指令區 3 排：駐守（哨所）、躲進去（主城、箭樓）、駐軍（自己的城）各一顆"),
        ("R13-01-0-2", "按「躲進去」", "只能點主城或箭樓；只有遠程兵、法師會去"),
        ("R13-01-0-3", "按「駐軍」", "只能點自己持有的城；整個編隊走進去留守"),
        ("R13-01-0-4", "按「駐守」", "只能點哨所；只有槍兵會去"),
    ]),
    f"{R1}-A-下方清單": ("A 下方清單：按「進駐」後，可以點的建築亮金框、寫名字；誰進去、誰留下列在下面的選取資訊裡，一棟一行。進駐以後的面板用文字寫人數。", [
        ("R13-01-A-1", "1 選兵前", "沒選東西：指令區只有「建造」"),
        ("R13-01-A-2", "2 選兵後（混編 12 名）", "指令區 2 排，「進駐」在第 2 排最後；選取資訊的說明多一行「進駐」"),
        ("R13-01-A-3", "3 按下進駐（只選 6 名槍兵）", "大城、哨所亮金框；主城、箭樓是灰虛線（槍兵進不去），下面那一行寫原因"),
        ("R13-01-A-4", "4 混編提示（12 名）", "四種都亮；下面一棟一行：進去的打勾，留下的寫在右邊"),
        ("R13-01-A-5", "5 目標滿了", "點了滿的箭樓：訊息條「箭樓滿了（最多 3 名），沒有人進去」；表裡箭樓那行變灰；主城只剩 2 個位子，寫最近的 2 名進去"),
        ("R13-01-A-6", "6 點錯目標", "點了兵營：訊息條叫你點亮起來的建築；還在選建築，可以直接再點"),
        ("R13-01-A-7a", "7a 已進駐：箭樓", "進駐 2 名（最多 3 名）；＋遠程、＋法師（叫最近的）、全部離開；編隊 1：2 名［召回］"),
        ("R13-01-A-7b", "7b 已進駐：哨所", "進駐 5 名槍兵（最多 9 名）；＋槍兵、全部離開、攻擊／堅守；編隊 1：3 名［召回］"),
        ("R13-01-A-7c", "7c 已進駐：大城", "城裡 5 名、牆上 3／12；留守 − 5 ＋；編隊 1：5 名［歸隊］［全部帶走］"),
        ("R13-01-A-8", "8 軍團畫面：進駐中的編隊", "最上面一格寫進駐在哪裡，三顆：召回、出城歸隊、全部帶走（按鈕下寫做什麼）；兵種 −／＋ 往下捲"),
    ]),
    f"{R1}-B-建築上標籤": ("B 建築上標籤：按「進駐」後，選取資訊自動收起；每棟可以點的建築上浮一個標籤寫「進 誰／留 誰」，進不去的是灰標籤寫原因。進駐以後的面板用方塊表示位子（一格一名，空的是斜線）。", [
        ("R13-01-B-1", "1 選兵前", "沒選東西：指令區只有「建造」"),
        ("R13-01-B-2", "2 選兵後（混編 12 名）", "指令區 2 排，「進駐」在第 2 排最後"),
        ("R13-01-B-3", "3 按下進駐（只選 6 名槍兵）", "大城、哨所亮金框，標籤寫「進 6 名」；主城、箭樓灰標籤「槍兵進不去」；選取資訊收起"),
        ("R13-01-B-4", "4 混編提示（12 名）", "四棟各一個標籤：上面一行進去的，下面一行留下的"),
        ("R13-01-B-5", "5 目標滿了", "點了滿的箭樓：訊息條「箭樓滿了…」；箭樓的標籤是灰的「滿了 3/3」"),
        ("R13-01-B-6", "6 點錯目標", "點了兵營：訊息條叫你點亮起來的建築；標籤還在"),
        ("R13-01-B-7a", "7a 已進駐：箭樓", "3 格位子 2 格有人（遠、法）；編隊 1：2［召回］；＋遠程、＋法師、全部離開"),
        ("R13-01-B-7b", "7b 已進駐：哨所", "9 格位子 5 格有人；編隊 1：3［召回］；＋槍兵、全部離開、攻擊／堅守"),
        ("R13-01-B-7c", "7c 已進駐：大城", "牆上 3 格、城內 2 格；留守 − 5 ＋、歸隊、全部帶走"),
        ("R13-01-B-8", "8 軍團畫面：進駐中的編隊", "大城、箭樓、哨所各一排方塊；召回、出城歸隊、全部帶走；兵種 −／＋ 往下捲"),
    ]),
    f"{R2}-0-現況": ("現況（main 586ec04，對照用）：一局結束跳出一張表，沒有圖、沒有時間軸。數字是和 A、B 同一局的假資料。", [
        ("R13-02-0-1", "現在的勝負畫面", "採集、訓練、損失、法師、攻城砲、城鎮；訓練和損失只算村民、槍兵、遠程兵、法師（沒有騎兵）"),
    ]),
    f"{R2}-A-分頁": ("A 分頁：結束時整個畫面換成統計；左邊 6 個分頁（總覽、資源、兵力、戰鬥、城鎮、法師），一頁一張圖；勝負、重來、回開局畫面一直在上面。圖上的 ①–④ 是關鍵時刻，圖下有對照。", [
        ("R13-02-A-1", "總覽（勝）", "左：關鍵時刻（第一次進攻、主城第一次被打、大仗…）；右：雙方數字（現在那張表）"),
        ("R13-02-A-2", "資源：糧", "累計採集，糧木金魔晶四顆切換；我方實線圓點、敵方虛線方點，線尾直接寫數字"),
        ("R13-02-A-3", "資源：切到魔晶", "同一張圖換成魔晶：敵方 10 分多治理大城後追上"),
        ("R13-02-A-4", "兵力", "士兵數（不含村民），標出雙方最多的時候；③ 大仗後敵方掉到 19 名"),
        ("R13-02-A-5", "戰鬥", "各兵種：左邊我方損失、右邊我方擊殺（＝敵方損失），數字寫在長條旁"),
        ("R13-02-A-6", "城鎮", "四座城鎮誰的（藍我方、紅敵方、灰中立、斜線廢墟），圓圈是治理、搶、叛離，框色＝誰做的"),
        ("R13-02-A-7", "法師", "訓練、陣亡、晶砲發數、晶砲擊殺、一發最多"),
        ("R13-02-A-8", "總覽（敗）", "失敗的同一頁：我方主城被摧毀、23:15"),
        ("R13-02-A-9", "戰鬥（敗）", "失敗那局的擊殺與損失：村民死 31"),
    ]),
    f"{R2}-B-一頁捲動": ("B 一頁捲動：所有東西排在同一頁往下捲；最上面是關鍵時刻的時間軸和 4 個數字，往下兩張圖並排（資源和兵力、擊殺和法師），再來是城鎮易手、雙方數字、重來。上面的勝負列不跟著捲；右邊細條是捲到哪。", [
        ("R13-02-B-1", "最上面（勝）", "關鍵時刻時間軸（★ 是結束）＋我方擊殺、損失、城鎮、晶砲擊殺"),
        ("R13-02-B-2", "捲到資源、兵力", "兩張圖並排，資源可以切糧木金魔晶"),
        ("R13-02-B-3", "捲到擊殺與損失、法師", "左右兩張"),
        ("R13-02-B-4", "捲到城鎮易手", "整排寬的時間軸"),
        ("R13-02-B-5", "捲到底", "雙方數字（現在那張表）和重來、回開局畫面"),
        ("R13-02-B-6", "最上面（敗）", "失敗那局"),
        ("R13-02-B-7", "整頁（捲動的全部內容）", "手機上一次只看得到 380 pt 高的一段；這張是整頁接起來（2 倍拍）"),
    ]),
}
# the overview: two frames an option
OVERVIEW = [
    (f"{R1}-0-現況", ["R13-01-0-1", "R13-01-0-2"]), (f"{R1}-A-下方清單", ["R13-01-A-4", "R13-01-A-7b"]), (f"{R1}-B-建築上標籤", ["R13-01-B-4", "R13-01-B-7b"]),
    (f"{R2}-0-現況", ["R13-02-0-1"]), (f"{R2}-A-分頁", ["R13-02-A-1", "R13-02-A-2"]), (f"{R2}-B-一頁捲動", ["R13-02-B-1", "R13-02-B-2"]),
]


def font(size, bold=True):
    return ImageFont.truetype(BOLD if bold else REG, size, index=TC)


def wrap(d, text, f, w):
    lines, cur = [], ""
    for ch in text:
        if d.textlength(cur + ch, font=f) > w and cur:
            lines.append(cur)
            cur = ch
        else:
            cur += ch
    return lines + [cur]


def checks(job, m):
    """[(text, colour)] under a frame."""
    out = []
    r13_01 = job.startswith("R13-01")
    if r13_01 and job.endswith(("-A-1", "-B-1")):
        out.append(("沒選兵：指令區只有「建造」", GREY))
    elif r13_01 and m["cmdsRows"]:
        now = job.startswith("R13-01-0")
        out.append((f"指令區 {m['cmdsRows']} 排" + ("（R13 合成後 2 排）" if now else "（現況 3 排）"), GREY if now else (GREEN if m["cmdsRows"] <= 2 else RED)))
    small = m["small"]
    out.append((f"觸控目標都 ≥ 44 pt（{m['buttons']} 顆）" if not small else "小於 44 pt：" + "、".join(f"{s['t']} {s['w']}×{s['h']}" for s in small), GREEN if not small else RED))
    out.append(("沒有截字" if not m["clipped"] else "截字：" + "、".join(m["clipped"]), GREEN if not m["clipped"] else RED))
    if m["out"]:
        out.append(("超出畫面：" + "、".join(m["out"]), RED))
    bad = [o for o in m["overlaps"] if o not in ("toast×sel",)]
    if bad:
        out.append(("面板疊在一起：" + "、".join(bad), RED))
    if m["tagHits"]:
        out.append(("標籤疊在一起", RED))
    f = m["minFont"]
    if job.startswith("R13-02") and not job.startswith("R13-02-0"):
        out.append((f"字最小 {f:g} pt", GREEN if f >= 12 else RED))
    else:
        out.append((f"字最小 {f:g} pt（按鈕小字、編隊的駐／躲，沿用 R6 與現在的 client）；R13 新加的字 ≥ 12 pt", GREY))
    if m.get("errors"):
        out.append(("頁面錯誤：" + " | ".join(m["errors"])[:120], RED))
    return out


def cell(raw, job, title, cap, scale, width, small_caps=False):
    im = Image.open(raw / f"{job}.png").convert("RGB")
    # the whole page was shot at 2 px a pt; it goes on both boards at 1 px a pt (it is the long strip)
    k = scale / 3 if job != "R13-02-B-7" else 0.5
    im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    m = json.loads((raw / f"{job}.json").read_text())
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    ft, fc, fm = (font(17), font(14, False), font(13, False)) if small_caps else (font(26), font(21, False), font(21, False))
    lines = [(ln, INK, ft) for ln in wrap(probe, title, ft, width)]
    lines += [(ln, INK, fc) for ln in wrap(probe, cap, fc, width)]
    below = [] if small_caps else [(ln, c, fm) for t, c in checks(job, m) for ln in wrap(probe, t, fm, width)]
    lh = lambda f: int(f.size * 1.42)
    H = sum(lh(f) for _, _, f in lines) + 8 + im.height + 8 + sum(lh(f) for _, _, f in below)
    o = Image.new("RGB", (width, H), BG)
    d = ImageDraw.Draw(o)
    y = 0
    for t, c, f in lines:
        d.text((0, y), t, font=f, fill=c)
        y += lh(f)
    y += 8
    o.paste(im, (0, y))
    d.rectangle((0, y, im.width - 1, y + im.height - 1), outline=(180, 170, 150))
    y += im.height + 8
    for t, c, f in below:
        d.text((0, y), t, font=f, fill=c)
        y += lh(f)
    return o


def board(name, sub, cells, raw, scale, cols, small_caps=False, suffix=""):
    fw = round(814 * scale)
    cols = min(cols, len(cells))
    tiles = [cell(raw, j, t, c, scale, fw, small_caps) for j, t, c in cells]
    gap = 34 if not small_caps else 24
    W = 2 * M + cols * fw + (cols - 1) * gap
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    fs = font(22 if not small_caps else 16, False)
    subl = wrap(probe, sub, fs, W - 2 * M)
    title_h = (58 if not small_caps else 40) + len(subl) * int(fs.size * 1.45) + 18
    rows = [tiles[i:i + cols] for i in range(0, len(tiles), cols)]
    H = title_h + sum(max(t.height for t in r) + gap for r in rows) + M
    o = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(o)
    label = f"{name}-phone{suffix}"
    d.text((M, M - 6), label, font=font(40 if not small_caps else 26), fill=INK)
    y = M + (52 if not small_caps else 30)
    for ln in subl:
        d.text((M, y), ln, font=fs, fill=GREY)
        y += int(fs.size * 1.45)
    y = title_h + 10
    for r in rows:
        x = M
        for t in r:
            o.paste(t, (x, y))
            x += fw + gap
        y += max(t.height for t in r) + gap
    o.save(OUT / f"{label}.png")
    return o


def overview(raw):
    fw, gap = 814, 30
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    cols = []
    for name, jobs in OVERVIEW:
        frames = []
        for j in jobs:
            im = Image.open(raw / f"{j}.png").convert("RGB").resize((814, 380), Image.LANCZOS)
            frames.append(im)
        m = json.loads((raw / f"{jobs[0]}.json").read_text())
        meas = []
        if name.startswith(R1):
            meas.append((f"指令區 {m['cmdsRows']} 排", GREY if "-0-" in name else GREEN))
        if name.startswith(R2) and "-0-" not in name:
            fmin = min(json.loads((raw / f"{j}.json").read_text())["minFont"] for j in jobs)
            meas.append((f"字最小 {fmin:g} pt、觸控目標 ≥ 44 pt", GREEN if fmin >= 12 else RED))
        cols.append((name, frames, meas))
    ft, fm = font(22), font(18, False)
    def tile(name, frames, meas):
        h = sum(f.height + 10 for f in frames) + 8 + int(ft.size * 1.5) + len(meas) * int(fm.size * 1.5)
        o = Image.new("RGB", (fw, h), BG)
        d = ImageDraw.Draw(o)
        y = 0
        for f in frames:
            o.paste(f, (0, y))
            d.rectangle((0, y, f.width - 1, y + f.height - 1), outline=(180, 170, 150))
            y += f.height + 10
        y += 4
        d.text((0, y), f"{name}-phone.png", font=ft, fill=INK)
        y += int(ft.size * 1.5)
        for t, c in meas:
            d.text((0, y), t, font=fm, fill=c)
            y += int(fm.size * 1.5)
        return o
    tiles = [tile(*c) for c in cols]
    rows = [tiles[0:3], tiles[3:6]]
    W = 2 * M + 3 * fw + 2 * gap
    head = 130
    H = head + sum(max(t.height for t in r) + 50 for r in rows) + M
    o = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(o)
    d.text((M, M - 6), "R13-99-總覽對照-phone", font=font(40), fill=INK)
    d.text((M, M + 50), "01 進駐：三顆合成一顆，A 誰進去寫在下面的清單、B 寫在建築上的標籤。02 局後統計：A 分頁、B 一頁捲動。0 是現況（對照）。每格是手機實際大小（1 pt = 1 px）。",
           font=font(20, False), fill=GREY)
    y = head
    for r in rows:
        x = M
        for t in r:
            o.paste(t, (x, y))
            x += fw + gap
        y += max(t.height for t in r) + 50
    o.save(OUT / "R13-99-總覽對照-phone.png")


def main(raw):
    OUT.mkdir(exist_ok=True)
    n = 0
    for name, (sub, cells) in BOARDS.items():
        board(name, sub, cells, raw, 2, 2)                                          # 2 px a pt
        board(name, sub, cells, raw, 1, 3, small_caps=True, suffix="-1x")            # the phone's real size
        n += 2
    overview(raw)
    print(n + 1, "boards in", OUT)


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parent / "build/raw")
