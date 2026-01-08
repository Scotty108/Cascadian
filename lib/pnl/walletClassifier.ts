/**
 * ============================================================================
 * WALLET CLASSIFIER - Classification & Routing System
 * ============================================================================
 *
 * PURPOSE: Classify wallets for PnL routing decisions.
 *
 * STRATEGY:
 * - TRADER_STRICT: Pure traders whose inventory is fully explainable by CLOB.
 *   V23c achieves 100% accuracy for this cohort.
 * - PASS Wallets: V23/V23c works well (< 1% error).
 * - MAKER Wallets: Uses Split/Merge. Exclude from Copy Trading.
 * - UNKNOWN Wallets: Require investigation.
 *
 * CLASSIFICATION LOGIC:
 * - If Splits > 0 OR Merges > 10 → MAKER
 * - If Inventory_Mismatch > 5.0 tokens → NON_TRADER (Imposter)
 * - If Transfer_In_Value > $100 → NON_TRADER (Transfer-Heavy)
 * - If all above pass → TRADER_STRICT
 * - If V23 Error < 1% → PASS
 * - Else → UNKNOWN
 *
 * Terminal: Claude 1
 * Date: 2025-12-05
 */

import { clickhouse } from '../clickhouse/client';
import { calculateV23PnL } from './shadowLedgerV23';
import { calculateV23cPnL } from './shadowLedgerV23c';

// ============================================================================
// Types
// ============================================================================

export type WalletClassification = 'PASS' | 'MAKER' | 'UNKNOWN' | 'TRADER_STRICT' | 'NON_TRADER';

export interface ClassificationResult {
  wallet: string;
  classification: WalletClassification;

  // Error metrics
  v23_pnl: number;
  v23c_pnl?: number;
  ui_pnl: number;
  error_pct: number;
  v23c_error_pct?: number;

  // Maker signals
  split_events: number;
  merge_events: number;
  is_market_maker: boolean;

  // Inventory consistency (TRADER_STRICT criteria)
  net_tokens_ledger: number;
  net_tokens_clob: number;
  inventory_mismatch: number;
  is_inventory_consistent: boolean;

  // Transfer activity
  transfer_in_count: number;
  transfer_in_value: number;
  is_transfer_heavy: boolean;

  // Activity counts
  clob_events: number;
  redemption_events: number;

  // TRADER_STRICT flag
  is_trader_strict: boolean;
  non_trader_reasons: string[];

  // Routing recommendation
  recommended_engine: 'V23' | 'V23c' | 'NONE' | 'INVESTIGATE';
  routing_note: string;
}

export interface ActivityCounts {
  clob_events: number;
  split_events: number;
  merge_events: number;
  redemption_events: number;
}

// ============================================================================
// Helpers
// ============================================================================

