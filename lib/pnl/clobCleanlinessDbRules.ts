/**
 * CLOB Cleanliness DB Rules
 *
 * Database-first, non-circular cleanliness classification for CLOB-only wallets.
 * These rules determine if a wallet's data is "clean" using ONLY our database,
 * NOT by comparing to UI values (which would be circular).
 *
 * TIERED CLEANLINESS SYSTEM:
 * - TIER_A_PRISTINE: No issues at all (3-5% of wallets typically)
 * - TIER_B_USABLE: Has minor data gaps but unified ledger appears complete (use for leaderboard)
 * - TIER_C_DATA_GAP: Has significant data gaps that likely affect accuracy (exclude from leaderboard)
 *
 * Tags (informational, not exclusive):
 * - DATA_GAP_TRADER_EVENTS_SURPLUS: More events in pm_trader_events_v3 than unified ledger (pipeline delay)
 * - DATA_INTEGRITY_NEGATIVE_INVENTORY: Running inventory goes negative (may indicate missing buys)
 * - DATA_MISSING_CLOB_CONFIRMED: Redemptions without any buy evidence in both sources
 * - SUSPECT_LOW_EVENT_DENSITY: Large PnL but very few events
 *
 * The tier is determined by severity, not just presence of tags:
 * - TIER_A: No tags
 * - TIER_B: Has DATA_GAP_TRADER_EVENTS_SURPLUS or minor DATA_INTEGRITY_NEGATIVE_INVENTORY
 * - TIER_C: Has DATA_MISSING_CLOB_CONFIRMED or SUSPECT_LOW_EVENT_DENSITY or severe negative inventory
 */

import { createClient } from '@clickhouse/client';

export type DbCleanlinessTag =
  | 'DATA_GAP_TRADER_EVENTS_SURPLUS'
  | 'DATA_MISSING_CLOB_CONFIRMED'
  | 'DATA_INTEGRITY_NEGATIVE_INVENTORY'
  | 'SUSPECT_LOW_EVENT_DENSITY'
  | 'PRISTINE';

export type CleanlinessTier = 'TIER_A_PRISTINE' | 'TIER_B_USABLE' | 'TIER_C_DATA_GAP';

export interface DbCleanlinessResult {
  wallet: string;
  tier: CleanlinessTier;
  isUsableForLeaderboard: boolean; // TIER_A or TIER_B
  tags: DbCleanlinessTag[];
  diagnostics: {
    unifiedLedgerClobCount: number;
    traderEventsV2Count: number;
    traderEventsSurplusPercent: number; // (trader - unified) / unified * 100
    redemptionCount: number;
    conditionsWithNegativeInventory: number;
    maxNegativeInventoryDepth: number; // Most negative running balance
    conditionsWithRedemptionNoTrades: number;
    pnlMagnitude: number;
    eventDensityRatio: number; // events per $1000 of |PnL|
  };
}

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

/**
 * Classify a wallet's data cleanliness using DB-only rules (non-circular)
 *
 * Uses a tiered system:
 * - TIER_A_PRISTINE: No data issues detected
 * - TIER_B_USABLE: Minor issues (trader events surplus, small negative inventory) - still usable
 * - TIER_C_DATA_GAP: Significant issues that likely affect accuracy
 */
