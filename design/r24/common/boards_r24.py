"""R24 介面健檢 boards (brief docs/briefs/2026-11-r24-ui-audit.md, D-149; the user 2026-11-15: 「我覺得你可以把有問題的頁面
打開然後給我看你想的改法」): each item one board, 現況 and 改法 side by side on the real page (正式介面 A 銅木, 932 x 336 with
the iPhone's safe area, the fake world with art-v7.11), plus an overview. Every label above its screen, none over it.

python3 -I design/r24/common/boards_r24.py SHOTS RAW OUT
  SHOTS: r24.mjs's screenshots and checks.json; RAW: the client's review/r24/raw (R24-01 and the start tips are theirs).
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
BG = (24, 26, 30)
INK = (240, 240, 240)
GOLD = (250, 220, 140)
GREY = (190, 190, 190)
DIM = (150, 150, 150)
NOW = (255, 150, 130)
NEW = (140, 220, 150)
YELLOW = (255, 214, 40)
K = 0.5  # the 3x screenshots at half size: 1398 x 504
PW, PH = 1398, 504
GAP = 28


def font(size, bold=True):
    return ImageFont.truetype(BOLD if bold else REG, size, index=3)


def wrap(d, text, f, width):
    lines, cur = [], ""
    for ch in text:
        if ch == "\n":
            lines.append(cur)
            cur = ""
        elif d.textlength(cur + ch, font=f) > width:
            lines.append(cur)
            cur = ch
        else:
            cur += ch
    return lines + [cur] if cur else lines


D0 = ImageDraw.Draw(Image.new("RGB", (10, 10)))


def lines_of(items, width):
    """[(text, size, colour, bold)] -> wrapped [(line, font, colour)]."""
    out = []
    for text, size, colour, bold in items:
        f = font(size, bold)
        out += [(ln, f, colour) for ln in wrap(D0, text, f, width)]
    return out


def height_of(lines, lead=12):
    return sum(f.size + lead for _, f, _ in lines)


def draw_lines(d, x, y, lines, lead=12):
    for ln, f, c in lines:
        d.text((x, y), ln, font=f, fill=c)
        y += f.size + lead
    return y


def load(path, crop=None):
    im = Image.open(path).convert("RGB")
    if crop is not None:
        im = im.crop(crop)
    return im.resize((round(im.width * K), round(im.height * K)), Image.LANCZOS)


def badges(im, marks):
    """Numbered badges (left top of each box, in screen pt) on a half-size 3x shot."""
    d = ImageDraw.Draw(im)
    s = 3 * K
    f = font(24)
    for n, (x, y, w, h) in marks:
        d.rectangle((x * s - 2, y * s - 2, (x + w) * s + 2, (y + h) * s + 2), outline=YELLOW, width=3)
        bx, by = x * s - 4, y * s - 4
        d.rounded_rectangle((bx, by, bx + 34, by + 32), 6, fill=YELLOW)
        d.text((bx + 17, by + 15), str(n), font=f, fill=(20, 20, 20), anchor="mm")
    return im


def placeholder(text):
    im = Image.new("RGB", (PW, PH), (40, 43, 50))
    d = ImageDraw.Draw(im)
    y = PH // 2 - 60
    for ln in wrap(d, text, font(34, False), PW - 160):
        d.text((PW // 2, y), ln, font=font(34, False), fill=GREY, anchor="ma")
        y += 50
    return im


def board(out, title, head, rows, foot, cols=2):
    """rows: [(row label or None, [(cell label, colour, image), ...])]; head and foot: [(text, size, colour, bold)]."""
    W = cols * PW + (cols + 1) * GAP
    hl = lines_of([(title, 54, INK, True)] + head, W - 2 * GAP)
    fl = lines_of(foot, W - 2 * GAP)
    H = 24 + height_of(hl) + 12
    lab = lambda cl: wrap(D0, cl, font(30), PW)  # noqa: E731
    labh = lambda cells: max(len(lab(c[0])) for c in cells) * 42 + 8  # noqa: E731
    for label, cells in rows:
        H += (60 if label else 0) + labh(cells) + max(c[2].height for c in cells) + GAP
    H += height_of(fl) + 30
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    y = draw_lines(d, GAP, 24, hl) + 12
    for label, cells in rows:
        if label:
            d.line((GAP, y + 2, W - GAP, y + 2), fill=(70, 74, 82), width=2)
            d.text((GAP, y + 12), label, font=font(38), fill=GOLD)
            y += 60
        lh = labh(cells)
        for i, (cl, colour, im) in enumerate(cells):
            x = GAP + i * (PW + GAP)
            for j, ln in enumerate(lab(cl)):
                d.text((x, y + 4 + j * 42), ln, font=font(30), fill=colour)
            img.paste(im, (x, y + lh))
        y += lh + max(c[2].height for c in cells) + GAP
    draw_lines(d, GAP, y, fl)
    img.save(out)
    print(out.name, img.size)


def main():
    shots, raw, out = (Path(a) for a in sys.argv[1:4])
    out.mkdir(parents=True, exist_ok=True)
    checks = json.loads((shots / "checks.json").read_text())
    S = lambda n, crop=None: load(shots / f"{n}.png", crop)  # noqa: E731
    R = lambda n: load(raw / f"{n}.png")  # noqa: E731
    same = ("現況和改法都在同一版的真畫面上拍（Chromium 932×336＋iPhone 安全區，假世界，art-v7.11）；改法是用腳本把現在的元件改位置、改樣子，"
            "不是 client 的程式。")

    # R24-01 正式介面設成預設 (the client's shots, WebKit).
    pairs = [("沒選東西", "01-沒選東西"), ("選了部隊", "03-選了部隊"), ("軍團畫面", "05-用編隊選軍團-面板展開（軍團畫面）"),
             ("城鎮面板（攻下：搶或治理）", "09-攻下城鎮-搶或治理"), ("結算", "12-結算-總覽")]
    board(out / "R24-01-正式介面設成預設-phone.png", "R24-01-正式介面設成預設-phone",
          [("左：原型介面（現在的預設，154 局都是用它玩的）。右：正式介面（A 銅木，R6 定的那一套）：銅木的按鈕和面板、加圖示；左邊的「重設」拿掉、「全體回城」只在用得到時出現，小地圖收進「地圖」按鈕；其他按鈕的位置大致一樣。", 30, GOLD, True),
           ("你同意，client 就把預設改成正式介面（一行，不斷存檔）；設定裡照舊可以換回 B 墨漆金線。", 28, GREY, False)],
          [(name, [("原型（現在預設）", NOW, R(f"proto-{key}")), ("正式介面（A 銅木）", NEW, R(f"r6-{key}"))]) for name, key in pairs],
          [("截圖：client 拍的真畫面（WebKit 932×336＋iPhone 安全區，假世界，art-v7.11）。", 25, DIM, False)])

    # R24-02 選取資訊面板.
    bar = round(491 * 44 / (932 * 336) * 100, 1)
    rows = [
        ("① 選一名兵", [("現況：面板 171 pt 高，蓋住 20%，7 行字", NOW, S("02-one-now")),
                      (f"改法：一條 44 pt 貼底邊（蓋住 {bar}%）：兵種、在做什麼、生命、？、×；剋怕也收進「？」", NEW, S("02-one-new"))]),
        ("② 選了部隊", [("現況：面板 186 pt 高，蓋住 21.7%，說明字五行每次都在", NOW, S("02-army-now")),
                      ("改法：同一條：選了幾名、在做什麼、每種兵一格（點一下只選那種）", NEW, S("02-army-new"))]),
        ("③ 按了「？」", [("現況：沒有「？」，說明字一直開著（看上一列左邊）", NOW, placeholder("現在說明字一直開著，沒有另外的「？」——看上一列左邊那張")),
                        ("改法：說明字收進「？」：112 pt 高（上限是畫面高的 40%＝134 pt），點外面就收起", NEW, S("02-army-q"))]),
        ("④ 用編隊 1–4 選一個軍團", [("現況：面板收起成一條 58 pt，按「展開」才是軍團畫面", NOW, S("02-group-now")),
                                 ("改法：同一條，「展開」換成「軍團」那一格", NEW, S("02-group-new"))]),
        ("⑤ 打開軍團畫面", [("現況：按「展開」：217 pt 高，蓋住 25%，第三種兵要往下捲", NOW, S("02-groupscreen-now")),
                          ("改法：按「軍團」：在那一條上面，106 pt 高（不超過 40%），三種兵一行放得下；再按「軍團」或點外面就收起", NEW, S("02-groupscreen-new"))]),
        ("⑥ 最多的時候：五種兵（只截畫面底部這一段）", [("改法：部隊五種兵、指令不一樣：一條還放得下", NEW, S("02-army5-new", (330, 770, 2796, 1008))),
                                         ("改法：軍團五種兵：放不下的收成一格「＋2 種」，點了打開軍團畫面", NEW, S("02-group5-new", (330, 770, 2796, 1008)))]),
        ("⑦ 點空的編隊（還沒有兵；假世界開了回合 7 的規則，有四種兵）",
         [("現況：直接打開軍團畫面（217 pt），按「改成剛才選的」才存成編隊", NOW, S("02-groupempty-now")),
          ("改法：照舊直接打開，套 40%（134 pt）：四種兵時第二行只露一半，按右下的箭頭往下捲", NEW, S("02-groupempty-new"))]),
    ]
    board(out / "R24-02-選取資訊面板-phone.png", "R24-02-選取資訊面板-phone",
          [("選了兵以後，資訊只剩貼著底邊的一條（44 pt 高，從「地圖」右邊到指令區左邊），不蓋戰場中間；說明字收進「？」。", 30, GOLD, True),
           ("點編隊 1–4 照舊只選取、預設收起（你 2026-10-31 要的：「大部分時候我只是要點地板而已」），只是把「展開」換成條上的「軍團」那一格；空的編隊照舊直接打開軍團畫面（第 ⑦ 列）。", 28, GREY, False),
           (same, 24, DIM, False)],
          rows,
          [("一條裡寫什麼：選了幾名（軍團寫編隊和 12/12）、下面一行寫在做什麼（全部一樣只寫一個詞，例如「待命」；不一樣就寫最多的兩種和人數）；每種兵一格；「？」；「×」取消選取。", 26, INK, False),
           ("「？」和「軍團」打開的東西都在那一條上面，高度不超過畫面的 40%（134 pt），點外面就收起。軍團畫面一行三種兵；四種以上第二行要按箭頭往下捲（第 ⑦ 列；上限放寬到 46% 就不用捲）。", 26, INK, False),
           ("選建築（主城、兵營）照舊用現在的面板，不改。", 26, INK, False),
           ("每張改法都量過：按鈕都 ≥ 44 pt、都在安全區內、彼此不重疊；只有 ⑦ 露一半的那一行被下面那排按鈕蓋住（現在的軍團畫面也是這樣，捲下去才按得到）。小地圖打開時在「地圖」上面（到 y 263），不會碰到這一條（從 y 267 起）。", 26, INK, False)])

    # R24-03 常駐按鈕.
    now = checks["03-army-now"]["boxes"]
    want = [("攻擊", 1), ("移動", 2), ("堅守", 3), ("停止", 4), ("隊形", 5), ("整理隊形", 6), ("進駐", 7), ("全軍撤退", 8)]
    marks = []
    for key, n in want:
        b = next((b for b in now if b["t"].startswith(key)), None)
        if b is None:
            print("no button for", key, [b["t"] for b in now])
        else:
            marks.append((n, (b["x"], b["y"], b["w"], b["h"])))
    table = [
        "① 攻擊　6,832 次（140／154 局用過）→ 留",
        "② 移動　10,633 次（126 局）→ 留",
        "⑦ 進駐　約 2,079 次（自己的城 1,637／32 局，建築 442／52 局；含畫面自己送的）→ 留",
        "⑤ 隊形　改成散開約 152、改成密集 35（31 局）→ 收進「更多」",
        "③ 堅守　87 次（54 局）→ 收進「更多」",
        "⑥ 整理隊形　34 次（23 局）→ 收進「更多」",
        "④ 停止　10 次（9 局）→ 收進「更多」",
        "⑧ 全軍撤退　和各編隊的「退」合計 1,335 次（132 局，每局約 7.5 次；紀錄分不出是哪一顆）→ 常用，照舊常駐",
    ]
    board(out / "R24-03-常駐按鈕-phone.png", "R24-03-常駐按鈕-phone",
          [("指令區從兩排 7 顆變一排 4 顆：攻擊、移動、進駐、更多。「更多」裡是隊形、堅守、整理隊形、停止（照用的次數排）。右下角空出一排（50 pt 高）的戰場。", 30, GOLD, True),
           ("攻擊、移動用得最多，一定留。第三格放進駐：次數多（約 2,079，但含畫面自己送的），用過的局卻比堅守少（32／52 局對 54 局），數字分不出誰比較常用；要的話第三格可以換成堅守。", 26, GOLD, False),
           ("次數是 client 從你 154 局的紀錄數的（2026-10-06～11-12，都是原型介面；「進駐」在這個假世界要開回合 7 的規則才有，真的遊戲有）。", 26, GREY, False),
           (same, 24, DIM, False)],
          [("選了部隊（12 名，假世界開了「進駐」）",
            [("現況：指令區 7 顆，兩排（黃框是編號）", NOW, badges(S("03-army-now"), marks)),
             ("改法：一排 4 顆（指令區 239×50 pt，原本 239×105）", NEW, S("03-army-new"))]),
           (None, [("每顆用了幾次（黃框編號）", GOLD, table_img(table)),
                   ("改法：按了「更多」：一排四顆出現在上面，不碰到右邊的編隊和全軍", NEW, S("03-army-more"))])],
          [("另一個選項「全軍撤退只在交戰時出現」「編隊 1–4 加全軍縮小」沒有畫：全軍撤退和「退」合計每局約 7.5 次，是常用的；編隊和全軍只選兵、不送指令，紀錄裡數不到，沒有數字支持縮小。", 26, INK, False),
           ("只在用得到時才出現的照現在的做法：全體回城（77 次）、閒置；整理隊形本來就只在選兩名以上的兵時出現。選村民時指令區是移動、停止、建造三顆，不用收，照舊。", 26, INK, False),
           ("每張都量過：按鈕都 ≥ 44 pt、彼此不重疊、都在安全區內。", 26, INK, False)])

    # R24-04 用到才教.
    tips = [
        ("現況：開局提示只有一頁字（client 拍，真的遊戲）", NOW, R("r6-00-開局提示（真的遊戲）")),
        ("① 資源堆很多、軍團都補滿：「資源很多：軍團畫面可以打開「自動擴編」」", NEW, S("04-h1-rich")),
        ("② 第一次攻下城鎮：不加。攻下時這個對話框已經說了搶和治理的差別（開局提示也說了）", GREY, S("04-h2-taken")),
        ("③ 第一次治理成功：「城鎮修繕完成，開始產出。選兵按「進駐」再點這座城，兵就會進城守」", NEW, S("04-h3-governed")),
        ("④ 打對手主城打很久：「主城很耐打：帶攻城砲來打比較快」", NEW, S("04-h4-keep")),
        ("⑤ 有 10 名以上的兵卻沒有編隊：「選好兵，按右邊的 1–4，再按「改成剛才選的」，就編成軍團」", NEW, S("04-h5-groups")),
    ]
    board(out / "R24-04-用到才教-phone.png", "R24-04-用到才教-phone",
          [("遇到的時候才在訊息條跳一句（左邊金色「提示」兩個字），每句一局只說一次；設定裡的「開局提示：開／關」一起管。不加新的元件。", 30, GOLD, True),
           ("提示停 8 秒，點一下就關。現在的訊息條只停 2.2 秒、有新訊息就換掉、點了會穿過去：要改成提示這一條可以點；提示還在時有別的訊息來，照舊換掉，被換掉的提示算沒說過，下次遇到再說。", 26, GREY, False),
           (same, 24, DIM, False)],
          [(None, tips[i:i + 2]) for i in range(0, 6, 2)],
          [("跟 brief 不一樣的地方：② 不加（已經有對話框）；③ 和 ⑤ 的字改成說出怎麼按（brief 是「可以按進駐把兵留在城裡」「按右邊的 1–4 可以把兵編成軍團」；點空的編隊只會打開軍團畫面，要再按「改成剛才選的」才存）；③ 跟現在的「城鎮修繕完成，開始產出」合成一句，免得兩句互相換掉。", 26, INK, False),
           ("④ 假世界沒有對手的主城，畫面用對手的兵營代替；要等主城耐打 2/5（#497）上線才有這個情況。", 26, INK, False)])

    # 總覽.
    board(out / "R24-總覽-phone.png", "R24-總覽-phone",
          [("四項都改了以後，選了部隊時的畫面（左：現在；右：改完）。", 30, GOLD, True), (same, 24, DIM, False)],
          [("選了部隊（12 名）", [("現況：正式介面（原型是現在的預設，見 R24-01）", NOW, S("all-now")),
                                ("改完：01 正式介面＋02 一條＋03 一排四顆＋04 一句提示", NEW, S("all-new"))])],
          [("01 正式介面設成預設：原型和正式介面並排五個畫面，你同意就打開。", 28, INK, False),
           ("02 選取資訊面板：選兵後只剩貼底邊的一條（44 pt），說明字收進「？」，軍團畫面從「軍團」那一格打開、不超過畫面的 40%。", 28, INK, False),
           ("03 常駐按鈕：指令區一排四顆（攻擊、移動、進駐、更多），其餘照用的次數收進「更多」。", 28, INK, False),
           ("04 用到才教：四句提示在遇到時跳在訊息條，停 8 秒、點一下就關；「第一次攻下城鎮」那句不加。", 28, INK, False)])


def table_img(lines):
    im = Image.new("RGB", (PW, PH), (40, 43, 50))
    d = ImageDraw.Draw(im)
    y = 26
    for ln in lines:
        for part in wrap(d, ln, font(30, False), PW - 60):
            d.text((30, y), part, font=font(30, False), fill=INK)
            y += 44
        y += 6
    return im


if __name__ == "__main__":
    main()
