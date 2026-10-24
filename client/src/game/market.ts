// 市場 (D-101, ceo 2026-10-24; while `features.market`): food and wood bought and sold for gold at
// a finished market of one's own, a lot (100) a tap (ceo: each tap trades one lot at once, so a
// trade never fails as a whole). Each player's prices are in the snapshot header; buying puts the
// price up, selling down, and each goes back towards its start with time (the simulation's).

import { BuildingType, type CommandBody, HeaderField as H, Reject, Resource, type Rules, type SimEvent } from "../sim.ts";
import { features } from "./features.ts";
import { RESOURCE_WORD } from "./dispatch.ts";

/** What can be traded, in the panel's order. */
export const MARKET_RESOURCES: readonly Resource[] = [Resource.Food, Resource.Wood];

export const MARKET_TYPE = BuildingType.Market;

/** The simulation's values (sent with the rules whenever `features.market`). */
export const MARKET_DEFAULTS: NonNullable<Rules["market"]> = { lot: 100, start: 100, step: 5, min: 25, max: 300, sellPermille: 700, recoverTicks: 600, maxLots: 5 };

export function marketRules(rules: Pick<Rules, "market"> | null | undefined): NonNullable<Rules["market"]> {
  return rules?.market ?? MARKET_DEFAULTS;
}

/** Whether markets are in this game. */
export function marketOn(rules: Pick<Rules, "features"> | null | undefined): boolean {
  return features(rules).market === true;
}

/** Gold a lot of this resource costs now (0 while markets are off). */
export function buyPrice(h: ArrayLike<number>, r: Resource): number {
  return r === Resource.Food ? h[H.priceFood] : r === Resource.Wood ? h[H.priceWood] : 0;
}

/** Gold a lot of it brings now: the price's share, rounded down as the simulation does. */
export function sellGain(price: number, m: NonNullable<Rules["market"]>): number {
  return Math.floor((price * m.sellPermille) / 1000);
}

/** One lot of `r`, bought or sold. */
export function tradeOne(r: Resource, buy: boolean): CommandBody {
  return { c: "trade", resource: r, buy, lots: 1 };
}

/** What a tap on 買 or 賣 can do now: null when it can, else why not (the button's small line). */
export function tradeBlock(h: ArrayLike<number>, r: Resource, buy: boolean, m: NonNullable<Rules["market"]>): string | null {
  const have = r === Resource.Food ? h[H.food] : h[H.wood];
  if (buy) return h[H.gold] < buyPrice(h, r) ? "金不夠" : null;
  return have < m.lot ? `${RESOURCE_WORD[r] ?? ""}不到 ${m.lot}` : null;
}

/** The toast when a trade of ours is done: 「賣出 100 糧，得 70 金」, 「買進 100 木，付 105 金」. */
export function tradedText(ev: Extract<SimEvent, { k: "traded" }>): string {
  const word = RESOURCE_WORD[ev.resource] ?? "";
  return ev.buy ? `買進 ${ev.amount} ${word}，付 ${ev.gold} 金` : `賣出 ${ev.amount} ${word}，得 ${ev.gold} 金`;
}

/** A refused trade in plain words (null: the reason's usual line). */
export function tradeRejectText(reason: number, cmd: Extract<CommandBody, { c: "trade" }>): string | null {
  const word = RESOURCE_WORD[cmd.resource] ?? "";
  const amount = cmd.lots * MARKET_DEFAULTS.lot;
  if (reason === Reject.NoMarket) return "沒有蓋好的市場，不能買賣";
  if (reason === Reject.CannotAfford) return cmd.buy ? `金不夠，買不了 ${amount} ${word}` : `${word}不到 ${amount}，賣不了`;
  if (reason === Reject.InvalidTarget) return `一次最多買賣 ${MARKET_DEFAULTS.maxLots} 份`;
  if (reason === Reject.NotAvailable) return "這局沒有市場";
  return null;
}
