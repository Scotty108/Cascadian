/**
 * Build DUEL Metrics History Table + Latest View
 *
 * Creates two objects:
 * 1. wallet_duel_metrics_history - append-only MergeTree (every compute writes a row)
 * 2. wallet_duel_metrics_latest - view using argMax by computed_at
 *
 * This pattern allows:
 * - Debugging regressions by comparing historical values
 * - Leaderboard diffs over time
 * - Safe concurrent writes (no ReplacingMergeTree timing issues)
 *
 * Usage:
 *   npx tsx scripts/pnl/build-duel-metrics-history-table.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const HISTORY_TABLE = 'wallet_duel_metrics_history';
const LATEST_VIEW = 'wallet_duel_metrics_latest_v2'; // v2 to not conflict with existing

// IMPORTANT: argMax tie-breaker
// If two rows have the same computed_at, argMax is nondeterministic.
// We use (computed_at, run_id) as the tie-breaker key everywhere.

async function createHistoryTable() {
  console.log(`Creating ${HISTORY_TABLE} table...`);

  await clickhouse.command({ query: `DROP TABLE IF EXISTS ${HISTORY_TABLE}` });

  // Append-only MergeTree - every compute inserts a new row
  const createQuery = `
    CREATE TABLE ${HISTORY_TABLE} (
      wallet_address String,

      -- Primary metrics
      realized_economic Float64,
      realized_cash Float64,
      unrealized Float64,
      total_economic Float64,
      total_cash Float64,

      -- Decomposition
      resolved_trade_cashflow Float64,
      unresolved_trade_cashflow Float64,
      synthetic_redemptions Float64,
      explicit_redemptions Float64,

      -- Delta analysis
      economic_vs_cash_delta Float64,
      synthetic_vs_explicit_delta Float64,

      -- Activity metrics
      positions_count UInt32,
      resolved_positions UInt32,
      unresolved_positions UInt32,
      markets_traded UInt32,
      total_volume Float64,

      -- Win rate (market-level)
      markets_won UInt32,
      markets_lost UInt32,
      market_win_rate Float64,

      -- Recency metrics (30 day) - from mapped CLOB trades only
      net_cashflow_30d Float64,
      volume_30d Float64,
      trades_30d UInt32,
      last_trade_ts Nullable(DateTime),

      -- Omega metrics (180-day trailing) - market-level PnL ratio
      omega_180d Float64,
      sum_gains_180d Float64,
      sum_losses_180d Float64,
      decided_markets_180d UInt32,
      wins_180d UInt32,
      losses_180d UInt32,

      -- Data coverage
      total_trades UInt32,
      total_usdc Float64,
      mapped_trades UInt32,
      mapped_usdc Float64,
      trade_coverage_pct Float64,
      usdc_coverage_pct Float64,
      unmapped_trades UInt32,
      unmapped_usdc Float64,
      unmapped_net_cashflow Float64,
      rankability_tier LowCardinality(String),

      -- Classification
      is_clob_only UInt8,
      clob_trade_count UInt32,
      split_merge_count UInt32,
      erc1155_transfer_count UInt32,

      -- Gates
      unmapped_cashflow_passes_gate UInt8,

      -- Final status
      is_rankable UInt8,

      -- Metadata (IMPORTANT: computed_at is DateTime64(3) for ms precision tie-breaking)
      computed_at DateTime64(3),  -- Write from code, NOT DEFAULT now()
      run_id UUID,                -- Unique per compute batch, tie-breaker for argMax
      engine_version LowCardinality(String) DEFAULT 'duel_v1',
      mapping_version LowCardinality(String) DEFAULT 'pm_token_to_condition_map_v5',

      -- Compute tracking
      compute_duration_ms UInt32 DEFAULT 0
    ) ENGINE = MergeTree()
    PARTITION BY toYYYYMM(computed_at)
    ORDER BY (wallet_address, computed_at, run_id)
    TTL toDateTime(computed_at) + INTERVAL 90 DAY DELETE
    SETTINGS index_granularity = 8192
  `;

  await clickhouse.command({ query: createQuery });
  console.log(`  Table ${HISTORY_TABLE} created (append-only, 90-day TTL).`);
}

async function createLatestView() {
  console.log(`Creating ${LATEST_VIEW} view...`);

  await clickhouse.command({ query: `DROP VIEW IF EXISTS ${LATEST_VIEW}` });

  // View that always returns the latest row per wallet using argMax
  // CRITICAL: Uses (computed_at, run_id) as tie-breaker to guarantee deterministic results
  // This is the single source of truth for "latest-by-wallet"
  // Note: computed_at and run_id use max() since they are the sort key itself
  const createQuery = `
    CREATE VIEW ${LATEST_VIEW} AS
    SELECT
      wallet_address,
      argMax(realized_economic, (computed_at, run_id)) as realized_economic,
      argMax(realized_cash, (computed_at, run_id)) as realized_cash,
      argMax(unrealized, (computed_at, run_id)) as unrealized,
      argMax(total_economic, (computed_at, run_id)) as total_economic,
      argMax(total_cash, (computed_at, run_id)) as total_cash,
      argMax(resolved_trade_cashflow, (computed_at, run_id)) as resolved_trade_cashflow,
      argMax(unresolved_trade_cashflow, (computed_at, run_id)) as unresolved_trade_cashflow,
      argMax(synthetic_redemptions, (computed_at, run_id)) as synthetic_redemptions,
      argMax(explicit_redemptions, (computed_at, run_id)) as explicit_redemptions,
      argMax(economic_vs_cash_delta, (computed_at, run_id)) as economic_vs_cash_delta,
      argMax(synthetic_vs_explicit_delta, (computed_at, run_id)) as synthetic_vs_explicit_delta,
      argMax(positions_count, (computed_at, run_id)) as positions_count,
      argMax(resolved_positions, (computed_at, run_id)) as resolved_positions,
      argMax(unresolved_positions, (computed_at, run_id)) as unresolved_positions,
      argMax(markets_traded, (computed_at, run_id)) as markets_traded,
      argMax(total_volume, (computed_at, run_id)) as total_volume,
      argMax(markets_won, (computed_at, run_id)) as markets_won,
      argMax(markets_lost, (computed_at, run_id)) as markets_lost,
      argMax(market_win_rate, (computed_at, run_id)) as market_win_rate,
      argMax(net_cashflow_30d, (computed_at, run_id)) as net_cashflow_30d,
      argMax(volume_30d, (computed_at, run_id)) as volume_30d,
      argMax(trades_30d, (computed_at, run_id)) as trades_30d,
      argMax(last_trade_ts, (computed_at, run_id)) as last_trade_ts,
      argMax(omega_180d, (computed_at, run_id)) as omega_180d,
      argMax(sum_gains_180d, (computed_at, run_id)) as sum_gains_180d,
      argMax(sum_losses_180d, (computed_at, run_id)) as sum_losses_180d,
      argMax(decided_markets_180d, (computed_at, run_id)) as decided_markets_180d,
      argMax(wins_180d, (computed_at, run_id)) as wins_180d,
      argMax(losses_180d, (computed_at, run_id)) as losses_180d,
      argMax(total_trades, (computed_at, run_id)) as total_trades,
      argMax(total_usdc, (computed_at, run_id)) as total_usdc,
      argMax(mapped_trades, (computed_at, run_id)) as mapped_trades,
      argMax(mapped_usdc, (computed_at, run_id)) as mapped_usdc,
      argMax(trade_coverage_pct, (computed_at, run_id)) as trade_coverage_pct,
      argMax(usdc_coverage_pct, (computed_at, run_id)) as usdc_coverage_pct,
      argMax(unmapped_trades, (computed_at, run_id)) as unmapped_trades,
      argMax(unmapped_usdc, (computed_at, run_id)) as unmapped_usdc,
      argMax(unmapped_net_cashflow, (computed_at, run_id)) as unmapped_net_cashflow,
      argMax(rankability_tier, (computed_at, run_id)) as rankability_tier,
      argMax(is_clob_only, (computed_at, run_id)) as is_clob_only,
      argMax(clob_trade_count, (computed_at, run_id)) as clob_trade_count,
      argMax(split_merge_count, (computed_at, run_id)) as split_merge_count,
      argMax(erc1155_transfer_count, (computed_at, run_id)) as erc1155_transfer_count,
      argMax(unmapped_cashflow_passes_gate, (computed_at, run_id)) as unmapped_cashflow_passes_gate,
      argMax(is_rankable, (computed_at, run_id)) as is_rankable,
      argMax(engine_version, (computed_at, run_id)) as engine_version,
      argMax(mapping_version, (computed_at, run_id)) as mapping_version,
      max(computed_at) as latest_computed_at,
      max(run_id) as latest_run_id
    FROM ${HISTORY_TABLE}
    GROUP BY wallet_address
  `;

  await clickhouse.command({ query: createQuery });
  console.log(`  View ${LATEST_VIEW} created (argMax pattern).`);
}

async function migrateExistingData() {
  // Check if old table exists and has data
  const checkQuery = `
    SELECT count() as cnt FROM system.tables
    WHERE database = currentDatabase() AND name = 'wallet_duel_metrics_latest'
  `;
  const checkResult = await clickhouse.query({ query: checkQuery, format: 'JSONEachRow' });
  const exists = ((await checkResult.json()) as any[])[0]?.cnt > 0;

  if (!exists) {
    console.log('No existing wallet_duel_metrics_latest table to migrate.');
    return;
  }

  // Count rows
  const countQuery = `SELECT count() as cnt FROM wallet_duel_metrics_latest`;
  const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
  const rowCount = ((await countResult.json()) as any[])[0]?.cnt || 0;

  if (rowCount === 0) {
    console.log('Existing table is empty, nothing to migrate.');
    return;
  }

  console.log(`Migrating ${rowCount} rows from old table...`);

  // Insert from old table to new history table
  const migrateQuery = `
    INSERT INTO ${HISTORY_TABLE}
    (wallet_address, realized_economic, realized_cash, unrealized, total_economic, total_cash,
     resolved_trade_cashflow, unresolved_trade_cashflow, synthetic_redemptions, explicit_redemptions,
     economic_vs_cash_delta, synthetic_vs_explicit_delta,
     positions_count, resolved_positions, unresolved_positions, markets_traded, total_volume,
     markets_won, markets_lost, market_win_rate,
     net_cashflow_30d, volume_30d, trades_30d, last_trade_ts,
     total_trades, total_usdc, mapped_trades, mapped_usdc, trade_coverage_pct, usdc_coverage_pct,
     unmapped_trades, unmapped_usdc, unmapped_net_cashflow, rankability_tier,
     is_clob_only, clob_trade_count, split_merge_count, erc1155_transfer_count,
     unmapped_cashflow_passes_gate, is_rankable, computed_at, engine_version, mapping_version)
    SELECT
      wallet_address, realized_economic, realized_cash, unrealized, total_economic, total_cash,
      resolved_trade_cashflow, unresolved_trade_cashflow, synthetic_redemptions, explicit_redemptions,
      economic_vs_cash_delta, synthetic_vs_explicit_delta,
      positions_count, resolved_positions, unresolved_positions, markets_traded, total_volume,
      markets_won, markets_lost, market_win_rate,
      net_cashflow_30d, volume_30d, trades_30d, last_trade_ts,
      total_trades, total_usdc, mapped_trades, mapped_usdc, trade_coverage_pct, usdc_coverage_pct,
      unmapped_trades, unmapped_usdc, unmapped_net_cashflow, rankability_tier,
      is_clob_only, clob_trade_count, split_merge_count, erc1155_transfer_count,
      unmapped_cashflow_passes_gate, is_rankable, computed_at, engine_version, mapping_version
    FROM wallet_duel_metrics_latest
  `;

  await clickhouse.command({ query: migrateQuery });
  console.log(`  Migrated ${rowCount} rows to history table.`);
}

async function main() {
  console.log('='.repeat(80));
  console.log('BUILD DUEL METRICS HISTORY TABLE + LATEST VIEW');
  console.log('='.repeat(80));
  console.log('');

  // Step 1: Create history table
  await createHistoryTable();

  // Step 2: Create latest view
  await createLatestView();

  // Step 3: Migrate existing data if present
  await migrateExistingData();

  console.log('\nDone. Use:');
  console.log(`  - ${HISTORY_TABLE} for inserts (append-only)`);
  console.log(`  - ${LATEST_VIEW} for queries (always latest per wallet)`);
}

main().catch(console.error);
