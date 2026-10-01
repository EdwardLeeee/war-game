"""Automated checks and a contact sheet for one unit's production renders.

python3 common/checks.py --target farmer_e [--preview]
-> build/prod/<unit>/report/<unit>_report.json, <unit>_report.md, <unit>_contact.png
Exit code 1 when a hard check fails (missing frame, clipped colour, empty frame, anchor drift).

Hard checks: every frame and pass exists; the colour layer never touches the frame edge; no
empty frame; one anchor and one size for the whole unit. Mages: every shield frame exists, is not
empty and stays inside the frame, and the effect layer of idle, walk and hit is empty (the shield
has its own layer since atlas format 2; left in the effect layer it would be drawn twice).
Warnings: shadow or effect layer at the frame edge (effects such as the flying bolt should
become separate projectile sprites), very little player colour in a frame.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(1, str(HERE.parents[1] / "round1" / "common"))
import compose  # noqa: E402  (round1: recolor, shadows)
import config   # noqa: E402
import spec     # noqa: E402

TEAM_BLUE = config.TEAM["blue"]
MIN_TEAM_SHARE = 0.01          # player colour below 1% of the figure's pixels -> warning


def _alpha_bbox(im, thr=8):
    return im.getchannel("A").point(lambda v: 255 if v > thr else 0).getbbox()


def _touches(bb, size):
    return bb is not None and (bb[0] <= 0 or bb[1] <= 0 or bb[2] >= size[0] or bb[3] >= size[1])


def check(target, preview=False, facings=None):
    u = spec.UNITS[target]
    raw = config.BUILD / "prod" / target / "raw"
    errors, warnings = [], []
    anchors, sizes, areas = set(), set(), []
    team_min = (1.0, None)
    mage = u["kind"].startswith("mage")
    n_images = 0
    for name, n, _, _ in u["anims"]:
        frames = [0] if preview else range(n)
        for f in (facings or spec.ALL_FACINGS):
            passes = spec.MIRROR_PASSES if f in spec.MIRRORED else (spec.MAGE_PASSES if mage else spec.PASSES)
            for i in frames:
                base = spec.frame_name(target, name, f, i)
                meta_p = raw / f"{base}_x3.json"
                if not meta_p.exists():
                    errors.append(f"缺影格：{base}")
                    continue
                meta = json.loads(meta_p.read_text())
                anchors.add(tuple(round(v, 2) for v in meta["anchor"]))
                for p in passes:
                    fp = raw / f"{base}_x3_{p}.png"
                    if not fp.exists():
                        errors.append(f"缺圖層：{base} {p}")
                        continue
                    n_images += 1
                    im = Image.open(fp)
                    if p == "beauty":
                        sizes.add(im.size)
                        bb = _alpha_bbox(im)
                        if bb is None:
                            errors.append(f"空白影格：{base}")
                            continue
                        if _touches(bb, im.size):
                            errors.append(f"本體被畫框切到：{base} {bb} / {im.size}")
                        areas.append((bb[2] - bb[0]) * (bb[3] - bb[1]))
                        a = np.asarray(im.getchannel("A")) > 8
                        m = np.asarray(Image.open(raw / f"{base}_x3_mask.png").convert("L")) > 128
                        share = float((m & a).sum()) / max(1, a.sum())
                        if share < team_min[0]:
                            team_min = (share, base)
                    elif p == "fx" and name in ("idle", "walk", "hit") and _alpha_bbox(im) is not None:
                        errors.append(f"特效層不該有東西（防護罩已拆成單獨一層）：{base}")
                    elif p in ("shadow", "fx") and _touches(_alpha_bbox(im, 40 if p == "shadow" else 8), im.size):
                        warnings.append(f"{'影子' if p == 'shadow' else '特效'}碰到畫框：{base}")
    shield_frames = 0
    if mage and not preview:
        for a, n in spec.SHIELD_ANIMS:
            for i in range(n):
                base = f"{target}_shield_{a}_{i:02d}"
                meta_p, fp = raw / f"{base}_x3.json", raw / f"{base}_x3_shield.png"
                if not meta_p.exists() or not fp.exists():
                    errors.append(f"缺防護罩影格：{base}")
                    continue
                anchors.add(tuple(round(v, 2) for v in json.loads(meta_p.read_text())["anchor"]))
                im = Image.open(fp)
                n_images += 1
                shield_frames += 1
                sizes.add(im.size)
                bb = _alpha_bbox(im)
                if bb is None:
                    errors.append(f"空白防護罩：{base}")
                elif _touches(bb, im.size):
                    errors.append(f"防護罩被畫框切到：{base} {bb} / {im.size}")
    if len(anchors) > 1:
        errors.append(f"錨點不一致：{sorted(anchors)[:4]}")
    if len(sizes) > 1:
        errors.append(f"影格大小不一致：{sorted(sizes)}")
    if team_min[1] and team_min[0] < MIN_TEAM_SHARE:
        warnings.append(f"玩家色太少：{team_min[1]} 只有 {team_min[0]:.1%}")
    ph = spec.placeholders(target)
    unique = sum(n for _, n, _, _ in u["anims"]) * (1 if preview else len(spec.RENDERED_FACINGS))
    stats_p = config.BUILD / "prod" / target / "render_stats.json"
    stats = json.loads(stats_p.read_text()) if stats_p.exists() else {}
    rep = dict(target=target, preview=preview, images=n_images, unique_frames=unique, shield_frames=shield_frames,
               mean_trimmed_px=round(float(np.mean(areas))) if areas else 0,
               min_team_share=round(team_min[0], 4), placeholders=ph, errors=errors,
               warnings=sorted(set(warnings))[:40], warnings_total=len(set(warnings)),
               render_seconds=stats.get("seconds"))
    out = config.BUILD / "prod" / target / "report"
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{target}_report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1))
    md = [f"# {target}", "",
          f"- 影格（不含鏡像）：{unique}；防護罩影格：{shield_frames}；圖層檔：{n_images}",
          f"- 算圖時間：{rep['render_seconds']} 秒",
          f"- 平均修邊面積（3 倍）：{rep['mean_trimmed_px']} px",
          f"- 玩家色最少的一格：{rep['min_team_share']:.1%}",
          f"- 還是替代動作（待補）：{'、'.join(ph) if ph else '無'}",
          f"- 錯誤：{len(errors)}", *[f"  - {e}" for e in errors[:20]],
          f"- 警告：{rep['warnings_total']}", *[f"  - {w}" for w in rep["warnings"][:20]]]
    (out / f"{target}_report.md").write_text("\n".join(md) + "\n")
    contact_sheet(target, out / f"{target}_contact.png", preview)
    print("\n".join(md))
    return not errors


def _sprite(raw, base, flip=False, shadow_base=None):
    """Colour with AO, blue player colour, and the facing's own shadow; flipped for mirrored facings."""
    b = compose.load(raw, f"{base}_x3", "beauty")
    img = b.img
    ao_p = raw / f"{base}_x3_ao.png"
    if ao_p.exists():
        ao = np.asarray(Image.open(ao_p).convert("L"), np.float32) / 255.0
        a = np.asarray(img, np.float32)
        a[..., :3] *= (0.7 + 0.3 * ao)[..., None]
        img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")
    img = compose.recolor(img, Image.open(raw / f"{base}_x3_mask.png"), TEAM_BLUE)
    ax, ay = b.anchor
    if flip:
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
        ax = img.width - ax
    sb = shadow_base or base
    sh = None
    if (raw / f"{sb}_x3_shadow.png").exists():
        sh = compose.load_shadow(raw, f"{sb}_x3", color=(26, 30, 48), strength=0.85)
    # align colour and shadow on the shared ground anchor (the shadow frame is larger, to the right and below)
    layers = [(img, ax, ay)] + ([(sh.img, sh.anchor[0], sh.anchor[1])] if sh else [])
    left = max(a for _, a, _ in layers)
    top = max(b_ for _, _, b_ in layers)
    right = max(im.width - a for im, a, _ in layers)          # extent right of / below the anchor
    bottom = max(im.height - b_ for im, _, b_ in layers)
    out = Image.new("RGBA", (int(left + right) + 1, int(top + bottom) + 1), (0, 0, 0, 0))
    if sh:
        out.alpha_composite(sh.img, (int(round(left - sh.anchor[0])), int(round(top - sh.anchor[1]))))
    out.alpha_composite(img, (int(round(left - ax)), int(round(top - ay))))
    return out, (left, top)