export async function classifyClobCleanlinessDb(wallet: string): Promise<DbCleanlinessResult> {
  const walletLower = wallet.toLowerCase();
  const tags: DbCleanlinessTag[] = [];

  // 1. Get CLOB event counts from both sources
  const coverageQuery = `
    SELECT
      -- Unified ledger CLOB events
      (SELECT countDistinct(event_id)
       FROM pm_unified_ledger_v8_tbl
       WHERE wallet_address = {wallet:String} AND source_type = 'CLOB'
      ) as unified_clob_count,

      -- Raw trader events (deduplicated by event_id)
      (SELECT count(DISTINCT event_id)
       FROM pm_trader_events_v3
       WHERE trader_wallet = {wallet:String}
      ) as trader_events_count,

      -- Redemption count in unified ledger
      (SELECT count()
       FROM pm_unified_ledger_v8_tbl
       WHERE wallet_address = {wallet:String} AND source_type = 'PayoutRedemption'
      ) as redemption_count,

      -- Total PnL magnitude from unified ledger
      (SELECT abs(sum(
         CASE
           WHEN payout_norm IS NOT NULL AND payout_norm >= 0
           THEN usdc_delta + (token_delta * payout_norm)
           ELSE usdc_delta
         END
       ))
       FROM pm_unified_ledger_v8_tbl
       WHERE wallet_address = {wallet:String}
      ) as pnl_magnitude
  `;

  const coverageResult = await clickhouse.query({
    query: coverageQuery,
    query_params: { wallet: walletLower },
    format: 'JSONEachRow',
  });
  const coverageRows = await coverageResult.json() as any[];
  const coverage = coverageRows[0];

  const unifiedClobCount = Number(coverage.unified_clob_count);
  const traderEventsCount = Number(coverage.trader_events_count);
  const redemptionCount = Number(coverage.redemption_count);
  const pnlMagnitude = Number(coverage.pnl_magnitude) || 0;

  // Calculate trader events surplus percentage
  const traderEventsSurplusPercent = unifiedClobCount > 0
    ? ((traderEventsCount - unifiedClobCount) / unifiedClobCount) * 100
    : (traderEventsCount > 0 ? 100 : 0);

  // Calculate event density: events per $1000 of |PnL|
  const eventDensityRatio = pnlMagnitude > 0
    ? (unifiedClobCount / (pnlMagnitude / 1000))
    : 0;

  // 2. Check for negative inventory anomalies - get the MOST negative
  const inventoryQuery = `
    SELECT
      count() as conditions_count,
      min(min_running) as worst_negative
    FROM (
      SELECT
        condition_id,
        outcome_index,
        min(runningSum) as min_running
      FROM (
        SELECT
          condition_id,
          outcome_index,
          token_delta,
          sum(token_delta) OVER (
            PARTITION BY condition_id, outcome_index
            ORDER BY event_time
          ) as runningSum
        FROM pm_unified_ledger_v8_tbl
        WHERE wallet_address = {wallet:String}
      )
      GROUP BY condition_id, outcome_index
      HAVING min_running < -0.01  -- Allow small tolerance for rounding
    )
  `;

  const inventoryResult = await clickhouse.query({
    query: inventoryQuery,
    query_params: { wallet: walletLower },
    format: 'JSONEachRow',
  });
  const inventoryRows = await inventoryResult.json() as any[];
  const inventoryData = inventoryRows[0];
  const conditionsWithNegativeInventory = Number(inventoryData?.conditions_count || 0);
  const maxNegativeInventoryDepth = Number(inventoryData?.worst_negative || 0);

  // 3. Check redemption coherence - redemptions without buy evidence in BOTH sources
  const redemptionCoherenceQuery = `
    SELECT count() as orphan_redemptions
    FROM (
      -- Conditions with redemptions
      SELECT DISTINCT condition_id
      FROM pm_unified_ledger_v8_tbl
      WHERE wallet_address = {wallet:String} AND source_type = 'PayoutRedemption'
    ) r
    LEFT JOIN (
      -- Conditions with buys in unified ledger
      SELECT DISTINCT condition_id
      FROM pm_unified_ledger_v8_tbl
      WHERE wallet_address = {wallet:String} AND source_type = 'CLOB' AND token_delta > 0
    ) u ON r.condition_id = u.condition_id
    LEFT JOIN (
      -- Conditions with buys in trader_events_v2
      SELECT DISTINCT lower(substring(token_id, 1, 64)) as condition_id
      FROM pm_trader_events_v3
      WHERE trader_wallet = {wallet:String} AND side = 'BUY'
    ) t ON r.condition_id = t.condition_id
    WHERE u.condition_id IS NULL AND t.condition_id IS NULL
  `;

  const redemptionCoherenceResult = await clickhouse.query({
    query: redemptionCoherenceQuery,
    query_params: { wallet: walletLower },
    format: 'JSONEachRow',
  });
  const redemptionCoherenceRows = await redemptionCoherenceResult.json() as any[];
  const redemptionCoherence = redemptionCoherenceRows[0];
  const conditionsWithRedemptionNoTrades = Number(redemptionCoherence?.orphan_redemptions || 0);

  // Build diagnostics
  const diagnostics = {
    unifiedLedgerClobCount: unifiedClobCount,
    traderEventsV2Count: traderEventsCount,
    traderEventsSurplusPercent,
    redemptionCount,
    conditionsWithNegativeInventory,
    maxNegativeInventoryDepth,
    conditionsWithRedemptionNoTrades,
    pnlMagnitude,
    eventDensityRatio,
  };

  // Apply tagging rules:

  // Tag 1: Trader events surplus (more in trader_events than unified ledger)
  // This is informational - it's a pipeline delay, not necessarily accuracy-affecting
  if (traderEventsSurplusPercent > 10 && traderEventsCount - unifiedClobCount > 10) {
    tags.push('DATA_GAP_TRADER_EVENTS_SURPLUS');
  }

  // Tag 2: Negative inventory (sells without buys)
  // Only tag if it's significant (more than 1 condition OR deep negative)
  if (conditionsWithNegativeInventory > 0 && (conditionsWithNegativeInventory > 5 || maxNegativeInventoryDepth < -10)) {
    tags.push('DATA_INTEGRITY_NEGATIVE_INVENTORY');
  }

  // Tag 3: Redemptions without ANY buy evidence in BOTH sources (serious)
  if (conditionsWithRedemptionNoTrades > 0) {
    tags.push('DATA_MISSING_CLOB_CONFIRMED');
  }

  // Tag 4: Event density sanity check
  // If |PnL| > $10,000 but less than 5 events, something is very suspicious
  if (pnlMagnitude > 10000 && unifiedClobCount < 5 && eventDensityRatio < 0.2) {
    tags.push('SUSPECT_LOW_EVENT_DENSITY');
  }

  // If no issues found, it's pristine
  if (tags.length === 0) {
    tags.push('PRISTINE');
  }

  // Determine tier based on tag severity
  let tier: CleanlinessTier;

  // Serious data issues that exclude from leaderboard
  const hasSeriousTags = tags.includes('DATA_MISSING_CLOB_CONFIRMED') ||
                         tags.includes('SUSPECT_LOW_EVENT_DENSITY') ||
                         (tags.includes('DATA_INTEGRITY_NEGATIVE_INVENTORY') && maxNegativeInventoryDepth < -100);

  // Large trader_events surplus (>100% = 2x more events) is also serious
  // This means the unified ledger is missing MORE THAN HALF of the wallet's trades
  const hasLargeEventGap = traderEventsSurplusPercent > 100;

  if (tags.length === 1 && tags[0] === 'PRISTINE') {
    tier = 'TIER_A_PRISTINE';
  } else if (hasSeriousTags || hasLargeEventGap) {
    tier = 'TIER_C_DATA_GAP';
  } else {
    // Only has minor tags like small DATA_GAP_TRADER_EVENTS_SURPLUS or mild negative inventory
    tier = 'TIER_B_USABLE';
  }

  const isUsableForLeaderboard = tier === 'TIER_A_PRISTINE' || tier === 'TIER_B_USABLE';

  return {
    wallet,
    tier,
    isUsableForLeaderboard,
    tags,
    diagnostics,
  };
}

