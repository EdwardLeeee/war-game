"""R25 新手教學 boards (brief docs/briefs/2026-11-r25-tutorial.md, D-150; the user: 「我覺得可以做一個獨立的新手教學」,
「只要教學關卡」): an overview with every step on one page and the highlight's two looks side by side, the shared parts,
and the steps in detail (1-5, 6-9). Every label above its screen, none over it. Each label checked against the font
first (R24 drew two empty boxes for glyphs the font lacks).

python3 -I design/r25/common/boards_r25.py SHOTS OUT [A|B]     (SHOTS: r25.mjs's screenshots; the look of the steps, A by default)
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
BG = (24, 26, 30)
INK = (240, 240, 240)
GOLD = (250, 220, 140)
GREY = (190, 190, 190)
DIM = (150, 150, 150)
GREEN = (140, 220, 150)
BLUE = (150, 190, 255)
GAP = 28


def font(size, bold=True):
    return ImageFont.truetype(BOLD if bold else REG, size, index=3)


def _ink(ch, f):
    im = Image.new("L", (80, 80), 0)
    ImageDraw.Draw(im).text((10, 5), ch, font=f, fill=255)
    return im


def check_glyphs(texts):
    """Raise on a character the font draws as its empty box."""
    f = font(40)
    tofu = _ink("", f)
    bad = sorted({ch for t in texts for ch in t if not ch.isspace() and ImageChops.difference(_ink(ch, f), tofu).getbbox() is None})
    if bad:
        raise SystemExit(f"no glyph in the font for: {' '.join(bad)}")


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
TEXTS = []


def lines_of(items, width):
    out = []
    for text, size, colour, bold in items:
        TEXTS.append(text)
        f = font(size, bold)
        out += [(ln, f, colour) for ln in wrap(D0, text, f, width)]
    return out


def draw_lines(d, x, y, lines, lead=12):
    for ln, f, c in lines:
        d.text((x, y), ln, font=f, fill=c)
        y += f.size + lead
    return y


def height_of(lines, lead=12):
    return sum(f.size + lead for _, f, _ in lines)


def text_cell(w, h, items):
    im = Image.new("RGB", (w, h), (40, 43, 50))
    d = ImageDraw.Draw(im)
    draw_lines(d, 26, 22, lines_of(items, w - 52), lead=14)
    return im


def board(out, title, head, rows, foot, cols, cw):
    """rows: [(row label or None, row sub or None, [(cell label, colour, image), ...])]."""
    W = cols * cw + (cols + 1) * GAP
    hl = lines_of([(title, 54, INK, True)] + head, W - 2 * GAP)
    fl = lines_of(foot, W - 2 * GAP)
    size = 30 if cw > 1000 else 26
    lab = lambda cl: wrap(D0, cl, font(size), cw)  # noqa: E731
    labh = lambda cells: max(len(lab(c[0])) for c in cells) * (size + 12) + 8  # noqa: E731
    plan = []
    for label, sub, cells in rows:
        for c in cells:
            TEXTS.append(c[0])
        sl = lines_of([(sub, 26, GREY, False)], W - 2 * GAP) if sub else []
        plan.append((label, sl, cells))
    H = 24 + height_of(hl) + 12
    for label, sl, cells in plan:
        H += (62 if label else 0) + height_of(sl) + labh(cells) + max(c[2].height for c in cells) + GAP
    H += height_of(fl) + 30
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    y = draw_lines(d, GAP, 24, hl) + 12
    for label, sl, cells in plan:
        if label:
            TEXTS.append(label)
            d.line((GAP, y + 2, W - GAP, y + 2), fill=(70, 74, 82), width=2)
            d.text((GAP, y + 12), label, font=font(38), fill=GOLD)
            y += 62
        y = draw_lines(d, GAP, y, sl)
        lh = labh(cells)
        for i, (cl, colour, im) in enumerate(cells):
            x = GAP + i * (cw + GAP)
            for j, ln in enumerate(lab(cl)):
                d.text((x, y + 4 + j * (size + 12)), ln, font=font(size), fill=colour)
            img.paste(im, (x, y + lh))
        y += lh + max(c[2].height for c in cells) + GAP
    draw_lines(d, GAP, y, fl)
    return img


def main():
    shots, out = Path(sys.argv[1]), Path(sys.argv[2])
    st = sys.argv[3] if len(sys.argv) > 3 else "A"     # the look the nine steps and the details are drawn in
    out.mkdir(parents=True, exist_ok=True)

    def S(name, k):
        im = Image.open(shots / f"{name}.png").convert("RGB")
        return im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)

    BIG, SMALL = 0.5, 1 / 3                # 1398 x 504 (details), 932 x 336 (overview)
    same = ("畫在真畫面上：Chromium 932×336＋iPhone 安全區，正式介面 A 銅木，介面照 R24 改完的樣子（一條、指令區一排）。"
            "假世界代替教學場景：兵、建築和城鎮比教學多；教學用的小地圖和很弱的對手是 core 做的。")
    steps = [
        ("1", "看地圖", "1a", "拖動畫面、兩指縮放、點小地圖", "三件各做過一次"),
        ("2", "採集", "2b", "點一名村民，再點樹", "那名村民開始砍樹"),
        ("3", "蓋兵營", "3a", "選村民 → 建造 → 兵營 → 放好按 ✓（民居主城會自動蓋）", "兵營蓋好"),
        ("4", "練兵", "4a", "選兵營，按 5 下「訓練槍兵」", "5 名槍兵練好"),
        ("5", "選兵和移動", "5a", "長按拉框選兵，點發亮的地方", "兵走到那裡"),
        ("6", "編軍團", "6b", "選著兵按右邊的 1，再按「改成剛才選的」；之後兵營自動補兵", "編隊 1 有兵"),
        ("7", "守家", "7a", "敵人打主城 → 全軍撤退 → 點敵人打", "來打主城的小隊被打光"),
        ("8", "打城鎮", "8b", "打倒小鎮的民兵 → 治理（修 10 秒）→ 進駐", "小鎮治理好、有兵進駐"),
        ("9", "打下對手主城", "9d", "選砲坊練 2 門攻城砲，帶攻城砲和軍團打對手主城", "勝利"),
    ]

    # 總覽.
    ab = ("A 遮暗：只有要按的亮著，也只有它按得到；畫面照樣能拖、能縮放。B 不遮暗：金框加箭頭，其他地方照樣能按，做對了才往下。"
          "兩種都會一閃一閃（閃的樣子看 R25-框的樣子-A和B.gif）。")
    rows = [
        ("要你選：框的樣子（A｜B）", None, [
            ("A 遮暗：3 蓋兵營（框按鈕）", GOLD, S("3a-A", SMALL)), ("B 金框加箭頭：3 蓋兵營", GOLD, S("3a-B", SMALL)),
            ("", INK, text_cell(932, 336, [(ab, 26, INK, False)]))]),
        (None, None, [("A 遮暗：2 採集（框地圖上的樹）", GOLD, S("2b-A", SMALL)), ("B 金框加箭頭：2 採集", GOLD, S("2b-B", SMALL)),
                      ("", INK, text_cell(932, 336, [("沒有單一目標的步驟（1 看地圖、5 拉框）A 也不遮暗整個畫面：1 不遮、5 只亮兵站的那一塊。", 26, INK, False),
                                                    ("下面九格先用 A 畫，你選了以後照選的重畫。", 26, GREY, False)]))]),
    ]
    for i in range(0, 9, 3):
        cells = [(f"{n} {name}：{what}　→ 過關：{done}", INK, S(f"{key}-{st}", SMALL)) for n, name, key, what, done in steps[i:i + 3]]
        rows.append(("九步（約 10–15 分鐘）" if i == 0 else None, None, cells))
    img = board(out / "x", "R25-總覽-phone",
                [("選單 → 設定、開局畫面都有「新手教學」。一步一張說明卡，要按的東西框起來，做對了才往下；每步都能「跳過這步」或按 × 離開。", 30, GOLD, True),
                 ("步驟從 ceo 草案的 11 步併成 9 步：「攻擊」和「主城被打」併成 7 守家；「打城鎮」和「進駐」併成 8；「練兵」說明的自動補兵移到 6 編軍團（兵營要有軍團才會自動練）。", 26, GREY, False),
                 (same, 24, DIM, False)],
                rows,
                [("要 core 和 client 配合的：教學場景的小鎮修 10 秒（core 已答應）；第 9 步給蓋好的砲坊和練 2 門砲的錢；「跳過這步」直接擺好那一步的結果（例如給一座蓋好的兵營、5 名槍兵）再往下。", 26, INK, False),
                 ("7 守家要成立：5 那個發亮的地方要離主城遠一點（往小鎮的方向）；來打主城的小隊等 6 做完才派，到主城時軍團還在外面，「全軍撤退」才有用（軍團還沒駐守過別的城，會退回主城）。", 26, INK, False)],
                cols=3, cw=932)
    save(img, out / "R25-總覽-phone.png")

    # 共用元件.
    img = board(out / "x", "R25-共用元件-phone",
                [("說明卡、框、手勢、入口、離開和完成：每一步都用同一套。", 30, GOLD, True), (same, 24, DIM, False)],
                [("說明卡", "固定在資源列下面、右邊的編隊前面（390×最多 3 行）。上緣一條細線是 9 步的進度。右邊是「跳過這步」和 ×（離開）。", [
                    ("平常：第幾步、做什麼（金色字是要按的）", INK, S("2b-A", BIG)),
                    ("只剩一行：打開了軍團畫面時，不擋住它", INK, S("6b-A", BIG))]),
                 (None, None, [("要等的時候：進度條（蓋房、練兵、修城）", INK, S("3d-A", BIG)),
                               ("做對了：綠框、打勾，「下一步」；一秒多以後自己往下", GREEN, S("2c-A", BIG))]),
                 (None, None, [("遊戲自己的提示出來時（放建築、進駐）：說明卡先收起，框照舊；提示結束再出來", INK, S("3c-A", BIG)),
                               ("對話框開著時（搶或治理、結算）：卡片移到左邊", INK, S("8b-A", BIG))]),
                 (None, None, [("目標不在畫面裡：邊上一個金色標籤指過去，卡片上有「帶我去看」", INK, S("8a-A", BIG)),
                               ("進駐的標籤照遊戲原本的排法（說明卡收起，讓出上面）", INK, S("8d-A", BIG))]),
                 ("手勢", "要拖、縮放、長按的步驟，畫一根手指和它要走的路。", [
                     ("拖動、兩指縮放（1 看地圖）", INK, S("1a-A", BIG)), ("按住不動一下再拖，拉出框（5 選兵）", INK, S("5a-A", BIG))]),
                 ("進來和離開", None, [
                     ("開局畫面：「開始」下面多一顆「新手教學」", INK, S("e-start-A", BIG)),
                     ("遊戲中：選單 → 設定，「開局提示」旁邊（選單本身十格已滿）", INK, S("e-settings-A", BIG))]),
                 (None, None, [("遊戲中按「新手教學」：先離開這一局（這一局存著，回來按「繼續上一局」）", INK, S("e-enter-A", BIG)),
                               ("教學中按 ×：問一次再離開，進度不存", INK, S("e-leave-A", BIG))]),
                 ("完成", None, [("打下對手主城：結算畫面加「教學完成」，可以直接開第一局", GREEN, S("9e-A", BIG)),
                                ("6 編好軍團：做對了的樣子（框變綠）", GREEN, S("6c-A", BIG))])],
                [("每一格都量過：按鈕都 ≥ 44 pt，說明卡沒有蓋到按鈕、遊戲自己的提示或進駐標籤。對話框開著時（8b、9e）卡片蓋到的是對話框後面、本來就按不到的按鈕。", 26, INK, False)],
                cols=2, cw=1398)
    save(img, out / "R25-共用元件-phone.png")

    # 步驟細節.
    detail = {
        "1": ["1a 拖動、縮放（已拖過一次，打勾）", "1b 打開小地圖、點一下跳過去"],
        "2": ["2a 點一名村民", "2b 再點一棵樹", "2c 做對了"],
        "3": ["3a 選著村民，按「建造」", "3b 按「兵營」（民居主城會自動蓋）", "3c 放好以後按 ✓（遊戲自己的提示出來，說明卡先收起）", "3d 等村民蓋好"],
        "4": ["4a 選兵營，按 5 下「訓練槍兵」", "4b 等 5 名練好"],
        "5": ["5a 長按拉框，把兵框起來", "5b 點發亮的地方，兵就走過去"],
        "6": ["6a 選著兵，按右邊的 1", "6b 空的編隊打開軍團畫面：按「改成剛才選的」", "6c 做對了：之後兵營自動補兵"],
        "7": ["7a 敵人來打主城（訊息條照舊報）：按「全軍撤退」，軍團退回主城", "7b 軍團回來了：點敵人，打光就過關"],
        "8": ["8a 小鎮不在畫面裡：邊上的標籤、「帶我去看」", "8b 打倒民兵後：選治理（卡片移到左邊）", "8c 等城修好（10 秒）", "8d 選軍團按「進駐」，點亮起來的小鎮（說明卡收起，讓出遊戲的提示和標籤）"],
        "9": ["9a core 給一座蓋好的砲坊：選它，按 2 下「訓練攻城砲」", "9b 等 2 門練好", "9c 對手主城不在畫面裡：邊上的標籤、「帶我去看」",
              "9d 選著攻城砲和軍團，點對手的主城（假世界用對手的兵營代替）", "9e 勝利：教學完成"],
    }
    for name, part in (("1到5", steps[:5]), ("6到9", steps[5:])):
        rows = []
        for n, title, _key, what, done in part:
            frames = detail[n]
            for i in range(0, len(frames), 2):
                cells = [(lab, INK, S(f"{lab.split(' ')[0]}-{st}", BIG)) for lab in frames[i:i + 2]]
                rows.append((f"{n} {title}" if i == 0 else None, f"要做的：{what}。過關：{done}。" if i == 0 else None, cells))
        img = board(out / "x", f"R25-步驟-{name}-phone", [("每一步的每一格：說明卡寫什麼、框哪裡、做對了怎麼往下。先用 A（遮暗）畫。", 30, GOLD, True), (same, 24, DIM, False)],
                    rows, [], cols=2, cw=1398)
        save(img, out / f"R25-步驟-{name}-phone.png")
    frames = shots.parent / "gif"
    if (frames / "gif-A-0.png").exists():
        gif(frames, out / "R25-框的樣子-A和B.gif")


def gif(frames, out):
    """The flash, A and B side by side (gif_r25.mjs's eight frames each), labels above the screens."""
    labels = ["R25-框的樣子-A和B：3 蓋兵營", "A 遮暗", "B 金框加箭頭"]
    check_glyphs(labels)
    pics = []
    for i in range(8):
        im = Image.new("RGB", (2 * 932 + 3 * 20, 336 + 110), BG)
        d = ImageDraw.Draw(im)
        d.text((20, 12), labels[0], font=font(30), fill=INK)
        for k, st in enumerate("AB"):
            x = 20 + k * (932 + 20)
            d.text((x, 62), labels[1 + k], font=font(26), fill=GOLD)
            im.paste(Image.open(frames / f"gif-{st}-{i}.png").convert("RGB").resize((932, 336), Image.LANCZOS), (x, 102))
        pics.append(im.convert("P", palette=Image.ADAPTIVE, colors=255))
    pics[0].save(out, save_all=True, append_images=pics[1:], duration=110, loop=0, optimize=True)
    print(out.name, pics[0].size)


def save(img, path):
    check_glyphs(TEXTS)
    TEXTS.clear()
    img.save(path)
    print(path.name, img.size)


if __name__ == "__main__":
    main()
