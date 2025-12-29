/**
 * Build Wallet Daily Sufficient Statistics Table
 *
 * Stores per (wallet, day):
 * - fills, maker_fills, taker_fills
 * - sum_w (sum of weights)
 * - sum_wx (sum of weight * markout_bps)
 * - sum_wx2 (sum of weight * markout_bps^2)
 *
 * This allows computing t-stat over ANY window by summing these fields.
 *
 * CRITICAL: Side-aware markout formula
 * - BUY:  return = (outcome / entry_price) - 1
 * - SELL: return = 1 - (outcome / entry_price)
 *
 * Where outcome is the resolution price (0 or 1 for binary markets)
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { clickhouse } from '../../lib/clickhouse/client.js';

const W_MAX = 1000; // Weight cap

async function main() {
  console.log('=== BUILD WALLET DAILY STATS TABLE ===\n');
  console.log('This creates a compact sufficient statistics table for t-stat calculations.\n');

  // Step 1: Drop and recreate table
  console.log('Step 1: Creating wallet_daily_stats table...');

  await clickhouse.command({
    query: 'DROP TABLE IF EXISTS wallet_daily_stats_v1'
  });

  const createTableQuery = `
    CREATE TABLE wallet_daily_stats_v1
    (
      wallet String,
      trade_date Date,
      fills UInt32,
      maker_fills UInt32,
      taker_fills UInt32,
      sum_w Float64,        -- sum of weights
      sum_wx Float64,       -- sum of weight * markout_bps
      sum_wx2 Float64,      -- sum of weight * markout_bps^2
      total_notional Float64
    )
    ENGINE = SummingMergeTree()
    ORDER BY (wallet, trade_date)
  `;

  await clickhouse.command({ query: createTableQuery });
  console.log('  Table created\n');

  // Step 2: Populate with correct side-aware markout
  console.log('Step 2: Populating with resolution-based markout (side-aware)...');
  console.log('  Formula:');
  console.log('    BUY:  markout_bps = ((outcome / entry_price) - 1) * 10000');
  console.log('    SELL: markout_bps = (1 - (outcome / entry_price)) * 10000');
  console.log('');

  // Break into date ranges to avoid timeout
  // First, get the date range
  const dateRangeResult = await clickhouse.query({
    query: `
      SELECT
        min(trade_time) as min_date,
        max(trade_time) as max_date
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const dateRange = (await dateRangeResult.json() as any[])[0];
  console.log(`  Trade data range: ${dateRange.min_date} to ${dateRange.max_date}\n`);

  // Process in chunks of 30 days
  const startDate = new Date('2022-11-01'); // Start from when Polymarket had significant activity
  const endDate = new Date();
  const chunkDays = 30;

  let currentStart = startDate;
  let totalRows = 0;

  while (currentStart < endDate) {
    const currentEnd = new Date(currentStart);
    currentEnd.setDate(currentEnd.getDate() + chunkDays);
    if (currentEnd > endDate) currentEnd.setTime(endDate.getTime());

    const startStr = currentStart.toISOString().split('T')[0];
    const endStr = currentEnd.toISOString().split('T')[0];

    process.stdout.write(`  Processing ${startStr} to ${endStr}...`);

    const insertQuery = `
      INSERT INTO wallet_daily_stats_v1
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
      FROM (
        WITH
        -- Resolved markets with outcome prices
        resolved AS (
          SELECT
            m.condition_id,
            arrayJoin(m.token_ids) as token_id,
            -- payout_numerators[1] / 1e6 = outcome (0 or 1 for binary)
            toFloat64(JSONExtractInt(r.payout_numerators, 1)) / 1000000.0 as outcome
          FROM pm_market_metadata m
          JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
          WHERE r.is_deleted = 0
        ),

        -- Pre-filter trades to date range and resolved markets
        filtered AS (
          SELECT *
          FROM pm_trader_events_v2
          WHERE is_deleted = 0
            AND token_amount > 0
            AND toDate(trade_time) >= '${startStr}'
            AND toDate(trade_time) < '${endStr}'
            AND token_id IN (SELECT token_id FROM resolved)
        ),

        -- Dedupe by event_id
        deduped AS (
          SELECT
            event_id,
            any(trader_wallet) as wallet,
            any(token_id) as token_id,
            any(side) as side,
            any(role) as role,
            any(usdc_amount) / 1e6 as notional,
            any(usdc_amount) / nullIf(any(token_amount), 0) as entry_price,
            toDate(any(trade_time)) as trade_date
          FROM filtered
          GROUP BY event_id
        )

        -- Calculate side-aware markout
        SELECT
          d.wallet,
          d.trade_date,
          d.role,
          d.notional,
          -- CRITICAL: Side-aware markout formula
          -- BUY: (outcome / entry_price) - 1
          -- SELL: 1 - (outcome / entry_price)
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
      GROUP BY wallet, trade_date
    `;

    try {
      await clickhouse.command({
        query: insertQuery,
        clickhouse_settings: { max_execution_time: 300 }
      });

      // Get row count for this chunk
      const countResult = await clickhouse.query({
        query: `
          SELECT count() as cnt
          FROM wallet_daily_stats_v1
          WHERE trade_date >= '${startStr}' AND trade_date < '${endStr}'
        `,
        format: 'JSONEachRow'
      });
      const countRow = (await countResult.json() as any[])[0];
      const chunkRows = Number(countRow.cnt);
      totalRows += chunkRows;
      console.log(` ${chunkRows.toLocaleString()} rows`);
    } catch (err: any) {
      console.log(` ERROR: ${err.message.slice(0, 100)}`);
    }

    currentStart = currentEnd;
  }

  // Step 3: Verify and summarize
  console.log('\nStep 3: Verifying table...');

  const summaryResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        countDistinct(wallet) as unique_wallets,
        min(trade_date) as min_date,
        max(trade_date) as max_date,
        sum(fills) as total_fills,
        sum(maker_fills) as total_maker_fills,
        sum(taker_fills) as total_taker_fills
      FROM wallet_daily_stats_v1
    `,
    format: 'JSONEachRow'
  });
  const summary = (await summaryResult.json() as any[])[0];

  console.log('\n=== SUMMARY ===');
  console.log(`  Total rows: ${Number(summary.total_rows).toLocaleString()}`);
  console.log(`  Unique wallets: ${Number(summary.unique_wallets).toLocaleString()}`);
  console.log(`  Date range: ${summary.min_date} to ${summary.max_date}`);
  console.log(`  Total fills: ${Number(summary.total_fills).toLocaleString()}`);
  console.log(`  Maker fills: ${Number(summary.total_maker_fills).toLocaleString()} (${(100 * summary.total_maker_fills / summary.total_fills).toFixed(1)}%)`);
  console.log(`  Taker fills: ${Number(summary.total_taker_fills).toLocaleString()} (${(100 * summary.total_taker_fills / summary.total_fills).toFixed(1)}%)`);

  // Verify the math works
  console.log('\n=== SAMPLE T-STAT CALCULATION ===');
  const sampleResult = await clickhouse.query({
    query: `
      WITH wallet_totals AS (
        SELECT
          wallet,
          sum(fills) as total_fills,
          sum(sum_w) as sum_w,
          sum(sum_wx) as sum_wx,
          sum(sum_wx2) as sum_wx2
        FROM wallet_daily_stats_v1
        GROUP BY wallet
        HAVING total_fills >= 50
      )
      SELECT
        wallet,
        total_fills,
        round(sum_wx / sum_w, 2) as weighted_mean_bps,
        round(sqrt(greatest((sum_wx2 / sum_w) - pow(sum_wx / sum_w, 2), 0)), 2) as weighted_std_bps,
        round((sum_wx / sum_w) / (sqrt(greatest((sum_wx2 / sum_w) - pow(sum_wx / sum_w, 2), 0)) + 1) * sqrt(total_fills), 2) as t_stat
      FROM wallet_totals
      WHERE sum_wx / sum_w > 0  -- positive edge
      ORDER BY t_stat DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  console.log('Top 10 wallets by lifetime t-stat:');
  console.log('Wallet                                     | Fills  | Mean(bps) | Std(bps) | t-stat');
  console.log('-------------------------------------------|--------|-----------|----------|-------');

  const sampleRows = await sampleResult.json() as any[];
  sampleRows.forEach((r: any) => {
    console.log(`${r.wallet} | ${String(r.total_fills).padStart(6)} | ${String(r.weighted_mean_bps).padStart(9)} | ${String(r.weighted_std_bps).padStart(8)} | ${String(r.t_stat).padStart(6)}`);
  });

  console.log('\n✅ Table built successfully. Ready for dual-horizon t-stat queries.');
}

main().catch(console.error);
