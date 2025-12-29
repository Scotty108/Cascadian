/**
 * CLOB-Only Outlier Tagger
 *
 * Categorizes wallets with V29 vs UI discrepancies into actionable buckets:
 * - DATA_MISSING_CLOB: Wallet has redemptions/payouts but missing CLOB trades
 * - PROXY_ATTRIBUTION_SUSPECT: Proxy contract activity causing attribution issues
 * - VALUATION_EDGE: Mark-to-market vs realized timing differences
 * - OPEN_POSITION_DRIFT: Large open positions causing unrealized PnL drift
 * - UNKNOWN: Requires manual investigation
 */

import { createClient } from '@clickhouse/client';

export type OutlierTag =
  | 'DATA_MISSING_CLOB'
  | 'PROXY_ATTRIBUTION_SUSPECT'
  | 'VALUATION_EDGE'
  | 'OPEN_POSITION_DRIFT'
  | 'UNKNOWN';

export interface OutlierAnalysis {
  wallet: string;
  tag: OutlierTag;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  signals: string[];
  recommendation: string;
}

interface ForensicSignals {
  clobEventCount: number;
  redemptionCount: number;
  openPositionCount: number;
  totalConditions: number;
  hasNegativeInventory: boolean;
  redemptionsWithoutBuys: number;
  cashFlowMagnitude: number;
  v29Pnl: number;
  uiPnl: number;
  absError: number;
  pctError: number;
}

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

export async function getForensicSignals(wallet: string): Promise<ForensicSignals | null> {
  try {
    const query = `
      SELECT
        countIf(source_type = 'CLOB') as clob_events,
        countIf(source_type = 'PayoutRedemption') as redemption_events,
        countIf(source_type = 'PositionSplit') as split_events,
        countIf(source_type = 'PositionsMerge') as merge_events,
        uniqExact(condition_id) as total_conditions,
        sum(usdc_delta) as cash_flow,
        -- Check for negative running inventory (sells without buys)
        sum(CASE WHEN token_delta < 0 THEN 1 ELSE 0 END) as sell_count,
        sum(CASE WHEN token_delta > 0 THEN 1 ELSE 0 END) as buy_count
      FROM pm_unified_ledger_v8_tbl
      WHERE wallet_address = {wallet:String}
    `;

    const result = await clickhouse.query({
      query,
      query_params: { wallet: wallet.toLowerCase() },
      format: 'JSONEachRow',
    });

    const rows: any[] = await result.json();
    if (rows.length === 0) return null;

    const r = rows[0];
    return {
      clobEventCount: Number(r.clob_events),
      redemptionCount: Number(r.redemption_events),
      openPositionCount: 0, // Will be calculated separately if needed
      totalConditions: Number(r.total_conditions),
      hasNegativeInventory: Number(r.sell_count) > Number(r.buy_count),
      redemptionsWithoutBuys: Math.max(0, Number(r.redemption_events) - Number(r.buy_count)),
      cashFlowMagnitude: Math.abs(Number(r.cash_flow)),
      v29Pnl: 0,
      uiPnl: 0,
      absError: 0,
      pctError: 0,
    };
  } catch (error) {
    console.error(`Failed to get forensic signals for ${wallet}:`, error);
    return null;
  }
}

