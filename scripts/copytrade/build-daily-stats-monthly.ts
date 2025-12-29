/**
 * Build Wallet Daily Stats - Monthly Chunks from Dedup Table
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
  console.log('=== BUILD DAILY STATS (MONTHLY CHUNKS FROM DEDUP) ===\n');

  // Check if table exists, create if not
  const tableExists = await clickhouse.query({
    query: `SELECT count() FROM system.tables WHERE name = 'wallet_daily_stats_v2'`,
    format: 'JSONEachRow'
  });
  const exists = (await tableExists.json() as any[])[0]['count()'];

  if (Number(exists) === 0) {
    console.log('Creating wallet_daily_stats_v2...');
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
    console.log('  Created\n');
  }

  // Get months to process
  const months: string[] = [];
  const start = new Date('2022-11-01');
  const end = new Date();
  let current = new Date(start);
  while (current <= end) {
    months.push(current.toISOString().slice(0, 7)); // YYYY-MM
    current.setMonth(current.getMonth() + 1);
  }

  console.log(`Processing ${months.length} months...\n`);

  for (const month of months) {
    const [year, mon] = month.split('-');
    const partition = parseInt(`${year}${mon}`);
    const startDate = `${month}-01`;
    const nextMonth = new Date(parseInt(year), parseInt(mon), 1);
    const endDate = nextMonth.toISOString().split('T')[0];

    // Check if partition exists
    const partCheck = await clickhouse.query({
      query: `SELECT count() as cnt FROM wallet_daily_stats_v2 WHERE toYYYYMM(trade_date) = ${partition}`,
      format: 'JSONEachRow'
    });
    const partRows = (await partCheck.json() as any[])[0].cnt;

    if (Number(partRows) > 0) {
      console.log(`${month}: ${Number(partRows).toLocaleString()} rows (exists)`);
      continue;
    }

    process.stdout.write(`${month}...`);

    const insertQuery = `
      INSERT INTO wallet_daily_stats_v2
      WITH
      -- Map each token to its outcome payout (NO division - values are 0 or 1)
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
          -- Get the correct payout for this token (YES or NO)
          multiIf(t.token_id = r.yes_token, r.yes_payout, t.token_id = r.no_token, r.no_payout, 0) as outcome,
          (t.usdc_amount / 1e6) / nullIf(t.token_amount / 1e6, 0) as entry_price,
          -- Side-aware markout: BUY profits when outcome > entry, SELL profits when outcome < entry
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
        WHERE t.trade_date >= '${startDate}'
          AND t.trade_date < '${endDate}'
          AND t.token_amount > 0
          AND (t.usdc_amount / 1e6) / nullIf(t.token_amount / 1e6, 0) > 0.10
          AND (t.usdc_amount / 1e6) / nullIf(t.token_amount / 1e6, 0) < 0.90
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

    try {
      const startTime = Date.now();
      await clickhouse.command({
        query: insertQuery,
        clickhouse_settings: {
          max_execution_time: 600,
          max_threads: 16,
          max_memory_usage: 9000000000,
          max_bytes_before_external_group_by: 1500000000,
        }
      });

      const countResult = await clickhouse.query({
        query: `SELECT count() as cnt FROM wallet_daily_stats_v2 WHERE toYYYYMM(trade_date) = ${partition}`,
        format: 'JSONEachRow'
      });
      const cnt = (await countResult.json() as any[])[0].cnt;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(` ${Number(cnt).toLocaleString()} rows (${elapsed}s)`);
    } catch (err: any) {
      console.log(` ERROR: ${err.message.slice(0, 60)}`);
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
}

main().catch(console.error);
