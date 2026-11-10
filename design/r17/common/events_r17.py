"""R17 (the user 2026-11-10: 「我覺得結算畫面 也可以把電腦來進攻我們打團戰的飆進去」): the computer's attacks and the battles
of one game, from war-game-client's replays (war-game-worktrees/review/r17/結果-原始.txt, analyze.ts: an attack is 5 or
more enemy soldiers near our main city or a town we govern, apart less than 30 s the same one; a battle 10 or more
soldiers dead in 60 s, joined when they overlap or are under 30 s apart; a single sample of an attack where nobody died
is left out, as client suggests), as JSON for the boards (r17.mjs).

python3 design/r17/common/events_r17.py RESULTS.txt GAME [GAME ...] > events.json
"""
import json
import re
import sys

ATTACK = re.compile(r"進攻 (\d+):(\d\d)–(\d+):(\d\d) (\S+(?: \d)?) 敵 (\d+) 名（敵死 (\d+)、我死 (\d+)）(\S+)")
BATTLE = re.compile(r"團戰 (\d+):(\d\d)–(\d+):(\d\d) (\S+?)(?: (\d+) 名對 (\d+) 名)?（我死 (\d+)、敵死 (\d+)）(\S+)")


def secs(m, s):
    return int(m) * 60 + int(s)


def parse(text, game):
    out, on = dict(attacks=[], battles=[]), False
    for line in text.splitlines():
        if line.startswith("GAME "):
            on = line.split()[1] == game
            if on:
                out["head"] = line
            continue
        if not on:
            continue
        a = ATTACK.search(line)
        if a:
            t0, t1 = secs(a[1], a[2]), secs(a[3], a[4])
            e = dict(t0=t0, t1=t1, place=a[5], foe=int(a[6]), foe_dead=int(a[7]), me_dead=int(a[8]), result=a[9])
            if not (t0 == t1 and e["foe_dead"] == 0 and e["me_dead"] == 0):      # a passing blip
                out["attacks"].append(e)
            continue
        b = BATTLE.search(line)
        if b:
            out["battles"].append(dict(t0=secs(b[1], b[2]), t1=secs(b[3], b[4]), place=b[5],
                                       me=int(b[6]) if b[6] else None, foe=int(b[7]) if b[7] else None,
                                       me_dead=int(b[8]), foe_dead=int(b[9]), result=b[10]))
    # an attack that turned into a battle at the same place: drawn as one (the ▼ on the battle's span)
    for a in out["attacks"]:
        a["battle"] = next((i for i, b in enumerate(out["battles"]) if b["place"] == a["place"]
                            and b["t0"] - 30 <= a["t1"] and a["t0"] <= b["t1"] + 30), None)
    return out


if __name__ == "__main__":
    text = open(sys.argv[1], encoding="utf-8").read()
    print(json.dumps({g: parse(text, g) for g in sys.argv[2:]}, ensure_ascii=False, indent=1))
