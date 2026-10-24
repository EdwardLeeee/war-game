// D-100 (the user 2026-10-23: 「我覺得把城鎮的範圍做更大一點，然後裡面也可以有一個主堡可以點，把這個主堡打下來跟殺完駐守的殘兵拿下了」).
// Its own module, so the castles (castle.ts) and the rules (rules.ts) both read the switch without
// importing each other.

import { CELL, TICKS_PER_SECOND } from "../protocol.ts";

const S = TICKS_PER_SECOND;

/**
 * Towns about 1.5 x bigger with a keep in each (ceo 2026-10-23). While on:
 * - the castles are castle-layout-d100.ts (the small town 13 x 13 inside, the big city 17 x 17), centred
 *   on every map on the town's centre cell; the walls `radius` cells from it;
 * - every town has a keep (BuildingType.Keep, 3 x 3, its top-left at the centre cell - 1) that
 *   shoots for whoever holds it: `hp` and `arrow` by TownSize (the small town's 600 / 4, ceo
 *   2026-10-24 from the scripted player's first captures; the big city's arrows a player's tower's);
 * - a town falls only once its keep has fallen too; the keep is down from then until the town is
 *   governed (built again for the governor when repaired) or neutral again (for the militia); a
 *   governed town builds a fallen keep again once no enemy has stood inside for `rebuildTicks`, as
 *   its gates (D-096). It holds no one; its owner's farmers may repair it.
 * Off: the castles and the big city's tower of D-089 (castle-layout.ts), as before.
 */
export const KEEP = {
  on: false,
  hp: [600, 1000],
  arrow: [
    { damage: 4, range: 7 * CELL, cooldown: 2 * S },
    { damage: 10, range: 7 * CELL, cooldown: 2 * S },
  ],
  size: 3,
  radius: [7, 9],
  rebuildTicks: 60 * S,
};
