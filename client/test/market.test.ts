// 市場 (D-101, ceo 2026-10-24): the panel's prices and why a button is greyed, the toast of a
// trade done, a refused trade in plain words; the fake world's trade as the simulation's.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buyPrice, MARKET_DEFAULTS, sellGain, tradeBlock, tradedText, tradeOne, tradeRejectText } from "../src/game/market.ts";
import { HEADER_LENGTH, HeaderField as H, Reject, Resource } from "../src/sim.ts";
import { rejectText } from "../src/ui/overlays.ts";

function header(v: Partial<Record<keyof typeof H, number>>): Int32Array {
  const h = new Int32Array(HEADER_LENGTH);
  for (const [k, n] of Object.entries(v)) h[H[k as keyof typeof H]] = n;
  return h;
}

test("市場：買 100 付現價，賣 100 得現價的七成（捨去）；錢或貨不夠時按鈕寫為什麼", () => {
  const h = header({ food: 80, wood: 400, gold: 104, priceFood: 105, priceWood: 97 });
  assert.equal(buyPrice(h, Resource.Food), 105);
  assert.equal(buyPrice(h, Resource.Wood), 97);
  assert.equal(sellGain(105, MARKET_DEFAULTS), 73);
  assert.equal(sellGain(97, MARKET_DEFAULTS), 67);
  assert.equal(tradeBlock(h, Resource.Food, true, MARKET_DEFAULTS), "金不夠");
  assert.equal(tradeBlock(h, Resource.Wood, true, MARKET_DEFAULTS), null);
  assert.equal(tradeBlock(h, Resource.Food, false, MARKET_DEFAULTS), "糧不到 100");
  assert.equal(tradeBlock(h, Resource.Wood, false, MARKET_DEFAULTS), null);
  assert.deepEqual(tradeOne(Resource.Wood, false), { c: "trade", resource: Resource.Wood, buy: false, lots: 1 });
});

test("市場：成交的提示、被拒的白話", () => {
  assert.equal(tradedText({ k: "traded", resource: Resource.Food, buy: false, lots: 1, amount: 100, gold: 70 }), "賣出 100 糧，得 70 金");
  assert.equal(tradedText({ k: "traded", resource: Resource.Wood, buy: true, lots: 1, amount: 100, gold: 105 }), "買進 100 木，付 105 金");
  const buy = { c: "trade" as const, resource: Resource.Food, buy: true, lots: 1 };
  const sell = { c: "trade" as const, resource: Resource.Wood, buy: false, lots: 1 };
  assert.equal(rejectText(Reject.NoMarket, buy), "沒有蓋好的市場，不能買賣");
  assert.equal(rejectText(Reject.CannotAfford, buy), "金不夠，買不了 100 糧");
  assert.equal(rejectText(Reject.CannotAfford, sell), "木不到 100，賣不了");
  assert.equal(tradeRejectText(Reject.InvalidTarget, buy), "一次最多買賣 5 份");
  // Not a trade: as before.
  assert.equal(rejectText(Reject.CannotAfford, { c: "train", building: 1, type: 1, n: 1 }), "資源不夠");
});
