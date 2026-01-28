#!/usr/bin/env npx tsx
/**
 * Build FIFO V5 - Active Wallets via Temp Table JOIN
 *
 * 1. Find wallets active in last N days
 * 2. Create temp table with those wallets
 * 3. Process FULL HISTORY for those wallets with TRUE FIFO matching
 * 4. Includes RESOLVED + CLOSED positions
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const DAYS = parseInt(process.argv.find(a => a.startsWith('--days='))?.split('=')[1] || '4');

async function main() {
  console.log('🔨 Building FIFO V5 (Active Wallets - Temp Table Approach)\n');
  console.log(`Strategy: Process FULL HISTORY for wallets active in last ${DAYS} days`);
  console.log('(TRUE FIFO = per-trade buy/sell matching for entire wallet history)\n');

  const startTime = Date.now();

  // Step 1: Create temp table for active wallets
  console.log('Step 1: Creating temp table with active wallets...');
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS tmp_active_wallets_v5 (
        wallet String
      )
      ENGINE = MergeTree
      ORDER BY wallet
    `,
  });

  // Clear any existing data
  await clickhouse.command({
    query: `TRUNCATE TABLE tmp_active_wallets_v5`,
  });

  // Step 2: Populate with wallets active in last N days
  console.log(`Step 2: Finding wallets active in last ${DAYS} days...`);
  await clickhouse.command({
    query: `
      INSERT INTO tmp_active_wallets_v5
      SELECT DISTINCT wallet
      FROM pm_canonical_fills_v4
      WHERE event_time >= now() - INTERVAL ${DAYS} DAY
        AND source = 'clob'
    `,
    clickhouse_settings: {
      max_execution_time: 300,
      max_memory_usage: 4000000000,
      max_threads: 8,
    },
  });

  // Count wallets
  const countResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM tmp_active_wallets_v5`,
    format: 'JSONEachRow',
  });
  const walletCount = (await countResult.json())[0].cnt;
  console.log(`Found ${walletCount.toLocaleString()} active wallets\n`);

  // Step 3: Process RESOLVED positions (longs + shorts)
  console.log('Step 3: Processing RESOLVED positions (TRUE FIFO)...');
  const resolvedStart = Date.now();

  await clickhouse.command({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3
      SELECT
        tx_hash,
        wallet,
        condition_id,
        outcome_index,
        entry_time,
        tokens,
        cost_usd,
        tokens_sold_early,
        tokens_held,
        exit_value,
        exit_value - cost_usd as pnl_usd,
        CASE WHEN cost_usd > 0 THEN (exit_value - cost_usd) / cost_usd ELSE 0 END as roi,
        CASE
          WHEN (total_tokens_sold + tokens_held) > 0 THEN
            tokens_sold_early / (total_tokens_sold + tokens_held) * 100
          ELSE 0
        END as pct_sold_early,
        is_maker_flag as is_maker,
        resolved_at,
        0 as is_short,
        0 as is_closed
      FROM (
        SELECT
          buy.*,
          coalesce(sells.total_tokens_sold, 0) as total_tokens_sold,
          coalesce(sells.total_sell_proceeds, 0) as total_sell_proceeds,
          least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
            PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
            ORDER BY buy.entry_time
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0))) as tokens_sold_early,
          buy.tokens - least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
            PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
            ORDER BY buy.entry_time
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0))) as tokens_held,
          CASE
            WHEN coalesce(sells.total_tokens_sold, 0) > 0 THEN
              least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
                PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
                ORDER BY buy.entry_time
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
              ), 0))) * (coalesce(sells.total_sell_proceeds, 0) / coalesce(sells.total_tokens_sold, 1))
            ELSE 0
          END as exit_value
        FROM (
          SELECT
            f.fill_id as tx_hash,
            f.wallet,
            f.condition_id,
            f.outcome_index,
            f.event_time as entry_time,
            f.tokens_delta as tokens,
            abs(f.usdc_delta) as cost_usd,
            f.is_maker as is_maker_flag,
            r.resolved_at
          FROM pm_canonical_fills_v4_deduped f
          INNER JOIN tmp_active_wallets_v5 w ON f.wallet = w.wallet
          INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
          WHERE f.source = 'clob'
            AND f.tokens_delta > 0
            AND r.is_deleted = 0
            AND r.payout_numerators != ''
          ORDER BY f.wallet, f.condition_id, f.outcome_index, f.event_time
        ) buy
        LEFT JOIN (
          SELECT
            f.wallet,
            f.condition_id,
            f.outcome_index,
            abs(sum(f.tokens_delta)) as total_tokens_sold,
            sum(f.usdc_delta) as total_sell_proceeds
          FROM pm_canonical_fills_v4_deduped f
          INNER JOIN tmp_active_wallets_v5 w ON f.wallet = w.wallet
          WHERE f.source = 'clob'
            AND f.tokens_delta < 0
          GROUP BY f.wallet, f.condition_id, f.outcome_index
        ) sells ON buy.wallet = sells.wallet
          AND buy.condition_id = sells.condition_id
          AND buy.outcome_index = sells.outcome_index
      )
    `,
    clickhouse_settings: {
      max_execution_time: 1800,
      max_memory_usage: 20000000000,
      max_threads: 8,
      optimize_read_in_window_order: 1,
      query_plan_enable_optimizations: 1,
    },
  });

  const resolvedDuration = ((Date.now() - resolvedStart) / 1000 / 60).toFixed(1);
  console.log(`  ✓ Resolved positions done in ${resolvedDuration} min\n`);

  // Step 4: Process CLOSED positions (unresolved markets, fully exited)
  console.log('Step 4: Processing CLOSED positions (TRUE FIFO)...');
  const closedStart = Date.now();

  await clickhouse.command({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3
      SELECT
        tx_hash,
        wallet,
        condition_id,
        outcome_index,
        entry_time,
        tokens,
        cost_usd,
        tokens_sold_early,
        tokens_held,
        exit_value,
        exit_value - cost_usd as pnl_usd,
        CASE WHEN cost_usd > 0 THEN (exit_value - cost_usd) / cost_usd ELSE 0 END as roi,
        CASE
          WHEN (total_tokens_sold + tokens_held) > 0 THEN
            tokens_sold_early / (total_tokens_sold + tokens_held) * 100
          ELSE 0
        END as pct_sold_early,
        is_maker_flag as is_maker,
        resolved_at,
        0 as is_short,
        1 as is_closed
      FROM (
        SELECT
          buy.*,
          coalesce(sells.total_tokens_sold, 0) as total_tokens_sold,
          coalesce(sells.total_sell_proceeds, 0) as total_sell_proceeds,
          least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
            PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
            ORDER BY buy.entry_time
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0))) as tokens_sold_early,
          buy.tokens - least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
            PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
            ORDER BY buy.entry_time
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0))) as tokens_held,
          CASE
            WHEN coalesce(sells.total_tokens_sold, 0) > 0 THEN
              least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
                PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
                ORDER BY buy.entry_time
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
              ), 0))) * (coalesce(sells.total_sell_proceeds, 0) / coalesce(sells.total_tokens_sold, 1))
            ELSE 0
          END as exit_value
        FROM (
          SELECT
            f.fill_id as tx_hash,
            f.wallet,
            f.condition_id,
            f.outcome_index,
            f.event_time as entry_time,
            f.tokens_delta as tokens,
            abs(f.usdc_delta) as cost_usd,
            f.is_maker as is_maker_flag,
            max(f.event_time) OVER (PARTITION BY f.wallet, f.condition_id, f.outcome_index) as resolved_at
          FROM pm_canonical_fills_v4_deduped f
          INNER JOIN tmp_active_wallets_v5 w ON f.wallet = w.wallet
          LEFT JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id AND r.is_deleted = 0
          WHERE f.source = 'clob'
            AND f.tokens_delta > 0
            AND (r.payout_numerators IS NULL OR r.payout_numerators = '')
          ORDER BY f.wallet, f.condition_id, f.outcome_index, f.event_time
        ) buy
        LEFT JOIN (
          SELECT
            f.wallet,
            f.condition_id,
            f.outcome_index,
            abs(sum(f.tokens_delta)) as total_tokens_sold,
            sum(f.usdc_delta) as total_sell_proceeds
          FROM pm_canonical_fills_v4_deduped f
          INNER JOIN tmp_active_wallets_v5 w ON f.wallet = w.wallet
          WHERE f.source = 'clob'
            AND f.tokens_delta < 0
          GROUP BY f.wallet, f.condition_id, f.outcome_index
        ) sells ON buy.wallet = sells.wallet
          AND buy.condition_id = sells.condition_id
          AND buy.outcome_index = sells.outcome_index
      )
      WHERE tokens_held = 0 OR abs(tokens_held) < 0.01
    `,
    clickhouse_settings: {
      max_execution_time: 1800,
      max_memory_usage: 20000000000,
      max_threads: 8,
      optimize_read_in_window_order: 1,
      query_plan_enable_optimizations: 1,
    },
  });

  const closedDuration = ((Date.now() - closedStart) / 1000 / 60).toFixed(1);
  console.log(`  ✓ Closed positions done in ${closedDuration} min\n`);

  // Step 5: Cleanup and report
  console.log('Step 5: Cleaning up...');
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS tmp_active_wallets_v5`,
  });

  const totalDuration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  // Get stats
  const statsResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        countIf(is_closed = 1) as closed_rows,
        countIf(is_closed = 0) as resolved_rows,
        round(sum(pnl_usd), 0) as total_pnl
      FROM pm_trade_fifo_roi_v3
    `,
    format: 'JSONEachRow',
  });
  const stats = (await statsResult.json())[0];

  console.log('\n════════════════════════════════════════════════════');
  console.log('✅ FIFO V5 Active Wallets Complete!');
  console.log('════════════════════════════════════════════════════');
  console.log(`Active wallets: ${walletCount.toLocaleString()}`);
  console.log(`Total FIFO rows: ${stats.total_rows.toLocaleString()}`);
  console.log(`  - Resolved positions: ${stats.resolved_rows.toLocaleString()}`);
  console.log(`  - Closed positions: ${stats.closed_rows.toLocaleString()}`);
  console.log(`Total PnL: $${stats.total_pnl.toLocaleString()}`);
  console.log(`Duration: ${totalDuration} minutes`);
  console.log('\n🎯 Your leaderboards are now ready!');
  console.log('   Query: pm_trade_fifo_roi_v3_deduped\n');
}

main().catch(console.error);
