"""The app's temporary icon (D-163): the web app's crystal shard (client/scripts/icons.py, D-042),
drawn by the same code at 1024 × 1024 for the App Store and the Home Screen. Opaque (RGB, no
alpha) and square: iOS rounds the corners itself. The real icon comes later from ui.

    python3 scripts/icon.py     (needs Pillow; the PNG is committed, CI only checks it)
"""

import importlib.util
import sys
from pathlib import Path

# Loading client's script must not leave a __pycache__ in client/ (another role's path).
sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "mobile" / "ios" / "App" / "App" / "Assets.xcassets" / "AppIcon.appiconset" / "AppIcon-512@2x.png"

spec = importlib.util.spec_from_file_location("client_icons", ROOT / "client" / "scripts" / "icons.py")
assert spec is not None and spec.loader is not None
icons = importlib.util.module_from_spec(spec)
spec.loader.exec_module(icons)

if __name__ == "__main__":
    image = icons.png(1024)
    assert image.mode == "RGB" and image.size == (1024, 1024)
    image.save(OUT, optimize=True)
    print(OUT.relative_to(ROOT))
