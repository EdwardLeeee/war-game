"""Atlas stand-ins for building and resource-point renders that are not packed yet (design/b1/common/run.py output):
the same interface as field.Atlas (body, shadow, frame, m["buildings"] / m["nodes"]), each frame read the way
atlas_b1 packs it (colour with the ambient occlusion, the player-colour layer, the half-size shadow, trimmed at
alpha > 4). For the oblique battlefield before art-v3 is packed (D-088) and the R6-05 side-by-side.

A frame the folder lacks falls back to a near one (another state of the same building, the east look, variant 0),
so the interim battlefield can be put together from the finished looks alone.
"""
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(1, str(HERE.parents[1] / "b1" / "common"))
import field      # noqa: E402

TRIM = 4


class RawAtlas:
    def __init__(self, src, culture=None):
        """culture "E" / "W": the buildings of that culture; None: the resource points."""
        import atlas_b1
        self.src, self.ab = Path(src), atlas_b1
        self.m = {"buildings": atlas_b1.building_table(culture)} if culture else {"nodes": atlas_b1.node_table()}
        self._cache = {}

    def _have(self, name):
        return (self.src / f"{name}_x3.json").exists()

    def resolve(self, name):
        """The frame drawn for `name`: itself, or the nearest one rendered."""
        tries = [name,
                 re.sub(r"_(build1|build2|build3|damaged|sown|growing)$", lambda m: "_ripe" if m.group(1) in ("sown", "growing") else "_done", name),
                 name.replace("_W_", "_E_").replace("_W", "_E"),
                 re.sub(r"_v\d", "_v0", name)]
        for t in tries:
            if self._have(t):
                return t
        raise SystemExit(f"{self.src}: no render for {name}")

    def _layers(self, name):
        name = self.resolve(name)
        if name not in self._cache:
            self.ab.SRC = self.src
            col, tm, sh, (ax, ay), (sax, say) = self.ab.layers(name)
            x0, y0, x1, y1 = Image.fromarray((np.asarray(col.getchannel("A")) > TRIM).astype(np.uint8) * 255).getbbox()
            self._cache[name] = (col.crop((x0, y0, x1, y1)), tm.crop((x0, y0, x1, y1)), ax - x0, ay - y0, sh, sax, say)
        return self._cache[name]

    def body(self, name, team):
        col, tm, ax, ay, *_ = self._layers(name)
        arr = np.asarray(tm, np.float32).copy()
        arr[..., :3] *= np.array(field.TEAM[team], np.float32) / 255.0
        col = col.copy()
        col.alpha_composite(Image.fromarray(arr.astype(np.uint8), "RGBA"))
        return col, ax, ay

    def shadow(self, name):
        *_, sh, sax, say = self._layers(name)
        a = sh.getchannel("A")
        img = Image.merge("RGBA", (Image.new("L", a.size, 0),) * 3 + (a,))
        return img.resize((img.width * 2, img.height * 2), Image.BILINEAR), sax * 2, say * 2

    def frame(self, name):
        col, _, ax, ay, *_ = self._layers(name)
        return dict(w=col.width, h=col.height, ax=ax, ay=ay)


def use(src):
    """Draw every battlefield from the renders in `src` instead of the art's atlases."""
    field.OVERRIDE.update({"E": RawAtlas(src, "E"), "W": RawAtlas(src, "W"), "nodes": RawAtlas(src)})