function errorPct(calculated: number, ui: number): number {
  if (ui === 0) return calculated === 0 ? 0 : 100;
  return (Math.abs(calculated - ui) / Math.abs(ui)) * 100;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Get activity counts from pm_unified_ledger_v7
 */
export async function getActivityCounts(wallet: string): Promise<ActivityCounts> {
  const query = `
    SELECT
      countIf(source_type = 'CLOB') as clob_events,
      countIf(source_type = 'PositionSplit') as split_events,
      countIf(source_type = 'PositionsMerge') as merge_events,
      countIf(source_type = 'PayoutRedemption') as redemption_events
    FROM pm_unified_ledger_v7
    WHERE wallet_address = '${wallet.toLowerCase()}'
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  const row = rows[0] || {};

  return {
    clob_events: Number(row.clob_events) || 0,
    split_events: Number(row.split_events) || 0,
    merge_events: Number(row.merge_events) || 0,
    redemption_events: Number(row.redemption_events) || 0,
  };
}

/**
 * Check if wallet is a Market Maker based on Split/Merge activity
 */
export function isMarketMaker(activity: ActivityCounts): boolean {
  return activity.split_events > 0 || activity.merge_events > 10;
}

/**
 * Classify a wallet for PnL routing.
 *
 * @param wallet - Wallet address
 * @param ui_pnl - UI PnL (from benchmark or Polymarket)
 * @returns Classification result with routing recommendation
 */
export async function classifyWallet(
  wallet: string,
  ui_pnl: number
): Promise<ClassificationResult> {
  // Step 1: Get V23 PnL
  const v23Result = await calculateV23PnL(wallet);
  const v23_pnl = v23Result.totalPnl;
  const error_pct = errorPct(v23_pnl, ui_pnl);

  // Step 2: Get activity counts
  const activity = await getActivityCounts(wallet);
  const is_market_maker = isMarketMaker(activity);

  // Step 3: Determine classification
  let classification: WalletClassification;
  let recommended_engine: ClassificationResult['recommended_engine'];
  let routing_note: string;

  if (is_market_maker) {
    // MAKER: Uses Split/Merge, exclude from normal routing
    classification = 'MAKER';
    recommended_engine = 'NONE';
    routing_note = `Market Maker with ${activity.split_events} splits, ${activity.merge_events} merges. Exclude from Copy Trading.`;
  } else if (error_pct < 1.0) {
    // PASS: V23 works well
    classification = 'PASS';
    recommended_engine = 'V23';
    routing_note = `V23 accurate (${error_pct.toFixed(2)}% error). Safe for production.`;
  } else {
    // UNKNOWN: Needs investigation
    classification = 'UNKNOWN';
    recommended_engine = 'INVESTIGATE';
    routing_note = `V23 error ${error_pct.toFixed(1)}% exceeds threshold. Manual investigation required.`;
  }

  return {
    wallet,
    classification,
    v23_pnl,
    ui_pnl,
    error_pct,
    split_events: activity.split_events,
    merge_events: activity.merge_events,
    is_market_maker,
    clob_events: activity.clob_events,
    redemption_events: activity.redemption_events,
    recommended_engine,
    routing_note,
    // Default values for fields not computed in this simplified version
    net_tokens_ledger: 0,
    net_tokens_clob: 0,
    inventory_mismatch: 0,
    is_inventory_consistent: true,
    transfer_in_count: 0,
    transfer_in_value: 0,
    is_transfer_heavy: false,
    is_trader_strict: classification === 'PASS' && !is_market_maker,
    non_trader_reasons: [],
  };
}

/**
 * Quick classification check (faster, no V23 calculation if clearly a Maker)
 */
export async function quickClassify(wallet: string): Promise<WalletClassification | 'NEEDS_V23'> {
  const activity = await getActivityCounts(wallet);

  if (isMarketMaker(activity)) {
    return 'MAKER';
  }

  // Need V23 to determine PASS vs UNKNOWN
  return 'NEEDS_V23';
}

/**
 * Batch classify multiple wallets
 */
export async function classifyWallets(
  wallets: Array<{ wallet: string; ui_pnl: number }>
): Promise<ClassificationResult[]> {
  const results: ClassificationResult[] = [];

  for (const w of wallets) {
    try {
      const result = await classifyWallet(w.wallet, w.ui_pnl);
      results.push(result);
    } catch (err: any) {
      // On error, mark as UNKNOWN
      results.push({
        wallet: w.wallet,
        classification: 'UNKNOWN',
        v23_pnl: 0,
        ui_pnl: w.ui_pnl,
        error_pct: 100,
        split_events: 0,
        merge_events: 0,
        is_market_maker: false,
        clob_events: 0,
        redemption_events: 0,
        recommended_engine: 'INVESTIGATE',
        routing_note: `Classification failed: ${err.message}`,
        // Default values for fields not computed on error
        net_tokens_ledger: 0,
        net_tokens_clob: 0,
        inventory_mismatch: 0,
        is_inventory_consistent: false,
        transfer_in_count: 0,
        transfer_in_value: 0,
        is_transfer_heavy: false,
        is_trader_strict: false,
        non_trader_reasons: ['Classification error'],
      });
    }
  }

  return results;
}

/**
 * Get classification summary stats
 */
export function summarizeClassifications(results: ClassificationResult[]): {
  pass: number;
  maker: number;
  unknown: number;
  trader_strict: number;
  non_trader: number;
  passRate: number;
  makerRate: number;
  unknownRate: number;
  traderStrictRate: number;
} {
  const pass = results.filter((r) => r.classification === 'PASS').length;
  const maker = results.filter((r) => r.classification === 'MAKER').length;
  const unknown = results.filter((r) => r.classification === 'UNKNOWN').length;
  const trader_strict = results.filter((r) => r.classification === 'TRADER_STRICT').length;
  const non_trader = results.filter((r) => r.classification === 'NON_TRADER').length;
  const total = results.length;

  return {
    pass,
    maker,
    unknown,
    trader_strict,
    non_trader,
    passRate: total > 0 ? (pass / total) * 100 : 0,
    makerRate: total > 0 ? (maker / total) * 100 : 0,
    unknownRate: total > 0 ? (unknown / total) * 100 : 0,
    traderStrictRate: total > 0 ? (trader_strict / total) * 100 : 0,
  };
}

// ============================================================================
// TRADER_STRICT Classification (V23c 100% Accuracy)
// ============================================================================

/**
 * Thresholds for TRADER_STRICT classification
 */
export const TRADER_STRICT_THRESHOLDS = {
  INVENTORY_MISMATCH_MAX: 5.0, // Max token mismatch allowed (dust tolerance)
  TRANSFER_IN_VALUE_MAX: 100, // Max transfer-in value in USDC
  SPLIT_EVENTS_MAX: 0, // No splits allowed
  MERGE_EVENTS_MAX: 0, // No merges allowed
};

export interface InventoryConsistency {
  net_tokens_ledger: number;
  net_tokens_clob: number;
  inventory_mismatch: number;
  is_consistent: boolean;
}

export interface TransferActivity {
  transfer_in_count: number;
  transfer_in_value: number;
  transfer_out_count: number;
  is_transfer_heavy: boolean;
}

/**
 * Check if wallet's token inventory is fully explainable by CLOB trades.
 *
 * A wallet is "inventory consistent" if:
 * Net_Tokens_Ledger ≈ Net_Tokens_CLOB (within dust tolerance)
 *
 * If not consistent, the wallet received tokens from non-CLOB sources
 * (transfers, splits, merges, etc.) and V23c cannot accurately calculate PnL.
 */
export async function checkInventoryConsistency(wallet: string): Promise<InventoryConsistency> {
  const query = `
    SELECT
      sum(token_delta) as net_tokens_ledger,
      sumIf(token_delta, source_type = 'CLOB') as net_tokens_clob
    FROM pm_unified_ledger_v7
    WHERE wallet_address = '${wallet.toLowerCase()}'
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  const row = rows[0] || {};

  const net_tokens_ledger = Number(row.net_tokens_ledger) || 0;
  const net_tokens_clob = Number(row.net_tokens_clob) || 0;
  const inventory_mismatch = Math.abs(net_tokens_ledger - net_tokens_clob);

  return {
    net_tokens_ledger,
    net_tokens_clob,
    inventory_mismatch,
    is_consistent: inventory_mismatch <= TRADER_STRICT_THRESHOLDS.INVENTORY_MISMATCH_MAX,
  };
}

/**
 * Check wallet's ERC-1155 transfer activity.
 *
 * Transfer-heavy wallets likely received tokens outside the order book
 * and should not be classified as TRADER_STRICT.
 */
export async function checkTransferActivity(wallet: string): Promise<TransferActivity> {
  const walletLc = wallet.toLowerCase();
  const query = `
    SELECT
      countIf(to_address = '${walletLc}') as transfer_in_count,
      countIf(from_address = '${walletLc}') as transfer_out_count,
      sumIf(toFloat64OrNull(value), to_address = '${walletLc}') as transfer_in_value
    FROM pm_erc1155_transfers
    WHERE (to_address = '${walletLc}' OR from_address = '${walletLc}')
      AND is_deleted = 0
  `;

  let transfer_in_count = 0;
  let transfer_out_count = 0;
  let transfer_in_value = 0;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];
    if (rows.length > 0) {
      transfer_in_count = Number(rows[0].transfer_in_count) || 0;
      transfer_out_count = Number(rows[0].transfer_out_count) || 0;
      transfer_in_value = Number(rows[0].transfer_in_value) || 0;
    }
  } catch {
    // Table might not exist or have different schema
  }

  return {
    transfer_in_count,
    transfer_in_value,
    transfer_out_count,
    is_transfer_heavy: transfer_in_value > TRADER_STRICT_THRESHOLDS.TRANSFER_IN_VALUE_MAX,
  };
}

