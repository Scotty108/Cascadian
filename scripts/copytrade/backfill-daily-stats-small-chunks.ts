/**
 * Backfill Daily Stats with 1-day chunks
 *
 * Handles high-volume periods (election, recent months) by processing
 * one day at a time to stay under memory limits.
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
  console.log('=== BACKFILL DAILY STATS (1-DAY CHUNKS) ===\n');

  // Get current max date
  const stateResult = await clickhouse.query({
    query: `SELECT max(trade_date) as max_date FROM wallet_daily_stats_v1`,
    format: 'JSONEachRow'
  });
  const state = (await stateResult.json() as any[])[0];
  const startDate = new Date(state.max_date);
  startDate.setDate(startDate.getDate() + 1); // Start from day after last

  const endDate = new Date();

  console.log(`Backfilling from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}\n`);

  let currentDate = startDate;
  let totalInserted = 0;
  let errors = 0;

  while (currentDate < endDate) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const nextDate = new Date(currentDate);
    nextDate.setDate(nextDate.getDate() + 1);
    const nextStr = nextDate.toISOString().split('T')[0];

    process.stdout.write(`${dateStr}...`);

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
            AND toDate(trade_time) = '${dateStr}'
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
          max_execution_time: 600,
          max_memory_usage: 8000000000,
        }
      });

      const countResult = await clickhouse.query({
        query: `SELECT count() as cnt FROM wallet_daily_stats_v1 WHERE trade_date = '${dateStr}'`,
        format: 'JSONEachRow'
      });
      const cnt = (await countResult.json() as any[])[0].cnt;
      totalInserted += Number(cnt);
      console.log(` ${Number(cnt).toLocaleString()} rows`);
    } catch (err: any) {
      errors++;
      console.log(` ERROR: ${err.message.slice(0, 60)}`);
    }

    currentDate = nextDate;
  }

  console.log(`\n=== COMPLETE ===`);
  console.log(`Total inserted: ${totalInserted.toLocaleString()} rows`);
  console.log(`Errors: ${errors}`);

  // Final summary
  const finalResult = await clickhouse.query({
    query: `
      SELECT
        count() as rows,
        min(trade_date) as min_date,
        max(trade_date) as max_date,
        sum(fills) as fills
      FROM wallet_daily_stats_v1
    `,
    format: 'JSONEachRow'
  });
  const final = (await finalResult.json() as any[])[0];
  console.log(`\nFinal state: ${Number(final.rows).toLocaleString()} rows, ${final.min_date} to ${final.max_date}`);
}

main().catch(console.error);