export function tagOutlier(
  wallet: string,
  v29Pnl: number,
  uiPnl: number,
  signals?: Partial<ForensicSignals>
): OutlierAnalysis {
  const absError = Math.abs(v29Pnl - uiPnl);
  const pctError = uiPnl !== 0 ? (absError / Math.abs(uiPnl)) * 100 : 100;

  const analysis: OutlierAnalysis = {
    wallet,
    tag: 'UNKNOWN',
    confidence: 'LOW',
    signals: [],
    recommendation: 'Manual investigation required',
  };

  // If we have forensic signals, use them
  if (signals) {
    // Pattern 1: DATA_MISSING_CLOB
    // High redemptions relative to CLOB events
    if (signals.redemptionCount && signals.clobEventCount) {
      const redemptionRatio = signals.redemptionCount / (signals.clobEventCount || 1);
      if (redemptionRatio > 0.5 && signals.redemptionsWithoutBuys && signals.redemptionsWithoutBuys > 0) {
        analysis.tag = 'DATA_MISSING_CLOB';
        analysis.confidence = 'HIGH';
        analysis.signals.push(`redemption_ratio=${redemptionRatio.toFixed(2)}`);
        analysis.signals.push(`redemptions_without_buys=${signals.redemptionsWithoutBuys}`);
        analysis.recommendation = 'Check if CLOB data ingestion is complete for this wallet';
        return analysis;
      }
    }

    // Pattern 2: Negative inventory suggests proxy or missing data
    if (signals.hasNegativeInventory) {
      analysis.tag = 'PROXY_ATTRIBUTION_SUSPECT';
      analysis.confidence = 'MEDIUM';
      analysis.signals.push('negative_inventory_detected');
      analysis.recommendation = 'Check for proxy contract interactions or split/merge operations';
      return analysis;
    }

    // Pattern 3: Large open positions causing drift
    if (signals.openPositionCount && signals.openPositionCount > 20) {
      analysis.tag = 'OPEN_POSITION_DRIFT';
      analysis.confidence = 'MEDIUM';
      analysis.signals.push(`open_positions=${signals.openPositionCount}`);
      analysis.recommendation = 'Open positions may cause mark-to-market drift between snapshots';
      return analysis;
    }
  }

  // Heuristic patterns based on error direction and magnitude
  const errorDirection = v29Pnl - uiPnl;

  // V29 more negative than UI -> likely missing gains or extra losses in V29
  if (errorDirection < -1000 && pctError > 20) {
    analysis.tag = 'DATA_MISSING_CLOB';
    analysis.confidence = 'MEDIUM';
    analysis.signals.push('v29_more_negative');
    analysis.signals.push(`error_direction=$${errorDirection.toFixed(2)}`);
    analysis.recommendation = 'V29 may be missing profitable trades or including extra losses';
    return analysis;
  }

  // V29 more positive than UI -> likely extra gains or missing losses in V29
  if (errorDirection > 1000 && pctError > 20) {
    analysis.tag = 'VALUATION_EDGE';
    analysis.confidence = 'MEDIUM';
    analysis.signals.push('v29_more_positive');
    analysis.signals.push(`error_direction=+$${errorDirection.toFixed(2)}`);
    analysis.recommendation = 'Check resolution price handling or payout attribution';
    return analysis;
  }

  // Small percentage error but large absolute -> likely open position drift
  if (pctError < 5 && absError > 100) {
    analysis.tag = 'OPEN_POSITION_DRIFT';
    analysis.confidence = 'LOW';
    analysis.signals.push(`abs_error=$${absError.toFixed(2)}`);
    analysis.signals.push(`pct_error=${pctError.toFixed(2)}%`);
    analysis.recommendation = 'Minor drift likely from timing or open positions';
    return analysis;
  }

  // Default unknown
  analysis.signals.push(`abs_error=$${absError.toFixed(2)}`);
  analysis.signals.push(`pct_error=${pctError.toFixed(2)}%`);
  return analysis;
}

export async function analyzeOutlier(
  wallet: string,
  v29Pnl: number,
  uiPnl: number
): Promise<OutlierAnalysis> {
  const signals = await getForensicSignals(wallet);
  return tagOutlier(wallet, v29Pnl, uiPnl, signals || undefined);
}

export function summarizeOutlierTags(analyses: OutlierAnalysis[]): Record<OutlierTag, number> {
  const summary: Record<OutlierTag, number> = {
    DATA_MISSING_CLOB: 0,
    PROXY_ATTRIBUTION_SUSPECT: 0,
    VALUATION_EDGE: 0,
    OPEN_POSITION_DRIFT: 0,
    UNKNOWN: 0,
  };

  for (const a of analyses) {
    summary[a.tag]++;
  }

  return summary;
}

export async function closeConnection() {
  await clickhouse.close();
}
