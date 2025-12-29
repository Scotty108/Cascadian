#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * BUILD COHORT MANIFEST - Single Source of Truth for Wallet Cohorts
 * ============================================================================
 *
 * Creates a comprehensive manifest of wallet cohorts that ALL validation
 * scripts can consume. This ensures consistent cohort definitions across:
 * - validate-v11-vs-dome-no-transfers.ts
 * - validate-v29-vs-dome-no-transfers.ts
 * - validate-ui-parity.ts
 * - run-unified-scorecard.ts
 *
 * Cohorts:
 * - transfer_free: No ERC1155 transfers
 * - clob_only: Only CLOB trades, no CTF events
 * - clob_only_closed: CLOB-only with all positions closed
 * - clob_only_open: CLOB-only with active positions
 * - trader_strict: CLOB-only + transfer-free + no splits/merges
 * - large_pnl: |PnL| >= $200 (for leaderboard relevance)
 * - clean_large_traders: trader_strict + large_pnl
 *
 * Usage:
 *   npx tsx scripts/pnl/build-cohort-manifest.ts [options]
 *
 * Options:
 *   --limit=N         Max wallets per cohort (default: 500)
 *   --min-trades=N    Minimum trade count (default: 5)
 *   --output=PATH     Output file (default: tmp/pnl_cohort_manifest.json)
 *   --dome-only       Only include wallets with Dome benchmarks
 *
 * Terminal: Claude 1 (Main Terminal)
 * Date: 2025-12-07
 */

import fs from 'fs';
import { getClickHouseClient } from '../../lib/clickhouse/client';

// ============================================================================
// CLI Parsing
// ============================================================================

const args = process.argv.slice(2);
let limit = 500;
let minTrades = 5;
let output = 'tmp/pnl_cohort_manifest.json';
let domeOnly = false;

for (const arg of args) {
  if (arg.startsWith('--limit=')) limit = parseInt(arg.split('=')[1]);
  if (arg.startsWith('--min-trades=')) minTrades = parseInt(arg.split('=')[1]);
  if (arg.startsWith('--output=')) output = arg.split('=')[1];
  if (arg === '--dome-only') domeOnly = true;
}

// ============================================================================
// Types
// ============================================================================

export type CohortType =
  | 'transfer_free'
  | 'clob_only'
  | 'clob_only_closed'
  | 'clob_only_open'
  | 'trader_strict'
  | 'mixed_source'
  | 'maker_heavy'
  | 'large_pnl'
  | 'clean_large_traders';

export interface WalletCohortEntry {
  wallet: string;
  cohorts: CohortType[];
  trade_count: number;
  transfer_count: number;
  split_count: number;
  merge_count: number;
  redeem_count: number;
  has_active_positions: boolean;
  estimated_pnl: number;
  dome_realized?: number;
  dome_confidence?: string;
}

export interface CohortManifest {
  generated_at: string;
  config: {
    limit: number;
    min_trades: number;
    dome_only: boolean;
  };
  summary: {
    total_wallets: number;
    by_cohort: Record<CohortType, number>;
  };
  wallets: WalletCohortEntry[];
  cohort_lists: Record<CohortType, string[]>;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('');
  console.log('='.repeat(80));
  console.log('BUILD COHORT MANIFEST');
  console.log('='.repeat(80));
  console.log('');
  console.log('Config:');
  console.log(`  limit: ${limit}`);
  console.log(`  min-trades: ${minTrades}`);
  console.log(`  output: ${output}`);
  console.log(`  dome-only: ${domeOnly}`);
  console.log('');

  const client = getClickHouseClient();

  // ========================================================================
  // Step 1: Get base wallet set
  // ========================================================================
  console.log('Step 1: Getting base wallet set...');

  let baseWallets: Map<string, { trade_count: number; estimated_pnl: number }>;

