"""R27 哨所轉向 boards (the user 2026-11-27: 「你哨所的角度都一樣，其實應該要應對關口的位置轉向」; he chose 「先自動轉，不滿意再自己轉」
and 「蓋好也能轉」). Each board: the real battlefield (compose.py), every label above its picture, none over it; what R27 adds
to the interface boxed in yellow. Labels checked against the font first (R24 drew empty boxes for glyphs it lacks).

python3 -I design/r27/common/boards_r27.py OUT
"""
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
import compose as C  # noqa: E402

BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
BG = (24, 26, 30)
CELL = (40, 43, 50)
INK = (240, 240, 240)
GOLD = (250, 220, 140)
GREY = (190, 190, 190)
DIM = (150, 150, 150)
GREEN = (140, 220, 150)
BLUE = (150, 190, 255)
YEL = (255, 214, 40)
GAP = 28
TEXTS = []
HUD = C.UI / "design" / "r27" / "build" / "hud"

SRC = ("畫在真畫面上：client main 0665575d 的雙河關（電腦對電腦觀戰，沒有戰爭迷霧，開局暫停），iPhone 14 Pro Max 橫放的 app 全螢幕（932×430）。"
       "哨所是 art-v7 的那座（D-121 敵臺門洞），照它的 Blender 檔轉向重算圖，光照和其他建築一樣；牆頂的槍兵照圖上的站點畫。")
REF = ("參考做法（只參考做法，不仿外觀）：AoE2 DE 的城門放的時候可以轉（預設按住 Ctrl 轉滾輪），貼著城牆時自動對齊牆；城門有橫、直和兩個斜的。"
       "AoE4 大部分建築不能轉，城門和牆塔會貼著牆自動對齊。我們一樣：先照地形自動轉，再讓玩家自己轉。")


def font(size, bold=True):
    return ImageFont.truetype(BOLD if bold else REG, size, index=3)


def check_glyphs():
    f = font(40)

    def ink(ch):
        im = Image.new("L", (80, 80), 0)
        ImageDraw.Draw(im).text((10, 5), ch, font=f, fill=255)
        return im

    tofu = ink("")
    bad = sorted({ch for t in TEXTS for ch in t if not ch.isspace() and ImageChops.difference(ink(ch), tofu).getbbox() is None})
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


def text_cell(w, h, items):
    im = Image.new("RGB", (w, h), CELL)
    draw_lines(ImageDraw.Draw(im), 24, 20, lines_of(items, w - 48), lead=14)
    return im


def board(title, head, rows, foot, width):
    """rows: [(row label or None, [(cell label, colour, image), ...])]."""
    hl = lines_of([(title, 54, INK, True)] + head, width - 2 * GAP)
    fl = lines_of(foot, width - 2 * GAP)
    plan = []
    for label, cells in rows:
        labs = [lines_of([(c[0], 28, c[1], True)], c[2].width) if c[0] else [] for c in cells]
        plan.append((label, cells, labs, max((height_of(x, 10) for x in labs), default=0)))
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
            img.paste(im.convert("RGB"), (x, y + lh))
            x += im.width + GAP
        y += lh + max(c[2].height for c in cells) + GAP
    draw_lines(d, GAP, y, fl)
    return img


def save(img, path):
    check_glyphs()
    TEXTS.clear()
    img.save(path)
    print(path.name, img.size)


def boxed(img, rects, k, pad=6):
    """Yellow boxes round what R27 adds (rects in CSS px, k the screen's px a CSS px)."""
    d = ImageDraw.Draw(img)
    for r in rects:
        if r is None:
            continue
        x, y, w, h = (v * k for v in r)
        d.rounded_rectangle((x - pad, y - pad, x + w + pad, y + h + pad), radius=10, outline=YEL + (255,), width=max(3, round(2 * k)))
    return img


