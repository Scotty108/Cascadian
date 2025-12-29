#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * BUILD CLOB-200 WALLET SET - For Dual Benchmark Experiment
 * ============================================================================
 *
 * Builds a single wallet list for the V11 vs V29 vs V23C experiment.
 * These wallets will be tested against both Dome (realized) and UI (total).
 *
 * Hard filters:
 * - CLOB-only traders (no AMM/FPMM trades)
 * - No ERC-1155 transfers (transfer_free)
 * - abs(realized) >= $200
 *
 * Priority order for sourcing:
 * 1. Wallets from Dome benchmarks with flags (pm_dome_realized_benchmarks_v1)
 * 2. Filter by clob_only = true, transfer_free = true, abs(dome_realized) >= 200
 *
 * Usage:
 *   npx tsx scripts/pnl/build-clob-200-wallet-set.ts --limit=200
 *   npx tsx scripts/pnl/build-clob-200-wallet-set.ts --limit=50 --output=tmp/clob_50_wallets.json
 *
 * Output:
 *   tmp/clob_200_wallets.json
 *
 * Terminal: Claude 1
 * Date: 2025-12-07
 */

import fs from 'fs';
import { getClickHouseClient } from '../../lib/clickhouse/client';

// ============================================================================
// CLI Parsing
// ============================================================================

const args = process.argv.slice(2);
let limit = 200;
let output = 'tmp/clob_200_wallets.json';
let transferFreeOnly = true;
let minPnl = 200;

for (const arg of args) {
  if (arg.startsWith('--limit=')) limit = parseInt(arg.split('=')[1]);
  if (arg.startsWith('--output=')) output = arg.split('=')[1];
  if (arg.startsWith('--min-pnl=')) minPnl = parseFloat(arg.split('=')[1]);
  if (arg === '--allow-transfers') transferFreeOnly = false;
}

// ============================================================================
// Types
// ============================================================================

export interface ClobWalletEntry {
  wallet_address: string;
  source: 'dome' | 'derived';
  dome_realized: number;
  dome_confidence: string;
  is_clob_only: boolean;
  is_transfer_free: boolean;
  has_active_positions: boolean;
  trade_count: number;
}

export interface ClobWalletSet {
  metadata: {
    generated_at: string;
    filters: {
      clob_only: boolean;
      transfer_free: boolean;
      min_pnl: number;
      limit: number;
    };
    total_wallets: number;
  };
  wallets: ClobWalletEntry[];
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('');
  console.log('='.repeat(80));
  console.log('BUILD CLOB-200 WALLET SET');
  console.log('='.repeat(80));
  console.log('');
  console.log('Config:');
  console.log(`  limit: ${limit}`);
  console.log(`  output: ${output}`);
  console.log(`  transfer_free_only: ${transferFreeOnly}`);
  console.log(`  min_pnl: $${minPnl}`);
  console.log('');

  const client = getClickHouseClient();

  // ========================================================================
  // Step 1: Get Dome wallets with behavioral flags
  // ========================================================================
  console.log('Step 1: Querying Dome benchmarks with behavioral flags...');

  // First check if we have pm_dome_realized_benchmarks_v1 with flags
  // If not, we'll build from scratch using pm_trader_events_v2 + pm_erc1155_transfers

