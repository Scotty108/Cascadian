/**
 * Build Wallet Daily Stats V2 with Monthly Partitioning
 *
 * Uses monthly chunks with disk spill for high-volume periods.
 * Properly dedupes the 66% duplicate rows in pm_trader_events_v2.
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
  console.log('=== BUILD WALLET DAILY STATS V2 (MONTHLY PARTITIONS) ===\n');

  // Step 1: Create v2 with partitioning
  console.log('Step 1: Creating wallet_daily_stats_v2 with monthly partitioning...');

  await clickhouse.command({
    query: 'DROP TABLE IF EXISTS wallet_daily_stats_v2'
  });

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
  console.log('  Created wallet_daily_stats_v2\n');

  // Step 2: Copy existing data from v1
  console.log('Step 2: Copying existing data from v1...');
  await clickhouse.command({
    query: `INSERT INTO wallet_daily_stats_v2 SELECT * FROM wallet_daily_stats_v1`,
    clickhouse_settings: { max_execution_time: 300 }
  });

  const v1Count = await clickhouse.query({
    query: 'SELECT count() as cnt, max(trade_date) as max_date FROM wallet_daily_stats_v2',
    format: 'JSONEachRow'
  });
  const v1 = (await v1Count.json() as any[])[0];
  console.log(`  Copied ${Number(v1.cnt).toLocaleString()} rows, max date: ${v1.max_date}\n`);

  // Step 3: Backfill missing months
  console.log('Step 3: Backfilling missing months with dedupe + disk spill...\n');

  // Get months to backfill
  const months = [
    '2024-10', '2024-11', '2024-12',
    '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06',
    '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12'
  ];

  for (const month of months) {
    const [year, mon] = month.split('-');
    const startDate = `${year}-${mon}-01`;
    const endDate = new Date(parseInt(year), parseInt(mon), 1).toISOString().split('T')[0];
    const partition = `${year}${mon}`;

    process.stdout.write(`  ${month}...`);

    // Skip if already have data
    const existingCheck = await clickhouse.query({
      query: `SELECT count() as cnt FROM wallet_daily_stats_v2 WHERE toYYYYMM(trade_date) = ${partition}`,
      format: 'JSONEachRow'
    });
    const existing = (await existingCheck.json() as any[])[0];
    if (Number(existing.cnt) > 0) {
      console.log(` already has ${Number(existing.cnt).toLocaleString()} rows, skipping`);
      continue;
    }

    // Check if we have trades for this month
    const tradeCheck = await clickhouse.query({
      query: `
        SELECT count() as cnt
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND trade_time >= '${startDate}'
          AND trade_time < '${endDate}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });
    const trades = (await tradeCheck.json() as any[])[0];
    if (Number(trades.cnt) === 0) {
      console.log(' no trades, skipping');
      continue;
    }

    // Insert with dedupe + disk spill
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
      filtered AS (
        SELECT *
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND token_amount > 0
          AND trade_time >= '${startDate}'
          AND trade_time < '${endDate}'
          AND token_id IN (SELECT token_id FROM resolved)
      ),
      deduped AS (
        SELECT
          event_id,
          any(trader_wallet) as wallet,
          any(token_id) as token_id,
          any(side) as side,
          right(event_id, 2) as role_suffix,
          any(usdc_amount) / 1e6 as notional,
          any(usdc_amount) / nullIf(any(token_amount), 0) as entry_price,
          toDate(any(trade_time)) as trade_date
        FROM filtered
        GROUP BY event_id
      ),
      scored AS (
        SELECT
          d.wallet,
          d.trade_date,
          d.role_suffix,
          d.notional,
          CASE
            WHEN lower(d.side) = 'buy'
            THEN ((r.outcome / d.entry_price) - 1) * 10000
            ELSE (1 - (r.outcome / d.entry_price)) * 10000
          END as markout_bps,
          least(sqrt(d.notional), ${W_MAX}) as weight
        FROM deduped d
        JOIN resolved r ON d.token_id = r.token_id
        WHERE d.entry_price > 0 AND d.entry_price < 1.0
      )
      SELECT
        wallet,
        trade_date,
        count() as fills,
        countIf(role_suffix = '-m') as maker_fills,
        countIf(role_suffix = '-t') as taker_fills,
        sum(weight) as sum_w,
        sum(weight * markout_bps) as sum_wx,
        sum(weight * pow(markout_bps, 2)) as sum_wx2,
        sum(notional) as total_notional
      FROM scored
      GROUP BY wallet, trade_date
    `;

    try {
      const startTime = Date.now();
      await clickhouse.command({
        query: insertQuery,
        clickhouse_settings: {
          max_execution_time: 1200,
          max_threads: 12,
          max_memory_usage: 9000000000,
          max_bytes_before_external_group_by: 1000000000,
          max_bytes_before_external_sort: 1000000000,
        }
      });

      const countResult = await clickhouse.query({
        query: `SELECT count() as cnt FROM wallet_daily_stats_v2 WHERE toYYYYMM(trade_date) = ${partition}`,
        format: 'JSONEachRow'
      });
      const cnt = (await countResult.json() as any[])[0].cnt;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(` ${Number(cnt).toLocaleString()} rows in ${elapsed}s`);
    } catch (err: any) {
      console.log(` ERROR: ${err.message.slice(0, 80)}`);
    }
  }

  // Final summary
  console.log('\n=== FINAL SUMMARY ===');
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
