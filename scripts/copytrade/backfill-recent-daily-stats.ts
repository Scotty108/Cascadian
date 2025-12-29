/**
 * Backfill Recent Daily Stats (smaller chunks to avoid memory issues)
 *
 * Processes 2024-10-01 to present in 7-day chunks
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
  console.log('=== BACKFILL RECENT DAILY STATS ===\n');

  // Check current state
  const stateResult = await clickhouse.query({
    query: `
      SELECT
        max(trade_date) as max_date,
        count() as total_rows
      FROM wallet_daily_stats_v1
    `,
    format: 'JSONEachRow'
  });
  const state = (await stateResult.json() as any[])[0];
  console.log(`Current state: ${Number(state.total_rows).toLocaleString()} rows, max date: ${state.max_date}\n`);

  // Process from 2024-10-01 in 7-day chunks
  const startDate = new Date('2024-10-01');
  const endDate = new Date();
  const chunkDays = 7;

  let currentStart = startDate;

  while (currentStart < endDate) {
    const currentEnd = new Date(currentStart);
    currentEnd.setDate(currentEnd.getDate() + chunkDays);
    if (currentEnd > endDate) currentEnd.setTime(endDate.getTime());

    const startStr = currentStart.toISOString().split('T')[0];
    const endStr = currentEnd.toISOString().split('T')[0];

    process.stdout.write(`Processing ${startStr} to ${endStr}...`);

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
            AND toDate(trade_time) >= '${startStr}'
            AND toDate(trade_time) < '${endStr}'
            AND token_id IN (SELECT token_id FROM resolved)
        ),
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
        SELECT
          d.wallet,
          d.trade_date,
          d.role,
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
      GROUP BY wallet, trade_date
    `;

    try {
      await clickhouse.command({
        query: insertQuery,
        clickhouse_settings: {
          max_execution_time: 300,
          max_memory_usage: 8000000000, // 8GB
        }
      });

      const countResult = await clickhouse.query({
        query: `
          SELECT count() as cnt
          FROM wallet_daily_stats_v1
          WHERE trade_date >= '${startStr}' AND trade_date < '${endStr}'
        `,
        format: 'JSONEachRow'
      });
      const countRow = (await countResult.json() as any[])[0];
      console.log(` ${Number(countRow.cnt).toLocaleString()} rows`);
    } catch (err: any) {
      console.log(` ERROR: ${err.message.slice(0, 80)}`);
    }

    currentStart = currentEnd;
  }

  // Final summary
  console.log('\n=== FINAL SUMMARY ===');
  const finalResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        countDistinct(wallet) as unique_wallets,
        min(trade_date) as min_date,
        max(trade_date) as max_date,
        sum(fills) as total_fills
      FROM wallet_daily_stats_v1
    `,
    format: 'JSONEachRow'
  });
  const final = (await finalResult.json() as any[])[0];
  console.log(`Total rows: ${Number(final.total_rows).toLocaleString()}`);
  console.log(`Unique wallets: ${Number(final.unique_wallets).toLocaleString()}`);
  console.log(`Date range: ${final.min_date} to ${final.max_date}`);
  console.log(`Total fills: ${Number(final.total_fills).toLocaleString()}`);
}

main().catch(console.error);
