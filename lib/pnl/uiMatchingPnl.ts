/**
 * UI-Matching P&L Engine
 *
 * Mimics Polymarket subgraph logic:
 *   adjustedAmount = min(sellAmount, trackedBuyAmount)
 *   deltaPnL = adjustedAmount * (sellPrice - avgBuyPrice)
 *
 * Key behaviors:
 * 1. Only count P&L on tokens that were tracked as buys
 * 2. Extra tokens from splits/transfers get $0 profit
 * 3. Round prices to cents (per Goldsky feedback)
 *
 * This should match UI for "normal" traders.
 * Arbitrageurs will show lower P&L (their split profits are ignored).
 */

import { clickhouse } from '@/lib/clickhouse/client';

export interface UIMatchingResult {
  wallet: string;
  // Raw data
  buyUsdc: number;
  sellUsdc: number;
  buyTokens: number;
  sellTokens: number;
  redemptions: number;
  merges: number;
  // Calculated
  avgBuyPrice: number;
  avgSellPrice: number;
  adjustedSellTokens: number;
  extraTokens: number;
  // P&L components
  pnlFromSells: number;
  pnlFromRedemptions: number;
  estimatedPnl: number;
  trades: number;
}

/**
 * Round to cents (2 decimal places) to match UI rounding behavior
 */
function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function computeUIMatchingPnl(wallet: string): Promise<UIMatchingResult> {
  const w = wallet.toLowerCase();

  // 1) Get CLOB trade totals
  const tradesQ = `
    SELECT
      sum(CASE WHEN side = 'buy' THEN usdc_amount ELSE 0 END)/1e6 as buy_usdc,
      sum(CASE WHEN side = 'sell' THEN usdc_amount ELSE 0 END)/1e6 as sell_usdc,
      sum(CASE WHEN side = 'buy' THEN token_amount ELSE 0 END)/1e6 as buy_tokens,
      sum(CASE WHEN side = 'sell' THEN token_amount ELSE 0 END)/1e6 as sell_tokens,
      count() as trade_count
    FROM pm_trader_events_dedup_v2_tbl
    WHERE trader_wallet = '${w}'
  `;
  const tradesR = await clickhouse.query({ query: tradesQ, format: 'JSONEachRow' });
  const [tradeData] = (await tradesR.json()) as [{
    buy_usdc: number;
    sell_usdc: number;
    buy_tokens: number;
    sell_tokens: number;
    trade_count: number;
  }];

  const buyUsdc = tradeData?.buy_usdc || 0;
  const sellUsdc = tradeData?.sell_usdc || 0;
  const buyTokens = tradeData?.buy_tokens || 0;
  const sellTokens = tradeData?.sell_tokens || 0;
  const tradeCount = Number(tradeData?.trade_count || 0);

  // 2) Get CTF event totals (redemptions count as exits)
  const ctfQ = `
    SELECT
      event_type,
      sum(toFloat64OrZero(amount_or_payout))/1e6 as total_amount
    FROM pm_ctf_events
    WHERE lower(user_address) = '${w}'
      AND event_type IN ('PositionsMerge', 'PayoutRedemption')
      AND is_deleted = 0
    GROUP BY event_type
  `;
  const ctfR = await clickhouse.query({ query: ctfQ, format: 'JSONEachRow' });
  const ctfEvents = (await ctfR.json()) as Array<{
    event_type: string;
    total_amount: number;
  }>;

  let redemptions = 0;
  let merges = 0;
  for (const e of ctfEvents) {
    if (e.event_type === 'PayoutRedemption') redemptions = e.total_amount;
    else if (e.event_type === 'PositionsMerge') merges = e.total_amount;
  }

  // 3) Calculate average prices (rounded to cents)
  const avgBuyPrice = buyTokens > 0 ? roundToCents(buyUsdc / buyTokens) : 0;
  const avgSellPrice = sellTokens > 0 ? roundToCents(sellUsdc / sellTokens) : 0;

  // 4) Cap sell tokens to tracked buy tokens (subgraph logic)
  const adjustedSellTokens = Math.min(sellTokens, buyTokens);
  const extraTokens = Math.max(0, sellTokens - buyTokens);

  // 5) Calculate P&L components
  // P&L from sells = adjustedAmount * (sellPrice - buyPrice)
  // Using rounded prices per Goldsky feedback
  const pnlFromSells = adjustedSellTokens * (avgSellPrice - avgBuyPrice);

  // Redemptions: the subgraph treats these as exits at resolved price
  // For simplicity, count redemption USDC as pure profit above cost basis
  // Actually, redemptions should also be capped... but we don't have redemption token counts
  // Let's assume redemptions are on tokens we already hold (tracked)
  const pnlFromRedemptions = redemptions;

  // 6) Total estimated P&L
  // Subtract the cost of tokens we still hold? No - UI shows "realized" P&L
  // This is just from closed positions (sells + redemptions)
  // We need to subtract the cost basis of redeemed tokens too...

  // Actually, let's simplify:
  // Total P&L = Sells + Redemptions + Merges - (tokens_sold * avgBuyPrice) - (tokens_redeemed_estimated * avgBuyPrice)
  // But we don't have tokens_redeemed...

  // Let's use a simpler formula that should approximate UI:
  // P&L ≈ (Sell revenue - cost of sold tokens) + (Redemption revenue - cost of redeemed tokens)
  // ≈ adjustedSellTokens * (avgSellPrice - avgBuyPrice) + redemptions - (redemptionTokens * avgBuyPrice)

  // For now, assume redemptions are "profit" (tokens redeemed at $1 minus cost)
  // This is imperfect but should get closer

  // Actually, the simplest matching formula is:
  // P&L = (Cash Out from sells) + Redemptions - (Cash In for buys)
  // But capped to only count sells on tracked buys

  // Let me try: P&L = adjustedSellUsdc + Redemptions - BuyUsdc
  // where adjustedSellUsdc = (adjustedSellTokens / sellTokens) * sellUsdc
  const adjustedSellUsdc = sellTokens > 0
    ? (adjustedSellTokens / sellTokens) * sellUsdc
    : 0;

  // This gives: proportion of sell revenue for tracked tokens only
  const estimatedPnl = adjustedSellUsdc + redemptions + merges - buyUsdc;

  return {
    wallet: w,
    buyUsdc,
    sellUsdc,
    buyTokens,
    sellTokens,
    redemptions,
    merges,
    avgBuyPrice,
    avgSellPrice,
    adjustedSellTokens,
    extraTokens,
    pnlFromSells,
    pnlFromRedemptions,
    estimatedPnl,
    trades: tradeCount,
  };
}
