/**
 * Build DUEL Metrics Table
 *
 * Creates wallet_duel_metrics_latest with precomputed DUEL metrics for leaderboard.
 * Only includes CLOB-only wallets with sufficient activity and high data coverage.
 *
 * Table schema:
 * - wallet_address
 * - realized_economic (V17 style)
 * - realized_cash (explicit redemptions)
 * - unrealized
 * - total_economic
 * - total_cash
 * - positions_count, markets_traded, total_volume
 * - trade_coverage_pct, usdc_coverage_pct
 * - rankability_tier ('A' | 'B' | 'C')
 * - is_rankable
 * - computed_at
 *
 * Usage:
 *   npx tsx scripts/pnl/build-duel-metrics-table.ts [--limit N] [--skip-create]
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';
import { createDuelEngine, DuelMetrics } from '../../lib/pnl/duelEngine';

const TABLE_NAME = 'wallet_duel_metrics_latest';
const BATCH_SIZE = 10; // DUEL is compute-heavy, process in small batches
const MIN_CLOB_TRADES = 10;
const DEFAULT_LIMIT = 1000;

interface CandidateWallet {
  wallet_address: string;
  clob_trades: number;
}

async function createTable() {
  console.log(`Creating ${TABLE_NAME} table...`);

  // Drop existing table if present
  await clickhouse.command({ query: `DROP TABLE IF EXISTS ${TABLE_NAME}` });

  const createQuery = `
    CREATE TABLE ${TABLE_NAME} (
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

      -- Metadata
      computed_at DateTime DEFAULT now(),
      engine_version LowCardinality(String) DEFAULT 'duel_v1',
      mapping_version LowCardinality(String) DEFAULT 'pm_token_to_condition_map_v5'
    ) ENGINE = ReplacingMergeTree(computed_at)
    ORDER BY wallet_address
  `;

  await clickhouse.command({ query: createQuery });
  console.log(`  Table ${TABLE_NAME} created.`);
}

async function getCandidateWallets(limit: number): Promise<CandidateWallet[]> {
  console.log('Finding candidate CLOB-only wallets...');

  // Find wallets that are likely CLOB-only with sufficient trades
  const query = `
    WITH clob_active AS (
      SELECT
        lower(trader_wallet) as wallet_address,
        count() as trade_count
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY lower(trader_wallet)
      HAVING trade_count >= ${MIN_CLOB_TRADES}
    ),
    erc_activity AS (
      SELECT
        lower(address) as address,
        count() as transfer_count
      FROM (
        SELECT from_address as address FROM pm_erc1155_transfers
        UNION ALL
        SELECT to_address as address FROM pm_erc1155_transfers
      )
      GROUP BY lower(address)
    ),
    ctf_activity AS (
      SELECT
        lower(user_address) as address,
        countIf(event_type IN ('PositionSplit', 'PositionsMerge')) as split_merge_count
      FROM pm_ctf_events
      WHERE is_deleted = 0
      GROUP BY lower(user_address)
    )
    SELECT
      c.wallet_address,
      c.trade_count as clob_trades
    FROM clob_active c
    LEFT JOIN erc_activity e ON c.wallet_address = lower(e.address)
    LEFT JOIN ctf_activity t ON c.wallet_address = t.address
    WHERE coalesce(e.transfer_count, 0) <= 10
      AND coalesce(t.split_merge_count, 0) = 0
    ORDER BY c.trade_count DESC
    LIMIT ${limit}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as CandidateWallet[];

  console.log(`  Found ${rows.length} candidate CLOB-only wallets`);
  return rows;
}

function formatUSD(value: number): string {
  const sign = value >= 0 ? '' : '-';
  return `${sign}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

async function insertMetrics(metrics: DuelMetrics[]) {
  if (metrics.length === 0) return;

  const values = metrics.map(m => {
    // Escape any single quotes in strings (wallet addresses shouldn't have them, but be safe)
    const wallet = m.wallet.replace(/'/g, "''");
    // Handle null last_trade_ts
    const lastTradeTs = m.last_trade_ts ? `'${m.last_trade_ts}'` : 'NULL';

    return `(
      '${wallet}',
      ${m.realized_economic},
      ${m.realized_cash},
      ${m.unrealized},
      ${m.total_economic},
      ${m.total_cash},
      ${m.resolved_trade_cashflow},
      ${m.unresolved_trade_cashflow},
      ${m.synthetic_redemptions},
      ${m.explicit_redemptions},
      ${m.economic_vs_cash_delta},
      ${m.synthetic_vs_explicit_delta},
      ${m.positions_count},
      ${m.resolved_positions},
      ${m.unresolved_positions},
      ${m.markets_traded},
      ${m.total_volume},
      ${m.markets_won},
      ${m.markets_lost},
      ${m.market_win_rate},
      ${m.net_cashflow_30d},
      ${m.volume_30d},
      ${m.trades_30d},
      ${lastTradeTs},
      ${m.data_coverage.total_trades},
      ${m.data_coverage.total_usdc},
      ${m.data_coverage.mapped_trades},
      ${m.data_coverage.mapped_usdc},
      ${m.data_coverage.trade_coverage_pct},
      ${m.data_coverage.usdc_coverage_pct},
      ${m.data_coverage.unmapped_trades},
      ${m.data_coverage.unmapped_usdc},
      ${m.data_coverage.unmapped_net_cashflow},
      '${m.data_coverage.rankability_tier}',
      ${m.clob_only_check.is_clob_only ? 1 : 0},
      ${m.clob_only_check.clob_trade_count},
      ${m.clob_only_check.split_merge_count},
      ${m.clob_only_check.erc1155_transfer_count},
      ${m.unmapped_cashflow_passes_gate ? 1 : 0},
      ${m.is_rankable ? 1 : 0},
      now(),
      'duel_v1',
      'pm_token_to_condition_map_v5'
    )`;
  }).join(',\n');

  const insertQuery = `
    INSERT INTO ${TABLE_NAME}
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
    VALUES ${values}
  `;

  await clickhouse.command({ query: insertQuery });
}

async function generateStatistics() {
  console.log('\n' + '='.repeat(100));
  console.log('DUEL METRICS TABLE STATISTICS');
  console.log('='.repeat(100));

  // Rankability distribution
  const tierDistQuery = `
    SELECT
      rankability_tier,
      count() as wallet_count,
      countIf(is_rankable = 1) as rankable_count,
      round(avg(usdc_coverage_pct), 1) as avg_usdc_coverage,
      round(avg(trade_coverage_pct), 1) as avg_trade_coverage,
      round(sum(realized_economic), 2) as total_economic_pnl,
      round(avg(realized_economic), 2) as avg_economic_pnl
    FROM ${TABLE_NAME}
    GROUP BY rankability_tier
    ORDER BY rankability_tier
  `;

  const tierResult = await clickhouse.query({ query: tierDistQuery, format: 'JSONEachRow' });
  const tierRows = (await tierResult.json()) as any[];

  console.log('\nTier Distribution:');
  console.log('| Tier | Wallets | Rankable | Avg USDC Cov | Avg Trade Cov | Total Econ PnL | Avg Econ PnL |');
  console.log('|------|---------|----------|--------------|---------------|----------------|--------------|');
  for (const row of tierRows) {
    console.log(
      `|   ${row.rankability_tier}  | ${String(row.wallet_count).padStart(7)} | ${String(row.rankable_count).padStart(8)} | ${String(row.avg_usdc_coverage + '%').padStart(12)} | ${String(row.avg_trade_coverage + '%').padStart(13)} | ${formatUSD(row.total_economic_pnl).padStart(14)} | ${formatUSD(row.avg_economic_pnl).padStart(12)} |`
    );
  }

  // Top performers by realized_economic
  const topQuery = `
    SELECT
      wallet_address,
      realized_economic,
      realized_cash,
      total_volume,
      rankability_tier,
      usdc_coverage_pct
    FROM ${TABLE_NAME}
    WHERE is_rankable = 1
    ORDER BY realized_economic DESC
    LIMIT 10
  `;

  const topResult = await clickhouse.query({ query: topQuery, format: 'JSONEachRow' });
  const topRows = (await topResult.json()) as any[];

  console.log('\nTop 10 Rankable Wallets by Economic PnL:');
  console.log('| Wallet                                     | Economic PnL   | Cash PnL       | Volume         | Tier | USDC Cov |');
  console.log('|--------------------------------------------|----------------|----------------|----------------|------|----------|');
  for (const row of topRows) {
    console.log(
      `| ${row.wallet_address} | ${formatUSD(row.realized_economic).padStart(14)} | ${formatUSD(row.realized_cash).padStart(14)} | ${formatUSD(row.total_volume).padStart(14)} |   ${row.rankability_tier}  | ${String(row.usdc_coverage_pct.toFixed(1) + '%').padStart(8)} |`
    );
  }

  // Summary
  const summaryQuery = `
    SELECT
      count() as total_wallets,
      countIf(is_rankable = 1) as rankable_wallets,
      round(sum(realized_economic), 2) as total_economic_pnl,
      round(sum(total_volume), 2) as total_volume
    FROM ${TABLE_NAME}
  `;

  const summaryResult = await clickhouse.query({ query: summaryQuery, format: 'JSONEachRow' });
  const summary = ((await summaryResult.json()) as any[])[0];

  console.log('\nOverall Summary:');
  console.log(`  Total wallets computed: ${summary.total_wallets.toLocaleString()}`);
  console.log(`  Rankable wallets: ${summary.rankable_wallets.toLocaleString()} (${((summary.rankable_wallets / summary.total_wallets) * 100).toFixed(1)}%)`);
  console.log(`  Total economic PnL: ${formatUSD(summary.total_economic_pnl)}`);
  console.log(`  Total volume: ${formatUSD(summary.total_volume)}`);

  console.log('\n' + '='.repeat(100));
}

async function main() {
  const args = process.argv.slice(2);
  const skipCreate = args.includes('--skip-create');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : DEFAULT_LIMIT;

  console.log('='.repeat(100));
  console.log('BUILD DUEL METRICS TABLE');
  console.log('='.repeat(100));
  console.log(`Limit: ${limit} wallets`);
  console.log(`Skip create: ${skipCreate}`);
  console.log('');

  // Step 1: Create table (unless skipped)
  if (!skipCreate) {
    await createTable();
  }

  // Step 2: Get candidate wallets
  const candidates = await getCandidateWallets(limit);

  if (candidates.length === 0) {
    console.log('No candidate wallets found. Exiting.');
    return;
  }

  // Step 3: Compute DUEL metrics in batches
  const engine = createDuelEngine();
  let processed = 0;
  let errors = 0;
  let rankableCount = 0;

  console.log(`\nProcessing ${candidates.length} wallets in batches of ${BATCH_SIZE}...`);

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const batchResults: DuelMetrics[] = [];

    for (const candidate of batch) {
      try {
        const metrics = await engine.compute(candidate.wallet_address);
        batchResults.push(metrics);

        if (metrics.is_rankable) rankableCount++;
        processed++;

        if (processed % 50 === 0 || processed === candidates.length) {
          console.log(`  [${processed}/${candidates.length}] ${candidate.wallet_address.slice(0, 10)}... econ=${formatUSD(metrics.realized_economic)} tier=${metrics.data_coverage.rankability_tier} rankable=${metrics.is_rankable}`);
        }
      } catch (err: any) {
        errors++;
        console.error(`  Error computing ${candidate.wallet_address}: ${err.message}`);
      }
    }

    // Insert batch
    if (batchResults.length > 0) {
      await insertMetrics(batchResults);
    }
  }

  console.log(`\nProcessing complete: ${processed} succeeded, ${errors} errors, ${rankableCount} rankable`);

  // Step 4: Generate statistics
  await generateStatistics();
}

main().catch(console.error);
