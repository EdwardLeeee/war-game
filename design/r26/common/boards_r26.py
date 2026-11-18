"""R26 電腦版 boards (brief docs/briefs/2026-11-r26-desktop-ui.md; the user 2026-11-18: 「電腦版UI優化一下吧，然後框起來選兵可以
用右鍵？」): one board per item, 現況 beside the change (and its two options where there are), plus an overview that reads
without the details. Every label above its picture, none over it; every label checked against the font first.

python3 -I design/r26/common/boards_r26.py SHOTS OUT
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
BG = (24, 26, 30)
CELL = (40, 43, 50)
INK = (240, 240, 240)
GOLD = (250, 220, 140)
GREY = (190, 190, 190)
DIM = (150, 150, 150)
NOW = (255, 150, 130)
NEW = (140, 220, 150)
BLUE = (150, 190, 255)
GAP = 28
TEXTS = []


def font(size, bold=True):
    return ImageFont.truetype(BOLD if bold else REG, size, index=3)


def _ink(ch, f):
    im = Image.new("L", (80, 80), 0)
    ImageDraw.Draw(im).text((10, 5), ch, font=f, fill=255)
    return im


def check_glyphs():
    f = font(40)
    tofu = _ink("", f)
    bad = sorted({ch for t in TEXTS for ch in t if not ch.isspace() and ImageChops.difference(_ink(ch, f), tofu).getbbox() is None})
    if bad:
        raise SystemExit(f"no glyph in the font for: {' '.join(bad)}")


D0 = ImageDraw.Draw(Image.new("RGB", (10, 10)))


def wrap(text, f, width):
    lines, cur = [], ""
    for ch in text:
        if ch == "\n":
            lines.append(cur)
            cur = ""
        elif D0.textlength(cur + ch, font=f) > width:
            lines.append(cur)
            cur = ch
        else:
            cur += ch
    return lines + [cur] if cur else lines


def lines_of(items, width):
    out = []
    for text, size, colour, bold in items:
        TEXTS.append(text)
        f = font(size, bold)
        out += [(ln, f, colour) for ln in wrap(text, f, width)]
    return out


def draw_lines(d, x, y, lines, lead=12):
    for ln, f, c in lines:
        d.text((x, y), ln, font=f, fill=c)
        y += f.size + lead
    return y


def height_of(lines, lead=12):
    return sum(f.size + lead for _, f, _ in lines)


def text_cell(w, h, items, bg=CELL):
    im = Image.new("RGB", (w, h), bg)
    draw_lines(ImageDraw.Draw(im), 24, 20, lines_of(items, w - 48), lead=14)
    return im


def board(title, head, rows, foot, width):
    """rows: [(row label or None, [(cell label, colour, image), ...])], cells left to right at their own sizes."""
    hl = lines_of([(title, 54, INK, True)] + head, width - 2 * GAP)
    fl = lines_of(foot, width - 2 * GAP)
    plan = []
    for label, cells in rows:
        labs = [lines_of([(c[0], 28, c[1], True)], c[2].width) if c[0] else [] for c in cells]
        lh = max((height_of(x, 10) for x in labs), default=0)
        plan.append((label, cells, labs, lh))
    H = 24 + height_of(hl) + 12
    for label, cells, labs, lh in plan:
        H += (62 if label else 0) + lh + max(c[2].height for c in cells) + GAP
    H += height_of(fl) + 30
    img = Image.new("RGB", (width, H), BG)
    d = ImageDraw.Draw(img)
    y = draw_lines(d, GAP, 24, hl) + 12
    for label, cells, labs, lh in plan:
        if label:
            TEXTS.append(label)
            d.line((GAP, y + 2, width - GAP, y + 2), fill=(70, 74, 82), width=2)
            d.text((GAP, y + 12), label, font=font(38), fill=GOLD)
            y += 62
        x = GAP
        for (cl, colour, im), ls in zip(cells, labs):
            draw_lines(d, x, y + 2, ls, lead=10)
            img.paste(im, (x, y + lh))
            x += im.width + GAP
        y += lh + max(c[2].height for c in cells) + GAP
    draw_lines(d, GAP, y, fl)
    return img


def save(img, path):
    check_glyphs()
    TEXTS.clear()
    img.save(path)
    print(path.name, img.size)


def mouse(w, h, parts, title=None):
    """A mouse with callouts. parts: {"left": [...], "right": [...], "wheel": [...], "keys": [...]} (lines of words)."""
    im = Image.new("RGB", (w, h), CELL)
    d = ImageDraw.Draw(im)
    mx, my, mw, mh = w // 2 - 95, 70, 190, 290
    d.rounded_rectangle((mx, my, mx + mw, my + mh), 90, fill=(70, 66, 60), outline=(200, 190, 170), width=4)
    d.line((mx + mw // 2, my, mx + mw // 2, my + 120), fill=(200, 190, 170), width=4)
    d.line((mx + 6, my + 120, mx + mw - 6, my + 120), fill=(200, 190, 170), width=3)
    lc, rc = (120, 150, 210), (210, 150, 110)
    if parts.get("left"):
        d.pieslice((mx + 4, my + 4, mx + mw - 4, my + 236), 180, 270, fill=lc)
        d.rectangle((mx + 4, my + 90, mx + mw // 2 - 2, my + 118), fill=lc)
    if parts.get("right"):
        d.pieslice((mx + 4, my + 4, mx + mw - 4, my + 236), 270, 360, fill=rc)
        d.rectangle((mx + mw // 2 + 2, my + 90, mx + mw - 4, my + 118), fill=rc)
    d.rounded_rectangle((mx + mw // 2 - 12, my + 30, mx + mw // 2 + 12, my + 82), 10, fill=(230, 220, 180), outline=(40, 30, 20), width=2)
    f = font(26)
    f2 = font(24, False)

    def callout(lines, side, y0, colour, anchor):
        x = 24 if side == "L" else mx + mw + 70
        tw = mx - 70 - 24 if side == "L" else w - x - 24
        ys = y0
        for i, ln in enumerate(lines):
            TEXTS.append(ln)
            for part in wrap(ln, f if i == 0 else f2, tw):
                d.text((x, ys), part, font=f if i == 0 else f2, fill=colour if i == 0 else INK)
                ys += 36
        ex = mx - 60 if side == "L" else x - 10
        d.line((ex, y0 + 16, anchor[0], anchor[1]), fill=colour, width=3)
        d.ellipse((anchor[0] - 6, anchor[1] - 6, anchor[0] + 6, anchor[1] + 6), fill=colour)

    if parts.get("left"):
        callout(parts["left"], "L", 40, lc, (mx + 50, my + 60))
    if parts.get("right"):
        callout(parts["right"], "R", 40, rc, (mx + mw - 50, my + 60))
    if parts.get("wheel"):
        callout(parts["wheel"], "R", 250, (230, 220, 180), (mx + mw // 2 + 12, my + 56))
    if parts.get("keys"):
        y = my + mh + 30
        for ln in parts["keys"]:
            TEXTS.append(ln)
            for part in wrap(ln, f2, w - 48):
                d.text((24, y), part, font=f2, fill=GREY)
                y += 34
    if title:
        TEXTS.append(title)
        d.text((24, h - 44), title, font=font(24, False), fill=DIM)
    return im


def main():
    shots, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    checks = json.loads((shots / "checks.json").read_text())
    marks = checks.get("marks", {})

    def S(name, k=0.5, crop=None):
        im = Image.open(shots / f"{name}.png").convert("RGB")
        if crop:
            im = im.crop(crop)
        return im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)

    W3 = 3 * 960 + 4 * GAP
    src = ("畫在真畫面上：main 1825203，Chromium，1920×950（1920×1080 的螢幕扣掉瀏覽器外框），滑鼠，正式介面 A 銅木，假世界 art-v7.11（新手教學用真的遊戲）。"
           "改法是用腳本改現在的元件，不是 client 的程式。")
    cond_mouse = "只在有滑鼠的裝置生效（CSS (hover: hover) and (pointer: fine)）。iPhone 是觸控，不受影響。"

    # 1 介面放大.
    c = checks
    img = board("R26-01-介面放大-A自動放大-B加設定可調-desktop",
                [("戰場不放大，只放大介面（按鈕、面板、對話框、開局畫面）。選兵那一條和軍團畫面在電腦上最寬 640（放大前），靠左，跟指令區分開。", 30, GOLD, True),
                 ("生效條件：視窗高 ≥ 600 px 才放大。iPhone 橫向 336 高，一律不受影響。", 28, BLUE, True),
                 ("A 自動：倍數＝視窗高 ÷ 633，最小 1、最大 1.6（1920×950 → 1.5 倍；1366×768 → 1.21 倍）。B：A 再加「設定 → 介面大小」，自動／100%／125%／150%，跟 AoE2（最大 125%）、AoE4（字 100–150%）一樣讓玩家自己調。", 26, GREY, False),
                 (src, 22, DIM, False)],
                [("① 選了部隊", [(f"現況：按鈕 44 px（視窗高 4.6%），最小的字 {c['1-army-now']['smallText']:g} px；那一條拉到 1600 px 長", NOW, S("1-army-now")),
                                (f"A 自動 1.5 倍：按鈕 {c['1-army-A']['buttonH']} px（7%），最小的字 {c['1-army-A']['smallText']:g} px；那一條 960 px", NEW, S("1-army-A")),
                                (f"B 玩家在設定選了 125%：按鈕 {c['1-army-B125']['buttonH']} px", NEW, S("1-army-B125"))]),
                 ("② 軍團畫面", [("現況：跟著視窗拉到 1597 px 寬，兵擠在左邊", NOW, S("1-group-now")),
                               ("A：1.5 倍，最寬 960 px", NEW, S("1-group-A")),
                               ("B：同 A", NEW, text_cell(960, 475, [("B 的倍數由設定決定，排法跟 A 一樣。", 26, INK, False)]))]),
                 ("③ 設定", [("現況", NOW, S("1-settings-now")),
                            ("A：設定不變", NEW, text_cell(960, 475, [("A 沒有新的設定：倍數只看視窗大小。", 26, INK, False)])),
                            ("B：多一行「介面大小」（這張選了 125%）", NEW, S("1-settings-B"))]),
                 ("④ 其他畫面放大後（A，1.5 倍）：都沒壞", [("開局畫面", INK, S("1-start-A")), ("選單", INK, S("1-menu-A")), ("攻下城鎮：搶或治理", INK, S("1-town-A"))]),
                 (None, [("建造選單", INK, S("1-build-A")), ("新手教學的說明卡", INK, S("1-tut-A")), ("1366×768（1.21 倍）", INK, S("1-army-1366-A", 960 / 1366))])],
                [("每一格都量過：按鈕沒有互相重疊、沒有超出視窗。放大後會「壞」的只有局後統計：還是佔滿整個視窗、下面空三分之二（第 7 項處理）。小地圖是畫出來的圖，client 要照放大後的大小重畫，不然會糊。", 26, INK, False),
                 ("兵的大小：預設縮放下一個兵約 40–45 px（視窗高 4–5%），跟手機上看到的像素一樣；介面放大後兵比按鈕（66 px）還小。建議電腦上預設拉近約 1.3 倍（兵約 55 px），滾輪照樣能拉遠；不另外出選項。", 26, INK, False)],
                W3)
    save(img, out / "R26-01-介面放大-A自動放大-B加設定可調-desktop.png")

    # 2 快捷鍵.
    crop_cmd = (1090, 560, 1920, 950)
    img = board("R26-02-快捷鍵-A照字的意思-B照位置-desktop",
                [("按鈕右上角標出按鍵。兩組的差別只在指令和建造的鍵。", 30, GOLD, True),
                 (cond_mouse.replace("有滑鼠的裝置", "有滑鼠的裝置（按鍵角標也只在這時候出現）"), 28, BLUE, True),
                 ("A 照字的意思（英文字頭），跟星海爭霸 2 一樣：A 攻擊、M 移動、E 進駐、S 停止、H 堅守、F 隊形、R 整理隊形、B 建造；建造選單裡民居 H、農田 F、伐木場 L、礦場 M、糧倉 G、兵營 B、射場 R、法術營 W。"
                  "B 照位置：指令區一排 Q W E R（攻擊、移動、進駐、更多），「更多」那一排 A S D F；建造選單 Q W E R／A S D F／Z X C V；選村民時 Q 移動、W 停止、E 建造。", 26, GREY, False),
                 ("兩組都一樣的：1–4 選軍團（按兩下鏡頭跳過去）、Ctrl＋1–4 把選的兵存成軍團、F2 全軍、句點 閒置村民、Space 暫停／繼續、Esc 取消／收起／選單、方向鍵 移動畫面、Backspace 全軍撤退（依據：AoE4、星海爭霸 2 的預設鍵）。", 26, GREY, False),
                 (src, 22, DIM, False)],
                [("① 選了部隊（1.5 倍）", [("現況：沒有按鍵", NOW, S("2-army-now")), ("A 照字的意思", NEW, S("2-army-A")), ("B 照位置", NEW, S("2-army-B"))]),
                 ("② 打開「更多」（右下角放大）", [("現況：沒有按鍵", NOW, S("2-army-now", 960 / 830, crop_cmd)), ("A：F 隊形、H 堅守、R 整理隊形、S 停止", NEW, S("2-more-A", 960 / 830, crop_cmd)),
                                          ("B：A S D F", NEW, S("2-more-B", 960 / 830, crop_cmd))]),
                 ("③ 建造選單（右下角放大）", [("現況", NOW, S("2-build-now", 960 / 830, crop_cmd)), ("A：英文字頭（民居 H、農田 F、兵營 B…）", NEW, S("2-build-A", 960 / 830, crop_cmd)),
                                        ("B：照格子 Q W E R／A S D F／Z X C V", NEW, S("2-build-B", 960 / 830, crop_cmd))])],
                [("A 的字是英文字頭（Attack、Move、Stop、Hold；House、Farm、Barracks…），建造選單打開時換成建築那一組，要多記一些字。B 只看位置，不用記字，但按鈕換位置時鍵也跟著換。", 26, INK, False),
                 ("跟第 6 項的兩種滑鼠操作都說得通：按鍵等於按那顆按鈕；攻擊、移動、進駐按了以後再用左鍵點目標，停止、堅守、隊形、整理隊形按了就做。6 B 的右鍵直接下指令，按鍵只是多一種下法。", 26, INK, False)],
                W3)
    save(img, out / "R26-02-快捷鍵-A照字的意思-B照位置-desktop.png")

    # 3 滑鼠說明.
    crop_tip = (960, 380, 1920, 950)
    img = board("R26-03-滑鼠說明-A貼在按鈕上-B固定在右下-desktop",
                [("滑鼠停在按鈕上 0.4 秒，出現說明：名字、按鍵、價錢、一兩句做什麼。從一顆移到隔壁那顆，馬上換，不再等。", 30, GOLD, True),
                 (cond_mouse, 28, BLUE, True),
                 ("A 貼在按鈕上方，眼睛不用離開按鈕。B 固定在指令區上面同一個位置，像 AoE2 的「固定位置」，不會蓋到別的按鈕。", 26, GREY, False),
                 ("依據：電腦上一般等 0.3–0.5 秒才出現（Unity 0.4 秒），移到隔壁馬上換；AoE2 DE 的提示可以選固定位置或跟著游標。", 24, GREY, False),
                 (src, 22, DIM, False)],
                [("① 指令：停在「攻擊」上（右下角放大）", [("現況：沒有說明", NOW, S("3-cmd-now", 1, crop_tip)), ("A 貼在按鈕上方", NEW, S("3-cmd-A", 1, crop_tip)), ("B 固定在指令區上面", NEW, S("3-cmd-B", 1, crop_tip))]),
                 ("② 建造：停在「兵營」上", [("現況：沒有說明，價錢只在按鈕上的小字", NOW, S("2-build-now", 1, crop_tip)), ("A", NEW, S("3-build-A", 1, crop_tip)), ("B", NEW, S("3-build-B", 1, crop_tip))])],
                [("說明裡的字照現在的按鈕小字和「？」裡的說明，不另外寫新的；鍵照第 2 項選的那一組。", 26, INK, False)],
                W3)
    save(img, out / "R26-03-滑鼠說明-A貼在按鈕上-B固定在右下-desktop.png")

    # 4 小地圖常開.
    crop_bl = (0, 520, 960, 950)
    W2 = 2 * 960 + 3 * GAP
    img = board("R26-04-小地圖常開-desktop",
                [("電腦上小地圖預設打開，放在左下角（264×264 px），「地圖」按鈕在它右邊，按了收起。選兵那一條往右讓開。手機照舊收在「地圖」按鈕裡。", 30, GOLD, True),
                 ("生效條件：有滑鼠，而且視窗高 ≥ 600 px。iPhone 不受影響。", 28, BLUE, True),
                 ("依據：AoE2、AoE3、AoE4、星海爭霸 2 的小地圖都一直開在下面的角落。", 24, GREY, False), (src, 22, DIM, False)],
                [("選了部隊（1.5 倍）", [("現況：小地圖收起", NOW, S("4-now")), ("改後：左下角常開", NEW, S("4-new"))]),
                 ("左下角放大", [("現況", NOW, S("4-now", 1, crop_bl)), ("改後", NEW, S("4-new", 1, crop_bl))])],
                [("小地圖上黑的地方是還沒探過的（假世界只探了家附近）。閒置按鈕移到小地圖上面。", 26, INK, False),
                 ("這一項只有一種畫法：照這樣做可以嗎？", 28, GOLD, True)], W2)
    save(img, out / "R26-04-小地圖常開-desktop.png")

    # 5 游標.
    def cur(name, w=620, h=380):
        m = marks[name]
        x0 = max(0, min(1920 - w, m["x"] - w // 2))
        y0 = max(0, min(950 - h, m["y"] - h // 2))
        return S(name, 1, (x0, y0, x0 + w, y0 + h))
    W3c = 3 * 620 + 4 * GAP
    img = board("R26-05-滑鼠游標-desktop",
                [("游標告訴你點下去會做什麼。選了兵：移到敵人上變成劍（攻擊）、移到自己的城或建築上變成城門（進駐）；選了村民：移到樹上變成斧頭（採集）。其他地方照舊是箭頭。", 30, GOLD, True),
                 (cond_mouse, 28, BLUE, True), (src, 22, DIM, False)],
                [(None, [("現況：選了兵，移到敵人上還是箭頭", NOW, cur("5-now")), ("改後：選了兵，移到敵人上 → 劍", NEW, cur("5-enemy")), ("改後：選了兵，移到地面 → 箭頭照舊", NEW, cur("5-ground"))]),
                 (None, [("改後：選了兵，移到自己的城 → 城門（進駐）", NEW, cur("5-town")), ("改後：選了村民，移到樹上 → 斧頭（採集）", NEW, cur("5-tree")),
                         ("", INK, text_cell(620, 380, [("這一項只有一種畫法：照這樣做可以嗎？", 26, GOLD, True), ("游標的圖是 ui 之後畫的正式圖，這裡先用示意。", 24, GREY, False)]))])],
                [], W3c)
    save(img, out / "R26-05-滑鼠游標-desktop.png")

    # 6 滑鼠操作.
    MW, MH = 960, 560
    m_now = mouse(MW, MH, {"left": ["左鍵", "點：選取，選了兵再點＝下指令", "拖：移動畫面", "按住不動一下再拖：框選"], "right": ["右鍵", "不做事"], "wheel": ["滾輪", "縮放"]})
    m_a = mouse(MW, MH, {"left": ["左鍵", "點：選取，選了兵再點＝下指令", "拖：移動畫面"], "right": ["右鍵", "拖：框選", "點一下：不做事"], "wheel": ["滾輪", "縮放"],
                         "keys": ["移動畫面：左鍵拖（照舊）"]})
    m_b = mouse(MW, MH, {"left": ["左鍵", "點：選取", "拖：框選"], "right": ["右鍵", "點：下指令（地面＝移動、敵人＝攻擊、自己的城＝進駐、樹＝採集）"], "wheel": ["滾輪", "縮放；按住拖＝移動畫面"],
                         "keys": ["移動畫面：方向鍵、滑鼠移到畫面邊緣、按住滾輪拖"]})
    crop_m = lambda n: (max(0, marks[n]["x0"] - 260), max(0, marks[n]["y0"] - 160), min(1920, marks[n]["x0"] - 260 + 960), min(950, marks[n]["y0"] - 160 + 475))  # noqa: E731
    img = board("R26-06-滑鼠操作-A右鍵框選-B左鍵框選右鍵下指令-desktop",
                [("用滑鼠時，左鍵、右鍵、滾輪各做什麼。", 30, GOLD, True),
                 ("生效條件：只在有滑鼠的裝置。iPhone 照舊用手指（按住不動一下再拖＝框選）。", 28, BLUE, True),
                 ("A：右鍵拖框選，左鍵照舊（client 正在做）。B：常見即時戰略遊戲（AoE、星海爭霸 2）的做法：左鍵拖框選，右鍵下指令。", 26, GREY, False), (src, 22, DIM, False)],
                [("各鍵做什麼", [("現況（main）", NOW, m_now), ("A 右鍵框選", NEW, m_a), ("B 左鍵框選、右鍵下指令", NEW, m_b)]),
                 ("框選的樣子（1.5 倍）", [("現況：左鍵按住不動一下再拖", NOW, S("6-now", 1, crop_m("6-now"))), ("A：按住右鍵拖", NEW, S("6-A", 1, crop_m("6-A"))),
                                     ("B：按住左鍵拖", NEW, S("6-B", 1, crop_m("6-B")))])],
                [("B 的話：左鍵點地面不再下指令，要用右鍵；新手教學第 5 步、第 7 步的說明要跟著換（「點發亮的地方」→「右鍵點發亮的地方」）。", 26, INK, False)],
                W3)
    save(img, out / "R26-06-滑鼠操作-A右鍵框選-B左鍵框選右鍵下指令-desktop.png")

    # 7 局後統計.
    img = board("R26-07-局後統計-desktop",
                [("放大 1.5 倍（第 1 項）以後，總覽下面空的地方直接放兵力圖，不用切到「兵力」才看得到；字從 13 px 變 20 px。", 30, GOLD, True),
                 ("生效條件：視窗高 ≥ 600 px（跟第 1 項一起）。iPhone 照舊。", 28, BLUE, True), (src, 22, DIM, False)],
                [(None, [("現況：佔滿整個視窗，字 13–14 px，下面三分之二空著", NOW, S("7-now")), ("改後：總覽＋兵力圖", NEW, S("7-new"))]),
                 ("左上角放大", [("現況", NOW, S("7-now", 1, (0, 0, 960, 475))), ("改後", NEW, S("7-new", 1, (0, 0, 960, 475)))])],
                [("這一項只有一種畫法：照這樣做可以嗎？", 28, GOLD, True)], W2)
    save(img, out / "R26-07-局後統計-desktop.png")

    # 總覽.
    q = 0.25
    sm = lambda n, crop=None: S(n, q if crop is None else 480 / (crop[2] - crop[0]), crop)  # noqa: E731
    items = [
        ("01 介面放大（要你選）", "按鈕和字放大 1.5 倍；A 自動，B 還能在設定自己調", sm("1-army-now"), sm("1-army-A")),
        ("02 快捷鍵（要你選）", "按鈕角落標按鍵；A 照字的意思（A 攻擊），B 照位置（QWER）", sm("2-army-now", crop_cmd), sm("2-army-A", crop_cmd)),
        ("03 滑鼠說明（要你選）", "滑鼠停在按鈕上就有說明；A 貼在按鈕上，B 固定在右下", sm("3-cmd-now", crop_tip), sm("3-cmd-A", crop_tip)),
        ("04 小地圖常開", "電腦上小地圖一直開在左下角", sm("4-now"), sm("4-new")),
        ("05 滑鼠游標", "移到敵人上變成劍、自己的城變成城門", S("5-now", 480 / 620, (lambda m: (max(0, m['x'] - 310), max(0, m['y'] - 190), max(0, m['x'] - 310) + 620, max(0, m['y'] - 190) + 380))(marks["5-now"])),
         S("5-enemy", 480 / 620, (lambda m: (max(0, m['x'] - 310), max(0, m['y'] - 190), max(0, m['x'] - 310) + 620, max(0, m['y'] - 190) + 380))(marks["5-enemy"]))),
        ("06 滑鼠操作（要你選）", "A 右鍵拖框選；B 左鍵拖框選、右鍵下指令", m_a.resize((480, 280), Image.LANCZOS), m_b.resize((480, 280), Image.LANCZOS)),
        ("07 局後統計", "放大，總覽下面直接放兵力圖", sm("7-now"), sm("7-new")),
    ]
    cw = 2 * 480 + 16
    cells = []
    for title, line, a, b in items:
        h = 54 + max(a.height, b.height) + 34 + 70
        cimg = Image.new("RGB", (cw, h), CELL)
        d = ImageDraw.Draw(cimg)
        TEXTS.extend([title, line])
        d.text((0, 6), title, font=font(30), fill=GOLD)
        la, lb = ("A", "B") if title.startswith("06") else ("現況", "改後" if "要你選" not in title else "改後（A）")
        d.text((0, 50), la, font=font(22), fill=NOW if la == "現況" else NEW)
        d.text((496, 50), lb, font=font(22), fill=NEW)
        TEXTS.extend([la, lb])
        cimg.paste(a, (0, 84))
        cimg.paste(b, (496, 84))
        yy = 84 + max(a.height, b.height) + 10
        for part in wrap(line, font(24, False), cw):
            d.text((0, yy), part, font=font(24, False), fill=INK)
            yy += 34
        cells.append(cimg)
    # Same heights in a row.
    rows = []
    for i in range(0, len(cells), 2):
        pair = cells[i:i + 2]
        hh = max(c.height for c in pair)
        pair = [c if c.height == hh else Image.new("RGB", (c.width, hh), CELL) for c in pair] if False else pair
        rows.append((None, [("", INK, c) for c in pair]))
    img = board("R26-總覽-電腦版介面-desktop",
                [("電腦版介面 7 項。要你選的：01、02、03、06；04、05、07 只有一種，問「照這樣做可以嗎」。", 30, GOLD, True),
                 ("手機版（iPhone）都不受影響：放大只在視窗高 ≥ 600 px；其他只在有滑鼠的裝置。", 28, BLUE, True), (src, 22, DIM, False)],
                rows, [], 2 * cw + 3 * GAP)
    save(img, out / "R26-總覽-電腦版介面-desktop.png")


if __name__ == "__main__":
    main()