  if (domeOnly) {
    // Use Dome benchmarks as base
    const domeQuery = `
      SELECT
        lower(wallet_address) as wallet,
        dome_realized_value,
        dome_confidence
      FROM pm_dome_realized_benchmarks_v1
      WHERE dome_realized_value IS NOT NULL
        AND is_placeholder = 0
    `;
    const domeResult = await client.query({ query: domeQuery, format: 'JSONEachRow' });
    const domeRows = await domeResult.json<Array<{
      wallet: string;
      dome_realized_value: string;
      dome_confidence: string;
    }>>();

    baseWallets = new Map();
    for (const r of domeRows) {
      baseWallets.set(r.wallet, {
        trade_count: 0,
        estimated_pnl: parseFloat(r.dome_realized_value),
      });
    }
    console.log(`  Found ${baseWallets.size} wallets with Dome benchmarks`);
  } else {
    // Use active traders as base
    const tradersQuery = `
      SELECT
        lower(trader_wallet) as wallet,
        count() as trade_count,
        sum(CASE WHEN side = 'BUY' THEN -usdc_amount ELSE usdc_amount END) / 1e6 as pnl
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY wallet
      HAVING trade_count >= ${minTrades}
      ORDER BY abs(pnl) DESC
      LIMIT ${limit * 3}
    `;
    const tradersResult = await client.query({ query: tradersQuery, format: 'JSONEachRow' });
    const tradersRows = await tradersResult.json<Array<{
      wallet: string;
      trade_count: string;
      pnl: string;
    }>>();

    baseWallets = new Map();
    for (const r of tradersRows) {
      baseWallets.set(r.wallet, {
        trade_count: parseInt(r.trade_count),
        estimated_pnl: parseFloat(r.pnl),
      });
    }
    console.log(`  Found ${baseWallets.size} wallets with >= ${minTrades} trades`);
  }

  const walletList = Array.from(baseWallets.keys());

  // ========================================================================
  // Step 2: Get transfer counts
  // ========================================================================
  console.log('Step 2: Checking ERC1155 transfers...');

  const transferCounts = new Map<string, number>();
  const CHUNK_SIZE = 100;

  for (let i = 0; i < walletList.length; i += CHUNK_SIZE) {
    const chunk = walletList.slice(i, i + CHUNK_SIZE);
    const quoted = chunk.map(w => `'${w}'`).join(',');

    const query = `
      SELECT wallet, count() as cnt FROM (
        SELECT lower(from_address) as wallet FROM pm_erc1155_transfers WHERE lower(from_address) IN (${quoted})
        UNION ALL
        SELECT lower(to_address) as wallet FROM pm_erc1155_transfers WHERE lower(to_address) IN (${quoted})
      ) GROUP BY wallet
    `;

    const result = await client.query({ query, format: 'JSONEachRow' });
    const rows = await result.json<Array<{ wallet: string; cnt: string }>>();

    for (const r of rows) {
      transferCounts.set(r.wallet, parseInt(r.cnt));
    }

    process.stdout.write(`\r  Checked ${Math.min(i + CHUNK_SIZE, walletList.length)}/${walletList.length} wallets...`);
  }
  console.log('');

  // ========================================================================
  // Step 3: Get CTF event counts (splits/merges/redemptions)
  // ========================================================================
  console.log('Step 3: Checking CTF events...');

  const ctfCounts = new Map<string, { splits: number; merges: number; redeems: number }>();

  for (let i = 0; i < walletList.length; i += CHUNK_SIZE) {
    const chunk = walletList.slice(i, i + CHUNK_SIZE);
    const quoted = chunk.map(w => `'${w}'`).join(',');

    try {
      const query = `
        SELECT
          lower(wallet_address) as wallet,
          countIf(event_type IN ('SPLIT', 'ConditionSplit')) as splits,
          countIf(event_type IN ('MERGE', 'ConditionMerge')) as merges,
          countIf(event_type IN ('REDEEM', 'PayoutRedemption')) as redeems
        FROM pm_ctf_events
        WHERE lower(wallet_address) IN (${quoted})
        GROUP BY wallet
      `;

      const result = await client.query({ query, format: 'JSONEachRow' });
      const rows = await result.json<Array<{
        wallet: string;
        splits: string;
        merges: string;
        redeems: string;
      }>>();

      for (const r of rows) {
        ctfCounts.set(r.wallet, {
          splits: parseInt(r.splits),
          merges: parseInt(r.merges),
          redeems: parseInt(r.redeems),
        });
      }
    } catch {
      // pm_ctf_events might not exist
    }

    process.stdout.write(`\r  Checked ${Math.min(i + CHUNK_SIZE, walletList.length)}/${walletList.length} wallets...`);
  }
  console.log('');

