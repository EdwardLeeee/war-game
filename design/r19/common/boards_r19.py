"""R19 boards (the user 2026-11-10; ceo's brief: 兵種動作總檢查): a unit two pictures (one would be some 5000 x
10000 px: fitted to a window its words are too small to read). R19-NN-<unit>-phone: what was found (a card a finding:
its number, a sentence, a small picture with the place circled). R19-NN-<unit>-依據-phone: every action as the grounds:
  - on the phone: every frame, facing down-right, blue over red, a spearman beside for scale, on the pack's grass,
    through the iPhone's display path;
  - the same frames enlarged; the frame that hits in the other four rendered facings; how it joins the idle
    (the idle's first frame, the action's first and last); frames a finding circles that are not among those;
  - walking: the frames moved on as the game moves the unit, over ticks that stay on the ground: a foot on the
    ground should stay on its tick.
Circles and numbers are on the pictures; every sentence is outside them.

python3 design/r19/common/boards_r19.py ART_X3 OUT unit [unit ...]
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
import art_r19 as A            # noqa: E402
import findings_r19 as F       # noqa: E402

BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
BG = (24, 26, 30)
PANEL = (36, 39, 45)
YEL = (255, 214, 64)
WHITE, GREY, PALE = (240, 240, 240), (170, 170, 170), (250, 220, 140)
SEV = {3: "高", 2: "中", 1: "低"}
SEV_COL = {3: (255, 120, 100), 2: (255, 200, 90), 1: (170, 200, 230)}
MAIN, SIDE = 7, [0, 1, 2, 6]
TAG = "art-v7.8"
M = 28                                  # the board's margin


def font(size, bold=True):
    return ImageFont.truetype(BOLD if bold else REG, size, index=3)


def wrap(d, text, f, width):
    lines, cur = [], ""
    for ch in text:
        if d.textlength(cur + ch, font=f) > width and ch not in "。，、；：）」":      # no line begins with these
            keep = cur[-1] if cur[-1] in "（「" else ""                              # nor ends with these
            lines.append(cur[:len(cur) - len(keep)])
            cur = keep + ch
        else:
            cur += ch
    return lines + [cur] if cur else lines


TMP = ImageDraw.Draw(Image.new("RGB", (8, 8)))


def pad(box, p):
    return tuple(v + p for v in box)


def key_frame(info, anim):
    return info.get("hit", info.get("impact", 2 if anim == "walk" else 0))


class Board:
    def __init__(self, art, unit):
        self.art, self.unit = art, unit
        self.spec = F.UNITS[unit]
        self.u = A.Unit(art, unit)
        self.spear = A.Unit(art, "spear_e")
        self.n = self.spec["n"]
        self.bg = A.grass_colour(art)
        self._box = {}

    def anchor(self, anim):
        """Where inspect_r19.py's cell of the action has the anchor."""
        if anim not in self._box:
            l, t, _, _ = self.u.box(anim)
            self._box[anim] = (l + 4, t + 4)
        return self._box[anim]

    def marks(self, anim, face, k):
        out = []
        for f in self.spec["findings"]:
            for a, fc, fr, (x, y), r in f["marks"]:
                if (a, fc, fr) == (anim, face, k):
                    ax, ay = self.anchor(a)
                    out.append((f["id"], x - ax, y - ay, r))
        return out

    def cell(self, anim, face, k, box, n=None, team="blue", dx=0, ticks=0, marked=True):
        """A frame on the grass's colour, the box (l, t, r, b) around its anchor, n times, its findings circled.
        dx: the frame moved on this far; ticks: marks on the ground this far apart."""
        n = n or self.n
        l, t, r, b = box
        st = A.Stage(Image.new("RGB", (l + r, t + b), self.bg))
        st.put(self.u.sprite(anim, face, k, team), l + dx, t)
        im = st.render()
        if ticks:
            d = ImageDraw.Draw(im)
            for x in range(0, im.width, ticks):
                d.line([(x, t + 6), (x, t + (14 if x % (4 * ticks) else 20))], fill=(255, 255, 255), width=1)
        im = A.enlarge(im, n)
        d = ImageDraw.Draw(im)
        f = font(max(22, round(11 * n)))
        for mid, cx, cy, rr in (self.marks(anim, face, k) if marked else ()):
            x, y, q = (l + dx + cx) * n, (t + cy) * n, rr * n
            d.ellipse([x - q, y - q, x + q, y + q], outline=(20, 20, 20), width=max(5, round(2.6 * n)))
            d.ellipse([x - q, y - q, x + q, y + q], outline=YEL, width=max(3, round(1.4 * n)))
            s = str(mid)
            tw, th = d.textlength(s, font=f) + 14, f.size + 10
            tx = min(im.width - tw - 2, max(2, x + q * 0.6))
            ty = min(im.height - th - 2, max(2, y - q - th * 0.6))
            d.rounded_rectangle([tx, ty, tx + tw, ty + th], 6, fill=YEL, outline=(20, 20, 20), width=2)
            d.text((tx + 7, ty + 1), s, font=f, fill=(20, 20, 20))
        return im

    # ------------------------------------------------------------ the top: what was found

    def walk_box(self):
        """(the legs' box with room to walk a cycle to the right, px a frame across the screen): walkFps."""
        info = self.u.anims["walk"]
        n = info["frames"]
        step = info["stride_m"] * 60 / n if info.get("stride_m") else 120 / info["fps"]
        l, t, r, b = pad(self.u.box("walk", [0]), 6)
        return (l, min(t, 50), r + round(step * n), b), step

    def card(self, f, w):
        tag = f"{self.spec['tag']}-{f['id']}"
        ft, fb = font(34), font(27, False)
        lines = wrap(TMP, f["problem"], fb, w - 24 - fb.size)
        a, fc, fr, _, _ = f["marks"][0]
        l, t, r, b = pad(self.u.box(a, [fc], [fr]), 8)
        ax, ay = self.anchor(a)
        for a2, fc2, fr2, (x, y), q in f["marks"]:                 # room for its circles
            if (a2, fc2, fr2) == (a, fc, fr):
                l, t = max(l, q + 6 - (x - ax)), max(t, q + 6 - (y - ay))
                r, b = max(r, x - ax + q + 6), max(b, y - ay + q + 6)
        pic = self.cell(a, fc, fr, (l, t, r, b))
        k = min(1.0, (w - 24) / pic.width, 450 / pic.height)
        if k < 1:
            pic = pic.resize((round(pic.width * k), round(pic.height * k)), Image.LANCZOS)
        return tag, pic, lines, ft, fb

    def top(self, W):
        fs = sorted(self.spec["findings"], key=lambda f: (-f["sev"], f["id"]))
        cw = 600
        cards = [(f, *self.card(f, cw)) for f in fs]
        per = max(1, (W - 2 * M + 20) // (cw + 20))
        rows = [cards[i:i + per] for i in range(0, len(cards), per)]
        heights = [max(92 + len(c[3]) * 37 + 12 + c[2].height + 16 for c in row) for row in rows]
        img = Image.new("RGB", (W, sum(heights) + 20 * len(rows)), BG)
        d = ImageDraw.Draw(img)
        y = 0
        for row, h in zip(rows, heights):
            for i, (f, tag, pic, lines, ft, fb) in enumerate(row):
                x = M + i * (cw + 20)
                d.rounded_rectangle([x, y, x + cw, y + h], 10, fill=PANEL)
                d.text((x + 12, y + 6), tag, font=ft, fill=YEL)
                s = f"嚴重程度：{SEV[f['sev']]}"
                d.text((x + cw - 12 - d.textlength(s, font=fb), y + 12), s, font=fb, fill=SEV_COL[f["sev"]])
                d.text((x + 12, y + 52), "、".join(A.ANIM_NAME[a] for a in f["anims"]), font=fb, fill=GREY)
                yy = y + 92
                for ln in lines:
                    d.text((x + 12, yy), ln, font=fb, fill=WHITE)
                    yy += 37
                img.paste(pic, (x + 12, yy + 12))
            y += h + 20
        return img

    def checked(self, W):
        """What was looked at and is fine, a line each (the weapon's size beside a real one's)."""
        f, fh = font(27, False), font(32)
        lines = [ln for text in self.spec.get("checked", []) for ln in wrap(TMP, "・" + text, f, W - 2 * M - 30)]
        if not lines:
            return Image.new("RGB", (W, 1), BG)
        img = Image.new("RGB", (W, 60 + len(lines) * 38 + 10), BG)
        d = ImageDraw.Draw(img)
        d.text((M, 8), "看過、沒問題的", font=fh, fill=WHITE)
        y = 56
        for ln in lines:
            d.text((M + (0 if ln.startswith("・") else 27), y), ln, font=f, fill=(200, 200, 200))
            y += 38
        return img

    # ------------------------------------------------------------ an action

    def shield(self, anim, k):
        """The shield's frame the client draws over a mage's frame (unit-art-draw.ts drawShield), or None."""
        if not self.spec.get("shield"):
            return None
        if anim in ("idle", "walk", "attack", "cast"):
            return "on_00"
        if anim == "hit":
            return f"hit_{min(k, 5):02d}"
        if anim == "shatter" and k < 2:
            return f"break_{k:02d}"
        return None

    def on_phone(self, anim, yard=False, frames=None):
        n = frames or self.u.anims[anim]["frames"]
        l, t, r, b = pad(self.u.box(anim, [MAIN]), 4)
        if self.shield(anim, 0):                 # room for the shield's ball (about 100 x 115 px round the body)
            l, t, r = max(l, 58), max(t, 122), max(r, 58)
        sl, stp, sr, sb = pad(self.spear.box("idle", [MAIN], [0]), 4)
        T, B = max(t, stp), max(b, sb)
        cw = l + r
        st = A.Stage(A.grass(self.art, sl + sr + n * cw, 2 * (T + B), yard))
        for row, team in enumerate(("blue", "red")):
            y = row * (T + B) + T
            st.put(self.spear.sprite("idle", MAIN, 0, team), sl, y)
            for k in range(n):
                st.put(self.u.sprite(anim, MAIN, k, team, shield=self.shield(anim, k)), sl + sr + k * cw + l, y)
        return A.phone(st.render())

    def strip(self, cells, labels, gap=6):
        """Pictures side by side, a label over each (outside it)."""
        f = font(24, False)
        h = max(c.height for c in cells)
        ws = [max(c.width, round(TMP.textlength(s, font=f)) + 12) for c, s in zip(cells, labels)]
        img = Image.new("RGB", (sum(ws) + gap * (len(cells) - 1), h + 34), BG)
        d = ImageDraw.Draw(img)
        x = 0
        for c, s, w in zip(cells, labels, ws):
            d.text((x + 2, 0), s, font=f, fill=PALE if "打中" in s or "落地" in s else GREY)
            img.paste(c, (x, 34))
            x += w + gap
        return img

    def action(self, anim, W):
        info = self.u.anims[anim]
        n, key = info["frames"], key_frame(info, anim)
        fh, fb = font(36), font(27, False)
        what = "打中" if "hit" in info else "落地" if "impact" in info else ""
        head = f"{A.ANIM_NAME[anim]}　{n} 格、每秒 {info['fps']} 格" + ("、循環" if info.get("loop") else "、播一次") + (f"、第 {key + 1} 格{what}" if what else "")
        notes = []
        for f in self.spec["findings"]:
            if anim in f["anims"]:
                o = F.others(self.unit, f)
                same = f"（同 {o[0]}{' 等 ' + str(len(o)) + ' 個' if len(o) > 1 else ''}）" if o else ""
                notes.append((f"{self.spec['tag']}-{f['id']}{same}　{f['problem']}　建議：{f['fix']}　估工：{f['cost']}", SEV_COL[f["sev"]]))
        if not notes:
            notes.append(("沒挑到問題。", GREY))
        if anim in self.spec.get("notes", {}):
            notes.append((self.spec["notes"][anim], GREY))
        rows = []
        # the phone's size beside the enlarged frames
        box = pad(self.u.box(anim, [MAIN]), 6)
        phone = self.strip([self.on_phone(anim)], ["手機上的大小：上藍下紅，最左邊是槍兵" + ("；罩著護盾" if self.shield(anim, 0) else "")])
        if anim == "idle":                    # the player colours on packed earth too
            earth = self.strip([self.on_phone(anim, yard=True, frames=3)], ["在泥地上"])
            both = Image.new("RGB", (max(phone.width, earth.width), phone.height + 8 + earth.height), BG)
            both.paste(phone, (0, 0))
            both.paste(earth, (0, phone.height + 8))
            phone = both
        per = 10
        big = []
        for i in range(0, n, per):
            ks = list(range(i, min(n, i + per)))
            big.append(self.strip([self.cell(anim, MAIN, k, box) for k in ks],
                                  [f"第 {k + 1} 格" + (f"（{what}）" if what and k == key else "") for k in ks]))
        rows.append((phone, big))
        # the other facings, the join with the idle, the frames a finding circles elsewhere
        cells, labels = [], []
        sbox = pad(self.u.box(anim, SIDE, [key]), 6)
        for fc in SIDE:
            cells.append(self.cell(anim, fc, key, sbox))
            labels.append(f"{A.FACE_NAME[fc]}　第 {key + 1} 格")
        if anim != "idle":
            cells.append(self.cell("idle", MAIN, 0, pad(self.u.box("idle", [MAIN], [0]), 6), marked=False))
            labels.append("和待機接：待機第 1 格")
            for k, s in ((0, f"{A.ANIM_NAME[anim]}第 1 格"), (n - 1, f"{A.ANIM_NAME[anim]}最後 1 格")):
                cells.append(self.cell(anim, MAIN, k, pad(self.u.box(anim, [MAIN], [k]), 6)))
                labels.append(s)
        shown = {(MAIN, k) for k in range(n)} | {(fc, key) for fc in SIDE} | ({(0, k) for k in range(n)} if anim == "walk" else set())
        extra = sorted({(fc, fr) for f in self.spec["findings"] for a, fc, fr, _, _ in f["marks"] if a == anim} - shown)
        for fc, fr in extra:
            cells.append(self.cell(anim, fc, fr, pad(self.u.box(anim, [fc], [fr]), 6)))
            labels.append(f"{A.FACE_NAME[fc]}　第 {fr + 1} 格")
        second = [self.strip(cells, labels)]
        if anim == "walk":
            wbox, step = self.walk_box()
            ks = list(range(n + 1))
            second.append(self.strip([self.cell(anim, 0, k % n, wbox, n=2, dx=round(step * k), ticks=10) for k in ks],
                                     [f"第 {k % n + 1} 格" for k in ks]))
        # lay the block out
        d = TMP
        note_lines = [(ln, col) for text, col in notes for ln in wrap(d, text, fb, W - 2 * M - 20 - fb.size)]
        left_w = rows[0][0].width
        h = 50 + len(note_lines) * 38 + 14
        body_h = max(rows[0][0].height, sum(b.height + 8 for b in rows[0][1]))
        sec_h = sum(s.height + 8 for s in second) + (40 if anim == "walk" else 0)
        img = Image.new("RGB", (W, h + body_h + 10 + sec_h + 26), BG)
        d = ImageDraw.Draw(img)
        d.line([(M, 4), (W - M, 4)], fill=(70, 74, 82), width=2)
        d.text((M, 12), head, font=fh, fill=WHITE)
        y = 60
        for ln, col in note_lines:
            d.text((M + 10, y), ln, font=fb, fill=col)
            y += 38
        y = h
        img.paste(rows[0][0], (M, y))
        yy = y
        for b in rows[0][1]:
            img.paste(b, (M + left_w + 30, yy))
            yy += b.height + 8
        y += body_h + 10
        for i, s in enumerate(second):
            if i == 1:
                d.text((M, y + 2), "腳滑不滑（只看腿，放大 2 倍）：朝右走，每格照遊戲的速度往前移；白色短線釘在地上。踩在地上的那隻腳應該停在同一條線上。", font=fb, fill=PALE)
                y += 40
            img.paste(s, (M, y))
            y += s.height + 8
        return img

    def width(self):
        w = 0
        for anim, info in self.u.anims.items():
            l, t, r, b = pad(self.u.box(anim, [MAIN]), 6)
            n = min(10, info["frames"])
            w = max(w, self.on_phone(anim).width + 30 + n * ((l + r) * self.n + 6))
        return int(w) + 2 * M + 2

    def build(self, out):
        fs = self.spec["findings"]
        name, no = self.spec["name"], self.spec["no"]
        count = f"{name}：{len(self.u.anims)} 個動作，挑出 {len(fs)} 個問題（高 {sum(f['sev'] == 3 for f in fs)}、中 {sum(f['sev'] == 2 for f in fs)}、低 {sum(f['sev'] == 1 for f in fs)}）"
        clean = [A.ANIM_NAME[a] for a in self.u.anims if not any(a in f["anims"] for f in fs)]
        cards = self.sheet(out, f"R19-{no:02d}-{name}-phone", 2 * M + 4 * 600 + 3 * 20, [
            (count + "，最怪的排最前面。" + (f"沒挑到問題的動作：{'、'.join(clean)}。" if clean else ""), font(32), PALE),
            (f"圖是已發布的 {TAG}（main 現在釘的版本，手機上現在的樣子）放大 {self.n:g} 倍，沒有改任何東西；黃圈和數字是問題的位置。格數從 1 算起。建議的改法和估的工在總表（R19-13），每個動作每一格的排列在「R19-{no:02d}-{name}-依據-phone」。", font(26, False), GREY),
        ], lambda W: [self.top(W), self.checked(W)])
        grounds = self.sheet(out, f"R19-{no:02d}-{name}-依據-phone", max(self.width(), 2600), [
            (count + "。這張是依據：每個動作每一格都排出來，問題的位置圈起來、寫在那個動作的標題下面。", font(32), PALE),
            (f"圖是已發布的 {TAG}，格數從 1 算起。放大圖是原圖放大 {self.n:g} 倍；「手機上的大小」是手機截圖的像素（3 倍圖畫進像素比 2 的畫布、再放大到螢幕）。每個動作第二排：打中那一格的另外四個方向、和待機怎麼接、被圈到的其他格。", font(26, False), GREY),
        ], lambda W: [self.action(a, W) for a in self.u.anims])
        return cards, grounds

    def sheet(self, out, label, W, lines, parts):
        hd = []
        y = 16 + 78
        for text, f, col in lines:
            for ln in wrap(TMP, text, f, W - 2 * M):
                hd.append((ln, f, col, y))
                y += f.size + 14
        parts = parts(W)
        H = y + 16 + sum(p.height for p in parts) + M
        img = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(img)
        d.text((M, 16), label, font=font(56), fill=WHITE)
        for ln, f, col, yy in hd:
            d.text((M, yy), ln, font=f, fill=col)
        y += 16
        for p in parts:
            img.paste(p, (0, y))
            y += p.height
        path = out / f"{label}.png"
        img.save(path, optimize=True)
        return path.name, img.size


def main():
    art, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    for unit in sys.argv[3:]:
        for name, size in Board(art, unit).build(out):
            print(name, size)


if __name__ == "__main__":
    main()
