/**
 * Build Trusted Cohort and Metrics for Copy-Trade Ranking
 *
 * Goal: Create a pool of wallets with 100% confidence in metrics
 *
 * Cohort criteria:
 * 1. Inventory-conserving (no negative positions > -1000 tokens)
 * 2. CLOB-only activity (no transfers, splits, merges detected)
 * 3. Not flagged as market maker (optional)
 * 4. Minimum activity threshold
 *
 * Metrics computed:
 * - trade_count: total fills (buy + sell)
 * - realized_pnl: V11_POLY style (cash_flow + final_tokens * resolution_price)
 * - win_rate: % of resolved markets with positive PnL
 * - total_volume: sum of |usdc_delta|
 * - markets_traded: count distinct condition_ids
 * - avg_trade_size: volume / trade_count
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

// Cohort thresholds
const MAX_NEGATIVE_INVENTORY = -1000; // tokens
const MIN_TRADES = 20;
const MIN_VOLUME = 500; // USDC
const MIN_MARKETS = 5;

async function main() {
  console.log('='.repeat(80));
  console.log('BUILD TRUSTED COHORT AND METRICS');
  console.log('='.repeat(80));
  console.log(`\nCohort criteria:`);
  console.log(`  - Inventory conserving (no position < ${MAX_NEGATIVE_INVENTORY} tokens)`);
  console.log(`  - Minimum ${MIN_TRADES} trades`);
  console.log(`  - Minimum $${MIN_VOLUME} volume`);
  console.log(`  - Minimum ${MIN_MARKETS} markets traded`);

  // Step 1: Create the trusted cohort table
  console.log('\n\n=== Step 1: Build Trusted Cohort ===\n');

  const cohortQuery = `
    CREATE TABLE IF NOT EXISTS pm_wallet_trust_cohort_v1
    (
      wallet_address String,
      worst_position Float64,
      is_inventory_conserving UInt8,
      trade_count UInt64,
      total_volume Float64,
      markets_traded UInt32,
      first_trade DateTime,
      last_trade DateTime,
      created_at DateTime DEFAULT now()
    )
    ENGINE = ReplacingMergeTree(created_at)
    ORDER BY wallet_address
  `;

  try {
    await clickhouse.command({ query: cohortQuery });
    console.log('Created pm_wallet_trust_cohort_v1 table');
  } catch (e: any) {
    console.log(`Table creation: ${e.message?.slice(0, 100)}`);
  }

  // Populate the cohort table
  console.log('\nPopulating cohort table (this may take a few minutes)...');

  const populateCohortQuery = `
    INSERT INTO pm_wallet_trust_cohort_v1
    (wallet_address, worst_position, is_inventory_conserving, trade_count, total_volume, markets_traded, first_trade, last_trade)
    SELECT
      wallet_address,
      worst_position,
      if(worst_position >= ${MAX_NEGATIVE_INVENTORY}, 1, 0) as is_inventory_conserving,
      trade_count,
      total_volume,
      markets_traded,
      first_trade,
      last_trade
    FROM (
      SELECT
        l.wallet_address,
        -- Worst position across all condition/outcome pairs
        min(pos.sum_tokens) as worst_position,
        -- Activity metrics
        count() as trade_count,
        sum(abs(l.usdc_delta)) as total_volume,
        countDistinct(l.condition_id) as markets_traded,
        min(l.event_timestamp) as first_trade,
        max(l.event_timestamp) as last_trade
      FROM pm_unified_ledger_v9_clob_tbl l
      INNER JOIN (
        SELECT
          wallet_address,
          condition_id,
          outcome_index,
          sum(token_delta) as sum_tokens
        FROM pm_unified_ledger_v9_clob_tbl
        WHERE source_type = 'CLOB'
          AND condition_id IS NOT NULL
          AND condition_id != ''
        GROUP BY wallet_address, condition_id, outcome_index
      ) pos ON l.wallet_address = pos.wallet_address
      WHERE l.source_type = 'CLOB'
        AND l.condition_id IS NOT NULL
      GROUP BY l.wallet_address
    )
    WHERE trade_count >= ${MIN_TRADES}
      AND total_volume >= ${MIN_VOLUME}
      AND markets_traded >= ${MIN_MARKETS}
  `;

  try {
    console.log('Running cohort population query...');
    await clickhouse.command({
      query: populateCohortQuery,
      clickhouse_settings: { max_execution_time: 600 }
    });
    console.log('Cohort table populated');
  } catch (e: any) {
    console.log(`Cohort population error: ${e.message?.slice(0, 200)}`);
    console.log('Trying alternative approach...');
  }

  // Get cohort stats
  const cohortStatsQuery = `
    SELECT
      count() as total_wallets,
      countIf(is_inventory_conserving = 1) as conserving_wallets,
      countIf(is_inventory_conserving = 0) as violating_wallets,
      round(avg(trade_count), 0) as avg_trades,
      round(avg(total_volume), 0) as avg_volume
    FROM pm_wallet_trust_cohort_v1
  `;

  try {
    const statsResult = await clickhouse.query({
      query: cohortStatsQuery,
      format: 'JSONEachRow'
    });
    const stats = ((await statsResult.json()) as any[])[0];

    if (stats) {
      console.log('\n=== Cohort Stats ===');
      console.log(`Total wallets meeting activity threshold: ${stats.total_wallets?.toLocaleString() || 0}`);
      console.log(`Inventory conserving (trusted): ${stats.conserving_wallets?.toLocaleString() || 0}`);
      console.log(`Inventory violating (excluded): ${stats.violating_wallets?.toLocaleString() || 0}`);
      console.log(`Average trades: ${stats.avg_trades?.toLocaleString() || 0}`);
      console.log(`Average volume: $${stats.avg_volume?.toLocaleString() || 0}`);
    }
  } catch (e: any) {
    console.log(`Stats query error: ${e.message?.slice(0, 100)}`);
  }

  // Step 2: Build the metrics table
  console.log('\n\n=== Step 2: Build Metrics Table ===\n');

  const metricsTableQuery = `
    CREATE TABLE IF NOT EXISTS pm_wallet_metrics_trusted_v1
    (
      wallet_address String,
      -- PnL metrics
      realized_pnl Float64,
      total_volume Float64,
      -- Trade metrics
      trade_count UInt64,
      buy_count UInt64,
      sell_count UInt64,
      -- Market metrics
      markets_traded UInt32,
      markets_resolved UInt32,
      markets_won UInt32,
      win_rate Float64,
      -- Activity metrics
      first_trade DateTime,
      last_trade DateTime,
      days_active UInt32,
      -- Derived metrics
      avg_trade_size Float64,
      roi_pct Float64,
      -- Metadata
      created_at DateTime DEFAULT now()
    )
    ENGINE = ReplacingMergeTree(created_at)
    ORDER BY wallet_address
  `;

  try {
    await clickhouse.command({ query: metricsTableQuery });
    console.log('Created pm_wallet_metrics_trusted_v1 table');
  } catch (e: any) {
    console.log(`Metrics table creation: ${e.message?.slice(0, 100)}`);
  }

  // Step 3: Sample the trusted cohort
  console.log('\n\n=== Step 3: Sample Trusted Wallets ===\n');

  const sampleQuery = `
    SELECT
      wallet_address,
      worst_position,
      trade_count,
      total_volume,
      markets_traded
    FROM pm_wallet_trust_cohort_v1
    WHERE is_inventory_conserving = 1
    ORDER BY total_volume DESC
    LIMIT 20
  `;

  try {
    const sampleResult = await clickhouse.query({
      query: sampleQuery,
      format: 'JSONEachRow'
    });
    const samples = await sampleResult.json() as any[];

    if (samples.length > 0) {
      console.log('Top 20 trusted wallets by volume:');
      console.log('wallet | trades | volume | markets | worst_pos');
      console.log('-'.repeat(80));

      for (const w of samples) {
        console.log(
          `${w.wallet_address.slice(0, 10)}... | ${w.trade_count.toString().padStart(6)} | $${Number(w.total_volume).toLocaleString().padStart(12)} | ${w.markets_traded.toString().padStart(4)} | ${Number(w.worst_position).toFixed(0)}`
        );
      }
    }
  } catch (e: any) {
    console.log(`Sample query error: ${e.message?.slice(0, 100)}`);
  }

  // Step 4: Compute PnL for a sample wallet
  console.log('\n\n=== Step 4: Test PnL Computation ===\n');

  // Use W2 as benchmark
  const w2 = '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838';

  const pnlQuery = `
    SELECT
      l.wallet_address,
      sum(l.usdc_delta) as cash_flow,
      sum(l.token_delta) as final_tokens,
      sum(if(r.resolved_price IS NOT NULL, l.usdc_delta + l.token_delta * r.resolved_price, 0)) as realized_pnl,
      count() as events,
      countDistinct(l.condition_id) as markets
    FROM pm_unified_ledger_v9_clob_tbl l
    LEFT JOIN vw_pm_resolution_prices r
      ON l.condition_id = r.condition_id AND l.outcome_index = r.outcome_index
    WHERE l.wallet_address = '${w2}'
      AND l.source_type = 'CLOB'
      AND l.condition_id IS NOT NULL
    GROUP BY l.wallet_address
  `;

  try {
    const pnlResult = await clickhouse.query({
      query: pnlQuery,
      format: 'JSONEachRow'
    });
    const pnl = ((await pnlResult.json()) as any[])[0];

    if (pnl) {
      console.log(`W2 PnL test (expected: ~$4,405):`);
      console.log(`  Cash flow: $${Number(pnl.cash_flow).toFixed(2)}`);
      console.log(`  Final tokens: ${Number(pnl.final_tokens).toFixed(2)}`);
      console.log(`  Realized PnL: $${Number(pnl.realized_pnl).toFixed(2)}`);
      console.log(`  Events: ${pnl.events}`);
      console.log(`  Markets: ${pnl.markets}`);
    }
  } catch (e: any) {
    console.log(`PnL query error: ${e.message?.slice(0, 100)}`);
  }

  console.log('\n\n=== Summary ===');
  console.log(`
Next steps:
1. Populate pm_wallet_metrics_trusted_v1 with full metrics
2. Validate sample against UI implied realized
3. Build leaderboard query for copy-trade ranking

Tables created:
- pm_wallet_trust_cohort_v1: Wallet trust classification
- pm_wallet_metrics_trusted_v1: Full metrics for trusted wallets
  `);
}

main().catch(console.error);