  // ========================================================================
  // Step 4: Check for active positions (via unified ledger source types)
  // ========================================================================
  console.log('Step 4: Checking position status and source types...');

  const walletDetails = new Map<string, {
    has_non_clob: boolean;
    has_active_positions: boolean;
  }>();

  for (let i = 0; i < walletList.length; i += CHUNK_SIZE) {
    const chunk = walletList.slice(i, i + CHUNK_SIZE);
    const quoted = chunk.map(w => `'${w}'`).join(',');

    // Check source types and position closure
    const query = `
      SELECT
        lower(wallet_address) as wallet,
        countIf(source_type != 'CLOB') > 0 as has_non_clob,
        -- Check if any condition has net tokens > 0 AND is not resolved
        sum(CASE
          WHEN abs(net_tokens) > 0.01 AND NOT is_resolved THEN 1
          ELSE 0
        END) > 0 as has_active
      FROM (
        SELECT
          wallet_address,
          condition_id,
          sum(token_delta) as net_tokens,
          any(source_type != 'CLOB') as has_non_clob_in_condition,
          source_type
        FROM pm_unified_ledger_v8_tbl
        WHERE lower(wallet_address) IN (${quoted})
          AND condition_id != ''
        GROUP BY wallet_address, condition_id, source_type
      ) pos
      LEFT JOIN (
        SELECT condition_id, 1 as is_resolved
        FROM pm_condition_resolutions
        WHERE is_deleted = 0
      ) res ON pos.condition_id = res.condition_id
      GROUP BY wallet
    `;

    try {
      const result = await client.query({ query, format: 'JSONEachRow' });
      const rows = await result.json<Array<{
        wallet: string;
        has_non_clob: string | number;
        has_active: string | number;
      }>>();

      for (const r of rows) {
        walletDetails.set(r.wallet, {
          has_non_clob: r.has_non_clob === 1 || r.has_non_clob === '1',
          has_active_positions: r.has_active === 1 || r.has_active === '1',
        });
      }
    } catch (err) {
      console.error(`\nError in position check: ${err}`);
    }

    process.stdout.write(`\r  Checked ${Math.min(i + CHUNK_SIZE, walletList.length)}/${walletList.length} wallets...`);
  }
  console.log('');

  // ========================================================================
  // Step 5: Load Dome benchmarks if not already loaded
  // ========================================================================
  console.log('Step 5: Loading Dome benchmarks...');

  const domeBenchmarks = new Map<string, { value: number; confidence: string }>();

  const domeQuery = `
    SELECT
      lower(wallet_address) as wallet,
      dome_realized_value,
      dome_confidence
    FROM pm_dome_realized_benchmarks_v1
    WHERE dome_realized_value IS NOT NULL
      AND is_placeholder = 0
  `;

  const domeResult = await client.query({ query: domeQuery, format: 'JSONEachRow' });
  const domeRows = await domeResult.json<Array<{
    wallet: string;
    dome_realized_value: string;
    dome_confidence: string;
  }>>();

  for (const r of domeRows) {
    domeBenchmarks.set(r.wallet, {
      value: parseFloat(r.dome_realized_value),
      confidence: r.dome_confidence,
    });
  }

  console.log(`  Loaded ${domeBenchmarks.size} Dome benchmarks`);

  // ========================================================================
  // Step 6: Classify wallets into cohorts
  // ========================================================================
  console.log('Step 6: Classifying wallets into cohorts...');

  const entries: WalletCohortEntry[] = [];

