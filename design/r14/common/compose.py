"""R14's boards from build/raw (shoot.mjs): one PNG a panel (its label top left, a frame a state, each state named, what was measured
under it: green passes, red fails, grey notes), the same board at the phone's real size (-1x: 1 px a pt), and the overview.

python3 design/r14/common/compose.py [RAW_DIR]      -> design/r14/build/out/
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "build" / "out"          # not in git
BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
TC = 3                                  # the Traditional Chinese face in the collection
BG, INK, GREY, GREEN, RED = (244, 241, 234), (40, 40, 40), (105, 105, 105), (30, 118, 58), (196, 40, 32)
M = 36
FIELD = "戰場是 art-v7 菱形圖集合成的示意（scene_r14.py），不是 client 畫的。"
PROP = "黃虛線框＝R14 的提議，client 現在沒有。"

B2_NOTE = "B2 的 12 條規則（擠的時候錯開、拉引線、縮成小籤；畫面外沿邊箭頭）照 R13（design/r13/common/compose.py 的 B2_RULES），演算法 design/r13/common/r13-tags.js。"
BOARDS = {
    "R14-01-城門": ("城門（D-096）是城鎮的一棟建築：點它看到建築資訊——名字、狀態字、生命；小鎮的門 850、大城的門 2100。破了就不見了（變成門洞），不能再點。" + FIELD + PROP, [
        ("R14-01-1", "1 點中立小鎮的城門（沒選兵）", "城門、中立小鎮、生命 850/850；金框是門腳下的格子，上面一條血條；指令區只有建造"),
        ("R14-01-2", "2 選兵後點城門：集中打這座門", "確認的訊息條「近戰打這座城門；弓手和法師到門前，先射牆上的守軍」；門下紅色回饋圈；攻擊鈕變「取消攻擊」"),
        ("R14-01-3", "3 打門中，點城門看生命", "城門的圖換成受損，生命 380/850；牆上的民兵投石"),
        ("R14-01-4", "4 城門破了：兵自己衝進去打", "破掉的門是門洞，不能點；兵照 D-109 自己進城打到攻下，選取資訊還是兵"),
        ("R14-01-5", "5 我方大城的城門：剛被打，不能修", "生命 1320/2100、「剛被攻擊，暫時不能修理」；村民在門內等。訊息條把 client 的「主城剛被攻擊…」改成「城門…」（提議）"),
    ]),
    "R14-02-主堡": ("主堡（D-100）在每座城正中間，3×3，替擁有的人射箭：小鎮 600、大城 1000。點它是建築資訊；倒了以後「主堡倒了」寫在城鎮的面板上。主堡不能躲人；進駐時點自己城裡的主堡＝點那座城（D-125）。" + FIELD, [
        ("R14-02-1", "1 點中立小鎮的主堡", "主堡、會射箭、生命 600/600"),
        ("R14-02-2", "2 選兵點城裡：攻擊這座城", "第一次這樣點時跳「點城鎮＝攻擊這座城」（這台手機只跳一次）；回饋圈在主堡"),
        ("R14-02-3", "3 打敵方大城的主堡", "敵方主堡、會射箭、380/1000，受損著火的圖；主堡朝我方射箭"),
        ("R14-02-4", "4 主堡倒了：攻下，選搶或治理", "城鎮面板最前面寫「主堡倒了」；搶、治理（木150 金150）、留守 − 3 ＋。攻下時先跳 R6-20 的對話框，這是按「稍後再決定」以後"),
        ("R14-02-5", "5 我方的主堡被打過", "「剛被攻擊，暫時不能修理　會射箭」、640/1000；訊息條的「主堡」是提議（client 寫「主城」）"),
    ]),
    "R14-03-市場": ("市場（D-101）：用金買賣糧和木，一按成交一份 100。買了變貴（+5）、賣了變便宜（−5），賣只拿七成，之後慢慢回到 100 金。R14 把四顆按鈕排成一排（糧的買、賣，木的買、賣），面板才不會太高。" + FIELD, [
        ("R14-03-1", "1 第一次打開", "生命 600/600；按鈕第二行寫付多少、得多少；最下面一行說明只在這台手機第一次打開時出現"),
        ("R14-03-2", "2 買了兩份糧", "確認的訊息條「買進 100 糧，付 105 金」（確認樣式照 R6-31，client 現在用一般的）；糧變成付 110 金、得 77 金"),
        ("R14-03-3", "3 金不夠、木不到 100", "灰的按鈕，第二行寫原因：金不夠、木不到 100"),
        ("R14-03-4", "4 還在蓋", "建造中 60%；蓋好才有買賣"),
    ]),
    "R14-04-攻城砲與砲坊": ("攻城砲（D-099、D-115）：生命 140，打建築 10 格、打兵 6 格，3 格內打不到；怕騎兵和近身的兵。選到時戰場上畫三個圈（淡黃＝打建築、白＝打兵、紅虛線＝打不到；client 的 drawSiegeRanges）。砲坊：木 200，要先有射場；訓練攻城砲 木150 金100。" + FIELD + PROP, [
        ("R14-04-1", "1 選一門攻城砲", "說明多兩行：射程、剋怕；只有一門時沒有整理隊形"),
        ("R14-04-2", "2 3 門攻城砲＋6 名槍兵打箭樓", "每門各三個圈（client 最多畫 6 門）；石頭在空中；目前：攻擊中 9"),
        ("R14-04-3", "3 點敵方的攻城砲", "敵方攻城砲、移動中、90/140、剋怕；沒有指令"),
        ("R14-04-4", "4 砲坊：自動訓練、佇列", "「補軍團缺的：砲 2」（client 少了攻城砲的簡稱，現在會寫「兵 2」）；訓練攻城砲三格寬（剋怕 13 個字放不進兩格，提議）"),
        ("R14-04-5", "5 砲坊還在蓋", "建造中 80%；自動訓練可以先設"),
        ("R14-04-6", "6 建造選單多了砲坊、市場", "13 種＋返回放不進 R6 的 4 欄（會疊到全軍鈕）：改 5 欄、每顆 52 pt（提議）"),
    ]),
    "R14-05-哨所": ("3×3 哨所（D-119、D-121）：生命 1500、木 90，最多 9 名槍兵躲在裡面（圖上站在牆頂，規則照躲著）。面板照 R13 B：一格一名，藍虛線格是正走過來的；每個編隊一顆「召回」、全部離開（D-125）；新蓋的哨所預設堅守。" + FIELD + PROP, [
        ("R14-05-1", "1 剛蓋好、沒有人", "0/9；全部離開不能按；堅守亮著，下面一行寫堅守做什麼"),
        ("R14-05-2", "2 叫了槍兵：5 名在裡面、2 名正過來", "5/9＋2 格虛線；編隊 1：7 名［召回］；編隊鈕角上「駐7」"),
        ("R14-05-3", "3 滿了 9/9", "＋槍兵不能按；兩個編隊各一顆召回"),
        ("R14-05-4", "4 攻擊：敵兵靠近，出去打", "攻擊亮著；4 名在裡面、5 名出去打（提議：client 現在會寫「5 名正過來」）"),
        ("R14-05-5", "5 被打：堅守，從裡面戳", "980/1500、「剛被攻擊，暫時不能修理」，受損的圖"),
        ("R14-05-6", "6 點敵方的哨所", "敵方哨所、裡面有人；只有生命"),
    ]),
    "R14-06-守城中的城鎮": ("我方治理的大城被攻（D-110 留守、D-116 守城）：點城鎮看到的面板照 R13 B——牆上、城內一格一名，留守 − N ＋、歸隊、全部帶走（D-125：城照舊）。地圖鈕的紅點是幾處被攻擊（R6-22）。被我方圍攻的城見 R14-01、R14-02。" + FIELD, [
        ("R14-06-1", "1 敵軍打東門，點城鎮", "主堡 1000/1000、城裡 12 名（至少 3 名）；牆上 6、城內 6；城樓射箭"),
        ("R14-06-2", "2 選了城裡的兵", "目前：守城 12；編隊鈕「駐12」；牆上的兵沒有腳下的圈，只有血條"),
        ("R14-06-3", "3 城門破了、敵軍進城", "主堡 640/1000、城裡 7 名、牆上 3"),
        ("R14-06-4", "4 守軍快沒了：叛離倒數", "主堡倒了、城裡 1 名（至少 3 名）；紅字「駐軍不足，0:45 後叛離」"),
        ("R14-06-5", "5 丟了：敵方攻下", "剛攻下的那一刻跳訊息條「敵方攻下了一座城鎮」；城標變紅；面板只剩民兵、駐軍"),
    ]),
    "R14-07-牆上換邊": ("牆上換邊（D-119 A、D-124 (b)）：牆上的弓手、法師沿牆走過去打，城門還在時從門頂走；敵人超過牆上守軍的 2 倍就不走；敵人走了 10 秒回原位。client 的面板在換邊時不變（牆上 N 名照舊），黃虛線那一行是提議；戰場上的黃色箭頭只是示意，遊戲不畫。" + FIELD, [
        ("R14-07-1", "1 敵人到東牆南段：4 名走過東門頂", "敵人 7 名，沒超過牆上 6 名的 2 倍：北段的兵沿牆走過來"),
        ("R14-07-2", "2 到了：一起打", "6 名都在東牆南段射"),
        ("R14-07-3", "3 敵人太多：不換邊", "15 名，超過牆上 6 名的 2 倍：牆上的兵留在原地（免得走過去被打死）"),
        ("R14-07-4", "4 敵人走了：走回原位", "10 秒沒有敵人，走回原本的位置"),
        ("R14-07-5", "5 東門破了：門頂過不去", "城門破了就只在那一段走（D-119）"),
    ]),
    "R14-08-進駐": ("進駐（R13 B，D-125 核准）的 R6 版：R13 B 本來就用 R6 A 銅木的元件，R14 換成 art-v7 菱形戰場（B2 的擺法和演算法）、3×3 哨所、R6-24 的玩家色，加主城的面板（7d）。用詞照 D-125：主城、箭樓、哨所「全部離開」，哨所每個編隊「召回」，城「歸隊」「全部帶走」。" + B2_NOTE + "建築擺得比實際近，這是示意。", [
        ("R14-08-1", "1 選兵前", "沒選東西：指令區只有「建造」"),
        ("R14-08-2", "2 選兵後（混編 12 名）", "指令區 2 排，「進駐」在第 2 排最後"),
        ("R14-08-3", "3 按下進駐（只選 6 名槍兵）", "大城、哨所亮金框；主城、箭樓灰虛線框；選取資訊收起"),
        ("R14-08-4", "4 混編提示（12 名）", "四棟各一個標籤：上一行進去的，下一行留下的"),
        ("R14-08-5", "5 目標滿了", "點了滿的箭樓：訊息條「箭樓滿了（最多 3 名），沒有人進去」；箭樓的標籤是灰的"),
        ("R14-08-6", "6 點錯目標", "點了兵營：訊息條叫你點亮起來的建築；標籤還在"),
        ("R14-08-7a", "7a 已進駐：箭樓", "3 格 2 格有人；編隊 1 的 2 名［召回］；＋遠程、＋法師、全部離開"),
        ("R14-08-7b", "7b 已進駐：哨所", "9 格 5 格有人；每個編隊一顆召回；＋槍兵、全部離開、攻擊／堅守"),
        ("R14-08-7c", "7c 已進駐：大城", "牆上 3 格、城內 2 格；留守 − 5 ＋、歸隊、全部帶走"),
        ("R14-08-7d", "7d 已進駐：主城（R14 新加）", "6 格 2 格有人、召回、＋遠程、＋法師、全部離開；村民目標 − 40 ＋；主城的指令"),
        ("R14-08-8", "8 軍團畫面：進駐中的編隊", "大城、箭樓、哨所各一排方塊；召回、出城歸隊、全部帶走；兵種 −／＋ 往下捲"),
        ("R14-08-B2-1", "B2-1 擠：錯開、拉引線", "大城的標籤往左移開，拉引線；兩座箭樓內容一樣，近的完整、遠的小籤"),
        ("R14-08-B2-2", "B2-2 更擠：小籤", "六座箭樓：最近的完整標籤，其他五座「進 3」"),
        ("R14-08-B2-3", "B2-3 被介面擋住", "標籤夾回戰場，拉引線到金框"),
        ("R14-08-B2-4", "B2-4 畫面外：沿邊箭頭", "畫面外的建築各一個箭頭；點了鏡頭移過去，不下指令"),
        ("R14-08-B2-5", "B2-5 點「主城」箭頭之後", "鏡頭移到主城、金框閃一下；再點才進駐"),
        ("R14-08-B2-6", "B2-6 沒有地方可以進駐", "只選槍兵，附近只有主城、箭樓：提示列直接說，只有取消"),
    ]),
    "R14-09-局後統計": ("局後統計（R13 A 分頁，D-125 核准）：R13 本來就是 R6 A 銅木的卡片和按鈕，R14 只把圖表顏色換成 R6-24 的玩家色（我方 #3f7fe0 實線圓點、敵方 #d9433a 虛線方點；validate_palette.js 在卡片底色 #221810 上全過），資料照 core 的時間軸（D-125）。", [
        ("R14-09-1", "1 總覽（勝）", "左：關鍵時刻；右：雙方數字"),
        ("R14-09-2", "2 資源：糧", "累計採集，糧木金魔晶切換；線尾直接寫數字"),
        ("R14-09-3", "3 資源：切到魔晶", "敵方 10 分多治理大城後追上"),
        ("R14-09-4", "4 兵力", "士兵數（不含村民），標出雙方最多的時候"),
        ("R14-09-5", "5 戰鬥", "各兵種：左邊我方損失、右邊我方擊殺"),
        ("R14-09-6", "6 城鎮", "四座城鎮誰的；圓圈是治理、搶、叛離，框色＝誰做的"),
        ("R14-09-7", "7 法師", "訓練、陣亡、晶砲發數、晶砲擊殺、一發最多"),
        ("R14-09-8", "8 總覽（敗）", "我方主城被摧毀、23:15"),
        ("R14-09-9", "9 戰鬥（敗）", "村民死 31"),
    ]),
}
OVERVIEW = [("R14-01-城門", "R14-01-2"), ("R14-02-主堡", "R14-02-3"), ("R14-03-市場", "R14-03-1"),
            ("R14-04-攻城砲與砲坊", "R14-04-2"), ("R14-05-哨所", "R14-05-2"), ("R14-06-守城中的城鎮", "R14-06-1"),
            ("R14-07-牆上換邊", "R14-07-1"), ("R14-08-進駐", "R14-08-4"), ("R14-09-局後統計", "R14-09-2")]


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
    if m["under"]:
        out.append(("字太小：" + "、".join(m["under"]), RED))
    else:
        nm = m["newMin"]
        r6 = m["minFont"] < 12
        out.append((f"字最小 {m['minFont']:g} pt" + ("（R6 的按鈕小字、說明列）" if r6 else "") + f"，其他字 ≥ 12 pt（最小 {nm:g}）", GREEN))
    sel = m["panels"].get("sel")
    if sel:
        out.append((f"選取資訊 {sel['h']} pt 高" + ("（R6 是 171 pt）" if sel["h"] > 171 else ""), GREY))
    if m.get("errors"):
        out.append(("頁面錯誤：" + " | ".join(m["errors"])[:120], RED))
    return out


def cell(raw, job, title, cap, scale, width, small_caps=False):
    im = Image.open(raw / f"{job}.png").convert("RGB")
    k = scale / 3
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
    subl = [ln for para in sub.split("\n") for ln in wrap(probe, para, fs, W - 2 * M)]
    title_h = (58 if not small_caps else 40) + len(subl) * int(fs.size * 1.45) + 18
    rows = [tiles[i:i + cols] for i in range(0, len(tiles), cols)]
    H = title_h + sum(max(t.height for t in r) + gap for r in rows) + M
    o = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(o)
    label = f"{name}-A-銅木-phone{suffix}"
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
    ft, fm = font(22), font(18, False)
    tiles = []
    for name, job in OVERVIEW:
        im = Image.open(raw / f"{job}.png").convert("RGB").resize((814, 380), Image.LANCZOS)
        n = len(BOARDS[name][1])
        jobs = [j for j, _, _ in BOARDS[name][1]]
        ms = [json.loads((raw / f"{j}.json").read_text()) for j in jobs]
        okay = all(not (m["small"] or m["clipped"] or m["out"] or m["under"] or m.get("errors")) for m in ms)
        o = Image.new("RGB", (fw, 380 + 12 + int(ft.size * 1.5) + int(fm.size * 1.5)), BG)
        d = ImageDraw.Draw(o)
        o.paste(im, (0, 0))
        d.rectangle((0, 0, fw - 1, 379), outline=(180, 170, 150))
        d.text((0, 388), f"{name}-A-銅木-phone.png", font=ft, fill=INK)
        d.text((0, 388 + int(ft.size * 1.5)), f"{n} 個狀態；" + ("觸控 ≥ 44 pt、沒有截字、字級照 R6" if okay else "有沒過的量測，見設計稿"), font=fm, fill=GREEN if okay else RED)
        tiles.append(o)
    rows = [tiles[i:i + 3] for i in range(0, len(tiles), 3)]
    W = 2 * M + 3 * fw + 2 * gap
    head = 130
    H = head + sum(max(t.height for t in r) + 40 for r in rows) + M
    o = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(o)
    d.text((M, M - 6), "R14-99-總覽-A-銅木", font=font(40), fill=INK)
    d.text((M, M + 50), "R6 之後才加的 9 個面板，用 R6 核准的 A 銅木畫（D-127）。每格是一張設計稿的代表畫面（手機實際大小，1 pt = 1 px），下面印檔名；每張設計稿裡有那個面板的每個狀態。",
           font=font(20, False), fill=GREY)
    y = head
    for r in rows:
        x = M
        for t in r:
            o.paste(t, (x, y))
            x += fw + gap
        y += max(t.height for t in r) + 40
    o.save(OUT / "R14-99-總覽-A-銅木.png")


def main(raw):
    OUT.mkdir(parents=True, exist_ok=True)
    n = 0
    for name, (sub, cells) in BOARDS.items():
        board(name, sub, cells, raw, 2, 3 if len(cells) > 6 else 2)               # 2 px a pt
        board(name, sub, cells, raw, 1, 3, small_caps=True, suffix="-1x")         # the phone's real size
        n += 2
    overview(raw)
    print(n + 1, "boards in", OUT)


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parent / "build/raw")