  const query = `
    WITH
    -- Get trade counts per wallet (dedupe by event_id)
    wallet_trades AS (
      SELECT
        lower(trader_wallet) as wallet,
        count(DISTINCT event_id) as trade_count
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY wallet
    ),
    -- Check for ERC1155 transfers
    wallet_transfers AS (
      SELECT lower(from_address) as wallet, count() as cnt FROM pm_erc1155_transfers GROUP BY wallet
      UNION ALL
      SELECT lower(to_address) as wallet, count() as cnt FROM pm_erc1155_transfers GROUP BY wallet
    ),
    transfer_summary AS (
      SELECT wallet, sum(cnt) as transfer_count
      FROM wallet_transfers
      GROUP BY wallet
    ),
    -- Check for active positions in unified ledger
    active_positions AS (
      SELECT
        lower(wallet_address) as wallet,
        countIf(token_delta > 0) as buys,
        countIf(token_delta < 0) as sells,
        abs(sum(token_delta)) > 0.01 as has_active_positions
      FROM pm_unified_ledger_v8_tbl
      WHERE source_type = 'CLOB'
        AND condition_id IS NOT NULL AND condition_id != ''
      GROUP BY wallet
    ),
    -- Check for any non-CLOB events
    non_clob_events AS (
      SELECT
        lower(wallet_address) as wallet,
        count() as non_clob_count
      FROM pm_unified_ledger_v8_tbl
      WHERE source_type != 'CLOB'
        AND condition_id IS NOT NULL AND condition_id != ''
      GROUP BY wallet
    )
    SELECT
      d.wallet_address,
      d.dome_realized_value as dome_realized,
      d.dome_confidence,
      coalesce(t.trade_count, 0) as trade_count,
      coalesce(ts.transfer_count, 0) as transfer_count,
      coalesce(nc.non_clob_count, 0) as non_clob_count,
      coalesce(ap.has_active_positions, false) as has_active_positions,
      -- Flags
      coalesce(ts.transfer_count, 0) = 0 as is_transfer_free,
      coalesce(nc.non_clob_count, 0) = 0 as is_clob_only
    FROM pm_dome_realized_benchmarks_v1 d
    LEFT JOIN wallet_trades t ON t.wallet = lower(d.wallet_address)
    LEFT JOIN transfer_summary ts ON ts.wallet = lower(d.wallet_address)
    LEFT JOIN non_clob_events nc ON nc.wallet = lower(d.wallet_address)
    LEFT JOIN active_positions ap ON ap.wallet = lower(d.wallet_address)
    WHERE d.is_placeholder = 0
      AND d.dome_confidence = 'high'
      AND abs(d.dome_realized_value) >= ${minPnl}
      ${transferFreeOnly ? 'AND coalesce(ts.transfer_count, 0) = 0' : ''}
      AND coalesce(nc.non_clob_count, 0) = 0
      AND coalesce(t.trade_count, 0) >= 5
    ORDER BY abs(d.dome_realized_value) DESC
    LIMIT ${limit}
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const rows = await result.json<Array<{
    wallet_address: string;
    dome_realized: string;
    dome_confidence: string;
    trade_count: string;
    transfer_count: string;
    non_clob_count: string;
    has_active_positions: boolean;
    is_transfer_free: boolean;
    is_clob_only: boolean;
  }>>();

  console.log(`  Found ${rows.length} wallets matching criteria`);

  // ========================================================================
  // Step 2: Build wallet set
  // ========================================================================
  console.log('Step 2: Building wallet set...');

  const wallets: ClobWalletEntry[] = rows.map(r => ({
    wallet_address: r.wallet_address.toLowerCase(),
    source: 'dome' as const,
    dome_realized: parseFloat(r.dome_realized),
    dome_confidence: r.dome_confidence,
    is_clob_only: r.is_clob_only,
    is_transfer_free: r.is_transfer_free,
    has_active_positions: r.has_active_positions,
    trade_count: parseInt(r.trade_count),
  }));

  // ========================================================================
  // Step 3: Write output
  // ========================================================================
  console.log('Step 3: Writing output...');

  const walletSet: ClobWalletSet = {
    metadata: {
      generated_at: new Date().toISOString(),
      filters: {
        clob_only: true,
        transfer_free: transferFreeOnly,
        min_pnl: minPnl,
        limit,
      },
      total_wallets: wallets.length,
    },
    wallets,
  };

  // Ensure tmp directory exists
  if (!fs.existsSync('tmp')) {
    fs.mkdirSync('tmp', { recursive: true });
  }

  fs.writeFileSync(output, JSON.stringify(walletSet, null, 2));

  // ========================================================================
  // Summary
  // ========================================================================
  console.log('');
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Total wallets: ${wallets.length}`);
  console.log(`Output: ${output}`);
  console.log('');

  // Stats
  const positives = wallets.filter(w => w.dome_realized > 0);
  const negatives = wallets.filter(w => w.dome_realized < 0);
  const withActivePositions = wallets.filter(w => w.has_active_positions);

  console.log(`Positive PnL: ${positives.length}`);
  console.log(`Negative PnL: ${negatives.length}`);
  console.log(`With active positions: ${withActivePositions.length}`);
  console.log(`All closed positions: ${wallets.length - withActivePositions.length}`);
  console.log('');

  // Top 5 by magnitude
  console.log('Top 5 by |PnL|:');
  const sorted = [...wallets].sort((a, b) => Math.abs(b.dome_realized) - Math.abs(a.dome_realized));
  for (let i = 0; i < Math.min(5, sorted.length); i++) {
    const w = sorted[i];
    console.log(`  ${i + 1}. ${w.wallet_address.slice(0, 10)}... $${w.dome_realized.toFixed(2)}`);
  }
  console.log('');

  await client.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