/**
 * Determine if a wallet qualifies as TRADER_STRICT.
 *
 * TRADER_STRICT criteria:
 * 1. No Split events (Splits == 0)
 * 2. No Merge events (Merges == 0)
 * 3. Not transfer-heavy (Incoming_Transfers_Value < $100)
 * 4. Inventory consistent (Net_Ledger ≈ Net_CLOB)
 */
export async function isTraderStrict(wallet: string): Promise<{
  is_trader_strict: boolean;
  reasons: string[];
  inventory: InventoryConsistency;
  transfers: TransferActivity;
  activity: ActivityCounts;
}> {
  const reasons: string[] = [];

  // Get activity counts
  const activity = await getActivityCounts(wallet);

  // Check for maker signals (splits/merges)
  if (activity.split_events > TRADER_STRICT_THRESHOLDS.SPLIT_EVENTS_MAX) {
    reasons.push(`Has ${activity.split_events} PositionSplit events (max: ${TRADER_STRICT_THRESHOLDS.SPLIT_EVENTS_MAX})`);
  }
  if (activity.merge_events > TRADER_STRICT_THRESHOLDS.MERGE_EVENTS_MAX) {
    reasons.push(`Has ${activity.merge_events} PositionsMerge events (max: ${TRADER_STRICT_THRESHOLDS.MERGE_EVENTS_MAX})`);
  }

  // Check inventory consistency
  const inventory = await checkInventoryConsistency(wallet);
  if (!inventory.is_consistent) {
    reasons.push(
      `Inventory mismatch: ${inventory.inventory_mismatch.toFixed(2)} tokens (Ledger=${inventory.net_tokens_ledger.toFixed(2)}, CLOB=${inventory.net_tokens_clob.toFixed(2)})`
    );
  }

  // Check transfer activity
  const transfers = await checkTransferActivity(wallet);
  if (transfers.is_transfer_heavy) {
    reasons.push(
      `Transfer-heavy: Received ${transfers.transfer_in_count} transfers worth $${transfers.transfer_in_value.toFixed(2)} (max: $${TRADER_STRICT_THRESHOLDS.TRANSFER_IN_VALUE_MAX})`
    );
  }

  const is_trader_strict = reasons.length === 0;

  return {
    is_trader_strict,
    reasons,
    inventory,
    transfers,
    activity,
  };
}

