/**
 * Overnight V1+ Validation Script
 *
 * Tests 500+ wallets stratified by multiple dimensions:
 *
 * By Role:
 * - maker_heavy (>70% maker trades)
 * - taker_heavy (>70% taker trades)
 * - mixed (neither dominates)
 *
 * By NegRisk Activity:
 * - negrisk_heavy (>100 conversions)
 * - negrisk_light (1-100 conversions)
 * - no_negrisk (0 conversions)
 *
 * By Position Status:
 * - only_closed (all positions resolved)
 * - has_open (has unresolved positions)
 *
 * By CTF Activity:
 * - split_heavy (has CTF splits/merges)
 *
 * By Volume:
 * - high_volume (>$100k)
 * - medium_volume ($10k-$100k)
 * - low_volume (<$10k)
 *
 * Compares V1, V1+, and API results
 * Outputs detailed JSON report
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';
import * as fs from 'fs';

const TOTAL_WALLETS = 500;
const BATCH_SIZE = 10;
const API_DELAY_MS = 200; // Rate limit protection

interface WalletResult {
  wallet: string;
  walletType: string;
  negriskCount: number;
  tradeCount: number;
  volume: number;
  extraInfo?: string;
  // Confidence indicators
  openPositionCount: number;
  negriskPct: number;
  ctfEventCount: number;
  confidence: 'high' | 'medium' | 'low';
  recommendedEngine: 'V1' | 'V1+' | 'API';
  // PnL results
  v1Pnl: number;
  v1PlusPnl: number;
  v1PlusRealizedPnl: number;    // Only resolved positions
  v1PlusUnrealizedPnl: number;  // Open positions at mark
  apiPnl: number | null;
  v1Error: number | null;
  v1PlusError: number | null;
  v1PlusImprovement: number | null;
  status: 'PASS' | 'CLOSE' | 'FAIL' | 'API_ERROR';
  timestamp: string;
}

interface ValidationReport {
  startTime: string;
  endTime: string;
  totalWallets: number;
  walletsProcessed: number;
  walletsFailed: number;
  byType: Record<string, {
    count: number;
    v1PassRate: number;
    v1PlusPassRate: number;
    avgV1Error: number;
    avgV1PlusError: number;
    improvement: number;
  }>;
  byConfidence: Record<string, {
    count: number;
    v1PassRate: number;
    v1PlusPassRate: number;
    avgV1Error: number;
    avgV1PlusError: number;
  }>;
  byRecommendedEngine: Record<string, {
    count: number;
    v1PassRate: number;
    v1PlusPassRate: number;
    correctRecommendation: number;  // % where recommended engine was best
  }>;
  summary: {
    v1PassCount: number;
    v1PlusPassCount: number;
    v1PassRate: number;
    v1PlusPassRate: number;
    avgV1Error: number;
    avgV1PlusError: number;
    overallImprovement: number;
    highConfidencePassRate: number;
    mediumConfidencePassRate: number;
    lowConfidencePassRate: number;
  };
  results: WalletResult[];
}

async function selectStratifiedWallets(count: number): Promise<Array<{wallet: string, type: string, negrisk: number, trades: number, volume: number, extraInfo?: string}>> {
  console.log(`\nSelecting ${count} stratified wallets across multiple dimensions...`);

  const wallets: Array<{wallet: string, type: string, negrisk: number, trades: number, volume: number, extraInfo?: string}> = [];

  // === BY ROLE ===
  // Sample from recent trades to reduce scan size

  // Maker-heavy wallets (>70% maker trades)
  const makerHeavyQuery = `
    SELECT
      lower(trader_wallet) as wallet,
      0 as negrisk_count,
      count() as trade_count,
      sum(usdc_amount) / 1e6 as volume,
      countIf(role = 'maker') / count() as maker_pct
    FROM pm_trader_events_v3
    WHERE trade_time > now() - INTERVAL 180 DAY
    GROUP BY wallet
    HAVING trade_count >= 20 AND maker_pct > 0.7
    ORDER BY rand()
    LIMIT 50
  `;

  // Taker-heavy wallets (>70% taker trades)
  const takerHeavyQuery = `
    SELECT
      lower(trader_wallet) as wallet,
      0 as negrisk_count,
      count() as trade_count,
      sum(usdc_amount) / 1e6 as volume,
      countIf(role = 'taker') / count() as taker_pct
    FROM pm_trader_events_v3
    WHERE trade_time > now() - INTERVAL 180 DAY
    GROUP BY wallet
    HAVING trade_count >= 20 AND taker_pct > 0.7
    ORDER BY rand()
    LIMIT 50
  `;

  // Mixed wallets (neither maker nor taker dominant)
  const mixedRoleQuery = `
    SELECT
      lower(trader_wallet) as wallet,
      0 as negrisk_count,
      count() as trade_count,
      sum(usdc_amount) / 1e6 as volume,
      countIf(role = 'maker') / count() as maker_pct
    FROM pm_trader_events_v3
    WHERE trade_time > now() - INTERVAL 180 DAY
    GROUP BY wallet
    HAVING trade_count >= 20 AND maker_pct BETWEEN 0.3 AND 0.7
    ORDER BY rand()
    LIMIT 50
  `;

  // === BY NEGRISK ACTIVITY ===
  // Use subquery to ensure wallets have CLOB trades

  // NegRisk-heavy wallets (>100 conversions) with CLOB activity
  const negriskHeavyQuery = `
    WITH nr AS (
      SELECT lower(user_address) as wallet, count() as negrisk_count
      FROM pm_neg_risk_conversions_v1
      WHERE is_deleted = 0
      GROUP BY wallet
      HAVING negrisk_count > 100
    ),
    traders AS (
      SELECT lower(trader_wallet) as wallet
      FROM pm_trader_events_v3
      GROUP BY wallet
      HAVING count() >= 10
    )
    SELECT n.wallet, n.negrisk_count, 0 as trade_count, 0 as volume
    FROM nr n
    WHERE n.wallet IN (SELECT wallet FROM traders)
    ORDER BY rand()
    LIMIT 50
  `;

  // NegRisk-light wallets (1-100 conversions) with CLOB activity
  const negriskLightQuery = `
    WITH nr AS (
      SELECT lower(user_address) as wallet, count() as negrisk_count
      FROM pm_neg_risk_conversions_v1
      WHERE is_deleted = 0
      GROUP BY wallet
      HAVING negrisk_count BETWEEN 1 AND 100
    ),
    traders AS (
      SELECT lower(trader_wallet) as wallet
      FROM pm_trader_events_v3
      GROUP BY wallet
      HAVING count() >= 10
    )
    SELECT n.wallet, n.negrisk_count, 0 as trade_count, 0 as volume
    FROM nr n
    WHERE n.wallet IN (SELECT wallet FROM traders)
    ORDER BY rand()
    LIMIT 50
  `;

  // No NegRisk wallets - sample from active traders not in NegRisk
  const noNegriskQuery = `
    WITH negrisk_wallets AS (
      SELECT DISTINCT lower(user_address) as wallet
      FROM pm_neg_risk_conversions_v1
      WHERE is_deleted = 0
    )
    SELECT
      lower(trader_wallet) as wallet,
      0 as negrisk_count,
      count() as trade_count,
      sum(usdc_amount) / 1e6 as volume
    FROM pm_trader_events_v3
    WHERE lower(trader_wallet) NOT IN (SELECT wallet FROM negrisk_wallets)
    GROUP BY wallet
    HAVING trade_count >= 10
    ORDER BY rand()
    LIMIT 50
  `;

  // === BY POSITION STATUS ===
  // Optimized: Use pre-aggregated wallet data, avoid full table scans

  // Only closed positions - sample wallets with only old trades (likely resolved)
  const onlyClosedQuery = `
    SELECT
      lower(trader_wallet) as wallet,
      0 as negrisk_count,
      count() as trade_count,
      sum(usdc_amount) / 1e6 as volume
    FROM pm_trader_events_v3
    WHERE trade_time < now() - INTERVAL 90 DAY
    GROUP BY wallet
    HAVING trade_count >= 10 AND trade_count <= 200
    ORDER BY rand()
    LIMIT 50
  `;

  // Has open positions - sample wallets with recent trades (likely have open positions)
  const hasOpenQuery = `
    SELECT
      lower(trader_wallet) as wallet,
      0 as negrisk_count,
      count() as trade_count,
      sum(usdc_amount) / 1e6 as volume
    FROM pm_trader_events_v3
    WHERE trade_time > now() - INTERVAL 30 DAY
    GROUP BY wallet
    HAVING trade_count >= 5
    ORDER BY rand()
    LIMIT 50
  `;

  // === BY CTF ACTIVITY ===

  // Split/merge heavy wallets - ensure they also have CLOB trades
  const splitHeavyQuery = `
    WITH ctf AS (
      SELECT lower(user_address) as wallet, count() as ctf_count
      FROM pm_ctf_events
      WHERE event_type IN ('PositionSplit', 'PositionsMerge') AND is_deleted = 0
      GROUP BY wallet
      HAVING ctf_count > 10
    ),
    traders AS (
      SELECT lower(trader_wallet) as wallet
      FROM pm_trader_events_v3
      GROUP BY wallet
      HAVING count() >= 10
    )
    SELECT c.wallet, 0 as negrisk_count, 0 as trade_count, 0 as volume, c.ctf_count
    FROM ctf c
    WHERE c.wallet IN (SELECT wallet FROM traders)
    ORDER BY rand()
    LIMIT 50
  `;

  // === BY VOLUME ===
  // Note: These queries scan full table but are necessary for volume stratification

  // High volume (>$100k) - limit source rows
  const highVolumeQuery = `
    SELECT
      lower(trader_wallet) as wallet,
      0 as negrisk_count,
      count() as trade_count,
      sum(usdc_amount) / 1e6 as volume
    FROM pm_trader_events_v3
    WHERE usdc_amount > 10000000  -- >$10 trades only for high volume wallets
    GROUP BY wallet
    HAVING trade_count >= 20 AND volume > 100000
    ORDER BY rand()
    LIMIT 50
  `;

  // Medium volume ($10k-$100k)
  const mediumVolumeQuery = `
    SELECT
      lower(trader_wallet) as wallet,
      0 as negrisk_count,
      count() as trade_count,
      sum(usdc_amount) / 1e6 as volume
    FROM pm_trader_events_v3
    WHERE usdc_amount > 1000000  -- >$1 trades
    GROUP BY wallet
    HAVING trade_count >= 10 AND volume BETWEEN 10000 AND 100000
    ORDER BY rand()
    LIMIT 50
  `;

  // Low volume (<$10k)
  const lowVolumeQuery = `
    SELECT
      lower(trader_wallet) as wallet,
      0 as negrisk_count,
      count() as trade_count,
      sum(usdc_amount) / 1e6 as volume
    FROM pm_trader_events_v3
    GROUP BY wallet
    HAVING trade_count BETWEEN 5 AND 50 AND volume BETWEEN 100 AND 10000
    ORDER BY rand()
    LIMIT 50
  `;

  // Execute all queries
  const queries = [
    // By Role
    { query: makerHeavyQuery, type: 'maker_heavy' },
    { query: takerHeavyQuery, type: 'taker_heavy' },
    { query: mixedRoleQuery, type: 'mixed_role' },
    // By NegRisk
    { query: negriskHeavyQuery, type: 'negrisk_heavy' },
    { query: negriskLightQuery, type: 'negrisk_light' },
    { query: noNegriskQuery, type: 'no_negrisk' },
    // By Position Status
    { query: onlyClosedQuery, type: 'only_closed' },
    { query: hasOpenQuery, type: 'has_open' },
    // By CTF Activity
    { query: splitHeavyQuery, type: 'split_heavy' },
    // By Volume
    { query: highVolumeQuery, type: 'high_volume' },
    { query: mediumVolumeQuery, type: 'medium_volume' },
    { query: lowVolumeQuery, type: 'low_volume' },
  ];

  for (const { query, type } of queries) {
    try {
      const result = await clickhouse.query({ query, format: 'JSONEachRow' });
      const rows = await result.json() as any[];
      console.log(`  ${type}: found ${rows.length} wallets`);

      for (const row of rows) {
        wallets.push({
          wallet: row.wallet,
          type,
          negrisk: Number(row.negrisk_count) || 0,
          trades: Number(row.trade_count) || 0,
          volume: Number(row.volume) || 0,
          extraInfo: row.ctf_count ? `ctf:${row.ctf_count}` :
                    row.open_conditions ? `open:${row.open_conditions}` :
                    row.maker_pct ? `maker:${Math.round(row.maker_pct * 100)}%` :
                    row.taker_pct ? `taker:${Math.round(row.taker_pct * 100)}%` : undefined,
        });
      }
    } catch (err) {
      console.error(`  Error fetching ${type}:`, err);
    }
  }

  // Dedupe by wallet address (same wallet may appear in multiple categories)
  const seen = new Set<string>();
  const deduped = wallets.filter(w => {
    if (seen.has(w.wallet)) return false;
    seen.add(w.wallet);
    return true;
  });

  console.log(`\n  Total unique wallets: ${deduped.length}`);

  // Shuffle and take requested count
  const shuffled = deduped.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

async function getApiPnL(wallet: string): Promise<number | null> {
  try {
    const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
    if (res.ok) {
      const data = await res.json() as Array<{ t: number; p: number }>;
      if (data && data.length > 0) {
        const sorted = [...data].sort((a, b) => b.t - a.t);
        return sorted[0].p || 0;
      }
    }
  } catch {}
  return null;
}

interface ConfidenceIndicators {
  openPositionCount: number;
  negriskPct: number;
  ctfEventCount: number;
}

async function getConfidenceIndicators(wallet: string): Promise<ConfidenceIndicators> {
  const query = `
    WITH
      -- Get all conditions the wallet has traded
      wallet_conditions AS (
        SELECT DISTINCT m.condition_id
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = '${wallet}' AND m.condition_id != ''
      ),
      -- Check which are resolved
      resolved AS (
        SELECT DISTINCT condition_id FROM pm_condition_resolutions WHERE is_deleted = 0
      ),
      -- Check which are NegRisk (multi-outcome markets)
      negrisk AS (
        SELECT condition_id FROM pm_market_metadata GROUP BY condition_id HAVING count() > 1
      ),
      -- CTF events for this wallet
      ctf AS (
        SELECT count() as cnt FROM pm_ctf_events
        WHERE lower(user_address) = '${wallet}'
          AND event_type IN ('PositionSplit', 'PositionsMerge')
          AND is_deleted = 0
      )
    SELECT
      countIf(wc.condition_id NOT IN (SELECT condition_id FROM resolved)) as open_positions,
      countIf(wc.condition_id IN (SELECT condition_id FROM negrisk)) as negrisk_conditions,
      count() as total_conditions,
      (SELECT cnt FROM ctf) as ctf_events
    FROM wallet_conditions wc
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json() as any[];
    const row = rows[0] || {};

    const totalConditions = Number(row.total_conditions) || 1;
    const negriskConditions = Number(row.negrisk_conditions) || 0;

    return {
      openPositionCount: Number(row.open_positions) || 0,
      negriskPct: Math.round((negriskConditions / totalConditions) * 100),
      ctfEventCount: Number(row.ctf_events) || 0,
    };
  } catch {
    return { openPositionCount: 0, negriskPct: 0, ctfEventCount: 0 };
  }
}

function computeConfidence(indicators: ConfidenceIndicators): { confidence: 'high' | 'medium' | 'low'; recommendedEngine: 'V1' | 'V1+' | 'API' } {
  const { openPositionCount, negriskPct, ctfEventCount } = indicators;

  // Confidence tiers based on docs/READ_ME_FIRST_PNL.md
  // High: 0 open positions, low NegRisk
  // Medium: 1-10 open positions OR moderate NegRisk
  // Low: 11+ open positions OR heavy NegRisk/CTF

  let confidence: 'high' | 'medium' | 'low';
  let recommendedEngine: 'V1' | 'V1+' | 'API';

  if (openPositionCount === 0 && negriskPct < 5 && ctfEventCount < 10) {
    confidence = 'high';
    recommendedEngine = 'V1';
  } else if (openPositionCount === 0 && negriskPct >= 5) {
    confidence = 'high';
    recommendedEngine = 'V1+';  // NegRisk needs V1+
  } else if (openPositionCount <= 10) {
    confidence = 'medium';
    recommendedEngine = negriskPct >= 5 ? 'V1+' : 'V1';
  } else {
    confidence = 'low';
    recommendedEngine = 'API';  // Too many open positions, use API
  }

  return { confidence, recommendedEngine };
}

async function calculateV1(wallet: string): Promise<number> {
  const query = `
    WITH
      sf AS (
        SELECT transaction_hash
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) = '${wallet}'
        GROUP BY transaction_hash
        HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
      ),
      clob AS (
        SELECT m.condition_id, m.outcome_index,
          sumIf(t.token_amount / 1e6, t.side = 'buy') - sumIf(t.token_amount / 1e6, t.side = 'sell') as net,
          sumIf(t.usdc_amount / 1e6, t.side = 'sell') - sumIf(t.usdc_amount / 1e6, t.side = 'buy') as cash
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = '${wallet}'
          AND m.condition_id != ''
          AND NOT (t.transaction_hash IN (SELECT transaction_hash FROM sf) AND t.role = 'maker')
        GROUP BY m.condition_id, m.outcome_index
      ),
      resolved AS (
        SELECT c.*, toInt64OrNull(JSONExtractString(r.payout_numerators, c.outcome_index + 1)) = 1 as won
        FROM clob c
        JOIN pm_condition_resolutions r ON c.condition_id = r.condition_id AND r.is_deleted = 0
        WHERE r.payout_numerators IS NOT NULL AND r.payout_numerators != ''
      )
    SELECT round(sum(cash) + sumIf(net, net > 0 AND won) - sumIf(abs(net), net < 0 AND won), 2) as pnl
    FROM resolved
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  return Number(rows[0]?.pnl) || 0;
}

interface V1PlusPnlResult {
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
}

async function calculateV1PlusDetailed(wallet: string): Promise<V1PlusPnlResult> {
  // Simplified query - just realized PnL (no unrealized for speed)
  const query = `
    WITH
      sf AS (
        SELECT transaction_hash
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) = '${wallet}'
        GROUP BY transaction_hash
        HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
      ),
      clob AS (
        SELECT m.condition_id, m.outcome_index,
          sumIf(t.token_amount / 1e6, t.side = 'buy') - sumIf(t.token_amount / 1e6, t.side = 'sell') as clob_net,
          sumIf(t.usdc_amount / 1e6, t.side = 'sell') - sumIf(t.usdc_amount / 1e6, t.side = 'buy') as cash
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = '${wallet}'
          AND m.condition_id != ''
          AND NOT (t.transaction_hash IN (SELECT transaction_hash FROM sf) AND t.role = 'maker')
        GROUP BY m.condition_id, m.outcome_index
      ),
      nr AS (
        SELECT m.condition_id, m.outcome_index, sum(v.shares) as nr_tokens
        FROM vw_negrisk_conversions v
        JOIN pm_token_to_condition_map_v5 m ON
          toString(reinterpretAsUInt256(reverse(unhex(substring(v.token_id_hex, 3))))) = m.token_id_dec
        WHERE v.wallet = '${wallet}' AND m.condition_id != ''
        GROUP BY m.condition_id, m.outcome_index
      ),
      combined AS (
        SELECT
          COALESCE(c.condition_id, n.condition_id) as condition_id,
          COALESCE(c.outcome_index, n.outcome_index) as outcome_index,
          COALESCE(c.clob_net, 0) + COALESCE(n.nr_tokens, 0) as net,
          COALESCE(c.cash, 0) as cash
        FROM clob c
        FULL OUTER JOIN nr n ON c.condition_id = n.condition_id AND c.outcome_index = n.outcome_index
      ),
      resolved AS (
        SELECT p.condition_id, p.outcome_index, p.net, p.cash,
          toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)) = 1 as won
        FROM combined p
        JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id AND r.is_deleted = 0
        WHERE r.payout_numerators IS NOT NULL AND r.payout_numerators != ''
      )
    SELECT round(sum(cash) + sumIf(net, net > 0 AND won) - sumIf(abs(net), net < 0 AND won), 2) as realized_pnl
    FROM resolved
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json() as any[];
    const row = rows[0] || {};
    const realized = Number(row.realized_pnl) || 0;
    return {
      realizedPnl: realized,
      unrealizedPnl: 0,  // Skip unrealized for speed
      totalPnl: realized,
    };
  } catch (err) {
    console.error(`  V1+ error for ${wallet.slice(0,10)}:`, err instanceof Error ? err.message : err);
    return { realizedPnl: 0, unrealizedPnl: 0, totalPnl: 0 };
  }
}

async function calculateV1Plus(wallet: string): Promise<number> {
  const result = await calculateV1PlusDetailed(wallet);
  return result.realizedPnl;  // For comparison, use realized only (matches API for closed wallets)
}

async function processWallet(wallet: string, type: string, negrisk: number, trades: number, volume: number, extraInfo?: string): Promise<WalletResult> {
  const timestamp = new Date().toISOString();

  try {
    // Fetch all data in parallel
    const [v1Pnl, v1PlusDetailed, apiPnl, indicators] = await Promise.all([
      calculateV1(wallet),
      calculateV1PlusDetailed(wallet),
      getApiPnL(wallet),
      getConfidenceIndicators(wallet),
    ]);

    const { confidence, recommendedEngine } = computeConfidence(indicators);

    // Use realized PnL for comparison (matches API for closed-only wallets)
    const v1PlusPnl = v1PlusDetailed.realizedPnl;
    const v1Error = apiPnl !== null ? Math.abs(v1Pnl - apiPnl) : null;
    const v1PlusError = apiPnl !== null ? Math.abs(v1PlusPnl - apiPnl) : null;
    const v1PlusImprovement = v1Error !== null && v1PlusError !== null && v1Error > 0
      ? ((v1Error - v1PlusError) / v1Error) * 100
      : null;

    let status: 'PASS' | 'CLOSE' | 'FAIL' | 'API_ERROR';
    if (apiPnl === null) {
      status = 'API_ERROR';
    } else if (v1PlusError !== null && v1PlusError <= 10) {
      status = 'PASS';
    } else if (v1PlusError !== null && v1PlusError <= 100) {
      status = 'CLOSE';
    } else {
      status = 'FAIL';
    }

    return {
      wallet,
      walletType: type,
      negriskCount: negrisk,
      tradeCount: trades,
      volume,
      extraInfo,
      openPositionCount: indicators.openPositionCount,
      negriskPct: indicators.negriskPct,
      ctfEventCount: indicators.ctfEventCount,
      confidence,
      recommendedEngine,
      v1Pnl,
      v1PlusPnl,
      v1PlusRealizedPnl: v1PlusDetailed.realizedPnl,
      v1PlusUnrealizedPnl: v1PlusDetailed.unrealizedPnl,
      apiPnl,
      v1Error,
      v1PlusError,
      v1PlusImprovement,
      status,
      timestamp,
    };
  } catch (err) {
    return {
      wallet,
      walletType: type,
      negriskCount: negrisk,
      tradeCount: trades,
      volume,
      extraInfo,
      openPositionCount: 0,
      negriskPct: 0,
      ctfEventCount: 0,
      confidence: 'low',
      recommendedEngine: 'API',
      v1Pnl: 0,
      v1PlusPnl: 0,
      v1PlusRealizedPnl: 0,
      v1PlusUnrealizedPnl: 0,
      apiPnl: null,
      v1Error: null,
      v1PlusError: null,
      v1PlusImprovement: null,
      status: 'API_ERROR',
      timestamp,
    };
  }
}

function calculateReport(results: WalletResult[], startTime: string): ValidationReport {
  const endTime = new Date().toISOString();
  const withApi = results.filter(r => r.apiPnl !== null);

  // Helper to calculate stats for a group
  const calcStats = (group: WalletResult[]) => {
    const valid = group.filter(w => w.apiPnl !== null);
    const v1Pass = valid.filter(w => w.v1Error !== null && w.v1Error <= 10).length;
    const v1PlusPass = valid.filter(w => w.v1PlusError !== null && w.v1PlusError <= 10).length;
    const avgV1Error = valid.reduce((sum, w) => sum + (w.v1Error || 0), 0) / Math.max(valid.length, 1);
    const avgV1PlusError = valid.reduce((sum, w) => sum + (w.v1PlusError || 0), 0) / Math.max(valid.length, 1);
    return {
      count: group.length,
      v1PassRate: valid.length > 0 ? Math.round((v1Pass / valid.length) * 100 * 10) / 10 : 0,
      v1PlusPassRate: valid.length > 0 ? Math.round((v1PlusPass / valid.length) * 100 * 10) / 10 : 0,
      avgV1Error: Math.round(avgV1Error * 100) / 100,
      avgV1PlusError: Math.round(avgV1PlusError * 100) / 100,
      improvement: avgV1Error > 0 ? Math.round(((avgV1Error - avgV1PlusError) / avgV1Error) * 100 * 10) / 10 : 0,
    };
  };

  // Group by type
  const byType: Record<string, WalletResult[]> = {};
  for (const r of results) {
    if (!byType[r.walletType]) byType[r.walletType] = [];
    byType[r.walletType].push(r);
  }
  const typeStats: Record<string, any> = {};
  for (const [type, wallets] of Object.entries(byType)) {
    typeStats[type] = calcStats(wallets);
  }

  // Group by confidence
  const byConfidence: Record<string, WalletResult[]> = { high: [], medium: [], low: [] };
  for (const r of results) {
    byConfidence[r.confidence].push(r);
  }
  const confStats: Record<string, any> = {};
  for (const [conf, wallets] of Object.entries(byConfidence)) {
    confStats[conf] = calcStats(wallets);
  }

  // Group by recommended engine
  const byEngine: Record<string, WalletResult[]> = { 'V1': [], 'V1+': [], 'API': [] };
  for (const r of results) {
    byEngine[r.recommendedEngine].push(r);
  }
  const engineStats: Record<string, any> = {};
  for (const [engine, wallets] of Object.entries(byEngine)) {
    const valid = wallets.filter(w => w.apiPnl !== null);
    const stats = calcStats(wallets);
    // Calculate if recommendation was correct
    const correct = valid.filter(w => {
      if (engine === 'V1') return (w.v1Error || Infinity) <= 10;
      if (engine === 'V1+') return (w.v1PlusError || Infinity) <= 10;
      return true; // API is always correct
    }).length;
    engineStats[engine] = {
      ...stats,
      correctRecommendation: valid.length > 0 ? Math.round((correct / valid.length) * 100 * 10) / 10 : 0,
    };
  }

  // Overall stats
  const v1Pass = withApi.filter(r => r.v1Error !== null && r.v1Error <= 10).length;
  const v1PlusPass = withApi.filter(r => r.v1PlusError !== null && r.v1PlusError <= 10).length;
  const avgV1Error = withApi.reduce((sum, r) => sum + (r.v1Error || 0), 0) / Math.max(withApi.length, 1);
  const avgV1PlusError = withApi.reduce((sum, r) => sum + (r.v1PlusError || 0), 0) / Math.max(withApi.length, 1);

  // Pass rates by confidence
  const highConf = results.filter(r => r.confidence === 'high' && r.apiPnl !== null);
  const medConf = results.filter(r => r.confidence === 'medium' && r.apiPnl !== null);
  const lowConf = results.filter(r => r.confidence === 'low' && r.apiPnl !== null);

  return {
    startTime,
    endTime,
    totalWallets: TOTAL_WALLETS,
    walletsProcessed: results.length,
    walletsFailed: results.filter(r => r.status === 'API_ERROR').length,
    byType: typeStats,
    byConfidence: confStats,
    byRecommendedEngine: engineStats,
    summary: {
      v1PassCount: v1Pass,
      v1PlusPassCount: v1PlusPass,
      v1PassRate: Math.round((v1Pass / Math.max(withApi.length, 1)) * 100 * 10) / 10,
      v1PlusPassRate: Math.round((v1PlusPass / Math.max(withApi.length, 1)) * 100 * 10) / 10,
      avgV1Error: Math.round(avgV1Error * 100) / 100,
      avgV1PlusError: Math.round(avgV1PlusError * 100) / 100,
      overallImprovement: avgV1Error > 0 ? Math.round(((avgV1Error - avgV1PlusError) / avgV1Error) * 100 * 10) / 10 : 0,
      highConfidencePassRate: highConf.length > 0 ? Math.round((highConf.filter(r => r.v1PlusError !== null && r.v1PlusError <= 10).length / highConf.length) * 100 * 10) / 10 : 0,
      mediumConfidencePassRate: medConf.length > 0 ? Math.round((medConf.filter(r => r.v1PlusError !== null && r.v1PlusError <= 10).length / medConf.length) * 100 * 10) / 10 : 0,
      lowConfidencePassRate: lowConf.length > 0 ? Math.round((lowConf.filter(r => r.v1PlusError !== null && r.v1PlusError <= 10).length / lowConf.length) * 100 * 10) / 10 : 0,
    },
    results,
  };
}

async function main() {
  const startTime = new Date().toISOString();
  console.log('='.repeat(80));
  console.log('V1+ OVERNIGHT VALIDATION');
  console.log(`Started: ${startTime}`);
  console.log(`Target: ${TOTAL_WALLETS} wallets`);
  console.log('='.repeat(80));

  // Select wallets
  const wallets = await selectStratifiedWallets(TOTAL_WALLETS);
  console.log(`\nSelected ${wallets.length} wallets for testing\n`);

  // Process in batches
  const results: WalletResult[] = [];
  let processed = 0;

  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);

    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(wallets.length / BATCH_SIZE)}...`);

    for (const w of batch) {
      const result = await processWallet(w.wallet, w.type, w.negrisk, w.trades, w.volume, w.extraInfo);
      results.push(result);
      processed++;

      // Progress indicator
      const statusIcon = result.status === 'PASS' ? '✓' : result.status === 'CLOSE' ? '~' : result.status === 'FAIL' ? '✗' : '?';
      const confIcon = result.confidence === 'high' ? 'H' : result.confidence === 'medium' ? 'M' : 'L';
      const flags = `[${confIcon}|${result.recommendedEngine}|NR:${result.negriskPct}%|O:${result.openPositionCount}]`;
      const totalPnl = result.v1PlusRealizedPnl + result.v1PlusUnrealizedPnl;
      const pnlStr = result.v1PlusUnrealizedPnl !== 0
        ? `R:$${result.v1PlusRealizedPnl.toFixed(0)}+U:$${result.v1PlusUnrealizedPnl.toFixed(0)}=$${totalPnl.toFixed(0)}`
        : `$${result.v1PlusRealizedPnl.toFixed(0)}`;
      // Show full wallet for first 20, then truncated
      const walletStr = processed <= 20 ? w.wallet : `${w.wallet.slice(0, 10)}...`;
      console.log(`  [${processed}/${wallets.length}] ${statusIcon} ${walletStr} | V1+: ${pnlStr} | API: $${result.apiPnl?.toFixed(0) || 'N/A'} | ${result.walletType} ${flags}`);

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, API_DELAY_MS));
    }

    // Save intermediate results every 50 wallets
    if (processed % 50 === 0) {
      const intermediateReport = calculateReport(results, startTime);
      const filename = `scripts/overnight-v1plus-intermediate-${processed}.json`;
      fs.writeFileSync(filename, JSON.stringify(intermediateReport, null, 2));
      console.log(`\n  Intermediate save: ${filename}`);
      console.log(`  Current V1+ pass rate: ${intermediateReport.summary.v1PlusPassRate}%\n`);
    }
  }

  // Calculate final report
  const report = calculateReport(results, startTime);

  // Save final results
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `scripts/overnight-v1plus-results-${timestamp}.json`;
  fs.writeFileSync(filename, JSON.stringify(report, null, 2));

  // Print summary
  console.log('\n' + '='.repeat(80));
  console.log('FINAL SUMMARY');
  console.log('='.repeat(80));
  console.log(`\nTotal processed: ${report.walletsProcessed}`);
  console.log(`API errors: ${report.walletsFailed}`);

  console.log(`\nOVERALL RESULTS:`);
  console.log(`  V1 Pass Rate:   ${report.summary.v1PassRate}% (${report.summary.v1PassCount} wallets)`);
  console.log(`  V1+ Pass Rate:  ${report.summary.v1PlusPassRate}% (${report.summary.v1PlusPassCount} wallets)`);
  console.log(`  Improvement:    ${report.summary.overallImprovement}%`);

  console.log(`\nBY CONFIDENCE TIER:`);
  console.log(`  High:   ${report.summary.highConfidencePassRate}% pass (${report.byConfidence.high?.count || 0} wallets)`);
  console.log(`  Medium: ${report.summary.mediumConfidencePassRate}% pass (${report.byConfidence.medium?.count || 0} wallets)`);
  console.log(`  Low:    ${report.summary.lowConfidencePassRate}% pass (${report.byConfidence.low?.count || 0} wallets)`);

  console.log(`\nBY RECOMMENDED ENGINE:`);
  for (const [engine, stats] of Object.entries(report.byRecommendedEngine)) {
    console.log(`  ${engine}: ${stats.count} wallets | V1+: ${stats.v1PlusPassRate}% | Correct recommendation: ${stats.correctRecommendation}%`);
  }

  console.log(`\nBY WALLET TYPE:`);
  for (const [type, stats] of Object.entries(report.byType)) {
    console.log(`  ${type}: ${stats.count} | V1: ${stats.v1PassRate.toFixed(1)}% | V1+: ${stats.v1PlusPassRate.toFixed(1)}%`);
  }

  console.log(`\nResults saved to: ${filename}`);
  console.log(`Completed: ${report.endTime}`);
}

main().catch(console.error);