def facing_pair(scene, yaw, w=1300, h=780, inset=None):
    """East and West at `scene` facing `yaw`, cropped round the outpost; inset: another yaw small in the corner."""
    out = []
    for c in ("E", "W"):
        im, ctr = C.shot(scene, c, yaw)
        cr, _ = C.crop_round(im, ctr)
        cr = cr.resize((w, h), Image.LANCZOS)
        if inset is not None:
            im2, ctr2 = C.shot(scene, c, inset, show_arrow=False)
            cr2, _ = C.crop_round(im2, ctr2, 1100, 660)
            cr2 = cr2.resize((w // 3, round(h / 3)), Image.LANCZOS)
            box = Image.new("RGBA", (cr2.width + 8, cr2.height + 8), (24, 26, 30, 255))
            box.paste(cr2, (4, 4))
            cr.paste(box, (w - box.width - 10, h - box.height - 10))
        out.append(cr)
    return out


SCENE_TEXT = {k: v["what"] for k, v in C.SCENES.items()}


# --- item 1: the facings -------------------------------------------------------------------------------------------

LOOKS = [
    # (file, title, axis words, rows [(row label, scene, yaw, inset yaw)], what for)
    ("R27-01-方向-AB-南北向-phone", "南北向：路南北穿過，牆擋在東西兩邊（A、B 都有）",
     [("橋頭（北邊的河，橋 3 格寬）：牆橫跨橋頭", "bridge", 270, 90), ("岩脊缺口（缺 3 格）：牆把缺口補起來", "ridge", 90, 270)]),
    ("R27-01-方向-AB-東西向-phone", "東西向：路東西穿過，牆擋在南北兩邊（A、B 都有；現在的哨所就是這個方向）",
     [("兩山之間（兩道懸崖夾出的山谷，東口）：牆橫跨谷口", "mouth", 0, 180)]),
    ("R27-01-方向-B-斜向西北東南-phone", "斜向（西北—東南）：只有 B 有。牆在畫面上是橫的",
     [("空曠地：北邊玩家的主城在左上，背對主城就是朝東南", "openSE", 315, 135)]),
    ("R27-01-方向-B-斜向東北西南-phone", "斜向（東北—西南）：只有 B 有。牆在畫面上是直的",
     [("空曠地：南邊玩家的主城在左下，背對主城就是朝東北", "openNE", 45, 225)]),
]


def look_board(out, name, title, rows):
    lines = [
        ("每一列左邊東陸、右邊西陸。淡黃格子＝擋路的 3×3，只有外觀轉，擋路照舊。金色箭頭＝路從門洞穿過的方向。", 28, GOLD, True),
        ("右下角的小圖：同一個位置轉 180°。門洞前後兩面一樣，只差旗子插在哪個角，所以 A 的四個方向只有兩種樣子，B 的八個方向只有四種樣子。", 26, GREY, False),
        (SRC, 22, DIM, False),
    ]
    rr = []
    for label, scene, yaw, inset in rows:
        e, w = facing_pair(scene, yaw, inset=inset)
        rr.append((label, [("東陸", INK, e), ("西陸", INK, w)]))
    W = 2 * 1300 + 3 * GAP
    img = board(name, [(title, 34, INK, True)] + lines, rr, [(REF, 22, DIM, False)], W)
    save(img, out / f"{name}.png")


def enemy_by_corner(culture, yaw, fit):
    """A soldier of the other side just outside the footprint (0.6 m past its east edge) where the turned outpost's corner
    reaches (3.68 m from the middle unfitted: 6 x 4.4 m at 45 degrees)."""
    def draw(img, centre, ppx):
        # grid metres from the middle: the corner at (3.68, -0.57) for yaw 315 (along NE-SW 3 m, across 2.2 m)
        gx, gy = 3.6, -0.55
        sc = C.SCENES["openSE"]
        k = sc["dpr"]
        cx = (sc["centre"]["x"]) * k
        cy = (sc["centre"]["y"]) * k
        ex = ((sc["east"]["x"] - sc["centre"]["x"]) * k, (sc["east"]["y"] - sc["centre"]["y"]) * k)
        sy = ((sc["south"]["x"] - sc["centre"]["x"]) * k, (sc["south"]["y"] - sc["centre"]["y"]) * k)
        x = cx + (gx / 2) * ex[0] + (gy / 2) * sy[0]
        y = cy + (gx / 2) * ex[1] + (gy / 2) * sy[1]
        unit = "pike_w" if culture == "E" else "spear_e"
        f = C.facing_of(cx - x, cy - y)
        im, anc, upm = C.unit_frame(unit, "idle", f, 0, C.RED)
        C.paste_scaled(img, im, (x, y), anc, ppx / upm)
        d = ImageDraw.Draw(img)
        r = 0.42 * ppx
        d.ellipse((x - r, y - r * 0.5, x + r, y + r * 0.5), outline=(255, 90, 80, 255), width=4)
    return draw


def fit_board(out):
    name = "R27-01-方向-B-斜放對照-phone"
    rows = []
    for c, cn in (("E", "東陸"), ("W", "西陸")):
        cells = []
        for fit in (False, True):
            im, ctr = C.shot("openSE", c, 315, fit=fit, extra=enemy_by_corner(c, 315, fit), show_arrow=False)
            cr, _ = C.crop_round(im, ctr, 1300, 820, 0.55)
            cells.append(("原尺寸（四個角凸出 3×3 約三分之一格）" if not fit else "縮小（長寬縮到 82%，整座塞進 3×3）", INK, cr))
        rows.append((cn, cells))
    W = 2 * 1300 + 3 * GAP
    head = [
        ("要你選：B 的斜向哨所，照原尺寸畫，還是縮小塞進 3×3。兩種擋路都是 3×3，只差畫面。", 34, INK, True),
        ("紅圈的敵兵站在 3×3 外面一點點（離邊 0.6 公尺）。左邊原尺寸：畫面上像站進牆角，其實沒擋到他、他也沒卡住；右邊縮小：牆在格子裡，看得出他在外面。", 28, GOLD, True),
        ("ui 推薦縮小：哨所畫面和擋路一樣大，玩家看到的就是擋得到的，不會以為牆角擋住了路或兵卡在牆裡。代價是斜放的哨所看起來比正放的小一點。", 28, GREEN, True),
        (SRC, 22, DIM, False),
    ]
    img = board(name, head, rows, [("縮小的比例：6×4.4 公尺的哨所轉 45° 要 7.4 公尺寬，3×3 只有 6 公尺，所以長寬乘 0.82（高度不變）。", 22, DIM, False)], W)
    save(img, out / f"{name}.png")


# --- item 2: placing it, and turning it once built ------------------------------------------------------------------

def frame(scene, hud_png, yaw, ghost=None, crew=0, boxes=(), culture="E"):
    """A whole screen: the battlefield of `scene` with the outpost (a preview when `ghost`), the interface over it."""
    im, _ = C.shot(scene, culture, yaw, ghost=ghost, crew=crew, grid=False, show_arrow=False, outline=False)
    hud = Image.open(HUD / hud_png).convert("RGBA")
    if hud.size != im.size:
        hud = hud.resize(im.size, Image.LANCZOS)
    im.alpha_composite(hud)
    k = C.SCENES[scene]["dpr"]
    return boxed(im, boxes, k)


def ui_boards(out):
    meta = json.loads((HUD / "hud.json").read_text())
    app, saf, desk = meta["app"], meta["safari"], meta["desk"]
    # phone: the app full screen; the frames at half size
    s = 0.5
    sm = lambda im: im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)  # noqa: E731
    p1 = sm(frame("ui-app", "hud-app-place-auto.png", 270, ghost=0.62, boxes=app["new"]))
    p2 = sm(frame("ui-app", "hud-app-place-turned.png", 0, ghost=0.62, boxes=app["new"]))
    p3 = sm(frame("ui-app", "hud-app-plain.png", 0))
    p4 = sm(frame("ui-appUp", "hud-app-panel.png", 0, boxes=[app["turnBtn"]]))
    p5 = sm(frame("ui-appUp", "hud-app-panel-turned.png", 270, boxes=[app["turnBtn"]]))
    p6 = sm(frame("ui-safari", "hud-safari-place-auto.png", 270, ghost=0.62, boxes=saf["new"]))
    W = 2 * p1.width + 3 * GAP
    head = [
        ("放哨所時多一顆「旋轉」，蓋好以後點哨所，面板多一顆「轉向」（黃框是新加的）。", 32, INK, True),
        ("放下去時先照地形自動轉好：預覽下面寫「自動」和原因（例如擋住橋頭）。按「旋轉」每次轉 90°（選 B 時 45°），標籤變成「轉過」；轉一圈回到自動的方向，標籤又變回「自動」。", 26, GOLD, False),
        ("「旋轉」放在 ✓ ✗ 旁邊，跟著預覽走，大小和 ✓ ✗ 一樣。蓋好以後按「轉向」馬上轉好、不花錢、牆頂的兵照站；訊息條說「已轉向」。", 26, GREY, False),
        (SRC, 22, DIM, False),
    ]
    rows = [
        ("放的時候", [("① 剛放下：自動轉好（橋頭：路南北穿過）", INK, p1), ("② 按了「旋轉」：轉 90°", INK, p2)]),
        (None, [("③ 按 ✓ 蓋下去：照轉好的方向蓋", INK, p3), ("Safari 有網址列時（932×336）：「旋轉」一樣在 ✓ ✗ 旁邊", INK, p6)]),
        ("蓋好以後", [("④ 點自己的哨所：面板多一顆「轉向」", INK, p4), ("⑤ 按了「轉向」：轉 90°，訊息條「已轉向」", INK, p5)]),
    ]
    img = board("R27-02-放哨所介面-phone", head, rows, [("iPhone 14 Pro Max 橫放；安全區照實機（左右 59、下 21）。預覽是半透明的哨所加上綠色的 3×3，照遊戲現在放建築的樣子。", 22, DIM, False)], W)
    save(img, out / "R27-02-放哨所介面-phone.png")

    # desktop: 1920 x 950 (interface 1.5x), a mouse
    s = 0.72
    sm = lambda im: im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)  # noqa: E731
    d1 = sm(frame("ui-desk", "hud-desk-place-auto.png", 270, ghost=0.62, boxes=desk["new"]))
    d2 = sm(frame("ui-desk", "hud-desk-place-turned.png", 0, ghost=0.62, boxes=desk["new"]))
    d3 = sm(frame("ui-desk", "hud-desk-panel.png", 0, boxes=[desk["turnBtn"]]))
    d4 = sm(frame("ui-desk", "hud-desk-panel-turned.png", 270, boxes=[desk["turnBtn"]]))
    W = 2 * d1.width + 3 * GAP
    head = [
        ("電腦版一樣多「旋轉」和「轉向」兩顆，兩顆都用 R 鍵，按鈕右上角標 R。", 32, INK, True),
        ("建議用 R：放的時候是「旋轉」、蓋好以後是「轉向」，同一件事同一個鍵，跟 AoE2 放城門時轉方向的習慣一樣（它是 Ctrl＋滾輪）。滾輪照舊是縮放，不拿來轉。", 26, GOLD, False),
        ("放的時候建造選單已經收起，指令區沒有用到 R（R26 02 的位置鍵），不會撞；選了哨所時 R 也沒有別的用途。", 26, GREY, False),
        ("畫在真畫面上：1920×950 的瀏覽器視窗、用滑鼠，介面放大 1.5 倍（R26 01），戰場拉近到 2 倍方便看。", 22, DIM, False),
    ]
    rows = [
        ("放的時候", [("① 剛放下：自動轉好，「旋轉」標 R", INK, d1), ("② 按了「旋轉」或 R：轉 90°", INK, d2)]),
        ("蓋好以後", [("③ 點自己的哨所：面板多「轉向」，標 R", INK, d3), ("④ 按了「轉向」或 R：轉 90°，訊息條「已轉向」", INK, d4)]),
    ]
    img = board("R27-02-放哨所介面-desktop", head, rows, [], W)
    save(img, out / "R27-02-放哨所介面-desktop.png")
