"""R6: the interface spec for client (design/r6/spec.md), from the same sources as the boards: the layout measured from
the mock (build/layout.json, layout.mjs), the rules on the boards (mock/boards.js), the animations (anim.py), the colour
tokens (mock/themes.css). Every rule names its board.

python3 common/spec.py
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import anim  # noqa: E402

R6 = HERE.parent


def tokens(theme):
    css = (R6 / "mock" / "themes.css").read_text()
    block = re.search(r'\[data-theme="%s"\] \{([^}]*)\}' % theme, css).group(1)
    return [(k.strip(), v.strip()) for k, v in re.findall(r"(--[\w-]+):\s*([^;]+);", block) if "url(" not in v]


def rules_html_to_md(h):
    h = re.sub(r"<h2>.*?</h2>", "", h)
    rows = re.findall(r"<tr>(.*?)</tr>", h, re.S)
    out = []
    for i, r in enumerate(rows):
        cells = [re.sub(r"<[^>]+>", "", c).strip() for c in re.findall(r"<t[hd]>(.*?)</t[hd]>", r, re.S)]
        out.append("| " + " | ".join(cells) + " |")
        if i == 0:
            out.append("|" + "---|" * len(cells))
    for li in re.findall(r"<li>(.*?)</li>", h, re.S):
        out.append("- " + re.sub(r"<[^>]+>", "", li).strip())
    gap = re.search(r'<p class="gap">(.*?)</p>', h)
    if gap:
        out.insert(len(rows) + 1 if rows else 0, "\n**" + re.sub(r"<[^>]+>", "", gap.group(1)) + "**\n")
    return "\n".join(out)


def boards():
    """The boards as data (coverage.mjs writes build/boards.json from mock/boards.js)."""
    data = json.loads((R6 / "build" / "boards.json").read_text())
    return {k: (v["name"], v["sub"] + ("\n\n涵蓋：" + "、".join(v["inv"]) if v["inv"] else ""), rules_html_to_md(v["rules"]) if v["rules"] else "")
            for k, v in data.items()}


def main():
    lay = json.loads((R6 / "build" / "layout.json").read_text())
    b = boards()
    L = ["# R6 正式介面規格（給 client）", "",
         "- 依據：R6 brief B（D-085）、使用者的選擇 D-087：風格 A 銅木（預設）和 B 墨漆金線都做，設定裡可以切換；左邊「需要時才出現」；小地圖菱形。",
         "- 這份規格和設計稿（`design/r6/out/`）一起看。**設計稿經使用者核准後，就是實作的規格和 QA 對照的基準**；文字和圖不一樣時，以圖為準，並回報 ui 改規格。",
         "- 每條規則後面寫設計稿編號。位置數字是從畫設計稿的 mock 量出來的（`common/layout.mjs`），不是另外打的。",
         "- 畫面：814×380 pt（iPhone 14 Pro Max 橫向，扣掉安全區）。表裡的 x、y 從左上角算；「右」「下」是到右邊、下面的距離（再加上安全區）。", "",
         "## 1. 共通", "",
         "- **手指要點的東西至少 44×44 pt**。設計稿每一格都用程式檢查過（`common/shoot-boards.mjs`）。",
         "- **字**：iPhone 內建的字（PingFang TC），只用兩種粗細：一般 400、粗 700。不把字型放進遊戲（ceo 2026-10-18）。",
         "- **按鈕的四種狀態**（R6-40）：一般、按下（手指碰到就換，放開 120 ms 回來）、亮著（選中、開著）、不能按（灰，按不下去；建造選單寫原因，例如「要先蓋 兵營」）。",
         "- **顏色的意思**：進攻都是紅、撤退都是藍（D-080），堅守是金；主要按鈕金色、一般按鈕木色（A）或墨色（B）。",
         "- **戰場維持菱形**（斜 45 度，D-085）：使用者 2026-10-18 看過 R6-04 的方形「甲 方形斜看」「乙 正上方俯視」後選的。小地圖改成方形（使用者 2026-10-19：「小地圖用正方形」，取代 D-087 的菱形）：地圖照格子畫，鏡頭框是斜的。",
         "- **選取資訊比原型高約 30 pt**（171 pt）：收起、×、兵種鈕都改成 44 pt，戰場少露出這一條。是為了 44 pt 規則刻意換的。",
         "- **兩種風格只換樣子，排版完全一樣**（R6-41、R6-42、R6-43）。切換在 選單 → 設定 → 介面風格（R6-20），馬上生效，存在這支手機上。",
         "- **拿掉的**：INV-16「原型介面」標示；左邊的重設鈕（D-087，見第 4 節）。INV-128 量測面板照舊（開發者用，不改樣式）。",
         "- **玩家色**（R6-24，使用者 2026-10-18 選「甲 藍紅黃紫」）：藍 #3f7fe0、紅 #d9433a、黃 #e8c42e、紫 #9a5ce0，中立 #d8d2c0。"
         "1 對 1 時我方藍、敵方紅。士兵和建築照圖集的做法（玩家色層乘上顏色）；小地圖上單位的點比建築淺一階。", "",
         "## 2. 位置（從 mock 量的，風格 A；B 一樣）", "", "| 元件 | 狀態 | x | y | 寬 | 高 | 到右邊 | 到下面 |", "|---|---|---|---|---|---|---|---|"]
    for r in lay:
        L.append(f"| {r['name']} | {r['state']} | {r['x']} | {r['y']} | {r['w']} | {r['h']} | {r['right']} | {r['bottom']} |")
    L += ["", "## 3. 每張設計稿", ""]
    order = ["R6-10", "R6-11", "R6-12", "R6-13", "R6-14", "R6-15", "R6-16", "R6-17", "R6-18", "R6-19", "R6-20", "R6-21", "R6-22", "R6-23", "R6-23b", "R6-24", "R6-30", "R6-40", "R6-41", "R6-42", "R6-43"]
    for bid in order:
        if bid == "R6-24":
            L += ["### R6-24 玩家色", "", "使用者選「甲 藍紅黃紫」（2026-10-18）。色差（CIEDE2000，程式算）：兩兩最小 21.7（藍–紫），和保留色最小 24.9（紅–預警橘）。", ""]
            continue
        if bid not in b:
            continue
        name, sub, rules = b[bid]
        L += [f"### {bid} {name}", "", sub, ""]
        if rules:
            L += [rules, ""]
    L += ["## 4. 重設拿掉以後（R6-30）", "", "見上面 R6-30 的表。重點：", "",
          "- 選取資訊的 × 改成「回到什麼都沒選」：取消選取、離開選位置、收掉建築預覽和輪盤、關建造選單。",
          "- 放建築的提示列加「取消」。", "",
          "## 5. 動畫（R6-25，分鏡和 GIF）", "", "| 編號 | 動畫 | 時間 | 減少動態效果時 |", "|---|---|---|---|"]
    for aid, name, _, _, fr, note, reduced in anim.ANIMS:
        L.append(f"| R6-25-{aid} | {name} | {note} | {reduced} |")
    L += ["", "## 6. 顏色（themes.css 的變數）", ""]
    for th, nm in (("a", "A 銅木"), ("b", "B 墨漆金線")):
        L += [f"**{nm}**：" + "、".join(f"`{k}` {v}" for k, v in tokens(th)), ""]
    L += ["其他固定的顏色（兩種風格一樣）：血條 #78d05f、防護罩 #5fe3f0、建造進度 #e7c35a、被攻擊 #ce3a2e、預警圈 #ff7026（B1b-03）、選取 #fff3b0、訊息條底 rgba(90,28,24,.94)。", ""]
    (R6 / "spec.md").write_text("\n".join(L) + "\n")
    print("wrote spec.md", len(L), "lines")


if __name__ == "__main__":
    main()
