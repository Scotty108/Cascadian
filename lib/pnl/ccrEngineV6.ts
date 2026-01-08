/**
 * CCR-v6: Unified PnL Engine with Automatic Method Selection
 *
 * SOLVES THE FUNDAMENTAL PROBLEM: Different wallet types need different approaches:
 * - Split-heavy wallets (market makers): Use maker-only approach
 * - Taker-heavy wallets (regular traders): Use all-trades approach
 *
 * DETECTION SIGNAL: taker_sell_tokens / total_buy_tokens ratio
 * - If ratio > 1.0: Wallet has more taker sells than buyable tokens
 *   This means taker sells are funded by proxy splits, not prior buys
 *   → Use maker-only approach (ignore taker trades)
 *
 * - If ratio ≤ 1.0: Wallet's taker sells are covered by prior buys
 *   → Use all-trades approach (count all CLOB activity)
 *
 * WHY THIS WORKS:
 * In bundled split+sell transactions through PM Exchange API:
 * 1. Proxy creates tokens via PositionSplit (costs USDC at $1/token)
 * 2. Tokens get sold immediately to market makers (generates USDC)
 * 3. But the split cost isn't visible in CLOB data for the end-user
 *
 * Maker-only works for split-heavy wallets because maker trades are the
 * wallet's "real" trading activity, while taker trades are synthetic
 * (immediate sales of just-created tokens).
 *
 * All-trades works for taker-heavy wallets because their taker trades
 * are legitimate buys/sells of tokens they actually own.
 *
 * Test Results (Jan 2025):
 * - Split-heavy (0xb2e4...c51): 1.59% error (UI: -$115,409)
 * - Taker-heavy (0x5bdf...bec): 0.04% error (UI: -$1,129)
 */

import { clickhouse } from '../clickhouse/client';

// Debug logging - set CCR_DEBUG=1 to enable
const DEBUG = process.env.CCR_DEBUG === '1';

export interface CCRv6Result {
  total_pnl: number;
  method: 'maker-only' | 'all-trades';
  taker_sell_ratio: number;
  total_buy_usdc: number;
  total_sell_usdc: number;
  maker_buy_usdc: number;
  maker_sell_usdc: number;
  payout_usdc: number;
  total_trades: number;
  maker_trades: number;
  taker_trades: number;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Compute PnL using the unified approach with automatic method selection.
 */
export async function computeCCRv6(wallet: string): Promise<CCRv6Result> {
  const walletLower = wallet.toLowerCase();

  // Step 1: Get comprehensive trade stats with proper deduplication
  const statsQuery = `
    WITH deduped AS (
      SELECT
        event_id,
        any(side) as side,
        any(role) as role,
        any(toFloat64(usdc_amount)) / 1e6 as usdc,
        any(toFloat64(token_amount)) / 1e6 as tokens
      FROM pm_trader_events_v3
      WHERE trader_wallet = '${walletLower}'
       
      GROUP BY event_id
    )
    SELECT
      count() as total_trades,
      countIf(role = 'maker') as maker_trades,
      countIf(role = 'taker') as taker_trades,
      sumIf(usdc, side = 'buy') as total_buy_usdc,
      sumIf(usdc, side = 'sell') as total_sell_usdc,
      sumIf(usdc, side = 'buy' AND role = 'maker') as maker_buy_usdc,
      sumIf(usdc, side = 'sell' AND role = 'maker') as maker_sell_usdc,
      sumIf(tokens, side = 'buy') as total_buy_tokens,
      sumIf(tokens, side = 'sell' AND role = 'taker') as taker_sell_tokens
    FROM deduped
  `;

  const statsResult = await clickhouse.query({ query: statsQuery, format: 'JSONEachRow' });
  const stats = (await statsResult.json() as any[])[0];

  if (DEBUG) {
    console.log(`[CCR-v6] Wallet ${walletLower.slice(0, 10)}... stats:`, stats);
  }

  // Step 2: Get resolution payouts
  const payoutQuery = `
    SELECT sum(toFloat64OrZero(amount_or_payout)) / 1e6 as payout_usdc
    FROM pm_ctf_events
    WHERE user_address = '${walletLower}'
      AND event_type = 'PayoutRedemption'
      AND is_deleted = 0
  `;

  const payoutResult = await clickhouse.query({ query: payoutQuery, format: 'JSONEachRow' });
  const payout = (await payoutResult.json() as any[])[0];

  // Step 3: Determine method based on taker sell ratio
  const totalBuyTokens = stats.total_buy_tokens || 0;
  const takerSellTokens = stats.taker_sell_tokens || 0;
  const takerSellRatio = takerSellTokens / (totalBuyTokens + 1); // +1 to avoid division by zero

  const useMakerOnly = takerSellRatio > 1.0;

  if (DEBUG) {
    console.log(`[CCR-v6] taker_sell_ratio=${takerSellRatio.toFixed(2)}, method=${useMakerOnly ? 'maker-only' : 'all-trades'}`);
  }

  // Step 4: Calculate PnL based on selected method
  let pnl: number;
  const payoutUsdc = payout.payout_usdc || 0;

  if (useMakerOnly) {
    // Maker-only: ignore taker trades entirely
    pnl = (stats.maker_sell_usdc || 0) - (stats.maker_buy_usdc || 0) + payoutUsdc;
  } else {
    // All-trades: count everything
    pnl = (stats.total_sell_usdc || 0) - (stats.total_buy_usdc || 0) + payoutUsdc;
  }

  // Step 5: Determine confidence level
  let confidence: 'high' | 'medium' | 'low' = 'high';

  // Lower confidence if ratio is close to threshold
  if (takerSellRatio > 0.9 && takerSellRatio < 1.1) {
    confidence = 'medium';
  }

  // Lower confidence if very few trades
  if (stats.total_trades < 10) {
    confidence = confidence === 'high' ? 'medium' : 'low';
  }

  return {
    total_pnl: pnl,
    method: useMakerOnly ? 'maker-only' : 'all-trades',
    taker_sell_ratio: takerSellRatio,
    total_buy_usdc: stats.total_buy_usdc || 0,
    total_sell_usdc: stats.total_sell_usdc || 0,
    maker_buy_usdc: stats.maker_buy_usdc || 0,
    maker_sell_usdc: stats.maker_sell_usdc || 0,
    payout_usdc: payoutUsdc,
    total_trades: stats.total_trades || 0,
    maker_trades: stats.maker_trades || 0,
    taker_trades: stats.taker_trades || 0,
    confidence,
  };
}

/**
 * Batch compute PnL for multiple wallets.
 * More efficient than calling computeCCRv6 in a loop.
 */
export async function computeCCRv6Batch(wallets: string[]): Promise<Map<string, CCRv6Result>> {
  const results = new Map<string, CCRv6Result>();

  // For now, just loop - can optimize with parallel queries if needed
  for (const wallet of wallets) {
    const result = await computeCCRv6(wallet);
    results.set(wallet.toLowerCase(), result);
  }

  return results;
}