  for (const wallet of walletList) {
    const base = baseWallets.get(wallet);
    if (!base) continue;

    const transfer_count = transferCounts.get(wallet) || 0;
    const ctf = ctfCounts.get(wallet) || { splits: 0, merges: 0, redeems: 0 };
    const details = walletDetails.get(wallet) || { has_non_clob: false, has_active_positions: false };
    const dome = domeBenchmarks.get(wallet);

    // Determine cohorts
    const cohorts: CohortType[] = [];

    // Transfer-free
    if (transfer_count === 0) {
      cohorts.push('transfer_free');
    }

    // CLOB-only (no non-CLOB source types in ledger)
    const hasCTFEvents = ctf.splits > 0 || ctf.merges > 0 || ctf.redeems > 0;
    const isClobOnly = !details.has_non_clob && !hasCTFEvents;

    if (isClobOnly) {
      cohorts.push('clob_only');

      if (details.has_active_positions) {
        cohorts.push('clob_only_open');
      } else {
        cohorts.push('clob_only_closed');
      }
    }

    // Trader strict = CLOB-only + transfer-free + no splits/merges
    if (isClobOnly && transfer_count === 0 && ctf.splits === 0 && ctf.merges === 0) {
      cohorts.push('trader_strict');
    }

    // Mixed source (some CTF but not heavy)
    const totalEvents = base.trade_count + ctf.splits + ctf.merges + ctf.redeems;
    const ctfRatio = totalEvents > 0 ? (ctf.splits + ctf.merges) / totalEvents : 0;

    if (hasCTFEvents && ctfRatio <= 0.1) {
      cohorts.push('mixed_source');
    }

    // Maker heavy (>10% CTF events)
    if (ctfRatio > 0.1) {
      cohorts.push('maker_heavy');
    }

    // Large PnL
    const pnl = dome?.value || base.estimated_pnl;
    if (Math.abs(pnl) >= 200) {
      cohorts.push('large_pnl');
    }

    // Clean large traders
    if (cohorts.includes('trader_strict') && cohorts.includes('large_pnl')) {
      cohorts.push('clean_large_traders');
    }

    entries.push({
      wallet,
      cohorts,
      trade_count: base.trade_count,
      transfer_count,
      split_count: ctf.splits,
      merge_count: ctf.merges,
      redeem_count: ctf.redeems,
      has_active_positions: details.has_active_positions,
      estimated_pnl: base.estimated_pnl,
      dome_realized: dome?.value,
      dome_confidence: dome?.confidence,
    });

    if (entries.length >= limit) break;
  }

  // ========================================================================
  // Step 7: Build cohort lists and summary
  // ========================================================================
  console.log('Step 7: Building cohort lists...');

  const cohortTypes: CohortType[] = [
    'transfer_free',
    'clob_only',
    'clob_only_closed',
    'clob_only_open',
    'trader_strict',
    'mixed_source',
    'maker_heavy',
    'large_pnl',
    'clean_large_traders',
  ];

  const cohortLists: Record<CohortType, string[]> = {} as Record<CohortType, string[]>;
  const byCohort: Record<CohortType, number> = {} as Record<CohortType, number>;

  for (const cohort of cohortTypes) {
    cohortLists[cohort] = entries
      .filter(e => e.cohorts.includes(cohort))
      .map(e => e.wallet);
    byCohort[cohort] = cohortLists[cohort].length;
  }

  // ========================================================================
  // Step 8: Summary output
  // ========================================================================
  console.log('');
  console.log('='.repeat(80));
  console.log('COHORT SUMMARY');
  console.log('='.repeat(80));
  console.log('');

  for (const cohort of cohortTypes) {
    const count = byCohort[cohort];
    const pct = (count / entries.length * 100).toFixed(1);
    console.log(`  ${cohort.padEnd(22)} : ${String(count).padStart(5)} (${pct.padStart(5)}%)`);
  }

  console.log('');
  console.log(`Total wallets: ${entries.length}`);

  // ========================================================================
  // Step 9: Save manifest
  // ========================================================================
  const manifest: CohortManifest = {
    generated_at: new Date().toISOString(),
    config: {
      limit,
      min_trades: minTrades,
      dome_only: domeOnly,
    },
    summary: {
      total_wallets: entries.length,
      by_cohort: byCohort,
    },
    wallets: entries,
    cohort_lists: cohortLists,
  };

  fs.writeFileSync(output, JSON.stringify(manifest, null, 2));
  console.log(`\nSaved to ${output}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