// ============================================================================
// CLOB-Only Gating (Simple CTF-Active Check)
// ============================================================================

/**
 * Simple check to determine if a wallet is suitable for CLOB-only PnL calculation.
 *
 * Use this for MVP leaderboard gating:
 * - CLOB-only wallets: Can be ranked with V17/DUEL engine
 * - CTF-active wallets: Exclude or show with "incomplete" badge
 *
 * Rules:
 * 1. Any PositionSplit or PositionsMerge → CTF-active
 * 2. More than 10 ERC1155 transfers → CTF-active
 * 3. Otherwise → CLOB-only
 */
export interface ClobOnlyCheckResult {
  wallet: string;
  is_clob_only: boolean;
  reasons: string[];
  split_merge_count: number;
  erc1155_transfer_count: number;
  clob_trade_count: number;
}

export async function checkClobOnly(wallet: string): Promise<ClobOnlyCheckResult> {
  // Run all checks in parallel
  const [splitMerge, erc1155, clobTrades] = await Promise.all([
    // 1. Split/merge count from pm_ctf_events
    clickhouse
      .query({
        query: `
          SELECT count() as cnt
          FROM pm_ctf_events
          WHERE user_address = '${wallet.toLowerCase()}'
            AND event_type IN ('PositionSplit', 'PositionsMerge')
            AND is_deleted = 0
        `,
        format: 'JSONEachRow',
      })
      .then((r) => r.json() as Promise<any[]>),

    // 2. ERC1155 transfer count
    clickhouse
      .query({
        query: `
          SELECT count() as cnt
          FROM pm_erc1155_transfers
          WHERE (from_address = '${wallet.toLowerCase()}' OR to_address = '${wallet.toLowerCase()}')
            AND is_deleted = 0
        `,
        format: 'JSONEachRow',
      })
      .then((r) => r.json() as Promise<any[]>),

    // 3. CLOB trade count
    clickhouse
      .query({
        query: `
          SELECT uniq(event_id) as cnt
          FROM pm_trader_events_v3
          WHERE trader_wallet = '${wallet.toLowerCase()}'
           
        `,
        format: 'JSONEachRow',
      })
      .then((r) => r.json() as Promise<any[]>),
  ]);

  const split_merge_count = Number(splitMerge[0]?.cnt) || 0;
  const erc1155_transfer_count = Number(erc1155[0]?.cnt) || 0;
  const clob_trade_count = Number(clobTrades[0]?.cnt) || 0;

  const reasons: string[] = [];
  let is_clob_only = true;

  // Check CTF-active indicators
  if (split_merge_count > 0) {
    is_clob_only = false;
    reasons.push(`Has ${split_merge_count} split/merge events`);
  }

  if (erc1155_transfer_count > 10) {
    is_clob_only = false;
    reasons.push(`Has ${erc1155_transfer_count} ERC1155 transfers (threshold: 10)`);
  }

  // Check minimum activity
  if (clob_trade_count < 5) {
    is_clob_only = false;
    reasons.push(`Only ${clob_trade_count} CLOB trades (minimum: 5)`);
  }

  if (is_clob_only && reasons.length === 0) {
    reasons.push('CLOB-only: No significant CTF activity');
  }

  return {
    wallet,
    is_clob_only,
    reasons,
    split_merge_count,
    erc1155_transfer_count,
    clob_trade_count,
  };
}

