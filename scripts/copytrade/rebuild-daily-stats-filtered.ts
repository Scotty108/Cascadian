/**
 * Rebuild wallet_daily_stats_v2 with 10-90% price filter
 * Excludes scalpers betting on near-certainties
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { clickhouse } from '../../lib/clickhouse/client.js';

const W_MAX = 1000;
const MIN_PRICE = 0.10;
const MAX_PRICE = 0.90;

async function main() {
  console.log('=== REBUILD DAILY STATS WITH PRICE FILTER ===');
  console.log(`Filter: entry_price between ${MIN_PRICE} and ${MAX_PRICE}\n`);

  // Drop and recreate
  console.log('Dropping old table...');
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS wallet_daily_stats_v2' });

  console.log('Creating new table...');
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

  console.log('Inserting data with price filter...\n');

  const insertQuery = `
    INSERT INTO wallet_daily_stats_v2
    WITH
    resolved AS (
      SELECT
        m.condition_id,
        arrayElement(m.token_ids, 1) as yes_token,
        arrayElement(m.token_ids, 2) as no_token,
        toFloat64(JSONExtractInt(r.payout_numerators, 1)) as yes_payout,
        toFloat64(JSONExtractInt(r.payout_numerators, 2)) as no_payout
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
        multiIf(t.token_id = r.yes_token, r.yes_payout, t.token_id = r.no_token, r.no_payout, 0) as outcome,
        (t.usdc_amount / 1e6) / nullIf(t.token_amount / 1e6, 0) as entry_price,
        CASE
          WHEN lower(t.side) = 'buy'
          THEN ((multiIf(t.token_id = r.yes_token, r.yes_payout, t.token_id = r.no_token, r.no_payout, 0) /
                ((t.usdc_amount / 1e6) / nullIf(t.token_amount / 1e6, 0))) - 1) * 10000
          ELSE (1 - (multiIf(t.token_id = r.yes_token, r.yes_payout, t.token_id = r.no_token, r.no_payout, 0) /
                ((t.usdc_amount / 1e6) / nullIf(t.token_amount / 1e6, 0)))) * 10000
        END as markout_bps,
        least(sqrt(t.usdc_amount / 1e6), ${W_MAX}) as weight
      FROM pm_trader_events_dedup_v2_tbl t
      JOIN resolved r ON t.token_id = r.yes_token OR t.token_id = r.no_token
      WHERE t.token_amount > 0
        AND (t.usdc_amount / 1e6) / nullIf(t.token_amount / 1e6, 0) > ${MIN_PRICE}
        AND (t.usdc_amount / 1e6) / nullIf(t.token_amount / 1e6, 0) < ${MAX_PRICE}
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
      max_execution_time: 1800,
      max_threads: 16,
      max_memory_usage: 10000000000,
      max_bytes_before_external_group_by: 2000000000,
    }
  });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Completed in ${elapsed}s\n`);

  // Summary
  const result = await clickhouse.query({
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
  const summary = (await result.json() as any[])[0];

  console.log('=== SUMMARY ===');
  console.log(`Rows: ${Number(summary.rows).toLocaleString()}`);
  console.log(`Wallets: ${Number(summary.wallets).toLocaleString()}`);
  console.log(`Date range: ${summary.min_date} to ${summary.max_date}`);
  console.log(`Total fills: ${Number(summary.fills).toLocaleString()}`);
}

main().catch(console.error);