def contact_sheet(target, path, preview=False):
    """Rows: animations (middle frame); columns: all eight facings (3, 4, 5 flipped from 1, 0, 7)."""
    u = spec.UNITS[target]
    raw = config.BUILD / "prod" / target / "raw"
    cells = []
    for name, n, _, ph in u["anims"]:
        i = 0 if preview else n // 2
        row = []
        for f in spec.ALL_FACINGS:
            src = spec.MIRRORED.get(f, f)
            base = spec.frame_name(target, name, src, i)
            if not (raw / f"{base}_x3.json").exists():
                row.append(None)
                continue
            sb = spec.frame_name(target, name, f, i)
            row.append(_sprite(raw, base, flip=f in spec.MIRRORED, shadow_base=sb))
        cells.append((name, ph, row))
    ims = [c for _, _, row in cells for c in row if c]
    if not ims:
        return
    cw = max(im.width for im, _ in ims)
    ch = max(im.height for im, _ in ims)
    lw = 190
    W = lw + cw * len(spec.ALL_FACINGS)
    H = 40 + ch * len(cells)
    sheet = Image.new("RGB", (W, H), (118, 128, 104))
    dr = ImageDraw.Draw(sheet)
    for k, f in enumerate(spec.ALL_FACINGS):
        tag = f"f{f}" + (f" mirror of f{spec.MIRRORED[f]}" if f in spec.MIRRORED else "")   # ASCII: CI has no CJK font
        dr.text((lw + k * cw + 6, 10), tag, font=_font(18), fill=(250, 248, 240))
    for r, (name, ph, row) in enumerate(cells):
        y = 40 + r * ch
        dr.text((10, y + ch // 2 - 12), name + (" (placeholder)" if ph else ""), font=_font(18),
                fill=(255, 220, 120) if ph else (250, 248, 240))
        for k, cell in enumerate(row):
            if cell is None:
                continue
            im, _ = cell
            tile = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
            tile.alpha_composite(im, ((cw - im.width) // 2, (ch - im.height) // 2))
            sheet.paste(tile.convert("RGB"), (lw + k * cw, y), tile)
    sheet.save(path)


def _font(size):
    try:
        import artboard
        return artboard.font(size)
    except Exception:
        from PIL import ImageFont
        return ImageFont.load_default()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", required=True, choices=list(spec.UNITS))
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--facings", help="comma list (default: all eight)")
    a = ap.parse_args()
    sys.exit(0 if check(a.target, a.preview, [int(x) for x in a.facings.split(",")] if a.facings else None) else 1)
