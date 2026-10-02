"""The prototype's temporary Home Screen icon (D-042): a magic-crystal shard on a dark ground.

Writes public/icons/icon.svg and the PNGs made from the same shapes: icon-180.png (iPhone's
apple-touch-icon), icon-192.png and icon-512.png (the web app manifest). The real name and
icon come later (GDD section 16); this only makes the test page easy to open.

    python3 scripts/icons.py        (needs Pillow; the files are committed, CI does not run it)

Everything is drawn inside the middle 80 % of the square, so the 512 one also works as a
maskable icon (Android crops it to a circle or a rounded square).
"""

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 512
GROUND = "#10161a"
# Three faces of a cut shard, lightest on top; the cyan is the game's crystal colour.
FACES = [
    ("#7af0ff", [(256, 88), (168, 196), (168, 324), (256, 424)]),  # left face, lit
    ("#2fb7d4", [(256, 88), (344, 196), (344, 324), (256, 424)]),  # right face, in shade
    ("#c9fbff", [(256, 88), (168, 196), (256, 236), (344, 196)]),  # top facet
]
OUT = Path(__file__).resolve().parent.parent / "public" / "icons"


def svg() -> str:
    shapes = "\n".join(
        f'  <polygon points="{" ".join(f"{x},{y}" for x, y in pts)}" fill="{fill}"/>' for fill, pts in FACES
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}">\n'
        f'  <rect width="{SIZE}" height="{SIZE}" fill="{GROUND}"/>\n{shapes}\n</svg>\n'
    )


def png(px: int) -> Image.Image:
    """Drawn four times larger and scaled down, for smooth edges."""
    k = 4 * px / SIZE
    big = Image.new("RGB", (4 * px, 4 * px), GROUND)
    d = ImageDraw.Draw(big)
    for fill, pts in FACES:
        d.polygon([(x * k, y * k) for x, y in pts], fill=fill)
    return big.resize((px, px), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "icon.svg").write_text(svg())
    for px in (180, 192, 512):
        png(px).save(OUT / f"icon-{px}.png", optimize=True)
        print(f"icon-{px}.png")


if __name__ == "__main__":
    main()