/**
 * Batch classify multiple wallets
 */
export async function batchClassifyClobCleanliness(wallets: string[]): Promise<DbCleanlinessResult[]> {
  const results: DbCleanlinessResult[] = [];
  for (const wallet of wallets) {
    const result = await classifyClobCleanlinessDb(wallet);
    results.push(result);
  }
  return results;
}

/**
 * Get detailed per-condition coverage comparison between unified ledger and trader_events_v2
 */
export async function getConditionCoverageAudit(wallet: string): Promise<{
  primaryOnly: number;
  traderEventsOnly: number;
  both: number;
  neither: number;
  details: Array<{
    conditionId: string;
    inUnified: boolean;
    inTraderEvents: boolean;
  }>;
}> {
  const walletLower = wallet.toLowerCase();

  // Get conditions from unified ledger
  const unifiedConditions = await clickhouse.query({
    query: `
      SELECT DISTINCT condition_id
      FROM pm_unified_ledger_v8_tbl
      WHERE wallet_address = {wallet:String} AND source_type = 'CLOB'
    `,
    query_params: { wallet: walletLower },
    format: 'JSONEachRow',
  });
  const unifiedConditionsRows = await unifiedConditions.json() as any[];
  const unifiedSet = new Set(unifiedConditionsRows.map(r => r.condition_id));

  // Get conditions from trader_events_v2 (need to extract condition_id from token_id)
  // token_id format: condition_id (64 hex chars) + outcome_index
  const traderConditions = await clickhouse.query({
    query: `
      SELECT DISTINCT lower(substring(token_id, 1, 64)) as condition_id
      FROM pm_trader_events_v3
      WHERE trader_wallet = {wallet:String}
    `,
    query_params: { wallet: walletLower },
    format: 'JSONEachRow',
  });
  const traderConditionsRows = await traderConditions.json() as any[];
  const traderSet = new Set(traderConditionsRows.map(r => r.condition_id));

  // Get all conditions from redemptions (may reveal missing trade data)
  const redemptionConditions = await clickhouse.query({
    query: `
      SELECT DISTINCT condition_id
      FROM pm_unified_ledger_v8_tbl
      WHERE wallet_address = {wallet:String} AND source_type = 'PayoutRedemption'
    `,
    query_params: { wallet: walletLower },
    format: 'JSONEachRow',
  });
  const redemptionConditionsRows = await redemptionConditions.json() as any[];
  const redemptionSet = new Set(redemptionConditionsRows.map(r => r.condition_id));

  // Combine all known conditions
  const allConditions = new Set([...unifiedSet, ...traderSet, ...redemptionSet]);

  let primaryOnly = 0;
  let traderEventsOnly = 0;
  let both = 0;
  let neither = 0;
  const details: Array<{ conditionId: string; inUnified: boolean; inTraderEvents: boolean }> = [];

  for (const cid of allConditions) {
    const inUnified = unifiedSet.has(cid);
    const inTrader = traderSet.has(cid);

    if (inUnified && inTrader) {
      both++;
    } else if (inUnified && !inTrader) {
      primaryOnly++;
    } else if (!inUnified && inTrader) {
      traderEventsOnly++;
    } else {
      neither++; // Only in redemptions, not in either trade source
    }

    details.push({ conditionId: cid, inUnified, inTraderEvents: inTrader });
  }

  return { primaryOnly, traderEventsOnly, both, neither, details };
}

export async function closeConnection() {
  await clickhouse.close();
}
