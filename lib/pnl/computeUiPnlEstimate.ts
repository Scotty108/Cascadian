/**
 * UI PnL Estimate Calculator
 *
 * Estimates the PnL as shown in Polymarket's UI.
 *
 * KNOWN LIMITATIONS:
 * - Matches perfectly for "retail" wallets (low short exposure)
 * - May overestimate by 30-50% for operator/MM wallets with high short exposure
 * - See docs/systems/pnl/UI_PNL_EST_ANALYSIS.md for full analysis
 */

import { clickhouse } from '../clickhouse/client';

export interface UiPnlEstimateResult {
  wallet: string;

  // Raw components
  totalBuyUsdc: number;
  totalSellUsdc: number;
  netCashflow: number;
  redemptionPayout: number;

  // Position values
  longWinnerValue: number;
  longLoserValue: number;
  shortWinnerLiability: number;
  shortLoserExposure: number;

  // Derived metrics
  longExposure: number;
  shortExposure: number;
  shortRatio: number;
  walletTier: 'retail' | 'mixed' | 'operator';

  // Final estimates
  uiPnlEstimate: number;
  confidence: 'high' | 'medium' | 'low';
}

export async function computeUiPnlEstimate(wallet: string): Promise<UiPnlEstimateResult> {
  // Get all position components
  const result = await clickhouse.query({
    query: `
      WITH trades AS (
        SELECT
          token_id,
          sum(if(side = 'buy', usdc, 0)) as bought_usdc,
          sum(if(side = 'sell', usdc, 0)) as sold_usdc,
          sum(if(side = 'buy', tokens, 0)) as bought_tokens,
          sum(if(side = 'sell', tokens, 0)) as sold_tokens,
          sum(if(side = 'buy', tokens, 0)) - sum(if(side = 'sell', tokens, 0)) as net_tokens
        FROM (
          SELECT
            event_id,
            any(token_id) as token_id,
            any(side) as side,
            any(usdc_amount) / 1e6 as usdc,
            any(token_amount) / 1e6 as tokens
          FROM pm_trader_events_v2
          WHERE trader_wallet = {wallet:String} AND is_deleted = 0
          GROUP BY event_id
        )
        GROUP BY token_id
      ),
      with_resolution AS (
        SELECT
          t.*,
          m.outcome_index,
          r.payout_numerators,
          JSONExtractInt(r.payout_numerators, m.outcome_index + 1) as payout
        FROM trades t
        LEFT JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
        LEFT JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
      )
      SELECT
        -- Totals
        sum(bought_usdc) as total_buy_usdc,
        sum(sold_usdc) as total_sell_usdc,

        -- Long on Winners (payout = 1)
        sumIf(net_tokens, net_tokens > 0 AND payout = 1) as long_winner_tokens,
        sumIf(bought_usdc, net_tokens > 0 AND payout = 1) as long_winner_cost,
        sumIf(sold_usdc, net_tokens > 0 AND payout = 1) as long_winner_sold,

        -- Long on Losers (payout = 0)
        sumIf(net_tokens, net_tokens > 0 AND payout = 0) as long_loser_tokens,
        sumIf(bought_usdc, net_tokens > 0 AND payout = 0) as long_loser_cost,
        sumIf(sold_usdc, net_tokens > 0 AND payout = 0) as long_loser_sold,

        -- Short on Winners (payout = 1) - LIABILITY
        sumIf(abs(net_tokens), net_tokens < 0 AND payout = 1) as short_winner_tokens,
        sumIf(bought_usdc, net_tokens < 0 AND payout = 1) as short_winner_cost,
        sumIf(sold_usdc, net_tokens < 0 AND payout = 1) as short_winner_sold,

        -- Short on Losers (payout = 0)
        sumIf(abs(net_tokens), net_tokens < 0 AND payout = 0) as short_loser_tokens,
        sumIf(bought_usdc, net_tokens < 0 AND payout = 0) as short_loser_cost,
        sumIf(sold_usdc, net_tokens < 0 AND payout = 0) as short_loser_sold,

        -- Total exposure
        sumIf(abs(net_tokens), net_tokens > 0) as long_exposure,
        sumIf(abs(net_tokens), net_tokens < 0) as short_exposure
      FROM with_resolution
    `,
    query_params: { wallet },
    format: 'JSONEachRow',
  });

  const dataRows = await result.json() as any[];
  const data = dataRows[0] as Record<string, number>;

  // Get redemption payouts
  const redemptionResult = await clickhouse.query({
    query: `
      SELECT sum(toFloat64OrZero(amount_or_payout)) / 1e6 as total_payout
      FROM pm_ctf_events
      WHERE user_address = {wallet:String}
        AND event_type = 'PayoutRedemption'
        AND is_deleted = 0
    `,
    query_params: { wallet },
    format: 'JSONEachRow',
  });
  const redemptionRows = await redemptionResult.json() as any[];
  const redemption = redemptionRows[0] as { total_payout: number };

  // Calculate derived values
  const totalBuyUsdc = data.total_buy_usdc || 0;
  const totalSellUsdc = data.total_sell_usdc || 0;
  const netCashflow = totalSellUsdc - totalBuyUsdc;
  const redemptionPayout = redemption.total_payout || 0;

  // Position values
  const longWinnerValue =
    (data.long_winner_tokens || 0) + (data.long_winner_sold || 0) - (data.long_winner_cost || 0);
  const longLoserValue = (data.long_loser_sold || 0) - (data.long_loser_cost || 0);
  const shortWinnerLiability = data.short_winner_tokens || 0; // Owe $1 per token
  const shortLoserExposure = data.short_loser_tokens || 0;

  // Exposure ratios
  const longExposure = data.long_exposure || 0;
  const shortExposure = data.short_exposure || 0;
  const shortRatio = longExposure > 0 ? shortExposure / longExposure : 0;

  // Classify wallet
  let walletTier: 'retail' | 'mixed' | 'operator';
  if (shortRatio < 0.1) {
    walletTier = 'retail';
  } else if (shortRatio < 0.3) {
    walletTier = 'mixed';
  } else {
    walletTier = 'operator';
  }

  // Calculate UI PnL estimate based on wallet tier
  let uiPnlEstimate: number;
  let confidence: 'high' | 'medium' | 'low';

  // The key insight:
  // - Redemption payouts are USDC received when you redeem
  // - Unredeemed winner tokens need to be valued at $1 each
  // - BUT we should not double-count: if redeemed, don't add unredeemed value

  // Simple formula that works for most cases:
  // PnL = (Total Sells - Total Buys) + Redemption Payouts + Unredeemed Winner Value
  // But for partially redeemed positions, this can double-count

  // Better formula:
  // PnL = Net Cashflow + Redemption Payouts + Unredeemed Winner Tokens
  // Where Unredeemed Winner Tokens = long_winner_tokens that haven't been redeemed

  // Since we can't easily tell which tokens are redeemed vs unredeemed,
  // we use the V11_POLY approach for retail and long-only for operators

  if (walletTier === 'retail') {
    // For retail wallets with low short exposure, use V11_POLY style
    // This matches their actual realized + unrealized
    uiPnlEstimate = netCashflow + redemptionPayout + (data.long_winner_tokens || 0);
    // But wait - this double-counts redeemed tokens
    // Redemption is included in cashflow when you receive USDC
    // So actually: uiPnlEstimate = netCashflow + long_winner_tokens (unredeemed only)
    // Since we can't easily distinguish, let's try:
    // If redemptions are high relative to winner value, use realized formula
    if (redemptionPayout > (data.long_winner_tokens || 0) * 0.8) {
      // Most winners redeemed, use realized formula
      uiPnlEstimate = netCashflow + redemptionPayout;
    } else {
      // Most winners unredeemed, add position value but don't double-count
      uiPnlEstimate = netCashflow + (data.long_winner_tokens || 0);
    }
    confidence = 'high';
  } else if (walletTier === 'mixed') {
    // For mixed wallets, use conservative estimate
    uiPnlEstimate = longWinnerValue;
    confidence = 'medium';
  } else {
    // For operator wallets, just use long winner value
    uiPnlEstimate = longWinnerValue;
    confidence = 'low';
  }

  return {
    wallet,
    totalBuyUsdc,
    totalSellUsdc,
    netCashflow,
    redemptionPayout,
    longWinnerValue,
    longLoserValue,
    shortWinnerLiability,
    shortLoserExposure,
    longExposure,
    shortExposure,
    shortRatio,
    walletTier,
    uiPnlEstimate,
    confidence,
  };
}

/**
 * Format a dollar amount for display
 */
export function formatUsd(amount: number): string {
  if (Math.abs(amount) >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(2)}M`;
  } else if (Math.abs(amount) >= 1000) {
    return `$${(amount / 1000).toFixed(1)}K`;
  } else {
    return `$${amount.toFixed(2)}`;
  }
}