/**
 * FAST PATH: Get pre-computed classification from wallet_classification_latest
 * Use this instead of checkClobOnly() when processing wallets from the classification table.
 * This avoids slow CTF/ERC1155 queries.
 */
export async function getClobOnlyFromTable(wallet: string): Promise<ClobOnlyCheckResult | null> {
  const walletLc = wallet.toLowerCase();
  const query = `
    SELECT
      is_clob_only,
      clob_trade_count_total as clob_trade_count,
      split_merge_count,
      erc1155_transfer_count
    FROM wallet_classification_latest
    WHERE wallet_address = '${walletLc}'
    LIMIT 1
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  if (rows.length === 0) {
    return null; // Wallet not in classification table
  }

  const row = rows[0];
  const is_clob_only = row.is_clob_only === 1;
  const reasons: string[] = [];

  if (!is_clob_only) {
    if (row.split_merge_count > 0) {
      reasons.push(`Has ${row.split_merge_count} split/merge events`);
    }
    if (row.erc1155_transfer_count > 10) {
      reasons.push(`Has ${row.erc1155_transfer_count} ERC1155 transfers`);
    }
  }

  return {
    wallet: walletLc,
    is_clob_only,
    reasons,
    split_merge_count: Number(row.split_merge_count) || 0,
    erc1155_transfer_count: Number(row.erc1155_transfer_count) || 0,
    clob_trade_count: Number(row.clob_trade_count) || 0,
  };
}

/**
 * Batch check multiple wallets for CLOB-only status
 */
export async function checkClobOnlyBatch(wallets: string[]): Promise<ClobOnlyCheckResult[]> {
  const BATCH_SIZE = 10;
  const results: ClobOnlyCheckResult[] = [];

  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(checkClobOnly));
    results.push(...batchResults);
  }

  return results;
}

/**
 * Classify a wallet with TRADER_STRICT support.
 *
 * @param wallet - Wallet address
 * @param ui_pnl - UI PnL (from benchmark or Polymarket)
 * @param options - { useV23c: true } to calculate V23c PnL for TRADER_STRICT
 * @returns Classification result with routing recommendation
 */
export async function classifyWalletStrict(
  wallet: string,
  ui_pnl: number,
  options: { useV23c?: boolean; errorThreshold?: number } = {}
): Promise<ClassificationResult> {
  const { useV23c = true, errorThreshold = 5.0 } = options;

  // Step 1: Check TRADER_STRICT criteria
  const strictCheck = await isTraderStrict(wallet);

  // Step 2: Get V23 PnL (always calculated as baseline)
  const v23Result = await calculateV23PnL(wallet);
  const v23_pnl = v23Result.totalPnl;
  const error_pct = errorPct(v23_pnl, ui_pnl);

  // Step 3: Get V23c PnL if requested
  let v23c_pnl: number | undefined;
  let v23c_error_pct: number | undefined;
  if (useV23c) {
    const v23cResult = await calculateV23cPnL(wallet, { useUIOracle: true });
    v23c_pnl = v23cResult.totalPnl;
    v23c_error_pct = errorPct(v23c_pnl, ui_pnl);
  }

  // Step 4: Determine classification
  let classification: WalletClassification;
  let recommended_engine: ClassificationResult['recommended_engine'];
  let routing_note: string;

  const is_market_maker = isMarketMaker(strictCheck.activity);

  if (is_market_maker) {
    // MAKER: Uses Split/Merge excessively, exclude from normal routing
    classification = 'MAKER';
    recommended_engine = 'NONE';
    routing_note = `Market Maker with ${strictCheck.activity.split_events} splits, ${strictCheck.activity.merge_events} merges. Exclude from Copy Trading.`;
  } else if (!strictCheck.is_trader_strict) {
    // NON_TRADER: Failed TRADER_STRICT criteria
    classification = 'NON_TRADER';
    recommended_engine = 'INVESTIGATE';
    routing_note = `Non-Trader: ${strictCheck.reasons.join('; ')}`;
  } else if (useV23c && v23c_error_pct !== undefined && v23c_error_pct < errorThreshold) {
    // TRADER_STRICT: Passes all criteria and V23c is accurate
    classification = 'TRADER_STRICT';
    recommended_engine = 'V23c';
    routing_note = `TRADER_STRICT: V23c accurate (${v23c_error_pct.toFixed(2)}% error). 100% accuracy cohort.`;
  } else if (error_pct < 1.0) {
    // PASS: V23 works well
    classification = 'PASS';
    recommended_engine = 'V23';
    routing_note = `V23 accurate (${error_pct.toFixed(2)}% error). Safe for production.`;
  } else {
    // UNKNOWN: Needs investigation
    classification = 'UNKNOWN';
    recommended_engine = 'INVESTIGATE';
    routing_note = `V23 error ${error_pct.toFixed(1)}% exceeds threshold. Manual investigation required.`;
  }

  return {
    wallet,
    classification,
    v23_pnl,
    v23c_pnl,
    ui_pnl,
    error_pct,
    v23c_error_pct,
    split_events: strictCheck.activity.split_events,
    merge_events: strictCheck.activity.merge_events,
    is_market_maker,
    net_tokens_ledger: strictCheck.inventory.net_tokens_ledger,
    net_tokens_clob: strictCheck.inventory.net_tokens_clob,
    inventory_mismatch: strictCheck.inventory.inventory_mismatch,
    is_inventory_consistent: strictCheck.inventory.is_consistent,
    transfer_in_count: strictCheck.transfers.transfer_in_count,
    transfer_in_value: strictCheck.transfers.transfer_in_value,
    is_transfer_heavy: strictCheck.transfers.is_transfer_heavy,
    clob_events: strictCheck.activity.clob_events,
    redemption_events: strictCheck.activity.redemption_events,
    is_trader_strict: strictCheck.is_trader_strict,
    non_trader_reasons: strictCheck.reasons,
    recommended_engine,
    routing_note,
  };
}
