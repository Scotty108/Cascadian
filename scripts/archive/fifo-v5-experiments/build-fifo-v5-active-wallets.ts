#!/usr/bin/env npx tsx
/**
 * Build FIFO V5 - Active Wallets First
 *
 * Process FULL history for wallets active in last 10 days.
 * Gets leaderboards working FAST (30-60 min), then run full backfill overnight.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const DAYS = parseInt(process.argv.find(a => a.startsWith('--days='))?.split('=')[1] || '4');

async function getActiveWallets(): Promise<string[]> {
  console.log(`Finding wallets active in last ${DAYS} days...\n`);

  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet
      FROM pm_canonical_fills_v4
      WHERE event_time >= now() - INTERVAL ${DAYS} DAY
        AND source = 'clob'
      ORDER BY wallet
    `,
    format: 'JSONEachRow',
    clickhouse_settings: {
      max_execution_time: 300,
      max_memory_usage: 4000000000,
      max_threads: 8,
    },
  });

  const rows = await result.json() as { wallet: string }[];
  return rows.map(r => r.wallet);
}

async function processWallet(wallet: string): Promise<{ rows: number; pnl: number }> {
  // Process FULL HISTORY for this wallet (all time, not just last 10 days)
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
          LEFT JOIN pm_condition_resolutions r
            ON f.condition_id = r.condition_id AND r.is_deleted = 0
          WHERE f.wallet = '${wallet}'
            AND f.source = 'clob'
            AND f.tokens_delta > 0
            AND (r.payout_numerators IS NULL OR r.payout_numerators = '')
          ORDER BY f.wallet, f.condition_id, f.outcome_index, f.event_time
        ) buy
        LEFT JOIN (
          SELECT
            wallet,
            condition_id,
            outcome_index,
            abs(sum(tokens_delta)) as total_tokens_sold,
            sum(usdc_delta) as total_sell_proceeds
          FROM pm_canonical_fills_v4_deduped
          WHERE wallet = '${wallet}'
            AND source = 'clob'
            AND tokens_delta < 0
          GROUP BY wallet, condition_id, outcome_index
        ) sells ON buy.wallet = sells.wallet
          AND buy.condition_id = sells.condition_id
          AND buy.outcome_index = sells.outcome_index
      )
      WHERE tokens_held = 0 OR abs(tokens_held) < 0.01
    `,
    clickhouse_settings: {
      max_execution_time: 60,
      max_memory_usage: 2000000000,
      max_threads: 4,
      optimize_read_in_window_order: 1,
    },
  });

  // Count and sum
  const result = await clickhouse.query({
    query: `
      SELECT
        count() as cnt,
        round(sum(pnl_usd), 0) as pnl
      FROM pm_trade_fifo_roi_v3
      WHERE wallet = '${wallet}' AND is_closed = 1
    `,
    format: 'JSONEachRow',
  });
  const stats = (await result.json())[0];
  return { rows: stats.cnt, pnl: stats.pnl };
}

async function main() {
  console.log('🔨 Building FIFO V5 (Active Wallets First)\n');
  console.log(`Strategy: Process wallets active in last ${DAYS} days`);
  console.log('(Full history per wallet, not just recent trades)\n');

  const startTime = Date.now();

  // Step 1: Get active wallets
  const wallets = await getActiveWallets();
  console.log(`Found ${wallets.length} active wallets\n`);

  if (wallets.length === 0) {
    console.log('No active wallets found. Exiting.\n');
    return;
  }

  // Step 2: Process each wallet
  let processed = 0;
  let totalRows = 0;
  let totalPnl = 0;
  let errors = 0;
  let walletsWithClosedPositions = 0;

  console.log('Processing wallets...\n');

  for (const wallet of wallets) {
    try {
      const stats = await processWallet(wallet);
      processed++;
      totalRows += stats.rows;
      totalPnl += stats.pnl;

      if (stats.rows > 0) {
        walletsWithClosedPositions++;
        console.log(`[${processed}/${wallets.length}] ${wallet.slice(0, 10)}... → ${stats.rows} rows, $${stats.pnl.toLocaleString()}`);
      } else {
        // Just update counter, don't spam console
        if (processed % 50 === 0) {
          console.log(`[${processed}/${wallets.length}] Progress...`);
        }
      }

      // Show stats every 100 wallets
      if (processed % 100 === 0) {
        const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
        const rate = processed / (Date.now() - startTime) * 1000 * 60;
        const remaining = wallets.length - processed;
        const eta = (remaining / rate).toFixed(0);

        console.log(`\n📊 Progress Report:`);
        console.log(`   Processed: ${processed}/${wallets.length} wallets`);
        console.log(`   FIFO rows: ${totalRows.toLocaleString()}`);
        console.log(`   Total PnL: $${totalPnl.toLocaleString()}`);
        console.log(`   Wallets with closed positions: ${walletsWithClosedPositions}`);
        console.log(`   Rate: ${rate.toFixed(1)} wallets/min`);
        console.log(`   ETA: ${eta} minutes\n`);
      }
    } catch (error: any) {
      errors++;
      console.log(`[${processed}/${wallets.length}] ${wallet.slice(0, 10)}... ✗ ${error.message}`);
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log('\n════════════════════════════════════════════════════');
  console.log('✅ FIFO V5 Active Wallets Complete!');
  console.log('════════════════════════════════════════════════════');
  console.log(`Wallets processed: ${processed.toLocaleString()}`);
  console.log(`Wallets with closed positions: ${walletsWithClosedPositions}`);
  console.log(`Total FIFO rows: ${totalRows.toLocaleString()}`);
  console.log(`Total closed PnL: $${totalPnl.toLocaleString()}`);
  console.log(`Errors: ${errors}`);
  console.log(`Duration: ${totalDuration} minutes`);
  console.log('\n🎯 Your leaderboards are now ready!');
  console.log('   Just query: pm_trade_fifo_roi_v3_deduped');
  console.log('\n📋 Next Steps:');
  console.log('   1. Test leaderboard query (should be <5s)');
  console.log('   2. Verify a few test wallets');
  console.log('   3. Run overnight backfill for remaining wallets\n');
}

main().catch(console.error);
