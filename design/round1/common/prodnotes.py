"""量產說明: full-production asset counts, runtime texture memory, and the card image.

Counts follow the brief: two cultures x 6 units x 4 actions x 8 directions, about
13 buildings per culture, towns in four states, two terrains; player colour by
program. Frame counts per action are this round's working assumption (marked 估計).
"""
import html
from pathlib import Path

import config

# frames per direction for one unit (估計: RTS norms at 12 fps)
FRAMES = {"idle": 8, "walk": 8, "attack": 10, "death": 10}
MAGE_FRAMES_DIR = 12 + 12 + 30 + 26          # this round's real mage sequence
FARMER_EXTRA = 4 * 8                         # chop, mine, farm, build
UNITS_PER_CULTURE = 6
CULTURES = 2
DIRS = 8
DIRS_UNIQUE = 5                              # 3 of 8 mirrored


def unit_frames(unique=True):
    per_dir = (UNITS_PER_CULTURE - 1) * sum(FRAMES.values()) + MAGE_FRAMES_DIR + FARMER_EXTRA
    return per_dir * CULTURES * (DIRS_UNIQUE if unique else DIRS)


def clips():
    return CULTURES * UNITS_PER_CULTURE * 4 * DIRS


BUILDINGS = 13 * CULTURES * 3      # construction, finished, damaged
TOWN_IMAGES = CULTURES * 2 * 3     # small/large x (neutral, ruin, governed-with-flag-slot)
TERRAIN = CULTURES * 35            # ground tiles, decals, trees, resources


def memory_table(unit_px, building_px):
    """unit_px / building_px: average trimmed sprite area in pixels at 3x (measured)."""
    uf = unit_frames(True)
    rows = []
    for name, scale, bpp in [("3 倍、未壓縮 RGBA", 1.0, 32), ("2 倍、未壓縮 RGBA", 4 / 9, 32),
                             ("2 倍、ASTC 4×4 壓縮", 4 / 9, 8)]:
        u = uf * unit_px * scale * bpp / 8 / 2 ** 20
        mask = uf * unit_px * scale * (8 if bpp == 32 else 2) / 8 / 2 ** 20
        b = (BUILDINGS + TOWN_IMAGES) * building_px * scale * bpp / 8 / 2 ** 20
        rows.append((name, u, mask, b, u + mask + b))
    return rows


def card_html(label, sections, verdict_rows):
    css = """
    body { margin: 0; background: #f4f1ea; font-family: 'Noto Sans CJK TC', sans-serif; color: #1e1e22;
           width: 1400px; }
    .wrap { padding: 36px 44px 40px; }
    h1 { font-size: 34px; margin: 0 0 6px; }
    .sub { color: #6e6e6e; font-size: 18px; margin-bottom: 22px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px 26px; }
    .box { background: #fff; border: 1px solid #ddd6c8; border-radius: 8px; padding: 14px 18px; }
    .box h2 { font-size: 20px; margin: 0 0 8px; }
    .box ul { margin: 0; padding-left: 20px; font-size: 16px; line-height: 1.55; }
    table { border-collapse: collapse; font-size: 15px; width: 100%; }
    td, th { border-bottom: 1px solid #e6e0d4; padding: 4px 6px; text-align: left; }
    th { color: #555; font-weight: 600; }
    .g { color: #2e8c46; } .r { color: #c8281f; } .n { color: #6e6e6e; }
    .full { grid-column: 1 / span 2; }
    """
    parts = [f"<!doctype html><html lang='zh-Hant'><head><meta charset='utf-8'><style>{css}</style></head><body>"
             f"<div class='wrap'><h1>{html.escape(label)}</h1>"]
    parts.append(f"<div class='sub'>{html.escape(sections['sub'])}</div><div class='grid'>")
    for title, body, full in sections["boxes"]:
        cls = "box full" if full else "box"
        parts.append(f"<div class='{cls}'><h2>{html.escape(title)}</h2>{body}</div>")
    rows = "".join(f"<li class='{c}'>{html.escape(t)}</li>" for t, c in verdict_rows)
    parts.append(f"<div class='box full'><h2>東西兩套放在同一個戰場：評估</h2><ul>{rows}</ul></div>")
    parts.append("</div></div></body></html>")
    return "".join(parts)


def ul(items):
    out = []
    for it in items:
        if isinstance(it, tuple):
            t, c = it
            out.append(f"<li class='{c}'>{html.escape(t)}</li>")
        else:
            out.append(f"<li>{html.escape(it)}</li>")
    return "<ul>" + "".join(out) + "</ul>"


def table(head, rows):
    h = "".join(f"<th>{html.escape(x)}</th>" for x in head)
    body = "".join("<tr>" + "".join(f"<td>{html.escape(str(c))}</td>" for c in r) + "</tr>" for r in rows)
    return f"<table><tr>{h}</tr>{body}</table>"


def render_card(label, sections, verdict_rows, out_png, height=2400):
    work = config.BUILD / "cards"
    work.mkdir(parents=True, exist_ok=True)
    page = work / f"{label}.html"
    page.write_text(card_html(label, sections, verdict_rows))
    config.chrome_screenshot(page, out_png, w=1400, h=height, scale=2)
    # trim the empty bottom
    from PIL import Image
    im = Image.open(out_png).convert("RGB")
    bg = im.getpixel((2, im.height - 2))
    y = im.height - 1
    px = im.load()
    while y > 200 and all(px[x, y] == bg for x in range(0, im.width, 7)):
        y -= 1
    im.crop((0, 0, im.width, min(im.height, y + 40))).save(out_png)
    return out_png


def write_md(path, label, sections, verdict_rows, md_extra=""):
    """Plain-text version of the card for the repo (same content)."""
    import re
    lines = [f"# {label}", "", sections["sub"], ""]
    for title, body, _ in sections["boxes"]:
        lines.append(f"## {title}")
        lines.append("")
        text = re.sub(r"<tr>", "\n", body)
        text = re.sub(r"</t[dh]>", " | ", text)
        text = re.sub(r"<li[^>]*>", "\n- ", text)
        text = re.sub(r"<[^>]+>", "", text)
        lines.append(html.unescape(text).strip())
        lines.append("")
    lines.append("## 東西兩套放在同一個戰場：評估")
    lines.append("")
    for t, c in verdict_rows:
        tag = {"g": "（通過）", "r": "（問題）", "n": "（備註）"}[c]
        lines.append(f"- {tag} {t}")
    lines.append("")
    lines.append(md_extra)
    Path(path).write_text("\n".join(lines))
    return path
