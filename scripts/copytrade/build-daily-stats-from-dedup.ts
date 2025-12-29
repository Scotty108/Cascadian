/**
 * Build Wallet Daily Stats from pre-deduped table
 *
 * Uses pm_trader_events_dedup_v2_tbl (528M rows, already deduped)
 * Much faster - no GROUP BY event_id needed!
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { clickhouse } from '../../lib/clickhouse/client.js';

const W_MAX = 1000;

async function main() {
  console.log('=== BUILD DAILY STATS FROM DEDUP TABLE ===\n');

  // Drop and recreate with partitioning
  console.log('Step 1: Creating wallet_daily_stats_v2...');
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS wallet_daily_stats_v2' });

  await clickhouse.command({
    query: `
      CREATE TABLE wallet_daily_stats_v2
      (
        wallet String,
        trade_date Date,
        fills UInt32,
        maker_fills UInt32,
        taker_fills UInt32,
        sum_w Float64,
        sum_wx Float64,
        sum_wx2 Float64,
        total_notional Float64
      )
      ENGINE = SummingMergeTree()
      PARTITION BY toYYYYMM(trade_date)
      ORDER BY (wallet, trade_date)
    `
  });
  console.log('  Table created\n');

  // Step 2: Insert all data in one query using disk spill
  console.log('Step 2: Inserting from dedup table (single query with disk spill)...');
  console.log('  This may take a few minutes...\n');

  const insertQuery = `
    INSERT INTO wallet_daily_stats_v2
    WITH
    resolved AS (
      SELECT
        m.condition_id,
        arrayJoin(m.token_ids) as token_id,
        toFloat64(JSONExtractInt(r.payout_numerators, 1)) / 1000000.0 as outcome
      FROM pm_market_metadata m
      JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
      WHERE r.is_deleted = 0
    ),
    scored AS (
      SELECT
        t.trader_wallet as wallet,
        t.trade_date,
        t.role,
        t.usdc_amount / 1e6 as notional,
        CASE
          WHEN lower(t.side) = 'buy'
          THEN ((r.outcome / ((t.usdc_amount / 1e6) / nullIf(t.token_amount / 1e6, 0))) - 1) * 10000
          ELSE (1 - (r.outcome / ((t.usdc_amount / 1e6) / nullIf(t.token_amount / 1e6, 0)))) * 10000
        END as markout_bps,
        least(sqrt(t.usdc_amount / 1e6), ${W_MAX}) as weight
      FROM pm_trader_events_dedup_v2_tbl t
      JOIN resolved r ON t.token_id = r.token_id
      WHERE t.token_amount > 0
        AND (t.usdc_amount / 1e6) / nullIf(t.token_amount / 1e6, 0) > 0
        AND (t.usdc_amount / 1e6) / nullIf(t.token_amount / 1e6, 0) < 1.0
    )
    SELECT
      wallet,
      trade_date,
      count() as fills,
      countIf(role = 'maker') as maker_fills,
      countIf(role = 'taker') as taker_fills,
      sum(weight) as sum_w,
      sum(weight * markout_bps) as sum_wx,
      sum(weight * pow(markout_bps, 2)) as sum_wx2,
      sum(notional) as total_notional
    FROM scored
    GROUP BY wallet, trade_date
  `;

  const startTime = Date.now();
  await clickhouse.command({
    query: insertQuery,
    clickhouse_settings: {
      max_execution_time: 3600,
      max_threads: 16,
      max_memory_usage: 10000000000,
      max_bytes_before_external_group_by: 2000000000,
      max_bytes_before_external_sort: 2000000000,
    }
  });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  Completed in ${elapsed}s\n`);

  // Final summary
  console.log('=== FINAL SUMMARY ===');
  const finalResult = await clickhouse.query({
    query: `
      SELECT
        count() as rows,
        countDistinct(wallet) as wallets,
        min(trade_date) as min_date,
        max(trade_date) as max_date,
        sum(fills) as fills
      FROM wallet_daily_stats_v2
    `,
    format: 'JSONEachRow'
  });
  const final = (await finalResult.json() as any[])[0];
  console.log(`Total rows: ${Number(final.rows).toLocaleString()}`);
  console.log(`Unique wallets: ${Number(final.wallets).toLocaleString()}`);
  console.log(`Date range: ${final.min_date} to ${final.max_date}`);
  console.log(`Total fills: ${Number(final.fills).toLocaleString()}`);

  console.log('\n✅ Done! Now run query-dual-horizon-tstat-v2.ts');
}

main().catch(console.error);
