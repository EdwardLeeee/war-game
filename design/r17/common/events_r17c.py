"""R17-03 (the user 2026-11-10: 「感覺可以有進攻 防守 跟團戰」; D-138): the three kinds of one game as one list, from
war-game-client's replays (war-game-worktrees/review/r17/): 防守 (結果-原始.txt's 「進攻」 lines: the computer at our
main city or a town of ours), 進攻 (我方進攻-原始.txt: we at a city or town not ours; a neutral town only with someone
dead or taken), 團戰 (結果-原始.txt). Each its own event, none joined, but one case, as client suggests: an attack
that starts within a minute of that town falling (我方進攻-全部候選.txt's [剛丟]) is the same fight as the defence
it follows: it is not listed, its dead go to that defence's (the computer's soldiers only: the town is neutral by
then, and its militia are not the computer's), and the defence reads 「失守後搶回」 when it took the town back.

python3 design/r17/common/events_r17c.py REVIEW_DIR GAME [GAME ...] > events3.json
"""
import json
import re
import sys
from pathlib import Path

T = r"(\d+):(\d\d)–(\d+):(\d\d)"
DEFEND = re.compile(rf"進攻 {T} (\S+(?: \d)?) 敵 (\d+) 名（敵死 (\d+)、我死 (\d+)）(\S+)")
BATTLE = re.compile(rf"團戰 {T} (\S+?)(?: (\d+) 名對 (\d+) 名)?（我死 (\d+)、敵死 (\d+)）(\S+)")
ATTACK = re.compile(rf"進攻 {T} (\S+(?: \d)?) 我方 (\d+) 名（我死 (\d+)、敵死 (\d+)(?:，其中民兵 \d+)?）(.+)$")
LOST = re.compile(rf"^(\w+) {T} \S+ (\S+(?: \d)?) samples \d+ 我方 \d+ 名 我死 (\d+) 敵死 (\d+) 民兵死 \d+")
RESULT = {"平": "平手", "攻下（敵方主城被毀）": "敵方主城被毀"}


def secs(m, s):
    return int(m) * 60 + int(s)


def lines_of(text, game):
    on = False
    for line in text.splitlines():
        if line.startswith("GAME "):
            on = line.split()[1] == game
        elif on:
            yield line


def parse(review, game):
    out = []
    for line in lines_of((review / "結果-原始.txt").read_text(encoding="utf-8"), game):
        d = DEFEND.search(line)
        if d:
            t0, t1 = secs(d[1], d[2]), secs(d[3], d[4])
            if t0 == t1 and int(d[7]) == 0 and int(d[8]) == 0:        # a passing blip
                continue
            out.append(dict(kind="defend", t0=t0, t1=t1, place=d[5], n=int(d[6]), foe_dead=int(d[7]), me_dead=int(d[8]), result=d[9]))
            continue
        b = BATTLE.search(line)
        if b:
            out.append(dict(kind="battle", t0=secs(b[1], b[2]), t1=secs(b[3], b[4]), place=b[5], me_dead=int(b[8]), foe_dead=int(b[9]),
                            result=RESULT.get(b[10], b[10])))
    just_lost = {}
    for line in (review / "我方進攻-全部候選.txt").read_text(encoding="utf-8").splitlines():
        m = LOST.search(line)
        if m and m[1] == game and "[剛丟]" in line and "[blip]" not in line:
            just_lost[(secs(m[2], m[3]), m[6])] = (int(m[7]), int(m[8]))
    joined = []
    for line in lines_of((review / "我方進攻-原始.txt").read_text(encoding="utf-8"), game):
        a = ATTACK.search(line.strip())
        if not a:
            continue
        t0, place, res = secs(a[1], a[2]), a[5], a[9].strip()
        if (t0, place) in just_lost:
            d = max((e for e in out if e["kind"] == "defend" and e["place"] == place and e["t0"] <= t0), key=lambda e: e["t0"])
            me, foe = just_lost[(t0, place)]
            d.update(t1=secs(a[3], a[4]), me_dead=d["me_dead"] + me, foe_dead=d["foe_dead"] + foe)
            if res.startswith("攻下"):
                d["result"] = "失守後搶回"
            joined.append(f"{a[1]}:{a[2]} {place}")
            continue
        out.append(dict(kind="attack", t0=t0, t1=secs(a[3], a[4]), place=place, n=int(a[6]), me_dead=int(a[7]), foe_dead=int(a[8]),
                        result=RESULT.get(res, res)))
    out.sort(key=lambda e: e["t0"])
    ticks = json.loads((review / "timelines" / f"{game}.json").read_text())["ticks"]
    count = {k: sum(e["kind"] == k for e in out) for k in ("attack", "defend", "battle")}
    return dict(ticks=ticks, list=out, count=count, joined=joined)


if __name__ == "__main__":
    review = Path(sys.argv[1])
    print(json.dumps({g: parse(review, g) for g in sys.argv[2:]}, ensure_ascii=False, indent=1))
