#!/usr/bin/env npx tsx
/**
 * Validate DUEL realized_economic against Polymarket UI truth
 * ============================================================================
 *
 * This script validates V18 PnL engine (maker-only) output against Polymarket UI tooltips.
 *
 * For wallets WITH open positions:
 *   - Compare V17.1 total_pnl (realized + unrealized) vs UI Net Total
 *   - Includes synthetic resolutions (positions at 0/1 price but unredeemed)
 *
 * For wallets WITHOUT open positions:
 *   - Compare V17.1 realized_pnl vs UI Net Total
 *
 * Usage:
 *   npx tsx scripts/pnl/validate-duel-vs-ui-synthetic.ts --count=25
 *   npx tsx scripts/pnl/validate-duel-vs-ui-synthetic.ts --count=100 --tier=AB
 *   npx tsx scripts/pnl/validate-duel-vs-ui-synthetic.ts --count=50 --clob-only
 *   npx tsx scripts/pnl/validate-duel-vs-ui-synthetic.ts --resume
 *   npx tsx scripts/pnl/validate-duel-vs-ui-synthetic.ts --save "wallet,net_total"
 *
 * Options:
 *   --count=N      Number of wallets to sample (default: 25)
 *   --tier=A|B|AB  Filter by tier (default: AB)
 *   --clob-only    Strict CLOB-only mode (erc1155=0 AND split_merge=0)
 *   --high-coverage Pre-filter to wallets with 99%+ mapping coverage (disabled - too expensive)
 *   --no-open      Skip wallets with open positions (unrealized PnL mismatch)
 *   --resume       Resume from checkpoint
 *   --report       Show final report
 *   --save "..."   Save scraped result
 *   --skip "..."   Skip a wallet
 *   --next=N       Show next N unlabeled wallets (for manual scraping)
 *   --autoscrape   Automate UI scraping with Playwright (use with --limit=N)
 *   --flat-only-sample  Pre-filter sampling for flat wallets (no open positions)
 *   --time-window-days=N  Limit fill scan to last N days (default: 180)
 *
 * CLOB-only mode:
 *   Samples from wallet_classification_latest where:
 *   - erc1155_transfer_count = 0
 *   - split_merge_count = 0
 *   - clob_trade_count >= 20
 *
 *   This gives ~400k wallets with clean CLOB-only trading patterns,
 *   avoiding complexity from ERC1155 transfers and CTF split/merge.
 *
 * Acceptance criteria:
 *   - For |PnL| >= $2500: |delta| <= 1% of UI value
 *   - For |PnL| < $2500: |delta| <= $25
 *   - Require 95% pass rate
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';
import * as fs from 'fs';
import * as path from 'path';
import { createV18Engine } from '../../lib/pnl/uiActivityEngineV18';
// V18 = maker-only filtering for UI parity (fixes 2x bug where V17 counts both maker+taker)

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

// File paths
const CHECKPOINT_DIR = '/tmp/duel-ui-validation';
const CHECKPOINT_FILE = path.join(CHECKPOINT_DIR, 'checkpoint.json');
const RESULTS_FILE = path.join(CHECKPOINT_DIR, 'results.json');
const REPORT_FILE = path.join(CHECKPOINT_DIR, 'report.json');

// Validation thresholds
const LARGE_PNL_THRESHOLD = 2500;
const LARGE_PNL_TOLERANCE_PCT = 0.01; // 1%
const SMALL_PNL_TOLERANCE_ABS = 25;
const MIN_PASS_RATE = 0.95;
const MIN_MAPPING_COVERAGE = 0.99; // 99% of volume must be mapped

// Strict thresholds - TRUE parity (for copy-trade grade validation)
// STRICT pass requires: abs_delta <= $0.25 OR abs_delta_pct_of_volume <= 0.5%
const STRICT_TOLERANCE_ABS = 0.25;  // $0.25 absolute tolerance
const STRICT_TOLERANCE_PCT_VOLUME = 0.005;  // 0.5% of volume traded

// ============================================================================
// Types
// ============================================================================

interface WalletSample {
  wallet_address: string;
  tier: 'A' | 'B';
  realized_economic: number;
  unresolved_positions: number | null;
  trades_30d: number;
  omega_180d: number;
  // Complexity signals
  erc1155_transfer_count: number | null;
  split_merge_count: number | null;
  clob_trade_count: number | null;
}

interface ValidationResult {
  wallet: string;
  tier: 'A' | 'B';
  // Engine outputs
  our_realized: number;
  our_unrealized: number;
  our_total: number;
  // UI proxy realized: raw cashflow without paired-outcome normalization
  // Formula: sum(sell_usdc) - sum(buy_usdc) for resolved positions
  // Used to isolate definition mismatch from data mismatch
  ui_proxy_realized: number | null;
  // Scraped UI values
  ui_net_total: number | null;
  ui_volume: number | null;
  ui_gain: number | null;
  ui_loss: number | null;
  // Delta metrics
  delta: number | null;
  delta_pct: number | null;
  abs_delta: number | null;  // |our_value - ui_value|
  abs_delta_pct_of_volume: number | null;  // abs_delta / ui_volume
  delta_pct_of_ui_abs: number | null;  // abs_delta / max(|ui_net|, 1)
  strict_tolerance_used: number | null;  // What tolerance was applied for strict
  // Pass/fail results
  passes_strict: boolean | null;  // Percent-of-PnL criteria
  passes_loose: boolean | null;   // Old criteria: $25 or 1%
  passes: boolean | null;  // Legacy field, equals passes_loose for backwards compat
  failure_reason: string | null;
  strict_failure_reason: string | null;  // Why strict failed
  // Wallet state
  has_open_positions: boolean;
  is_flat: boolean; // Fill-based flat detection
  skipped: boolean;
  skip_reason: string | null;
  scraped_at: string | null;
  // Complexity signals
  erc1155_transfer_count: number | null;
  split_merge_count: number | null;
  clob_trade_count: number | null;
  // Coverage signals (from pm_trader_events_dedup_v2_tbl - 520M rows canonical source)
  fill_volume: number | null;
  mapped_volume: number | null;
  mapping_coverage: number | null;
  fill_count: number | null;
  mapped_count: number | null;
  // Flat check signals
  non_flat_positions: number | null;
  max_abs_net_shares: number | null;
}

interface Checkpoint {
  run_id: string;
  started_at: string;
  target_count: number;
  tier_filter: string;
  clob_only: boolean;
  high_coverage: boolean;
  no_open: boolean;
  flat_only_sample: boolean;
  time_window_days: number;
  sampled_wallets: WalletSample[];
  completed_wallets: string[];
  current_index: number;
}

interface ValidationReport {
  run_id: string;
  started_at: string;
  completed_at: string;
  total_sampled: number;
  total_validated: number;
  total_skipped: number;
  total_passed: number;
  total_failed: number;
  pass_rate: number;
  meets_acceptance_criteria: boolean;
  p50_delta: number;
  p95_delta: number;
  max_delta: number;
  results: ValidationResult[];
  failures: ValidationResult[];
}

// ============================================================================
// Helpers
// ============================================================================

function ensureCheckpointDir() {
  if (!fs.existsSync(CHECKPOINT_DIR)) {
    fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
  }
}

function loadCheckpoint(): Checkpoint | null {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
    }
  } catch (e) {}
  return null;
}

function saveCheckpoint(checkpoint: Checkpoint) {
  ensureCheckpointDir();
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
}

function loadResults(): ValidationResult[] {
  try {
    if (fs.existsSync(RESULTS_FILE)) {
      return JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf-8'));
    }
  } catch (e) {}
  return [];
}

function saveResults(results: ValidationResult[]) {
  ensureCheckpointDir();
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
}

function parseDollarAmount(str: string): number | null {
  if (!str) return null;
  const cleaned = str.replace(/[$,+]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function generateRunId(): string {
  return `val_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================================
// Mapping Coverage Check - ALIGNED TO CANONICAL FILLS (same as V17 engine)
// ============================================================================

interface MappingCoverage {
  // Dedup fills (pm_trader_events_dedup_v2_tbl - 520M rows, the proper canonical source)
  fill_volume: number;      // Total volume in dollars
  mapped_volume: number;    // Volume that maps to condition_ids
  mapping_coverage: number; // mapped / total ratio
  fill_count: number;       // Number of fills
  mapped_count: number;     // Number of fills that map
}

async function computeMappingCoverage(wallet: string): Promise<MappingCoverage> {
  // ============================================================================
  // Use pm_trader_events_dedup_v2_tbl with GROUP BY event_id to dedupe
  // (the table has 2x rows per event_id, must aggregate to get accurate counts)
  // ============================================================================
  const query = `
    SELECT
      sum(abs(usdc_amount)) / 1e6 as total_volume,
      sumIf(abs(usdc_amount) / 1e6, isNotNull(condition_id)) as mapped_volume,
      count() as fill_count,
      countIf(isNotNull(condition_id)) as mapped_count
    FROM (
      SELECT
        f.event_id,
        any(f.usdc_amount) as usdc_amount,
        any(m.condition_id) as condition_id
      FROM pm_trader_events_dedup_v2_tbl f
      LEFT JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
      WHERE lower(f.trader_wallet) = lower('${wallet}')
      GROUP BY f.event_id
    )
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  const data = rows[0] || { total_volume: 0, mapped_volume: 0, fill_count: 0, mapped_count: 0 };

  const total = Number(data.total_volume) || 0;
  const mapped = Number(data.mapped_volume) || 0;
  const count = Number(data.fill_count) || 0;
  const mappedCount = Number(data.mapped_count) || 0;

  return {
    fill_volume: total,
    mapped_volume: mapped,
    mapping_coverage: total > 0 ? mapped / total : 0,
    fill_count: count,
    mapped_count: mappedCount,
  };
}

// ============================================================================
// Flat Position Check - FILL-BASED (same source as V17 engine)
// ============================================================================
// This determines if a wallet has any non-zero net positions.
// Used for --no-open mode to skip wallets that aren't flat.
// ============================================================================

// Flat position detection thresholds
// UI_FLAT_EPSILON: What the UI likely considers "no positions" (display threshold)
// Based on observation: UI shows "No positions" for wallets with ~0.01 shares
const UI_FLAT_EPSILON = 0.01; // Shares threshold for UI parity validation
const STRICT_FLAT_EPSILON = 0.000001; // For engine-level dust detection

interface FlatCheck {
  is_flat: boolean;
  max_abs_net_shares: number;
  non_flat_positions: number;
  total_positions: number;
}

async function computeNetShares(wallet: string): Promise<FlatCheck> {
  // ============================================================================
  // Use pm_trader_events_dedup_v2_tbl with GROUP BY event_id to dedupe first,
  // then aggregate by (condition_id, outcome_index) to compute net shares.
  // ============================================================================
  const query = `
    SELECT
      condition_id,
      outcome_index,
      sum(if(side = 'buy', token_amount, -token_amount)) / 1e6 as net_shares
    FROM (
      SELECT
        f.event_id,
        any(lower(f.side)) as side,
        any(f.token_amount) as token_amount,
        any(m.condition_id) as condition_id,
        any(m.outcome_index) as outcome_index
      FROM pm_trader_events_dedup_v2_tbl f
      INNER JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
      WHERE lower(f.trader_wallet) = lower('${wallet}')
      GROUP BY f.event_id
    )
    GROUP BY condition_id, outcome_index
    HAVING abs(net_shares) > ${UI_FLAT_EPSILON}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const nonFlatPositions = (await result.json()) as any[];

  // Also get total position count (deduped)
  const totalQuery = `
    SELECT count() as total
    FROM (
      SELECT condition_id, outcome_index
      FROM (
        SELECT
          f.event_id,
          any(m.condition_id) as condition_id,
          any(m.outcome_index) as outcome_index
        FROM pm_trader_events_dedup_v2_tbl f
        INNER JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
        WHERE lower(f.trader_wallet) = lower('${wallet}')
        GROUP BY f.event_id
      )
      GROUP BY condition_id, outcome_index
    )
  `;
  const totalResult = await clickhouse.query({ query: totalQuery, format: 'JSONEachRow' });
  const totalRows = (await totalResult.json()) as any[];
  const totalPositions = Number(totalRows[0]?.total) || 0;

  const maxAbsNetShares = nonFlatPositions.reduce(
    (max, p) => Math.max(max, Math.abs(Number(p.net_shares))),
    0
  );

  return {
    is_flat: nonFlatPositions.length === 0,
    max_abs_net_shares: maxAbsNetShares,
    non_flat_positions: nonFlatPositions.length,
    total_positions: totalPositions,
  };
}

// ============================================================================
// UI Proxy Realized - Raw cashflow WITHOUT paired-outcome normalization
// ============================================================================
// This computes what we think the UI uses as "realized PnL":
//   sum(sell_usdc) - sum(buy_usdc) for RESOLVED markets only
//
// Key difference from V17:
//   - V17 filters out "hedge legs" from complete-set trades (paired-outcome normalization)
//   - UI likely does NOT do this filtering
//
// Use case: If ui_proxy_realized matches UI better than our_realized,
// it means the normalization is causing the mismatch, not the data itself.
// ============================================================================

async function computeUiProxyRealized(wallet: string): Promise<number> {
  // Raw cashflow for resolved positions only, NO paired-outcome normalization
  // GROUP BY event_id to dedupe, then aggregate by (condition_id, outcome_index)
  const query = `
    SELECT
      sum(trade_cash_flow) as total_cash_flow,
      sum(final_shares * resolution_price) as total_resolution_value,
      sum(trade_cash_flow + final_shares * resolution_price) as ui_proxy_realized
    FROM (
      SELECT
        condition_id,
        outcome_index,
        sum(if(side = 'sell', usdc_amount, -usdc_amount)) as trade_cash_flow,
        sum(if(side = 'buy', token_amount, -token_amount)) as final_shares,
        any(resolution_price) as resolution_price,
        any(is_resolved) as is_resolved
      FROM (
        SELECT
          f.event_id,
          any(lower(f.side)) as side,
          any(f.usdc_amount) / 1e6 as usdc_amount,
          any(f.token_amount) / 1e6 as token_amount,
          any(m.condition_id) as condition_id,
          any(m.outcome_index) as outcome_index,
          -- Get resolution info
          any(
            CASE
              WHEN r.payout_numerators IS NOT NULL
              THEN arrayElement(JSONExtract(r.payout_numerators, 'Array(Float64)'), m.outcome_index + 1)
              ELSE NULL
            END
          ) as resolution_price,
          any(r.payout_numerators IS NOT NULL) as is_resolved
        FROM pm_trader_events_dedup_v2_tbl f
        INNER JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
        LEFT JOIN pm_condition_resolutions r ON lower(m.condition_id) = lower(r.condition_id)
        WHERE lower(f.trader_wallet) = lower('${wallet}')
        GROUP BY f.event_id
      )
      GROUP BY condition_id, outcome_index
      HAVING is_resolved = 1  -- Only resolved positions
    )
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];
    const data = rows[0] || { ui_proxy_realized: 0 };
    return Number(data.ui_proxy_realized) || 0;
  } catch (e: any) {
    console.log('  Warning: Could not compute UI proxy realized:', e.message?.slice(0, 100));
    return 0;
  }
}

// ============================================================================
// Wallet Sampling
// ============================================================================

interface SamplingOptions {
  count: number;
  tierFilter: string;
  clobOnly: boolean;
  highCoverage: boolean;
  flatOnlySample: boolean;
  timeWindowDays: number;
}

async function sampleRankableWallets(options: SamplingOptions): Promise<WalletSample[]> {
  const { count, tierFilter, clobOnly, highCoverage, flatOnlySample, timeWindowDays } = options;
  console.log(`\nSampling ${count} wallets with tier=${tierFilter}, clob_only=${clobOnly}, high_coverage=${highCoverage}, flat_only=${flatOnlySample}, time_window=${timeWindowDays}d`);

  if (clobOnly) {
    // CLOB-only mode: Use wallet_classification_latest for strict filtering
    // Require erc1155_transfer_count = 0 AND split_merge_count = 0
    console.log('  CLOB-only mode: strict filtering (erc1155=0 AND split_merge=0)');

    if (highCoverage) {
      console.log('  NOTE: --high-coverage prefiltering disabled (too expensive).');
      console.log('  Mapping coverage is checked per-wallet when saving results.');
    }

    // ============================================================================
    // FLAT-ONLY SAMPLING: Pre-filter for wallets with no open positions
    // ============================================================================
    if (flatOnlySample) {
      console.log('  FLAT-ONLY mode: per-wallet flat check using canonical fills');
      console.log(`  UI_FLAT_EPSILON: ${UI_FLAT_EPSILON} shares`);

      // Sample CLOB-only candidates, then check flatness one by one using canonical fills
      const candidateCount = count * 15; // Sample more to account for non-flat wallets
      const candidateQuery = `
        SELECT
          c.wallet_address as wallet_address,
          'A' as tier,
          COALESCE(d.realized_economic, 0) as realized_economic,
          d.unresolved_positions as unresolved_positions,
          COALESCE(d.trades_30d, 0) as trades_30d,
          COALESCE(d.omega_180d, 0) as omega_180d,
          c.erc1155_transfer_count as erc1155_transfer_count,
          c.split_merge_count as split_merge_count,
          c.clob_trade_count_total as clob_trade_count
        FROM wallet_classification_latest c
        LEFT JOIN wallet_duel_metrics_latest_v2 d ON c.wallet_address = d.wallet_address
        WHERE c.erc1155_transfer_count = 0
          AND c.split_merge_count = 0
          AND c.clob_trade_count_total >= 20
        ORDER BY rand()
        LIMIT ${candidateCount}
      `;

      try {
        console.log(`  Sampling ${candidateCount} CLOB-only candidates...`);
        const candidateResult = await clickhouse.query({ query: candidateQuery, format: 'JSONEachRow' });
        const candidates = (await candidateResult.json()) as any[];
        console.log(`  Got ${candidates.length} candidates. Checking flatness (UI_FLAT_EPSILON=${UI_FLAT_EPSILON})...`);

        const flatSamples: WalletSample[] = [];
        let checked = 0;
        let skippedNotFlat = 0;

        for (const c of candidates) {
          if (flatSamples.length >= count) break;

          checked++;
          const wallet = c.wallet_address;

          // TOKEN-ONLY flat check - no mapping join needed, much faster
          // Just check if any token has non-zero net shares
          const flatCheckQuery = `
            WITH fills AS (
              SELECT
                event_id,
                any(lower(side)) AS side,
                any(token_id) AS token_id,
                any(token_amount) AS token_amount
              FROM pm_trader_events_dedup_v2_tbl
              WHERE lower(trader_wallet) = lower('${wallet}')
              GROUP BY event_id
            ),
            pos AS (
              SELECT
                token_id,
                sum(if(side='buy', token_amount, -token_amount)) / 1e6 AS net_shares
              FROM fills
              GROUP BY token_id
            )
            SELECT max(abs(net_shares)) AS max_abs_net
            FROM pos
          `;

          const flatResult = await clickhouse.query({ query: flatCheckQuery, format: 'JSONEachRow' });
          const flatRows = (await flatResult.json()) as any[];
          const maxAbsNet = Number(flatRows[0]?.max_abs_net) || 0;

          if (maxAbsNet <= UI_FLAT_EPSILON) {
            // Wallet is flat!
            flatSamples.push({
              wallet_address: wallet,
              tier: 'A' as const,
              realized_economic: Number(c.realized_economic) || 0,
              unresolved_positions: c.unresolved_positions !== null ? Number(c.unresolved_positions) : null,
              trades_30d: Number(c.trades_30d) || 0,
              omega_180d: Number(c.omega_180d) || 0,
              erc1155_transfer_count: Number(c.erc1155_transfer_count),
              split_merge_count: Number(c.split_merge_count),
              clob_trade_count: Number(c.clob_trade_count),
            });
            process.stdout.write(`\r  Found ${flatSamples.length}/${count} flat wallets (checked ${checked}, skipped ${skippedNotFlat})`);
          } else {
            skippedNotFlat++;
          }
        }

        console.log(''); // newline after progress

        if (flatSamples.length > 0) {
          console.log(`  Found ${flatSamples.length} FLAT CLOB-only wallets (checked ${checked})`);
          return flatSamples;
        } else {
          console.log('  WARNING: No flat wallets found. Try increasing UI_FLAT_EPSILON.');
        }
      } catch (e: any) {
        console.log('  Error during flat wallet sampling:', e.message?.slice(0, 200));
      }

      console.log('  ERROR: Could not find flat CLOB-only wallets. Aborting.');
      return [];
    }

    // Non-flat sampling: Original CLOB-only query
    const clobOnlyQuery = `
      SELECT
        c.wallet_address,
        'A' as tier,
        COALESCE(d.realized_economic, 0) as realized_economic,
        d.unresolved_positions,
        COALESCE(d.trades_30d, 0) as trades_30d,
        COALESCE(d.omega_180d, 0) as omega_180d,
        c.erc1155_transfer_count,
        c.split_merge_count,
        c.clob_trade_count_total as clob_trade_count
      FROM wallet_classification_latest c
      LEFT JOIN wallet_duel_metrics_latest_v2 d ON c.wallet_address = d.wallet_address
      WHERE c.erc1155_transfer_count = 0
        AND c.split_merge_count = 0
        AND c.clob_trade_count_total >= 20
      ORDER BY rand()
      LIMIT ${count * 3}
    `;

    try {
      const result = await clickhouse.query({ query: clobOnlyQuery, format: 'JSONEachRow' });
      const rows = (await result.json()) as any[];

      if (rows.length > 0) {
        console.log(`  Found ${rows.length} strict CLOB-only wallets from wallet_classification_latest`);

        // Filter out wallets with zero activity
        const validRows = rows.filter((r) => Number(r.clob_trade_count) > 0);
        console.log(`  After filtering for activity: ${validRows.length} wallets`);

        const samples = validRows.slice(0, count).map((r) => ({
          wallet_address: r.wallet_address,
          tier: 'A' as const,
          realized_economic: Number(r.realized_economic) || 0,
          unresolved_positions: r.unresolved_positions !== null ? Number(r.unresolved_positions) : null,
          trades_30d: Number(r.trades_30d) || 0,
          omega_180d: Number(r.omega_180d) || 0,
          erc1155_transfer_count: Number(r.erc1155_transfer_count),
          split_merge_count: Number(r.split_merge_count),
          clob_trade_count: Number(r.clob_trade_count),
        }));

        return samples;
      }
    } catch (e: any) {
      console.log('  Error querying CLOB-only wallets:', e.message?.slice(0, 100));
    }

    console.log('  ERROR: Could not find CLOB-only wallets. Aborting.');
    return [];
  }

  // Non-CLOB-only mode: Try DUEL metrics table first (has accurate data)
  const duelQuery = `
    SELECT
      wallet_address,
      rankability_tier as tier,
      realized_economic,
      unresolved_positions,
      trades_30d,
      omega_180d,
      erc1155_transfer_count,
      split_merge_count,
      clob_trade_count
    FROM wallet_duel_metrics_latest_v2
    WHERE is_rankable = 1
      ${tierFilter === 'A' ? "AND rankability_tier = 'A'" : tierFilter === 'B' ? "AND rankability_tier = 'B'" : tierFilter === 'AB' ? "AND rankability_tier IN ('A', 'B')" : ''}
    ORDER BY rand()
    LIMIT ${count * 5}
  `;

  try {
    const result = await clickhouse.query({ query: duelQuery, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];

    if (rows.length > 0) {
      console.log(`  Found ${rows.length} wallets from wallet_duel_metrics_latest_v2`);

      const samples = rows.slice(0, count).map((r) => ({
        wallet_address: r.wallet_address,
        tier: r.tier as 'A' | 'B',
        realized_economic: Number(r.realized_economic),
        unresolved_positions: r.unresolved_positions !== null ? Number(r.unresolved_positions) : null,
        trades_30d: Number(r.trades_30d),
        omega_180d: Number(r.omega_180d),
        erc1155_transfer_count: r.erc1155_transfer_count !== null ? Number(r.erc1155_transfer_count) : null,
        split_merge_count: r.split_merge_count !== null ? Number(r.split_merge_count) : null,
        clob_trade_count: r.clob_trade_count !== null ? Number(r.clob_trade_count) : null,
      }));

      return samples;
    }
  } catch (e) {
    console.log('  DUEL metrics table not available');
  }

  // Fallback to cohort table (no complexity signals available)
  console.log('  Using pm_hc_leaderboard_cohort_all_v1 as source (no complexity signals)');
  const cohortQuery = `
    SELECT
      wallet as wallet_address,
      CASE WHEN trade_count_30d > 0 AND omega > 1 THEN 'A' ELSE 'B' END as tier,
      realized_pnl as realized_economic,
      trade_count_30d as trades_30d,
      omega as omega_180d
    FROM pm_hc_leaderboard_cohort_all_v1
    WHERE trade_count_total >= 20
      ${tierFilter === 'A' ? 'AND trade_count_30d > 0 AND omega > 1' : tierFilter === 'B' ? 'AND (trade_count_30d > 0 OR (omega >= 0.5 AND omega <= 1))' : tierFilter === 'AB' ? 'AND (trade_count_30d > 0 OR omega >= 0.5)' : ''}
    ORDER BY rand()
    LIMIT ${count}
  `;

  const result = await clickhouse.query({ query: cohortQuery, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  console.log(`  Found ${rows.length} wallets from cohort table`);

  return rows.map((r) => ({
    wallet_address: r.wallet_address,
    tier: r.tier as 'A' | 'B',
    realized_economic: Number(r.realized_economic),
    unresolved_positions: null, // Unknown from cohort table
    trades_30d: Number(r.trades_30d),
    omega_180d: Number(r.omega_180d),
    erc1155_transfer_count: null, // Unknown from cohort table
    split_merge_count: null,
    clob_trade_count: null,
  }));
}

// ============================================================================
// Validation Logic
// ============================================================================

interface PassResult {
  passes_strict: boolean;
  passes_loose: boolean;
  strict_reason: string | null;
  loose_reason: string | null;
  abs_delta: number;
  abs_delta_pct_of_volume: number | null;
  delta_pct_of_ui_abs: number | null;  // For dataset export
  strict_tolerance_used: number;  // What tolerance was actually applied
}

function checkPasses(ourValue: number, uiValue: number, uiVolume: number | null): PassResult {
  const absDelta = Math.abs(ourValue - uiValue);
  const absUiNet = Math.abs(uiValue);

  // For dataset export (with guard against division by zero)
  const absDeltaPctOfVolume = uiVolume && uiVolume > 0 ? absDelta / uiVolume : null;
  const deltaPctOfUiAbs = absUiNet > 1 ? absDelta / absUiNet : null;  // Guard: only compute if |ui| > $1

  // ============================================================================
  // STRICT criteria (percent-of-PnL, not percent-of-volume)
  // ============================================================================
  // For small PnL (|ui_net| < $25): abs_delta <= $0.25 (absolute only)
  // For larger PnL (|ui_net| >= $25): abs_delta <= max($0.25, 1% of |ui_net|)
  //
  // This avoids the "high volume = loose tolerance" problem.
  // ============================================================================
  let passes_strict = false;
  let strict_reason: string | null = null;
  let strict_tolerance_used = STRICT_TOLERANCE_ABS;

  if (absUiNet < 25) {
    // Small PnL branch: absolute tolerance only ($0.25)
    strict_tolerance_used = STRICT_TOLERANCE_ABS;
    if (absDelta <= STRICT_TOLERANCE_ABS) {
      passes_strict = true;
    } else {
      strict_reason = `|Δ|=$${absDelta.toFixed(2)} > $${STRICT_TOLERANCE_ABS.toFixed(2)} (small PnL: |UI|=$${absUiNet.toFixed(2)})`;
    }
  } else {
    // Larger PnL branch: allow 1% of |ui_net| with $0.25 floor
    strict_tolerance_used = Math.max(STRICT_TOLERANCE_ABS, 0.01 * absUiNet);
    if (absDelta <= strict_tolerance_used) {
      passes_strict = true;
    } else {
      strict_reason = `|Δ|=$${absDelta.toFixed(2)} > $${strict_tolerance_used.toFixed(2)} (1% of |UI|=$${absUiNet.toFixed(2)})`;
    }
  }

  // ============================================================================
  // LOOSE criteria (legacy: $25 absolute OR 1% for large PnL)
  // ============================================================================
  let passes_loose = false;
  let loose_reason: string | null = null;

  if (absUiNet >= LARGE_PNL_THRESHOLD) {
    const loosePct = deltaPctOfUiAbs ?? (absDelta / Math.max(absUiNet, 1));
    if (loosePct <= LARGE_PNL_TOLERANCE_PCT) {
      passes_loose = true;
    } else {
      loose_reason = `|Δ|=$${absDelta.toFixed(2)} > 1% of |UI|=$${absUiNet.toFixed(2)}`;
    }
  } else {
    if (absDelta <= SMALL_PNL_TOLERANCE_ABS) {
      passes_loose = true;
    } else {
      loose_reason = `|Δ|=$${absDelta.toFixed(2)} > $25`;
    }
  }

  return {
    passes_strict,
    passes_loose,
    strict_reason,
    loose_reason,
    abs_delta: absDelta,
    abs_delta_pct_of_volume: absDeltaPctOfVolume,
    delta_pct_of_ui_abs: deltaPctOfUiAbs,
    strict_tolerance_used,
  };
}

function generateReport(results: ValidationResult[], checkpoint: Checkpoint): ValidationReport {
  const validated = results.filter((r) => !r.skipped && r.ui_net_total !== null);
  const skipped = results.filter((r) => r.skipped);

  // STRICT passes (true parity)
  const passedStrict = validated.filter((r) => r.passes_strict === true);
  const failedStrict = validated.filter((r) => r.passes_strict === false);

  // LOOSE passes (legacy - $25 or 1%)
  const passedLoose = validated.filter((r) => r.passes_loose === true);
  const failedLoose = validated.filter((r) => r.passes_loose === false);

  const deltas = validated.map((r) => Math.abs(r.delta || 0)).sort((a, b) => a - b);
  const p50 = deltas.length > 0 ? deltas[Math.floor(deltas.length * 0.5)] : 0;
  const p95 = deltas.length > 0 ? deltas[Math.floor(deltas.length * 0.95)] : 0;
  const maxDelta = deltas.length > 0 ? deltas[deltas.length - 1] : 0;

  // Report uses STRICT pass rate as the primary metric
  const passRateStrict = validated.length > 0 ? passedStrict.length / validated.length : 0;
  const passRateLoose = validated.length > 0 ? passedLoose.length / validated.length : 0;

  return {
    run_id: checkpoint.run_id,
    started_at: checkpoint.started_at,
    completed_at: new Date().toISOString(),
    total_sampled: results.length,
    total_validated: validated.length,
    total_skipped: skipped.length,
    total_passed: passedStrict.length,  // STRICT pass count
    total_failed: failedStrict.length,  // STRICT fail count
    pass_rate: passRateStrict,  // STRICT pass rate
    meets_acceptance_criteria: passRateStrict >= MIN_PASS_RATE,
    p50_delta: p50,
    p95_delta: p95,
    max_delta: maxDelta,
    results,
    failures: failedStrict,  // STRICT failures
    // Extended metrics (added to JSON, not to interface for backwards compat)
    ...(({
      pass_rate_loose: passRateLoose,
      total_passed_loose: passedLoose.length,
      total_failed_loose: failedLoose.length,
    }) as any),
  };
}

// ============================================================================
// CLI Commands
// ============================================================================

interface ValidationOptions {
  count: number;
  tierFilter: string;
  clobOnly: boolean;
  highCoverage: boolean;
  noOpen: boolean;
  flatOnlySample: boolean;
  timeWindowDays: number;
}

async function startNewValidation(options: ValidationOptions) {
  const { count, tierFilter, clobOnly, highCoverage, noOpen, flatOnlySample, timeWindowDays } = options;

  console.log('='.repeat(80));
  console.log('DUEL UI PARITY VALIDATION - NEW RUN');
  console.log('='.repeat(80));
  console.log(`Count: ${count}, Tier: ${tierFilter}, CLOB-only: ${clobOnly}, Flat-only-sample: ${flatOnlySample}, No-open: ${noOpen}, Time-window: ${timeWindowDays}d`);

  const wallets = await sampleRankableWallets({
    count,
    tierFilter,
    clobOnly,
    highCoverage,
    flatOnlySample,
    timeWindowDays,
  });
  console.log(`\nSampled ${wallets.length} wallets`);

  if (wallets.length === 0) {
    console.log('ERROR: No wallets found. Exiting.');
    return;
  }

  const checkpoint: Checkpoint = {
    run_id: generateRunId(),
    started_at: new Date().toISOString(),
    target_count: count,
    tier_filter: tierFilter,
    clob_only: clobOnly,
    high_coverage: highCoverage,
    no_open: noOpen,
    flat_only_sample: flatOnlySample,
    time_window_days: timeWindowDays,
    sampled_wallets: wallets,
    completed_wallets: [],
    current_index: 0,
  };
  saveCheckpoint(checkpoint);
  saveResults([]);

  console.log(`\nCheckpoint created: ${checkpoint.run_id}`);
  console.log(`State saved to: ${CHECKPOINT_DIR}`);

  showNextBatch(checkpoint, []);
}

function showNextBatch(checkpoint: Checkpoint, results: ValidationResult[]) {
  const remaining = checkpoint.sampled_wallets.filter(
    (w) => !checkpoint.completed_wallets.includes(w.wallet_address)
  );

  if (remaining.length === 0) {
    console.log('\nAll wallets validated! Generating report...');
    const report = generateReport(results, checkpoint);
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
    printReportSummary(report);
    return;
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`PROGRESS: ${checkpoint.completed_wallets.length}/${checkpoint.sampled_wallets.length}`);
  console.log(`Remaining: ${remaining.length}`);
  console.log('='.repeat(80));

  const batch = remaining.slice(0, 10);
  console.log('\nNEXT WALLETS TO SCRAPE:');
  console.log('-'.repeat(80));

  for (let i = 0; i < batch.length; i++) {
    const w = batch[i];
    console.log(`\n${i + 1}. ${w.wallet_address}`);
    console.log(`   Tier: ${w.tier}`);
    console.log(`   Our realized_economic: $${w.realized_economic.toFixed(2)}`);
    console.log(`   Unresolved positions: ${w.unresolved_positions ?? 'unknown'}`);
    console.log(`   ERC1155 transfers: ${w.erc1155_transfer_count ?? 'unknown'}`);
    console.log(`   Split/merge count: ${w.split_merge_count ?? 'unknown'}`);
    console.log(`   CLOB trades: ${w.clob_trade_count ?? 'unknown'}`);
    console.log(`   URL: https://polymarket.com/profile/${w.wallet_address}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('INSTRUCTIONS:');
  console.log('1. Use mcp__playwright__browser_navigate to go to each URL');
  console.log('2. Wait for page load');
  console.log('3. Use mcp__playwright__browser_snapshot to get page state');
  console.log('4. Hover on info icon near "Profit / Loss" to reveal tooltip');
  console.log('5. Extract: Volume traded, Gain, Loss, Net total');
  console.log('6. Save result:');
  console.log('   npx tsx scripts/pnl/validate-duel-vs-ui-synthetic.ts --save "0x...,+$1234.56"');
  console.log('   Or with full data:');
  console.log('   npx tsx scripts/pnl/validate-duel-vs-ui-synthetic.ts --save "0x...,volume,gain,loss,net_total"');
  console.log('7. For wallets to skip:');
  console.log('   npx tsx scripts/pnl/validate-duel-vs-ui-synthetic.ts --skip "0x...,reason"');
  console.log('');
}

async function saveScrapedResult(args: string) {
  const checkpoint = loadCheckpoint();
  if (!checkpoint) {
    console.error('No active validation run. Start with --count=N');
    return;
  }

  const results = loadResults();
  const parts = args.split(',').map((p) => p.trim());

  if (parts.length < 2) {
    console.error('Usage: --save "wallet,net_total" or --save "wallet,volume,gain,loss,net_total"');
    return;
  }

  const wallet = parts[0].toLowerCase();
  const sample = checkpoint.sampled_wallets.find((w) => w.wallet_address === wallet);

  if (!sample) {
    console.error(`Wallet ${wallet} not in current validation sample`);
    return;
  }

  if (checkpoint.completed_wallets.includes(wallet)) {
    console.log(`Wallet ${wallet} already recorded, updating...`);
    const existingIdx = results.findIndex((r) => r.wallet === wallet);
    if (existingIdx >= 0) {
      results.splice(existingIdx, 1);
    }
    checkpoint.completed_wallets = checkpoint.completed_wallets.filter((w) => w !== wallet);
  }

  let ui_net_total: number | null;
  let ui_volume: number | null = null;
  let ui_gain: number | null = null;
  let ui_loss: number | null = null;

  if (parts.length === 2) {
    ui_net_total = parseDollarAmount(parts[1]);
  } else if (parts.length >= 5) {
    ui_volume = parseDollarAmount(parts[1]);
    ui_gain = parseDollarAmount(parts[2]);
    ui_loss = parseDollarAmount(parts[3]);
    ui_net_total = parseDollarAmount(parts[4]);
  } else {
    console.error('Invalid format');
    return;
  }

  if (ui_net_total === null) {
    console.error('Could not parse net_total value');
    return;
  }

  // ============================================================================
  // GATE 1: Token mapping coverage (from pm_trader_events_dedup_v2_tbl)
  // ============================================================================
  console.log('Checking token mapping coverage...');
  const coverage = await computeMappingCoverage(wallet);
  console.log(`  Fill volume: $${coverage.fill_volume.toFixed(2)}`);
  console.log(`  Mapped volume: $${coverage.mapped_volume.toFixed(2)}`);
  console.log(`  Mapping coverage: ${(coverage.mapping_coverage * 100).toFixed(1)}%`);
  console.log(`  Fill count: ${coverage.fill_count} (${coverage.mapped_count} mapped)`);

  // Helper to create skip result
  const createSkipResult = (skipReason: string, flatCheck?: FlatCheck): ValidationResult => ({
    wallet,
    tier: sample.tier,
    our_realized: 0,
    our_unrealized: 0,
    our_total: 0,
    ui_proxy_realized: null,
    ui_net_total,
    ui_volume,
    ui_gain,
    ui_loss,
    delta: null,
    delta_pct: null,
    abs_delta: null,
    abs_delta_pct_of_volume: null,
    delta_pct_of_ui_abs: null,
    strict_tolerance_used: null,
    passes_strict: null,
    passes_loose: null,
    passes: null,
    failure_reason: null,
    strict_failure_reason: null,
    has_open_positions: false,
    is_flat: flatCheck?.is_flat ?? false,
    skipped: true,
    skip_reason: skipReason,
    scraped_at: new Date().toISOString(),
    erc1155_transfer_count: sample.erc1155_transfer_count,
    split_merge_count: sample.split_merge_count,
    clob_trade_count: sample.clob_trade_count,
    fill_volume: coverage.fill_volume,
    mapped_volume: coverage.mapped_volume,
    mapping_coverage: coverage.mapping_coverage,
    fill_count: coverage.fill_count,
    mapped_count: coverage.mapped_count,
    non_flat_positions: flatCheck?.non_flat_positions ?? null,
    max_abs_net_shares: flatCheck?.max_abs_net_shares ?? null,
  });

  // Skip if mapping coverage is too low
  if (coverage.mapping_coverage < MIN_MAPPING_COVERAGE) {
    console.log(`\n⚠️ SKIP_COVERAGE: Mapping coverage ${(coverage.mapping_coverage * 100).toFixed(1)}% < ${MIN_MAPPING_COVERAGE * 100}%`);
    results.push(createSkipResult(`SKIP_COVERAGE: ${(coverage.mapping_coverage * 100).toFixed(1)}% < ${MIN_MAPPING_COVERAGE * 100}%`));
    checkpoint.completed_wallets.push(wallet);
    saveResults(results);
    saveCheckpoint(checkpoint);
    showNextBatch(checkpoint, results);
    return;
  }

  // ============================================================================
  // GATE 2: Flat position check (--no-open mode) - fill-based, same source as V17
  // ============================================================================
  console.log('Checking flat position status...');
  const flatCheck = await computeNetShares(wallet);
  console.log(`  Is flat: ${flatCheck.is_flat}`);
  console.log(`  Total positions: ${flatCheck.total_positions}`);
  console.log(`  Non-flat positions: ${flatCheck.non_flat_positions}`);
  if (!flatCheck.is_flat) {
    console.log(`  Max net shares: ${flatCheck.max_abs_net_shares.toFixed(6)}`);
  }

  // NOTE: Flat check disabled - UI considers resolved positions as "closed" even if share balances remain
  // We now validate all wallets and let UI Positions Value determine effective flatness
  if (checkpoint.no_open && !flatCheck.is_flat) {
    console.log(`\n⚠️ NON-FLAT (by share balance): ${flatCheck.non_flat_positions} positions (max=${flatCheck.max_abs_net_shares.toFixed(4)} shares)`);
    console.log(`   Proceeding anyway - UI Positions Value determines effective flatness`);
  }

  // ============================================================================
  // Compute fresh PnL using V18 engine (maker-only for UI parity)
  // ============================================================================
  console.log('Computing fresh PnL with V18 engine (maker-only for UI parity)...');
  const engine = createV18Engine();
  const freshMetrics = await engine.compute(wallet);

  const our_realized = freshMetrics.realized_pnl;
  const our_unrealized = freshMetrics.unrealized_pnl;
  const our_total = freshMetrics.total_pnl;
  const has_open_positions = freshMetrics.unrealized_pnl !== 0 || freshMetrics.positions.some((p) => !p.is_resolved);

  // ============================================================================
  // Compute UI proxy realized (raw cashflow without paired-outcome normalization)
  // ============================================================================
  console.log('Computing UI proxy realized (raw cashflow)...');
  const ui_proxy_realized = await computeUiProxyRealized(wallet);
  console.log(`  UI proxy realized: $${ui_proxy_realized.toFixed(2)}`);

  // For comparison: use total PnL if has open positions, otherwise realized
  const our_value = has_open_positions ? our_total : our_realized;

  const delta = our_value - ui_net_total;
  const deltaPct = Math.abs(ui_net_total) > 0 ? delta / Math.abs(ui_net_total) : delta;

  // Check passes with both strict and loose criteria
  const passResult = checkPasses(our_value, ui_net_total, ui_volume);

  const result: ValidationResult = {
    wallet,
    tier: sample.tier,
    // Engine outputs
    our_realized,
    our_unrealized,
    our_total,
    ui_proxy_realized,
    // Scraped UI values
    ui_net_total,
    ui_volume,
    ui_gain,
    ui_loss,
    // Delta metrics
    delta,
    delta_pct: deltaPct,
    abs_delta: passResult.abs_delta,
    abs_delta_pct_of_volume: passResult.abs_delta_pct_of_volume,
    delta_pct_of_ui_abs: passResult.delta_pct_of_ui_abs,
    strict_tolerance_used: passResult.strict_tolerance_used,
    // Pass/fail results
    passes_strict: passResult.passes_strict,
    passes_loose: passResult.passes_loose,
    passes: passResult.passes_loose,  // Legacy: backwards compat with old reports
    failure_reason: passResult.loose_reason,
    strict_failure_reason: passResult.strict_reason,
    // Wallet state
    has_open_positions,
    is_flat: flatCheck.is_flat,
    skipped: false,
    skip_reason: null,
    scraped_at: new Date().toISOString(),
    // Complexity signals from sample
    erc1155_transfer_count: sample.erc1155_transfer_count,
    split_merge_count: sample.split_merge_count,
    clob_trade_count: sample.clob_trade_count,
    // Coverage signals (from pm_trader_events_dedup_v2_tbl)
    fill_volume: coverage.fill_volume,
    mapped_volume: coverage.mapped_volume,
    mapping_coverage: coverage.mapping_coverage,
    fill_count: coverage.fill_count,
    mapped_count: coverage.mapped_count,
    // Flat check signals
    non_flat_positions: flatCheck.non_flat_positions,
    max_abs_net_shares: flatCheck.max_abs_net_shares,
  };

  results.push(result);
  checkpoint.completed_wallets.push(wallet);
  saveResults(results);
  saveCheckpoint(checkpoint);

  // OUTPUT: Only print "PASS ✓" for STRICT passes
  const strictStr = passResult.passes_strict ? 'PASS ✓' : 'FAIL ✗';
  const looseStr = passResult.passes_loose ? '(loose: ✓)' : '(loose: ✗)';
  console.log(`\n${strictStr} ${looseStr} ${wallet}`);
  console.log(`  Has open positions: ${has_open_positions}`);
  console.log(`  Our: $${our_value.toFixed(2)} (realized=$${our_realized.toFixed(2)}, unrealized=$${our_unrealized.toFixed(2)})`);
  console.log(`  UI proxy (raw): $${ui_proxy_realized.toFixed(2)} (delta from UI: $${(ui_proxy_realized - ui_net_total).toFixed(2)})`);
  console.log(`  UI: $${ui_net_total.toFixed(2)}`);
  console.log(`  |Δ|=$${passResult.abs_delta.toFixed(2)} | tolerance=$${passResult.strict_tolerance_used.toFixed(2)}`);
  if (passResult.delta_pct_of_ui_abs !== null) {
    console.log(`  |Δ|/|UI|: ${(passResult.delta_pct_of_ui_abs * 100).toFixed(2)}%`);
  }
  if (passResult.strict_reason) console.log(`  Strict fail: ${passResult.strict_reason}`);

  showNextBatch(checkpoint, results);
}

function skipWallet(args: string) {
  const checkpoint = loadCheckpoint();
  if (!checkpoint) {
    console.error('No active validation run. Start with --count=N');
    return;
  }

  const results = loadResults();
  const parts = args.split(',').map((p) => p.trim());

  if (parts.length < 2) {
    console.error('Usage: --skip "wallet,reason"');
    return;
  }

  const wallet = parts[0].toLowerCase();
  const reason = parts.slice(1).join(',');

  const sample = checkpoint.sampled_wallets.find((w) => w.wallet_address === wallet);
  if (!sample) {
    console.error(`Wallet ${wallet} not in current validation sample`);
    return;
  }

  if (checkpoint.completed_wallets.includes(wallet)) {
    console.log(`Wallet ${wallet} already recorded, skipping update`);
    return;
  }

  const result: ValidationResult = {
    wallet,
    tier: sample.tier,
    our_realized: sample.realized_economic,
    our_unrealized: 0,
    our_total: sample.realized_economic,
    ui_proxy_realized: null,
    ui_net_total: null,
    ui_volume: null,
    ui_gain: null,
    ui_loss: null,
    delta: null,
    delta_pct: null,
    abs_delta: null,
    abs_delta_pct_of_volume: null,
    delta_pct_of_ui_abs: null,
    strict_tolerance_used: null,
    passes_strict: null,
    passes_loose: null,
    passes: null,
    failure_reason: null,
    strict_failure_reason: null,
    has_open_positions: false,
    is_flat: false,
    skipped: true,
    skip_reason: reason,
    scraped_at: new Date().toISOString(),
    erc1155_transfer_count: sample.erc1155_transfer_count,
    split_merge_count: sample.split_merge_count,
    clob_trade_count: sample.clob_trade_count,
    fill_volume: null,
    mapped_volume: null,
    mapping_coverage: null,
    fill_count: null,
    mapped_count: null,
    non_flat_positions: null,
    max_abs_net_shares: null,
  };

  results.push(result);
  checkpoint.completed_wallets.push(wallet);
  saveResults(results);
  saveCheckpoint(checkpoint);

  console.log(`\nSKIPPED ${wallet}: ${reason}`);
  showNextBatch(checkpoint, results);
}

function resumeValidation() {
  const checkpoint = loadCheckpoint();
  if (!checkpoint) {
    console.error('No checkpoint found. Start a new validation with --count=N');
    return;
  }

  const results = loadResults();
  console.log(`\nResuming validation: ${checkpoint.run_id}`);
  console.log(`Started: ${checkpoint.started_at}`);
  console.log(`CLOB-only: ${checkpoint.clob_only ?? false}`);
  console.log(`High-coverage: ${checkpoint.high_coverage ?? false}`);
  console.log(`No-open: ${checkpoint.no_open ?? false}`);
  showNextBatch(checkpoint, results);
}

function printReportSummary(report: ValidationReport) {
  // Extract extended metrics if present
  const extReport = report as any;
  const passRateLoose = extReport.pass_rate_loose ?? null;
  const passedLoose = extReport.total_passed_loose ?? null;
  const failedLoose = extReport.total_failed_loose ?? null;

  // Calculate skip reason breakdown
  const skipped = report.results.filter((r) => r.skipped);
  const skipReasons = new Map<string, number>();
  for (const r of skipped) {
    const reason = r.skip_reason?.split(':')[0] || 'UNKNOWN';
    skipReasons.set(reason, (skipReasons.get(reason) || 0) + 1);
  }

  // Calculate flat-only cohort stats (the export cohort)
  const flatOnly = report.results.filter((r) => !r.skipped && r.is_flat === true);
  const flatOnlyPassed = flatOnly.filter((r) => r.passes_strict === true);
  const flatOnlyFailed = flatOnly.filter((r) => r.passes_strict === false);
  const flatPassRate = flatOnly.length > 0 ? flatOnlyPassed.length / flatOnly.length : 0;

  // Count wallets with open positions
  const hasOpenPositions = report.results.filter((r) => !r.skipped && r.has_open_positions).length;
  const notFlat = report.results.filter((r) => !r.skipped && !r.is_flat).length;

  console.log('\n' + '='.repeat(80));
  console.log('VALIDATION REPORT');
  console.log('='.repeat(80));
  console.log(`Run ID: ${report.run_id}`);
  console.log(`Started: ${report.started_at}`);
  console.log(`Completed: ${report.completed_at}`);
  console.log('');
  console.log('SAMPLE BREAKDOWN:');
  console.log(`  Total sampled: ${report.total_sampled}`);
  console.log(`  Total validated: ${report.total_validated}`);
  console.log(`  Total skipped: ${report.total_skipped}`);
  if (skipReasons.size > 0) {
    console.log('  Skip reasons:');
    for (const [reason, count] of skipReasons.entries()) {
      console.log(`    - ${reason}: ${count}`);
    }
  }
  console.log(`  With open positions: ${hasOpenPositions}`);
  console.log(`  Not flat: ${notFlat}`);
  console.log('');

  // FLAT-ONLY COHORT (the export cohort)
  console.log('FLAT-ONLY COHORT (export cohort):');
  console.log(`  Total flat wallets: ${flatOnly.length}`);
  console.log(`  Strict passed: ${flatOnlyPassed.length}`);
  console.log(`  Strict failed: ${flatOnlyFailed.length}`);
  console.log(`  Pass rate: ${(flatPassRate * 100).toFixed(1)}%`);
  if (flatPassRate >= 0.95) {
    console.log('  ✓ FLAT COHORT READY FOR EXPORT');
  } else {
    console.log('  ✗ Flat cohort not yet at 95% pass rate');
  }
  console.log('');

  console.log('ALL VALIDATED (strict):');
  console.log(`  Passed: ${report.total_passed}`);
  console.log(`  Failed: ${report.total_failed}`);
  console.log(`  Pass rate: ${(report.pass_rate * 100).toFixed(1)}%`);
  if (passRateLoose !== null) {
    console.log('');
    console.log('ALL VALIDATED (loose - legacy):');
    console.log(`  Passed: ${passedLoose}`);
    console.log(`  Failed: ${failedLoose}`);
    console.log(`  Pass rate: ${(passRateLoose * 100).toFixed(1)}%`);
  }
  console.log('');
  console.log('DELTA STATISTICS:');
  console.log(`  p50: $${report.p50_delta.toFixed(2)}`);
  console.log(`  p95: $${report.p95_delta.toFixed(2)}`);
  console.log(`  Max: $${report.max_delta.toFixed(2)}`);
  console.log('');

  if (report.meets_acceptance_criteria) {
    console.log('✓ MEETS ACCEPTANCE CRITERIA (STRICT pass rate >= 95%)');
  } else {
    console.log('✗ DOES NOT MEET ACCEPTANCE CRITERIA');
  }

  if (report.failures.length > 0) {
    console.log('\nTOP 10 STRICT FAILURES (by delta):');
    const sortedFailures = [...report.failures].sort((a, b) =>
      Math.abs(b.abs_delta || 0) - Math.abs(a.abs_delta || 0)
    );
    for (const f of sortedFailures.slice(0, 10)) {
      const strictReason = f.strict_failure_reason || f.failure_reason || 'Unknown';
      const absDeltaStr = f.abs_delta != null ? `$${f.abs_delta.toFixed(2)}` : '?';
      console.log(`  ${f.wallet.slice(0, 10)}...: ${strictReason}`);
      console.log(`    Our: $${f.our_total.toFixed(2)} | UI: $${f.ui_net_total?.toFixed(2)} | |Δ|=${absDeltaStr}`);
      if (f.ui_proxy_realized != null) {
        console.log(`    UI proxy (raw): $${f.ui_proxy_realized.toFixed(2)}`);
      }
    }
    if (report.failures.length > 10) {
      console.log(`  ... and ${report.failures.length - 10} more`);
    }
  }

  console.log(`\nFull report saved to: ${REPORT_FILE}`);
  console.log(`Export CSV: npx tsx scripts/pnl/validate-duel-vs-ui-synthetic.ts --csv`);
}

function showReport() {
  if (!fs.existsSync(REPORT_FILE)) {
    console.error('No report found. Complete a validation first.');
    return;
  }

  const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf-8')) as ValidationReport;
  printReportSummary(report);
}

// ============================================================================
// CSV Export
// ============================================================================

const CSV_FILE = path.join(CHECKPOINT_DIR, 'validation_dataset.csv');

function exportToCsv() {
  const results = loadResults();
  if (results.length === 0) {
    console.error('No results to export. Complete some validations first.');
    return;
  }

  // CSV header - all fields for dataset analysis
  const headers = [
    'wallet',
    'tier',
    // UI values
    'ui_net_total',
    'ui_gain',
    'ui_loss',
    'ui_volume',
    // Engine outputs
    'engine_realized',
    'engine_unrealized',
    'engine_total',
    'ui_proxy_realized',
    // Delta metrics
    'abs_delta',
    'delta_pct_of_ui_abs',
    'strict_tolerance_used',
    // Pass/fail
    'passes_strict',
    'passes_loose',
    'strict_failure_reason',
    // Wallet state
    'has_open_positions',
    'is_flat',
    'skipped',
    'skip_reason',
    // Coverage signals
    'mapping_coverage',
    'mapped_count',
    'fill_count',
    // Complexity signals
    'erc1155_transfer_count',
    'split_merge_count',
    'clob_trade_count',
  ];

  const csvRows: string[] = [headers.join(',')];

  for (const r of results) {
    const row = [
      r.wallet,
      r.tier,
      // UI values
      r.ui_net_total?.toFixed(2) ?? '',
      r.ui_gain?.toFixed(2) ?? '',
      r.ui_loss?.toFixed(2) ?? '',
      r.ui_volume?.toFixed(2) ?? '',
      // Engine outputs
      r.our_realized?.toFixed(2) ?? '',
      r.our_unrealized?.toFixed(2) ?? '',
      r.our_total?.toFixed(2) ?? '',
      r.ui_proxy_realized?.toFixed(2) ?? '',
      // Delta metrics
      r.abs_delta?.toFixed(4) ?? '',
      r.delta_pct_of_ui_abs?.toFixed(6) ?? '',
      r.strict_tolerance_used?.toFixed(4) ?? '',
      // Pass/fail
      r.passes_strict === null ? '' : r.passes_strict ? '1' : '0',
      r.passes_loose === null ? '' : r.passes_loose ? '1' : '0',
      `"${r.strict_failure_reason?.replace(/"/g, '""') ?? ''}"`,
      // Wallet state
      r.has_open_positions ? '1' : '0',
      r.is_flat ? '1' : '0',
      r.skipped ? '1' : '0',
      `"${r.skip_reason?.replace(/"/g, '""') ?? ''}"`,
      // Coverage signals
      r.mapping_coverage?.toFixed(4) ?? '',
      r.mapped_count?.toString() ?? '',
      r.fill_count?.toString() ?? '',
      // Complexity signals
      r.erc1155_transfer_count?.toString() ?? '',
      r.split_merge_count?.toString() ?? '',
      r.clob_trade_count?.toString() ?? '',
    ];
    csvRows.push(row.join(','));
  }

  fs.writeFileSync(CSV_FILE, csvRows.join('\n'));
  console.log(`Exported ${results.length} results to: ${CSV_FILE}`);
  console.log('\nTo analyze, sort by abs_delta desc or ui_net_total desc:');
  console.log(`  sort -t, -k11 -nr ${CSV_FILE} | head -20`);
}

// ============================================================================
// --next=N Command: Show next N unlabeled wallets
// ============================================================================

function showNextWallets(count: number) {
  const checkpoint = loadCheckpoint();
  if (!checkpoint) {
    console.error('No checkpoint found. Start a new validation with --count=N');
    return;
  }

  const remaining = checkpoint.sampled_wallets.filter(
    (w) => !checkpoint.completed_wallets.includes(w.wallet_address)
  );

  if (remaining.length === 0) {
    console.log('All wallets have been labeled!');
    return;
  }

  const batch = remaining.slice(0, count);
  console.log(`\n${'='.repeat(80)}`);
  console.log(`NEXT ${batch.length} UNLABELED WALLETS (of ${remaining.length} remaining)`);
  console.log('='.repeat(80));
  console.log('');
  console.log('Copy-paste list:');
  for (const w of batch) {
    console.log(w.wallet_address);
  }
  console.log('');
  console.log('With URLs:');
  for (let i = 0; i < batch.length; i++) {
    const w = batch[i];
    console.log(`${i + 1}. ${w.wallet_address}`);
    console.log(`   https://polymarket.com/profile/${w.wallet_address}`);
  }
}

// ============================================================================
// --autoscrape Command: Automated Playwright UI scraping
// ============================================================================
// This function uses Playwright MCP tools to:
// 1. Navigate to each wallet's Polymarket profile
// 2. Hover on the P/L info icon to reveal the tooltip
// 3. Parse the tooltip values (Volume, Gain, Loss, Net total)
// 4. Save the result or record a skip
// ============================================================================

interface ScrapeResult {
  success: boolean;
  wallet: string;
  volume?: number;
  gain?: number;
  loss?: number;
  netTotal?: number;
  error?: string;
}

// Placeholder for Playwright MCP integration
// The actual scraping will be done via Claude's tool calls
async function scrapeWalletUI(wallet: string): Promise<ScrapeResult> {
  // This is called from the CLI but the actual Playwright operations
  // must be done via Claude's MCP tools. This function is a stub
  // that will be replaced by the autoscrape loop in main().
  return {
    success: false,
    wallet,
    error: 'Scraping must be done via Playwright MCP tools',
  };
}

// Parse tooltip text into structured values
function parseTooltipText(text: string): { volume?: number; gain?: number; loss?: number; netTotal?: number } {
  const result: { volume?: number; gain?: number; loss?: number; netTotal?: number } = {};

  // Match patterns like "Volume traded $1,234.56" or "Net total +$567.89"
  const volumeMatch = text.match(/Volume\s+traded\s*\$?([\d,]+\.?\d*)/i);
  const gainMatch = text.match(/Gain\s*\+?\$?([\d,]+\.?\d*)/i);
  const lossMatch = text.match(/Loss\s*-?\$?([\d,]+\.?\d*)/i);
  const netMatch = text.match(/Net\s+total\s*([+-]?\$?[\d,]+\.?\d*)/i);

  if (volumeMatch) {
    result.volume = parseFloat(volumeMatch[1].replace(/,/g, ''));
  }
  if (gainMatch) {
    result.gain = parseFloat(gainMatch[1].replace(/,/g, ''));
  }
  if (lossMatch) {
    result.loss = parseFloat(lossMatch[1].replace(/,/g, ''));
  }
  if (netMatch) {
    const netStr = netMatch[1].replace(/[$,+]/g, '');
    result.netTotal = parseFloat(netStr);
  }

  return result;
}

// Generate autoscrape instructions for Claude
function printAutoscrapeInstructions(wallets: string[]) {
  console.log(`\n${'='.repeat(80)}`);
  console.log('AUTOSCRAPE MODE - Playwright MCP Required');
  console.log('='.repeat(80));
  console.log(`\nReady to scrape ${wallets.length} wallets.`);
  console.log('\nThis mode requires Claude to execute Playwright MCP tools.');
  console.log('For each wallet, Claude will:');
  console.log('  1. Navigate to https://polymarket.com/profile/{wallet}');
  console.log('  2. Wait for page load');
  console.log('  3. Find and hover on info icon near "Profit / Loss"');
  console.log('  4. Extract tooltip values: Volume, Gain, Loss, Net total');
  console.log('  5. Save result via saveScrapedResult() or skip on failure');
  console.log('\n' + '-'.repeat(80));
  console.log('WALLETS TO SCRAPE:');
  console.log('-'.repeat(80));
  for (let i = 0; i < wallets.length; i++) {
    console.log(`  ${i + 1}. ${wallets[i]}`);
  }
  console.log('\n' + '='.repeat(80));
  console.log('To start autoscrape, Claude should now execute the scraping loop.');
  console.log('='.repeat(80));
}

// Entry point for --autoscrape command
async function startAutoscrape(limit: number) {
  const checkpoint = loadCheckpoint();
  if (!checkpoint) {
    console.error('No checkpoint found. Start a new validation with --count=N first.');
    return null;
  }

  const remaining = checkpoint.sampled_wallets.filter(
    (w) => !checkpoint.completed_wallets.includes(w.wallet_address)
  );

  if (remaining.length === 0) {
    console.log('All wallets have been labeled! Nothing to scrape.');
    return null;
  }

  const toScrape = remaining.slice(0, limit).map((w) => w.wallet_address);
  printAutoscrapeInstructions(toScrape);

  return toScrape;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  let count = 25;
  let tierFilter = 'AB';
  let clobOnly = false;
  let highCoverage = false;
  let noOpen = false;
  let flatOnlySample = false;
  let timeWindowDays = 180; // Default: last 180 days of fills
  let autoscrapeLimit = 0;

  for (const arg of args) {
    if (arg.startsWith('--count=')) {
      count = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--tier=')) {
      tierFilter = arg.split('=')[1].toUpperCase();
    } else if (arg === '--clob-only') {
      clobOnly = true;
    } else if (arg === '--high-coverage') {
      highCoverage = true;
    } else if (arg === '--no-open') {
      noOpen = true;
    } else if (arg === '--flat-only-sample') {
      flatOnlySample = true;
    } else if (arg.startsWith('--time-window-days=')) {
      timeWindowDays = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--limit=')) {
      autoscrapeLimit = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--resume') {
      resumeValidation();
      await clickhouse.close();
      return;
    } else if (arg === '--report') {
      showReport();
      await clickhouse.close();
      return;
    } else if (arg === '--csv') {
      exportToCsv();
      await clickhouse.close();
      return;
    } else if (arg.startsWith('--next=')) {
      const nextCount = parseInt(arg.split('=')[1], 10);
      showNextWallets(nextCount);
      await clickhouse.close();
      return;
    } else if (arg === '--autoscrape') {
      // Autoscrape mode - requires --limit=N
      const limit = autoscrapeLimit || 10;
      const wallets = await startAutoscrape(limit);
      if (wallets && wallets.length > 0) {
        // Output wallets as JSON for Claude to process
        console.log('\n__AUTOSCRAPE_WALLETS_JSON__');
        console.log(JSON.stringify(wallets));
        console.log('__END_AUTOSCRAPE_WALLETS_JSON__');
      }
      await clickhouse.close();
      return;
    } else if (arg.startsWith('--save')) {
      const idx = args.indexOf(arg);
      const value = args[idx + 1];
      if (value) {
        await saveScrapedResult(value);
      } else {
        console.error('--save requires a value');
      }
      await clickhouse.close();
      return;
    } else if (arg.startsWith('--skip')) {
      const idx = args.indexOf(arg);
      const value = args[idx + 1];
      if (value) {
        skipWallet(value);
      } else {
        console.error('--skip requires a value');
      }
      await clickhouse.close();
      return;
    }
  }

  // Start new validation with all options
  await startNewValidation({
    count,
    tierFilter,
    clobOnly,
    highCoverage,
    noOpen,
    flatOnlySample,
    timeWindowDays,
  });
  await clickhouse.close();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
