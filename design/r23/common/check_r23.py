"""Two checks the ceo asked for before art-v7.11 (2026-11-11), from the packs themselves (the dry run's x3 unpacked):

  R23-06-西陸農民-和東陸農民西陸遠程兵並排-phone    the West farmer in his apron beside the East farmer and the West
                                                bowman: can a villager be told from a soldier, and the two farmers
                                                from each other, at the phone's size?
  R22-03-東陸攻城砲拽手倒下-改前改後-phone          the East engine's pullers falling, the old pack over the new

python3 design/r23/common/check_r23.py OLD_X3 NEW_X3 OUT
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "r21" / "common"))
import boards_r21 as R21   # noqa: E402

R, A, B = R21.R, R21.A, R21.B


def scene(u, anim, face, k, team="blue"):
    return [(u.sprite(anim, face, k, team), 0, 0)]


def trio(new, out, tag):
    S = R21.Shots(Path("."), new)
    fw, fe, bw = A.Unit(new, "farmer_w"), A.Unit(new, "farmer_e"), A.Unit(new, "bow_w")
    who = [("西陸農民", fw), ("東陸農民", fe), ("西陸遠程兵", bw)]
    rows = []
    for title, shots in (("待機，朝右下、朝下、朝右，藍", [("idle", 7, 0, "blue"), ("idle", 6, 0, "blue"), ("idle", 0, 0, "blue")]),
                         ("待機，紅", [("idle", 7, 0, "red"), ("idle", 6, 0, "red"), ("idle", 0, 0, "red")]),
                         ("走路第 3、7 格，朝右下", [("walk", 7, 2, "blue"), ("walk", 7, 6, "blue")]),
                         ("背面：待機朝右上、朝上", [("idle", 1, 0, "blue"), ("idle", 2, 0, "blue")])):
        scenes = [scene(u, a, f, k, t) for _, u in who for a, f, k, t in shots]
        box, pbox = S.box(scenes), S.box(scenes, pad=3)
        cols = []
        for name, u in who:
            mine = [scene(u, a, f, k, t) for a, f, k, t in shots]
            cols.append(R.titled(R.join([R.titled(S.phone(mine, pbox), "手機"), S.big(mine, 2.5, box)], 8, vertical=True), name, B.YEL, 30, True))
        rows.append(R.block(title, "", R.join(cols, 40)))
    R.sheet(out, "R23-06-西陸農民-和東陸農民西陸遠程兵並排-phone", [
        ("西陸農民加了玩家色圍裙以後，和東陸農民、西陸遠程兵並排：手機大小上分不分得出來。", B.font(32), B.PALE),
        (f"圖取自 {tag} 的美術包（CI 正式算的圖），不是草稿。每一格最左邊的槍兵是比例。", B.font(26, False), B.GREY),
    ], rows)


def crew_fall(old, new, out, old_tag, new_tag):
    S = R21.Shots(Path("."), new)
    uo, un = A.Unit(old, "siege_e"), A.Unit(new, "siege_e")
    blocks = []
    for face, name in ((7, "朝右下"), (0, "朝右"), (6, "朝下"), (1, "朝右上")):
        ks = list(range(10))
        scenes = [scene(u, "death", face, k) for u in (uo, un) for k in ks]
        box, pbox = S.box(scenes), S.box(scenes, pad=3)
        sides = []
        for u, word, col in ((uo, f"改前（{old_tag}）", (255, 150, 130)), (un, f"改後（{new_tag}）", (150, 230, 150))):
            mine = [scene(u, "death", face, k) for k in ks]
            parts = [R.titled(S.phone(mine, pbox), "手機：倒下的 10 格")]
            if face == 7:
                parts.append(R.titled(S.big(mine[1:6], 1.3, box), "放大：第 2–6 格"))
            sides.append(R.titled(R.join(parts, 8, vertical=True), word, col, 30, True))
        blocks.append(R.block(name, "", R.join(sides, 12, vertical=True)))
    R.sheet(out, "R22-03-東陸攻城砲拽手倒下-改前改後-phone", [
        ("東陸攻城砲的兩名拽手也用步兵的倒法：倒下開頭的手臂跟著改（不再是 T 字）。砲本身的垮法沒有動。", B.font(32), B.PALE),
        ("圖取自兩版美術包（CI 正式算的圖），不是草稿。", B.font(26, False), B.GREY),
    ], blocks)


def main():
    old, new, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    out.mkdir(parents=True, exist_ok=True)
    tag = lambda p: __import__("json").loads((p / "art-release.json").read_text()).get("tag", p.parent.name)
    trio(new, out, tag(new))
    crew_fall(old, new, out, tag(old), tag(new))


if __name__ == "__main__":
    main()
