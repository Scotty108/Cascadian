/**
 * CCR-Unified: Hybrid PnL Engine
 *
 * =============================================================================
 * THE HYBRID APPROACH
 * =============================================================================
 *
 * Different wallet types require different PnL calculation approaches:
 *
 * 1. MAKER-HEAVY wallets (traditional limit order traders)
 *    - Most trades are maker trades (limit orders on the book)
 *    - Split+sell operations show up in CTF events
 *    - CCR-v1 (cost-basis, maker-only) works well
 *    - Accuracy: ~2-3% vs Polymarket UI
 *
 * 2. TAKER-HEAVY wallets (PM Exchange API users, market takers)
 *    - Most trades are taker trades (taking liquidity)
 *    - Split+sell operations are BUNDLED into taker trades by PM Exchange API
 *    - CCR-v1 fails because it filters to maker-only
 *    - CCR-v3 (cash-flow, all trades) handles bundled trades correctly
 *    - Accuracy: ~0.04% vs Polymarket UI for single-market taker wallets
 *
 * 3. MIXED wallets
 *    - Combination of maker and taker activity
 *    - Use maker ratio to determine which engine
 *    - Threshold: 50% maker → use CCR-v1, else CCR-v3
 *
 * =============================================================================
 * DETECTION LOGIC
 * =============================================================================
 *
 * 1. Query wallet's maker/taker ratio
 * 2. If maker_ratio >= 0.5 → CCR-v1 (cost-basis)
 * 3. If maker_ratio < 0.5 → CCR-v3 (cash-flow)
 *
 * Special cases:
 * - Single-market wallets with taker-heavy: Pattern A detection in CCR-v3
 * - Multi-market wallets with maker-heavy: Standard cost-basis in CCR-v1
 *
 * =============================================================================
 */

import { clickhouse } from '../clickhouse/client';
import { computeCCRv1, CCRMetrics as CCRv1Metrics } from './ccrEngineV1';
import { computeCCRv3, CCRv3Metrics } from './ccrEngineV3';

// =============================================================================
// Types
// =============================================================================

export interface UnifiedMetrics {
  wallet: string;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  positions_count: number;
  resolved_count: number;
  unresolved_count: number;
  total_trades: number;
  volume_traded: number;
  win_count: number;
  loss_count: number;
  win_rate: number;
  pnl_confidence: 'high' | 'medium' | 'low';
  // Engine selection metadata
  engine_used: 'ccr-v1' | 'ccr-v3';
  maker_ratio: number;
  markets_count: number;
}

// =============================================================================
// Detection Logic
// =============================================================================

async function detectWalletPattern(wallet: string): Promise<{
  makerRatio: number;
  makerTrades: number;
  takerTrades: number;
  marketsCount: number;
}> {
  // Query maker/taker counts and unique markets
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(role) as role,
        any(token_id) as token_id
      FROM pm_trader_events_v3
      WHERE trader_wallet = '${wallet.toLowerCase()}'
       
      GROUP BY event_id
    ),
    with_condition AS (
      SELECT
        d.role,
        m.condition_id
      FROM deduped d
      LEFT JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
    )
    SELECT
      countIf(role = 'maker') as maker_count,
      countIf(role = 'taker') as taker_count,
      count(DISTINCT condition_id) as markets_count
    FROM with_condition
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const [row] = (await result.json()) as any[];

  const makerTrades = Number(row?.maker_count || 0);
  const takerTrades = Number(row?.taker_count || 0);
  const totalTrades = makerTrades + takerTrades;
  const makerRatio = totalTrades > 0 ? makerTrades / totalTrades : 0;
  const marketsCount = Number(row?.markets_count || 0);

  return {
    makerRatio,
    makerTrades,
    takerTrades,
    marketsCount,
  };
}

// =============================================================================
// Unified Engine
// =============================================================================

export async function computeUnified(wallet: string): Promise<UnifiedMetrics> {
  // Step 1: Detect wallet pattern
  const pattern = await detectWalletPattern(wallet);

  // Step 2: Choose engine based on wallet characteristics
  //
  // KEY INSIGHT: The choice isn't really about maker vs taker ratio.
  // It's about whether the wallet's taker trades are complex split+sell bundles.
  //
  // Detection heuristics:
  // - Single-market wallets (especially taker-heavy): CCR-v3 with Pattern A detection
  //   These wallets often use PM Exchange API which bundles split+sell into taker trades.
  //   CCR-v3's Pattern A detection handles this correctly.
  //
  // - Multi-market wallets: CCR-v1 (maker-only)
  //   For wallets trading across many markets, the taker trades are often complex
  //   split+sell bundles that are hard to infer correctly. By using maker-only trades,
  //   CCR-v1 avoids this complexity and achieves better accuracy.
  //
  // Threshold: marketsCount > 1 → use CCR-v1
  //            marketsCount == 1 and taker-heavy → use CCR-v3
  //
  // This correctly routes:
  // - splitHeavy (198 markets) → CCR-v1 → 3.54% error
  // - takerHeavy (1 market) → CCR-v3 → 0.04% error

  const isSingleMarket = pattern.marketsCount <= 1;
  const isTakerHeavy = pattern.makerRatio < 0.5;

  // Use CCR-v3 for single-market taker-heavy wallets (Pattern A)
  // Use CCR-v1 for everything else (multi-market or maker-heavy)
  const useCCRv3 = isSingleMarket && isTakerHeavy;
  const useCCRv1 = !useCCRv3;

  let result: UnifiedMetrics;

  if (useCCRv1) {
    // Use CCR-v1 for maker-heavy wallets
    const v1Result = await computeCCRv1(wallet);

    result = {
      wallet: v1Result.wallet,
      realized_pnl: v1Result.realized_pnl,
      unrealized_pnl: v1Result.unrealized_pnl,
      total_pnl: v1Result.total_pnl,
      positions_count: v1Result.positions_count,
      resolved_count: v1Result.resolved_count,
      unresolved_count: v1Result.unresolved_count,
      total_trades: v1Result.total_trades,
      volume_traded: v1Result.volume_traded,
      win_count: v1Result.win_count,
      loss_count: v1Result.loss_count,
      win_rate: v1Result.win_rate,
      pnl_confidence: v1Result.pnl_confidence,
      engine_used: 'ccr-v1',
      maker_ratio: pattern.makerRatio,
      markets_count: pattern.marketsCount,
    };
  } else {
    // Use CCR-v3 for taker-heavy wallets
    const v3Result = await computeCCRv3(wallet);

    result = {
      wallet: v3Result.wallet,
      realized_pnl: v3Result.realized_pnl,
      unrealized_pnl: v3Result.unrealized_pnl,
      total_pnl: v3Result.total_pnl,
      positions_count: v3Result.positions_count,
      resolved_count: v3Result.resolved_count,
      unresolved_count: v3Result.unresolved_count,
      total_trades: v3Result.total_trades,
      volume_traded: v3Result.volume_traded,
      win_count: v3Result.win_count,
      loss_count: v3Result.loss_count,
      win_rate: v3Result.win_rate,
      pnl_confidence: v3Result.pnl_confidence,
      engine_used: 'ccr-v3',
      maker_ratio: pattern.makerRatio,
      markets_count: pattern.marketsCount,
    };
  }

  return result;
}

// =============================================================================
// Factory
// =============================================================================

export function createUnifiedEngine() {
  return {
    compute: computeUnified,
    detectPattern: detectWalletPattern,
  };
}
